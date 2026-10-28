# Data Model: Browsable Tree View, Image and Video Preview

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## Schema change, version 5 → 6

One `@AutoMigration(from = 5, to = 6)`, with no data rewrite.

| Table | Change | Why |
| --- | --- | --- |
| `local_node` | New index `index_local_node_snapshotId_sourceId_documentId` on `(snapshotId, sourceId, documentId)` | `carrySelection` joins the old and new snapshot on the stable file key (R9) |
| `scan_run` | New nullable columns `recheckedFolders INTEGER` and `promotedFiles INTEGER` | The refresh re-check outcome, shown on the scan summary card (R5); `NULL` on `FULL` runs and on rows written before version 6 |

`MigrationTest` adds `version5RowsMigrateToVersion6WithTheDocumentIndexAndNullRecheckCounts`.

## Media kind (R6)

| Concept | Rule | Single source |
| --- | --- | --- |
| Media file | `kind = 'FILE'` and `mimeType` starts with `image/` or `video/` | Kotlin `MediaKind` (`SQL_MEDIA` predicate, `of(mimeType)`); TS `isMediaMime` / `mediaKindOf` in `src/files/media.ts`, kept in step by a parity test |
| Video | `mimeType` starts with `video/` | the same two places |

These places stop using `LIKE 'image/%'` and use `MediaKind.SQL_MEDIA` instead:

- `SnapshotStore.scopeOf` (the gallery);
- `LocalNodeDao.statusCounts` (`imagesOnly` → `mediaOnly`);
- `SnapshotStore.selectableEntries` (`isImage` → `isMedia`).

In TypeScript, `SelectionItem.isImage` → `isMedia`, and the gallery's "filtered out" rule in
`selection/summary.ts` follows.

## Thumbnail cache (R6)

Under `cacheDir/thumbnails/`, keyed by `sha256(entryId + "|" + edge)` as today.

| File | Content | Written |
| --- | --- | --- |
| `<hash>.jpg` | The downscaled frame or image | atomically (temp + rename), as today |
| `<hash>.meta` | Videos only: the duration in milliseconds, as decimal text; absent for images and for unreadable durations | atomically, after the JPEG |

A cache hit reads `.meta` when it exists and returns `durationMillis`. The cache is still left to the OS to
reclaim.

## Refresh re-check (R5)

These are working values, not stored except for the two counters on the run.

| Name | Meaning |
| --- | --- |
| Re-checkable file | A `FILE` in the active snapshot with status `UNSYNCED`, or `UNKNOWN` with an issue code other than `LOCAL_UNAVAILABLE` and `REMOTE_MTIME_MISSING` |
| Neighbour folder | The device folder (`parentId`, `sourceId`) of a re-checkable file that also holds at least one `SYNCED` file |
| Candidate server folder | One of `remote_match_key.directories` of a `SYNCED` file in a neighbour folder; weighted by the number of re-checkable files in the neighbour folders that point to it |
| `RECHECK_MAX_FOLDERS` | 32 candidate folders per refresh, the highest weight first; ties broken by path |
| `RECHECK_BUDGET_MILLIS` | 20 000 ms for connecting and listing; when it runs out, the folders already listed are kept |

Rules:

- New keys go into the staged snapshot's `remote_match_key` with `INSERT OR IGNORE` on the existing unique
  key `(snapshotId, name, sizeBytes, precisionMillis, bucket)`. Existing keys, their `duplicateCount` and
  their `directories` are not changed. A new key's `directories` is the listed folder.
- The verdicts come from the unchanged `Matcher`. A file is never demoted by the re-check.
- `scan_run.recheckedFolders` is the number of folders listed successfully. `scan_run.promotedFiles` is the
  number of files that were re-checkable in the active snapshot and are `SYNCED` in the new one, counted
  per `(sourceId, documentId)`.

## Selection carry-over (R9)

`carrySelection(from, to, entryIds)` maps `from.entryId` to `to.entryId` where both rows are `FILE`s and
match on:

```text
from.sourceId = to.sourceId
AND from.documentId = to.documentId
AND from.sizeBytes IS to.sizeBytes
AND from.modifiedUtcMillis IS to.modifiedUtcMillis
```

The IDs are read in batches of 900, under SQLite's variable limit. An entry with no match counts as
`dropped`. A selection item keeps its size from the new row, and its status from the new row's status.

## Tree view state (JS only, R1–R3)

```ts
interface TreeState {
  /** Expanded folders as name paths from the source root, e.g. ['src-1', 'DCIM', 'Camera']. */
  expanded: readonly (readonly string[])[];
  /** The first visible row's name path, for re-finding it on a new snapshot. */
  anchor: readonly string[] | null;
}
```

It is held in `FilesProvider` beside the list view's folder, for the session only. The flattened rows are
derived:

| Row kind | Fields | Notes |
| --- | --- | --- |
| `source` | `sourceId`, alias, counts | Depth 0; one per selected source, like list view's root |
| `folder` | `entryId`, `path`, `depth`, `name`, `matchingFileCount`, `expanded` | Dimmed when `matchingFileCount === 0`; still expandable |
| `file` | `entry: FileEntryDto`, `depth` | Thumbnail when media |
| `more` | `folderPath`, `nextPageToken` | Reads the next page of that folder when visible |
| `placeholder` | `folderPath` | Shown while a folder's first page loads |

Every row is `density.rowHeight` (56 dp) high. Each depth indents by `spacing.lg`, up to depth 8, and
deeper rows keep the depth-8 indent.

## Preview route params

```ts
type PreviewParams = {
  snapshotId: string;
  entryId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  status: FileStatus;
};
```
