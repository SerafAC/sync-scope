# Sync and deletion safety

The app exists to drive one irreversible action: deleting local files. This page describes the rules that
make its SYNCED / UNSYNCED / UNKNOWN verdict trustworthy and its deletions safe. Rationale lives in the
linked decision records.

## Matching: name + size + mtime, never directory structure

A local file is SYNCED when a remote file exists with the same **name**, the same **size**, and a
**modified time within the same precision bucket** (R007, [D003](./decisions/0003-directory-agnostic-sync-matching.md)).

- **Directories are ignored entirely.** Android album directories and cloud-flattened remote layouts will
  never line up. Duplicates on both sides are fine: what matters is that a given file is backed up
  somewhere.
- Matching is an indexed exact lookup on a collapsed `remote_match_key` of
  `(snapshotId, name, sizeBytes, precisionMillis, bucket)`. Local nodes look up by `(name, sizeBytes)` and
  then compare mtime inside the bucket.
- A stricter checksum mode is deferred (R023, see [scope](./scope.md#deferred)), because it would require
  downloading remote content.

## Precision is discovered at connect time

Timestamp precision is measured for each server when the app connects, not hardcoded per protocol
([D004](./decisions/0004-discovered-timestamp-precision.md)). FTP is second-precision at best and sometimes
only minute- or day-granular via LIST; a file compared at minute precision is materially weaker proof than
one compared at second precision. The discovered precision and how it was derived are recorded with the
snapshot, so a weak comparison basis stays visible. Per-protocol details are in
[protocols](./protocols.md).

## UNKNOWN is never deletable

UNKNOWN means the remote state was genuinely never established: the remote directory was unreadable, the
listing aborted mid-scan, or the timestamp precision was unusable
([D006](./decisions/0006-unknown-status-never-deletable.md)).

- It is a distinct status with its own `ISSUES_UNKNOWN` filter chip and an `issueCode` explaining why.
- `prepareLocalDeletion` refuses UNKNOWN entries outright, even behind a warning (R012, R017).
- UNSYNCED files may be deleted, but only behind a stronger warning; SYNCED files are the default target
  (R012).

## Partial scans are shown as partial

A scan never aborts wholesale on an unreadable directory or a dropped connection
([D011](./decisions/0011-typed-error-envelopes-partial-scans.md), R017).

- Affected files become UNKNOWN with an `issueCode`.
- The run reports an honest completion summary that states plainly how many files could not be checked.
- A partial run never becomes the active snapshot; backgrounding mid-scan stops the run and discards the
  partial snapshot ([D009](./decisions/0009-foreground-scan-and-freshness.md)).
- Errors cross the native boundary as typed envelopes with stable codes and redacted messages, so the UI can
  tell auth rejection from an unreachable host and offer the right recovery.

## Two-phase delete with a pre-flight breakdown

Deletion always happens in two steps ([D008](./decisions/0008-two-phase-local-deletion.md), R013):

1. `prepareLocalDeletion` returns a plan token and a breakdown: how many files are synced, how many are
   unsynced and warned, and how many are unknown and refused. The confirmation dialog shows exactly this.
2. `executeLocalDeletion(planToken)` commits that plan. A stale multi-select cannot delete a different set.

Outcomes are per file, never all-or-nothing: a revoked grant or an already-missing file is reported
individually. `local_deletion_overlay` records only actual successes, so the catalog never claims a deletion
that did not happen. The app deletes local files only; it never deletes anything remote (R026).

## Remote-listing age near delete

On reopen, the local side re-stats automatically, while the remote listing stays cached until an explicit
rescan (R015, [D009](./decisions/0009-foreground-scan-and-freshness.md)).

- A file can therefore show SYNCED from a stale listing after it was removed remotely. Because the user acts
  on that verdict by deleting, the remote listing's age is shown near any delete action.
- Past **7 days**, the app suggests a rescan without blocking. The threshold is a tunable default, not a
  hard rule.
- Rescan from scratch is a first-class control, not a hidden setting (R016).
