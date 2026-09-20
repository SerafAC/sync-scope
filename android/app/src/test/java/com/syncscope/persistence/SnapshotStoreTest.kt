package com.syncscope.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SnapshotStoreTest {

  private lateinit var db: SyncScopeDatabase
  private lateinit var store: SnapshotStore

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db =
      Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java)
        .allowMainThreadQueries()
        .build()
    store = SnapshotStore(db)
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun publishSwapsPointerAtomically() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageLocalNodes(listOf(localNode("snap-1", "src-1", "e1", "a.txt")))

    // Staging rows are never visible before publication.
    assertThrows(SnapshotNotFoundException::class.java) {
      runBlocking { store.queryFilePage("snap-1", SnapshotQuery(), null) }
    }

    store.publish(runId = "run-1", generation = 1L, configRevision = 1L, terminalState = "COMPLETED", nowMillis = 5_000L)

    val active = store.activeSnapshot()
    assertNotNull(active)
    assertEquals("snap-1", active!!.snapshotId)
    assertNull(active.staleReason)

    val page = store.queryFilePage("snap-1", SnapshotQuery(), null)
    assertEquals(listOf("e1"), page.entries.map { it.entryId })

    val run = db.scanRunDao().byId("run-1")!!
    assertEquals("COMPLETED", run.terminalState)
    assertEquals(5_000L, run.finishedAtMillis)
  }

  @Test
  fun staleGenerationCannotPublishOrRewriteLastKnownGood() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
    val before = store.activeSnapshot()!!

    seedRun("run-2", 2L, "snap-2")
    store.stageLocalNodes(listOf(localNode("snap-2", "src-1", "e9", "z.txt")))

    // A stale generation must not publish.
    assertThrows(StaleGenerationException::class.java) {
      runBlocking { store.publish("run-2", generation = 1L, configRevision = 1L, terminalState = "COMPLETED", nowMillis = 6_000L) }
    }
    // A replayed publication of an already-terminal run must not publish.
    assertThrows(StaleGenerationException::class.java) {
      runBlocking { store.publish("run-1", 1L, 1L, "COMPLETED", 6_500L) }
    }

    val after = store.activeSnapshot()!!
    assertEquals(before.snapshotId, after.snapshotId)
    assertEquals(before.updatedAtMillis, after.updatedAtMillis)
    assertEquals("snap-1", after.snapshotId)
    // snap-2 remains unpublished staging.
    assertEquals(false, db.snapshotDao().byId("snap-2")!!.publishable)
  }

  @Test
  fun failedAttemptPreservesPointerAndRecordsStaleContext() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    seedRun("run-2", 2L, "snap-2")
    store.recordFailedAttempt(
      runId = "run-2",
      generation = 2L,
      terminalState = "FAILED",
      errorCode = "TRANSPORT",
      summary = "Connection lost",
      staleReason = "REFRESH_FAILED",
      nowMillis = 7_000L,
    )

    val active = store.activeSnapshot()!!
    assertEquals("snap-1", active.snapshotId)
    assertEquals("REFRESH_FAILED", active.staleReason)
    assertEquals("Connection lost", active.lastAttemptSummary)

    val failedRun = db.scanRunDao().byId("run-2")!!
    assertEquals("FAILED", failedRun.terminalState)
    assertEquals("TRANSPORT", failedRun.errorCode)
    assertEquals(false, db.snapshotDao().byId("snap-2")!!.publishable)
  }

  @Test
  fun failedAttemptWithNoPriorSnapshotLeavesPointerEmpty() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.recordFailedAttempt("run-1", 1L, "FAILED", "AUTH", "Bad credentials", "REFRESH_FAILED", 2_000L)

    val active = store.activeSnapshot()!!
    assertNull(active.snapshotId)
    assertEquals("REFRESH_FAILED", active.staleReason)
  }

  @Test
  fun abandonedRunsAreAbortedAndStagingReclaimedOnReopen() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    // Simulate a run left RUNNING by process death.
    seedRun("run-2", 2L, "snap-2")
    store.stageLocalNodes(listOf(localNode("snap-2", "src-1", "e5", "orphan.txt")))
    store.stageMatchKeys(
      listOf(RemoteMatchKeyEntity(0, "snap-2", "orphan.txt", 10L, 1L, 2L, 1L))
    )

    store.abortAbandonedRuns(nowMillis = 9_000L)

    val abandoned = db.scanRunDao().byId("run-2")!!
    assertEquals("ABORTED", abandoned.terminalState)
    assertEquals(9_000L, abandoned.finishedAtMillis)

    // Staging rows are reclaimed; the active snapshot is untouched.
    assertNull(db.snapshotDao().byId("snap-2"))
    assertEquals(0L, db.localNodeDao().countFor("snap-2"))
    assertEquals(0L, db.remoteMatchKeyDao().countFor("snap-2"))
    assertEquals("snap-1", store.activeSnapshot()!!.snapshotId)

    // Cleanup is idempotent.
    store.abortAbandonedRuns(nowMillis = 10_000L)
    assertEquals(9_000L, db.scanRunDao().byId("run-2")!!.finishedAtMillis)
  }

  private suspend fun seedRun(runId: String, generation: Long, snapshotId: String) {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    store.beginRun(scanRun(runId, generation))
    store.stageSnapshot(stagingSnapshot(snapshotId, runId))
  }
}
