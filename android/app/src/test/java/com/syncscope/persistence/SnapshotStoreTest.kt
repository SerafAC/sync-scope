package com.syncscope.persistence

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.syncscope.deletion.DeletionOutcome
import com.syncscope.deletion.DeletionRow
import com.syncscope.deletion.DeletionState
import kotlin.random.Random
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
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
  fun copyRemoteStateCarriesTheServerDirectoriesOfEachKey() = runBlocking {
    db.sourceRootDao().upsert(sourceRoot("src-1"))
    val from = store.beginRun("run-1", "FULL", 1L, "LISTING_REMOTE", 100L)
    store.stageSnapshot(stagingSnapshot("snap-1", from.runId, remoteListedAtMillis = 4_000L))
    store.stageMatchKeys(
      listOf(
        RemoteMatchKeyEntity(0, "snap-1", "a.png", 10L, 1_000L, 2L, 2L, directories = "/photos/2024\n/photos/old"),
        RemoteMatchKeyEntity(0, "snap-1", "b.png", 11L, 1_000L, 3L, 1L, directories = null),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
    val to = store.beginRun("run-2", "LOCAL_REFRESH", 1L, "COPYING_REMOTE", 6_000L)
    store.stageSnapshot(stagingSnapshot("snap-2", to.runId))

    store.copyRemoteState(fromSnapshotId = "snap-1", toSnapshotId = "snap-2")

    assertEquals(
      mapOf("a.png" to "/photos/2024\n/photos/old", "b.png" to null),
      store.matchKeys("snap-2").associate { it.name to it.directories },
    )
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

  // --- Feature 005 read rules (data-model.md "Read rules") ----------------------------------------

  @Test
  fun directoriesIgnoreTheFilterUnderAParentOrAtTheTopLevel() = runBlocking {
    seedBrowseFixture()

    val inD1 = store.queryFilePage("snap-1", SnapshotQuery(filter = FileFilter.SYNCED, parentId = "d1"), null)
    // d2's descendants are all UNSYNCED, yet the directory is returned; f6 (UNKNOWN) is narrowed away.
    assertEquals(listOf("d2", "f3"), inD1.entries.map { it.entryId })
    assertEquals(0L, inD1.entries.single { it.entryId == "d2" }.matchingFileCount)

    val top =
      store.queryFilePage("snap-1", SnapshotQuery(filter = FileFilter.SYNCED, sourceId = "src-1"), null, topLevelOnly = true)
    assertEquals(listOf("dLegacy", "d1", "f7"), top.entries.map { it.entryId })

    val unsyncedTop =
      store.queryFilePage("snap-1", SnapshotQuery(filter = FileFilter.UNSYNCED, sourceId = "src-1"), null, topLevelOnly = true)
    assertEquals(listOf("f8", "dLegacy", "d1", "f1"), unsyncedTop.entries.map { it.entryId })

    // queryFiles without a parent keeps 004's behaviour: the filter applies to every row.
    val flat = store.queryFilePage("snap-1", SnapshotQuery(filter = FileFilter.SYNCED), null)
    assertEquals(setOf("dLegacy", "f3", "f7", "g1"), flat.entries.map { it.entryId }.toSet())
  }

  @Test
  fun matchingFileCountFollowsTheFilter() = runBlocking {
    seedBrowseFixture()
    val expectedD1 =
      mapOf(FileFilter.ALL to 4L, FileFilter.SYNCED to 1L, FileFilter.UNSYNCED to 2L, FileFilter.ISSUES_UNKNOWN to 1L)
    val expectedD2 =
      mapOf(FileFilter.ALL to 2L, FileFilter.SYNCED to 0L, FileFilter.UNSYNCED to 2L, FileFilter.ISSUES_UNKNOWN to 0L)

    for (filter in FileFilter.entries) {
      val top = store.queryFilePage("snap-1", SnapshotQuery(filter = filter, sourceId = "src-1"), null, topLevelOnly = true)
      val byId = top.entries.associateBy { it.entryId }
      assertEquals("d1 under $filter", expectedD1[filter], byId.getValue("d1").matchingFileCount)
      assertNull("pre-v3 directory under $filter", byId.getValue("dLegacy").matchingFileCount)
      for (file in top.entries.filter { it.kind == "FILE" }) {
        assertNull("file ${file.entryId} under $filter", file.matchingFileCount)
      }

      val inD1 = store.queryFilePage("snap-1", SnapshotQuery(filter = filter, parentId = "d1"), null)
      assertEquals("d2 under $filter", expectedD2[filter], inD1.entries.single { it.entryId == "d2" }.matchingFileCount)
    }
  }

  @Test
  fun aDirectoryWithOnlySomeNullCountsHasNoMatchingFileCount() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageLocalNodes(
      listOf(
        localNode("snap-1", "src-1", "d1", "dir", kind = "DIRECTORY", sizeBytes = null)
          .copy(descSynced = 3L, descUnsynced = null, descUnknown = 0L)
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val page = store.queryFilePage("snap-1", SnapshotQuery(), null, topLevelOnly = true)
    assertNull(page.entries.single().matchingFileCount)
  }

  @Test
  fun galleryReturnsImageFilesOnly() = runBlocking {
    seedBrowseFixture()

    val gallery =
      store.queryFilePage("snap-1", SnapshotQuery(view = FileView.GALLERY, sort = FileSort.TIME_DESC), null)

    assertEquals(setOf("f3", "f6", "f7", "f8", "g1", "g2"), gallery.entries.map { it.entryId }.toSet())
    assertTrue(gallery.entries.all { it.kind == "FILE" && it.mimeType!!.startsWith("image/") })
  }

  @Test
  fun firstPageCountsAreScopedByViewAndSourceOnly() = runBlocking {
    seedBrowseFixture()
    val everyFile = mapOf("SYNCED" to 3L, "UNSYNCED" to 5L, "UNKNOWN" to 2L)

    // LIST: every FILE of the snapshot, whatever the filter, parent or search.
    assertEquals(everyFile, countsOf(SnapshotQuery()))
    assertEquals(
      everyFile,
      countsOf(SnapshotQuery(filter = FileFilter.SYNCED, parentId = "d1", search = "zzz")),
    )
    // GALLERY: images only.
    val images = mapOf("SYNCED" to 3L, "UNSYNCED" to 1L, "UNKNOWN" to 2L)
    assertEquals(images, countsOf(SnapshotQuery(view = FileView.GALLERY)))
    assertEquals(images, countsOf(SnapshotQuery(view = FileView.GALLERY, filter = FileFilter.UNSYNCED)))
    // sourceId narrows the counts.
    assertEquals(mapOf("SYNCED" to 1L, "UNKNOWN" to 1L), countsOf(SnapshotQuery(view = FileView.GALLERY, sourceId = "src-2")))
    assertEquals(
      mapOf("SYNCED" to 2L, "UNSYNCED" to 4L, "UNKNOWN" to 1L),
      countsOf(SnapshotQuery(filter = FileFilter.UNSYNCED, sourceId = "src-1"), topLevelOnly = true),
    )
    // Later pages carry no counts.
    val first = store.queryFilePage("snap-1", SnapshotQuery(view = FileView.GALLERY, pageSize = 1), null)
    assertNull(store.queryFilePage("snap-1", SnapshotQuery(view = FileView.GALLERY, pageSize = 1), first.nextPageToken).counts)
  }

  @Test
  fun nameInOtherSourceIsAnExactNameTwinInAnotherSourceForGalleryReadsOnly() = runBlocking {
    seedBrowseFixture()

    val gallery = store.queryFilePage("snap-1", SnapshotQuery(view = FileView.GALLERY), null)
    val twin = gallery.entries.associate { it.entryId to it.nameInOtherSource }
    assertEquals(
      // a.png is in both sources; dup.png only twins inside src-1; Case.png vs case.png differ in case.
      mapOf("f3" to true, "g1" to true, "f6" to false, "f7" to false, "f8" to false, "g2" to false),
      twin,
    )

    val list = store.queryFilePage("snap-1", SnapshotQuery(), null)
    assertTrue(list.entries.isNotEmpty())
    assertTrue(list.entries.none { it.nameInOtherSource })
    val listInD1 = store.queryFilePage("snap-1", SnapshotQuery(parentId = "d1"), null)
    assertTrue(listInD1.entries.none { it.nameInOtherSource })
  }

  @Test
  fun keysetPagingReturnsEveryRowOnceUnderEachRule() = runBlocking {
    seedBrowseFixture()
    val cases =
      listOf(
        SnapshotQuery(view = FileView.GALLERY, sort = FileSort.TIME_DESC) to false,
        SnapshotQuery(view = FileView.GALLERY, filter = FileFilter.SYNCED, sort = FileSort.NAME_ASC) to false,
        SnapshotQuery(filter = FileFilter.SYNCED, parentId = "d1") to false,
        SnapshotQuery(filter = FileFilter.UNSYNCED, sourceId = "src-1") to true,
        SnapshotQuery(filter = FileFilter.ISSUES_UNKNOWN, sort = FileSort.TIME_ASC) to true,
      )
    for ((query, topLevelOnly) in cases) {
      val whole = store.queryFilePage("snap-1", query.copy(pageSize = 200), null, topLevelOnly)
      val paged = mutableListOf<FileEntry>()
      var token: String? = null
      do {
        val page = store.queryFilePage("snap-1", query.copy(pageSize = 2), token, topLevelOnly)
        paged += page.entries
        token = page.nextPageToken
        assertTrue("$query top=$topLevelOnly never ends", paged.size <= whole.entries.size)
      } while (token != null)
      assertEquals("$query top=$topLevelOnly", whole.entries, paged)
      assertEquals("$query top=$topLevelOnly", paged.size, paged.map { it.entryId }.toSet().size)
    }
  }

  @Test
  fun aPageTokenMintedUnderTheOldRulesIsStillAccepted() = runBlocking {
    seedBrowseFixture()
    val query = SnapshotQuery(view = FileView.GALLERY, sort = FileSort.NAME_ASC, pageSize = 2)
    // The fingerprint did not change in contract 4, so a token written by 004 replays as-is.
    assertEquals("f=ALL|v=GALLERY|s=NAME_ASC|src=|p=|q=", query.fingerprint())
    val legacyToken =
      PageTokenCodec.encode(snapshotId = "snap-1", queryFingerprint = query.fingerprint(), sortKey = "Case.png", lastEntryId = "f8")

    val page = store.queryFilePage("snap-1", query, legacyToken)

    assertEquals(listOf("f3", "g1"), page.entries.map { it.entryId })
  }

  @Test
  fun imageEntryReturnsTheDocumentOfAPublishedFileOnly() = runBlocking {
    seedBrowseFixture()

    assertEquals(
      ImageEntry(documentUri = "content://provider/doc/f3", mimeType = "image/png"),
      store.imageEntry("snap-1", "f3"),
    )
    // A directory and an unknown entry have no image.
    assertNull(store.imageEntry("snap-1", "d1"))
    assertNull(store.imageEntry("snap-1", "no-such-entry"))
    // An entry of another snapshot is unknown here.
    seedRun("run-2", 2L, "snap-2")
    store.stageLocalNodes(listOf(localNode("snap-2", "src-1", "s2", "staged.png", mimeType = "image/png")))
    // A staged (unpublished) or missing snapshot is not readable.
    assertThrows(SnapshotNotFoundException::class.java) { runBlocking { store.imageEntry("snap-2", "s2") } }
    assertThrows(SnapshotNotFoundException::class.java) { runBlocking { store.imageEntry("missing", "f3") } }
    assertNull(store.imageEntry("snap-1", "s2"))
  }

  // --- Feature 006: selectableEntries ("Select all", contracts/cloudsync-mvp.md) ----------------

  @Test
  fun selectableEntriesInGalleryAreImageFilesUnderEveryFilter() = runBlocking {
    seedBrowseFixture()
    val expected =
      mapOf(
        FileFilter.ALL to setOf("f3", "f6", "f7", "f8", "g1", "g2"),
        FileFilter.SYNCED to setOf("f3", "f7", "g1"),
        FileFilter.UNSYNCED to setOf("f8"),
        FileFilter.ISSUES_UNKNOWN to setOf("f6", "g2"),
      )
    for ((filter, ids) in expected) {
      val selectable = store.selectableEntries("snap-1", SnapshotQuery(view = FileView.GALLERY, filter = filter))
      assertEquals("gallery $filter", ids, selectable.entryIds.toSet())
      assertEquals("gallery $filter", selectable.entryIds.size, ids.size)
      assertTrue("gallery $filter images only", selectable.images.all { it })
    }
    // sourceId narrows the gallery as it narrows queryFiles.
    val src2 = store.selectableEntries("snap-1", SnapshotQuery(view = FileView.GALLERY, sourceId = "src-2"))
    assertEquals(setOf("g1", "g2"), src2.entryIds.toSet())
  }

  @Test
  fun selectableEntriesInListAreTheDirectFileChildrenOfTheFolderInItsSource() = runBlocking {
    seedBrowseFixture()

    val inD1 = store.selectableEntries("snap-1", SnapshotQuery(sourceId = "src-1", parentId = "d1"))
    // d2 is a directory and is never returned; f4 and f5 live below d2, not directly in d1.
    assertEquals(setOf("f3", "f6"), inD1.entryIds.toSet())
    assertEquals(mapOf("f3" to "SYNCED", "f6" to "UNKNOWN"), inD1.entryIds.zip(inD1.statuses).toMap())

    val syncedInD1 =
      store.selectableEntries("snap-1", SnapshotQuery(filter = FileFilter.SYNCED, sourceId = "src-1", parentId = "d1"))
    assertEquals(listOf("f3"), syncedInD1.entryIds)

    // No parentId: the top level of that one source only; dLegacy and d1 are directories.
    val top = store.selectableEntries("snap-1", SnapshotQuery(sourceId = "src-1"))
    assertEquals(setOf("f1", "f7", "f8"), top.entryIds.toSet())
    assertEquals(
      mapOf("f1" to false, "f7" to true, "f8" to true),
      top.entryIds.zip(top.images.toList()).toMap(),
    )
    val unsyncedTop =
      store.selectableEntries("snap-1", SnapshotQuery(filter = FileFilter.UNSYNCED, sourceId = "src-1"))
    assertEquals(setOf("f1", "f8"), unsyncedTop.entryIds.toSet())

    val otherSource = store.selectableEntries("snap-1", SnapshotQuery(sourceId = "src-2"))
    assertEquals(setOf("g1", "g2", "g3"), otherSource.entryIds.toSet())
  }

  @Test
  fun selectableEntriesInListRequireASource() = runBlocking {
    seedBrowseFixture()
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { store.selectableEntries("snap-1", SnapshotQuery(parentId = "d1")) }
    }
    Unit
  }

  @Test
  fun selectableEntriesIgnorePageSizeSortAndSearch() = runBlocking {
    seedBrowseFixture()
    val cases =
      listOf(
        SnapshotQuery(view = FileView.GALLERY),
        SnapshotQuery(sourceId = "src-1", parentId = "d1"),
        SnapshotQuery(sourceId = "src-1"),
      )
    for (query in cases) {
      val plain = store.selectableEntries("snap-1", query)
      val narrowed =
        store.selectableEntries("snap-1", query.copy(pageSize = 1, sort = FileSort.TIME_DESC, search = "zzz"))
      assertTrue("$query is not empty", plain.entryIds.isNotEmpty())
      assertEquals("$query", plain.entryIds.toSet(), narrowed.entryIds.toSet())
    }
  }

  @Test
  fun selectableEntriesReportAnUnknownSizeAsMinusOne() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageLocalNodes(
      listOf(
        localNode("snap-1", "src-1", "known", "known.png", mimeType = "image/png", sizeBytes = 70L),
        localNode("snap-1", "src-1", "unknown", "unknown.png", mimeType = "image/png", sizeBytes = null),
        localNode("snap-1", "src-1", "untyped", "untyped", mimeType = null, sizeBytes = 5L),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val list = store.selectableEntries("snap-1", SnapshotQuery(sourceId = "src-1"))
    assertEquals(3, list.sizes.size)
    assertEquals(3, list.statuses.size)
    assertEquals(3, list.images.size)
    assertEquals(
      mapOf("known" to 70L, "unknown" to -1L, "untyped" to 5L),
      list.entryIds.zip(list.sizes.toList()).toMap(),
    )
    // A file without a MIME type is not an image.
    assertEquals(
      mapOf("known" to true, "unknown" to true, "untyped" to false),
      list.entryIds.zip(list.images.toList()).toMap(),
    )
  }

  @Test
  fun selectableEntriesOfAStagedOrMissingSnapshotAreNotReadable() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    store.stageLocalNodes(listOf(localNode("snap-1", "src-1", "s1", "staged.png", mimeType = "image/png")))
    assertThrows(SnapshotNotFoundException::class.java) {
      runBlocking { store.selectableEntries("snap-1", SnapshotQuery(view = FileView.GALLERY)) }
    }
    assertThrows(SnapshotNotFoundException::class.java) {
      runBlocking { store.selectableEntries("missing", SnapshotQuery(view = FileView.GALLERY)) }
    }
    Unit
  }

  // --- deletionRows (data-model "Deletion plan") ---

  @Test
  fun deletionRowsLoadsOnlyFileRowsInRequestOrder() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()

    val rows = store.deletionRows("snap-1", listOf("f4", "d1", "ghost", "f3", "f4", "g1"))

    assertEquals(listOf("f4", "f3", "g1"), rows.map { it.entryId })
    val f4 = nodes.getValue("f4")
    assertEquals(
      com.syncscope.deletion.DeletionRow(
        entryId = "f4",
        sourceId = f4.sourceId,
        parentId = f4.parentId,
        documentUri = f4.documentUri,
        name = f4.name,
        sizeBytes = f4.sizeBytes,
        modifiedUtcMillis = f4.modifiedUtcMillis,
        status = f4.status,
      ),
      rows.first(),
    )
    assertEquals("snap-1", store.activeSnapshotId())
  }

  @Test
  fun deletionRowsReadsMoreIdsThanOneQueryBinds() = runBlocking {
    seedRun("run-1", 1L, "snap-1")
    val count = SnapshotStore.MAX_IDS_PER_QUERY * 2 + 3
    store.stageLocalNodes((1..count).map { localNode("snap-1", "src-1", "e$it", "f$it.png") })
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)

    val ids = (count downTo 1).map { "e$it" }
    assertEquals(ids, store.deletionRows("snap-1", ids).map { it.entryId })
  }

  // --- recordDeletions (data-model "Deletion write rule", research R14) ---

  @Test
  fun recordDeletionsRemovesOnlyDeletedAndAlreadyGoneRows() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()

    store.recordDeletions(
      "snap-1",
      listOf(
        outcome(nodes, "f3", DeletionState.DELETED),
        outcome(nodes, "f4", DeletionState.ALREADY_GONE),
        outcome(nodes, "f5", DeletionState.CHANGED),
        outcome(nodes, "f6", DeletionState.ACCESS_LOST),
        outcome(nodes, "f7", DeletionState.FAILED),
        outcome(nodes, "f8", DeletionState.SKIPPED_UNSYNCED),
      ),
    )

    val remaining = nodesById().keys
    assertFalse("f3" in remaining)
    assertFalse("f4" in remaining)
    assertTrue(remaining.containsAll(listOf("f1", "f5", "f6", "f7", "f8", "g1", "d1", "d2", "dLegacy")))
    assertDeletionInvariant("snap-1")
  }

  @Test
  fun recordDeletionsDecrementsCountsAndEveryAncestorByStatus() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()

    // f4 (UNSYNCED) sits in d2 inside d1; f6 (UNKNOWN) in d1; f7 (SYNCED) at the top level of src-1.
    store.recordDeletions(
      "snap-1",
      listOf(
        outcome(nodes, "f4", DeletionState.DELETED),
        outcome(nodes, "f6", DeletionState.DELETED),
        outcome(nodes, "f7", DeletionState.ALREADY_GONE),
      ),
    )

    val after = nodesById()
    fun desc(id: String) = after.getValue(id).let { Triple(it.descSynced, it.descUnsynced, it.descUnknown) }
    assertEquals(Triple(1L, 1L, 0L), desc("d1"))
    assertEquals(Triple(0L, 1L, 0L), desc("d2"))
    assertEquals(
      setOf(
        Triple("src-1", "SYNCED", 1L),
        Triple("src-1", "UNSYNCED", 4L),
        Triple("src-1", "UNKNOWN", 0L),
        Triple("src-2", "SYNCED", 1L),
        Triple(null, "SYNCED", 2L),
        Triple(null, "UNSYNCED", 4L),
        Triple(null, "UNKNOWN", 0L),
      ),
      store.counts("snap-1").map { Triple(it.sourceId, it.status, it.count) }.toSet(),
    )
    assertDeletionInvariant("snap-1")
  }

  @Test
  fun preVersion3NullCountsStayNull() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()
    store.recordDeletions("snap-1", listOf(outcome(nodes, "f9", DeletionState.DELETED)))
    val legacy = nodesById().getValue("dLegacy")
    assertNull(legacy.descSynced)
    assertNull(legacy.descUnsynced)
    assertNull(legacy.descUnknown)
    assertFalse("f9" in nodesById())
  }

  @Test
  fun recordDeletionsWritesOneOverlayRowPerRemovalWithItsState() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()
    store.recordDeletions(
      "snap-1",
      listOf(
        outcome(nodes, "f3", DeletionState.DELETED, at = 7_000L),
        outcome(nodes, "f4", DeletionState.ALREADY_GONE, at = 7_001L),
        outcome(nodes, "f5", DeletionState.CHANGED, at = 7_002L),
        outcome(nodes, "f6", DeletionState.FAILED, at = 7_003L),
      ),
    )
    assertEquals(
      setOf(Triple("f3", "DELETED", 7_000L), Triple("f4", "ALREADY_GONE", 7_001L)),
      db.localDeletionOverlayDao().forSnapshot("snap-1").map { Triple(it.localEntryId, it.state, it.atMillis) }.toSet(),
    )
    assertEquals(2, db.localDeletionOverlayDao().forSnapshot("snap-1").size)
  }

  @Test
  fun aRowAlreadyRemovedIsNotCountedTwice() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()
    store.recordDeletions("snap-1", listOf(outcome(nodes, "f3", DeletionState.DELETED)))
    store.recordDeletions(
      "snap-1",
      listOf(outcome(nodes, "f3", DeletionState.ALREADY_GONE), outcome(nodes, "f3", DeletionState.DELETED)),
    )
    assertEquals(1, db.localDeletionOverlayDao().forSnapshot("snap-1").size)
    assertDeletionInvariant("snap-1")
  }

  @Test
  fun recordDeletionsRejectsMoreThanOneHundredOutcomes() = runBlocking {
    seedDeletionFixture()
    val f3 = outcome(nodesById(), "f3", DeletionState.DELETED)
    assertEquals(100, SnapshotStore.MAX_DELETIONS_PER_BATCH)
    assertThrows(IllegalArgumentException::class.java) {
      runBlocking { store.recordDeletions("snap-1", List(101) { f3 }) }
    }
    assertTrue("f3" in nodesById())
  }

  @Test
  fun aFailureMidBatchRollsTheWholeBatchBack() = runBlocking {
    seedDeletionFixture()
    val nodes = nodesById()
    val countsBefore = store.counts("snap-1").map { Triple(it.sourceId, it.status, it.count) }.toSet()
    db.openHelper.writableDatabase.execSQL(
      "CREATE TRIGGER fail_on_f6 BEFORE INSERT ON local_deletion_overlay WHEN NEW.localEntryId = 'f6' " +
        "BEGIN SELECT RAISE(ABORT, 'injected'); END"
    )

    assertThrows(Exception::class.java) {
      runBlocking {
        store.recordDeletions(
          "snap-1",
          listOf(
            outcome(nodes, "f3", DeletionState.DELETED),
            outcome(nodes, "f4", DeletionState.DELETED),
            outcome(nodes, "f6", DeletionState.DELETED),
            outcome(nodes, "f7", DeletionState.DELETED),
          ),
        )
      }
    }

    assertEquals(nodes, nodesById())
    assertEquals(countsBefore, store.counts("snap-1").map { Triple(it.sourceId, it.status, it.count) }.toSet())
    assertTrue(db.localDeletionOverlayDao().forSnapshot("snap-1").isEmpty())
  }

  @Test
  fun theCountInvariantHoldsAfterRandomBatches() = runBlocking {
    val random = Random(6)
    seedRun("run-1", 1L, "snap-1")
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    val statuses = listOf("SYNCED", "UNSYNCED", "UNKNOWN")
    val directories = mutableListOf<LocalNodeEntity>()
    val files = mutableListOf<LocalNodeEntity>()
    for (source in listOf("src-1", "src-2")) {
      val ids = mutableListOf<String?>(null)
      repeat(12) { i ->
        val id = "$source-d$i"
        directories += localNode("snap-1", source, id, "dir$i", kind = "DIRECTORY", parentId = ids.random(random), sizeBytes = null, status = "UNKNOWN")
        ids += id
      }
      repeat(150) { i ->
        files += localNode("snap-1", source, "$source-f$i", "f$i.jpg", parentId = ids.random(random), status = statuses.random(random))
      }
    }
    // Descendant counts and snapshot_counts computed from the rows, as a fresh scan would write them.
    val parentOf = (directories + files).associate { it.entryId to it.parentId }
    fun ancestors(id: String): Sequence<String> = generateSequence(parentOf[id]) { parentOf[it] }
    val withCounts =
      directories.map { dir ->
        val beneath = files.filter { dir.entryId in ancestors(it.entryId) }
        dir.copy(
          descSynced = beneath.count { it.status == "SYNCED" }.toLong(),
          descUnsynced = beneath.count { it.status == "UNSYNCED" }.toLong(),
          descUnknown = beneath.count { it.status == "UNKNOWN" }.toLong(),
        )
      }
    store.stageLocalNodes(withCounts + files)
    store.stageCounts(
      files.groupBy { it.sourceId to it.status }.map { (k, v) -> SnapshotCountsEntity(0, "snap-1", k.first, k.second, v.size.toLong()) } +
        files.groupBy { it.status }.map { (status, v) -> SnapshotCountsEntity(0, "snap-1", null, status, v.size.toLong()) }
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
    assertDeletionInvariant("snap-1")

    val states = DeletionState.entries
    val pool = files.shuffled(random).toMutableList()
    while (pool.isNotEmpty()) {
      val batch = List(minOf(pool.size, random.nextInt(1, 40))) { pool.removeAt(0) }
      store.recordDeletions("snap-1", batch.map { DeletionOutcome(it.toDeletionRow(), states.random(random), 9_000L) })
      assertDeletionInvariant("snap-1")
    }
  }

  /**
   * ```
   * src-1  d1/ Photos (1 SYNCED, 2 UNSYNCED, 1 UNKNOWN beneath)
   *          f3 a.png    SYNCED
   *          f6 b.png    UNKNOWN
   *          d2/ Old (0, 2, 0)
   *            f4 deep.txt UNSYNCED
   *            f5 clip.mp4 UNSYNCED
   *        dLegacy/ (NULL counts)
   *          f9 legacy.txt UNSYNCED
   *        f1 top.txt UNSYNCED
   *        f7 dup.png SYNCED
   *        f8 Case.png UNSYNCED
   * src-2  g1 a.png SYNCED
   * ```
   */
  private suspend fun seedDeletionFixture() {
    seedRun("run-1", 1L, "snap-1")
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    fun dir(id: String, parent: String?, s: Long?, u: Long?, k: Long?) =
      localNode("snap-1", "src-1", id, id, kind = "DIRECTORY", parentId = parent, sizeBytes = null, status = "UNKNOWN")
        .copy(descSynced = s, descUnsynced = u, descUnknown = k)
    fun file(src: String, id: String, parent: String?, status: String) =
      localNode("snap-1", src, id, "$id.png", parentId = parent, status = status)
    store.stageLocalNodes(
      listOf(
        dir("d1", null, 1L, 2L, 1L),
        dir("d2", "d1", 0L, 2L, 0L),
        dir("dLegacy", null, null, null, null),
        file("src-1", "f3", "d1", "SYNCED"),
        file("src-1", "f6", "d1", "UNKNOWN"),
        file("src-1", "f4", "d2", "UNSYNCED"),
        file("src-1", "f5", "d2", "UNSYNCED"),
        file("src-1", "f9", "dLegacy", "UNSYNCED"),
        file("src-1", "f1", null, "UNSYNCED"),
        file("src-1", "f7", null, "SYNCED"),
        file("src-1", "f8", null, "UNSYNCED"),
        file("src-2", "g1", null, "SYNCED"),
      )
    )
    store.stageCounts(
      listOf(
        SnapshotCountsEntity(0, "snap-1", "src-1", "SYNCED", 2L),
        SnapshotCountsEntity(0, "snap-1", "src-1", "UNSYNCED", 5L),
        SnapshotCountsEntity(0, "snap-1", "src-1", "UNKNOWN", 1L),
        SnapshotCountsEntity(0, "snap-1", "src-2", "SYNCED", 1L),
        SnapshotCountsEntity(0, "snap-1", null, "SYNCED", 3L),
        SnapshotCountsEntity(0, "snap-1", null, "UNSYNCED", 5L),
        SnapshotCountsEntity(0, "snap-1", null, "UNKNOWN", 1L),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
  }

  private suspend fun nodesById(snapshotId: String = "snap-1"): Map<String, LocalNodeEntity> =
    db.localNodeDao().page(androidx.sqlite.db.SimpleSQLiteQuery("SELECT * FROM local_node WHERE snapshotId = ?", arrayOf(snapshotId)))
      .associateBy { it.entryId }

  private fun outcome(nodes: Map<String, LocalNodeEntity>, id: String, state: DeletionState, at: Long = 9_000L) =
    DeletionOutcome(nodes.getValue(id).toDeletionRow(), state, at)

  private fun LocalNodeEntity.toDeletionRow() =
    DeletionRow(entryId, sourceId, parentId, documentUri, name, sizeBytes, modifiedUtcMillis, status)

  /**
   * Each directory's three counts equal the `FILE` rows beneath it by status (`NULL` counts stay `NULL`),
   * and `snapshot_counts` equals a `GROUP BY` over the remaining rows (zero rows may remain).
   */
  private suspend fun assertDeletionInvariant(snapshotId: String) {
    val nodes = nodesById(snapshotId).values
    val parentOf = nodes.associate { it.entryId to it.parentId }
    val files = nodes.filter { it.kind == "FILE" }
    for (dir in nodes.filter { it.kind == "DIRECTORY" }) {
      if (dir.descSynced == null) continue
      val beneath = files.filter { file -> generateSequence(file.parentId) { parentOf[it] }.any { it == dir.entryId } }
      assertEquals(
        "counts of ${dir.entryId}",
        Triple(
          beneath.count { it.status == "SYNCED" }.toLong(),
          beneath.count { it.status == "UNSYNCED" }.toLong(),
          beneath.count { it.status == "UNKNOWN" }.toLong(),
        ),
        Triple(dir.descSynced, dir.descUnsynced, dir.descUnknown),
      )
    }
    val expected =
      files.groupBy { it.sourceId to it.status }.mapValues { it.value.size.toLong() } +
        files.groupBy { null to it.status }.mapValues { it.value.size.toLong() }
    val actual = store.counts(snapshotId).filter { it.count != 0L }.associate { (it.sourceId to it.status) to it.count }
    assertEquals(expected, actual)
    assertTrue("no count goes negative", store.counts(snapshotId).all { it.count >= 0 })
  }

  /**
   * Two sources, nested directories and mixed statuses. Directory counts match their descendants;
   * `dLegacy` has pre-v3 `NULL` counts.
   *
   * ```
   * src-1  d1/ (1 synced, 2 unsynced, 1 unknown)      src-2  g1 a.png     image  SYNCED
   *          d2/ (0, 2, 0)                                   g2 case.png  image  UNKNOWN
   *            f4 deep.txt   text   UNSYNCED                 g3 doc.txt   text   UNSYNCED
   *            f5 clip.mp4   video  UNSYNCED
   *          f3 a.png        image  SYNCED
   *          f6 dup.png      image  UNKNOWN
   *        dLegacy/ (NULL counts)
   *        f1 top.txt        text   UNSYNCED
   *        f7 dup.png        image  SYNCED
   *        f8 Case.png       image  UNSYNCED
   * ```
   */
  private suspend fun seedBrowseFixture() {
    seedRun("run-1", 1L, "snap-1")
    db.sourceRootDao().upsert(sourceRoot("src-2"))
    fun dir(id: String, name: String, parent: String?, s: Long?, u: Long?, k: Long?, status: String) =
      localNode("snap-1", "src-1", id, name, kind = "DIRECTORY", parentId = parent, sizeBytes = null, modifiedUtcMillis = null, status = status)
        .copy(descSynced = s, descUnsynced = u, descUnknown = k)
    fun file(src: String, id: String, name: String, parent: String?, mime: String, status: String, at: Long) =
      localNode("snap-1", src, id, name, parentId = parent, mimeType = mime, status = status, modifiedUtcMillis = at)
    store.stageLocalNodes(
      listOf(
        dir("d1", "Photos", null, 1L, 2L, 1L, status = "UNKNOWN"),
        dir("d2", "Old", "d1", 0L, 2L, 0L, status = "UNSYNCED"),
        dir("dLegacy", "Legacy", null, null, null, null, status = "SYNCED"),
        file("src-1", "f1", "top.txt", null, "text/plain", "UNSYNCED", 1_000L),
        file("src-1", "f3", "a.png", "d1", "image/png", "SYNCED", 3_000L),
        file("src-1", "f4", "deep.txt", "d2", "text/plain", "UNSYNCED", 4_000L),
        file("src-1", "f5", "clip.mp4", "d2", "video/mp4", "UNSYNCED", 5_000L),
        file("src-1", "f6", "dup.png", "d1", "image/png", "UNKNOWN", 6_000L),
        file("src-1", "f7", "dup.png", null, "image/png", "SYNCED", 7_000L),
        file("src-1", "f8", "Case.png", null, "image/png", "UNSYNCED", 8_000L),
        file("src-2", "g1", "a.png", null, "image/png", "SYNCED", 9_000L),
        file("src-2", "g2", "case.png", null, "image/png", "UNKNOWN", 10_000L),
        file("src-2", "g3", "doc.txt", null, "text/plain", "UNSYNCED", 11_000L),
      )
    )
    store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
  }

  private suspend fun countsOf(query: SnapshotQuery, topLevelOnly: Boolean = false): Map<String, Long> =
    store.queryFilePage("snap-1", query, null, topLevelOnly).counts!!.associate { it.status to it.count }

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
