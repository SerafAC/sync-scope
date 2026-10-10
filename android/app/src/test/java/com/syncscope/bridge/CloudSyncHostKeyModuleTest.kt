package com.syncscope.bridge

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.PresentedHostKey
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.SftpHostKeyException
import java.util.Base64
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import net.schmizz.sshj.common.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * approveSftpHostKey / rejectSftpHostKey through the real module surface, and the browser's host-key
 * round trip (browseRemoteFolders, contract version 6).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CloudSyncHostKeyModuleTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var store: HostKeyTrustStore
  private lateinit var module: CloudSyncModule
  private val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    store = HostKeyTrustStore(db.trustedSftpHostKeyDao())
    @Suppress("DEPRECATION")
    module =
      CloudSyncModule(
        BridgeReactContext(context),
        dispatcher = Dispatchers.Unconfined,
        envelope = envelope,
        hostKeyTrust = { store },
      )
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun approvePersistsTheKeyAndResolvesOk() = runBlocking {
    val challengeId = raiseChallenge()
    val promise = RecordingPromise()

    module.approveSftpHostKey(challengeId, promise)

    assertEquals("ok", (promise.await() as ReadableMap).getString("status"))
    val row = db.trustedSftpHostKeyDao().forHost(HOST, 22).single()
    assertEquals("ssh-ed25519", row.algorithm)
    assertEquals(FINGERPRINT, row.fingerprint)
    assertNull(promise.rejectedCode)
  }

  @Test
  fun rejectResolvesOkAndPersistsNothing() = runBlocking {
    val challengeId = raiseChallenge()
    val promise = RecordingPromise()

    module.rejectSftpHostKey(challengeId, promise)

    assertEquals("ok", (promise.await() as ReadableMap).getString("status"))
    assertTrue(db.trustedSftpHostKeyDao().forHost(HOST, 22).isEmpty())
  }

  @Test
  fun unknownOrConsumedChallengeResolvesTypedErrorNotRejection() {
    val challengeId = raiseChallenge()
    module.rejectSftpHostKey(challengeId, RecordingPromise())

    for (call in listOf<(RecordingPromise) -> Unit>(
      { module.approveSftpHostKey("does-not-exist", it) },
      { module.rejectSftpHostKey("does-not-exist", it) },
      { module.approveSftpHostKey(challengeId, it) },
    )) {
      val promise = RecordingPromise()
      call(promise)
      val result = promise.await() as ReadableMap
      assertEquals("error", result.getString("status"))
      assertEquals("HOST_KEY_CHALLENGE_NOT_FOUND", result.getMap("error")!!.getString("code"))
      assertNull(promise.rejectedCode)
    }
  }

  @Test
  fun hostKeyEnvelopeCarriesTheChallengeButTheMessageStaysHostFree() {
    val challenge =
      HostKeyChallenge("c-1", HOST, 22, "ssh-ed25519", KEY_BLOB, FINGERPRINT, "SHA256:old", 0L)

    val unverified = envelope.hostKeyApprovalRequired(challenge).getMap("error")!!
    val changed =
      envelope
        .remoteFailure(SftpHostKeyException(CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED, challenge))
        .getMap("error")!!

    assertEquals("SFTP_HOST_KEY_UNVERIFIED", unverified.getString("code"))
    assertEquals("SFTP_HOST_KEY_CHANGED", changed.getString("code"))
    for (error in listOf(unverified, changed)) {
      val dto = error.getMap("hostKeyChallenge")!!
      assertEquals("c-1", dto.getString("challengeId"))
      assertEquals(HOST, dto.getString("host"))
      assertEquals(22, dto.getInt("port"))
      assertEquals("ssh-ed25519", dto.getString("algorithm"))
      assertEquals(FINGERPRINT, dto.getString("fingerprint"))
      assertEquals("SHA256:old", dto.getString("previousFingerprint"))
      assertFalse(dto.hasKey("keyBase64"))
      assertFalse(error.getString("message")!!.contains(HOST))
    }
  }

  @Test
  fun ordinaryErrorsCarryNoChallenge() {
    val error = envelope.error(CloudSyncErrorCode.AUTH_FAILED, "no").getMap("error")!!

    assertFalse(error.hasKey("hostKeyChallenge"))
  }

  @Test
  fun browseReturnsTheChallengeAndListsAfterApproval() = runBlocking {
    val listed = mutableListOf<String>()
    val browser = moduleWith(RemoteClientFactory { UntrustedUntilApproved(listed) })
    val first = RecordingPromise()

    browser.browseRemoteFolders(draft(), "pw", "/scan", first)

    val error = (first.await() as ReadableMap).getMap("error")!!
    assertEquals("SFTP_HOST_KEY_UNVERIFIED", error.getString("code"))
    val challengeId = error.getMap("hostKeyChallenge")!!.getString("challengeId")!!
    assertTrue("nothing listed before the key is trusted", listed.isEmpty())

    val approve = RecordingPromise()
    browser.approveSftpHostKey(challengeId, approve)
    assertEquals("ok", (approve.await() as ReadableMap).getString("status"))

    val retry = RecordingPromise()
    browser.browseRemoteFolders(draft(), "pw", "/scan", retry)

    val result = retry.await() as ReadableMap
    assertEquals("ok", result.getString("status"))
    val folders = result.getMap("remoteFolders")!!
    assertEquals("/scan", folders.getString("path"))
    assertEquals("/", folders.getString("parent"))
    assertFalse(folders.getBoolean("fellBackToRoot"))
    assertEquals("clean", folders.getArray("folders")!!.getString(0))
    assertEquals(listOf("/scan"), listed)
    assertTrue("browse never saves a repository", db.repositoryConfigDao().get() == null)
  }

  private fun moduleWith(clients: RemoteClientFactory): CloudSyncModule {
    val context = ApplicationProvider.getApplicationContext<Context>()
    @Suppress("DEPRECATION")
    return CloudSyncModule(
      BridgeReactContext(context),
      dispatcher = Dispatchers.Unconfined,
      envelope = envelope,
      hostKeyTrust = { store },
      repositoryConfig = { db.repositoryConfigDao() },
      remoteClients = clients,
    )
  }

  private fun draft(): JavaOnlyMap =
    JavaOnlyMap().apply {
      putString("protocol", "SFTP")
      putString("host", HOST)
      putDouble("port", 22.0)
      putString("username", "alice")
    }

  /** An SFTP client whose server key is untrusted until the user approves it (TOFU, through [store]). */
  private inner class UntrustedUntilApproved(private val listed: MutableList<String>) : RemoteClient {
    override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
      if (store.isTrusted(config.host, config.port)) return ConnectOutcome.Connected
      val key = Buffer.PlainBuffer(Base64.getDecoder().decode(KEY_BLOB)).readPublicKey()
      return ConnectOutcome.HostKeyApprovalRequired(
        store.challenges.raise(config.host, config.port, PresentedHostKey.of(key), null),
      )
    }

    override suspend fun list(directory: String): List<RemoteEntry> {
      listed += directory
      return listOf(RemoteEntry("clean", 0, null, RemoteEntryType.DIRECTORY))
    }

    override suspend fun discoverPrecision() = PrecisionFinding(1000L, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)

    override fun close() = Unit
  }

  private fun raiseChallenge(): String {
    val key = Buffer.PlainBuffer(Base64.getDecoder().decode(KEY_BLOB)).readPublicKey()
    return store.challenges.raise(HOST, 22, PresentedHostKey.of(key), null).challengeId
  }

  private companion object {
    const val HOST = "sftp.example.test"
    const val KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOdJBz774N97LZvrLI0+A0poQyGnaZ0EGGkLxgwWHrqV"
    const val FINGERPRINT = "SHA256:U3b54O0CASN6rxo5Jas4AiNSVGgFM2adMsobZH67CIg"
  }
}
