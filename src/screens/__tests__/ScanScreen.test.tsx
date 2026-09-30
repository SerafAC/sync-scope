import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import type {
  ActiveSnapshotDto,
  ScanRunDto,
} from '../../native/CloudSyncContracts';
import {formatTimestamp} from '../../scan/ScanSummaryCard';
import {useScan, type ScanState} from '../../scan/useScan';
import {ScanScreen} from '../ScanScreen';

jest.mock('../../scan/useScan', () => ({
  ...jest.requireActual('../../scan/useScan'),
  useScan: jest.fn(),
}));

const useScanMock = useScan as jest.MockedFunction<typeof useScan>;

const NOW = 1_800_000_000_000;

function run(overrides: Partial<ScanRunDto> = {}): ScanRunDto {
  return {
    runId: 'run-1',
    generation: 3,
    mode: 'FULL',
    phase: 'LISTING_REMOTE',
    terminalState: null,
    startedAtMillis: NOW - 10_000,
    finishedAtMillis: null,
    progress: {
      remoteDirectoriesListed: 2,
      remoteFilesListed: 17,
      localFilesEnumerated: 5,
      localFilesMatched: 4,
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
    finishedAtMillis: NOW - 5_000,
    ...overrides,
  });
}

function active(): ActiveSnapshotDto {
  return {
    snapshotId: 'snap-1',
    completedAtMillis: NOW - 5_000,
    remoteListedAtMillis: NOW - 6_000,
    precisionMillis: 1000,
    coverage: 'COMPLETE',
    summary: {
      synced: 4,
      unsynced: 3,
      unknown: 0,
      unreadableRemoteDirectories: 0,
      remoteListingInterruptedBy: null,
      skippedSources: [],
    },
  };
}

function hookState(overrides: Partial<ScanState> = {}): ScanState {
  const current = overrides.run ?? null;
  return {
    run: null,
    active: null,
    interrupted: null,
    loading: false,
    error: null,
    isRunning: current != null && current.terminalState === null,
    isStale: false,
    scan: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
    dismissError: jest.fn(),
    ...overrides,
  };
}

function renderScreen(state: ScanState) {
  useScanMock.mockReturnValue(state);
  return render(
    <PaperProvider>
      <ScanScreen />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScanScreen', () => {
  it('offers Scan without an active snapshot', () => {
    const state = hookState();
    renderScreen(state);

    fireEvent.press(screen.getByLabelText('Scan'));

    expect(state.scan).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Rescan from scratch')).toBeNull();
    expect(screen.queryByLabelText('Scan summary')).toBeNull();
  });

  it('offers Rescan from scratch with an active snapshot', () => {
    const state = hookState({run: completed(), active: active()});
    renderScreen(state);

    fireEvent.press(screen.getByLabelText('Rescan from scratch'));

    expect(state.scan).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Scan')).toBeNull();
    expect(screen.getByLabelText('Scan summary')).toBeOnTheScreen();
  });

  it('shows Cancel scan only while running', () => {
    const running = hookState({run: run(), active: active()});
    const view = renderScreen(running);

    fireEvent.press(screen.getByLabelText('Cancel scan'));
    expect(running.cancel).toHaveBeenCalledTimes(1);
    view.unmount();

    renderScreen(hookState({run: completed(), active: active()}));
    expect(screen.queryByLabelText('Cancel scan')).toBeNull();
  });

  it('shows the phase and the four counters in Scan progress', () => {
    renderScreen(hookState({run: run()}));

    const progress = within(screen.getByLabelText('Scan progress'));
    expect(progress.getByText('Listing the backup')).toBeOnTheScreen();
    expect(progress.getByText('Remote folders listed: 2')).toBeOnTheScreen();
    expect(progress.getByText('Remote files listed: 17')).toBeOnTheScreen();
    expect(progress.getByText('Local files found: 5')).toBeOnTheScreen();
    expect(progress.getByText('Local files matched: 4')).toBeOnTheScreen();
  });

  it('hides Scan progress when nothing runs', () => {
    renderScreen(hookState({run: completed(), active: active()}));
    expect(screen.queryByLabelText('Scan progress')).toBeNull();
  });

  it('shows the mode, generation and completion time in Last scan', () => {
    const finished = completed({generation: 7});
    const view = renderScreen(hookState({run: finished, active: active()}));

    const last = within(screen.getByLabelText('Last scan'));
    expect(last.getByText('Full scan')).toBeOnTheScreen();
    expect(last.getByText('Generation 7')).toBeOnTheScreen();
    expect(
      last.getByText(`Completed ${formatTimestamp(NOW - 5_000)}`),
    ).toBeOnTheScreen();
    view.unmount();

    renderScreen(
      hookState({
        run: completed({mode: 'LOCAL_REFRESH', generation: 8}),
        active: active(),
      }),
    );
    expect(
      within(screen.getByLabelText('Last scan')).getByText('Local refresh'),
    ).toBeOnTheScreen();
  });

  it('shows the summary and the remote listing age of the active snapshot', () => {
    renderScreen(hookState({run: completed(), active: active()}));

    const summary = within(screen.getByLabelText('Scan summary'));
    expect(summary.getByText('Synced: 4')).toBeOnTheScreen();
    expect(summary.getByText('Unsynced: 3')).toBeOnTheScreen();
    expect(
      summary.getByText('Files that could not be checked: 0'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Remote listing age')).toBeOnTheScreen();
  });

  it('suggests a rescan when stale without disabling Scan', () => {
    const state = hookState({run: completed(), active: active(), isStale: true});
    renderScreen(state);

    expect(screen.getByLabelText('Rescan suggested')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Rescan from scratch'));
    expect(state.scan).toHaveBeenCalledTimes(1);
  });

  it('shows Scan failed with the message and the action, keeping the summary', () => {
    const failed = run({
      phase: 'FAILED',
      terminalState: 'FAILED',
      finishedAtMillis: NOW - 1_000,
      error: {
        code: 'AUTH_FAILED',
        message: 'The server rejected the username or password.',
        action: 'Check the credentials and try again.',
      },
    });
    renderScreen(hookState({run: failed, interrupted: failed, active: active()}));

    const box = within(screen.getByLabelText('Scan failed'));
    expect(box.getByText('Scan failed')).toBeOnTheScreen();
    expect(
      box.getByText('The server rejected the username or password.'),
    ).toBeOnTheScreen();
    expect(box.getByText('Check the credentials and try again.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Scan summary')).toBeOnTheScreen();
  });

  it('shows Cancelled or Cancelled (app left) by cancel reason', () => {
    const byUser = run({
      phase: 'CANCELLED',
      terminalState: 'CANCELLED',
      cancelReason: 'USER',
    });
    const view = renderScreen(
      hookState({run: byUser, interrupted: byUser, active: active()}),
    );
    expect(screen.getByText('Cancelled')).toBeOnTheScreen();
    expect(screen.queryByText('Cancelled (app left)')).toBeNull();
    expect(screen.getByLabelText('Scan summary')).toBeOnTheScreen();
    view.unmount();

    const backgrounded = {...byUser, cancelReason: 'BACKGROUNDED' as const};
    renderScreen(
      hookState({
        // The automatic local refresh replaced it as the latest run.
        run: completed({mode: 'LOCAL_REFRESH', runId: 'run-2'}),
        interrupted: backgrounded,
        active: active(),
      }),
    );
    expect(screen.getByText('Cancelled (app left)')).toBeOnTheScreen();
  });

  it('shows a hook error with its action', () => {
    const state = hookState({
      error: {
        code: 'NO_SOURCES_SELECTED',
        message: 'No folders are selected to check.',
        action: 'Add a folder in Settings › Folders.',
      },
    });
    renderScreen(state);

    expect(
      screen.getByText(
        'No folders are selected to check. Add a folder in Settings › Folders.',
      ),
    ).toBeOnTheScreen();
  });

  it('labels every interactive element with its selector', () => {
    renderScreen(hookState({run: run(), active: active(), isStale: true}));

    for (const label of [
      'Rescan from scratch',
      'Cancel scan',
      'Scan progress',
      'Scan summary',
      'Files that could not be checked',
      'Remote listing age',
      'Rescan suggested',
      'Last scan',
    ]) {
      expect(screen.getByLabelText(label)).toBeOnTheScreen();
    }
  });
});
