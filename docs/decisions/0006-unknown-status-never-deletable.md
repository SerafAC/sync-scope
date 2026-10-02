# D006: How is the UNKNOWN file status treated relative to SYNCED and UNSYNCED?

- **Status**: Accepted
- **Date / context**: M001 Layer 2, decided by the agent at the user's direction
- **Scope**: architecture
- **Made by**: agent
- **Revisable**: No. The scaffold already carries `UNKNOWN` in `FileStatus` and `ISSUES_UNKNOWN` in
  `FileFilter`, and deletion safety depends on it.

## Context

Some files cannot be checked: the remote directory is unreadable, the listing aborted mid-scan, or the
timestamp precision is unusable. The question was whether such files get their own status or are folded
into UNSYNCED.

## Decision

UNKNOWN is a distinct, never-deletable status with its own `ISSUES_UNKNOWN` filter chip and an `issueCode`
explaining why. `prepareLocalDeletion` refuses UNKNOWN entries outright rather than warning about them.

## Rationale

Deletion safety is the entire point of the app, and UNKNOWN means the remote state was genuinely never
established. Collapsing UNKNOWN into UNSYNCED would let a user delete a file behind a warning when the truth
is that nobody checked it.

## Alternatives rejected

- A two-state UI with UNKNOWN folded into UNSYNCED — simpler, but it hides the distinction between "not
  backed up" and "not checked".

## Related

- Requirements: R011, R012, R017
- Features: specs/004-scan-engine-matching, specs/005-gallery-list-filtering,
  specs/006-mvp (absorbed specs/008-multiselect-local-deletion)
