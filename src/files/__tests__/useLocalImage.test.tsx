import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getLocalImageHandle } from '../../native/CloudSync';
import {
  CloudSyncErrorCode,
  GALLERY_THUMBNAIL_EDGE_PX,
  type LocalImageHandleResult,
} from '../../native/CloudSyncContracts';
import { useLocalImage } from '../useLocalImage';

jest.mock('../../native/CloudSync', () => ({
  getLocalImageHandle: jest.fn(),
}));

const getLocalImageHandleMock = getLocalImageHandle as jest.MockedFunction<
  typeof getLocalImageHandle
>;

function ok(uri: string): LocalImageHandleResult {
  return { contractVersion: 4, status: 'ok', handle: { uri } };
}

function unavailable(): LocalImageHandleResult {
  return {
    contractVersion: 4,
    status: 'error',
    error: {
      code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
      message: 'This image could not be read on the device.',
      action: 'Check that the folder is still available, then rescan.',
    },
  };
}

type Props = { snapshotId: string | null; entryId: string; edge?: number };

function setup(initialProps: Props) {
  return renderHook(
    ({ snapshotId, entryId, edge }: Props) =>
      useLocalImage(snapshotId, entryId, edge),
    { initialProps },
  );
}

beforeEach(() => jest.clearAllMocks());

describe('useLocalImage', () => {
  it('returns the handle URI, asking for the gallery edge by default', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok('file:///cache/t/a.jpg'));
    const { result } = setup({ snapshotId: 'snap-1', entryId: 'e-1' });

    expect(result.current).toEqual({ uri: null, failed: false });
    await waitFor(() =>
      expect(result.current).toEqual({
        uri: 'file:///cache/t/a.jpg',
        failed: false,
      }),
    );
    expect(getLocalImageHandleMock).toHaveBeenCalledTimes(1);
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
      maxEdgePx: GALLERY_THUMBNAIL_EDGE_PX,
    });
  });

  it('passes a custom edge', async () => {
    getLocalImageHandleMock.mockResolvedValue(ok('file:///cache/t/b.jpg'));
    const { result } = setup({
      snapshotId: 'snap-1',
      entryId: 'e-1',
      edge: 1080,
    });

    await waitFor(() => expect(result.current.uri).not.toBeNull());
    expect(getLocalImageHandleMock).toHaveBeenCalledWith('snap-1', 'e-1', {
      maxEdgePx: 1080,
    });
  });

  it('reports IMAGE_UNAVAILABLE as failed', async () => {
    getLocalImageHandleMock.mockResolvedValue(unavailable());
    const { result } = setup({ snapshotId: 'snap-1', entryId: 'e-1' });

    await waitFor(() =>
      expect(result.current).toEqual({ uri: null, failed: true }),
    );
  });

  it('reports a rejected call as failed', async () => {
    getLocalImageHandleMock.mockRejectedValue(new Error('boom'));
    const { result } = setup({ snapshotId: 'snap-1', entryId: 'e-1' });

    await waitFor(() => expect(result.current.failed).toBe(true));
  });

  it('asks once per key, and again only when the key changes', async () => {
    getLocalImageHandleMock.mockImplementation(async (_s, entryId) =>
      ok(`file:///cache/${entryId}.jpg`),
    );
    const { result, rerender } = setup({
      snapshotId: 'snap-1',
      entryId: 'e-1',
    });
    await waitFor(() =>
      expect(result.current.uri).toBe('file:///cache/e-1.jpg'),
    );

    rerender({ snapshotId: 'snap-1', entryId: 'e-1' });
    expect(getLocalImageHandleMock).toHaveBeenCalledTimes(1);

    rerender({ snapshotId: 'snap-1', entryId: 'e-2' });
    expect(result.current).toEqual({ uri: null, failed: false });
    await waitFor(() =>
      expect(result.current.uri).toBe('file:///cache/e-2.jpg'),
    );
    expect(getLocalImageHandleMock).toHaveBeenCalledTimes(2);
  });

  it('ignores a late result for an earlier key', async () => {
    let resolveFirst!: (r: LocalImageHandleResult) => void;
    getLocalImageHandleMock
      .mockReturnValueOnce(
        new Promise(r => {
          resolveFirst = r;
        }),
      )
      .mockResolvedValueOnce(ok('file:///cache/e-2.jpg'));
    const { result, rerender } = setup({
      snapshotId: 'snap-1',
      entryId: 'e-1',
    });

    rerender({ snapshotId: 'snap-1', entryId: 'e-2' });
    await waitFor(() =>
      expect(result.current.uri).toBe('file:///cache/e-2.jpg'),
    );
    await act(async () => resolveFirst(ok('file:///cache/e-1.jpg')));

    expect(result.current.uri).toBe('file:///cache/e-2.jpg');
  });

  it('never asks without a snapshot', async () => {
    const { result } = setup({ snapshotId: null, entryId: 'e-1' });
    await act(async () => {});

    expect(result.current).toEqual({ uri: null, failed: false });
    expect(getLocalImageHandleMock).not.toHaveBeenCalled();
  });

  it('does not update state when unmounted before the result', async () => {
    let resolve!: (r: LocalImageHandleResult) => void;
    getLocalImageHandleMock.mockReturnValue(
      new Promise(r => {
        resolve = r;
      }),
    );
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const { result, unmount } = setup({
        snapshotId: 'snap-1',
        entryId: 'e-1',
      });
      unmount();
      await act(async () => resolve(ok('file:///cache/late.jpg')));

      expect(result.current).toEqual({ uri: null, failed: false });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
