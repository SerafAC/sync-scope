package com.syncscope.scan

/** Number of `FILE` rows anywhere beneath a directory, per status (schema version 3). */
data class DescendantCounts(val synced: Long, val unsynced: Long, val unknown: Long)

/** What [DirectoryRollup.finish] yields for one directory: its rolled-up verdict and descendant counts. */
data class DirectoryResult(val verdict: Verdict, val counts: DescendantCounts)

/**
 * Worst-of status propagation from files to every ancestor directory (data-model `LocalNode`):
 * UNKNOWN > UNSYNCED > SYNCED, an empty directory is SYNCED, and a directory never carries an issue code.
 * Each directory also gets the per-status count of files anywhere beneath it; every ancestor of a file
 * counts it once, and an empty directory gets `0 / 0 / 0`.
 *
 * Directories and files may be recorded in any order; ancestors are resolved in [finish].
 */
class DirectoryRollup {
  private val parents = HashMap<String, String?>()

  /** Files recorded directly inside each directory, indexed by [FileStatus.ordinal]. */
  private val own = HashMap<String, LongArray>()

  fun registerDirectory(entryId: String, parentEntryId: String?) {
    parents[entryId] = parentEntryId
  }

  /** Records a file directly inside [parentEntryId]; a null parent (a source-root child) affects no directory. */
  fun recordFile(parentEntryId: String?, status: FileStatus) {
    if (parentEntryId == null) return
    own.getOrPut(parentEntryId) { LongArray(STATUS_COUNT) }[status.ordinal]++
  }

  /** The final verdict and descendant counts per registered directory. */
  fun finish(): Map<String, DirectoryResult> {
    for (parent in parents.values) {
      check(parent == null || parent in parents) { "directory registered under an unregistered parent" }
    }
    val totals = HashMap<String, LongArray>(parents.size)
    for (id in parents.keys) totals[id] = LongArray(STATUS_COUNT)
    for ((id, counts) in own) {
      check(id in parents) { "file recorded under an unregistered directory" }
      addToAncestors(totals, id, counts)
    }
    return totals.mapValues { (_, counts) ->
      DirectoryResult(
        Verdict(worstOf(counts), null),
        DescendantCounts(
          synced = counts[FileStatus.SYNCED.ordinal],
          unsynced = counts[FileStatus.UNSYNCED.ordinal],
          unknown = counts[FileStatus.UNKNOWN.ordinal],
        ),
      )
    }
  }

  /**
   * Adds [counts] to [id] and every ancestor. This is a full walk, unlike an early-exit status raise,
   * because counts must reach every ancestor even when its status is already the worst.
   */
  private fun addToAncestors(totals: Map<String, LongArray>, id: String, counts: LongArray) {
    var current: String? = id
    var steps = 0
    while (current != null) {
      val target = totals.getValue(current)
      for (i in counts.indices) target[i] += counts[i]
      current = parents[current]
      check(++steps <= parents.size) { "directory cycle" }
    }
  }

  /** The worst status with at least one descendant file; SYNCED for an empty directory. */
  private fun worstOf(counts: LongArray): FileStatus =
    FileStatus.entries.lastOrNull { counts[it.ordinal] > 0 } ?: FileStatus.SYNCED

  private companion object {
    val STATUS_COUNT = FileStatus.entries.size
  }
}
