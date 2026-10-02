package com.syncscope.scan

import kotlin.random.Random
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Worst-of UNKNOWN > UNSYNCED > SYNCED from files through every ancestor directory, plus the per-status
 * descendant file counts (schema version 3) that every ancestor of a file includes once.
 */
class DirectoryRollupTest {

  @Test
  fun emptyDirectoryIsSynced() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("empty", null)
    assertEquals(
      mapOf("empty" to DirectoryResult(Verdict(FileStatus.SYNCED, null), DescendantCounts(0, 0, 0))),
      rollup.finish(),
    )
  }

  @Test
  fun worstStatusPropagatesThroughEveryAncestor() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.SYNCED)
    rollup.recordFile("c", FileStatus.UNSYNCED)
    val result = rollup.finish()
    assertEquals(FileStatus.UNSYNCED, result.getValue("c").verdict.status)
    assertEquals(FileStatus.UNSYNCED, result.getValue("b").verdict.status)
    assertEquals(FileStatus.UNSYNCED, result.getValue("a").verdict.status)
  }

  @Test
  fun unknownBeatsUnsyncedAndSynced() {
    val rollup = tree()
    rollup.recordFile("a", FileStatus.UNSYNCED)
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("b", FileStatus.SYNCED)
    val result = rollup.finish()
    assertEquals(FileStatus.UNKNOWN, result.getValue("a").verdict.status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("b").verdict.status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("c").verdict.status)
  }

  @Test
  fun laterBetterStatusNeverImprovesADirectory() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("c", FileStatus.SYNCED)
    rollup.recordFile("c", FileStatus.UNSYNCED)
    assertEquals(FileStatus.UNKNOWN, rollup.finish().getValue("a").verdict.status)
  }

  @Test
  fun siblingSubtreesDoNotAffectEachOther() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("root", null)
    rollup.registerDirectory("left", "root")
    rollup.registerDirectory("right", "root")
    rollup.registerDirectory("right-child", "right")
    rollup.recordFile("left", FileStatus.UNKNOWN)
    rollup.recordFile("right-child", FileStatus.SYNCED)
    val result = rollup.finish()
    assertEquals(FileStatus.UNKNOWN, result.getValue("left").verdict.status)
    assertEquals(FileStatus.SYNCED, result.getValue("right").verdict.status)
    assertEquals(FileStatus.SYNCED, result.getValue("right-child").verdict.status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("root").verdict.status)
  }

  @Test
  fun registrationOrderDoesNotMatter() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("c", "b")
    rollup.recordFile("c", FileStatus.UNSYNCED)
    rollup.registerDirectory("b", "a")
    rollup.registerDirectory("a", null)
    assertEquals(FileStatus.UNSYNCED, rollup.finish().getValue("a").verdict.status)
  }

  @Test
  fun topLevelFilesAffectNoDirectory() {
    val rollup = tree()
    rollup.recordFile(null, FileStatus.UNKNOWN)
    assertEquals(FileStatus.SYNCED, rollup.finish().getValue("a").verdict.status)
  }

  @Test
  fun directoryIssueCodeIsAlwaysNull() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.finish().values.forEach { assertNull(it.verdict.issueCode) }
  }

  @Test
  fun aFileTwoLevelsDeepCountsInBothAncestors() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("a", null)
    rollup.registerDirectory("b", "a")
    rollup.registerDirectory("c", "b")
    rollup.recordFile("c", FileStatus.UNSYNCED)
    rollup.recordFile("c", FileStatus.SYNCED)
    rollup.recordFile("b", FileStatus.UNKNOWN)
    val result = rollup.finish()
    assertEquals(DescendantCounts(synced = 1, unsynced = 1, unknown = 0), result.getValue("c").counts)
    assertEquals(DescendantCounts(synced = 1, unsynced = 1, unknown = 1), result.getValue("b").counts)
    assertEquals(DescendantCounts(synced = 1, unsynced = 1, unknown = 1), result.getValue("a").counts)
  }

  @Test
  fun countsReachEveryAncestorEvenWhenTheStatusIsAlreadyWorst() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("c", FileStatus.SYNCED)
    val result = rollup.finish()
    for (id in listOf("a", "b", "c")) {
      assertEquals(id, DescendantCounts(synced = 1, unsynced = 0, unknown = 2), result.getValue(id).counts)
      assertEquals(id, FileStatus.UNKNOWN, result.getValue(id).verdict.status)
    }
  }

  @Test
  fun emptyDirectoryGetsZeroCounts() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("root", null)
    rollup.registerDirectory("empty", "root")
    rollup.registerDirectory("full", "root")
    rollup.recordFile("full", FileStatus.SYNCED)
    val result = rollup.finish()
    assertEquals(DescendantCounts(0, 0, 0), result.getValue("empty").counts)
    assertEquals(DescendantCounts(1, 0, 0), result.getValue("root").counts)
  }

  @Test
  fun aFileDirectlyUnderASourceRootCountsInNoDirectory() {
    val rollup = tree()
    rollup.recordFile(null, FileStatus.UNKNOWN)
    rollup.recordFile(null, FileStatus.SYNCED)
    rollup.finish().values.forEach { assertEquals(DescendantCounts(0, 0, 0), it.counts) }
  }

  @Test
  fun topLevelDirectoryCountsPlusTopLevelFilesEqualTheSourceTotals() {
    repeat(20) { seed ->
      val random = Random(seed)
      val rollup = DirectoryRollup()
      val directories = ArrayList<String>()
      val parentOf = HashMap<String, String?>()
      repeat(random.nextInt(1, 40)) { i ->
        val id = "d$i"
        // Parents are always earlier directories (or the source root), so the generated tree has no cycle.
        val parent = if (directories.isEmpty() || random.nextInt(4) == 0) null else directories.random(random)
        parentOf[id] = parent
        directories += id
      }
      // Register in a shuffled order: registration order must not matter.
      directories.shuffled(random).forEach { rollup.registerDirectory(it, parentOf.getValue(it)) }
      val totals = HashMap<FileStatus, Long>()
      val topLevelFiles = HashMap<FileStatus, Long>()
      repeat(random.nextInt(0, 300)) {
        val status = FileStatus.entries.random(random)
        val parent = if (random.nextInt(5) == 0) null else directories.random(random)
        rollup.recordFile(parent, status)
        totals.merge(status, 1L, Long::plus)
        if (parent == null) topLevelFiles.merge(status, 1L, Long::plus)
      }

      val result = rollup.finish()

      val topLevel = directories.filter { parentOf.getValue(it) == null }.map { result.getValue(it).counts }
      fun total(status: FileStatus) = totals[status] ?: 0L
      fun top(status: FileStatus) = topLevelFiles[status] ?: 0L
      assertEquals("seed $seed synced", total(FileStatus.SYNCED), topLevel.sumOf { it.synced } + top(FileStatus.SYNCED))
      assertEquals(
        "seed $seed unsynced",
        total(FileStatus.UNSYNCED),
        topLevel.sumOf { it.unsynced } + top(FileStatus.UNSYNCED),
      )
      assertEquals(
        "seed $seed unknown",
        total(FileStatus.UNKNOWN),
        topLevel.sumOf { it.unknown } + top(FileStatus.UNKNOWN),
      )
      // Status and counts agree: a directory is the worst status it has a count for, else SYNCED.
      for ((id, dir) in result) {
        val expected =
          when {
            dir.counts.unknown > 0 -> FileStatus.UNKNOWN
            dir.counts.unsynced > 0 -> FileStatus.UNSYNCED
            else -> FileStatus.SYNCED
          }
        assertEquals("seed $seed $id", expected, dir.verdict.status)
        assertNull(dir.verdict.issueCode)
      }
    }
  }

  @Test(expected = IllegalStateException::class)
  fun directoryCycleIsAnError() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("x", "y")
    rollup.registerDirectory("y", "x")
    rollup.recordFile("x", FileStatus.SYNCED)
    rollup.finish()
  }

  @Test(expected = IllegalStateException::class)
  fun unregisteredParentIsAnError() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("orphan", "missing")
    rollup.finish()
  }

  /** a ⊃ b ⊃ c */
  private fun tree() =
    DirectoryRollup().apply {
      registerDirectory("a", null)
      registerDirectory("b", "a")
      registerDirectory("c", "b")
    }
}
