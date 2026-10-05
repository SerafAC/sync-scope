/**
 * Versioned TypeScript contracts for the single CloudSync TurboModule.
 *
 * Every DTO that crosses the bridge carries `contractVersion` so the native
 * engine and the JS presentation layer can evolve without silent drift.
 * Error envelopes are discriminated by `status` and carry stable,
 * machine-readable codes; messages are redacted and actionable.
 */

export const CLOUD_SYNC_MODULE_NAME = 'CloudSync';
export const CLOUD_SYNC_CONTRACT_VERSION = 5;

/**
 * Hard bridge bounds. The native engine enforces the same limits; these
 * constants let the UI size pages without ever requesting an unbounded
 * catalog payload.
 */
export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

/**
 * Port used when a repository is saved with no port (contract version 5). A WebDAV
 * repository over HTTPS uses WEBDAV_HTTPS. Mirrored by the Kotlin
 * `RepositoryDefaultPorts` under CloudSyncContractsParityTest.
 */
export const REPOSITORY_DEFAULT_PORTS = {
  FTP: 21,
  SFTP: 22,
  WEBDAV: 80,
  WEBDAV_HTTPS: 443,
} as const;

/** A deletion plan expires this long after prepareLocalDeletion made it (contract version 5). */
export const MAX_DELETION_PLAN_AGE_MILLIS = 15 * 60 * 1000;

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
  /** No repository has been saved yet; set one up in Settings › Repository. */
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
  /** getLocalImageHandle could not read or decode the local image (contract version 4). */
  IMAGE_UNAVAILABLE: 'IMAGE_UNAVAILABLE',
  /** WebDAV over HTTPS: the server's certificate is not trusted by the phone (contract version 5). */
  TLS_UNTRUSTED: 'TLS_UNTRUSTED',
  /** A deletion is running, so a scan, a repository save or another deletion must wait (contract version 5). */
  DELETION_IN_PROGRESS: 'DELETION_IN_PROGRESS',
  /** prepareLocalDeletion: the results were made with previous server settings (contract version 5). */
  REPOSITORY_CHANGED: 'REPOSITORY_CHANGED',
  /** executeLocalDeletion: the plan token is unknown, expired or already used (contract version 5). */
  PLAN_NOT_FOUND: 'PLAN_NOT_FOUND',
  /** executeLocalDeletion: the snapshot changed since the plan was made (contract version 5). */
  PLAN_STALE: 'PLAN_STALE',
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

export type ImageErrorCode = 'IMAGE_UNAVAILABLE';

/**
 * Exact redacted message and recovery action for the local image error codes
 * (contract version 4). Mirrored by the Kotlin `CloudSyncErrorCode` entries and
 * checked by CloudSyncContractsParityTest.
 */
export const IMAGE_ERROR_TEXT: Readonly<
  Record<ImageErrorCode, {message: string; action: string}>
> = {
  IMAGE_UNAVAILABLE: {
    message: 'This image could not be read on the device.',
    action: 'Check that the folder is still available, then rescan.',
  },
};

export type MvpErrorCode =
  | 'TLS_UNTRUSTED'
  | 'DELETION_IN_PROGRESS'
  | 'REPOSITORY_CHANGED'
  | 'PLAN_NOT_FOUND'
  | 'PLAN_STALE';

/**
 * Exact redacted message and recovery action for the repository and deletion
 * error codes (contract version 5). Mirrored by the Kotlin `CloudSyncErrorCode`
 * entries and checked by CloudSyncContractsParityTest.
 */
export const MVP_ERROR_TEXT: Readonly<
  Record<MvpErrorCode, {message: string; action: string}>
> = {
  TLS_UNTRUSTED: {
    message: "The server's certificate is not trusted by this phone.",
    action: 'Use a certificate from a public authority, or connect with SFTP.',
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
  /**
   * saveRepository rejections (INVALID_QUERY) only: the form field to fix
   * (contract version 5). The rejected value is never echoed.
   */
  field?: RepositoryField | null;
}

/** The repository form fields an error can name in `CloudSyncError.field`. */
export const REPOSITORY_FIELDS = [
  'protocol',
  'host',
  'port',
  'username',
  'password',
  'remoteRoot',
] as const;

export type RepositoryField = (typeof REPOSITORY_FIELDS)[number];

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

export type RepositoryProtocol = 'FTP' | 'SFTP' | 'WEBDAV';

/**
 * The `config` argument of saveRepository. The password is passed separately
 * as `transientPassword` and is never part of any DTO.
 */
export interface RepositoryConfigInput {
  protocol: RepositoryProtocol;
  host: string;
  /** null → REPOSITORY_DEFAULT_PORTS for the protocol (WebDAV over HTTPS → 443). */
  port: number | null;
  username: string;
  /** Absolute folder path on the server. */
  remoteRoot: string;
  /** WebDAV only: connect over HTTPS. Absent means false, so existing callers keep HTTP (contract v5). */
  webdavHttps?: boolean;
}

/** The saved repository as getRepositorySummary returns it. Never carries the password. */
export interface RepositorySummaryDto {
  protocol: RepositoryProtocol;
  host: string;
  port: number;
  username: string;
  remoteRoot: string;
  /** Timestamp precision found by testRepository; null until a test succeeded. */
  precisionMillis: number | null;
  /** A stored password is present and readable; the password itself never crosses the bridge. */
  credentialPresent: boolean;
  /** SFTP only: the endpoint's host key is trusted. null for FTP and WebDAV. */
  hostKeyTrusted: boolean | null;
  /** Bumped on every save; compared with `ActiveSnapshotDto.configRevision` (contract v5). */
  revision: number;
  /** WebDAV only: the repository connects over HTTPS (contract v5). */
  webdavHttps: boolean;
}

export interface RepositorySummaryOk {
  contractVersion: number;
  status: 'ok';
  repository: RepositorySummaryDto;
}

export type RepositorySummaryResult = RepositorySummaryOk | OperationError;

/** What testRepository found at the saved repository's remote folder. */
export interface RepositoryConnectionDto {
  protocol: RepositoryProtocol;
  reachable: boolean;
  /** Direct children of the remote folder. */
  entryCount: number;
  precisionMillis: number;
  precisionBasis: string;
  /** False when a save landed during the test, so the precision was not written. */
  precisionPersisted: boolean;
}

export interface TestRepositoryOk {
  contractVersion: number;
  status: 'ok';
  connection: RepositoryConnectionDto;
}

export type TestRepositoryResult = TestRepositoryOk | OperationError;

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
  /**
   * GALLERY reads: a FILE with the same name exists in another source of this snapshot,
   * so the tile shows its source's alias as an origin badge. Always false for LIST reads.
   */
  nameInOtherSource: boolean;
  /**
   * DIRECTORY rows: files anywhere beneath it that match the query's filter. 0 means the row is shown
   * dimmed. null for FILE rows and for snapshots written before contract 4.
   */
  matchingFileCount: number | null;
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

export interface LocalImageSpec {
  /** Longest edge in px of the returned image; clamped to 64…2048. */
  maxEdgePx: number;
}

export interface LocalImageHandleDto {
  /** `file://` URI of a JPEG in the app's own cache. Never a document URI or a user path. */
  uri: string;
}

export interface LocalImageHandleOk {
  contractVersion: number;
  status: 'ok';
  handle: LocalImageHandleDto;
}

export type LocalImageHandleResult = LocalImageHandleOk | OperationError;

/** Bounds of `LocalImageSpec.maxEdgePx`; mirrored by the Kotlin `LocalImageSpec`. */
export const LOCAL_IMAGE_MIN_EDGE_PX = 64;
export const LOCAL_IMAGE_MAX_EDGE_PX = 2048;
/** Gallery tiles request this edge (research R7). */
export const GALLERY_THUMBNAIL_EDGE_PX = 256;

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

/**
 * Every FILE row a query would show, for "Select all" (listSelectableEntries,
 * contract v5). The arrays are parallel and in the same order.
 */
export interface SelectableEntriesDto {
  entryIds: string[];
  /** Same order as entryIds; -1 = size unknown. */
  sizes: number[];
  statuses: FileStatus[];
  images: boolean[];
}

export interface ListSelectableEntriesOk {
  contractVersion: number;
  status: 'ok';
  selectable: SelectableEntriesDto;
}

export type ListSelectableEntriesResult = ListSelectableEntriesOk | OperationError;

/**
 * `SelectableEntriesDto` as the `listSelectableEntries` wrapper returns it:
 * the same parallel arrays, with an unknown size (`-1` on the wire) as null.
 */
export interface SelectableEntries {
  entryIds: string[];
  sizes: Array<number | null>;
  statuses: FileStatus[];
  images: boolean[];
}

export interface SelectableEntriesOk {
  contractVersion: number;
  status: 'ok';
  selectable: SelectableEntries;
}

export type SelectableEntriesResult = SelectableEntriesOk | OperationError;

/** What prepareLocalDeletion found after the server re-check (contract v5). */
export interface DeletionPlanDto {
  planToken: string;
  /** Backed up, confirmed on the server. `bytes` sums known sizes only. */
  toDelete: {count: number; bytes: number};
  /** Not backed up, including files the re-check moved out of toDelete. */
  unsynced: {count: number; bytes: number};
  /** Unknown state, never deleted (D006). */
  refused: {count: number; scanTooOld: number};
  /** SYNCED rows the re-check moved out of toDelete. */
  movedByRecheck: number;
  /** IDs that are not FILE rows of the snapshot. */
  missing: number;
  /** Rows in toDelete or unsynced with no size. */
  unknownSizeCount: number;
  /** Scan age at the point of decision. */
  remoteListedAtMillis: number;
}

export interface PrepareLocalDeletionOk {
  contractVersion: number;
  status: 'ok';
  plan: DeletionPlanDto;
}

export type PrepareLocalDeletionResult = PrepareLocalDeletionOk | OperationError;

export type DeletionFailureReason =
  | 'ALREADY_GONE'
  | 'CHANGED'
  | 'ACCESS_LOST'
  | 'FAILED';

export interface DeletionFailureDto {
  entryId: string;
  name: string;
  reason: DeletionFailureReason;
}

/** What executeLocalDeletion did (contract v5). */
export interface DeletionResultDto {
  deleted: number;
  /** Known sizes of the DELETED files. */
  freedBytes: number;
  /** Every attempted file that was not deleted. */
  failures: DeletionFailureDto[];
  /** DELETED and ALREADY_GONE: rows no longer in the snapshot. */
  removedEntryIds: string[];
}

export interface ExecuteLocalDeletionOk {
  contractVersion: number;
  status: 'ok';
  result: DeletionResultDto;
}

export type ExecuteLocalDeletionResult = ExecuteLocalDeletionOk | OperationError;

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
  /** Repository revision the snapshot was made with (contract v5); compare with `RepositorySummaryDto.revision`. */
  configRevision: number;
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

/**
 * Normalizes a requested image edge into LOCAL_IMAGE_MIN_EDGE_PX..LOCAL_IMAGE_MAX_EDGE_PX.
 * A non-finite value maps to GALLERY_THUMBNAIL_EDGE_PX. The native engine applies the same
 * clamp (`LocalImageSpec.bounded`), checked by CloudSyncContractsParityTest.
 */
export function clampImageEdge(px: number): number {
  if (!Number.isFinite(px)) {
    return GALLERY_THUMBNAIL_EDGE_PX;
  }
  const truncated = Math.trunc(px);
  return Math.min(
    Math.max(truncated, LOCAL_IMAGE_MIN_EDGE_PX),
    LOCAL_IMAGE_MAX_EDGE_PX,
  );
}
