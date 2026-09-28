package com.syncscope.source

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.JavaOnlyArray
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.bridge.WritableMap
import com.syncscope.bridge.CloudSyncEnvelope
import com.syncscope.persistence.SourceRootEntity
import com.syncscope.persistence.SyncScopeDatabase
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SourcePickerTest {

  private lateinit var db: SyncScopeDatabase
  private val saf = FakeSafAccess()
  private lateinit var operations: SourceOperations
  private lateinit var activity: RecordingActivity
  private var currentActivity: Activity? = null
  private lateinit var picker: SourcePicker

  private val camera = treeUri("primary:DCIM/Camera")

  @Before
  fun setUp() {
    val context = ApplicationProvider.getApplicationContext<Context>()
    db = Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    val envelope = CloudSyncEnvelope({ JavaOnlyMap() }, { JavaOnlyArray() })
    operations = SourceOperations(saf = { saf }, sources = { db.sourceRootDao() }, envelope = envelope)
    activity = Robolectric.buildActivity(RecordingActivity::class.java).get()
    currentActivity = activity
    picker = SourcePicker(operations, envelope) { currentActivity }
  }

  @After
  fun tearDown() {
    db.close()
  }

  @Test
  fun launchOpensTheTreePickerWithPersistableReadWriteFlags() = runBlocking {
    val result = launch(null)
    val (intent, requestCode) = activity.awaitStart()

    assertEquals(Intent.ACTION_OPEN_DOCUMENT_TREE, intent.action)
    val flags = intent.flags
    assertTrue(flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
    assertTrue(flags and Intent.FLAG_GRANT_WRITE_URI_PERMISSION != 0)
    assertTrue(flags and Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION != 0)
    assertNull(intent.extras?.get(DocumentsContract.EXTRA_INITIAL_URI))
    assertEquals(SourcePicker.REQUEST_CODE, requestCode)

    picker.onActivityResult(activity, requestCode, Activity.RESULT_CANCELED, null)
    result.await()
    Unit
  }

  @Test
  fun aPickIsHandedToSourceOperations() = runBlocking {
    val result = launch(null)
    activity.awaitStart()

    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_OK, Intent().setData(Uri.parse(camera)))

    val envelope = withTimeout(TIMEOUT) { result.await() }
    assertEquals("ADDED", envelope.getString("outcome"))
    assertEquals(1, db.sourceRootDao().all().size)
  }

  @Test
  fun aSecondLaunchWhileOneIsPendingIsBusy() = runBlocking {
    val first = launch(null)
    activity.awaitStart()

    val second = picker.launch(null)

    assertError("PICKER_BUSY", second)
    assertTrue(activity.started.isEmpty())
    // The busy launch did not clear the first launch's slot.
    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_CANCELED, null)
    assertEquals("CANCELLED", withTimeout(TIMEOUT) { first.await() }.getString("outcome"))
  }

  @Test
  fun noCurrentActivityIsBusy() = runBlocking {
    currentActivity = null

    assertError("PICKER_BUSY", picker.launch(null))
    assertTrue(activity.started.isEmpty())
    // Nothing was left in the slot.
    currentActivity = activity
    val next = launch(null)
    activity.awaitStart()
    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_CANCELED, null)
    next.await()
    Unit
  }

  @Test
  fun resultCanceledIsCancelledAndPersistsNothing() = runBlocking {
    val result = launch(null)
    activity.awaitStart()

    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_CANCELED, null)

    assertCancelled(withTimeout(TIMEOUT) { result.await() })
    assertEquals(emptyList<SourceRootEntity>(), db.sourceRootDao().all())
    assertTrue(saf.taken.isEmpty())
  }

  @Test
  fun resultOkWithoutDataIsCancelled() = runBlocking {
    val result = launch(null)
    activity.awaitStart()

    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_OK, null)

    assertCancelled(withTimeout(TIMEOUT) { result.await() })
    assertTrue(saf.taken.isEmpty())
  }

  @Test
  fun aRegrantLaunchStartsAtTheSourcesTreeUri() = runBlocking {
    operations.onPicked(camera, null)
    val sourceId = db.sourceRootDao().all().single().sourceId

    val result = launch(sourceId)
    val (intent, _) = activity.awaitStart()

    @Suppress("DEPRECATION")
    assertEquals(Uri.parse(camera), intent.extras?.get(DocumentsContract.EXTRA_INITIAL_URI))
    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_OK, Intent().setData(Uri.parse(camera)))
    assertEquals("REGRANTED", withTimeout(TIMEOUT) { result.await() }.getString("outcome"))
  }

  @Test
  fun aRegrantOfAnUnknownSourceIsNotFoundBeforeThePickerOpens() = runBlocking {
    assertError("SOURCE_NOT_FOUND", picker.launch("nope"))
    assertTrue(activity.started.isEmpty())
  }

  @Test
  fun anUnrelatedRequestCodeIsIgnored() = runBlocking {
    val result = launch(null)
    activity.awaitStart()

    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE + 1, Activity.RESULT_OK, Intent().setData(Uri.parse(camera)))
    assertTrue(!result.isCompleted)

    picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, Activity.RESULT_CANCELED, null)
    assertCancelled(withTimeout(TIMEOUT) { result.await() })
    assertTrue(saf.taken.isEmpty())
  }

  @Test
  fun theSlotIsClearedAfterEveryOutcome() = runBlocking {
    val outcomes: List<Pair<Int, Intent?>> =
      listOf(
        Activity.RESULT_CANCELED to null,
        Activity.RESULT_OK to Intent().setData(Uri.parse(camera)),
        // Rejected (overlaps the source just added).
        Activity.RESULT_OK to Intent().setData(Uri.parse(treeUri("primary:DCIM"))),
        Activity.RESULT_OK to null,
      )
    val seen = mutableListOf<String?>()
    for ((resultCode, data) in outcomes) {
      val result = launch(null)
      assertNotNull(activity.awaitStart())
      picker.onActivityResult(activity, SourcePicker.REQUEST_CODE, resultCode, data)
      val envelope = withTimeout(TIMEOUT) { result.await() }
      seen += envelope.getString("outcome") ?: envelope.getMap("error")?.getString("code")
    }
    assertEquals(listOf("CANCELLED", "ADDED", "SOURCE_OVERLAP", "CANCELLED"), seen)
    assertEquals(1, db.sourceRootDao().all().size)
  }

  private fun CoroutineScope.launch(regrantSourceId: String?): Deferred<WritableMap> =
    async(Dispatchers.IO) { picker.launch(regrantSourceId) }

  private fun assertCancelled(result: WritableMap) {
    assertEquals("ok", result.getString("status"))
    assertEquals("CANCELLED", result.getString("outcome"))
    assertTrue(result.isNull("source"))
  }

  private fun assertError(code: String, result: WritableMap) {
    assertEquals("error", result.getString("status"))
    assertEquals(code, result.getMap("error")!!.getString("code"))
  }

  private companion object {
    const val TIMEOUT = 10_000L
  }
}

/** Records the intents it is asked to start for a result, instead of starting them. */
class RecordingActivity : Activity() {
  val started = LinkedBlockingQueue<Pair<Intent, Int>>()

  @Deprecated("Deprecated in Java")
  override fun startActivityForResult(intent: Intent, requestCode: Int) {
    started.put(intent to requestCode)
  }

  fun awaitStart(): Pair<Intent, Int> =
    checkNotNull(started.poll(10, TimeUnit.SECONDS)) { "the picker was never started" }
}
