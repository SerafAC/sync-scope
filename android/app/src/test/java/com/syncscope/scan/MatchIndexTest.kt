package com.syncscope.scan

import com.syncscope.persistence.RemoteMatchKeyEntity
import com.syncscope.remote.RemoteEntry
import com.syncscope.remote.RemoteEntryType
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The bucket and normalization rules of research R3/R4, defined only in [MatchIndex]. */
class MatchIndexTest {

  @Test
  fun bucketEdgeFixturesShareABucketOnlyInsideTheEdge() {
    val start = 1_704_067_200_000L
    val end = 1_704_067_200_999L
    val next = 1_704_067_201_000L
    assertEquals(MatchIndex.bucketOf(start, 1_000), MatchIndex.bucketOf(end, 1_000))
    assertNotEquals(MatchIndex.bucketOf(end, 1_000), MatchIndex.bucketOf(next, 1_000))

    val day = 86_400_000L
    assertEquals(MatchIndex.bucketOf(start, day), MatchIndex.bucketOf(end, day))
    assertEquals(MatchIndex.bucketOf(end, day), MatchIndex.bucketOf(next, day))
  }

  @Test
  fun bucketOfFloorsNegativeTimestamps() {
    assertEquals(-1L, MatchIndex.bucketOf(-1L, 1_000))
    assertEquals(-1L, MatchIndex.bucketOf(-1_000L, 1_000))
    assertEquals(-2L, MatchIndex.bucketOf(-1_001L, 1_000))
    assertEquals(0L, MatchIndex.bucketOf(0L, 1_000))
  }

  @Test
  fun nfdAndNfcNamesProduceTheSameKey() {
    val nfd = "é-decomposed.txt"
    val nfc = "é-decomposed.txt"
    assertNotEquals(nfd, nfc)
    assertEquals(nfc, MatchIndex.nfc(nfd))

    val index = MatchIndex(PRECISION)
    index.add(file(nfd, 28, MTIME), "/")
    assertTrue(index.containsExact(nfc, 28, MatchIndex.bucketOf(MTIME, PRECISION)))
    assertEquals(1, index.keyCount)
  }

  @Test
  fun letterCaseMatters() {
    val index = MatchIndex(PRECISION)
    index.add(file("IMG.jpg", 10, MTIME), "/")
    index.add(file("img.jpg", 10, MTIME), "/")
    assertEquals(2, index.keyCount)
    assertTrue(index.containsExact("IMG.jpg", 10, MatchIndex.bucketOf(MTIME, PRECISION)))
    assertTrue(index.containsExact("img.jpg", 10, MatchIndex.bucketOf(MTIME, PRECISION)))
    assertFalse(index.containsExact("Img.jpg", 10, MatchIndex.bucketOf(MTIME, PRECISION)))
  }

  @Test
  fun duplicatesCollapseOntoOneKeyWithACount() {
    val index = MatchIndex(PRECISION)
    index.add(file("reusable.jpg", 27, MTIME), "/") // duplicates/a/reusable.jpg
    index.add(file("reusable.jpg", 27, MTIME), "/") // duplicates/b/reusable.jpg

    val rows = index.toRows("snap")
    assertEquals(1, rows.size)
    assertEquals(2L, rows.single().duplicateCount)
    assertEquals("reusable.jpg", rows.single().name)
    assertEquals(27L, rows.single().sizeBytes)
    assertEquals(PRECISION, rows.single().precisionMillis)
    assertEquals(MatchIndex.bucketOf(MTIME, PRECISION), rows.single().bucket)
    assertEquals("snap", rows.single().snapshotId)
  }

  @Test
  fun missingRemoteMtimeUsesTheUnknownBucket() {
    assertEquals(Long.MIN_VALUE, MatchIndex.MTIME_UNKNOWN_BUCKET)
    val index = MatchIndex(PRECISION)
    index.add(file("no-mtime.txt", 5, null), "/")
    assertTrue(index.containsExact("no-mtime.txt", 5, MatchIndex.MTIME_UNKNOWN_BUCKET))
    assertEquals(MatchIndex.MTIME_UNKNOWN_BUCKET, index.toRows("snap").single().bucket)
  }

  @Test
  fun onlyRegularFilesAreKeyed() {
    val index = MatchIndex(PRECISION)
    index.add(RemoteEntry("dir", 0, MTIME, RemoteEntryType.DIRECTORY), "/")
    index.add(RemoteEntry("link", 0, MTIME, RemoteEntryType.OTHER), "/")
    assertEquals(0, index.keyCount)
  }

  @Test
  fun rowsRoundTripToAnEqualIndex() {
    val index = MatchIndex(PRECISION)
    index.add(file("exact.txt", 22, MTIME), "/")
    index.add(file("reusable.jpg", 27, MTIME), "/")
    index.add(file("reusable.jpg", 27, MTIME), "/")
    index.add(file("no-mtime.txt", 5, null), "/")
    index.add(file("é.txt", 3, -1L), "/")

    val rebuilt = MatchIndex.fromRows(index.toRows("snap"), PRECISION)
    assertEquals(index, rebuilt)
    assertEquals(index.hashCode(), rebuilt.hashCode())
    assertEquals(index.toRows("other").toSet(), rebuilt.toRows("other").toSet())
  }

  @Test
  fun addCollectsDistinctDirectoriesPerKey() {
    val index = MatchIndex(PRECISION)
    index.add(file("reusable.jpg", 27, MTIME), "/backup/a")
    index.add(file("reusable.jpg", 27, MTIME), "/backup/b")
    index.add(file("reusable.jpg", 27, MTIME), "/backup/a")
    index.add(file("other.jpg", 27, MTIME), "/backup/c")

    val bucket = MatchIndex.bucketOf(MTIME, PRECISION)
    assertEquals(listOf("/backup/a", "/backup/b"), index.directoriesOf("reusable.jpg", 27, bucket))
    assertEquals(listOf("/backup/c"), index.directoriesOf("other.jpg", 27, bucket))
    assertEquals(3L, index.toRows("snap").single { it.name == "reusable.jpg" }.duplicateCount)
  }

  @Test
  fun directoriesAreCappedAtTheFirstSixteenInWalkOrder() {
    val index = MatchIndex(PRECISION)
    for (i in 1..20) index.add(file("many.jpg", 9, MTIME), "/d$i")

    val expected = (1..MatchIndex.MAX_DIRECTORIES_PER_KEY).map { "/d$it" }
    assertEquals(16, MatchIndex.MAX_DIRECTORIES_PER_KEY)
    assertEquals(expected, index.directoriesOf("many.jpg", 9, MatchIndex.bucketOf(MTIME, PRECISION)))
    assertEquals(20L, index.toRows("snap").single().duplicateCount)
  }

  @Test
  fun toRowsJoinsDirectoriesWithNewlinesAndFromRowsRestoresThem() {
    val index = MatchIndex(PRECISION)
    index.add(file("reusable.jpg", 27, MTIME), "/backup/a")
    index.add(file("reusable.jpg", 27, MTIME), "/backup/b b")
    index.add(file("no-mtime.txt", 5, null), "/")

    val rows = index.toRows("snap")
    assertEquals("/backup/a\n/backup/b b", rows.single { it.name == "reusable.jpg" }.directories)
    assertEquals("/", rows.single { it.name == "no-mtime.txt" }.directories)

    val rebuilt = MatchIndex.fromRows(rows, PRECISION)
    assertEquals(index, rebuilt)
    assertEquals(
      listOf("/backup/a", "/backup/b b"),
      rebuilt.directoriesOf("reusable.jpg", 27, MatchIndex.bucketOf(MTIME, PRECISION)),
    )
    assertEquals(rows.toSet(), rebuilt.toRows("snap").toSet())
  }

  @Test
  fun nonRegularEntriesAddNoDirectory() {
    val index = MatchIndex(PRECISION)
    index.add(RemoteEntry("dir", 0, MTIME, RemoteEntryType.DIRECTORY), "/backup")
    index.add(RemoteEntry("link", 0, MTIME, RemoteEntryType.OTHER), "/backup")
    assertEquals(0, index.keyCount)
    assertTrue(index.toRows("snap").isEmpty())
    assertNull(index.directoriesOf("dir", 0, MatchIndex.bucketOf(MTIME, PRECISION)))
  }

  @Test
  fun directoriesOfIsNullForAKeyFromRowsWithoutDirectories() {
    val bucket = MatchIndex.bucketOf(MTIME, PRECISION)
    val legacy =
      RemoteMatchKeyEntity(
        matchKeyId = 0,
        snapshotId = "snap",
        name = "old.jpg",
        sizeBytes = 4,
        precisionMillis = PRECISION,
        bucket = bucket,
        duplicateCount = 1,
        directories = null,
      )
    val rebuilt = MatchIndex.fromRows(listOf(legacy), PRECISION)
    assertTrue(rebuilt.containsExact("old.jpg", 4, bucket))
    assertNull(rebuilt.directoriesOf("old.jpg", 4, bucket))
    assertNull(rebuilt.toRows("snap").single().directories)
  }

  @Test
  fun splitDirectoriesIsTheInverseOfTheStoredForm() {
    assertNull(MatchIndex.splitDirectories(null))
    assertEquals(listOf("/a", "/b"), MatchIndex.splitDirectories("/a\n/b"))
  }

  @Test(expected = IllegalArgumentException::class)
  fun fromRowsRejectsAForeignPrecision() {
    val index = MatchIndex(PRECISION)
    index.add(file("exact.txt", 22, MTIME), "/")
    MatchIndex.fromRows(index.toRows("snap"), 2_000)
  }

  private fun file(name: String, size: Long, mtime: Long?) = RemoteEntry(name, size, mtime, RemoteEntryType.REGULAR_FILE)

  private companion object {
    const val PRECISION = 1_000L
    const val MTIME = 1_704_067_200_000L
  }
}
