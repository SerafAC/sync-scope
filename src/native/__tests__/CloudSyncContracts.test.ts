import * as fs from 'fs';
import * as path from 'path';

import type {
  ActiveSnapshotDto,
  CloudSyncError,
  DeletionFailureReason,
  DeletionPlanDto,
  ExecuteLocalDeletionResult,
  FileEntryDto,
  FileIssueCode,
  LocalImageHandleResult,
  LocalImageSpec,
  LaunchSourcePickerResult,
  ListSelectableEntriesResult,
  ListSourcesResult,
  PrepareLocalDeletionResult,
  RepositoryConfigInput,
  RepositoryField,
  RepositorySummaryResult,
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
  GALLERY_THUMBNAIL_EDGE_PX,
  IMAGE_ERROR_TEXT,
  LOCAL_IMAGE_MAX_EDGE_PX,
  LOCAL_IMAGE_MIN_EDGE_PX,
  MAX_DELETION_PLAN_AGE_MILLIS,
  MAX_PAGE_SIZE,
  MVP_ERROR_TEXT,
  REPOSITORY_DEFAULT_PORTS,
  SCAN_ERROR_TEXT,
  STALE_REMOTE_LISTING_MILLIS,
  SOURCE_ERROR_TEXT,
  clampImageEdge,
  clampPageSize,
  isErrorResult,
} from '../CloudSyncContracts';

describe('CloudSync versioned contract', () => {
  it('exposes a stable positive contract version', () => {
    expect(CLOUD_SYNC_CONTRACT_VERSION).toBe(5);
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

  it('mirrors the repository default ports and the deletion plan age (contract v5)', () => {
    expect(REPOSITORY_DEFAULT_PORTS).toEqual({
      FTP: 21,
      SFTP: 22,
      WEBDAV: 80,
      WEBDAV_HTTPS: 443,
    });
    expect(MAX_DELETION_PLAN_AGE_MILLIS).toBe(900_000);
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

  it('inserts the source, scan, image and MVP error codes, in order, just before INTERNAL_ERROR', () => {
    expect(Object.values(CloudSyncErrorCode).slice(-16)).toEqual([
      'SOURCE_OVERLAP',
      'SOURCE_UNSUPPORTED',
      'SOURCE_REGRANT_MISMATCH',
      'SOURCE_NOT_FOUND',
      'PICKER_BUSY',
      'NO_SOURCES_SELECTED',
      'SCAN_IN_PROGRESS',
      'SCAN_NOT_FOUND',
      'REFRESH_UNAVAILABLE',
      'IMAGE_UNAVAILABLE',
      'TLS_UNTRUSTED',
      'DELETION_IN_PROGRESS',
      'REPOSITORY_CHANGED',
      'PLAN_NOT_FOUND',
      'PLAN_STALE',
      'INTERNAL_ERROR',
    ]);
  });

  it('carries the exact message and action for each MVP error code (contract v5)', () => {
    expect(MVP_ERROR_TEXT).toEqual({
      TLS_UNTRUSTED: {
        message: "The server's certificate is not trusted by this phone.",
        action:
          'Use a certificate from a public authority, or connect with SFTP.',
      },
      DELETION_IN_PROGRESS: {
        message: 'Files are being deleted.',
        action: 'Wait until the deletion finishes.',
      },
      REPOSITORY_CHANGED: {
        message: 'These results were made with your previous server settings.',
        action: 'Scan again before deleting.',
      },
      PLAN_NOT_FOUND: {
        message: 'This deletion is no longer available.',
        action: 'Review the selection and tap Delete again.',
      },
      PLAN_STALE: {
        message: 'The results changed since you reviewed this deletion.',
        action: 'Review the selection and tap Delete again.',
      },
    });
  });

  it('points a missing repository at Settings › Repository, not a Connect screen', () => {
    const contract = fs.readFileSync(
      path.join(__dirname, '..', 'CloudSyncContracts.ts'),
      'utf8',
    );
    expect(contract).toContain(
      'No repository has been saved yet; set one up in Settings › Repository.',
    );
    expect(contract).not.toContain('Connect screen');
  });

  it('carries the exact message and action for the image error code', () => {
    expect(IMAGE_ERROR_TEXT).toEqual({
      IMAGE_UNAVAILABLE: {
        message: 'This image could not be read on the device.',
        action: 'Check that the folder is still available, then rescan.',
      },
    });
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
      configRevision: 3,
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

  describe('browse DTOs (contract v4)', () => {
    it('carries the duplicate flag and the matching-file count on every entry', () => {
      const tile: FileEntryDto = {
        entryId: 'e-1',
        sourceId: 'src-1',
        parentId: null,
        kind: 'FILE',
        name: 'sunset.png',
        mimeType: 'image/png',
        sizeBytes: 70,
        modifiedUtcMillis: 1704067200000,
        status: 'UNSYNCED',
        issueCode: null,
        nameInOtherSource: true,
        matchingFileCount: null,
      };
      const folder: FileEntryDto = {
        ...tile,
        entryId: 'e-2',
        kind: 'DIRECTORY',
        name: 'album',
        mimeType: null,
        nameInOtherSource: false,
        matchingFileCount: 0,
      };
      // @ts-expect-error nameInOtherSource is required in contract v4
      const missingFlag: FileEntryDto = {...tile, nameInOtherSource: undefined};
      // @ts-expect-error matchingFileCount is a number or null, never a string
      const badCount: FileEntryDto = {...folder, matchingFileCount: '0'};
      expect(tile.nameInOtherSource).toBe(true);
      expect(folder.matchingFileCount).toBe(0);
      expect([missingFlag, badCount]).toHaveLength(2);
    });

    it('types the local image handle envelopes', () => {
      const spec: LocalImageSpec = {maxEdgePx: GALLERY_THUMBNAIL_EDGE_PX};
      const ok: LocalImageHandleResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        handle: {uri: 'file:///data/cache/thumbnails/e-1_256.jpg'},
      };
      const unavailable: LocalImageHandleResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.IMAGE_UNAVAILABLE,
          ...IMAGE_ERROR_TEXT.IMAGE_UNAVAILABLE,
        },
      };
      // @ts-expect-error an ok handle result carries a handle
      const noHandle: LocalImageHandleResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
      };
      expect(spec.maxEdgePx).toBe(256);
      expect(isErrorResult(ok)).toBe(false);
      expect(isErrorResult(unavailable)).toBe(true);
      expect(noHandle.status).toBe('ok');
    });

    it('bounds the requested image edge', () => {
      expect(LOCAL_IMAGE_MIN_EDGE_PX).toBe(64);
      expect(LOCAL_IMAGE_MAX_EDGE_PX).toBe(2048);
      expect(GALLERY_THUMBNAIL_EDGE_PX).toBe(256);
      // Same inputs as the Kotlin parity test (LocalImageSpec.bounded).
      expect([-1, 0, 63, 64, 256, 2048, 2049].map(clampImageEdge)).toEqual([
        64, 64, 64, 64, 256, 2048, 2048,
      ]);
      expect(clampImageEdge(300.9)).toBe(300);
      expect(clampImageEdge(Number.NaN)).toBe(256);
      expect(clampImageEdge(Number.POSITIVE_INFINITY)).toBe(256);
      expect(clampImageEdge(Number.NEGATIVE_INFINITY)).toBe(256);
    });
  });

  describe('repository, selection and deletion DTOs (contract v5)', () => {
    it('names the offending repository field on an error', () => {
      const fields: RepositoryField[] = [
        'protocol',
        'host',
        'port',
        'username',
        'password',
        'remoteRoot',
      ];
      const invalidPort: CloudSyncError = {
        code: CloudSyncErrorCode.INVALID_QUERY,
        message: 'The repository port is invalid: it must be a number.',
        action: 'Correct the port and save again.',
        field: 'port',
      };
      const noField: CloudSyncError = {
        code: CloudSyncErrorCode.INTERNAL_ERROR,
        message: 'Unexpected.',
        action: null,
        field: null,
      };
      // @ts-expect-error field is one of the repository form fields
      const badField: CloudSyncError = {...invalidPort, field: 'password2'};
      expect(fields).toHaveLength(6);
      expect(invalidPort.field).toBe('port');
      expect(noField.field).toBeNull();
      expect(badField.code).toBe('INVALID_QUERY');
    });

    it('types the repository summary and the save config', () => {
      const summary: RepositorySummaryResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        repository: {
          protocol: 'WEBDAV',
          host: 'nas.local',
          port: 443,
          username: 'me',
          remoteRoot: '/backup',
          precisionMillis: null,
          credentialPresent: true,
          hostKeyTrusted: null,
          revision: 3,
          webdavHttps: true,
        },
      };
      const legacyCaller: RepositoryConfigInput = {
        protocol: 'SFTP',
        host: 'nas.local',
        port: null,
        username: 'me',
        remoteRoot: '/backup',
      };
      const https: RepositoryConfigInput = {
        ...legacyCaller,
        protocol: 'WEBDAV',
        webdavHttps: true,
      };
      const noRevision: RepositorySummaryResult = {
        ...summary,
        // @ts-expect-error the summary always carries its revision in contract v5
        repository: {...summary.repository, revision: undefined},
      };
      expect(isErrorResult(summary)).toBe(false);
      expect(legacyCaller.webdavHttps).toBeUndefined();
      expect(https.webdavHttps).toBe(true);
      expect(noRevision.status).toBe('ok');
    });

    it('carries the repository revision on the active snapshot', () => {
      // @ts-expect-error configRevision is required in contract v5
      const missing: ActiveSnapshotDto = {
        snapshotId: 'snap-1',
        completedAtMillis: 5,
        remoteListedAtMillis: 4,
        precisionMillis: 1000,
        coverage: 'COMPLETE',
        summary: {
          synced: 0,
          unsynced: 0,
          unknown: 0,
          unreadableRemoteDirectories: 0,
          remoteListingInterruptedBy: null,
          skippedSources: [],
        },
      };
      expect(missing.snapshotId).toBe('snap-1');
    });

    it('types the selectable entries envelope with -1 for unknown sizes', () => {
      const ok: ListSelectableEntriesResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        selectable: {
          entryIds: ['e-1', 'e-2'],
          sizes: [70, -1],
          statuses: ['SYNCED', 'UNKNOWN'],
          images: [true, false],
        },
      };
      const stale: ListSelectableEntriesResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.STALE_GENERATION,
          message: 'Stale.',
          action: null,
        },
      };
      const badStatus: ListSelectableEntriesResult = {
        ...ok,
        // @ts-expect-error statuses are FileStatus values
        selectable: {...ok.selectable, statuses: ['DELETED']},
      };
      expect(isErrorResult(ok)).toBe(false);
      expect(isErrorResult(stale)).toBe(true);
      expect(badStatus.status).toBe('ok');
    });

    it('types the deletion plan and result envelopes', () => {
      const plan: DeletionPlanDto = {
        planToken: 'plan-1',
        toDelete: {count: 3, bytes: 210},
        unsynced: {count: 1, bytes: 70},
        refused: {count: 2, scanTooOld: 0},
        movedByRecheck: 1,
        missing: 0,
        unknownSizeCount: 0,
        remoteListedAtMillis: 4,
      };
      const prepared: PrepareLocalDeletionResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        plan,
      };
      const changed: PrepareLocalDeletionResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: CloudSyncErrorCode.REPOSITORY_CHANGED,
          ...MVP_ERROR_TEXT.REPOSITORY_CHANGED,
        },
      };
      const reasons: DeletionFailureReason[] = [
        'ALREADY_GONE',
        'CHANGED',
        'ACCESS_LOST',
        'FAILED',
      ];
      const executed: ExecuteLocalDeletionResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
        result: {
          deleted: 2,
          freedBytes: 140,
          failures: [{entryId: 'e-3', name: 'c.png', reason: 'ALREADY_GONE'}],
          removedEntryIds: ['e-1', 'e-2', 'e-3'],
        },
      };
      // @ts-expect-error a deletion failure reason is a closed set
      const badReason: DeletionFailureReason = 'DELETED';
      // @ts-expect-error an ok plan result carries a plan
      const noPlan: PrepareLocalDeletionResult = {
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
      };
      expect(isErrorResult(prepared)).toBe(false);
      expect(isErrorResult(changed)).toBe(true);
      expect(isErrorResult(executed)).toBe(false);
      expect(reasons).toHaveLength(4);
      expect([badReason, noPlan]).toHaveLength(2);
    });
  });
});
