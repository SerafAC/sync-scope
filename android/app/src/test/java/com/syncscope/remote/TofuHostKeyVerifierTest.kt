package com.syncscope.remote

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.TrustedSftpHostKeyDao
import java.security.KeyPairGenerator
import java.security.PublicKey
import java.util.Base64
import kotlinx.coroutines.runBlocking
import net.schmizz.sshj.common.Buffer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Decision table for blocking TOFU (R002), against a real in-memory Room database. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class TofuHostKeyVerifierTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var dao: TrustedSftpHostKeyDao
  private lateinit var store: HostKeyTrustStore
  private var now = 1_000_000L

  @Before
  fun setUp() {
    db =
      Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext<Context>(), SyncScopeDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    dao = db.trustedSftpHostKeyDao()
    store = HostKeyTrustStore(dao, HostKeyChallengeRegistry(clock = { now }), clock = { now })
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun fingerprintsMatchOpenSshByteForByte() {
    // Expected values are `ssh-keygen -lf key.pub -E sha256|md5` output for SERVER_KEY.
    assertEquals(SERVER_KEY_SHA256, SshFingerprints.sha256(SERVER_KEY))
    assertEquals(SERVER_KEY_MD5, SshFingerprints.md5(SERVER_KEY))
    assertEquals(ROTATED_KEY_SHA256, SshFingerprints.sha256(ROTATED_KEY))

    val presented = PresentedHostKey.of(SERVER_KEY)
    assertEquals("ssh-ed25519", presented.algorithm)
    // The persisted blob is exactly the second field of the OpenSSH public key line.
    assertEquals(SERVER_KEY_BLOB, presented.keyBase64)
  }

  @Test
  fun unknownHostRaisesChallengeAndRefusesConnect() = runBlocking {
    val verifier = store.verifierFor(HOST, PORT)

    assertFalse(verifier.verify(HOST, PORT, SERVER_KEY))

    val rejection = requireNotNull(verifier.rejection)
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, rejection.code)
    val challenge = rejection.challenge
    assertEquals(HOST, challenge.host)
    assertEquals(PORT, challenge.port)
    assertEquals("ssh-ed25519", challenge.algorithm)
    assertEquals(SERVER_KEY_SHA256, challenge.fingerprint)
    assertNull(challenge.previousFingerprint)
    assertTrue(challenge.challengeId.isNotBlank())
    assertTrue(verifier.findExistingAlgorithms(HOST, PORT).isEmpty())
    // Blocking: nothing is trusted until the user answers.
    assertTrue(dao.forHost(HOST, PORT).isEmpty())
    assertEquals(1, store.challenges.pendingCount())
  }

  @Test
  fun matchingStoredKeyVerifies() = runBlocking {
    approveFirstContact(SERVER_KEY)

    val verifier = store.verifierFor(HOST, PORT)

    assertTrue(verifier.verify(HOST, PORT, SERVER_KEY))
    assertNull(verifier.rejection)
    assertEquals(listOf("ssh-ed25519"), verifier.findExistingAlgorithms(HOST, PORT))
    assertEquals(0, store.challenges.pendingCount())
  }

  @Test
  fun differingStoredKeyFailsHardWithChangedCode() = runBlocking {
    approveFirstContact(SERVER_KEY)

    val verifier = store.verifierFor(HOST, PORT)

    assertFalse(verifier.verify(HOST, PORT, ROTATED_KEY))
    val rejection = requireNotNull(verifier.rejection)
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED, rejection.code)
    assertEquals(ROTATED_KEY_SHA256, rejection.challenge.fingerprint)
    assertEquals(SERVER_KEY_SHA256, rejection.challenge.previousFingerprint)
    // The approved key is untouched: a changed key never replaces it silently.
    assertEquals(SERVER_KEY_BLOB, dao.forHost(HOST, PORT).single().keyBase64)
  }

  @Test
  fun keyOfAnotherAlgorithmIsAChangeNotAFirstContact() = runBlocking {
    approveFirstContact(SERVER_KEY)
    val rsa = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair().public

    val verifier = store.verifierFor(HOST, PORT)

    assertFalse(verifier.verify(HOST, PORT, rsa))
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED, verifier.rejection!!.code)
    assertEquals("ssh-rsa", verifier.rejection!!.challenge.algorithm)
  }

  @Test
  fun approveThenReconnectVerifies() = runBlocking {
    val first = store.verifierFor(HOST, PORT)
    assertFalse(first.verify(HOST, PORT, SERVER_KEY))

    val row = store.approve(first.rejection!!.challenge.challengeId)

    assertEquals(now, row.approvedAtMillis)
    val stored = dao.forHost(HOST, PORT).single()
    assertEquals("ssh-ed25519", stored.algorithm)
    assertEquals(SERVER_KEY_SHA256, stored.fingerprint)
    assertEquals(SERVER_KEY_BLOB, stored.keyBase64)
    assertTrue(store.verifierFor(HOST, PORT).verify(HOST, PORT, SERVER_KEY))
  }

  @Test
  fun reapprovalAfterChangeUpdatesTheExistingRow() = runBlocking {
    approveFirstContact(SERVER_KEY)
    val originalId = dao.forHost(HOST, PORT).single().id
    val changed = store.verifierFor(HOST, PORT)
    assertFalse(changed.verify(HOST, PORT, ROTATED_KEY))

    store.approve(changed.rejection!!.challenge.challengeId)

    val rows = dao.forHost(HOST, PORT)
    assertEquals(1, rows.size)
    assertEquals(originalId, rows.single().id)
    assertEquals(ROTATED_KEY_SHA256, rows.single().fingerprint)
    val next = store.verifierFor(HOST, PORT)
    assertTrue(next.verify(HOST, PORT, ROTATED_KEY))
    // The superseded key can no longer verify.
    assertFalse(store.verifierFor(HOST, PORT).verify(HOST, PORT, SERVER_KEY))
  }

  @Test
  fun rejectPersistsNothingAndTheNextConnectAsksAgain() = runBlocking {
    val first = store.verifierFor(HOST, PORT)
    assertFalse(first.verify(HOST, PORT, SERVER_KEY))
    val challengeId = first.rejection!!.challenge.challengeId

    store.reject(challengeId)

    assertTrue(dao.forHost(HOST, PORT).isEmpty())
    assertEquals(0, store.challenges.pendingCount())
    val again = store.verifierFor(HOST, PORT)
    assertFalse(again.verify(HOST, PORT, SERVER_KEY))
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, again.rejection!!.code)
    assertNotEquals(challengeId, again.rejection!!.challenge.challengeId)
  }

  @Test
  fun unknownOrConsumedChallengeIsATypedError(): Unit = runBlocking {
    val unknown = assertThrows(RemoteClientException::class.java) { runBlocking { store.approve("nope") } }
    assertEquals(CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND, unknown.code)
    assertThrows(RemoteClientException::class.java) { store.reject("nope") }

    val verifier = store.verifierFor(HOST, PORT)
    verifier.verify(HOST, PORT, SERVER_KEY)
    val challengeId = verifier.rejection!!.challenge.challengeId
    store.approve(challengeId)

    val replay = assertThrows(RemoteClientException::class.java) { runBlocking { store.approve(challengeId) } }
    assertEquals(CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND, replay.code)
    val rejectAfterApprove = assertThrows(RemoteClientException::class.java) { store.reject(challengeId) }
    assertEquals(CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND, rejectAfterApprove.code)
  }

  @Test
  fun expiredChallengeCannotBeApproved(): Unit = runBlocking {
    val verifier = store.verifierFor(HOST, PORT)
    verifier.verify(HOST, PORT, SERVER_KEY)
    now += HostKeyChallengeRegistry.TTL_MILLIS + 1

    val expired =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { store.approve(verifier.rejection!!.challenge.challengeId) }
      }
    assertEquals(CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND, expired.code)
    assertTrue(dao.forHost(HOST, PORT).isEmpty())
  }

  @Test
  fun trustIsScopedToHostAndPortAndHostIsCaseInsensitive() = runBlocking {
    approveFirstContact(SERVER_KEY)

    assertTrue(store.verifierFor("SFTP.Example.TEST", PORT).verify("SFTP.Example.TEST", PORT, SERVER_KEY))
    val otherPort = store.verifierFor(HOST, 2222)
    assertFalse(otherPort.verify(HOST, 2222, SERVER_KEY))
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, otherPort.rejection!!.code)
    val otherHost = store.verifierFor("other.example.test", PORT)
    assertFalse(otherHost.verify("other.example.test", PORT, SERVER_KEY))
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, otherHost.rejection!!.code)
  }

  @Test
  fun pendingChallengesAreBoundedAndOnePerEndpoint() {
    val registry = HostKeyChallengeRegistry(clock = { now })
    val presented = PresentedHostKey.of(SERVER_KEY)

    val stale = registry.raise(HOST, PORT, presented, null)
    val fresh = registry.raise(HOST, PORT, presented, null)
    assertEquals(1, registry.pendingCount())
    assertNull(registry.consume(stale.challengeId))
    assertNotNull(registry.consume(fresh.challengeId))

    repeat(HostKeyChallengeRegistry.MAX_PENDING * 3) { registry.raise("h$it.test", PORT, presented, null) }
    assertEquals(HostKeyChallengeRegistry.MAX_PENDING, registry.pendingCount())
  }

  private suspend fun approveFirstContact(key: PublicKey) {
    val verifier = store.verifierFor(HOST, PORT)
    assertFalse(verifier.verify(HOST, PORT, key))
    store.approve(verifier.rejection!!.challenge.challengeId)
  }

  private companion object {
    const val HOST = "sftp.example.test"
    const val PORT = 22

    // Throwaway keys generated with `ssh-keygen -t ed25519`; the private halves were discarded.
    const val SERVER_KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOdJBz774N97LZvrLI0+A0poQyGnaZ0EGGkLxgwWHrqV"
    const val SERVER_KEY_SHA256 = "SHA256:U3b54O0CASN6rxo5Jas4AiNSVGgFM2adMsobZH67CIg"
    const val SERVER_KEY_MD5 = "MD5:ac:70:08:40:3b:d1:1c:d4:3d:4c:27:12:0c:a9:9f:f4"
    const val ROTATED_KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIEmuxxZssnfqyxEWw2rijNH0ozP31gi5UfE81oEyX8rd"
    const val ROTATED_KEY_SHA256 = "SHA256:PwE6nqvWO2ZjCoeObzYuLcPuV+a/MI0fxSX2B0Sp0+Y"

    val SERVER_KEY: PublicKey = parse(SERVER_KEY_BLOB)
    val ROTATED_KEY: PublicKey = parse(ROTATED_KEY_BLOB)

    fun parse(blob: String): PublicKey = Buffer.PlainBuffer(Base64.getDecoder().decode(blob)).readPublicKey()
  }
}
