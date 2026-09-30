# Contract: CloudSync scan and query methods (contract version 3)

The authoritative sources are `src/native/specs/NativeCloudSync.ts` (Codegen spec),
`src/native/CloudSyncContracts.ts` (TypeScript DTOs and codes) and
`android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt` (Kotlin mirror, checked by
`CloudSyncContractsParityTest`). This page describes the intended change; the code wins where they differ.

## Surface change

| Item | Before (v2, feature 003) | After (v3) |
| --- | --- | --- |
| `CONTRACT_VERSION` (TS and Kotlin) | 2 | **3** |
| `startScan` | `startScan(): Promise<OperationResultDto>`, `NOT_IMPLEMENTED` | `startScan(mode?: string \| null): Promise<OperationResultDto>`, implemented |
| `cancelScan(runId)` | `NOT_IMPLEMENTED` | implemented |
| `getScanState()` | `NOT_IMPLEMENTED` | implemented |
| `queryFiles(...)` | `NOT_IMPLEMENTED` | implemented over a published snapshot |
| `queryTreeChildren(...)` | `NOT_IMPLEMENTED` | implemented; `parentId = null` means top level |

Every method resolves an envelope and never rejects (D011). `getSettings` and `setIncludeHidden` stay
`NOT_IMPLEMENTED` (research R8).

## DTOs (TypeScript, `CloudSyncContracts.ts`)

```ts
export type ScanMode = 'FULL' | 'LOCAL_REFRESH';
export type ScanPhase =
  | 'CONNECTING' | 'LISTING_REMOTE' | 'COPYING_REMOTE' | 'ENUMERATING_LOCAL'
  | 'PUBLISHING' | 'PUBLISHED' | 'CANCELLED' | 'FAILED' | 'ABORTED';
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
  terminalState: ScanTerminalState | null;   // null while running
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

export interface StartScanOk { contractVersion: number; status: 'ok'; runId: string; generation: number; }
export type StartScanResult = StartScanOk | OperationError;

/** Suggest (never force) a rescan once the remote listing is older than this (FR-003, D009). */
export const STALE_REMOTE_LISTING_MILLIS = 7 * 24 * 60 * 60 * 1000;

/** Values of `FileEntryDto.issueCode`. Remote causes reuse CloudSyncErrorCode values. */
export type FileIssueCode =
  | 'DIRECTORY_UNREADABLE' | 'CONNECTION_LOST' | 'CONNECTION_TIMEOUT' | 'SERVER_ERROR'
  | 'REMOTE_MTIME_MISSING' | 'LOCAL_UNAVAILABLE';
```

## Behaviour

### `startScan(mode?)`

| Situation | Result |
| --- | --- |
| No repository saved | error `REPOSITORY_NOT_CONFIGURED` |
| Saved password missing or rotated (`FULL`) | error `CREDENTIAL_UNAVAILABLE` |
| No `source_root` rows | error `NO_SOURCES_SELECTED` |
| A run is already active | error `SCAN_IN_PROGRESS` |
| `LOCAL_REFRESH` with no active snapshot, or a config revision that has changed | error `REFRESH_UNAVAILABLE` |
| Unknown `mode` string | error `INVALID_QUERY` |
| Otherwise | `ok` with the new `runId` and `generation`. The run continues in the background of the module scope; progress comes from `getScanState`. |

Connection and listing failures are **not** reported by `startScan`. They end the run (`FAILED`, with
`run.error`) or become part of the summary (incomplete listing).

### `cancelScan(runId)`

- Active run with that ID → cancels it, deletes the staged snapshot and resolves `ok`. The run ends
  `CANCELLED` with `cancelReason: 'USER'`.
- Run already terminal → `ok` (idempotent).
- Unknown ID → error `SCAN_NOT_FOUND`.

### `getScanState()`

A pure read that is safe to poll every 500 ms. It resolves `ok` with `run` and `active`. With no run ever
started, both are `null`.

### Backgrounding (no method)

`onHostPause` cancels an active run with `cancelReason: 'BACKGROUNDED'` (FR-001). The next `getScanState`
shows the run `CANCELLED`, and `active` is unchanged.

### `queryFiles` / `queryTreeChildren`

The page contract is unchanged from feature 002 (`FilePageDto`, `PageTokenCodec`, clamp to 200,
first-page `counts`). A snapshot that is not published → `SNAPSHOT_NOT_FOUND`; a mismatched token →
`PAGE_TOKEN_MISMATCH`. `queryTreeChildren(snapshotId, null, …)` returns rows with `parentId IS NULL`
(narrowed by `querySpec.sourceId` when given), served by
`index_local_node_snapshotId_sourceId_parentId_kind_name`.

## New error codes

Inserted just before `INTERNAL_ERROR`, in the same order in TypeScript and Kotlin.

| Code | Message (redacted, user-facing) | Action |
| --- | --- | --- |
| `NO_SOURCES_SELECTED` | "No folders are selected to check." | "Add a folder in Settings › Folders." |
| `SCAN_IN_PROGRESS` | "A scan is already running." | "Wait for it to finish, or cancel it." |
| `SCAN_NOT_FOUND` | "That scan is no longer known." | "Refresh the scan screen." |
| `REFRESH_UNAVAILABLE` | "There is no up-to-date remote listing to refresh against." | "Run a full scan." |

## New issue codes (not error codes)

`REMOTE_MTIME_MISSING` ("The backup has this file but no modified time, so it could not be compared.") and
`LOCAL_UNAVAILABLE` ("This file could not be read on the device."). They are mirrored as a Kotlin `enum
class FileIssueCode` and a TS `FILE_ISSUE_TEXT` record under the parity test. The UI text for a remote
cause reuses the matching `CloudSyncErrorCode` message.
