package com.syncscope.image

import android.content.ContentResolver
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Size
import com.syncscope.bridge.LocalImageSpec
import com.syncscope.media.MediaKind
import java.io.File
import java.io.FileNotFoundException
import java.io.IOException
import java.io.OutputStream
import java.security.MessageDigest
import kotlin.math.roundToInt
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * One decoded local thumbnail: a bitmap whose long edge is at most the requested edge and, for a video,
 * its duration in milliseconds (null when it cannot be read, and always null for an image).
 */
class Thumbnail(val bitmap: Bitmap, val durationMillis: Long? = null)

/** Decodes one local document of [MediaKind] into a [Thumbnail] at most `edgePx` long; null when it cannot. */
fun interface ThumbnailSource {
  fun load(documentUri: String, edgePx: Int, kind: MediaKind): Thumbnail?
}

/** What `getLocalImageHandle` returns: the cached JPEG's `file://` URI and a video's duration, if known. */
data class LocalImageHandle(val uri: String, val durationMillis: Long?)

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
 * Local image handles for `getLocalImageHandle` (research R7): a JPEG thumbnail of a local image or
 * video frame, cached under `cacheDir/thumbnails/` and named by `sha256(entryId + "|" + edge)`, so the
 * returned `file://` URI never carries the document URI, document ID or a user path. Reads local
 * storage only.
 *
 * A video's duration is kept beside its JPEG in `<hash>.meta` (009 research R6), as decimal
 * milliseconds; there is none for an image or for a video whose duration cannot be read.
 *
 * At most four loads run at once ([dispatcher]); further calls queue. A cached file is served without
 * a decode, with the duration read from its sidecar. Files are written atomically (temp file +
 * rename), the sidecar after the JPEG, so a reader never sees a partial file. The document URI is
 * never logged.
 */
class LocalImageStore(
  cacheDir: File,
  private val source: ThumbnailSource,
  private val dispatcher: CoroutineDispatcher = Dispatchers.IO.limitedParallelism(MAX_PARALLEL_LOADS),
) {
  private val directory = File(cacheDir, DIRECTORY)

  /**
   * Returns the `file://` URI of [entryId]'s thumbnail at the clamped [maxEdgePx], and for a
   * [MediaKind.VIDEO] its duration, decoding it from [documentUri] on a cache miss. Throws
   * [ImageUnavailable] when the document cannot be read.
   */
  suspend fun handle(
    entryId: String,
    documentUri: String,
    maxEdgePx: Int,
    kind: MediaKind = MediaKind.IMAGE,
  ): LocalImageHandle =
    withContext(dispatcher) {
      val edge = LocalImageSpec.bounded(maxEdgePx)
      val target = File(directory, cacheName(entryId, edge))
      val sidecar = File(directory, sidecarName(target.name))
      val durationMillis =
        if (target.isFile) {
          if (kind == MediaKind.VIDEO) readDuration(sidecar) else null
        } else {
          val thumbnail = decode(documentUri, edge, kind)
          writeAtomically(target) { thumbnail.bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, it) }
          val duration = thumbnail.durationMillis?.takeIf { kind == MediaKind.VIDEO && it >= 0 }
          storeDuration(sidecar, duration)
          duration
        }
      LocalImageHandle(Uri.fromFile(target).toString(), durationMillis)
    }

  private fun decode(documentUri: String, edge: Int, kind: MediaKind): Thumbnail =
    try {
      source.load(documentUri, edge, kind) ?: throw ImageUnavailable("the image did not decode")
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

  /** A sidecar's duration: whole non-negative milliseconds, or null when it is missing or not one. */
  private fun readDuration(sidecar: File): Long? =
    try {
      if (sidecar.isFile) parseDurationMillis(sidecar.readText()) else null
    } catch (_: IOException) {
      null
    }

  /**
   * Writes [durationMillis] to [sidecar] after the JPEG, or removes a stale sidecar when there is none.
   * A sidecar that cannot be written costs only the duration on later cache hits, not this answer.
   */
  private fun storeDuration(sidecar: File, durationMillis: Long?) {
    if (durationMillis == null) {
      sidecar.delete()
      return
    }
    try {
      writeAtomically(sidecar) { out ->
        out.write(durationMillis.toString().toByteArray(Charsets.US_ASCII))
        true
      }
    } catch (_: ImageUnavailable) {
      sidecar.delete()
    }
  }

  /** Writes [target] through a temp file and a rename; [encode] returns false when it wrote nothing. */
  private fun writeAtomically(target: File, encode: (OutputStream) -> Boolean) {
    if (!directory.isDirectory && !directory.mkdirs() && !directory.isDirectory) {
      throw ImageUnavailable("the thumbnail cache is not writable")
    }
    val temp = File.createTempFile(target.nameWithoutExtension, ".tmp", directory)
    try {
      val written = temp.outputStream().use(encode)
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

    const val JPEG_SUFFIX = ".jpg"
    const val SIDECAR_SUFFIX = ".meta"

    fun cacheName(entryId: String, edge: Int): String =
      MessageDigest.getInstance("SHA-256")
        .digest("$entryId|$edge".toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it) } + JPEG_SUFFIX

    /** `<hash>.meta` beside `<hash>.jpg`. */
    fun sidecarName(cacheName: String): String = cacheName.removeSuffix(JPEG_SUFFIX) + SIDECAR_SUFFIX
  }
}

/** `METADATA_KEY_DURATION` (or a sidecar) as whole non-negative milliseconds; null when it is not one. */
fun parseDurationMillis(text: String?): Long? = text?.trim()?.toLongOrNull()?.takeIf { it >= 0 }

/** What [VideoRetriever] read from one video: a frame (only when asked) and the duration text. */
class VideoProbe(val frame: Bitmap?, val duration: String?)

/** Reads a local video's frame and `METADATA_KEY_DURATION` in one pass (a fake in tests). */
fun interface VideoRetriever {
  /**
   * Opens [uri] once; returns a frame at most [edgePx] on its long edge when [withFrame], and the raw
   * duration. Throws `FileNotFoundException` or `SecurityException` when the document cannot be opened.
   */
  fun read(uri: Uri, edgePx: Int, withFrame: Boolean): VideoProbe
}

/**
 * Production [VideoRetriever] over the platform `MediaMetadataRetriever`, fed a file descriptor from
 * the [resolver] so no path is needed. The frame is the sync frame nearest the start
 * (`getScaledFrameAtTime(-1, OPTION_CLOSEST_SYNC, edge, edge)`). A file the retriever cannot parse
 * reads as no frame and no duration.
 */
class MediaMetadataVideoRetriever(private val resolver: ContentResolver) : VideoRetriever {
  override fun read(uri: Uri, edgePx: Int, withFrame: Boolean): VideoProbe {
    val retriever = MediaMetadataRetriever()
    try {
      val descriptor = resolver.openFileDescriptor(uri, "r") ?: throw FileNotFoundException("the provider returned no descriptor")
      try {
        descriptor.use { retriever.setDataSource(it.fileDescriptor) }
      } catch (_: IllegalArgumentException) {
        return VideoProbe(null, null)
      } catch (e: SecurityException) {
        throw e
      } catch (_: RuntimeException) {
        return VideoProbe(null, null)
      }
      val duration = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)
      val frame =
        if (withFrame) {
          retriever.getScaledFrameAtTime(-1, MediaMetadataRetriever.OPTION_CLOSEST_SYNC, edgePx, edgePx)
        } else {
          null
        }
      return VideoProbe(frame, duration)
    } finally {
      try {
        retriever.release()
      } catch (_: IOException) {
        // Nothing to recover: the retriever is discarded either way.
      }
    }
  }
}

/**
 * Production [ThumbnailSource]: the provider's own thumbnail through `ContentResolver.loadThumbnail`.
 *
 * - **Image**: when the provider has none (`UnsupportedOperationException`), a bounds read followed by
 *   a sampled decode ([sampleSizeFor]).
 * - **Video** (009 research R6): when the provider has none, fails or returns nothing, the frame comes
 *   from [videos] (`MediaMetadataRetriever`); the same retriever reads the duration. A duration that
 *   cannot be read is null and never costs the frame.
 *
 * Either way the result is scaled so its long edge is at most `edgePx`.
 */
class ContentResolverThumbnailSource(
  private val resolver: ContentResolver,
  private val videos: VideoRetriever = MediaMetadataVideoRetriever(resolver),
) : ThumbnailSource {

  override fun load(documentUri: String, edgePx: Int, kind: MediaKind): Thumbnail? {
    val uri = Uri.parse(documentUri)
    return when (kind) {
      MediaKind.IMAGE -> loadImage(uri, edgePx)?.let { Thumbnail(scaleDown(it, edgePx)) }
      MediaKind.VIDEO -> loadVideo(uri, edgePx)
    }
  }

  private fun loadImage(uri: Uri, edgePx: Int): Bitmap? =
    try {
      resolver.loadThumbnail(uri, Size(edgePx, edgePx), null)
    } catch (_: UnsupportedOperationException) {
      decodeSampled(uri, edgePx)
    }

  private fun loadVideo(uri: Uri, edgePx: Int): Thumbnail? {
    val provided: Bitmap? =
      try {
        resolver.loadThumbnail(uri, Size(edgePx, edgePx), null)
      } catch (_: UnsupportedOperationException) {
        null
      } catch (_: IOException) {
        null
      }
    if (provided == null) {
      val probe = videos.read(uri, edgePx, withFrame = true)
      val frame = probe.frame ?: return null
      return Thumbnail(scaleDown(frame, edgePx), parseDurationMillis(probe.duration))
    }
    val duration =
      try {
        parseDurationMillis(videos.read(uri, edgePx, withFrame = false).duration)
      } catch (_: IOException) {
        null
      } catch (_: RuntimeException) {
        null
      }
    return Thumbnail(scaleDown(provided, edgePx), duration)
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
