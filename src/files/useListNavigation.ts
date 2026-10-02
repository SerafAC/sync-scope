import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { queryTreeChildren } from '../native/CloudSync';
import { MAX_PAGE_SIZE } from '../native/CloudSyncContracts';

/** Text of the breadcrumb's first crumb, which returns to the sources list. */
export const ALL_FOLDERS = 'All folders';

/** One level of the list view's stack; `entryId` is null at the source root. */
export interface PathLevel {
  entryId: string | null;
  name: string;
}

/** Where the list view is (data-model.md, navigation stack). */
export type ListLocation =
  | { kind: 'sources' }
  | { kind: 'folder'; sourceId: string; alias: string; path: PathLevel[] };

/** One breadcrumb; pass `index` to `goTo` (-1 is the sources list). */
export interface Crumb {
  name: string;
  index: number;
}

/**
 * The entry ID of the DIRECTORY named exactly [name] directly under
 * [parentId] (null: the source root) of [sourceId] in [snapshotId], or null
 * when there is none.
 */
export type FindChildDirectory = (
  snapshotId: string,
  sourceId: string,
  parentId: string | null,
  name: string,
) => Promise<string | null>;

export interface UseListNavigationOptions {
  /** The active snapshot. A change re-resolves the stack by name (research R2). */
  snapshotId: string | null;
  /**
   * The added sources; a location in a source that is no longer here returns
   * to the sources list on relocation. Null when not known yet.
   */
  sources: { has(sourceId: string): boolean } | null;
  /** Injected for tests; defaults to the `queryTreeChildren` search. */
  findChildDirectory?: FindChildDirectory;
}

export interface UseListNavigationResult {
  location: ListLocation;
  /** `All folders`, the alias, then each folder name. */
  breadcrumb: Crumb[];
  /**
   * The snapshot the location's entry IDs belong to. It lags the active
   * snapshot while `relocating`; reads should use this one.
   */
  snapshotId: string | null;
  relocating: boolean;
  openSource: (sourceId: string, alias: string) => void;
  openFolder: (entryId: string, name: string) => void;
  /** Truncates the stack to `path[index]`; -1 returns to the sources list. */
  goTo: (index: number) => void;
  /** Re-resolves the current stack in the active snapshot. */
  relocate: () => Promise<void>;
}

const SOURCES_LOCATION: ListLocation = { kind: 'sources' };

interface NavState {
  location: ListLocation;
  snapshotId: string | null;
}

/**
 * Production {@link FindChildDirectory}. `search` is a substring match, so
 * every page is checked for the exact name, and "missing" is concluded only
 * after the last page. A page that cannot be read rejects.
 */
export const findChildDirectory: FindChildDirectory = async (
  snapshotId,
  sourceId,
  parentId,
  name,
) => {
  let pageToken: string | null = null;
  do {
    const result = await queryTreeChildren(
      snapshotId,
      parentId,
      {
        filter: 'ALL',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId,
        search: name,
        pageSize: MAX_PAGE_SIZE,
      },
      pageToken,
    );
    if (result.status === 'error') {
      throw new Error(result.error.code);
    }
    const match = result.page.entries.find(
      e => e.kind === 'DIRECTORY' && e.name === name,
    );
    if (match != null) {
      return match.entryId;
    }
    pageToken = result.page.nextPageToken;
  } while (pageToken != null);
  return null;
};

/**
 * The list view's navigation stack and breadcrumb. Entry IDs are fresh in
 * every snapshot, so after a snapshot change the stack is walked again by
 * name from the source root and stops at the deepest level that still
 * exists, or returns to the sources list when the source itself is gone.
 *
 * Feature 006's tree view reuses this stack and breadcrumb.
 */
export function useListNavigation({
  snapshotId,
  sources,
  findChildDirectory: find = findChildDirectory,
}: UseListNavigationOptions): UseListNavigationResult {
  const [nav, setNav] = useState<NavState>({
    location: SOURCES_LOCATION,
    snapshotId,
  });
  const [relocating, setRelocating] = useState(false);
  const navRef = useRef(nav);
  const latest = useRef({ snapshotId, sources, find });
  const sequence = useRef(0);
  const mounted = useRef(true);

  // Declared first, so the effects below always see the latest props.
  useEffect(() => {
    latest.current = { snapshotId, sources, find };
  });

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const commit = useCallback((next: NavState) => {
    navRef.current = next;
    setNav(next);
  }, []);

  const relocate = useCallback(async (): Promise<void> => {
    sequence.current += 1;
    const walk = sequence.current;
    const { snapshotId: target, sources: known, find: lookup } = latest.current;
    const { location } = navRef.current;
    const settle = (next: ListLocation) => {
      commit({ location: next, snapshotId: target });
      setRelocating(false);
    };
    if (target == null) {
      settle(SOURCES_LOCATION);
      return;
    }
    if (location.kind === 'sources' || location.path.length === 1) {
      settle(
        location.kind === 'folder' &&
          known != null &&
          !known.has(location.sourceId)
          ? SOURCES_LOCATION
          : location,
      );
      return;
    }
    if (known != null && !known.has(location.sourceId)) {
      settle(SOURCES_LOCATION);
      return;
    }
    setRelocating(true);
    const [root, ...levels] = location.path;
    const path: PathLevel[] = [root as PathLevel];
    for (const level of levels) {
      let found: string | null;
      try {
        found = await lookup(
          target,
          location.sourceId,
          (path[path.length - 1] as PathLevel).entryId,
          level.name,
        );
      } catch {
        found = null;
      }
      if (!mounted.current || walk !== sequence.current) {
        return;
      }
      if (found == null) {
        break;
      }
      path.push({ entryId: found, name: level.name });
    }
    settle({ ...location, path });
  }, [commit]);

  useEffect(() => {
    if (snapshotId !== navRef.current.snapshotId) {
      relocate();
    }
  }, [snapshotId, relocate]);

  /** Applies a user move; IDs of an older snapshot are re-resolved at once. */
  const navigate = useCallback(
    (location: ListLocation) => {
      sequence.current += 1;
      const current = navRef.current;
      commit({ location, snapshotId: current.snapshotId });
      if (current.snapshotId !== latest.current.snapshotId) {
        relocate();
      } else {
        setRelocating(false);
      }
    },
    [commit, relocate],
  );

  const openSource = useCallback(
    (sourceId: string, alias: string) =>
      navigate({
        kind: 'folder',
        sourceId,
        alias,
        path: [{ entryId: null, name: alias }],
      }),
    [navigate],
  );

  const openFolder = useCallback(
    (entryId: string, name: string) => {
      const { location } = navRef.current;
      if (location.kind !== 'folder') {
        return;
      }
      navigate({ ...location, path: [...location.path, { entryId, name }] });
    },
    [navigate],
  );

  const goTo = useCallback(
    (index: number) => {
      const { location } = navRef.current;
      if (location.kind !== 'folder' || index < -1) {
        return;
      }
      if (index === -1) {
        navigate(SOURCES_LOCATION);
      } else if (index < location.path.length - 1) {
        navigate({ ...location, path: location.path.slice(0, index + 1) });
      }
    },
    [navigate],
  );

  const breadcrumb = useMemo<Crumb[]>(() => {
    const crumbs: Crumb[] = [{ name: ALL_FOLDERS, index: -1 }];
    if (nav.location.kind === 'folder') {
      nav.location.path.forEach((level, index) =>
        crumbs.push({ name: level.name, index }),
      );
    }
    return crumbs;
  }, [nav.location]);

  return {
    location: nav.location,
    breadcrumb,
    snapshotId: nav.snapshotId,
    relocating,
    openSource,
    openFolder,
    goTo,
    relocate,
  };
}
