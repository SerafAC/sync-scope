import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type {
  CloudSyncError,
  FileEntryDto,
  FileFilter,
  FileSort,
  QueryFilesResult,
  QuerySpec,
  StatusCountDto,
} from '../native/CloudSyncContracts';
import {
  PAGED_QUERY_PAGE_SIZE,
  READ_THREW,
  readTreeChildren,
  SNAPSHOT_LOST_CODES,
  type PageReader,
} from './usePagedQuery';

/** A folder or row by names from its source: `[sourceId, 'DCIM', 'Camera']` (research R3). */
export type TreePath = readonly string[];

/**
 * The tree view's state (data-model.md, "Tree view state"), held in
 * `FilesProvider` beside the list view's folder for the session only. Name
 * paths, not entry IDs, since entry IDs change with every scan.
 */
export interface TreeState {
  /** Expanded folders as name paths from the source root; a source is `[sourceId]`. */
  expanded: readonly TreePath[];
  /** The first visible row's name path, re-found on a new snapshot. */
  anchor: TreePath | null;
}

export const INITIAL_TREE_STATE: TreeState = { expanded: [], anchor: null };

interface TreeRowBase {
  /** Stable for the row's name path. */
  key: string;
  /** 0 for a source; each level below adds one. */
  depth: number;
}

/** A source at depth 0: one per selected source, like list view's root. */
export interface TreeSourceRow extends TreeRowBase {
  kind: 'source';
  path: TreePath;
  sourceId: string;
  alias: string;
  /** Page-1 counts of the source's root once it has been read; null before. */
  counts: StatusCountDto[] | null;
  expanded: boolean;
}

/** A folder: dimmed when `matchingFileCount === 0`, and still expandable (R4). */
export interface TreeFolderRow extends TreeRowBase {
  kind: 'folder';
  path: TreePath;
  entryId: string;
  name: string;
  matchingFileCount: number | null;
  expanded: boolean;
}

export interface TreeFileRow extends TreeRowBase {
  kind: 'file';
  path: TreePath;
  entry: FileEntryDto;
}

/** The end of a folder with more pages: reads the next one when it becomes visible. */
export interface TreeMoreRow extends TreeRowBase {
  kind: 'more';
  folderPath: TreePath;
  /** The opaque token of the next page (D010). */
  nextPageToken: string;
}

/** Shown while a folder's first page loads. */
export interface TreePlaceholderRow extends TreeRowBase {
  kind: 'placeholder';
  folderPath: TreePath;
}

export type TreeRow =
  | TreeSourceRow
  | TreeFolderRow
  | TreeFileRow
  | TreeMoreRow
  | TreePlaceholderRow;

export interface UseTreeOptions {
  /** The active snapshot; null before any completed scan (no rows). */
  snapshotId: string | null;
  /** The selected sources, `sourceId → alias`, in display order. */
  sources: ReadonlyMap<string, string>;
  filter: FileFilter;
  /** The files' sort in every folder; folders are always by name first. */
  sort: FileSort;
  state: TreeState;
  /** Applies a change to [state]: `FilesProvider`'s setter. */
  onStateChange: (update: (previous: TreeState) => TreeState) => void;
  /** Injected for tests; defaults to `queryTreeChildren`. */
  read?: PageReader;
  /** As in `usePagedQuery`: called once when the snapshot or a token is lost. */
  onSnapshotLost?: () => unknown;
  /** A change re-reads every expanded folder in place (a deletion, research R14). */
  reloadKey?: number;
}

export interface UseTreeResult {
  rows: TreeRow[];
  /** Expands a collapsed source or folder, or collapses an expanded one. */
  toggle: (row: TreeSourceRow | TreeFolderRow) => void;
  /** Reads the next page of the folder a `more` row ends. */
  loadMore: (row: TreeMoreRow) => void;
  /** The first failed read that is not being recovered; null otherwise. */
  error: CloudSyncError | null;
  /** Reads again every folder whose read failed. */
  retry: () => void;
  /**
   * After a new snapshot was read with every expanded path re-found: the row
   * of `state.anchor`, or of its deepest ancestor still there. Null otherwise.
   */
  anchorIndex: number | null;
  /** Rows were shown and the active snapshot changed: show "Results updated". */
  snapshotChanged: boolean;
  acknowledgeSnapshotChange: () => void;
}

/** One expanded folder's pages: its subfolders by name, then its files in the sort. */
interface FolderPages {
  sourceId: string;
  /** The folder's entry ID; null for a source root. */
  parentId: string | null;
  dirs: FileEntryDto[];
  dirToken: string | null;
  dirsStarted: boolean;
  dirsDone: boolean;
  files: FileEntryDto[];
  fileToken: string | null;
  filesStarted: boolean;
  filesDone: boolean;
  counts: StatusCountDto[] | null;
  loading: boolean;
  error: CloudSyncError | null;
}

interface TreeStore {
  /** The snapshot, filter, sort and reload key every held page was read under. */
  scopeKey: string;
  snapshotId: string | null;
  /** Bumped on every reset: answers of an earlier generation are dropped. */
  generation: number;
  records: Map<string, FolderPages>;
  /** A lost snapshot was refreshed once already: a second loss is an error. */
  recovering: boolean;
  /** A new snapshot is being read: the anchor is re-found once it settles. */
  relocating: boolean;
  /** A relocation settled: the anchor is re-found in the next rows. */
  anchorPending: boolean;
  /** Rows of a snapshot were shown. */
  shown: boolean;
}

const SEPARATOR = '\u0000';

/** The map key of [path]. */
export function treePathKey(path: TreePath): string {
  return path.join(SEPARATOR);
}

function samePath(a: TreePath, b: TreePath): boolean {
  return a.length === b.length && a.every((name, i) => name === b[i]);
}

function isWithin(path: TreePath, ancestor: TreePath): boolean {
  return (
    path.length >= ancestor.length &&
    ancestor.every((name, i) => name === path[i])
  );
}

function folderPages(sourceId: string, parentId: string | null): FolderPages {
  return {
    sourceId,
    parentId,
    dirs: [],
    dirToken: null,
    dirsStarted: false,
    dirsDone: false,
    files: [],
    fileToken: null,
    filesStarted: false,
    filesDone: false,
    counts: null,
    loading: false,
    error: null,
  };
}

/** The folder's first page is in: its folders, and its files once the folders ended. */
function firstPageIn(pages: FolderPages): boolean {
  return pages.dirsStarted && !(pages.dirsDone && !pages.filesStarted);
}

function complete(pages: FolderPages): boolean {
  return pages.dirsDone && pages.filesDone;
}

/**
 * The tree view's rows (research R1–R3): one flattened list of sources,
 * folders, files, "more" rows and placeholders. Each expanded folder is read
 * with `queryTreeChildren` as list view reads one folder: its subfolders by
 * name (`kind: 'DIRECTORY'`, `NAME_ASC`), then its files in [sort]
 * (`kind: 'FILE'`), page by page with the opaque token. Collapsing a folder
 * removes its rows, forgets the expansions beneath it and drops its pages.
 *
 * A lost snapshot or token (`STALE_GENERATION` and the like) is recovered as
 * `usePagedQuery` does: `onSnapshotLost` once, then every expanded folder is
 * read again; a second loss in a row is an error.
 *
 * On a new snapshot every still-expanded name path is re-read in order, each
 * folder found by name in its parent's pages (as `useListNavigation` does for
 * one folder). A path that no longer exists is dropped from the state with
 * its descendants, and the anchor row is re-found by its name path.
 */
export function useTree({
  snapshotId,
  sources,
  filter,
  sort,
  state,
  onStateChange,
  read = readTreeChildren,
  onSnapshotLost,
  reloadKey = 0,
}: UseTreeOptions): UseTreeResult {
  const scopeKey = [snapshotId, filter, sort, reloadKey].join(SEPARATOR);
  const storeRef = useRef<TreeStore>({
    scopeKey,
    snapshotId,
    generation: 0,
    records: new Map(),
    recovering: false,
    relocating: false,
    anchorPending: false,
    shown: false,
  });
  const [version, setVersion] = useState(0);
  const [anchorIndex, setAnchorIndex] = useState<number | null>(null);
  const [snapshotChanged, setSnapshotChanged] = useState(false);
  const mounted = useRef(true);
  const latest = useRef({
    snapshotId,
    sources,
    filter,
    sort,
    state,
    onStateChange,
    read,
    onSnapshotLost,
  });
  latest.current = {
    snapshotId,
    sources,
    filter,
    sort,
    state,
    onStateChange,
    read,
    onSnapshotLost,
  };

  useEffect(() => {
    const store = storeRef.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      store.generation += 1;
    };
  }, []);

  const bump = useCallback(() => setVersion(v => v + 1), []);

  // `pump` and `readPage` call each other; a ref breaks the cycle.
  const pumpRef = useRef<() => void>(() => {});

  /** Clears every page; the expanded paths are read again by `pump`. */
  const reset = useCallback((recovering: boolean) => {
    const store = storeRef.current;
    store.generation += 1;
    store.records = new Map();
    store.recovering = recovering;
  }, []);

  const readPage = useCallback(
    (key: string, stage: 'dirs' | 'files', pageToken: string | null) => {
      const store = storeRef.current;
      const pages = store.records.get(key);
      const target = latest.current.snapshotId;
      if (pages == null || target == null || pages.loading) {
        return;
      }
      pages.loading = true;
      pages.error = null;
      const generation = store.generation;
      const { filter: f, sort: s } = latest.current;
      const query: QuerySpec =
        stage === 'dirs'
          ? {
              filter: f,
              view: 'LIST',
              sort: 'NAME_ASC',
              sourceId: pages.sourceId,
              parentId: pages.parentId,
              kind: 'DIRECTORY',
              pageSize: PAGED_QUERY_PAGE_SIZE,
            }
          : {
              filter: f,
              view: 'LIST',
              sort: s,
              sourceId: pages.sourceId,
              parentId: pages.parentId,
              kind: 'FILE',
              pageSize: PAGED_QUERY_PAGE_SIZE,
            };
      (async () => {
        let result: QueryFilesResult;
        try {
          result = await latest.current.read(target, query, pageToken);
        } catch {
          result = { contractVersion: 0, status: 'error', error: READ_THREW };
        }
        const now = storeRef.current;
        if (
          !mounted.current ||
          now.generation !== generation ||
          now.records.get(key) !== pages
        ) {
          return;
        }
        pages.loading = false;
        if (result.status !== 'ok') {
          if (!now.recovering && SNAPSHOT_LOST_CODES.has(result.error.code)) {
            reset(true);
            const lost = now.generation;
            bump();
            try {
              await latest.current.onSnapshotLost?.();
            } catch {
              // The re-read below, or the next snapshot change, takes over.
            }
            if (mounted.current && storeRef.current.generation === lost) {
              pumpRef.current();
              bump();
            }
            return;
          }
          pages.error = result.error;
          bump();
          return;
        }
        now.recovering = false;
        const { page } = result;
        if (stage === 'dirs') {
          if (!pages.dirsStarted) {
            pages.counts = page.counts;
          }
          pages.dirsStarted = true;
          pages.dirs = [
            ...pages.dirs,
            ...page.entries.filter(e => e.kind === 'DIRECTORY'),
          ];
          pages.dirToken = page.nextPageToken;
          pages.dirsDone = page.nextPageToken == null;
        } else {
          pages.filesStarted = true;
          pages.files = [
            ...pages.files,
            ...page.entries.filter(e => e.kind === 'FILE'),
          ];
          pages.fileToken = page.nextPageToken;
          pages.filesDone = page.nextPageToken == null;
        }
        pumpRef.current();
        bump();
      })();
    },
    [bump, reset],
  );

  /** Reads the next page of the folder at [key], folders first. */
  const readNext = useCallback(
    (key: string) => {
      const pages = storeRef.current.records.get(key);
      if (pages == null || pages.loading || pages.error != null) {
        return;
      }
      if (!pages.dirsDone) {
        readPage(key, 'dirs', pages.dirsStarted ? pages.dirToken : null);
      } else if (!pages.filesDone) {
        readPage(key, 'files', pages.filesStarted ? pages.fileToken : null);
      }
    },
    [readPage],
  );

  /**
   * Starts every read the expanded paths need: each folder's first page,
   * found by name in its parent's pages, parents first. Drops the paths that
   * no longer exist, and settles a relocation.
   */
  const pump = useCallback(() => {
    const store = storeRef.current;
    const {
      snapshotId: target,
      sources: known,
      state: current,
    } = latest.current;
    if (target == null) {
      return;
    }
    const expandedKeys = new Set(current.expanded.map(treePathKey));
    const gone: TreePath[] = [];
    let pending = false;
    const ordered = [...current.expanded].sort((a, b) => a.length - b.length);
    for (const path of ordered) {
      const key = treePathKey(path);
      const sourceId = path[0];
      if (sourceId == null) {
        continue;
      }
      if (path.length === 1) {
        if (known.size > 0 && !known.has(sourceId)) {
          gone.push(path);
          continue;
        }
        if (!store.records.has(key)) {
          store.records.set(key, folderPages(sourceId, null));
        }
      } else {
        const parentPath = path.slice(0, -1);
        const parentKey = treePathKey(parentPath);
        if (!expandedKeys.has(parentKey)) {
          continue;
        }
        const parent = store.records.get(parentKey);
        if (parent == null) {
          pending = true;
          continue;
        }
        if (!store.records.has(key)) {
          const name = path[path.length - 1];
          const child = parent.dirs.find(d => d.name === name);
          if (child != null) {
            store.records.set(key, folderPages(sourceId, child.entryId));
          } else if (parent.dirsDone) {
            gone.push(path);
            continue;
          } else {
            // Not in the pages read so far: read on until found or ended.
            pending = true;
            if (parent.dirsStarted && parent.error == null) {
              readNext(parentKey);
            }
            continue;
          }
        }
      }
      const pages = store.records.get(key);
      if (pages == null) {
        continue;
      }
      if (!firstPageIn(pages) && pages.error == null) {
        pending = true;
        readNext(key);
      }
    }

    // While relocating, read on in the anchor's folder until its row is in.
    const anchor = current.anchor;
    if (store.relocating && anchor != null && anchor.length > 1) {
      const folderKey = treePathKey(anchor.slice(0, -1));
      const pages = expandedKeys.has(folderKey)
        ? store.records.get(folderKey)
        : undefined;
      const name = anchor[anchor.length - 1];
      if (
        pages != null &&
        firstPageIn(pages) &&
        !complete(pages) &&
        pages.error == null &&
        !pages.dirs.some(d => d.name === name) &&
        !pages.files.some(f => f.name === name)
      ) {
        pending = true;
        readNext(folderKey);
      }
    }

    if (gone.length > 0) {
      pending = true;
      latest.current.onStateChange(previous => ({
        ...previous,
        expanded: previous.expanded.filter(
          path => !gone.some(lost => isWithin(path, lost)),
        ),
      }));
    }
    for (const pages of store.records.values()) {
      if (pages.loading) {
        pending = true;
      }
    }
    if (!pending && store.relocating) {
      store.relocating = false;
      store.anchorPending = true;
      bump();
    }
  }, [bump, readNext]);
  pumpRef.current = pump;

  // A new snapshot, filter, sort or reload key: read every expanded path again.
  useEffect(() => {
    const store = storeRef.current;
    if (store.scopeKey === scopeKey) {
      return;
    }
    const newSnapshot =
      store.snapshotId !== snapshotId && snapshotId != null && store.shown;
    store.scopeKey = scopeKey;
    store.snapshotId = snapshotId;
    reset(false);
    store.anchorPending = false;
    if (newSnapshot) {
      store.relocating = true;
      setSnapshotChanged(true);
    }
    setAnchorIndex(null);
    bump();
  }, [scopeKey, snapshotId, reset, bump]);

  // Every render may have changed the expanded paths: start what they need.
  const expandedKey = state.expanded.map(treePathKey).join('\u0001');
  useEffect(() => {
    pump();
  }, [pump, expandedKey, version, scopeKey]);

  const rows = useMemo<TreeRow[]>(() => {
    if (snapshotId == null) {
      return [];
    }
    const store = storeRef.current;
    const expandedKeys = new Set(state.expanded.map(treePathKey));
    const out: TreeRow[] = [];
    const children = (path: TreePath, depth: number) => {
      const pages = store.records.get(treePathKey(path));
      if (pages == null || !pages.dirsStarted) {
        out.push({
          kind: 'placeholder',
          key: `placeholder:${treePathKey(path)}`,
          depth,
          folderPath: path,
        });
        return;
      }
      for (const folder of pages.dirs) {
        const folderPath = [...path, folder.name];
        const key = treePathKey(folderPath);
        const expanded = expandedKeys.has(key);
        out.push({
          kind: 'folder',
          key: `folder:${key}`,
          depth,
          path: folderPath,
          entryId: folder.entryId,
          name: folder.name,
          matchingFileCount: folder.matchingFileCount,
          expanded,
        });
        if (expanded) {
          children(folderPath, depth + 1);
        }
      }
      for (const entry of pages.files) {
        const filePath = [...path, entry.name];
        out.push({
          kind: 'file',
          key: `file:${treePathKey(filePath)}`,
          depth,
          path: filePath,
          entry,
        });
      }
      if (complete(pages)) {
        return;
      }
      const token = !pages.dirsDone
        ? pages.dirToken
        : pages.filesStarted
        ? pages.fileToken
        : null;
      out.push(
        token == null
          ? {
              kind: 'placeholder',
              key: `placeholder:${treePathKey(path)}`,
              depth,
              folderPath: path,
            }
          : {
              kind: 'more',
              key: `more:${treePathKey(path)}`,
              depth,
              folderPath: path,
              nextPageToken: token,
            },
      );
    };
    for (const [sourceId, alias] of sources) {
      const path = [sourceId];
      const key = treePathKey(path);
      const expanded = expandedKeys.has(key);
      out.push({
        kind: 'source',
        key: `source:${key}`,
        depth: 0,
        path,
        sourceId,
        alias,
        counts: store.records.get(key)?.counts ?? null,
        expanded,
      });
      if (expanded) {
        children(path, 1);
      }
    }
    return out;
    // The pages live in a ref: `version` changes after every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, snapshotId, sources, state.expanded]);

  // Rows of a snapshot are on screen once any folder or file is shown.
  useEffect(() => {
    if (rows.some(row => row.kind === 'folder' || row.kind === 'file')) {
      storeRef.current.shown = true;
    }
  }, [rows]);

  // Re-finds the anchor once a relocation has read every expanded path.
  useEffect(() => {
    const store = storeRef.current;
    if (!store.anchorPending || store.relocating) {
      return;
    }
    store.anchorPending = false;
    const anchor = latest.current.state.anchor;
    if (anchor == null) {
      return;
    }
    for (let length = anchor.length; length > 0; length -= 1) {
      const wanted = anchor.slice(0, length);
      const index = rows.findIndex(
        row =>
          (row.kind === 'source' ||
            row.kind === 'folder' ||
            row.kind === 'file') &&
          samePath(row.path, wanted),
      );
      if (index >= 0) {
        setAnchorIndex(index);
        return;
      }
    }
  }, [rows]);

  const toggle = useCallback(
    (row: TreeSourceRow | TreeFolderRow) => {
      const key = treePathKey(row.path);
      const store = storeRef.current;
      const { state: current, onStateChange: change } = latest.current;
      const isExpanded = current.expanded.some(path =>
        samePath(path, row.path),
      );
      if (isExpanded) {
        for (const recordKey of [...store.records.keys()]) {
          const recordPath = recordKey.split(SEPARATOR);
          if (isWithin(recordPath, row.path)) {
            store.records.delete(recordKey);
          }
        }
        const next = {
          ...current,
          expanded: current.expanded.filter(path => !isWithin(path, row.path)),
        };
        latest.current.state = next;
        change(previous => ({
          ...previous,
          expanded: previous.expanded.filter(path => !isWithin(path, row.path)),
        }));
      } else {
        store.records.set(
          key,
          row.kind === 'source'
            ? folderPages(row.sourceId, null)
            : folderPages(row.path[0] as string, row.entryId),
        );
        const next = { ...current, expanded: [...current.expanded, row.path] };
        latest.current.state = next;
        change(previous =>
          previous.expanded.some(path => samePath(path, row.path))
            ? previous
            : { ...previous, expanded: [...previous.expanded, row.path] },
        );
        readNext(key);
      }
      bump();
    },
    [bump, readNext],
  );

  const loadMore = useCallback(
    (row: TreeMoreRow) => {
      readNext(treePathKey(row.folderPath));
      bump();
    },
    [bump, readNext],
  );

  const retry = useCallback(() => {
    const store = storeRef.current;
    for (const pages of store.records.values()) {
      pages.error = null;
    }
    store.recovering = false;
    pump();
    bump();
  }, [bump, pump]);

  const error = useMemo(() => {
    for (const pages of storeRef.current.records.values()) {
      if (pages.error != null) {
        return pages.error;
      }
    }
    return null;
    // The pages live in a ref: `version` changes after every read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);

  const acknowledgeSnapshotChange = useCallback(
    () => setSnapshotChanged(false),
    [],
  );

  return {
    rows,
    toggle,
    loadMore,
    error,
    retry,
    anchorIndex,
    snapshotChanged,
    acknowledgeSnapshotChange,
  };
}
