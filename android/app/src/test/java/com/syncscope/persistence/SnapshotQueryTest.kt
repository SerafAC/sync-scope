package com.syncscope.persistence

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class SnapshotQueryTest {

  @Test
  fun pageSizeIsBoundedByTheBridgeContract() {
    assertEquals(SnapshotQuery.DEFAULT_PAGE_SIZE, SnapshotQuery.boundedPageSize(null))
    assertEquals(1, SnapshotQuery.boundedPageSize(0))
    assertEquals(1, SnapshotQuery.boundedPageSize(-5))
    assertEquals(75, SnapshotQuery.boundedPageSize(75))
    assertEquals(SnapshotQuery.MAX_PAGE_SIZE, SnapshotQuery.boundedPageSize(10_000))
    assertEquals(200, SnapshotQuery.MAX_PAGE_SIZE)
  }

  @Test
  fun rejectsUnboundedSearchText() {
    assertThrows(IllegalArgumentException::class.java) {
      SnapshotQuery(search = "x".repeat(SnapshotQuery.MAX_SEARCH_LENGTH + 1))
    }
  }

  @Test
  fun fingerprintChangesWithEveryQueryDimension() {
    val base = SnapshotQuery()
    assertNotEquals(base.fingerprint(), base.copy(filter = FileFilter.SYNCED).fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(view = FileView.GALLERY).fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(sort = FileSort.TIME_DESC).fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(sourceId = "s1").fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(parentId = "p1").fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(search = "abc").fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(sort = FileSort.SIZE_DESC).fingerprint())
    assertNotEquals(base.fingerprint(), base.copy(kind = FileKind.FILE).fingerprint())
    // Two specs that differ only in kind select different rows (research R3).
    assertNotEquals(base.copy(kind = FileKind.FILE).fingerprint(), base.copy(kind = FileKind.DIRECTORY).fingerprint())
    // Page size never changes which rows match, only how many are returned.
    assertEquals(base.fingerprint(), base.copy(pageSize = 10).fingerprint())
  }
}
