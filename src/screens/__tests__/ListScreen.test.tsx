import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { FlatList } from 'react-native';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';

import { Button } from 'react-native-paper';

import { FilesProvider } from '../../files/FilesProvider';
import { FilterChips } from '../../files/FilterChips';
import type { FilesViewProps } from '../../files/FilesViewParts';
import { SortMenu } from '../../files/SortMenu';
import { useFiles } from '../../files/useFiles';
import {
  getBrowsePreferences,
  getScrollIndex,
  listSelectableEntries,
  queryTreeChildren,
  setBrowsePreferences,
} from '../../native/CloudSync';
import type {
  FileEntryDto,
  FileFilter,
  FileSort,
  FileStatus,
  QueryFilesResult,
  QuerySpec,
  ScrollBandDto,
  ScrollIndexResult,
  StatusCountDto,
} from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import {
  SelectionProvider,
  useSelection,
} from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { selectAllQuery } from '../FilesScreen';
import { density } from '../../theme/spacing';
import { ListScreen, formatSize, type ListFolder } from '../ListScreen';

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  listSelectableEntries: jest.fn(),
  queryTreeChildren: jest.fn(),
  getScrollIndex: jest.fn(),
}));

const getScrollIndexMock = getScrollIndex as jest.MockedFunction<
  typeof getScrollIndex
>;

const queryTreeChildrenMock = queryTreeChildren as jest.MockedFunction<
  typeof queryTreeChildren
>;
const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;
const setBrowsePreferencesMock = setBrowsePreferences as jest.MockedFunction<
  typeof setBrowsePreferences
>;
const listSelectableEntriesMock = listSelectableEntries as jest.MockedFunction<
  typeof listSelectableEntries
>;

const DIMMED = MD3LightTheme.colors.onSurfaceDisabled;

const ALIASES = new Map([
  ['s-1', 'Gallery'],
  ['s-2', 'GalleryTwin'],
]);

const SOURCE_COUNTS: Record<string, StatusCountDto[]> = {
  's-1': [
    { status: 'SYNCED', count: 3 },
    { status: 'UNSYNCED', count: 3 },
  ],
  's-2': [{ status: 'UNSYNCED', count: 1 }],
};

function entry(
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
    sizeBytes: 2048,
    modifiedUtcMillis: 1704067200000,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    sortName: `1${name.toLowerCase()}`,
    ...overrides,
  };
}

function dir(
  entryId: string,
  name: string,
  matching: Record<FileFilter, number> | null,
  filter: FileFilter,
): FileEntryDto {
  return entry(entryId, name, {
    kind: 'DIRECTORY',
    mimeType: null,
    sizeBytes: null,
    matchingFileCount: matching == null ? null : matching[filter],
  });
}

function file(entryId: string, name: string, status: FileStatus): FileEntryDto {
  return entry(entryId, name, { status });
}

function keep(filter: FileFilter, status: FileStatus): boolean {
  return (
    filter === 'ALL' ||
    (filter === 'SYNCED' && status === 'SYNCED') ||
    (filter === 'UNSYNCED' && status === 'UNSYNCED') ||
    (filter === 'ISSUES_UNKNOWN' && status === 'UNKNOWN')
  );
}

/** Children of each folder of source s-1 under [filter]. */
function children(parentId: string | null, filter: FileFilter): FileEntryDto[] {
  const files = (list: FileEntryDto[]) =>
    list.filter(e => keep(filter, e.status));
  switch (parentId) {
    case null:
      return [
        dir(
          'd-album',
          'album',
          { ALL: 2, SYNCED: 1, UNSYNCED: 1, ISSUES_UNKNOWN: 0 },
          filter,
        ),
        dir(
          'd-drafts',
          'drafts',
          { ALL: 1, SYNCED: 0, UNSYNCED: 1, ISSUES_UNKNOWN: 0 },
          filter,
        ),
        dir('d-legacy', 'legacy', null, filter),
        ...files([
          file('f-beach', 'beach.png', 'SYNCED'),
          file('f-harbor', 'harbor.png', 'UNSYNCED'),
        ]),
      ];
    case 'd-album':
      return files([
        file('f-forest', 'forest.png', 'SYNCED'),
        file('f-notes', 'notes.txt', 'UNSYNCED'),
      ]);
    case 'd-drafts':
      return files([file('f-draft', 'draft.png', 'UNSYNCED')]);
    default:
      return [];
  }
}

function ok(entries: FileEntryDto[], counts: StatusCountDto[] | null) {
  const result: QueryFilesResult = {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken: null, counts },
  };
  return result;
}

/** What the native sorts compare (research R1); enough for these fixtures. */
function compareBy(
  sort: FileSort,
): (a: FileEntryDto, b: FileEntryDto) => number {
  const byName = (a: FileEntryDto, b: FileEntryDto) =>
    a.sortName.localeCompare(b.sortName);
  switch (sort) {
    case 'NAME_DESC':
      return (a, b) => byName(b, a);
    case 'SIZE_DESC':
      return (a, b) => (b.sizeBytes ?? 0) - (a.sizeBytes ?? 0) || byName(a, b);
    case 'SIZE_ASC':
      return (a, b) => (a.sizeBytes ?? 0) - (b.sizeBytes ?? 0) || byName(a, b);
    default:
      return byName;
  }
}

/** queryTreeChildren over {@link children}: narrowed by `kind` and ordered by `sort`. */
function fakeTree(
  _snapshotId: string,
  parentId: string | null,
  query: QuerySpec,
): Promise<QueryFilesResult> {
  const sourceId = query.sourceId ?? '';
  const counts = SOURCE_COUNTS[sourceId] ?? [];
  if (query.pageSize === 1) {
    return Promise.resolve(ok([], counts));
  }
  const rows = children(parentId, query.filter)
    .filter(row => query.kind == null || row.kind === query.kind)
    .sort(compareBy(query.sort));
  return Promise.resolve(ok(rows, counts));
}

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

/** The Files toolbar's sort drop-down, as FilesScreen wires it for the list. */
function ListSort(): React.JSX.Element {
  const { sorts, setSort } = useFiles();
  return (
    <SortMenu onChange={sort => setSort('LIST', sort)} sort={sorts.LIST} />
  );
}

/** The top bar's "Select all", as FilesScreen wires it for the list. */
function SelectAllProbe({
  folder,
}: {
  folder: ListFolder | null;
}): React.JSX.Element {
  const { filter } = useFiles();
  const { selectAll } = useSelection();
  const query = selectAllQuery('LIST', filter, folder);
  return (
    <Button
      accessibilityLabel="Select all"
      onPress={() => {
        if (query != null) {
          selectAll(query);
        }
      }}
    >
      Select all
    </Button>
  );
}

function Harness(props: FilesViewProps): React.JSX.Element {
  const [folder, setFolder] = React.useState<ListFolder | null>(null);
  return (
    <>
      <ListSort />
      <SelectAllProbe folder={folder} />
      <FilterChips counts={null} />
      <ListScreen {...props} onFolderChange={setFolder} />
    </>
  );
}

function renderList(overrides: Partial<FilesViewProps> = {}) {
  const props: FilesViewProps = {
    snapshotId: 'snap-1',
    scanLoading: false,
    aliases: ALIASES,
    onCountsChange: jest.fn(),
    onSnapshotChange: jest.fn(),
    ...overrides,
  };
  const result = render(
    <PaperProvider theme={MD3LightTheme}>
      <ScanContext.Provider value={scanState(props.snapshotId)}>
        <FilesProvider>
          <SelectionProvider>
            <Harness {...props} />
          </SelectionProvider>
        </FilesProvider>
      </ScanContext.Provider>
    </PaperProvider>,
  );
  return { ...result, props };
}

beforeEach(() => {
  jest.clearAllMocks();
  getBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
    preferences: {
      view: 'LIST',
      gallerySort: 'TIME_DESC',
      listSort: 'NAME_ASC',
    },
  });
  setBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 6,
    status: 'ok',
  });
  queryTreeChildrenMock.mockImplementation(fakeTree);
  // Without an index the list pages linearly (research R7).
  getScrollIndexMock.mockResolvedValue({
    contractVersion: 6,
    status: 'error',
    error: { code: 'INTERNAL_ERROR', message: 'No index.', action: null },
  });
});

describe('formatSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [12 * 1024 * 1024, '12 MB'],
  ])('formats %d bytes as %s', (bytes, text) => {
    expect(formatSize(bytes)).toBe(text);
  });
});

describe('ListScreen', () => {
  it('lists the sources with their matching counts and reports the totals', async () => {
    const { props } = renderList();

    expect(
      await screen.findByLabelText('Folder Gallery, 6 matching'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Folder GalleryTwin, 1 matching'),
    ).toBeOnTheScreen();
    expect(queryTreeChildrenMock).toHaveBeenCalledWith(
      'snap-1',
      null,
      {
        filter: 'ALL',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId: 's-1',
        pageSize: 1,
      },
      null,
    );
    await waitFor(() =>
      expect(props.onCountsChange).toHaveBeenLastCalledWith([
        { status: 'SYNCED', count: 3 },
        { status: 'UNSYNCED', count: 4 },
      ]),
    );
  });

  it('descends into folders and comes back through the breadcrumb', async () => {
    renderList();
    fireEvent.press(await screen.findByLabelText('Folder Gallery, 6 matching'));

    expect(
      await screen.findByLabelText('Folder album, 2 matching'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb All folders')).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb Gallery')).toBeDisabled();
    expect(queryTreeChildrenMock).toHaveBeenCalledWith(
      'snap-1',
      null,
      expect.objectContaining({
        filter: 'ALL',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId: 's-1',
        pageSize: 100,
      }),
      null,
    );

    fireEvent.press(screen.getByLabelText('Folder album, 2 matching'));
    const forestRow = await screen.findByLabelText('forest.png, Synced');
    expect(forestRow).toBeOnTheScreen();
    // Android only exposes the row label when the row is one a11y node.
    expect(forestRow.props.accessible).toBe(true);
    expect(screen.getByLabelText('notes.txt, Unsynced')).toBeOnTheScreen();
    expect(queryTreeChildrenMock).toHaveBeenCalledWith(
      'snap-1',
      'd-album',
      expect.objectContaining({ sourceId: 's-1', parentId: 'd-album' }),
      null,
    );

    fireEvent.press(screen.getByLabelText('Breadcrumb Gallery'));
    expect(
      await screen.findByLabelText('Folder album, 2 matching'),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Breadcrumb All folders'));
    expect(
      await screen.findByLabelText('Folder Gallery, 6 matching'),
    ).toBeOnTheScreen();
  });

  it('dims folders with no matches, keeps them pressable, and never dims an unknown count', async () => {
    renderList();
    fireEvent.press(screen.getByLabelText('Filter Synced'));

    expect(
      await screen.findByLabelText('Folder Gallery, 3 matching'),
    ).toBeOnTheScreen();
    expect(
      screen.getByLabelText('Folder GalleryTwin, 0 matching, no matches'),
    ).toBeOnTheScreen();
    expect(screen.getByText('GalleryTwin')).toHaveStyle({ color: DIMMED });
    expect(screen.getByText('Gallery')).not.toHaveStyle({ color: DIMMED });

    fireEvent.press(screen.getByLabelText('Folder Gallery, 3 matching'));
    expect(
      await screen.findByLabelText('Folder drafts, 0 matching, no matches'),
    ).toBeOnTheScreen();
    expect(screen.getByText('drafts')).toHaveStyle({ color: DIMMED });
    expect(screen.getByLabelText('Folder album, 1 matching')).toBeOnTheScreen();
    expect(screen.getByText('album')).not.toHaveStyle({ color: DIMMED });
    // A pre-v4 directory: no count, not dimmed.
    expect(screen.getByLabelText('Folder legacy')).toBeOnTheScreen();
    expect(screen.getByText('legacy')).not.toHaveStyle({ color: DIMMED });
    expect(screen.queryByLabelText('harbor.png, Unsynced')).toBeNull();

    fireEvent.press(
      screen.getByLabelText('Folder drafts, 0 matching, no matches'),
    );
    expect(
      await screen.findByText('No files match this filter'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Breadcrumb drafts')).toBeOnTheScreen();
  });

  it('shows file rows with size, time and status, and no origin badge', async () => {
    queryTreeChildrenMock.mockImplementation((s, parentId, query) =>
      parentId === null && query.pageSize !== 1 && query.kind === 'FILE'
        ? Promise.resolve(
            ok(
              [
                entry('f-sunset', 'sunset.png', {
                  status: 'UNSYNCED',
                  nameInOtherSource: true,
                }),
              ],
              SOURCE_COUNTS['s-1'] ?? null,
            ),
          )
        : fakeTree(s, parentId, query),
    );
    renderList();
    fireEvent.press(await screen.findByLabelText('Folder Gallery, 6 matching'));

    expect(
      await screen.findByLabelText('sunset.png, Unsynced'),
    ).toBeOnTheScreen();
    expect(screen.getByText(/^2 KB · /)).toBeOnTheScreen();
    expect(
      within(screen.getByLabelText('sunset.png, Unsynced')).getByText(
        'Unsynced',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Origin /)).toBeNull();
    expect(screen.queryByLabelText(/, from /)).toBeNull();
  });

  it('shows the no-snapshot state without reading', () => {
    renderList({ snapshotId: null });

    expect(screen.getByText('No scan results yet')).toBeOnTheScreen();
    expect(queryTreeChildrenMock).not.toHaveBeenCalled();
  });

  it('passes the a11y sweep at both levels', async () => {
    const result = renderList();
    await screen.findByLabelText('Folder Gallery, 6 matching');
    expect(() => a11ySweep(result)).not.toThrow();

    fireEvent.press(screen.getByLabelText('Folder Gallery, 6 matching'));
    await screen.findByLabelText('beach.png, Synced');
    expect(() => a11ySweep(result)).not.toThrow();
  });

  describe('folders first, files in the chosen sort (Story 1 sc. 4, FR-004, research R3)', () => {
    /** Source s-1's root: two folders and three files of different sizes. */
    function sizedRoot(query: QuerySpec): FileEntryDto[] {
      const rows = [
        dir('d-zoo', 'zoo', null, 'ALL'),
        dir('d-album', 'album', null, 'ALL'),
        entry('f-small', 'small.png', { sizeBytes: 10 }),
        entry('f-big', 'big.png', { sizeBytes: 5000 }),
        entry('f-mid', 'mid.png', { sizeBytes: 300 }),
      ];
      return rows
        .filter(row => query.kind == null || row.kind === query.kind)
        .sort(compareBy(query.sort));
    }

    beforeEach(() => {
      queryTreeChildrenMock.mockImplementation((s, parentId, query) =>
        parentId === null && query.pageSize !== 1
          ? Promise.resolve(ok(sizedRoot(query), SOURCE_COUNTS['s-1'] ?? null))
          : fakeTree(s, parentId, query),
      );
    });

    function rowLabels(): string[] {
      return screen
        .getAllByLabelText(/^(Folder |[a-z]+\.png, )/)
        .map(node => node.props.accessibilityLabel as string)
        .filter(label => !label.startsWith('Folder Gallery'));
    }

    async function openGallery() {
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );
      await screen.findByLabelText('small.png, Synced');
    }

    function pickSort(text: string) {
      fireEvent.press(screen.getByLabelText(/^Sort: /));
      fireEvent.press(screen.getByLabelText(text));
    }

    it('reads the subfolders by name, then the files in the list sort', async () => {
      renderList();
      await openGallery();

      const reads = queryTreeChildrenMock.mock.calls.filter(
        ([, , query]) => query.pageSize !== 1,
      );
      expect(reads.map(([, parentId, query]) => [parentId, query])).toEqual([
        [
          null,
          {
            filter: 'ALL',
            view: 'LIST',
            sort: 'NAME_ASC',
            sourceId: 's-1',
            parentId: null,
            kind: 'DIRECTORY',
            pageSize: 100,
          },
        ],
        [
          null,
          {
            filter: 'ALL',
            view: 'LIST',
            sort: 'NAME_ASC',
            sourceId: 's-1',
            parentId: null,
            kind: 'FILE',
            pageSize: 100,
          },
        ],
      ]);
      expect(rowLabels()).toEqual([
        'Folder album',
        'Folder zoo',
        'big.png, Synced',
        'mid.png, Synced',
        'small.png, Synced',
      ]);
    });

    it('keeps the folders above the files under SIZE_DESC', async () => {
      getBrowsePreferencesMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        preferences: {
          view: 'LIST',
          gallerySort: 'TIME_DESC',
          listSort: 'SIZE_DESC',
        },
      });
      renderList();
      await openGallery();

      expect(rowLabels()).toEqual([
        'Folder album',
        'Folder zoo',
        'big.png, Synced',
        'mid.png, Synced',
        'small.png, Synced',
      ]);
      expect(queryTreeChildrenMock).toHaveBeenCalledWith(
        'snap-1',
        null,
        expect.objectContaining({ kind: 'FILE', sort: 'SIZE_DESC' }),
        null,
      );
      expect(queryTreeChildrenMock).not.toHaveBeenCalledWith(
        'snap-1',
        null,
        expect.objectContaining({ kind: 'DIRECTORY', sort: 'SIZE_DESC' }),
        null,
      );
    });

    it('a sort change reorders only the files and does not read the folders again', async () => {
      renderList();
      await openGallery();
      const folderReads = () =>
        queryTreeChildrenMock.mock.calls.filter(
          ([, , query]) => query.kind === 'DIRECTORY',
        ).length;
      expect(folderReads()).toBe(1);

      pickSort('Size (smallest first)');

      await waitFor(() =>
        expect(rowLabels()).toEqual([
          'Folder album',
          'Folder zoo',
          'small.png, Synced',
          'mid.png, Synced',
          'big.png, Synced',
        ]),
      );
      expect(folderReads()).toBe(1);
      expect(setBrowsePreferencesMock).toHaveBeenCalledWith({
        listSort: 'SIZE_ASC',
      });
    });

    it('starts the file read only once the folder read has no next page', async () => {
      let resolvePage2: (result: QueryFilesResult) => void = () => {};
      queryTreeChildrenMock.mockImplementation((s, parentId, query, token) => {
        if (parentId !== null || query.pageSize === 1) {
          return fakeTree(s, parentId, query);
        }
        if (query.kind === 'DIRECTORY' && token == null) {
          return Promise.resolve({
            contractVersion: 6,
            status: 'ok',
            page: {
              entries: [dir('d-album', 'album', null, 'ALL')],
              nextPageToken: 'folders-2',
              counts: SOURCE_COUNTS['s-1'] ?? null,
            },
          });
        }
        if (query.kind === 'DIRECTORY') {
          return new Promise(resolve => {
            resolvePage2 = resolve;
          });
        }
        return Promise.resolve(ok(sizedRoot(query), null));
      });
      renderList();
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );
      await screen.findByLabelText('Folder album');
      const fileReads = () =>
        queryTreeChildrenMock.mock.calls.filter(
          ([, , query]) => query.kind === 'FILE',
        ).length;
      expect(fileReads()).toBe(0);

      fireEvent(screen.getByTestId('list-entries'), 'onEndReached');
      await waitFor(() =>
        expect(queryTreeChildrenMock).toHaveBeenCalledWith(
          'snap-1',
          null,
          expect.objectContaining({ kind: 'DIRECTORY' }),
          'folders-2',
        ),
      );
      expect(fileReads()).toBe(0);

      await act(async () =>
        resolvePage2(
          ok([dir('d-zoo', 'zoo', null, 'ALL')], SOURCE_COUNTS['s-1'] ?? null),
        ),
      );

      expect(await screen.findByLabelText('big.png, Synced')).toBeOnTheScreen();
      expect(fileReads()).toBe(1);
      expect(rowLabels()).toEqual([
        'Folder album',
        'Folder zoo',
        'big.png, Synced',
        'mid.png, Synced',
        'small.png, Synced',
      ]);
    });

    it("select all is unchanged by the sort: the open folder's direct files under the filter", async () => {
      listSelectableEntriesMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        selectable: { entryIds: [], sizes: [], statuses: [], images: [] },
      });
      renderList();
      await openGallery();
      pickSort('Size (largest first)');
      await waitFor(() =>
        expect(queryTreeChildrenMock).toHaveBeenLastCalledWith(
          'snap-1',
          null,
          expect.objectContaining({ kind: 'FILE', sort: 'SIZE_DESC' }),
          null,
        ),
      );

      fireEvent.press(screen.getByLabelText('Select all'));

      await waitFor(() =>
        expect(listSelectableEntriesMock).toHaveBeenCalledWith('snap-1', {
          filter: 'ALL',
          view: 'LIST',
          sort: 'NAME_ASC',
          sourceId: 's-1',
          parentId: null,
          pageSize: 100,
        }),
      );
    });

    it('reports a snapshot change in a folder that holds only files', async () => {
      queryTreeChildrenMock.mockImplementation((s, parentId, query) =>
        parentId === null && query.pageSize !== 1
          ? Promise.resolve(
              ok(
                query.kind === 'FILE' ? [entry('f-z', 'zebra.png')] : [],
                SOURCE_COUNTS['s-1'] ?? null,
              ),
            )
          : fakeTree(s, parentId, query),
      );
      const { props, rerender } = renderList();
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );
      await screen.findByLabelText('zebra.png, Synced');

      rerender(
        <PaperProvider theme={MD3LightTheme}>
          <ScanContext.Provider value={scanState('snap-2')}>
            <FilesProvider>
              <SelectionProvider>
                <Harness {...props} snapshotId="snap-2" />
              </SelectionProvider>
            </FilesProvider>
          </ScanContext.Provider>
        </PaperProvider>,
      );

      await waitFor(() =>
        expect(props.onSnapshotChange).toHaveBeenCalledTimes(1),
      );
    });
  });

  describe('selection (FR-015, FR-017, Story 5 sc. 7)', () => {
    async function openGallerySource() {
      const result = renderList();
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );
      await screen.findByLabelText('beach.png, Synced');
      return result;
    }

    it('does nothing on a file tap before anything is selected', async () => {
      await openGallerySource();
      fireEvent.press(screen.getByLabelText('beach.png, Synced'));

      expect(screen.getByLabelText('beach.png, Synced')).not.toBeSelected();
      expect(screen.queryByTestId('list-row-selected')).toBeNull();
    });

    it('starts on a long-press and toggles file rows on a tap, with a check mark', async () => {
      await openGallerySource();
      fireEvent(screen.getByLabelText('beach.png, Synced'), 'longPress');

      const beach = await screen.findByLabelText('beach.png, Synced, selected');
      expect(beach).toBeSelected();
      expect(beach.props.accessible).toBe(true);
      expect(within(beach).getByTestId('list-row-selected')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('harbor.png, Unsynced'));
      expect(
        await screen.findByLabelText('harbor.png, Unsynced, selected'),
      ).toBeSelected();

      fireEvent.press(screen.getByLabelText('beach.png, Synced, selected'));
      expect(
        await screen.findByLabelText('beach.png, Synced'),
      ).not.toBeSelected();
      expect(screen.getAllByTestId('list-row-selected')).toHaveLength(1);
    });

    it('never selects a directory: a long-press does nothing and a tap opens it, keeping the selection', async () => {
      await openGallerySource();
      fireEvent(screen.getByLabelText('Folder album, 2 matching'), 'longPress');
      expect(screen.queryByLabelText(/, selected$/)).toBeNull();

      fireEvent(screen.getByLabelText('beach.png, Synced'), 'longPress');
      await screen.findByLabelText('beach.png, Synced, selected');

      fireEvent.press(screen.getByLabelText('Folder album, 2 matching'));
      expect(
        await screen.findByLabelText('forest.png, Synced'),
      ).toBeOnTheScreen();
      expect(screen.getByLabelText('Breadcrumb album')).toBeOnTheScreen();

      // Selecting continues in the new folder: a tap toggles.
      fireEvent.press(screen.getByLabelText('forest.png, Synced'));
      expect(
        await screen.findByLabelText('forest.png, Synced, selected'),
      ).toBeSelected();

      // Back at the source root, beach.png is still selected.
      fireEvent.press(screen.getByLabelText('Breadcrumb Gallery'));
      expect(
        await screen.findByLabelText('beach.png, Synced, selected'),
      ).toBeSelected();
    });

    it('opens a source while selecting and keeps the selection', async () => {
      await openGallerySource();
      fireEvent(screen.getByLabelText('beach.png, Synced'), 'longPress');
      await screen.findByLabelText('beach.png, Synced, selected');

      fireEvent.press(screen.getByLabelText('Breadcrumb All folders'));
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );

      expect(
        await screen.findByLabelText('beach.png, Synced, selected'),
      ).toBeSelected();
    });

    it('passes the a11y sweep while selecting', async () => {
      const result = await openGallerySource();
      fireEvent(screen.getByLabelText('beach.png, Synced'), 'longPress');
      await screen.findByLabelText('beach.png, Synced, selected');

      expect(() => a11ySweep(result)).not.toThrow();
    });
  });
});

describe('ListScreen with the scroll index (Story 2, research R7)', () => {
  const BAND_COUNTS = [600, 600, 600];

  /** Letter bands of [counts]; band k starts at token `band-<k>`. */
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

  /** Source s-1's root holds two folders and the files of [BAND_COUNTS]; band k's files are `<k>-<i>.png`. */
  function bandTree(
    snapshotId: string,
    parentId: string | null,
    query: QuerySpec,
    pageToken?: string | null,
  ): Promise<QueryFilesResult> {
    if (parentId !== null || query.pageSize === 1) {
      return fakeTree(snapshotId, parentId, query);
    }
    if (query.kind === 'DIRECTORY') {
      return Promise.resolve(
        ok(
          [
            dir('d-album', 'album', null, 'ALL'),
            dir('d-drafts', 'drafts', null, 'ALL'),
          ],
          SOURCE_COUNTS['s-1'] ?? null,
        ),
      );
    }
    const k = pageToken == null ? 0 : Number(pageToken.split('-')[1]);
    return Promise.resolve({
      contractVersion: 6,
      status: 'ok',
      page: {
        entries: Array.from({ length: 100 }, (_, i) =>
          file(`f-${k}-${i}`, `${k}-${i}.png`, 'SYNCED'),
        ),
        // Every band holds more than one page.
        nextPageToken: `more-${k}`,
        counts: k === 0 ? SOURCE_COUNTS['s-1'] ?? null : null,
      },
    });
  }

  beforeEach(() => {
    queryTreeChildrenMock.mockImplementation(bandTree);
    getScrollIndexMock.mockImplementation(async (_snapshotId, query) =>
      query.parentId == null ? scrollIndex(BAND_COUNTS) : scrollIndex([1]),
    );
  });

  async function openGallery() {
    fireEvent.press(await screen.findByLabelText('Folder Gallery, 6 matching'));
    await screen.findByLabelText('0-0.png, Synced');
    fireEvent(screen.getByTestId('list-body'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } },
    });
  }

  it('shows the folders first, then the file bands with placeholders past the loaded rows', async () => {
    renderList();
    await openGallery();

    const data = screen.getByTestId('list-entries').props.data as unknown[];
    expect(data).toHaveLength(2 + 1800);
    expect(screen.getByLabelText('Folder album')).toBeOnTheScreen();
    expect(getScrollIndexMock).toHaveBeenCalledWith('snap-1', {
      filter: 'ALL',
      view: 'LIST',
      sort: 'NAME_ASC',
      sourceId: 's-1',
      parentId: null,
      kind: 'FILE',
      pageSize: 100,
    });

    fireEvent(screen.getByTestId('list-entries'), 'onViewableItemsChanged', {
      viewableItems: [{ index: 602 }, { index: 603 }],
      changed: [],
    });

    await waitFor(() =>
      expect(queryTreeChildrenMock).toHaveBeenLastCalledWith(
        'snap-1',
        null,
        expect.objectContaining({ kind: 'FILE' }),
        'band-1',
      ),
    );
  });

  it("jumps with the scrollbar to the band's first file, below the folders", async () => {
    const scrollToIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
    try {
      renderList();
      await openGallery();
      const thumb = await screen.findByTestId('files.scroller.thumb');

      fireEvent(thumb, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });

      expect(scrollToIndex).toHaveBeenCalledWith({
        index: 2 + 600,
        animated: false,
      });
      await waitFor(() =>
        expect(queryTreeChildrenMock).toHaveBeenLastCalledWith(
          'snap-1',
          null,
          expect.objectContaining({ kind: 'FILE' }),
          'band-1',
        ),
      );
    } finally {
      scrollToIndex.mockRestore();
    }
  });

  describe('keeps the place when results update (Story 4, research R8)', () => {
    /** The album folder's ID: entry IDs change with every snapshot. */
    const albumOf = (snapshotId: string) =>
      snapshotId === 'snap-2' ? 'd-album-2' : 'd-album';

    /** Source s-1's root holds `album`, whose files are the bands of BAND_COUNTS. */
    function albumTree(
      snapshotId: string,
      parentId: string | null,
      query: QuerySpec,
      pageToken?: string | null,
    ): Promise<QueryFilesResult> {
      if (query.pageSize === 1) {
        return fakeTree(snapshotId, parentId, query);
      }
      if (parentId === null) {
        return Promise.resolve(
          ok(
            query.kind === 'FILE'
              ? []
              : [
                  entry(albumOf(snapshotId), 'album', {
                    kind: 'DIRECTORY',
                    mimeType: null,
                    sizeBytes: null,
                    matchingFileCount: 1800,
                  }),
                ],
            SOURCE_COUNTS['s-1'] ?? null,
          ),
        );
      }
      if (query.kind === 'DIRECTORY') {
        return Promise.resolve(ok([], SOURCE_COUNTS['s-1'] ?? null));
      }
      return bandTree(snapshotId, null, query, pageToken);
    }

    function harness(snapshotId: string, props: FilesViewProps) {
      return (
        <PaperProvider theme={MD3LightTheme}>
          <ScanContext.Provider value={scanState(snapshotId)}>
            <FilesProvider>
              <SelectionProvider>
                <Harness {...props} snapshotId={snapshotId} />
              </SelectionProvider>
            </FilesProvider>
          </ScanContext.Provider>
        </PaperProvider>
      );
    }

    it.each([
      ['the noted file is still there', 603],
      ['the noted file is gone: its neighbour (sc. 2)', 602],
    ])(
      'relocates the folder by name, then scrolls to the anchor: %s',
      async (_case, anchorIndex) => {
        queryTreeChildrenMock.mockImplementation(albumTree);
        getScrollIndexMock.mockImplementation(
          async (_snapshotId, query, anchor) => {
            const index = scrollIndex(
              query.parentId == null ? [1] : BAND_COUNTS,
            );
            if (index.status === 'ok' && anchor != null) {
              index.scrollIndex.anchorIndex = anchorIndex;
            }
            return index;
          },
        );
        const { props, rerender } = renderList();
        fireEvent.press(
          await screen.findByLabelText('Folder Gallery, 6 matching'),
        );
        fireEvent.press(
          await screen.findByLabelText('Folder album, 1800 matching'),
        );
        await screen.findByLabelText('0-0.png, Synced');
        const viewable = {
          viewableItems: Array.from({ length: 10 }, (_, i) => ({
            index: 603 + i,
          })),
          changed: [],
        };
        fireEvent(
          screen.getByTestId('list-entries'),
          'onViewableItemsChanged',
          viewable,
        );
        await waitFor(() =>
          expect(
            (
              screen.getByTestId('list-entries').props.data as {
                entryId?: string;
              }[]
            )[603]?.entryId,
          ).toBe('f-1-3'),
        );
        // Row 603 is the top row on screen; row 602 is scrolled away.
        fireEvent.scroll(screen.getByTestId('list-entries'), {
          nativeEvent: {
            contentOffset: { x: 0, y: 603 * density.rowHeight + 20 },
            contentSize: { width: 400, height: 1000000 },
            layoutMeasurement: { width: 400, height: 600 },
          },
        });

        rerender(harness('snap-2', props));

        await waitFor(() =>
          expect(getScrollIndexMock).toHaveBeenLastCalledWith(
            'snap-2',
            expect.objectContaining({ parentId: 'd-album-2', kind: 'FILE' }),
            { sortValue: '11-3.png', sortName: '11-3.png' },
          ),
        );
        await waitFor(() =>
          expect(
            screen.getByTestId('list-entries').props.initialScrollIndex,
          ).toBe(anchorIndex),
        );
        expect(screen.getByLabelText('Breadcrumb album')).toBeOnTheScreen();
        await waitFor(() =>
          expect(props.onSnapshotChange).toHaveBeenCalledTimes(1),
        );
      },
    );

    it('starts a newly opened folder at the top', async () => {
      queryTreeChildrenMock.mockImplementation(albumTree);
      getScrollIndexMock.mockImplementation(async (_snapshotId, query) =>
        scrollIndex(query.parentId == null ? [1] : BAND_COUNTS),
      );
      renderList();
      fireEvent.press(
        await screen.findByLabelText('Folder Gallery, 6 matching'),
      );
      fireEvent.press(
        await screen.findByLabelText('Folder album, 1800 matching'),
      );
      await screen.findByLabelText('0-0.png, Synced');

      expect(
        screen.getByTestId('list-entries').props.initialScrollIndex ?? null,
      ).toBeNull();
      expect(getScrollIndexMock).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ parentId: 'd-album' }),
      );
    });
  });

  it('reads the bands of the open folder (Story 2 sc. 8)', async () => {
    renderList();
    await openGallery();
    expect(await screen.findByTestId('files.scroller.thumb')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Folder album'));

    await waitFor(() =>
      expect(getScrollIndexMock).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ parentId: 'd-album', kind: 'FILE' }),
      ),
    );
    await screen.findByLabelText('forest.png, Synced');
    expect(screen.queryByTestId('files.scroller.thumb')).toBeNull();
  });

  it('passes the a11y sweep with folders, placeholders and the scrollbar (FR-017)', async () => {
    // The first band holds 3 files, so the second band's unread rows are
    // placeholders inside the first screenful, right after the folders.
    getScrollIndexMock.mockImplementation(async (_snapshotId, query) =>
      query.parentId == null ? scrollIndex([3, 600, 600]) : scrollIndex([1]),
    );
    queryTreeChildrenMock.mockImplementation(
      async (snapshotId, parentId, query, pageToken) => {
        const read = await bandTree(snapshotId, parentId, query, pageToken);
        if (
          parentId !== null ||
          query.kind !== 'FILE' ||
          query.pageSize === 1 ||
          pageToken != null ||
          read.status !== 'ok'
        ) {
          return read;
        }
        // The first band is complete after its 3 files.
        return {
          ...read,
          page: { ...read.page, entries: read.page.entries.slice(0, 3), nextPageToken: null },
        };
      },
    );
    const result = renderList();
    fireEvent.press(await screen.findByLabelText('Folder Gallery, 6 matching'));
    await screen.findByLabelText('0-0.png, Synced');
    fireEvent(screen.getByTestId('list-body'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 600 } },
    });
    await screen.findByTestId('files.scroller.thumb');

    expect(screen.getByLabelText('Folder album')).toBeOnTheScreen();
    expect(screen.getAllByLabelText('Loading file').length).toBeGreaterThan(0);
    expect(() => a11ySweep(result)).not.toThrow();
  });
});
