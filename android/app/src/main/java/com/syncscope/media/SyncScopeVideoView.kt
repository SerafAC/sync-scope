package com.syncscope.media

import android.content.ContentResolver
import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.os.Build
import android.util.Log
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.widget.FrameLayout
import android.widget.MediaController
import android.widget.VideoView
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.facebook.react.viewmanagers.SyncScopeVideoViewManagerDelegate
import com.facebook.react.viewmanagers.SyncScopeVideoViewManagerInterface
import com.syncscope.persistence.SnapshotNotFoundException
import com.syncscope.persistence.SnapshotStore
import com.syncscope.persistence.SyncScopeDatabase
import kotlin.coroutines.CoroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * The native video view of the preview (009 research R7, contracts/cloudsync-tree-preview.md "New native
 * view: SyncScopeVideoView"). It takes a published snapshot and a `video/` `FILE` entry of it, resolves
 * the local document natively through [SnapshotStore.mediaEntry], and plays it in the platform
 * [VideoView] with a [MediaController] for play/pause and seek. It starts muted. The document URI never
 * leaves native code: it is in no event, no prop and no log line. It plays local content only (R026).
 */

/** The `reason` of `onPlaybackError`. */
enum class VideoPlaybackError {
  /** The snapshot or entry is unknown, or the entry is not a `video/` `FILE`. */
  NOT_A_VIDEO,

  /** The local document cannot be opened. */
  UNAVAILABLE,

  /** The decoder failed. */
  UNPLAYABLE,
}

/** What [VideoResolver] found for an entry. */
sealed interface VideoSource {
  /** A local document that opens. [toString] never includes the URI. */
  class Playable(val uri: Uri) : VideoSource {
    override fun toString(): String = "Playable(<redacted>)"
  }

  data class Failed(val reason: VideoPlaybackError) : VideoSource
}

/** Resolves an entry of a snapshot to its local document. Runs off the main thread. */
fun interface VideoResolver {
  suspend fun resolve(snapshotId: String, entryId: String): VideoSource
}

/**
 * The production [VideoResolver]: the entry must be a `video/` `FILE` of a published snapshot
 * ([MediaKind.VIDEO]), and its document must open for reading.
 */
class StoreVideoResolver(
  private val store: () -> SnapshotStore,
  private val contentResolver: ContentResolver,
) : VideoResolver {
  override suspend fun resolve(snapshotId: String, entryId: String): VideoSource {
    val entry =
      try {
        store().mediaEntry(snapshotId, entryId)
      } catch (_: SnapshotNotFoundException) {
        null
      }
    if (entry == null || MediaKind.of(entry.mimeType) != MediaKind.VIDEO) {
      return VideoSource.Failed(VideoPlaybackError.NOT_A_VIDEO)
    }
    val uri = Uri.parse(entry.documentUri)
    val opens =
      try {
        contentResolver.openFileDescriptor(uri, "r")?.use { true } ?: false
      } catch (_: Exception) {
        false
      }
    return if (opens) VideoSource.Playable(uri) else VideoSource.Failed(VideoPlaybackError.UNAVAILABLE)
  }
}

/** The platform player behind the view, so the view's rules are tested without a decoder. */
interface VideoPlayer {
  /** The view that draws the video; the host adds it as its only child. */
  val view: View

  /** Starts preparing [uri]; [listener] hears when it is ready or failed. */
  fun open(uri: Uri, listener: Listener)

  /** 0 for muted, 1 for full volume. Only after [Listener.onPrepared]. */
  fun setVolume(volume: Float)

  fun start()

  fun pause()

  /** Stops playback and releases the `MediaPlayer`. Safe to call more than once. */
  fun release()

  interface Listener {
    /** Called from inside `OnPreparedListener`. */
    fun onPrepared(durationMillis: Long)

    /** A `MediaPlayer` error; [what] and [extra] are its codes, which carry no URI. */
    fun onError(what: Int, extra: Int)
  }
}

/** [VideoPlayer] over [VideoView] and [MediaController]. */
class PlatformVideoPlayer(context: Context) : VideoPlayer {
  private val videoView = VideoView(context)
  private val controller = BackPassingMediaController(context)
  private var player: MediaPlayer? = null

  override val view: View
    get() = videoView

  init {
    videoView.setMediaController(controller)
  }

  override fun open(uri: Uri, listener: VideoPlayer.Listener) {
    videoView.setOnPreparedListener { mediaPlayer ->
      player = mediaPlayer
      listener.onPrepared(mediaPlayer.duration.toLong())
      // Keep play/pause and seek on screen: the controller otherwise hides itself after 3 s.
      controller.show(0)
    }
    // VideoView hides the controller when the clip ends; show it again so it can be replayed.
    videoView.setOnCompletionListener { controller.show(0) }
    videoView.setOnErrorListener { _, what, extra ->
      listener.onError(what, extra)
      // Handled: no system "Can't play this video" dialog.
      true
    }
    videoView.setVideoURI(uri)
  }

  override fun setVolume(volume: Float) {
    player?.setVolume(volume, volume)
  }

  override fun start() = videoView.start()

  override fun pause() = videoView.pause()

  override fun release() {
    player = null
    controller.hide()
    videoView.stopPlayback()
  }
}

/**
 * The platform controller, kept on screen by [PlatformVideoPlayer], consumes Back to hide itself, so the
 * first Back would not leave the preview. This one hides and passes Back on to the activity: as a key
 * event, and from API 33 also through its window's back dispatcher, where predictive back (target SDK 36)
 * delivers it instead of a key event.
 */
private class BackPassingMediaController(context: Context) : MediaController(context) {
  private var backCallback: Any? = null

  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (event.keyCode != KeyEvent.KEYCODE_BACK) return super.dispatchKeyEvent(event)
    // Hand both key events to the activity, as if the controller were not there, so React Native's
    // back handling (navigation) sees them.
    val activity = (context as? ReactContext)?.currentActivity ?: return super.dispatchKeyEvent(event)
    if (event.action == KeyEvent.ACTION_UP) hide()
    activity.dispatchKeyEvent(event)
    return true
  }

  override fun show(timeout: Int) {
    super.show(timeout)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && backCallback == null) {
      // Above the controller's own callback (PRIORITY_DEFAULT), which would only hide it.
      val callback = OnBackInvokedCallback { passBack() }
      findOnBackInvokedDispatcher()?.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_OVERLAY, callback)
        ?: return
      backCallback = callback
    }
  }

  override fun hide() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      (backCallback as? OnBackInvokedCallback)?.let { findOnBackInvokedDispatcher()?.unregisterOnBackInvokedCallback(it) }
      backCallback = null
    }
    super.hide()
  }

  /**
   * The dispatcher's Back, handed to the activity's own Back. A replayed key pair would be dropped here:
   * with predictive back, the activity no longer turns a Back key into onBackPressed.
   */
  private fun passBack() {
    val activity = (context as? ReactContext)?.currentActivity
    hide()
    // ReactActivity.onBackPressed asks React Native first (navigation), as a Back key does.
    @Suppress("DEPRECATION")
    activity?.onBackPressed()
  }
}

/** Where the view's two events go. */
interface VideoEvents {
  fun playbackError(view: View, reason: VideoPlaybackError)

  fun ready(view: View, durationMillis: Long)
}

/** `onPlaybackError`: only the reason. */
class PlaybackErrorEvent(
  surfaceId: Int,
  viewId: Int,
  private val reason: VideoPlaybackError,
  private val newMap: () -> WritableMap = Arguments::createMap,
) : Event<PlaybackErrorEvent>(surfaceId, viewId) {
  override fun getEventName(): String = NAME

  override fun getEventData(): WritableMap = data()

  fun data(): WritableMap = newMap().apply { putString("reason", reason.name) }

  companion object {
    const val NAME = "topPlaybackError"
  }
}

/** `onReady`: only the duration. */
class ReadyEvent(
  surfaceId: Int,
  viewId: Int,
  private val durationMillis: Long,
  private val newMap: () -> WritableMap = Arguments::createMap,
) : Event<ReadyEvent>(surfaceId, viewId) {
  override fun getEventName(): String = NAME

  override fun getEventData(): WritableMap = data()

  fun data(): WritableMap = newMap().apply { putDouble("durationMillis", durationMillis.toDouble()) }

  companion object {
    const val NAME = "topReady"
  }
}

/** [VideoEvents] dispatched to JS through the surface's event dispatcher. */
class ReactVideoEvents(private val context: ThemedReactContext) : VideoEvents {
  override fun playbackError(view: View, reason: VideoPlaybackError) {
    dispatch(PlaybackErrorEvent(UIManagerHelper.getSurfaceId(view), view.id, reason))
  }

  override fun ready(view: View, durationMillis: Long) {
    dispatch(ReadyEvent(UIManagerHelper.getSurfaceId(view), view.id, durationMillis))
  }

  private fun dispatch(event: Event<*>) {
    UIManagerHelper.getEventDispatcher(context)?.dispatchEvent(event)
  }
}

/**
 * The host view. Props are recorded by the setters and applied together in [commit], which the manager
 * calls after each prop transaction: a changed `snapshotId` or `entryId` resolves and opens the video
 * again, and `muted` and `paused` are applied to a prepared player. The player is released when the view
 * detaches, when the host pauses and when the view is dropped; it opens again on attach or host resume.
 */
class SyncScopeVideoView(
  context: Context,
  private val player: VideoPlayer,
  private val resolver: VideoResolver,
  private val events: VideoEvents,
  mainContext: CoroutineContext = Dispatchers.Main.immediate,
  private val ioContext: CoroutineContext = Dispatchers.IO,
) : FrameLayout(context), LifecycleEventListener {

  private val scope = CoroutineScope(SupervisorJob() + mainContext)
  private var job: Job? = null

  var snapshotId: String? = null
    private set

  var entryId: String? = null
    private set

  var muted: Boolean = true
    private set

  var paused: Boolean = false
    private set

  /** The ids last opened; a [commit] with other ids opens again. */
  private var openedKey: Pair<String, String>? = null
  private var prepared = false
  /** The `paused` last applied to the prepared player, so other prop changes do not resume it. */
  private var appliedPaused: Boolean? = null
  private var hostPaused = false

  init {
    addView(
      player.view,
      LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT, Gravity.CENTER),
    )
  }

  fun setSnapshotId(value: String?) {
    snapshotId = value
  }

  fun setEntryId(value: String?) {
    entryId = value
  }

  fun setMuted(value: Boolean) {
    muted = value
  }

  fun setPaused(value: Boolean) {
    paused = value
  }

  /** Applies the recorded props. */
  fun commit() {
    val key = keyOrNull()
    if (key != openedKey) {
      open()
      return
    }
    if (prepared) {
      applyVolume()
      applyPaused()
    }
  }

  /** Stops and releases the player; a later [commit], attach or host resume opens it again. */
  fun release() {
    job?.cancel()
    job = null
    openedKey = null
    prepared = false
    appliedPaused = null
    player.release()
  }

  /** Releases for good: the view was dropped. */
  fun dispose() {
    release()
    scope.cancel()
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    if (!hostPaused && openedKey == null) open()
  }

  override fun onDetachedFromWindow() {
    release()
    super.onDetachedFromWindow()
  }

  override fun onHostResume() {
    hostPaused = false
    if (isAttachedToWindow && openedKey == null) open()
  }

  override fun onHostPause() {
    hostPaused = true
    release()
  }

  override fun onHostDestroy() {
    dispose()
  }

  // React lays out this view but not its child: measure and lay the player out on every request.
  private val measureAndLayout = Runnable {
    measure(
      MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
      MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY),
    )
    layout(left, top, right, bottom)
  }

  override fun requestLayout() {
    super.requestLayout()
    post(measureAndLayout)
  }

  private fun keyOrNull(): Pair<String, String>? {
    val snapshot = snapshotId
    val entry = entryId
    return if (snapshot == null || entry == null) null else snapshot to entry
  }

  private fun applyVolume() {
    player.setVolume(if (muted) 0f else 1f)
  }

  private fun applyPaused() {
    if (appliedPaused == paused) return
    appliedPaused = paused
    if (paused) player.pause() else player.start()
  }

  private fun open() {
    release()
    val key = keyOrNull() ?: return
    openedKey = key
    job =
      scope.launch {
        val source =
          try {
            withContext(ioContext) { resolver.resolve(key.first, key.second) }
          } catch (e: CancellationException) {
            throw e
          } catch (e: Exception) {
            Log.w(TAG, "video view: resolving failed (${e.javaClass.simpleName})")
            VideoSource.Failed(VideoPlaybackError.UNAVAILABLE)
          }
        when (source) {
          is VideoSource.Failed -> events.playbackError(this@SyncScopeVideoView, source.reason)
          is VideoSource.Playable -> player.open(source.uri, listener)
        }
      }
  }

  private val listener =
    object : VideoPlayer.Listener {
      override fun onPrepared(durationMillis: Long) {
        prepared = true
        // Muted from the first frame: the volume is set before playback starts.
        applyVolume()
        events.ready(this@SyncScopeVideoView, durationMillis.coerceAtLeast(0))
        if (!paused) player.start()
        appliedPaused = paused
      }

      override fun onError(what: Int, extra: Int) {
        Log.w(TAG, "video view: playback failed what=$what extra=$extra")
        release()
        events.playbackError(this@SyncScopeVideoView, VideoPlaybackError.UNPLAYABLE)
      }
    }

  companion object {
    private const val TAG = "SyncScopeVideo"
  }
}

/**
 * The view manager of `SyncScopeVideoView`, over the Codegen delegate. The factories are seams for
 * `SyncScopeVideoViewManagerTest`; the defaults resolve through the app's [SnapshotStore] and play in
 * [PlatformVideoPlayer].
 */
@ReactModule(name = SyncScopeVideoViewManager.NAME)
class SyncScopeVideoViewManager(
  private val resolverFor: (ThemedReactContext) -> VideoResolver = { context ->
    StoreVideoResolver({ SnapshotStore(SyncScopeDatabase.get(context.applicationContext)) }, context.contentResolver)
  },
  private val playerFor: (Context) -> VideoPlayer = ::PlatformVideoPlayer,
  private val eventsFor: (ThemedReactContext) -> VideoEvents = ::ReactVideoEvents,
  private val mainContext: CoroutineContext = Dispatchers.Main.immediate,
  private val ioContext: CoroutineContext = Dispatchers.IO,
) : SimpleViewManager<SyncScopeVideoView>(), SyncScopeVideoViewManagerInterface<SyncScopeVideoView> {

  private val delegate = SyncScopeVideoViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<SyncScopeVideoView> = delegate

  override fun getName(): String = NAME

  public override fun createViewInstance(context: ThemedReactContext): SyncScopeVideoView {
    val view =
      SyncScopeVideoView(
        context,
        playerFor(context),
        resolverFor(context),
        eventsFor(context),
        mainContext,
        ioContext,
      )
    context.addLifecycleEventListener(view)
    return view
  }

  override fun onDropViewInstance(view: SyncScopeVideoView) {
    (view.context as? ThemedReactContext)?.removeLifecycleEventListener(view)
    view.dispose()
    super.onDropViewInstance(view)
  }

  @ReactProp(name = "snapshotId")
  override fun setSnapshotId(view: SyncScopeVideoView, value: String?) = view.setSnapshotId(value)

  @ReactProp(name = "entryId")
  override fun setEntryId(view: SyncScopeVideoView, value: String?) = view.setEntryId(value)

  @ReactProp(name = "muted", defaultBoolean = true)
  override fun setMuted(view: SyncScopeVideoView, value: Boolean) = view.setMuted(value)

  @ReactProp(name = "paused", defaultBoolean = false)
  override fun setPaused(view: SyncScopeVideoView, value: Boolean) = view.setPaused(value)

  override fun onAfterUpdateTransaction(view: SyncScopeVideoView) {
    super.onAfterUpdateTransaction(view)
    view.commit()
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> {
    val base = super.getExportedCustomDirectEventTypeConstants().orEmpty()
    return base.toMutableMap().apply {
      put(PlaybackErrorEvent.NAME, mapOf("registrationName" to "onPlaybackError"))
      put(ReadyEvent.NAME, mapOf("registrationName" to "onReady"))
    }
  }

  companion object {
    const val NAME = "SyncScopeVideoView"
  }
}
