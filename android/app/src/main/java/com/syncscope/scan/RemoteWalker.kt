package com.syncscope.scan

import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.persistence.RemoteAmbiguityEntity
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType

/**
 * The connected [client] of a scan plus a way to replace it after a transient failure. The owner
 * closes the session; a client replaced by [reconnect] is closed here.
 */
class RemoteSession(initial: RemoteClient, private val connect: suspend () -> RemoteClient) : AutoCloseable {
  var client: RemoteClient = initial
    private set

  /** Closes the current client and opens a new one; a failure propagates as [RemoteClientException]. */
  suspend fun reconnect() {
    client.close()
    client = connect()
  }

  override fun close() {
    client.close()
  }
}

/** A remote-scope gap in the listing; [reason] never carries a path or host (D011). */
data class WalkAmbiguity(val scope: String, val reason: CloudSyncErrorCode) {
  fun toEntity(snapshotId: String): RemoteAmbiguityEntity =
    RemoteAmbiguityEntity(
      id = 0,
      snapshotId = snapshotId,
      scope = scope,
      sourceId = null,
      entryId = null,
      matchKeyId = null,
      reason = reason.name,
    )

  companion object {
    fun remoteDirectory(reason: CloudSyncErrorCode) = WalkAmbiguity(RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY, reason)

    fun remoteListing(reason: CloudSyncErrorCode) = WalkAmbiguity(RemoteAmbiguityEntity.SCOPE_REMOTE_LISTING, reason)
  }
}

data class WalkProgress(val directoriesListed: Int, val filesListed: Long)

data class WalkResult(val index: MatchIndex, val listing: ListingState, val ambiguities: List<WalkAmbiguity>)

/** The root itself could not be listed: the run ends FAILED with [code] (FR-006, clarification 4). */
class RootListingFailed(val code: CloudSyncErrorCode, cause: RemoteClientException) : Exception(cause.message, cause)

/**
 * Breadth-first remote walk (research R5). Only regular files are indexed, directories are queued and
 * `OTHER` entries are never followed; hidden entries are included (R8).
 *
 * - The root failing after the retry policy raises [RootListingFailed].
 * - A non-root [CloudSyncErrorCode.DIRECTORY_UNREADABLE] / [CloudSyncErrorCode.SERVER_ERROR] /
 *   [CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND] adds a `REMOTE_DIRECTORY` gap and the walk continues.
 * - Transient codes reconnect and retry the same directory, [MAX_ATTEMPTS] attempts in total with
 *   1 s / 2 s backoff. Exhausting them, or any other failure, adds a `REMOTE_LISTING` gap and stops the walk.
 *   [CloudSyncErrorCode.AUTH_FAILED] is never retried.
 */
class RemoteWalker(private val delay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) }) {

  suspend fun walk(
    session: RemoteSession,
    root: String,
    precisionMillis: Long,
    onProgress: (WalkProgress) -> Unit = {},
  ): WalkResult {
    val index = MatchIndex(precisionMillis)
    val ambiguities = mutableListOf<WalkAmbiguity>()
    val pending = ArrayDeque<String>().apply { add(root) }
    var directoriesListed = 0
    var filesListed = 0L

    while (pending.isNotEmpty()) {
      val directory = pending.removeFirst()
      val entries =
        try {
          listWithRetry(session, directory)
        } catch (failure: RemoteClientException) {
          if (directory == root) throw RootListingFailed(failure.code, failure)
          if (failure.code in DIRECTORY_CODES) {
            ambiguities += WalkAmbiguity.remoteDirectory(failure.code)
            continue
          }
          ambiguities += WalkAmbiguity.remoteListing(failure.code)
          break
        }
      for (entry in entries) {
        when (entry.type) {
          RemoteEntryType.REGULAR_FILE -> {
            index.add(entry)
            filesListed++
          }
          RemoteEntryType.DIRECTORY -> pending.addLast(join(directory, entry.name))
          RemoteEntryType.OTHER -> Unit
        }
      }
      directoriesListed++
      onProgress(WalkProgress(directoriesListed, filesListed))
    }

    val listing = ambiguities.firstOrNull()?.let { ListingState.Incomplete(it.reason) } ?: ListingState.Complete
    return WalkResult(index, listing, ambiguities.toList())
  }

  private suspend fun listWithRetry(session: RemoteSession, directory: String): List<RemoteEntry> {
    var attempt = 1
    var needsReconnect = false
    while (true) {
      try {
        if (needsReconnect) session.reconnect()
        return session.client.list(directory)
      } catch (failure: RemoteClientException) {
        if (failure.code !in TRANSIENT_CODES || attempt >= MAX_ATTEMPTS) throw failure
        delay(BACKOFF_MILLIS shl (attempt - 1))
        attempt++
        needsReconnect = true
      }
    }
  }

  companion object {
    const val MAX_ATTEMPTS = 3
    const val BACKOFF_MILLIS = 1_000L

    val TRANSIENT_CODES = setOf(CloudSyncErrorCode.CONNECTION_LOST, CloudSyncErrorCode.CONNECTION_TIMEOUT)

    private val DIRECTORY_CODES =
      setOf(
        CloudSyncErrorCode.DIRECTORY_UNREADABLE,
        CloudSyncErrorCode.SERVER_ERROR,
        CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND,
      )

    fun join(directory: String, name: String): String = if (directory.endsWith("/")) "$directory$name" else "$directory/$name"
  }
}
