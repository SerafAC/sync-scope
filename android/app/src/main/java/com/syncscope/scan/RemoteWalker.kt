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

/**
 * A remote-scope gap in the listing; [reason] never carries a path or host (D011). [remotePath] is set for
 * `REMOTE_FOLDER` gaps only, and is always a configured folder, never a path found by the walk.
 */
data class WalkAmbiguity(val scope: String, val reason: CloudSyncErrorCode, val remotePath: String? = null) {
  fun toEntity(snapshotId: String): RemoteAmbiguityEntity =
    RemoteAmbiguityEntity(
      id = 0,
      snapshotId = snapshotId,
      scope = scope,
      sourceId = null,
      entryId = null,
      matchKeyId = null,
      reason = reason.name,
      remotePath = remotePath,
    )

  companion object {
    fun remoteDirectory(reason: CloudSyncErrorCode) = WalkAmbiguity(RemoteAmbiguityEntity.SCOPE_REMOTE_DIRECTORY, reason)

    fun remoteListing(reason: CloudSyncErrorCode) = WalkAmbiguity(RemoteAmbiguityEntity.SCOPE_REMOTE_LISTING, reason)

    fun remoteFolder(reason: CloudSyncErrorCode, folder: String) =
      WalkAmbiguity(RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER, reason, folder)
  }
}

data class WalkProgress(val directoriesListed: Int, val filesListed: Long)

data class WalkResult(val index: MatchIndex, val listing: ListingState, val ambiguities: List<WalkAmbiguity>)

/**
 * No configured folder could be listed: the run ends FAILED with the first folder's [code] (FR-006,
 * clarification 4, research R14).
 */
class RootListingFailed(val code: CloudSyncErrorCode, cause: RemoteClientException) : Exception(cause.message, cause)

/**
 * Breadth-first remote walk (research R5). Only regular files are indexed, each with the directory it
 * was listed in (R11); directories are queued and `OTHER` entries are never followed; hidden entries are
 * included (R8). Every listing goes through [listWithRetry].
 *
 * - Every configured folder ([roots][walk]) is queued first, in order, so they are all listed before any
 *   subdirectory (research R14).
 * - A folder failing after the retry policy, with any code, adds a `REMOTE_FOLDER` gap carrying the folder
 *   and the walk continues with the others. Every folder failing raises [RootListingFailed] with the first
 *   folder's code, so with one folder this is the old "root failed" rule.
 * - A non-root [CloudSyncErrorCode.DIRECTORY_UNREADABLE] / [CloudSyncErrorCode.SERVER_ERROR] /
 *   [CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND] adds a `REMOTE_DIRECTORY` gap and the walk continues.
 * - Transient codes reconnect and retry the same directory, [MAX_ATTEMPTS] attempts in total with
 *   1 s / 2 s backoff. Exhausting them, or any other failure, adds a `REMOTE_LISTING` gap and stops the walk.
 *   [CloudSyncErrorCode.AUTH_FAILED] is never retried.
 */
class RemoteWalker(private val delay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) }) {

  suspend fun walk(
    session: RemoteSession,
    roots: List<String>,
    precisionMillis: Long,
    onProgress: (WalkProgress) -> Unit = {},
  ): WalkResult {
    require(roots.isNotEmpty()) { "at least one remote folder is required" }
    val index = MatchIndex(precisionMillis)
    val ambiguities = mutableListOf<WalkAmbiguity>()
    val pending = ArrayDeque(roots)
    // The roots are at the head of the queue, so the first roots.size iterations list exactly them.
    var rootsLeft = roots.size
    var firstRootFailure: RemoteClientException? = null
    var rootFailures = 0
    var directoriesListed = 0
    var filesListed = 0L

    while (pending.isNotEmpty()) {
      val directory = pending.removeFirst()
      val isRoot = rootsLeft > 0
      if (isRoot) rootsLeft--
      val entries =
        try {
          listWithRetry(session, directory, delay)
        } catch (failure: RemoteClientException) {
          if (isRoot) {
            if (firstRootFailure == null) firstRootFailure = failure
            rootFailures++
            if (rootFailures == roots.size) {
              val first = checkNotNull(firstRootFailure)
              throw RootListingFailed(first.code, first)
            }
            ambiguities += WalkAmbiguity.remoteFolder(failure.code, directory)
            continue
          }
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
            index.add(entry, directory)
            filesListed++
          }
          RemoteEntryType.DIRECTORY -> pending.addLast(join(directory, entry.name))
          RemoteEntryType.OTHER -> Unit
        }
      }
      directoriesListed++
      onProgress(WalkProgress(directoriesListed, filesListed))
    }

    val listing =
      ambiguities.firstOrNull()?.let { first ->
        ListingState.Incomplete(first.reason, folderUnread = ambiguities.any { it.scope == RemoteAmbiguityEntity.SCOPE_REMOTE_FOLDER })
      } ?: ListingState.Complete
    return WalkResult(index, listing, ambiguities.toList())
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

/**
 * Lists [directory] with the retry policy shared by the walk and the pre-delete re-check (research R5,
 * R12; Principle III): a transient code ([RemoteWalker.TRANSIENT_CODES]) reconnects [session] and retries,
 * [RemoteWalker.MAX_ATTEMPTS] attempts in total with 1 s / 2 s backoff through [delay]. Any other
 * failure, or the last attempt failing, propagates as [RemoteClientException].
 */
internal suspend fun listWithRetry(
  session: RemoteSession,
  directory: String,
  delay: suspend (Long) -> Unit,
): List<RemoteEntry> {
  var attempt = 1
  var needsReconnect = false
  while (true) {
    try {
      if (needsReconnect) session.reconnect()
      return session.client.list(directory)
    } catch (failure: RemoteClientException) {
      if (failure.code !in RemoteWalker.TRANSIENT_CODES || attempt >= RemoteWalker.MAX_ATTEMPTS) throw failure
      delay(RemoteWalker.BACKOFF_MILLIS shl (attempt - 1))
      attempt++
      needsReconnect = true
    }
  }
}
