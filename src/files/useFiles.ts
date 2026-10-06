import {createContext, useContext} from 'react';

import {
  DEFAULT_BROWSE_PREFERENCES,
  type FileFilter,
  type FileSort,
} from '../native/CloudSyncContracts';

/** Which Files tab view is shown. */
export type FilesView = 'GALLERY' | 'LIST';

/** Each view's own sort (FR-003). */
export type SortsByView = Readonly<Record<FilesView, FileSort>>;

/**
 * Files tab state shared by the gallery and the list. Held in React state by
 * {@link FilesProvider}:
 *
 * - one filter applies to both views and is never persisted, so a restart
 *   starts again at All (005 research R10);
 * - the view mode and each view's sort are remembered natively through
 *   `getBrowsePreferences` / `setBrowsePreferences` (007 research R10).
 *
 * Sort, filter, view, folder and selection are independent (FR-003): changing
 * one never resets another.
 */
export interface FilesState {
  view: FilesView;
  filter: FileFilter;
  /** The sort of each view; the visible view's sort is `sorts[view]`. */
  sorts: SortsByView;
  /**
   * False until the remembered view and sorts have been read. The views mount
   * only after that, so they never read with a sort they are about to drop.
   */
  preferencesLoaded: boolean;
  setView: (view: FilesView) => void;
  setFilter: (filter: FileFilter) => void;
  setSort: (view: FilesView, sort: FileSort) => void;
}

export const INITIAL_VIEW: FilesView = DEFAULT_BROWSE_PREFERENCES.view;
export const INITIAL_FILTER: FileFilter = 'ALL';
export const INITIAL_SORTS: SortsByView = {
  GALLERY: DEFAULT_BROWSE_PREFERENCES.gallerySort,
  LIST: DEFAULT_BROWSE_PREFERENCES.listSort,
};

export const FilesContext = createContext<FilesState | null>(null);

/** Reads the shared Files state; must be rendered inside `FilesProvider`. */
export function useFiles(): FilesState {
  const value = useContext(FilesContext);
  if (value == null) {
    throw new Error('useFiles must be used inside a FilesProvider');
  }
  return value;
}
