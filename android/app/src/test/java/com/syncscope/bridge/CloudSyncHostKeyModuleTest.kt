package com.syncscope.bridge

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PresentedHostKey
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

/** approveSftpHostKey / rejectSftpHostKey through the real module surface. */
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
