import {useCallback, useEffect, useRef, useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';

import {getRepositorySummary, listSources} from '../native/CloudSync';
import {
  CloudSyncErrorCode,
  type ListSourcesResult,
  type RepositorySummaryResult,
} from '../native/CloudSyncContracts';
import {useScan} from '../scan/useScan';

export type RepositoryItem = 'missing' | 'needsPassword' | 'ready';
export type FoldersItem = 'none' | 'noneAvailable' | 'ready';

/** What still stands between the user and a first scan (data-model.md › Setup checklist). */
export interface SetupChecklist {
  repository: RepositoryItem;
  folders: FoldersItem;
  /** The shown results were made with a repository revision other than the saved one (FR-010). */
  resultsFromOldSettings: boolean;
  /** True until the first read of both items has answered. */
  loading: boolean;
}

type Reads = {
  summary: RepositorySummaryResult | null;
  sources: ListSourcesResult | null;
};

/**
 * A read failure other than the ones below is not a missing item: it would only
 * block the scan, which then reports the real error with its own fix target.
 */
function repositoryItem(summary: RepositorySummaryResult | null): RepositoryItem {
  if (summary == null) {
    return 'ready';
  }
  if (summary.status === 'ok') {
    return summary.repository.credentialPresent ? 'ready' : 'needsPassword';
  }
  switch (summary.error.code) {
    case CloudSyncErrorCode.REPOSITORY_NOT_CONFIGURED:
      return 'missing';
    case CloudSyncErrorCode.CREDENTIAL_UNAVAILABLE:
      return 'needsPassword';
    default:
      return 'ready';
  }
}

function foldersItem(result: ListSourcesResult | null): FoldersItem {
  if (result == null || result.status !== 'ok') {
    return 'ready';
  }
  if (result.sources.length === 0) {
    return 'none';
  }
  return result.sources.some(source => source.availability === 'AVAILABLE')
    ? 'ready'
    : 'noneAvailable';
}

/**
 * The setup checklist of the Scan tab (research R6). It is derived on every
 * focus from `getRepositorySummary`, `listSources` and the active snapshot, and
 * never stored: nothing here writes, caches across mounts or persists.
 */
export function useSetupChecklist(): SetupChecklist {
  const {active} = useScan();
  const [reads, setReads] = useState<Reads | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const [summary, sources] = await Promise.all([
      getRepositorySummary().catch(() => null),
      listSources().catch(() => null),
    ]);
    if (mounted.current) {
      setReads({summary, sources});
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  const summary = reads?.summary ?? null;
  const savedRevision =
    summary?.status === 'ok' ? summary.repository.revision : null;
  return {
    repository: repositoryItem(summary),
    folders: foldersItem(reads?.sources ?? null),
    resultsFromOldSettings:
      active != null &&
      savedRevision != null &&
      active.configRevision !== savedRevision,
    loading: reads == null,
  };
}
