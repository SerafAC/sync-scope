package com.syncscope.image

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.CancellationSignal
import android.util.Size
import androidx.test.core.app.ApplicationProvider
import com.syncscope.media.MediaKind
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.FileNotFoundException
import java.io.IOException
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [36], shadows = [ContentResolverThumbnailSourceTest.NoThumbnailContentResolver::class])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ContentResolverThumbnailSourceTest {

  /**
   * A provider without thumbnail support by default: `loadThumbnail` throws, `openInputStream` still
   * works. A test sets [thumbnail] to make the provider answer, or fail, instead.
   */
  @Implements(ContentResolver::class)
  class NoThumbnailContentResolver : ShadowContentResolver() {
    @Implementation
    fun loadThumbnail(uri: Uri, size: Size, signal: CancellationSignal?): Bitmap? {
      requestedSizes += size
      val answer = thumbnail ?: throw UnsupportedOperationException("no thumbnail for $uri")
      return answer()
    }

    companion object {
      @JvmStatic var thumbnail: (() -> Bitmap?)? = null
      @JvmStatic val requestedSizes: MutableList<Size> = mutableListOf()
    }
  }

  /** Records each read and answers with [frame] and [duration], or throws [failure]. */
  private class FakeVideoRetriever : VideoRetriever {
    val reads = mutableListOf<Triple<Uri, Int, Boolean>>()
    var frame: Bitmap? = null
    var duration: String? = null
    var failure: Exception? = null

    override fun read(uri: Uri, edgePx: Int, withFrame: Boolean): VideoProbe {
      reads += Triple(uri, edgePx, withFrame)
      failure?.let { throw it }
      return VideoProbe(if (withFrame) frame else null, duration)
    }
  }

  private val resolver = ApplicationProvider.getApplicationContext<Context>().contentResolver
  private val videos = FakeVideoRetriever()

  @After
  fun tearDown() {
    NoThumbnailContentResolver.thumbnail = null
    NoThumbnailContentResolver.requestedSizes.clear()
  }

  @Test
  fun anUnsupportedThumbnailFallsBackToASampledDecode() {
    val uri = Uri.parse("content://com.example.documents/document/wide.png")
    val png = encodedPng(width = 2000, height = 1000)
    Shadow.extract<NoThumbnailContentResolver>(resolver).registerInputStreamSupplier(uri) { ByteArrayInputStream(png) }

    val bitmap = ContentResolverThumbnailSource(resolver, videos).load(uri.toString(), 256, MediaKind.IMAGE)!!.bitmap

    assertTrue("long edge ${bitmap.width} ≤ 256", maxOf(bitmap.width, bitmap.height) <= 256)
    assertTrue("long edge ${bitmap.width} close to 256", maxOf(bitmap.width, bitmap.height) >= 200)
    assertEquals("aspect ratio kept", 2.0, bitmap.width.toDouble() / bitmap.height, 0.05)
  }

  @Test
  fun aSmallImageIsDecodedAtItsOwnSize() {
    val uri = Uri.parse("content://com.example.documents/document/small.png")
    val png = encodedPng(width = 120, height = 80)
    Shadow.extract<NoThumbnailContentResolver>(resolver).registerInputStreamSupplier(uri) { ByteArrayInputStream(png) }

    val bitmap = ContentResolverThumbnailSource(resolver, videos).load(uri.toString(), 256, MediaKind.IMAGE)!!.bitmap

    assertEquals(120, bitmap.width)
    assertEquals(80, bitmap.height)
  }

  @Test
  fun anImageNeverReadsTheVideoRetrieverAndHasNoDuration() {
    val uri = Uri.parse("content://com.example.documents/document/small.png")
    val png = encodedPng(width = 120, height = 80)
    Shadow.extract<NoThumbnailContentResolver>(resolver).registerInputStreamSupplier(uri) { ByteArrayInputStream(png) }
    videos.duration = "2000"

    val thumbnail = ContentResolverThumbnailSource(resolver, videos).load(uri.toString(), 256, MediaKind.IMAGE)!!

    assertNull(thumbnail.durationMillis)
    assertTrue(videos.reads.isEmpty())
  }

  // --- videos (research R6) ---

  @Test
  fun aVideoUsesTheProviderThumbnailAndReadsOnlyTheDurationFromTheRetriever() {
    val provided = Bitmap.createBitmap(512, 288, Bitmap.Config.ARGB_8888)
    NoThumbnailContentResolver.thumbnail = { provided }
    videos.duration = "2000"

    val thumbnail = ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO)!!

    assertEquals(listOf(Size(256, 256)), NoThumbnailContentResolver.requestedSizes)
    assertEquals(listOf(Triple(VIDEO, 256, false)), videos.reads)
    assertEquals(2_000L, thumbnail.durationMillis)
    // The provider's frame is scaled down to the edge, keeping its aspect ratio.
    assertEquals(256, thumbnail.bitmap.width)
    assertEquals(144, thumbnail.bitmap.height)
  }

  @Test
  fun aVideoFallsBackToTheRetrieverFrameWhenTheProviderHasNoThumbnail() {
    val failures =
      listOf<(() -> Bitmap?)?>(
        null, // UnsupportedOperationException
        { throw IOException("the provider could not make a thumbnail") },
        { null }, // the provider returned nothing
      )
    for ((index, behaviour) in failures.withIndex()) {
      NoThumbnailContentResolver.thumbnail = behaviour
      videos.reads.clear()
      val frame = Bitmap.createBitmap(200, 100, Bitmap.Config.ARGB_8888)
      videos.frame = frame
      videos.duration = "65000"

      val thumbnail = ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO)!!

      assertEquals("case $index", listOf(Triple(VIDEO, 256, true)), videos.reads)
      assertSame("case $index", frame, thumbnail.bitmap)
      assertEquals("case $index", 65_000L, thumbnail.durationMillis)
    }
  }

  @Test
  fun aVideoWithNoFrameAnywhereIsNull() {
    videos.frame = null
    videos.duration = "2000"

    assertNull(ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO))
  }

  @Test
  fun aFallbackThatCannotOpenTheVideoPropagatesSoTheStoreReportsItUnavailable() {
    videos.failure = FileNotFoundException("gone")

    assertThrows(FileNotFoundException::class.java) {
      ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO)
    }
  }

  @Test
  fun anUnreadableDurationIsNullAndDoesNotLoseTheProviderFrame() {
    NoThumbnailContentResolver.thumbnail = { Bitmap.createBitmap(64, 64, Bitmap.Config.ARGB_8888) }
    for (duration in listOf(null, "", "abc", "-1", "12.5")) {
      videos.duration = duration
      val thumbnail = ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO)!!
      assertNull("'$duration'", thumbnail.durationMillis)
    }
    // A retriever that cannot open the file only costs the duration when the provider gave a frame.
    videos.failure = RuntimeException("setDataSource failed")
    val thumbnail = ContentResolverThumbnailSource(resolver, videos).load(VIDEO.toString(), 256, MediaKind.VIDEO)!!
    assertNull(thumbnail.durationMillis)
    assertEquals(64, thumbnail.bitmap.width)
  }

  @Test
  fun durationTextIsParsedAsNonNegativeWholeMilliseconds() {
    assertEquals(2_000L, parseDurationMillis("2000"))
    assertEquals(0L, parseDurationMillis("0"))
    assertEquals(2_000L, parseDurationMillis(" 2000 "))
    for (bad in listOf(null, "", "abc", "-1", "12.5")) assertNull("'$bad'", parseDurationMillis(bad))
  }

  private fun encodedPng(width: Int, height: Int): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.RED)
    return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
  }

  private companion object {
    val VIDEO: Uri = Uri.parse("content://com.example.documents/document/clip.mp4")
  }
}
