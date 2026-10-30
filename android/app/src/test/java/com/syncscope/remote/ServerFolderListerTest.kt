package com.syncscope.remote

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.scan.MatchIndex
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import kotlin.coroutines.cancellation.CancellationException

/**
 * The server folder lister shared by the pre-delete re-check and the refresh re-check (research R5, D023;
 * Principle III), over a scripted [RemoteClient]: one connection, each folder listed once with the walk's
 * retry policy, the keys each listing holds, connect failures as one typed failure, and cancellation.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ServerFolderListerTest {

  private lateinit var context: Context
  private lateinit var credentials: CredentialStore
  private lateinit var repository: RepositoryConfigEntity
  private val server = ScriptedServer()
  private val backoffs = mutableListOf<Long>()
  private lateinit var lister: ServerFolderLister

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    credentials = CredentialStore { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    repository = repository(credentials.store(PASSWORD.toCharArray()))
    lister = ServerFolderLister(credentials, server, delay = { backoffs += it })
  }

  @After
  fun tearDown() {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
  }

  @Test
  fun severalFoldersShareOneConnectionAndEachIsListedOnce() = runBlocking {
    server.ok("/backup/a", file("a.jpg", 1))
    server.ok("/backup/b", file("b.jpg", 2))
    server.ok("/backup/c")

    val result =
      lister.listFolders(repository, PRECISION, listOf("/backup/a", "/backup/b", "/backup/a", "/backup/c", "/backup/b"))

    assertEquals(1, server.connects)
    assertEquals(PASSWORD, server.passwords.single())
    assertEquals(listOf("/backup/a", "/backup/b", "/backup/c"), server.listed)
    assertEquals("one result per distinct folder, in first-seen order", listOf("/backup/a", "/backup/b", "/backup/c"), result.keys.toList())
    assertTrue("the session is closed", server.clients.all { it.closed })
  }

  @Test
  fun aListedFolderReturnsTheKeysOfItsRegularFiles() = runBlocking {
    val nfd = java.text.Normalizer.normalize("é.png", java.text.Normalizer.Form.NFD)
    server.ok(
      "/backup/a",
      file("beach.jpg", 120),
      file(nfd, 5),
      file("no-time.jpg", 7, mtime = null),
      RemoteEntry("sub", 0L, MTIME, RemoteEntryType.DIRECTORY),
    )

    val listing = lister.listFolders(repository, PRECISION, listOf("/backup/a")).getValue("/backup/a")

    val keys = (listing as FolderListing.Listed).keys
    assertEquals(PRECISION, keys.precisionMillis)
    val bucket = MatchIndex.bucketOf(MTIME, PRECISION)
    assertTrue(keys.containsExact("beach.jpg", 120, bucket))
    assertTrue("names are keyed in NFC, like the scan", keys.containsExact("é.png", 5, bucket))
    assertEquals(listOf("/backup/a"), keys.directoriesOf("beach.jpg", 120, bucket))
    assertFalse(keys.containsExact("beach.jpg", 121, bucket))
    assertFalse(keys.containsExact("sub", 0, bucket))
    val expected = MatchIndex(PRECISION)
    expected.add(file("beach.jpg", 120), "/backup/a")
    expected.add(file("é.png", 5), "/backup/a")
    expected.add(file("no-time.jpg", 7, mtime = null), "/backup/a")
    assertEquals("the same keys the scan's walk would build", expected, keys)
  }

  @Test
  fun aFolderThatIsNotFoundIsGoneAndIsNotRetried() = runBlocking {
    server.fail("/backup/removed", CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND)
    server.fail("/backup/missing", CloudSyncErrorCode.DIRECTORY_UNREADABLE) // WebDAV 404
    server.ok("/backup/ok", file("a.jpg", 1))

    val result = lister.listFolders(repository, PRECISION, listOf("/backup/removed", "/backup/missing", "/backup/ok"))

    assertSame(FolderListing.Gone, result["/backup/removed"])
    assertSame(FolderListing.Gone, result["/backup/missing"])
    assertTrue(result["/backup/ok"] is FolderListing.Listed)
    assertTrue("not-found is never retried", backoffs.isEmpty())
  }

  @Test
  fun aFolderFailingAnyOtherWayIsUncheckedAfterTheWalksRetries() = runBlocking {
    repeat(3) { server.fail("/backup/a", CloudSyncErrorCode.CONNECTION_LOST) }
    server.fail("/backup/b", CloudSyncErrorCode.SERVER_ERROR)
    server.ok("/backup/c", file("c.jpg", 3))

    val result = lister.listFolders(repository, PRECISION, listOf("/backup/a", "/backup/b", "/backup/c"))

    assertEquals(FolderListing.Unchecked(CloudSyncErrorCode.CONNECTION_LOST), result["/backup/a"])
    assertEquals(FolderListing.Unchecked(CloudSyncErrorCode.SERVER_ERROR), result["/backup/b"])
    assertTrue("one failed folder does not stop the others", result["/backup/c"] is FolderListing.Listed)
    assertEquals("the walk's retry policy is used", listOf(1_000L, 2_000L), backoffs)
    assertEquals("a transient failure reconnects", 3, server.connects)
    assertTrue(server.clients.all { it.closed })
  }

  @Test
  fun aTransientFailureThenSuccessIsListed() = runBlocking {
    server.fail("/backup/a", CloudSyncErrorCode.CONNECTION_TIMEOUT)
    server.ok("/backup/a", file("a.jpg", 1))

    val listing = lister.listFolders(repository, PRECISION, listOf("/backup/a")).getValue("/backup/a")

    assertTrue((listing as FolderListing.Listed).keys.containsExact("a.jpg", 1, MatchIndex.bucketOf(MTIME, PRECISION)))
    assertEquals(listOf(1_000L), backoffs)
  }

  @Test
  fun noFoldersMeansNoConnection() = runBlocking {
    assertTrue(lister.listFolders(repository, PRECISION, emptyList()).isEmpty())
    assertEquals(0, server.connects)
    assertTrue(server.clients.isEmpty())
  }

  @Test
  fun aConnectFailureIsOneTypedFailureBeforeAnythingIsListed() {
    val codes =
      listOf(
        CloudSyncErrorCode.AUTH_FAILED,
        CloudSyncErrorCode.CONNECTION_REFUSED,
        CloudSyncErrorCode.CONNECTION_TIMEOUT,
        CloudSyncErrorCode.CONNECTION_LOST,
        CloudSyncErrorCode.TLS_UNTRUSTED,
        CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED,
      )
    for (code in codes) {
      server.reset()
      server.connectFailure = code
      val failure =
        assertThrows(RemoteClientException::class.java) {
          runBlocking { lister.listFolders(repository, PRECISION, listOf("/backup/a", "/backup/b")) }
        }
      assertEquals(code, failure.code)
      assertEquals("$code: one connect, not one per folder", 1, server.connects)
      assertTrue("$code: nothing is listed", server.listed.isEmpty())
      assertTrue("$code: the client is closed", server.clients.all { it.closed })
    }
  }

  @Test
  fun anUnapprovedHostKeyIsUnverified() {
    server.challenge = CHALLENGE
    val failure =
      assertThrows(SftpHostKeyException::class.java) {
        runBlocking { lister.listFolders(repository, PRECISION, listOf("/backup/a")) }
      }
    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, failure.code)
    assertEquals(CHALLENGE, failure.challenge)
    assertTrue(server.listed.isEmpty())
    assertTrue(server.clients.all { it.closed })
  }

  @Test
  fun anUnreadablePasswordIsCredentialUnavailable() {
    val failure =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { lister.listFolders(repository.copy(credentialVersion = 999), PRECISION, listOf("/backup/a")) }
      }
    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE, failure.code)
    assertTrue(server.listed.isEmpty())
  }

  @Test
  fun anUnconfiguredRepositoryIsNotConfigured() {
    val failure =
      assertThrows(RemoteClientException::class.java) {
        runBlocking { lister.listFolders(repository.copy(protocol = "GOPHER"), PRECISION, listOf("/backup/a")) }
      }
    assertEquals(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED, failure.code)
    assertEquals(0, server.connects)
  }

  @Test
  fun cancellationStopsListingAndClosesTheSession() = runBlocking {
    server.ok("/backup/a", file("a.jpg", 1))
    server.hang("/backup/b")
    server.ok("/backup/c", file("c.jpg", 3))

    val listing =
      async(start = CoroutineStart.UNDISPATCHED) {
        lister.listFolders(repository, PRECISION, listOf("/backup/a", "/backup/b", "/backup/c"))
      }
    server.hanging.await()
    listing.cancel()

    val thrown = runCatching { listing.await() }.exceptionOrNull()
    assertTrue("cancellation propagates as itself, not as a listing failure: $thrown", thrown is CancellationException)
    assertEquals("the folder after the cancelled one is never listed", listOf("/backup/a", "/backup/b"), server.listed)
    assertTrue("cancellation is not a failure, so nothing reconnects", backoffs.isEmpty())
    assertEquals(1, server.connects)
    assertTrue("the session is closed", server.clients.all { it.closed })
  }

  @Test
  fun hooksSeeEachClientAndEachResultAndKeepGoingStopsBeforeTheNextFolder() = runBlocking {
    server.ok("/backup/a", file("a.jpg", 1))
    server.fail("/backup/b", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    server.ok("/backup/c", file("c.jpg", 3))
    val clients = mutableListOf<RemoteClient>()
    val seen = mutableListOf<Pair<String, FolderListing>>()

    val result =
      lister.listFolders(
        repository,
        PRECISION,
        listOf("/backup/a", "/backup/b", "/backup/c"),
        ListingHooks(onClient = { clients += it }, keepGoing = { seen.size < 2 }, onListed = { folder, listing -> seen += folder to listing }),
      )

    assertEquals(server.clients.toList(), clients)
    assertEquals(listOf("/backup/a", "/backup/b"), seen.map { it.first })
    assertEquals("the folder after the budget ran out is never listed", listOf("/backup/a", "/backup/b"), server.listed)
    assertEquals(seen.toMap(), result)
    assertTrue(result.getValue("/backup/a") is FolderListing.Listed)
    assertTrue(server.clients.all { it.closed })
  }

  // --- helpers ---

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

  /** Per-folder queues of listings, failure codes or a hang, and a scripted `connect`. */
  private class ScriptedServer : RemoteClientFactory {
    val outcomes = mutableMapOf<String, ArrayDeque<Any>>()
    val listed = mutableListOf<String>()
    val clients = mutableListOf<Client>()
    val passwords = mutableListOf<String>()
    var connects = 0
    var connectFailure: CloudSyncErrorCode? = null
    var challenge: HostKeyChallenge? = null
    val hanging = CompletableDeferred<Unit>()

    fun ok(folder: String, vararg entries: RemoteEntry) {
      outcomes.getOrPut(folder) { ArrayDeque() }.addLast(entries.toList())
    }

    fun fail(folder: String, code: CloudSyncErrorCode) {
      outcomes.getOrPut(folder) { ArrayDeque() }.addLast(code)
    }

    fun hang(folder: String) {
      outcomes.getOrPut(folder) { ArrayDeque() }.addLast(HANG)
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
          throw RemoteClientException(code, "Cannot reach $HOST as $USER", null)
        }
        server.challenge?.let { return ConnectOutcome.HostKeyApprovalRequired(it) }
        return ConnectOutcome.Connected
      }

      override suspend fun list(directory: String): List<RemoteEntry> {
        server.listed += directory
        val next = server.outcomes[directory]?.removeFirstOrNull() ?: error("unscripted list")
        if (next === HANG) {
          server.hanging.complete(Unit)
          awaitCancellation()
        }
        if (next is CloudSyncErrorCode) throw RemoteClientException(next, "Cannot list $directory", null)
        @Suppress("UNCHECKED_CAST")
        return next as List<RemoteEntry>
      }

      override suspend fun discoverPrecision(): PrecisionFinding = error("not used by the lister")

      override fun close() {
        closed = true
      }
    }
  }

  private companion object {
    const val PREFS = "server-folder-lister-test"
    const val PASSWORD = "s3cret-Lister"
    const val HOST = "nas.example.lan"
    const val USER = "backup-user"
    const val PRECISION = 1_000L
    const val MTIME = 1_704_067_200_000L
    val HANG = Any()
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
