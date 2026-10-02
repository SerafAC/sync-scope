import { act, renderHook, waitFor } from '@testing-library/react-native';

import { queryTreeChildren } from '../../native/CloudSync';
import type {
  FileEntryDto,
  QueryFilesResult,
} from '../../native/CloudSyncContracts';
import {
  ALL_FOLDERS,
  findChildDirectory,
  useListNavigation,
  type FindChildDirectory,
  type UseListNavigationOptions,
} from '../useListNavigation';

jest.mock('../../native/CloudSync', () => ({
  queryTreeChildren: jest.fn(),
}));

const queryTreeChildrenMock = queryTreeChildren as jest.MockedFunction<
  typeof queryTreeChildren
>;

const SOURCES: ReadonlySet<string> = new Set(['source-1', 'source-2']);

type Props = UseListNavigationOptions;

/** Renders the hook; `rerender` takes only the props that change. */
function setup(initial: Partial<Props> = {}) {
  const base: Props = {
    snapshotId: 'snap-1',
    sources: SOURCES,
    findChildDirectory: jest.fn<
      ReturnType<FindChildDirectory>,
      Parameters<FindChildDirectory>
    >(),
    ...initial,
  };
  return renderHook(
    (props: Partial<Props>) => useListNavigation({ ...base, ...props }),
    { initialProps: {} },
  );
}

/** Opens Camera › a › b › c, with entry IDs of snapshot 1. */
function openDeepPath(result: ReturnType<typeof setup>['result']): void {
  act(() => result.current.openSource('source-1', 'Camera'));
  act(() => result.current.openFolder('old-a', 'a'));
  act(() => result.current.openFolder('old-b', 'b'));
  act(() => result.current.openFolder('old-c', 'c'));
}

/** A fake directory tree of snapshot 2, keyed by `parentId/name`. */
function treeFinder(
  tree: Record<string, string>,
): jest.MockedFunction<FindChildDirectory> {
  return jest.fn(async (_snapshotId, _sourceId, parentId, name) => {
    return tree[`${parentId ?? 'root'}/${name}`] ?? null;
  });
}

describe('useListNavigation', () => {
  describe('stack', () => {
    it('starts at the sources list', () => {
      const { result } = setup();

      expect(result.current.location).toEqual({ kind: 'sources' });
      expect(result.current.breadcrumb).toEqual([
        { name: ALL_FOLDERS, index: -1 },
      ]);
      expect(ALL_FOLDERS).toBe('All folders');
    });

    it('opens a source at its root and pushes folders', () => {
      const { result } = setup();

      act(() => result.current.openSource('source-1', 'Camera'));
      expect(result.current.location).toEqual({
        kind: 'folder',
        sourceId: 'source-1',
        alias: 'Camera',
        path: [{ entryId: null, name: 'Camera' }],
      });

      act(() => result.current.openFolder('dir-a', 'album'));
      act(() => result.current.openFolder('dir-b', 'trip'));
      expect(result.current.location).toMatchObject({
        kind: 'folder',
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'dir-a', name: 'album' },
          { entryId: 'dir-b', name: 'trip' },
        ],
      });
    });

    it('goTo truncates the stack, and goTo(-1) returns to the sources', () => {
      const { result } = setup();
      openDeepPath(result);

      act(() => result.current.goTo(1));
      expect(result.current.location).toMatchObject({
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'old-a', name: 'a' },
        ],
      });

      act(() => result.current.goTo(0));
      expect(result.current.location).toMatchObject({
        path: [{ entryId: null, name: 'Camera' }],
      });

      act(() => result.current.goTo(-1));
      expect(result.current.location).toEqual({ kind: 'sources' });
    });

    it('ignores goTo on the current level or past it', () => {
      const { result } = setup();
      openDeepPath(result);
      const before = result.current.location;

      act(() => result.current.goTo(3));
      act(() => result.current.goTo(7));

      expect(result.current.location).toBe(before);
    });

    it('openFolder does nothing at the sources list', () => {
      const { result } = setup();

      act(() => result.current.openFolder('dir-a', 'album'));

      expect(result.current.location).toEqual({ kind: 'sources' });
    });
  });

  describe('breadcrumb', () => {
    it('yields All folders, the alias, then each folder name', () => {
      const { result } = setup();
      openDeepPath(result);

      expect(result.current.breadcrumb).toEqual([
        { name: 'All folders', index: -1 },
        { name: 'Camera', index: 0 },
        { name: 'a', index: 1 },
        { name: 'b', index: 2 },
        { name: 'c', index: 3 },
      ]);
    });
  });

  describe('relocation after a snapshot change', () => {
    it('re-resolves every level by name to the new entry IDs', async () => {
      const find = treeFinder({
        'root/a': 'new-a',
        'new-a/b': 'new-b',
        'new-b/c': 'new-c',
      });
      const { result, rerender } = setup({ findChildDirectory: find });
      openDeepPath(result);
      expect(result.current.snapshotId).toBe('snap-1');

      rerender({ snapshotId: 'snap-2' });
      expect(result.current.relocating).toBe(true);
      await waitFor(() => expect(result.current.relocating).toBe(false));

      expect(result.current.snapshotId).toBe('snap-2');
      expect(result.current.location).toEqual({
        kind: 'folder',
        sourceId: 'source-1',
        alias: 'Camera',
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'new-a', name: 'a' },
          { entryId: 'new-b', name: 'b' },
          { entryId: 'new-c', name: 'c' },
        ],
      });
      expect(find.mock.calls).toEqual([
        ['snap-2', 'source-1', null, 'a'],
        ['snap-2', 'source-1', 'new-a', 'b'],
        ['snap-2', 'source-1', 'new-b', 'c'],
      ]);
    });

    it('stops at the deepest level that still exists', async () => {
      const find = treeFinder({ 'root/a': 'new-a' });
      const { result, rerender } = setup({ findChildDirectory: find });
      openDeepPath(result);

      rerender({ snapshotId: 'snap-2' });
      await waitFor(() => expect(result.current.relocating).toBe(false));

      expect(result.current.location).toMatchObject({
        kind: 'folder',
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'new-a', name: 'a' },
        ],
      });
      expect(find).toHaveBeenCalledTimes(2);
      expect(result.current.snapshotId).toBe('snap-2');
    });

    it('stops at a level whose lookup fails', async () => {
      const find = jest.fn<
        ReturnType<FindChildDirectory>,
        Parameters<FindChildDirectory>
      >(async () => {
        throw new Error('read failed');
      });
      const { result, rerender } = setup({ findChildDirectory: find });
      openDeepPath(result);

      rerender({ snapshotId: 'snap-2' });
      await waitFor(() => expect(result.current.relocating).toBe(false));

      expect(result.current.location).toMatchObject({
        path: [{ entryId: null, name: 'Camera' }],
      });
    });

    it('returns to the sources list when the source was removed', async () => {
      const find = treeFinder({ 'root/a': 'new-a' });
      const { result, rerender } = setup({ findChildDirectory: find });
      openDeepPath(result);

      rerender({ snapshotId: 'snap-2', sources: new Set(['source-2']) });
      await waitFor(() => expect(result.current.relocating).toBe(false));

      expect(result.current.location).toEqual({ kind: 'sources' });
      expect(result.current.snapshotId).toBe('snap-2');
      expect(find).not.toHaveBeenCalled();
    });

    it('keeps the source root without any lookup', async () => {
      const find = treeFinder({});
      const { result, rerender } = setup({ findChildDirectory: find });
      act(() => result.current.openSource('source-1', 'Camera'));

      rerender({ snapshotId: 'snap-2' });
      await waitFor(() => expect(result.current.snapshotId).toBe('snap-2'));

      expect(result.current.location).toMatchObject({
        path: [{ entryId: null, name: 'Camera' }],
      });
      expect(result.current.relocating).toBe(false);
      expect(find).not.toHaveBeenCalled();
    });

    it('needs no lookup at the sources list', async () => {
      const find = treeFinder({});
      const { result, rerender } = setup({ findChildDirectory: find });

      rerender({ snapshotId: 'snap-2' });

      expect(result.current.snapshotId).toBe('snap-2');
      expect(result.current.location).toEqual({ kind: 'sources' });
      expect(find).not.toHaveBeenCalled();
    });

    it('drops a walk superseded by a newer snapshot', async () => {
      let releaseOld!: () => void;
      const oldWalk = new Promise<void>(r => {
        releaseOld = r;
      });
      const find = jest.fn<
        ReturnType<FindChildDirectory>,
        Parameters<FindChildDirectory>
      >(async snapshotId => {
        if (snapshotId === 'snap-2') {
          await oldWalk;
          return 'stale-a';
        }
        return 'fresh-a';
      });
      const { result, rerender } = setup({ findChildDirectory: find });
      act(() => result.current.openSource('source-1', 'Camera'));
      act(() => result.current.openFolder('old-a', 'a'));

      rerender({ snapshotId: 'snap-2' });
      rerender({ snapshotId: 'snap-3' });
      await waitFor(() => expect(result.current.relocating).toBe(false));
      await act(async () => releaseOld());

      expect(result.current.snapshotId).toBe('snap-3');
      expect(result.current.location).toMatchObject({
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'fresh-a', name: 'a' },
        ],
      });
    });

    it('lets the user leave while a walk runs, and the walk does not override it', async () => {
      let release!: (id: string | null) => void;
      const find = jest.fn<
        ReturnType<FindChildDirectory>,
        Parameters<FindChildDirectory>
      >(
        () =>
          new Promise<string | null>(r => {
            release = r;
          }),
      );
      const { result, rerender } = setup({ findChildDirectory: find });
      openDeepPath(result);

      rerender({ snapshotId: 'snap-2' });
      act(() => result.current.goTo(-1));
      await act(async () => release('new-a'));

      expect(result.current.location).toEqual({ kind: 'sources' });
      expect(result.current.snapshotId).toBe('snap-2');
      expect(result.current.relocating).toBe(false);
    });

    it('relocate() re-runs the walk on demand', async () => {
      const find = treeFinder({ 'root/a': 'new-a' });
      const { result } = setup({ findChildDirectory: find });
      act(() => result.current.openSource('source-1', 'Camera'));
      act(() => result.current.openFolder('old-a', 'a'));

      await act(async () => result.current.relocate());

      expect(result.current.location).toMatchObject({
        path: [
          { entryId: null, name: 'Camera' },
          { entryId: 'new-a', name: 'a' },
        ],
      });
    });
  });
});

describe('findChildDirectory', () => {
  function row(
    entryId: string,
    name: string,
    kind: FileEntryDto['kind'] = 'DIRECTORY',
  ): FileEntryDto {
    return {
      entryId,
      sourceId: 'source-1',
      parentId: 'parent',
      kind,
      name,
      mimeType: null,
      sizeBytes: null,
      modifiedUtcMillis: null,
      status: 'SYNCED',
      issueCode: null,
      nameInOtherSource: false,
      matchingFileCount: 1,
    };
  }

  function page(
    entries: FileEntryDto[],
    nextPageToken: string | null,
  ): QueryFilesResult {
    return {
      contractVersion: 4,
      status: 'ok',
      page: { entries, nextPageToken, counts: null },
    };
  }

  beforeEach(() => jest.clearAllMocks());

  it('searches the parent by name with the relocation query', async () => {
    queryTreeChildrenMock.mockResolvedValue(page([row('id-a', 'album')], null));

    await expect(
      findChildDirectory('snap-2', 'source-1', 'parent', 'album'),
    ).resolves.toBe('id-a');

    expect(queryTreeChildrenMock).toHaveBeenCalledWith(
      'snap-2',
      'parent',
      {
        filter: 'ALL',
        view: 'LIST',
        sort: 'NAME_ASC',
        sourceId: 'source-1',
        search: 'album',
        pageSize: 200,
      },
      null,
    );
  });

  it('matches the exact name only, and directories only', async () => {
    queryTreeChildrenMock.mockResolvedValue(
      page(
        [
          row('id-file', 'album', 'FILE'),
          row('id-album2', 'album2'),
          row('id-myalbum', 'myalbum'),
          row('id-upper', 'Album'),
        ],
        null,
      ),
    );

    await expect(
      findChildDirectory('snap-2', 'source-1', null, 'album'),
    ).resolves.toBeNull();
  });

  it('follows the next page tokens until the exact match is found', async () => {
    const decoys = Array.from({ length: 200 }, (_, i) =>
      row(`decoy-${i}`, `a${String(i).padStart(3, '0')}`),
    );
    queryTreeChildrenMock
      .mockResolvedValueOnce(page(decoys, 'tok-2'))
      .mockResolvedValueOnce(page([row('id-a', 'a')], 'tok-3'));

    await expect(
      findChildDirectory('snap-2', 'source-1', null, 'a'),
    ).resolves.toBe('id-a');

    expect(queryTreeChildrenMock).toHaveBeenCalledTimes(2);
    expect(queryTreeChildrenMock).toHaveBeenLastCalledWith(
      'snap-2',
      null,
      expect.objectContaining({ search: 'a' }),
      'tok-2',
    );
  });

  it('gives up only after the last page', async () => {
    const decoys = Array.from({ length: 200 }, (_, i) =>
      row(`d-${i}`, `xa${i}`),
    );
    queryTreeChildrenMock
      .mockResolvedValueOnce(page(decoys, 'tok-2'))
      .mockResolvedValueOnce(page([row('d-last', 'ab')], null));

    await expect(
      findChildDirectory('snap-2', 'source-1', null, 'a'),
    ).resolves.toBeNull();

    expect(queryTreeChildrenMock).toHaveBeenCalledTimes(2);
  });

  it('rejects when a page cannot be read', async () => {
    queryTreeChildrenMock.mockResolvedValue({
      contractVersion: 4,
      status: 'error',
      error: { code: 'SNAPSHOT_NOT_FOUND', message: 'gone', action: null },
    });

    await expect(
      findChildDirectory('snap-2', 'source-1', null, 'a'),
    ).rejects.toThrow('SNAPSHOT_NOT_FOUND');
  });
});
