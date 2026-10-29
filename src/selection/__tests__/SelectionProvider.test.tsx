import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';

import {FilesProvider} from '../../files/FilesProvider';
import {useFiles} from '../../files/useFiles';
import {carrySelection, listSelectableEntries} from '../../native/CloudSync';
import type {
  ActiveSnapshotDto,
  CarrySelectionResult,
  FileEntryDto,
  QuerySpec,
  SelectableEntriesResult,
} from '../../native/CloudSyncContracts';
import {ScanContext, type ScanState} from '../../scan/useScan';
import {
  SELECTION_CLEARED_NOTICE,
  SelectionProvider,
  selectionDroppedNotice,
  useSelection,
} from '../SelectionProvider';

jest.mock('../../native/CloudSync', () => ({
  // The remembered view and sorts do not matter here: the read never answers.
  getBrowsePreferences: jest.fn(() => new Promise(() => {})),
  setBrowsePreferences: jest.fn(),
  listSelectableEntries: jest.fn(),
  carrySelection: jest.fn(),
}));

const carrySelectionMock = carrySelection as jest.MockedFunction<
  typeof carrySelection
>;
const listSelectableEntriesMock = listSelectableEntries as jest.MockedFunction<
  typeof listSelectableEntries
>;

let activeSnapshotId: string | null = 'snap-1';

function scanState(): ScanState {
  const active =
    activeSnapshotId == null
      ? null
      : ({snapshotId: activeSnapshotId} as ActiveSnapshotDto);
  return {
    run: null,
    active,
    interrupted: null,
    loading: false,
    error: null,
    isRunning: false,
    isStale: false,
    scan: jest.fn(),
    cancel: jest.fn(),
    refresh: jest.fn(),
    dismissError: jest.fn(),
  };
}

function wrapper({children}: {children: React.ReactNode}) {
  return (
    <ScanContext.Provider value={scanState()}>
      <FilesProvider>
        <SelectionProvider>{children}</SelectionProvider>
      </FilesProvider>
    </ScanContext.Provider>
  );
}

function renderSelection() {
  return renderHook(() => ({selection: useSelection(), files: useFiles()}), {
    wrapper,
  });
}

function file(entryId: string, overrides: Partial<FileEntryDto> = {}): FileEntryDto {
  return {
    entryId,
    sourceId: 'src-1',
    parentId: null,
    kind: 'FILE',
    name: `${entryId}.png`,
    mimeType: 'image/png',
    sizeBytes: 70,
    modifiedUtcMillis: 1,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    sortName: `1${entryId}.png`,
    ...overrides,
  };
}

const galleryQuery: QuerySpec = {filter: 'ALL', view: 'GALLERY', sort: 'NAME_ASC'};

function selectable(
  rows: Array<[string, number | null, 'SYNCED' | 'UNSYNCED' | 'UNKNOWN', boolean]>,
): SelectableEntriesResult {
  return {
    contractVersion: 5,
    status: 'ok',
    selectable: {
      entryIds: rows.map(r => r[0]),
      sizes: rows.map(r => r[1]),
      statuses: rows.map(r => r[2]),
      media: rows.map(r => r[3]),
    },
  };
}

beforeEach(() => {
  activeSnapshotId = 'snap-1';
  listSelectableEntriesMock.mockReset();
  carrySelectionMock.mockReset();
});

function carried(
  entries: Array<[string, string, 'SYNCED' | 'UNSYNCED' | 'UNKNOWN']>,
  dropped: number,
): CarrySelectionResult {
  return {
    contractVersion: 7,
    status: 'ok',
    carried: entries.map(([from, to, status]) => ({from, to, status})),
    dropped,
  };
}

describe('SelectionProvider', () => {
  it('starts empty and not selecting', () => {
    const {result} = renderSelection();

    expect(result.current.selection.isSelecting).toBe(false);
    expect(result.current.selection.items.size).toBe(0);
    expect(result.current.selection.notice).toBeNull();
    expect(result.current.selection.summary).toEqual({
      count: 0,
      knownBytes: 0,
      unknownSizeCount: 0,
      hiddenByFilterCount: 0,
    });
  });

  it('enters selection mode on a long-press with that file', () => {
    const {result} = renderSelection();

    act(() => result.current.selection.longPress(file('a', {sizeBytes: null, status: 'UNKNOWN'})));

    expect(result.current.selection.isSelecting).toBe(true);
    expect(result.current.selection.snapshotId).toBe('snap-1');
    expect(result.current.selection.isSelected('a')).toBe(true);
    expect(result.current.selection.items.get('a')).toEqual({
      sizeBytes: null,
      status: 'UNKNOWN',
      isMedia: true,
    });
  });

  it('marks a video as media and a document as not media', () => {
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('v', {mimeType: 'video/mp4'})));
    act(() => result.current.selection.toggle(file('t', {mimeType: 'text/plain'})));
    act(() => result.current.selection.toggle(file('n', {mimeType: null})));

    expect(result.current.selection.items.get('v')?.isMedia).toBe(true);
    expect(result.current.selection.items.get('t')?.isMedia).toBe(false);
    expect(result.current.selection.items.get('n')?.isMedia).toBe(false);
  });

  it('toggles a file on tap while selecting', () => {
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    act(() => result.current.selection.toggle(file('b', {sizeBytes: 30})));
    expect(result.current.selection.summary).toMatchObject({count: 2, knownBytes: 100});

    act(() => result.current.selection.toggle(file('b')));
    expect(result.current.selection.isSelected('b')).toBe(false);
    expect(result.current.selection.summary.count).toBe(1);
  });

  it('never selects a directory', () => {
    const {result} = renderSelection();

    act(() => result.current.selection.longPress(file('d', {kind: 'DIRECTORY'})));
    expect(result.current.selection.isSelecting).toBe(false);

    act(() => result.current.selection.longPress(file('a')));
    act(() => result.current.selection.toggle(file('d', {kind: 'DIRECTORY'})));
    expect(result.current.selection.items.size).toBe(1);
  });

  it('leaves selection mode when the last item is toggled off', () => {
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    act(() => result.current.selection.toggle(file('a')));

    expect(result.current.selection.isSelecting).toBe(false);
    expect(result.current.selection.snapshotId).toBeNull();
  });

  it('clears and leaves selection mode', () => {
    const {result} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a'));
      result.current.selection.toggle(file('b'));
    });

    act(() => result.current.selection.clear());

    expect(result.current.selection.isSelecting).toBe(false);
    expect(result.current.selection.items.size).toBe(0);
  });

  it('merges the listSelectableEntries result on select all', async () => {
    listSelectableEntriesMock.mockResolvedValue(
      selectable([
        ['a', 70, 'SYNCED', true],
        ['b', null, 'UNKNOWN', true],
        ['c', 30, 'UNSYNCED', false],
      ]),
    );
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));
    act(() => result.current.selection.toggle(file('z', {sizeBytes: 5})));

    await act(() => result.current.selection.selectAll(galleryQuery));

    expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', galleryQuery);
    expect([...result.current.selection.items.keys()].sort()).toEqual(['a', 'b', 'c', 'z']);
    expect(result.current.selection.items.get('c')).toEqual({
      sizeBytes: 30,
      status: 'UNSYNCED',
      isMedia: false,
    });
    expect(result.current.selection.summary).toEqual({
      count: 4,
      knownBytes: 105,
      unknownSizeCount: 1,
      // c is not media and the gallery is open.
      hiddenByFilterCount: 1,
    });
  });

  it('enters selection mode on select all from an empty selection', async () => {
    listSelectableEntriesMock.mockResolvedValue(selectable([['a', 70, 'SYNCED', true]]));
    const {result} = renderSelection();

    await act(() => result.current.selection.selectAll(galleryQuery));

    expect(result.current.selection.isSelecting).toBe(true);
    expect(result.current.selection.snapshotId).toBe('snap-1');
  });

  it('keeps the selection and reports the error when select all fails', async () => {
    listSelectableEntriesMock.mockResolvedValue({
      contractVersion: 5,
      status: 'error',
      error: {code: 'INVALID_QUERY', message: 'The query sourceId is invalid.', action: null},
    });
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    await act(() => result.current.selection.selectAll(galleryQuery));

    expect(result.current.selection.items.size).toBe(1);
    expect(result.current.selection.error?.code).toBe('INVALID_QUERY');
    act(() => result.current.selection.dismissError());
    expect(result.current.selection.error).toBeNull();
  });

  it('reads several queries together and merges them (tree view, R11)', async () => {
    const roots = ['s-1', 's-2'].map(sourceId => ({
      ...galleryQuery,
      view: 'LIST' as const,
      sourceId,
      parentId: null,
    }));
    listSelectableEntriesMock
      .mockResolvedValueOnce(selectable([['a', 70, 'SYNCED', true]]))
      .mockResolvedValueOnce(selectable([['c', 30, 'UNSYNCED', false]]));
    const {result} = renderSelection();

    await act(() => result.current.selection.selectAll(roots));

    expect(listSelectableEntriesMock).toHaveBeenCalledTimes(2);
    expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', roots[0]);
    expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', roots[1]);
    expect([...result.current.selection.items.keys()].sort()).toEqual(['a', 'c']);
  });

  it('adds nothing when one of several queries fails', async () => {
    listSelectableEntriesMock
      .mockResolvedValueOnce(selectable([['b', 1, 'SYNCED', true]]))
      .mockResolvedValueOnce({
        contractVersion: 5,
        status: 'error',
        error: {code: 'INVALID_QUERY', message: 'The query sourceId is invalid.', action: null},
      });
    const {result} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    await act(() => result.current.selection.selectAll([galleryQuery, galleryQuery]));

    expect([...result.current.selection.items.keys()]).toEqual(['a']);
    expect(result.current.selection.error?.code).toBe('INVALID_QUERY');
  });

  it('does nothing on select all without an active snapshot', async () => {
    activeSnapshotId = null;
    const {result} = renderSelection();

    await act(() => result.current.selection.selectAll(galleryQuery));

    expect(listSelectableEntriesMock).not.toHaveBeenCalled();
    expect(result.current.selection.isSelecting).toBe(false);
  });

  it('is kept across view and filter changes, and the summary follows them', () => {
    const {result} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a'));
      result.current.selection.toggle(file('t', {mimeType: 'text/plain', status: 'UNSYNCED'}));
    });
    expect(result.current.selection.summary.hiddenByFilterCount).toBe(1);

    act(() => result.current.files.setView('LIST'));
    expect(result.current.selection.items.size).toBe(2);
    expect(result.current.selection.summary.hiddenByFilterCount).toBe(0);

    act(() => result.current.files.setFilter('SYNCED'));
    expect(result.current.selection.items.size).toBe(2);
    expect(result.current.selection.summary.hiddenByFilterCount).toBe(1);
  });

  it('carries the selection to the new snapshot under the new IDs, with no notice (R9)', async () => {
    carrySelectionMock.mockResolvedValue(
      carried(
        [
          ['a', 'a-2', 'SYNCED'],
          ['t', 't-2', 'SYNCED'],
        ],
        0,
      ),
    );
    const {result, rerender} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a', {sizeBytes: 70}));
      result.current.selection.toggle(
        file('t', {mimeType: 'text/plain', status: 'UNSYNCED', sizeBytes: null}),
      );
    });

    activeSnapshotId = 'snap-2';
    rerender({});

    await waitFor(() =>
      expect(result.current.selection.snapshotId).toBe('snap-2'),
    );
    expect(carrySelectionMock).toHaveBeenCalledWith('snap-1', 'snap-2', ['a', 't']);
    expect([...result.current.selection.items.keys()]).toEqual(['a-2', 't-2']);
    // Each kept item takes its size and status from the new row; t was promoted by the refresh.
    expect(result.current.selection.items.get('a-2')).toEqual({
      sizeBytes: 70,
      status: 'SYNCED',
      isMedia: true,
    });
    expect(result.current.selection.items.get('t-2')).toEqual({
      sizeBytes: null,
      status: 'SYNCED',
      isMedia: false,
    });
    expect(result.current.selection.isSelecting).toBe(true);
    expect(result.current.selection.notice).toBeNull();
  });

  it('names how many selected files were dropped when some changed or are gone', async () => {
    carrySelectionMock.mockResolvedValue(carried([['a', 'a-2', 'SYNCED']], 2));
    const {result, rerender} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a'));
      result.current.selection.toggle(file('b'));
      result.current.selection.toggle(file('c'));
    });

    activeSnapshotId = 'snap-2';
    rerender({});

    await waitFor(() =>
      expect(result.current.selection.notice).toBe(
        '2 selected files changed or were removed, so they were unselected.',
      ),
    );
    expect([...result.current.selection.items.keys()]).toEqual(['a-2']);
    expect(result.current.selection.snapshotId).toBe('snap-2');
  });

  it('uses the singular when one selected file was dropped', async () => {
    carrySelectionMock.mockResolvedValue(carried([['a', 'a-2', 'SYNCED']], 1));
    const {result, rerender} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a'));
      result.current.selection.toggle(file('b'));
    });

    activeSnapshotId = 'snap-2';
    rerender({});

    await waitFor(() =>
      expect(result.current.selection.notice).toBe(
        '1 selected file changed or was removed, so it was unselected.',
      ),
    );
    expect(selectionDroppedNotice(1)).toBe(
      '1 selected file changed or was removed, so it was unselected.',
    );
    expect(selectionDroppedNotice(3)).toBe(
      '3 selected files changed or were removed, so they were unselected.',
    );
  });

  it('leaves selection mode with the notice when every selected file was dropped', async () => {
    carrySelectionMock.mockResolvedValue(carried([], 1));
    const {result, rerender} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    activeSnapshotId = 'snap-2';
    rerender({});

    await waitFor(() =>
      expect(result.current.selection.notice).toBe(
        '1 selected file changed or was removed, so it was unselected.',
      ),
    );
    expect(result.current.selection.isSelecting).toBe(false);
    expect(result.current.selection.snapshotId).toBeNull();
  });

  it('clears with the existing notice when the carry fails', async () => {
    carrySelectionMock.mockResolvedValue({
      contractVersion: 7,
      status: 'error',
      error: {
        code: 'SNAPSHOT_NOT_FOUND',
        message: 'That scan result is no longer available.',
        action: null,
        conflictingSource: null,
      },
    });
    const {result, rerender} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    activeSnapshotId = 'snap-2';
    rerender({});

    await waitFor(() => expect(result.current.selection.isSelecting).toBe(false));
    expect(result.current.selection.notice).toBe(SELECTION_CLEARED_NOTICE);
    expect(SELECTION_CLEARED_NOTICE).toBe(
      'Results were updated, so the selection was cleared.',
    );

    act(() => result.current.selection.dismissNotice());
    expect(result.current.selection.notice).toBeNull();

    // A new selection belongs to the new snapshot.
    act(() => result.current.selection.longPress(file('b')));
    expect(result.current.selection.snapshotId).toBe('snap-2');
  });

  it('clears with the existing notice when the scan result is gone', async () => {
    const {result, rerender} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    activeSnapshotId = null;
    rerender({});

    await waitFor(() => expect(result.current.selection.isSelecting).toBe(false));
    expect(result.current.selection.notice).toBe(SELECTION_CLEARED_NOTICE);
    expect(carrySelectionMock).not.toHaveBeenCalled();
  });

  it('ignores a carry that arrives after an even newer snapshot, and carries again from there', async () => {
    let resolveFirst: (value: CarrySelectionResult) => void = () => {};
    carrySelectionMock
      .mockReturnValueOnce(
        new Promise(r => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce(carried([['a', 'a-3', 'SYNCED']], 0));
    const {result, rerender} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));

    activeSnapshotId = 'snap-2';
    rerender({});
    activeSnapshotId = 'snap-3';
    rerender({});
    await act(async () => {
      resolveFirst(carried([['a', 'a-2', 'SYNCED']], 0));
    });

    await waitFor(() =>
      expect(result.current.selection.snapshotId).toBe('snap-3'),
    );
    expect(carrySelectionMock).toHaveBeenLastCalledWith('snap-1', 'snap-3', ['a']);
    expect([...result.current.selection.items.keys()]).toEqual(['a-3']);
    expect(result.current.selection.notice).toBeNull();
  });

  it('shows no notice when the snapshot changes while nothing is selected', () => {
    const {result, rerender} = renderSelection();

    activeSnapshotId = 'snap-2';
    rerender({});

    expect(result.current.selection.notice).toBeNull();
  });

  it('drops a select all result that arrives after the snapshot changed', async () => {
    let resolve: (value: SelectableEntriesResult) => void = () => {};
    listSelectableEntriesMock.mockReturnValue(
      new Promise(r => {
        resolve = r;
      }),
    );
    const {result, rerender} = renderSelection();
    act(() => result.current.selection.longPress(file('a')));
    let pending: Promise<void> = Promise.resolve();
    act(() => {
      pending = result.current.selection.selectAll(galleryQuery);
    });

    activeSnapshotId = 'snap-2';
    rerender({});
    await act(async () => {
      resolve(selectable([['b', 1, 'SYNCED', true]]));
      await pending;
    });

    expect(result.current.selection.isSelected('b')).toBe(false);
    expect(result.current.selection.isSelecting).toBe(false);
  });

  it('removes deleted IDs and leaves selection mode when empty', () => {
    const {result} = renderSelection();
    act(() => {
      result.current.selection.longPress(file('a'));
      result.current.selection.toggle(file('b'));
      result.current.selection.toggle(file('c'));
    });

    act(() => result.current.selection.removeIds(['a', 'b', 'missing']));
    expect([...result.current.selection.items.keys()]).toEqual(['c']);

    act(() => result.current.selection.removeIds(['c']));
    expect(result.current.selection.isSelecting).toBe(false);
  });

  it('bumps deletionKey on every finished deletion, so the Files views reload (009 T043)', () => {
    const {result} = renderSelection();
    expect(result.current.selection.deletionKey).toBe(0);

    act(() => result.current.selection.removeIds(['a']));
    expect(result.current.selection.deletionKey).toBe(1);

    // A deletion that removed nothing still changed the device: reload too.
    act(() => result.current.selection.removeIds([]));
    expect(result.current.selection.deletionKey).toBe(2);
  });

  it('throws outside a SelectionProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSelection())).toThrow(
      'useSelection must be used inside a SelectionProvider',
    );
  });
});
