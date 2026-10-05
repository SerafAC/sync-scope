/**
 * A byte total for the selection bar: decimal units (1 kB = 1000 B), at most
 * one decimal place with a trailing `.0` dropped, and the locale's separators
 * via `Intl.NumberFormat`. Exact byte counts below 1000 stay in bytes.
 */
const UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;
const STEP = 1000;

export function formatBytes(bytes: number, locale?: string): string {
  const total = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const format = new Intl.NumberFormat(locale, {maximumFractionDigits: 1});
  let unit = 0;
  let value = total;
  while (value >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  // 999 960 B is 999.96 kB, which rounds to "1000 kB": show "1 MB" instead.
  if (Math.round(value * 10) / 10 >= STEP && unit < UNITS.length - 1) {
    value /= STEP;
    unit += 1;
  }
  return `${format.format(value)} ${UNITS[unit]}`;
}
