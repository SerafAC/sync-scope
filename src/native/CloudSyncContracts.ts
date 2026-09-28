/**
 * Versioned TypeScript contracts for the single CloudSync TurboModule.
 *
 * Every DTO that crosses the bridge carries `contractVersion` so the native
 * engine and the JS presentation layer can evolve without silent drift.
 * Error envelopes are discriminated by `status` and carry stable,
 * machine-readable codes; messages are redacted and actionable.
 */

export const CLOUD_SYNC_MODULE_NAME = 'CloudSync';
export const CLOUD_SYNC_CONTRACT_VERSION = 2;

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
