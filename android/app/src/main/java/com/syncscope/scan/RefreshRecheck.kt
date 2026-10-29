package com.syncscope.scan

import android.util.Log
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.remote.FolderLister
import com.syncscope.remote.FolderListing
import com.syncscope.remote.ListingHooks
import com.syncscope.remote.RemoteClient
import com.syncscope.remote.RemoteClientException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The automatic refresh's re-check of not-backed-up files (FR-003, research R5, D023).
 *
 * 1. In the active snapshot, a *re-checkable* file is `UNSYNCED`, or `UNKNOWN` for a reason a listing can
 *    change (not `LOCAL_UNAVAILABLE`, not `REMOTE_MTIME_MISSING`). A *neighbour folder* is a device folder
 *    `(sourceId, parentId)` holding at least one re-checkable and one `SYNCED` file.
 * 2. The candidate server folders are the stored directories ([MatchIndex.directoriesOf]) of the `SYNCED`
 *    files in those folders, each weighted by the re-checkable files of the neighbour folders that point
 *    to it. At most [RECHECK_MAX_FOLDERS] are listed, the heaviest first, ties by path.
 * 3. They are listed read-only through the shared [FolderLister] (D020's connect-and-retry rules) within
 *    [RECHECK_BUDGET_MILLIS]; when the budget runs out, the folders listed so far are kept.
 * 4. Every listed key the refresh does not hold yet goes into the staged snapshot's `remote_match_key`
 *    (`INSERT OR IGNORE`) and into the refresh's [MatchIndex], with the listed folder as its directory.
 *    Keys already there, their counts and their directories never change. The unchanged [Matcher] then
 *    decides every file, so a file can be promoted and never demoted (D006).
 *
 * No re-checkable file or no candidate folder means no connection. A connection, authentication, host-key
 * or listing failure skips what it affects and never throws; cancellation propagates as itself. Only
 * counts and codes are logged, never a host, user or path (D011).
 */
class RefreshRecheck(
  private val store: SnapshotStore,
  private val lister: FolderLister,
  private val clock: () -> Long = System::currentTimeMillis,
) {

  /**
   * Re-checks the files of [fromSnapshotId] (the active snapshot) into the staged [toSnapshotId] and
   * [index] (its remote state, already copied). Returns the number of server folders listed successfully.
   */
  suspend fun run(
    fromSnapshotId: String,
    toSnapshotId: String,
    repository: RepositoryConfigEntity,
    index: MatchIndex,
    onClient: (RemoteClient) -> Unit = {},
  ): Int {
    val folders = candidates(fromSnapshotId, index)
    if (folders.isEmpty()) return 0

    val listed = LinkedHashMap<String, MatchIndex>()
    val start = clock()
    val hooks =
      ListingHooks(
        onClient = onClient,
        keepGoing = { clock() - start < RECHECK_BUDGET_MILLIS },
        onListed = { folder, listing -> if (listing is FolderListing.Listed) listed[folder] = listing.keys },
      )
    try {
      // The clock check stops between folders; the timeout also bounds a connect or a listing that hangs.
      withTimeoutOrNull(RECHECK_BUDGET_MILLIS) { lister.listFolders(repository, index.precisionMillis, folders, hooks) }
    } catch (failure: RemoteClientException) {
      // A cancel closes the client under the listing: that is a cancellation, not a failure.
      currentCoroutineContext().ensureActive()
      Log.w(TAG, "refresh recheck: skipped code=${failure.code}")
    }

    var added = 0
    for (keys in listed.values) {
      currentCoroutineContext().ensureActive()
      val missing = index.keysMissingFrom(keys)
      if (missing.keyCount == 0) continue
      store.stageMissingMatchKeys(missing.toRows(toSnapshotId))
      index.addMissing(missing)
      added += missing.keyCount
    }
    Log.i(TAG, "refresh recheck: candidates=${folders.size} listed=${listed.size} newKeys=$added")
    return listed.size
  }

  /** The candidate server folders of [snapshotId], heaviest first, ties by path, at most [RECHECK_MAX_FOLDERS]. */
  private suspend fun candidates(snapshotId: String, index: MatchIndex): List<String> {
    val recheckable = store.recheckableNeighbourFolders(snapshotId).associate { (it.sourceId to it.parentId) to it.count }
    if (recheckable.isEmpty()) return emptyList()
    val precision = index.precisionMillis
    val foldersOf = HashMap<Pair<String, String?>, LinkedHashSet<String>>()
    for (file in store.syncedNeighbours(snapshotId)) {
      val size = file.sizeBytes ?: continue
      val mtime = file.modifiedUtcMillis ?: continue
      val directories =
        index.directoriesOf(MatchIndex.nfc(file.name), size, MatchIndex.bucketOf(mtime, precision)) ?: continue
      foldersOf.getOrPut(file.sourceId to file.parentId) { LinkedHashSet() }.addAll(directories)
    }
    val weights = HashMap<String, Long>()
    for ((folder, directories) in foldersOf) {
      val count = recheckable[folder] ?: continue
      for (directory in directories) weights.merge(directory, count, Long::plus)
    }
    return weights.entries
      .sortedWith(compareByDescending<Map.Entry<String, Long>> { it.value }.thenBy { it.key })
      .take(RECHECK_MAX_FOLDERS)
      .map { it.key }
  }

  companion object {
    /** At most this many server folders per refresh (research R5). */
    const val RECHECK_MAX_FOLDERS = 32

    /** The time for connecting and listing; the folders listed when it runs out are kept (research R5). */
    const val RECHECK_BUDGET_MILLIS = 20_000L

    private const val TAG = "CloudSync"
  }
}
