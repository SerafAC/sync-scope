# Feature Specification: Scan Engine, Matching and Snapshot Lifecycle

**Feature Branch**: `004-scan-engine-matching`

**Created**: 2026-09-28 (seeded from milestone slice M001/S03)

**Status**: Draft (seeded)

**Input**: Roadmap slice M001/S03, "Scan engine, matching, and snapshot lifecycle" (`risk:high`,
`depends:[S01,S02]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [002-native-cloudsync-connect](../002-native-cloudsync-connect/spec.md) (complete) and
[003-local-source-selection](../003-local-source-selection/spec.md).

## Dependencies

Consumes from feature 002 (M001/S01 → M001/S03):

- The `RemoteClient` listing contract the scan engine drives to enumerate the remote root.
- `precisionMillis` as the bucket width for mtime comparison.
- The typed error envelope vocabulary (`CloudSyncError` code, redacted message and recovery action) that
  mid-scan failures reuse to populate `issueCode`.
- A working `SnapshotStore`, `SnapshotQuery` and `PageTokenCodec`.

Consumes from feature 003 (M001/S02 → M001/S03):

- Persisted `source_root` rows with a durable SAF URI grant per selected folder.
- The local enumeration contract (name, size, modified time per file, plus an availability flag).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan and see which files are backed up (Priority: P1)

The user taps Scan, watches live progress through a multi-minute run, and gets a snapshot where every
file is SYNCED, UNSYNCED or UNKNOWN. An unreadable remote directory does not abort the run: affected files
become UNKNOWN with an `issueCode`, and the summary states how many files could not be checked. Rescan
from scratch and local auto-refresh on open both work.

**Why this priority**: the snapshot is what every view and every deletion decision reads. A wrong or
silently partial snapshot leads directly to deleting files that are not backed up.

**Independent Test**: a Maestro flow for the loop, plus Robolectric matcher tests (slice demo).

**Acceptance Scenarios** (from the slice demo):

1. **Given** a configured repository and selected sources, **When** the user taps Scan, **Then** live
   progress is shown throughout a multi-minute run.
2. **Given** a completed scan, **When** the user views the results, **Then** every file is SYNCED,
   UNSYNCED or UNKNOWN.
3. **Given** a remote directory that cannot be read, **When** the scan runs, **Then** it does not abort;
   affected files become UNKNOWN with an `issueCode`, and the summary states how many files could not be
   checked.
4. **Given** a previous snapshot, **When** the user chooses Rescan from scratch, **Then** a new scan run
   with a fresh generation produces a new snapshot.
5. **Given** a previous snapshot, **When** the app is reopened, **Then** the local side refreshes
   automatically while the remote listing stays cached.
6. **Given** a scan in progress, **When** the app is backgrounded, **Then** the run stops and the partial
   snapshot is discarded, never promoted.

### Edge Cases

- Duplicates on either side: the `duplicates/{a,b}/reusable.jpg` fixture pair collapses into one match key.
- NFC and NFD forms of the same name arrive un-normalized from the clients (feature 002); the match key
  must decide how to treat them.
- Timestamps at the edge of a precision bucket (`timestamps/bucket-start.bin` / `bucket-end.bin`).
- A dropped connection mid-scan.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R006, primary-user-loop): The scan MUST run in the foreground with visible progress and
  cancellation, and a partial run MUST never become the active snapshot. One `scan_run` per attempt with a
  monotonic generation; backgrounding mid-scan stops the run and discards the partial snapshot, per
  [D009](../../docs/decisions/0009-foreground-scan-and-freshness.md). A half-finished scan promoted to
  active would make the user delete files that were never checked.
- **FR-002** (R007, core-capability): Sync status MUST be determined by file name plus size plus modified
  time within the protocol's precision bucket, ignoring directory structure entirely, via the collapsed
  `remote_match_key` on (snapshotId, name, sizeBytes, precisionMillis, bucket), per
  [D003](../../docs/decisions/0003-directory-agnostic-sync-matching.md). Path-relative matching is
  rejected: Android album directories and cloud-flattened remote layouts will never line up.
- **FR-003** (R015, continuity): On reopen, the local side MUST auto-refresh, the remote listing MUST stay
  cached until an explicit rescan, and the remote listing's age MUST be readable. Past a 7-day staleness
  threshold (a tunable default) the app suggests a rescan rather than blocking, per
  [D009](../../docs/decisions/0009-foreground-scan-and-freshness.md). New photos since the last scan are
  exactly the ones the user wants flagged, but a stale remote listing plus an irreversible delete is a
  hazard.
- **FR-004** (R016, operability): Rescan from scratch MUST be a first-class control, not a hidden setting,
  producing a new `scan_run` with a fresh generation and a new snapshot. Cached remote state drifts, and
  the user needs an obvious way to force a full re-check before deleting.
- **FR-005** (R017, failure-visibility): Partial scans MUST be visibly partial: affected files become
  UNKNOWN with an `issueCode`, and the run reports an honest completion summary stating how many files
  could not be checked. A scan never aborts wholesale on an unreadable directory or a dropped connection,
  per [D011](../../docs/decisions/0011-typed-error-envelopes-partial-scans.md) and
  [D006](../../docs/decisions/0006-unknown-status-never-deletable.md). A partial scan indistinguishable
  from a clean one is the worst possible outcome for an app whose output drives irreversible deletion.

Supporting requirements (primary FR in another feature):

- R020 (feature 008): the scan loop is proven by a Maestro flow against live containers.
- R022 (feature 008): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **ScanRun** (`scan_run`): one attempt, with a monotonic generation, phase and terminal state.
- **Snapshot** (`snapshot`, `active_snapshot`): a completed, publishable run; only a completed run is
  promoted to active.
- **LocalNode** (`local_node`): a local file or directory with `parentId`, `kind`, size, mtime, `status`
  and `issueCode`.
- **RemoteMatchKey** (`remote_match_key`): the collapsed remote listing keyed on name, size, precision and
  bucket, with a duplicate count.

## Provides

To feature 005 (gallery, list and filtering, M001/S03 → M001/S04):

- A completed `snapshot` row with `scan_run` generation, populated `local_node` rows carrying `status`
  (SYNCED / UNSYNCED / UNKNOWN) and `issueCode`, and collapsed `remote_match_key` rows.
- Working `queryFiles(snapshotId, querySpec, pageToken)` returning bounded pages plus first-page `counts`,
  honouring the `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN` filter and the sort options.
- Working `startScan`, `cancelScan` and `getScanState` with progress the UI can render.
- The active-snapshot invariant: only a completed run is ever promoted, and the remote listing's age is
  readable.

To feature 006 (tree view and preview, M001/S03 → M001/S05):

- Working `queryTreeChildren(snapshotId, parentId, querySpec, pageToken)` for parent-scoped listing,
  backed by `index_local_node_snapshotId_sourceId_parentId_kind_name`.
- `parentId` and `kind` (FILE / DIRECTORY) populated on every `local_node` row, so hierarchy navigation is
  possible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Robolectric matcher tests cover match-key collapsing and precision-bucket edge cases and pass.
- **SC-002**: The Maestro scan flow passes against live containers, including the partial-listing
  scenario reporting the number of files that could not be checked.
- **SC-003**: No partial run is ever promoted to the active snapshot.

## Assumptions

- Scanning is foreground-only for v1; background or scheduled scanning is deferred (R025, `docs/scope.md`).
- Checksum matching is deferred (R023, `docs/scope.md`); name + size + mtime is the v1 comparison.
- Retries are bounded (3 attempts) and apply to transient network errors only, never to auth.
