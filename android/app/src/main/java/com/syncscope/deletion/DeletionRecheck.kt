package com.syncscope.deletion

import android.util.Log
import com.syncscope.credential.CredentialStore
import com.syncscope.persistence.RepositoryConfigEntity
import com.syncscope.persistence.SnapshotStore
import com.syncscope.remote.FolderListing
import com.syncscope.remote.RemoteClientException
import com.syncscope.remote.RemoteClientFactory
import com.syncscope.remote.ServerFolderLister
import com.syncscope.scan.MatchIndex

/** Why the re-check moved a `SYNCED` row out of `toDelete` (research R12). */
enum class RecheckReason {
  /** Every stored directory was listed and none still holds the file: it goes to `unsynced`. */
  GONE_FROM_SERVER,

  /** No directory confirmed the file and at least one could not be listed: it goes to `refused`. */
  RECHECK_FAILED,

  /** The key has no stored directories (a scan from before schema version 4): it goes to `refused`. */
  SCAN_TOO_OLD,
}

data class RecheckedRow(val row: DeletionRow, val reason: RecheckReason)

/**
 * The re-check's split of the selected `SYNCED` rows, in input order within each group.
 *
 * [movedByRecheck] counts the rows the server listings moved: [RecheckReason.GONE_FROM_SERVER] and
 * [RecheckReason.RECHECK_FAILED]. [RecheckReason.SCAN_TOO_OLD] rows are refused without a listing and are
 * reported on their own (`refused.scanTooOld`).
 */
data class RecheckResult(
  val toDelete: List<DeletionRow>,
  val unsynced: List<RecheckedRow>,
  val refused: List<RecheckedRow>,
  val movedByRecheck: Int,
)

/**
 * The pre-delete server re-check (research R12, step 4; clarification 1).
 *
 * Each `SYNCED` row is keyed with the scan's own rules ([MatchIndex.nfc], [MatchIndex.bucketOf] at the
 * snapshot's precision) and looked up in the snapshot's match keys for the server directories that held
 * it. [ServerFolderLister] opens one session for the saved repository and lists each distinct directory
 * once, in order, with the walk's retry policy. A row stays in `toDelete` when any of its directories
 * still lists a regular file with the same key.
 *
 * A failure to connect (credentials, authentication, connection, TLS, an SFTP host key) propagates as the
 * [RemoteClientException] it is, before anything is listed, and no result exists. Only codes and counts
 * are logged, never the password, host, user or a remote path (D011, SC-005).
 */
class DeletionRecheck(
  private val store: SnapshotStore,
  private val lister: ServerFolderLister,
) : ServerRecheck {

  constructor(
    store: SnapshotStore,
    credentials: CredentialStore,
    clients: RemoteClientFactory,
    delay: suspend (Long) -> Unit = { kotlinx.coroutines.delay(it) },
  ) : this(store, ServerFolderLister(credentials, clients, delay))

  override suspend fun recheck(snapshotId: String, repository: RepositoryConfigEntity, synced: List<DeletionRow>): RecheckResult {
    val precision = store.precisionOf(snapshotId)
    val refused = ArrayList<RecheckedRow>()
    val pending = ArrayList<Pending>()
    for (row in synced) {
      val size = row.sizeBytes
      val mtime = row.modifiedUtcMillis
      if (precision == null || size == null || mtime == null) {
        // A SYNCED row always has both (Matcher rule 1); without them nothing can be confirmed.
        refused += RecheckedRow(row, RecheckReason.RECHECK_FAILED)
        continue
      }
      val name = MatchIndex.nfc(row.name)
      val bucket = MatchIndex.bucketOf(mtime, precision)
      val directories = MatchIndex.splitDirectories(store.matchKey(snapshotId, name, size, precision, bucket)?.directories)
      if (directories == null) {
        refused += RecheckedRow(row, RecheckReason.SCAN_TOO_OLD)
      } else {
        pending += Pending(row, name, size, bucket, directories)
      }
    }

    val listings =
      if (pending.isEmpty() || precision == null) {
        emptyMap()
      } else {
        lister.listFolders(repository, precision, pending.flatMap { it.directories })
      }

    val toDelete = ArrayList<DeletionRow>()
    val unsynced = ArrayList<RecheckedRow>()
    var moved = 0
    for (item in pending) {
      val results = item.directories.map { listings.getValue(it) }
      when {
        results.any { it is FolderListing.Listed && it.keys.containsExact(item.nfcName, item.sizeBytes, item.bucket) } ->
          toDelete += item.row
        results.any { it is FolderListing.Unchecked } -> {
          refused += RecheckedRow(item.row, RecheckReason.RECHECK_FAILED)
          moved++
        }
        else -> {
          unsynced += RecheckedRow(item.row, RecheckReason.GONE_FROM_SERVER)
          moved++
        }
      }
    }
    Log.i(
      TAG,
      "deletion recheck: rows=${synced.size} directories=${listings.size} confirmed=${toDelete.size} " +
        "gone=${unsynced.size} failed=${refused.count { it.reason == RecheckReason.RECHECK_FAILED }} " +
        "tooOld=${refused.count { it.reason == RecheckReason.SCAN_TOO_OLD }}",
    )
    val order = synced.withIndex().associate { it.value.entryId to it.index }
    return RecheckResult(
      toDelete = toDelete,
      unsynced = unsynced,
      refused = refused.sortedBy { order[it.row.entryId] },
      movedByRecheck = moved,
    )
  }

  private class Pending(
    val row: DeletionRow,
    val nfcName: String,
    val sizeBytes: Long,
    val bucket: Long,
    val directories: List<String>,
  )

  private companion object {
    const val TAG = "CloudSync"
  }
}
