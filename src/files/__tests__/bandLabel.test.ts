import type { ScrollBandDto } from '../../native/CloudSyncContracts';
import { bandLabel, UNKNOWN_BAND_LABEL } from '../bandLabel';

function band(fields: Partial<ScrollBandDto>): ScrollBandDto {
  return { startIndex: 0, count: 1, startToken: null, ...fields };
}

describe('bandLabel', () => {
  it('labels letter bands with # or the upper-case letter', () => {
    expect(bandLabel('LETTER', band({ letter: '#' }))).toBe('#');
    expect(bandLabel('LETTER', band({ letter: 'a' }))).toBe('A');
    expect(bandLabel('LETTER', band({ letter: 'z' }))).toBe('Z');
  });

  it('labels date bands from startMillis in local time', () => {
    // Local midnight, as native computes it in the device's time zone.
    const march = new Date(2024, 2, 1).getTime();
    const day = new Date(2025, 0, 7).getTime();

    expect(
      bandLabel('YEAR', band({ startMillis: new Date(2019, 0, 1).getTime() })),
    ).toBe('2019');
    expect(bandLabel('MONTH', band({ startMillis: march }))).toBe('03.2024');
    expect(bandLabel('DAY', band({ startMillis: day }))).toBe('07.01.2025');
    expect(
      bandLabel('DAY', band({ startMillis: new Date(2023, 11, 31).getTime() })),
    ).toBe('31.12.2023');
  });

  it('labels size bands with formatBytes of the lower bound', () => {
    expect(bandLabel('SIZE', band({ lowerBytes: 3_200_000 }), 'en-US')).toBe(
      '3.2 MB',
    );
    expect(bandLabel('SIZE', band({ lowerBytes: 500_000 }), 'en-US')).toBe(
      '500 kB',
    );
    expect(
      bandLabel('SIZE', band({ lowerBytes: 1_000_000_000 }), 'en-US'),
    ).toBe('1 GB');
    expect(bandLabel('SIZE', band({ lowerBytes: 0 }), 'en-US')).toBe('0 B');
  });

  it('labels the band of files without a value Unknown, whatever the unit', () => {
    expect(UNKNOWN_BAND_LABEL).toBe('Unknown');
    for (const unit of ['LETTER', 'YEAR', 'MONTH', 'DAY', 'SIZE'] as const) {
      expect(bandLabel(unit, band({ unknown: true }))).toBe('Unknown');
    }
  });
});
