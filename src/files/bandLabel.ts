import type { ScrollBandDto, ScrollUnit } from '../native/CloudSyncContracts';
import { formatBytes } from '../selection/formatBytes';

/** The label of the band of files without a size or date (research R1). */
export const UNKNOWN_BAND_LABEL = 'Unknown';

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * The scrollbar label of one band of a scroll index (research R4–R6): `#` or
 * the upper-case letter; `YYYY`, `MM.YYYY` or `DD.MM.YYYY` in the device's
 * local time from `startMillis`; the band's lower size through `formatBytes`
 * (decimal units, 006 R10); `Unknown` for the band of files without a value.
 */
export function bandLabel(
  unit: ScrollUnit,
  band: ScrollBandDto,
  locale?: string,
): string {
  if (band.unknown === true) {
    return UNKNOWN_BAND_LABEL;
  }
  switch (unit) {
    case 'LETTER':
      return (band.letter ?? '#').toUpperCase();
    case 'SIZE':
      return formatBytes(band.lowerBytes ?? 0, locale);
    case 'YEAR':
    case 'MONTH':
    case 'DAY': {
      const date = new Date(band.startMillis ?? 0);
      const year = String(date.getFullYear());
      if (unit === 'YEAR') {
        return year;
      }
      const month = `${twoDigits(date.getMonth() + 1)}.${year}`;
      return unit === 'MONTH' ? month : `${twoDigits(date.getDate())}.${month}`;
    }
  }
}
