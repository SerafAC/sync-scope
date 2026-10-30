import { formatDuration, isMediaMime, mediaKindOf } from '../media';
import type { MediaKind } from '../media';

/**
 * Shared with `MediaKindTest.kt` (`PARITY_CASES`): the same MIME types, the same answers. A change to the
 * media rule must change both tables.
 */
const PARITY_CASES: ReadonlyArray<readonly [string | null, MediaKind | null]> = [
  ['image/jpeg', 'image'],
  ['image/png', 'image'],
  ['image/heic', 'image'],
  ['video/mp4', 'video'],
  ['video/quicktime', 'video'],
  [null, null],
  ['', null],
  ['application/pdf', null],
  ['imagex/foo', null],
  ['image', null],
  ['text/image/png', null],
];

describe('mediaKindOf', () => {
  it.each(PARITY_CASES)('classifies %p as %p', (mimeType, expected) => {
    expect(mediaKindOf(mimeType)).toBe(expected);
  });

  it('treats undefined like an unknown MIME type', () => {
    expect(mediaKindOf(undefined)).toBeNull();
  });
});

describe('isMediaMime', () => {
  it.each(PARITY_CASES)('%p is media exactly when it has a kind', (mimeType, expected) => {
    expect(isMediaMime(mimeType)).toBe(expected !== null);
  });

  it('treats undefined as not media', () => {
    expect(isMediaMime(undefined)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('shows m:ss below one hour', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(2_000)).toBe('0:02');
    expect(formatDuration(59_000)).toBe('0:59');
    expect(formatDuration(60_000)).toBe('1:00');
    expect(formatDuration(605_000)).toBe('10:05');
    expect(formatDuration(3_599_999)).toBe('59:59');
  });

  it('shows h:mm:ss from one hour', () => {
    expect(formatDuration(3_600_000)).toBe('1:00:00');
    expect(formatDuration(3_725_000)).toBe('1:02:05');
    expect(formatDuration(36_000_000 + 61_000)).toBe('10:01:01');
  });

  it('rounds down to the whole second', () => {
    expect(formatDuration(2_999)).toBe('0:02');
    expect(formatDuration(999)).toBe('0:00');
    expect(formatDuration(3_599_999)).toBe('59:59');
  });

  it('never shows a negative or non-finite time', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
});
