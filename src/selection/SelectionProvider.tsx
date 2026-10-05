import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {useFiles} from '../files/useFiles';
import {listSelectableEntries} from '../native/CloudSync';
import type {
  CloudSyncError,
  FileEntryDto,
  QuerySpec,
} from '../native/CloudSyncContracts';
import {useScan} from '../scan/useScan';
import {
  selectionSummary,
  type SelectionItem,
  type SelectionSummary,
} from './summary';

/** The snackbar text when a new scan result replaced the selected one. */
export const SELECTION_CLEARED_NOTICE =
  'Results were updated, so the selection was cleared.';

/** The fields of an on-screen row the selection reads (data-model "Selection"). */
export type SelectableRow = Pick<
  FileEntryDto,
  'entryId' | 'kind' | 'mimeType' | 'sizeBytes' | 'status'
>;

export interface SelectionState {
  /** The snapshot the selected IDs belong to; null while nothing is selected. */
  snapshotId: string | null;
  items: ReadonlyMap<string, SelectionItem>;
  /** Selection mode: at least one file is selected. */
  isSelecting: boolean;
  /** Derived for the current view and filter of the Files tab. */
  summary: SelectionSummary;
  /** A `selectAll` call is in flight. */
  selectingAll: boolean;
  /** The last `selectAll` error, until dismissed. */
  error: CloudSyncError | null;
  /** Set when the selection was cleared because the active snapshot changed. */
  notice: string | null;
  isSelected: (entryId: string) => boolean;
  /** Long-press: enters selection mode with [row]; while selecting, toggles it. */
  longPress: (row: SelectableRow) => void;
  /** Tap while selecting: adds or removes [row]. Directories are ignored. */
  toggle: (row: SelectableRow) => void;
  /** Merges every FILE row [query] shows (listSelectableEntries) into the selection. */
  selectAll: (query: QuerySpec) => Promise<void>;
  /** ✕ or back: clears and leaves selection mode. */
  clear: () => void;
  /** After a deletion: drops [entryIds]; leaves selection mode when empty. */
  removeIds: (entryIds: readonly string[]) => void;
  dismissNotice: () => void;
  dismissError: () => void;
}

interface Selection {
  snapshotId: string | null;
  items: ReadonlyMap<string, SelectionItem>;
}

const EMPTY: Selection = {snapshotId: null, items: new Map()};

export const SelectionContext = createContext<SelectionState | null>(null);

/** Reads the Files tab selection; must be rendered inside `SelectionProvider`. */
export function useSelection(): SelectionState {
  const value = useContext(SelectionContext);
  if (value == null) {
    throw new Error('useSelection must be used inside a SelectionProvider');
  }
  return value;
}

function itemOf(row: SelectableRow): SelectionItem {
  return {
    sizeBytes: row.sizeBytes,
    status: row.status,
    isImage: row.mimeType?.startsWith('image/') === true,
  };
}

/** A selection with [items]; an empty one belongs to no snapshot. */
function withItems(
  snapshotId: string | null,
  items: Map<string, SelectionItem>,
): Selection {
  return items.size === 0 ? EMPTY : {snapshotId, items};
}

/**
 * Holds the Files tab selection in memory (research R9): an explicit set of
 * entry IDs of one snapshot, kept across view and filter changes and cleared
 * with a notice when `useScan`'s active snapshot changes. Mounted inside
 * `FilesProvider`, whose view and filter the summary follows.
 */
export function SelectionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const {view, filter} = useFiles();
  const activeSnapshotId = useScan().active?.snapshotId ?? null;
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<CloudSyncError | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);

  const activeRef = useRef(activeSnapshotId);
  activeRef.current = activeSnapshotId;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const current = selectionRef.current;
    if (current.items.size > 0 && current.snapshotId !== activeSnapshotId) {
      setSelection(EMPTY);
      setNotice(SELECTION_CLEARED_NOTICE);
    }
  }, [activeSnapshotId]);

  const toggle = useCallback((row: SelectableRow) => {
    if (row.kind !== 'FILE') {
      return;
    }
    setSelection(prev => {
      const items = new Map(prev.items);
      if (items.has(row.entryId)) {
        items.delete(row.entryId);
      } else {
        items.set(row.entryId, itemOf(row));
      }
      return withItems(prev.snapshotId ?? activeRef.current, items);
    });
  }, []);

  const longPress = toggle;

  const selectAll = useCallback(async (query: QuerySpec) => {
    const snapshotId = activeRef.current;
    if (snapshotId == null) {
      return;
    }
    setSelectingAll(true);
    try {
      const result = await listSelectableEntries(snapshotId, query);
      if (result.status !== 'ok') {
        setError(result.error);
        return;
      }
      setSelection(prev => {
        // A newer scan replaced the snapshot while the read was in flight.
        if (
          activeRef.current !== snapshotId ||
          (prev.snapshotId != null && prev.snapshotId !== snapshotId)
        ) {
          return prev;
        }
        const {entryIds, sizes, statuses, images} = result.selectable;
        const items = new Map(prev.items);
        // The wrapper checked that the arrays are parallel; the fallbacks only satisfy the index type.
        entryIds.forEach((entryId, i) => {
          items.set(entryId, {
            sizeBytes: sizes[i] ?? null,
            status: statuses[i] ?? 'UNKNOWN',
            isImage: images[i] === true,
          });
        });
        return withItems(snapshotId, items);
      });
    } finally {
      setSelectingAll(false);
    }
  }, []);

  const clear = useCallback(() => setSelection(EMPTY), []);

  const removeIds = useCallback((entryIds: readonly string[]) => {
    setSelection(prev => {
      const items = new Map(prev.items);
      entryIds.forEach(id => items.delete(id));
      return withItems(prev.snapshotId, items);
    });
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo<SelectionState>(() => {
    const {items} = selection;
    return {
      snapshotId: selection.snapshotId,
      items,
      isSelecting: items.size > 0,
      summary: selectionSummary(items, view, filter),
      selectingAll,
      error,
      notice,
      isSelected: (entryId: string) => items.has(entryId),
      longPress,
      toggle,
      selectAll,
      clear,
      removeIds,
      dismissNotice,
      dismissError,
    };
  }, [
    selection,
    view,
    filter,
    selectingAll,
    error,
    notice,
    longPress,
    toggle,
    selectAll,
    clear,
    removeIds,
    dismissNotice,
    dismissError,
  ]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
