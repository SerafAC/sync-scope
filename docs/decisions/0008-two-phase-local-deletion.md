# D008: How is local deletion executed?

- **Status**: Accepted
- **Date / context**: M001 Layer 2 architecture discussion
- **Scope**: architecture
- **Made by**: agent
- **Revisable**: No. The method pair is already declared in the TurboModule contract.

## Context

Deleting local files is the app's only mutating action and its reason to exist. It is irreversible, it acts
on a multi-selection that may have gone stale, and individual files can fail independently (a revoked
grant, a file already gone).

## Decision

Two phases. `prepareLocalDeletion` returns a plan token plus a breakdown of synced, unsynced-warned and
unknown-refused counts. `executeLocalDeletion(planToken)` commits, with per-file outcomes written to
`local_deletion_overlay` on success only.

## Rationale

Deletion is irreversible and the whole app exists to drive it. A plan token lets the confirmation dialog
show exactly what will happen and prevents a stale multi-select from deleting the wrong set. Per-file
outcomes mean a revoked grant or an already-missing file reports individually rather than failing the
batch, and recording only successes means the catalog never claims a deletion that did not happen.

## Amendment 2026-10-02

Feature 006 (MVP) implemented both methods (contract version 5). The two-phase decision stands; two
details changed (research R13 and R14):

- **`executeLocalDeletion(planToken, includeUnsynced)`.** The second argument is the stronger
  acknowledgement for not-backed-up files (spec Story 6 sc. 3). Without it, the plan's `unsynced` rows
  are skipped. The acknowledgement belongs to the confirmation, after the breakdown was shown, so it
  rides on execute rather than on a second prepare, which would repeat the server re-check
  ([D020](./0020-pre-delete-server-recheck.md)). UNKNOWN rows are never in a plan's delete set, whatever
  the argument ([D006](./0006-unknown-status-never-deletable.md)).
- **Plans.** At most one plan exists, in memory: a new prepare replaces it, it is single-use, it expires
  after 15 minutes (`PLAN_NOT_FOUND`), and it is refused when the active snapshot moved (`PLAN_STALE`).
  Process death loses it, which is safe: the user prepares again.
- **Rows are removed, the overlay is the audit.** For every file that ends `DELETED` or `ALREADY_GONE`,
  one Room transaction per batch of 100 (`SnapshotStore.recordDeletions`) deletes the `local_node` row,
  decrements `snapshot_counts` and every ancestor folder's `desc*` count, and inserts the
  `local_deletion_overlay` row as the audit record. Read queries need no overlay filter. `CHANGED`,
  `ACCESS_LOST` and `FAILED` change nothing. Folders are never removed, even when they become empty
  (clarification 4). An interrupted run keeps every committed batch, and the next app-open
  `LOCAL_REFRESH` re-enumerates the device.
- **Exclusive.** Prepare and execute run through `ScanCoordinator.runExclusive`: they refuse while a scan
  runs (`SCAN_IN_PROGRESS`) or another deletion runs (`DELETION_IN_PROGRESS`), and a scan cannot start
  meanwhile.

"Per-file outcomes written on success only" above now reads: only real successes (`DELETED`,
`ALREADY_GONE`) change the results and are written to the overlay.

## Alternatives rejected

- A single-call delete with a boolean force flag — no way to show an honest pre-flight summary.
- (2026-10-02) Keeping deleted rows and filtering every read with `NOT EXISTS (overlay)`: every read path,
  including precomputed folder counts, would need the filter.
- (2026-10-02) Persisting plans in Room: nothing needs them across a process restart.

## Related

- Requirements: R012, R013
- Features: specs/006-mvp (absorbed specs/009-multiselect-local-deletion; research R13, R14)
- Decisions: [D006](./0006-unknown-status-never-deletable.md), [D020](./0020-pre-delete-server-recheck.md)
