import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {getBrowsePreferences, setBrowsePreferences} from '../native/CloudSync';
import type {
  BrowsePreferencesDto,
  FileFilter,
  FileSort,
} from '../native/CloudSyncContracts';
import {
  FilesContext,
  INITIAL_FILTER,
  INITIAL_SORTS,
  INITIAL_VIEW,
  type FilesState,
  type FilesView,
} from './useFiles';

/** The preference key that holds each view's sort (data-model.md, Browse preferences). */
const SORT_KEY = {
  GALLERY: 'gallerySort',
  LIST: 'listSort',
} as const satisfies Record<FilesView, keyof BrowsePreferencesDto>;

/** Reads the remembered choices; any failure reads as the first-run defaults. */
async function readPreferences(): Promise<BrowsePreferencesDto | null> {
  try {
    const result = await getBrowsePreferences();
    return result.status === 'ok' ? result.preferences : null;
  } catch {
    return null;
  }
}

/** Stores [change]; a failed write only means the choice is not remembered. */
function writePreferences(change: Partial<BrowsePreferencesDto>): void {
  try {
    setBrowsePreferences(change).catch(() => undefined);
  } catch {
    // Not remembered; the choice still applies until the app closes.
  }
}

/**
 * Holds the Files tab's view, filter and per-view sorts (007 research R10).
 *
 * The view mode and both sorts are read once with `getBrowsePreferences()`
 * when the provider mounts (`preferencesLoaded` turns true when the read
 * resolves) and each change is written with `setBrowsePreferences()`. A
 * choice made before the read resolves wins over the stored one. The filter
 * stays in memory only, so it is back at All after a restart (005 R10).
 */
export function FilesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [view, setViewState] = useState<FilesView>(INITIAL_VIEW);
  const [filter, setFilter] = useState<FileFilter>(INITIAL_FILTER);
  const [gallerySort, setGallerySort] = useState<FileSort>(
    INITIAL_SORTS.GALLERY,
  );
  const [listSort, setListSort] = useState<FileSort>(INITIAL_SORTS.LIST);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);
  /** Fields the user changed before the stored ones arrived. */
  const touched = useRef(new Set<keyof BrowsePreferencesDto>());

  useEffect(() => {
    let live = true;
    readPreferences().then(stored => {
      if (!live) {
        return;
      }
      if (stored != null) {
        if (!touched.current.has('view')) {
          setViewState(stored.view);
        }
        if (!touched.current.has('gallerySort')) {
          setGallerySort(stored.gallerySort);
        }
        if (!touched.current.has('listSort')) {
          setListSort(stored.listSort);
        }
      }
      setPreferencesLoaded(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const setView = useCallback((next: FilesView) => {
    touched.current.add('view');
    setViewState(next);
    writePreferences({view: next});
  }, []);

  const setSort = useCallback((target: FilesView, sort: FileSort) => {
    const key = SORT_KEY[target];
    touched.current.add(key);
    if (target === 'GALLERY') {
      setGallerySort(sort);
    } else {
      setListSort(sort);
    }
    writePreferences({[key]: sort});
  }, []);

  const sorts = useMemo(
    () => ({GALLERY: gallerySort, LIST: listSort}),
    [gallerySort, listSort],
  );

  const value = useMemo<FilesState>(
    () => ({
      view,
      filter,
      sorts,
      preferencesLoaded,
      setView,
      setFilter,
      setSort,
    }),
    [view, filter, sorts, preferencesLoaded, setView, setSort],
  );

  return (
    <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
  );
}
