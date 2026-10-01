package com.syncscope

import android.content.Context
import androidx.room.Room
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.facebook.react.turbomodule.core.interfaces.TurboModule
import com.syncscope.bridge.CloudSyncContracts
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.CloudSyncModule
import com.syncscope.bridge.CloudSyncPackage
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.PrecisionBasis
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import java.text.Normalizer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Live connect proof for S01: every protocol is exercised against the digest-pinned
 * containers started by scripts/validation/android-flow.sh, never against fixtures.
 *
 * Credentials arrive as instrumentation arguments (`<proto>User` / `<proto>Password`,
 * bridged by app/build.gradle); a missing pair fails the run rather than skipping it,
 * because a skipped protocol would silently void the proof. The emulator reaches the
 * host loopback on 10.0.2.2. The container logs are audited on teardown (R026), so
 * nothing here may read file content.
 */
@RunWith(AndroidJUnit4::class)
class ProtocolConnectInstrumentedTest {
  private lateinit var context: Context
  private lateinit var database: SyncScopeDatabase
  private lateinit var hostKeys: HostKeyTrustStore
  private lateinit var credentials: CredentialStore
  private lateinit var module: CloudSyncModule
  private val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })

  @Before
  fun setUp() {
    context = InstrumentationRegistry.getInstrumentation().targetContext
    // In-memory Room and a dedicated encrypted-preferences file keep the app's own state untouched.
    database = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).build()
    hostKeys = HostKeyTrustStore(database.trustedSftpHostKeyDao())
    credentials = CredentialStore { encryptedTestPreferences(context) }
    module =
      CloudSyncModule(
        BridgeReactContext(context),
        dispatcher = Dispatchers.IO,
        envelope = envelope,
        hostKeyTrust = { hostKeys },
        repositoryConfig = { database.repositoryConfigDao() },
        credentialStore = { credentials },
      )
  }

  @After
  fun tearDown() {
    module.invalidate()
    credentials.clear()
    database.close()
  }

  // --- R019: the TurboModule is registered under the name JS resolves ---------------------

  @Test
  fun cloudSyncPackageRegistersTheTurboModuleAndReportsContractVersion() {
    val reactContext = BridgeReactContext(context)
    val cloudSyncPackage = CloudSyncPackage()
    val info = cloudSyncPackage.getReactModuleInfoProvider().getReactModuleInfos()[MODULE_NAME]
    assertNotNull("CloudSync is missing from the package's module infos", info)
    assertTrue("CloudSync must be registered as a TurboModule", info!!.isTurboModule)
    assertEquals(MODULE_NAME, info.name)

    val registered = cloudSyncPackage.getModule(MODULE_NAME, reactContext)
    assertTrue("getModule(\"CloudSync\") must return the CloudSync module", registered is CloudSyncModule)
    assertTrue("CloudSync must implement TurboModule", registered is TurboModule)
    assertEquals(MODULE_NAME, registered!!.name)
    assertNull("unknown names must not resolve", cloudSyncPackage.getModule("NotCloudSync", reactContext))

    val promise = AwaitedPromise()
    (registered as CloudSyncModule).getContractVersion(promise)
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, promise.await())
    assertEquals(3, CloudSyncContracts.CONTRACT_VERSION)
    registered.invalidate()
  }

  // --- Per-protocol live proof ------------------------------------------------------------

  @Test fun ftpConnectsThroughTheModuleAndRejectsAWrongPassword() = moduleConnectProof(Endpoint.FTP)

  @Test fun webDavConnectsThroughTheModuleAndRejectsAWrongPassword() = moduleConnectProof(Endpoint.WEBDAV)

  @Test fun ftpListingMatchesTheSeededFixtures() = listingProof(Endpoint.FTP)

  @Test fun sftpListingMatchesTheSeededFixtures() = listingProof(Endpoint.SFTP)

  @Test fun webDavListingMatchesTheSeededFixtures() = listingProof(Endpoint.WEBDAV)

  /**
   * Blocking TOFU end to end through the module: challenge → reject (nothing persisted,
   * re-challenged) → approve (persisted) → connect without a challenge. The wrong-password
   * check runs after approval, because SSH verifies the host key before authentication.
   */
  @Test
  fun sftpHostKeyTofuThenConnectThroughTheModule() {
    val endpoint = Endpoint.SFTP
    val account = account(endpoint)
    assertOk(call { module.saveRepository(endpoint.configMap(account.user), account.password, it) })

    val first = expectHostKeyChallenge(call { module.testRepository(it) })
    assertTrue("fingerprint must be OpenSSH SHA256", first.getString("fingerprint")!!.startsWith("SHA256:"))
    assertEquals("ssh-ed25519", first.getString("algorithm"))
    assertEquals(endpoint.port, first.getInt("port"))
    assertTrue("nothing may be trusted before approval", runBlocking { trustedRows(endpoint) }.isEmpty())

    assertOk(call { module.rejectSftpHostKey(first.getString("challengeId")!!, it) })
    assertTrue("reject must not persist a key", runBlocking { trustedRows(endpoint) }.isEmpty())
    // An answered challenge cannot be answered again.
    assertError(
      CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND,
      call { module.approveSftpHostKey(first.getString("challengeId")!!, it) },
    )

    val second = expectHostKeyChallenge(call { module.testRepository(it) })
    assertNotEquals(first.getString("challengeId"), second.getString("challengeId"))
    assertEquals(first.getString("fingerprint"), second.getString("fingerprint"))

    assertOk(call { module.approveSftpHostKey(second.getString("challengeId")!!, it) })
    val rows = runBlocking { trustedRows(endpoint) }
    assertEquals(1, rows.size)
    assertEquals(second.getString("fingerprint"), rows.single().fingerprint)

    val connection = assertConnected(endpoint, call { module.testRepository(it) })
    assertEquals(1000.0, connection.getDouble("precisionMillis"), 0.0)
    assertEquals(PrecisionBasis.SFTP_V3_WHOLE_SECONDS.name, connection.getString("precisionBasis"))
    val summary = assertOk(call { module.getRepositorySummary(it) }).getMap("repository")!!
    assertTrue(summary.getBoolean("hostKeyTrusted"))

    assertWrongPasswordIsTypedAuthFailure(endpoint, account)
  }

  private fun moduleConnectProof(endpoint: Endpoint) {
    val account = account(endpoint)
    assertWrongPasswordIsTypedAuthFailure(endpoint, account)

    assertOk(call { module.saveRepository(endpoint.configMap(account.user), account.password, it) })
    val connection = assertConnected(endpoint, call { module.testRepository(it) })
    val precision = connection.getDouble("precisionMillis").toLong()
    val basis = PrecisionBasis.valueOf(connection.getString("precisionBasis")!!)
    assertPrecision(endpoint, precision, basis)

    // The discovered precision is persisted against the saved profile.
    val summary = assertOk(call { module.getRepositorySummary(it) }).getMap("repository")!!
    assertEquals(precision.toDouble(), summary.getDouble("precisionMillis"), 0.0)
    assertTrue(summary.getBoolean("credentialPresent"))
  }

  /** A wrong password resolves an AUTH_FAILED envelope; the module never rejects or throws. */
  private fun assertWrongPasswordIsTypedAuthFailure(endpoint: Endpoint, account: Account) {
    assertOk(call { module.saveRepository(endpoint.configMap(account.user), account.password + WRONG_SUFFIX, it) })
    val result = call { module.testRepository(it) }
    val error = assertError(CloudSyncErrorCode.AUTH_FAILED, result)
    val message = error.getString("message").orEmpty()
    assertFalse("the error message must not echo the username", message.contains(account.user))
    assertFalse("the error message must not echo the password", message.contains(account.password))
  }

  private fun listingProof(endpoint: Endpoint) {
    val account = account(endpoint)
    val client = RemoteClientFactory.default { hostKeys }.create(endpoint.protocol)
    try {
      runBlocking {
        connectTrusting(client, endpoint, account)
        withTimeout(LISTING_TIMEOUT_MS) { assertListing(client, endpoint) }
        val finding = withTimeout(LISTING_TIMEOUT_MS) { client.discoverPrecision() }
        assertPrecision(endpoint, finding.precisionMillis, finding.basis)
        withTimeout(LISTING_TIMEOUT_MS) { assertBucketPair(client, endpoint, finding.precisionMillis) }
      }
    } finally {
      client.close()
    }
  }

  /** Connects; for SFTP the first contact's challenge is approved through the trust store. */
  private suspend fun connectTrusting(client: RemoteClient, endpoint: Endpoint, account: Account) {
    val config = endpoint.config(account.user)
    var outcome = client.connect(config, account.password.toCharArray())
    if (outcome is ConnectOutcome.HostKeyApprovalRequired) {
      assertEquals(RemoteProtocol.SFTP, endpoint.protocol)
      assertTrue(outcome.challenge.fingerprint.startsWith("SHA256:"))
      hostKeys.approve(outcome.challenge.challengeId)
      outcome = client.connect(config, account.password.toCharArray())
    }
    assertEquals(ConnectOutcome.Connected, outcome)
  }

  private suspend fun assertListing(client: RemoteClient, endpoint: Endpoint) {
    val top = client.list(endpoint.root).associateBy { it.name }
    assertTrue("the root listing must be non-empty", top.isNotEmpty())
    for (directory in listOf("flat", "nested", "duplicates", "unicode", "timestamps", "non-regular", "scan")) {
      assertEquals("$directory must list as a directory", RemoteEntryType.DIRECTORY, top[directory]?.type)
    }

    val exact = file(client.list(endpoint.path("flat")), "exact.txt")
    assertFixtureFile(endpoint, exact, "exact metadata fixture\n")
    val alpha = client.list(endpoint.path("nested")).single { it.name == "alpha" }
    assertEquals(RemoteEntryType.DIRECTORY, alpha.type)
    val nested = file(client.list(endpoint.path("nested/alpha")), "nested.txt")
    assertFixtureFile(endpoint, nested, "nested metadata fixture\n")

    // The pair S03's match-key collapse relies on: identical size and mtime in different folders.
    val a = file(client.list(endpoint.path("duplicates/a")), "reusable.jpg")
    val b = file(client.list(endpoint.path("duplicates/b")), "reusable.jpg")
    assertFixtureFile(endpoint, a, "reusable duplicate payload\n")
    assertEquals(a.sizeBytes, b.sizeBytes)
    assertEquals(a.modifiedUtcMillis, b.modifiedUtcMillis)

    // Names arrive byte-faithful: neither composition is normalised into the other.
    val unicode = client.list(endpoint.path("unicode"))
    val names = unicode.map { it.name }.toSet()
    assertEquals("both unicode fixtures must be distinct entries: $names", 2, unicode.size)
    assertTrue("composed name missing: $names", COMPOSED_NAME in names)
    assertTrue("decomposed name missing or normalised: $names", DECOMPOSED_NAME in names)
    assertFalse(Normalizer.normalize(COMPOSED_NAME, Normalizer.Form.NFD) in names)
    assertFalse(Normalizer.normalize(DECOMPOSED_NAME, Normalizer.Form.NFC) in names)
    assertFixtureFile(endpoint, file(unicode, COMPOSED_NAME), "composed unicode metadata\n")
    assertFixtureFile(endpoint, file(unicode, DECOMPOSED_NAME), "decomposed unicode metadata\n")

    // Non-regular entries must never read as files (and so never enter matching) or hang.
    val nonRegular = client.list(endpoint.path("non-regular")).associateBy { it.name }
    for (name in listOf("escape-link", "named-pipe")) {
      val entry = nonRegular[name]
      if (endpoint.listsNonRegular) {
        assertEquals("$name must be classified OTHER", RemoteEntryType.OTHER, entry?.type)
      } else {
        assertTrue("$name must be OTHER or omitted, was ${entry?.type}", entry == null || entry.type == RemoteEntryType.OTHER)
      }
    }
    assertTrue(nonRegular.values.none { it.type == RemoteEntryType.REGULAR_FILE })
  }

  /** bucket-start (@…200.000) and bucket-end (@…200.999) must share one precision bucket. */
  private suspend fun assertBucketPair(client: RemoteClient, endpoint: Endpoint, precisionMillis: Long) {
    val timestamps = client.list(endpoint.path("timestamps"))
    val start = file(timestamps, "bucket-start.bin")
    val end = file(timestamps, "bucket-end.bin")
    assertEquals("bucket start".length.toLong(), start.sizeBytes)
    assertEquals("bucket end".length.toLong(), end.sizeBytes)
    val startMillis = requirePresent(start.modifiedUtcMillis)
    val endMillis = requirePresent(end.modifiedUtcMillis)
    assertPlausibleMtime(endpoint, startMillis)
    assertPlausibleMtime(endpoint, endMillis)
    assertEquals(
      "bucket pair split at precision $precisionMillis",
      Math.floorDiv(startMillis, precisionMillis),
      Math.floorDiv(endMillis, precisionMillis),
    )
  }

  private fun assertPrecision(endpoint: Endpoint, precisionMillis: Long, basis: PrecisionBasis) {
    when (endpoint.protocol) {
      RemoteProtocol.WEBDAV -> {
        assertEquals(1000L, precisionMillis)
        assertEquals(PrecisionBasis.RFC1123_WHOLE_SECONDS, basis)
      }
      RemoteProtocol.SFTP -> {
        assertEquals(1000L, precisionMillis)
        assertEquals(PrecisionBasis.SFTP_V3_WHOLE_SECONDS, basis)
      }
      // Whatever vsftpd empirically yields, as long as it came from a real measurement.
      RemoteProtocol.FTP -> {
        assertTrue("FTP precision must be positive", precisionMillis > 0)
        assertNotEquals("the root has sample files", PrecisionBasis.NO_SAMPLE_FILES, basis)
        assertTrue(
          "unexpected FTP basis $basis",
          basis in setOf(
            PrecisionBasis.MDTM_SUBSECOND,
            PrecisionBasis.MDTM_WHOLE_SECONDS,
            PrecisionBasis.MLSD_SUBSECOND,
            PrecisionBasis.MLSD_WHOLE_SECONDS,
            PrecisionBasis.LIST_GRANULARITY,
          ),
        )
      }
    }
  }

  private fun assertFixtureFile(endpoint: Endpoint, entry: RemoteEntry, content: String) {
    assertEquals(RemoteEntryType.REGULAR_FILE, entry.type)
    assertEquals("${entry.name} size", content.toByteArray(Charsets.UTF_8).size.toLong(), entry.sizeBytes)
    assertPlausibleMtime(endpoint, requirePresent(entry.modifiedUtcMillis))
  }

  private fun assertPlausibleMtime(endpoint: Endpoint, millis: Long) {
    assertTrue(
      "mtime $millis is not within ${endpoint.mtimeToleranceMillis}ms of the seeded instant",
      abs(millis - SEEDED_MTIME_MILLIS) <= endpoint.mtimeToleranceMillis,
    )
  }

  private fun file(entries: List<RemoteEntry>, name: String): RemoteEntry {
    val entry = entries.firstOrNull { it.name == name }
    assertNotNull("$name missing from ${entries.map { it.name }}", entry)
    return entry!!
  }

  private fun <T : Any> requirePresent(value: T?): T {
    assertNotNull("value must be present", value as Any?)
    return value!!
  }

  // --- Envelope helpers --------------------------------------------------------------------

  private fun call(invoke: (Promise) -> Unit): ReadableMap {
    val promise = AwaitedPromise()
    invoke(promise)
    val value = promise.await()
    assertNull("module methods must resolve, never reject", promise.rejectedCode)
    assertTrue("expected an envelope map, got $value", value is ReadableMap)
    return value as ReadableMap
  }

  private fun assertOk(result: ReadableMap): ReadableMap {
    val detail = if (result.hasKey("error")) result.getMap("error")?.getString("code") else null
    assertEquals("expected ok, got error $detail", CloudSyncContracts.STATUS_OK, result.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, result.getInt("contractVersion"))
    return result
  }

  private fun assertError(code: CloudSyncErrorCode, result: ReadableMap): ReadableMap {
    assertEquals(CloudSyncContracts.STATUS_ERROR, result.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, result.getInt("contractVersion"))
    val error = result.getMap("error")!!
    assertEquals(code.name, error.getString("code"))
    return error
  }

  private fun assertConnected(endpoint: Endpoint, result: ReadableMap): ReadableMap {
    val connection = assertOk(result).getMap("connection")!!
    assertEquals(endpoint.protocol.name, connection.getString("protocol"))
    assertTrue(connection.getBoolean("reachable"))
    assertTrue("the root must list entries", connection.getInt("entryCount") > 0)
    assertTrue("precision must be persisted", connection.getBoolean("precisionPersisted"))
    return connection
  }

  private fun expectHostKeyChallenge(result: ReadableMap): ReadableMap {
    val error = assertError(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, result)
    val challenge = error.getMap("hostKeyChallenge")
    assertNotNull("the challenge must be attached to the envelope", challenge)
    assertFalse(challenge!!.getString("challengeId").isNullOrBlank())
    return challenge
  }

  private suspend fun trustedRows(endpoint: Endpoint) =
    database.trustedSftpHostKeyDao().forHost(HOST, endpoint.port)

  private fun account(endpoint: Endpoint): Account {
    val arguments = InstrumentationRegistry.getArguments()
    val user = arguments.getString("${endpoint.argumentPrefix}User")
    val password = arguments.getString("${endpoint.argumentPrefix}Password")
    // The message names the argument keys only; values are never printed.
    assertTrue(
      "${endpoint.argumentPrefix}User/${endpoint.argumentPrefix}Password are not set: run this suite " +
        "through `pnpm validation:android:api31` so the live container credentials are bridged",
      !user.isNullOrEmpty() && !password.isNullOrEmpty(),
    )
    return Account(user!!, password!!)
  }

  private class Account(val user: String, val password: String) {
    override fun toString(): String = "Account(redacted)"
  }

  /**
   * The approved container endpoints (scripts/validation/protocol-service.sh), as seen from
   * the emulator. SFTP is not chrooted, so its fixtures sit under the account's home.
   */
  private enum class Endpoint(
    val protocol: RemoteProtocol,
    val port: Int,
    val root: String,
    val argumentPrefix: String,
    /** FTP LIST prints year-form dates (day granularity) for files older than six months. */
    val mtimeToleranceMillis: Long,
    /** mod_dav may leave out entries it cannot stat, such as a dangling symlink. */
    val listsNonRegular: Boolean,
  ) {
    FTP(RemoteProtocol.FTP, 32120, "/", "ftp", DAY_MILLIS, listsNonRegular = true),
    SFTP(RemoteProtocol.SFTP, 32122, "/srv/fixtures", "sftp", 0L, listsNonRegular = true),
    WEBDAV(RemoteProtocol.WEBDAV, 32180, "/webdav", "webdav", 0L, listsNonRegular = false);

    fun path(relative: String): String = if (root.endsWith("/")) "$root$relative" else "$root/$relative"

    fun config(user: String) = RemoteConfig(protocol, HOST, port, user, root)

    fun configMap(user: String): JavaOnlyMap =
      JavaOnlyMap().apply {
        putString("protocol", protocol.name)
        putString("host", HOST)
        putDouble("port", port.toDouble())
        putString("username", user)
        putString("remoteRoot", root)
      }
  }

  /** Records the single settlement of a module call; JS never sees a rejection. */
  private class AwaitedPromise : Promise {
    @Volatile var resolved: Any? = null
    @Volatile var rejectedCode: String? = null
    private val settled = CountDownLatch(1)

    fun await(): Any? {
      check(settled.await(CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)) { "promise never settled" }
      return resolved
    }

    override fun resolve(value: Any?) {
      resolved = value
      settled.countDown()
    }

    private fun rejected(code: String?) {
      rejectedCode = code ?: "rejected"
      settled.countDown()
    }

    override fun reject(code: String?, message: String?) = rejected(code)

    override fun reject(code: String?, throwable: Throwable?) = rejected(code)

    override fun reject(code: String?, message: String?, throwable: Throwable?) = rejected(code)

    override fun reject(throwable: Throwable) = rejected(null)

    override fun reject(throwable: Throwable, userInfo: WritableMap) = rejected(null)

    override fun reject(code: String?, userInfo: WritableMap) = rejected(code)

    override fun reject(code: String?, throwable: Throwable?, userInfo: WritableMap) = rejected(code)

    override fun reject(code: String?, message: String?, userInfo: WritableMap) = rejected(code)

    override fun reject(code: String?, message: String?, throwable: Throwable?, userInfo: WritableMap?) =
      rejected(code)

    @Deprecated("Prefer reject(code, message)")
    override fun reject(message: String) = rejected(null)
  }

  private companion object {
    const val MODULE_NAME = "CloudSync"

    /** The emulator's alias for the host loopback, where the containers publish their ports. */
    const val HOST = "10.0.2.2"

    const val WRONG_SUFFIX = "-wrong"
    const val SEEDED_MTIME_MILLIS = 1_704_067_200_000L
    const val DAY_MILLIS = 86_400_000L

    /** Longer than the clients' 15s connect + 30s socket timeouts, so a hang fails, not stalls. */
    const val CALL_TIMEOUT_SECONDS = 60L
    const val LISTING_TIMEOUT_MS = 60_000L

    const val COMPOSED_NAME = "Grüße_日本_é.txt"
    const val DECOMPOSED_NAME = "é-decomposed.txt"

    @Suppress("DEPRECATION")
    fun encryptedTestPreferences(context: Context) =
      EncryptedSharedPreferences.create(
        context,
        "syncscope_credentials_instrumented_test",
        MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
        EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
        EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
      )
  }
}
