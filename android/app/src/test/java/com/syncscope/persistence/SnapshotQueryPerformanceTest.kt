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
 * Without the pinned duplicate-probe index the gallery page took ≈ 700 ms.
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
            modifiedUtcMillis = 1_000_000L + i * 7L + sourceIndex,
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
  }
}
