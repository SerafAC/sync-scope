package com.syncscope.scan

import com.syncscope.persistence.RemoteMatchKeyEntity
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import java.text.Normalizer

/**
 * The remote side of a scan collapsed to `(nfcName, sizeBytes, bucket) → duplicate count` (research R3, R4).
 *
 * This is the only place the bucket and name-normalization rules are defined (Principle III): the
 * [Matcher] and the snapshot rows both go through [bucketOf] and [nfc]. Every key uses the one
 * [precisionMillis] of the run.
 */
class MatchIndex(val precisionMillis: Long) {

  init {
    require(precisionMillis > 0) { "precisionMillis must be positive" }
  }

  data class Key(val nfcName: String, val sizeBytes: Long, val bucket: Long)

  private val counts = HashMap<Key, Long>()

  /** Number of distinct keys (duplicates collapse onto one). */
  val keyCount: Int
    get() = counts.size

  /** Keys a remote entry; only [RemoteEntryType.REGULAR_FILE] entries take part in matching. */
  fun add(entry: RemoteEntry) {
    if (entry.type != RemoteEntryType.REGULAR_FILE) return
    val bucket = entry.modifiedUtcMillis?.let { bucketOf(it, precisionMillis) } ?: MTIME_UNKNOWN_BUCKET
    addKey(Key(nfc(entry.name), entry.sizeBytes, bucket), 1)
  }

  /** [nfcName] must already be normalized with [nfc]. */
  fun containsExact(nfcName: String, sizeBytes: Long, bucket: Long): Boolean =
    counts.containsKey(Key(nfcName, sizeBytes, bucket))

  fun toRows(snapshotId: String): List<RemoteMatchKeyEntity> =
    counts.map { (key, count) ->
      RemoteMatchKeyEntity(
        matchKeyId = 0,
        snapshotId = snapshotId,
        name = key.nfcName,
        sizeBytes = key.sizeBytes,
        precisionMillis = precisionMillis,
        bucket = key.bucket,
        duplicateCount = count,
      )
    }

  private fun addKey(key: Key, count: Long) {
    counts.merge(key, count, Long::plus)
  }

  override fun equals(other: Any?): Boolean =
    other is MatchIndex && other.precisionMillis == precisionMillis && other.counts == counts

  override fun hashCode(): Int = 31 * precisionMillis.hashCode() + counts.hashCode()

  override fun toString(): String = "MatchIndex(precisionMillis=$precisionMillis, keys=${counts.size})"

  companion object {
    /** The bucket of a remote regular file without a modified time; never a real bucket for a positive precision. */
    const val MTIME_UNKNOWN_BUCKET: Long = Long.MIN_VALUE

    /** Floor division, so pre-1970 (negative) timestamps land in the right bucket. */
    fun bucketOf(mtimeMillis: Long, precisionMillis: Long): Long = Math.floorDiv(mtimeMillis, precisionMillis)

    /** Names compare in Unicode NFC and case-sensitively. */
    fun nfc(name: String): String = Normalizer.normalize(name, Normalizer.Form.NFC)

    /** Rebuilds the index of a stored snapshot (LOCAL_REFRESH); every row must carry [precisionMillis]. */
    fun fromRows(rows: Iterable<RemoteMatchKeyEntity>, precisionMillis: Long): MatchIndex {
      val index = MatchIndex(precisionMillis)
      for (row in rows) {
        require(row.precisionMillis == precisionMillis) { "match key precision differs from the run's precision" }
        index.addKey(Key(row.name, row.sizeBytes, row.bucket), row.duplicateCount)
      }
      return index
    }
  }
}
