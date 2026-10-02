package com.syncscope.bridge

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.scan.REMOTE_ROOT
import com.syncscope.scan.ScanHarness
import com.syncscope.scan.localFile
import com.syncscope.scan.remoteFile
import com.syncscope.source.FakeSafAccess
import com.syncscope.source.RecordingActivity
import com.syncscope.source.SourcePicker
import com.syncscope.source.treeUri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class CloudSyncModuleTest {

  private val appContext = ApplicationProvider.getApplicationContext<Context>()
  private val db =
    Room.inMemoryDatabaseBuilder(appContext, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
  private val saf = FakeSafAccess()

  // ReactApplicationContext is abstract; BridgeReactContext is RN's test-visible concrete one.
  @Suppress("DEPRECATION")
  private val reactContext = BridgeReactContext(appContext)

  private val module =
    CloudSyncModule(
      reactContext,
      dispatcher = Dispatchers.Unconfined,
      envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
      safAccess = { saf },
      sourceRoots = { db.sourceRootDao() },
    )

  private val camera = treeUri("primary:DCIM/Camera")

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun nameIsCloudSync() {
    assertEquals("CloudSync", module.name)
  }

  @Test
  fun contractVersionResolvesFour() {
    val promise = RecordingPromise()

    module.getContractVersion(promise)

    assertEquals(4, promise.resolved)
    assertNull(promise.rejectedCode)
  }

  @Test
  fun unbuiltOperationsResolveNotImplementedWithoutRejecting() {
    val calls: List<(Promise) -> Unit> =
      listOf(
        { module.getSettings(it) },
        { module.setIncludeHidden(true, it) },
        { module.prepareLocalDeletion("snap", JavaOnlyArray.of("entry"), it) },
        { module.executeLocalDeletion("plan", it) },
      )

    for (call in calls) {
      val promise = RecordingPromise()
      call(promise)
      val result = promise.resolved as ReadableMap
      assertEquals("error", result.getString("status"))
      assertEquals("NOT_IMPLEMENTED", result.getMap("error")!!.getString("code"))
      assertNull(promise.rejectedCode)
    }
  }

  @Test
  fun listSourcesResolvesOkWithEverySource() {
    val empty = resolve { module.listSources(it) }
    assertEquals("ok", empty.getString("status"))
    assertEquals(4, empty.getInt("contractVersion"))
    assertEquals(0, empty.getArray("sources")!!.size())

    pick(camera)

    val listed = resolve { module.listSources(it) }.getArray("sources")!!
    assertEquals(1, listed.size())
    val source = listed.getMap(0)!!
    assertEquals("Camera", source.getString("alias"))
    assertEquals("AVAILABLE", source.getString("availability"))
    assertEquals(
      setOf("sourceId", "alias", "volumeLabel", "displayPath", "isRemovable", "canWrite", "addedAtMillis", "availability"),
      source.toHashMap().keys,
    )
  }

  @Test
  fun launchSourcePickerResolvesAddedThroughTheRegisteredActivityListener() {
    val result = pick(camera)

    assertEquals("ok", result.getString("status"))
    assertEquals("ADDED", result.getString("outcome"))
    assertEquals("Camera", result.getMap("source")!!.getString("alias"))
  }

  @Test
  fun launchSourcePickerResolvesCancelledWithNullSource() {
    val result = pick(null)

    assertEquals("ok", result.getString("status"))
    assertEquals("CANCELLED", result.getString("outcome"))
    assertTrue(result.isNull("source"))
  }

  @Test
  fun launchSourcePickerResolvesOverlapWithTheConflictingSource() {
    val added = pick(camera).getMap("source")!!

    val result = pick(treeUri("primary:DCIM"))

    val error = result.getMap("error")!!
    assertEquals("SOURCE_OVERLAP", error.getString("code"))
    assertEquals(added.getString("sourceId"), error.getMap("conflictingSource")!!.getString("sourceId"))
    assertEquals("Camera", error.getMap("conflictingSource")!!.getString("alias"))
  }

  @Test
  fun launchSourcePickerWithoutAnActivityResolvesPickerBusy() {
    val result = resolve { module.launchSourcePicker(null, it) }
    assertEquals("PICKER_BUSY", result.getMap("error")!!.getString("code"))
  }

  @Test
  fun launchSourcePickerForAnUnknownSourceResolvesNotFound() {
    val result = resolve { module.launchSourcePicker("nope", it) }
    assertEquals("SOURCE_NOT_FOUND", result.getMap("error")!!.getString("code"))
  }

  @Test
  fun removeSourceResolvesOkThenNotFound() {
    val sourceId = pick(camera).getMap("source")!!.getString("sourceId")!!

    val removed = resolve { module.removeSource(sourceId, it) }
    assertEquals("ok", removed.getString("status"))
    assertEquals(listOf(camera), saf.released)
    assertEquals(0, resolve { module.listSources(it) }.getArray("sources")!!.size())

    val again = resolve { module.removeSource(sourceId, it) }
    assertEquals("SOURCE_NOT_FOUND", again.getMap("error")!!.getString("code"))
  }

  /** Opens the picker on a resumed activity and answers it with [picked] (null = back out). */
  private fun pick(picked: String?): ReadableMap {
    val activity = Robolectric.buildActivity(RecordingActivity::class.java).get()
    reactContext.onHostResume(activity)
    val promise = RecordingPromise()
    module.launchSourcePicker(null, promise)
    val (_, requestCode) = activity.awaitStart()
    assertEquals(SourcePicker.REQUEST_CODE, requestCode)
    val data = picked?.let { Intent().setData(Uri.parse(it)) }
    reactContext.onActivityResult(activity, requestCode, if (picked == null) Activity.RESULT_CANCELED else Activity.RESULT_OK, data)
    val result = promise.await() as ReadableMap
    assertNull(promise.rejectedCode)
    return result
  }

  private fun resolve(call: (Promise) -> Unit): ReadableMap {
    val promise = RecordingPromise()
    call(promise)
    val result = promise.await() as ReadableMap
    assertNull(promise.rejectedCode)
    return result
  }

  // --- scan methods (T033) ---

  /** A module wired to the scan harness: in-memory Room, a scripted remote and a scripted enumerator. */
  private fun scanModule(h: ScanHarness): CloudSyncModule =
    CloudSyncModule(
      reactContext,
      dispatcher = Dispatchers.Default,
      envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
      repositoryConfig = { h.db.repositoryConfigDao() },
      credentialStore = { h.credentials },
      remoteClients = h.remote,
      safAccess = { saf },
      sourceRoots = { h.db.sourceRootDao() },
      snapshotStore = { h.store },
      localSources = { h.enumerator },
    )

  @Test
  fun scanMethodsNoLongerResolveNotImplemented() {
    val h = ScanHarness(appContext)
    val scans = scanModule(h)
    try {
      val operations: List<Pair<String, (Promise) -> Unit>> =
        listOf(
          "startScan" to { scans.startScan(null, it) },
          "startScan(FULL)" to { scans.startScan("FULL", it) },
          "cancelScan" to { scans.cancelScan("no-such-run", it) },
          "getScanState" to { scans.getScanState(it) },
          "getLocalImageHandle" to { scans.getLocalImageHandle("snap", "entry", JavaOnlyMap.of("maxEdgePx", 256.0), it) },
        )
      for ((method, call) in operations) {
        val result = resolve(call)
        assertEquals(method, 4, result.getInt("contractVersion"))
        if (result.getString("status") == "error") {
          assertNotEquals(method, "NOT_IMPLEMENTED", result.getMap("error")!!.getString("code"))
        }
      }
      // Nothing configured yet: a start is refused, an unknown run is not found, and the state is empty.
      assertEquals("REPOSITORY_NOT_CONFIGURED", resolve { scans.startScan(null, it) }.getMap("error")!!.getString("code"))
      assertEquals("SCAN_NOT_FOUND", resolve { scans.cancelScan("no-such-run", it) }.getMap("error")!!.getString("code"))
      assertEquals(
        "SNAPSHOT_NOT_FOUND",
        resolve { scans.getLocalImageHandle("snap", "entry", JavaOnlyMap.of("maxEdgePx", 256.0), it) }
          .getMap("error")!!
          .getString("code"),
      )
      val state = resolve { scans.getScanState(it) }
      assertEquals("ok", state.getString("status"))
      assertTrue(state.isNull("run"))
      assertTrue(state.isNull("active"))

      val pages: List<Pair<String, (Promise) -> Unit>> =
        listOf(
          "queryFiles" to { scans.queryFiles("snap", JavaOnlyMap(), null, it) },
          "queryTreeChildren" to { scans.queryTreeChildren("snap", null, JavaOnlyMap(), null, it) },
        )
      for ((method, call) in pages) {
        val result = resolve(call)
        assertEquals(method, "SNAPSHOT_NOT_FOUND", result.getMap("error")!!.getString("code"))
        assertTrue(method, result.isNull("page"))
      }
    } finally {
      scans.invalidate()
      h.close()
    }
  }

  @Test
  fun aFullScanRunsThroughTheModuleAndPublishes() {
    val h = ScanHarness(appContext)
    val scans = scanModule(h)
    try {
      runBlocking {
        h.configure()
        h.addSource("src-1")
      }
      h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
      h.enumerator.files("src-1", localFile("d1", "exact.txt", size = 22), localFile("d2", "new.txt", size = 3))

      val started = resolve { scans.startScan("FULL", it) }
      assertEquals("ok", started.getString("status"))
      val runId = started.getString("runId")!!

      val state = awaitRun(scans, runId) { it.getString("terminalState") != null }
      assertEquals("COMPLETED", state.getMap("run")!!.getString("terminalState"))
      val active = state.getMap("active")!!
      val summary = active.getMap("summary")!!
      assertEquals(1, summary.getInt("synced"))
      assertEquals(1, summary.getInt("unsynced"))

      val page = resolve { scans.queryFiles(active.getString("snapshotId")!!, JavaOnlyMap(), null, it) }
      assertEquals("ok", page.getString("status"))
      assertEquals(2, page.getMap("page")!!.getArray("entries")!!.size())
    } finally {
      scans.invalidate()
      h.close()
    }
  }

  @Test
  fun hostPauseCancelsAnActiveRunAsBackgrounded() {
    val h = ScanHarness(appContext)
    val scans = scanModule(h)
    try {
      runBlocking {
        h.configure()
        h.addSource("src-1")
      }
      h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
      h.remote.hold()

      val runId = resolve { scans.startScan(null, it) }.getString("runId")!!
      runBlocking { withTimeout(10_000) { h.remote.reachedGate.await() } }

      reactContext.onHostPause()

      val run = awaitRun(scans, runId) { it.getString("terminalState") != null }.getMap("run")!!
      assertEquals("CANCELLED", run.getString("terminalState"))
      assertEquals("BACKGROUNDED", run.getString("cancelReason"))
      assertNull("the staged snapshot is never promoted", runBlocking { h.store.activeSnapshot()?.snapshotId })
      assertNull(runBlocking { h.db.snapshotDao().forRun(runId) })
    } finally {
      h.remote.release()
      scans.invalidate()
      h.close()
    }
  }

  @Test
  fun hostPauseAfterInvalidateDoesNotReachTheModule() {
    val h = ScanHarness(appContext)
    val scans = scanModule(h)
    try {
      runBlocking {
        h.configure()
        h.addSource("src-1")
      }
      h.remote.dir(REMOTE_ROOT, remoteFile("exact.txt", 22))
      h.remote.hold()
      resolve { scans.startScan(null, it) }
      runBlocking { withTimeout(10_000) { h.remote.reachedGate.await() } }

      scans.invalidate()
      // The listener is gone, so this pause must not throw or touch the (cancelled) module.
      reactContext.onHostPause()
    } finally {
      h.remote.release()
      h.close()
    }
  }

  /** Polls `getScanState` until the run [runId] satisfies [done]; returns that state. */
  private fun awaitRun(module: CloudSyncModule, runId: String, done: (ReadableMap) -> Boolean): ReadableMap {
    val deadline = System.currentTimeMillis() + 10_000
    while (true) {
      val state = resolve { module.getScanState(it) }
      val run = state.getMap("run")
      if (run != null && run.getString("runId") == runId && done(run)) return state
      check(System.currentTimeMillis() < deadline) { "run $runId never reached the expected state" }
      Thread.sleep(20)
    }
  }

  @Test
  fun throwableBecomesRedactedInternalErrorNotRejection() {
    val promise = RecordingPromise()

    module.runOperation("probe", promise) { throw IllegalStateException("denied for dave@10.0.2.2:/srv/data") }

    val error = (promise.resolved as ReadableMap).getMap("error")!!
    assertEquals("INTERNAL_ERROR", error.getString("code"))
    val message = error.getString("message")!!
    assertFalse(message, message.contains("dave"))
    assertFalse(message, message.contains("10.0.2.2"))
    assertFalse(message, message.contains("/srv"))
    assertNull(promise.rejectedCode)
  }

  @Test
  fun throwableInPageMethodKeepsPageShape() {
    val promise = RecordingPromise()

    module.runPage("probe", promise) { throw OutOfMemoryError("boom") }

    val result = promise.resolved as ReadableMap
    assertEquals("INTERNAL_ERROR", result.getMap("error")!!.getString("code"))
    assertEquals(true, result.isNull("page"))
  }
}
