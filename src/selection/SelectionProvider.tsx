import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { isMediaMime } from '../files/media';
import { useFiles } from '../files/useFiles';
import { carrySelection, listSelectableEntries } from '../native/CloudSync';
import type {
  CarrySelectionResult,
  CloudSyncError,
  FileEntryDto,
  QuerySpec,
} from '../native/CloudSyncContracts';
import { useScan } from '../scan/useScan';
import {
  selectionSummary,
  type SelectionItem,
  type SelectionSummary,
} from './summary';

/**
 * The snackbar text when a new scan result replaced the selected one and the
 * selection could not be carried over to it.
 */
export const SELECTION_CLEARED_NOTICE =
  'Results were updated, so the selection was cleared.';

/** The snackbar text when [count] selected files were not carried to a new scan result (R9). */
export function selectionDroppedNotice(count: number): string {
  return count === 1
    ? '1 selected file changed or was removed, so it was unselected.'
    : `${count} selected files changed or were removed, so they were unselected.`;
}

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
  /** Set when selected files were unselected because the active snapshot changed. */
  notice: string | null;
  isSelected: (entryId: string) => boolean;
  /** Long-press: enters selection mode with [row]; while selecting, toggles it. */
  longPress: (row: SelectableRow) => void;
  /** Tap while selecting: adds or removes [row]. Directories are ignored. */
  toggle: (row: SelectableRow) => void;
  /**
   * Merges every FILE row [query] shows (listSelectableEntries) into the
   * selection. Several queries (the tree's one per source) are read together
   * and merged only when every read succeeds.
   */
  selectAll: (query: QuerySpec | readonly QuerySpec[]) => Promise<void>;
  /** ✕ or back: clears and leaves selection mode. */
  clear: () => void;
  /** After a deletion: drops [entryIds]; leaves selection mode when empty. */
  removeIds: (entryIds: readonly string[]) => void;
  /**
   * Counts finished deletions (each `removeIds` call), wherever they ran: the
   * Files views reload page 1 when it changes, also after one in the preview.
   */
  deletionKey: number;
  dismissNotice: () => void;
  dismissError: () => void;
}

interface Selection {
  snapshotId: string | null;
  items: ReadonlyMap<string, SelectionItem>;
}

const EMPTY: Selection = { snapshotId: null, items: new Map() };

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
    isMedia: isMediaMime(row.mimeType),
  };
}

/** A selection with [items]; an empty one belongs to no snapshot. */
function withItems(
  snapshotId: string | null,
  items: Map<string, SelectionItem>,
): Selection {
  return items.size === 0 ? EMPTY : { snapshotId, items };
}

/**
 * Holds the Files tab selection in memory (research R9): an explicit set of
 * entry IDs of one snapshot, kept across view and filter changes. When
 * `useScan`'s active snapshot changes, `carrySelection` moves it to the new
 * snapshot's IDs; the files that changed or are gone are unselected with a
 * notice that counts them, and a failed carry clears it with
 * [SELECTION_CLEARED_NOTICE]. Mounted inside `FilesProvider`, whose view and
 * filter the summary follows.
 */
export function SelectionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const { view, filter } = useFiles();
  const activeSnapshotId = useScan().active?.snapshotId ?? null;
  const [selection, setSelection] = useState<Selection>(EMPTY);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<CloudSyncError | null>(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [deletionKey, setDeletionKey] = useState(0);

  const activeRef = useRef(activeSnapshotId);
  activeRef.current = activeSnapshotId;

  const selectionRef = useRef(selection);
  selectionRef.current = selection;

  useEffect(() => {
    const current = selectionRef.current;
    const from = current.snapshotId;
    if (current.items.size === 0 || from === activeSnapshotId) {
      return;
    }
    const cleared = () => {
      setSelection(EMPTY);
      setNotice(SELECTION_CLEARED_NOTICE);
    };
    if (from == null || activeSnapshotId == null) {
      cleared();
      return;
    }
    const to = activeSnapshotId;
    const requested = [...current.items.keys()];
    (async () => {
      let result: CarrySelectionResult | null | undefined;
      try {
        result = await carrySelection(from, to, requested);
      } catch {
        result = null;
      }
      // A newer snapshot replaced this one meanwhile: its own carry applies.
      if (activeRef.current !== to) {
        return;
      }
      const latest = selectionRef.current;
      // Cleared, or emptied by a deletion, while the carry ran.
      if (latest.snapshotId !== from) {
        return;
      }
      if (result?.status !== 'ok') {
        cleared();
        return;
      }
      const moved = new Map(result.carried.map(c => [c.from, c]));
      const asked = new Set(requested);
      const items = new Map<string, SelectionItem>();
      let dropped = 0;
      latest.items.forEach((item, entryId) => {
        const entry = moved.get(entryId);
        if (entry != null) {
          // Same size and time by the match rule; the status is the new row's.
          items.set(entry.to, { ...item, status: entry.status });
        } else if (asked.has(entryId)) {
          dropped += 1;
        } else {
          // Selected while the carry ran, from rows of the new results.
          items.set(entryId, item);
        }
      });
      const next = withItems(to, items);
      selectionRef.current = next;
      setSelection(next);
      if (dropped > 0) {
        setNotice(selectionDroppedNotice(dropped));
      }
    })();
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

  const selectAll = useCallback(
    async (query: QuerySpec | readonly QuerySpec[]) => {
      const snapshotId = activeRef.current;
      const queries: readonly QuerySpec[] = Array.isArray(query)
        ? query
        : [query as QuerySpec];
      if (snapshotId == null || queries.length === 0) {
        return;
      }
      setSelectingAll(true);
      try {
        const results = await Promise.all(
          queries.map(q => listSelectableEntries(snapshotId, q)),
        );
        const added = new Map<string, SelectionItem>();
        for (const result of results) {
          if (result.status !== 'ok') {
            setError(result.error);
            return;
          }
          const { entryIds, sizes, statuses, media } = result.selectable;
          // The wrapper checked that the arrays are parallel; the fallbacks only satisfy the index type.
          entryIds.forEach((entryId, i) => {
            added.set(entryId, {
              sizeBytes: sizes[i] ?? null,
              status: statuses[i] ?? 'UNKNOWN',
              isMedia: media[i] === true,
            });
          });
        }
        setSelection(prev => {
          // A newer scan replaced the snapshot while the read was in flight.
          if (
            activeRef.current !== snapshotId ||
            (prev.snapshotId != null && prev.snapshotId !== snapshotId)
          ) {
            return prev;
          }
          const items = new Map(prev.items);
          added.forEach((item, entryId) => items.set(entryId, item));
          return withItems(snapshotId, items);
        });
      } finally {
        setSelectingAll(false);
      }
    },
    [],
  );

  const clear = useCallback(() => setSelection(EMPTY), []);

  const removeIds = useCallback((entryIds: readonly string[]) => {
    setSelection(prev => {
      const items = new Map(prev.items);
      entryIds.forEach(id => items.delete(id));
      return withItems(prev.snapshotId, items);
    });
    setDeletionKey(key => key + 1);
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);
  const dismissError = useCallback(() => setError(null), []);

  const value = useMemo<SelectionState>(() => {
    const { items } = selection;
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
      deletionKey,
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
    deletionKey,
    dismissNotice,
    dismissError,
  ]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}
