import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CloudSyncErrorCode,
  type CloudSyncError,
  type FileEntryDto,
  type QueryFilesResult,
  type QuerySpec,
  type StatusCountDto,
} from '../native/CloudSyncContracts';

/** Rows requested per page by every Files view (data-model.md, FileQuery). */
export const PAGED_QUERY_PAGE_SIZE = 100;

/**
 * Reads one page of [snapshotId] for [query]. Both `queryFiles` and
 * `queryTreeChildren` fit: a tree read takes its parent from `query.parentId`.
 */
export type PageReader = (
  snapshotId: string,
  query: QuerySpec,
  pageToken: string | null,
) => Promise<QueryFilesResult>;

export type PagedPhase =
  | 'idle'
  | 'loading-first'
  | 'ready'
  | 'loading-more'
  | 'error';

export interface UsePagedQueryOptions {
  /** The active snapshot; null before any completed scan (the hook stays idle). */
  snapshotId: string | null;
  /** What to read. `pageSize` is ignored: every page is PAGED_QUERY_PAGE_SIZE rows. */
  query: QuerySpec;
  read: PageReader;
  /**
   * Called once when a read reports that the snapshot is gone or a token no
   * longer fits (SNAPSHOT_NOT_FOUND, PAGE_TOKEN_MISMATCH, STALE_GENERATION).
   * Wired to `useScan().refresh`: the reload follows the new `snapshotId`.
   */
  onSnapshotLost?: () => unknown;
  /**
   * A change reloads page 1 of the same snapshot and query, as a snapshot
   * change does but without `snapshotChanged`: rows were removed in place
   * (a deletion, research R14).
   */
  reloadKey?: number;
}

export interface UsePagedQueryResult {
  /** Every loaded row, all from the current snapshot and query. */
  entries: FileEntryDto[];
  /** Page-1 counts; null until page 1 has loaded. */
  counts: StatusCountDto[] | null;
  phase: PagedPhase;
  error: CloudSyncError | null;
  /** Loads the next page; a no-op without a next token or while loading. */
  loadMore: () => void;
  /** After an error: reloads page 1, or the failed next page when rows are shown. */
  retry: () => void;
  /** Rows were shown and the active snapshot changed: show "Results updated". */
  snapshotChanged: boolean;
  acknowledgeSnapshotChange: () => void;
}

interface PagedState {
  /** The snapshot every held row came from. */
  snapshotId: string | null;
  /** The query every held row came from. */
  queryKey: string;
  entries: FileEntryDto[];
  nextPageToken: string | null;
  counts: StatusCountDto[] | null;
  phase: PagedPhase;
  error: CloudSyncError | null;
}

/** Errors after which the held snapshot or token can no longer be read. */
const SNAPSHOT_LOST_CODES: ReadonlySet<string> = new Set([
  CloudSyncErrorCode.SNAPSHOT_NOT_FOUND,
  CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
  CloudSyncErrorCode.STALE_GENERATION,
]);

const READ_THREW: CloudSyncError = {
  code: CloudSyncErrorCode.INTERNAL_ERROR,
  message: 'The files could not be read.',
  action: null,
};

const NO_ENTRIES: FileEntryDto[] = [];

/** A JSON of [query] with sorted keys and without `pageSize` or undefined fields. */
export function queryKeyOf(query: QuerySpec): string {
  const record = query as unknown as Record<string, unknown>;
  const stable: Record<string, unknown> = {};
  for (const key of Object.keys(record).sort()) {
    if (key !== 'pageSize' && record[key] !== undefined) {
      stable[key] = record[key];
    }
  }
  return JSON.stringify(stable);
}

function emptyState(
  snapshotId: string | null,
  queryKey: string,
  phase: PagedPhase,
): PagedState {
  return {
    snapshotId,
    queryKey,
    entries: NO_ENTRIES,
    nextPageToken: null,
    counts: null,
    phase,
    error: null,
  };
}

/**
 * Pages through one snapshot read for a Files view (data-model.md, FilePage).
 *
 * Every response is applied only if it is the latest request and was issued
 * for the current `(snapshotId, query)`, so rows of two snapshots or of two
 * filters are never mixed, whatever order the answers arrive in. A snapshot
 * change drops the rows and reloads page 1, and raises `snapshotChanged`
 * when rows had been shown; a query change (filter, folder) reloads quietly.
 *
 * Feature 007's tree view reuses this hook with a `queryTreeChildren` reader.
 */
export function usePagedQuery({
  snapshotId,
  query,
  read,
  onSnapshotLost,
  reloadKey = 0,
}: UsePagedQueryOptions): UsePagedQueryResult {
  const queryKey = queryKeyOf(query);
  const stableQuery = useMemo<QuerySpec>(
    () => ({
      ...(JSON.parse(queryKey) as QuerySpec),
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [queryKey],
  );

  const [state, setState] = useState<PagedState>(() =>
    emptyState(
      snapshotId,
      queryKey,
      snapshotId == null ? 'idle' : 'loading-first',
    ),
  );
  const [snapshotChanged, setSnapshotChanged] = useState(false);

  // Mirrors of the latest values, so callbacks never act on a stale render.
  const stateRef = useRef(state);
  const readRef = useRef(read);
  const onSnapshotLostRef = useRef(onSnapshotLost);
  const sequence = useRef(0);
  const mounted = useRef(true);
  /** The snapshot whose rows were last on screen, kept across a lost-snapshot drop. */
  const shownSnapshot = useRef<string | null>(null);

  useEffect(() => {
    readRef.current = read;
    onSnapshotLostRef.current = onSnapshotLost;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      sequence.current += 1;
    };
  }, []);

  const commit = useCallback((next: PagedState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const fetchPage = useCallback(
    async (
      target: { snapshotId: string; queryKey: string; query: QuerySpec },
      pageToken: string | null,
      recovering: boolean,
    ): Promise<void> => {
      sequence.current += 1;
      const issued = sequence.current;
      let result: QueryFilesResult;
      try {
        result = await readRef.current(
          target.snapshotId,
          target.query,
          pageToken,
        );
      } catch {
        result = { contractVersion: 0, status: 'error', error: READ_THREW };
      }
      const current = stateRef.current;
      if (
        !mounted.current ||
        issued !== sequence.current ||
        current.snapshotId !== target.snapshotId ||
        current.queryKey !== target.queryKey
      ) {
        return;
      }
      if (result.status === 'ok') {
        const { page } = result;
        const entries =
          pageToken == null
            ? page.entries
            : [...current.entries, ...page.entries];
        if (entries.length > 0) {
          shownSnapshot.current = target.snapshotId;
        }
        commit({
          ...current,
          entries,
          nextPageToken: page.nextPageToken,
          counts: pageToken == null ? page.counts : current.counts,
          phase: 'ready',
          error: null,
        });
        return;
      }
      if (!recovering && SNAPSHOT_LOST_CODES.has(result.error.code)) {
        commit(emptyState(target.snapshotId, target.queryKey, 'loading-first'));
        const lost = sequence.current;
        try {
          await onSnapshotLostRef.current?.();
        } catch {
          // The reload below, or the next snapshot change, takes over.
        }
        // The refresh kept the same snapshot: read page 1 again, once.
        if (mounted.current && lost === sequence.current) {
          await fetchPage(target, null, true);
        }
        return;
      }
      commit({ ...current, phase: 'error', error: result.error });
    },
    [commit],
  );

  useEffect(() => {
    if (snapshotId == null) {
      sequence.current += 1;
      shownSnapshot.current = null;
      commit(emptyState(null, queryKey, 'idle'));
      return;
    }
    if (shownSnapshot.current != null && shownSnapshot.current !== snapshotId) {
      setSnapshotChanged(true);
    }
    shownSnapshot.current = null;
    commit(emptyState(snapshotId, queryKey, 'loading-first'));
    fetchPage({ snapshotId, queryKey, query: stableQuery }, null, false);
  }, [snapshotId, queryKey, stableQuery, commit, fetchPage, reloadKey]);

  const loadMore = useCallback(() => {
    const current = stateRef.current;
    if (
      current.phase !== 'ready' ||
      current.nextPageToken == null ||
      current.snapshotId == null
    ) {
      return;
    }
    commit({ ...current, phase: 'loading-more' });
    fetchPage(
      {
        snapshotId: current.snapshotId,
        queryKey: current.queryKey,
        query: stableQuery,
      },
      current.nextPageToken,
      false,
    );
  }, [commit, fetchPage, stableQuery]);

  const retry = useCallback(() => {
    const current = stateRef.current;
    if (current.phase !== 'error' || current.snapshotId == null) {
      return;
    }
    const target = {
      snapshotId: current.snapshotId,
      queryKey: current.queryKey,
      query: stableQuery,
    };
    if (current.entries.length > 0 && current.nextPageToken != null) {
      commit({ ...current, phase: 'loading-more', error: null });
      fetchPage(target, current.nextPageToken, false);
    } else {
      commit(emptyState(current.snapshotId, current.queryKey, 'loading-first'));
      fetchPage(target, null, false);
    }
  }, [commit, fetchPage, stableQuery]);

  const acknowledgeSnapshotChange = useCallback(
    () => setSnapshotChanged(false),
    [],
  );

  // Between a prop change and its effect, never expose rows of the old read.
  const matches =
    state.snapshotId === snapshotId && state.queryKey === queryKey;
  const view: PagedState = matches
    ? state
    : emptyState(
        snapshotId,
        queryKey,
        snapshotId == null ? 'idle' : 'loading-first',
      );

  return {
    entries: view.entries,
    counts: view.counts,
    phase: view.phase,
    error: view.error,
    loadMore,
    retry,
    snapshotChanged,
    acknowledgeSnapshotChange,
  };
}
