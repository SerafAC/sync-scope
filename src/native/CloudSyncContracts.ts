/**
 * Versioned TypeScript contracts for the single CloudSync TurboModule.
 *
 * Every DTO that crosses the bridge carries `contractVersion` so the native
 * engine and the JS presentation layer can evolve without silent drift.
 * Error envelopes are discriminated by `status` and carry stable,
 * machine-readable codes; messages are redacted and actionable.
 */

export const CLOUD_SYNC_MODULE_NAME = 'CloudSync';
export const CLOUD_SYNC_CONTRACT_VERSION = 1;

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
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type CloudSyncErrorCode =
  (typeof CloudSyncErrorCode)[keyof typeof CloudSyncErrorCode];

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
