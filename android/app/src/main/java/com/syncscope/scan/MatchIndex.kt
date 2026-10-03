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
 *
 * Each key also remembers the distinct remote directories its files were listed in (research R11), at
 * most [MAX_DIRECTORIES_PER_KEY] in walk order, so the pre-delete re-check can list only those folders.
 * A key rebuilt from rows written before schema version 4 has no directories ([directoriesOf] is `null`).
 */
class MatchIndex(val precisionMillis: Long) {

  init {
    require(precisionMillis > 0) { "precisionMillis must be positive" }
  }

  data class Key(val nfcName: String, val sizeBytes: Long, val bucket: Long)

  private val counts = HashMap<Key, Long>()
  private val directories = HashMap<Key, LinkedHashSet<String>>()

  /** Number of distinct keys (duplicates collapse onto one). */
  val keyCount: Int
    get() = counts.size

  /**
   * Keys a remote entry listed in [directory]; only [RemoteEntryType.REGULAR_FILE] entries take part in
   * matching. The first [MAX_DIRECTORIES_PER_KEY] distinct directories per key are kept.
   */
  fun add(entry: RemoteEntry, directory: String) {
    if (entry.type != RemoteEntryType.REGULAR_FILE) return
    val bucket = entry.modifiedUtcMillis?.let { bucketOf(it, precisionMillis) } ?: MTIME_UNKNOWN_BUCKET
    val key = Key(nfc(entry.name), entry.sizeBytes, bucket)
    addKey(key, 1)
    val seen = directories.getOrPut(key) { LinkedHashSet() }
    if (seen.size < MAX_DIRECTORIES_PER_KEY) seen.add(directory)
  }

  /**
   * The remote directories that held files with this key, in walk order; `null` when the key is unknown
   * or came from rows without directories. [nfcName] must already be normalized with [nfc].
   */
  fun directoriesOf(nfcName: String, sizeBytes: Long, bucket: Long): List<String>? =
    directories[Key(nfcName, sizeBytes, bucket)]?.toList()

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
        directories = directories[key]?.let(::joinDirectories),
      )
    }

  private fun addKey(key: Key, count: Long) {
    counts.merge(key, count, Long::plus)
  }

  override fun equals(other: Any?): Boolean =
    other is MatchIndex &&
      other.precisionMillis == precisionMillis &&
      other.counts == counts &&
      other.directories.mapValues { it.value.toList() } == directories.mapValues { it.value.toList() }

  override fun hashCode(): Int = 31 * (31 * precisionMillis.hashCode() + counts.hashCode()) + directories.hashCode()

  override fun toString(): String = "MatchIndex(precisionMillis=$precisionMillis, keys=${counts.size})"

  companion object {
    /** The bucket of a remote regular file without a modified time; never a real bucket for a positive precision. */
    const val MTIME_UNKNOWN_BUCKET: Long = Long.MIN_VALUE

    /** At most this many distinct directories are kept per key (research R11). */
    const val MAX_DIRECTORIES_PER_KEY: Int = 16

    private const val DIRECTORY_SEPARATOR = "\n"

    /** The stored form of `remote_match_key.directories`. */
    fun joinDirectories(directories: Collection<String>): String = directories.joinToString(DIRECTORY_SEPARATOR)

    /** The inverse of [joinDirectories]; `null` (a row written before schema version 4) stays `null`. */
    fun splitDirectories(stored: String?): List<String>? = stored?.split(DIRECTORY_SEPARATOR)

    /** Floor division, so pre-1970 (negative) timestamps land in the right bucket. */
    fun bucketOf(mtimeMillis: Long, precisionMillis: Long): Long = Math.floorDiv(mtimeMillis, precisionMillis)

    /** Names compare in Unicode NFC and case-sensitively. */
    fun nfc(name: String): String = Normalizer.normalize(name, Normalizer.Form.NFC)

    /**
     * Rebuilds the index of a stored snapshot (LOCAL_REFRESH), directories included; every row must carry
     * [precisionMillis].
     */
    fun fromRows(rows: Iterable<RemoteMatchKeyEntity>, precisionMillis: Long): MatchIndex {
      val index = MatchIndex(precisionMillis)
      for (row in rows) {
        require(row.precisionMillis == precisionMillis) { "match key precision differs from the run's precision" }
        val key = Key(row.name, row.sizeBytes, row.bucket)
        index.addKey(key, row.duplicateCount)
        splitDirectories(row.directories)?.let { index.directories[key] = LinkedHashSet(it) }
      }
      return index
    }
  }
}
