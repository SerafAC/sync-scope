package com.syncscope.bridge

import android.util.Log
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.syncscope.codegen.NativeCloudSyncSpec
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.RemoteClientException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * The single CloudSync TurboModule: the entire JS-to-native API.
 *
 * Every method resolves a versioned envelope and never rejects: all work runs
 * on a background dispatcher, and any throwable is converted into a redacted
 * INTERNAL_ERROR envelope so no Kotlin exception ever reaches JS.
 * Methods not yet built resolve a typed NOT_IMPLEMENTED envelope.
 */
class CloudSyncModule(
  reactContext: ReactApplicationContext,
  dispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val envelope: CloudSyncEnvelope = CloudSyncEnvelope(),
  hostKeyTrust: () -> HostKeyTrustStore = { HostKeyTrustStore.shared(reactContext) },
) : NativeCloudSyncSpec(reactContext) {

  private val scope = CoroutineScope(SupervisorJob() + dispatcher)

  /** Resolved on first use, on the background dispatcher, so the database never opens on the UI thread. */
  private val hostKeys by lazy(hostKeyTrust)

  override fun getName(): String = NAME

  override fun invalidate() {
    scope.cancel()
    super.invalidate()
  }

  override fun getContractVersion(promise: Promise) {
    // Resolves a bare number per the spec; there is no envelope to fall back to.
    scope.launch { promise.resolve(CloudSyncContracts.CONTRACT_VERSION) }
  }

  override fun queryFiles(
    snapshotId: String,
    querySpec: ReadableMap,
    pageToken: String?,
    promise: Promise,
  ) = runPage("queryFiles", promise) { envelope.pageNotImplemented("queryFiles") }

  override fun queryTreeChildren(
    snapshotId: String,
    parentId: String?,
    querySpec: ReadableMap,
    pageToken: String?,
    promise: Promise,
  ) = runPage("queryTreeChildren", promise) { envelope.pageNotImplemented("queryTreeChildren") }

  override fun getRepositorySummary(promise: Promise) = notImplemented("getRepositorySummary", promise)

  override fun saveRepository(config: ReadableMap, transientPassword: String?, promise: Promise) =
    notImplemented("saveRepository", promise)

  override fun testRepository(promise: Promise) = notImplemented("testRepository", promise)

  override fun approveSftpHostKey(challengeId: String, promise: Promise) =
    runOperation("approveSftpHostKey", promise) {
      hostKeys.approve(challengeId)
      envelope.ok()
    }

  override fun rejectSftpHostKey(challengeId: String, promise: Promise) =
    runOperation("rejectSftpHostKey", promise) {
      hostKeys.reject(challengeId)
      envelope.ok()
    }

  override fun listSources(promise: Promise) = notImplemented("listSources", promise)

  override fun launchSourcePicker(promise: Promise) = notImplemented("launchSourcePicker", promise)

  override fun removeSource(sourceId: String, promise: Promise) = notImplemented("removeSource", promise)

  override fun getSettings(promise: Promise) = notImplemented("getSettings", promise)

  override fun setIncludeHidden(includeHidden: Boolean, promise: Promise) =
    notImplemented("setIncludeHidden", promise)

  override fun startScan(promise: Promise) = notImplemented("startScan", promise)

  override fun cancelScan(runId: String, promise: Promise) = notImplemented("cancelScan", promise)

  override fun getScanState(promise: Promise) = notImplemented("getScanState", promise)

  override fun getLocalImageHandle(
    snapshotId: String,
    entryId: String,
    spec: ReadableMap,
    promise: Promise,
  ) = notImplemented("getLocalImageHandle", promise)

  override fun prepareLocalDeletion(snapshotId: String, entryIds: ReadableArray, promise: Promise) =
    notImplemented("prepareLocalDeletion", promise)

  override fun executeLocalDeletion(planToken: String, promise: Promise) =
    notImplemented("executeLocalDeletion", promise)

  private fun notImplemented(method: String, promise: Promise) =
    runOperation(method, promise) { envelope.notImplemented(method) }

  /**
   * Resolves an `OperationResultDto`; a [RemoteClientException] keeps its code, any other
   * throwable becomes an INTERNAL_ERROR envelope.
   */
  internal fun runOperation(method: String, promise: Promise, block: suspend () -> Any?) =
    run(method, promise, page = false, block)

  /** Resolves a `FilePageResultDto`; a throwable becomes a page-shaped INTERNAL_ERROR envelope. */
  internal fun runPage(method: String, promise: Promise, block: suspend () -> Any?) =
    run(method, promise, page = true, block)

  private fun run(method: String, promise: Promise, page: Boolean, block: suspend () -> Any?) {
    scope.launch {
      val result =
        try {
          block()
        } catch (e: RemoteClientException) {
          Log.w(TAG, "$method failed: ${e.code} reply=${e.replyCode}")
          envelope.remoteFailure(e, page)
        } catch (t: Throwable) {
          Log.e(TAG, "$method failed: ${CloudSyncEnvelope.redact(t.toString())}")
          envelope.internalError(t, page)
        }
      promise.resolve(result)
    }
  }

  companion object {
    const val NAME = CloudSyncContracts.MODULE_NAME
    private const val TAG = "CloudSync"
  }
}
