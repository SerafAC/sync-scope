package com.syncscope.scan

import com.syncscope.bridge.CloudSyncErrorCode
import com.syncscope.bridge.FileIssueCode
import com.syncscope.source.LocalFile

/** Mirrors `FileStatus` in `src/native/CloudSyncContracts.ts`; declared from best to worst. */
enum class FileStatus {
  SYNCED,
  UNSYNCED,
  UNKNOWN;

  /** Worst-of: UNKNOWN > UNSYNCED > SYNCED. */
  fun worst(other: FileStatus): FileStatus = if (other.ordinal > ordinal) other else this
}

/** A row's `status` and `issueCode` (the wire name of a [FileIssueCode] or [CloudSyncErrorCode]). */
data class Verdict(val status: FileStatus, val issueCode: String?)

/** Whether the remote walk listed everything it should have. */
sealed interface ListingState {
  data object Complete : ListingState

  /**
   * [firstFailureCode] is the code of the first listing failure of the run; [folderUnread] is true when a
   * configured remote folder could not be read at all (a `REMOTE_FOLDER` gap, research R14).
   */
  data class Incomplete(val firstFailureCode: CloudSyncErrorCode, val folderUnread: Boolean = false) : ListingState
}

/** The data-model "Matching rules" table as a pure function; the first rule that applies wins. */
object Matcher {
  private val SYNCED = Verdict(FileStatus.SYNCED, null)
  private val UNSYNCED = Verdict(FileStatus.UNSYNCED, null)
  private val LOCAL_UNAVAILABLE = Verdict(FileStatus.UNKNOWN, FileIssueCode.LOCAL_UNAVAILABLE.name)
  private val REMOTE_MTIME_MISSING = Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_MTIME_MISSING.name)
  private val REMOTE_FOLDER_UNREAD = Verdict(FileStatus.UNKNOWN, FileIssueCode.REMOTE_FOLDER_UNREAD.name)

  fun verdict(file: LocalFile, precisionMillis: Long, index: MatchIndex, listing: ListingState): Verdict {
    val size = file.sizeBytes
    val mtime = file.modifiedUtcMillis
    // 1. The device could not tell us enough to compare.
    if (size == null || mtime == null) return LOCAL_UNAVAILABLE
    val name = MatchIndex.nfc(file.name)
    // 2. Exact key: backed up, even on an incomplete listing (clarification 1).
    if (index.containsExact(name, size, MatchIndex.bucketOf(mtime, precisionMillis))) return SYNCED
    // 3. Same name and size, but the remote gave no mtime.
    if (index.containsExact(name, size, MatchIndex.MTIME_UNKNOWN_BUCKET)) return REMOTE_MTIME_MISSING
    // 4. The file may be in a part of the backup that could not be listed: a whole configured folder when one
    //    was unread (research R14), else wherever the first failure was. Never UNSYNCED (D006).
    if (listing is ListingState.Incomplete) {
      return if (listing.folderUnread) REMOTE_FOLDER_UNREAD else Verdict(FileStatus.UNKNOWN, listing.firstFailureCode.name)
    }
    // 5. Not in a complete listing.
    return UNSYNCED
  }
}
