package com.syncscope.remote

import android.content.Context
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.TrustedSftpHostKeyDao
import com.syncscope.persistence.TrustedSftpHostKeyEntity
import java.util.Locale
import java.util.UUID

/**
 * In-memory pending TOFU challenges, keyed by an unguessable challengeId.
 *
 * Challenges live only as long as the process: after a restart the reconnect simply
 * raises a new one. The registry is bounded ([MAX_PENDING], [TTL_MILLIS]) and keeps
 * only the newest challenge per endpoint, so a reconnect loop cannot grow it.
 */
class HostKeyChallengeRegistry(
  private val clock: () -> Long = System::currentTimeMillis,
  private val newId: () -> String = { UUID.randomUUID().toString() },
) {
  private val pending = LinkedHashMap<String, HostKeyChallenge>()

  @Synchronized
  fun raise(host: String, port: Int, presented: PresentedHostKey, previousFingerprint: String?): HostKeyChallenge {
    val now = clock()
    val challenge =
      HostKeyChallenge(
        challengeId = newId(),
        host = normalizeHost(host),
        port = port,
        algorithm = presented.algorithm,
        keyBase64 = presented.keyBase64,
        fingerprint = presented.fingerprint,
        previousFingerprint = previousFingerprint,
        raisedAtMillis = now,
      )
    expire(now)
    pending.values.removeAll { it.host == challenge.host && it.port == port }
    while (pending.size >= MAX_PENDING) {
      pending.remove(pending.keys.first())
    }
    pending[challenge.challengeId] = challenge
    return challenge
  }

  /** Removes and returns the challenge; null when unknown, expired, or already answered. */
  @Synchronized
  fun consume(challengeId: String): HostKeyChallenge? {
    expire(clock())
    return pending.remove(challengeId)
  }

  @Synchronized fun pendingCount(): Int = pending.size

  private fun expire(now: Long) {
    pending.values.removeAll { now - it.raisedAtMillis > TTL_MILLIS }
  }

  companion object {
    const val MAX_PENDING = 16
    const val TTL_MILLIS = 15 * 60_000L

    /** Hostnames are case-insensitive; stored and compared lower-cased. */
    fun normalizeHost(host: String): String = host.trim().lowercase(Locale.ROOT)
  }
}

/**
 * Joins the persisted approvals in `trusted_sftp_host_key` with the pending challenges.
 * One process-wide instance ([shared]) is used so a challenge raised by an SFTP connect
 * can be answered through the CloudSync module.
 */
class HostKeyTrustStore(
  private val dao: TrustedSftpHostKeyDao,
  val challenges: HostKeyChallengeRegistry = HostKeyChallengeRegistry(),
  private val clock: () -> Long = System::currentTimeMillis,
) {
  /** Loads the endpoint's trusted keys up front; the verifier itself does no I/O. */
  suspend fun verifierFor(host: String, port: Int): TofuHostKeyVerifier =
    TofuHostKeyVerifier(dao.forHost(HostKeyChallengeRegistry.normalizeHost(host), port), challenges)

  /** Persists the challenged key as the endpoint's trusted key. */
  suspend fun approve(challengeId: String): TrustedSftpHostKeyEntity {
    val challenge = challenges.consume(challengeId) ?: throw challengeNotFound()
    val row =
      TrustedSftpHostKeyEntity(
        id = 0L,
        host = challenge.host,
        port = challenge.port,
        algorithm = challenge.algorithm,
        keyBase64 = challenge.keyBase64,
        fingerprint = challenge.fingerprint,
        approvedAtMillis = clock(),
      )
    dao.replaceEndpointKey(row)
    return row
  }

  /** Discards the challenge without trusting anything; the next connect asks again. */
  fun reject(challengeId: String) {
    challenges.consume(challengeId) ?: throw challengeNotFound()
  }

  private fun challengeNotFound() =
    RemoteClientException(
      CloudSyncErrorCode.HOST_KEY_CHALLENGE_NOT_FOUND,
      "That host-key question has expired or was already answered.",
      "Connect again to see the server's current fingerprint.",
    )

  companion object {
    @Volatile private var instance: HostKeyTrustStore? = null

    fun shared(context: Context): HostKeyTrustStore =
      instance
        ?: synchronized(this) {
          instance
            ?: HostKeyTrustStore(SyncScopeDatabase.get(context).trustedSftpHostKeyDao()).also {
              instance = it
            }
        }
  }
}
