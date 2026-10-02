import type {
  FileFilter,
  FileStatus,
  StatusCountDto,
} from '../native/CloudSyncContracts';

/** User-facing text for each file status: the one source of truth (Principle III). */
export const STATUS_LABEL: Record<FileStatus, string> = {
  SYNCED: 'Synced',
  UNSYNCED: 'Unsynced',
  UNKNOWN: 'Unknown',
};

/** User-facing text for each filter chip. */
export const FILTER_LABEL: Record<FileFilter, string> = {
  ALL: 'All',
  SYNCED: 'Synced',
  UNSYNCED: 'Unsynced',
  ISSUES_UNKNOWN: 'Issues or unknown',
};

function countOf(
  counts: readonly StatusCountDto[],
  status: FileStatus,
): number {
  return counts.find(c => c.status === status)?.count ?? 0;
}

/**
 * A filter chip's count from the first page's `counts` (data-model.md, chip
 * model): ALL is the sum, every other chip its status's count or 0. Null while
 * the counts are not known yet.
 */
export function chipCount(
  filter: FileFilter,
  counts: readonly StatusCountDto[] | null,
): number | null {
  if (counts == null) {
    return null;
  }
  switch (filter) {
    case 'ALL':
      return counts.reduce((sum, c) => sum + c.count, 0);
    case 'SYNCED':
      return countOf(counts, 'SYNCED');
    case 'UNSYNCED':
      return countOf(counts, 'UNSYNCED');
    case 'ISSUES_UNKNOWN':
      return countOf(counts, 'UNKNOWN');
  }
}
