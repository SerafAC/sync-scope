package com.syncscope.bridge

import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.syncscope.scan.REMOTE_HOST
import com.syncscope.scan.REMOTE_ROOT
import com.syncscope.scan.ScanCoordinator
import com.syncscope.scan.ScanHarness
import com.syncscope.scan.localDir
import com.syncscope.scan.localFile
import com.syncscope.scan.remoteDir
import com.syncscope.scan.remoteFile
import com.syncscope.source.SourceAvailability
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
  private val ops =
    ScanOperations(
      coordinator = { coordinator },
      store = { h.store },
      sources = { h.db.sourceRootDao() },
      repositories = { h.db.repositoryConfigDao() },
      envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
    )

  @After
  fun tearDown() {
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
    assertEquals("Add a folder in Settings › Folders.", error.getString("action"))
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
    val skipped = summary.getArray("skippedSources")!!
    assertEquals(1, skipped.size())
    assertEquals("src-2", skipped.getMap(0)!!.getString("sourceId"))
    assertEquals("Alias src-2", skipped.getMap(0)!!.getString("alias"))
    assertEquals("GRANT_REVOKED", skipped.getMap(0)!!.getString("reason"))
    assertNoPathOrHost(state)
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
    assertEquals(listOf("Photos", "inner.jpg", "top.txt"), names(all.getArray("entries")!!))
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

  private suspend fun ready() {
    h.configure()
    h.addSource("src-1")
    if (REMOTE_ROOT !in h.remote.tree) h.remote.dir(REMOTE_ROOT)
  }

  private fun spec(pageSize: Double? = null): ReadableMap =
    JavaOnlyMap.of("filter", "ALL", "view", "LIST", "sort", "NAME_ASC").apply { pageSize?.let { putDouble("pageSize", it) } }

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
