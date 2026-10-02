# Feature Specification: Scan Engine, Matching and Snapshot Lifecycle

**Feature Branch**: `004-scan-engine-matching`

**Created**: 2026-09-28 (seeded from milestone slice M001/S03)

**Status**: Clarified and planned (2026-09-30)

**Input**: Roadmap slice M001/S03, "Scan engine, matching, and snapshot lifecycle" (`risk:high`,
`depends:[S01,S02]`).

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
- The local enumeration contract (`LocalSourceEnumerator`): per source, either a lazy listing of files
  (name, size and modified time, where size or modified time may be missing) or `Skipped` with the reason
  the whole source is unavailable (`GRANT_REVOKED` or `STORAGE_MISSING`).

## Clarifications

### Session 2026-09-30

- Q: When part of the remote listing fails (unreadable remote folder or dropped connection), which local files should be marked UNKNOWN? → A: Matched files stay SYNCED; every unmatched local file becomes UNKNOWN with an `issueCode`, never UNSYNCED.
- Q: Should modified times match only in the same precision bucket, or also in adjacent buckets? → A: Same bucket only: floor(localMtime / precision) == floor(remoteMtime / precision); a file just across a bucket edge is not matched.
- Q: How should names be compared across Unicode forms (NFC/NFD) and letter case? → A: Normalize both sides to NFC before building the match key; comparison stays case-sensitive.
- Q: If the remote cannot be reached at all (auth rejected or host unreachable before anything is listed), what happens? → A: The run ends FAILED with the typed error; the previous active snapshot stays active with its age shown. The partial-listing / UNKNOWN rule applies only once the remote root has been at least partly listed.
- Q: How should a local file be treated when it can't be read during the scan (size or modified time missing, or its folder listing fails midway)? → A: UNKNOWN with a local-side `issueCode` (e.g. `LOCAL_UNAVAILABLE`), counted in the "could not be checked" summary.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Scan and see which files are backed up (Priority: P1)

The user taps Scan, watches live progress through a multi-minute run, and gets a snapshot where every
file is SYNCED, UNSYNCED or UNKNOWN. An unreadable remote directory does not abort the run: affected files
without a remote match become UNKNOWN with an `issueCode`, and the summary states how many files could
not be checked. Rescan from scratch and local auto-refresh on open both work.

**Why this priority**: the snapshot is what every view and every deletion decision reads. A wrong or
silently partial snapshot leads directly to deleting files that are not backed up.

**Independent Test**: a Maestro flow for the loop, plus JVM matcher unit tests (slice demo).

**Acceptance Scenarios** (from the slice demo):

1. **Given** a configured repository and selected sources, **When** the user taps Scan, **Then** live
   progress is shown throughout a multi-minute run.
2. **Given** a completed scan, **When** the user views the results, **Then** every file is SYNCED,
   UNSYNCED or UNKNOWN.
3. **Given** a remote directory that cannot be read, **When** the scan runs, **Then** it does not abort;
   local files that found a remote match stay SYNCED, every unmatched local file becomes UNKNOWN with an
   `issueCode` (never UNSYNCED), and the summary states how many files could not be checked.
4. **Given** a previous snapshot, **When** the user chooses Rescan from scratch, **Then** a new scan run
   with a fresh generation produces a new snapshot.
5. **Given** a previous snapshot, **When** the app is reopened, **Then** the local side refreshes
   automatically while the remote listing stays cached.
6. **Given** a scan in progress, **When** the app is backgrounded, **Then** the run stops and the partial
   snapshot is discarded, never promoted.
7. **Given** a previous active snapshot, **When** a scan cannot reach the remote at all (auth rejected or
   host unreachable before anything is listed), **Then** the run ends FAILED with the typed error and
   recovery action, and the previous snapshot stays active with its listing age shown.

### Edge Cases

- Duplicates on either side: the `duplicates/{a,b}/reusable.jpg` fixture pair collapses into one match key.
- NFC and NFD forms of the same name arrive un-normalized from the clients (feature 002). The scan
  normalizes both local and remote names to NFC before building or looking up the match key, so an NFC/NFD
  pair matches. Names that differ only in letter case (`IMG.jpg` vs `img.jpg`) do not match.
- Timestamps at the edge of a precision bucket (`timestamps/bucket-start.bin` / `bucket-end.bin`): only
  an exact bucket match counts. Two times that straddle a bucket boundary do not match, even if they are
  closer together than one precision unit. The error is deliberately on the safe side (UNSYNCED, never a
  false SYNCED).
- A local file that cannot be read (the provider reports no size or no modified time) becomes UNKNOWN
  with the local-side `issueCode` `LOCAL_UNAVAILABLE` and is never matched on stale metadata. If a
  source's listing fails midway, the files already listed are kept and the source is named in the
  completion summary with `LOCAL_UNAVAILABLE`. A source whose SAF grant has been revoked, or whose storage
  is missing, cannot be listed at all: it is named in the completion summary with its reason
  (`GRANT_REVOKED` or `STORAGE_MISSING`), and the scan continues with the other sources.
- The remote is unreachable, or the login is rejected, before anything is listed: the run ends FAILED
  (FR-006) and the previous active snapshot is kept. This is not treated as an incomplete listing.
- A dropped connection mid-scan: handled like an unreadable remote directory. The listing is incomplete,
  so unmatched local files become UNKNOWN rather than UNSYNCED, and matched files stay SYNCED.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R006, primary-user-loop): The scan MUST run in the foreground with visible progress and
  cancellation, and an interrupted run (cancelled, backgrounded or failed) MUST never become the active
  snapshot. One `scan_run` per attempt with a
  monotonic generation; backgrounding mid-scan stops the run and discards the partial snapshot, per
  [D009](../../docs/decisions/0009-foreground-scan-and-freshness.md). A half-finished scan promoted to
  active would make the user delete files that were never checked.
- **FR-002** (R007, core-capability): Sync status MUST be determined by file name plus size plus modified
  time within the protocol's precision bucket, ignoring directory structure entirely, via the collapsed
  `remote_match_key` on (snapshotId, name, sizeBytes, precisionMillis, bucket), per
  [D003](../../docs/decisions/0003-directory-agnostic-sync-matching.md). Both modified times are floored
  to the discovered precision, bucket = floor(mtimeMillis / precisionMillis), and a match requires equal
  buckets. Adjacent buckets and absolute-difference tolerance are not accepted. Names are normalized to
  Unicode NFC on both sides before keying, and compared case-sensitively. Path-relative matching is
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
- **FR-005** (R017, failure-visibility): Scans with an incomplete remote listing MUST be visibly
  incomplete. Once the remote root has been at least partly listed, if any further part of the listing
  fails, a local file that found a match stays SYNCED, and every local file without a match becomes UNKNOWN with an `issueCode`, never UNSYNCED, because matching ignores directories and its copy
  could be in the part of the listing that failed. The run reports an honest completion summary stating
  how many files could not be checked. A scan never aborts wholesale on an unreadable directory or a
  dropped connection, per [D011](../../docs/decisions/0011-typed-error-envelopes-partial-scans.md) and
  [D006](../../docs/decisions/0006-unknown-status-never-deletable.md). An incomplete scan indistinguishable
  from a clean one is the worst possible outcome for an app whose output drives irreversible deletion.
- **FR-006** (R017, failure-visibility): If the remote cannot be reached at all before anything is listed
  (auth rejected, host unreachable), the `scan_run` MUST end in a FAILED terminal state carrying the typed
  `CloudSyncError` code and recovery action. No snapshot is promoted, and the previous active snapshot (if
  any) stays active with its listing age readable. Auth failures are never retried, per
  [D011](../../docs/decisions/0011-typed-error-envelopes-partial-scans.md).
- **FR-007** (R017, failure-visibility): A local file that cannot be read during the scan MUST be marked
  UNKNOWN with a local-side `issueCode` (distinct from remote-side codes) and MUST be counted in the "could
  not be checked" summary. It is never matched, and never excluded silently. "Cannot be read" means the
  provider reports no size or no modified time. A source that cannot be listed (grant revoked, storage
  missing, or its listing fails midway) MUST be named in the completion summary with its reason.

Supporting requirements (primary FR in another feature):

- R020 (feature 009): the scan loop is proven by a Maestro flow against live containers.
- R022 (feature 009): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **ScanRun** (`scan_run`): one attempt, with a monotonic generation, phase and terminal state (completed,
  cancelled, FAILED with a `CloudSyncError` code, or ABORTED when the process died mid-run and the run is
  found on the next start). Only a completed run, including one with an
  incomplete remote listing, is promoted.
- **Snapshot** (`snapshot`, `active_snapshot`): a completed, publishable run; only a completed run is
  promoted to active.
- **LocalNode** (`local_node`): a local file or directory with `parentId`, `kind`, size, mtime, `status`
  and `issueCode`.
- **RemoteMatchKey** (`remote_match_key`): the collapsed remote listing keyed on NFC-normalized name,
  size, precision and bucket, with a duplicate count.

## Provides

To feature 005 (gallery, list and filtering, M001/S03 → M001/S04):

- A completed `snapshot` row with `scan_run` generation, populated `local_node` rows carrying `status`
  (SYNCED / UNSYNCED / UNKNOWN) and `issueCode`, and collapsed `remote_match_key` rows.
- Working `queryFiles(snapshotId, querySpec, pageToken)` returning bounded pages plus first-page `counts`,
  honouring the `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN` filter and the sort options.
- Working `startScan`, `cancelScan` and `getScanState` with progress the UI can render.
- The active-snapshot invariant: only a completed run is ever promoted, and the remote listing's age is
  readable.

To feature 007 (tree view and preview, M001/S03 → M001/S05):

- Working `queryTreeChildren(snapshotId, parentId, querySpec, pageToken)` for parent-scoped listing,
  backed by `index_local_node_snapshotId_sourceId_parentId_kind_name`.
- `kind` (FILE / DIRECTORY) on every `local_node` row, and `parentId` set to the parent directory's
  entry on every row below a source root (null for a source root's direct children), so hierarchy
  navigation is possible.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: JVM matcher unit tests cover match-key collapsing and precision-bucket edge cases and pass,
  including a pair straddling a bucket boundary that is asserted as not matched, an NFC/NFD name pair
  asserted as matched, and a case-only name difference asserted as not matched.
- **SC-002**: The Maestro scan flow passes against live containers, including the incomplete-listing
  scenario reporting the number of files that could not be checked.
- **SC-003**: No interrupted run (cancelled, backgrounded or FAILED) is ever promoted to the active
  snapshot, and a FAILED run leaves the previous active snapshot unchanged.

## Assumptions

- Scanning is foreground-only for v1; background or scheduled scanning is deferred (R025, `docs/scope.md`).
- Checksum matching is deferred (R023, `docs/scope.md`); name + size + mtime is the v1 comparison.
- Retries are bounded (3 attempts) and apply to transient network errors only, never to auth.
