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
  fun failedAttemptPreservesPointerAndRecordsTheAttempt() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    seedRun("run-2", 2L, "snap-2")
    store.discardRun(
      runId = "run-2",
      generation = 2L,
      terminalState = "FAILED",
      errorCode = "CONNECTION_LOST",
      summary = "Connection lost",
      nowMillis = 7_000L,
    )

    val active = store.activeSnapshot()!!
    assertEquals("snap-1", active.snapshotId)
    assertEquals("Connection lost", active.lastAttemptSummary)

    val failedRun = db.scanRunDao().byId("run-2")!!
    assertEquals("FAILED", failedRun.terminalState)
    assertEquals("CONNECTION_LOST", failedRun.errorCode)
    // The failed run's staging is reclaimed rather than left behind unpublished.
    assertNull(db.snapshotDao().byId("snap-2"))
  }

  @Test
  fun discardRunRejectsAnUnknownRunOrAWrongGeneration() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    assertThrows(StaleGenerationException::class.java) {
      runBlocking { store.discardRun("missing", 1L, "FAILED", "SERVER_ERROR", "x", 2_000L) }
    }
    assertThrows(StaleGenerationException::class.java) {
      runBlocking { store.discardRun("run-1", 9L, "FAILED", "SERVER_ERROR", "x", 2_000L) }
    }
    assertNull(db.scanRunDao().byId("run-1")!!.terminalState)
    assertNotNull(db.snapshotDao().byId("snap-1"))
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

  // --- Feature 004 additions -------------------------------------------------------------------

  @Test
  fun beginRunAssignsTheNextGenerationInOneTransaction() = runBlocking {
    val first = store.beginRun("run-a", mode = "FULL", configRevision = 3L, phase = "CONNECTING", startedAtMillis = 100L)
    val second =
      store.beginRun("run-b", mode = "LOCAL_REFRESH", configRevision = 3L, phase = "COPYING_REMOTE", startedAtMillis = 200L)

    assertEquals(1L, first.generation)
    assertEquals(2L, second.generation)
    val stored = db.scanRunDao().byId("run-b")!!
    assertEquals(second, stored)
    assertEquals("LOCAL_REFRESH", stored.mode)
    assertEquals("COPYING_REMOTE", stored.phase)
    assertEquals(3L, stored.configRevision)
    assertEquals(false, stored.includeHidden)
    assertEquals(200L, stored.startedAtMillis)
    assertNull(stored.terminalState)
    assertNull(stored.finishedAtMillis)

    // The generation follows the highest one on disk, not a count of rows.
    db.scanRunDao().insert(scanRun("run-old", generation = 7L))
    assertEquals(8L, store.beginRun("run-c", "FULL", 3L, "CONNECTING", 300L).generation)
    assertEquals("run-c", db.scanRunDao().latest()!!.runId)
  }

  @Test
  fun discardRunDeletesEveryStagedRowAndKeepsThePointer() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    stageEverything("snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    seedRun("run-2", 2L, "snap-2")
    stageEverything("snap-2")

    store.discardRun(
      runId = "run-2",
      generation = 2L,
      terminalState = "CANCELLED",
      errorCode = null,
      summary = "USER",
      nowMillis = 7_000L,
    )

    assertNull(db.snapshotDao().byId("snap-2"))
    assertEquals(0L, db.localNodeDao().countFor("snap-2"))
    assertEquals(0L, db.remoteMatchKeyDao().countFor("snap-2"))
    assertEquals(0L, db.remoteAmbiguityDao().countFor("snap-2"))
    assertEquals(emptyList<SnapshotCountsEntity>(), db.snapshotCountsDao().forSnapshot("snap-2"))

    val run = db.scanRunDao().byId("run-2")!!
    assertEquals("CANCELLED", run.terminalState)
    assertEquals("CANCELLED", run.phase)
    assertEquals(7_000L, run.finishedAtMillis)
    assertNull(run.errorCode)
    assertEquals("USER", run.errorSummary)

    val active = store.activeSnapshot()!!
    assertEquals("snap-1", active.snapshotId)
    assertEquals("USER", active.lastAttemptSummary)
    assertEquals(7_000L, active.updatedAtMillis)
    // The published snapshot and its rows are untouched.
    assertEquals(1L, db.localNodeDao().countFor("snap-1"))
    assertEquals(1L, db.remoteMatchKeyDao().countFor("snap-1"))
    assertEquals(1L, db.remoteAmbiguityDao().countFor("snap-1"))
    assertEquals(1, db.snapshotCountsDao().forSnapshot("snap-1").size)
  }

  @Test
  fun discardRunRecordsAFailureWithItsCode() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    stageEverything("snap-1")

    store.discardRun("run-1", 1L, "FAILED", "CONNECTION_REFUSED", "The server refused the connection.", 2_000L)

    val run = db.scanRunDao().byId("run-1")!!
    assertEquals("FAILED", run.terminalState)
    assertEquals("FAILED", run.phase)
    assertEquals("CONNECTION_REFUSED", run.errorCode)
    assertEquals("The server refused the connection.", run.errorSummary)
    assertNull(db.snapshotDao().byId("snap-1"))

    val active = store.activeSnapshot()!!
    assertNull(active.snapshotId)
    assertEquals("The server refused the connection.", active.lastAttemptSummary)
  }

  @Test
  fun discardRunIsANoOpForATerminalRun() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
    seedRun("run-2", 2L, "snap-2")
    store.discardRun("run-2", 2L, "CANCELLED", null, "BACKGROUNDED", 6_000L)
    val activeBefore = store.activeSnapshot()!!

    // A second discard (for example cancel racing a failure) changes nothing.
    store.discardRun("run-2", 2L, "FAILED", "CONNECTION_LOST", "lost", 8_000L)
    // Discarding a published run never deletes its snapshot.
    store.discardRun("run-1", 1L, "CANCELLED", null, "USER", 9_000L)

    val cancelled = db.scanRunDao().byId("run-2")!!
    assertEquals("CANCELLED", cancelled.terminalState)
    assertEquals("BACKGROUNDED", cancelled.errorSummary)
    assertEquals(6_000L, cancelled.finishedAtMillis)
    val published = db.scanRunDao().byId("run-1")!!
    assertEquals("COMPLETED", published.terminalState)
    assertEquals(true, db.snapshotDao().byId("snap-1")!!.publishable)
    assertEquals(activeBefore, store.activeSnapshot())
  }

  @Test
  fun copyRemoteStateCopiesKeysRemoteAmbiguitiesAndListingTime() = runBlocking {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    val from = store.beginRun("run-1", "FULL", 1L, "LISTING_REMOTE", 100L)
    store.stageSnapshot(stagingSnapshot("snap-1", from.runId, remoteListedAtMillis = 4_000L))
    store.stageMatchKeys(
      listOf(
        RemoteMatchKeyEntity(0, "snap-1", "a.txt", 10L, 1_000L, 2L, 1L),
        RemoteMatchKeyEntity(0, "snap-1", "reusable.jpg", 27L, 1_000L, 1_704_067_200L, 2L),
      )
    )
    store.stageAmbiguities(
      listOf(
        RemoteAmbiguityEntity(0, "snap-1", "REMOTE_DIRECTORY", null, null, null, "DIRECTORY_UNREADABLE"),
        RemoteAmbiguityEntity(0, "snap-1", "REMOTE_LISTING", null, null, null, "CONNECTION_LOST"),
        RemoteAmbiguityEntity(0, "snap-1", "SOURCE", "src-1", null, null, "GRANT_REVOKED"),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val to = store.beginRun("run-2", "LOCAL_REFRESH", 1L, "COPYING_REMOTE", 6_000L)
    store.stageSnapshot(stagingSnapshot("snap-2", to.runId))

    store.copyRemoteState(fromSnapshotId = "snap-1", toSnapshotId = "snap-2")

    val keyOf = { k: RemoteMatchKeyEntity -> listOf(k.name, k.sizeBytes, k.precisionMillis, k.bucket, k.duplicateCount) }
    assertEquals(
      store.matchKeys("snap-1").map(keyOf).toSet(),
      store.matchKeys("snap-2").map(keyOf).toSet(),
    )
    assertEquals(2, store.matchKeys("snap-2").size)
    assertEquals(
      setOf("REMOTE_DIRECTORY" to "DIRECTORY_UNREADABLE", "REMOTE_LISTING" to "CONNECTION_LOST"),
      store.ambiguities("snap-2").map { it.scope to it.reason }.toSet(),
    )
    assertEquals(4_000L, db.snapshotDao().byId("snap-2")!!.remoteListedAtMillis)
    // The source snapshot is unchanged.
    assertEquals(3, store.ambiguities("snap-1").size)
    assertEquals(2, store.matchKeys("snap-1").size)
  }

  @Test
  fun ambiguitiesAndCountsAreStagedAndRead() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageAmbiguities(emptyList())
    store.stageCounts(emptyList())
    assertEquals(emptyList<RemoteAmbiguityEntity>(), store.ambiguities("snap-1"))
    assertEquals(emptyList<SnapshotCountsEntity>(), store.counts("snap-1"))

    store.stageAmbiguities(
      listOf(RemoteAmbiguityEntity(0, "snap-1", "SOURCE", "src-1", null, null, "STORAGE_MISSING"))
    )
    store.stageCounts(
      listOf(
        SnapshotCountsEntity(0, "snap-1", "src-1", "SYNCED", 4L),
        SnapshotCountsEntity(0, "snap-1", null, "SYNCED", 4L),
        SnapshotCountsEntity(0, "snap-1", null, "UNKNOWN", 1L),
      )
    )

    assertEquals(
      listOf(Triple("SOURCE", "src-1", "STORAGE_MISSING")),
      store.ambiguities("snap-1").map { Triple(it.scope, it.sourceId, it.reason) },
    )
    assertEquals(
      setOf(Triple("src-1", "SYNCED", 4L), Triple(null, "SYNCED", 4L), Triple(null, "UNKNOWN", 1L)),
      store.counts("snap-1").map { Triple(it.sourceId, it.status, it.count) }.toSet(),
    )
  }

  @Test
  fun topLevelOnlyReturnsOnlyRootRowsNarrowedBySource() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    store.stageLocalNodes(
      listOf(
        localNode("snap-1", "src-1", "d1", "dir", kind = "DIRECTORY", sizeBytes = null, modifiedUtcMillis = null),
        localNode("snap-1", "src-1", "f1", "top.txt"),
        localNode("snap-1", "src-1", "f2", "child.txt", parentId = "d1"),
        localNode("snap-1", "src-2", "g1", "other.txt"),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val rootOfSource = store.queryFilePage("snap-1", SnapshotQuery(sourceId = "src-1"), null, topLevelOnly = true)
    assertEquals(listOf("d1", "f1"), rootOfSource.entries.map { it.entryId })

    val everyRoot = store.queryFilePage("snap-1", SnapshotQuery(), null, topLevelOnly = true)
    assertEquals(listOf("d1", "g1", "f1"), everyRoot.entries.map { it.entryId })

    // Without the flag, a null parentId still means "no filter".
    val unfiltered = store.queryFilePage("snap-1", SnapshotQuery(), null)
    assertEquals(setOf("d1", "f1", "f2", "g1"), unfiltered.entries.map { it.entryId }.toSet())

    val children = store.queryFilePage("snap-1", SnapshotQuery(parentId = "d1"), null)
    assertEquals(listOf("f2"), children.entries.map { it.entryId })
  }

  @Test
  fun aTopLevelPageTokenIsNotAcceptedByTheUnfilteredQuery() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageLocalNodes(
      listOf(localNode("snap-1", "src-1", "f1", "a.txt"), localNode("snap-1", "src-1", "f2", "b.txt"))
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val first = store.queryFilePage("snap-1", SnapshotQuery(pageSize = 1), null, topLevelOnly = true)
    val token = first.nextPageToken!!

    assertThrows(PageTokenMismatchException::class.java) {
      runBlocking { store.queryFilePage("snap-1", SnapshotQuery(pageSize = 1), token) }
    }
    val second = store.queryFilePage("snap-1", SnapshotQuery(pageSize = 1), token, topLevelOnly = true)
    assertEquals(listOf("f2"), second.entries.map { it.entryId })
  }

  private suspend fun stageEverything(snapshotId: String) {
    store.stageLocalNodes(listOf(localNode(snapshotId, "src-1", "e-$snapshotId", "staged.txt")))
    store.stageMatchKeys(listOf(RemoteMatchKeyEntity(0, snapshotId, "staged.txt", 10L, 1L, 2L, 1L)))
    store.stageAmbiguities(
      listOf(RemoteAmbiguityEntity(0, snapshotId, "REMOTE_DIRECTORY", null, null, null, "DIRECTORY_UNREADABLE"))
    )
    store.stageCounts(listOf(SnapshotCountsEntity(0, snapshotId, null, "SYNCED", 1L)))
  }

  private suspend fun seedRun(runId: String, generation: Long, snapshotId: String) {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    val run = store.beginRun(runId, mode = "FULL", configRevision = 1L, phase = "CONNECTING", startedAtMillis = 1_000L)
    assertEquals(generation, run.generation)
    store.stageSnapshot(stagingSnapshot(snapshotId, runId))
  }
}
