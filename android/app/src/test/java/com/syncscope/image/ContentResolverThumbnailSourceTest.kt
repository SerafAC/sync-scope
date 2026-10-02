package com.syncscope.image

import android.content.ContentResolver
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.CancellationSignal
import android.util.Size
import androidx.test.core.app.ApplicationProvider
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import org.junit.Assert.assertEquals
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

  /** A provider without thumbnail support: `loadThumbnail` throws, `openInputStream` still works. */
  @Implements(ContentResolver::class)
  class NoThumbnailContentResolver : ShadowContentResolver() {
    @Implementation
    fun loadThumbnail(uri: Uri, size: Size, signal: CancellationSignal?): Bitmap =
      throw UnsupportedOperationException("no thumbnail for $uri")
  }

  private val resolver = ApplicationProvider.getApplicationContext<Context>().contentResolver

  @Test
  fun anUnsupportedThumbnailFallsBackToASampledDecode() {
    val uri = Uri.parse("content://com.example.documents/document/wide.png")
    val png = encodedPng(width = 2000, height = 1000)
    Shadow.extract<NoThumbnailContentResolver>(resolver).registerInputStreamSupplier(uri) { ByteArrayInputStream(png) }

    val bitmap = ContentResolverThumbnailSource(resolver).load(uri.toString(), 256)!!

    assertTrue("long edge ${bitmap.width} ≤ 256", maxOf(bitmap.width, bitmap.height) <= 256)
    assertTrue("long edge ${bitmap.width} close to 256", maxOf(bitmap.width, bitmap.height) >= 200)
    assertEquals("aspect ratio kept", 2.0, bitmap.width.toDouble() / bitmap.height, 0.05)
  }

  @Test
  fun aSmallImageIsDecodedAtItsOwnSize() {
    val uri = Uri.parse("content://com.example.documents/document/small.png")
    val png = encodedPng(width = 120, height = 80)
    Shadow.extract<NoThumbnailContentResolver>(resolver).registerInputStreamSupplier(uri) { ByteArrayInputStream(png) }

    val bitmap = ContentResolverThumbnailSource(resolver).load(uri.toString(), 256)!!

    assertEquals(120, bitmap.width)
    assertEquals(80, bitmap.height)
  }

  private fun encodedPng(width: Int, height: Int): ByteArray {
    val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
    bitmap.eraseColor(Color.RED)
    return ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }.toByteArray()
  }
}
