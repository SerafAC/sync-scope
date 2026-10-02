import React, {useMemo, useState} from 'react';

import type {FileFilter} from '../native/CloudSyncContracts';
import {
  FilesContext,
  INITIAL_FILTER,
  INITIAL_VIEW,
  type FilesState,
  type FilesView,
} from './useFiles';

/**
 * Holds the Files tab's view and filter in memory (research R10). The value
 * lives as long as the provider is mounted and is reset on app restart.
 */
export function FilesProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [view, setView] = useState<FilesView>(INITIAL_VIEW);
  const [filter, setFilter] = useState<FileFilter>(INITIAL_FILTER);

  const value = useMemo<FilesState>(
    () => ({view, filter, setView, setFilter}),
    [view, filter],
  );

  return (
    <FilesContext.Provider value={value}>{children}</FilesContext.Provider>
  );
}
