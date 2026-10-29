import React from 'react';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { FlatList, Text } from 'react-native';
import { MD3LightTheme, PaperProvider } from 'react-native-paper';

import { getBrowsePreferences } from '../../native/CloudSync';
import type { FileEntryDto, FileStatus } from '../../native/CloudSyncContracts';
import { ScanContext, type ScanState } from '../../scan/useScan';
import {
  SelectionProvider,
  useSelection,
} from '../../selection/SelectionProvider';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { density, spacing } from '../../theme/spacing';
import { FilesProvider } from '../FilesProvider';
import { useFiles } from '../useFiles';
import { TreeView, type TreeViewProps } from '../TreeView';
import type {
  TreeFileRow,
  TreeFolderRow,
  TreeMoreRow,
  TreeRow,
  TreeSourceRow,
} from '../useTree';

const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn() };

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
  listSelectableEntries: jest.fn(),
  queryTreeChildren: jest.fn(),
  // Media rows read their thumbnail; it stays loading here (FileRow has its own tests).
  getLocalImageHandle: jest.fn(() => new Promise(() => {})),
}));

const getBrowsePreferencesMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;

const DIMMED = MD3LightTheme.colors.onSurfaceDisabled;

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

function entry(
  name: string,
  overrides: Partial<FileEntryDto> = {},
): FileEntryDto {
  return {
    entryId: `e-${name}`,
    sourceId: 's-1',
    parentId: null,
    kind: 'FILE',
    name,
    mimeType: 'image/jpeg',
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

function source(alias: string, expanded: boolean): TreeSourceRow {
  return {
    kind: 'source',
    key: `source:${alias}`,
    depth: 0,
    path: ['s-1'],
    sourceId: 's-1',
    alias,
    counts: null,
    expanded,
  };
}

function folder(
  path: string[],
  matchingFileCount: number | null,
  expanded = false,
): TreeFolderRow {
  const name = path[path.length - 1] as string;
  return {
    kind: 'folder',
    key: `folder:${path.join('/')}`,
    depth: path.length - 1,
    path,
    entryId: `d-${name}`,
    name,
    matchingFileCount,
    expanded,
  };
}

function fileRow(
  path: string[],
  overrides: Partial<FileEntryDto> = {},
  status: FileStatus = 'SYNCED',
): TreeFileRow {
  const name = path[path.length - 1] as string;
  return {
    kind: 'file',
    key: `file:${path.join('/')}`,
    depth: path.length - 1,
    path,
    entry: entry(name, { status, ...overrides }),
  };
}

const ROWS: TreeRow[] = [
  source('Camera', true),
  folder(['s-1', 'Album'], 4, true),
  folder(['s-1', 'Album', '2024'], 2, true),
  fileRow(['s-1', 'Album', '2024', 'a1.jpg']),
  fileRow(['s-1', 'Album', '2024', 'a2.jpg'], {}, 'UNSYNCED'),
  folder(['s-1', 'Album', 'Docs'], 0),
  fileRow(['s-1', 'Album', 'notes.txt'], { mimeType: 'text/plain' }),
  fileRow(['s-1', 'Loose.jpg']),
];

/** Shows the selection's count, as the Files tab's selection bar would. */
function SelectionProbe(): React.JSX.Element | null {
  const { items } = useSelection();
  return items.size > 0 ? <Text>{`${items.size} selected`}</Text> : null;
}

function renderTree(overrides: Partial<TreeViewProps['tree']> = {}) {
  const tree: TreeViewProps['tree'] = {
    rows: ROWS,
    toggle: jest.fn(),
    loadMore: jest.fn(),
    anchorIndex: null,
    anchorGeneration: 0,
    ...overrides,
  };
  const result = render(
    <PaperProvider theme={MD3LightTheme}>
      <ScanContext.Provider value={scanState('snap-1')}>
        <FilesProvider>
          <SelectionProvider>
            <TreeView filter="ALL" snapshotId="snap-1" tree={tree} />
            <SelectionProbe />
          </SelectionProvider>
        </FilesProvider>
      </ScanContext.Provider>
    </PaperProvider>,
  );
  return { ...result, tree };
}

beforeEach(() => {
  jest.clearAllMocks();
  getBrowsePreferencesMock.mockResolvedValue({
    contractVersion: 7,
    status: 'ok',
    preferences: {
      view: 'TREE',
      gallerySort: 'TIME_DESC',
      listSort: 'NAME_ASC',
    },
  });
});

describe('TreeView', () => {
  it('renders one flat list whose rows are all density.rowHeight high', () => {
    renderTree();

    const list = screen.getByTestId('tree-rows');
    expect(list.props.data).toHaveLength(ROWS.length);
    const layout = list.props.getItemLayout(list.props.data, 5);
    expect(layout).toEqual({
      length: density.rowHeight,
      offset: density.rowHeight * 5,
      index: 5,
    });
    expect(density.rowHeight).toBe(56);
    for (const label of [
      'Folder Camera',
      'Folder Album, 4 matching',
      'Folder Docs, 0 matching, no matches',
      'a1.jpg, Synced',
      'notes.txt, Synced',
    ]) {
      expect(screen.getByLabelText(label)).toHaveStyle({
        height: density.rowHeight,
      });
    }
  });

  it('indents each depth by spacing.lg, up to depth 8', () => {
    const deep = Array.from({ length: 11 }, (_, i) => `d${i}`);
    renderTree({
      rows: [
        ...ROWS,
        folder(['s-1', ...deep.slice(0, 9)], 1),
        fileRow(['s-1', ...deep, 'deep.jpg']),
      ],
    });

    expect(screen.getByLabelText('Folder Camera')).not.toHaveStyle({
      paddingLeft: spacing.lg,
    });
    expect(screen.getByLabelText('Folder Album, 4 matching')).toHaveStyle({
      paddingLeft: spacing.lg,
    });
    expect(screen.getByLabelText('Folder 2024, 2 matching')).toHaveStyle({
      paddingLeft: 2 * spacing.lg,
    });
    expect(screen.getByLabelText('a1.jpg, Synced')).toHaveStyle({
      paddingLeft: 3 * spacing.lg,
    });
    // Depth 9 and depth 12 keep the depth-8 indent.
    expect(screen.getByLabelText('Folder d8, 1 matching')).toHaveStyle({
      paddingLeft: 8 * spacing.lg,
    });
    expect(screen.getByLabelText('deep.jpg, Synced')).toHaveStyle({
      paddingLeft: 8 * spacing.lg,
    });
  });

  it('dims a folder with no matching files, shows "0" and still expands it', () => {
    const { tree } = renderTree();

    const docs = screen.getByLabelText('Folder Docs, 0 matching, no matches');
    expect(within(docs).getByText('Docs')).toHaveStyle({ color: DIMMED });
    expect(within(docs).getByText('0')).toHaveStyle({ color: DIMMED });
    expect(
      within(screen.getByLabelText('Folder Album, 4 matching')).getByText(
        'Album',
      ),
    ).not.toHaveStyle({ color: DIMMED });

    fireEvent.press(screen.getByLabelText('Expand Docs'));

    expect(tree.toggle).toHaveBeenCalledWith(ROWS[5]);
  });

  it('labels the expand and collapse controls of sources and folders', () => {
    const { tree } = renderTree();

    expect(screen.getByLabelText('Collapse Camera')).toBeOnTheScreen();
    expect(screen.getByLabelText('Collapse Album')).toBeOnTheScreen();
    expect(screen.getByLabelText('Collapse 2024')).toBeOnTheScreen();
    expect(screen.getByLabelText('Expand Docs')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('Collapse Album'));
    expect(tree.toggle).toHaveBeenLastCalledWith(ROWS[1]);

    // A tap on the folder row itself toggles it too.
    fireEvent.press(screen.getByLabelText('Folder 2024, 2 matching'));
    expect(tree.toggle).toHaveBeenLastCalledWith(ROWS[2]);
  });

  it('never selects a folder or a source', () => {
    const { tree } = renderTree();

    fireEvent(screen.getByLabelText('Folder Album, 4 matching'), 'longPress');
    fireEvent(screen.getByLabelText('Folder Camera'), 'longPress');

    expect(screen.queryByText(/selected$/)).toBeNull();
    expect(
      screen.getByLabelText('Folder Album, 4 matching'),
    ).not.toBeSelected();
    expect(tree.toggle).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'file' }),
    );
  });

  it('a long-press on a file starts selecting, and a tap then toggles', () => {
    renderTree();

    fireEvent(screen.getByLabelText('a1.jpg, Synced'), 'longPress');
    expect(screen.getByLabelText('a1.jpg, Synced, selected')).toBeSelected();
    expect(screen.getByText('1 selected')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('a2.jpg, Unsynced'));
    expect(screen.getByLabelText('a2.jpg, Unsynced, selected')).toBeSelected();
    expect(screen.getByText('2 selected')).toBeOnTheScreen();

    fireEvent.press(screen.getByLabelText('a1.jpg, Synced, selected'));
    expect(screen.getByLabelText('a1.jpg, Synced')).not.toBeSelected();
    expect(screen.getByText('1 selected')).toBeOnTheScreen();
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('with nothing selected, a tap on a media file opens its preview, and on another file does nothing', () => {
    renderTree();

    fireEvent.press(screen.getByLabelText('Loose.jpg, Synced'));

    expect(mockNavigation.navigate).toHaveBeenCalledWith('Preview', {
      snapshotId: 'snap-1',
      entryId: 'e-Loose.jpg',
      name: 'Loose.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
      status: 'SYNCED',
    });
    expect(screen.queryByText(/selected$/)).toBeNull();

    mockNavigation.navigate.mockClear();
    fireEvent.press(screen.getByLabelText('notes.txt, Synced'));
    expect(mockNavigation.navigate).not.toHaveBeenCalled();
  });

  it('has no fast scrollbar', () => {
    renderTree();

    expect(screen.queryByLabelText('Scrollbar')).toBeNull();
    expect(screen.queryByTestId('fast-scroller')).toBeNull();
  });

  it('reads the next page when a "more" row becomes visible', () => {
    const more: TreeMoreRow = {
      kind: 'more',
      key: 'more:s-1',
      depth: 1,
      folderPath: ['s-1'],
      nextPageToken: 'tok-2',
    };
    const { tree } = renderTree({ rows: [...ROWS, more] });

    fireEvent(screen.getByTestId('tree-rows'), 'onViewableItemsChanged', {
      viewableItems: [{ index: ROWS.length, item: more }],
      changed: [],
    });

    expect(tree.loadMore).toHaveBeenCalledWith(more);
  });

  it('passes the a11y sweep, also while selecting', () => {
    const result = renderTree();
    a11ySweep(result);

    fireEvent(screen.getByLabelText('a1.jpg, Synced'), 'longPress');
    a11ySweep(result);
  });
});

describe('TreeView keeps the place on new results (T057, 007 FR-014)', () => {
  /** Shows the tree state's anchor, as `FilesProvider` holds it. */
  function AnchorProbe(): React.JSX.Element {
    const { tree } = useFiles();
    return <Text testID="anchor">{JSON.stringify(tree.anchor)}</Text>;
  }

  function ui(
    anchorIndex: number | null,
    visible: boolean,
    anchorGeneration = anchorIndex == null ? 0 : 1,
  ) {
    return (
      <PaperProvider theme={MD3LightTheme}>
        <ScanContext.Provider value={scanState('snap-1')}>
          <FilesProvider>
            <SelectionProvider>
              <TreeView
                filter="ALL"
                snapshotId="snap-1"
                tree={{
                  rows: ROWS,
                  toggle: jest.fn(),
                  loadMore: jest.fn(),
                  anchorIndex,
                  anchorGeneration,
                }}
                visible={visible}
              />
              <AnchorProbe />
            </SelectionProvider>
          </FilesProvider>
        </ScanContext.Provider>
      </PaperProvider>
    );
  }

  function layout(height: number) {
    fireEvent(screen.getByTestId('tree-rows'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 360, height } },
    });
  }

  function scrollEnd(event: 'scrollEndDrag' | 'momentumScrollEnd', y: number) {
    fireEvent(screen.getByTestId('tree-rows'), event, {
      nativeEvent: {
        contentOffset: { x: 0, y },
        contentSize: { width: 360, height: ROWS.length * density.rowHeight },
        layoutMeasurement: { width: 360, height: 112 },
      },
    });
  }

  it("records the first visible row's name path when a scroll settles", () => {
    render(ui(null, true));
    expect(screen.getByTestId('anchor')).toHaveTextContent('null');

    scrollEnd('momentumScrollEnd', 3 * density.rowHeight + 10);
    expect(screen.getByTestId('anchor')).toHaveTextContent(
      JSON.stringify(['s-1', 'Album', '2024', 'a1.jpg']),
    );

    // Less than a point of a row on screen is not that row.
    scrollEnd('scrollEndDrag', 5 * density.rowHeight - 0.5);
    expect(screen.getByTestId('anchor')).toHaveTextContent(
      JSON.stringify(['s-1', 'Album', 'Docs']),
    );

    // Back at the top there is no place to keep.
    scrollEnd('scrollEndDrag', 0);
    expect(screen.getByTestId('anchor')).toHaveTextContent('null');
  });

  it('scrolls back to the re-found anchor once', () => {
    const scrollToIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
    try {
      const { rerender } = render(ui(null, true));
      layout(112);
      expect(scrollToIndex).not.toHaveBeenCalled();

      rerender(ui(6, true));
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenCalledWith({ index: 6, animated: false });

      rerender(ui(6, true));
      layout(200);
      expect(scrollToIndex).toHaveBeenCalledTimes(1);
    } finally {
      scrollToIndex.mockRestore();
    }
  });

  it('scrolls back on every re-find, also when it lands on the same index', () => {
    const scrollToIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
    try {
      const { rerender } = render(ui(null, true));
      layout(112);

      rerender(ui(6, true, 1));
      expect(scrollToIndex).toHaveBeenCalledTimes(1);

      // The user scrolls to another row, and the next snapshot shortens the
      // rows above it so that it is re-found at index 6 again.
      scrollEnd('momentumScrollEnd', 2 * density.rowHeight);
      rerender(ui(6, true, 2));
      expect(scrollToIndex).toHaveBeenCalledTimes(2);
      expect(scrollToIndex).toHaveBeenLastCalledWith({
        index: 6,
        animated: false,
      });
    } finally {
      scrollToIndex.mockRestore();
    }
  });

  it('a hidden tree scrolls to the anchor once it is shown and laid out', () => {
    const scrollToIndex = jest
      .spyOn(FlatList.prototype, 'scrollToIndex')
      .mockImplementation(() => {});
    try {
      const { rerender } = render(ui(null, false));
      layout(0);

      rerender(ui(4, false));
      expect(scrollToIndex).not.toHaveBeenCalled();

      rerender(ui(4, true));
      expect(scrollToIndex).not.toHaveBeenCalled();
      layout(112);

      expect(scrollToIndex).toHaveBeenCalledTimes(1);
      expect(scrollToIndex).toHaveBeenCalledWith({ index: 4, animated: false });
    } finally {
      scrollToIndex.mockRestore();
    }
  });
});
