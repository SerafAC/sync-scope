import {createContext, useContext} from 'react';

import type {FileFilter} from '../native/CloudSyncContracts';

/** Which Files tab view is shown. */
export type FilesView = 'GALLERY' | 'LIST';

/**
 * Files tab state shared by the gallery and the list (research R10): one
 * filter applies to both views. Held in React state by {@link FilesProvider}
 * and never persisted, so a restart starts again at `{GALLERY, ALL}`.
 */
export interface FilesState {
  view: FilesView;
  filter: FileFilter;
  setView: (view: FilesView) => void;
  setFilter: (filter: FileFilter) => void;
}

export const INITIAL_VIEW: FilesView = 'GALLERY';
export const INITIAL_FILTER: FileFilter = 'ALL';

export const FilesContext = createContext<FilesState | null>(null);

/** Reads the shared Files state; must be rendered inside `FilesProvider`. */
export function useFiles(): FilesState {
  const value = useContext(FilesContext);
  if (value == null) {
    throw new Error('useFiles must be used inside a FilesProvider');
  }
  return value;
}
