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

## Alternatives rejected

- A single-call delete with a boolean force flag — no way to show an honest pre-flight summary.

## Related

- Requirements: R012, R013
- Features: specs/006-mvp (absorbed specs/008-multiselect-local-deletion)
