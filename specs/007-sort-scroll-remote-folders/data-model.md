# Data Model: Sorting, Fast Scrolling, Several Server Folders and an App Icon

Persistent changes are one Room schema step (4 → 5, `@AutoMigration` with a spec class) and three values
in `SharedPreferences`. Everything else is derived on read (the scroll index) or held in JS state (anchors,
segments, the folder browser). Bridge shapes are in
[contracts/cloudsync-polish.md](./contracts/cloudsync-polish.md).

## Schema change: version 4 → 5

| Table | Change | Type | Default | Meaning |
| --- | --- | --- | --- | --- |
| `repository_config` | rename `remoteRoot` → `remoteRoots` | `TEXT` not null | (kept) | The remote folders, `\n`-separated, in the user's order ([R11](./research.md#r11-several-remote-folders-storage-and-validation)). An existing single folder is a one-element list. |
| `local_node` | add `sortName` | `TEXT` not null | `''` | The name's sort key: NFKD, accents removed, lowercased, prefixed `0` (`#` band) or `1` (letter) ([R2](./research.md#r2-name-order-and-letter-bands-a-stored-sortname)). |
| `local_node` | add index `(snapshotId, kind, sizeBytes)` | | | Gallery size sorts and size bands. |
| `local_node` | add index `(snapshotId, kind, sortName)` | | | Gallery name sorts and letter bands. |
| `remote_ambiguity` | add `remotePath` | `TEXT` nullable | `NULL` | `REMOTE_FOLDER` gaps only: the configured folder that could not be read ([R14](./research.md#r14-a-scan-that-cannot-read-some-folders)). `NULL` for every other scope. |

- **Migration**: `@AutoMigration(from = 4, to = 5, spec = Migration4To5::class)`. The spec carries
  `@RenameColumn`, and its `onPostMigrate` runs one `UPDATE local_node SET sortName = …` that applies the
  prefix rule to `lower(name)` (accents not folded for old rows; the next refresh recomputes them).
- **Schema export**: `android/app/schemas/.../5.json`.
- **`MigrationTest` (4 → 5)**: a saved repository keeps its folder as `remoteRoots`, `sortName` is filled
  for every existing row, and `remotePath` is `NULL`.
- **`SchemaContractTest`**: `repository_config` still has no secret column.

### Writers

| Column | Written by |
| --- | --- |
| `repository_config.remoteRoots` | `RepositoryOperations.save`, from `config.remoteRoots` after `RemoteRoots.normalize` and the overlap check. |
| `local_node.sortName` | `ScanEngine.scanSource` for every `FILE` and `DIRECTORY` row, through `SortName.of(name)`; a `LOCAL_REFRESH` writes new rows the same way. |
| `remote_ambiguity.remotePath` | `ScanEngine.listRemote` from a `REMOTE_FOLDER` `WalkAmbiguity`; `copyRemoteState` copies it with the row. |

## Repository (existing row, one per install)

| Field | Notes |
| --- | --- |
| `remoteRoots` | Replaces `remoteRoot`. 1 or more folders; each normalized (trimmed, `/`-prefixed, `//` collapsed, no trailing `/`), no newline, no two equal or nested. The first one is used for precision discovery. |
| everything else | Unchanged (006 data model). |

**Rules**:

- **Validation on save** (`RemoteRoots`, the one place this rule lives): an empty list → field error
  `remoteRoots`, `fieldIndex 0`, "Add at least one remote folder." A folder that equals or nests with an
  earlier one → field error at its index: "This folder is the same as, inside or around `/photos`."
- **Revision**: changing the folders bumps `revision` like any other change, so an existing snapshot shows
  the "previous server settings" notice, and `LOCAL_REFRESH` is unavailable until a full scan (006).
- **Redaction**: every folder is a sensitive value (`RemoteConfig.sensitiveValues`).

## Scan run with several folders

| State | Result |
| --- | --- |
| Every folder listed | As today: `coverage = COMPLETE` unless other gaps exist. |
| Some folders fail after the retry policy | Each adds a `REMOTE_FOLDER` gap (`reason` = error code, `remotePath` = folder). Listing is `Incomplete`; the run publishes with `coverage = INCOMPLETE`. |
| Every folder fails | `RootListingFailed` with the first folder's code: the run ends `FAILED` and the active snapshot stays. |

**File verdicts** (`Matcher`, unchanged order):

1. Exact match → `SYNCED`.
2. Same name and size, but no remote mtime → `UNKNOWN` (`REMOTE_MTIME_MISSING`).
3. Listing incomplete → `UNKNOWN`, with `issueCode = REMOTE_FOLDER_UNREAD` if any `REMOTE_FOLDER` gap
   exists, else the first failure code.
4. Otherwise → `UNSYNCED`.

**Summary**: `ScanSummaryDto.unreadRemoteFolders` lists the `remotePath` of the active snapshot's
`REMOTE_FOLDER` gaps, in folder order.

## Sort keys and ordering

| Sort | Primary key (direction-dependent sentinel for `NULL`, R1) | Then |
| --- | --- | --- |
| `NAME_ASC` / `NAME_DESC` | `sortName` | `entryId` |
| `TIME_ASC` / `TIME_DESC` | `COALESCE(modifiedUtcMillis, MAX \| -1)` | `sortName`, `entryId` |
| `SIZE_ASC` / `SIZE_DESC` | `COALESCE(sizeBytes, MAX \| -1)` | `sortName`, `entryId` |

- The sentinel is `Long.MAX_VALUE` in ascending order and `-1` in descending, so unknown values come last
  either way.
- **Page token cursor**: `(sortKey, sortName, lastEntryId)`, with a format version byte. A token from
  before v6 fails as `PAGE_TOKEN_MISMATCH`.
- **`QuerySpec.kind`**: `DIRECTORY` or `FILE`. It narrows the rows and is part of the fingerprint. List
  view reads `kind = DIRECTORY` with `NAME_ASC`, then `kind = FILE` with the chosen sort.

## Scroll index (derived on read, never stored)

| Field | Notes |
| --- | --- |
| `unit` | `LETTER`, `YEAR`, `MONTH`, `DAY` or `SIZE`, from the sort. |
| `totalCount` | `FILE` rows the query shows. |
| `bands[]` | Ordered as the sort. Each band has `startIndex` (0-based, among the files), `count`, `startToken` and one lower bound: `letter` (`#`, `a`…`z`), `startMillis` (local start of the year, month or day) or `lowerBytes`. A final band with `unknown: true` holds files with no value for the sort key. |
| `anchorIndex` | When an anchor `(sortValue, sortName)` is passed: the number of rows that sort before it, clamped to `totalCount − 1`. |

**Band rules**:

- **Letters**: one band per non-empty letter.
- **Dates**: the coarsest of year, month or day that gives at least 5 non-empty bands, else days (R6).
- **Sizes**: the percentile and 1-2-5 rule, with 5–15 bands and no band over half of the files when there
  are at least 8 distinct sizes (R5).
- **Empty bands**: never returned.
- **Scope**: identical to the rows' scope (`scopeOf`): filter, view, source and parent.

## Browse preferences (native `SharedPreferences`, file `browse_preferences`)

| Key | Values | First-run default |
| --- | --- | --- |
| `view` | `GALLERY` \| `LIST` | `GALLERY` (today's `INITIAL_VIEW`) |
| `gallerySort` | any `FileSort` | `TIME_DESC` |
| `listSort` | any `FileSort` | `NAME_ASC` |

An unknown stored value reads as the default, so a value from a newer build never breaks an older one.
The filter is not stored (005 R10).

## JS state (in memory)

| State | Owner | Notes |
| --- | --- | --- |
| Segments | `usePagedQuery` | One per band, plus a folder segment in list view. Each holds its loaded rows, its next token and a phase. The flattened list pads unread rows with placeholders up to the band's `count` (R7). |
| Anchor | each view | `(sortValue, sortName)` of the first visible file, refreshed by `onViewableItemsChanged`; used once per snapshot change (R8). |
| Folder browser | `RepositoryScreen` | Open field index, current path, folders, a phase (`loading`, `ready` or `error`) and a request sequence number. Nothing persists. |
| Remote folder fields | `RepositoryScreen` draft | `remoteRoots: string[]`, replacing `remoteRoot`. FTP/SFTP Host URL paths fill index 0 only; WebDAV shared paths stay in Host and folders are relative to that endpoint (`splitServerAddress`, FR-009b). |
