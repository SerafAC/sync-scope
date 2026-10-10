package com.syncscope.bridge

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableMap
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.TrustedSftpHostKeyDao
import com.syncscope.persistence.TrustedSftpHostKeyEntity
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyChallenge
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.PrecisionFinding
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import com.syncscope.scan.BusyState
import com.syncscope.scan.ScanCoordinator
import com.syncscope.scan.ScanHarness
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
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
import org.robolectric.shadows.ShadowLog

/**
 * [RepositoryOperations] over in-memory fakes (contract version 6): `remoteRoots` with `fieldIndex`, the
 * per-folder test (research R11, R12), `webdavHttps`, `revision`, the
 * mirrored default ports, `error.field`, the busy refusal (R3, FR-011), the reworded actions that name
 * Settings › Repository (R5), and SC-005 (the password never reaches the device log).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class RepositoryOperationsTest {

  private lateinit var context: Context
  private lateinit var credentials: CredentialStore
  private val dao = FakeRepositoryConfigDao()
  private val clients = mutableListOf<FakeClient>()
  private var busyState = BusyState.NONE
  private val failures = mutableMapOf<String, RemoteClientException>()
  private var connectFailure: RemoteClientException? = null
  private var hostKeyChallenge: HostKeyChallenge? = null
  private val listings = mutableMapOf<String, List<RemoteEntry>>()
  private val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })
  private lateinit var ops: RepositoryOperations

  @Before
  fun setUp() {
    context = ApplicationProvider.getApplicationContext()
    credentials = CredentialStore { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }
    ops = operations { busyState }
    ShadowLog.clear()
  }

  @After
  fun tearDown() {
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().commit()
  }

  // --- webdavHttps and revision ---

  @Test
  fun webdavHttpsIsSavedAndReturnedBySummary() = runBlocking {
    assertOk(ops.save(config(protocol = "WEBDAV", https = true), PASSWORD))

    assertTrue(dao.row!!.webdavHttps)
    assertTrue(summary().getBoolean("webdavHttps"))
  }

  @Test
  fun absentWebdavHttpsMeansFalse() = runBlocking {
    assertOk(ops.save(config(protocol = "WEBDAV", https = null), PASSWORD))

    assertFalse(dao.row!!.webdavHttps)
    assertFalse(summary().getBoolean("webdavHttps"))
  }

  @Test
  fun summaryCarriesTheRevisionBumpedOnEverySave() = runBlocking {
    assertOk(ops.save(config(), PASSWORD))
    assertEquals(1, summary().getInt("revision"))

    assertOk(ops.save(config(root = "/other"), null))
    assertEquals(2, summary().getInt("revision"))
  }

  @Test
  fun testPassesWebdavHttpsIntoTheRemoteConfig() = runBlocking {
    assertOk(ops.save(config(protocol = "WEBDAV", https = true, port = null), PASSWORD))

    assertOk(ops.test())

    val seen = clients.single().config!!
    assertEquals(RemoteProtocol.WEBDAV, seen.protocol)
    assertTrue(seen.webdavHttps)
    assertEquals(RepositoryDefaultPorts.WEBDAV_HTTPS, seen.port)
  }

  // --- default ports ---

  @Test
  fun nullPortTakesTheProtocolDefaultFromRepositoryDefaultPorts() = runBlocking {
    val cases =
      listOf(
        Triple("FTP", false, RepositoryDefaultPorts.FTP),
        Triple("SFTP", false, RepositoryDefaultPorts.SFTP),
        Triple("WEBDAV", false, RepositoryDefaultPorts.WEBDAV),
        Triple("WEBDAV", true, RepositoryDefaultPorts.WEBDAV_HTTPS),
      )
    for ((protocol, https, expected) in cases) {
      assertOk(ops.save(config(protocol = protocol, port = null, https = https), PASSWORD))
      assertEquals("$protocol https=$https", expected, dao.row!!.port)
    }
    assertEquals(listOf(21, 22, 80, 443), cases.map { it.third })
  }

  @Test
  fun defaultPortIgnoresHttpsForNonWebdav() {
    assertEquals(21, RepositoryOperations.defaultPort(RemoteProtocol.FTP, https = true))
    assertEquals(22, RepositoryOperations.defaultPort(RemoteProtocol.SFTP, https = true))
    assertEquals(80, RepositoryOperations.defaultPort(RemoteProtocol.WEBDAV, https = false))
    assertEquals(443, RepositoryOperations.defaultPort(RemoteProtocol.WEBDAV, https = true))
  }

  // --- field errors ---

  @Test
  fun eachInvalidFieldIsInvalidQueryWithFieldSet() = runBlocking {
    val cases =
      listOf(
        "protocol" to config(protocol = "SMB"),
        "host" to config(host = ""),
        "port" to config(port = 0.0),
        "username" to config(username = " "),
        "remoteRoots" to config(root = "/photos/../etc"),
        "webdavHttps" to config(protocol = "WEBDAV").apply { putString("webdavHttps", "yes") },
      )
    for ((field, map) in cases) {
      val error = ops.save(map, PASSWORD).getMap("error")!!
      assertEquals(field, CloudSyncErrorCode.INVALID_QUERY.name, error.getString("code"))
      assertEquals(field, error.getString("field"))
    }
    val noPassword = ops.save(config(), null).getMap("error")!!
    assertEquals(CloudSyncErrorCode.INVALID_QUERY.name, noPassword.getString("code"))
    assertEquals("password", noPassword.getString("field"))
    assertNull(dao.row)
  }

  // --- remoteRoots (contract version 6, research R11, R12) ---

  @Test
  fun webdavHostKeepsItsSharedPathThroughSaveSummaryTestAndBrowse() = runBlocking {
    val host = "$HOST/remote.php/dav/alice"
    assertOk(ops.save(config(protocol = "WEBDAV", host = host, roots = listOf("/a", "/b")), PASSWORD))
    assertEquals(host, dao.row!!.host)
    assertEquals(host, summary().getString("host"))
    assertOk(ops.test())
    assertEquals(host, clients.last().config!!.host)
    assertEquals(listOf("/a", "/b"), clients.last().config!!.rootPaths)
    assertOk(ops.browse(config(protocol = "WEBDAV", host = host), null, "/"))
    assertEquals(host, clients.last().config!!.host)
    // DNS is case-insensitive; the endpoint path is not.
    assertOk(ops.browse(config(protocol = "WEBDAV", host = "${HOST.uppercase()}/remote.php/dav/alice"), null, "/"))
    val error = ops.browse(config(protocol = "WEBDAV", host = "$HOST/remote.php/dav/ALICE"), null, "/").getMap("error")!!
    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE.name, error.getString("code"))
  }

  @Test
  fun hostPathsAreWebdavOnlyAndCannotSmuggleUrlAuthorityOrQuery() = runBlocking {
    for (protocol in listOf("FTP", "SFTP")) {
      assertEquals("host", ops.save(config(protocol = protocol, host = "$HOST/dav"), PASSWORD).getMap("error")!!.getString("field"))
    }
    for (host in listOf("https://$HOST/dav", "user@$HOST/dav", "$HOST/dav?token=x", "$HOST/dav#top", "$HOST/dav\\folder")) {
      assertEquals("host", ops.save(config(protocol = "WEBDAV", host = host), PASSWORD).getMap("error")!!.getString("field"))
    }
    assertNull(dao.row)
  }

  @Test
  fun eachRemoteRootsCaseIsAFieldErrorWithItsIndexAndStoresNothing() = runBlocking {
    val cases =
      listOf(
        Triple(config(roots = emptyList()), 0, "Add at least one remote folder."),
        Triple(config(roots = listOf(" ", "")), 0, "Add at least one remote folder."),
        Triple(config(roots = listOf("/a", "/b\nc")), 1, "A folder name cannot contain a line break."),
        Triple(
          config(roots = listOf("/scan/clean/a", "/scan/clean/a/x")),
          1,
          "This folder is the same as, inside or around /scan/clean/a.",
        ),
        Triple(config(roots = listOf("/a", "/b", "/b/")), 2, "This folder is the same as, inside or around /b."),
        Triple(config(roots = null), 0, "Add at least one remote folder."),
      )
    for ((map, index, message) in cases) {
      val error = ops.save(map, PASSWORD).getMap("error")!!
      assertEquals(message, CloudSyncErrorCode.INVALID_QUERY.name, error.getString("code"))
      assertEquals(message, "remoteRoots", error.getString("field"))
      assertEquals(message, index, error.getInt("fieldIndex"))
      assertEquals(message, error.getString("message"))
    }
    assertNull(dao.row)
    assertFalse("no credential stored", credentials.isCurrent(1L))
  }

  @Test
  fun remoteRootsOfTheWrongTypeAreFieldErrors() = runBlocking {
    val notAList = config().apply { putString("remoteRoots", "/photos") }
    val notAListError = ops.save(notAList, PASSWORD).getMap("error")!!
    assertEquals("remoteRoots", notAListError.getString("field"))
    assertFalse(notAListError.hasKey("fieldIndex"))

    val notText = config().apply { putArray("remoteRoots", JavaOnlyArray.of("/a", 3.0)) }
    val notTextError = ops.save(notText, PASSWORD).getMap("error")!!
    assertEquals("remoteRoots", notTextError.getString("field"))
    assertEquals(1, notTextError.getInt("fieldIndex"))
    assertNull(dao.row)
  }

  @Test
  fun otherFieldErrorsCarryNoFieldIndex() = runBlocking {
    val error = ops.save(config(host = ""), PASSWORD).getMap("error")!!
    assertEquals("host", error.getString("field"))
    assertFalse(error.hasKey("fieldIndex"))
  }

  @Test
  fun aValidSaveStoresTheNormalizedListAndSummaryReturnsItInOrder() = runBlocking {
    assertOk(ops.save(config(roots = listOf(" scan/clean/b/ ", "/scan//clean/a")), PASSWORD))

    assertEquals("/scan/clean/b\n/scan/clean/a", dao.row!!.remoteRoots)
    val roots = summary().getArray("remoteRoots")!!
    assertEquals(listOf("/scan/clean/b", "/scan/clean/a"), (0 until roots.size()).map { roots.getString(it) })
    assertFalse(summary().hasKey("remoteRoot"))
  }

  @Test
  fun changingTheFoldersBumpsTheRevision() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a")), PASSWORD))
    assertOk(ops.save(config(roots = listOf("/a", "/b")), null))

    assertEquals(2L, dao.row!!.revision)
    assertEquals("/a\n/b", dao.row!!.remoteRoots)
  }

  @Test
  fun everyFolderIsASensitiveValue() {
    val config = RemoteConfig(RemoteProtocol.FTP, HOST, 21, USER, listOf("/photos", "/backup/phone"))

    assertTrue(config.sensitiveValues.containsAll(listOf(HOST, USER, "/photos", "/backup/phone")))
    assertFalse("the bare root scrubs nothing", "/" in RemoteConfig(RemoteProtocol.FTP, HOST, 21, USER).sensitiveValues)
    assertFalse(config.toString().contains("/photos"))
  }

  @Test
  fun testConnectsOnceAndListsEveryFolderInOrder() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a", "/b")), PASSWORD))

    val result = ops.test()

    assertOk(result)
    val client = clients.single()
    assertEquals(1, client.connects)
    assertEquals(listOf("/a", "/b"), client.listed)
    assertEquals(listOf("/a", "/b"), client.config!!.rootPaths)
    assertTrue(client.closed)
    val connection = result.getMap("connection")!!
    assertEquals(2, connection.getInt("entryCount"))
    val folders = connection.getArray("folders")!!
    assertEquals(2, folders.size())
    for ((i, path) in listOf("/a", "/b").withIndex()) {
      val folder = folders.getMap(i)!!
      assertEquals(path, folder.getString("path"))
      assertEquals(1, folder.getInt("entryCount"))
      assertTrue(folder.isNull("error"))
    }
  }

  @Test
  fun aFailingFolderIsReportedOnItsLineAndTheTestStillPasses() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a", "/missing", "/c")), PASSWORD))
    failures["/missing"] =
      failure(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, "No /missing on $HOST for $USER")

    val result = ops.test()

    assertOk(result)
    val connection = result.getMap("connection")!!
    assertTrue(connection.getBoolean("reachable"))
    assertEquals("the sum over the folders that were read", 2, connection.getInt("entryCount"))
    val folders = connection.getArray("folders")!!
    assertEquals(listOf("/a", "/missing", "/c"), (0 until folders.size()).map { folders.getMap(it)!!.getString("path") })
    val failed = folders.getMap(1)!!
    assertTrue(failed.isNull("entryCount"))
    val error = failed.getMap("error")!!
    assertEquals(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND.name, error.getString("code"))
    assertEquals("Check the folder.", error.getString("action"))
    val message = error.getString("message")!!
    for (secret in listOf(HOST, USER, "/missing")) assertFalse(message, message.contains(secret))
    assertEquals(listOf("/a", "/missing", "/c"), clients.single().listed)
  }

  @Test
  fun connectAndLoginFailuresStillFailTheWholeTest() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a", "/b")), PASSWORD))
    connectFailure = failure(CloudSyncErrorCode.AUTH_FAILED, "Login as $USER refused")

    val error = ops.test().getMap("error")!!

    assertEquals(CloudSyncErrorCode.AUTH_FAILED.name, error.getString("code"))
    assertTrue(clients.single().listed.isEmpty())
    assertTrue(clients.single().closed)
  }

  @Test
  fun precisionDiscoveryRunsOnceAfterTheFoldersAreListed() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/first", "/second")), PASSWORD))

    assertOk(ops.test())

    val client = clients.single()
    assertEquals(1, client.precisionCalls)
    assertEquals("/first", client.config!!.rootPaths.first())
    assertEquals(1000L, dao.row!!.precisionMillis)
  }

  @Test
  fun noPasswordCrossesTheBridge() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a", "/b")), PASSWORD))
    failures["/b"] = failure(CloudSyncErrorCode.DIRECTORY_UNREADABLE, "denied")

    for (result in listOf(ops.summary(), ops.test())) {
      assertFalse(result.toHashMap().toString().contains(PASSWORD))
    }
  }


  // --- browseRemoteFolders (contract version 6, research R13) ---

  @Test
  fun browseValidatesTheDraftWithTheSaveRulesButNeedsNoRemoteRoots() = runBlocking {
    val invalid = ops.browse(config(host = ""), PASSWORD, null).getMap("error")!!
    assertEquals(CloudSyncErrorCode.INVALID_QUERY.name, invalid.getString("code"))
    assertEquals("host", invalid.getString("field"))
    assertTrue("nothing connected for an invalid draft", clients.isEmpty())

    for (draft in listOf(config(roots = null), config(roots = emptyList()), config(roots = listOf("/a", "/a/b")))) {
      assertOk(ops.browse(draft, PASSWORD, null))
    }
  }

  @Test
  fun browseUsesTheTransientPasswordWhenGiven() = runBlocking {
    assertOk(ops.save(config(), PASSWORD))

    assertOk(ops.browse(config(), "typed-password", null))

    assertEquals("typed-password", clients.single().password)
  }

  @Test
  fun browseUsesTheStoredCredentialForTheSameAccount() = runBlocking {
    assertOk(ops.save(config(roots = listOf("/a")), PASSWORD))

    assertOk(ops.browse(config(host = HOST.uppercase(), roots = listOf("/other")), null, null))

    assertEquals(PASSWORD, clients.single().password)
  }

  @Test
  fun browseWithoutAPasswordForAnotherAccountIsCredentialUnavailable() = runBlocking {
    val noRepository = ops.browse(config(), null, null).getMap("error")!!
    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE.name, noRepository.getString("code"))
    assertEquals("Enter the password to browse the server.", noRepository.getString("action"))

    assertOk(ops.save(config(), PASSWORD))
    val others =
      listOf(
        config(protocol = "FTP"),
        config(host = "other.example.test"),
        config(port = 22.0),
        config(username = "bob"),
      )
    for (draft in others) {
      val error = ops.browse(draft, null, null).getMap("error")!!
      assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE.name, error.getString("code"))
      assertEquals("Enter the password to browse the server.", error.getString("action"))
    }

    credentials.clear()
    val lost = ops.browse(config(), null, null).getMap("error")!!
    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE.name, lost.getString("code"))
    assertEquals("Enter the password to browse the server.", lost.getString("action"))
    assertTrue("nothing connected without a password", clients.isEmpty())
  }

  @Test
  fun browseWithNoPathOrAnEmptyPathListsTheTop() = runBlocking {
    for (path in listOf(null, "", "  ")) {
      val folders = browsed(ops.browse(config(), PASSWORD, path))
      assertEquals("/", folders.getString("path"))
      assertTrue(folders.isNull("parent"))
      assertFalse(folders.getBoolean("fellBackToRoot"))
      assertEquals(listOf("/"), clients.last().listed)
    }
  }

  @Test
  fun browseNormalizesThePathAndNamesItsParent() = runBlocking {
    listings["/scan/clean"] = listOf(dir("a"), dir("b"))

    val folders = browsed(ops.browse(config(), PASSWORD, " scan//clean/ "))

    assertEquals("/scan/clean", folders.getString("path"))
    assertEquals("/scan", folders.getString("parent"))
    assertFalse(folders.getBoolean("fellBackToRoot"))
    assertEquals(listOf("a", "b"), names(folders))
    assertEquals(listOf("/scan/clean"), clients.single().listed)

    listings["/scan"] = listOf(dir("clean"))
    assertEquals("/", browsed(ops.browse(config(), PASSWORD, "/scan")).getString("parent"))
  }

  @Test
  fun aMissingPathFallsBackToTheTop() = runBlocking {
    listings["/"] = listOf(dir("scan"))
    for (code in listOf(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, CloudSyncErrorCode.DIRECTORY_UNREADABLE)) {
      failures["/gone"] = failure(code, "no such folder")

      val folders = browsed(ops.browse(config(), PASSWORD, "/gone"))

      assertEquals("/", folders.getString("path"))
      assertTrue(folders.isNull("parent"))
      assertTrue(folders.getBoolean("fellBackToRoot"))
      assertEquals(listOf("scan"), names(folders))
      val client = clients.last()
      assertEquals("one connection for both listings", 1, client.connects)
      assertEquals(listOf("/gone", "/"), client.listed)
    }
  }

  @Test
  fun anUnusablePathFallsBackToTheTop() = runBlocking {
    for (path in listOf("/a/../etc", "/a\nb")) {
      val folders = browsed(ops.browse(config(), PASSWORD, path))
      assertEquals("/", folders.getString("path"))
      assertTrue(folders.getBoolean("fellBackToRoot"))
    }
  }

  @Test
  fun aTopThatCannotBeReadIsAnError() = runBlocking {
    failures["/"] = failure(CloudSyncErrorCode.DIRECTORY_UNREADABLE, "denied on $HOST")
    failures["/gone"] = failure(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, "no /gone")

    for (path in listOf(null, "/gone")) {
      val error = ops.browse(config(), PASSWORD, path).getMap("error")!!
      assertEquals(CloudSyncErrorCode.DIRECTORY_UNREADABLE.name, error.getString("code"))
      assertEquals("Check the folder.", error.getString("action"))
      assertFalse(error.getString("message")!!.contains(HOST))
      assertTrue(clients.last().closed)
    }
  }

  @Test
  fun browseListsDirectoryNamesOnlySortedCaseInsensitively() = runBlocking {
    listings["/"] =
      listOf(
        dir("beta"),
        RemoteEntry("photo.jpg", 10, 0L, RemoteEntryType.REGULAR_FILE),
        dir("Alpha"),
        RemoteEntry("link", 0, null, RemoteEntryType.OTHER),
        dir("gamma"),
        dir("Beta2"),
      )

    val folders = browsed(ops.browse(config(), PASSWORD, "/"))

    assertEquals(listOf("Alpha", "beta", "Beta2", "gamma"), names(folders))
  }

  @Test
  fun browseConnectAndLoginFailuresUseTheTestEnvelope() = runBlocking {
    connectFailure = failure(CloudSyncErrorCode.AUTH_FAILED, "Login as $USER refused")

    val error = ops.browse(config(), PASSWORD, "/photos").getMap("error")!!

    assertEquals(CloudSyncErrorCode.AUTH_FAILED.name, error.getString("code"))
    assertEquals("Check the folder.", error.getString("action"))
    assertFalse(error.getString("message")!!.contains(USER))
    assertTrue(clients.single().listed.isEmpty())
    assertTrue(clients.single().closed)
  }

  @Test
  fun browseReturnsTheHostKeyChallenge() = runBlocking {
    hostKeyChallenge = challenge()

    val error = ops.browse(config(), PASSWORD, null).getMap("error")!!

    assertEquals(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED.name, error.getString("code"))
    assertEquals("c-1", error.getMap("hostKeyChallenge")!!.getString("challengeId"))
    assertTrue(clients.single().listed.isEmpty())
    assertTrue(clients.single().closed)
  }

  @Test
  fun browseIsRefusedDuringAScanOrADeletion() = runBlocking {
    for ((state, code) in listOf(
      BusyState.SCAN to CloudSyncErrorCode.SCAN_IN_PROGRESS,
      BusyState.DELETION to CloudSyncErrorCode.DELETION_IN_PROGRESS,
    )) {
      busyState = state
      val error = ops.browse(config(), PASSWORD, null).getMap("error")!!
      assertEquals(code.name, error.getString("code"))
    }
    assertTrue(clients.isEmpty())
  }

  @Test
  fun browseOpensOneConnectionClosesItAndWritesNothing() = runBlocking {
    assertOk(ops.save(config(), PASSWORD))
    val before = dao.row
    val version = before!!.credentialVersion

    assertOk(ops.browse(config(protocol = "FTP", host = "other.example.test"), "other-password", "/x"))
    failures["/y"] = failure(CloudSyncErrorCode.CONNECTION_LOST, "lost")
    ops.browse(config(), null, "/y")

    assertEquals(2, clients.size)
    for (client in clients) {
      assertEquals(1, client.connects)
      assertTrue(client.closed)
      assertEquals(0, client.precisionCalls)
    }
    assertEquals(before, dao.row)
    assertTrue(credentials.isCurrent(version))
    assertEquals(PASSWORD, String(credentials.load(version)!!))
  }

  @Test
  fun browseNeverLogsThePassword() = runBlocking {
    ops.browse(config(), LOG_PROBE, "/photos")
    connectFailure = failure(CloudSyncErrorCode.AUTH_FAILED, "refused")
    ops.browse(config(), LOG_PROBE, "/photos")

    for (item in ShadowLog.getLogs()) {
      assertFalse("${item.tag}: ${item.msg}", item.msg.orEmpty().contains(LOG_PROBE))
    }
  }

  // --- busy ---

  @Test
  fun saveDuringAScanIsRefusedAndWritesNothing() = runBlocking {
    busyState = BusyState.SCAN

    val error = ops.save(config(), PASSWORD).getMap("error")!!

    assertEquals(CloudSyncErrorCode.SCAN_IN_PROGRESS.name, error.getString("code"))
    assertEquals(CloudSyncErrorCode.SCAN_IN_PROGRESS.defaultMessage, error.getString("message"))
    assertNull(dao.row)
    assertFalse("no credential stored", credentials.isCurrent(1L))
  }

  @Test
  fun saveDuringADeletionIsRefusedAndWritesNothing() = runBlocking {
    assertOk(ops.save(config(), PASSWORD))
    val before = dao.row
    busyState = BusyState.DELETION

    val error = ops.save(config(root = "/elsewhere"), "new-password").getMap("error")!!

    assertEquals(CloudSyncErrorCode.DELETION_IN_PROGRESS.name, error.getString("code"))
    assertEquals(before, dao.row)
    assertEquals(PASSWORD, String(credentials.load(before!!.credentialVersion)!!))
  }

  @Test
  fun busyStateFollowsTheCoordinatorsExclusiveBlock() = runBlocking {
    val harness = ScanHarness(context)
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    try {
      val coordinator = ScanCoordinator(harness.engine, harness.store, scope, harness.clock)
      val guarded = operations(coordinator::busyState)

      assertEquals(BusyState.NONE, coordinator.busyState())
      val error = coordinator.runExclusive { guarded.save(config(), PASSWORD) }.getMap("error")!!

      assertEquals(CloudSyncErrorCode.DELETION_IN_PROGRESS.name, error.getString("code"))
      assertNull(dao.row)
      assertOk(guarded.save(config(), PASSWORD))
    } finally {
      scope.cancel()
      harness.db.close()
    }
  }

  // --- reworded actions ---

  @Test
  fun notConfiguredPointsAtSettingsRepository() = runBlocking {
    for (result in listOf(ops.summary(), ops.test())) {
      val error = result.getMap("error")!!
      assertEquals(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED.name, error.getString("code"))
      assertEquals("Set up your server in Settings › Repository.", error.getString("action"))
    }
  }

  @Test
  fun unavailableCredentialPointsAtSettingsRepository() = runBlocking {
    assertOk(ops.save(config(), PASSWORD))
    credentials.clear()

    val error = ops.test().getMap("error")!!

    assertEquals(CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE.name, error.getString("code"))
    assertEquals("Enter the password again in Settings › Repository.", error.getString("action"))
    assertTrue(clients.isEmpty())
  }

  // --- SC-005 ---

  @Test
  fun thePasswordNeverReachesTheDeviceLog() = runBlocking {
    assertOk(ops.save(config(), LOG_PROBE))
    assertOk(ops.test())
    assertOk(ops.save(config(protocol = "WEBDAV", https = true), LOG_PROBE))
    assertOk(ops.test())

    val logs = ShadowLog.getLogs()
    assertTrue("the operations log something", logs.isNotEmpty())
    for (item in logs) {
      assertFalse("${item.tag}: ${item.msg}", item.msg.orEmpty().contains(LOG_PROBE))
      assertFalse(item.tag, item.throwable?.toString().orEmpty().contains(LOG_PROBE))
    }
  }

  // --- helpers ---

  private fun operations(busy: () -> BusyState): RepositoryOperations =
    RepositoryOperations(
      repositories = { dao },
      credentials = { credentials },
      hostKeys = { HostKeyTrustStore(EmptyHostKeyDao()) },
      clients = { RemoteClientFactory { protocol -> FakeClient().also { it.protocol = protocol; clients += it } } },
      envelope = envelope,
      busy = busy,
    )

  private suspend fun summary(): ReadableMap {
    val result = ops.summary()
    assertOk(result)
    return result.getMap("repository")!!
  }

  private fun browsed(result: ReadableMap): ReadableMap {
    assertOk(result)
    return result.getMap("remoteFolders")!!
  }

  private fun names(folders: ReadableMap): List<String> {
    val array = folders.getArray("folders")!!
    return (0 until array.size()).map { array.getString(it)!! }
  }

  private fun dir(name: String) = RemoteEntry(name, 0, null, RemoteEntryType.DIRECTORY)

  private fun challenge() =
    HostKeyChallenge("c-1", HOST, 2222, "ssh-ed25519", "AAAA", "SHA256:new", null, 0L)

  private fun assertOk(result: ReadableMap) {
    val error = if (result.hasKey("error")) result.getMap("error")?.toHashMap() else null
    assertEquals("expected ok, got $error", "ok", result.getString("status"))
  }

  private fun config(
    protocol: String = "SFTP",
    host: String = HOST,
    port: Double? = 2222.0,
    username: String = USER,
    root: String = "/photos",
    https: Boolean? = null,
    roots: List<String>? = listOf(root),
  ): JavaOnlyMap =
    JavaOnlyMap().apply {
      putString("protocol", protocol)
      putString("host", host)
      if (port == null) putNull("port") else putDouble("port", port)
      putString("username", username)
      roots?.let { putArray("remoteRoots", JavaOnlyArray.from(it)) }
      if (https != null) putBoolean("webdavHttps", https)
    }

  private class FakeRepositoryConfigDao : RepositoryConfigDao {
    var row: RepositoryConfigEntity? = null

    override suspend fun put(config: RepositoryConfigEntity) {
      row = config
    }

    override suspend fun get(): RepositoryConfigEntity? = row

    override suspend fun updatePrecision(revision: Long, precisionMillis: Long): Int {
      val current = row ?: return 0
      if (current.revision != revision) return 0
      row = current.copy(precisionMillis = precisionMillis)
      return 1
    }
  }

  private class EmptyHostKeyDao : TrustedSftpHostKeyDao() {
    override suspend fun insert(key: TrustedSftpHostKeyEntity) = Unit

    override suspend fun update(key: TrustedSftpHostKeyEntity) = Unit

    override suspend fun byId(id: Long): TrustedSftpHostKeyEntity? = null

    override suspend fun forEndpoint(host: String, port: Int, algorithm: String): TrustedSftpHostKeyEntity? = null

    override suspend fun forHost(host: String, port: Int): List<TrustedSftpHostKeyEntity> = emptyList()

    override suspend fun deleteOtherAlgorithms(host: String, port: Int, algorithm: String) = Unit
  }

  private inner class FakeClient : RemoteClient {
    var protocol: RemoteProtocol? = null
    var config: RemoteConfig? = null
    var connects = 0
    var precisionCalls = 0
    var closed = false
    var password: String? = null
    val listed = mutableListOf<String>()

    override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome {
      connects++
      this.config = config
      this.password = String(password)
      connectFailure?.let { throw it }
      hostKeyChallenge?.let { return ConnectOutcome.HostKeyApprovalRequired(it) }
      return ConnectOutcome.Connected
    }

    override suspend fun list(directory: String): List<RemoteEntry> {
      listed += directory
      failures[directory]?.let { throw it }
      return listings[directory] ?: listOf(RemoteEntry("a.jpg", 10, 0L, RemoteEntryType.REGULAR_FILE))
    }

    override suspend fun discoverPrecision(): PrecisionFinding {
      precisionCalls++
      return PrecisionFinding(1000L, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)
    }

    override fun close() {
      closed = true
    }
  }

  private fun failure(code: CloudSyncErrorCode, message: String) =
    RemoteClientException(code, message, "Check the folder.")

  private companion object {
    const val PREFS = "repository-operations-test"
    const val HOST = "nas.example.test"
    const val USER = "alice"
    const val PASSWORD = "correct-horse-battery"
    const val LOG_PROBE = "s3cret-Log-Probe"
  }
}
