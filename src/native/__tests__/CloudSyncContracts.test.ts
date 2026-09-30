import * as fs from 'fs';
import * as path from 'path';

import type {
  ActiveSnapshotDto,
  FileIssueCode,
  LaunchSourcePickerResult,
  ListSourcesResult,
  ScanMode,
  ScanPhase,
  ScanRunDto,
  ScanStateResult,
  ScanTerminalState,
  SourceDto,
  StartScanResult,
} from '../CloudSyncContracts';
import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  DEFAULT_PAGE_SIZE,
  FILE_ISSUE_TEXT,
  MAX_PAGE_SIZE,
  SCAN_ERROR_TEXT,
  STALE_REMOTE_LISTING_MILLIS,
  SOURCE_ERROR_TEXT,
  clampPageSize,
  isErrorResult,
} from '../CloudSyncContracts';

describe('CloudSync versioned contract', () => {
  it('exposes a stable positive contract version', () => {
    expect(CLOUD_SYNC_CONTRACT_VERSION).toBe(3);
    expect(Number.isInteger(CLOUD_SYNC_CONTRACT_VERSION)).toBe(true);
  });

  it('targets exactly one native module name', () => {
    expect(CLOUD_SYNC_MODULE_NAME).toBe('CloudSync');
  });

  it('bounds every catalog page across the bridge', () => {
    expect(MAX_PAGE_SIZE).toBe(200);
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it('clamps requested page sizes into the supported range', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(25)).toBe(25);
    expect(clampPageSize(5000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('keeps stable machine-readable error codes', () => {
    expect(Object.values(CloudSyncErrorCode)).toEqual(
      expect.arrayContaining([
        'NOT_IMPLEMENTED',
        'NATIVE_MODULE_UNAVAILABLE',
        'INVALID_QUERY',
        'PAGE_TOKEN_MISMATCH',
        'SNAPSHOT_NOT_FOUND',
        'STALE_GENERATION',
        'INTERNAL_ERROR',
      ]),
    );
  });

  it('inserts the source and scan error codes, in order, just before INTERNAL_ERROR', () => {
    expect(Object.values(CloudSyncErrorCode).slice(-10)).toEqual([
      'SOURCE_OVERLAP',
      'SOURCE_UNSUPPORTED',
      'SOURCE_REGRANT_MISMATCH',
      'SOURCE_NOT_FOUND',
      'PICKER_BUSY',
      'NO_SOURCES_SELECTED',
      'SCAN_IN_PROGRESS',
      'SCAN_NOT_FOUND',
      'REFRESH_UNAVAILABLE',
      'INTERNAL_ERROR',
    ]);
  });

  it('carries the exact message and action for each scan error code', () => {
    expect(SCAN_ERROR_TEXT).toEqual({
      NO_SOURCES_SELECTED: {
        message: 'No folders are selected to check.',
        action: 'Add a folder in Settings › Folders.',
      },
      SCAN_IN_PROGRESS: {
        message: 'A scan is already running.',
        action: 'Wait for it to finish, or cancel it.',
      },
      SCAN_NOT_FOUND: {
        message: 'That scan is no longer known.',
        action: 'Refresh the scan screen.',
      },
      REFRESH_UNAVAILABLE: {
        message: 'There is no up-to-date remote listing to refresh against.',
        action: 'Run a full scan.',
      },
    });
  });

  it('carries the exact text for each file issue code', () => {
    expect(FILE_ISSUE_TEXT).toEqual({
      REMOTE_MTIME_MISSING:
        'The backup has this file but no modified time, so it could not be compared.',
      LOCAL_UNAVAILABLE: 'This file could not be read on the device.',
    });
  });

  it('carries the exact message and action for each source error code', () => {
    expect(SOURCE_ERROR_TEXT).toEqual({
      SOURCE_OVERLAP: {
        message: 'This folder overlaps a folder you already added.',
        action: 'Pick a folder that is not inside, or around, an existing one.',
      },
      SOURCE_UNSUPPORTED: {
        message: 'Only folders on this device or its SD card can be added.',
        action: 'Pick a folder from internal storage or the SD card.',
      },
      SOURCE_REGRANT_MISMATCH: {
        message: 'That is a different folder from the one that lost access.',
        action: 'Pick the same folder again, or remove the source.',
      },
      SOURCE_NOT_FOUND: {
        message: 'That folder is no longer in your list.',
        action: 'Refresh the folder list.',
      },
      PICKER_BUSY: {
        message: 'The folder picker is already open.',
        action: 'Finish or close the picker, then try again.',
      },
    });
  });

  it('discriminates error envelopes from success envelopes', () => {
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: 'PAGE_TOKEN_MISMATCH',
          message: 'mismatch',
          action: null,
        },
      }),
    ).toBe(true);
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
      }),
    ).toBe(false);
  });

  it('describes sources without any native-only location field', () => {
    const source: SourceDto = {
      sourceId: 'src-1',
      alias: 'Camera',
      volumeLabel: 'Internal shared storage',
      displayPath: 'DCIM/Camera',
      isRemovable: false,
      canWrite: true,
      addedAtMillis: 1,
      availability: 'AVAILABLE',
    };
    const listed: ListSourcesResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'ok',
      sources: [source],
    };
    const cancelled: LaunchSourcePickerResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'ok',
      outcome: 'CANCELLED',
      source: null,
    };
    const overlap: LaunchSourcePickerResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.SOURCE_OVERLAP,
        message: SOURCE_ERROR_TEXT.SOURCE_OVERLAP.message,
        action: SOURCE_ERROR_TEXT.SOURCE_OVERLAP.action,
        conflictingSource: {sourceId: 'src-1', alias: 'Camera'},
      },
    };
    expect(isErrorResult(listed)).toBe(false);
    expect(isErrorResult(cancelled)).toBe(false);
    expect(isErrorResult(overlap)).toBe(true);

    const contract = fs.readFileSync(
      path.join(__dirname, '..', 'CloudSyncContracts.ts'),
      'utf8',
    );
    expect(contract).not.toMatch(/\btreeUri\b/);
    expect(contract).not.toMatch(/\bcanonicalRoot\b/);
  });

  describe('scan DTOs (contract v3)', () => {
    const run: ScanRunDto = {
      runId: 'run-1',
      generation: 4,
      mode: 'FULL',
      phase: 'FAILED',
      terminalState: 'FAILED',
      startedAtMillis: 1,
      finishedAtMillis: 2,
      progress: {
        remoteDirectoriesListed: 3,
        remoteFilesListed: 10,
        localFilesEnumerated: 0,
        localFilesMatched: 0,
      },
      error: {
        code: CloudSyncErrorCode.CONNECTION_REFUSED,
        message: 'The server refused the connection.',
        action: null,
      },
      cancelReason: null,
    };
    const active: ActiveSnapshotDto = {
      snapshotId: 'snap-1',
      completedAtMillis: 5,
      remoteListedAtMillis: 4,
      precisionMillis: 1000,
      coverage: 'INCOMPLETE',
      summary: {
        synced: 1,
        unsynced: 2,
        unknown: 3,
        unreadableRemoteDirectories: 1,
        remoteListingInterruptedBy: null,
        skippedSources: [
          {sourceId: 'src-1', alias: 'Camera', reason: 'GRANT_REVOKED'},
        ],
      },
    };

    it('types the scan state and start envelopes', () => {
      const state: ScanStateResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        run,
        active,
      };
      const idle: ScanStateResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        run: null,
        active: null,
      };
      const started: StartScanResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        runId: 'run-2',
        generation: 5,
      };
      const busy: StartScanResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.SCAN_IN_PROGRESS,
          ...SCAN_ERROR_TEXT.SCAN_IN_PROGRESS,
        },
      };
      expect(isErrorResult(state)).toBe(false);
      expect(isErrorResult(idle)).toBe(false);
      expect(isErrorResult(started)).toBe(false);
      expect(isErrorResult(busy)).toBe(true);
    });

    it('keeps the scan enums closed', () => {
      const modes: ScanMode[] = ['FULL', 'LOCAL_REFRESH'];
      const phases: ScanPhase[] = [
        'CONNECTING',
        'LISTING_REMOTE',
        'COPYING_REMOTE',
        'ENUMERATING_LOCAL',
        'PUBLISHING',
        'PUBLISHED',
        'CANCELLED',
        'FAILED',
        'ABORTED',
      ];
      const terminal: ScanTerminalState[] = [
        'COMPLETED',
        'CANCELLED',
        'FAILED',
        'ABORTED',
      ];
      const issues: FileIssueCode[] = [
        'DIRECTORY_UNREADABLE',
        'CONNECTION_LOST',
        'CONNECTION_TIMEOUT',
        'SERVER_ERROR',
        'REMOTE_MTIME_MISSING',
        'LOCAL_UNAVAILABLE',
      ];
      // @ts-expect-error unknown scan mode
      const badMode: ScanMode = 'PARTIAL';
      // @ts-expect-error unknown cancel reason
      const badReason: ScanRunDto['cancelReason'] = 'TIMEOUT';
      expect(modes).toHaveLength(2);
      expect(phases).toHaveLength(9);
      expect(terminal).toHaveLength(4);
      expect(issues).toHaveLength(6);
      expect([badMode, badReason]).toHaveLength(2);
    });

    it('reuses CloudSyncErrorCode values for remote issue causes', () => {
      const remoteCauses: FileIssueCode[] = [
        CloudSyncErrorCode.DIRECTORY_UNREADABLE,
        CloudSyncErrorCode.CONNECTION_LOST,
        CloudSyncErrorCode.CONNECTION_TIMEOUT,
        CloudSyncErrorCode.SERVER_ERROR,
      ];
      expect(remoteCauses).toHaveLength(4);
      expect(Object.keys(FILE_ISSUE_TEXT).sort()).toEqual([
        'LOCAL_UNAVAILABLE',
        'REMOTE_MTIME_MISSING',
      ]);
    });

    it('suggests a rescan after seven days', () => {
      expect(STALE_REMOTE_LISTING_MILLIS).toBe(604_800_000);
    });

    it('carries no path, host or document identifier in any scan DTO', () => {
      const contract = fs.readFileSync(
        path.join(__dirname, '..', 'CloudSyncContracts.ts'),
        'utf8',
      );
      const scanBlock = contract.slice(
        contract.indexOf('export type ScanMode'),
        contract.indexOf('export function isErrorResult'),
      );
      expect(scanBlock.length).toBeGreaterThan(0);
      expect(scanBlock).not.toMatch(/\b\w*[pP]ath\w*\??:/);
      expect(scanBlock).not.toMatch(/\bhost\w*\??:/i);
      expect(scanBlock).not.toMatch(/\bdocumentId\b|\bdocumentUri\b/);
    });
  });
});
