package com.syncscope.deletion

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RemoteMatchKeyEntity
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.sourceRoot
import com.syncscope.persistence.stagingSnapshot
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import com.syncscope.remote.RemoteRoots
import com.syncscope.remote.SftpHostKeyException
import com.syncscope.scan.MatchIndex
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/**
 * Research R12 step 4: the pre-delete server re-check over a scripted [RemoteClient], with the match keys
 * (and their server directories) in an in-memory snapshot.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class DeletionRecheckTest {

  private lateinit var context: Context
  private lateinit var db: SyncScopeDatabase
  private lateinit var store: SnapshotStore
  private lateinit var credentials: CredentialStore
  private val server = ScriptedServer()
  private val backoffs = mutableListOf<Long>()
  private lateinit var recheck: DeletionRecheck
  private lateinit var repository: RepositoryConfigEntity

  @Before
  fun setUp() = runBlocking {
    context = ApplicationProvider.getApplicationContext()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    store = SnapshotStore(db)
    credentials = CredentialStore { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    repository = repository(credentials.store(PASSWORD.toCharArray()))
    recheck = DeletionRecheck(store, credentials, server, delay = { backoffs += it })
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    store.beginRun("run-1", mode = "FULL", configRevision = 1L, phase = "CONNECTING", startedAtMillis = 1_000L)
    store.stageSnapshot(stagingSnapshot(SNAPSHOT, "run-1"))
    ShadowLog.clear()
  }

  @After
  fun tearDown() {
    db.close()
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
  }

  @Test
  fun aConfirmedKeyStaysToDelete() = runBlocking {
    key("beach.png", 120, "/backup/camera")
    server.ok("/backup/camera", file("beach.png", 120))
    val beach = row("e1", "beach.png", 120)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(beach))

    assertEquals(listOf(beach), result.toDelete)
    assertTrue(result.unsynced.isEmpty())
    assertTrue(result.refused.isEmpty())
    assertEquals(0, result.movedByRecheck)
    assertEquals(PASSWORD, server.passwords.single())
    assertTrue("the session is closed", server.clients.all { it.closed })
  }

  @Test
  fun aNameInNfdOnTheServerStillConfirms() = runBlocking {
    key("é.png", 5, "/backup")
    server.ok("/backup", file(java.text.Normalizer.normalize("é.png", java.text.Normalizer.Form.NFD), 5))
    val result = recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "é.png", 5)))
    assertEquals(1, result.toDelete.size)
  }

  @Test
  fun aFileMissingFromItsStoredDirectoryIsGoneFromServer() = runBlocking {
    key("beach.png", 120, "/backup/camera")
    server.ok("/backup/camera", file("sunset.png", 99))
    val beach = row("e1", "beach.png", 120)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(beach))

    assertTrue(result.toDelete.isEmpty())
    assertEquals(listOf(RecheckedRow(beach, RecheckReason.GONE_FROM_SERVER)), result.unsynced)
    assertEquals(1, result.movedByRecheck)
  }

  @Test
  fun aDifferentSizeOrBucketInTheListingCountsAsGone() = runBlocking {
    key("size.png", 120, "/backup")
    key("time.png", 120, "/backup")
    key("nomtime.png", 120, "/backup")
    server.ok(
      "/backup",
      file("size.png", 121),
      file("time.png", 120, mtime = MTIME + PRECISION),
      file("nomtime.png", 120, mtime = null),
    )

    val result =
      recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "size.png", 120), row("e2", "time.png", 120), row("e3", "nomtime.png", 120)))

    assertTrue(result.toDelete.isEmpty())
    assertEquals(setOf("e1", "e2", "e3"), result.unsynced.map { it.row.entryId }.toSet())
    assertTrue(result.unsynced.all { it.reason == RecheckReason.GONE_FROM_SERVER })
  }

  @Test
  fun aTimeInsideTheSameBucketStillConfirms() = runBlocking {
    key("beach.png", 120, "/backup")
    server.ok("/backup", file("beach.png", 120, mtime = MTIME + PRECISION - 1))
    assertEquals(1, recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120))).toDelete.size)
  }

  @Test
  fun aDirectoryThatIsNotFoundCountsAsGone() = runBlocking {
    key("a.png", 120, "/backup/removed")
    key("b.png", 121, "/backup/missing")
    server.fail("/backup/removed", CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND)
    server.fail("/backup/missing", CloudSyncErrorCode.DIRECTORY_UNREADABLE) // WebDAV 404
    val a = row("e1", "a.png", 120)
    val b = row("e2", "b.png", 121)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(a, b))

    assertEquals(
      listOf(RecheckedRow(a, RecheckReason.GONE_FROM_SERVER), RecheckedRow(b, RecheckReason.GONE_FROM_SERVER)),
      result.unsynced,
    )
    assertTrue(result.refused.isEmpty())
    assertTrue("not-found is never retried", backoffs.isEmpty())
  }

  @Test
  fun aDirectoryFailingAnyOtherWayRefusesTheRow() = runBlocking {
    key("beach.png", 120, "/backup/a")
    repeat(3) { server.fail("/backup/a", CloudSyncErrorCode.CONNECTION_LOST) }
    val beach = row("e1", "beach.png", 120)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(beach))

    assertEquals(listOf(RecheckedRow(beach, RecheckReason.RECHECK_FAILED)), result.refused)
    assertTrue(result.unsynced.isEmpty())
    assertEquals(1, result.movedByRecheck)
    assertEquals("the walk's retry policy is used", listOf(1_000L, 2_000L), backoffs)
  }

  @Test
  fun anotherDirectoryConfirmingWinsOverAFailedOne() = runBlocking {
    key("beach.png", 120, "/backup/a", "/backup/b")
    server.fail("/backup/a", CloudSyncErrorCode.SERVER_ERROR)
    server.ok("/backup/b", file("beach.png", 120))
    val beach = row("e1", "beach.png", 120)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(beach))

    assertEquals(listOf(beach), result.toDelete)
    assertEquals(0, result.movedByRecheck)
  }

  @Test
  fun aFailedDirectoryPlusAGoneOneRefusesTheRow() = runBlocking {
    key("beach.png", 120, "/backup/a", "/backup/b")
    server.fail("/backup/a", CloudSyncErrorCode.SERVER_ERROR)
    server.ok("/backup/b")
    val result = recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120)))
    assertEquals(RecheckReason.RECHECK_FAILED, result.refused.single().reason)
  }

  @Test
  fun keysWithoutDirectoriesAreRefusedAsScanTooOldWithoutConnecting() = runBlocking {
    key("legacy.png", 120)
    val legacy = row("e1", "legacy.png", 120)

    val result = recheck.recheck(SNAPSHOT, repository, listOf(legacy))

    assertEquals(listOf(RecheckedRow(legacy, RecheckReason.SCAN_TOO_OLD)), result.refused)
    assertEquals(0, server.connects)
    assertEquals("a scan that is too old is not moved by the re-check", 0, result.movedByRecheck)
  }

  @Test
  fun eachDirectoryIsListedExactlyOnceForManyRows() = runBlocking {
    val rows = mutableListOf<DeletionRow>()
    val entriesA = mutableListOf<RemoteEntry>()
    val entriesB = mutableListOf<RemoteEntry>()
    for (i in 0 until 40) {
      val directory = if (i % 2 == 0) "/backup/a" else "/backup/b"
      key("img$i.png", 100L + i, directory)
      (if (i % 2 == 0) entriesA else entriesB) += file("img$i.png", 100L + i)
      rows += row("e$i", "img$i.png", 100L + i)
    }
    server.ok("/backup/a", *entriesA.toTypedArray())
    server.ok("/backup/b", *entriesB.toTypedArray())

    val result = recheck.recheck(SNAPSHOT, repository, rows)

    assertEquals(40, result.toDelete.size)
    assertEquals(listOf("/backup/a", "/backup/b"), server.listed)
    assertEquals(1, server.connects)
  }

  @Test
  fun aConnectFailureAbortsWithItsCodeAndNoResult() {
    val codes =
      listOf(
        CloudSyncErrorCode.AUTH_FAILED,
        CloudSyncErrorCode.CONNECTION_REFUSED,
        CloudSyncErrorCode.CONNECTION_TIMEOUT,
        CloudSyncErrorCode.CONNECTION_LOST,
        CloudSyncErrorCode.TLS_UNTRUSTED,
        CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED,
      )
    runBlocking { key("beach.png", 120, "/backup") }
    for (code in codes) {
      server.reset()
      server.connectFailure = code
      val failure =
        assertThrows(RemoteClientException::class.java) {
          runBlocking { recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120))) }
        }
      assertEquals(code, failure.code)
      assertTrue("$code: nothing is listed", server.listed.isEmpty())
      assertTrue("$code: the client is closed", server.clients.all { it.closed })
    }
  }

  @Test
  fun aHostKeyChallengeAbortsWithUnverified() {
    runBlocking { key("beach.png", 120, "/backup") }
    server.challenge = CHALLENGE
    val failure =
      assertThrows(SftpHostKeyException::class.java) {
        runBlocking { recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120))) }
      }
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, failure.code)
    assertEquals(CHALLENGE, failure.challenge)
    assertTrue(server.listed.isEmpty())
  }

  @Test
  fun anUnreadablePasswordAbortsWithCredentialUnavailable() {
    runBlocking { key("beach.png", 120, "/backup") }
    val failure =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { recheck.recheck(SNAPSHOT, repository.copy(credentialVersion = 999), listOf(row("e1", "beach.png", 120))) }
      }
    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE, failure.code)
  }

  @Test
  fun movedByRecheckCountsBothMoves() = runBlocking {
    key("kept.png", 1, "/backup/ok")
    key("gone.png", 2, "/backup/ok")
    key("failed.png", 3, "/backup/broken")
    key("legacy.png", 4)
    server.ok("/backup/ok", file("kept.png", 1))
    server.fail("/backup/broken", CloudSyncErrorCode.SERVER_ERROR)

    val result =
      recheck.recheck(
        SNAPSHOT,
        repository,
        listOf(row("e1", "kept.png", 1), row("e2", "gone.png", 2), row("e3", "failed.png", 3), row("e4", "legacy.png", 4)),
      )

    assertEquals(listOf("e1"), result.toDelete.map { it.entryId })
    assertEquals(listOf("e2"), result.unsynced.map { it.row.entryId })
    assertEquals(
      setOf("e3" to RecheckReason.RECHECK_FAILED, "e4" to RecheckReason.SCAN_TOO_OLD),
      result.refused.map { it.row.entryId to it.reason }.toSet(),
    )
    assertEquals(2, result.movedByRecheck)
  }

  @Test
  fun thePasswordAndLocationsNeverReachTheLog() {
    // SC-005 / D011: a successful re-check and a failing one.
    runBlocking {
      key("beach.png", 120, "/backup/private-dir")
      server.ok("/backup/private-dir", file("beach.png", 120))
      recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120)))
    }
    server.reset()
    server.connectFailure = CloudSyncErrorCode.AUTH_FAILED
    assertThrows(RemoteClientException::class.java) {
      runBlocking { recheck.recheck(SNAPSHOT, repository, listOf(row("e1", "beach.png", 120))) }
    }

    val logs = ShadowLog.getLogs()
    assertTrue("the re-check logs something", logs.isNotEmpty())
    for (item in logs) {
      val text = item.msg.orEmpty() + item.throwable?.toString().orEmpty()
      for (secret in listOf(PASSWORD, HOST, USER, "/backup/private-dir", "beach.png")) {
        assertFalse("${item.tag}: ${item.msg}", text.contains(secret))
      }
    }
  }

  // --- helpers ---

  private suspend fun key(name: String, size: Long, vararg directories: String) {
    store.stageMatchKeys(
      listOf(
        RemoteMatchKeyEntity(
          matchKeyId = 0,
          snapshotId = SNAPSHOT,
          name = name,
          sizeBytes = size,
          precisionMillis = PRECISION,
          bucket = MatchIndex.bucketOf(MTIME, PRECISION),
          duplicateCount = directories.size.coerceAtLeast(1).toLong(),
          directories = if (directories.isEmpty()) null else MatchIndex.joinDirectories(directories.toList()),
        )
      )
    )
  }

  private fun row(id: String, name: String, size: Long) =
    DeletionRow(id, "src-1", null, "content://provider/doc/$id", name, size, MTIME, "SYNCED")

  private fun file(name: String, size: Long, mtime: Long? = MTIME) = RemoteEntry(name, size, mtime, RemoteEntryType.REGULAR_FILE)

  private fun repository(credentialVersion: Long) =
    RepositoryConfigEntity(
      protocol = "SFTP",
      host = HOST,
      port = 22,
      username = USER,
      remoteRoots = RemoteRoots.encode(listOf("/backup")),
      precisionMillis = PRECISION,
      credentialVersion = credentialVersion,
      revision = 1,
    )

  /** Per-directory queues of listings or failure codes, and a scripted `connect`. */
  private class ScriptedServer : RemoteClientFactory {
    val outcomes = mutableMapOf<String, ArrayDeque<Any>>()
    val listed = mutableListOf<String>()
    val clients = mutableListOf<Client>()
    val passwords = mutableListOf<String>()
    var connects = 0
    var connectFailure: CloudSyncErrorCode? = null
    var challenge: HostKeyChallenge? = null

    fun ok(directory: String, vararg entries: RemoteEntry) {
      outcomes.getOrPut(directory) { ArrayDeque() }.addLast(entries.toList())
    }

    fun fail(directory: String, code: CloudSyncErrorCode) {
      outcomes.getOrPut(directory) { ArrayDeque() }.addLast(code)
    }

    fun reset() {
      outcomes.clear()
      listed.clear()
      clients.clear()
      passwords.clear()
      connects = 0
      connectFailure = null
      challenge = null
    }

    override fun create(protocol: RemoteProtocol): RemoteClient = Client(this).also { clients += it }

    class Client(private val server: ScriptedServer) : RemoteClient {
      var closed = false

      override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
        server.connects++
        server.passwords += String(password)
        server.connectFailure?.let { code ->
          if (code == CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED) throw SftpHostKeyException(code, CHALLENGE)
          throw RemoteClientException(code, "Cannot reach $HOST as $USER with $PASSWORD", null)
        }
        server.challenge?.let { return ConnectOutcome.HostKeyApprovalRequired(it) }
        return ConnectOutcome.Connected
      }

      override suspend fun list(directory: String): List<RemoteEntry> {
        server.listed += directory
        val next = server.outcomes[directory]?.removeFirstOrNull() ?: error("unscripted list")
        if (next is CloudSyncErrorCode) throw RemoteClientException(next, "Cannot list $directory on $HOST", null)
        @Suppress("UNCHECKED_CAST")
        return next as List<RemoteEntry>
      }

      override suspend fun discoverPrecision(): PrecisionFinding = error("not used by the re-check")

      override fun close() {
        closed = true
      }
    }
  }

  private companion object {
    const val PREFS = "deletion-recheck-test"
    const val PASSWORD = "s3cret-Log-Probe"
    const val HOST = "nas.example.lan"
    const val USER = "backup-user"
    const val SNAPSHOT = "snap-1"
    const val PRECISION = 1_000L
    const val MTIME = 1_704_067_200_000L
    val CHALLENGE =
      HostKeyChallenge(
        challengeId = "c-1",
        host = HOST,
        port = 22,
        algorithm = "ssh-ed25519",
        keyBase64 = "AAAA",
        fingerprint = "SHA256:abc",
        previousFingerprint = null,
        raisedAtMillis = 1L,
      )
  }
}
