package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode

/**
 * Read-only listing contract shared by the FTP, SFTP, and WebDAV clients.
 *
 * The contract deliberately exposes names, sizes, timestamps, and types only.
 * There is no way to obtain remote file content through it (R026):
 * scripts/validation/protocol-audit.sh fails the build if the protocol log
 * shows a content fetch, so implementations must never add one either.
 *
 * Implementations run blocking I/O off the caller's thread and report every
 * failure as a [RemoteClientException] whose message is safe to show to the user.
 */
interface RemoteClient {
  /** Opens and authenticates a session. The caller owns [password] and may wipe it afterwards. */
  suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome

  /** Lists the direct children of [directory]; "." and ".." are never returned. */
  suspend fun list(directory: String): List<RemoteEntry>

  /** Measures the timestamp precision this server actually delivers. */
  suspend fun discoverPrecision(): PrecisionFinding

  /** Closes the session; safe to call repeatedly and on a never-connected client. */
  fun close()
}

enum class RemoteProtocol { FTP, SFTP, WEBDAV }

/** Non-secret connection parameters; the password is passed separately and never stored here. */
data class RemoteConfig(
  val protocol: RemoteProtocol,
  val host: String,
  val port: Int,
  val username: String,
  /**
   * The repository's remote folders, normalized, in the user's order (research R11). The first one is
   * where precision discovery samples.
   */
  val rootPaths: List<String> = listOf("/"),
  /** WebDAV only: connect over HTTPS instead of plain HTTP (research R4). */
  val webdavHttps: Boolean = false,
) {
  /** Values that must be scrubbed from anything that crosses the bridge: host, user and every folder. */
  val sensitiveValues: List<String>
    get() = (listOf(host, username) + rootPaths).filter { it.length > 1 }

  override fun toString(): String = "RemoteConfig(protocol=$protocol, port=$port)"
}

sealed interface ConnectOutcome {
  /** The session is open and authenticated. */
  data object Connected : ConnectOutcome

  /**
   * SFTP only: the server key is not yet trusted. The session was torn down; the user
   * must answer [challenge] via approve/reject before a reconnect can succeed.
   */
  data class HostKeyApprovalRequired(val challenge: HostKeyChallenge) : ConnectOutcome
}

enum class RemoteEntryType {
  REGULAR_FILE,
  DIRECTORY,

  /** Symlinks, FIFOs, devices, and anything unrecognised. Never followed. */
  OTHER,
}

data class RemoteEntry(
  val name: String,
  val sizeBytes: Long,
  val modifiedUtcMillis: Long?,
  val type: RemoteEntryType,
)

/** How a [PrecisionFinding] was derived, so a weak comparison basis stays visible (R004). */
enum class PrecisionBasis {
  /** MDTM returned a fractional-second timestamp. */
  MDTM_SUBSECOND,

  /** MDTM is advertised but every sampled reply carried whole seconds. */
  MDTM_WHOLE_SECONDS,

  /** MLSD `modify` fact carried a fractional-second timestamp. */
  MLSD_SUBSECOND,

  /** MLSD `modify` fact carried whole seconds. */
  MLSD_WHOLE_SECONDS,

  /** Only the LIST output was usable; granularity is whatever the dialect prints (minute floor). */
  LIST_GRANULARITY,

  /** There was no regular file to sample; the conservative LIST floor is assumed. */
  NO_SAMPLE_FILES,

  /** SFTP protocol v3 (the only version SSHJ negotiates) carries mtime as whole seconds. */
  SFTP_V3_WHOLE_SECONDS,

  /**
   * WebDAV `DAV:getlastmodified` is an rfc1123-date (RFC 4918 §15.7), which has no
   * sub-second field. This is structural, not a server quirk.
   */
  RFC1123_WHOLE_SECONDS,
}

data class PrecisionFinding(val precisionMillis: Long, val basis: PrecisionBasis)

/**
 * A remote failure with a stable [code] and a message that contains no host,
 * username, password, or path. [replyCode] is the numeric protocol reply when
 * one was received (safe to log; it carries no server text).
 */
open class RemoteClientException(
  val code: CloudSyncErrorCode,
  message: String,
  val action: String?,
  val replyCode: Int? = null,
  cause: Throwable? = null,
) : Exception(message, cause)
