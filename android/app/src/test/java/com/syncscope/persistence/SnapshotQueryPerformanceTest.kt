package com.syncscope.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Performance budget of the browse reads (plan "Performance Goals"): on a snapshot of 50 000 files and
 * 2 000 directories over two sources, the first GALLERY page (rows, counts and the duplicate probe) and
 * the first `queryTreeChildren` page under `SYNCED` each take under [BUDGET_MILLIS], as the median of
 * [RUNS] runs after one warm-up.
 *
 * If this budget is missed or flaky on CI, record the measured value here and escalate; never raise
 * the limit silently.
 *
 * Measured locally (Robolectric, JDK 21): gallery ≈ 125 ms, top-level tree ≈ 60 ms, folder ≈ 60 ms.
 * "Select all" (`selectableEntries`) over 50 000 rows has its own budget, [SELECT_ALL_BUDGET_MILLIS]:
 * measured ≈ 120 ms in gallery and ≈ 110 ms in one folder.
 * Without the pinned duplicate-probe index the gallery page took ≈ 700 ms.
 *
 * Feature 007 (schema 5, measured 2026-10-06): a first gallery page under the six sorts ≈ 40–125 ms (the
 * slowest is `SIZE_DESC`, whose `COALESCE` key sorts in a temporary B-tree), a later page ≈ 5–90 ms, one
 * folder's files ≈ 30–55 ms. Staging 50 000 rows with the two new indexes ≈ 750 ms; no insert budget
 * existed before 007, so [INSERT_BUDGET_MILLIS] is set at about four times that.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SnapshotQueryPerformanceTest {

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
  fun firstGalleryAndTreePagesStayWithinBudget() = runBlocking {
    seed()

    val gallery = SnapshotQuery(view = FileView.GALLERY, sort = FileSort.TIME_DESC, pageSize = 100)
    val galleryMillis =
      medianMillis {
        val page = store.queryFilePage(SNAPSHOT, gallery, null)
        assertEquals(100, page.entries.size)
        assertNotNull(page.counts)
        assertTrue(page.entries.any { it.nameInOtherSource })
      }

    val tree = SnapshotQuery(filter = FileFilter.SYNCED, sourceId = "src-1", pageSize = 100)
    val treeMillis =
      medianMillis {
        val page = store.queryFilePage(SNAPSHOT, tree, null, topLevelOnly = true)
        assertEquals(TOP_DIRECTORIES_PER_SOURCE, page.entries.size)
        assertNotNull(page.counts)
      }

    val subtree = SnapshotQuery(filter = FileFilter.SYNCED, parentId = "src-1-top-0", pageSize = 100)
    val subtreeMillis =
      medianMillis {
        val page = store.queryFilePage(SNAPSHOT, subtree, null)
        assertTrue(page.entries.isNotEmpty())
        assertNotNull(page.counts)
      }

    println("SnapshotQueryPerformanceTest: gallery=${galleryMillis}ms tree=${treeMillis}ms subtree=${subtreeMillis}ms")
    assertTrue("first GALLERY page took ${galleryMillis}ms", galleryMillis < BUDGET_MILLIS)
    assertTrue("first top-level queryTreeChildren page took ${treeMillis}ms", treeMillis < BUDGET_MILLIS)
    assertTrue("first folder queryTreeChildren page took ${subtreeMillis}ms", subtreeMillis < BUDGET_MILLIS)
  }

  /**
   * Feature 007 (research R1, R18): the first page under each of the six sorts, in gallery over 50 000 files
   * and in list over one folder's files (`kind = FILE`), stays within [BUDGET_MILLIS], and so does a later page
   * read through a token.
   */
  @Test
  fun aPageUnderEachSortStaysWithinBudget() = runBlocking {
    seed()
    val timings = mutableListOf<String>()
    for (sort in FileSort.entries) {
      val gallery = SnapshotQuery(view = FileView.GALLERY, sort = sort, pageSize = 100)
      val galleryMillis =
        medianMillis {
          val page = store.queryFilePage(SNAPSHOT, gallery, null)
          assertEquals(100, page.entries.size)
          assertNotNull(page.nextPageToken)
        }
      val token = store.queryFilePage(SNAPSHOT, gallery, null).nextPageToken
      val nextMillis = medianMillis { assertEquals(100, store.queryFilePage(SNAPSHOT, gallery, token).entries.size) }
      val folder = SnapshotQuery(sourceId = "src-1", parentId = "src-1-top-0-sub-0", sort = sort, kind = FileKind.FILE, pageSize = 100)
      val folderMillis = medianMillis { assertTrue(store.queryFilePage(SNAPSHOT, folder, null).entries.isNotEmpty()) }

      timings += "$sort gallery=${galleryMillis}ms next=${nextMillis}ms folder=${folderMillis}ms"
      assertTrue("first GALLERY page under $sort took ${galleryMillis}ms", galleryMillis < BUDGET_MILLIS)
      assertTrue("second GALLERY page under $sort took ${nextMillis}ms", nextMillis < BUDGET_MILLIS)
      assertTrue("first folder page under $sort took ${folderMillis}ms", folderMillis < BUDGET_MILLIS)
    }
    println("SnapshotQueryPerformanceTest: " + timings.joinToString("; "))
  }

  /**
   * Staging 50 000 `local_node` rows, with schema 5's two added indexes `(snapshotId, kind, sizeBytes)` and
   * `(snapshotId, kind, sortName)`, stays within [INSERT_BUDGET_MILLIS] (research R18). If it fails, drop the
   * `sortName` index first (plan › Risks) and record it in research R18.
   */
  @Test
  fun stagingFiftyThousandRowsStaysWithinBudget() = runBlocking {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    val run = store.beginRun("run-1", "FULL", 1L, "CONNECTING", 1_000L)
    store.stageSnapshot(stagingSnapshot(SNAPSHOT, run.runId))
    val batches =
      (0 until SELECT_ALL_ROWS).chunked(5_000).map { chunk ->
        chunk.map { i ->
          localNode(SNAPSHOT, "src-1", "f$i", "IMG_$i.jpg", mimeType = "image/jpeg", sizeBytes = (i * 7_919L) % 10_000_000L)
        }
      }
    // Warm the insert path with 5 000 other rows so JIT and statement caches do not count.
    store.stageLocalNodes(batches.first().map { it.copy(entryId = "warm-${it.entryId}") })

    val start = System.nanoTime()
    for (batch in batches) store.stageLocalNodes(batch)
    val millis = (System.nanoTime() - start) / 1_000_000

    println("SnapshotQueryPerformanceTest: insert 50k=${millis}ms")
    assertEquals(SELECT_ALL_ROWS + 5_000L, db.localNodeDao().countFor(SNAPSHOT))
    assertTrue("staging $SELECT_ALL_ROWS rows took ${millis}ms", millis < INSERT_BUDGET_MILLIS)
  }

  /** "Select all" over 50 000 matching rows returns them in one read under [SELECT_ALL_BUDGET_MILLIS]. */
  @Test
  fun selectAllOverFiftyThousandRowsStaysWithinBudget() = runBlocking {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    val run = store.beginRun("run-1", "FULL", 1L, "CONNECTING", 1_000L)
    store.stageSnapshot(stagingSnapshot(SNAPSHOT, run.runId))
    store.stageLocalNodes(listOf(directory("src-1", "dir", "Camera", null)))
    val files = ArrayList<LocalNodeEntity>(5_000)
    for (i in 0 until SELECT_ALL_ROWS) {
      files +=
        localNode(
          SNAPSHOT,
          "src-1",
          "f$i",
          "IMG_$i.jpg",
          parentId = "dir",
          mimeType = "image/jpeg",
          sizeBytes = if (i % 10 == 0) null else 1_000L + i,
          status = listOf("SYNCED", "UNSYNCED", "UNKNOWN")[i % 3],
        )
      if (files.size == 5_000) {
        store.stageLocalNodes(files)
        files.clear()
      }
    }
    store.stageLocalNodes(files)
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val gallery = SnapshotQuery(view = FileView.GALLERY)
    val galleryMillis = medianMillis { assertEquals(SELECT_ALL_ROWS, store.selectableEntries(SNAPSHOT, gallery).entryIds.size) }
    val folder = SnapshotQuery(sourceId = "src-1", parentId = "dir")
    val folderMillis = medianMillis { assertEquals(SELECT_ALL_ROWS, store.selectableEntries(SNAPSHOT, folder).entryIds.size) }

    println("SnapshotQueryPerformanceTest: selectAll gallery=${galleryMillis}ms folder=${folderMillis}ms")
    assertTrue("select all in gallery took ${galleryMillis}ms", galleryMillis < SELECT_ALL_BUDGET_MILLIS)
    assertTrue("select all in a folder took ${folderMillis}ms", folderMillis < SELECT_ALL_BUDGET_MILLIS)
  }

  private suspend fun medianMillis(read: suspend () -> Unit): Long {
    read() // warm-up
    val samples =
      (1..RUNS).map {
        val start = System.nanoTime()
        read()
        (System.nanoTime() - start) / 1_000_000
      }
    return samples.sorted()[RUNS / 2]
  }

  /**
   * Each source has [TOP_DIRECTORIES_PER_SOURCE] top-level directories with
   * [SUBDIRECTORIES_PER_TOP] subdirectories each (2 000 directories in all); 25 000 files per source
   * are spread over the subdirectories. Half the files are images, and 5 % of names are twins of a
   * file in the other source.
   */
  private suspend fun seed() {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    val run = store.beginRun("run-1", "FULL", 1L, "CONNECTING", 1_000L)
    store.stageSnapshot(stagingSnapshot(SNAPSHOT, run.runId))

    val statuses = listOf("SYNCED", "UNSYNCED", "UNKNOWN")
    for ((sourceIndex, source) in listOf("src-1", "src-2").withIndex()) {
      val directories = mutableListOf<LocalNodeEntity>()
      val leaves = mutableListOf<String>()
      for (t in 0 until TOP_DIRECTORIES_PER_SOURCE) {
        val top = "$source-top-$t"
        directories += directory(source, top, "Top $t", null)
        for (s in 0 until SUBDIRECTORIES_PER_TOP) {
          val sub = "$top-sub-$s"
          directories += directory(source, sub, "Sub $s", top)
          leaves += sub
        }
      }
      store.stageLocalNodes(directories)

      val files = ArrayList<LocalNodeEntity>(FILES_PER_SOURCE)
      for (i in 0 until FILES_PER_SOURCE) {
        val image = i % 2 == 0
        // 5 % of the names exist in both sources; the rest carry their source in the name.
        val name = if (i % 20 == 0) "twin-$i.jpg" else "s$sourceIndex-file-$i.${if (image) "jpg" else "txt"}"
        files +=
          localNode(
            SNAPSHOT,
            source,
            "$source-f$i",
            name,
            parentId = leaves[i % leaves.size],
            mimeType = if (image || i % 20 == 0) "image/jpeg" else "text/plain",
            status = statuses[i % statuses.size],
            modifiedUtcMillis = if (i % 97 == 0) null else 1_000_000L + i * 7L + sourceIndex,
            // Sizes spread over 0–10 MB in a scrambled order, 2 % unknown, so a size sort is a real sort.
            sizeBytes = if (i % 50 == 1) null else (i * 7_919L) % 10_000_000L,
          )
        if (files.size == 5_000) {
          store.stageLocalNodes(files)
          files.clear()
        }
      }
      store.stageLocalNodes(files)
    }
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
    assertEquals(52_000L, db.localNodeDao().countFor(SNAPSHOT))
  }

  private fun directory(source: String, id: String, name: String, parent: String?) =
    localNode(SNAPSHOT, source, id, name, kind = "DIRECTORY", parentId = parent, sizeBytes = null, modifiedUtcMillis = null)
      .copy(descSynced = 10L, descUnsynced = 10L, descUnknown = 5L)

  private companion object {
    const val SNAPSHOT = "snap-perf"
    const val BUDGET_MILLIS = 300L
    const val RUNS = 5
    const val TOP_DIRECTORIES_PER_SOURCE = 10
    const val SUBDIRECTORIES_PER_TOP = 99
    const val FILES_PER_SOURCE = 25_000
    const val SELECT_ALL_ROWS = 50_000
    const val SELECT_ALL_BUDGET_MILLIS = 1_000L
    const val INSERT_BUDGET_MILLIS = 3_000L
  }
}
