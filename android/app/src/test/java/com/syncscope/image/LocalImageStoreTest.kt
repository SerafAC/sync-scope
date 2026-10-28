package com.syncscope.image

import android.content.Context
import android.graphics.Bitmap
import androidx.test.core.app.ApplicationProvider
import com.syncscope.media.MediaKind
import java.io.File
import java.io.FileNotFoundException
import java.security.MessageDigest
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class LocalImageStoreTest {

  private lateinit var cacheDir: File
  private val source = FakeThumbnailSource()
  private lateinit var store: LocalImageStore

  @Before
  fun setUp() {
    cacheDir = ApplicationProvider.getApplicationContext<Context>().cacheDir
    File(cacheDir, "thumbnails").deleteRecursively()
    store = LocalImageStore(cacheDir, source)
  }

  @After
  fun tearDown() {
    File(cacheDir, "thumbnails").deleteRecursively()
  }

  @Test
  fun aFirstCallDecodesOnceAndASecondCallIsServedFromTheCache() = runBlocking {
    val first = store.handle(ENTRY_ID, DOCUMENT_URI, 256)

    val expected = File(File(cacheDir, "thumbnails"), sha256("$ENTRY_ID|256") + ".jpg")
    assertTrue("thumbnail written to $expected", expected.isFile)
    assertTrue(expected.length() > 0)
    assertEquals(1, source.loads.get())
    assertEquals(listOf(Triple(DOCUMENT_URI, 256, MediaKind.IMAGE)), source.requests)

    val second = store.handle(ENTRY_ID, DOCUMENT_URI, 256)

    assertEquals(first, second)
    assertEquals("no second decode", 1, source.loads.get())
    // No temp file is left next to the thumbnail.
    assertEquals(listOf(expected.name), File(cacheDir, "thumbnails").list()!!.toList())
  }

  @Test
  fun theUriIsAFileUriThatCarriesNoDocumentIdentity() = runBlocking {
    val uri = store.handle(ENTRY_ID, DOCUMENT_URI, 256).uri

    assertTrue(uri, uri.startsWith("file://"))
    assertFalse(uri, uri.contains(DOCUMENT_URI))
    assertFalse(uri, uri.contains(DOCUMENT_ID))
    assertFalse(uri, uri.contains("secret"))
    assertFalse(uri, uri.contains(ENTRY_ID))
  }

  @Test
  fun theEdgeIsClampedToTheContractBounds() = runBlocking {
    store.handle(ENTRY_ID, DOCUMENT_URI, 10)
    store.handle(ENTRY_ID, DOCUMENT_URI, 5000)

    assertEquals(listOf(DOCUMENT_URI to 64, DOCUMENT_URI to 2048), source.requests.map { it.first to it.second })
    val names = File(cacheDir, "thumbnails").list()!!.toSet()
    assertEquals(setOf(sha256("$ENTRY_ID|64") + ".jpg", sha256("$ENTRY_ID|2048") + ".jpg"), names)
    // A clamped request hits the same cache entry as the bound itself.
    store.handle(ENTRY_ID, DOCUMENT_URI, 1)
    assertEquals(2, source.loads.get())
  }

  @Test
  fun sampleSizeIsTheLargestPowerOfTwoKeepingTheLongEdgeAtLeastTheTarget() {
    assertEquals(8, sampleSizeFor(4000, 3000, 256))
    assertEquals(1, sampleSizeFor(300, 200, 256))
    assertEquals(1, sampleSizeFor(256, 256, 256))
    assertEquals(8, sampleSizeFor(3000, 4000, 256))
    assertEquals(2, sampleSizeFor(512, 10, 256))
    assertEquals(1, sampleSizeFor(511, 10, 256))
  }

  @Test
  fun unreadableDocumentsAreImageUnavailable() {
    val failures =
      listOf<() -> Bitmap?>(
        { throw FileNotFoundException("content://gone") },
        { throw SecurityException("grant revoked") },
        { null },
      )
    for ((index, failure) in failures.withIndex()) {
      source.behaviour = failure
      assertThrows("failure $index", ImageUnavailable::class.java) {
        runBlocking { store.handle("entry-$index", DOCUMENT_URI, 256) }
      }
    }
    // A failed load leaves nothing in the cache, so a later call retries.
    assertEquals(0, File(cacheDir, "thumbnails").list()?.size ?: 0)
  }

  @Test
  fun atMostFourLoadsRunAtOnce() = runBlocking {
    val gate = CountDownLatch(1)
    val current = AtomicInteger()
    val peak = AtomicInteger()
    val entered = AtomicInteger()
    source.behaviour = {
      val now = current.incrementAndGet()
      peak.accumulateAndGet(now) { a, b -> maxOf(a, b) }
      entered.incrementAndGet()
      gate.await(10, TimeUnit.SECONDS)
      current.decrementAndGet()
      Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888)
    }

    val calls = (1..8).map { i -> async(Dispatchers.Default) { store.handle("entry-$i", DOCUMENT_URI, 256).uri } }
    val deadline = System.currentTimeMillis() + 10_000
    while (entered.get() < 4 && System.currentTimeMillis() < deadline) Thread.sleep(10)
    // Give a fifth load every chance to start before the gate opens.
    Thread.sleep(300)
    assertEquals(4, entered.get())
    gate.countDown()
    val uris = calls.awaitAll()

    assertEquals(8, uris.toSet().size)
    assertEquals(4, peak.get())
    assertEquals(8, source.loads.get())
  }

  // --- videos (research R6) ---

  @Test
  fun aVideoKeepsItsDurationInASidecarWrittenBesideTheJpeg() = runBlocking {
    source.durationMillis = 2_000L

    val handle = store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO)

    assertEquals(2_000L, handle.durationMillis)
    assertEquals(listOf(Triple(VIDEO_URI, 256, MediaKind.VIDEO)), source.requests)
    val hash = sha256("$ENTRY_ID|256")
    val directory = File(cacheDir, "thumbnails")
    assertTrue(File(directory, "$hash.jpg").length() > 0)
    // The duration in milliseconds, as decimal text.
    assertEquals("2000", File(directory, "$hash.meta").readText())
    // Both files were written through a temp file and a rename: no temp file is left.
    assertEquals(setOf("$hash.jpg", "$hash.meta"), directory.list()!!.toSet())
    assertFalse(handle.uri, handle.uri.contains(".meta"))
  }

  @Test
  fun aCacheHitReturnsTheVideoDurationWithoutADecode() = runBlocking {
    source.durationMillis = 3_723_000L
    val first = store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO)

    val second = store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO)

    assertEquals(first, second)
    assertEquals(3_723_000L, second.durationMillis)
    assertEquals("no second decode", 1, source.loads.get())
  }

  @Test
  fun anImageHasNoSidecarAndNoDuration() = runBlocking {
    // Even when a source reports one, an image never gets a duration.
    source.durationMillis = 5_000L

    val first = store.handle(ENTRY_ID, DOCUMENT_URI, 256, MediaKind.IMAGE)
    val hit = store.handle(ENTRY_ID, DOCUMENT_URI, 256, MediaKind.IMAGE)

    assertNull(first.durationMillis)
    assertNull(hit.durationMillis)
    assertEquals(listOf(sha256("$ENTRY_ID|256") + ".jpg"), File(cacheDir, "thumbnails").list()!!.toList())
  }

  @Test
  fun aVideoWhoseDurationCannotBeReadHasNoSidecar() = runBlocking {
    for ((index, unreadable) in listOf(null, -1L).withIndex()) {
      source.durationMillis = unreadable
      val entryId = "video-$index"

      val first = store.handle(entryId, VIDEO_URI, 256, MediaKind.VIDEO)
      val hit = store.handle(entryId, VIDEO_URI, 256, MediaKind.VIDEO)

      assertNull("case $index", first.durationMillis)
      assertNull("case $index", hit.durationMillis)
      assertFalse("case $index", File(File(cacheDir, "thumbnails"), sha256("$entryId|256") + ".meta").exists())
    }
    assertEquals("each cache hit was served without a decode", 2, source.loads.get())
  }

  @Test
  fun aSidecarThatDoesNotHoldADurationIsIgnoredOnACacheHit() = runBlocking {
    source.durationMillis = 2_000L
    store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO)
    val meta = File(File(cacheDir, "thumbnails"), sha256("$ENTRY_ID|256") + ".meta")

    for (garbage in listOf("", "abc", "-5", "12.5")) {
      meta.writeText(garbage)
      assertNull("'$garbage'", store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO).durationMillis)
    }
    assertEquals(1, source.loads.get())
  }

  @Test
  fun aVideoWhoseFrameCannotBeReadIsImageUnavailableAndLeavesNothingInTheCache() {
    source.durationMillis = 2_000L
    source.behaviour = { null }

    assertThrows(ImageUnavailable::class.java) {
      runBlocking { store.handle(ENTRY_ID, VIDEO_URI, 256, MediaKind.VIDEO) }
    }
    assertEquals(0, File(cacheDir, "thumbnails").list()?.size ?: 0)
  }

  /**
   * Returns an `edge × edge/2` bitmap unless [behaviour] is set, with [durationMillis] as the duration
   * it read (the store keeps it only for videos).
   */
  private class FakeThumbnailSource : ThumbnailSource {
    val loads = AtomicInteger()
    val requests: MutableList<Triple<String, Int, MediaKind>> = java.util.Collections.synchronizedList(mutableListOf())
    var behaviour: (() -> Bitmap?)? = null
    @Volatile var durationMillis: Long? = null

    override fun load(documentUri: String, edgePx: Int, kind: MediaKind): Thumbnail? {
      loads.incrementAndGet()
      requests += Triple(documentUri, edgePx, kind)
      val bitmap =
        behaviour?.invoke() ?: if (behaviour == null) Bitmap.createBitmap(edgePx, edgePx / 2, Bitmap.Config.ARGB_8888) else null
      return bitmap?.let { Thumbnail(it, durationMillis) }
    }
  }

  private fun sha256(value: String): String =
    MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString("") { "%02x".format(it) }

  private companion object {
    const val ENTRY_ID = "entry-1"
    const val DOCUMENT_ID = "primary:DCIM/secret.png"
    const val DOCUMENT_URI = "content://com.android.externalstorage.documents/document/primary%3ADCIM%2Fsecret.png"
    const val VIDEO_URI = "content://com.android.externalstorage.documents/document/primary%3ADCIM%2Fclip.mp4"
  }
}
