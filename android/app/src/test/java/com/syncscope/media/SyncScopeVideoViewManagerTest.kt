package com.syncscope.media

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.view.View
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import com.facebook.react.bridge.BridgeReactContext
import com.facebook.react.bridge.JavaOnlyMap
import com.facebook.react.uimanager.ReactStylesDiffMap
import com.facebook.react.uimanager.ThemedReactContext
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SyncScopeDatabase
import com.syncscope.persistence.localNode
import com.syncscope.persistence.sourceRoot
import com.syncscope.persistence.stagingSnapshot
import java.io.File
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowLog

/**
 * `SyncScopeVideoView` and its manager (009 research R7, contracts/cloudsync-tree-preview.md "New native
 * view"): prop parsing with the Codegen defaults, the three error reasons, `onReady` with the duration,
 * volume 0 while muted, release on detach and on host pause, and no document URI in an event or a log.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
class SyncScopeVideoViewManagerTest {

  private lateinit var context: Context
  private lateinit var reactContext: BridgeReactContext
  private lateinit var themed: ThemedReactContext
  private val players = mutableListOf<FakePlayer>()
  private val events = RecordingEvents()
  private var resolver = VideoResolver { _, _ -> VideoSource.Playable(Uri.parse(SECRET_URI)) }

  private lateinit var manager: SyncScopeVideoViewManager

  @Before
  fun setUp() {
    ShadowLog.clear()
    context = ApplicationProvider.getApplicationContext()
    reactContext = BridgeReactContext(context)
    themed = ThemedReactContext(reactContext, context, null, 1)
    manager =
      SyncScopeVideoViewManager(
        resolverFor = { VideoResolver { s, e -> resolver.resolve(s, e) } },
        playerFor = { ctx -> FakePlayer(ctx).also { players += it } },
        eventsFor = { events },
        mainContext = Dispatchers.Unconfined,
        ioContext = Dispatchers.Unconfined,
      )
  }

  private fun create(): SyncScopeVideoView = manager.createViewInstance(themed)

  private fun update(view: SyncScopeVideoView, vararg props: Any?) {
    manager.updateProperties(view, ReactStylesDiffMap(JavaOnlyMap.of(*props)))
  }

  private val player: FakePlayer
    get() = players.single()

  /** A layout inside a resumed activity's window, so added views attach. */
  private fun attachedParent(): android.widget.FrameLayout {
    val activity = Robolectric.buildActivity(android.app.Activity::class.java).setup().get()
    val parent = android.widget.FrameLayout(activity)
    activity.setContentView(parent)
    return parent
  }

  // --- props ---

  @Test
  fun propsAreParsedWithMutedTrueAndPausedFalseByDefault() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")

    assertEquals("snap-1", view.snapshotId)
    assertEquals("e-1", view.entryId)
    assertTrue("muted defaults to true", view.muted)
    assertFalse("paused defaults to false", view.paused)

    update(view, "muted", false, "paused", true)
    assertFalse(view.muted)
    assertTrue(view.paused)

    // A prop reset to null goes back to its Codegen default.
    update(view, "muted", null, "paused", null)
    assertTrue(view.muted)
    assertFalse(view.paused)
  }

  @Test
  fun theManagerIsNamedAndExportsBothEvents() {
    assertEquals("SyncScopeVideoView", manager.name)
    val constants = manager.exportedCustomDirectEventTypeConstants!!
    assertEquals(mapOf("registrationName" to "onPlaybackError"), constants["topPlaybackError"])
    assertEquals(mapOf("registrationName" to "onReady"), constants["topReady"])
  }

  // --- playback ---

  @Test
  fun aPreparedVideoIsMutedReportsItsDurationAndPlays() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")

    assertEquals(listOf(Uri.parse(SECRET_URI)), player.opened)
    player.prepare(2_000L)

    assertEquals("volume 0 before playback starts", listOf(0f), player.volumes)
    assertEquals(listOf("ready:2000"), events.log)
    assertEquals(1, player.starts)
  }

  @Test
  fun theMuteToggleSetsTheVolumeAndPausedPausesAndResumes() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    player.prepare(2_000L)

    update(view, "muted", false)
    assertEquals(1f, player.volumes.last())
    assertEquals("a mute change does not restart playback", 1, player.starts)

    update(view, "muted", true)
    assertEquals(0f, player.volumes.last())

    update(view, "paused", true)
    assertEquals(1, player.pauses)
    update(view, "paused", false)
    assertEquals(2, player.starts)
    assertEquals("the same video is not opened again", 1, player.opened.size)
  }

  @Test
  fun aVideoPausedBeforeItIsReadyDoesNotStart() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1", "paused", true)
    player.prepare(1_000L)

    assertEquals(0, player.starts)
    assertEquals(listOf(0f), player.volumes)
  }

  @Test
  fun aNewEntryOpensAgain() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    update(view, "entryId", "e-2")

    assertEquals(2, player.opened.size)
    assertTrue(player.releases >= 1)
  }

  // --- errors ---

  @Test
  fun anUnknownOrNonVideoEntryRaisesNotAVideo() {
    resolver = VideoResolver { _, _ -> VideoSource.Failed(VideoPlaybackError.NOT_A_VIDEO) }
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")

    assertEquals(listOf("error:NOT_A_VIDEO"), events.log)
    assertTrue(player.opened.isEmpty())
  }

  @Test
  fun anUnopenableDocumentRaisesUnavailable() {
    resolver = VideoResolver { _, _ -> VideoSource.Failed(VideoPlaybackError.UNAVAILABLE) }
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")

    assertEquals(listOf("error:UNAVAILABLE"), events.log)
  }

  @Test
  fun aResolverFailureRaisesUnavailable() {
    resolver = VideoResolver { _, _ -> throw IllegalStateException("db closed at $SECRET_URI") }
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")

    assertEquals(listOf("error:UNAVAILABLE"), events.log)
    assertNoSecretLogged()
  }

  @Test
  fun aMediaPlayerErrorRaisesUnplayableAndReleases() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    player.fail(1, -1004)

    assertEquals(listOf("error:UNPLAYABLE"), events.log)
    assertTrue(player.releases >= 1)
  }

  // --- release ---

  @Test
  fun theMediaPlayerIsReleasedOnDetachAndOpensAgainOnAttach() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    player.prepare(2_000L)
    val parent = attachedParent()
    parent.addView(view)
    val before = player.releases

    parent.removeView(view)
    assertEquals(before + 1, player.releases)

    parent.addView(view)
    assertEquals(2, player.opened.size)
  }

  @Test
  fun theMediaPlayerIsReleasedOnHostPauseAndOpensAgainOnResume() {
    val view = create()
    val parent = attachedParent()
    parent.addView(view)
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    player.prepare(2_000L)
    val before = player.releases

    reactContext.onHostPause()
    assertEquals(before + 1, player.releases)

    reactContext.onHostResume(null)
    assertEquals(2, player.opened.size)
  }

  @Test
  fun aDroppedViewReleasesAndStopsListeningToTheHost() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    manager.onDropViewInstance(view)
    val after = player.releases
    assertTrue(after >= 1)

    reactContext.onHostResume(null)
    assertEquals("no reopen after drop", 1, player.opened.size)
  }

  // --- no URI anywhere ---

  @Test
  fun theDocumentUriIsNeverInAnEventOrALog() {
    val view = create()
    update(view, "snapshotId", "snap-1", "entryId", "e-1")
    player.prepare(2_000L)
    player.fail(100, 0)

    val error = PlaybackErrorEvent(1, 7, VideoPlaybackError.UNPLAYABLE) { JavaOnlyMap() }
    assertEquals(mapOf("reason" to "UNPLAYABLE"), error.data().toHashMap())
    val ready = ReadyEvent(1, 7, 2_000L) { JavaOnlyMap() }
    assertEquals(mapOf("durationMillis" to 2_000.0), ready.data().toHashMap())
    assertEquals("topPlaybackError", error.eventName)
    assertEquals("topReady", ready.eventName)
    assertFalse(VideoSource.Playable(Uri.parse(SECRET_URI)).toString().contains("content://"))
    assertNoSecretLogged()
  }

  // --- the store resolver ---

  @Test
  fun theStoreResolverMapsEachEntryToItsReason() = runBlocking {
    val db =
      Room.inMemoryDatabaseBuilder(context, SyncScopeDatabase::class.java).allowMainThreadQueries().build()
    try {
      val store = SnapshotStore(db)
      db.sourceRootDao().upsert(sourceRoot("src-1"))
      store.beginRun("run-1", mode = "FULL", configRevision = 1L, phase = "CONNECTING", startedAtMillis = 1_000L)
      store.stageSnapshot(stagingSnapshot("snap-1", "run-1"))
      store.stageLocalNodes(
        listOf(
          localNode("snap-1", "src-1", "dir", "Camera", kind = "DIRECTORY", sizeBytes = null),
          localNode("snap-1", "src-1", "clip", "clip.mp4", parentId = "dir", mimeType = "video/mp4"),
          localNode("snap-1", "src-1", "gone", "gone.mp4", parentId = "dir", mimeType = "video/mp4"),
          localNode("snap-1", "src-1", "photo", "photo.jpg", parentId = "dir", mimeType = "image/jpeg"),
          localNode("snap-1", "src-1", "doc", "notes.txt", parentId = "dir", mimeType = "text/plain"),
        ),
      )
      store.publish("run-1", 1L, 1L, "COMPLETED", 5_000L)
      // The fixture's documents are content://provider/doc/<entryId>; only "clip" opens.
      Robolectric.setupContentProvider(OneDocumentProvider::class.java, "provider")
      val resolver = StoreVideoResolver({ store }, context.contentResolver)

      val clip = resolver.resolve("snap-1", "clip")
      assertTrue(clip is VideoSource.Playable)
      assertEquals(Uri.parse("content://provider/doc/clip"), (clip as VideoSource.Playable).uri)
      assertEquals(VideoSource.Failed(VideoPlaybackError.UNAVAILABLE), resolver.resolve("snap-1", "gone"))
      for (entryId in listOf("photo", "doc", "dir", "no-such-entry")) {
        assertEquals(entryId, VideoSource.Failed(VideoPlaybackError.NOT_A_VIDEO), resolver.resolve("snap-1", entryId))
      }
      assertEquals(VideoSource.Failed(VideoPlaybackError.NOT_A_VIDEO), resolver.resolve("no-such-snapshot", "clip"))
    } finally {
      db.close()
    }
  }

  @After
  fun tearDown() {
    assertNoSecretLogged()
  }

  private fun assertNoSecretLogged() {
    for (item in ShadowLog.getLogs()) {
      val text = "${item.msg} ${item.throwable}"
      for (secret in listOf("content://", "secret-clip", "provider/doc")) {
        assertFalse("'$secret' was logged: $text", text.contains(secret))
      }
    }
  }

  /** Records what the view asks of the platform player; [prepare] and [fail] play the decoder. */
  private class FakePlayer(context: Context) : VideoPlayer {
    override val view: View = View(context)
    val opened = mutableListOf<Uri>()
    val volumes = mutableListOf<Float>()
    var starts = 0
    var pauses = 0
    var releases = 0
    private var listener: VideoPlayer.Listener? = null

    override fun open(uri: Uri, listener: VideoPlayer.Listener) {
      opened += uri
      this.listener = listener
    }

    override fun setVolume(volume: Float) {
      volumes += volume
    }

    override fun start() {
      starts += 1
    }

    override fun pause() {
      pauses += 1
    }

    override fun release() {
      releases += 1
      listener = null
    }

    fun prepare(durationMillis: Long) = listener!!.onPrepared(durationMillis)

    fun fail(what: Int, extra: Int) = listener!!.onError(what, extra)
  }

  private class RecordingEvents : VideoEvents {
    val log = mutableListOf<String>()

    override fun playbackError(view: View, reason: VideoPlaybackError) {
      log += "error:${reason.name}"
    }

    override fun ready(view: View, durationMillis: Long) {
      log += "ready:$durationMillis"
    }
  }

  companion object {
    const val SECRET_URI = "content://com.android.externalstorage.documents/document/primary%3ADCIM%2Fsecret-clip.mp4"
  }
}

/** A provider whose only readable document is `content://provider/doc/clip`. */
class OneDocumentProvider : ContentProvider() {
  override fun onCreate(): Boolean = true

  override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor? {
    if (uri.lastPathSegment != "clip") throw java.io.FileNotFoundException("no such document")
    val file = File.createTempFile("clip", ".mp4", context!!.cacheDir)
    return ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
  }

  override fun query(uri: Uri, p: Array<out String>?, s: String?, a: Array<out String>?, o: String?): Cursor? = null

  override fun getType(uri: Uri): String? = null

  override fun insert(uri: Uri, values: ContentValues?): Uri? = null

  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
