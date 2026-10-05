# Data Model: MVP — a Usable App on a Real Device

Persistent changes are one Room schema step (3 → 4, `@AutoMigration`). Everything else is in-memory state
on the native side (deletion plans) or the JS side (form, checklist, selection). Bridge shapes are in
[contracts/cloudsync-mvp.md](./contracts/cloudsync-mvp.md).

## Schema change: version 3 → 4

| Table | Column | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `remote_match_key` | `directories` | `TEXT` nullable | `NULL` | Distinct remote parent directories of the files collapsed into this key, `\n`-separated, at most 16 ([research R11](./research.md#r11-server-locations-of-matched-files-for-the-re-check)). `NULL` on rows written before version 4. |
| `repository_config` | `webdavHttps` | `INTEGER` (boolean) not null | `0` | WebDAV only: connect over HTTPS ([R4](./research.md#r4-webdav-over-https-and-cleartext-in-release-builds)). Existing rows keep plain HTTP. |

- Both are additive. The migration is `@AutoMigration(from = 3, to = 4)`, and the exported schema is
  `android/app/schemas/.../4.json`. `MigrationTest` covers 3 → 4: existing rows survive, `directories`
  is `NULL` and `webdavHttps` is `0`.
- `SchemaContractTest` keeps proving that `repository_config` has no secret column.
- `local_deletion_overlay` is unchanged in shape. Its `state` values are now defined as `DELETED` and
  `ALREADY_GONE`, the only outcomes that remove a row (R14).

### Writers

| Column | Written by |
| --- | --- |
| `remote_match_key.directories` | `MatchIndex.add(entry, directory)` during the remote walk; `toRows` joins the set. `LOCAL_REFRESH` copies the column with the rest of the key (`RemoteMatchKeyDao.copy`, extended by one column). |
| `repository_config.webdavHttps` | `RepositoryOperations.save` from the new config field. |

## Repository (existing row, one per install)

| Field | Notes |
| --- | --- |
| `protocol` | `FTP` \| `SFTP` \| `WEBDAV` |
| `host`, `port`, `username`, `remoteRoot` | Validated by native `parse`. `port` empty → `REPOSITORY_DEFAULT_PORTS` for the protocol (WebDAV + HTTPS → 443). |
| `webdavHttps` | New. Ignored for FTP and SFTP. |
| `credentialVersion` | Pointer into the Keystore-backed store. The password never leaves native code. |
| `revision` | Bumped on every save. Now exposed in the summary (R15). |
| `precisionMillis` | Written by `testRepository`. |

**Rules**:

- No password on save keeps the stored one only for the same protocol, host, port and user (feature 002,
  `sameAccount`).
- Save is refused while a scan or deletion runs (R3).

## Snapshot (existing)

`configRevision` is now exposed on `ActiveSnapshotDto`. When it differs from the repository's `revision`,
the Scan tab shows the "previous server settings" notice and `prepareLocalDeletion` refuses with
`REPOSITORY_CHANGED`.

A published snapshot is no longer strictly immutable. Deletion removes `local_node` rows and decrements
counts inside it, in one transaction per batch (R14). The snapshot ID does not change.

### Deletion write rule (`SnapshotStore.recordDeletions(snapshotId, outcomes)`)

For each outcome whose state is `DELETED` or `ALREADY_GONE`, in one transaction per batch of ≤ 100:

1. `DELETE FROM local_node WHERE snapshotId = ? AND entryId = ?`.
2. Decrement `snapshot_counts.count` for `(snapshotId, row.sourceId, row.status)`.
3. Walk `parentId` up to the source root and decrement the ancestor's `descSynced`, `descUnsynced` or
   `descUnknown`, picked by `row.status`. Rows written before version 3 have `NULL` counts, which stay
   `NULL`.
4. Insert `local_deletion_overlay(snapshotId, localEntryId, state, atMillis)`.

**Invariant**, tested in `SnapshotStoreTest`: after any batch, each directory's three counts equal the
`FILE` rows beneath it by status, and `snapshot_counts` equals a `GROUP BY` over the remaining rows. This
is the same invariant `DirectoryRollupTest` pins for a fresh snapshot.

## Deletion plan (native, in memory)

| Field | Notes |
| --- | --- |
| `token` | Random UUID string. At most one plan exists; a new prepare replaces it. |
| `snapshotId` | Must still be the active snapshot at execute time, else `PLAN_STALE`. |
| `createdAtMillis` | The plan expires 15 minutes later (`PLAN_NOT_FOUND`). |
| `toDelete` | SYNCED rows confirmed on the server by the re-check. |
| `unsynced` | UNSYNCED rows, plus SYNCED rows the re-check found gone (`GONE_FROM_SERVER`). |
| `refused` | UNKNOWN rows (D006), plus SYNCED rows with `RECHECK_FAILED` or `SCAN_TOO_OLD`. |
| `missing` | Requested IDs that are not `FILE` rows of the snapshot. Only counted. |
| `movedByRecheck` | Count of SYNCED rows moved to `unsynced` or `refused` by the re-check. |
| `remoteListedAtMillis` | From the snapshot: the scan age shown at the point of decision (R015). |

Each row keeps `entryId`, `sourceId`, `parentId`, `documentUri`, `name`, `sizeBytes`, `modifiedUtcMillis`
and `status`. That is what execute needs, and none of it crosses the bridge except `entryId` and `name`
in failures.

### Plan lifecycle

```text
(none) ──prepare ok──▶ READY ──execute──▶ CONSUMED (removed)
          │               │ └─15 min / new prepare──▶ (removed)          → PLAN_NOT_FOUND
          │               └─active snapshot moved──▶ refused at execute  → PLAN_STALE
          └─prepare error (connection, auth, host key, busy, changed repo) ──▶ (none), nothing stored
```

### Per-file outcome (execute)

| State | When | Row removed? | Reported as |
| --- | --- | --- | --- |
| `DELETED` | `deleteDocument` succeeded | yes | counted in "deleted" and "freed" |
| `ALREADY_GONE` | the document no longer exists | yes | failure list: "Already gone" |
| `CHANGED` | the size or modified time differs from the scan | no | failure list: "Changed since the scan" |
| `ACCESS_LOST` | no write grant on the source, or `SecurityException` | no | failure list: "No permission to delete in this folder" |
| `FAILED` | any other error | no | failure list: "Could not be deleted" |
| `SKIPPED_UNSYNCED` | in `unsynced`, and `includeUnsynced` is false | no | not listed; the dialog already said so |

## Selection (JS, `SelectionProvider`)

| Field | Notes |
| --- | --- |
| `snapshotId` | The snapshot the IDs belong to. When `useScan`'s active snapshot changes, the selection clears with a notice. |
| `items` | `Map<entryId, {sizeBytes: number \| null, status, isImage}>`. `FILE` rows only. |

**Derived** (`selectionSummary(items, view, filter)`): `count`, `knownBytes` (the sum of non-null
sizes), `unknownSizeCount`, and `hiddenByFilterCount` (status not in the filter, or not an image while in
gallery view).

**Transitions**:

| Event | Effect |
| --- | --- |
| long-press a file (empty selection) | enter selection mode with that file |
| tap a file (selection mode) | toggle it |
| tap a directory (selection mode) | navigate; the selection is kept |
| "Select all" | merge `listSelectableEntries(snapshotId, currentQuery)` into `items` |
| ✕, back, or the last item removed | clear and leave selection mode |
| view or filter change | keep |
| active snapshot changes | clear, with snackbar "Results were updated, so the selection was cleared." |
| deletion finished | remove the deleted IDs; leave selection mode when empty |

## Repository form (JS, `RepositoryScreen` / `useRepository`)

**States**: `idle`, `saving`, `testing`, `connected` (with `entryCount`), `failed` (with code, message,
action and optional `field`), `hostKeyPrompt` (with `challenge` and `changed: boolean`), `rejected`.

**Draft**: `protocol`, `host`, `port`, `username`, `password`, `remoteRoot` and `webdavHttps`, prefilled
from the summary except `password`. The dirty check compares the draft with the summary and treats any
typed password as dirty.

## Setup checklist (JS, derived, never stored)

| Item | Source | Values |
| --- | --- | --- |
| `repository` | `getRepositorySummary` | `missing` (`REPOSITORY_NOT_CONFIGURED`), `needsPassword` (`credentialPresent=false`), `ready` |
| `folders` | `listSources` | `none`, `noneAvailable` (every source has `GRANT_REVOKED` or `STORAGE_MISSING`), `ready` |
| `resultsFromOldSettings` | snapshot `configRevision` ≠ repository `revision` | boolean |
