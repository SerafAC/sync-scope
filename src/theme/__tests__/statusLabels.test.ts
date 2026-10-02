import type {StatusCountDto} from '../../native/CloudSyncContracts';
import {FILTER_LABEL, STATUS_LABEL, chipCount} from '../statusLabels';

// ScanSummaryCard reuses STATUS_LABEL for "Synced" and "Unsynced". Its third
// line, "Files that could not be checked", deliberately stays separate: it
// explains the UNKNOWN count in a sentence rather than naming the status, so
// matching "Unknown" would be coincidental duplication (Principle III).

describe('STATUS_LABEL', () => {
  it('names every status', () => {
    expect(STATUS_LABEL).toEqual({
      SYNCED: 'Synced',
      UNSYNCED: 'Unsynced',
      UNKNOWN: 'Unknown',
    });
  });
});

describe('FILTER_LABEL', () => {
  it('names every filter', () => {
    expect(FILTER_LABEL).toEqual({
      ALL: 'All',
      SYNCED: 'Synced',
      UNSYNCED: 'Unsynced',
      ISSUES_UNKNOWN: 'Issues or unknown',
    });
  });
});

describe('chipCount', () => {
  const counts: StatusCountDto[] = [
    {status: 'SYNCED', count: 3},
    {status: 'UNSYNCED', count: 2},
    {status: 'UNKNOWN', count: 1},
  ];

  it('sums every status for ALL', () => {
    expect(chipCount('ALL', counts)).toBe(6);
  });

  it('reads the matching status for the other chips', () => {
    expect(chipCount('SYNCED', counts)).toBe(3);
    expect(chipCount('UNSYNCED', counts)).toBe(2);
    expect(chipCount('ISSUES_UNKNOWN', counts)).toBe(1);
  });

  it('reads 0 for a status missing from the counts', () => {
    const partial: StatusCountDto[] = [{status: 'SYNCED', count: 4}];
    expect(chipCount('ALL', partial)).toBe(4);
    expect(chipCount('UNSYNCED', partial)).toBe(0);
    expect(chipCount('ISSUES_UNKNOWN', partial)).toBe(0);
    expect(chipCount('ALL', [])).toBe(0);
  });

  it('is null while the counts are unknown', () => {
    expect(chipCount('ALL', null)).toBeNull();
    expect(chipCount('SYNCED', null)).toBeNull();
    expect(chipCount('UNSYNCED', null)).toBeNull();
    expect(chipCount('ISSUES_UNKNOWN', null)).toBeNull();
  });
});
