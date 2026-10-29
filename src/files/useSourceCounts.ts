import { useEffect, useState } from 'react';

import { queryTreeChildren } from '../native/CloudSync';
import type {
  FileFilter,
  FileStatus,
  StatusCountDto,
} from '../native/CloudSyncContracts';

// The sources' chip counts, shared by the list and tree views.

/** Adds up per-status counts; null when any part is not known. */
export function sumCounts(
  parts: readonly (StatusCountDto[] | null | undefined)[],
): StatusCountDto[] | null {
  const totals = new Map<FileStatus, number>();
  for (const part of parts) {
    if (part == null) {
      return null;
    }
    for (const { status, count } of part) {
      totals.set(status, (totals.get(status) ?? 0) + count);
    }
  }
  return [...totals].map(([status, count]) => ({ status, count }));
}

interface SourceCounts {
  key: string;
  bySource: ReadonlyMap<string, StatusCountDto[] | null>;
}

/**
 * Each source's page-1 `counts` from a one-row `queryTreeChildren` read of
 * its root (research R4). Counts are scoped by source and never narrowed by
 * the filter, so the chip model turns them into the filter's count.
 */
export function useSourceCounts(
  snapshotId: string | null,
  sourceIds: readonly string[],
  filter: FileFilter,
  reloadKey: number,
): ReadonlyMap<string, StatusCountDto[] | null> | null {
  const key = `${snapshotId}\u0000${filter}\u0000${reloadKey}\u0000${sourceIds.join(
    '\u0000',
  )}`;
  const [loaded, setLoaded] = useState<SourceCounts | null>(null);

  useEffect(() => {
    if (snapshotId == null) {
      return;
    }
    let live = true;
    Promise.all(
      sourceIds.map(async sourceId => {
        try {
          const result = await queryTreeChildren(
            snapshotId,
            null,
            { filter, view: 'LIST', sort: 'NAME_ASC', sourceId, pageSize: 1 },
            null,
          );
          return [
            sourceId,
            result.status === 'ok' ? result.page.counts : null,
          ] as const;
        } catch {
          return [sourceId, null] as const;
        }
      }),
    ).then(entries => {
      if (live) {
        setLoaded({ key, bySource: new Map(entries) });
      }
    });
    return () => {
      live = false;
    };
    // `key` covers snapshotId, filter, reloadKey and sourceIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded != null && loaded.key === key ? loaded.bySource : null;
}
