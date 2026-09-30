package com.syncscope.debug

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.PresentedHostKey
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteProtocol
import java.util.Base64
import java.util.Collections
import kotlinx.coroutines.runBlocking
import net.schmizz.sshj.common.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.android.controller.ActivityController
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/**
 * The debug-only repository seam (D018): `syncscope-debug://configure-repository?…` runs the production
 * [com.syncscope.bridge.RepositoryOperations] save and test (approving an SFTP host-key challenge once),
 * shows the resulting code, and never lets the password or the deep link reach the view or the log.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ConfigureRepositoryActivityTest {

  private val context = ApplicationProvider.getApplicationContext<Context>()
  private val db =
    Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
  private val hostKeys = HostKeyTrustStore(db.trustedSftpHostKeyDao())
  private val credentials =
    CredentialStore { context.getSharedPreferences("configure-repository-test", Context.MODE_PRIVATE) }
  private val remote = ScriptedRemote(hostKeys)

  @Before
  fun setUp() {
    ShadowLog.clear()
    ConfigureRepositoryActivity.dependencies = {
      ConfigureRepositoryActivity.Dependencies(
        repositories = db.repositoryConfigDao(),
        credentials = credentials,
        hostKeys = hostKeys,
        clients = remote,
        envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
      )
    }
  }

  @After
  fun tearDown() {
    ConfigureRepositoryActivity.dependencies = ConfigureRepositoryActivity.PRODUCTION
    db.close()
  }

  @Test
  fun sftpSavesThenApprovesTheHostKeyChallengeAndTestsAgain() = runBlocking<Unit> {
    val activity = launch(link("SFTP", port = "2222"))

    assertEquals("Repository configured", awaitResult(activity))

    val row = db.repositoryConfigDao().get()
    assertNotNull(row)
    assertEquals("SFTP", row!!.protocol)
    assertEquals("10.0.2.2", row.host)
    assertEquals(2222, row.port)
    assertEquals("e2e", row.username)
    assertEquals("/scan/clean", row.remoteRoot)
    assertEquals(1L, row.revision)
    assertEquals(PASSWORD, String(credentials.load(row.credentialVersion)!!))
    assertEquals("save, then test, then a second test after the approval", 2, remote.connects.size)
    assertTrue("the challenge was approved into the trust store", hostKeys.isTrusted("10.0.2.2", 2222))
    assertEquals(1000L, db.repositoryConfigDao().get()!!.precisionMillis)
  }

  @Test
  fun ftpWithoutAChallengeTestsOnce() {
    val activity = launch(link("FTP", port = "2121"))

    assertEquals("Repository configured", awaitResult(activity))
    assertEquals(1, remote.connects.size)
    assertEquals(RemoteProtocol.FTP, remote.connects.single().protocol)
  }

  @Test
  fun aRejectedLoginShowsTheErrorCode() {
    remote.connectFailure = CloudSyncErrorCode.AUTH_FAILED

    val activity = launch(link("SFTP", port = "2222"))

    assertEquals("Repository error: AUTH_FAILED", awaitResult(activity))
    // The config is saved even though the test failed, so the next scan sees the new revision.
    assertEquals(1L, runBlocking { db.repositoryConfigDao().get()!!.revision })
  }

  @Test
  fun anInvalidConfigIsReportedWithoutTesting() {
    val activity = launch(link("GOPHER", port = "70"))

    assertEquals("Repository error: INVALID_QUERY", awaitResult(activity))
    assertTrue(remote.connects.isEmpty())
  }

  @Test
  fun thePasswordAndTheLinkNeverReachTheViewOrTheLog() {
    remote.connectFailure = CloudSyncErrorCode.AUTH_FAILED
    val first = launch(link("SFTP", port = "2222"))
    val firstText = awaitResult(first)
    remote.connectFailure = null
    val second = launch(link("SFTP", port = "2222"))
    val secondText = awaitResult(second)

    for (text in listOf(firstText, secondText)) {
      assertFalse(text, text.contains(PASSWORD))
      assertFalse(text, text.contains("10.0.2.2"))
    }
    val logged = ShadowLog.getLogs().joinToString("\n") { "${it.tag}: ${it.msg} ${it.throwable ?: ""}" }
    assertFalse(logged, logged.contains(PASSWORD))
    assertFalse("the deep link is never logged", logged.contains("syncscope-debug"))
    assertFalse("the deep link is never logged", logged.contains("configure-repository"))
    assertFalse("the query is never logged", logged.contains("password="))
  }

  private fun link(protocol: String, port: String): Intent =
    Intent(
      Intent.ACTION_VIEW,
      Uri.parse(
        "syncscope-debug://configure-repository?protocol=$protocol&host=10.0.2.2&port=$port" +
          "&username=e2e&password=$PASSWORD&root=%2Fscan%2Fclean"
      ),
    )

  private fun launch(intent: Intent): ActivityController<ConfigureRepositoryActivity> =
    Robolectric.buildActivity(ConfigureRepositoryActivity::class.java, intent).setup()

  /** Idles the main looper until the status reads a final result, then returns it. */
  private fun awaitResult(controller: ActivityController<ConfigureRepositoryActivity>): String {
    val deadline = System.currentTimeMillis() + 10_000
    while (true) {
      shadowOf(Looper.getMainLooper()).idle()
      val text = controller.get().statusView.text.toString()
      if (text.startsWith("Repository ")) return text
      check(System.currentTimeMillis() < deadline) { "the seam never reported a result: $text" }
      Thread.sleep(10)
    }
  }

  /**
   * A remote whose SFTP connects raise a real host-key challenge in [hostKeys] until the key is trusted,
   * like `SftpRemoteClient` does.
   */
  private class ScriptedRemote(private val hostKeys: HostKeyTrustStore) : RemoteClientFactory {
    val connects: MutableList<RemoteConfig> = Collections.synchronizedList(mutableListOf())
    @Volatile var connectFailure: CloudSyncErrorCode? = null

    override fun create(protocol: RemoteProtocol): RemoteClient =
      object : RemoteClient {
        override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
          connects += config
          connectFailure?.let { throw RemoteClientException(it, "Login rejected", "Check the credentials and try again.") }
          if (config.protocol == RemoteProtocol.SFTP && !hostKeys.isTrusted(config.host, config.port)) {
            val key = Buffer.PlainBuffer(Base64.getDecoder().decode(KEY_BLOB)).readPublicKey()
            return ConnectOutcome.HostKeyApprovalRequired(
              hostKeys.challenges.raise(config.host, config.port, PresentedHostKey.of(key), null)
            )
          }
          return ConnectOutcome.Connected
        }

        override suspend fun list(directory: String): List<RemoteEntry> = emptyList()

        override suspend fun discoverPrecision(): PrecisionFinding =
          PrecisionFinding(1000L, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)

        override fun close() = Unit
      }
  }

  private companion object {
    const val PASSWORD = "s3cret-Pass"
    const val KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOdJBz774N97LZvrLI0+A0poQyGnaZ0EGGkLxgwWHrqV"
  }
}
