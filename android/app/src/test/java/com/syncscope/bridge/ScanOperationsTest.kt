package com.syncscope.bridge

import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.syncscope.image.LocalImageStore
import com.syncscope.image.ThumbnailSource
import com.syncscope.persistence.stagingSnapshot
import com.syncscope.scan.REMOTE_HOST
import com.syncscope.scan.REMOTE_ROOT
import com.syncscope.scan.ScanCoordinator
import com.syncscope.scan.ScanHarness
import com.syncscope.scan.localDir
import com.syncscope.scan.localFile
import com.syncscope.scan.remoteDir
import com.syncscope.scan.remoteFile
import com.syncscope.source.SourceAvailability
import java.io.File
import java.io.FileNotFoundException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** One envelope test per `startScan` row of contracts/cloudsync-scan.md, plus cancel, state and queries. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class ScanOperationsTest {

  private val h = ScanHarness(ApplicationProvider.getApplicationContext())
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
  private val coordinator = ScanCoordinator(h.engine, h.store, scope, h.clock)
  private val thumbnails = FakeThumbnails()
  private val images =
    LocalImageStore(
      File(ApplicationProvider.getApplicationContext<android.content.Context>().cacheDir, "scan-ops-test"),
      thumbnails,
    )
  private val ops =
    ScanOperations(
      coordinator = { coordinator },
      store = { h.store },
      sources = { h.db.sourceRootDao() },
      repositories = { h.db.repositoryConfigDao() },
      envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
      images = { images },
    )

  @After
  fun tearDown() {
    File(ApplicationProvider.getApplicationContext<android.content.Context>().cacheDir, "scan-ops-test").deleteRecursively()
    h.remote.release()
    scope.cancel()
    h.close()
  }

  // --- startScan ---

  @Test
  fun startWithoutARepositoryIsRepositoryNotConfigured() = runBlocking<Unit> {
    assertError(ops.start(null), "REPOSITORY_NOT_CONFIGURED")
    assertNull(h.db.scanRunDao().latest())
  }

  @Test
  fun startWithoutTheSavedPasswordIsCredentialUnavailable() = runBlocking<Unit> {
    h.configure(credentialVersion = 99L)
    h.addSource("src-1")
    assertError(ops.start("FULL"), "CREDENTIAL_UNAVAILABLE")
  }

  @Test
  fun startWithoutSourcesIsNoSourcesSelected() = runBlocking<Unit> {
    h.configure()
    val error = assertError(ops.start(null), "NO_SOURCES_SELECTED")
    assertEquals("No folders are selected to check.", error.getString("message"))
    assertEquals("Add a folder in Settings › Device folders.", error.getString("action"))
  }

  @Test
  fun startWhileRunningIsScanInProgress() = runBlocking<Unit> {
    ready()
    h.remote.hold()
    assertEquals("ok", ops.start(null).getString("status"))

    val error = assertError(ops.start(null), "SCAN_IN_PROGRESS")
    assertEquals("A scan is already running.", error.getString("message"))
  }

  @Test
  fun refreshWithoutAnActiveSnapshotIsRefreshUnavailable() = runBlocking<Unit> {
    ready()
    assertError(ops.start("LOCAL_REFRESH"), "REFRESH_UNAVAILABLE")
    assertNull(h.db.scanRunDao().latest())
  }

  @Test
  fun anUnknownModeIsInvalidQuery() = runBlocking<Unit> {
    ready()
    val error = assertError(ops.start("SIDEWAYS"), "INVALID_QUERY")
    assertEquals("mode", error.getString("field"))
    assertFalse(error.getString("message")!!.contains("SIDEWAYS"))
  }

  @Test
  fun okCarriesRunIdAndGenerationAndAMissingModeMeansFull() = runBlocking<Unit> {
    ready()

    val result = ops.start(null)

    assertEquals("ok", result.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, result.getInt("contractVersion"))
    val runId = result.getString("runId")!!
    assertEquals(1.0, result.getDouble("generation"), 0.0)
    coordinator.awaitIdle()
    assertEquals("FULL", h.store.run(runId)!!.mode)
  }

  // --- cancelScan ---

  @Test
  fun cancelIsOkThenIdempotentAndUnknownIsScanNotFound() = runBlocking<Unit> {
    ready()
    h.remote.hold()
    val runId = ops.start(null).getString("runId")!!
    withTimeout(10_000) { h.remote.reachedGate.await() }

    assertEquals("ok", ops.cancel(runId).getString("status"))
    assertEquals("CANCELLED", h.store.run(runId)!!.terminalState)
    assertEquals("ok", ops.cancel(runId).getString("status"))
    val error = assertError(ops.cancel("no-such-run"), "SCAN_NOT_FOUND")
    assertEquals("That scan is no longer known.", error.getString("message"))
  }

  // --- getScanState ---

  @Test
  fun stateWithNoRunIsEmpty() = runBlocking<Unit> {
    val state = ops.state()
    assertEquals("ok", state.getString("status"))
    assertTrue(state.isNull("run"))
    assertTrue(state.isNull("active"))
  }

  @Test
  fun aFailedRunCarriesItsTypedErrorOnly() = runBlocking<Unit> {
    ready()
    h.remote.connectFailure = CloudSyncErrorCode.AUTH_FAILED
    ops.start(null)
    coordinator.awaitIdle()

    val state = ops.state()

    val run = state.getMap("run")!!
    assertEquals("FAILED", run.getString("terminalState"))
    assertEquals("FAILED", run.getString("phase"))
    assertNotNull(run.getDouble("finishedAtMillis"))
    val error = run.getMap("error")!!
    assertEquals("AUTH_FAILED", error.getString("code"))
    assertEquals("Check the credentials and try again.", error.getString("action"))
    assertTrue(run.isNull("cancelReason"))
    assertTrue(state.isNull("active"))
    assertNoPathOrHost(state)
  }

  @Test
  fun aCancelledRunCarriesItsReasonOnly() = runBlocking<Unit> {
    ready()
    h.remote.hold()
    val runId = ops.start(null).getString("runId")!!
    withTimeout(10_000) { h.remote.reachedGate.await() }
    ops.cancel(runId)

    val run = ops.state().getMap("run")!!

    assertEquals("CANCELLED", run.getString("terminalState"))
    assertEquals("USER", run.getString("cancelReason"))
    assertTrue(run.isNull("error"))
  }

  @Test
  fun stateSummarisesTheActiveSnapshot() = runBlocking<Unit> {
    ready()
    h.addSource("src-2")
    h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22), remoteDir("restricted"))
    h.remote.fail("$REMOTE_ROOT/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.files(
      "src-1",
      localFile("d1", "exact.txt", size = 22),
      localFile("d2", "only-here.txt", size = 3),
      localFile("d3", "unreadable.txt", size = null),
    )
    h.enumerator.skip("src-2", SourceAvailability.GRANT_REVOKED)
    val runId = ops.start(null).getString("runId")!!
    coordinator.awaitIdle()

    val state = ops.state()

    val run = state.getMap("run")!!
    assertEquals(runId, run.getString("runId"))
    assertEquals("FULL", run.getString("mode"))
    assertEquals("COMPLETED", run.getString("terminalState"))
    assertEquals("PUBLISHED", run.getString("phase"))
    assertTrue(run.isNull("error"))
    assertTrue(run.isNull("cancelReason"))
    assertEquals(3.0, run.getMap("progress")!!.getDouble("localFilesMatched"), 0.0)
    val active = state.getMap("active")!!
    assertEquals(h.store.activeSnapshot()!!.snapshotId, active.getString("snapshotId"))
    assertEquals("INCOMPLETE", active.getString("coverage"))
    assertEquals(1_000.0, active.getDouble("precisionMillis"), 0.0)
    assertTrue(active.getDouble("remoteListedAtMillis") > 0)
    assertTrue(active.getDouble("completedAtMillis") >= active.getDouble("remoteListedAtMillis"))
    val summary = active.getMap("summary")!!
    assertEquals(1.0, summary.getDouble("synced"), 0.0)
    assertEquals(0.0, summary.getDouble("unsynced"), 0.0)
    assertEquals("unknown is the UNKNOWN file count", 2.0, summary.getDouble("unknown"), 0.0)
    assertEquals(1.0, summary.getDouble("unreadableRemoteDirectories"), 0.0)
    assertTrue(summary.isNull("remoteListingInterruptedBy"))
    assertEquals("every folder was read", 0, summary.getArray("unreadRemoteFolders")!!.size())
    val skipped = summary.getArray("skippedSources")!!
    assertEquals(1, skipped.size())
    assertEquals("src-2", skipped.getMap(0)!!.getString("sourceId"))
    assertEquals("Alias src-2", skipped.getMap(0)!!.getString("alias"))
    assertEquals("GRANT_REVOKED", skipped.getMap(0)!!.getString("reason"))
    assertNoPathOrHost(state)
  }

  @Test
  fun theActiveSnapshotCarriesTheConfigRevisionItWasMadeWith() = runBlocking<Unit> {
    h.configure(revision = 7L)
    h.addSource("src-1")
    h.remote.dir(REMOTE_ROOT)
    ops.start(null)
    coordinator.awaitIdle()
    // A later save bumps the repository revision; the snapshot keeps the one it was made with.
    h.configure(revision = 8L)

    val active = ops.state().getMap("active")!!

    assertEquals(7L, h.store.snapshot(active.getString("snapshotId")!!)!!.configRevision)
    assertEquals(7.0, active.getDouble("configRevision"), 0.0)
  }

  @Test
  fun anInterruptedListingIsReportedWithItsCode() = runBlocking<Unit> {
    ready()
    h.remote.dir(REMOTE_ROOT, remoteDir("flaky"))
    h.remote.fail("$REMOTE_ROOT/flaky", CloudSyncErrorCode.CONNECTION_LOST)
    ops.start(null)
    coordinator.awaitIdle()

    val summary = ops.state().getMap("active")!!.getMap("summary")!!

    assertEquals("CONNECTION_LOST", summary.getString("remoteListingInterruptedBy"))
    assertEquals(0.0, summary.getDouble("unreadableRemoteDirectories"), 0.0)
  }

  @Test
  fun unreadRemoteFoldersListsTheUnreadFoldersInFolderOrder() = runBlocking<Unit> {
    h.configure(roots = listOf("/a", "/b", "/c"))
    h.addSource("src-1")
    h.remote.fail("/a", CloudSyncErrorCode.REMOTE_ROOT_NOT_FOUND)
    h.remote.dir("/b", remoteDir("restricted"), remoteFile("exact.txt", 22))
    h.remote.fail("/b/restricted", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.remote.fail("/c", CloudSyncErrorCode.DIRECTORY_UNREADABLE)
    h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "elsewhere.txt", size = 3))
    ops.start(null)
    coordinator.awaitIdle()

    val active = ops.state().getMap("active")!!
    val summary = active.getMap("summary")!!

    assertEquals("INCOMPLETE", active.getString("coverage"))
    val unread = summary.getArray("unreadRemoteFolders")!!
    assertEquals(listOf("/a", "/c"), (0 until unread.size()).map { unread.getString(it) })
    assertEquals("non-root directories only", 1.0, summary.getDouble("unreadableRemoteDirectories"), 0.0)
    assertTrue(summary.isNull("remoteListingInterruptedBy"))
    assertEquals(1.0, summary.getDouble("synced"), 0.0)
    assertEquals(0.0, summary.getDouble("unsynced"), 0.0)
    assertEquals(1.0, summary.getDouble("unknown"), 0.0)
  }

  // --- queryFiles / queryTreeChildren ---

  @Test
  fun treeChildrenWithoutAParentListTheTopLevel() = runBlocking<Unit> {
    ready()
    h.enumerator.files("src-1", localFile("d1", "top.txt"), localDir("d2", "Photos"), localFile("d3", "inner.jpg", parent = "d2"))
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!

    val top = ops.queryTreeChildren(snapshotId, null, spec(), null)

    assertEquals("ok", top.getString("status"))
    val entries = top.getMap("page")!!.getArray("entries")!!
    assertEquals(listOf("Photos", "top.txt"), names(entries))
    val photos = entries.getMap(0)!!
    assertEquals("DIRECTORY", photos.getString("kind"))
    assertTrue(photos.isNull("parentId"))
    assertFalse(photos.hasKey("documentId"))
    assertFalse(photos.hasKey("documentUri"))

    val children = ops.queryTreeChildren(snapshotId, photos.getString("entryId"), spec(), null)
    assertEquals(listOf("inner.jpg"), names(children.getMap("page")!!.getArray("entries")!!))

    val all = ops.queryFiles(snapshotId, spec(), null).getMap("page")!!
    // Name order is case-insensitive (contract version 6, research R1).
    assertEquals(listOf("inner.jpg", "Photos", "top.txt"), names(all.getArray("entries")!!))
    assertNotNull(all.getArray("counts"))
  }

  @Test
  fun queryErrorsResolvePageEnvelopes() = runBlocking<Unit> {
    ready()
    h.enumerator.files("src-1", *Array(3) { localFile("d$it", "f$it.txt") })
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!

    val missing = ops.queryFiles("no-such-snapshot", spec(), null)
    assertEquals("SNAPSHOT_NOT_FOUND", missing.getMap("error")!!.getString("code"))
    assertTrue(missing.isNull("page"))

    val first = ops.queryFiles(snapshotId, spec(pageSize = 1.0), null).getMap("page")!!
    val token = first.getString("nextPageToken")!!
    val mismatch = ops.queryTreeChildren(snapshotId, null, spec(pageSize = 1.0), token)
    assertEquals("PAGE_TOKEN_MISMATCH", mismatch.getMap("error")!!.getString("code"))

    val invalid = ops.queryFiles(snapshotId, JavaOnlyMap.of("filter", "SIDEWAYS"), null)
    assertEquals("INVALID_QUERY", invalid.getMap("error")!!.getString("code"))
    assertTrue(invalid.isNull("page"))
  }

  @Test
  fun theQuerySpecAcceptsTheSizeSortsAndAKind() = runBlocking<Unit> {
    ready()
    h.enumerator.files(
      "src-1",
      localDir("d1", "Photos"),
      localDir("d2", "archive"),
      localFile("d3", "small.txt", size = 5L),
      localFile("d4", "Big.txt", size = 500L),
      localFile("d5", "unknown.txt", size = null),
    )
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!
    suspend fun read(vararg pairs: Any?): ReadableMap = ops.queryTreeChildren(snapshotId, null, JavaOnlyMap.of(*pairs), null)
    fun namesOf(result: ReadableMap): List<String> {
      assertEquals("ok", result.getString("status"))
      return names(result.getMap("page")!!.getArray("entries")!!)
    }

    assertEquals(listOf("Big.txt", "small.txt", "unknown.txt"), namesOf(read("sort", "SIZE_DESC", "kind", "FILE")))
    assertEquals(listOf("small.txt", "Big.txt", "unknown.txt"), namesOf(read("sort", "SIZE_ASC", "kind", "FILE")))
    assertEquals(listOf("archive", "Photos"), namesOf(read("sort", "NAME_ASC", "kind", "DIRECTORY")))
    // No kind, or a null one, reads both.
    assertEquals(5, namesOf(read("sort", "NAME_ASC")).size)
    assertEquals(5, namesOf(read("sort", "NAME_ASC", "kind", null)).size)

    for (kind in listOf<Any>("FOLDER", "file", 1.0)) {
      val invalid = read("sort", "NAME_ASC", "kind", kind)
      val error = assertError(invalid, "INVALID_QUERY")
      assertEquals("$kind", "The query kind is invalid.", error.getString("message"))
      assertTrue(invalid.isNull("page"))
    }
    assertEquals("The query sort is invalid.", assertError(read("sort", "SIZE_SIDEWAYS"), "INVALID_QUERY").getString("message"))
  }

  @Test
  fun everyEntryCarriesTheContract4FieldsAndNoDocumentIdentity() = runBlocking<Unit> {
    ready()
    h.addSource("src-2")
    h.enumerator.files(
      "src-1",
      localDir("d1", "Photos"),
      image("d2", "a.png", parent = "d1"),
      localFile("d3", "notes.txt", parent = "d1"),
      image("d4", "solo.png"),
    )
    h.enumerator.files("src-2", image("e1", "a.png"))
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!

    val reads =
      listOf(
        "list top" to ops.queryTreeChildren(snapshotId, null, spec(), null),
        "list all" to ops.queryFiles(snapshotId, spec(), null),
        "gallery" to ops.queryFiles(snapshotId, JavaOnlyMap.of("view", "GALLERY", "sort", "NAME_ASC"), null),
      )
    for ((label, result) in reads) {
      assertEquals(label, "ok", result.getString("status"))
      val entries = result.getMap("page")!!.getArray("entries")!!
      assertTrue(label, entries.size() > 0)
      for (i in 0 until entries.size()) {
        val entry = entries.getMap(i)!!
        assertTrue("$label ${entry.getString("name")}", entry.hasKey("nameInOtherSource"))
        assertTrue("$label ${entry.getString("name")}", entry.hasKey("matchingFileCount"))
        for (key in listOf("documentUri", "documentId", "path", "treeUri", "documentPath")) {
          assertFalse("$label carries $key", entry.hasKey(key))
        }
      }
      assertNoPathOrHost(result)
    }

    val listEntries = reads[1].second.getMap("page")!!.getArray("entries")!!
    for (i in 0 until listEntries.size()) {
      val entry = listEntries.getMap(i)!!
      assertFalse("LIST rows never flag a twin", entry.getBoolean("nameInOtherSource"))
      if (entry.getString("kind") == "FILE") assertTrue(entry.isNull("matchingFileCount"))
    }
    val photos = (0 until listEntries.size()).map { listEntries.getMap(it)!! }.single { it.getString("name") == "Photos" }
    assertEquals(2.0, photos.getDouble("matchingFileCount"), 0.0)

    val gallery = reads[2].second.getMap("page")!!.getArray("entries")!!
    val twins = (0 until gallery.size()).map { gallery.getMap(it)!! }.map { it.getString("name") to it.getBoolean("nameInOtherSource") }
    assertEquals(listOf("a.png" to true, "a.png" to true, "solo.png" to false), twins)
  }

  // --- listSelectableEntries ---

  @Test
  fun selectableEntriesFollowTheContract() = runBlocking<Unit> {
    ready()
    h.enumerator.files(
      "src-1",
      localDir("d1", "Photos"),
      image("d2", "a.png", parent = "d1").copy(sizeBytes = 70L),
      localFile("d3", "notes.txt", parent = "d1", size = null),
      image("d4", "solo.png"),
    )
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!
    val rows = ops.queryFiles(snapshotId, spec(), null).getMap("page")!!.getArray("entries")!!
    val idOf = (0 until rows.size()).map { rows.getMap(it)!! }.associate { it.getString("name")!! to it.getString("entryId")!! }

    val gallery = ops.listSelectableEntries(snapshotId, JavaOnlyMap.of("filter", "ALL", "view", "GALLERY", "sort", "NAME_ASC"))
    assertEquals("ok", gallery.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, gallery.getInt("contractVersion"))
    val all = selectable(gallery)
    assertEquals(setOf(idOf.getValue("a.png"), idOf.getValue("solo.png")), all.keys)
    assertTrue(all.values.all { it.third })
    assertEquals(70.0, all.getValue(idOf.getValue("a.png")).first, 0.0)
    assertNoPathOrHost(gallery)

    val folder =
      ops.listSelectableEntries(
        snapshotId,
        JavaOnlyMap.of("filter", "ALL", "view", "LIST", "sort", "NAME_ASC", "sourceId", "src-1", "parentId", idOf.getValue("Photos")),
      )
    val inPhotos = selectable(folder)
    // Directories are never selectable; a file of unknown size is -1.
    assertEquals(setOf(idOf.getValue("a.png"), idOf.getValue("notes.txt")), inPhotos.keys)
    assertEquals(Triple(-1.0, "UNKNOWN", false), inPhotos.getValue(idOf.getValue("notes.txt")))
    val top = selectable(ops.listSelectableEntries(snapshotId, JavaOnlyMap.of("view", "LIST", "sourceId", "src-1")))
    assertEquals(setOf(idOf.getValue("solo.png")), top.keys)

    // The query is validated as queryFiles does, and a LIST selection names its source.
    assertEquals("filter", assertError(ops.listSelectableEntries(snapshotId, JavaOnlyMap.of("filter", "SIDEWAYS")), "INVALID_QUERY").getString("field"))
    assertEquals("sourceId", assertError(ops.listSelectableEntries(snapshotId, JavaOnlyMap.of("view", "LIST")), "INVALID_QUERY").getString("field"))
    val gone = ops.listSelectableEntries("no-such-snapshot", JavaOnlyMap.of("view", "GALLERY"))
    assertError(gone, "SNAPSHOT_NOT_FOUND")
    assertFalse(gone.hasKey("selectable"))

    // A published snapshot that is no longer the active one is stale.
    val old = h.store.beginRun("run-old", "FULL", 1L, "CONNECTING", 0L)
    h.store.stageSnapshot(stagingSnapshot("snap-old", old.runId).copy(publishable = true))
    assertError(ops.listSelectableEntries("snap-old", JavaOnlyMap.of("view", "GALLERY")), "STALE_GENERATION")
  }

  // --- getScrollIndex ---

  @Test
  fun scrollIndexFollowsTheContract() = runBlocking<Unit> {
    ready()
    h.enumerator.files(
      "src-1",
      localDir("d0", "Photos"),
      localFile("d1", "apple.txt", size = 5L),
      localFile("d2", "Banana.txt", size = 50_000L),
      localFile("d3", "2024.txt", size = 7_000_000L),
      localFile("d4", "kiwi.txt", size = null),
      localFile("d5", "inner.txt", parent = "d0"),
    )
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!
    val files = JavaOnlyMap.of("filter", "ALL", "view", "LIST", "sort", "NAME_ASC", "sourceId", "src-1", "kind", "FILE")

    val result = ops.scrollIndex(snapshotId, files, null)
    assertEquals("ok", result.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, result.getInt("contractVersion"))
    val index = result.getMap("scrollIndex")!!
    assertEquals(setOf("unit", "totalCount", "bands", "anchorIndex"), index.toHashMap().keys)
    assertEquals("LETTER", index.getString("unit"))
    // The top level's files only: the folder and its child are not counted.
    assertEquals(4.0, index.getDouble("totalCount"), 0.0)
    assertTrue(index.isNull("anchorIndex"))
    val bands = index.getArray("bands")!!
    assertEquals(listOf("#", "a", "b", "k"), (0 until bands.size()).map { bands.getMap(it)!!.getString("letter") })
    val first = bands.getMap(0)!!
    assertEquals(
      setOf("startIndex", "count", "startToken", "letter", "startMillis", "lowerBytes", "unknown"),
      first.toHashMap().keys,
    )
    assertTrue(first.isNull("startToken"))
    assertTrue(first.isNull("startMillis"))
    assertTrue(first.isNull("lowerBytes"))
    assertFalse(first.getBoolean("unknown"))
    assertNoPathOrHost(result)

    // A band's start token pages queryTreeChildren from that band's first row.
    val kiwi = bands.getMap(3)!!
    assertEquals(3.0, kiwi.getDouble("startIndex"), 0.0)
    val page = ops.queryTreeChildren(snapshotId, null, files, kiwi.getString("startToken"))
    assertEquals(listOf("kiwi.txt"), names(page.getMap("page")!!.getArray("entries")!!))

    // pageSize and pageToken are ignored; sizes have an unknown band last; an anchor gives its index.
    val sizes = JavaOnlyMap.of("view", "LIST", "sort", "SIZE_DESC", "sourceId", "src-1", "kind", "FILE", "pageSize", 1.0, "pageToken", "x")
    val bySize = ops.scrollIndex(snapshotId, sizes, JavaOnlyMap.of("sortValue", 50_000.0, "sortName", "1banana.txt")).getMap("scrollIndex")!!
    assertEquals("SIZE", bySize.getString("unit"))
    assertEquals(4.0, bySize.getDouble("totalCount"), 0.0)
    assertEquals(1.0, bySize.getDouble("anchorIndex"), 0.0)
    val sizeBands = bySize.getArray("bands")!!
    assertTrue(sizeBands.getMap(sizeBands.size() - 1)!!.getBoolean("unknown"))
    assertFalse(sizeBands.getMap(0)!!.isNull("lowerBytes"))

    // A sort value of the wrong type gives no index; an anchor without a sortName is invalid.
    for (value in listOf<Any>("big", true, JavaOnlyMap())) {
      val anchor = JavaOnlyMap().apply {
        when (value) {
          is String -> putString("sortValue", value)
          is Boolean -> putBoolean("sortValue", value)
          else -> putMap("sortValue", value as JavaOnlyMap)
        }
        putString("sortName", "1apple.txt")
      }
      assertTrue("$value", ops.scrollIndex(snapshotId, sizes, anchor).getMap("scrollIndex")!!.isNull("anchorIndex"))
    }
    assertEquals("anchor", assertError(ops.scrollIndex(snapshotId, sizes, JavaOnlyMap.of("sortValue", 1.0)), "INVALID_QUERY").getString("field"))
    assertEquals("sort", assertError(ops.scrollIndex(snapshotId, JavaOnlyMap.of("sort", "SIDEWAYS"), null), "INVALID_QUERY").getString("field"))
    assertError(ops.scrollIndex("no-such-snapshot", files, null), "SNAPSHOT_NOT_FOUND")

    // A published snapshot that is no longer the active one is stale.
    val old = h.store.beginRun("run-old", "FULL", 1L, "CONNECTING", 0L)
    h.store.stageSnapshot(stagingSnapshot("snap-old", old.runId).copy(publishable = true))
    val stale = ops.scrollIndex("snap-old", files, null)
    assertError(stale, "STALE_GENERATION")
    assertFalse(stale.hasKey("scrollIndex"))
  }

  // --- getLocalImageHandle ---

  @Test
  fun imageHandleFollowsTheBehaviourTable() = runBlocking<Unit> {
    ready()
    h.enumerator.files(
      "src-1",
      localDir("d1", "Photos"),
      image("d2", "secret-photo.png", parent = "d1"),
      localFile("d3", "notes.txt", parent = "d1"),
    )
    ops.start(null)
    coordinator.awaitIdle()
    val snapshotId = h.store.activeSnapshot()!!.snapshotId!!
    val rows = ops.queryFiles(snapshotId, spec(), null).getMap("page")!!.getArray("entries")!!
    val idOf = (0 until rows.size()).map { rows.getMap(it)!! }.associate { it.getString("name")!! to it.getString("entryId")!! }
    val photo = idOf.getValue("secret-photo.png")
    val edge = JavaOnlyMap.of("maxEdgePx", 256.0)

    assertError(ops.imageHandle("no-such-snapshot", photo, edge), "SNAPSHOT_NOT_FOUND")
    for (entryId in listOf("no-such-entry", idOf.getValue("Photos"), idOf.getValue("notes.txt"))) {
      assertEquals(entryId, "entryId", assertError(ops.imageHandle(snapshotId, entryId, edge), "INVALID_QUERY").getString("field"))
    }
    for (bad in listOf(JavaOnlyMap(), JavaOnlyMap.of("maxEdgePx", "256"), JavaOnlyMap.of("maxEdgePx", Double.NaN))) {
      assertEquals("maxEdgePx", assertError(ops.imageHandle(snapshotId, photo, bad), "INVALID_QUERY").getString("field"))
    }
    assertEquals(0, thumbnails.loads)

    val ok = ops.imageHandle(snapshotId, photo, edge)
    assertEquals("ok", ok.getString("status"))
    assertEquals(CloudSyncContracts.CONTRACT_VERSION, ok.getInt("contractVersion"))
    val uri = ok.getMap("handle")!!.getString("uri")!!
    assertTrue(uri, uri.startsWith("file://"))
    assertFalse(uri, uri.contains("secret"))
    assertFalse(uri, uri.contains("content://"))
    assertEquals(setOf("uri"), ok.getMap("handle")!!.toHashMap().keys)
    assertNoPathOrHost(ok)
    assertEquals(1, thumbnails.loads)
    // A clamped edge is the same cache entry: no second decode.
    assertEquals(uri, ops.imageHandle(snapshotId, photo, JavaOnlyMap.of("maxEdgePx", 256.9)).getMap("handle")!!.getString("uri"))
    assertEquals(1, thumbnails.loads)

    thumbnails.failure = FileNotFoundException("content://gone/secret-photo.png")
    val unavailable = assertError(ops.imageHandle(snapshotId, photo, JavaOnlyMap.of("maxEdgePx", 512.0)), "IMAGE_UNAVAILABLE")
    assertEquals("This image could not be read on the device.", unavailable.getString("message"))
    assertEquals("Check that the folder is still available, then rescan.", unavailable.getString("action"))
    assertNoPathOrHost(unavailable)
  }

  /** Returns a small bitmap, or throws [failure] when set. */
  private class FakeThumbnails : ThumbnailSource {
    @Volatile var loads = 0
    @Volatile var failure: Exception? = null

    override fun load(documentUri: String, edgePx: Int): Bitmap? {
      loads++
      failure?.let { throw it }
      return Bitmap.createBitmap(edgePx, edgePx, Bitmap.Config.ARGB_8888)
    }
  }

  private suspend fun ready() {
    h.configure()
    h.addSource("src-1")
    if (REMOTE_ROOT !in h.remote.tree) h.remote.dir(REMOTE_ROOT)
  }

  private fun image(documentId: String, name: String, parent: String? = null) =
    localFile(documentId, name, parent = parent).copy(mimeType = "image/png")

  private fun spec(pageSize: Double? = null): ReadableMap =
    JavaOnlyMap.of("filter", "ALL", "view", "LIST", "sort", "NAME_ASC").apply { pageSize?.let { putDouble("pageSize", it) } }

  /** The `selectable` arrays of an ok result as entryId → (size, status, image), checking they are parallel. */
  private fun selectable(result: ReadableMap): Map<String, Triple<Double, String, Boolean>> {
    assertEquals("ok", result.getString("status"))
    val dto = result.getMap("selectable")!!
    assertEquals(setOf("entryIds", "sizes", "statuses", "images"), dto.toHashMap().keys)
    val ids = dto.getArray("entryIds")!!
    val sizes = dto.getArray("sizes")!!
    val statuses = dto.getArray("statuses")!!
    val images = dto.getArray("images")!!
    for (array in listOf(sizes, statuses, images)) assertEquals(ids.size(), array.size())
    return (0 until ids.size()).associate {
      ids.getString(it)!! to Triple(sizes.getDouble(it), statuses.getString(it)!!, images.getBoolean(it))
    }
  }

  private fun names(entries: ReadableArray): List<String> = (0 until entries.size()).map { entries.getMap(it)!!.getString("name")!! }

  private fun assertError(result: ReadableMap, code: String): ReadableMap {
    assertEquals("error", result.getString("status"))
    val error = result.getMap("error")!!
    assertEquals(code, error.getString("code"))
    assertTrue(error.getString("message")!!.isNotBlank())
    return error
  }

  private fun assertNoPathOrHost(map: ReadableMap) {
    val text = dump(map)
    for (secret in listOf(REMOTE_HOST, REMOTE_ROOT, "alice", "content://", "primary:")) {
      assertFalse("'$secret' crossed the bridge: $text", text.contains(secret))
    }
  }

  private fun dump(value: Any?): String =
    when (value) {
      is ReadableMap -> {
        val it = value.keySetIterator()
        buildString {
          while (it.hasNextKey()) {
            val key = it.nextKey()
            append(key).append('=')
            append(
              when (value.getType(key)) {
                ReadableType.Map -> dump(value.getMap(key))
                ReadableType.Array -> dump(value.getArray(key))
                ReadableType.String -> value.getString(key)
                else -> value.toHashMap()[key].toString()
              }
            )
            append(';')
          }
        }
      }
      is ReadableArray -> (0 until value.size()).joinToString(",") { i ->
        when (value.getType(i)) {
          ReadableType.Map -> dump(value.getMap(i))
          ReadableType.Array -> dump(value.getArray(i))
          ReadableType.String -> value.getString(i) ?: ""
          else -> value.toArrayList()[i].toString()
        }
      }
      else -> value.toString()
    }
}
