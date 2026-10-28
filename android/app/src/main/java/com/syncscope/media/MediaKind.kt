package com.syncscope.media

/**
 * The single media rule (research R6; Principle III): a media file is a `FILE` whose MIME type starts with
 * `image/` or `video/`. [SQL_MEDIA] is the predicate every query uses (the gallery, its counts and "Select
 * all"), and [of] is the same rule in Kotlin. `src/files/media.ts` mirrors it, and `MediaKindTest` and
 * `media.test.ts` share one parity table.
 */
enum class MediaKind {
  IMAGE,
  VIDEO;

  companion object {
    private const val IMAGE_PREFIX = "image/"
    private const val VIDEO_PREFIX = "video/"

    /**
     * `local_node` rows that are media files. The prefix is compared exactly (`substr`, not `LIKE`), so it
     * is case-sensitive and has no wildcards, the same as [of]. It is `NULL`, not `0`, for a `NULL` MIME
     * type, so a projection wraps it in `COALESCE(…, 0)`.
     */
    const val SQL_MEDIA: String =
      "(kind = 'FILE' AND substr(mimeType, 1, 6) IN ('$IMAGE_PREFIX', '$VIDEO_PREFIX'))"

    /** [IMAGE] for `image/…`, [VIDEO] for `video/…`, and `null` for anything else, including `null`. */
    fun of(mimeType: String?): MediaKind? =
      when {
        mimeType == null -> null
        mimeType.startsWith(IMAGE_PREFIX) -> IMAGE
        mimeType.startsWith(VIDEO_PREFIX) -> VIDEO
        else -> null
      }
  }
}
