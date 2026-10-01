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
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.RemoteConfig
import com.syncscope.remote.RemoteProtocol
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * saveRepository / testRepository / getRepositorySummary.
 *
 * Room's `repository_config` holds only protocol, host, port, username, root, precision,
 * and the `credentialVersion` pointer; the password lives in [CredentialStore] and is
 * wiped from memory on every path. v1 has exactly one profile: saving replaces it.
 * Save and test are serialised so a test never races a save of a different endpoint.
 */
class RepositoryOperations(
  private val repositories: () -> RepositoryConfigDao,
  private val credentials: () -> CredentialStore,
  private val hostKeys: () -> HostKeyTrustStore,
  private val clients: () -> RemoteClientFactory,
  private val envelope: CloudSyncEnvelope,
) {
  private val lock = Mutex()

  suspend fun save(config: ReadableMap, transientPassword: String?): WritableMap {
    // A JVM String cannot be wiped; copy it once and drop the reference.
    val password = transientPassword?.toCharArray()
    try {
      val parsed =
        when (val result = parse(config)) {
          is Parsed.Invalid -> return envelope.invalidField(result.field, result.reason)
          is Parsed.Valid -> result.config
        }
      if (password != null && password.isEmpty()) return envelope.invalidField("password", "it is empty")

      return lock.withLock {
        val existing = repositories().get()
        val credentialVersion =
          when {
            password != null -> credentials().store(password)
            // Re-saving the same endpoint (e.g. a new root) may keep the stored password,
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
              remoteRoot = parsed.rootPath,
              precisionMillis = UNKNOWN_PRECISION,
              credentialVersion = credentialVersion,
              revision = (existing?.revision ?: 0L) + 1,
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
        val entries = client.list(config.rootPath)
        val precision = client.discoverPrecision()
        val persisted = repositories().updatePrecision(row.revision, precision.precisionMillis) == 1
        Log.i(
          TAG,
          "testRepository ok: protocol=${config.protocol} entries=${entries.size} " +
            "precisionMillis=${precision.precisionMillis} basis=${precision.basis} persisted=$persisted",
        )
        envelope.ok(
          "connection",
          envelope.map().apply {
            putString("protocol", config.protocol.name)
            putBoolean("reachable", true)
            putInt("entryCount", entries.size)
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
        putString("remoteRoot", row.remoteRoot)
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

  private fun notConfigured(): WritableMap =
    envelope.error(CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED, NOT_CONFIGURED_MESSAGE, NOT_CONFIGURED_ACTION)

  private fun sameAccount(row: RepositoryConfigEntity, config: RemoteConfig): Boolean =
    row.protocol == config.protocol.name &&
      row.host.equals(config.host, ignoreCase = true) &&
      row.port == config.port &&
      row.username == config.username

  private fun RepositoryConfigEntity.protocol(): RemoteProtocol? =
    RemoteProtocol.entries.firstOrNull { it.name == protocol }

  private fun RepositoryConfigEntity.toRemoteConfig(): RemoteConfig? =
    protocol()?.let { RemoteConfig(it, host, port, username, remoteRoot) }

  internal sealed interface Parsed {
    data class Valid(val config: RemoteConfig) : Parsed

    data class Invalid(val field: String, val reason: String) : Parsed
  }

  companion object {
    private const val TAG = "CloudSync"

    const val NOT_CONFIGURED_MESSAGE = "No repository has been set up yet."
    const val NOT_CONFIGURED_ACTION = "Enter the server details on the Connect screen."
    const val CREDENTIAL_UNAVAILABLE_MESSAGE = "The saved password is no longer available."
    const val CREDENTIAL_UNAVAILABLE_ACTION = "Enter the password and save the repository again."

    /** Stored until testRepository discovers the real value; reported to JS as null. */
    const val UNKNOWN_PRECISION = 0L

    private const val MAX_HOST = 253
    private const val MAX_USERNAME = 256
    private const val MAX_ROOT = 1024
    private val HOST_FORBIDDEN = Regex("""[\s/\\@?#]""")
    private val CONTROL = Regex("""\p{Cntrl}""")

    private fun defaultPort(protocol: RemoteProtocol): Int =
      when (protocol) {
        RemoteProtocol.FTP -> 21
        RemoteProtocol.SFTP -> 22
        RemoteProtocol.WEBDAV -> 80
      }

    /** Validates the JS config object. Rejections name the field and never echo the value. */
    internal fun parse(map: ReadableMap): Parsed {
      val protocol =
        map.string("protocol")?.trim()?.uppercase()?.let { name ->
          RemoteProtocol.entries.firstOrNull { it.name == name }
        } ?: return Parsed.Invalid("protocol", "it must be FTP, SFTP, or WEBDAV")

      val host = map.string("host")?.trim()
      if (host.isNullOrEmpty()) return Parsed.Invalid("host", "it is required")
      if (host.length > MAX_HOST || HOST_FORBIDDEN.containsMatchIn(host) || CONTROL.containsMatchIn(host)) {
        return Parsed.Invalid("host", "use a bare host name or IP address")
      }

      val port =
        when {
          !map.hasKey("port") || map.isNull("port") -> defaultPort(protocol)
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

      val root =
        if (!map.hasKey("remoteRoot") || map.isNull("remoteRoot")) {
          "/"
        } else {
          map.string("remoteRoot")?.trim() ?: return Parsed.Invalid("remoteRoot", "it must be text")
        }
      if (!root.startsWith("/") || root.length > MAX_ROOT || CONTROL.containsMatchIn(root)) {
        return Parsed.Invalid("remoteRoot", "it must be an absolute folder path")
      }
      if (root.split('/').any { it == "." || it == ".." }) {
        return Parsed.Invalid("remoteRoot", "it must not contain relative segments")
      }

      return Parsed.Valid(RemoteConfig(protocol, host, port, username, root))
    }

    private fun ReadableMap.string(key: String): String? =
      if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null
  }
}
