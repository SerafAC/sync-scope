import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  CloudSyncErrorCode,
  type FileEntryDto,
  type QueryFilesResult,
  type QuerySpec,
  type StatusCountDto,
} from '../../native/CloudSyncContracts';
import {
  PAGED_QUERY_PAGE_SIZE,
  usePagedQuery,
  type PageReader,
  type UsePagedQueryOptions,
} from '../usePagedQuery';

function entry(entryId: string, overrides: Partial<FileEntryDto> = {}) {
  return {
    entryId,
    sourceId: 'source-1',
    parentId: null,
    kind: 'FILE',
    name: `${entryId}.png`,
    mimeType: 'image/png',
    sizeBytes: 1,
    modifiedUtcMillis: 1,
    status: 'SYNCED',
    issueCode: null,
    nameInOtherSource: false,
    matchingFileCount: null,
    ...overrides,
  } satisfies FileEntryDto;
}

const COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 2 },
];

function ok(
  entries: FileEntryDto[],
  nextPageToken: string | null,
  counts: StatusCountDto[] | null = null,
): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'ok',
    page: { entries, nextPageToken, counts },
  };
}

function fail(code: string): QueryFilesResult {
  return {
    contractVersion: 4,
    status: 'error',
    error: { code, message: `failed: ${code}`, action: null },
  };
}

/** A promise the test resolves by hand, to order responses. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => {
    resolve = r;
  });
  return { promise, resolve };
}

const GALLERY: QuerySpec = {
  filter: 'ALL',
  view: 'GALLERY',
  sort: 'TIME_DESC',
};

type Props = UsePagedQueryOptions;

/** Renders the hook; `rerender` takes only the props that change. */
function setup(initial: Partial<Props> & { read: PageReader }) {
  const base: Props = {
    snapshotId: 'snap-1',
    query: GALLERY,
    onSnapshotLost: jest.fn(),
    ...initial,
  };
  return renderHook(
    (props: Partial<Props>) => usePagedQuery({ ...base, ...props }),
    { initialProps: {} },
  );
}

describe('usePagedQuery', () => {
  it('loads page 1 with its counts, and requests 100 rows per page', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValue(ok([entry('a'), entry('b')], 'tok-2', COUNTS));
    const { result } = setup({ read });

    expect(result.current.phase).toBe('loading-first');
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.entries.map(e => e.entryId)).toEqual(['a', 'b']);
    expect(result.current.counts).toEqual(COUNTS);
    expect(result.current.error).toBeNull();
    expect(result.current.snapshotChanged).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: PAGED_QUERY_PAGE_SIZE },
      null,
    );
    expect(PAGED_QUERY_PAGE_SIZE).toBe(100);
  });

  it('appends page 2 on loadMore and keeps the page-1 counts', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(ok([entry('a')], 'tok-2', COUNTS))
      .mockResolvedValueOnce(ok([entry('b')], null, null));
    const { result } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => result.current.loadMore());
    expect(result.current.phase).toBe('loading-more');
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.entries.map(e => e.entryId)).toEqual(['a', 'b']);
    expect(result.current.counts).toEqual(COUNTS);
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      'tok-2',
    );
  });

  it('ignores loadMore with no next token', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValue(ok([entry('a')], null, COUNTS));
    const { result } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => result.current.loadMore());

    expect(result.current.phase).toBe('ready');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('ignores loadMore while a page is loading', async () => {
    const first = deferred<QueryFilesResult>();
    const second = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = setup({ read });

    act(() => result.current.loadMore());
    expect(read).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(ok([entry('a')], 'tok-2', COUNTS)));
    act(() => {
      result.current.loadMore();
      result.current.loadMore();
    });
    act(() => result.current.loadMore());

    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(ok([entry('b')], null)));
    expect(result.current.entries.map(e => e.entryId)).toEqual(['a', 'b']);
  });

  it('drops the rows on a snapshot change, reloads, and reports it once', async () => {
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      async snapshotId => ok([entry(`${snapshotId}-row`)], null, COUNTS),
    );
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({
      snapshotId: 'snap-2',
      query: GALLERY,
      onSnapshotLost: jest.fn(),
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.phase).toBe('loading-first');
    expect(result.current.snapshotChanged).toBe(true);
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.entries.map(e => e.entryId)).toEqual(['snap-2-row']);
    expect(read).toHaveBeenLastCalledWith(
      'snap-2',
      { ...GALLERY, pageSize: 100 },
      null,
    );

    act(() => result.current.acknowledgeSnapshotChange());
    expect(result.current.snapshotChanged).toBe(false);

    // Nothing else changed: the signal is not raised again.
    rerender({
      snapshotId: 'snap-2',
      query: { ...GALLERY },
      onSnapshotLost: jest.fn(),
    });
    expect(result.current.snapshotChanged).toBe(false);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('does not report a snapshot change when no rows were shown', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValue(ok([], null, []));
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({
      snapshotId: 'snap-2',
      query: GALLERY,
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.snapshotChanged).toBe(false);
  });

  it('does not report a snapshot change while page 1 was still loading', async () => {
    const never = new Promise<QueryFilesResult>(() => {});
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockReturnValueOnce(never)
      .mockResolvedValueOnce(ok([entry('x')], null, COUNTS));
    const { result, rerender } = setup({ read });

    rerender({
      snapshotId: 'snap-2',
      query: GALLERY,
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.snapshotChanged).toBe(false);
  });

  it('ignores a late page-2 response for the old snapshot', async () => {
    const lateMore = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(ok([entry('old-a')], 'tok-2', COUNTS))
      .mockReturnValueOnce(lateMore.promise)
      .mockResolvedValueOnce(ok([entry('new-a')], null, COUNTS));
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.loadMore());

    rerender({
      snapshotId: 'snap-2',
      query: GALLERY,
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => lateMore.resolve(ok([entry('old-b')], null)));

    expect(result.current.entries.map(e => e.entryId)).toEqual(['new-a']);
    expect(result.current.phase).toBe('ready');
  });

  it('ignores a late page-2 response for the old query', async () => {
    const lateMore = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(ok([entry('all-a')], 'tok-2', COUNTS))
      .mockReturnValueOnce(lateMore.promise)
      .mockResolvedValueOnce(ok([entry('synced-a')], null, COUNTS));
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => result.current.loadMore());

    rerender({
      snapshotId: 'snap-1',
      query: { ...GALLERY, filter: 'SYNCED' },
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => lateMore.resolve(ok([entry('all-b')], null)));

    expect(result.current.entries.map(e => e.entryId)).toEqual(['synced-a']);
  });

  it('ignores an out-of-order page 1 of an earlier filter', async () => {
    const slowAll = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockReturnValueOnce(slowAll.promise)
      .mockResolvedValueOnce(ok([entry('synced-a')], null, COUNTS));
    const { result, rerender } = setup({ read });

    rerender({
      snapshotId: 'snap-1',
      query: { ...GALLERY, filter: 'SYNCED' },
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => slowAll.resolve(ok([entry('all-a')], null, COUNTS)));

    expect(result.current.entries.map(e => e.entryId)).toEqual(['synced-a']);
  });

  it('reloads on a query change without reporting a snapshot change', async () => {
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      async (_snapshotId, query) =>
        ok([entry(`${query.filter}-row`)], null, COUNTS),
    );
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({
      snapshotId: 'snap-1',
      query: { ...GALLERY, filter: 'UNSYNCED' },
      onSnapshotLost: jest.fn(),
    });

    expect(result.current.entries).toEqual([]);
    expect(result.current.phase).toBe('loading-first');
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.entries.map(e => e.entryId)).toEqual([
      'UNSYNCED-row',
    ]);
    expect(result.current.snapshotChanged).toBe(false);
  });

  it('reloads page 1 of the same read when reloadKey changes, without reporting a snapshot change', async () => {
    let rows = ['a', 'b', 'c'];
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      async () => ok(rows.map(id => entry(id)), null, COUNTS),
    );
    const { result, rerender } = setup({ read, reloadKey: 0 });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(read).toHaveBeenCalledTimes(1);

    rows = ['c'];
    rerender({ reloadKey: 1 });

    await waitFor(() =>
      expect(result.current.entries.map(e => e.entryId)).toEqual(['c']),
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ filter: 'ALL' }),
      null,
    );
    expect(result.current.snapshotChanged).toBe(false);
  });

  it('reloads when the parent folder changes', async () => {
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      async (_snapshotId, query) =>
        ok([entry(`${query.parentId ?? 'root'}-row`)], null, COUNTS),
    );
    const list: QuerySpec = {
      filter: 'ALL',
      view: 'LIST',
      sort: 'NAME_ASC',
      sourceId: 'source-1',
      parentId: null,
    };
    const { result, rerender } = setup({ read, query: list });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({
      snapshotId: 'snap-1',
      query: { ...list, parentId: 'dir-1' },
      onSnapshotLost: jest.fn(),
    });
    await waitFor(() =>
      expect(result.current.entries.map(e => e.entryId)).toEqual(['dir-1-row']),
    );
    expect(result.current.snapshotChanged).toBe(false);
  });

  it('treats an equal query with a different key order as the same query', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValue(ok([entry('a')], null, COUNTS));
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({
      snapshotId: 'snap-1',
      query: { sort: 'TIME_DESC', view: 'GALLERY', filter: 'ALL' },
      onSnapshotLost: jest.fn(),
    });

    expect(result.current.phase).toBe('ready');
    expect(read).toHaveBeenCalledTimes(1);
  });

  it.each([
    CloudSyncErrorCode.SNAPSHOT_NOT_FOUND,
    CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
    CloudSyncErrorCode.STALE_GENERATION,
  ])(
    '%s calls onSnapshotLost once and reloads once the snapshot ID updates',
    async code => {
      const refreshed = deferred<void>();
      const onSnapshotLost = jest.fn(() => refreshed.promise);
      const read = jest
        .fn<ReturnType<PageReader>, Parameters<PageReader>>()
        .mockResolvedValueOnce(ok([entry('a')], 'tok-2', COUNTS))
        .mockResolvedValueOnce(fail(code))
        .mockResolvedValueOnce(ok([entry('fresh')], null, COUNTS));
      const { result, rerender } = setup({ read, onSnapshotLost });
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      act(() => result.current.loadMore());
      await waitFor(() => expect(onSnapshotLost).toHaveBeenCalledTimes(1));
      expect(result.current.phase).not.toBe('error');
      expect(result.current.entries).toEqual([]);

      rerender({ snapshotId: 'snap-2', query: GALLERY, onSnapshotLost });
      await act(async () => refreshed.resolve());
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      expect(result.current.entries.map(e => e.entryId)).toEqual(['fresh']);
      expect(result.current.snapshotChanged).toBe(true);
      expect(onSnapshotLost).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledTimes(3);
      expect(read).toHaveBeenLastCalledWith(
        'snap-2',
        { ...GALLERY, pageSize: 100 },
        null,
      );
    },
  );

  it('reloads page 1 once when the refresh keeps the same snapshot, then gives up with an error', async () => {
    const onSnapshotLost = jest.fn(async () => {});
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.PAGE_TOKEN_MISMATCH))
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.PAGE_TOKEN_MISMATCH));
    const { result } = setup({ read, onSnapshotLost });

    await waitFor(() => expect(result.current.phase).toBe('error'));

    expect(onSnapshotLost).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenNthCalledWith(
      2,
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      null,
    );
    expect(result.current.error?.code).toBe(
      CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
    );
  });

  it('sets the error phase for any other error, and retry reloads', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.INTERNAL_ERROR))
      .mockResolvedValueOnce(ok([entry('a')], null, COUNTS));
    const onSnapshotLost = jest.fn();
    const { result } = setup({ read, onSnapshotLost });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error).toEqual({
      code: CloudSyncErrorCode.INTERNAL_ERROR,
      message: 'failed: INTERNAL_ERROR',
      action: null,
    });
    expect(onSnapshotLost).not.toHaveBeenCalled();

    act(() => result.current.retry());
    expect(result.current.phase).toBe('loading-first');
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.entries.map(e => e.entryId)).toEqual(['a']);
    expect(result.current.error).toBeNull();
  });

  it('keeps the shown rows when page 2 fails, and retry fetches page 2 again', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(ok([entry('a')], 'tok-2', COUNTS))
      .mockResolvedValueOnce(fail(CloudSyncErrorCode.INTERNAL_ERROR))
      .mockResolvedValueOnce(ok([entry('b')], null));
    const { result } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.entries.map(e => e.entryId)).toEqual(['a']);

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.entries.map(e => e.entryId)).toEqual(['a', 'b']);
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      'tok-2',
    );
  });

  it('turns a thrown read into an INTERNAL_ERROR', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockRejectedValue(new Error('boom'));
    const { result } = setup({ read });

    await waitFor(() => expect(result.current.phase).toBe('error'));
    expect(result.current.error?.code).toBe(CloudSyncErrorCode.INTERNAL_ERROR);
  });

  it('stays idle and never reads while there is no snapshot', async () => {
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>();
    const { result } = setup({ read, snapshotId: null });

    await act(async () => {});

    expect(result.current.phase).toBe('idle');
    expect(result.current.entries).toEqual([]);
    expect(result.current.counts).toBeNull();
    act(() => {
      result.current.loadMore();
      result.current.retry();
    });
    expect(read).not.toHaveBeenCalled();
  });

  it('drops the rows when the snapshot goes away', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValue(ok([entry('a')], null, COUNTS));
    const { result, rerender } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ snapshotId: null, query: GALLERY, onSnapshotLost: jest.fn() });

    expect(result.current.phase).toBe('idle');
    expect(result.current.entries).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('ignores a response that arrives after unmount', async () => {
    const pending = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockReturnValue(pending.promise);
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { unmount } = setup({ read });
      unmount();
      await act(async () => pending.resolve(ok([entry('a')], null, COUNTS)));
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
