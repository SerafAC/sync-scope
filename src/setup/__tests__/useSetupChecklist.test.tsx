import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';

import * as CloudSync from '../../native/CloudSync';
import type {
  ActiveSnapshotDto,
  ListSourcesResult,
  OperationError,
  RepositorySummaryDto,
  RepositorySummaryResult,
  SourceAvailability,
  SourceDto,
} from '../../native/CloudSyncContracts';
import {ScanContext, type ScanState} from '../../scan/useScan';
import {useSetupChecklist} from '../useSetupChecklist';

// The latest focus callback, so a test can simulate the tab gaining focus again.
let mockFocusCallback: (() => void) | null = null;

jest.mock('@react-navigation/native', () => {
  const {useEffect} = jest.requireActual<typeof import('react')>('react');
  return {
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('../../native/CloudSync', () => ({
  getRepositorySummary: jest.fn(),
  listSources: jest.fn(),
  saveRepository: jest.fn(),
  launchSourcePicker: jest.fn(),
  removeSource: jest.fn(),
  startScan: jest.fn(),
}));

const summaryMock = CloudSync.getRepositorySummary as jest.MockedFunction<
  typeof CloudSync.getRepositorySummary
>;
const sourcesMock = CloudSync.listSources as jest.MockedFunction<
  typeof CloudSync.listSources
>;

const SAVED: RepositorySummaryDto = {
  protocol: 'WEBDAV',
  host: '10.0.2.2',
  port: 8080,
  username: 'alice',
  remoteRoot: '/gallery',
  precisionMillis: 1000,
  credentialPresent: true,
  hostKeyTrusted: null,
  revision: 3,
  webdavHttps: false,
};

function errorOf(code: string): OperationError {
  return {
    contractVersion: 5,
    status: 'error',
    error: {code, message: `${code} message`, action: null},
  };
}

function repository(
  overrides: Partial<RepositorySummaryDto> = {},
): RepositorySummaryResult {
  return {
    contractVersion: 5,
    status: 'ok',
    repository: {...SAVED, ...overrides},
  };
}

function source(id: string, availability: SourceAvailability): SourceDto {
  return {
    sourceId: id,
    alias: `Alias ${id}`,
    volumeLabel: 'Internal shared storage',
    displayPath: `DCIM/${id}`,
    isRemovable: false,
    canWrite: true,
    addedAtMillis: 1,
    availability,
  };
}

function sources(...list: SourceDto[]): ListSourcesResult {
  return {contractVersion: 5, status: 'ok', sources: list};
}

function snapshot(configRevision: number): ActiveSnapshotDto {
  return {
    snapshotId: 'snap-1',
    completedAtMillis: 2,
    remoteListedAtMillis: 1,
    precisionMillis: 1000,
    configRevision,
    coverage: 'COMPLETE',
    summary: {
      synced: 1,
      unsynced: 0,
      unknown: 0,
      unreadableRemoteDirectories: 0,
      remoteListingInterruptedBy: null,
      skippedSources: [],
    },
  };
}

function scanState(active: ActiveSnapshotDto | null): ScanState {
  return {
    run: null,
    active,
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

function renderChecklist(active: ActiveSnapshotDto | null = null) {
  const value = scanState(active);
  function wrapper({children}: {children: React.ReactNode}) {
    return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
  }
  return renderHook(() => useSetupChecklist(), {wrapper});
}

async function loaded(active: ActiveSnapshotDto | null = null) {
  const view = renderChecklist(active);
  await waitFor(() => expect(view.result.current.loading).toBe(false));
  return view;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
  summaryMock.mockResolvedValue(repository());
  sourcesMock.mockResolvedValue(sources(source('a', 'AVAILABLE')));
});

describe('useSetupChecklist', () => {
  it('is loading until both reads answer', async () => {
    const view = renderChecklist();

    expect(view.result.current.loading).toBe(true);
    await waitFor(() => expect(view.result.current.loading).toBe(false));
  });

  describe('repository', () => {
    it('is missing when no repository is saved', async () => {
      summaryMock.mockResolvedValue(errorOf('REPOSITORY_NOT_CONFIGURED'));

      const {result} = await loaded();

      expect(result.current.repository).toBe('missing');
    });

    it('needs a password when none is stored', async () => {
      summaryMock.mockResolvedValue(repository({credentialPresent: false}));

      const {result} = await loaded();

      expect(result.current.repository).toBe('needsPassword');
    });

    it('needs a password when the stored one cannot be read', async () => {
      summaryMock.mockResolvedValue(errorOf('CREDENTIAL_UNAVAILABLE'));

      const {result} = await loaded();

      expect(result.current.repository).toBe('needsPassword');
    });

    it('is ready with a saved repository and its password', async () => {
      const {result} = await loaded();

      expect(result.current.repository).toBe('ready');
    });

    it('does not block a scan on a read failure: the scan reports it', async () => {
      summaryMock.mockResolvedValue(errorOf('INTERNAL_ERROR'));

      const {result} = await loaded();

      expect(result.current.repository).toBe('ready');
    });
  });

  describe('folders', () => {
    it('is none without folders', async () => {
      sourcesMock.mockResolvedValue(sources());

      const {result} = await loaded();

      expect(result.current.folders).toBe('none');
    });

    it('is noneAvailable when every folder lost its grant or storage', async () => {
      sourcesMock.mockResolvedValue(
        sources(source('a', 'GRANT_REVOKED'), source('b', 'STORAGE_MISSING')),
      );

      const {result} = await loaded();

      expect(result.current.folders).toBe('noneAvailable');
    });

    it('is ready when at least one folder is available', async () => {
      sourcesMock.mockResolvedValue(
        sources(source('a', 'GRANT_REVOKED'), source('b', 'AVAILABLE')),
      );

      const {result} = await loaded();

      expect(result.current.folders).toBe('ready');
    });

    it('does not block a scan on a read failure: the scan reports it', async () => {
      sourcesMock.mockRejectedValue(new Error('bridge down'));

      const {result} = await loaded();

      expect(result.current.folders).toBe('ready');
    });
  });

  describe('resultsFromOldSettings', () => {
    it('is false without results', async () => {
      const {result} = await loaded(null);

      expect(result.current.resultsFromOldSettings).toBe(false);
    });

    it('is false when the results match the saved revision', async () => {
      const {result} = await loaded(snapshot(3));

      expect(result.current.resultsFromOldSettings).toBe(false);
    });

    it('is true when the results were made with another revision', async () => {
      const {result} = await loaded(snapshot(2));

      expect(result.current.resultsFromOldSettings).toBe(true);
    });

    it('is false when no repository is saved (the checklist covers it)', async () => {
      summaryMock.mockResolvedValue(errorOf('REPOSITORY_NOT_CONFIGURED'));

      const {result} = await loaded(snapshot(2));

      expect(result.current.resultsFromOldSettings).toBe(false);
    });
  });

  it('re-reads both on focus', async () => {
    summaryMock.mockResolvedValue(errorOf('REPOSITORY_NOT_CONFIGURED'));
    sourcesMock.mockResolvedValue(sources());
    const {result} = await loaded();
    expect(result.current.repository).toBe('missing');
    expect(result.current.folders).toBe('none');

    summaryMock.mockResolvedValue(repository());
    sourcesMock.mockResolvedValue(sources(source('a', 'AVAILABLE')));
    await act(async () => {
      mockFocusCallback?.();
    });

    await waitFor(() => expect(result.current.repository).toBe('ready'));
    expect(result.current.folders).toBe('ready');
    expect(summaryMock).toHaveBeenCalledTimes(2);
    expect(sourcesMock).toHaveBeenCalledTimes(2);
  });

  it('stores nothing: it only reads, and a new mount reads afresh', async () => {
    const first = await loaded();
    expect(first.result.current.repository).toBe('ready');
    first.unmount();

    summaryMock.mockResolvedValue(errorOf('REPOSITORY_NOT_CONFIGURED'));
    const second = await loaded();

    expect(second.result.current.repository).toBe('missing');
    expect(CloudSync.saveRepository).not.toHaveBeenCalled();
    expect(CloudSync.launchSourcePicker).not.toHaveBeenCalled();
    expect(CloudSync.removeSource).not.toHaveBeenCalled();
    expect(CloudSync.startScan).not.toHaveBeenCalled();
  });
});
