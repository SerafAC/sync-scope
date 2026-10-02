# Data Model: Gallery View, Browsable List, Filtering and Material 3 Shell

The persistent model is 004's ([004 data-model](../004-scan-engine-matching/data-model.md)). This feature
adds three nullable columns, changes two query rules, and adds UI-side state. Decisions are in
[research.md](./research.md).

## Schema change: version 2 → 3

`@AutoMigration(from = 2, to = 3)`, purely additive. The exported schema is
`android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/3.json`.

| Table | Column | Type | Meaning |
| --- | --- | --- | --- |
| `local_node` | `descSynced` | `INTEGER NULL` | `DIRECTORY` rows: number of `FILE` rows anywhere beneath it with status `SYNCED`. `NULL` on `FILE` rows and on rows written before version 3. |
| `local_node` | `descUnsynced` | `INTEGER NULL` | Same, status `UNSYNCED`. |
| `local_node` | `descUnknown` | `INTEGER NULL` | Same, status `UNKNOWN` (the `ISSUES_UNKNOWN` set). |

No new index: the counts are read from the row already selected by
`index_local_node_snapshotId_sourceId_parentId_kind_name`.

**Written by** `DirectoryRollup.finish()`. Besides the worst-of status, each registered directory gets the
three counts, raised along the same ancestor walk that propagates status (every ancestor of a file counts
it once). An empty directory gets `0 / 0 / 0`. Both `FULL` and `LOCAL_REFRESH` runs go through the rollup,
so every newly published snapshot has the counts.

**Invariant** (unit-tested): for a source's top-level directories plus top-level files, the sums equal that
source's per-status `FILE` counts.

## Read rules (changes to `SnapshotStore.queryFilePage`)

| Rule | Before (004) | After |
| --- | --- | --- |
| Gallery file set | `kind = 'FILE' AND (mimeType LIKE 'image/%' OR mimeType LIKE 'video/%')` | `kind = 'FILE' AND mimeType LIKE 'image/%'` (R6) |
| Filter on directory rows (`queryTreeChildren`) | Filter applied to the directory's rolled-up status | **Not applied**: directories are always returned; the filter narrows `FILE` rows only (R3) |
| Filter on `queryFiles` (no parent) | As before | Unchanged |
| First-page `counts` scope | Whole snapshot, `kind = 'FILE'` | `kind = 'FILE'`, plus `mimeType LIKE 'image/%'` for `GALLERY`, plus `sourceId = ?` when given. Never narrowed by `filter`, `parentId` or `search` (R6) |
| `nameInOtherSource` | — | `GALLERY`: `EXISTS` same `name`, `kind = 'FILE'`, other `sourceId`, same snapshot. `LIST`: `false` (R5) |
| `matchingFileCount` | — | `DIRECTORY` rows: `ALL` → `descSynced + descUnsynced + descUnknown`; `SYNCED` → `descSynced`; `UNSYNCED` → `descUnsynced`; `ISSUES_UNKNOWN` → `descUnknown`. `null` on files and on pre-v3 rows (R3) |

The page-token fingerprint is unchanged (filter, view, sort, source, parent and search already cover every
dimension that changes the row set).

## Wire entities (contract version 4)

See [contracts/cloudsync-browse.md](./contracts/cloudsync-browse.md) for the exact TypeScript.

- **FileEntryDto** (004) gains:
  - `nameInOtherSource: boolean`: drives the gallery origin badge (FR-001, clarification 1).
  - `matchingFileCount: number | null`: drives the list view's directory count and dimming
    (FR-002, clarification 3).
- **FilePageDto**: unchanged shape; `counts` follows the new scope rule above.
- **LocalImageHandleDto** (new): `{ uri: string }`, a `file://` URI of a JPEG in the app's cache. It is
  never a document URI or a user path (R7).

## UI-side state (TypeScript, not persisted)

### FileQuery (spec entity)

The `QuerySpec` a view sends, derived and never typed by the user:

| Field | Gallery | List (top level) | List (inside a source or folder) |
| --- | --- | --- | --- |
| `filter` | shared filter | shared filter | shared filter |
| `view` | `GALLERY` | — (source rows come from `listSources`) | `LIST` |
| `sort` | `TIME_DESC` | — | `NAME_ASC` |
| `sourceId` | unset | each source, for its count read | the source being browsed |
| `parentId` | unset (`queryFiles`) | — | the folder's `entryId`, or `null` at the source root (`queryTreeChildren`) |
| `search` | unset | — | unset, except in the relocation walk (R2) |
| `pageSize` | 100 | 1 (count read) | 100 |

### FilePage (spec entity), as held by `usePagedQuery`

```text
PagedState {
  snapshotId: string           // the snapshot every held row came from
  entries: FileEntryDto[]      // concatenated pages, all from snapshotId
  nextPageToken: string | null
  counts: StatusCountDto[] | null   // from page 1
  phase: 'idle' | 'loading-first' | 'ready' | 'loading-more' | 'error'
  error: CloudSyncError | null
}
```

Transitions:

```text
idle ──(snapshotId set)──▶ loading-first ──ok──▶ ready ──(end reached, token)──▶ loading-more ──ok──▶ ready
                              │                    │                                  │
                              └──error──▶ error ◀──┴──────────(error)─────────────────┘
ready | loading-more | error ──(active snapshotId changes, or SNAPSHOT_NOT_FOUND / PAGE_TOKEN_MISMATCH /
                                STALE_GENERATION)──▶ loading-first (rows dropped; "Results updated" if rows were shown)
any ──(query changes: filter, folder)──▶ loading-first (no snackbar)
```

A response whose `snapshotId` or query no longer matches the current one is dropped. That is the guard
against mixing two snapshots and against out-of-order filter switches.

### Navigation stack (list view)

```text
ListLocation = { kind: 'sources' }
             | { kind: 'folder', sourceId, alias, path: Array<{ entryId: string | null, name: string }> }
```

`path[0]` is the source root (`entryId: null`). The breadcrumb renders `All folders`, the alias, then each
`path` name. Tapping a crumb truncates the stack. After a snapshot change, the stack is re-resolved by name
(R2). If a level is missing, the location is the deepest level that resolved.

### Shared Files state (`FilesProvider`)

`{ view: 'GALLERY' | 'LIST', filter: FileFilter }`, with initial value `{ GALLERY, ALL }`. It is kept while
the app runs and reset on restart (R10).

### Chip model

```text
chip ALL            count = Σ counts
chip SYNCED         count = counts[SYNCED]   ?? 0
chip UNSYNCED       count = counts[UNSYNCED] ?? 0
chip ISSUES_UNKNOWN count = counts[UNKNOWN]  ?? 0
```
