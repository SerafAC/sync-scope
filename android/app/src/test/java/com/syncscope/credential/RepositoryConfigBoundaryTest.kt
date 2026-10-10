package com.syncscope.credential

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.CloudSyncModule
import com.syncscope.bridge.RecordingPromise
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.PresentedHostKey
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import com.syncscope.remote.RemoteRoots
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
 * R003 boundary: the password goes to [CredentialStore] only, Room keeps just the
 * `credentialVersion` pointer, and the repository bridge methods return real envelopes.
 * The Keystore-backed preferences cannot run under Robolectric, so the store is exercised
 * over plain SharedPreferences; its version logic is the same code.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RepositoryConfigBoundaryTest {

  private lateinit var context: Context
  private lateinit var db: SyncScopeDatabase
  private lateinit var credentials: CredentialStore
  private lateinit var hostKeys: HostKeyTrustStore
  private lateinit var module: CloudSyncModule
  private val clients = mutableListOf<FakeClient>()
  private var nextClient: () -> FakeClient = { FakeClient() }

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    credentials = CredentialStore { context.getSharedPreferences("test-credentials", Context.MODE_PRIVATE) }
    hostKeys = HostKeyTrustStore(db.trustedSftpHostKeyDao())
    @Suppress("DEPRECATION")
    module =
      CloudSyncModule(
        BridgeReactContext(context),
        dispatcher = Dispatchers.Unconfined,
        envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
        hostKeyTrust = { hostKeys },
        repositoryConfig = { db.repositoryConfigDao() },
        credentialStore = { credentials },
        remoteClients = { protocol -> nextClient().also { it.protocol = protocol; clients += it } },
      )
  }

  @After
  fun tearDown() {
    db.close()
    context.getSharedPreferences("test-credentials", Context.MODE_PRIVATE).edit().clear().commit()
  }

  // --- CredentialStore ---

  @Test
  fun storeIssuesIncreasingVersionsAndWipesTheCallersArray() {
    val first = "one".toCharArray()
    val v1 = credentials.store(first)
    val v2 = credentials.store("two".toCharArray())

    assertTrue(v2 > v1)
    assertTrue(first.all { it == '\u0000' })
    assertEquals("two", String(credentials.load(v2)!!))
  }

  @Test
  fun rotatedOrClearedCredentialIsDetectedNotReused() {
    val v1 = credentials.store("one".toCharArray())
    val v2 = credentials.store("two".toCharArray())

    assertNull(credentials.load(v1))
    assertFalse(credentials.isCurrent(v1))
    assertNull(credentials.load(0L))

    credentials.clear()
    assertNull(credentials.load(v2))
    assertFalse(credentials.isCurrent(v2))
    assertTrue("a version is never reissued after clear", credentials.store("three".toCharArray()) > v2)
  }

  // --- saveRepository ---

  @Test
  fun saveWritesOnlyNonSecretColumnsAndThePasswordToTheStore() = runBlocking {
    val result = call { module.saveRepository(config(), PASSWORD, it) }

    assertEquals("ok", result.getString("status"))
    val row = db.repositoryConfigDao().get()!!
    assertEquals("SFTP", row.protocol)
    assertEquals(HOST, row.host)
    assertEquals(2222, row.port)
    assertEquals(USER, row.username)
    assertEquals("/photos", RemoteRoots.decode(row.remoteRoots).first())
    assertEquals(0L, row.precisionMillis)
    assertEquals(PASSWORD, String(credentials.load(row.credentialVersion)!!))
    assertNoPasswordInRoom()
  }

  @Test
  fun saveReplacesTheSingleProfileAndRotatesTheCredential() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }
    val firstVersion = db.repositoryConfigDao().get()!!.credentialVersion

    call { module.saveRepository(config(protocol = "webdav", port = 8080.0), "other-pass", it) }

    val cursor = db.query("SELECT COUNT(*) FROM repository_config", null)
    cursor.moveToFirst()
    assertEquals(1, cursor.getInt(0))
    cursor.close()
    val row = db.repositoryConfigDao().get()!!
    assertEquals("WEBDAV", row.protocol)
    assertEquals(2L, row.revision)
    assertTrue(row.credentialVersion > firstVersion)
    assertNull(credentials.load(firstVersion))
  }

  @Test
  fun invalidFieldsAreNamedWithoutEchoingValuesAndPersistNothing() {
    val cases =
      listOf(
        "protocol" to config(protocol = "smb"),
        "protocol" to config(protocol = null),
        "host" to config(host = ""),
        "host" to config(host = "evil host/../x"),
        "host" to config(host = "user@$HOST"),
        "port" to config(port = 0.0),
        "port" to config(port = 70000.0),
        "port" to config(port = 21.5),
        "username" to config(username = "  "),
        "username" to config(username = "bad\nname"),
        "remoteRoots" to config(root = "bad\nfolder"),
        "remoteRoots" to config(root = "/photos/../etc"),
      )
    for ((field, map) in cases) {
      val error = call { module.saveRepository(map, PASSWORD, it) }.getMap("error")!!
      assertEquals(field, CloudSyncErrorCode.INVALID_QUERY.name, error.getString("code"))
      assertEquals(field, error.getString("field"))
      val text = error.toHashMap().toString()
      assertFalse(field, text.contains(HOST))
      assertFalse(field, text.contains(PASSWORD))
      assertFalse(field, text.contains("evil"))
    }
    val wrongType = JavaOnlyMap.of("protocol", "FTP", "host", HOST, "port", "21", "username", USER)
    assertEquals("port", call { module.saveRepository(wrongType, PASSWORD, it) }.getMap("error")!!.getString("field"))

    runBlocking { assertNull(db.repositoryConfigDao().get()) }
    assertFalse(credentials.isCurrent(1L))
  }

  @Test
  fun passwordIsRequiredForANewAccountButKeptForTheSameOne() = runBlocking {
    for (password in listOf(null, "")) {
      val error = call { module.saveRepository(config(), password, it) }.getMap("error")!!
      assertEquals("password", error.getString("field"))
    }

    call { module.saveRepository(config(), PASSWORD, it) }
    val version = db.repositoryConfigDao().get()!!.credentialVersion

    // Same server and account, new root: the stored password carries over.
    assertEquals("ok", call { module.saveRepository(config(root = "/other"), null, it) }.getString("status"))
    assertEquals(version, db.repositoryConfigDao().get()!!.credentialVersion)

    // A different account must never inherit it.
    val error = call { module.saveRepository(config(username = "mallory"), null, it) }.getMap("error")!!
    assertEquals("password", error.getString("field"))
    assertEquals("/other", RemoteRoots.decode(db.repositoryConfigDao().get()!!.remoteRoots).first())
  }

  @Test
  fun anOmittedPortTakesTheDefaultButTheFoldersAreRequired() = runBlocking {
    val map = JavaOnlyMap.of("protocol", "ftp", "host", HOST, "username", USER, "remoteRoots", JavaOnlyArray.of("/"))

    call { module.saveRepository(map, PASSWORD, it) }

    val row = db.repositoryConfigDao().get()!!
    assertEquals(21, row.port)
    assertEquals(listOf("/"), RemoteRoots.decode(row.remoteRoots))

    val noFolders = JavaOnlyMap.of("protocol", "ftp", "host", HOST, "username", USER)
    val error = call { module.saveRepository(noFolders, PASSWORD, it) }.getMap("error")!!
    assertEquals("remoteRoots", error.getString("field"))
    assertEquals(0, error.getInt("fieldIndex"))
    assertEquals("Add at least one remote folder.", error.getString("message"))
  }

  @Test
  fun severalFoldersAreSavedNormalizedAndReturnedInOrderWithoutThePassword() = runBlocking {
    val result = call { module.saveRepository(config(roots = listOf("/photos", "backup/phone/")), PASSWORD, it) }

    assertEquals("ok", result.getString("status"))
    assertEquals(listOf("/photos", "/backup/phone"), RemoteRoots.decode(db.repositoryConfigDao().get()!!.remoteRoots))
    val repo = call { module.getRepositorySummary(it) }.getMap("repository")!!
    val roots = repo.getArray("remoteRoots")!!
    assertEquals(listOf("/photos", "/backup/phone"), (0 until roots.size()).map { roots.getString(it) })
    assertFalse(repo.toHashMap().toString().contains(PASSWORD))
    assertNoPasswordInRoom()
  }

  @Test
  fun anOverlappingFolderIsRefusedAtItsIndexAndNothingIsStored() = runBlocking {
    val error =
      call { module.saveRepository(config(roots = listOf("/photos", "/photos/2024")), PASSWORD, it) }.getMap("error")!!

    assertEquals("remoteRoots", error.getString("field"))
    assertEquals(1, error.getInt("fieldIndex"))
    assertEquals("This folder is the same as, inside or around /photos.", error.getString("message"))
    assertNull(db.repositoryConfigDao().get())
    assertFalse(credentials.isCurrent(1L))
  }

  // --- getRepositorySummary ---

  @Test
  fun summaryIsTypedNotConfiguredBeforeAnySave() {
    val result = call { module.getRepositorySummary(it) }

    assertEquals(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED.name, result.getMap("error")!!.getString("code"))
  }

  @Test
  fun summaryReportsCredentialPresenceAndTrustButNeverThePassword() {
    call { module.saveRepository(config(), PASSWORD, it) }

    var repo = call { module.getRepositorySummary(it) }.getMap("repository")!!
    assertEquals("SFTP", repo.getString("protocol"))
    assertEquals(2222, repo.getInt("port"))
    assertTrue(repo.isNull("precisionMillis"))
    assertTrue(repo.getBoolean("credentialPresent"))
    assertFalse(repo.getBoolean("hostKeyTrusted"))
    assertFalse(repo.toHashMap().toString().contains(PASSWORD))

    val challenge = hostKeys.challenges.raise(HOST, 2222, PresentedHostKey.of(hostKey()), null)
    runBlocking { hostKeys.approve(challenge.challengeId) }
    credentials.clear()

    repo = call { module.getRepositorySummary(it) }.getMap("repository")!!
    assertTrue(repo.getBoolean("hostKeyTrusted"))
    assertFalse(repo.getBoolean("credentialPresent"))
  }

  @Test
  fun summaryHostKeyTrustIsNullForNonSftp() {
    call { module.saveRepository(config(protocol = "FTP", port = 21.0), PASSWORD, it) }

    assertTrue(call { module.getRepositorySummary(it) }.getMap("repository")!!.isNull("hostKeyTrusted"))
  }

  // --- testRepository ---

  @Test
  fun testConnectsListsPersistsPrecisionAndReleasesEverything() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }

    val result = call { module.testRepository(it) }

    assertEquals("ok", result.getString("status"))
    val connection = result.getMap("connection")!!
    assertEquals("SFTP", connection.getString("protocol"))
    assertTrue(connection.getBoolean("reachable"))
    assertEquals(2, connection.getInt("entryCount"))
    assertEquals(1000.0, connection.getDouble("precisionMillis"), 0.0)
    assertEquals("SFTP_V3_WHOLE_SECONDS", connection.getString("precisionBasis"))
    assertTrue(connection.getBoolean("precisionPersisted"))
    assertEquals(1000L, db.repositoryConfigDao().get()!!.precisionMillis)

    val client = clients.single()
    assertEquals(RemoteProtocol.SFTP, client.protocol)
    assertEquals(PASSWORD, client.passwordSeen)
    assertEquals("/photos", client.listed)
    assertTrue(client.closed)
    assertTrue("password array wiped", client.passwordArray!!.all { it == '\u0000' })
    assertEquals(1000.0, call { module.getRepositorySummary(it) }.getMap("repository")!!.getDouble("precisionMillis"), 0.0)
  }

  @Test
  fun remoteFailureKeepsItsCodeIsScrubbedAndStillReleases() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }
    nextClient = {
      FakeClient(
        connectFailure =
          RemoteClientException(CloudSyncErrorCode.AUTH_FAILED, "Login to $HOST as $USER refused", "Check the password."),
      )
    }

    val error = call { module.testRepository(it) }.getMap("error")!!

    assertEquals("AUTH_FAILED", error.getString("code"))
    assertFalse(error.getString("message")!!.contains(HOST))
    assertFalse(error.getString("message")!!.contains(USER))
    val client = clients.single()
    assertTrue(client.closed)
    assertTrue(client.passwordArray!!.all { it == '\u0000' })
    assertEquals(0L, db.repositoryConfigDao().get()!!.precisionMillis)
  }

  @Test
  fun aFolderThatCannotBeListedIsReportedPerFolderAndTheTestPasses() = runBlocking {
    call { module.saveRepository(config(roots = listOf("/photos", "/gone")), PASSWORD, it) }
    nextClient = {
      FakeClient(
        failingDirectory = "/gone",
        listFailure =
          RemoteClientException(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, "No /gone on $HOST for $USER", "Check the folder."),
      )
    }

    val result = call { module.testRepository(it) }

    assertEquals("ok", result.getString("status"))
    val connection = result.getMap("connection")!!
    assertEquals(2, connection.getInt("entryCount"))
    val folders = connection.getArray("folders")!!
    assertEquals("/photos", folders.getMap(0)!!.getString("path"))
    assertEquals(2, folders.getMap(0)!!.getInt("entryCount"))
    val gone = folders.getMap(1)!!
    assertEquals("/gone", gone.getString("path"))
    assertTrue(gone.isNull("entryCount"))
    val error = gone.getMap("error")!!
    assertEquals("REMOTE_ROOT_NOT_FOUND", error.getString("code"))
    for (secret in listOf(HOST, USER, "/gone")) assertFalse(error.getString("message")!!.contains(secret))
    assertTrue(clients.single().closed)
    assertTrue(clients.single().passwordArray!!.all { it == '\u0000' })
  }

  @Test
  fun unexpectedThrowableStillReleasesAndBecomesInternalError() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }
    nextClient = { FakeClient(listFailure = IllegalStateException("boom at $HOST")) }

    val error = call { module.testRepository(it) }.getMap("error")!!

    assertEquals("INTERNAL_ERROR", error.getString("code"))
    assertTrue(clients.single().closed)
    assertTrue(clients.single().passwordArray!!.all { it == '\u0000' })
  }

  @Test
  fun unverifiedSftpHostKeySurfacesTheChallengeNotAGenericFailure() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }
    val challenge = hostKeys.challenges.raise(HOST, 2222, PresentedHostKey.of(hostKey()), null)
    nextClient = { FakeClient(outcome = ConnectOutcome.HostKeyApprovalRequired(challenge)) }

    val error = call { module.testRepository(it) }.getMap("error")!!

    assertEquals("SFTP_HOST_KEY_UNVERIFIED", error.getString("code"))
    val dto = error.getMap("hostKeyChallenge")!!
    assertEquals(challenge.challengeId, dto.getString("challengeId"))
    assertEquals(challenge.fingerprint, dto.getString("fingerprint"))
    assertNull("never listed before approval", clients.single().listed)
    assertTrue(clients.single().closed)
  }

  @Test
  fun testWithoutConfigOrCredentialBuildsNoClient() = runBlocking {
    assertEquals(
      "REPOSITORY_NOT_CONFIGURED",
      call { module.testRepository(it) }.getMap("error")!!.getString("code"),
    )

    call { module.saveRepository(config(), PASSWORD, it) }
    credentials.clear()

    assertEquals(
      "CREDENTIAL_UNAVAILABLE",
      call { module.testRepository(it) }.getMap("error")!!.getString("code"),
    )
    assertTrue(clients.isEmpty())
  }

  @Test
  fun precisionIsNotWrittenOntoAConfigSavedMidTest() = runBlocking {
    call { module.saveRepository(config(), PASSWORD, it) }
    val row = db.repositoryConfigDao().get()!!
    db.repositoryConfigDao().put(row.copy(revision = row.revision + 1))

    assertEquals(0, db.repositoryConfigDao().updatePrecision(row.revision, 1000L))
    assertEquals(0L, db.repositoryConfigDao().get()!!.precisionMillis)
  }

  // --- helpers ---

  private fun assertNoPasswordInRoom() {
    val cursor = db.query("SELECT * FROM repository_config", null)
    while (cursor.moveToNext()) {
      for (i in 0 until cursor.columnCount) {
        assertFalse(cursor.getColumnName(i).contains("password", ignoreCase = true))
        if (cursor.getType(i) == android.database.Cursor.FIELD_TYPE_STRING) {
          assertFalse(cursor.getString(i).contains(PASSWORD))
        }
      }
    }
    cursor.close()
  }

  private fun call(block: (Promise) -> Unit): ReadableMap {
    val promise = RecordingPromise()
    block(promise)
    val result = promise.await() as ReadableMap
    assertNull("CloudSync methods must never reject", promise.rejectedCode)
    return result
  }

  private fun config(
    protocol: String? = "SFTP",
    host: String = HOST,
    port: Double = 2222.0,
    username: String = USER,
    root: String = "/photos",
    roots: List<String> = listOf(root),
  ): JavaOnlyMap =
    JavaOnlyMap().apply {
      if (protocol == null) putNull("protocol") else putString("protocol", protocol)
      putString("host", host)
      putDouble("port", port)
      putString("username", username)
      putArray("remoteRoots", JavaOnlyArray.from(roots))
    }

  private fun hostKey() = Buffer.PlainBuffer(Base64.getDecoder().decode(KEY_BLOB)).readPublicKey()

  private class FakeClient(
    private val outcome: ConnectOutcome = ConnectOutcome.Connected,
    private val listFailure: Throwable? = null,
    /** When set, only this directory fails with [listFailure]. */
    private val failingDirectory: String? = null,
    private val connectFailure: RemoteClientException? = null,
  ) : RemoteClient {
    var protocol: RemoteProtocol? = null
    var passwordArray: CharArray? = null
    var passwordSeen: String? = null
    var listed: String? = null
    var closed = false

    override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
      passwordArray = password
      passwordSeen = String(password)
      connectFailure?.let { throw it }
      return outcome
    }

    override suspend fun list(directory: String): List<RemoteEntry> {
      if (failingDirectory == null || failingDirectory == directory) listFailure?.let { throw it }
      listed = directory
      return listOf(
        RemoteEntry("a.jpg", 10, 0L, RemoteEntryType.REGULAR_FILE),
        RemoteEntry("dir", 0, null, RemoteEntryType.DIRECTORY),
      )
    }

    override suspend fun discoverPrecision() = PrecisionFinding(1000L, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)

    override fun close() {
      closed = true
    }
  }

  private companion object {
    const val HOST = "nas.example.test"
    const val USER = "alice"
    const val PASSWORD = "correct-horse-battery"
    const val KEY_BLOB = "AAAAC3NzaC1lZDI1NTE5AAAAIOdJBz774N97LZvrLI0+A0poQyGnaZ0EGGkLxgwWHrqV"
  }
}
