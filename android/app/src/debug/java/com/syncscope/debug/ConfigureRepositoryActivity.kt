package com.syncscope.debug

import android.app.Activity
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.util.TypedValue
import android.widget.TextView
import androidx.annotation.VisibleForTesting
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.syncscope.bridge.CloudSyncContracts
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.RepositoryOperations
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.scan.ScanPacing
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Debug-only repository seam (D018), reached through
 * `syncscope-debug://configure-repository?protocol=…&host=…&port=…&username=…&password=…&root=…`,
 * plus an optional `scanDelayMs=…` that sets the debug-only per-file scan pause ([ScanPacing],
 * decision log 2026-10-01). A link without it sets the pause back to 0, so only the flows that ask
 * for it run paced.
 *
 * There is no Connect screen until feature 006 (MVP), so the e2e flows configure the live containers here. It
 * runs the production [RepositoryOperations] save, then test; when the test raises an SFTP host-key
 * challenge it approves it through the production [HostKeyTrustStore] and tests again. Nothing is faked:
 * the saved config, credential and trusted key are exactly what the real flow leaves.
 *
 * The result is shown as `Repository configured` or `Repository error: <CODE>` for Maestro to assert. The
 * password is a throwaway per-run container credential; it never reaches the view or the log, and neither
 * the intent nor its URI is ever logged. It lives in `src/debug/` only, so the release build lacks it.
 */
class ConfigureRepositoryActivity : Activity() {

  /** The I/O edges of the production objects; tests swap them for in-memory ones. */
  class Dependencies(
    val repositories: RepositoryConfigDao,
    val credentials: CredentialStore,
    val hostKeys: HostKeyTrustStore,
    val clients: RemoteClientFactory,
    val envelope: CloudSyncEnvelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
  )

  @VisibleForTesting internal lateinit var statusView: TextView

  /** Everything, the database included, runs off the UI thread. */
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    statusView =
      TextView(this).apply {
        text = PENDING
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 20f)
        val padding = (24 * resources.displayMetrics.density).toInt()
        setPadding(padding, padding, padding, padding)
      }
    setContentView(statusView)

    val request = Request.of(intent?.data)
    ScanPacing.setPerFileDelay(applicationContext, request.scanDelayMillis)
    val resolve = dependencies
    val context = applicationContext
    scope.launch {
      val code =
        try {
          configure(request, resolve(context))
        } catch (e: RemoteClientException) {
          e.code.name
        } catch (e: Exception) {
          // The class name only: a message could echo a value from the link.
          Log.e(TAG, "repository seam failed: ${e.javaClass.simpleName}")
          CloudSyncErrorCode.INTERNAL_ERROR.name
        }
      runOnUiThread { statusView.text = if (code == null) CONFIGURED else "$ERROR_PREFIX$code" }
    }
  }

  override fun onDestroy() {
    scope.cancel()
    super.onDestroy()
  }

  /** Save, test, and on a host-key challenge approve and test once more. Null means configured. */
  private suspend fun configure(request: Request, deps: Dependencies): String? {
    val operations =
      RepositoryOperations(
        repositories = { deps.repositories },
        credentials = { deps.credentials },
        hostKeys = { deps.hostKeys },
        clients = { deps.clients },
        envelope = deps.envelope,
      )
    val saved = operations.save(request.config, request.password)
    errorCode(saved)?.let { return it }

    val tested = operations.test()
    val challengeId = challengeIdOf(tested) ?: return errorCode(tested)
    Log.i(TAG, "repository seam: approving the SFTP host key")
    deps.hostKeys.approve(challengeId)
    return errorCode(operations.test())
  }

  private fun errorCode(result: ReadableMap): String? =
    if (result.getString("status") == CloudSyncContracts.STATUS_OK) null
    else result.getMap("error")?.getString("code") ?: CloudSyncErrorCode.INTERNAL_ERROR.name

  private fun challengeIdOf(result: ReadableMap): String? {
    val error = result.takeIf { it.hasKey("error") && !it.isNull("error") }?.getMap("error") ?: return null
    if (!error.hasKey("hostKeyChallenge") || error.isNull("hostKeyChallenge")) return null
    return error.getMap("hostKeyChallenge")?.getString("challengeId")
  }

  /** The link's query as a `saveRepository` config plus the transient password. */
  private class Request(val config: ReadableMap, val password: String?, val scanDelayMillis: Long) {
    companion object {
      fun of(uri: Uri?): Request {
        val config = JavaOnlyMap()
        uri?.getQueryParameter("protocol")?.let { config.putString("protocol", it) }
        uri?.getQueryParameter("host")?.let { config.putString("host", it) }
        uri?.getQueryParameter("username")?.let { config.putString("username", it) }
        uri?.getQueryParameter("root")?.let { config.putString("remoteRoot", it) }
        uri?.getQueryParameter("port")?.let { port ->
          // A non-numeric port is passed as text so the production validation rejects it.
          port.toIntOrNull()?.let { config.putDouble("port", it.toDouble()) } ?: config.putString("port", port)
        }
        val scanDelay = uri?.getQueryParameter("scanDelayMs")?.toLongOrNull() ?: 0L
        return Request(config, uri?.getQueryParameter("password"), scanDelay)
      }
    }
  }

  companion object {
    private const val TAG = "SyncScopeDebug"
    const val PENDING = "Configuring repository…"
    const val CONFIGURED = "Repository configured"
    const val ERROR_PREFIX = "Repository error: "

    /** The production objects: the shared database, credential store and host-key trust store. */
    val PRODUCTION: (Context) -> Dependencies = { context ->
      val hostKeys = HostKeyTrustStore.shared(context)
      Dependencies(
        repositories = SyncScopeDatabase.get(context).repositoryConfigDao(),
        credentials = CredentialStore.shared(context),
        hostKeys = hostKeys,
        clients = RemoteClientFactory.default { hostKeys },
      )
    }

    @VisibleForTesting internal var dependencies: (Context) -> Dependencies = PRODUCTION
  }
}
