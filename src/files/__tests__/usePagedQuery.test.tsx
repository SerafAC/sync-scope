import { act, renderHook, waitFor } from '@testing-library/react-native';

import {
  CloudSyncErrorCode,
  type FileEntryDto,
  type QueryFilesResult,
  type QuerySpec,
  type ScrollIndexResult,
  type StatusCountDto,
} from '../../native/CloudSyncContracts';
import {
  isPlaceholder,
  PAGED_QUERY_PAGE_SIZE,
  usePagedQuery,
  type IndexReader,
  type PagedRow,
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
    sortName: `1${entryId}.png`,
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

  it('reports hasMore while a next token exists', async () => {
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockResolvedValueOnce(ok([entry('a')], 'token-2'))
      .mockResolvedValueOnce(ok([entry('b')], null));
    const { result } = setup({ read });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());

    await waitFor(() => expect(result.current.entries).toHaveLength(2));
    expect(result.current.hasMore).toBe(false);
  });

  describe('enabled (research R3: the list holds its file read)', () => {
    it('holds idle without reading while disabled, then reads page 1', async () => {
      const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
        async () => ok([entry('a')], null, COUNTS),
      );
      const { result, rerender } = setup({ read, enabled: false });

      expect(result.current.phase).toBe('idle');
      expect(result.current.entries).toEqual([]);
      expect(result.current.hasMore).toBe(false);
      act(() => result.current.loadMore());
      expect(read).not.toHaveBeenCalled();

      rerender({ enabled: true });

      expect(result.current.phase).toBe('loading-first');
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      expect(result.current.entries.map(e => e.entryId)).toEqual(['a']);
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('drops the rows when disabled again', async () => {
      const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
        async () => ok([entry('a')], null, COUNTS),
      );
      const { result, rerender } = setup({ read });
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      rerender({ enabled: false });

      expect(result.current.phase).toBe('idle');
      expect(result.current.entries).toEqual([]);
      expect(result.current.counts).toBeNull();
    });

    it('still reports a snapshot change that happened while it was held', async () => {
      const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
        async snapshotId => ok([entry(`${snapshotId}-row`)], null, COUNTS),
      );
      const { result, rerender } = setup({ read });
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      rerender({ snapshotId: 'snap-2', enabled: false });
      expect(result.current.snapshotChanged).toBe(false);
      expect(result.current.entries).toEqual([]);

      rerender({ snapshotId: 'snap-2', enabled: true });

      expect(result.current.snapshotChanged).toBe(true);
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      expect(result.current.entries.map(e => e.entryId)).toEqual([
        'snap-2-row',
      ]);
    });

    it('ignores a page that arrives after it was disabled', async () => {
      const page1 = deferred<QueryFilesResult>();
      const read = jest
        .fn<ReturnType<PageReader>, Parameters<PageReader>>()
        .mockReturnValueOnce(page1.promise);
      const { result, rerender } = setup({ read });

      rerender({ enabled: false });
      await act(async () => page1.resolve(ok([entry('late')], null)));

      expect(result.current.phase).toBe('idle');
      expect(result.current.entries).toEqual([]);
    });
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
      async () =>
        ok(
          rows.map(id => entry(id)),
          null,
          COUNTS,
        ),
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

/**
 * A fake snapshot of [total] files `f0`…: a token `at-<i>` (or a band's
 * start token, which is the same) reads from row i, 100 rows per page.
 */
function fileRows(total: number): FileEntryDto[] {
  return Array.from({ length: total }, (_, i) => entry(`f${i}`));
}

function pagedReader(
  files: FileEntryDto[],
  folders: FileEntryDto[] = [],
): jest.Mock<ReturnType<PageReader>, Parameters<PageReader>> {
  return jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
    async (_snapshotId, query, pageToken) => {
      const rows = query.kind === 'DIRECTORY' ? folders : files;
      const start = pageToken == null ? 0 : Number(pageToken.split('-')[1]);
      const end = Math.min(rows.length, start + PAGED_QUERY_PAGE_SIZE);
      return ok(
        rows.slice(start, end),
        end < rows.length ? `at-${end}` : null,
        pageToken == null ? COUNTS : null,
      );
    },
  );
}

/** An index of consecutive bands with the given counts; band k starts at token `at-<start>`. */
function index(counts: number[]): ScrollIndexResult {
  let start = 0;
  const bands = counts.map((count, k) => {
    const band = {
      startIndex: start,
      count,
      startToken: k === 0 ? null : `at-${start}`,
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

function idsOf(rows: readonly PagedRow[]): string[] {
  return rows.map(row => (isPlaceholder(row) ? '_' : row.entryId));
}

describe('usePagedQuery segments (007 research R7)', () => {
  it('requests page 1 and the index together, and behaves as today before the index arrives', async () => {
    const pending = deferred<ScrollIndexResult>();
    const readIndex = jest.fn<ReturnType<IndexReader>, Parameters<IndexReader>>(
      () => pending.promise,
    );
    const read = pagedReader(fileRows(250));
    const { result } = setup({ read, readIndex });

    expect(read).toHaveBeenCalledTimes(1);
    expect(readIndex).toHaveBeenCalledTimes(1);
    expect(readIndex).toHaveBeenCalledWith('snap-1', {
      ...GALLERY,
      pageSize: PAGED_QUERY_PAGE_SIZE,
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.scrollIndex).toBeNull();
    expect(result.current.rows).toHaveLength(100);
    expect(result.current.rows).toEqual(result.current.entries);
    expect(result.current.hasMore).toBe(true);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      'at-100',
    );
  });

  it('gives the result its full length once the index arrives: loaded rows plus placeholders', async () => {
    const read = pagedReader(fileRows(250));
    const readIndex = jest.fn(async () => index([30, 120, 100]));
    const { result } = setup({ read, readIndex });

    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    const rows = result.current.rows;
    expect(rows).toHaveLength(250);
    // Page 1 (100 rows) fills band 0 and the first 70 rows of band 1.
    expect(idsOf(rows.slice(0, 100))).toEqual(
      fileRows(100).map(e => e.entryId),
    );
    expect(rows.slice(100).every(isPlaceholder)).toBe(true);
    expect(result.current.entries).toHaveLength(100);
    expect(result.current.hasMore).toBe(true);
    expect(result.current.bandStarts).toEqual([0, 30, 150]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('places a page 1 that arrives after the index into the bands', async () => {
    const page1 = deferred<QueryFilesResult>();
    const read = jest
      .fn<ReturnType<PageReader>, Parameters<PageReader>>()
      .mockReturnValueOnce(page1.promise);
    const readIndex = jest.fn(async () => index([60, 60]));
    const { result } = setup({ read, readIndex });

    await act(async () => {});
    expect(result.current.phase).toBe('loading-first');

    await act(async () => page1.resolve(ok(fileRows(100), 'at-100', COUNTS)));

    expect(result.current.phase).toBe('ready');
    expect(result.current.rows).toHaveLength(120);
    expect(idsOf(result.current.rows.slice(95, 105))).toEqual([
      'f95',
      'f96',
      'f97',
      'f98',
      'f99',
      '_',
      '_',
      '_',
      '_',
      '_',
    ]);
    expect(result.current.counts).toEqual(COUNTS);
  });

  it('loadBand reads a band from its start token until its count is in, and never twice at once', async () => {
    const read = pagedReader(fileRows(500));
    const readIndex = jest.fn(async () => index([50, 250, 200]));
    const { result } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    read.mockClear();

    act(() => {
      result.current.loadBand(2);
      result.current.loadBand(2);
    });
    act(() => result.current.loadBand(2));
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      'at-300',
    );

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    // 200 rows: two pages from the band's start token, then it stops.
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(
      'snap-1',
      { ...GALLERY, pageSize: 100 },
      'at-400',
    );
    expect(idsOf(result.current.rows.slice(300))).toEqual(
      fileRows(500)
        .slice(300)
        .map(e => e.entryId),
    );
    // Band 1 is still placeholders past page 1.
    expect(idsOf(result.current.rows.slice(150, 150 + 1))[0] === '_').toBe(
      true,
    );

    act(() => result.current.loadBand(2));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('loadRange reads the bands a visible range touches, in rows of the whole result', async () => {
    const read = pagedReader(fileRows(500));
    const readIndex = jest.fn(async () => index([50, 250, 200]));
    const { result } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    read.mockClear();

    act(() => result.current.loadRange(290, 320));

    await waitFor(() => expect(result.current.phase).toBe('ready'));
    // Band 1 continues from page 1's next token up to row 290; band 2 reads its first page.
    expect(read.mock.calls.map(call => call[2]).sort()).toEqual([
      'at-100',
      'at-200',
      'at-300',
    ]);
    expect(idsOf(result.current.rows.slice(289, 289 + 1))[0] === '_').toBe(
      false,
    );
    expect(idsOf(result.current.rows.slice(320, 320 + 1))[0] === '_').toBe(
      false,
    );
    expect(idsOf(result.current.rows.slice(450, 450 + 1))[0] === '_').toBe(
      true,
    );
  });

  it('shows placeholders, not an empty list, while a far band read is delayed (Story 2 sc. 6)', async () => {
    const files = fileRows(400);
    const far = deferred<QueryFilesResult>();
    const read = pagedReader(files);
    const readIndex = jest.fn(async () => index([100, 100, 200]));
    const { result } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    read.mockReturnValueOnce(far.promise);

    act(() => result.current.loadBand(2));

    expect(result.current.rows).toHaveLength(400);
    expect(result.current.rows.slice(200).every(isPlaceholder)).toBe(true);
    expect(result.current.phase).toBe('loading-more');

    await act(async () =>
      far.resolve(ok(files.slice(200, 300), 'at-300', null)),
    );
    expect(idsOf(result.current.rows.slice(200, 202))).toEqual([
      'f200',
      'f201',
    ]);
  });

  it('drops a late band read after a query change', async () => {
    const late = deferred<QueryFilesResult>();
    const read = pagedReader(fileRows(300));
    const readIndex = jest.fn(async () => index([100, 200]));
    const { result, rerender } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    read.mockReturnValueOnce(late.promise);
    act(() => result.current.loadBand(1));

    rerender({ query: { ...GALLERY, filter: 'SYNCED' } });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () =>
      late.resolve(ok([entry('old-1'), entry('old-2')], null)),
    );

    expect(idsOf(result.current.rows)).not.toContain('old-1');
    expect(readIndex).toHaveBeenCalledTimes(2);
    expect(readIndex).toHaveBeenLastCalledWith(
      'snap-1',
      expect.objectContaining({ filter: 'SYNCED' }),
    );
  });

  it('drops a late index of the old snapshot and reads the new one', async () => {
    const lateIndex = deferred<ScrollIndexResult>();
    const readIndex = jest
      .fn<ReturnType<IndexReader>, Parameters<IndexReader>>()
      .mockReturnValueOnce(lateIndex.promise)
      .mockResolvedValueOnce(index([150]));
    const read = pagedReader(fileRows(150));
    const { result, rerender } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    rerender({ snapshotId: 'snap-2' });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await act(async () => lateIndex.resolve(index([10, 10, 10])));

    expect(result.current.scrollIndex?.bands).toHaveLength(1);
    expect(result.current.rows).toHaveLength(150);
    expect(result.current.snapshotChanged).toBe(true);
  });

  it.each([
    CloudSyncErrorCode.STALE_GENERATION,
    CloudSyncErrorCode.PAGE_TOKEN_MISMATCH,
  ])(
    '%s on a band read calls onSnapshotLost and reloads page 1 and the index',
    async code => {
      const onSnapshotLost = jest.fn(async () => {});
      const read = pagedReader(fileRows(300));
      const readIndex = jest.fn(async () => index([100, 200]));
      const { result } = setup({ read, readIndex, onSnapshotLost });
      await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      read.mockResolvedValueOnce(fail(code));

      act(() => result.current.loadBand(1));

      await waitFor(() => expect(onSnapshotLost).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(readIndex).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      expect(read).toHaveBeenLastCalledWith(
        'snap-1',
        { ...GALLERY, pageSize: 100 },
        null,
      );
      expect(result.current.rows).toHaveLength(300);
      expect(result.current.snapshotChanged).toBe(false);
    },
  );

  it('reloads page 1 and the index when reloadKey changes', async () => {
    let files = fileRows(300);
    const read = jest.fn<ReturnType<PageReader>, Parameters<PageReader>>(
      (...args) => pagedReader(files)(...args),
    );
    const readIndex = jest
      .fn<ReturnType<IndexReader>, Parameters<IndexReader>>()
      .mockResolvedValueOnce(index([100, 200]))
      .mockResolvedValueOnce(index([100, 199]));
    const { result, rerender } = setup({ read, readIndex, reloadKey: 0 });
    await waitFor(() => expect(result.current.rows).toHaveLength(300));

    files = fileRows(299);
    rerender({ reloadKey: 1 });

    await waitFor(() => expect(result.current.rows).toHaveLength(299));
    expect(readIndex).toHaveBeenCalledTimes(2);
    expect(result.current.snapshotChanged).toBe(false);
  });

  it('keeps paging linearly when the index read fails', async () => {
    const read = pagedReader(fileRows(150));
    const readIndex = jest.fn(
      async (): Promise<ScrollIndexResult> => ({
        contractVersion: 6,
        status: 'error',
        error: { code: 'INTERNAL_ERROR', message: 'failed', action: null },
      }),
    );
    const { result } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    await act(async () => {});

    expect(result.current.scrollIndex).toBeNull();
    expect(result.current.error).toBeNull();
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.rows).toHaveLength(150));
  });

  it('pages a single band like linear paging', async () => {
    const read = pagedReader(fileRows(250));
    const readIndex = jest.fn(async () => index([250]));
    const { result } = setup({ read, readIndex });
    await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.rows).toHaveLength(250);
    expect(result.current.entries).toHaveLength(100);

    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(200));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.entries).toHaveLength(250));

    expect(result.current.hasMore).toBe(false);
    expect(result.current.rows.some(isPlaceholder)).toBe(false);
    expect(read.mock.calls.map(call => call[2])).toEqual([
      null,
      'at-100',
      'at-200',
    ]);
  });

  describe('a leading segment (list view folders, research R3)', () => {
    const LIST: QuerySpec = {
      filter: 'ALL',
      view: 'LIST',
      sort: 'SIZE_DESC',
      sourceId: 'source-1',
      parentId: null,
      kind: 'FILE',
    };
    const FOLDERS: QuerySpec = { ...LIST, sort: 'NAME_ASC', kind: 'DIRECTORY' };
    const dirs = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        entry(`d${i}`, { kind: 'DIRECTORY', matchingFileCount: 1 }),
      );

    it('reads the folders first and places them before the file bands', async () => {
      const read = pagedReader(fileRows(150), dirs(2));
      const readIndex = jest.fn(async () => index([50, 100]));
      const { result } = setup({
        read,
        readIndex,
        query: LIST,
        leadingQuery: FOLDERS,
      });

      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(
        'snap-1',
        { ...FOLDERS, pageSize: 100 },
        null,
      );
      await waitFor(() => expect(result.current.scrollIndex).not.toBeNull());
      await waitFor(() => expect(result.current.entries).toHaveLength(102));

      expect(read).toHaveBeenNthCalledWith(
        2,
        'snap-1',
        { ...LIST, pageSize: 100 },
        null,
      );
      expect(readIndex).toHaveBeenCalledWith('snap-1', {
        ...LIST,
        pageSize: 100,
      });
      expect(result.current.fileOffset).toBe(2);
      expect(result.current.rows).toHaveLength(152);
      expect(result.current.bandStarts).toEqual([2, 52]);
      expect(idsOf(result.current.rows.slice(0, 3))).toEqual([
        'd0',
        'd1',
        'f0',
      ]);
      expect(result.current.counts).toEqual(COUNTS);
    });

    it('pages a long folder read before any file is read', async () => {
      const read = pagedReader(fileRows(10), dirs(150));
      const readIndex = jest.fn(async () => index([10]));
      const { result } = setup({
        read,
        readIndex,
        query: LIST,
        leadingQuery: FOLDERS,
      });
      await waitFor(() => expect(result.current.phase).toBe('ready'));

      expect(result.current.rows).toHaveLength(100);
      expect(result.current.scrollIndex).toBeNull();
      expect(read).toHaveBeenCalledTimes(1);

      act(() => result.current.loadMore());

      await waitFor(() => expect(result.current.rows).toHaveLength(160));
      expect(result.current.fileOffset).toBe(150);
      expect(idsOf(result.current.rows.slice(149, 151))).toEqual([
        'd149',
        'f0',
      ]);
    });

    it('keeps the folders when only the file query changes, and reads the files again', async () => {
      const read = pagedReader(fileRows(3), dirs(2));
      const readIndex = jest.fn(async () => index([3]));
      const { result, rerender } = setup({
        read,
        readIndex,
        query: LIST,
        leadingQuery: FOLDERS,
      });
      await waitFor(() => expect(result.current.rows).toHaveLength(5));
      read.mockClear();

      rerender({ query: { ...LIST, sort: 'SIZE_ASC' } });

      await waitFor(() => expect(result.current.rows).toHaveLength(5));
      await waitFor(() => expect(result.current.phase).toBe('ready'));
      expect(read).toHaveBeenCalledTimes(1);
      expect(read).toHaveBeenCalledWith(
        'snap-1',
        { ...LIST, sort: 'SIZE_ASC', pageSize: 100 },
        null,
      );
      expect(readIndex).toHaveBeenLastCalledWith(
        'snap-1',
        expect.objectContaining({ sort: 'SIZE_ASC' }),
      );
      expect(result.current.counts).toEqual(COUNTS);
    });

    it('reads the folders again when the folder changes', async () => {
      const read = pagedReader(fileRows(3), dirs(2));
      const { result, rerender } = setup({
        read,
        query: LIST,
        leadingQuery: FOLDERS,
      });
      await waitFor(() => expect(result.current.rows).toHaveLength(5));
      read.mockClear();

      rerender({
        query: { ...LIST, parentId: 'd0' },
        leadingQuery: { ...FOLDERS, parentId: 'd0' },
      });

      await waitFor(() => expect(result.current.rows).toHaveLength(5));
      expect(read.mock.calls.map(call => call[1].kind)).toEqual([
        'DIRECTORY',
        'FILE',
      ]);
    });

    it('reads files at once when the folder has no subfolders', async () => {
      const read = pagedReader(fileRows(3));
      const { result } = setup({ read, query: LIST, leadingQuery: FOLDERS });

      await waitFor(() => expect(result.current.rows).toHaveLength(3));
      expect(result.current.fileOffset).toBe(0);
      expect(result.current.hasMore).toBe(false);
    });
  });
});
