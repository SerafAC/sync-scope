package com.syncscope.remote

import android.util.Log
import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.RepositoryOperations
import com.syncscope.bridge.connectRepository
import com.syncscope.bridge.toRemoteConfig
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.scan.MatchIndex
import com.syncscope.scan.RemoteSession
import com.syncscope.scan.listWithRetry

/** What one server folder's listing says about the files keyed to it. */
sealed interface FolderListing {
  /** Listed: [keys] holds its regular files, keyed with the scan's rules ([MatchIndex.add]). */
  class Listed(val keys: MatchIndex) : FolderListing

  /** The folder no longer exists (a "not found" answer, WebDAV 404 included). It is never retried. */
  data object Gone : FolderListing

  /** It could not be listed, after the walk's retries, so nothing in it can be confirmed or ruled out. */
  data class Unchecked(val code: CloudSyncErrorCode) : FolderListing
}

/**
 * Optional controls for one [FolderLister.listFolders] call (the refresh re-check, research R5):
 *
 * - [onClient] receives every client the call creates, so a canceller can close it ([com.syncscope.scan.RunControl]);
 * - [keepGoing] is asked before each folder; once it answers false, no further folder is started and the
 *   result holds only the folders listed so far (the 20 s budget);
 * - [onListed] receives each folder's result as soon as it is known, so a caller that stops the call early
 *   still has them.
 */
class ListingHooks(
  val onClient: (RemoteClient) -> Unit = {},
  val keepGoing: () -> Boolean = { true },
  val onListed: (String, FolderListing) -> Unit = { _, _ -> },
)

/** Read-only listing of server folders; [ServerFolderLister] is the one implementation, tests fake it. */
interface FolderLister {
  /**
   * One [FolderListing] per distinct folder of [folders] that was started, in first-seen order, keyed at
   * [precisionMillis]. No folders means no connection. A connect failure propagates as its
   * [RemoteClientException].
   */
  suspend fun listFolders(
    repository: RepositoryConfigEntity,
    precisionMillis: Long,
    folders: List<String>,
    hooks: ListingHooks = ListingHooks(),
  ): Map<String, FolderListing>
}

/**
 * Lists server folders read-only, for the pre-delete re-check ([com.syncscope.deletion.DeletionRecheck],
 * D020) and the refresh re-check (research R5, D023). One place owns the connect-and-list rules
 * (Principle III).
 *
 * One session is opened for the saved repository, with its stored credential and trusted host key
 * ([connectRepository]), and each distinct folder is listed once, in first-seen order, with the walk's
 * retry policy ([listWithRetry]). No folders means no connection.
 *
 * A failure to connect (an unconfigured repository, an unreadable credential, authentication, connection,
 * TLS, an SFTP host key) propagates as the [RemoteClientException] it is, before anything is listed.
 * Cancellation propagates as itself, and the session is always closed. Only codes are logged, never the
 * password, host, user or a remote path (D011, SC-005).
 */
class ServerFolderLister(
  private val credentials: CredentialStore,
  private val clients: RemoteClientFactory,
  private val delay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
) : FolderLister {

  override suspend fun listFolders(
    repository: RepositoryConfigEntity,
    precisionMillis: Long,
    folders: List<String>,
    hooks: ListingHooks,
  ): Map<String, FolderListing> {
    val distinct = folders.distinct()
    if (distinct.isEmpty()) return emptyMap()
    val config =
      repository.toRemoteConfig()
        ?: throw RemoteClientException(
          CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED,
          RepositoryOperations.NOT_CONFIGURED_MESSAGE,
          RepositoryOperations.NOT_CONFIGURED_ACTION,
        )
    val connect: suspend () -> RemoteClient = {
      connectRepository(clients, credentials, config, repository.credentialVersion, onCreated = hooks.onClient)
    }
    val initial =
      try {
        connect()
      } catch (failure: RemoteClientException) {
        Log.w(TAG, "folder lister: connect failed code=${failure.code} reply=${failure.replyCode}")
        throw failure
      }
    val listings = LinkedHashMap<String, FolderListing>()
    RemoteSession(initial, connect).use { session ->
      for (folder in distinct) {
        if (!hooks.keepGoing()) break
        val listing =
          try {
            val keys = MatchIndex(precisionMillis)
            listWithRetry(session, folder, delay).forEach { keys.add(it, folder) }
            FolderListing.Listed(keys)
          } catch (failure: RemoteClientException) {
            if (failure.code in GONE_CODES) {
              FolderListing.Gone
            } else {
              Log.w(TAG, "folder lister: listing failed code=${failure.code} reply=${failure.replyCode}")
              FolderListing.Unchecked(failure.code)
            }
          }
        listings[folder] = listing
        hooks.onListed(folder, listing)
      }
    }
    return listings
  }

  private companion object {
    const val TAG = "CloudSync"

    /** "Not found" answers: the folder, and so every file keyed to it, is gone (WebDAV 404 included). */
    val GONE_CODES = setOf(CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND, CloudSyncErrorCode.DIRECTORY_UNREADABLE)
  }
}
