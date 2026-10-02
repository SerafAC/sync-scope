import { renderHook } from '@testing-library/react-native';

import type {
  ActiveSnapshotDto,
  SourceDto,
} from '../../native/CloudSyncContracts';
import { useScan, type ScanState } from '../../scan/useScan';
import { useSources, type UseSourcesResult } from '../../sources/useSources';
import { useSourceAliases } from '../useSourceAliases';

jest.mock('../../sources/useSources', () => ({ useSources: jest.fn() }));
jest.mock('../../scan/useScan', () => ({ useScan: jest.fn() }));

const useSourcesMock = useSources as jest.MockedFunction<typeof useSources>;
const useScanMock = useScan as jest.MockedFunction<typeof useScan>;

function source(sourceId: string, alias: string): SourceDto {
  return {
    sourceId,
    alias,
    volumeLabel: 'Internal shared storage',
    displayPath: `SyncScopeE2E/${alias}`,
    isRemovable: false,
    canWrite: true,
    addedAtMillis: 1,
    availability: 'AVAILABLE',
  };
}

function sourcesState(
  sources: SourceDto[],
  refresh: jest.Mock,
): UseSourcesResult {
  return {
    sources,
    loading: false,
    error: null,
    refresh,
    add: jest.fn(),
    regrant: jest.fn(),
    remove: jest.fn(),
    dismissError: jest.fn(),
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

beforeEach(() => jest.clearAllMocks());

describe('useSourceAliases', () => {
  it('maps every source ID to its alias', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    useSourcesMock.mockReturnValue(
      sourcesState(
        [source('s-1', 'Gallery'), source('s-2', 'GalleryTwin')],
        refresh,
      ),
    );
    useScanMock.mockReturnValue(scanState('snap-1'));

    const { result } = renderHook(() => useSourceAliases());

    expect([...result.current]).toEqual([
      ['s-1', 'Gallery'],
      ['s-2', 'GalleryTwin'],
    ]);
    // useSources loads on its own mount: no extra read.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('keeps the same map while the sources do not change', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    const state = sourcesState([source('s-1', 'Gallery')], refresh);
    useSourcesMock.mockReturnValue(state);
    useScanMock.mockReturnValue(scanState('snap-1'));

    const { result, rerender } = renderHook(() => useSourceAliases());
    const first = result.current;
    rerender({});

    expect(result.current).toBe(first);
  });

  it('reloads the sources when the active snapshot changes', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    useSourcesMock.mockReturnValue(
      sourcesState([source('s-1', 'Gallery')], refresh),
    );
    useScanMock.mockReturnValue(scanState('snap-1'));
    const { result, rerender } = renderHook(() => useSourceAliases());

    useScanMock.mockReturnValue(scanState('snap-2'));
    rerender({});
    expect(refresh).toHaveBeenCalledTimes(1);

    useSourcesMock.mockReturnValue(
      sourcesState([source('s-2', 'GalleryTwin')], refresh),
    );
    rerender({});
    expect([...result.current]).toEqual([['s-2', 'GalleryTwin']]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('reloads when the first snapshot is published', () => {
    const refresh = jest.fn().mockResolvedValue(undefined);
    useSourcesMock.mockReturnValue(sourcesState([], refresh));
    useScanMock.mockReturnValue(scanState(null));
    const { result, rerender } = renderHook(() => useSourceAliases());
    expect(result.current.size).toBe(0);

    useScanMock.mockReturnValue(scanState('snap-1'));
    rerender({});

    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
