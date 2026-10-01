# Implementation Plan: Scan Engine, Matching and Snapshot Lifecycle

**Branch**: `004-scan-engine-matching` | **Date**: 2026-09-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-scan-engine-matching/spec.md` (clarified 2026-09-30)

## Summary

Turn the configured repository and the selected folders into a snapshot where every file is SYNCED,
UNSYNCED or UNKNOWN. A new native `scan` package runs one foreground `scan_run` per attempt.

- **FULL** scans connect, discover precision, walk the remote breadth-first into an in-memory
  `MatchIndex`, enumerate each source through 003's `LocalSourceEnumerator`, match each file with a pure
  rule table and publish.
- **LOCAL_REFRESH** runs on app open. It reuses the active snapshot's remote keys and re-enumerates only
  the local side.

Names are NFC-normalized and compared case-sensitively, and mtimes must fall in the same precision bucket.
An incomplete remote listing makes unmatched files UNKNOWN, never UNSYNCED. An unreachable remote fails
the run and keeps the previous snapshot. Unreadable local files are UNKNOWN. Cancellation, backgrounding
and failure delete the staged snapshot, so only a completed run is ever promoted.

The bridge gains working `startScan(mode)`, `cancelScan`, `getScanState`, `queryFiles` and
`queryTreeChildren` (contract version 3). Room goes to schema version 2 with two added columns. A real
Scan tab shows progress, the completion summary, the remote listing's age and a rescan hint after 7 days.
Decisions are in [research.md](./research.md).

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 5 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule), React Native Paper
5.15, React Navigation 7, AndroidX Room, Kotlin coroutines, the existing `RemoteClient` implementations
(Commons Net, SSHJ, OkHttp WebDAV) and 003's `LocalSourceEnumerator`. `java.text.Normalizer` for NFC.
**No new dependencies.**

**Storage**: the Room scan store. Schema version 1 → 2 via `@AutoMigration`: `scan_run.mode` and
`snapshot.remoteListedAtMillis` ([data-model.md](./data-model.md#schema-change-version-1--2)).

**Testing**: Jest + Testing Library (JS); JUnit + Robolectric JVM tests (`pnpm test:android:unit`); Room
`MigrationTestHelper` for 1 → 2; Maestro 2.10.0 flows on API 31 and API 36 against the live FTP / SFTP /
WebDAV containers (`pnpm e2e:android`, D012); Node script-contract tests (`pnpm test:foundation`).

**Target Platform**: Android, minSdk 31, targetSdk 36; validated on API 31 and API 36 emulators.

**Project Type**: mobile app (React Native presentation over one Kotlin TurboModule)

**Performance Goals**: one O(1) index lookup per local file. `local_node` / `remote_match_key` rows are
inserted in batches of 500 per transaction. Progress is published at most every 250 ms and polled every
500 ms. `getScanState` reads `snapshot_counts` only, never a full-table count.

**Constraints**: foreground only (R025 deferred). Remote access is metadata listing only, with no content
reads (R026, protocol audit). No raw path or host crosses the bridge (D011, D016). Retries: 3 attempts on
transient network errors only, never on auth. Precision is discovered per scan (D004).

**Scale/Scope**: up to 50 k local files across ≤ 20 sources and 200 k remote files per scan (research R9).
Five bridge methods, one screen, seven Maestro scenarios in 11 flow files (the clean and partial scenarios get one file per protocol).

All unknowns are resolved in [research.md](./research.md). The vsftpd / Apache / OpenSSH behaviour for
an unreadable directory is a decided *method* (R5, R11) whose observed result is recorded during
implementation.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. The result is the same both times.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS, one justified item | One engine for both modes (R2). The existing `SnapshotStore` staging and publish are reused. Matching is a pure rule table over a hash map (R3). JS polls instead of subscribing to native events (R9). The schema change is two additive columns with an auto-migration. The one added seam (the debug repository activity) is justified under Complexity Tracking. |
| II. YAGNI | PASS | No `includeHidden` toggle (R8), no `remote_node` writes, no checksum mode (R023), no background scan (R025), no percentage progress. `remote_node` stays declared by 002 but unused. |
| III. DRY | PASS | Bucket and NFC rules live only in `MatchIndex`. The rule table lives only in `Matcher`. Error and issue codes and `CONTRACT_VERSION` keep their mirrored single definitions under the parity test. `STALE_REMOTE_LISTING_MILLIS` is defined once (TS). Remote-cause issue codes reuse `CloudSyncErrorCode` values rather than new names. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | JVM: `MatcherTest`, `MatchIndexTest`, `RemoteWalkerTest` (fake `RemoteClient`: unreadable dir, lost connection with retry, auth never retried, root failure → FAILED), `DirectoryRollupTest`, `ScanEngineTest` (fake enumerator plus in-memory Room: both modes, cancel, background, incomplete coverage, skipped source), `SnapshotStoreTest` additions (`discardRun`, `copyRemoteState`, tree root query), `MigrationTest` (1 → 2), `CloudSyncModuleTest` and parity updates, `ConfigureRepositoryActivityTest` (`testDebug`). Jest: v3 wrappers, `useScan` (polling, auto-refresh, staleness), `ScanScreen`. Script contract: fixture additions. All deterministic, with no device or network. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | P1 US1: every acceptance scenario and FR-001…FR-007 map to a named Maestro flow ([contracts/maestro-scan.md](./contracts/maestro-scan.md#acceptance-scenario-mapping)) on API 31 and 36 against live containers. The clean and partial flows run on all three protocols. Fixtures are reproducible and nothing is manual. |
| VI. Versioning + CHANGELOG | PASS | `Unreleased`: "Added: scan and see which files are backed up…", "Changed: CloudSync contract version 3", "Changed: scan store schema version 2". |
| VII. `./docs` | PASS | `sync-and-deletion-safety.md`, `architecture.md` and `protocols.md` updated, plus new `0018-debug-repository-seam.md` and `0019-match-name-normalization-and-strict-buckets.md` (R12). |
| VIII. README | PASS | User-facing "Scan" section: Scan / Rescan from scratch, what the three statuses mean, "files that could not be checked", the listing age and rescan hint, and what leaving the app does to a running scan. |
| IX. DEVELOPMENT.md | PASS | The configure-repository seam, the new fixtures and the Bulk calibration, passing credentials to Maestro, and running one scan flow. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit`, `test:foundation` and `e2e:android` (API 31 and 36) are the exit gate. |

No unjustified violations. The gate passes.

## Project Structure

### Documentation (this feature)

```text
specs/004-scan-engine-matching/
├── spec.md                          # clarified 2026-09-30
├── plan.md                          # this file
├── research.md                      # R1–R12 decisions
├── data-model.md                    # schema v2, state machine, matching rules, summary
├── quickstart.md                    # how to validate
├── contracts/
│   ├── cloudsync-scan.md            # bridge surface, DTOs, error/issue codes (contract v3)
│   └── maestro-scan.md              # seam, selectors, scenario → flow mapping
└── tasks.md                         # next: /speckit-tasks
```

### Source Code (repository root)

```text
android/app/src/main/java/com/syncscope/
├── scan/                            # NEW
│   ├── MatchIndex.kt                # (nfcName, size, bucket) → count; bucketOf; MTIME_UNKNOWN_BUCKET
│   ├── Matcher.kt                   # pure rule table (data-model "Matching rules")
│   ├── RemoteWalker.kt              # BFS listing, retry/backoff, FAILED boundary (R5)
│   ├── DirectoryRollup.kt           # worst-of directory status
│   ├── ScanEngine.kt                # FULL / LOCAL_REFRESH end to end
│   └── ScanCoordinator.kt           # single-flight Job, ScanProgress, cancel, onHostPause
├── persistence/
│   ├── Entities.kt                  # +scan_run.mode, +snapshot.remoteListedAtMillis
│   ├── SyncScopeDatabase.kt         # version 2, @AutoMigration(1 → 2)
│   ├── Daos.kt                      # ambiguity/counts reads, copy-remote-state inserts, latest run
│   └── SnapshotStore.kt             # discardRun, copyRemoteState, staging helpers, tree-root query
└── bridge/
    ├── CloudSyncModule.kt           # wire 5 methods; LifecycleEventListener
    ├── CloudSyncContracts.kt        # CONTRACT_VERSION = 3; +4 error codes; FileIssueCode
    └── ScanOperations.kt            # NEW: startScan / cancelScan / getScanState / query → envelopes

android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/2.json   # NEW (exported)

android/app/src/debug/
├── AndroidManifest.xml              # + ConfigureRepositoryActivity, syncscope-debug://configure-repository
└── java/com/syncscope/debug/ConfigureRepositoryActivity.kt

android/app/src/test/java/com/syncscope/scan/        # NEW JVM tests (see Constitution Check)

src/
├── native/
│   ├── specs/NativeCloudSync.ts     # startScan(mode?)
│   ├── CloudSyncContracts.ts        # v3, scan DTOs, codes, STALE_REMOTE_LISTING_MILLIS
│   └── CloudSync.ts                 # startScan / cancelScan / getScanState wrappers
├── scan/                            # NEW
│   ├── ScanProvider.tsx             # app-level: polling, auto LOCAL_REFRESH on open/foreground
│   ├── useScan.ts                   # state + actions for screens
│   └── ScanSummaryCard.tsx          # counts, could-not-check, skipped sources, listing age
├── screens/ScanScreen.tsx           # NEW: Scan / Rescan from scratch / Cancel, progress, summary, errors
├── navigation/AppNavigator.tsx      # Scan tab renders ScanScreen
└── App.tsx                          # wrap in ScanProvider

validation/maestro/scan/             # NEW: 01…07 flows (contracts/maestro-scan.md)
validation/maestro/subflows/configure-repository.yaml, add-scan-source.yaml
scripts/validation/
├── fixture-seed.sh                  # + scan/clean, scan/partial (restricted 0700)
├── device-fixtures.sh               # + SyncScopeE2E/Scan (NFC name, mtimes), SyncScopeE2E/Bulk
├── android-flow.sh                  # pass container credentials to maestro -e
└── validation-infrastructure.test.mjs
android/app/src/androidTest/.../ProtocolConnectInstrumentedTest.kt  # top-level listing now includes scan/

docs/  README.md  DEVELOPMENT.md  CHANGELOG.md   # per Principles VI–IX
```

**Structure Decision**: one Android app module plus the JS presentation layer, as in features 002 and
003. Scan orchestration gets its own native `scan` package next to `source` and `remote`, which it
consumes. Bridge glue goes in `bridge/ScanOperations.kt`, following `SourceOperations` /
`RepositoryOperations`. JS scan state lives in `src/scan/`, provided app-wide so that the auto-refresh on
open runs whichever tab is showing.

## Integration closure

This feature hands feature 005 and feature 006:

- a published `snapshot` whose `local_node` rows all carry `status`, `issueCode`, `parentId` and `kind`,
  with directory statuses rolled up;
- working `queryFiles` and `queryTreeChildren` (top level when `parentId` is null);
- `startScan`, `cancelScan` and `getScanState`, with the progress, summary and `remoteListedAtMillis`
  that 007 also reads for the age near delete;
- `ScanProvider` / `useScan` for any screen that needs scan state.

## Risks

| Risk | Mitigation |
| --- | --- |
| Branch lacks 003 (R1) | The first task rebases onto 003 (or merges 003 to `master` first). The contract v3 bump assumes v2 is present. |
| A server returns an empty listing for an unreadable directory instead of an error | The partial flow runs on all three protocols. A silent server is recorded in `docs/protocols.md` as a known limitation and escalated to the user; the test is never weakened. |
| The backgrounding flow is timing-sensitive | The Bulk fixture is calibrated (task) for a scan of ≥ 15 s, and the flow presses Home right after tapping Scan. JVM tests prove the cancel path deterministically. |
| `onHostPause` fires on events that are not really "leaving the app" | Documented behaviour: any pause cancels. It is a safe failure (the partial snapshot is discarded and the user rescans). |
| Memory for 200 k remote files | The index is about 30 MB, discarded after the run. The scale target is recorded; larger remotes are a follow-up. |
| 008 later builds a real Connect screen | The seam calls the same `RepositoryOperations`, so the flows switch to UI steps without changing their assertions. |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Debug-only `ConfigureRepositoryActivity` behind `syncscope-debug://configure-repository` (D018) | Every scan flow needs a saved, tested repository pointing at the live containers (D012). No Connect UI exists until feature 008. | Building the Connect screen now pulls 008's scope forward. Pre-seeding Room or Keystore from adb fakes app state and bypasses the credential boundary. The seam runs the production save, test and approve code. |
