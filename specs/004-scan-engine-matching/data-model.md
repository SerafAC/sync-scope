# Data Model: Scan Engine, Matching and Snapshot Lifecycle

The tables already exist (schema version 1, feature 002). This feature **adds two columns** (schema
version 2, a Room auto-migration) and defines how the scan fills every table. Entities are in
`android/app/src/main/java/com/syncscope/persistence/Entities.kt`; the code wins where it differs from this
page.

## Schema change: version 1 → 2

| Table | Column | Type | Default | Why |
| --- | --- | --- | --- | --- |
| `scan_run` | `mode` | `TEXT NOT NULL` | `'FULL'` | Distinguishes `FULL` from `LOCAL_REFRESH` (research R2). |
| `snapshot` | `remoteListedAtMillis` | `INTEGER` (nullable) | `NULL` | The remote listing's age (FR-003). A `LOCAL_REFRESH` copies it from the active snapshot, so it is not the same as `completedAtMillis`. |

`@AutoMigration(from = 1, to = 2)` with the exported `2.json`. No destructive fallback (unchanged rule).

## ScanRun (`scan_run`)

| Field | Rule |
| --- | --- |
| `runId` | UUID. |
| `generation` | `maxGeneration() + 1`, read and inserted in one transaction; unique and monotonic. |
| `mode` | `FULL` or `LOCAL_REFRESH`. |
| `configRevision` | `repository_config.revision` at start. `LOCAL_REFRESH` requires it to equal the active snapshot's `configRevision`. |
| `includeHidden` | Always `false` in this feature (research R8). |
| `phase` | See the state machine below. |
| `terminalState` | `null` while running, then `COMPLETED`, `CANCELLED`, `FAILED` or `ABORTED`. |
| `errorCode` / `errorSummary` | `FAILED`: the `CloudSyncErrorCode` and redacted message. `CANCELLED`: `errorSummary` is `USER` or `BACKGROUNDED`. |

### State machine

```text
FULL:           CONNECTING → LISTING_REMOTE → ENUMERATING_LOCAL → PUBLISHING → PUBLISHED  (COMPLETED)
LOCAL_REFRESH:  COPYING_REMOTE ─────────────→ ENUMERATING_LOCAL → PUBLISHING → PUBLISHED  (COMPLETED)

any non-terminal phase ── cancelScan / onHostPause ──→ CANCELLED  (staged snapshot deleted)
CONNECTING, or LISTING_REMOTE before the root lists ──→ FAILED     (staged snapshot deleted, FR-006)
process death (found on next start) ─────────────────→ ABORTED    (existing abortAbandonedRuns)
```

Matching happens inside `ENUMERATING_LOCAL`, file by file. Only `PUBLISHED` / `COMPLETED` moves the
`active_snapshot` pointer (SC-003). A run with an incomplete remote listing still reaches `COMPLETED` and is
promoted, because it is complete and honestly marked (FR-005).

## Snapshot (`snapshot`, `active_snapshot`)

| Field | Rule |
| --- | --- |
| `snapshotId` | UUID, staged with `publishable = false` at run start. |
| `coverage` | `COMPLETE`, or `INCOMPLETE` when the snapshot has any `remote_ambiguity` row of scope `REMOTE_DIRECTORY`, `REMOTE_LISTING` or `SOURCE`. |
| `remoteListedAtMillis` | `FULL`: when the remote walk finished. `LOCAL_REFRESH`: copied from the active snapshot. |
| `completedAtMillis` | Set by `publish`. |

`active_snapshot` keeps pointing at the last `COMPLETED` snapshot. `FAILED` and `CANCELLED` runs set
`lastAttemptSummary` (the run's outcome) and leave `snapshotId` unchanged.

## LocalNode (`local_node`)

| Field | Rule |
| --- | --- |
| `entryId` | UUID (opaque across the bridge). |
| `parentId` | The parent directory's `entryId`; `null` for direct children of a source root. |
| `kind` | `FILE` or `DIRECTORY`. |
| `name` | The display name exactly as the provider reports it (not normalized). |
| `documentId`, `documentUri` | Native only; never cross the bridge. |
| `sizeBytes`, `modifiedUtcMillis` | From `LocalFile`; `null` for directories. |
| `precisionMillis` | The run's precision (discovered at connect, or copied for `LOCAL_REFRESH`). |
| `status`, `issueCode` | FILE: from `Matcher` (below). DIRECTORY: worst-of rollup over descendant files, UNKNOWN > UNSYNCED > SYNCED; an empty directory is SYNCED. A directory's `issueCode` is always `null`. |

Hidden entries (name starts with `.`) and their subtrees are not stored (`includeHidden = false`).

## RemoteMatchKey (`remote_match_key`)

| Field | Rule |
| --- | --- |
| `name` | `Normalizer.normalize(remoteName, NFC)`. |
| `sizeBytes` | As listed. |
| `precisionMillis` | The run's precision. |
| `bucket` | `Math.floorDiv(modifiedUtcMillis, precisionMillis)`, or `MTIME_UNKNOWN_BUCKET = Long.MIN_VALUE` when the remote gave no mtime (research R4). |
| `duplicateCount` | Number of remote regular files that collapsed onto this key (for example `duplicates/{a,b}/reusable.jpg` → 1 row, count 2). |

Unique on `(snapshotId, name, sizeBytes, precisionMillis, bucket)` (existing index). Only `REGULAR_FILE`
entries are keyed. `remote_node` is not written by this feature: nothing reads it (Principle II).

## RemoteAmbiguity (`remote_ambiguity`)

| `scope` | Filled when | Other fields | Carried by `LOCAL_REFRESH` |
| --- | --- | --- | --- |
| `REMOTE_DIRECTORY` | A non-root directory could not be listed | `reason` = error code | yes |
| `REMOTE_LISTING` | The walk stopped after 3 failed transient attempts | `reason` = error code | yes |
| `SOURCE` | A source was skipped or failed mid-walk | `sourceId`, `reason` = `GRANT_REVOKED`, `STORAGE_MISSING` or `LOCAL_UNAVAILABLE` | no (recomputed) |

`reason` never contains a path or host (D011 redaction).

## SnapshotCounts (`snapshot_counts`)

One row per `(sourceId, status)` for FILE rows, plus one row per status with `sourceId = null` holding the
totals. They are written at `PUBLISHING` and read by `getScanState` to build the summary without a
full-table count.

## Matching rules (`Matcher`, FILE rows)

Evaluated in order; the first rule that applies wins.

| # | Condition | status | issueCode |
| --- | --- | --- | --- |
| 1 | Local `sizeBytes` or `modifiedUtcMillis` is null | UNKNOWN | `LOCAL_UNAVAILABLE` |
| 2 | `(nfc(name), size, floorDiv(mtime, precision))` is in the index | SYNCED | null |
| 3 | `(nfc(name), size, MTIME_UNKNOWN_BUCKET)` is in the index | UNKNOWN | `REMOTE_MTIME_MISSING` |
| 4 | The remote listing is incomplete | UNKNOWN | the first listing failure's code |
| 5 | Otherwise | UNSYNCED | null |

Rule 2 comes before rule 4: a file that found a match stays SYNCED even if the listing is incomplete
(clarification 1). A match in an adjacent bucket is **not** a match (clarification 2). Letter case matters
(clarification 3).

## Completion summary (derived, not stored)

Built by `getScanState` from `snapshot_counts` and `remote_ambiguity`:

- `synced`, `unsynced` and `unknown` file totals (`unknown` is "files that could not be checked");
- `unreadableRemoteDirectories` (count of `REMOTE_DIRECTORY` rows);
- `remoteListingInterrupted` (a `REMOTE_LISTING` row exists) with its reason code;
- `skippedSources`: `{sourceId, alias, reason}` for each `SOURCE` row.

## Kotlin-only types

| Type | Package | Role |
| --- | --- | --- |
| `ScanEngine` | `scan` | Runs one mode end to end against the store, the remote client factory and the enumerator. |
| `RemoteWalker` | `scan` | Breadth-first remote listing with the retry and failure rules (research R5). |
| `MatchIndex` | `scan` | `(nfcName, size, bucket) → count`; built from a walk or from rows; owns `MTIME_UNKNOWN_BUCKET` and `bucketOf`. |
| `Matcher` | `scan` | The pure rule table above. |
| `DirectoryRollup` | `scan` | Worst-of status propagation from files to ancestor directories. |
| `ScanProgress` / `ScanCoordinator` | `scan` | Single-flight run holder, progress snapshots, cancel and lifecycle hooks. |
