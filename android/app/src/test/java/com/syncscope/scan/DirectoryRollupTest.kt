package com.syncscope.scan

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** Worst-of UNKNOWN > UNSYNCED > SYNCED from files through every ancestor directory. */
class DirectoryRollupTest {

  @Test
  fun emptyDirectoryIsSynced() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("empty", null)
    assertEquals(mapOf("empty" to Verdict(FileStatus.SYNCED, null)), rollup.finish())
  }

  @Test
  fun worstStatusPropagatesThroughEveryAncestor() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.SYNCED)
    rollup.recordFile("c", FileStatus.UNSYNCED)
    val result = rollup.finish()
    assertEquals(FileStatus.UNSYNCED, result.getValue("c").status)
    assertEquals(FileStatus.UNSYNCED, result.getValue("b").status)
    assertEquals(FileStatus.UNSYNCED, result.getValue("a").status)
  }

  @Test
  fun unknownBeatsUnsyncedAndSynced() {
    val rollup = tree()
    rollup.recordFile("a", FileStatus.UNSYNCED)
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("b", FileStatus.SYNCED)
    val result = rollup.finish()
    assertEquals(FileStatus.UNKNOWN, result.getValue("a").status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("b").status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("c").status)
  }

  @Test
  fun laterBetterStatusNeverImprovesADirectory() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.recordFile("c", FileStatus.SYNCED)
    rollup.recordFile("c", FileStatus.UNSYNCED)
    assertEquals(FileStatus.UNKNOWN, rollup.finish().getValue("a").status)
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
    assertEquals(FileStatus.UNKNOWN, result.getValue("left").status)
    assertEquals(FileStatus.SYNCED, result.getValue("right").status)
    assertEquals(FileStatus.SYNCED, result.getValue("right-child").status)
    assertEquals(FileStatus.UNKNOWN, result.getValue("root").status)
  }

  @Test
  fun registrationOrderDoesNotMatter() {
    val rollup = DirectoryRollup()
    rollup.registerDirectory("c", "b")
    rollup.recordFile("c", FileStatus.UNSYNCED)
    rollup.registerDirectory("b", "a")
    rollup.registerDirectory("a", null)
    assertEquals(FileStatus.UNSYNCED, rollup.finish().getValue("a").status)
  }

  @Test
  fun topLevelFilesAffectNoDirectory() {
    val rollup = tree()
    rollup.recordFile(null, FileStatus.UNKNOWN)
    assertEquals(FileStatus.SYNCED, rollup.finish().getValue("a").status)
  }

  @Test
  fun directoryIssueCodeIsAlwaysNull() {
    val rollup = tree()
    rollup.recordFile("c", FileStatus.UNKNOWN)
    rollup.finish().values.forEach { assertNull(it.issueCode) }
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
