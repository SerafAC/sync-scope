import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react-native';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';

import { FilesProvider } from '../../files/FilesProvider';
import { FilterChips } from '../../files/FilterChips';
import type { FilesViewProps } from '../../files/FilesViewParts';
import { queryTreeChildren } from '../../native/CloudSync';
import type {
  FileEntryDto,
  FileFilter,
  FileStatus,
  QueryFilesResult,
  QuerySpec,
  StatusCountDto,
} from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import { SelectionProvider } from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { ListScreen, formatSize } from '../ListScreen';

jest.mock('../../native/CloudSync', () => ({
  queryTreeChildren: jest.fn(),
}));

const queryTreeChildrenMock = queryTreeChildren as jest.MockedFunction<
  typeof queryTreeChildren
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
  return Promise.resolve(ok(children(parentId, query.filter), counts));
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
            <FilterChips counts={null} />
            <ListScreen {...props} />
          </SelectionProvider>
        </FilesProvider>
      </ScanContext.Provider>
    </PaperProvider>,
  );
  return { ...result, props };
}

beforeEach(() => {
  jest.clearAllMocks();
  queryTreeChildrenMock.mockImplementation(fakeTree);
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
      parentId === null && query.pageSize !== 1
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
