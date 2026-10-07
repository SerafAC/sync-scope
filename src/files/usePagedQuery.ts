import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  CloudSyncErrorCode,
  type CloudSyncError,
  type FileEntryDto,
  type FileSort,
  type QueryFilesResult,
  type QuerySpec,
  type ScrollAnchor,
  type ScrollIndexDto,
  type ScrollIndexResult,
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

/**
 * Reads the scroll index of [query] in [snapshotId]: `getScrollIndex`
 * (contract v6, research R4). With an [anchor] the index also carries its
 * `anchorIndex` (research R8); the anchor is passed only when there is one.
 */
export type IndexReader = (
  snapshotId: string,
  query: QuerySpec,
  anchor?: ScrollAnchor,
) => Promise<ScrollIndexResult>;

/**
 * The scroll anchor of [entry] under [sort] (research R8): its primary sort
 * value (`sortName` for a name sort, `modifiedUtcMillis` for a date sort,
 * `sizeBytes` for a size sort) and its `sortName`. Values, not the entry ID,
 * since entry IDs change with every snapshot.
 */
export function scrollAnchorOf(
  entry: FileEntryDto,
  sort: FileSort,
): ScrollAnchor {
  switch (sort) {
    case 'TIME_ASC':
    case 'TIME_DESC':
      return { sortValue: entry.modifiedUtcMillis, sortName: entry.sortName };
    case 'SIZE_ASC':
    case 'SIZE_DESC':
      return { sortValue: entry.sizeBytes, sortName: entry.sortName };
    default:
      return { sortValue: entry.sortName, sortName: entry.sortName };
  }
}

export type PagedPhase =
  | 'idle'
  | 'loading-first'
  | 'ready'
  | 'loading-more'
  | 'error';

/** A row of a band that is not read yet: the list keeps its full length (research R7). */
export interface PlaceholderRow {
  readonly placeholder: true;
  /** Stable while the band is unread: `placeholder-<band>-<offset>`. */
  readonly key: string;
  /** The index of the band in `scrollIndex.bands`. */
  readonly band: number;
}

export type PagedRow = FileEntryDto | PlaceholderRow;

export function isPlaceholder(row: PagedRow): row is PlaceholderRow {
  return (row as Partial<PlaceholderRow>).placeholder === true;
}

export interface UsePagedQueryOptions {
  /** The active snapshot; null before any completed scan (the hook stays idle). */
  snapshotId: string | null;
  /** What to read. `pageSize` is ignored: every page is PAGED_QUERY_PAGE_SIZE rows. */
  query: QuerySpec;
  read: PageReader;
  /**
   * Reads the scroll index of `query`, requested together with page 1. Once
   * it arrives the rows are segmented by band (research R7); without it, or
   * while it is on its way or after it failed, the hook pages linearly.
   */
  readIndex?: IndexReader;
  /**
   * A read placed before the rows of `query` and read to its end first:
   * list view's subfolders (`kind: 'DIRECTORY'`, `NAME_ASC`, research R3).
   * The rows of `query` are read and shown only once it is complete.
   */
  leadingQuery?: QuerySpec | null;
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
  /**
   * The first visible file of the view (research R8). Read only when the
   * snapshot changes after rows were shown: the new index is requested with
   * it, the band holding its `anchorIndex` is read before the hook reports
   * ready, and `anchorIndex` is exposed for that one reload.
   */
  anchor?: ScrollAnchor | null;
  /**
   * While false the hook holds without reading (phase `idle`, no rows), and
   * the snapshot last shown is kept, so a snapshot change is still reported
   * once reading starts.
   */
  enabled?: boolean;
}

export interface UsePagedQueryResult {
  /** Every loaded row, in order, all from the current snapshot and query. */
  entries: FileEntryDto[];
  /**
   * The whole result as far as it is known: the leading rows, then the
   * loaded rows of each band padded with placeholders up to the band's
   * count. Equal to `entries` until the scroll index arrives.
   */
  rows: PagedRow[];
  /** The scroll index of the rows of `query`; null until it arrives and the leading read is complete. */
  scrollIndex: ScrollIndexDto | null;
  /**
   * Where each band of `scrollIndex` starts in `rows`; empty without the
   * index. A band holds its count of rows unless its read ran out early.
   */
  bandStarts: readonly number[];
  /** Rows before the first row of `query` in `rows` (the leading rows). */
  fileOffset: number;
  /** Page-1 counts; null until page 1 has loaded. */
  counts: StatusCountDto[] | null;
  phase: PagedPhase;
  error: CloudSyncError | null;
  /** A next page exists: the read is not complete yet. */
  hasMore: boolean;
  /** Loads the next page; a no-op without a next token or while loading. */
  loadMore: () => void;
  /** Reads band [band] of the index from its start token until its count is in. */
  loadBand: (band: number) => void;
  /** Reads the bands that rows [first]…[last] of `rows` fall in, up to [last]. */
  loadRange: (first: number, last: number) => void;
  /** After an error: reloads page 1, or the failed reads when rows are shown. */
  retry: () => void;
  /**
   * After a snapshot change read with an `anchor`: the anchor's position
   * among the rows of `query` (add `fileOffset` for its row in `rows`). Set
   * only for that one reload, and only once its band is loaded; null
   * otherwise (research R8).
   */
  anchorIndex: number | null;
  /** Rows were shown and the active snapshot changed: show "Results updated". */
  snapshotChanged: boolean;
  acknowledgeSnapshotChange: () => void;
}

/**
 * One run of rows read from one start token (data-model.md, Segments): the
 * leading read, the linear read before the index arrives, or one band.
 */
interface Segment {
  /** Position of the segment's first row among the rows of its query. */
  start: number;
  /** Rows of the complete segment: a band's count; null for a read to its end. */
  count: number | null;
  startToken: string | null;
  /** The loaded prefix of the segment. */
  rows: FileEntryDto[];
  /** Reads on after `rows`; null when complete or not read yet. */
  nextToken: string | null;
  /** The read ran out of rows: the segment holds all it will hold. */
  ended: boolean;
  /** Rows wanted: the segment is read on while it holds fewer. */
  want: number;
  /** The read in flight, if any. */
  loading: number | null;
  error: CloudSyncError | null;
}

interface PagedState {
  /** The snapshot every held row came from. */
  snapshotId: string | null;
  /** The queries every held row came from. */
  queryKey: string;
  /** The leading query every held leading row came from. */
  leadingKey: string | null;
  /** The reload key the rows were read under. */
  reloadKey: number;
  /** Bumped on every reload: answers of an earlier generation are dropped. */
  generation: number;
  idle: boolean;
  leading: Segment | null;
  /** One linear segment until the index arrives, then one per band. */
  files: Segment[];
  index: ScrollIndexDto | null;
  counts: StatusCountDto[] | null;
  /** The first read of the first segment answered. */
  started: boolean;
  /** A lost snapshot was refreshed once already: a second loss is an error. */
  recovering: boolean;
  /**
   * A snapshot change read with an anchor: page 1 and the anchor's band are
   * read before the hook reports ready (research R8).
   */
  anchoring: boolean;
  /** The anchor's position in this read; set by its index. */
  anchorIndex: number | null;
}

/** What a reload reads. */
interface ReadTarget {
  snapshotId: string;
  queryKey: string;
  query: QuerySpec;
  leadingQuery: QuerySpec | null;
  leadingKey: string | null;
  reloadKey: number;
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

function segment(
  start: number,
  count: number | null,
  startToken: string | null,
  want = 0,
): Segment {
  return {
    start,
    count,
    startToken,
    rows: NO_ENTRIES,
    nextToken: null,
    ended: false,
    want,
    loading: null,
    error: null,
  };
}

function isComplete(seg: Segment): boolean {
  return seg.ended || (seg.count != null && seg.rows.length >= seg.count);
}

function leadingDone(state: PagedState): boolean {
  return state.leading == null || isComplete(state.leading);
}

function needsRead(seg: Segment): boolean {
  return (
    !isComplete(seg) &&
    seg.loading == null &&
    seg.error == null &&
    seg.rows.length < seg.want
  );
}

/** The segment holding position [position] of the rows of the query, or -1. */
function segmentAt(files: readonly Segment[], position: number): number {
  return files.findIndex(
    seg =>
      seg.start <= position &&
      (seg.count == null || position < seg.start + seg.count),
  );
}

/**
 * Places [entries], read from [offset] of segment [first], into the
 * segments: rows past a band's count belong to the bands after it, since
 * bands are consecutive runs of one order. [nextToken] goes to the segment
 * the page ends in, unless that segment already holds rows past the page.
 */
function placeRows(
  files: readonly Segment[],
  first: number,
  offset: number,
  entries: readonly FileEntryDto[],
  nextToken: string | null,
): Segment[] {
  const next = [...files];
  let i = first;
  let off = offset;
  let rest = entries;
  for (let seg = next[i]; seg != null; seg = next[i]) {
    if (off > seg.rows.length) {
      break;
    }
    const cap = seg.count ?? Number.POSITIVE_INFINITY;
    const take = rest.slice(0, Math.max(0, cap - off));
    rest = rest.slice(take.length);
    const end = off + take.length;
    const grows = end >= seg.rows.length;
    let placed: Segment = {
      ...seg,
      rows: grows
        ? [...seg.rows.slice(0, off), ...take]
        : [...seg.rows.slice(0, off), ...take, ...seg.rows.slice(end)],
    };
    if (rest.length === 0) {
      if (grows) {
        const full = end >= cap;
        placed = {
          ...placed,
          nextToken: full ? null : nextToken,
          ended: !full && nextToken == null,
        };
      }
      next[i] = placed;
      break;
    }
    next[i] = placed;
    i += 1;
    off = 0;
  }
  return next;
}

/** Turns the linear read into one segment per band of [index], keeping every loaded row. */
function segmentByBands(state: PagedState, index: ScrollIndexDto): Segment[] {
  const linear = state.files[0];
  let files = index.bands.map(band =>
    segment(band.startIndex, band.count, band.startToken),
  );
  if (linear == null || files.length === 0) {
    return files;
  }
  if (linear.rows.length > 0 || linear.ended) {
    files = placeRows(files, 0, 0, linear.rows, linear.nextToken);
  }
  const at = linear.rows.length;
  const i = segmentAt(files, at);
  const band = files[i];
  if (band != null) {
    files[i] = {
      ...band,
      want: Math.max(band.want, linear.want - band.start),
      loading: band.rows.length === at - band.start ? linear.loading : null,
      error: linear.error,
    };
  }
  return files;
}

function blankState(
  snapshotId: string | null,
  queryKey: string,
  generation: number,
  idle: boolean,
): PagedState {
  return {
    snapshotId,
    queryKey,
    leadingKey: null,
    reloadKey: 0,
    generation,
    idle,
    leading: null,
    files: [],
    index: null,
    counts: null,
    started: false,
    recovering: false,
    anchoring: false,
    anchorIndex: null,
  };
}

function freshState(
  target: ReadTarget,
  generation: number,
  recovering: boolean,
  kept: PagedState | null,
  anchoring = false,
): PagedState {
  return {
    ...blankState(target.snapshotId, target.queryKey, generation, false),
    leadingKey: target.leadingKey,
    reloadKey: target.reloadKey,
    leading:
      kept?.leading ??
      (target.leadingQuery == null ? null : segment(0, null, null, 1)),
    files: [segment(0, null, null, 1)],
    counts: kept?.counts ?? null,
    started: kept != null,
    recovering,
    anchoring,
  };
}

/**
 * An anchored read is in place: the index is in, the leading rows and page 1
 * are read, and the anchor's band holds the anchor's row.
 */
function anchorReady(state: PagedState): boolean {
  if (state.index == null || !state.started || !leadingDone(state)) {
    return false;
  }
  const first = state.files[0];
  if (first != null && first.rows.length === 0 && !isComplete(first)) {
    return false;
  }
  if (state.anchorIndex == null) {
    return true;
  }
  const at = state.files[segmentAt(state.files, state.anchorIndex)];
  return (
    at == null ||
    isComplete(at) ||
    at.rows.length > state.anchorIndex - at.start
  );
}

/**
 * The state whose complete leading read a reload of [target] can keep: only
 * the file query changed (a sort change, research R3), so the folders are
 * not read again.
 */
function keepableLeading(
  current: PagedState,
  target: ReadTarget,
): PagedState | null {
  const leading = current.leading;
  return !current.idle &&
    current.started &&
    leading != null &&
    isComplete(leading) &&
    leading.error == null &&
    current.snapshotId === target.snapshotId &&
    current.leadingKey === target.leadingKey &&
    current.reloadKey === target.reloadKey
    ? current
    : null;
}

function phaseOf(state: PagedState): PagedPhase {
  if (state.idle) {
    return 'idle';
  }
  if (errorOf(state) != null) {
    return 'error';
  }
  if (!state.started || state.anchoring) {
    return 'loading-first';
  }
  const loading =
    state.leading?.loading != null ||
    (leadingDone(state) && state.files.some(seg => seg.loading != null));
  return loading ? 'loading-more' : 'ready';
}

function errorOf(state: PagedState): CloudSyncError | null {
  if (state.leading?.error != null) {
    return state.leading.error;
  }
  return state.files.find(seg => seg.error != null)?.error ?? null;
}

/** The segment a "next page" goes to: the leading read, else the first incomplete one. */
function nextSegment(
  state: PagedState,
): { leading: true } | { leading: false; index: number } | null {
  if (state.leading != null && !isComplete(state.leading)) {
    return { leading: true };
  }
  const index = state.files.findIndex(seg => !isComplete(seg));
  return index < 0 ? null : { leading: false, index };
}

const placeholderCache = new WeakMap<Segment, PagedRow[]>();

/** A band's rows padded with placeholders up to its count. */
function paddedRows(seg: Segment, band: number): PagedRow[] {
  if (seg.count == null || seg.ended || seg.rows.length >= seg.count) {
    return seg.rows;
  }
  const cached = placeholderCache.get(seg);
  if (cached != null) {
    return cached;
  }
  const rows: PagedRow[] = [...seg.rows];
  for (let offset = seg.rows.length; offset < seg.count; offset += 1) {
    rows.push({
      placeholder: true,
      key: `placeholder-${band}-${offset}`,
      band,
    });
  }
  placeholderCache.set(seg, rows);
  return rows;
}

/**
 * Pages through one snapshot read for a Files view (data-model.md, FilePage
 * and Segments; 007 research R7).
 *
 * Every response is applied only if it belongs to the current generation of
 * `(snapshotId, query)`, so rows of two snapshots or of two filters are never
 * mixed, whatever order the answers arrive in. A snapshot change drops the
 * rows and reloads page 1, and raises `snapshotChanged` when rows had been
 * shown; a query change (filter, folder) reloads quietly.
 *
 * With `readIndex`, page 1 and the scroll index are requested together.
 * Until the index arrives the rows page linearly, as before; then the result
 * is the concatenation of its bands, each read lazily from its start token,
 * with placeholders for the rows not read yet, so the list has its full
 * length at once and the scrollbar can jump anywhere. A single band pages
 * like the linear read. A `leadingQuery` (list view's folders) is read to
 * its end first and placed before the bands.
 *
 * Feature 008's tree view reuses this hook with a `queryTreeChildren` reader.
 */
export function usePagedQuery({
  snapshotId,
  query,
  read,
  readIndex,
  leadingQuery = null,
  onSnapshotLost,
  reloadKey = 0,
  anchor = null,
  enabled = true,
}: UsePagedQueryOptions): UsePagedQueryResult {
  const fileKey = queryKeyOf(query);
  const leadingKey = leadingQuery == null ? null : queryKeyOf(leadingQuery);
  const queryKey =
    leadingKey == null ? fileKey : `${leadingKey}\u0000${fileKey}`;
  const stableQuery = useMemo<QuerySpec>(
    () => ({
      ...(JSON.parse(fileKey) as QuerySpec),
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [fileKey],
  );
  const stableLeading = useMemo<QuerySpec | null>(
    () =>
      leadingKey == null
        ? null
        : {
            ...(JSON.parse(leadingKey) as QuerySpec),
            pageSize: PAGED_QUERY_PAGE_SIZE,
          },
    [leadingKey],
  );
  const hasIndex = readIndex != null;

  const [state, setState] = useState<PagedState>(() =>
    blankState(snapshotId, queryKey, 0, snapshotId == null || !enabled),
  );
  const [snapshotChanged, setSnapshotChanged] = useState(false);

  // Mirrors of the latest values, so callbacks never act on a stale render.
  const stateRef = useRef(state);
  const readRef = useRef(read);
  const readIndexRef = useRef(readIndex);
  const onSnapshotLostRef = useRef(onSnapshotLost);
  const anchorRef = useRef(anchor);
  const generation = useRef(0);
  const readSequence = useRef(0);
  const mounted = useRef(true);
  /** The snapshot whose rows were last on screen, kept across a lost-snapshot drop. */
  const shownSnapshot = useRef<string | null>(null);

  useEffect(() => {
    readRef.current = read;
    readIndexRef.current = readIndex;
    onSnapshotLostRef.current = onSnapshotLost;
    anchorRef.current = anchor;
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);

  const commit = useCallback((next: PagedState) => {
    const settled =
      next.anchoring && anchorReady(next)
        ? { ...next, anchoring: false }
        : next;
    stateRef.current = settled;
    setState(settled);
  }, []);

  // `pump`, `startRead` and `begin` call each other; refs break the cycle.
  const pumpRef = useRef<(target: ReadTarget) => void>(() => {});
  const beginRef = useRef<
    (target: ReadTarget, recovering: boolean, withIndex: boolean) => void
  >(() => {});

  const lose = useCallback(
    async (target: ReadTarget, withIndex: boolean): Promise<void> => {
      generation.current += 1;
      const lost = generation.current;
      commit({
        ...blankState(target.snapshotId, target.queryKey, lost, false),
      });
      try {
        await onSnapshotLostRef.current?.();
      } catch {
        // The reload below, or the next snapshot change, takes over.
      }
      // The refresh kept the same snapshot: read page 1 again, once.
      if (mounted.current && lost === generation.current) {
        beginRef.current(target, true, withIndex);
      }
    },
    [commit],
  );

  const startRead = useCallback(
    (
      target: ReadTarget,
      leading: boolean,
      index: number,
      withIndex: boolean,
    ) => {
      const current = stateRef.current;
      const seg = leading ? current.leading : current.files[index];
      if (seg == null) {
        return;
      }
      readSequence.current += 1;
      const id = readSequence.current;
      const gen = current.generation;
      let offset = seg.rows.length;
      let pageToken = offset === 0 ? seg.startToken : seg.nextToken;
      if (offset > 0 && pageToken == null) {
        offset = 0;
        pageToken = seg.startToken;
      }
      const position = seg.start + offset;
      const reading: Segment = { ...seg, loading: id, error: null };
      if (leading) {
        commit({ ...current, leading: reading });
      } else {
        const files = [...current.files];
        files[index] = reading;
        commit({ ...current, files });
      }
      const pageQuery =
        leading && target.leadingQuery != null
          ? target.leadingQuery
          : target.query;
      const primary = leading || target.leadingQuery == null;

      (async () => {
        let result: QueryFilesResult;
        try {
          result = await readRef.current(
            target.snapshotId,
            pageQuery,
            pageToken,
          );
        } catch {
          result = { contractVersion: 0, status: 'error', error: READ_THREW };
        }
        const now = stateRef.current;
        if (!mounted.current || now.generation !== gen) {
          return;
        }
        if (result.status !== 'ok') {
          if (!now.recovering && SNAPSHOT_LOST_CODES.has(result.error.code)) {
            await lose(target, withIndex);
            return;
          }
          const failed = (s: Segment): Segment => ({
            ...s,
            loading: s.loading === id ? null : s.loading,
            error: result.status === 'error' ? result.error : null,
          });
          if (leading && now.leading != null) {
            commit({ ...now, leading: failed(now.leading) });
          } else {
            const i = segmentAt(now.files, position);
            const at = now.files[i];
            if (at != null) {
              const files = [...now.files];
              files[i] = failed(at);
              commit({ ...now, files });
            }
          }
          return;
        }
        const { page } = result;
        let next: PagedState = {
          ...now,
          started: now.started || primary,
          recovering: false,
          counts: primary && pageToken == null ? page.counts : now.counts,
        };
        if (leading && now.leading != null) {
          const done = { ...now.leading, loading: null };
          next = {
            ...next,
            leading:
              placeRows(
                [done],
                0,
                offset,
                page.entries,
                page.nextPageToken,
              )[0] ?? done,
          };
        } else {
          const i = segmentAt(now.files, position);
          const at = now.files[i];
          if (at != null) {
            const files = [...now.files];
            files[i] = {
              ...at,
              loading: at.loading === id ? null : at.loading,
            };
            next = {
              ...next,
              files: placeRows(
                files,
                i,
                position - at.start,
                page.entries,
                page.nextPageToken,
              ),
            };
          }
        }
        const shown =
          (next.leading?.rows.length ?? 0) > 0 ||
          next.files.some(s => s.rows.length > 0);
        if (shown) {
          shownSnapshot.current = target.snapshotId;
        }
        commit(next);
        pumpRef.current(target);
      })();
    },
    [commit, lose],
  );

  const pump = useCallback(
    (target: ReadTarget) => {
      const withIndex = readIndexRef.current != null;
      for (;;) {
        const current = stateRef.current;
        if (current.idle || current.snapshotId !== target.snapshotId) {
          return;
        }
        if (current.leading != null && needsRead(current.leading)) {
          startRead(target, true, 0, withIndex);
          continue;
        }
        if (!leadingDone(current)) {
          return;
        }
        const index = current.files.findIndex(needsRead);
        if (index < 0) {
          return;
        }
        startRead(target, false, index, withIndex);
      }
    },
    [startRead],
  );

  const fetchIndex = useCallback(
    async (
      target: ReadTarget,
      gen: number,
      sentAnchor: ScrollAnchor | null,
    ): Promise<void> => {
      const reader = readIndexRef.current;
      if (reader == null) {
        return;
      }
      let result: ScrollIndexResult | null;
      try {
        result = await (sentAnchor == null
          ? reader(target.snapshotId, target.query)
          : reader(target.snapshotId, target.query, sentAnchor));
      } catch {
        result = null;
      }
      const now = stateRef.current;
      if (!mounted.current || now.generation !== gen || now.index != null) {
        return;
      }
      if (result == null || result.status !== 'ok') {
        // Without an index the rows keep paging linearly, from the top.
        if (now.anchoring) {
          commit({ ...now, anchoring: false });
        }
        return;
      }
      let files = segmentByBands(now, result.scrollIndex);
      const anchorIndex = now.anchoring
        ? result.scrollIndex.anchorIndex
        : null;
      const at = anchorIndex == null ? -1 : segmentAt(files, anchorIndex);
      const band = files[at];
      if (anchorIndex != null && band != null) {
        // The anchor's band is read from its start up to the anchor's row.
        files = [...files];
        files[at] = {
          ...band,
          want: Math.max(band.want, anchorIndex - band.start + 1),
        };
      }
      commit({
        ...now,
        index: result.scrollIndex,
        files,
        anchorIndex: band == null ? null : anchorIndex,
      });
      pumpRef.current(target);
    },
    [commit],
  );

  const begin = useCallback(
    (
      target: ReadTarget,
      recovering: boolean,
      withIndex: boolean,
      kept: PagedState | null = null,
      placeAnchor: ScrollAnchor | null = null,
    ) => {
      generation.current += 1;
      const gen = generation.current;
      const anchoring = withIndex && placeAnchor != null;
      commit(freshState(target, gen, recovering, kept, anchoring));
      pumpRef.current(target);
      if (withIndex) {
        fetchIndex(target, gen, anchoring ? placeAnchor : null);
      }
    },
    [commit, fetchIndex],
  );

  useEffect(() => {
    pumpRef.current = pump;
    beginRef.current = begin;
  }, [pump, begin]);

  const targetOf = useCallback(
    (current: PagedState): ReadTarget | null =>
      current.snapshotId == null || current.queryKey !== queryKey
        ? null
        : {
            snapshotId: current.snapshotId,
            queryKey,
            query: stableQuery,
            leadingQuery: stableLeading,
            leadingKey,
            reloadKey: current.reloadKey,
          },
    [queryKey, stableQuery, stableLeading, leadingKey],
  );

  useEffect(() => {
    if (snapshotId == null) {
      generation.current += 1;
      shownSnapshot.current = null;
      commit(blankState(null, queryKey, generation.current, true));
      return;
    }
    if (!enabled) {
      generation.current += 1;
      commit(blankState(snapshotId, queryKey, generation.current, true));
      return;
    }
    const changed =
      shownSnapshot.current != null && shownSnapshot.current !== snapshotId;
    if (changed) {
      setSnapshotChanged(true);
    }
    const target: ReadTarget = {
      snapshotId,
      queryKey,
      query: stableQuery,
      leadingQuery: stableLeading,
      leadingKey,
      reloadKey,
    };
    const kept = keepableLeading(stateRef.current, target);
    shownSnapshot.current =
      (kept?.leading?.rows.length ?? 0) > 0 ? snapshotId : null;
    // A new snapshot keeps the view's place: its anchor is used once, here.
    begin(target, false, hasIndex, kept, changed ? anchorRef.current : null);
  }, [
    snapshotId,
    queryKey,
    stableQuery,
    stableLeading,
    leadingKey,
    commit,
    begin,
    reloadKey,
    enabled,
    hasIndex,
  ]);

  /** Raises the rows wanted of the segment a "next page" goes to by one page. */
  const loadMore = useCallback(() => {
    const current = stateRef.current;
    const target = targetOf(current);
    if (current.idle || !current.started || target == null) {
      return;
    }
    const at = nextSegment(current);
    if (at == null) {
      return;
    }
    const seg = at.leading ? current.leading : current.files[at.index];
    if (seg == null || seg.loading != null || seg.error != null) {
      return;
    }
    const wanted: Segment = { ...seg, want: seg.rows.length + 1 };
    if (at.leading) {
      commit({ ...current, leading: wanted });
    } else {
      const files = [...current.files];
      files[at.index] = wanted;
      commit({ ...current, files });
    }
    pump(target);
  }, [commit, pump, targetOf]);

  const want = useCallback(
    (wantOf: (seg: Segment, index: number) => number) => {
      const current = stateRef.current;
      const target = targetOf(current);
      if (current.idle || current.index == null || target == null) {
        return;
      }
      let changed = false;
      const files = current.files.map((seg, index) => {
        const wanted = wantOf(seg, index);
        if (wanted <= seg.want) {
          return seg;
        }
        changed = true;
        return { ...seg, want: wanted };
      });
      if (changed) {
        commit({ ...current, files });
        pump(target);
      }
    },
    [commit, pump, targetOf],
  );

  const loadBand = useCallback(
    (band: number) =>
      want((seg, index) => (index === band ? seg.count ?? 0 : 0)),
    [want],
  );

  const loadRange = useCallback(
    (first: number, last: number) => {
      const current = stateRef.current;
      if (!leadingDone(current)) {
        return;
      }
      const offset = current.leading?.rows.length ?? 0;
      const from = first - offset;
      const to = last - offset;
      want(seg => {
        const count = seg.count ?? 0;
        if (to < seg.start || from >= seg.start + count) {
          return 0;
        }
        return Math.min(count, to - seg.start + 1);
      });
    },
    [want],
  );

  const retry = useCallback(() => {
    const current = stateRef.current;
    const target = targetOf(current);
    if (current.idle || target == null || errorOf(current) == null) {
      return;
    }
    const shown =
      (current.leading?.rows.length ?? 0) > 0 ||
      current.files.some(seg => seg.rows.length > 0);
    if (!current.started || !shown) {
      begin(target, false, readIndexRef.current != null);
      return;
    }
    const cleared = (seg: Segment): Segment =>
      seg.error == null
        ? seg
        : {
            ...seg,
            error: null,
            want: Math.max(seg.want, seg.rows.length + 1),
          };
    commit({
      ...current,
      leading: current.leading == null ? null : cleared(current.leading),
      files: current.files.map(cleared),
    });
    pump(target);
  }, [begin, commit, pump, targetOf]);

  const acknowledgeSnapshotChange = useCallback(
    () => setSnapshotChanged(false),
    [],
  );

  // Between a prop change and its effect, never expose rows of the old read.
  const matches =
    state.snapshotId === snapshotId &&
    state.queryKey === queryKey &&
    state.idle === (snapshotId == null || !enabled) &&
    (state.idle || state.generation > 0);
  const view: PagedState = matches
    ? state
    : blankState(snapshotId, queryKey, -1, snapshotId == null || !enabled);

  const filesShown = leadingDone(view);
  const leadingRows = view.leading?.rows ?? NO_ENTRIES;
  const entries = useMemo(() => {
    if (!filesShown) {
      return leadingRows;
    }
    const parts = view.files.map(seg => seg.rows);
    if (parts.length === 1 && parts[0] != null && leadingRows.length === 0) {
      return parts[0];
    }
    return leadingRows.concat(...parts);
  }, [filesShown, leadingRows, view.files]);
  const rows = useMemo<PagedRow[]>(() => {
    if (view.index == null) {
      return entries;
    }
    if (!filesShown) {
      return leadingRows;
    }
    return (leadingRows as PagedRow[]).concat(
      ...view.files.map((seg, band) => paddedRows(seg, band)),
    );
  }, [entries, filesShown, leadingRows, view.files, view.index]);
  const bandStarts = useMemo<number[]>(() => {
    if (view.index == null || !filesShown) {
      return [];
    }
    let at = leadingRows.length;
    return view.files.map((seg, band) => {
      const start = at;
      at += paddedRows(seg, band).length;
      return start;
    });
  }, [filesShown, leadingRows, view.files, view.index]);

  return {
    entries,
    rows,
    scrollIndex: filesShown ? view.index : null,
    bandStarts,
    fileOffset: leadingRows.length,
    counts: view.counts,
    phase: matches ? phaseOf(view) : view.idle ? 'idle' : 'loading-first',
    error: errorOf(view),
    hasMore:
      view.started && (!filesShown || view.files.some(seg => !isComplete(seg))),
    loadMore,
    loadBand,
    loadRange,
    retry,
    anchorIndex:
      matches && filesShown && !view.anchoring ? view.anchorIndex : null,
    snapshotChanged,
    acknowledgeSnapshotChange,
  };
}
