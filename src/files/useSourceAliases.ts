import { useEffect, useMemo, useRef } from 'react';

import { useScan } from '../scan/useScan';
import { useSources } from '../sources/useSources';

/**
 * Each added source's alias by `sourceId`, for origin badges and the list
 * view's top level. It reuses the `listSources` read of `useSources` (which
 * also reloads on app foreground) and reloads it whenever the active
 * snapshot changes, since a rescan follows source changes.
 */
export function useSourceAliases(): ReadonlyMap<string, string> {
  const { sources, refresh } = useSources();
  const snapshotId = useScan().active?.snapshotId ?? null;
  const seenSnapshot = useRef(snapshotId);

  useEffect(() => {
    // useSources already loads on mount; reload on later changes only.
    if (seenSnapshot.current !== snapshotId) {
      seenSnapshot.current = snapshotId;
      refresh();
    }
  }, [snapshotId, refresh]);

  return useMemo(
    () => new Map(sources.map(s => [s.sourceId, s.alias] as const)),
    [sources],
  );
}
