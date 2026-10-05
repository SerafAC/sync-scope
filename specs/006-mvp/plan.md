# Implementation Plan: MVP — a Usable App on a Real Device

**Branch**: `006-mvp` | **Date**: 2026-10-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-mvp/spec.md` (clarified 2026-10-02, 4 questions)

## Summary

Make the app usable by its owner on their own phone, with no computer attached. There are four parts.

**1. Server setup in the app.**

- Settings gets a Repository section, and a new stack screen holds the form.
- The form drives the existing native save, test and SFTP key approve/reject operations. The changed-key
  case gets an explicit warning.
- WebDAV gains an HTTPS switch. Release builds allow cleartext so that FTP and plain-HTTP WebDAV work,
  with an "unencrypted" warning in the form (research R4).
- Error messages now name "Settings › Repository", and a "Go there" button takes the user to that place.

**2. Guidance from first launch to a first scan.**

- A derived setup checklist on the Scan tab, and an empty state on the Files tab.
- A picker hint, with the folder picker starting in DCIM.

**3. Selecting and safely deleting files** (gallery and list view).

- **Selection**: a JS selection set. While selecting, a selection bar replaces the tabs and shows the count
  and size in the bottom-left corner. "Select all" is backed by one bulk native read.
- **Two-phase deletion** (D008):
  - Prepare re-checks every selected backed-up file on the server by listing only the folders that hold
    them. Those folders are recorded per match key by the scan (schema version 4).
  - Execute verifies each file on the device, deletes it through SAF, and removes the row and its counts
    from the live snapshot in the same transaction.
  - Scans and deletions exclude each other.

**4. An installable release APK**, signed with a personal key from local Gradle properties, with no
debug-key fallback and no debug seams. Its version is derived from `package.json` (research R17, moved from
009 FR-004 to satisfy constitution VI).

The contract version goes to 5. There are 12 new Maestro flows (three split into parts around a host-side
step) and a release-smoke mode. Decisions are in
[research.md](./research.md).

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 6 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule), React Native Paper
5.15 (MD3), React Navigation 7 (bottom tabs), AndroidX Room, Kotlin coroutines, and the SAF
`DocumentsContract`.

- **One new JS dependency**: `@react-navigation/native-stack` 7.x (research R1). Its only native part,
  `react-native-screens`, is already installed.
- No new native library.

**Storage**: Room scan store, schema version 3 → 4 via `@AutoMigration`. It adds
`remote_match_key.directories` and `repository_config.webdavHttps`
([data-model.md](./data-model.md#schema-change-version-3--4)). Deletion plans are in memory. The release
keystore stays outside the repository.

**Testing**:

- Jest + Testing Library (JS).
- JUnit + Robolectric JVM tests (`pnpm test:android:unit`), including Room `MigrationTestHelper` for 3 → 4.
- Maestro 2.10.0 flows on API 31 against the live FTP, SFTP and WebDAV containers (`pnpm e2e:android`,
  D012), plus `android-flow.sh release-smoke`.
- Node script-contract tests (`pnpm test:foundation`) for the new runner modes, hooks and fixtures.

**Target Platform**: Android, minSdk 31, targetSdk 36. The 006 flows run on API 31 and API 36, the levels
`pnpm e2e:android` runs. The release smoke runs on API 31; 009 adds the API 36 full loop.

**Project Type**: mobile app (a React Native presentation layer over one Kotlin TurboModule)

**Performance Goals**:

- **Select all**: "Select all" over 50 k files returns in one call within 1 s, as an indexed read of four
  columns, asserted by a JVM budget test next to `SnapshotQueryPerformanceTest`. A tap updates the count
  and total within one frame, because the summary is O(selection) and memoized.
- **Re-check**: one connection, and one listing per distinct server folder of the selection. A typical
  camera selection needs fewer than 10 listings.
- **Deletion**: commits every 100 files. Ancestor decrements are O(depth) per file.

**Constraints**:

- No remote write and no remote content read; the re-check lists only (R026, protocol audit).
- No password, document URI or remote path crosses the bridge (D011, D016).
- UNKNOWN files are never deleted (D006).
- Execute runs only a confirmed plan on the snapshot it was made from (D008).
- Material 3 via Paper, with no inline styles (005 FR-004). Every control has an accessibility label
  (R021).
- The signing material is never committed.

**Scale/Scope**: up to 50 k local files across ≤ 20 sources (the 004 scale).

- Two new screens or sections (Repository form, selection bar and dialogs) and changes to 4 existing ones.
- 1 new and 2 implemented bridge methods, 5 new error codes and 1 schema step.
- 12 Maestro flows (three split into parts around a host-side step) and the release-smoke mode.

All unknowns are resolved in [research.md](./research.md).

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS (with 2 recorded items) | Reuses the existing repository, host-key and matching code throughout. The re-check lists folders through the existing `list` and shared retry (R12). Plans live in memory (R13). Deletions remove rows, so no read query changes (R14). The checklist is derived, not stored (R6). Selection is one ID map (R9). The new stack-navigator dependency and the snapshot-mutation rule are recorded under Complexity Tracking. |
| II. YAGNI | PASS | No inline host-key approval inside the deletion flow (an error points to Settings), no plan persistence, no deletion progress polling, no empty-folder removal (clarification 4), no user-CA trust, no re-check of UNSYNCED files, and `remote_node` stays unwritten (R11). Selection exists only in gallery and list; tree view is 007's. |
| III. DRY | PASS | Matching rules stay only in `MatchIndex` (`nfc`, `bucketOf`), reused by the re-check. The retry policy is extracted from `RemoteWalker` into one shared function. Native code alone owns message text; JS maps codes to places in one table (R5). Default ports are one mirrored constant (R2). The count-decrement invariant is the same one `DirectoryRollupTest` pins. `formatBytes` is defined once. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | **JVM**:<br>• `MigrationTest` (3 → 4)<br>• `MatchIndexTest` (directories collected, deduplicated, cap 16, `toRows`/`fromRows` round trip)<br>• `RemoteWalkerTest` (shared retry)<br>• `DeletionRecheckTest` (fake `RemoteClient`: confirmed, gone, folder-not-found, folder-unreadable, connect failure → no plan, `SCAN_TOO_OLD`, host-key codes)<br>• `DeletionOperationsTest` (plan replace, expiry, stale, single use, `includeUnsynced`, refused never deleted)<br>• `LocalDeleterTest` (fake SAF: `DELETED`, `ALREADY_GONE`, `CHANGED`, `ACCESS_LOST`, `FAILED`)<br>• `SnapshotStoreTest` (`recordDeletions` invariant, `listSelectableEntries` scope rules)<br>• `ScanCoordinatorTest` (`runExclusive`, `DELETION_IN_PROGRESS`)<br>• `RepositoryOperations` tests (`webdavHttps`, `field`, `SCAN_IN_PROGRESS`, reworded actions)<br>• `WebDavRemoteClientTest` (https scheme, `TLS_UNTRUSTED` mapping)<br>• `SourcePickerTest` (DCIM initial URI only when adding)<br>• contract parity and module tests<br>**Jest**:<br>• contract v5 wrappers<br>• `useRepository` state machine<br>• `RepositoryScreen` (prefill, unsaved-changes prompt, changed-key double confirm, warning)<br>• `fixTargets`<br>• `useSetupChecklist`, `ScanScreen` checklist, `FilesScreen` empty state<br>• `SelectionProvider` transitions, `selectionSummary`, `formatBytes`, `SelectionBar`<br>• `DeleteFlow` dialogs and result<br>• the accessibility sweep<br>• a "no Connect screen string" test<br>**Script-contract**: staged pairs, `release-smoke`, hooks, fixtures.<br>All of it is deterministic, with no device or network. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | Every P1 story (1, 2, 4, 5, 6) and each protocol (FTP, SFTP, WebDAV setup through the UI) maps to a named Maestro flow on API 31 and API 36 against the live containers ([contracts/maestro-mvp.md](./contracts/maestro-mvp.md#acceptance-scenario-mapping)). P2 Story 3 is covered by `03-first-run` and the extended `sources/06-regrant`. Story 4 sc. 3–6 are covered by the release-smoke mode, and Story 6 sc. 6 by a staged flow with a device-side hook. Deletion removes real files (D012). Fixtures are reproducible, and the staged hooks are scripted, not manual. Four scenarios that cannot be set up deterministically are proven by JVM and Jest tests and recorded as deviations under Complexity Tracking. |
| VI. Versioning + CHANGELOG | PASS | `Unreleased`:<br>• "Added: repository setup screen, first-run guidance, multi-select with selection size, safe two-phase deletion, release APK build"<br>• "Changed: release builds allow user-chosen unencrypted connections; WebDAV can use HTTPS"<br>• "Changed: CloudSync contract version 5; scan store schema version 4"<br>• "Changed: the app version now comes from `package.json`"<br>`versionName` and `versionCode` are derived from `package.json` (FR-022, R17), proven by a script-contract test of `:app:printVersion` and by release-smoke's `aapt2 dump badging` check. This closes the gap 001's Complexity Tracking deferred. |
| VII. `./docs` | PASS | **New decisions**:<br>• D020, pre-delete server re-check and per-key server folders (R11, R12)<br>• D021, release signing and the cleartext policy (R4, R8)<br>**Amended decisions**:<br>• D008, `includeUnsynced` and row removal (R13, R14)<br>• D018, the seam stays for non-setup flows<br>**Pages**: `architecture.md` (navigation stack, deletion package, delivery list), `sync-and-deletion-safety.md` (re-check, outcomes, what is never deleted), `protocols.md` (the "Known limit" becomes WebDAV HTTPS and `TLS_UNTRUSTED`), `overview.md`. |
| VIII. README | PASS | User-facing sections "Install the app", "Set up your server", "Pick folders" (the Android restriction), and "Free up space safely" (select, size, what is never deleted, server check). They lead the README before any developer link. |
| IX. DEVELOPMENT.md | PASS | Release key creation and properties, `pnpm assemble:release`, the `hermes-compiler` hoist, the `release-smoke` mode and staged pairs, the new fixtures and hooks, and the `mvp/` flows. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit`, `test:foundation`, `e2e:android` (API 31 and 36) and `release-smoke` are the exit gate. |

The gate passes. The post-design re-check and the 2026-10-02 analysis found the items under Complexity
Tracking (two added-complexity items and four justified end-to-end deviations) and no unjustified
violations.

## Project Structure

### Documentation (this feature)

```text
specs/006-mvp/
├── spec.md                  # clarified 2026-10-02
├── plan.md                  # this file
├── research.md              # R1–R16
├── data-model.md            # schema v4, deletion write rule, plan and selection state
├── quickstart.md            # gates, APK install, manual walk-through
├── contracts/
│   ├── cloudsync-mvp.md     # contract v5: new/implemented methods, DTOs, error codes
│   └── maestro-mvp.md       # fixtures, runner additions, selectors, scenario → flow mapping
├── checklists/requirements.md
└── tasks.md                 # next: /speckit-tasks
```

### Source Code (repository root)

```text
android/app/build.gradle                     # signingConfigs.release from SYNCSCOPE_RELEASE_*; fail-fast check;
                                             #   release usesCleartextTraffic=true (R4, R8); version from
                                             #   package.json + :app:printVersion (R17)
android/app/schemas/.../4.json               # NEW (exported)
android/app/src/main/java/com/syncscope/
├── bridge/
│   ├── CloudSyncContracts.kt                # v5; new codes; REPOSITORY_DEFAULT_PORTS; MAX_DELETION_PLAN_AGE
│   ├── CloudSyncEnvelope.kt                 # error `field`; plan/result/selectable DTO builders
│   ├── CloudSyncModule.kt                   # wire listSelectableEntries, prepare/execute
│   ├── RepositoryOperations.kt              # webdavHttps, field errors, busy check, reworded actions
│   └── ScanOperations.kt                    # configRevision on the active snapshot; listSelectableEntries
├── deletion/                                # NEW
│   ├── DeletionOperations.kt                # plan store, prepare/execute orchestration (R12, R13)
│   ├── DeletionRecheck.kt                   # group by folder, list, confirm with MatchIndex rules
│   └── LocalDeleter.kt                      # SAF verify + deleteDocument per file → outcome
├── persistence/
│   ├── Entities.kt                          # + directories, + webdavHttps
│   ├── SyncScopeDatabase.kt                 # version 4, @AutoMigration(3 → 4)
│   ├── Daos.kt                              # copy(+directories); key lookup; selectable rows; decrement queries
│   └── SnapshotStore.kt                     # recordDeletions (R14); selectableEntries
├── remote/
│   ├── RemoteClient.kt                      # RemoteConfig.webdavHttps
│   └── WebDavRemoteClient.kt                # scheme from config; SSL failures → TLS_UNTRUSTED
├── scan/
│   ├── MatchIndex.kt                        # add(entry, directory); directories per key (cap 16)
│   ├── RemoteWalker.kt                      # listWithRetry extracted (shared with the re-check)
│   ├── ScanCoordinator.kt                   # runExclusive / isBusy (R3, R13)
│   └── ScanEngine.kt                        # pass the listed directory to MatchIndex
└── source/
    ├── SafAccess.kt                         # + document stat and delete
    └── SourcePicker.kt                      # EXTRA_INITIAL_URI = primary:DCIM when adding (R7)
android/app/src/test/java/com/syncscope/{bridge,deletion,persistence,remote,scan,source}/   # per Check IV

src/
├── native/
│   ├── specs/NativeCloudSync.ts             # listSelectableEntries; executeLocalDeletion(+includeUnsynced)
│   ├── CloudSyncContracts.ts                # v5 DTOs, codes, constants
│   └── CloudSync.ts                         # wrappers
├── navigation/
│   ├── AppNavigator.tsx                     # root native stack: Tabs + Repository (R1)
│   └── fixTargets.ts                        # NEW: error code → place (R5)
├── repository/                              # NEW
│   ├── useRepository.ts                     # save → test → host-key state machine (R2)
│   ├── RepositorySection.tsx                # Settings summary + Set up / Edit
│   └── HostKeyDialog.tsx                    # unknown / changed key
├── screens/
│   ├── RepositoryScreen.tsx                 # NEW: the form, beforeRemove discard prompt
│   ├── SettingsScreen.tsx                   # + RepositorySection
│   ├── ScanScreen.tsx                       # checklist card, old-settings notice, Go there
│   ├── FilesScreen.tsx                      # empty state; selection mode (hide tabs, header actions, bar)
│   ├── GalleryScreen.tsx                    # long-press / toggle, selected overlay
│   └── ListScreen.tsx                       # long-press / toggle on file rows; folder taps navigate
├── setup/useSetupChecklist.ts               # NEW (R6)
├── selection/                               # NEW
│   ├── SelectionProvider.tsx                # ID map, snapshot guard, select all (R9)
│   ├── summary.ts                           # selectionSummary
│   ├── formatBytes.ts                       # decimal units, locale (R10)
│   ├── SelectionBar.tsx                     # bottom-left count · size; Delete
│   └── DeleteFlow.tsx                       # checking → confirmation → result dialogs
├── files/a11y.ts                            # ", selected" labels; selection selectors
└── sources/SourcesSection.tsx               # picker hint

validation/maestro/mvp/                      # NEW: flows per contracts/maestro-mvp.md
validation/maestro/staged/                   # NEW: split a/b pairs + pairs.txt (not in config.yaml)
validation/maestro/config.yaml               # + mvp/* in flowsOrder
scripts/validation/
├── android-flow.sh                          # staged pairs, release-smoke
├── hooks/                                   # NEW: remove-recheck-file.sh, pause-service.sh, resume-service.sh
├── device-fixtures.sh                       # + Delete, Recheck, Offline, Select sources
├── fixture-seed.sh                          # + recheck/ (re-created each run)
└── validation-infrastructure.test.mjs
package.json                                 # + @react-navigation/native-stack
pnpm-workspace.yaml                          # hermes-compiler hoist (already in the working tree)
docs/  README.md  DEVELOPMENT.md  CHANGELOG.md   # per Principles VI–IX
```

**Structure Decision**: one Android app module plus the JS presentation layer, as in 002–005.

- **Native**: deletion gets its own `deletion` package, because it is a separate concern from scanning and
  browsing. It talks to the scan store, the SAF layer and the remote clients only through their existing
  types.
- **JS**: the new UI concerns get their own folders (`repository/`, `selection/`, `setup/`), and the
  screens stay in `src/screens/`, following the 005 layout.

## Integration closure

This feature hands **feature 007** (tree view and preview):

- `SelectionProvider`, `SelectionBar`, `DeleteFlow` and the `, selected` label convention, to extend
  selection to tree view and the preview;
- `listSelectableEntries` with the list-view (`parentId`) scope, which the tree reuses per folder.

It hands **feature 009** (full loop and release):

- the Repository screen, so the full-loop flow's "connect" step goes through the UI;
- `pnpm assemble:release`, the release key setup and `release-smoke`, which 009 extends with version
  derivation and API 36;
- the deletion flows, which 009 runs on API 36 too.

Snapshot retention (009) must now keep `remote_match_key.directories` for the active snapshot's remote
side. It already keeps the active snapshot, so nothing changes, but this is noted in 009's spec follow-up.

Spec follow-ups (cross-feature consistency, not blocking tasks):

- 007 spec: consume the items above (already stated in its "Selection in tree view and preview" section).
- 009 spec: record that the release-smoke mode exists and that WebDAV HTTPS ships here.

## Risks

| Risk | Mitigation |
| --- | --- |
| Allowing cleartext in release lets a user send a password unencrypted (FTP, HTTP WebDAV) | It is the user's explicit choice, shown with a warning in the form. HTTPS is the default for a new WebDAV setup, and SFTP is recommended in the message. Recorded in D021. |
| Self-signed HTTPS WebDAV (common on a home NAS) fails with `TLS_UNTRUSTED` | A clear message suggests SFTP or plain HTTP on a trusted network. User-CA trust is a later feature if asked for. |
| SAF `deleteDocument` is slow on some devices; thousands of files take minutes with only an indeterminate indicator | Batches commit every 100 files, so an interruption is safe. The dialog says "Deleting N files…". Progress polling is a follow-up if human acceptance (quickstart §3) finds it painful. |
| A file changed on the device after the scan but kept the same size and modified time is deleted | The same identity rule the scan uses (D003). The server re-check confirmed a copy with that identity exists. Accepted. |
| `docker compose pause` hooks between staged parts make the suite slower or flaky | `resume` runs from a `trap`. The paused window covers one prepare call. Hooks are unit-tested by script-contract tests. |
| The DocumentsUI header text for DCIM differs between API levels | The flow asserts "DCIM" with a regex over the header only. If a level differs, the assertion is per level (009 adds API 36). |
| The release build fails on bundling (`hermes-compiler` not found) | The hoist in `pnpm-workspace.yaml` is part of this feature, and `release-smoke` proves the build from a clean checkout. |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| New dependency `@react-navigation/native-stack` (Principle I: extra dependency) | The Repository form needs its own screen with back handling and a discard prompt (spec edge case "Leaving the form") | An inline Settings edit mode or a Paper `Modal` needs hand-written back, keyboard and tab-switch guards, which is more code than the dependency. Its native part is already installed (R1). |
| Published snapshots are mutated by deletions (rows removed, counts decremented) | The results must reflect deletions immediately without a rescan (FR-020) | Overlay filtering would change every read path, including precomputed folder counts. A post-delete `LOCAL_REFRESH` takes seconds to minutes during which the results are wrong (R14). The overlay table still records each outcome (D008). |
| Constitution V deviation: Story 1 sc. 5 (changed SFTP key) has no Maestro flow | The scenario needs the server's host key to change mid-suite | Rotating the shared SFTP container's key breaks every later SFTP flow. A debug seam that fakes the change adds a test-only path into host-key trust (D017 allows seams for real OS state only). Proven by `TofuHostKeyVerifierTest`, `useRepository` and `HostKeyDialog` tests. |
| Constitution V deviation: Story 2 sc. 4 (stored password unreadable) has no Maestro flow | Needs Android Keystore to invalidate the stored credential | No test can trigger Keystore invalidation; faking it would be a seam into credential storage. Proven by the `RepositoryOperationsTest` `CREDENTIAL_UNAVAILABLE` case (T019) plus the `useSetupChecklist` (`needsPassword`) and `fixTargets` tests. |
| Constitution V deviation: Story 5 sc. 5 (unknown sizes) has no Maestro flow | Needs a device file whose size SAF does not report | SAF reports a size for every regular file the fixtures can create. Proven by the `selectionSummary`, `SelectionBar` and `SnapshotStoreTest` (`-1` sizes) tests. |
| Constitution V deviation: Story 6 sc. 9 (scan older than 7 days) has no Maestro flow | Needs a scan whose server listing is more than 7 days old | Moving the emulator clock mid-suite breaks TLS, token expiry and every later flow's timing. Proven by the `DeleteFlow` staleness test, which shares `isRemoteListingStale` with the Scan tab's existing hint. |

