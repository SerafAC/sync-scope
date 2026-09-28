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
import com.syncscope.source.FakeSafAccess
import com.syncscope.source.RecordingActivity
import com.syncscope.source.SourcePicker
import com.syncscope.source.treeUri
import kotlinx.coroutines.Dispatchers
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
  fun contractVersionResolvesTwo() {
    val promise = RecordingPromise()

    module.getContractVersion(promise)

    assertEquals(2, promise.resolved)
    assertNull(promise.rejectedCode)
  }

  @Test
  fun unbuiltOperationsResolveNotImplementedWithoutRejecting() {
    val calls: List<(Promise) -> Unit> =
      listOf(
        { module.getSettings(it) },
        { module.startScan(it) },
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
    assertEquals(2, empty.getInt("contractVersion"))
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

  @Test
  fun queryFilesResolvesPageShapedNotImplemented() {
    val promise = RecordingPromise()

    module.queryFiles("snap", JavaOnlyMap(), null, promise)

    val result = promise.resolved as ReadableMap
    assertEquals("NOT_IMPLEMENTED", result.getMap("error")!!.getString("code"))
    assertEquals(true, result.isNull("page"))
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
