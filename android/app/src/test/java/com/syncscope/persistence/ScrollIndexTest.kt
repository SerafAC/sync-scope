package com.syncscope.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.bridge.ScrollUnit
import java.time.ZoneId
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * `SnapshotStore.scrollIndex` (research R4, R8, contracts/cloudsync-polish.md "getScrollIndex"): the bands of a
 * query's files in the sort's order, each with a start token that pages from its first row, and the anchor index.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ScrollIndexTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var store: SnapshotStore

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    store = SnapshotStore(db)
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun theUnitFollowsTheSort() = runBlocking {
    seed()
    val units = FileSort.entries.associateWith { index(SnapshotQuery(view = FileView.GALLERY, sort = it)).unit }

    assertEquals(ScrollUnit.LETTER, units[FileSort.NAME_ASC])
    assertEquals(ScrollUnit.LETTER, units[FileSort.NAME_DESC])
    // Sixty files forty days apart span seven years.
    assertEquals(ScrollUnit.YEAR, units[FileSort.TIME_ASC])
    assertEquals(ScrollUnit.YEAR, units[FileSort.TIME_DESC])
    assertEquals(ScrollUnit.SIZE, units[FileSort.SIZE_ASC])
    assertEquals(ScrollUnit.SIZE, units[FileSort.SIZE_DESC])
  }

  @Test
  fun bandsFollowTheSortsDirectionWithTheUnknownBandLast() = runBlocking {
    seed()

    val ascending = index(SnapshotQuery(sort = FileSort.NAME_ASC, kind = FileKind.FILE))
    assertEquals("#", ascending.bands.first().letter)
    assertEquals(ascending.bands.map { it.letter }.sortedWith(compareBy<String?> { it != "#" }.thenBy { it }), ascending.bands.map { it.letter })
    val descending = index(SnapshotQuery(sort = FileSort.NAME_DESC, kind = FileKind.FILE))
    assertEquals(ascending.bands.map { it.letter }.reversed(), descending.bands.map { it.letter })

    for (sort in listOf(FileSort.SIZE_ASC, FileSort.SIZE_DESC, FileSort.TIME_ASC, FileSort.TIME_DESC)) {
      val result = index(SnapshotQuery(sort = sort, kind = FileKind.FILE))
      val known = result.bands.dropLast(1)
      assertTrue("$sort: the last band is unknown", result.bands.last().unknown)
      assertTrue("$sort: only the last band is unknown", known.none { it.unknown })
      val bounds = known.map { it.lowerBytes ?: it.startMillis!! }
      val ascendingSort = sort == FileSort.SIZE_ASC || sort == FileSort.TIME_ASC
      assertEquals("$sort", if (ascendingSort) bounds.sorted() else bounds.sortedDescending(), bounds)
      assertEquals(bounds.distinct(), bounds)
    }
  }

  @Test
  fun countsAddUpAndEachStartIndexIsTheSumBeforeIt() = runBlocking {
    seed()
    for (query in queries()) {
      val result = index(query)
      assertEquals("$query", result.totalCount, result.bands.sumOf { it.count })
      assertTrue("$query", result.bands.all { it.count > 0 })
      var sum = 0
      for (band in result.bands) {
        assertEquals("$query", sum, band.startIndex)
        sum += band.count
      }
    }
  }

  @Test
  fun pagingFromABandsStartTokenReturnsThatBandsFirstRowFirst() = runBlocking {
    seed()
    for (query in queries()) {
      val topLevel = query.view == FileView.LIST && query.parentId == null
      val rows = readAll(query, topLevel)
      val result = index(query)
      assertNull("$query", result.bands.firstOrNull()?.startToken)
      for (band in result.bands) {
        val page = store.queryFilePage(SNAPSHOT, query.copy(pageSize = 3), band.startToken, topLevelOnly = topLevel)
        assertEquals("$query band $band", rows[band.startIndex].entryId, page.entries.first().entryId)
      }
    }
  }

  @Test
  fun theScopeEqualsTheRowsScope() = runBlocking {
    seed()
    for (query in queries()) {
      val topLevel = query.view == FileView.LIST && query.parentId == null
      assertEquals("$query", readAll(query, topLevel).count { it.kind == "FILE" }, index(query).totalCount)
    }
    // Files only: a folder in the scope is not counted, so the list view's folder read stays separate.
    val folder = SnapshotQuery(sourceId = "src-1", parentId = "dir", kind = FileKind.FILE)
    assertEquals(30, index(folder).totalCount)
    assertEquals(0, index(SnapshotQuery(view = FileView.GALLERY, sourceId = "src-2")).totalCount)
    assertEquals(emptyList<ScrollIndexBand>(), index(SnapshotQuery(view = FileView.GALLERY, sourceId = "src-2")).bands)
  }

  @Test
  fun theAnchorIndexCountsTheRowsBeforeTheAnchor() = runBlocking {
    seed()
    for (sort in FileSort.entries) {
      val query = SnapshotQuery(view = FileView.GALLERY, sort = sort)
      val rows = readAll(query, topLevel = false)
      for (k in listOf(0, 1, rows.size / 2, rows.size - 1)) {
        assertEquals("$sort row $k", k, index(query, anchorOf(rows[k], sort)).anchorIndex)
      }
      assertNull("$sort without an anchor", index(query).anchorIndex)
    }
  }

  @Test
  fun aGoneAnchorGivesItsNeighboursIndex() = runBlocking {
    seed()
    for (sort in FileSort.entries) {
      val query = SnapshotQuery(view = FileView.GALLERY, sort = sort)
      val rows = readAll(query, topLevel = false)
      val k = rows.size / 3
      val gone = rows[k]
      db.localNodeDao().deleteFile(SNAPSHOT, gone.entryId)
      try {
        val result = index(query, anchorOf(gone, sort))
        assertEquals("$sort", k, result.anchorIndex)
        assertEquals(rows[k + 1].entryId, readAll(query, topLevel = false)[result.anchorIndex!!].entryId)
      } finally {
        db.localNodeDao().insertAll(listOf(nodeOf(gone)))
      }
    }
  }

  @Test
  fun anAnchorPastTheLastRowIsClampedToIt() = runBlocking {
    seed()
    val query = SnapshotQuery(view = FileView.GALLERY, sort = FileSort.NAME_ASC)
    val result = index(query, ScrollAnchor(sortValue = null, sortName = "1zzzzzz"))
    assertEquals(result.totalCount - 1, result.anchorIndex)

    val time = SnapshotQuery(view = FileView.GALLERY, sort = FileSort.TIME_DESC)
    // A null value is unknown, which sorts last; descending, names read Z to A, so "" is past every name.
    assertEquals(index(time).totalCount - 1, index(time, ScrollAnchor(sortValue = null, sortName = "")).anchorIndex)
  }

  @Test
  fun aWrongTypedSortValueGivesNoAnchorIndex() = runBlocking {
    seed()
    assertNull(index(SnapshotQuery(view = FileView.GALLERY, sort = FileSort.SIZE_DESC), ScrollAnchor("big", "1apple")).anchorIndex)
    assertNull(index(SnapshotQuery(view = FileView.GALLERY, sort = FileSort.TIME_ASC), ScrollAnchor(true, "1apple")).anchorIndex)
    assertNull(index(SnapshotQuery(view = FileView.GALLERY, sort = FileSort.NAME_ASC), ScrollAnchor(5.0, "1apple")).anchorIndex)
    // A name sort takes its key from sortName; a string value (the name) is accepted.
    assertEquals(0, index(SnapshotQuery(view = FileView.GALLERY, sort = FileSort.NAME_ASC), ScrollAnchor("x", "")).anchorIndex)
  }

  @Test
  fun aMissingOrStagedSnapshotIsNotFoundAndAReplacedOneIsStale() = runBlocking {
    seed()
    assertThrows(SnapshotNotFoundException::class.java) { runBlocking { store.scrollIndex("no-such-snapshot", SnapshotQuery()) } }

    val staged = store.beginRun("run-2", "FULL", 1L, "CONNECTING", 2_000L)
    store.stageSnapshot(stagingSnapshot("snap-2", staged.runId))
    assertThrows(SnapshotNotFoundException::class.java) { runBlocking { store.scrollIndex("snap-2", SnapshotQuery()) } }

    store.publish("run-2", staged.generation, 1L, "COMPLETED", 6_000L)
    assertThrows(StaleGenerationException::class.java) { runBlocking { store.scrollIndex(SNAPSHOT, SnapshotQuery()) } }
    assertEquals(0, store.scrollIndex("snap-2", SnapshotQuery()).totalCount)
  }

  // --- fixtures ---

  private suspend fun index(query: SnapshotQuery, anchor: ScrollAnchor? = null): ScrollIndex =
    store.scrollIndex(SNAPSHOT, query, anchor, UTC)

  /** Gallery, list top level, one folder, a filter and a source, each under every sort. */
  private fun queries(): List<SnapshotQuery> =
    FileSort.entries.flatMap { sort ->
      listOf(
        SnapshotQuery(view = FileView.GALLERY, sort = sort),
        SnapshotQuery(view = FileView.GALLERY, sort = sort, filter = FileFilter.UNSYNCED),
        SnapshotQuery(view = FileView.GALLERY, sort = sort, sourceId = "src-1", parentId = "dir"),
        SnapshotQuery(view = FileView.LIST, sort = sort, sourceId = "src-1", kind = FileKind.FILE),
        SnapshotQuery(view = FileView.LIST, sort = sort, sourceId = "src-1", parentId = "dir", kind = FileKind.FILE, filter = FileFilter.SYNCED),
      )
    }

  private suspend fun readAll(query: SnapshotQuery, topLevel: Boolean): List<FileEntry> {
    val rows = ArrayList<FileEntry>()
    var token: String? = null
    do {
      val page = store.queryFilePage(SNAPSHOT, query.copy(pageSize = 7), token, topLevelOnly = topLevel)
      rows += page.entries
      token = page.nextPageToken
    } while (token != null)
    return rows
  }

  /** The anchor a view builds from a row: a number for size and time sorts, the name for name sorts. */
  private fun anchorOf(row: FileEntry, sort: FileSort): ScrollAnchor =
    when (sort) {
      FileSort.NAME_ASC,
      FileSort.NAME_DESC -> ScrollAnchor(row.name, row.sortName)
      FileSort.TIME_ASC,
      FileSort.TIME_DESC -> ScrollAnchor(row.modifiedUtcMillis?.toDouble(), row.sortName)
      FileSort.SIZE_ASC,
      FileSort.SIZE_DESC -> ScrollAnchor(row.sizeBytes?.toDouble(), row.sortName)
    }

  private val seeded = HashMap<String, LocalNodeEntity>()

  private fun nodeOf(entry: FileEntry): LocalNodeEntity = seeded.getValue(entry.entryId)

  /**
   * Sixty image and text files in `src-1`, half under the folder `dir` and half at the top level, with `#` and
   * accented names, sizes from 1 kB to 50 MB (some unknown) and times forty days apart (some unknown).
   */
  private suspend fun seed() {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    val run = store.beginRun("run-1", "FULL", 1L, "CONNECTING", 1_000L)
    store.stageSnapshot(stagingSnapshot(SNAPSHOT, run.runId))
    val stems = listOf("apple", "Banana", "cherry", "Éclair", "2024", "_x", "mango", "zebra", "delta", "kiwi")
    val nodes = ArrayList<LocalNodeEntity>()
    nodes += localNode(SNAPSHOT, "src-1", "dir", "dir", kind = "DIRECTORY", sizeBytes = null, modifiedUtcMillis = null)
    nodes += localNode(SNAPSHOT, "src-1", "sub", "Sub", kind = "DIRECTORY", parentId = "dir", sizeBytes = null, modifiedUtcMillis = null)
    for (i in 0 until 60) {
      nodes +=
        localNode(
          SNAPSHOT,
          "src-1",
          "f$i",
          "${stems[i % stems.size]}-$i.${if (i % 4 == 0) "txt" else "jpg"}",
          parentId = if (i % 2 == 0) "dir" else null,
          mimeType = if (i % 4 == 0) "text/plain" else "image/jpeg",
          sizeBytes = if (i % 11 == 0) null else 1_000L * ((i * 37) % 50 + 1) * (if (i % 3 == 0) 1_000L else 1L),
          modifiedUtcMillis = if (i % 13 == 0) null else BASE_MILLIS + i * FORTY_DAYS,
          status = listOf("SYNCED", "UNSYNCED", "UNKNOWN")[i % 3],
        )
    }
    nodes.forEach { seeded[it.entryId] = it }
    store.stageLocalNodes(nodes)
    store.publish("run-1", run.generation, 1L, "COMPLETED", 5_000L)
  }

  private companion object {
    const val SNAPSHOT = "snap-1"
    const val BASE_MILLIS = 1_500_000_000_000L
    const val FORTY_DAYS = 40L * 24 * 60 * 60 * 1000
    val UTC: ZoneId = ZoneId.of("UTC")
  }
}
