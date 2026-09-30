# Research: Scan Engine, Matching and Snapshot Lifecycle

Decisions for [plan.md](./plan.md). Each entry records the decision, why, and what was rejected. Spec
clarifications (session 2026-09-30) are treated as fixed inputs, not re-litigated here.

## R1. Base branch: build on feature 003's code

- **Decision**: 004 is implemented on top of `003-local-source-selection`. The branch is currently cut from
  `master` (`fa1427c`), which does not contain 003's `source` package, contract version 2 or
  `validation/maestro/`. Before the first implementation task, either merge 003 into `master` and rebase 004
  onto it, or rebase 004 directly onto `003-local-source-selection`.
- **Rationale**: every local-side requirement consumes `LocalSourceEnumerator`, `SourceAvailability` and
  `source_root` access from 003, and the Maestro scaffolding (`validation/maestro/`, `device-fixtures.sh`,
  the debug seam convention) exists only there. The contract version in this plan (3) assumes 003's version
  2 is already in place.
- **Alternatives rejected**: re-implementing enumeration in 004 (duplicates 003, violates Principle III).

## R2. Scan modes: FULL and LOCAL_REFRESH are the same engine

- **Decision**: one `ScanEngine` with two modes. `FULL` connects, lists the remote, enumerates local
  sources, matches and publishes. `LOCAL_REFRESH` skips the remote: it copies the active snapshot's
  `remote_match_key` rows and remote-scope `remote_ambiguity` rows into the new snapshot, then enumerates,
  matches and publishes. Both create a `scan_run` with a fresh generation. "Scan" (no snapshot yet) and
  "Rescan from scratch" (FR-004) are both `FULL`; the UI label is the only difference.
- **Rationale**: FR-003 (local refresh with a cached remote listing) and FR-004 (rescan) share every step
  except the remote walk. Copying the remote-scope ambiguity rows keeps an incomplete listing incomplete: an
  unmatched file stays UNKNOWN after a refresh, never becomes UNSYNCED (FR-005).
- **Guard**: `LOCAL_REFRESH` is refused with `REFRESH_UNAVAILABLE` when there is no active snapshot or when
  `repository_config.revision` differs from the active snapshot's `configRevision` (the cached listing
  belongs to a different repository). The JS auto-refresh ignores that error; the user then runs a full
  scan.
- **Alternatives rejected**: re-listing the remote on every open (contradicts D009; FTP listing takes
  minutes); updating the active snapshot in place (breaks snapshot immutability and page-token safety,
  D010).

## R3. Matching: an in-memory `MatchIndex`, a pure `Matcher`

- **Decision**: remote entries are collapsed into a `MatchIndex` keyed on `(nfcName, sizeBytes, bucket)`
  with a duplicate count, held in memory for the run and staged to `remote_match_key` in batches. A
  `LOCAL_REFRESH` rebuilds the same index from the active snapshot's rows. `Matcher.verdict(localFile,
  index, listingState)` is a pure function returning `(status, issueCode)`.
- **Rules** (spec FR-002, FR-005, FR-007, clarifications 1–3, 5):
  1. Local file with null `sizeBytes` or null `modifiedUtcMillis` → UNKNOWN, `LOCAL_UNAVAILABLE`.
  2. `bucket = Math.floorDiv(mtimeMillis, precisionMillis)`; names normalized with
     `java.text.Normalizer.normalize(name, NFC)`, compared case-sensitively.
  3. Exact `(nfcName, size, bucket)` hit → SYNCED (even if the listing is incomplete).
  4. `(nfcName, size)` hit only on a remote entry whose mtime is missing → UNKNOWN,
     `REMOTE_MTIME_MISSING`.
  5. No hit and the remote listing is incomplete → UNKNOWN, `issueCode` = the code of the first listing
     failure (`DIRECTORY_UNREADABLE`, `CONNECTION_LOST`, …).
  6. Otherwise → UNSYNCED.
- **Rationale**: an O(1) hash lookup per local file, no per-file SQL round trip, and a pure function that
  JVM tests can drive through every edge case (SC-001). `Math.floorDiv` gives correct buckets for negative
  (pre-1970) timestamps.
- **Memory**: the target scale (R9) is ≤ 200 k remote files → roughly 30 MB of index at worst, acceptable
  in a foreground run. The index is dropped when the run ends.
- **Alternatives rejected**: SQL lookup per local file through `RemoteMatchKeyDao.candidates` (works, but
  is about 50 k queries per scan and harder to unit test); a SQL `JOIN` after staging (mixes rule 4 and
  rule 5 into SQL and is harder to read).

## R4. Remote mtime missing

- **Decision**: a remote regular file with `modifiedUtcMillis == null` is staged as a `remote_match_key`
  row with `bucket = Long.MIN_VALUE` (the `MTIME_UNKNOWN_BUCKET` sentinel), so that a `LOCAL_REFRESH` can
  rebuild rule 4 from the database. The sentinel is defined once in Kotlin (`MatchIndex`).
- **Rationale**: `bucket` is `NOT NULL` and part of a unique index in schema version 1; making it nullable
  would need a table rebuild. `Long.MIN_VALUE` cannot be a real bucket for any positive precision.
- **Alternatives rejected**: dropping such entries (a backed-up file would show UNSYNCED); treating the
  whole listing as incomplete (turns every unmatched file UNKNOWN for one odd entry).

## R5. Remote walk, retries and the FAILED boundary

- **Decision**: breadth-first walk from `repository_config.remoteRoot` through `RemoteClient.list`. Only
  `REGULAR_FILE` entries feed the index; `DIRECTORY` entries are queued; `OTHER` entries (symlinks, FIFOs)
  are ignored and never followed. Remote hidden entries are included (see R8).
  - **Before anything is listed** (connect fails, auth rejected, host key unverified, or the root directory
    itself cannot be listed): the run ends `FAILED` with the typed error, the staged snapshot is deleted and
    the previous active snapshot stays active (FR-006).
  - **A non-root directory fails** with `DIRECTORY_UNREADABLE` (or `SERVER_ERROR`): record one
    `remote_ambiguity` row (scope `REMOTE_DIRECTORY`, reason = code), mark the listing incomplete, continue
    with the next directory.
  - **Transient errors** (`CONNECTION_LOST`, `CONNECTION_TIMEOUT`): close, reconnect and retry the same
    directory, three attempts in total with 1 s / 2 s backoff (D011). `AUTH_FAILED` is never retried. If
    all attempts fail, record one ambiguity row (scope `REMOTE_LISTING`, reason = code), stop the walk,
    mark the listing incomplete and go on to the local side.
- **Precision**: after connecting, a `FULL` scan calls `discoverPrecision()` and uses that value for the
  whole run. It is stored on every `local_node` and `remote_match_key` row, and written back through the
  revision-guarded `RepositoryConfigDao.updatePrecision`.
- **Rationale**: the root listing is the dividing line in clarification 4: once the root is listed the
  run has real information, so it completes as incomplete rather than failing.
- **Risk**: a server that answers an unreadable directory with an empty listing instead of an error
  cannot be detected. The partial-listing Maestro flow runs against all three containers to confirm each
  one reports the error (R11); a protocol that does not is recorded in `docs/protocols.md` as a known
  limitation.

## R6. Local side

- **Decision**: for each `source_root`, call `LocalSourceEnumerator.enumerate(source)`.
  - `Skipped(reason)` → one ambiguity row (scope `SOURCE`, `sourceId`, reason `GRANT_REVOKED` or
    `STORAGE_MISSING`). The source has no files to list, so it contributes no `local_node` rows and is
    named in the completion summary (FR-007, spec edge case).
  - An exception while walking (`SecurityException`, `IllegalArgumentException` or
    `FileNotFoundException` from the provider) → the files already yielded are kept, one ambiguity row
    (scope `SOURCE`, reason `LOCAL_UNAVAILABLE`) is recorded and the next source is scanned.
  - A file with null size or null mtime → UNKNOWN, `LOCAL_UNAVAILABLE` (R3 rule 1).
- **Entry IDs**: `entryId` is a random UUID. The engine keeps a `documentId → entryId` map per source so
  that `parentId` holds the parent directory's `entryId`. The enumerator's breadth-first order guarantees a
  parent is seen before its children. `documentId` and `documentUri` stay native (003's
  no-raw-path rule).
- **Directory status**: directory rows get a rolled-up status: UNKNOWN if any descendant file is UNKNOWN,
  else UNSYNCED if any is UNSYNCED, else SYNCED (an empty directory is SYNCED, since there is nothing in
  it to lose). Directory rows are held in memory and inserted after their subtree is matched.
  `statusCounts` keeps counting `kind = 'FILE'` only.
- **Rationale**: `local_node.status` is `NOT NULL`, and feature 005's filters must behave sensibly on
  directories in list view. Worst-of rollup is the only choice that never makes a folder look safer than
  its contents.

## R7. Snapshot lifecycle and cancellation

- **Decision**: reuse `SnapshotStore` (`beginRun`, `stageSnapshot`, staging methods, `publish`,
  `abortAbandonedRuns`) and add three things:
  - `discardRun(runId, generation, terminalState, errorCode, summary)`: one transaction that deletes the
    staged snapshot (cascading every staged row) and marks the run terminal. It is used for `CANCELLED`
    (user cancel or backgrounding) and for `FAILED`. The existing `recordFailedAttempt` is folded into it,
    because it left staged rows behind.
  - Staging for `remote_ambiguity` and `snapshot_counts`.
  - `copyRemoteState(fromSnapshotId, toSnapshotId)` for `LOCAL_REFRESH`: `INSERT … SELECT` of match keys and
    remote-scope ambiguity rows.
- **Generation**: `maxGeneration() + 1`, taken inside the `beginRun` transaction. The existing `publish`
  fence already rejects a superseded generation.
- **Single-flight**: at most one run at a time. `startScan` during a run returns `SCAN_IN_PROGRESS`.
- **Cancellation**: the run is a coroutine `Job` on the module scope. `cancelScan(runId)` cancels it and
  closes the `RemoteClient`, which unblocks blocking socket I/O. The engine's `finally` block calls
  `discardRun` with `NonCancellable`.
- **Backgrounding** (FR-001, acceptance 6): `CloudSyncModule` registers a `LifecycleEventListener`;
  `onHostPause` cancels any active run with summary `BACKGROUNDED`. Process death is already covered by
  `abortAbandonedRuns`, which now runs once when the module first touches the store.
- **Alternatives rejected**: cancelling from JS on `AppState` change (JS may not run before the process
  is frozen); a WorkManager job (scanning is foreground-only for v1, R025 deferred).

## R8. Hidden files

- **Decision**: 004 scans with `includeHidden = false`, recorded on `scan_run` and `snapshot` as today.
  Local entries whose name starts with `.` are skipped together with their whole subtree. Remote hidden
  entries are **included** in the match index. `getSettings` / `setIncludeHidden` stay `NOT_IMPLEMENTED`.
- **Rationale**: no 004 requirement asks for a user toggle (Principle II). Excluding local hidden files
  only hides them from the results. Including remote hidden entries can only turn a false UNSYNCED into a
  correct SYNCED, never the reverse. 003's plan listed `setIncludeHidden` as "feature 004's", but the 004
  spec does not own it. Feature 005 is recorded as the proposed owner in its spec (Dependencies), to be
  confirmed in its `/speckit-clarify`; nothing is built speculatively here.

## R9. Scale and progress

- **Target scale**: 50 k local files across ≤ 20 sources, and 200 k remote files. The bulk Maestro
  fixture (R11) is sized to make a run last long enough to background it.
- **Progress**: the engine updates an in-memory `ScanProgress` (phase, remote directories listed, remote
  files listed, local files enumerated, local files matched) at most every 250 ms. JS polls `getScanState`
  every 500 ms while a run is active, and stops polling on a terminal state. Remote totals are unknown up
  front, so progress shows counters, not a percentage.
- **Writes**: `local_node` and `remote_match_key` rows are inserted in batches of 500, one transaction
  each.
- **Alternatives rejected**: TurboModule event emitters (more Codegen surface and harder to test than
  polling a pure getter); a percentage bar (the remote total is unknowable before the walk ends).

## R10. Contract version 3

- **Decision**: `CONTRACT_VERSION` becomes 3. `startScan()` becomes `startScan(mode?: string | null)`
  (default `FULL`), `startScan`, `cancelScan`, `getScanState`, `queryFiles` and `queryTreeChildren` are
  implemented, and new DTOs and error codes are added (see
  [contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md)). `queryTreeChildren` with
  `parentId = null` lists top-level entries (`parentId IS NULL`), optionally narrowed by `sourceId`. The
  existing `queryFilePage` treats a null `parentId` as "no filter", which is right for `queryFiles` but
  wrong for tree children, so the tree path passes an explicit root flag.
- **Issue codes**: `local_node.issueCode` reuses `CloudSyncErrorCode` values where the cause is a remote
  error (`DIRECTORY_UNREADABLE`, `CONNECTION_LOST`, `CONNECTION_TIMEOUT`, `SERVER_ERROR`) and adds two
  scan-only issue codes, `REMOTE_MTIME_MISSING` and `LOCAL_UNAVAILABLE`. They are mirrored in TypeScript
  and Kotlin under the parity test.
- **Staleness**: `STALE_REMOTE_LISTING_MILLIS = 7 days` is defined once, in `CloudSyncContracts.ts`,
  because only JS decides when to suggest a rescan (FR-003).

## R11. End-to-end proof on live containers

- **Remote fixtures**: `fixture-seed.sh` gains a `scan/` subtree:
  - `scan/clean/`: `exact.txt`, `a/reusable.jpg`, `b/reusable.jpg`, the NFD-named
    `é-decomposed.txt` and `size-mismatch.txt`, with fixed mtimes.
  - `scan/partial/readable/exact.txt`, and `scan/partial/restricted/only-here.txt`, where `restricted/`
    is `0700`, host-owned. The container accounts run as other UIDs, so each server gets a real
    permission error.

  The clean flows use remote root `…/scan/clean`, the partial flow `…/scan/partial`. The existing top-level
  assertions in `ProtocolConnectInstrumentedTest` and the manifest tests are updated for the new `scan/`
  directory.
- **Device fixtures**: `device-fixtures.sh` gains `SyncScopeE2E/Scan/`, with the same names, sizes and
  mtimes as `scan/clean/`. The local copy of `é-decomposed.txt` uses the **NFC** name, which proves NFC
  matching. It also gets `size-mismatch.txt` at a different size, a local-only `local-only.txt`, and
  `only-here.txt`, which matches only the restricted remote file. Mtimes are set with `touch -d @<epoch>`.
  A generated `SyncScopeE2E/Bulk/` (`BULK_FILES`, provisional default 20 000 small files in 200
  directories) is added as a separate
  source, only for the progress and backgrounding flows. The size is calibrated in a task so that a scan
  runs for at least 15 s on the API 31 emulator.
- **Repository setup seam**: there is no Connect screen until feature 008. A debug-only
  `syncscope-debug://configure-repository` activity (in `android/app/src/debug/`) takes protocol, host,
  port, username, password and root. It calls the production `RepositoryOperations.save` and `test`, and
  approves an SFTP host-key challenge through `approveSftpHostKey`. It runs real app code on real
  containers rather than faking state; it is recorded as D018. `android-flow.sh` passes the per-run
  container credentials to Maestro with `-e`.
- **Protocols**: the clean scan flow runs once per protocol (FTP, SFTP, WebDAV), and the partial flow runs
  against all three (R5 risk). Rescan, reopen-refresh and backgrounding run on SFTP only, because their
  behaviour does not depend on the protocol.
- **Alternatives rejected**: building a Connect screen early (feature 008 owns it); a debug seam that slows
  the scan down (fakes app state, which violates the seam rule).

## R12. Documentation deltas (Principle VII)

- `docs/sync-and-deletion-safety.md`: NFC normalization, strict bucket equality, the rules for incomplete
  listings, unreachable remotes and unreadable local files, and the rolled-up directory status.
- `docs/architecture.md`: new `scan` package, schema version 2, contract version 3, and the methods removed
  from "Not yet implemented".
- New decisions: `0018-debug-repository-seam.md` and `0019-match-name-normalization-and-strict-buckets.md`
  (clarifications 2–3; D003 itself is not revisable, so the refinement gets its own record).
- `docs/protocols.md`: how each protocol reports an unreadable directory, as observed in R11.
