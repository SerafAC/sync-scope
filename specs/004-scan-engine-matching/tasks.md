---

description: "Task list for feature 004: Scan Engine, Matching and Snapshot Lifecycle"
---

# Tasks: Scan Engine, Matching and Snapshot Lifecycle

**Input**: Design documents from `/specs/004-scan-engine-matching/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md),
[contracts/maestro-scan.md](./contracts/maestro-scan.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle IV requires unit tests for all code, in the same change.
Principle V requires every acceptance scenario of the P1 story to map to a named Maestro flow on API 31 and
API 36 against the live containers. Each test task sits next to the implementation it verifies: write the
test first and make sure it fails.

**Organization**: the spec has one user story (US1, P1). Phase 2 holds the contract, the schema and the
pure matching rules that every part of US1 builds on. The story itself is split into sub-phases (native
engine → bridge → JS → e2e), each with a checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task belongs to (US1)
- Paths are relative to the repository root. Kotlin package root:
  `android/app/src/main/java/com/syncscope/` (abbreviated `KT/`); JVM tests:
  `android/app/src/test/java/com/syncscope/` (abbreviated `KTEST/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: put the branch on top of feature 003 and prepare the remote and device fixtures the e2e proof
depends on. No production code.

- [X] T001 Rebase `004-scan-engine-matching` onto feature 003 (research R1): either merge `003-local-source-selection` into `master` and rebase onto `master`, or rebase directly onto `003-local-source-selection`, keeping the uncommitted/committed `specs/004-scan-engine-matching/` files. Then verify that `KT/source/LocalSourceEnumerator.kt` exists, that `CLOUD_SYNC_CONTRACT_VERSION` in `src/native/CloudSyncContracts.ts` is `2`, and that `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:android:unit` pass on the rebased base before any other task. If the rebase conflicts in anything other than `specs/`, stop and escalate to the user.
- [X] T002 [P] Add a contract test for the new remote fixtures in `scripts/validation/validation-infrastructure.test.mjs`. Seeding a scratch root with `scripts/validation/fixture-seed.sh` must produce `scan/clean/exact.txt`, `scan/clean/a/reusable.jpg`, `scan/clean/b/reusable.jpg`, `scan/clean/é-decomposed.txt` (the name in **NFD**, bytes `65 CC 81`), `scan/clean/size-mismatch.txt`, `scan/partial/readable/exact.txt` and `scan/partial/restricted/only-here.txt`. `scan/partial/restricted` must have mode `700` and every other directory `755`. `fixture-manifest.mjs` must still list the whole tree. It must fail until T003 lands.
- [X] T003 Extend `scripts/validation/fixture-seed.sh` (research R11): create the `scan/clean/` and `scan/partial/{readable,restricted}/` files from T002. The contents are `exact metadata fixture\n` for both `exact.txt` files, `reusable duplicate payload\n` for both `reusable.jpg`, `decomposed unicode metadata\n` for `é-decomposed.txt`, `intentionally different size\n` for `size-mismatch.txt` and `only in restricted\n` for `only-here.txt`. Every file's mtime is `@1704067200.000000000`. Run `chmod 0700 "$root/scan/partial/restricted"` **after** the existing `find … chmod 0755` line and before the final directory `touch`. Make T002 pass (`pnpm test:foundation`).
- [X] T004 Update the tests that assert the fixture tree for the new top-level `scan/` directory: `android/app/src/androidTest/java/com/syncscope/ProtocolConnectInstrumentedTest.kt` (the `client.list(endpoint.root)` top-level expectations) and any exact-tree expectations in `scripts/validation/validation-infrastructure.test.mjs`. `pnpm test:foundation` must pass; the instrumented test is re-run in T050.
- [X] T005 [P] Add contract assertions for the new device fixtures to `scripts/validation/validation-infrastructure.test.mjs`. `scripts/validation/device-fixtures.sh` must create `SyncScopeE2E/Scan/` on primary storage with `exact.txt`, `a/reusable.jpg`, `b/reusable.jpg`, `é-decomposed.txt` in **NFC** (single code point `C3 A9`), `size-mismatch.txt`, `local-only.txt` and `only-here.txt`, with mtimes set by `touch -d @1704067200`. It must also create `SyncScopeE2E/Bulk/` with a configurable file count (`BULK_FILES`, provisional default `20000`, calibrated in T047). It must stay idempotent. It must fail until T006 lands.
- [X] T006 Extend `scripts/validation/device-fixtures.sh`: seed `/sdcard/SyncScopeE2E/Scan/` with the same contents as the remote `scan/clean/` files from T003 (so sizes match), except `size-mismatch.txt`, which gets `local size differs\n`. Add `local-only.txt` (`only on the device\n`) and `only-here.txt` (`only in restricted\n`, same size as the remote copy). Set every mtime with `touch -d @1704067200`. Generate `BULK_FILES` (default `20000`) files `/sdcard/SyncScopeE2E/Bulk/dNNN/fNNNNN.txt` spread over 200 directories in one `adb shell` loop. Make T005 pass.
- [X] T007 In `scripts/validation/android-flow.sh` e2e mode, read the per-run container credentials from the files `android-flow.sh` already exports for Gradle (D014): `SYNCSCOPE_FTP_CREDENTIAL_FILE`, `SYNCSCOPE_SFTP_CREDENTIAL_FILE` and `SYNCSCOPE_WEBDAV_CREDENTIAL_FILE` (`/tmp/cloud-sync-checker-syncscope-<protocol>/credentials`, written by `scripts/validation/protocol-service.sh` as `username=` and `password=` lines). Take ports from the existing `case` table (FTP 32120, SFTP 32122, WebDAV 32180) and roots from `ProtocolConnectInstrumentedTest`'s endpoint table (FTP `/`, SFTP `/srv/fixtures`, WebDAV `/webdav`) and pass them to `maestro test` as `-e FTP_PORT=… -e FTP_USER=… -e FTP_PASSWORD=… -e FTP_ROOT=…`, and the same for `SFTP_*` and `WEBDAV_*`, with host `10.0.2.2`. Never echo a password to stdout. Extend `scripts/validation/validation-infrastructure.test.mjs` to assert the variables are passed and not logged.
- [X] T008 [P] Create the empty directory `validation/maestro/scan/` (with a `.gitkeep`, as 003 did). Do **not** touch `validation/maestro/config.yaml` here: each flow is added to `executionOrder.flowsOrder` by the task that creates it (T043–T049), after the existing `sources/*` entries, so `pnpm e2e:android` never lists a flow file that does not exist yet.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract version 3 surface, the schema version 2 change, the snapshot-store additions and
the pure, device-free scan rules that the engine, the bridge and the UI all depend on.

**⚠️ CRITICAL**: no Phase 3 work can begin until this phase is complete.

### Contract version 3 (TS and Kotlin in lockstep, parity-guarded)

- [X] T009 Bump the contract to version 3 on both sides in one change. Set `CLOUD_SYNC_CONTRACT_VERSION = 3` in `src/native/CloudSyncContracts.ts` and `CONTRACT_VERSION = 3` in `KT/bridge/CloudSyncContracts.kt`. Insert the four new error codes `NO_SOURCES_SELECTED`, `SCAN_IN_PROGRESS`, `SCAN_NOT_FOUND` and `REFRESH_UNAVAILABLE` **in that order, just before `INTERNAL_ERROR`**, in both lists, each with the exact message and action from the "New error codes" table in [contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md) (for example `NO_SOURCES_SELECTED`: "No folders are selected to check." / "Add a folder in Settings › Folders."). Add the issue codes as a Kotlin `enum class FileIssueCode { REMOTE_MTIME_MISSING, LOCAL_UNAVAILABLE }` and a TS `FILE_ISSUE_TEXT` record with the exact texts from the contract ("The backup has this file but no modified time, so it could not be compared." / "This file could not be read on the device."). Update `KTEST/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts` in the same task.
- [X] T010 Add the scan DTOs to `src/native/CloudSyncContracts.ts` exactly as in [contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md): `ScanMode = 'FULL' | 'LOCAL_REFRESH'`, `ScanPhase` (the nine values), `ScanTerminalState = 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'ABORTED'`, `ScanProgressDto`, `ScanRunDto` (`terminalState` "null while running"; `error` "FAILED only"; `cancelReason: 'USER' | 'BACKGROUNDED' | null` "CANCELLED only"), `SkippedSourceDto` (`reason: 'GRANT_REVOKED' | 'STORAGE_MISSING' | 'LOCAL_UNAVAILABLE'`), `ScanSummaryDto`, `ActiveSnapshotDto` (`coverage: 'COMPLETE' | 'INCOMPLETE'`), `ScanStateOk` / `ScanStateResult`, `StartScanOk` / `StartScanResult`, `FileIssueCode`, and `export const STALE_REMOTE_LISTING_MILLIS = 7 * 24 * 60 * 60 * 1000`. No DTO may contain a path, host, `documentId` or `documentUri`. Add type-level tests to `src/native/__tests__/CloudSyncContracts.test.ts`.
- [X] T011 Change the Codegen spec in `src/native/specs/NativeCloudSync.ts` to `startScan(mode?: string | null): Promise<OperationResultDto>`. Update `KT/bridge/CloudSyncModule.kt` to the generated signature `startScan(mode: String?, promise: Promise)`, still `notImplemented` so the build stays green. Update `src/native/__tests__/NativeCloudSyncBoundary.test.ts` for the new parameter.

### Schema version 2 (Room)

- [X] T012 [P] Write `KTEST/persistence/MigrationTest.kt` first, with Room `MigrationTestHelper` against the exported schemas. A version 1 database with one `scan_run` and one `snapshot` row migrates to version 2. `scan_run.mode` must be `TEXT NOT NULL` with the existing row reading `'FULL'`, and `snapshot.remoteListedAtMillis` must be a nullable `INTEGER` reading `NULL`. All other rows and indices must be unchanged. There must be no destructive fallback: opening an unknown version fails.
- [X] T013 Implement schema version 2 (data-model "Schema change"). Add `val mode: String` (default `"FULL"`, `@ColumnInfo(defaultValue = "FULL")`) to `ScanRunEntity` and `val remoteListedAtMillis: Long?` to `SnapshotEntity` in `KT/persistence/Entities.kt`. Set `version = 2` with `autoMigrations = [AutoMigration(from = 1, to = 2)]` in `KT/persistence/SyncScopeDatabase.kt`. Export `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/2.json`. Fix every constructor call site and test fixture (`KTEST/persistence/PersistenceTestFixtures.kt`). Make T012, `SchemaContractTest` and `SchemaConstraintTest` pass.

### Snapshot store additions

- [X] T014 Write `KTEST/persistence/SnapshotStoreTest.kt` additions first:
  - `beginRun` assigns `maxGeneration() + 1` inside one transaction; two sequential runs get 1 and 2.
  - `discardRun(runId, generation, terminalState, errorCode, summary)` deletes the staged snapshot (and with it every staged `local_node`, `remote_match_key`, `remote_ambiguity` and `snapshot_counts` row), marks the run terminal with the given state and phase, sets `active_snapshot.lastAttemptSummary`, and leaves `active_snapshot.snapshotId` unchanged. It is a no-op for a run that is already terminal.
  - `copyRemoteState(from, to)` copies every `remote_match_key` row and only the `REMOTE_DIRECTORY` / `REMOTE_LISTING` `remote_ambiguity` rows (never `SOURCE`), and copies `remoteListedAtMillis`.
  - Staging and reading of `remote_ambiguity` and `snapshot_counts`.
  - `queryFilePage` with a new `topLevelOnly` flag returns only `parentId IS NULL` rows (narrowed by `sourceId`), while `parentId = null` without the flag still means "no filter".
- [X] T015 Add the DAO methods the store needs in `KT/persistence/Daos.kt`: `ScanRunDao.latest()` (highest generation), `RemoteAmbiguityDao.forSnapshot`, an `INSERT … SELECT` copy of match keys and of remote-scope ambiguity rows between snapshot IDs, and `SnapshotDao.setRemoteListedAt`. Inserts keep `OnConflictStrategy.ABORT`.
- [X] T016 Implement the store additions in `KT/persistence/SnapshotStore.kt`: `beginRun` generation assignment, `discardRun`, `copyRemoteState`, `stageAmbiguities`, `stageCounts`, and the `topLevelOnly` query path (research R7, R10). Fold `recordFailedAttempt` into `discardRun`, update its callers and existing tests, and delete the old method (Principle II). Make T014 pass.

### Pure scan rules (JVM, no I/O)

- [X] T017 [P] Write `KTEST/scan/MatchIndexTest.kt` first:
  - The `timestamps/bucket-start.bin` / `bucket-end.bin` fixture values: `bucketOf(1704067200000, 1000) == bucketOf(1704067200999, 1000)` (same bucket), but `bucketOf(1704067200999, 1000) != bucketOf(1704067201000, 1000)` (straddling the edge). At FTP's day precision (`86400000`) all three share a bucket.
  - `bucketOf` uses `Math.floorDiv`, so `-1` at precision 1000 gives bucket `-1`.
  - NFD `"é-decomposed.txt"` and NFC `"é-decomposed.txt"` produce the same key; `IMG.jpg` and `img.jpg` produce different keys.
  - The `duplicates/{a,b}/reusable.jpg` pair (same name, size and mtime) collapses to one key with `duplicateCount = 2`.
  - A remote file with `modifiedUtcMillis = null` is keyed with `MTIME_UNKNOWN_BUCKET = Long.MIN_VALUE`.
  - Round trip: `toRows(snapshotId)` → `fromRows(rows)` rebuilds an equal index.
- [X] T018 Implement `KT/scan/MatchIndex.kt` (research R3, R4): the key `(nfcName, sizeBytes, bucket)` → count, `add(RemoteEntry)` for `REGULAR_FILE` only, `const val MTIME_UNKNOWN_BUCKET = Long.MIN_VALUE`, `fun bucketOf(mtimeMillis, precisionMillis) = Math.floorDiv(...)`, `fun nfc(name) = Normalizer.normalize(name, Normalizer.Form.NFC)`, `toRows` / `fromRows` for `RemoteMatchKeyEntity`. This is the **only** place bucket and normalization rules are defined (Principle III). Make T017 pass.
- [X] T019 [P] Write `KTEST/scan/MatcherTest.kt` first, one test per row of the data-model "Matching rules" table plus order tests:
  - rule 1: null size or null mtime → `UNKNOWN` / `LOCAL_UNAVAILABLE`, even when an exact key exists;
  - rule 2: an exact key → `SYNCED`, also when the listing is incomplete (clarification 1);
  - rule 3: only an `MTIME_UNKNOWN_BUCKET` key for `(name, size)` → `UNKNOWN` / `REMOTE_MTIME_MISSING`;
  - rule 4: no key and an incomplete listing with first failure `DIRECTORY_UNREADABLE` → `UNKNOWN` / `DIRECTORY_UNREADABLE`;
  - rule 5: no key and a complete listing → `UNSYNCED` / null;
  - `(name, size)` present only in the adjacent bucket → not matched (`UNSYNCED` on a complete listing; clarification 2);
  - a case-only name difference → not matched (clarification 3).
- [X] T020 Implement `KT/scan/Matcher.kt` as a pure function `verdict(file: LocalFile, precisionMillis: Long, index: MatchIndex, listing: ListingState): Verdict(status, issueCode)`, where `ListingState` is either `Complete` or `Incomplete(firstFailureCode)`. It evaluates the five rules in order. Make T019 pass.
- [X] T021 [P] Write `KTEST/scan/DirectoryRollupTest.kt` first: worst-of `UNKNOWN > UNSYNCED > SYNCED` propagates from files through every ancestor; an empty directory is `SYNCED`; sibling subtrees do not affect each other; a directory's `issueCode` is always null.
- [X] T022 Implement `KT/scan/DirectoryRollup.kt`: register directories (`entryId`, `parentEntryId`), record file statuses, and emit the final status per directory. Make T021 pass.
- [X] T023 [P] Write `KTEST/scan/RemoteWalkerTest.kt` first, with a fake `RemoteClient` scripted per directory:
  - A complete walk returns every `REGULAR_FILE` in the index, ignores `OTHER` and never lists through it.
  - The root failing (`AUTH_FAILED`, `CONNECTION_REFUSED`, `DIRECTORY_UNREADABLE` on root) raises `RootListingFailed(code)`.
  - A non-root `DIRECTORY_UNREADABLE` adds one `REMOTE_DIRECTORY` ambiguity and the walk continues.
  - `CONNECTION_LOST` on a non-root directory triggers reconnect and retry, at most 3 attempts in total, with an injected clock recording 1 s then 2 s backoff; success on attempt 2 leaves the listing complete.
  - Three failures add one `REMOTE_LISTING` ambiguity, stop the walk and return `Incomplete(CONNECTION_LOST)`.
  - `AUTH_FAILED` during a reconnect is never retried.
  - Hidden remote entries are included.
  - Progress callbacks report directories and files listed.
- [X] T024 Implement `KT/scan/RemoteWalker.kt` (research R5): a breadth-first walk from the root, with an injected `delay` for the backoff, the retry policy (3 attempts, transient codes `CONNECTION_LOST` and `CONNECTION_TIMEOUT` only), and a result of `(MatchIndex, ListingState, ambiguities)`. Make T023 pass.

**Checkpoint**: contract v3 compiles on both sides, schema v2 migrates, and every matching rule is proven by JVM tests (SC-001). `pnpm test:ci` and `pnpm test:android:unit` are green.

---

## Phase 3: User Story 1 - Scan and see which files are backed up (Priority: P1) 🎯 MVP

**Goal**: the user taps Scan, watches live progress, and gets a snapshot where every file is SYNCED,
UNSYNCED or UNKNOWN, with an honest summary of what could not be checked. Rescan from scratch and the
automatic local refresh on reopen both work. Backgrounding and failures never promote a partial snapshot.

**Independent Test**: the JVM engine tests plus the Maestro flows in
[contracts/maestro-scan.md](./contracts/maestro-scan.md) on API 31 and API 36 against the live
containers.

### Native engine

- [X] T025 [US1] Write `KTEST/scan/ScanEngineTest.kt` (FULL mode) first, using an in-memory Room database, a fake `RemoteClientFactory` / `RemoteClient`, and a fake `LocalSourceEnumerator` (from 003's test helpers where available):
  - A clean run publishes a snapshot with `coverage = COMPLETE`, `remoteListedAtMillis` set, the expected statuses per file, rolled-up directory statuses, `parentId` holding the parent's `entryId` (null at the source root), `snapshot_counts` totals, and `precisionMillis` from `discoverPrecision()` on every row. Precision is written back through `updatePrecision`.
  - An unreadable remote subdirectory → `coverage = INCOMPLETE`, matched files `SYNCED`, unmatched files `UNKNOWN` / `DIRECTORY_UNREADABLE`, still published.
  - A root listing failure → run `FAILED` with the code, the staged snapshot deleted, the previous active snapshot unchanged (FR-006).
  - A `Skipped(GRANT_REVOKED)` source → a `SOURCE` ambiguity, no rows for that source, other sources scanned.
  - An enumerator throwing `SecurityException` mid-walk → the rows already yielded are kept, plus a `SOURCE` / `LOCAL_UNAVAILABLE` ambiguity.
  - Hidden local entries and their subtrees are not stored.
  - With 1 201 local files and 1 201 remote files, `local_node` and `remote_match_key` rows are written in batches of at most 500 (assert through a recording `SnapshotStore` wrapper: batch sizes 500, 500, 201 for files), and progress updates arrive at most once per 250 ms of the injected clock.
  - `entryId`, `documentId` and `documentUri` never appear in any ambiguity `reason`.
- [X] T026 [US1] Implement FULL mode in `KT/scan/ScanEngine.kt` (data-model state machine):
  1. `CONNECTING`: load config and credentials, `connect`, `discoverPrecision`.
  2. `LISTING_REMOTE`: `RemoteWalker`.
  3. `ENUMERATING_LOCAL`: per source, `LocalSourceEnumerator.enumerate`; skip hidden subtrees; map `documentId → entryId` (UUID); `Matcher.verdict` per file; insert batches of 500 `local_node` rows.
  4. Insert directory rows after `DirectoryRollup`.
  5. Stage `remote_match_key` (batches of 500), ambiguities and counts.
  6. Set `coverage` and `remoteListedAtMillis`.
  7. `PUBLISHING`: `SnapshotStore.publish`.

  Close the `RemoteClient` in `finally`. On `RootListingFailed` or a connect error, call `discardRun(…, "FAILED", code, redactedMessage)`. Make T025 pass.
- [X] T027 [US1] Add LOCAL_REFRESH tests to `KTEST/scan/ScanEngineTest.kt` first:
  - Refresh from a `COMPLETE` active snapshot: no `RemoteClient` is created, the match keys are copied, `remoteListedAtMillis` equals the source snapshot's, and a newly added local file is `UNSYNCED`.
  - Refresh from an `INCOMPLETE` snapshot: the remote-scope ambiguities are copied, and a new unmatched file is `UNKNOWN` with the carried code (never `UNSYNCED`).
  - No active snapshot, or `repository_config.revision` ≠ the active snapshot's `configRevision` → `RefreshUnavailable`, and no run is created.
- [X] T028 [US1] Implement LOCAL_REFRESH in `KT/scan/ScanEngine.kt` (research R2): `COPYING_REMOTE` (`copyRemoteState` and `MatchIndex.fromRows`, `ListingState` rebuilt from the copied ambiguities), then the same `ENUMERATING_LOCAL` → `PUBLISHING` path as FULL. No duplicated code: extract a shared local phase. Make T027 pass.
- [X] T029 [US1] Write `KTEST/scan/ScanCoordinatorTest.kt` first:
  - A second `start` while running → `ScanInProgress`.
  - `cancel(runId)` cancels the Job, closes the client, and ends the run `CANCELLED` with summary `USER` and the staged snapshot deleted. Cancelling an already terminal run is a no-op; an unknown ID → `ScanNotFound`.
  - `onHostPause()` during a run → `CANCELLED` / `BACKGROUNDED`, active snapshot unchanged (SC-003).
  - `abortAbandonedRuns` runs exactly once, on the first `start` or `state` call.
  - Progress snapshots are throttled to at most one per 250 ms of the injected clock.
  - `state()` returns the running run, else the latest run.
- [X] T030 [US1] Implement `KT/scan/ScanCoordinator.kt` (research R7, R9): single-flight `Job` on an injected scope, `ScanProgress` holder, `cancel`, `onHostPause`, and cleanup with `discardRun` under `NonCancellable`. Make T029 pass.

### Bridge

- [X] T031 [US1] Write `KTEST/bridge/ScanOperationsTest.kt` first, with one envelope test per row of the `startScan` table in [contracts/cloudsync-scan.md](./contracts/cloudsync-scan.md):
  - `REPOSITORY_NOT_CONFIGURED`, `CREDENTIAL_UNAVAILABLE`, `NO_SOURCES_SELECTED`, `SCAN_IN_PROGRESS`, `REFRESH_UNAVAILABLE`, and an unknown mode → `INVALID_QUERY`; `ok` carries `runId` and `generation`; a missing mode means `FULL`.
  - `cancelScan`: `ok`, idempotent `ok`, and `SCAN_NOT_FOUND`.
  - `getScanState` builds `ScanRunDto` (`error` only on FAILED, `cancelReason` only on CANCELLED) and `ActiveSnapshotDto.summary` from `snapshot_counts` and `remote_ambiguity`. `skippedSources` carries the alias from `source_root`. `unknown` equals the UNKNOWN file count. No path or host appears anywhere in the map.
- [X] T032 [US1] Implement `KT/bridge/ScanOperations.kt`, following the `SourceOperations` / `RepositoryOperations` pattern: `start(mode)`, `cancel(runId)`, `state()`, `queryFiles` and `queryTreeChildren` (the latter with `topLevelOnly = parentId == null`, mapping `SnapshotNotFoundException` → `SNAPSHOT_NOT_FOUND` and a token mismatch → `PAGE_TOKEN_MISMATCH`), all resolved through `CloudSyncEnvelope`. Make T031 pass.
- [X] T033 [US1] Wire the five methods in `KT/bridge/CloudSyncModule.kt` (`startScan`, `cancelScan`, `getScanState` via `runOperation`; `queryFiles`, `queryTreeChildren` via `runPage`), inject the coordinator dependencies through constructor parameters as the existing ones are, and register a `LifecycleEventListener` whose `onHostPause` calls `ScanCoordinator.onHostPause()` (removed in `invalidate`). Update `KTEST/bridge/CloudSyncModuleTest.kt`: the five methods no longer resolve `NOT_IMPLEMENTED`; `getSettings` and `setIncludeHidden` still do; `onHostPause` cancels an active run.

### Debug seam (D018)

- [X] T034 [US1] Write `android/app/src/testDebug/java/com/syncscope/debug/ConfigureRepositoryActivityTest.kt` first (Robolectric), following `ReleaseGrantsActivityTest`. `syncscope-debug://configure-repository?protocol=SFTP&host=10.0.2.2&port=…&username=…&password=…&root=…` calls `RepositoryOperations.save` then `test`. A host-key challenge result leads to `approveSftpHostKey(challengeId)` and a second `test`. The resulting status code is shown in a `TextView` labelled `Repository configured` or `Repository error: <CODE>`. The password never appears in the view or in any app log line, and the activity never logs the intent or its data URI (assert with Robolectric `ShadowLog`).
- [X] T035 [US1] Implement `android/app/src/debug/java/com/syncscope/debug/ConfigureRepositoryActivity.kt` and register it with the `syncscope-debug://configure-repository` intent filter in `android/app/src/debug/AndroidManifest.xml`. It must use the production `RepositoryOperations` and `HostKeyTrustStore`, with no fake state. Make T034 pass.

**Checkpoint**: `pnpm test:android:unit` is green, and every bridge method of this feature resolves a real envelope.

### JavaScript

- [X] T036 [P] [US1] Add `startScan(mode?: ScanMode)`, `cancelScan(runId)` and `getScanState()` to `src/native/CloudSync.ts`. Each normalizes the plain Codegen object into `StartScanResult`, `OperationResult` or `ScanStateResult`, as `normalizePageResult` does. Add tests to `src/native/__tests__/CloudSync.test.ts`: the ok and error shapes, `mode` passed through (`null` when omitted), and `NATIVE_MODULE_UNAVAILABLE` when the module is missing.
- [X] T037 [US1] Write `src/scan/__tests__/useScan.test.tsx` first, with a mocked `CloudSync`:
  - Polling every 500 ms while `run.terminalState === null`, stopping on a terminal state and on unmount.
  - On mount and on every `AppState` → `active` with an active snapshot and no running run, it calls `startScan('LOCAL_REFRESH')` once and ignores `REFRESH_UNAVAILABLE`.
  - `scan()` calls `startScan('FULL')`; `cancel()` calls `cancelScan(runId)`.
  - `isStale` is true only when `now - active.remoteListedAtMillis > STALE_REMOTE_LISTING_MILLIS`.
- [X] T038 [US1] Implement `src/scan/ScanProvider.tsx` (context, polling, auto-refresh) and `src/scan/useScan.ts` (state and actions). Make T037 pass.
- [X] T039 [P] [US1] Write `src/scan/__tests__/ScanSummaryCard.test.tsx` and `src/screens/__tests__/ScanScreen.test.tsx` first. Cover:
  - The button reads `Scan` without an active snapshot and `Rescan from scratch` with one.
  - `Cancel scan` is visible only while running.
  - `Last scan` shows the mode label ("Full scan" / "Local refresh"), the generation and the completion time.
  - `Scan progress` shows the phase and the four counters.
  - `Scan summary` shows synced, unsynced and `Files that could not be checked` counts, "N remote folders could not be read", the interrupted-listing line with its code text, and each skipped source by alias with its reason.
  - `Remote listing age` shows relative time from `remoteListedAtMillis`; `Rescan suggested` appears only when `isStale` and never disables `Scan`.
  - FAILED shows `Scan failed` with the error message and the action text; CANCELLED shows "Cancelled" or "Cancelled (app left)" by `cancelReason`.
  - Every interactive element has the accessibility label listed in [contracts/maestro-scan.md](./contracts/maestro-scan.md#selectors).
- [X] T040 [US1] Implement `src/scan/ScanSummaryCard.tsx` and `src/screens/ScanScreen.tsx` with React Native Paper only. Make T039 pass.
- [X] T041 [US1] Render `ScanScreen` for the `Scan` tab in `src/navigation/AppNavigator.tsx` (only `Files` keeps a placeholder) and wrap the navigator in `ScanProvider` in `App.tsx`. Update `__tests__/App.test.tsx` and any navigator test.

**Checkpoint**: `pnpm lint && pnpm typecheck && pnpm test:ci` are green, and the app scans end to end on an emulator by hand ([quickstart.md](./quickstart.md) §3).

### End-to-end (Maestro, live containers, API 31 and API 36)

- [X] T042 [US1] Create `validation/maestro/subflows/configure-repository.yaml`. It takes the env `PROTOCOL`, `PORT`, `USER`, `PASSWORD` and `ROOT`, calls `openLink` on the D018 seam URL and asserts `Repository configured`. Create `validation/maestro/subflows/add-scan-source.yaml`, which reuses `subflows/open-sources.yaml` and `subflows/pick-folder.yaml` from 003 to add `SyncScopeE2E/Scan` (and, with `BULK=true`, `SyncScopeE2E/Bulk`).
- [X] T043 [US1] Create `validation/maestro/scan/01-clean-scan-{ftp,sftp,webdav}.yaml`: `clearState`, configure with remote root `<protocol root>/scan/clean`, add the Scan source, open **Scan**, tap `Scan`, assert `Scan progress` is visible, then wait for `Scan summary` and assert synced `4`, unsynced `3` and `Files that could not be checked` `0` (acceptance 1–2, FR-002, NFC edge case). Append `scan/01-clean-scan-ftp`, `scan/01-clean-scan-sftp` and `scan/01-clean-scan-webdav` to `validation/maestro/config.yaml`.
- [X] T044 [US1] Create `validation/maestro/scan/02-partial-listing-{ftp,sftp,webdav}.yaml`, with remote root `<protocol root>/scan/partial`. Assert "1 remote folder could not be read", synced `1` and `Files that could not be checked` `6` (acceptance 3, FR-005, SC-002). Record in `specs/004-scan-engine-matching/research.md` under R5 what each server returned for the `0700` directory. **If any server reports the unreadable directory as an empty listing, do not weaken the flow: stop and escalate to the user** (plan Risks). Append the three `scan/02-partial-listing-*` entries to `validation/maestro/config.yaml`.
- [X] T045 [US1] Create `validation/maestro/scan/03-rescan.yaml` (SFTP): scan, record the generation label, tap `Rescan from scratch`, and assert a higher generation and a new completion time (acceptance 4, FR-004). Append `scan/03-rescan` to `validation/maestro/config.yaml`.
- [X] T046 [US1] Create `validation/maestro/scan/04-reopen-refresh.yaml` (SFTP): scan, record `Remote listing age`, `stopApp`, `launchApp`, open **Scan**, and assert that the latest run's mode label reads "Local refresh" and that `Remote listing age` shows the same time (acceptance 5, FR-003). Append `scan/04-reopen-refresh` to `validation/maestro/config.yaml`.
- [X] T047 [US1] Calibrate `BULK_FILES` in `scripts/validation/device-fixtures.sh` so that a FULL scan including `SyncScopeE2E/Bulk` runs for at least 15 s on the API 31 emulator. Record the measured duration and count in `specs/004-scan-engine-matching/research.md` R11. Then create `validation/maestro/scan/05-background-discards.yaml` (SFTP): run a first scan of the Scan source alone to completion and add the Bulk source. Then tap `Rescan from scratch`, tap `Cancel scan` while `Scan progress` is visible, and assert "Cancelled" with the first scan's summary still shown (FR-001 cancellation). Tap `Rescan from scratch` again, `pressKey: Home` right away, `launchApp`, and assert "Cancelled (app left)" with the first scan's summary still shown (acceptance 6, FR-001, SC-003). Append `scan/05-background-discards` to `validation/maestro/config.yaml`.
- [X] T048 [US1] Create `validation/maestro/scan/06-unreachable-fails.yaml` (SFTP): scan successfully, reconfigure through the seam with a wrong password (expecting `Repository error: AUTH_FAILED`, which leaves the saved config at the new revision), tap `Rescan from scratch`, and assert `Scan failed` with the `AUTH_FAILED` action text, while the previous summary is still shown (acceptance 7, FR-006). Append `scan/06-unreachable-fails` to `validation/maestro/config.yaml`.
- [X] T049 [US1] Create `validation/maestro/scan/07-revoked-source.yaml` (SFTP): scan, `openLink syncscope-debug://release-grants` (D017), `Rescan from scratch`, and assert the summary names the Scan source's alias as skipped with "Access lost" (FR-007). Append `scan/07-revoked-source` to `validation/maestro/config.yaml`.
- [X] T050 [US1] Run `pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm e2e:android && pnpm validation:services:stop` (the instrumented run re-checks `ProtocolConnectInstrumentedTest` after T004's fixture change) and get every flow in `validation/maestro/config.yaml` (003's and 004's) passing on API 31 and API 36, with a clean protocol audit. Fix any failure at its root; never skip or weaken a flow.

**Checkpoint**: US1 is complete. Every acceptance scenario and FR-001…FR-007 is proven on both API levels (SC-001…SC-003).

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Principles VI–IX and the final quality gates.

- [X] T051 [P] Update `docs/sync-and-deletion-safety.md`: NFC normalization and case-sensitive names, strict same-bucket equality (with a straddling example), the five-rule matching table (linking data-model), incomplete listing vs unreachable remote vs unreadable local file, the rolled-up directory status, and local refresh keeping an incomplete listing incomplete.
- [X] T052 [P] Update `docs/architecture.md`: add the `scan` package row to "Native packages", schema version 2 (two columns, auto-migration), contract version 3, `ScanProvider` in the repository layout, `validation/maestro/scan/` and the configure-repository seam. Remove `startScan`, `cancelScan`, `getScanState`, `queryFiles` and `queryTreeChildren` from "Not yet implemented". List `getSettings` / `setIncludeHidden` as still not implemented, with feature 005 as their proposed owner (per `specs/005-gallery-list-filtering/spec.md`, Dependencies).
- [X] T053 [P] Update `docs/protocols.md` with each protocol's observed reply to an unreadable directory (from T044) and the fact that remote hidden entries are included in matching.
- [X] T054 [P] Add `docs/decisions/0018-debug-repository-seam.md` (the context, the decision to use production save/test/approve, the rejected alternatives from plan Complexity Tracking, and the credential exposure: the password travels in a debug-only deep-link query that Android and Maestro may log, which is accepted only because the credentials are throwaway per-run container credentials, as in D014; the seam itself never logs the URI) and `docs/decisions/0019-match-name-normalization-and-strict-buckets.md` (clarifications 2–3, refining D003 without revising it), and list both in `docs/decisions/README.md`.
- [X] T055 [P] Add a user-facing "Scan" section to `README.md`, after "Select folders": Scan and Rescan from scratch, what SYNCED / UNSYNCED / UNKNOWN mean, "files that could not be checked", the remote listing age and the 7-day hint, and that leaving the app cancels a running scan.
- [X] T056 [P] Update `DEVELOPMENT.md`: the configure-repository seam under "Test-only seams", the new remote and device fixtures, how credentials reach Maestro, `BULK_FILES` calibration, and running one scan flow (quickstart §2).
- [X] T057 [P] Add to `CHANGELOG.md` under `Unreleased`: "Added: scan your folders and see which files are backed up (SYNCED / UNSYNCED / UNKNOWN), with rescan and automatic local refresh", "Changed: CloudSync contract version 3", "Changed: scan store schema version 2".
- [X] T058 [P] Correct the claim in `specs/003-local-source-selection/plan.md` (Constitution Check, II) that hidden-file filtering is "feature 004's `setIncludeHidden`": point it at the proposed-ownership note in `specs/005-gallery-list-filtering/spec.md` (Dependencies), which makes 005 the proposed owner of `getSettings` / `setIncludeHidden` (analysis I2). This file only exists after T001's rebase.
- [ ] T059 Run every quality gate: `pnpm lint` (zero warnings), `pnpm typecheck`, `pnpm test:ci`, `pnpm test:android:unit`, `pnpm test:foundation` and `pnpm e2e:android` on API 31 and API 36. Walk through [quickstart.md](./quickstart.md) and confirm every expected outcome.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T001 first; everything else depends on it. T002 → T003 → T004; T005 → T006; T007 and T008 are independent after T001.
- **Foundational (Phase 2)**: depends on T001. T009 → T010 → T011. T012 → T013 → T014 → T015 → T016. The pure-rule pairs (T017→T018, T019→T020, T021→T022, T023→T024) depend only on T013 for the entity types. T020 depends on T018; T024 depends on T018.
- **US1 (Phase 3)**: depends on all of Phase 2. Native: T025 → T026 → T027 → T028 → T029 → T030. Bridge: T031 → T032 → T033 (after T030). Seam: T034 → T035 (after T001 only; it can run alongside the native engine). JS: T036 after T011; T037 → T038; T039 → T040; T041 after T038 and T040. E2E: T042 after T035 and T041 plus Phase 1 fixtures; T043–T049 after T042; T050 last.
- **Polish (Phase 4)**: T051–T058 after T050 (T053 needs T044's observations); T059 last.

### Within US1

Tests before implementation in every pair. Engine before bridge before JS. E2E flows only after the
screen and the seam exist.

## Parallel Example: Phase 2 pure rules

```bash
# After T013, these four test-first pairs touch different files:
Task: "T017 MatchIndexTest in KTEST/scan/MatchIndexTest.kt"
Task: "T019 MatcherTest in KTEST/scan/MatcherTest.kt"
Task: "T021 DirectoryRollupTest in KTEST/scan/DirectoryRollupTest.kt"
Task: "T023 RemoteWalkerTest in KTEST/scan/RemoteWalkerTest.kt"
```

## Parallel Example: User Story 1

```bash
# While the native engine (T025–T033) is in progress:
Task: "T034/T035 ConfigureRepositoryActivity (debug seam)"
Task: "T036 CloudSync.ts scan wrappers"
Task: "T039 ScanSummaryCard / ScanScreen tests"

# Polish docs after T050:
Task: "T051 docs/sync-and-deletion-safety.md"
Task: "T054 decisions 0018 and 0019"
Task: "T055 README Scan section"
```

## Implementation Strategy

### MVP (User Story 1 is the whole feature)

1. Phase 1 (rebase onto 003, fixtures) and Phase 2 (contract v3, schema v2, pure rules). Stop and confirm
   SC-001 with the JVM tests.
2. Native engine and bridge (T025–T035). Stop and confirm with `pnpm test:android:unit`.
3. JS (T036–T041). Stop and do a manual scan on an emulator.
4. E2E (T042–T050). This is the feature's exit gate.
5. Polish (T051–T059).

### Notes

- [P] = different files and no dependency on an incomplete task.
- Commit after each task or logical group, with the conventional-commit style used by feature 003.
- Never weaken an e2e assertion to get a flow green. Escalate instead (T044, T047, T050).
