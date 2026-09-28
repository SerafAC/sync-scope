package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import java.net.ConnectException
import java.net.NoRouteToHostException
import java.net.SocketTimeoutException
import java.net.UnknownHostException
import java.security.Security
import java.util.concurrent.TimeoutException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import net.schmizz.sshj.DefaultConfig
import net.schmizz.sshj.SSHClient
import net.schmizz.sshj.sftp.FileAttributes
import net.schmizz.sshj.sftp.FileMode
import net.schmizz.sshj.sftp.RemoteResourceInfo
import net.schmizz.sshj.sftp.Response
import net.schmizz.sshj.sftp.SFTPClient
import net.schmizz.sshj.sftp.SFTPException
import net.schmizz.sshj.userauth.UserAuthException
import org.bouncycastle.jce.provider.BouncyCastleProvider

/**
 * Read-only SFTP [RemoteClient] on SSHJ.
 *
 * Every connect is gated by [TofuHostKeyVerifier]: an unapproved key ends the attempt with
 * [ConnectOutcome.HostKeyApprovalRequired], and a changed key throws [SftpHostKeyException]
 * with [CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED]. Listing uses OPENDIR/READDIR only; this
 * class never opens a remote file handle in any mode, which protocol-audit.sh enforces (R026).
 */
class SftpRemoteClient(
  private val hostKeys: HostKeyTrustStore,
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO,
  private val clientFactory: () -> SSHClient = { SSHClient(DefaultConfig()) },
) : RemoteClient {

  @Volatile private var ssh: SSHClient? = null
  @Volatile private var sftp: SFTPClient? = null

  override suspend fun connect(config: RemoteConfig, password: CharArray): ConnectOutcome =
    withContext(dispatcher) {
      require(config.protocol == RemoteProtocol.SFTP) { "SftpRemoteClient cannot serve ${config.protocol}" }
      close()
      SshSecurity.ensureBouncyCastle()
      val verifier = hostKeys.verifierFor(config.host, config.port)
      val client =
        clientFactory().apply {
          connectTimeout = CONNECT_TIMEOUT_MS
          timeout = SOCKET_TIMEOUT_MS
          addHostKeyVerifier(verifier)
        }
      try {
        try {
          client.connect(config.host, config.port)
        } catch (e: Exception) {
          if (e is CancellationException) throw e
          // SSHJ reports a refused key as a generic transport failure; the verifier knows why.
          val refusal = verifier.rejection ?: throw SftpFailures.map(e)
          if (refusal.code == CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED) {
            disconnectQuietly(client)
            return@withContext ConnectOutcome.HostKeyApprovalRequired(refusal.challenge)
          }
          throw refusal
        }
        guarded {
          // SSHJ blanks the array it is given, so it gets a copy; the caller owns [password].
          client.authPassword(config.username, password.copyOf())
          sftp = client.newSFTPClient()
        }
      } catch (t: Throwable) {
        // Includes cancellation: a half-open transport must never outlive the attempt.
        sftp = null
        disconnectQuietly(client)
        throw t
      }
      ssh = client
      ConnectOutcome.Connected
    }

  override suspend fun list(directory: String): List<RemoteEntry> =
    withContext(dispatcher) {
      val client = session()
      guarded { client.ls(directory) }.mapNotNull(SftpListing::toEntry)
    }

  /**
   * SSHJ negotiates SFTP v3, whose ATTRS carry mtime as a uint32 of whole seconds, so no
   * listing can deliver anything finer. The basis names the negotiated protocol rather
   * than an assumption about the server's filesystem.
   */
  override suspend fun discoverPrecision(): PrecisionFinding =
    withContext(dispatcher) { SftpPrecision.forProtocolVersion(session().version()) }

  override fun close() {
    val client = ssh
    val channel = sftp
    ssh = null
    sftp = null
    try {
      channel?.close()
    } catch (_: Exception) {
      // The session is being torn down; a failed channel close changes nothing.
    }
    client?.let(::disconnectQuietly)
  }

  private fun session(): SFTPClient =
    sftp?.takeIf { ssh?.isConnected == true }
      ?: throw RemoteClientException(
        CloudSyncErrorCode.CONNECTION_LOST,
        "The SFTP session is not connected.",
        "Reconnect the repository.",
      )

  private inline fun <T> guarded(block: () -> T): T =
    try {
      block()
    } catch (e: CancellationException) {
      throw e
    } catch (e: RemoteClientException) {
      throw e
    } catch (e: Exception) {
      throw SftpFailures.map(e)
    }

  private fun disconnectQuietly(client: SSHClient) {
    try {
      client.disconnect()
    } catch (_: Exception) {
    }
  }

  companion object {
    const val CONNECT_TIMEOUT_MS = 15_000
    const val SOCKET_TIMEOUT_MS = 30_000
  }
}

/** Pure SSHJ-to-[RemoteEntry] mapping. */
internal object SftpListing {
  /** Symlinks are reported by READDIR's lstat attributes and are never followed. */
  fun classify(attributes: FileAttributes): RemoteEntryType {
    if (!attributes.has(FileAttributes.Flag.MODE)) return RemoteEntryType.OTHER
    return when (attributes.type) {
      FileMode.Type.REGULAR -> RemoteEntryType.REGULAR_FILE
      FileMode.Type.DIRECTORY -> RemoteEntryType.DIRECTORY
      else -> RemoteEntryType.OTHER
    }
  }

  /** Null for "." and ".."; an absent size is -1 and an absent mtime is null. */
  fun toEntry(info: RemoteResourceInfo): RemoteEntry? {
    val name = info.name ?: return null
    if (name.isEmpty() || name == "." || name == "..") return null
    val attributes = info.attributes
    return RemoteEntry(
      name = name,
      sizeBytes = if (attributes.has(FileAttributes.Flag.SIZE)) attributes.size else -1L,
      modifiedUtcMillis =
        if (attributes.has(FileAttributes.Flag.ACMODTIME)) attributes.mtime * 1_000L else null,
      type = classify(attributes),
    )
  }
}

internal object SftpPrecision {
  /** SSHJ's ATTRS decoder is the v3 one for every version it can negotiate. */
  fun forProtocolVersion(@Suppress("UNUSED_PARAMETER") version: Int): PrecisionFinding =
    PrecisionFinding(1_000L, PrecisionBasis.SFTP_V3_WHOLE_SECONDS)
}

internal object SftpFailures {
  private val UNREADABLE =
    setOf(
      Response.StatusCode.PERMISSION_DENIED,
      Response.StatusCode.NO_SUCH_FILE,
      Response.StatusCode.NO_SUCH_PATH,
      Response.StatusCode.NOT_A_DIRECTORY,
    )

  /**
   * Maps an SSHJ or socket failure onto a stable code. The original exception is kept
   * only as the cause; its text (which can name the host or path) never becomes the message.
   */
  fun map(e: Throwable): RemoteClientException {
    if (e is RemoteClientException) return e
    val chain = generateSequence(e) { it.cause.takeIf { cause -> cause !== it } }.take(8).toList()
    if (e is SFTPException) {
      val status = e.statusCode
      val code =
        if (status in UNREADABLE) CloudSyncErrorCode.DIRECTORY_UNREADABLE else CloudSyncErrorCode.CONNECTION_LOST
      return failure(code, status?.code, e)
    }
    val code =
      when {
        chain.any { it is UserAuthException } -> CloudSyncErrorCode.AUTH_FAILED
        chain.any { it is SocketTimeoutException || it is TimeoutException } ->
          CloudSyncErrorCode.CONNECTION_TIMEOUT
        chain.any { it is ConnectException || it is NoRouteToHostException || it is UnknownHostException } ->
          CloudSyncErrorCode.CONNECTION_REFUSED
        else -> CloudSyncErrorCode.CONNECTION_LOST
      }
    return failure(code, null, e)
  }

  fun failure(code: CloudSyncErrorCode, statusCode: Int? = null, cause: Throwable? = null): RemoteClientException {
    val (message, action) =
      when (code) {
        CloudSyncErrorCode.AUTH_FAILED ->
          "The SFTP server rejected the username or password." to "Check the credentials and try again."
        CloudSyncErrorCode.CONNECTION_REFUSED ->
          "The SFTP server could not be reached or refused the connection." to
            "Check the host and port, and that the server is running."
        CloudSyncErrorCode.CONNECTION_TIMEOUT ->
          "The SFTP server did not respond in time." to "Check the network and try again."
        CloudSyncErrorCode.DIRECTORY_UNREADABLE ->
          "The SFTP server refused to list a directory." to
            "Check that the account may list the configured folder."
        else -> "The SFTP connection was lost." to "Reconnect the repository."
      }
    return RemoteClientException(code, message, action, statusCode, cause)
  }
}

/**
 * Android registers a stripped-down platform provider under the name "BC" that lacks the
 * Ed25519/X25519 support SSHJ asks "BC" for. It is replaced once by the bundled full
 * provider; it is appended rather than preferred, so other JCA lookups are unaffected.
 */
internal object SshSecurity {
  @Volatile private var installed = false

  fun ensureBouncyCastle() {
    if (installed) return
    synchronized(this) {
      if (installed) return
      if (Security.getProvider(BouncyCastleProvider.PROVIDER_NAME) !is BouncyCastleProvider) {
        Security.removeProvider(BouncyCastleProvider.PROVIDER_NAME)
        Security.addProvider(BouncyCastleProvider())
      }
      installed = true
    }
  }
}
