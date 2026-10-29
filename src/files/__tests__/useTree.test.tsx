import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  CloudSyncErrorCode,
  type FileEntryDto,
  type FileSort,
  type QueryFilesResult,
  type QuerySpec,
} from '../../native/CloudSyncContracts';
import { PAGED_QUERY_PAGE_SIZE, type PageReader } from '../usePagedQuery';
import {
  INITIAL_TREE_STATE,
  useTree,
  type TreeFileRow,
  type TreeFolderRow,
  type TreeMoreRow,
  type TreeRow,
  type TreeSourceRow,
  type TreeState,
  type UseTreeOptions,
} from '../useTree';

/** A node of the fake snapshot: a folder has children, a file a size. */
interface FakeNode {
  name: string;
  children?: FakeNode[];
  size?: number;
  matching?: number;
}

type FakeSnapshot = Record<string, FakeNode[]>;

const dir = (
  name: string,
  children: FakeNode[] = [],
  matching = 1,
): FakeNode => ({ name, children, matching });
const file = (name: string, size = 1): FakeNode => ({ name, size });

function sortNameOf(name: string): string {
  return `1${name.toLowerCase()}`;
}

/** Entry IDs differ per snapshot, as they do per scan. */
function idOf(snapshotId: string, sourceId: string, path: readonly string[]) {
  return `${snapshotId}:${sourceId}/${path.join('/')}`;
}

function entryOf(
  snapshotId: string,
  sourceId: string,
  parentPath: readonly string[],
  node: FakeNode,
): FileEntryDto {
  const path = [...parentPath, node.name];
  return {
    entryId: idOf(snapshotId, sourceId, path),
    sourceId,
    parentId:
      parentPath.length === 0 ? null : idOf(snapshotId, sourceId, parentPath),
    kind: node.children != null ? 'DIRECTORY' : 'FILE',
    name: node.name,
    mimeType: node.children != null ? null : 'image/jpeg',
    sizeBytes: node.size ?? null,
    modifiedUtcMillis: 1,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: node.children != null ? node.matching ?? null : null,
    sortName: sortNameOf(node.name),
  };
}

function compareFiles(sort: FileSort) {
  return (a: FakeNode, b: FakeNode): number => {
    switch (sort) {
      case 'NAME_DESC':
        return sortNameOf(b.name).localeCompare(sortNameOf(a.name));
      case 'SIZE_DESC':
        return (b.size ?? 0) - (a.size ?? 0) || a.name.localeCompare(b.name);
      case 'SIZE_ASC':
        return (a.size ?? 0) - (b.size ?? 0) || a.name.localeCompare(b.name);
      default:
        return sortNameOf(a.name).localeCompare(sortNameOf(b.name));
    }
  };
}

/**
 * A fake `queryTreeChildren` over [snapshots]: the parent travels in
 * `query.parentId`, folders and files are read apart by `query.kind`, and
 * [pageSize] rows come per page with an opaque token.
 */
function fakeReader(snapshots: Record<string, FakeSnapshot>, pageSize = 100) {
  return jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
    async (snapshotId, query, pageToken): Promise<QueryFilesResult> => {
      const snapshot = snapshots[snapshotId];
      const sourceId = query.sourceId ?? '';
      if (snapshot == null || snapshot[sourceId] == null) {
        return {
          contractVersion: 7,
          status: 'error',
          error: {
            code: CloudSyncErrorCode.SNAPSHOT_NOT_FOUND,
            message: 'gone',
            action: null,
          },
        };
      }
      let nodes = snapshot[sourceId] as FakeNode[];
      let parentPath: string[] = [];
      if (query.parentId != null) {
        const wanted = query.parentId.split('/').slice(1);
        for (const name of wanted) {
          const next = nodes.find(n => n.name === name && n.children != null);
          nodes = next?.children ?? [];
        }
        parentPath = wanted;
      }
      const rows = nodes
        .filter(n =>
          query.kind === 'DIRECTORY'
            ? n.children != null
            : query.kind === 'FILE'
            ? n.children == null
            : true,
        )
        .sort(
          query.kind === 'DIRECTORY'
            ? (a, b) => a.name.localeCompare(b.name)
            : compareFiles(query.sort),
        );
      const offset = pageToken == null ? 0 : Number(pageToken.split('#')[1]);
      const page = rows.slice(offset, offset + pageSize);
      const next = offset + pageSize;
      return {
        contractVersion: 7,
        status: 'ok',
        page: {
          entries: page.map(n => entryOf(snapshotId, sourceId, parentPath, n)),
          nextPageToken:
            next < rows.length
              ? `${snapshotId}:${query.parentId}:${query.kind}#${next}`
              : null,
          counts:
            pageToken == null
              ? [{ status: 'SYNCED', count: rows.length }]
              : null,
        },
      };
    },
  );
}

function fail(code: string): QueryFilesResult {
  return {
    contractVersion: 7,
    status: 'error',
    error: { code, message: `failed: ${code}`, action: null },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const SOURCES = new Map([
  ['s-1', 'Camera'],
  ['s-2', 'Downloads'],
]);

/** The fixture of the tree flows: `Album/2024`, `Album/2025`, `Album/Docs`, `Empty`, `Loose.jpg`. */
const SNAP_1: FakeSnapshot = {
  's-1': [
    file('Loose.jpg', 5),
    dir('Album', [
      dir('2025', [file('b1.jpg', 3), file('new.jpg', 9), file('clip.mp4', 7)]),
      dir('2024', [file('a1.jpg'), file('a2.jpg')]),
      dir('Docs', [file('doc.pdf')], 0),
    ]),
    dir('Empty', [], 0),
    file('big.jpg', 50),
  ],
  's-2': [file('x.jpg')],
};

type Props = Omit<UseTreeOptions, 'state' | 'onStateChange'> & {
  initialState?: TreeState;
};

/** Holds the tree state as `FilesProvider` does, so `onStateChange` round-trips. */
function setup(initial: Partial<Props> & { read: PageReader }) {
  const base: Props = {
    snapshotId: 'snap-1',
    sources: SOURCES,
    filter: 'ALL',
    sort: 'NAME_ASC',
    onSnapshotLost: jest.fn(),
    ...initial,
  };
  return renderHook(
    (props: Partial<Props>) => {
      const { initialState, ...options } = { ...base, ...props };
      const [state, setState] = useState<TreeState>(
        initialState ?? INITIAL_TREE_STATE,
      );
      return {
        state,
        tree: useTree({ ...options, state, onStateChange: setState }),
      };
    },
    { initialProps: {} },
  );
}

/** `kind:depth:name` of each row: what the tree shows, in order. */
function shape(rows: readonly TreeRow[]): string[] {
  return rows.map(row => {
    switch (row.kind) {
      case 'source':
        return `source:0:${row.alias}${row.expanded ? ' -' : ' +'}`;
      case 'folder':
        return `folder:${row.depth}:${row.name}${row.expanded ? ' -' : ' +'}`;
      case 'file':
        return `file:${row.depth}:${row.entry.name}`;
      case 'more':
        return `more:${row.depth}:${row.folderPath.join('/')}`;
      case 'placeholder':
        return `placeholder:${row.depth}:${row.folderPath.join('/')}`;
    }
  });
}

function rowAt(
  rows: readonly TreeRow[],
  path: readonly string[],
): TreeSourceRow | TreeFolderRow | TreeFileRow {
  const found = rows.find(
    (row): row is TreeSourceRow | TreeFolderRow | TreeFileRow =>
      (row.kind === 'source' || row.kind === 'folder' || row.kind === 'file') &&
      row.path.join('/') === path.join('/'),
  );
  if (found == null) {
    throw new Error(`no row at ${path.join('/')}`);
  }
  return found;
}

/** The source or folder row at [path], to toggle it. */
function nodeAt(
  rows: readonly TreeRow[],
  path: readonly string[],
): TreeSourceRow | TreeFolderRow {
  const row = rowAt(rows, path);
  if (row.kind === 'file') {
    throw new Error(`a file at ${path.join('/')}`);
  }
  return row;
}

describe('useTree', () => {
  it('shows one collapsed source row per selected source and reads nothing', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result } = setup({ read });
    await act(async () => {});

    expect(shape(result.current.tree.rows)).toEqual([
      'source:0:Camera +',
      'source:0:Downloads +',
    ]);
    expect(result.current.tree.rows[0]).toMatchObject({
      kind: 'source',
      sourceId: 's-1',
      path: ['s-1'],
      depth: 0,
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('shows no rows without a snapshot', () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result } = setup({ read, snapshotId: null });

    expect(result.current.tree.rows).toEqual([]);
  });

  it('expanding a source shows a placeholder, then its folders by name and its files in the sort', async () => {
    const fake = fakeReader({ 'snap-1': SNAP_1 });
    const gate = deferred<void>();
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      async (...args) => {
        await gate.promise;
        return fake(...args);
      },
    );
    const { result } = setup({ read, sort: 'SIZE_DESC' });

    act(() =>
      result.current.tree.toggle(nodeAt(result.current.tree.rows, ['s-1'])),
    );

    expect(shape(result.current.tree.rows)).toEqual([
      'source:0:Camera -',
      'placeholder:1:s-1',
      'source:0:Downloads +',
    ]);
    expect(result.current.state.expanded).toEqual([['s-1']]);

    await act(async () => gate.resolve());
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toEqual([
        'source:0:Camera -',
        'folder:1:Album +',
        'folder:1:Empty +',
        'file:1:big.jpg',
        'file:1:Loose.jpg',
        'source:0:Downloads +',
      ]),
    );
    const base: QuerySpec = {
      filter: 'ALL',
      view: 'LIST',
      sort: 'NAME_ASC',
      sourceId: 's-1',
      parentId: null,
      kind: 'DIRECTORY',
      pageSize: PAGED_QUERY_PAGE_SIZE,
    };
    expect(read).toHaveBeenNthCalledWith(1, 'snap-1', base, null);
    expect(read).toHaveBeenNthCalledWith(
      2,
      'snap-1',
      { ...base, sort: 'SIZE_DESC', kind: 'FILE' },
      null,
    );
    expect(rowAt(result.current.tree.rows, ['s-1', 'Album'])).toMatchObject({
      kind: 'folder',
      depth: 1,
      name: 'Album',
      entryId: 'snap-1:s-1/Album',
      matchingFileCount: 1,
      expanded: false,
    });
  });

  it('expanding a folder splices its children in below it, one level deeper', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result } = setup({ read });
    act(() =>
      result.current.tree.toggle(nodeAt(result.current.tree.rows, ['s-1'])),
    );
    await waitFor(() =>
      expect(result.current.tree.rows.map(r => r.kind)).toContain('folder'),
    );

    act(() =>
      result.current.tree.toggle(
        nodeAt(result.current.tree.rows, ['s-1', 'Album']),
      ),
    );
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('folder:2:2024 +'),
    );
    act(() =>
      result.current.tree.toggle(
        nodeAt(result.current.tree.rows, ['s-1', 'Album', '2025']),
      ),
    );

    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toEqual([
        'source:0:Camera -',
        'folder:1:Album -',
        'folder:2:2024 +',
        'folder:2:2025 -',
        'file:3:b1.jpg',
        'file:3:clip.mp4',
        'file:3:new.jpg',
        'folder:2:Docs +',
        'folder:1:Empty +',
        'file:1:big.jpg',
        'file:1:Loose.jpg',
        'source:0:Downloads +',
      ]),
    );
    expect(read).toHaveBeenCalledWith(
      'snap-1',
      expect.objectContaining({
        parentId: 'snap-1:s-1/Album/2025',
        kind: 'FILE',
      }),
      null,
    );
    expect(result.current.state.expanded).toEqual([
      ['s-1'],
      ['s-1', 'Album'],
      ['s-1', 'Album', '2025'],
    ]);
    expect(
      rowAt(result.current.tree.rows, ['s-1', 'Album', '2025', 'new.jpg']),
    ).toMatchObject({ kind: 'file', depth: 3 });
  });

  it('a folder with no matching files is listed and still expands', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result } = setup({ read, filter: 'UNSYNCED' });
    act(() =>
      result.current.tree.toggle(nodeAt(result.current.tree.rows, ['s-1'])),
    );
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('folder:1:Empty +'),
    );

    expect(rowAt(result.current.tree.rows, ['s-1', 'Empty'])).toMatchObject({
      matchingFileCount: 0,
    });
    act(() =>
      result.current.tree.toggle(
        nodeAt(result.current.tree.rows, ['s-1', 'Empty']),
      ),
    );
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('folder:1:Empty -'),
    );
    expect(read).toHaveBeenCalledWith(
      'snap-1',
      expect.objectContaining({
        filter: 'UNSYNCED',
        parentId: 'snap-1:s-1/Empty',
        kind: 'DIRECTORY',
      }),
      null,
    );
  });

  it('collapsing removes the rows beneath, forgets nested expansions and drops the pages', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result } = setup({
      read,
      initialState: {
        expanded: [['s-1'], ['s-1', 'Album'], ['s-1', 'Album', '2024']],
        anchor: null,
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:a2.jpg'),
    );
    const reads = read.mock.calls.length;

    act(() =>
      result.current.tree.toggle(
        nodeAt(result.current.tree.rows, ['s-1', 'Album']),
      ),
    );

    expect(shape(result.current.tree.rows)).toEqual([
      'source:0:Camera -',
      'folder:1:Album +',
      'folder:1:Empty +',
      'file:1:big.jpg',
      'file:1:Loose.jpg',
      'source:0:Downloads +',
    ]);
    expect(result.current.state.expanded).toEqual([['s-1']]);

    // Expanding again reads the folder again: its pages were dropped.
    act(() =>
      result.current.tree.toggle(
        nodeAt(result.current.tree.rows, ['s-1', 'Album']),
      ),
    );
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('folder:2:2024 +'),
    );
    expect(read.mock.calls.length).toBeGreaterThan(reads);
    expect(shape(result.current.tree.rows)).not.toContain('file:3:a2.jpg');
  });

  it('ends a folder with more than one page in a "more" row that reads the next page with its token', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 }, 2);
    const { result } = setup({
      read,
      initialState: {
        expanded: [['s-1'], ['s-1', 'Album'], ['s-1', 'Album', '2025']],
        anchor: null,
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:b1.jpg'),
    );
    const rows = result.current.tree.rows;
    const at2025 = rows.findIndex(
      r => r.key === rowAt(rows, ['s-1', 'Album', '2025']).key,
    );
    expect(shape(rows.slice(at2025, at2025 + 4))).toEqual([
      'folder:2:2025 -',
      'file:3:b1.jpg',
      'file:3:clip.mp4',
      'more:3:s-1/Album/2025',
    ]);
    const more = rows[at2025 + 3] as TreeMoreRow;
    expect(more.nextPageToken).toBe('snap-1:snap-1:s-1/Album/2025:FILE#2');

    act(() => result.current.tree.loadMore(more));

    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:new.jpg'),
    );
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({
        parentId: 'snap-1:s-1/Album/2025',
        kind: 'FILE',
      }),
      'snap-1:snap-1:s-1/Album/2025:FILE#2',
    );
    expect(shape(result.current.tree.rows)).not.toContain(
      'more:3:s-1/Album/2025',
    );
  });

  it('a "more" row after the folders reads the next folder page, then the files', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 }, 2);
    const { result } = setup({
      read,
      initialState: { expanded: [['s-1'], ['s-1', 'Album']], anchor: null },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('more:2:s-1/Album'),
    );
    expect(shape(result.current.tree.rows)).not.toContain('folder:2:Docs +');
    const more = result.current.tree.rows.find(
      (r): r is TreeMoreRow => r.kind === 'more' && r.depth === 2,
    ) as TreeMoreRow;

    act(() => result.current.tree.loadMore(more));

    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('folder:2:Docs +'),
    );
    expect(shape(result.current.tree.rows)).not.toContain('more:2:s-1/Album');
  });

  it('re-reads the expanded folders when the filter or the sort changes', async () => {
    const read = fakeReader({ 'snap-1': SNAP_1 });
    const { result, rerender } = setup({
      read,
      initialState: { expanded: [['s-1']], anchor: null },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:1:Loose.jpg'),
    );

    rerender({ sort: 'SIZE_DESC' });

    await waitFor(() =>
      expect(
        shape(result.current.tree.rows).filter(s => s.startsWith('file')),
      ).toEqual(['file:1:big.jpg', 'file:1:Loose.jpg']),
    );
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ sort: 'SIZE_DESC', kind: 'FILE' }),
      null,
    );
    expect(result.current.state.expanded).toEqual([['s-1']]);
  });

  it.each([
    CloudSyncErrorCode.STALE_GENERATION,
    CloudSyncErrorCode.SNAPSHOT_NOT_FOUND,
    CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
  ])(
    '%s calls onSnapshotLost once and reads the tree again, like list view',
    async code => {
      const fake = fakeReader({ 'snap-1': SNAP_1 });
      const read = jest
        .fn<ReturnType<PageReader>, Parameters<PageReader>>(fake)
        .mockResolvedValueOnce(fail(code));
      const onSnapshotLost = jest.fn(async () => {});
      const { result } = setup({
        read,
        onSnapshotLost,
        initialState: { expanded: [['s-1']], anchor: null },
      });

      await waitFor(() =>
        expect(shape(result.current.tree.rows)).toContain('file:1:Loose.jpg'),
      );
      expect(onSnapshotLost).toHaveBeenCalledTimes(1);
      expect(result.current.tree.error).toBeNull();
      expect(result.current.state.expanded).toEqual([['s-1']]);
    },
  );

  it('a second loss right after the recovery is an error, and retry reads again', async () => {
    const fake = fakeReader({ 'snap-1': SNAP_1 });
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>(fake)
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.STALE_GENERATION))
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.STALE_GENERATION));
    const onSnapshotLost = jest.fn(async () => {});
    const { result } = setup({
      read,
      onSnapshotLost,
      initialState: { expanded: [['s-1']], anchor: null },
    });

    await waitFor(() =>
      expect(result.current.tree.error?.code).toBe(
        CloudSyncErrorCode.STALE_GENERATION,
      ),
    );
    expect(onSnapshotLost).toHaveBeenCalledTimes(1);

    act(() => result.current.tree.retry());

    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:1:Loose.jpg'),
    );
    expect(result.current.tree.error).toBeNull();
  });

  it('on a new snapshot re-reads every still-expanded name path in order and drops the gone ones', async () => {
    const snap2: FakeSnapshot = {
      's-1': [
        file('Loose.jpg', 5),
        dir('Album', [
          // 2024 is gone; 2025 is still there, with a new file.
          dir('2025', [file('b1.jpg', 3), file('c0.jpg', 1)]),
          dir('Docs', [file('doc.pdf')], 0),
        ]),
      ],
      's-2': [file('x.jpg')],
    };
    const read = fakeReader({ 'snap-1': SNAP_1, 'snap-2': snap2 });
    const { result, rerender } = setup({
      read,
      initialState: {
        expanded: [
          ['s-1'],
          ['s-1', 'Album'],
          ['s-1', 'Album', '2024'],
          ['s-1', 'Album', '2025'],
        ],
        anchor: null,
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:a1.jpg'),
    );
    read.mockClear();

    rerender({ snapshotId: 'snap-2' });

    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toEqual([
        'source:0:Camera -',
        'folder:1:Album -',
        'folder:2:2025 -',
        'file:3:b1.jpg',
        'file:3:c0.jpg',
        'folder:2:Docs +',
        'file:1:Loose.jpg',
        'source:0:Downloads +',
      ]),
    );
    expect(result.current.state.expanded).toEqual([
      ['s-1'],
      ['s-1', 'Album'],
      ['s-1', 'Album', '2025'],
    ]);
    // Parents before children: each folder's ID is found by name in its parent.
    const parents = read.mock.calls.map(([, query]) => query.parentId ?? null);
    expect(parents.indexOf(null)).toBeLessThan(
      parents.indexOf('snap-2:s-1/Album'),
    );
    expect(parents.indexOf('snap-2:s-1/Album')).toBeLessThan(
      parents.indexOf('snap-2:s-1/Album/2025'),
    );
    expect(
      read.mock.calls.every(([snapshotId]) => snapshotId === 'snap-2'),
    ).toBe(true);
    expect(rowAt(result.current.tree.rows, ['s-1', 'Album'])).toMatchObject({
      entryId: 'snap-2:s-1/Album',
    });
  });

  it('drops the descendants of a gone folder too', async () => {
    const snap2: FakeSnapshot = {
      's-1': [file('Loose.jpg', 5)],
      's-2': [file('x.jpg')],
    };
    const read = fakeReader({ 'snap-1': SNAP_1, 'snap-2': snap2 });
    const { result, rerender } = setup({
      read,
      initialState: {
        expanded: [['s-1'], ['s-1', 'Album'], ['s-1', 'Album', '2025']],
        anchor: null,
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:b1.jpg'),
    );

    rerender({ snapshotId: 'snap-2' });

    await waitFor(() =>
      expect(result.current.state.expanded).toEqual([['s-1']]),
    );
    expect(shape(result.current.tree.rows)).toEqual([
      'source:0:Camera -',
      'file:1:Loose.jpg',
      'source:0:Downloads +',
    ]);
  });

  it('re-finds the anchor row by its name path on a new snapshot', async () => {
    const snap2: FakeSnapshot = {
      's-1': [
        dir('Album', [
          dir('2024', [file('a1.jpg'), file('a2.jpg')]),
          dir('2025', [
            file('b0.jpg', 3),
            file('b1.jpg', 3),
            file('new.jpg', 9),
          ]),
        ]),
        dir('Aardvark', []),
      ],
      's-2': [file('x.jpg')],
    };
    const read = fakeReader({ 'snap-1': SNAP_1, 'snap-2': snap2 });
    const { result, rerender } = setup({
      read,
      initialState: {
        expanded: [['s-1'], ['s-1', 'Album'], ['s-1', 'Album', '2025']],
        anchor: ['s-1', 'Album', '2025', 'new.jpg'],
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:new.jpg'),
    );
    expect(result.current.tree.anchorIndex).toBeNull();

    rerender({ snapshotId: 'snap-2' });

    await waitFor(() => expect(result.current.tree.anchorIndex).not.toBeNull());
    const rows = result.current.tree.rows;
    expect(rows[result.current.tree.anchorIndex as number]).toBe(
      rowAt(rows, ['s-1', 'Album', '2025', 'new.jpg']),
    );
    expect(result.current.tree.snapshotChanged).toBe(true);
  });

  it('re-finds the deepest remaining ancestor when the anchor row is gone', async () => {
    const snap2: FakeSnapshot = {
      's-1': [dir('Album', [dir('2025', [file('b1.jpg', 3)])])],
      's-2': [file('x.jpg')],
    };
    const read = fakeReader({ 'snap-1': SNAP_1, 'snap-2': snap2 });
    const { result, rerender } = setup({
      read,
      initialState: {
        expanded: [['s-1'], ['s-1', 'Album'], ['s-1', 'Album', '2024']],
        anchor: ['s-1', 'Album', '2024', 'a2.jpg'],
      },
    });
    await waitFor(() =>
      expect(shape(result.current.tree.rows)).toContain('file:3:a2.jpg'),
    );

    rerender({ snapshotId: 'snap-2' });

    await waitFor(() => expect(result.current.tree.anchorIndex).not.toBeNull());
    const rows = result.current.tree.rows;
    expect(rows[result.current.tree.anchorIndex as number]).toBe(
      rowAt(rows, ['s-1', 'Album']),
    );
  });
});
