package com.syncscope.bridge

import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.WritableMap
import kotlinx.coroutines.Dispatchers
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class CloudSyncModuleTest {

  // ReactApplicationContext is abstract; BridgeReactContext is RN's test-visible concrete one.
  @Suppress("DEPRECATION")
  private val module =
    CloudSyncModule(
      BridgeReactContext(ApplicationProvider.getApplicationContext()),
      dispatcher = Dispatchers.Unconfined,
      envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() }),
    )

  @Test
  fun nameIsCloudSync() {
    assertEquals("CloudSync", module.name)
  }

  @Test
  fun contractVersionResolvesOne() {
    val promise = RecordingPromise()

    module.getContractVersion(promise)

    assertEquals(1, promise.resolved)
    assertNull(promise.rejectedCode)
  }

  @Test
  fun unbuiltOperationsResolveNotImplementedWithoutRejecting() {
    val calls: List<(Promise) -> Unit> =
      listOf(
        { module.getRepositorySummary(it) },
        { module.saveRepository(JavaOnlyMap(), "secret", it) },
        { module.testRepository(it) },
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
