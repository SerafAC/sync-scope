import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { BackHandler, Dimensions, Text } from 'react-native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { FilesProvider } from '../../files/FilesProvider';
import { galleryTileSize } from '../../files/GalleryTile';
import { density } from '../../theme/spacing';
import { useSourceAliases } from '../../files/useSourceAliases';
import {
  executeLocalDeletion,
  getBrowsePreferences,
  getLocalImageHandle,
  getScrollIndex,
  listSelectableEntries,
  prepareLocalDeletion,
  queryFiles,
  queryTreeChildren,
  setBrowsePreferences,
} from '../../native/CloudSync';
import type {
  ActiveSnapshotDto,
  BrowsePreferencesDto,
  FileEntryDto,
  QueryFilesResult,
  ScrollIndexResult,
  StatusCountDto,
} from '../../native/CloudSyncContracts';
import { useScan, type ScanState } from '../../scan/useScan';
import { SelectionProvider } from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { FilesScreen, selectAllQuery } from '../FilesScreen';

/** The tab screen's options as `navigation.setOptions` merged them. */
type HeaderOptions = {
  tabBarStyle?: { display?: string };
  headerLeft?: () => React.ReactNode;
  headerRight?: () => React.ReactNode;
};

const mockNavigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
};
let mockOptions: HeaderOptions = {};
const optionListeners = new Set<() => void>();

jest.mock('@react-navigation/native', () => ({
  // DeleteFlow re-provides NavigationContext inside its Portal.
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  queryFiles: jest.fn(),
  queryTreeChildren: jest.fn(),
  getScrollIndex: jest.fn(),
  getLocalImageHandle: jest.fn(),
  listSelectableEntries: jest.fn(),
  prepareLocalDeletion: jest.fn(),
  executeLocalDeletion: jest.fn(),
}));
jest.mock('../../scan/useScan', () => ({ useScan: jest.fn() }));
jest.mock('../../files/useSourceAliases', () => ({
  useSourceAliases: jest.fn(),
}));

const getScrollIndexMock = getScrollIndex as jest.MockedFunction<
  typeof getScrollIndex
>;
const queryFilesMock = queryFiles as jest.MockedFunction<typeof queryFiles>;
const queryTreeChildrenMock = queryTreeChildren as jest.MockedFunction<
  typeof queryTreeChildren
>;
const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;
const listSelectableEntriesMock = listSelectableEntries as jest.MockedFunction<
  typeof listSelectableEntries
>;
const prepareLocalDeletionMock = prepareLocalDeletion as jest.MockedFunction<
  typeof prepareLocalDeletion
>;
const executeLocalDeletionMock = executeLocalDeletion as jest.MockedFunction<
  typeof executeLocalDeletion
>;
const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;
const setBrowsePreferencesMock = setBrowsePreferences as jest.MockedFunction<
  typeof setBrowsePreferences
>;
const useScanMock = useScan as jest.MockedFunction<typeof useScan>;
const useSourceAliasesMock = useSourceAliases as jest.MockedFunction<
  typeof useSourceAliases
>;

const HIDDEN = { includeHiddenElements: true };

const ALIASES = new Map([['s-1', 'Gallery']]);

const GALLERY_COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 3 },
];
const LIST_COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 4 },
];

function file(entryId: string, name: string): FileEntryDto {
  return {
    entryId,
    sourceId: 's-1',
    parentId: null,
    kind: 'FILE',
    name,
    mimeType: 'image/png',
    sizeBytes: 10,
    modifiedUtcMillis: 1704067200000,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    sortName: `1${name.toLowerCase()}`,
  };
}

function ok(
  entries: FileEntryDto[],
  counts: StatusCountDto[],
): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken: null, counts },
  };
}

function scanState(snapshotId: string | null): ScanState {
  return {
    run: null,
    active:
      snapshotId == null
        ? null
        : ({ snapshotId } as unknown as ActiveSnapshotDto),
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

/**
 * Stands in for the navigator's header and tab bar: renders the header
 * buttons FilesScreen set, and `Tab bar` unless it was hidden.
 */
function NavigatorChrome(): React.JSX.Element {
  const [, setVersion] = React.useState(0);
  React.useEffect(() => {
    const listener = () => setVersion(v => v + 1);
    optionListeners.add(listener);
    return () => {
      optionListeners.delete(listener);
    };
  }, []);
  return (
    <>
      {mockOptions.tabBarStyle?.display === 'none' ? null : (
        <Text>Tab bar</Text>
      )}
      {mockOptions.headerLeft?.()}
      {mockOptions.headerRight?.()}
    </>
  );
}

function ui(focused?: boolean) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 360, height: 640 },
        insets: { top: 0, left: 0, right: 0, bottom: 0 },
      }}
    >
      <PaperProvider>
        <FilesProvider>
          <SelectionProvider>
            <NavigatorChrome />
            <FilesScreen focused={focused} />
          </SelectionProvider>
        </FilesProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

function storedPreferences(preferences: BrowsePreferencesDto) {
  getBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
    preferences,
  });
}

/** Opens the view drop-down and picks [target] (`Gallery` or `List`). */
function pickView(target: 'Gallery' | 'List') {
  fireEvent.press(screen.getByLabelText(/^View: /));
  fireEvent.press(screen.getByLabelText(target));
}

/** Opens the sort drop-down and picks the option with [text]. */
function pickSort(text: string) {
  fireEvent.press(screen.getByLabelText(/^Sort: /));
  fireEvent.press(screen.getByLabelText(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  storedPreferences({
    view: 'GALLERY',
    gallerySort: 'TIME_DESC',
    listSort: 'NAME_ASC',
  });
  setBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
  });
  mockOptions = {};
  mockNavigation.setOptions.mockImplementation((next: HeaderOptions) => {
    mockOptions = { ...mockOptions, ...next };
    optionListeners.forEach(listener => listener());
  });
  useScanMock.mockReturnValue(scanState('snap-1'));
  useSourceAliasesMock.mockReturnValue(ALIASES);
  getLocalImageHandleMock.mockResolvedValue({
    contractVersion: 4,
    status: 'ok',
    handle: { uri: 'file:///cache/t.jpg' },
  });
  queryFilesMock.mockImplementation(async snapshotId =>
    ok([file(`${snapshotId}-e1`, `${snapshotId}.png`)], GALLERY_COUNTS),
  );
  queryTreeChildrenMock.mockImplementation(async () => ok([], LIST_COUNTS));
  // Without an index both views page linearly (007 research R7).
  getScrollIndexMock.mockResolvedValue({
    contractVersion: 6,
    status: 'error',
    error: { code: 'INTERNAL_ERROR', message: 'No index.', action: null },
  });
});

describe('FilesScreen', () => {
  it('opens on the gallery, with the gallery counts on the chips', async () => {
    render(ui());

    expect(await screen.findByLabelText('View: Gallery')).toBeOnTheScreen();
    expect(screen.getByLabelText('Sort: Date, newest first')).toBeOnTheScreen();
    expect(await screen.findByLabelText('Filter All, 6')).toBeSelected();
    expect(screen.getByTestId('files-gallery')).toBeVisible();
    expect(screen.getByTestId('files-list', HIDDEN)).not.toBeVisible();
    expect(screen.getByLabelText('snap-1.png, Synced')).toBeVisible();
  });

  it('keeps the filter across a view switch, each view with its own counts (FR-003)', async () => {
    render(ui());
    fireEvent.press(await screen.findByLabelText('Filter Synced, 3'));
    await waitFor(() =>
      expect(queryFilesMock).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ filter: 'SYNCED', view: 'GALLERY' }),
        null,
      ),
    );

    pickView('List');
    expect(screen.getByTestId('files-list')).toBeVisible();
    expect(screen.getByTestId('files-gallery', HIDDEN)).not.toBeVisible();
    expect(await screen.findByLabelText('Filter All, 7')).not.toBeSelected();
    expect(screen.getByLabelText('Filter Synced, 3')).toBeSelected();
    expect(screen.getByLabelText('Folder Gallery, 3 matching')).toBeVisible();

    pickView('Gallery');
    expect(await screen.findByLabelText('Filter All, 6')).not.toBeSelected();
    expect(screen.getByLabelText('Filter Synced, 3')).toBeSelected();
    expect(screen.getByTestId('files-gallery')).toBeVisible();
  });

  it('shows "Results updated" once when the snapshot changes', async () => {
    const { rerender } = render(ui());
    await screen.findByLabelText('snap-1.png, Synced');
    expect(screen.queryByText('Results updated')).toBeNull();

    useScanMock.mockReturnValue(scanState('snap-2'));
    rerender(ui());

    expect(await screen.findByLabelText('snap-2.png, Synced')).toBeVisible();
    expect(await screen.findByLabelText('Results updated')).toBeOnTheScreen();
    expect(screen.getAllByText('Results updated')).toHaveLength(1);
    expect(screen.queryByLabelText('snap-1.png, Synced')).toBeNull();
  });

  it('holds the snackbar until the tab is focused', async () => {
    const { rerender } = render(ui(false));
    await screen.findByLabelText('snap-1.png, Synced');

    useScanMock.mockReturnValue(scanState('snap-2'));
    rerender(ui(false));
    await screen.findByLabelText('snap-2.png, Synced');
    await act(async () => {});
    expect(screen.queryByText('Results updated')).toBeNull();

    rerender(ui(true));
    expect(await screen.findByLabelText('Results updated')).toBeOnTheScreen();
  });

  it('shows no snackbar on the first snapshot', async () => {
    useScanMock.mockReturnValue(scanState(null));
    const { rerender } = render(ui());
    expect(screen.getByLabelText('No scan results yet')).toBeOnTheScreen();

    useScanMock.mockReturnValue(scanState('snap-1'));
    rerender(ui());
    await screen.findByLabelText('snap-1.png, Synced');
    await act(async () => {});

    expect(screen.queryByText('Results updated')).toBeNull();
  });

  describe('keeps the place when results update (Story 4, research R8)', () => {
    const BANDS = [600, 600, 600, 600, 600];

    /** Letter bands of BANDS; band k starts at token `band-<k>`. */
    function bandIndex(anchorIndex: number | null): ScrollIndexResult {
      let start = 0;
      const bands = BANDS.map((count, k) => {
        const band = {
          startIndex: start,
          count,
          startToken: k === 0 ? null : `band-${k}`,
          letter: String.fromCharCode(97 + k),
        };
        start += count;
        return band;
      });
      return {
        contractVersion: 6,
        status: 'ok',
        scrollIndex: { unit: 'LETTER', totalCount: start, bands, anchorIndex },
      };
    }

    it('restores the hidden view to its anchor when its snapshot changes (sc. 4)', async () => {
      queryFilesMock.mockImplementation(async (_snapshotId, _query, token) => {
        const k = token == null ? 0 : Number(token.split('-')[1]);
        return {
          contractVersion: 6,
          status: 'ok',
          page: {
            entries: Array.from({ length: 100 }, (_, i) =>
              file(`e-${k}-${i}`, `${k}-${i}.png`),
            ),
            nextPageToken: `band-${k}-more`,
            counts: k === 0 ? GALLERY_COUNTS : null,
          },
        };
      });
      getScrollIndexMock.mockImplementation(
        async (_snapshotId, query, anchor) =>
          query.view === 'GALLERY'
            ? bandIndex(anchor == null ? null : 1203)
            : {
                contractVersion: 6,
                status: 'error',
                error: { code: 'INTERNAL_ERROR', message: 'No.', action: null },
              },
      );
      const { rerender } = render(ui());
      const grid = await screen.findByTestId('gallery-grid');
      const viewable = {
        viewableItems: Array.from({ length: 12 }, (_, i) => ({
          index: 1203 + i,
        })),
        changed: [],
      };
      fireEvent(grid, 'onViewableItemsChanged', viewable);
      await waitFor(() =>
        expect(
          (
            screen.getByTestId('gallery-grid').props.data as {
              entryId?: string;
            }[]
          )[1203]?.entryId,
        ).toBe('e-2-3'),
      );
      const rowLength =
        galleryTileSize(Dimensions.get('window').width) + density.tileGap;
      fireEvent.scroll(screen.getByTestId('gallery-grid'), {
        nativeEvent: {
          contentOffset: { x: 0, y: 401 * rowLength },
          contentSize: { width: 400, height: 1000000 },
          layoutMeasurement: { width: 400, height: 600 },
        },
      });

      pickView('List');
      useScanMock.mockReturnValue(scanState('snap-2'));
      rerender(ui());

      await waitFor(() =>
        expect(getScrollIndexMock).toHaveBeenLastCalledWith(
          'snap-2',
          expect.objectContaining({ view: 'GALLERY' }),
          { sortValue: 1704067200000, sortName: '12-3.png' },
        ),
      );
      // The hidden gallery holds its grid back until it is shown.
      await waitFor(() => {
        expect(screen.getByTestId('gallery', HIDDEN)).toBeTruthy();
        expect(screen.queryByTestId('gallery-grid', HIDDEN)).toBeNull();
      });
      expect(await screen.findByLabelText('Results updated')).toBeOnTheScreen();

      pickView('Gallery');
      expect(await screen.findByTestId('gallery-grid')).toBeVisible();
      expect(screen.getByTestId('gallery-grid').props.initialScrollIndex).toBe(
        401,
      );
    });
  });

  it('passes the a11y sweep', async () => {
    const result = render(ui());
    await screen.findByLabelText('snap-1.png, Synced');

    expect(() => a11ySweep(result)).not.toThrow();
  });
  describe('sort and view drop-downs (Story 1, FR-001, FR-003)', () => {
    it('puts the sort drop-down left of the view drop-down, both above the filter chips', async () => {
      render(ui());

      const toolbar = await screen.findByTestId('files-toolbar');
      const labels = toolbar.findAll(
        node =>
          typeof node.type === 'string' &&
          /^(Sort|View): /.test(node.props.accessibilityLabel ?? ''),
      );
      expect(labels.map(node => node.props.accessibilityLabel)).toEqual([
        'Sort: Date, newest first',
        'View: Gallery',
      ]);
      const tree = JSON.stringify(screen.toJSON());
      expect(tree.indexOf('"files-toolbar"')).toBeGreaterThan(-1);
      expect(tree.indexOf('"files-toolbar"')).toBeLessThan(
        tree.indexOf('"filter-chips"'),
      );
    });

    it('gives both dropdowns equal shares of the entire toolbar width', async () => {
      render(ui());
      await screen.findByTestId('files-toolbar');
      for (const id of ['files-sort', 'files-view']) {
        expect(screen.getByTestId(`${id}-control`)).toHaveStyle({
          flex: 1,
          minWidth: 0,
        });
        expect(screen.getByTestId(`${id}-container-outer-layer`)).toHaveStyle({
          width: '100%',
        });
      }
      pickView('List');
      for (const id of ['files-sort', 'files-view']) {
        expect(screen.getByTestId(`${id}-control`)).toHaveStyle({
          flex: 1,
          minWidth: 0,
        });
        expect(screen.getByTestId(`${id}-container-outer-layer`)).toHaveStyle({
          width: '100%',
        });
      }
    });

    it('passes the a11y sweep with each drop-down open, in both views (FR-017)', async () => {
      const result = render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      fireEvent.press(screen.getByLabelText('Sort: Date, newest first'));
      await waitFor(() =>
        expect(screen.getByLabelText('Size (largest first)')).toBeOnTheScreen(),
      );
      expect(() => a11ySweep(result)).not.toThrow();
      fireEvent.press(screen.getByLabelText('Date (newest first)'));

      fireEvent.press(screen.getByLabelText('View: Gallery'));
      expect(() => a11ySweep(result)).not.toThrow();
      fireEvent.press(await screen.findByLabelText('List'));

      expect(await screen.findByLabelText('View: List')).toBeOnTheScreen();
      expect(screen.getByLabelText('Sort: Name, A to Z')).toBeOnTheScreen();
      expect(() => a11ySweep(result)).not.toThrow();
    });

    it('mounts the views only after the remembered choices are read', async () => {
      let resolve: (preferences: BrowsePreferencesDto) => void = () => {};
      getBrowsePreferencesMock.mockReturnValue(
        new Promise(r => {
          resolve = preferences =>
            r({ contractVersion: 6, status: 'ok', preferences });
        }),
      );
      render(ui());

      expect(screen.queryByTestId('files-gallery', HIDDEN)).toBeNull();
      expect(screen.queryByTestId('files-list', HIDDEN)).toBeNull();
      expect(queryFilesMock).not.toHaveBeenCalled();

      await act(async () =>
        resolve({
          view: 'GALLERY',
          gallerySort: 'SIZE_DESC',
          listSort: 'NAME_ASC',
        }),
      );

      await screen.findByLabelText('snap-1.png, Synced');
      expect(queryFilesMock).toHaveBeenCalledTimes(1);
      expect(queryFilesMock).toHaveBeenCalledWith(
        'snap-1',
        expect.objectContaining({ view: 'GALLERY', sort: 'SIZE_DESC' }),
        null,
      );
    });

    it('opens in the remembered view, each view with its remembered sort', async () => {
      storedPreferences({
        view: 'LIST',
        gallerySort: 'SIZE_DESC',
        listSort: 'SIZE_ASC',
      });
      render(ui());

      expect(await screen.findByLabelText('View: List')).toBeOnTheScreen();
      expect(
        screen.getByLabelText('Sort: Size, smallest first'),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('files-list')).toBeVisible();
      expect(await screen.findByLabelText('Filter All, 7')).toBeSelected();

      pickView('Gallery');
      expect(
        screen.getByLabelText('Sort: Size, largest first'),
      ).toBeOnTheScreen();
    });

    it("edits the visible view's sort only, keeps each view's sort across a switch, and stores it", async () => {
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      pickSort('Size (largest first)');
      expect(
        screen.getByLabelText('Sort: Size, largest first'),
      ).toBeOnTheScreen();
      expect(setBrowsePreferencesMock).toHaveBeenLastCalledWith({
        gallerySort: 'SIZE_DESC',
      });
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ view: 'GALLERY', sort: 'SIZE_DESC' }),
          null,
        ),
      );

      pickView('List');
      expect(setBrowsePreferencesMock).toHaveBeenLastCalledWith({
        view: 'LIST',
      });
      expect(screen.getByLabelText('Sort: Name, A to Z')).toBeOnTheScreen();
      pickSort('Name (Z–A)');
      expect(setBrowsePreferencesMock).toHaveBeenLastCalledWith({
        listSort: 'NAME_DESC',
      });

      pickView('Gallery');
      expect(
        screen.getByLabelText('Sort: Size, largest first'),
      ).toBeOnTheScreen();
      pickView('List');
      expect(screen.getByLabelText('Sort: Name, Z to A')).toBeOnTheScreen();
    });

    it('keeps the filter when the sort changes, and the sort when the filter changes (sc. 5)', async () => {
      render(ui());
      fireEvent.press(await screen.findByLabelText('Filter Synced, 3'));

      pickSort('Date (oldest first)');
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ filter: 'SYNCED', sort: 'TIME_ASC' }),
          null,
        ),
      );
      expect(await screen.findByLabelText('Filter Synced, 3')).toBeSelected();

      fireEvent.press(screen.getByLabelText('Filter All, 6'));
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ filter: 'ALL', sort: 'TIME_ASC' }),
          null,
        ),
      );
      expect(
        screen.getByLabelText('Sort: Date, oldest first'),
      ).toBeOnTheScreen();
    });

    it("keeps the list's folder across a view switch (sc. 8)", async () => {
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      pickView('List');
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 7 matching'),
      );
      expect(
        await screen.findByLabelText('Breadcrumb Gallery'),
      ).toBeOnTheScreen();

      pickView('Gallery');
      pickView('List');

      expect(screen.getByLabelText('Breadcrumb Gallery')).toBeVisible();
    });
  });

  describe('before any completed scan (FR-008)', () => {
    it('explains that results appear after a scan and leads to the Scan tab', () => {
      useScanMock.mockReturnValue(scanState(null));
      render(ui());

      const empty = screen.getByLabelText('No scan results yet');
      expect(empty).toBeOnTheScreen();
      expect(
        screen.getByText('Results appear after a scan.'),
      ).toBeOnTheScreen();
      expect(screen.queryByLabelText(/^View: /)).toBeNull();
      expect(screen.queryByLabelText(/^Sort: /)).toBeNull();

      fireEvent.press(screen.getByLabelText('Go to Scan'));

      expect(mockNavigation.navigate).toHaveBeenCalledWith('Scan');
    });

    it('shows nothing of it while the scan state is still loading', () => {
      useScanMock.mockReturnValue({ ...scanState(null), loading: true });
      render(ui());

      expect(screen.queryByLabelText('Go to Scan')).toBeNull();
      expect(screen.queryByText('Results appear after a scan.')).toBeNull();
    });

    it('shows nothing of it once results exist', async () => {
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      expect(screen.queryByLabelText('Go to Scan')).toBeNull();
      expect(screen.queryByText('Results appear after a scan.')).toBeNull();
    });
  });

  describe('selection mode (FR-015, FR-016)', () => {
    async function startSelecting() {
      const result = render(ui());
      fireEvent(
        await screen.findByLabelText('snap-1.png, Synced'),
        'longPress',
      );
      await screen.findByLabelText('snap-1.png, Synced, selected');
      return result;
    }

    it('shows no selection chrome before anything is selected', async () => {
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');

      expect(screen.getByText('Tab bar')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Clear selection')).toBeNull();
      expect(screen.queryByLabelText('Select all')).toBeNull();
      expect(screen.queryByTestId('selection-bar')).toBeNull();
    });

    it('hides the tabs, shows ✕ and Select all and the selection bar on a long-press', async () => {
      await startSelecting();

      expect(screen.queryByText('Tab bar')).toBeNull();
      expect(mockOptions.tabBarStyle).toEqual({ display: 'none' });
      expect(screen.getByLabelText('Clear selection')).toBeOnTheScreen();
      expect(screen.getByLabelText('Select all')).toBeEnabled();
      expect(
        screen.getByLabelText('Selection 1 selected, 10 B'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Delete selected')).toBeOnTheScreen();
    });

    it('clears with ✕ and restores the tabs and the header', async () => {
      await startSelecting();

      fireEvent.press(screen.getByLabelText('Clear selection'));

      expect(await screen.findByText('Tab bar')).toBeOnTheScreen();
      expect(mockOptions.tabBarStyle).toBeUndefined();
      expect(mockOptions.headerLeft).toBeUndefined();
      expect(mockOptions.headerRight).toBeUndefined();
      expect(screen.queryByTestId('selection-bar')).toBeNull();
      expect(screen.getByLabelText('snap-1.png, Synced')).not.toBeSelected();
    });

    it('clears on back while selecting, and leaves back alone otherwise', async () => {
      const added = jest.spyOn(BackHandler, 'addEventListener');
      render(ui());
      await screen.findByLabelText('snap-1.png, Synced');
      expect(added).not.toHaveBeenCalled();

      fireEvent(screen.getByLabelText('snap-1.png, Synced'), 'longPress');
      await screen.findByLabelText('snap-1.png, Synced, selected');
      expect(added).toHaveBeenLastCalledWith(
        'hardwareBackPress',
        expect.any(Function),
      );
      const handler = added.mock.calls.at(-1)?.[1] as
        | (() => boolean | null | undefined)
        | undefined;
      const subscription = added.mock.results.at(-1)?.value as {
        remove: () => void;
      };
      const removed = jest.spyOn(subscription, 'remove');

      let handled: boolean | null | undefined;
      act(() => {
        handled = handler?.();
      });

      expect(handled).toBe(true);
      expect(await screen.findByText('Tab bar')).toBeOnTheScreen();
      expect(screen.queryByTestId('selection-bar')).toBeNull();
      expect(removed).toHaveBeenCalled();
      added.mockRestore();
    });

    it('selects every image under the filter in the gallery, with an exact total', async () => {
      listSelectableEntriesMock.mockResolvedValue({
        contractVersion: 4,
        status: 'ok',
        selectable: {
          entryIds: ['snap-1-e1', 'e-2', 'e-3'],
          sizes: [10, 20, null],
          statuses: ['SYNCED', 'SYNCED', 'UNSYNCED'],
          images: [true, true, true],
        },
      });
      await startSelecting();

      fireEvent.press(screen.getByLabelText('Select all'));

      expect(
        await screen.findByLabelText('Selection 3 selected, 30 B'),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText('Selection details 1 of unknown size'),
      ).toBeOnTheScreen();
      expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', {
        filter: 'ALL',
        view: 'GALLERY',
        sort: 'TIME_DESC',
        pageSize: 100,
      });
    });

    it('keeps the selection across a view switch; Select all is disabled at the sources level and covers the open folder', async () => {
      listSelectableEntriesMock.mockResolvedValue({
        contractVersion: 4,
        status: 'ok',
        selectable: {
          entryIds: ['l-1'],
          sizes: [5],
          statuses: ['UNSYNCED'],
          images: [false],
        },
      });
      await startSelecting();

      pickView('List');
      expect(
        screen.getByLabelText('Selection 1 selected, 10 B'),
      ).toBeOnTheScreen();
      await waitFor(() =>
        expect(screen.getByLabelText('Select all')).toBeDisabled(),
      );

      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 7 matching'),
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Select all')).toBeEnabled(),
      );
      expect(
        screen.getByLabelText('Selection 1 selected, 10 B'),
      ).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Select all'));

      expect(
        await screen.findByLabelText('Selection 2 selected, 15 B'),
      ).toBeOnTheScreen();
      expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', {
        filter: 'ALL',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId: 's-1',
        parentId: null,
        pageSize: 100,
      });
    });

    it('says how many selected files the filter hides', async () => {
      await startSelecting();

      fireEvent.press(screen.getByLabelText('Filter Unsynced, 3'));

      expect(
        await screen.findByLabelText('Selection details 1 hidden by filter'),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText('Selection 1 selected, 10 B'),
      ).toBeOnTheScreen();
    });

    it('clears with a snackbar when a new scan result replaces the snapshot', async () => {
      const { rerender } = await startSelecting();

      useScanMock.mockReturnValue(scanState('snap-2'));
      rerender(ui());

      expect(
        await screen.findByLabelText(
          'Results were updated, so the selection was cleared.',
        ),
      ).toBeOnTheScreen();
      expect(screen.queryByTestId('selection-bar')).toBeNull();
      expect(await screen.findByText('Tab bar')).toBeOnTheScreen();
    });

    it('deletes the selection through the delete dialog and reloads page 1 in place', async () => {
      prepareLocalDeletionMock.mockResolvedValue({
        contractVersion: 5,
        status: 'ok',
        plan: {
          planToken: 'tok-1',
          toDelete: { count: 1, bytes: 10 },
          unsynced: { count: 0, bytes: 0 },
          refused: { count: 0, scanTooOld: 0 },
          movedByRecheck: 0,
          missing: 0,
          unknownSizeCount: 0,
          remoteListedAtMillis: Date.now(),
        },
      });
      executeLocalDeletionMock.mockResolvedValue({
        contractVersion: 5,
        status: 'ok',
        result: {
          deleted: 1,
          freedBytes: 10,
          failures: [],
          removedEntryIds: ['snap-1-e1'],
        },
      });
      await startSelecting();
      fireEvent.press(screen.getByLabelText('Filter Synced, 3'));
      await screen.findByLabelText('snap-1.png, Synced, selected');
      const readsBefore = queryFilesMock.mock.calls.length;
      queryFilesMock.mockImplementation(async () => ok([], GALLERY_COUNTS));

      fireEvent.press(screen.getByLabelText('Delete selected'));

      expect(prepareLocalDeletionMock).toHaveBeenCalledWith('snap-1', [
        'snap-1-e1',
      ]);
      await screen.findByLabelText('Delete 1 backed-up files, 10 B');
      expect(screen.queryByLabelText('Delete selected')).toBeNull();
      fireEvent.press(screen.getByLabelText('Delete'));

      expect(
        await screen.findByLabelText('Deleted 1 files, freed 10 B'),
      ).toBeOnTheScreen();
      expect(executeLocalDeletionMock).toHaveBeenCalledWith('tok-1', false);
      // The deleted file left the selection, which ended selection mode.
      await waitFor(() =>
        expect(screen.queryByTestId('selection-bar')).toBeNull(),
      );
      expect(await screen.findByText('Tab bar')).toBeOnTheScreen();
      // Page 1 was read again for the same snapshot and filter, and no
      // "Results updated" notice was raised for it.
      await waitFor(() =>
        expect(queryFilesMock.mock.calls.length).toBeGreaterThan(readsBefore),
      );
      const [snapshotId, query, pageToken] = queryFilesMock.mock.lastCall ?? [];
      expect(snapshotId).toBe('snap-1');
      expect(query).toEqual(expect.objectContaining({ filter: 'SYNCED' }));
      expect(pageToken).toBeNull();
      expect(screen.queryByLabelText('snap-1.png, Synced')).toBeNull();
      expect(screen.queryByLabelText('Results updated')).toBeNull();

      fireEvent.press(screen.getByLabelText('Done'));
      await waitFor(() =>
        expect(
          screen.queryByLabelText('Deleted 1 files, freed 10 B'),
        ).toBeNull(),
      );
    });

    it('passes the a11y sweep while selecting', async () => {
      const result = await startSelecting();

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });

  describe('selectAllQuery', () => {
    it('is null at the list sources level', () => {
      expect(selectAllQuery('LIST', 'SYNCED', null)).toBeNull();
    });

    it('covers the open folder in the list', () => {
      expect(
        selectAllQuery('LIST', 'SYNCED', { sourceId: 's-1', parentId: 'd-1' }),
      ).toEqual({
        filter: 'SYNCED',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId: 's-1',
        parentId: 'd-1',
        pageSize: 100,
      });
    });
  });
});
