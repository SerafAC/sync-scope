import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';

import {FilesProvider} from '../../files/FilesProvider';
import {useFiles} from '../../files/useFiles';
import {listSelectableEntries} from '../../native/CloudSync';
import type {
  ActiveSnapshotDto,
  FileEntryDto,
  QuerySpec,
  SelectableEntriesResult,
} from '../../native/CloudSyncContracts';
import {ScanContext, type ScanState} from '../../scan/useScan';
import {
  SELECTION_CLEARED_NOTICE,
  SelectionProvider,
  useSelection,
} from '../SelectionProvider';

jest.mock('../../native/CloudSync', () => ({
  listSelectableEntries: jest.fn(),
}));

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
      images: rows.map(r => r[3]),
    },
  };
}

beforeEach(() => {
  activeSnapshotId = 'snap-1';
  listSelectableEntriesMock.mockReset();
});

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
      isImage: true,
    });
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
      isImage: false,
    });
    expect(result.current.selection.summary).toEqual({
      count: 4,
      knownBytes: 105,
      unknownSizeCount: 1,
      // c is not an image and the gallery is open.
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

  it('clears with a notice when the active snapshot changes', async () => {
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

  it('throws outside a SelectionProvider', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useSelection())).toThrow(
      'useSelection must be used inside a SelectionProvider',
    );
  });
});
