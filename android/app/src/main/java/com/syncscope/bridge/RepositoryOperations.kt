package com.syncscope.bridge

import android.util.Log
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableMap
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigDao
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.remote.ConnectOutcome
import com.syncscope.remote.HostKeyTrustStore
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteEntryType
import com.syncscope.remote.RemoteProtocol
import com.syncscope.remote.RemoteRoots
import com.syncscope.remote.SftpHostKeyException
import com.syncscope.scan.BusyState
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * saveRepository / testRepository / getRepositorySummary / browseRemoteFolders.
 *
 * The repository holds one or more remote folders (`remoteRoots`, research R11), validated by
 * [RemoteRoots]; the connection test lists each of them on one connection (research R12).
 *
 * Room's `repository_config` holds only protocol, host, port, username, the folders, `webdavHttps`,
 * precision, and the `credentialVersion` pointer; the password lives in [CredentialStore] and is
 * wiped from memory on every path. v1 has exactly one profile: saving replaces it.
 * Save, test and browse are serialised so a test never races a save of a different endpoint.
 * A save or a browse is refused while [busy] reports a scan or a deletion (research R3, FR-011), so the
 * configuration a run reads never changes under it.
 */
class RepositoryOperations(
  private val repositories: () -> RepositoryConfigDao,
  private val credentials: () -> CredentialStore,
  private val hostKeys: () -> HostKeyTrustStore,
  private val clients: () -> RemoteClientFactory,
  private val envelope: CloudSyncEnvelope,
  /** The scan coordinator's state; [BusyState.NONE] where no coordinator exists (the debug seam). */
  private val busy: () -> BusyState,
) {
  private val lock = Mutex()

  suspend fun save(config: ReadableMap, transientPassword: String?): WritableMap {
    // A JVM String cannot be wiped; copy it once and drop the reference.
    val password = transientPassword?.toCharArray()
    try {
      val parsed =
        when (val result = parse(config)) {
          is Parsed.Invalid -> return envelope.invalidField(result.field, result.reason, result.fieldIndex)
          is Parsed.InvalidFolder -> return envelope.remoteRootsError(result.fieldIndex, result.message)
          is Parsed.Valid -> result.config
        }
      if (password != null && password.isEmpty()) return envelope.invalidField("password", "it is empty")

      return lock.withLock {
        busyRefusal()?.let { return@withLock it }
        val existing = repositories().get()
        val credentialVersion =
          when {
            password != null -> credentials().store(password)
            // Re-saving the same endpoint (e.g. new folders) may keep the stored password,
            // but a password is never carried over to a different server or account.
            existing != null && sameAccount(existing, parsed) &&
              credentials().isCurrent(existing.credentialVersion) -> existing.credentialVersion
            else -> return@withLock envelope.invalidField("password", "a password is required for this server")
          }
        repositories()
          .put(
            RepositoryConfigEntity(
              protocol = parsed.protocol.name,
              host = parsed.host,
              port = parsed.port,
              username = parsed.username,
              remoteRoots = RemoteRoots.encode(parsed.rootPaths),
              precisionMillis = UNKNOWN_PRECISION,
              credentialVersion = credentialVersion,
              revision = (existing?.revision ?: 0L) + 1,
              webdavHttps = parsed.webdavHttps,
            ),
          )
        Log.i(TAG, "repository saved: protocol=${parsed.protocol} credentialVersion=$credentialVersion")
        envelope.ok()
      }
    } finally {
      password?.fill('\u0000')
    }
  }

  suspend fun test(): WritableMap =
    lock.withLock {
      val row = repositories().get() ?: return@withLock notConfigured()
      val config = row.toRemoteConfig() ?: return@withLock notConfigured()
      val password =
        credentials().load(row.credentialVersion)
          ?: return@withLock envelope.error(
            CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE,
            CREDENTIAL_UNAVAILABLE_MESSAGE,
            CREDENTIAL_UNAVAILABLE_ACTION,
          )
      val client = clients().create(config.protocol)
      try {
        when (val outcome = client.connect(config, password)) {
          is ConnectOutcome.HostKeyApprovalRequired -> {
            Log.i(TAG, "testRepository: SFTP host key awaiting approval")
            return@withLock envelope.hostKeyApprovalRequired(outcome.challenge)
          }
          ConnectOutcome.Connected -> Unit
        }
        // Each folder on the same connection; a folder that cannot be listed is reported on its own line
        // and does not fail the test (research R12). Only connect, login and host-key failures do.
        val folders =
          config.rootPaths.map { path ->
            try {
              FolderOutcome(path, client.list(path).size, null)
            } catch (e: RemoteClientException) {
              Log.w(TAG, "testRepository: a folder failed code=${e.code} reply=${e.replyCode}")
              FolderOutcome(path, null, e)
            }
          }
        val entryCount = folders.sumOf { it.entryCount ?: 0 }
        val precision = client.discoverPrecision()
        val persisted = repositories().updatePrecision(row.revision, precision.precisionMillis) == 1
        Log.i(
          TAG,
          "testRepository ok: protocol=${config.protocol} folders=${folders.size} " +
            "unread=${folders.count { it.failure != null }} entries=$entryCount " +
            "precisionMillis=${precision.precisionMillis} basis=${precision.basis} persisted=$persisted",
        )
        val folderLines = envelope.emptyArray()
        for (folder in folders) {
          folderLines.pushMap(envelope.folderResult(folder.path, folder.entryCount, folder.failure, config.sensitiveValues))
        }
        envelope.ok(
          "connection",
          envelope.map().apply {
            putString("protocol", config.protocol.name)
            putBoolean("reachable", true)
            putInt("entryCount", entryCount)
            putArray("folders", folderLines)
            putDouble("precisionMillis", precision.precisionMillis.toDouble())
            putString("precisionBasis", precision.basis.name)
            putBoolean("precisionPersisted", persisted)
          },
        )
      } catch (e: RemoteClientException) {
        Log.w(TAG, "testRepository failed: protocol=${config.protocol} code=${e.code} reply=${e.replyCode}")
        envelope.remoteFailure(e, sensitive = config.sensitiveValues)
      } finally {
        client.close()
        password.fill('\u0000')
      }
    }

  /**
   * `browseRemoteFolders` (research R13): lists the folders directly inside [path] on the server described by
   * the form's [config] draft, which is checked by the same [parse] as save but needs no `remoteRoots`.
   *
   * The [transientPassword] is used when given; otherwise the stored credential, only when the draft is the
   * saved repository's account ([sameAccount]). A blank or missing [path] lists `/`; a path that cannot be
   * used or listed (missing, or refused, which FTP and SFTP cannot tell apart) lists `/` with
   * `fellBackToRoot`. One connection, closed before returning; nothing is written to the repository row,
   * the credential store or the precision.
   */
  suspend fun browse(config: ReadableMap, transientPassword: String?, path: String?): WritableMap {
    val typed = transientPassword?.takeIf { it.isNotEmpty() }?.toCharArray()
    try {
      val draft =
        when (val result = parse(config, requireRoots = false)) {
          is Parsed.Invalid -> return envelope.invalidField(result.field, result.reason, result.fieldIndex)
          is Parsed.InvalidFolder -> return envelope.remoteRootsError(result.fieldIndex, result.message)
          is Parsed.Valid -> result.config
        }
      // Null for a blank path, and for one the save rules would refuse: both list the top.
      val requested = if (path.isNullOrBlank()) null else browsePath(path)
      val target = requested ?: ROOT
      return lock.withLock {
        busyRefusal()?.let { return@withLock it }
        val password =
          typed
            ?: storedPasswordFor(draft)
            ?: return@withLock envelope.error(
              CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE,
              BROWSE_PASSWORD_MESSAGE,
              BROWSE_PASSWORD_ACTION,
            )
        // WebDAV checks the configured folders on connect; `/` stays a candidate so a missing start
        // folder still connects and falls back.
        val remote = draft.copy(rootPaths = if (target == ROOT) listOf(ROOT) else listOf(target, ROOT))
        val client = clients().create(remote.protocol)
        try {
          when (val outcome = client.connect(remote, password)) {
            is ConnectOutcome.HostKeyApprovalRequired -> {
              Log.i(TAG, "browseRemoteFolders: SFTP host key awaiting approval")
              return@withLock envelope.hostKeyApprovalRequired(outcome.challenge)
            }
            ConnectOutcome.Connected -> Unit
          }
          val (shown, entries) =
            try {
              target to client.list(target)
            } catch (e: RemoteClientException) {
              if (target == ROOT || e.code !in FALLBACK_CODES) throw e
              Log.i(TAG, "browseRemoteFolders: start folder unreadable code=${e.code}; listing the top")
              ROOT to client.list(ROOT)
            }
          val folders =
            entries
              .filter { it.type == RemoteEntryType.DIRECTORY }
              .map { it.name }
              .sortedWith(String.CASE_INSENSITIVE_ORDER.then(naturalOrder()))
          Log.i(TAG, "browseRemoteFolders ok: protocol=${remote.protocol} folders=${folders.size}")
          envelope.ok(
            "remoteFolders",
            envelope.map().apply {
              putString("path", shown)
              if (shown == ROOT) putNull("parent") else putString("parent", parentOf(shown))
              putArray("folders", envelope.emptyArray().apply { folders.forEach(::pushString) })
              putBoolean("fellBackToRoot", !path.isNullOrBlank() && shown != requested)
            },
          )
        } catch (e: RemoteClientException) {
          Log.w(TAG, "browseRemoteFolders failed: protocol=${remote.protocol} code=${e.code} reply=${e.replyCode}")
          envelope.remoteFailure(e, sensitive = remote.sensitiveValues)
        } finally {
          client.close()
          password.fill('\u0000')
        }
      }
    } finally {
      typed?.fill('\u0000')
    }
  }

  /** The saved password, when [draft] is the saved repository's account and the password is still there. */
  private suspend fun storedPasswordFor(draft: RemoteConfig): CharArray? {
    val row = repositories().get() ?: return null
    return if (sameAccount(row, draft)) credentials().load(row.credentialVersion) else null
  }

  suspend fun summary(): WritableMap {
    val row = repositories().get() ?: return notConfigured()
    val protocol = row.protocol()
    val trusted = if (protocol == RemoteProtocol.SFTP) hostKeys().isTrusted(row.host, row.port) else null
    return envelope.ok(
      "repository",
      envelope.map().apply {
        putString("protocol", row.protocol)
        putString("host", row.host)
        putInt("port", row.port)
        putString("username", row.username)
        putArray("remoteRoots", envelope.emptyArray().apply { RemoteRoots.decode(row.remoteRoots).forEach(::pushString) })
        putBoolean("webdavHttps", row.webdavHttps)
        putDouble("revision", row.revision.toDouble())
        if (row.precisionMillis > UNKNOWN_PRECISION) {
          putDouble("precisionMillis", row.precisionMillis.toDouble())
        } else {
          putNull("precisionMillis")
        }
        // A presence flag only: the password itself never crosses the bridge.
        putBoolean("credentialPresent", credentials().isCurrent(row.credentialVersion))
        if (trusted == null) putNull("hostKeyTrusted") else putBoolean("hostKeyTrusted", trusted)
      },
    )
  }

  private fun busyRefusal(): WritableMap? =
    when (busy()) {
      BusyState.NONE -> null
      BusyState.SCAN -> envelope.sourceError(CloudSyncErrorCode.SCAN_IN_PROGRESS)
      BusyState.DELETION -> envelope.sourceError(CloudSyncErrorCode.DELETION_IN_PROGRESS)
    }

  private fun notConfigured(): WritableMap =
    envelope.error(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE, NOT_CONFIGURED_ACTION)

  private fun sameAccount(row: RepositoryConfigEntity, config: RemoteConfig): Boolean =
    row.protocol == config.protocol.name &&
      row.host.equals(config.host, ignoreCase = true) &&
      row.port == config.port &&
      row.username == config.username

  /** One configured folder's line in the connection test. */
  private class FolderOutcome(val path: String, val entryCount: Int?, val failure: RemoteClientException?)

  internal sealed interface Parsed {
    data class Valid(val config: RemoteConfig) : Parsed

    /** [fieldIndex] names the element of a list field (`remoteRoots`), when the problem is one element. */
    data class Invalid(val field: String, val reason: String, val fieldIndex: Int? = null) : Parsed

    /** A `remoteRoots` rule from [RemoteRoots.validate], with the save table's text. */
    data class InvalidFolder(val fieldIndex: Int, val message: String) : Parsed
  }

  companion object {
    private const val TAG = "CloudSync"

    const val NOT_CONFIGURED_MESSAGE = "No repository has been set up yet."
    const val NOT_CONFIGURED_ACTION = "Set up your server in Settings › Repository."
    const val CREDENTIAL_UNAVAILABLE_MESSAGE = "The saved password is no longer available."
    const val CREDENTIAL_UNAVAILABLE_ACTION = "Enter the password again in Settings › Repository."

    const val BROWSE_PASSWORD_MESSAGE = "A password is needed to browse this server."
    const val BROWSE_PASSWORD_ACTION = "Enter the password to browse the server."

    private const val ROOT = "/"

    /** A start folder that is missing or refused: the browser shows the top instead (Story 3 sc. 11). */
    private val FALLBACK_CODES = setOf(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, CloudSyncErrorCode.DIRECTORY_UNREADABLE)

    /** [path] normalized by the folder rules ([RemoteRoots]); null when those rules refuse it. */
    private fun browsePath(path: String): String? =
      when (val result = RemoteRoots.validate(listOf(path))) {
        is RemoteRoots.Validation.Valid -> result.roots.single()
        is RemoteRoots.Validation.Invalid -> null
      }

    private fun parentOf(path: String): String = path.substringBeforeLast('/').ifEmpty { ROOT }

    /** Stored until testRepository discovers the real value; reported to JS as null. */
    const val UNKNOWN_PRECISION = 0L

    private const val MAX_HOST = 253
    private const val MAX_USERNAME = 256
    private val HOST_FORBIDDEN = Regex("""[\s/\\@?#]""")
    private val CONTROL = Regex("""\p{Cntrl}""")

    /** The port used when none is given; [https] matters for WebDAV only (research R2, R4). */
    internal fun defaultPort(protocol: RemoteProtocol, https: Boolean): Int =
      when (protocol) {
        RemoteProtocol.FTP -> RepositoryDefaultPorts.FTP
        RemoteProtocol.SFTP -> RepositoryDefaultPorts.SFTP
        RemoteProtocol.WEBDAV -> if (https) RepositoryDefaultPorts.WEBDAV_HTTPS else RepositoryDefaultPorts.WEBDAV
      }

    /**
     * Validates the JS config object. Rejections name the field and never echo the value. Without
     * [requireRoots] (the folder browser) `remoteRoots` is ignored and the config holds `/`.
     */
    internal fun parse(map: ReadableMap, requireRoots: Boolean = true): Parsed {
      val protocol =
        map.string("protocol")?.trim()?.uppercase()?.let { name ->
          RemoteProtocol.entries.firstOrNull { it.name == name }
        } ?: return Parsed.Invalid("protocol", "it must be FTP, SFTP, or WEBDAV")

      // Absent means plain HTTP, so existing callers (the D018 seam) keep working; ignored unless WebDAV.
      val webdavHttps =
        when {
          !map.hasKey("webdavHttps") || map.isNull("webdavHttps") -> false
          map.getType("webdavHttps") != ReadableType.Boolean ->
            return Parsed.Invalid("webdavHttps", "it must be true or false")
          else -> protocol == RemoteProtocol.WEBDAV && map.getBoolean("webdavHttps")
        }

      val host = map.string("host")?.trim()
      if (host.isNullOrEmpty()) return Parsed.Invalid("host", "it is required")
      if (host.length > MAX_HOST || HOST_FORBIDDEN.containsMatchIn(host) || CONTROL.containsMatchIn(host)) {
        return Parsed.Invalid("host", "use a bare host name or IP address")
      }

      val port =
        when {
          !map.hasKey("port") || map.isNull("port") -> defaultPort(protocol, webdavHttps)
          map.getType("port") != ReadableType.Number -> return Parsed.Invalid("port", "it must be a number")
          else -> {
            val raw = map.getDouble("port")
            if (raw != Math.floor(raw) || raw < 1 || raw > 65535) {
              return Parsed.Invalid("port", "it must be a whole number from 1 to 65535")
            }
            raw.toInt()
          }
        }

      val username = map.string("username")
      if (username.isNullOrBlank()) return Parsed.Invalid("username", "it is required")
      if (username.length > MAX_USERNAME || CONTROL.containsMatchIn(username)) {
        return Parsed.Invalid("username", "it contains unsupported characters")
      }

      // The browser's draft may hold no folder, or folders still being typed: they are not its concern.
      if (!requireRoots) return Parsed.Valid(RemoteConfig(protocol, host, port, username, listOf("/"), webdavHttps))

      // Absent is an empty list: at least one folder is required (contract version 6).
      val given =
        when {
          !map.hasKey(REMOTE_ROOTS) || map.isNull(REMOTE_ROOTS) -> emptyList()
          map.getType(REMOTE_ROOTS) != ReadableType.Array -> return Parsed.Invalid(REMOTE_ROOTS, "it must be a list of folders")
          else -> {
            val array = requireNotNull(map.getArray(REMOTE_ROOTS))
            (0 until array.size()).map { i ->
              if (array.getType(i) != ReadableType.String) return Parsed.Invalid(REMOTE_ROOTS, "every folder must be text", i)
              array.getString(i) ?: ""
            }
          }
        }
      val roots =
        when (val folders = RemoteRoots.validate(given)) {
          is RemoteRoots.Validation.Invalid -> return Parsed.InvalidFolder(folders.fieldIndex, folders.message)
          is RemoteRoots.Validation.Valid -> folders.roots
        }

      return Parsed.Valid(RemoteConfig(protocol, host, port, username, roots, webdavHttps))
    }

    private const val REMOTE_ROOTS = CloudSyncEnvelope.REMOTE_ROOTS_FIELD

    private fun ReadableMap.string(key: String): String? =
      if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null
  }
}

internal fun RepositoryConfigEntity.protocol(): RemoteProtocol? = RemoteProtocol.entries.firstOrNull { it.name == protocol }

/** The non-secret connection parameters of the saved repository; null for an unknown protocol. */
internal fun RepositoryConfigEntity.toRemoteConfig(): RemoteConfig? =
  protocol()?.let { RemoteConfig(it, host, port, username, RemoteRoots.decode(remoteRoots), webdavHttps) }

/**
 * A fresh, authenticated client for the saved repository, shared by the scan and the pre-delete re-check
 * (Principle III). [onCreated] sees the client before it connects, so an owner can cancel it.
 *
 * The password is loaded from [credentials] for [credentialVersion] and wiped straight after `connect`.
 * Throws [RemoteClientException]: `CREDENTIAL_UNAVAILABLE` when the password cannot be loaded, the
 * client's code when `connect` fails, and an [SftpHostKeyException] (`SFTP_HOST_KEY_UNVERIFIED`) when an
 * SFTP key awaits approval. The client is closed on every failure.
 */
internal suspend fun connectRepository(
  clients: RemoteClientFactory,
  credentials: CredentialStore,
  config: RemoteConfig,
  credentialVersion: Long,
  onCreated: (RemoteClient) -> Unit = {},
): RemoteClient {
  val client = clients.create(config.protocol)
  onCreated(client)
  val password = credentials.load(credentialVersion)
  if (password == null) {
    client.close()
    throw RemoteClientException(
      CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE,
      RepositoryOperations.CREDENTIAL_UNAVAILABLE_MESSAGE,
      RepositoryOperations.CREDENTIAL_UNAVAILABLE_ACTION,
    )
  }
  try {
    when (val outcome = client.connect(config, password)) {
      ConnectOutcome.Connected -> return client
      is ConnectOutcome.HostKeyApprovalRequired ->
        throw SftpHostKeyException(CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED, outcome.challenge)
    }
  } catch (t: Throwable) {
    client.close()
    throw t
  } finally {
    password.fill('\u0000')
  }
}
