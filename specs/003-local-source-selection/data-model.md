# Data Model: Local Source Selection via SAF

**Feature**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

The Room schema does **not** change: `source_root` already has every column this feature needs
(`SyncScopeDatabase` stays at version 1, and `android/app/schemas/.../1.json` is unchanged). This feature
adds DAO queries, computed values and bridge DTOs. The authoritative entity definition is
`android/app/src/main/java/com/syncscope/persistence/Entities.kt` (`SourceRootEntity`).

## SourceRoot (`source_root`, persisted)

| Field | Type | Rule |
| --- | --- | --- |
| `sourceId` | TEXT, PK | Random UUID assigned on add. Never reused, and kept across Re-grant. |
| `treeUri` | TEXT | Tree URI returned by the picker. Replaced on Re-grant. |
| `authority` | TEXT | Always `com.android.externalstorage.documents` (research R2). |
| `volumeId` | TEXT | `primary`, or the removable volume's UUID (`XXXX-XXXX`). |
| `documentPath` | TEXT | Path within the volume without leading or trailing `/`. Empty for a volume root. |
| `canonicalRoot` | TEXT, unique | `<authority>/<volumeId>:<documentPath>` (R3). Must not overlap any other row (FR-002). |
| `alias` | TEXT | Generated once, unique case-insensitively, never edited or recomputed (FR-004, R6). |
| `canWrite` | INTEGER (bool) | Whether the persisted grant includes write. Refreshed on Re-grant. |
| `addedAtMillis` | INTEGER | UTC time of the add. It sets the list order and is kept across Re-grant. |

### Validation rules

- **V1 – provider**: the authority must be `com.android.externalstorage.documents`, otherwise
  `SOURCE_UNSUPPORTED`.
- **V2 – no overlap**: for every existing row with the same `authority` and `volumeId`, neither
  `documentPath` may equal the other or be its prefix at a `/` boundary. An empty path (a volume root)
  overlaps every path on its volume. A violation gives `SOURCE_OVERLAP` naming the first conflicting row.
  The unique index remains as a backstop for an exact duplicate.
- **V3 – Re-grant target**: a re-grant result must produce the same `canonicalRoot` as the target row,
  otherwise `SOURCE_REGRANT_MISMATCH`.
- **V4 – alias uniqueness**: the alias is unique among current rows, compared case-insensitively.

**Order.** An add checks V1, then V2. A re-grant checks V1, then V3, and never V2: a pick whose
`canonicalRoot` equals the target row's cannot overlap another row, because the target row passed V2 when
it was added. So a re-grant of a different folder always gives `SOURCE_REGRANT_MISMATCH`, even when that
folder also overlaps another source.

A pick rejected by V1–V3 persists nothing, and the grant just taken is released.

### Availability (computed on read, not stored)

```text
                ┌──────────────────── grant missing ───────────────────┐
                │                                                      ▼
  add ──▶ AVAILABLE ◀── Re-grant (same canonicalRoot) ──  GRANT_REVOKED
                │  ▲                                                    │
   root query   │  │ root query succeeds again                          │
   fails        ▼  │ (card re-inserted)                                 │
          STORAGE_MISSING ────── Re-grant (same canonicalRoot) ─────────┤
                                                                        │
  Remove (from any state, after confirmation) ──▶ row and scan data deleted, grant released
```

Evaluation order for each row (R5): first `GRANT_REVOKED` if no persisted grant with read permission
matches `treeUri`, then `STORAGE_MISSING` if the root-document query fails or returns no row, otherwise
`AVAILABLE`.

### Removal cascade (FR-005, R7)

One Room transaction, in this order, all scoped to the source's `sourceId`:

1. `local_deletion_overlay` rows whose `localEntryId` is one of the source's `local_node.entryId`;
2. `remote_ambiguity` rows with the `sourceId`;
3. `snapshot_counts` rows with the `sourceId`;
4. `local_node` rows with the `sourceId` (their foreign key to `source_root` has no cascade);
5. the `source_root` row.

After the commit, the persisted SAF permission is released and a `SecurityException` is ignored. Snapshots,
match keys and the other sources' rows are untouched; browse counts are computed from `local_node`, so
they stay correct.

## SourceDto (bridge, not persisted)

This is what `listSources` and `launchSourcePicker` return per source. The field list is in
[contracts/cloudsync-sources.md](./contracts/cloudsync-sources.md).

| Field | From |
| --- | --- |
| `sourceId`, `alias`, `canWrite`, `addedAtMillis` | the `source_root` row |
| `volumeLabel` | `StorageManager` description for `volumeId`, or "Removable storage" when the volume is not mounted |
| `displayPath` | `documentPath`, or an empty string for a volume root |
| `isRemovable` | `volumeId != "primary"` |
| `availability` | `AVAILABLE`, `GRANT_REVOKED` or `STORAGE_MISSING`, computed |

`treeUri` and `canonicalRoot` never cross the bridge. JS refers to a source only by `sourceId`.

## LocalFile and SourceListing (Kotlin only, provided to feature 004)

```text
SourceListing = Available(files: Sequence<LocalFile>) | Skipped(reason: GRANT_REVOKED | STORAGE_MISSING)

LocalFile:
  documentId        String    SAF document ID, stable within the source
  parentDocumentId  String?   null for direct children of the source root
  name              String
  isDirectory       Boolean
  isHidden          Boolean   name starts with "."
  mimeType          String?
  sizeBytes         Long?     null for directories
  modifiedUtcMillis Long?     COLUMN_LAST_MODIFIED; null when the provider reports 0 or nothing
```

An unavailable source is always `Skipped`, never `Available` with an empty sequence (FR-003).
