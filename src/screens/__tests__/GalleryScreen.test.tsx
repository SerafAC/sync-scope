import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { Dimensions, FlatList } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import { FilesProvider } from '../../files/FilesProvider';
import { FilterChips } from '../../files/FilterChips';
import { SortMenu } from '../../files/SortMenu';
import { useFiles } from '../../files/useFiles';
import { galleryTileSize } from '../../files/GalleryTile';
import type { FilesViewProps } from '../../files/FilesViewParts';
import {
  getBrowsePreferences,
  getLocalImageHandle,
  getScrollIndex,
  queryFiles,
  setBrowsePreferences,
} from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  type FileEntryDto,
  type QueryFilesResult,
  type ScrollBandDto,
  type ScrollIndexResult,
  type StatusCountDto,
} from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import { SelectionProvider } from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { density } from '../../theme/spacing';
import { GalleryScreen } from '../GalleryScreen';

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  queryFiles: jest.fn(),
  getScrollIndex: jest.fn(),
  getLocalImageHandle: jest.fn(),
}));

const getScrollIndexMock = getScrollIndex as jest.MockedFunction<
  typeof getScrollIndex
>;

const queryFilesMock = queryFiles as jest.MockedFunction<typeof queryFiles>;
const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;
const setBrowsePreferencesMock = setBrowsePreferences as jest.MockedFunction<
  typeof setBrowsePreferences
>;

/** The Files toolbar's sort drop-down, as FilesScreen wires it for the gallery. */
function GallerySort(): React.JSX.Element {
  const { sorts, setSort } = useFiles();
  return (
    <SortMenu
      onChange={sort => setSort('GALLERY', sort)}
      sort={sorts.GALLERY}
    />
  );
}
const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

const COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 3 },
];

function file(
  entryId: string,
  name: string,
  overrides: Partial<FileEntryDto> = {},
): FileEntryDto {
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
    ...overrides,
  };
}

function page(
  entries: FileEntryDto[],
  nextPageToken: string | null = null,
  counts: StatusCountDto[] | null = COUNTS,
): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken, counts },
  };
}

const ALIASES = new Map([
  ['s-1', 'Gallery'],
  ['s-2', 'GalleryTwin'],
]);

function scanState(snapshotId: string | null): ScanState {
  return {
    run: null,
    active:
      snapshotId == null
        ? null
        : ({ snapshotId } as unknown as ScanState['active']),
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

function renderGallery(overrides: Partial<FilesViewProps> = {}) {
  const props: FilesViewProps = {
    snapshotId: 'snap-1',
    scanLoading: false,
    aliases: ALIASES,
    onCountsChange: jest.fn(),
    onSnapshotChange: jest.fn(),
    ...overrides,
  };
  const ui = (p: FilesViewProps) => (
    <PaperProvider>
      <ScanContext.Provider value={scanState(p.snapshotId)}>
        <FilesProvider>
          <SelectionProvider>
            <GallerySort />
            <FilterChips counts={null} />
            <GalleryScreen {...p} />
          </SelectionProvider>
        </FilesProvider>
      </ScanContext.Provider>
    </PaperProvider>
  );
  const result = render(ui(props));
  return {
    ...result,
    props,
    rerenderWith: (next: Partial<FilesViewProps>) =>
      result.rerender(ui({ ...props, ...next })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Without an index the gallery pages linearly, as before 007 (research R7).
  getScrollIndexMock.mockResolvedValue({
    contractVersion: 6,
    status: 'error',
    error: {
      code: CloudSyncErrorCode.INTERNAL_ERROR,
      message: 'No index.',
      action: null,
    },
  });
  getBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
    preferences: {
      view: 'GALLERY',
      gallerySort: 'TIME_DESC',
      listSort: 'NAME_ASC',
    },
  });
  setBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
  });
  getLocalImageHandleMock.mockResolvedValue({
    contractVersion: 4,
    status: 'ok',
    handle: { uri: 'file:///cache/t.jpg' },
  });
});

describe('GalleryScreen', () => {
  it('reads the gallery newest first under the shared filter and reports the counts', async () => {
    queryFilesMock.mockResolvedValue(
      page([
        file('e-1', 'beach.png'),
        file('e-2', 'sunset.png', {
          sourceId: 's-2',
          status: 'UNSYNCED',
          nameInOtherSource: true,
        }),
      ]),
    );
    const { props } = renderGallery();

    expect(
      await screen.findByLabelText('sunset.png, Unsynced, from GalleryTwin'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('beach.png, Synced')).toBeOnTheScreen();
    expect(screen.getByLabelText('Origin GalleryTwin')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenCalledWith(
      'snap-1',
      { filter: 'ALL', view: 'GALLERY', sort: 'TIME_DESC', pageSize: 100 },
      null,
    );
    expect(props.onCountsChange).toHaveBeenLastCalledWith(COUNTS);
  });

  it('reads again with the new filter when a chip is pressed', async () => {
    queryFilesMock.mockResolvedValue(page([file('e-1', 'beach.png')]));
    renderGallery();
    await screen.findByLabelText('beach.png, Synced');

    fireEvent.press(screen.getByLabelText('Filter Synced'));

    await waitFor(() =>
      expect(queryFilesMock).toHaveBeenLastCalledWith(
        'snap-1',
        {
          filter: 'SYNCED',
          view: 'GALLERY',
          sort: 'TIME_DESC',
          pageSize: 100,
        },
        null,
      ),
    );
    expect(await screen.findByLabelText('beach.png, Synced')).toBeOnTheScreen();
  });

  it('loads the next page when the end is reached', async () => {
    queryFilesMock
      .mockResolvedValueOnce(page([file('e-1', 'a.png')], 'token-2'))
      .mockResolvedValueOnce(page([file('e-2', 'b.png')], null, null));
    renderGallery();
    await screen.findByLabelText('a.png, Synced');

    fireEvent(screen.getByTestId('gallery-grid'), 'onEndReached');

    expect(await screen.findByLabelText('b.png, Synced')).toBeOnTheScreen();
    expect(screen.getByLabelText('a.png, Synced')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ view: 'GALLERY' }),
      'token-2',
    );
  });

  it('shows the loading indicator during the first load', async () => {
    queryFilesMock.mockReturnValue(new Promise(() => {}));
    renderGallery();

    expect(screen.getByLabelText('Loading files')).toBeOnTheScreen();
  });

  it('shows the empty state when page 1 is empty', async () => {
    queryFilesMock.mockResolvedValue(page([]));
    renderGallery();

    expect(
      await screen.findByText('No files match this filter'),
    ).toBeOnTheScreen();
  });

  it('shows the no-snapshot state, and reads nothing', async () => {
    const { props } = renderGallery({ snapshotId: null });

    expect(screen.getByText('No scan results yet')).toBeOnTheScreen();
    expect(queryFilesMock).not.toHaveBeenCalled();
    expect(props.onCountsChange).toHaveBeenLastCalledWith(null);
  });

  it('shows loading, not the no-snapshot state, while the scan state is unknown', () => {
    renderGallery({ snapshotId: null, scanLoading: true });

    expect(screen.getByLabelText('Loading files')).toBeOnTheScreen();
    expect(screen.queryByText('No scan results yet')).toBeNull();
  });

  it('shows the error with its action, and Retry reads again', async () => {
    queryFilesMock.mockResolvedValueOnce({
      contractVersion: 4,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.INTERNAL_ERROR,
        message: 'Something went wrong.',
        action: 'Try again.',
      },
    });
    queryFilesMock.mockResolvedValueOnce(page([file('e-1', 'beach.png')]));
    renderGallery();

    expect(
      await screen.findByText('Something went wrong. Try again.'),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Retry'));

    expect(await screen.findByLabelText('beach.png, Synced')).toBeOnTheScreen();
    expect(queryFilesMock).toHaveBeenCalledTimes(2);
  });

  it('reports a snapshot change once, after the rows were replaced', async () => {
    queryFilesMock.mockResolvedValueOnce(page([file('e-1', 'old.png')]));
    const { props, rerenderWith } = renderGallery();
    await screen.findByLabelText('old.png, Synced');

    queryFilesMock.mockResolvedValueOnce(page([file('e-9', 'new.png')]));
    rerenderWith({ snapshotId: 'snap-2' });

    expect(await screen.findByLabelText('new.png, Synced')).toBeOnTheScreen();
    expect(screen.queryByLabelText('old.png, Synced')).toBeNull();
    await waitFor(() =>
      expect(props.onSnapshotChange).toHaveBeenCalledTimes(1),
    );
  });

  it('passes the a11y sweep', async () => {
    queryFilesMock.mockResolvedValue(
      page([file('e-1', 'sunset.png', { nameInOtherSource: true })]),
    );
    const result = renderGallery();
    await screen.findByLabelText('sunset.png, Synced, from Gallery');

    expect(() => a11ySweep(result)).not.toThrow();
  });

  describe('sort (Story 1, FR-003)', () => {
    it("puts the gallery's sort into the query spec", async () => {
      queryFilesMock.mockResolvedValue(page([file('e-1', 'beach.png')]));
      getBrowsePreferencesMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        preferences: {
          view: 'GALLERY',
          gallerySort: 'SIZE_DESC',
          listSort: 'NAME_ASC',
        },
      });
      renderGallery();

      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          {
            filter: 'ALL',
            view: 'GALLERY',
            sort: 'SIZE_DESC',
            pageSize: 100,
          },
          null,
        ),
      );
      expect(
        await screen.findByLabelText('beach.png, Synced'),
      ).toBeOnTheScreen();
    });

    it('a sort change reloads from page 1 and keeps the filter and the selection', async () => {
      queryFilesMock.mockImplementation(async (_, query, token) =>
        query.sort === 'SIZE_DESC'
          ? page([file('e-2', 'b.png'), file('e-1', 'a.png')])
          : token == null
          ? page([file('e-1', 'a.png')], 'token-2')
          : page([file('e-2', 'b.png')], null, null),
      );
      renderGallery();
      await screen.findByLabelText('a.png, Synced');
      fireEvent(screen.getByTestId('gallery-grid'), 'onEndReached');
      await screen.findByLabelText('b.png, Synced');
      fireEvent.press(screen.getByLabelText('Filter Synced'));
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ filter: 'SYNCED', sort: 'TIME_DESC' }),
          null,
        ),
      );
      fireEvent(await screen.findByLabelText('a.png, Synced'), 'longPress');
      await screen.findByLabelText('a.png, Synced, selected');

      queryFilesMock.mockClear();
      fireEvent.press(screen.getByLabelText('Sort: Date, newest first'));
      fireEvent.press(screen.getByLabelText('Size (largest first)'));

      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenCalledWith(
          'snap-1',
          {
            filter: 'SYNCED',
            view: 'GALLERY',
            sort: 'SIZE_DESC',
            pageSize: 100,
          },
          null,
        ),
      );
      expect(queryFilesMock).toHaveBeenCalledTimes(1);
      expect(
        await screen.findByLabelText('a.png, Synced, selected'),
      ).toBeSelected();
      expect(screen.getByLabelText('b.png, Synced')).not.toBeSelected();
      expect(screen.getByLabelText('Filter Synced')).toBeSelected();
      expect(setBrowsePreferencesMock).toHaveBeenCalledWith({
        gallerySort: 'SIZE_DESC',
      });
    });
  });

  describe('selection (FR-015, FR-017)', () => {
    beforeEach(() => {
      queryFilesMock.mockResolvedValue(
        page([
          file('e-1', 'beach.png'),
          file('e-2', 'sunset.png'),
          file('e-3', 'harbor.png', { status: 'UNSYNCED' }),
        ]),
      );
    });

    it('does nothing on a tap before anything is selected', async () => {
      renderGallery();
      fireEvent.press(await screen.findByLabelText('beach.png, Synced'));

      expect(screen.getByLabelText('beach.png, Synced')).not.toBeSelected();
      expect(screen.queryByLabelText(/, selected$/)).toBeNull();
    });

    it('starts the selection on a long-press, then toggles tiles on a tap', async () => {
      renderGallery();
      fireEvent(await screen.findByLabelText('beach.png, Synced'), 'longPress');

      expect(
        await screen.findByLabelText('beach.png, Synced, selected'),
      ).toBeSelected();
      expect(screen.getByLabelText('sunset.png, Synced')).not.toBeSelected();

      fireEvent.press(screen.getByLabelText('sunset.png, Synced'));
      expect(
        await screen.findByLabelText('sunset.png, Synced, selected'),
      ).toBeSelected();

      fireEvent.press(screen.getByLabelText('beach.png, Synced, selected'));
      expect(
        await screen.findByLabelText('beach.png, Synced'),
      ).not.toBeSelected();
      expect(
        screen.getByLabelText('sunset.png, Synced, selected'),
      ).toBeSelected();
    });

    it('leaves selection mode when the last tile is deselected', async () => {
      renderGallery();
      fireEvent(await screen.findByLabelText('beach.png, Synced'), 'longPress');
      fireEvent.press(
        await screen.findByLabelText('beach.png, Synced, selected'),
      );
      await screen.findByLabelText('beach.png, Synced');

      // Not selecting any more: a tap no longer selects.
      fireEvent.press(screen.getByLabelText('sunset.png, Synced'));
      expect(screen.queryByLabelText(/, selected$/)).toBeNull();
    });

    it('keeps the row layout while tiles are selected', async () => {
      renderGallery();
      fireEvent(await screen.findByLabelText('beach.png, Synced'), 'longPress');
      await screen.findByLabelText('beach.png, Synced, selected');

      const { getItemLayout } = screen.getByTestId('gallery-grid').props as {
        getItemLayout: (
          data: unknown,
          index: number,
        ) => { length: number; offset: number };
      };
      const row =
        galleryTileSize(Dimensions.get('window').width) + density.tileGap;
      expect(getItemLayout(null, 2)).toEqual(
        expect.objectContaining({ length: row, offset: 2 * row }),
      );
    });

    it('passes the a11y sweep while selecting', async () => {
      const result = renderGallery();
      fireEvent(await screen.findByLabelText('beach.png, Synced'), 'longPress');
      await screen.findByLabelText('beach.png, Synced, selected');

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });
});

/** Letter bands of the given counts; band k starts at token `band-<k>`. */
function scrollIndex(counts: number[]): ScrollIndexResult {
  let start = 0;
  const bands = counts.map((count, k): ScrollBandDto => {
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
    scrollIndex: {
      unit: 'LETTER',
      totalCount: start,
      bands,
      anchorIndex: null,
    },
  };
}

/** Files `<k>-<i>.png` of band k, read from token `band-<k>` (or null for band 0). */
function bandReader(counts: number[]) {
  return async (
    _snapshotId: string,
    _query: unknown,
    pageToken?: string | null,
  ): Promise<QueryFilesResult> => {
    const k = pageToken == null ? 0 : Number(pageToken.split('-')[1]);
    const count = Math.min(counts[k] ?? 0, 100);
    return page(
      Array.from({ length: count }, (_, i) =>
        file(`e-${k}-${i}`, `${k}-${i}.png`),
      ),
      // A band longer than a page reads on (the next page is never read here).
      (counts[k] ?? 0) > count ? `band-${k}-more` : null,
      k === 0 ? COUNTS : null,
    );
  };
}

describe('GalleryScreen with the scroll index (Story 2, research R7)', () => {
  it('requests the index with page 1 and shows placeholder tiles for bands not read yet', async () => {
    getScrollIndexMock.mockResolvedValue(scrollIndex([3, 3]));
    queryFilesMock.mockImplementation(bandReader([3, 3]));
    renderGallery();

    expect(await screen.findByLabelText('0-2.png, Synced')).toBeOnTheScreen();
    expect(await screen.findAllByLabelText('Loading file')).toHaveLength(3);
    expect(getScrollIndexMock).toHaveBeenCalledWith('snap-1', {
      filter: 'ALL',
      view: 'GALLERY',
      sort: 'TIME_DESC',
      pageSize: 100,
    });
    expect(queryFilesMock).toHaveBeenCalledTimes(1);
  });

  it('loads a band when it comes into view', async () => {
    getScrollIndexMock.mockResolvedValue(scrollIndex([3, 3]));
    queryFilesMock.mockImplementation(bandReader([3, 3]));
    renderGallery();
    await screen.findAllByLabelText('Loading file');

    fireEvent(screen.getByTestId('gallery-grid'), 'onViewableItemsChanged', {
      viewableItems: [{ index: 3 }, { index: 4 }],
      changed: [],
    });

    expect(await screen.findByLabelText('1-0.png, Synced')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading file')).toBeNull();
    expect(queryFilesMock).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ view: 'GALLERY' }),
      'band-1',
    );
  });

  it('jumps with the scrollbar: scrolls to the band and reads it', async () => {
    const counts = [600, 600, 600, 600, 600];
    getScrollIndexMock.mockResolvedValue(scrollIndex(counts));
    queryFilesMock.mockImplementation(bandReader(counts));
    const scrollToIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
    try {
      renderGallery();
      const thumb = await screen.findByTestId('files.scroller.thumb');
      expect(thumb.props.accessibilityValue).toEqual({ text: 'A' });

      fireEvent(thumb, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });

      expect(scrollToIndex).toHaveBeenCalledWith({
        index: 600 / 3,
        animated: false,
      });
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ view: 'GALLERY' }),
          'band-1',
        ),
      );
    } finally {
      scrollToIndex.mockRestore();
    }
  });

  it('starts every band on a new grid row', async () => {
    getScrollIndexMock.mockResolvedValue(scrollIndex([2, 3]));
    queryFilesMock.mockImplementation(bandReader([2, 3]));
    renderGallery();
    await screen.findByLabelText('0-1.png, Synced');

    const data = screen.getByTestId('gallery-grid').props.data as {
      entryId?: string;
      filler?: boolean;
    }[];
    expect(data).toHaveLength(6);
    expect(data[2]?.filler).toBe(true);
    expect(screen.getAllByTestId('gallery-filler')).toHaveLength(1);
  });

  it('has no scrollbar for a short result', async () => {
    getScrollIndexMock.mockResolvedValue(scrollIndex([3, 3]));
    queryFilesMock.mockImplementation(bandReader([3, 3]));
    renderGallery();
    await screen.findByLabelText('0-0.png, Synced');
    await waitFor(() =>
      expect(screen.getAllByLabelText('Loading file')).toHaveLength(3),
    );

    expect(screen.queryByTestId('files.scroller.thumb')).toBeNull();
  });

  it('reads the bands of the filtered result (Story 2 sc. 8)', async () => {
    const counts = [600, 600, 600, 600, 600];
    getScrollIndexMock.mockResolvedValue(scrollIndex(counts));
    queryFilesMock.mockImplementation(bandReader(counts));
    renderGallery();
    await screen.findByTestId('files.scroller.thumb');

    getScrollIndexMock.mockResolvedValue(scrollIndex([3]));
    fireEvent.press(screen.getByLabelText('Filter Synced'));

    await waitFor(() =>
      expect(getScrollIndexMock).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ filter: 'SYNCED' }),
      ),
    );
    await screen.findByLabelText('0-0.png, Synced');
    await waitFor(() =>
      expect(screen.queryByTestId('files.scroller.thumb')).toBeNull(),
    );
  });

  describe('keeps the place when results update (Story 4, research R8)', () => {
    const COUNTS_5 = [600, 600, 600, 600, 600];

    /** Scrolls to band 2's fourth file (cell 1203): the view records it once its band is read. */
    async function scrollToBand2() {
      const grid = await screen.findByTestId('gallery-grid');
      const viewable = {
        viewableItems: Array.from({ length: 12 }, (_, i) => ({
          index: 1203 + i,
        })),
        changed: [],
      };
      fireEvent(grid, 'onViewableItemsChanged', viewable);
      await waitFor(() =>
        expect(queryFilesMock).toHaveBeenLastCalledWith(
          'snap-1',
          expect.objectContaining({ view: 'GALLERY' }),
          'band-2',
        ),
      );
      await waitFor(() =>
        expect(
          (
            screen.getByTestId('gallery-grid').props.data as {
              entryId?: string;
            }[]
          )[1203]?.entryId,
        ).toBe('e-2-3'),
      );
      // The grid comes to rest with row 401 (cells 1203…1205) on top.
      const rowLength =
        galleryTileSize(Dimensions.get('window').width) + density.tileGap;
      fireEvent.scroll(screen.getByTestId('gallery-grid'), {
        nativeEvent: {
          contentOffset: { x: 0, y: 401 * rowLength + rowLength / 3 },
          contentSize: { width: 400, height: 1000000 },
          layoutMeasurement: { width: 400, height: 600 },
        },
      });
    }

    it.each([
      ['the noted file is still there', 1203, 401],
      ['the noted file is gone: its neighbour (sc. 2)', 1202, 400],
    ])(
      'scrolls to the anchor, not to the top, on a new snapshot: %s',
      async (_case, anchorIndex, gridRow) => {
        getScrollIndexMock.mockResolvedValue(scrollIndex(COUNTS_5));
        queryFilesMock.mockImplementation(bandReader(COUNTS_5));
        const { props, rerenderWith } = renderGallery();
        await screen.findByTestId('files.scroller.thumb');
        await scrollToBand2();

        const next = scrollIndex(COUNTS_5);
        if (next.status === 'ok') {
          next.scrollIndex.anchorIndex = anchorIndex;
        }
        getScrollIndexMock.mockResolvedValue(next);
        rerenderWith({ snapshotId: 'snap-2' });

        await waitFor(() =>
          expect(getScrollIndexMock).toHaveBeenLastCalledWith(
            'snap-2',
            expect.objectContaining({ view: 'GALLERY', sort: 'TIME_DESC' }),
            { sortValue: 1704067200000, sortName: '12-3.png' },
          ),
        );
        await waitFor(() =>
          expect(
            screen.getByTestId('gallery-grid').props.initialScrollIndex,
          ).toBe(gridRow),
        );
        expect(queryFilesMock).toHaveBeenCalledWith(
          'snap-2',
          expect.objectContaining({ view: 'GALLERY' }),
          'band-2',
        );
        await waitFor(() =>
          expect(props.onSnapshotChange).toHaveBeenCalledTimes(1),
        );
      },
    );

    it('starts at the top after a sort change: the anchor is used once', async () => {
      getScrollIndexMock.mockResolvedValue(scrollIndex(COUNTS_5));
      queryFilesMock.mockImplementation(bandReader(COUNTS_5));
      const { rerenderWith } = renderGallery();
      await screen.findByTestId('files.scroller.thumb');
      await scrollToBand2();
      const next = scrollIndex(COUNTS_5);
      if (next.status === 'ok') {
        next.scrollIndex.anchorIndex = 1203;
      }
      getScrollIndexMock.mockResolvedValueOnce(next);
      rerenderWith({ snapshotId: 'snap-2' });
      await waitFor(() =>
        expect(
          screen.getByTestId('gallery-grid').props.initialScrollIndex,
        ).toBe(401),
      );

      fireEvent.press(screen.getByLabelText(/^Sort: /));
      fireEvent.press(screen.getByLabelText('Name (A–Z)'));

      await waitFor(() =>
        expect(getScrollIndexMock).toHaveBeenLastCalledWith(
          'snap-2',
          expect.objectContaining({ sort: 'NAME_ASC' }),
        ),
      );
      await screen.findByTestId('gallery-grid');
      expect(
        screen.getByTestId('gallery-grid').props.initialScrollIndex ?? null,
      ).toBeNull();
    });
  });

  it('passes the a11y sweep with placeholders and the scrollbar', async () => {
    const counts = [600, 600, 600, 600, 600];
    getScrollIndexMock.mockResolvedValue(scrollIndex(counts));
    queryFilesMock.mockImplementation(bandReader(counts));
    const result = renderGallery();
    await screen.findByTestId('files.scroller.thumb');

    expect(() => a11ySweep(result)).not.toThrow();
  });
});
