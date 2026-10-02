import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';

import {cancelScan, getScanState, startScan} from '../../native/CloudSync';
import {
  STALE_REMOTE_LISTING_MILLIS,
  type ActiveSnapshotDto,
  type OperationError,
  type ScanRunDto,
  type ScanStateResult,
} from '../../native/CloudSyncContracts';
import {ScanProvider} from '../ScanProvider';
import {POLL_INTERVAL_MILLIS, useScan} from '../useScan';

jest.mock('../../native/CloudSync', () => ({
  getScanState: jest.fn(),
  startScan: jest.fn(),
  cancelScan: jest.fn(),
}));

const getScanStateMock = getScanState as jest.MockedFunction<
  typeof getScanState
>;
const startScanMock = startScan as jest.MockedFunction<typeof startScan>;
const cancelScanMock = cancelScan as jest.MockedFunction<typeof cancelScan>;

const NOW = 1_800_000_000_000;

function run(overrides: Partial<ScanRunDto> = {}): ScanRunDto {
  return {
    runId: 'run-1',
    generation: 1,
    mode: 'FULL',
    phase: 'LISTING_REMOTE',
    terminalState: null,
    startedAtMillis: NOW - 1_000,
    finishedAtMillis: null,
    progress: {
      remoteDirectoriesListed: 1,
      remoteFilesListed: 2,
      localFilesEnumerated: 0,
      localFilesMatched: 0,
    },
    error: null,
    cancelReason: null,
    ...overrides,
  };
}

function completed(overrides: Partial<ScanRunDto> = {}): ScanRunDto {
  return run({
    phase: 'PUBLISHED',
    terminalState: 'COMPLETED',
    finishedAtMillis: NOW - 500,
    ...overrides,
  });
}

function active(overrides: Partial<ActiveSnapshotDto> = {}): ActiveSnapshotDto {
  return {
    snapshotId: 'snap-1',
    completedAtMillis: NOW - 500,
    remoteListedAtMillis: NOW - 600,
    precisionMillis: 1000,
    configRevision: 1,
    coverage: 'COMPLETE',
    summary: {
      synced: 4,
      unsynced: 3,
      unknown: 0,
      unreadableRemoteDirectories: 0,
      remoteListingInterruptedBy: null,
      skippedSources: [],
    },
    ...overrides,
  };
}

function state(
  current: ScanRunDto | null,
  snapshot: ActiveSnapshotDto | null,
): ScanStateResult {
  return {contractVersion: 3, status: 'ok', run: current, active: snapshot};
}

function scanError(code: string): OperationError {
  return {
    contractVersion: 3,
    status: 'error',
    error: {code, message: `${code} message`, action: `${code} action`},
  };
}

function started(runId = 'run-2', generation = 2) {
  return {contractVersion: 3, status: 'ok' as const, runId, generation};
}

let appStateListener: ((next: AppStateStatus) => void) | null = null;
const removeAppStateListener = jest.fn();

function wrapper({children}: {children: React.ReactNode}) {
  return <ScanProvider>{children}</ScanProvider>;
}

function renderScan() {
  return renderHook(() => useScan(), {wrapper});
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  jest.useFakeTimers({now: NOW});
  jest.clearAllMocks();
  appStateListener = null;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, listener) => {
      if (type === 'change') {
        appStateListener = listener as (next: AppStateStatus) => void;
      }
      return {remove: removeAppStateListener};
    });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useScan polling', () => {
  it(`polls every ${POLL_INTERVAL_MILLIS} ms while the run is not terminal`, async () => {
    getScanStateMock
      .mockResolvedValueOnce(state(run(), null))
      .mockResolvedValueOnce(state(run({phase: 'ENUMERATING_LOCAL'}), null))
      .mockResolvedValue(state(completed(), active()));

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.isRunning).toBe(true);
    expect(getScanStateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MILLIS - 1);
    });
    expect(getScanStateMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(getScanStateMock).toHaveBeenCalledTimes(2);
    expect(result.current.run?.phase).toBe('ENUMERATING_LOCAL');

    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MILLIS);
    });
    expect(getScanStateMock).toHaveBeenCalledTimes(3);
    expect(result.current.run?.terminalState).toBe('COMPLETED');
    expect(result.current.isRunning).toBe(false);

    // Terminal: polling stops.
    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MILLIS * 5);
    });
    expect(getScanStateMock).toHaveBeenCalledTimes(3);
  });

  it('stops polling on unmount', async () => {
    getScanStateMock.mockResolvedValue(state(run(), null));

    const {result, unmount} = renderScan();
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    const calls = getScanStateMock.mock.calls.length;

    unmount();
    await act(async () => {
      jest.advanceTimersByTime(POLL_INTERVAL_MILLIS * 4);
    });

    expect(getScanStateMock).toHaveBeenCalledTimes(calls);
    expect(removeAppStateListener).toHaveBeenCalled();
  });
});

describe('useScan auto-refresh', () => {
  it('starts one LOCAL_REFRESH on mount when a snapshot is active and nothing runs', async () => {
    getScanStateMock
      .mockResolvedValueOnce(state(completed(), active()))
      .mockResolvedValue(
        state(run({runId: 'run-2', mode: 'LOCAL_REFRESH'}), active()),
      );
    startScanMock.mockResolvedValue(started());

    const {result} = renderScan();

    await waitFor(() =>
      expect(result.current.run?.mode).toBe('LOCAL_REFRESH'),
    );
    expect(startScanMock).toHaveBeenCalledTimes(1);
    expect(startScanMock).toHaveBeenCalledWith('LOCAL_REFRESH');
  });

  it('does not refresh without an active snapshot', async () => {
    getScanStateMock.mockResolvedValue(state(null, null));

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await flush();

    expect(startScanMock).not.toHaveBeenCalled();
  });

  it('does not refresh while a run is active', async () => {
    getScanStateMock.mockResolvedValue(state(run(), active()));

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));
    await flush();

    expect(startScanMock).not.toHaveBeenCalled();
  });

  it('ignores REFRESH_UNAVAILABLE', async () => {
    getScanStateMock.mockResolvedValue(state(completed(), active()));
    startScanMock.mockResolvedValue(scanError('REFRESH_UNAVAILABLE'));

    const {result} = renderScan();
    await waitFor(() => expect(startScanMock).toHaveBeenCalledTimes(1));
    await flush();

    expect(result.current.error).toBeNull();
    expect(result.current.run?.terminalState).toBe('COMPLETED');
  });

  it('refreshes again on every return to the foreground', async () => {
    getScanStateMock.mockResolvedValue(state(completed(), active()));
    startScanMock.mockResolvedValue(scanError('REFRESH_UNAVAILABLE'));

    renderScan();
    await waitFor(() => expect(startScanMock).toHaveBeenCalledTimes(1));

    await act(async () => {
      appStateListener?.('background');
    });
    expect(startScanMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(startScanMock).toHaveBeenCalledTimes(2));

    await act(async () => {
      appStateListener?.('active');
    });
    await waitFor(() => expect(startScanMock).toHaveBeenCalledTimes(3));
    for (const call of startScanMock.mock.calls) {
      expect(call).toEqual(['LOCAL_REFRESH']);
    }
  });

  it('keeps a run cancelled by leaving the app visible after the refresh replaces it', async () => {
    const backgrounded = run({
      runId: 'run-5',
      generation: 5,
      phase: 'CANCELLED',
      terminalState: 'CANCELLED',
      cancelReason: 'BACKGROUNDED',
      finishedAtMillis: NOW - 100,
    });
    getScanStateMock
      .mockResolvedValueOnce(state(backgrounded, active()))
      .mockResolvedValue(
        state(completed({runId: 'run-6', mode: 'LOCAL_REFRESH'}), active()),
      );
    startScanMock.mockResolvedValue(started('run-6', 6));

    const {result} = renderScan();

    await waitFor(() => expect(result.current.run?.runId).toBe('run-6'));
    expect(result.current.interrupted?.cancelReason).toBe('BACKGROUNDED');
  });
});

describe('useScan actions', () => {
  it('scan() starts a FULL run and reads the new state', async () => {
    getScanStateMock
      .mockResolvedValueOnce(state(null, null))
      .mockResolvedValue(state(run({runId: 'run-2', generation: 2}), null));
    startScanMock.mockResolvedValue(started());

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.scan();
    });

    expect(startScanMock).toHaveBeenCalledWith('FULL');
    expect(result.current.run?.runId).toBe('run-2');
    expect(result.current.isRunning).toBe(true);
  });

  it('scan() surfaces a start error', async () => {
    getScanStateMock.mockResolvedValue(state(null, null));
    startScanMock.mockResolvedValue(scanError('NO_SOURCES_SELECTED'));

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.scan();
    });

    expect(result.current.error?.code).toBe('NO_SOURCES_SELECTED');
    act(() => result.current.dismissError());
    expect(result.current.error).toBeNull();
  });

  it('cancel() cancels the running run by ID', async () => {
    getScanStateMock
      .mockResolvedValueOnce(state(run({runId: 'run-7'}), null))
      .mockResolvedValue(
        state(
          run({
            runId: 'run-7',
            phase: 'CANCELLED',
            terminalState: 'CANCELLED',
            cancelReason: 'USER',
          }),
          null,
        ),
      );
    cancelScanMock.mockResolvedValue({contractVersion: 3, status: 'ok'});

    const {result} = renderScan();
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(cancelScanMock).toHaveBeenCalledWith('run-7');
    expect(result.current.run?.terminalState).toBe('CANCELLED');
    expect(result.current.interrupted?.cancelReason).toBe('USER');
  });

  it('a new scan() clears the previous interruption', async () => {
    const cancelled = run({
      phase: 'CANCELLED',
      terminalState: 'CANCELLED',
      cancelReason: 'USER',
    });
    getScanStateMock
      .mockResolvedValueOnce(state(cancelled, null))
      .mockResolvedValue(state(run({runId: 'run-2'}), null));
    startScanMock.mockResolvedValue(started());

    const {result} = renderScan();
    await waitFor(() => expect(result.current.interrupted).not.toBeNull());

    await act(async () => {
      await result.current.scan();
    });

    expect(result.current.interrupted).toBeNull();
  });
});

describe('useScan staleness', () => {
  it('is stale only past STALE_REMOTE_LISTING_MILLIS', async () => {
    getScanStateMock.mockResolvedValue(
      state(
        completed(),
        // waitFor advances the fake clock a little, hence the one-minute margin.
        active({
          remoteListedAtMillis: NOW - STALE_REMOTE_LISTING_MILLIS + 60_000,
        }),
      ),
    );
    startScanMock.mockResolvedValue(scanError('REFRESH_UNAVAILABLE'));

    const fresh = renderScan();
    await waitFor(() => expect(fresh.result.current.active).not.toBeNull());
    expect(fresh.result.current.isStale).toBe(false);
    fresh.unmount();

    getScanStateMock.mockResolvedValue(
      state(
        completed(),
        active({remoteListedAtMillis: NOW - STALE_REMOTE_LISTING_MILLIS - 1}),
      ),
    );
    const stale = renderScan();
    await waitFor(() => expect(stale.result.current.active).not.toBeNull());
    expect(stale.result.current.isStale).toBe(true);
  });

  it('is never stale without an active snapshot', async () => {
    getScanStateMock.mockResolvedValue(state(null, null));

    const {result} = renderScan();
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.isStale).toBe(false);
  });
});
