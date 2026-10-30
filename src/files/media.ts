/**
 * The single media rule on the JS side (research R6, Principle III): a media
 * file is a file whose MIME type starts with `image/` or `video/`. It mirrors
 * `MediaKind` in Kotlin (`media/MediaKind.kt`); `media.test.ts` and
 * `MediaKindTest.kt` share one parity table.
 */
export type MediaKind = 'image' | 'video';

const IMAGE_PREFIX = 'image/';
const VIDEO_PREFIX = 'video/';

/** `'image'` for `image/…`, `'video'` for `video/…`, otherwise `null`. */
export function mediaKindOf(
  mimeType: string | null | undefined,
): MediaKind | null {
  if (typeof mimeType !== 'string') {
    return null;
  }
  if (mimeType.startsWith(IMAGE_PREFIX)) {
    return 'image';
  }
  if (mimeType.startsWith(VIDEO_PREFIX)) {
    return 'video';
  }
  return null;
}

/** Whether a file with this MIME type is shown in the gallery and previewed. */
export function isMediaMime(mimeType: string | null | undefined): boolean {
  return mediaKindOf(mimeType) !== null;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * A video duration as `m:ss` below one hour and `h:mm:ss` from one hour,
 * rounded down to the whole second. A negative or non-finite value is `0:00`.
 */
export function formatDuration(millis: number): string {
  const totalSeconds =
    Number.isFinite(millis) && millis > 0 ? Math.floor(millis / 1000) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${twoDigits(minutes)}:${twoDigits(seconds)}`;
  }
  return `${minutes}:${twoDigits(seconds)}`;
}
