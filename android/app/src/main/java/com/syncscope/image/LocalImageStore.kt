package com.syncscope.image

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Size
import com.syncscope.bridge.LocalImageSpec
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.security.MessageDigest
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Decodes one local document into a bitmap whose long edge is at most `edgePx`; null when it cannot. */
fun interface ThumbnailSource {
  fun load(documentUri: String, edgePx: Int): Bitmap?
}

/** The document is gone, its grant was revoked, its storage is missing, or it does not decode. */
class ImageUnavailable(message: String, cause: Throwable? = null) : Exception(message, cause)

/**
 * The largest power of two `s` that keeps the long edge of a `width × height` image at least [edge]
 * after division by `s`; 1 when the image is already at or below [edge]. Used as `inSampleSize`.
 */
fun sampleSizeFor(width: Int, height: Int, edge: Int): Int {
  val longEdge = maxOf(width, height)
  var sample = 1
  while (longEdge / (sample * 2) >= edge) sample *= 2
  return sample
}

/**
 * Local image handles for `getLocalImageHandle` (research R7): a JPEG thumbnail of a local document,
 * cached under `cacheDir/thumbnails/` and named by `sha256(entryId + "|" + edge)`, so the returned
 * `file://` URI never carries the document URI, document ID or a user path. Reads local storage only.
 *
 * At most four loads run at once ([dispatcher]); further calls queue. A cached file is served without
 * a decode. Files are written atomically (temp file + rename), so a reader never sees a partial JPEG.
 * The document URI is never logged.
 */
class LocalImageStore(
  cacheDir: File,
  private val source: ThumbnailSource,
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(MAX_PARALLEL_LOADS),
) {
  private val directory = File(cacheDir, DIRECTORY)

  /**
   * Returns the `file://` URI of [entryId]'s thumbnail at the clamped [maxEdgePx], decoding it from
   * [documentUri] on a cache miss. Throws [ImageUnavailable] when the document cannot be read.
   */
  suspend fun handle(entryId: String, documentUri: String, maxEdgePx: Int): String =
    withContext(dispatcher) {
      val edge = LocalImageSpec.bounded(maxEdgePx)
      val target = File(directory, cacheName(entryId, edge))
      if (!target.isFile) write(target, decode(documentUri, edge))
      Uri.fromFile(target).toString()
    }

  private fun decode(documentUri: String, edge: Int): Bitmap =
    try {
      source.load(documentUri, edge) ?: throw ImageUnavailable("the image did not decode")
    } catch (e: ImageUnavailable) {
      throw e
    } catch (e: FileNotFoundException) {
      throw ImageUnavailable("the document is gone", e)
    } catch (e: SecurityException) {
      throw ImageUnavailable("the folder grant was revoked", e)
    } catch (e: IOException) {
      throw ImageUnavailable("the document could not be read", e)
    } catch (e: IllegalArgumentException) {
      throw ImageUnavailable("the document is not a readable image", e)
    }

  private fun write(target: File, bitmap: Bitmap) {
    if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) {
      throw ImageUnavailable("the thumbnail cache is not writable")
    }
    val temp = File.createTempFile(target.nameWithoutExtension, ".tmp", directory)
    try {
      val written = temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
      if (!written) throw ImageUnavailable("the thumbnail could not be encoded")
      if (!temp.renameTo(target) && !target.isFile) throw ImageUnavailable("the thumbnail could not be stored")
    } catch (e: IOException) {
      throw ImageUnavailable("the thumbnail could not be stored", e)
    } finally {
      temp.delete()
    }
  }

  companion object {
    const val DIRECTORY = "thumbnails"
    const val MAX_PARALLEL_LOADS = 4
    const val JPEG_QUALITY = 85

    fun cacheName(entryId: String, edge: Int): String =
      MessageDigest.getInstance("SHA-256")
        .digest("$entryId|$edge".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) } + ".jpg"
  }
}

/**
 * Production [ThumbnailSource]: the provider's own thumbnail through `ContentResolver.loadThumbnail`,
 * or, when the provider has none (`UnsupportedOperationException`), a bounds read followed by a
 * sampled decode ([sampleSizeFor]) scaled so the long edge is at most `edgePx`.
 */
class ContentResolverThumbnailSource(private val resolver: ContentResolver) : ThumbnailSource {

  override fun load(documentUri: String, edgePx: Int): Bitmap? {
    val uri = Uri.parse(documentUri)
    val bitmap =
      try {
        resolver.loadThumbnail(uri, Size(edgePx, edgePx), null)
      } catch (_: UnsupportedOperationException) {
        decodeSampled(uri, edgePx)
      } ?: return null
    return scaleDown(bitmap, edgePx)
  }

  private fun decodeSampled(uri: Uri, edgePx: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    open(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSizeFor(bounds.outWidth, bounds.outHeight, edgePx) }
    return open(uri).use { BitmapFactory.decodeStream(it, null, options) }
  }

  private fun open(uri: Uri) = resolver.openInputStream(uri) ?: throw FileNotFoundException("the provider returned no stream")

  private fun scaleDown(bitmap: Bitmap, edgePx: Int): Bitmap {
    val longEdge = maxOf(bitmap.width, bitmap.height)
    if (longEdge <= edgePx) return bitmap
    val scale = edgePx.toDouble() / longEdge
    val width = (bitmap.width * scale).roundToInt().coerceIn(1, edgePx)
    val height = (bitmap.height * scale).roundToInt().coerceIn(1, edgePx)
    val scaled = Bitmap.createScaledBitmap(bitmap, width, height, true)
    if (scaled !== bitmap) bitmap.recycle()
    return scaled
  }
}
