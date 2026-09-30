package com.syncscope.scan

/**
 * Worst-of status propagation from files to every ancestor directory (data-model `LocalNode`):
 * UNKNOWN > UNSYNCED > SYNCED, an empty directory is SYNCED, and a directory never carries an issue code.
 *
 * Directories and files may be recorded in any order; ancestors are resolved in [finish].
 */
class DirectoryRollup {
  private val parents = HashMap<String, String?>()
  private val own = HashMap<String, FileStatus>()

  fun registerDirectory(entryId: String, parentEntryId: String?) {
    parents[entryId] = parentEntryId
  }

  /** Records a file directly inside [parentEntryId]; a null parent (a source-root child) affects no directory. */
  fun recordFile(parentEntryId: String?, status: FileStatus) {
    if (parentEntryId == null) return
    own.merge(parentEntryId, status, FileStatus::worst)
  }

  /** The final verdict per registered directory. */
  fun finish(): Map<String, Verdict> {
    val result = HashMap<String, FileStatus>(parents.size)
    for (id in parents.keys) result[id] = FileStatus.SYNCED
    for (parent in parents.values) {
      check(parent == null || parent in parents) { "directory registered under an unregistered parent" }
    }
    for ((id, status) in own) {
      check(id in parents) { "file recorded under an unregistered directory" }
      raise(result, id, status)
    }
    return result.mapValues { (_, status) -> Verdict(status, null) }
  }

  /**
   * Raises [id] and its ancestors to at least [status]. Every ancestor is always at least as bad as its
   * descendants, so the walk stops at the first directory that already is.
   */
  private fun raise(result: MutableMap<String, FileStatus>, id: String, status: FileStatus) {
    var current: String? = id
    var steps = 0
    while (current != null) {
      val existing = result.getValue(current)
      if (existing.ordinal >= status.ordinal) return
      result[current] = status
      current = parents[current]
      check(++steps <= parents.size) { "directory cycle" }
    }
  }
}
