import {formatBytes} from '../formatBytes';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1000, '1 kB'],
    [1_234_567, '1.2 MB'],
    [1.2e9, '1.2 GB'],
    [2.5e12, '2.5 TB'],
  ])('formats %d bytes as %s', (bytes, expected) => {
    expect(formatBytes(bytes, 'en-US')).toBe(expected);
  });

  it('uses decimal units, 1 kB = 1000 B', () => {
    expect(formatBytes(1024, 'en-US')).toBe('1 kB');
    expect(formatBytes(1500, 'en-US')).toBe('1.5 kB');
  });

  it('keeps at most one decimal place and drops a trailing .0', () => {
    expect(formatBytes(1_260_000, 'en-US')).toBe('1.3 MB');
    expect(formatBytes(2_000_000, 'en-US')).toBe('2 MB');
    expect(formatBytes(2_040_000, 'en-US')).toBe('2 MB');
  });

  it('moves to the next unit when rounding reaches 1000', () => {
    expect(formatBytes(999_960, 'en-US')).toBe('1 MB');
  });

  it('stays in TB beyond 1000 TB', () => {
    expect(formatBytes(1.5e15, 'en-US')).toBe('1,500 TB');
  });

  it('uses the locale decimal separator', () => {
    expect(formatBytes(1_234_567, 'de-DE')).toBe('1,2 MB');
    expect(formatBytes(0, 'de-DE')).toBe('0 B');
  });

  it('treats a negative or non-finite total as 0 B', () => {
    expect(formatBytes(-5, 'en-US')).toBe('0 B');
    expect(formatBytes(Number.NaN, 'en-US')).toBe('0 B');
  });

  it('defaults to the device locale', () => {
    expect(formatBytes(1000)).toMatch(/^1 kB$/);
  });
});
