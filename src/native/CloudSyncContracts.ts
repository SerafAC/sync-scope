/**
 * Versioned TypeScript contracts for the single CloudSync TurboModule.
 *
 * Every DTO that crosses the bridge carries `contractVersion` so the native
 * engine and the JS presentation layer can evolve without silent drift.
 * Error envelopes are discriminated by `status` and carry stable,
 * machine-readable codes; messages are redacted and actionable.
 */

export const CLOUD_SYNC_MODULE_NAME = 'CloudSync';
export const CLOUD_SYNC_CONTRACT_VERSION = 3;

/**
 * Hard bridge bounds. The native engine enforces the same limits; these
 * constants let the UI size pages without ever requesting an unbounded
 * catalog payload.
 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export const CloudSyncErrorCode = {
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  NATIVE_MODULE_UNAVAILABLE: 'NATIVE_MODULE_UNAVAILABLE',
  INVALID_QUERY: 'INVALID_QUERY',
  PAGE_TOKEN_MISMATCH: 'PAGE_TOKEN_MISMATCH',
  SNAPSHOT_NOT_FOUND: 'SNAPSHOT_NOT_FOUND',
  STALE_GENERATION: 'STALE_GENERATION',
  AUTH_FAILED: 'AUTH_FAILED',
  CONNECTION_REFUSED: 'CONNECTION_REFUSED',
  CONNECTION_TIMEOUT: 'CONNECTION_TIMEOUT',
  CONNECTION_LOST: 'CONNECTION_LOST',
  DIRECTORY_UNREADABLE: 'DIRECTORY_UNREADABLE',
  REMOTE_ROOT_NOT_FOUND: 'REMOTE_ROOT_NOT_FOUND',
  SERVER_ERROR: 'SERVER_ERROR',
  SFTP_HOST_KEY_UNVERIFIED: 'SFTP_HOST_KEY_UNVERIFIED',
  SFTP_HOST_KEY_CHANGED: 'SFTP_HOST_KEY_CHANGED',
  HOST_KEY_CHALLENGE_NOT_FOUND: 'HOST_KEY_CHALLENGE_NOT_FOUND',
  /** No repository has been saved yet; the Connect screen must run first. */
  REPOSITORY_NOT_CONFIGURED: 'REPOSITORY_NOT_CONFIGURED',
  /** The saved repository's password is missing or was rotated; re-enter it. */
  CREDENTIAL_UNAVAILABLE: 'CREDENTIAL_UNAVAILABLE',
  /** The picked folder is inside, equal to, or around a folder already added. */
  SOURCE_OVERLAP: 'SOURCE_OVERLAP',
  /** The picked folder comes from a provider other than device/SD card storage. */
  SOURCE_UNSUPPORTED: 'SOURCE_UNSUPPORTED',
  /** A re-grant picked a different folder from the one that lost access. */
  SOURCE_REGRANT_MISMATCH: 'SOURCE_REGRANT_MISMATCH',
  /** The source ID is not (or no longer) in the list of added folders. */
  SOURCE_NOT_FOUND: 'SOURCE_NOT_FOUND',
  /** The folder picker is already open, or there is no foreground activity. */
  PICKER_BUSY: 'PICKER_BUSY',
  /** startScan was asked to run with no folder selected. */
  NO_SOURCES_SELECTED: 'NO_SOURCES_SELECTED',
  /** startScan was asked to run while another scan is active. */
  SCAN_IN_PROGRESS: 'SCAN_IN_PROGRESS',
  /** cancelScan named a run ID that is not known. */
  SCAN_NOT_FOUND: 'SCAN_NOT_FOUND',
  /** LOCAL_REFRESH has no current remote listing to reuse. */
  REFRESH_UNAVAILABLE: 'REFRESH_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type CloudSyncErrorCode =
  (typeof CloudSyncErrorCode)[keyof typeof CloudSyncErrorCode];

export type SourceErrorCode =
  | 'SOURCE_OVERLAP'
  | 'SOURCE_UNSUPPORTED'
  | 'SOURCE_REGRANT_MISMATCH'
  | 'SOURCE_NOT_FOUND'
  | 'PICKER_BUSY';

/**
 * Exact redacted message and recovery action for the source-selection error
 * codes (contract version 2). The Kotlin `CloudSyncErrorCode` entries carry the
 * same text; CloudSyncContractsParityTest fails on any drift.
 */
export const SOURCE_ERROR_TEXT: Readonly<
  Record<SourceErrorCode, {message: string; action: string}>
> = {
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
};

export type ScanErrorCode =
  | 'NO_SOURCES_SELECTED'
  | 'SCAN_IN_PROGRESS'
  | 'SCAN_NOT_FOUND'
  | 'REFRESH_UNAVAILABLE';

/**
 * Exact redacted message and recovery action for the scan error codes
 * (contract version 3). Mirrored by the Kotlin `CloudSyncErrorCode` entries and
 * checked by CloudSyncContractsParityTest.
 */
export const SCAN_ERROR_TEXT: Readonly<
  Record<ScanErrorCode, {message: string; action: string}>
> = {
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
};

/**
 * User-facing text of the file issue codes that are not error codes. Mirrored
 * by the Kotlin `enum class FileIssueCode` under the parity test. A remote
 * cause reuses the matching `CloudSyncErrorCode` value and its text instead.
 */
export const FILE_ISSUE_TEXT: Readonly<
  Record<Extract<FileIssueCode, 'REMOTE_MTIME_MISSING' | 'LOCAL_UNAVAILABLE'>, string>
> = {
  REMOTE_MTIME_MISSING:
    'The backup has this file but no modified time, so it could not be compared.',
  LOCAL_UNAVAILABLE: 'This file could not be read on the device.',
};

export interface CloudSyncError {
  code: CloudSyncErrorCode | string;
  /** Redacted, user-actionable message. Never contains secrets or paths. */
  message: string;
  /** Optional hint describing the recovery action the UI should offer. */
  action: string | null;
  /**
   * Present on SFTP_HOST_KEY_UNVERIFIED and SFTP_HOST_KEY_CHANGED only. The
   * connection is blocked until the user answers via approveSftpHostKey or
   * rejectSftpHostKey with `challengeId`.
   */
  hostKeyChallenge?: HostKeyChallengeDto | null;
  /**
   * Present on SOURCE_OVERLAP only: the already-added source the pick
   * overlaps, carried as structured data so the alias never passes through
   * message redaction.
   */
  conflictingSource?: {sourceId: string; alias: string} | null;
}

export interface HostKeyChallengeDto {
  challengeId: string;
  /** Endpoint the user typed, shown so the prompt can be checked against `ssh-keyscan`. */
  host: string;
  port: number;
  /** SSH key algorithm, e.g. `ssh-ed25519`. */
  algorithm: string;
  /** OpenSSH `SHA256:<base64>` form, identical to `ssh-keygen -l` output. */
  fingerprint: string;
  /** Fingerprint of the key previously trusted for this endpoint (CHANGED only). */
  previousFingerprint: string | null;
}

export type FileStatus = 'SYNCED' | 'UNSYNCED' | 'UNKNOWN';
export type LocalNodeKind = 'FILE' | 'DIRECTORY';

export type FileFilter = 'ALL' | 'SYNCED' | 'UNSYNCED' | 'ISSUES_UNKNOWN';
export type FileView = 'LIST' | 'GALLERY';
export type FileSort = 'NAME_ASC' | 'NAME_DESC' | 'TIME_ASC' | 'TIME_DESC';

export interface QuerySpec {
  filter: FileFilter;
  view: FileView;
  sort: FileSort;
  sourceId?: string | null;
  parentId?: string | null;
  search?: string | null;
  pageSize?: number | null;
}

export interface FileEntryDto {
  entryId: string;
  sourceId: string;
  parentId: string | null;
  kind: LocalNodeKind;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedUtcMillis: number | null;
  status: FileStatus;
  issueCode: string | null;
}

export interface StatusCountDto {
  status: FileStatus;
  count: number;
}

export interface FilePageDto {
  entries: FileEntryDto[];
  nextPageToken: string | null;
  /** Present on the first page so counts and rows share one snapshot read. */
  counts: StatusCountDto[] | null;
}

export interface QueryFilesOk {
  contractVersion: number;
  status: 'ok';
  page: FilePageDto;
}

export interface QueryFilesError {
  contractVersion: number;
  status: 'error';
  error: CloudSyncError;
}

export type QueryFilesResult = QueryFilesOk | QueryFilesError;

export interface OperationOk {
  contractVersion: number;
  status: 'ok';
}

export interface OperationError {
  contractVersion: number;
  status: 'error';
  error: CloudSyncError;
}

/** Envelope for operations implemented by later features. */
export type OperationResult = OperationOk | OperationError;

/**
 * Availability of an added source, computed at call time: the persisted
 * grant is gone (GRANT_REVOKED) or its storage is not mounted/present
 * (STORAGE_MISSING).
 */
export type SourceAvailability =
  | 'AVAILABLE'
  | 'GRANT_REVOKED'
  | 'STORAGE_MISSING';

/**
 * One local folder the user chose to check. The SAF tree URI and the
 * canonical root are native-only and never cross the bridge.
 */
export interface SourceDto {
  sourceId: string;
  /** Generated, unique, stable (FR-004). */
  alias: string;
  /** e.g. "Internal shared storage", "SDCARD". */
  volumeLabel: string;
  /** Path within the volume; "" for a volume root. */
  displayPath: string;
  isRemovable: boolean;
  canWrite: boolean;
  addedAtMillis: number;
  availability: SourceAvailability;
}

export interface ListSourcesOk {
  contractVersion: number;
  status: 'ok';
  sources: SourceDto[];
}

export type ListSourcesResult = ListSourcesOk | OperationError;

export type SourcePickerOutcome = 'ADDED' | 'REGRANTED' | 'CANCELLED';

export interface LaunchSourcePickerOk {
  contractVersion: number;
  status: 'ok';
  outcome: SourcePickerOutcome;
  /** null only when outcome is CANCELLED. */
  source: SourceDto | null;
}

export type LaunchSourcePickerResult = LaunchSourcePickerOk | OperationError;

export type ScanMode = 'FULL' | 'LOCAL_REFRESH';

export type ScanPhase =
  | 'CONNECTING'
  | 'LISTING_REMOTE'
  | 'COPYING_REMOTE'
  | 'ENUMERATING_LOCAL'
  | 'PUBLISHING'
  | 'PUBLISHED'
  | 'CANCELLED'
  | 'FAILED'
  | 'ABORTED';

export type ScanTerminalState = 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'ABORTED';

export interface ScanProgressDto {
  remoteDirectoriesListed: number;
  remoteFilesListed: number;
  localFilesEnumerated: number;
  localFilesMatched: number;
}

export interface ScanRunDto {
  runId: string;
  generation: number;
  mode: ScanMode;
  phase: ScanPhase;
  /** null while running. */
  terminalState: ScanTerminalState | null;
  startedAtMillis: number;
  finishedAtMillis: number | null;
  progress: ScanProgressDto;
  /** FAILED only: the typed cause with its recovery action (FR-006). */
  error: CloudSyncError | null;
  /** CANCELLED only. */
  cancelReason: 'USER' | 'BACKGROUNDED' | null;
}

export interface SkippedSourceDto {
  sourceId: string;
  alias: string;
  reason: 'GRANT_REVOKED' | 'STORAGE_MISSING' | 'LOCAL_UNAVAILABLE';
}

export interface ScanSummaryDto {
  synced: number;
  unsynced: number;
  /** "Files that could not be checked" (FR-005, FR-007). */
  unknown: number;
  unreadableRemoteDirectories: number;
  /** Code of the transient failure that stopped the remote walk, or null. */
  remoteListingInterruptedBy: string | null;
  skippedSources: SkippedSourceDto[];
}

export interface ActiveSnapshotDto {
  snapshotId: string;
  completedAtMillis: number;
  /** Age anchor for the staleness hint; a LOCAL_REFRESH does not move it (FR-003). */
  remoteListedAtMillis: number;
  precisionMillis: number;
  coverage: 'COMPLETE' | 'INCOMPLETE';
  summary: ScanSummaryDto;
}

export interface ScanStateOk {
  contractVersion: number;
  status: 'ok';
  /** The running run, else the most recent one, else null. */
  run: ScanRunDto | null;
  active: ActiveSnapshotDto | null;
}

export type ScanStateResult = ScanStateOk | OperationError;

export interface StartScanOk {
  contractVersion: number;
  status: 'ok';
  runId: string;
  generation: number;
}

export type StartScanResult = StartScanOk | OperationError;

/** Suggest (never force) a rescan once the remote listing is older than this (FR-003, D009). */
export const STALE_REMOTE_LISTING_MILLIS = 7 * 24 * 60 * 60 * 1000;

/** Values of `FileEntryDto.issueCode`. Remote causes reuse CloudSyncErrorCode values. */
export type FileIssueCode =
  | 'DIRECTORY_UNREADABLE'
  | 'CONNECTION_LOST'
  | 'CONNECTION_TIMEOUT'
  | 'SERVER_ERROR'
  | 'REMOTE_MTIME_MISSING'
  | 'LOCAL_UNAVAILABLE';

export function isErrorResult(
  result: OperationResult | QueryFilesResult,
): result is OperationError | QueryFilesError {
  return result.status === 'error';
}

/**
 * Normalizes a caller-provided page size into the supported 1..MAX_PAGE_SIZE
 * range. The native engine applies the same clamp so a page can never exceed
 * the bridge bound regardless of which side is asked.
 */
export function clampPageSize(pageSize?: number | null): number {
  if (
    pageSize === undefined ||
    pageSize === null ||
    Number.isNaN(pageSize) ||
    !Number.isFinite(pageSize)
  ) {
    return DEFAULT_PAGE_SIZE;
  }
  const truncated = Math.trunc(pageSize);
  if (truncated < 1) {
    return 1;
  }
  return Math.min(truncated, MAX_PAGE_SIZE);
}
