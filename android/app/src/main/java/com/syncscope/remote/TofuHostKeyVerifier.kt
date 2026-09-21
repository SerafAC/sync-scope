package com.syncscope.remote

import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.TrustedSftpHostKeyEntity
import java.security.PublicKey
import java.util.Base64
import net.schmizz.sshj.common.Buffer
import net.schmizz.sshj.common.KeyType
import net.schmizz.sshj.common.SecurityUtils
import net.schmizz.sshj.transport.verification.FingerprintVerifier
import net.schmizz.sshj.transport.verification.HostKeyVerifier

/**
 * Blocking trust-on-first-use host-key verification (R002).
 *
 * The decision is made against [trusted], a snapshot of every key the user approved
 * for this endpoint, so SSHJ's transport thread never touches the database:
 * - presented key equals a trusted key → verified, the connect proceeds;
 * - no key trusted for the endpoint → [CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED];
 * - a different key trusted for the endpoint → [CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED].
 *
 * Both refusals raise a pending challenge in [challenges] and return false, which makes
 * SSHJ abort the key exchange; the caller then reads [rejection]. Nothing is ever
 * trusted without an explicit approve call, and a changed key is never reconnected silently.
 */
class TofuHostKeyVerifier(
  trusted: List<TrustedSftpHostKeyEntity>,
  private val challenges: HostKeyChallengeRegistry,
) : HostKeyVerifier {

  private val trusted = trusted.toList()

  /** Set when [verify] refused the presented key; null after a successful verification. */
  @Volatile
  var rejection: SftpHostKeyException? = null
    private set

  override fun verify(hostname: String, port: Int, key: PublicKey): Boolean {
    val presented = PresentedHostKey.of(key)
    val endpointKeys = trusted.filter { it.matchesEndpoint(hostname, port) }
    if (endpointKeys.any { it.algorithm == presented.algorithm && it.keyBase64 == presented.keyBase64 }) {
      rejection = null
      return true
    }
    val previous =
      endpointKeys.firstOrNull { it.algorithm == presented.algorithm } ?: endpointKeys.firstOrNull()
    val code =
      if (previous == null) CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED
      else CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED
    val challenge = challenges.raise(hostname, port, presented, previous?.fingerprint)
    rejection = SftpHostKeyException(code, challenge)
    return false
  }

  /**
   * The pinned algorithms go first in SSHJ's host-key negotiation, so a server that
   * still holds the approved key is verified against it rather than a different one.
   */
  override fun findExistingAlgorithms(hostname: String, port: Int): List<String> =
    trusted.filter { it.matchesEndpoint(hostname, port) }.map { it.algorithm }.distinct()

  private fun TrustedSftpHostKeyEntity.matchesEndpoint(hostname: String, port: Int): Boolean =
    this.port == port && host == HostKeyChallengeRegistry.normalizeHost(hostname)
}

/** A host key presented by a server, in the form it is persisted and shown. */
data class PresentedHostKey(
  val algorithm: String,
  /** Base64 of the SSH wire encoding, the same blob as the second field of `ssh-keyscan`. */
  val keyBase64: String,
  val fingerprint: String,
) {
  companion object {
    fun of(key: PublicKey): PresentedHostKey =
      PresentedHostKey(
        algorithm = KeyType.fromKey(key).toString(),
        keyBase64 = Base64.getEncoder().encodeToString(SshFingerprints.wireBlob(key)),
        fingerprint = SshFingerprints.sha256(key),
      )
  }
}

/**
 * OpenSSH-compatible fingerprints. The key blob comes from SSHJ's own wire encoder,
 * and every SHA256 string is checked against SSHJ's [FingerprintVerifier] before it is
 * shown, so the prompt matches `ssh-keygen -l` / `ssh-keyscan` output byte for byte.
 */
object SshFingerprints {
  private const val SHA256_PREFIX = "SHA256:"

  fun wireBlob(key: PublicKey): ByteArray = Buffer.PlainBuffer().putPublicKey(key).compactData

  /** `SHA256:<unpadded base64>`, the OpenSSH default since 6.8. */
  fun sha256(key: PublicKey): String {
    val digest = SecurityUtils.getMessageDigest("SHA-256").digest(wireBlob(key))
    val fingerprint = SHA256_PREFIX + Base64.getEncoder().withoutPadding().encodeToString(digest)
    check(FingerprintVerifier.getInstance(fingerprint).verify("", 0, key)) {
      "SHA256 fingerprint disagrees with SSHJ's verifier"
    }
    return fingerprint
  }

  /** Legacy `MD5:aa:bb:…` form (`ssh-keygen -E md5`), for servers documented that way. */
  fun md5(key: PublicKey): String = "MD5:" + SecurityUtils.getFingerprint(key)
}

/**
 * A pending blocking TOFU question. [host] and [port] are the endpoint the user typed;
 * they are carried as structured fields so the user can compare the prompt with
 * `ssh-keyscan`, and are never embedded in a message.
 */
data class HostKeyChallenge(
  val challengeId: String,
  val host: String,
  val port: Int,
  val algorithm: String,
  val keyBase64: String,
  val fingerprint: String,
  val previousFingerprint: String?,
  val raisedAtMillis: Long,
)

/** A refused host key; always carries the [challenge] the user must answer. */
class SftpHostKeyException(code: CloudSyncErrorCode, val challenge: HostKeyChallenge) :
  RemoteClientException(
    code,
    if (code == CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED) {
      "The SFTP server presented a different host key than the one you approved. " +
        "This can mean the connection is being intercepted."
    } else {
      "The SFTP server's host key has not been approved yet."
    },
    if (code == CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED) {
      "Confirm with the server's administrator that the key changed, then approve the new fingerprint."
    } else {
      "Compare the fingerprint with the server's key, then approve or reject it."
    },
  ) {
  init {
    require(
      code == CloudSyncErrorCode.SFTP_HOST_KEY_UNVERIFIED || code == CloudSyncErrorCode.SFTP_HOST_KEY_CHANGED
    ) {
      "not a host-key code: $code"
    }
  }
}
