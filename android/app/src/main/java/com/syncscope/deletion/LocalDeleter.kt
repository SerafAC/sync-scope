package com.syncscope.deletion

import com.syncscope.source.DeleteResult
import com.syncscope.source.SafAccess

/**
 * One selected `FILE` row of a deletion plan (data-model "Deletion plan"): what execute needs to verify
 * and delete the document and to update the snapshot. Only [entryId] and [name] ever cross the bridge.
 */
data class DeletionRow(
  val entryId: String,
  val sourceId: String,
  val parentId: String?,
  val documentUri: String,
  val name: String,
  val sizeBytes: Long?,
  val modifiedUtcMillis: Long?,
  /** `SYNCED`, `UNSYNCED` or `UNKNOWN`, as stored on the `local_node` row. */
  val status: String,
)

/** Per-file outcome of execute (data-model "Per-file outcome"). */
enum class DeletionState {
  /** `deleteDocument` succeeded; the row is removed from the snapshot. */
  DELETED,

  /** The document no longer exists; the row is removed from the snapshot. */
  ALREADY_GONE,

  /** The size or modified time differs from the scan; the file is not deleted. */
  CHANGED,

  /** No write grant on the source, or the provider refused with a `SecurityException`. */
  ACCESS_LOST,

  /** Any other error. */
  FAILED,

  /** In `unsynced` and the user did not include those files; never attempted. */
  SKIPPED_UNSYNCED;

  /** Only these two remove the row from the snapshot (research R14). */
  val removesRow: Boolean
    get() = this == DELETED || this == ALREADY_GONE
}

data class DeletionOutcome(val row: DeletionRow, val state: DeletionState, val atMillis: Long)

/**
 * Verifies and deletes one device file through SAF (research R13, execute steps 1–3):
 *
 * 1. no write grant on the source → [DeletionState.ACCESS_LOST];
 * 2. the document is absent → [DeletionState.ALREADY_GONE]; its size or modified time differs from the
 *    row → [DeletionState.CHANGED], and it is not deleted;
 * 3. `deleteDocument`: deleted → [DeletionState.DELETED]; refused → [DeletionState.ACCESS_LOST]; missing
 *    or any other failure → [DeletionState.ALREADY_GONE] when a re-query confirms absence, else
 *    [DeletionState.FAILED].
 *
 * Nothing is logged: a document URI or file name must never reach the log (D011).
 */
class LocalDeleter(private val saf: SafAccess, private val clock: () -> Long = System::currentTimeMillis) {

  fun deleteOne(row: DeletionRow, sourceCanWrite: Boolean): DeletionOutcome = DeletionOutcome(row, decide(row, sourceCanWrite), clock())

  private fun decide(row: DeletionRow, sourceCanWrite: Boolean): DeletionState {
    if (!sourceCanWrite) return DeletionState.ACCESS_LOST
    val current =
      try {
        saf.stat(row.documentUri)
      } catch (_: SecurityException) {
        return DeletionState.ACCESS_LOST
      } catch (_: Exception) {
        return DeletionState.FAILED
      } ?: return DeletionState.ALREADY_GONE
    if (current.sizeBytes != row.sizeBytes || current.modifiedUtcMillis != row.modifiedUtcMillis) {
      return DeletionState.CHANGED
    }
    return when (saf.delete(row.documentUri)) {
      DeleteResult.DELETED -> DeletionState.DELETED
      DeleteResult.DENIED -> DeletionState.ACCESS_LOST
      DeleteResult.NOT_FOUND,
      DeleteResult.FAILED -> if (confirmedAbsent(row)) DeletionState.ALREADY_GONE else DeletionState.FAILED
    }
  }

  private fun confirmedAbsent(row: DeletionRow): Boolean =
    try {
      saf.stat(row.documentUri) == null
    } catch (_: Exception) {
      false
    }
}
