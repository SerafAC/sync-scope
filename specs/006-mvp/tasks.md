---

description: "Task list for feature 006: MVP — a Usable App on a Real Device"
---

# Tasks: MVP — a Usable App on a Real Device

**Input**: Design documents from `/specs/006-mvp/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/cloudsync-mvp.md](./contracts/cloudsync-mvp.md),
[contracts/maestro-mvp.md](./contracts/maestro-mvp.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED.

- Constitution Principle IV requires unit tests for all code, in the same change.
- Principle V requires every P1 story and each protocol to map to a named Maestro flow against the live
  containers.

Each test task sits next to the implementation it verifies: write the test first and make sure it fails.

**Organization**: phases follow the spec's priorities: the P1 stories in spec order (US1, US2, US4, US5,
US6), then US3 (P2). US6 builds on US1 (a saved repository) and US5 (the selection). Every other story
needs only Phase 2.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task belongs to (US1–US6)
- Paths are relative to the repository root. Abbreviations:
  - `KT/` = `android/app/src/main/java/com/syncscope/`
  - `KTEST/` = `android/app/src/test/java/com/syncscope/`
  - `MAESTRO/` = `validation/maestro/`
- Byte sizes in Maestro assertions: every fixture PNG is far smaller than 1000 bytes, so each expected
  label is `<n> B`. The runner passes raw byte sums as `SIZE_*` variables, and the flows assert
  `${SIZE_X} B`. No unit formatting is restated in shell (Principle III).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: fixtures, the staged-pair runner, the release-smoke mode and the one new dependency. No
production behaviour.

- [X] T001 Add script-contract assertions to `scripts/validation/validation-infrastructure.test.mjs` for the new fixtures ([contracts/maestro-mvp.md](./contracts/maestro-mvp.md#fixtures)). The test must fail until T002 and T003 land.
  - **Remote**: seeding a scratch root with `scripts/validation/fixture-seed.sh` must create `recheck/` as a byte-identical copy of `gallery/` (`sunset.png`, `beach.png`, `album/forest.png`) with mtime `@1704067200`, directories `755`. A second seed run must re-create `recheck/beach.png` after it was deleted, because flow 06 mutates it.
  - **Device**: `scripts/validation/device-fixtures.sh` must seed `/sdcard/SyncScopeE2E/Delete`, `/Recheck`, `/Offline`, `/Select` and `/Changed`. Each is the same tree as `SyncScopeE2E/Gallery`: `sunset.png`, `beach.png`, `album/forest.png`, `harbor.png`, `album/notes.txt`, `drafts/draft.png`, with the same bytes and mtimes. The script must stay idempotent and re-create deleted files on every run.
- [X] T002 Extend `scripts/validation/fixture-seed.sh` to make the remote half of T001 pass. Do `rm -rf "$root/recheck"`, then copy `gallery/` to `recheck/` with `cp -p`, keep the existing `touch -d @1704067200` and `chmod` passes covering it, and add the three files to the manifest list. `pnpm test:foundation` must pass.
- [X] T003 Extend `scripts/validation/device-fixtures.sh` to make the device half of T001 pass. Refactor the existing Gallery seeding into one shell function `seed_gallery_tree <dir>`, called for `Gallery`, `Delete`, `Recheck`, `Offline`, `Select` and `Changed` (Principle III: one definition of the tree). Each call removes and re-creates the directory first, so files deleted by a previous run come back. Update the header comment (feature 006 sources). `pnpm test:foundation` must pass.
- [X] T004 Add script-contract assertions to `scripts/validation/validation-infrastructure.test.mjs` (same file as T001: do it after T001) for the runner additions in [contracts/maestro-mvp.md](./contracts/maestro-mvp.md#runner-additions-scriptsvalidationandroid-flowsh). The test must fail until T005–T007 land.
  - `android-flow.sh` accepts the mode `release-smoke` (exit 64 for unknown modes stays).
  - Every `MAESTRO/staged/pairs.txt` line parses as an alternating sequence `<flow>|<hook and args>|<flow>[|<hook and args>|<flow>…]` that starts and ends with a flow. Every named file exists, and every hook exists and is executable.
  - `scripts/validation/hooks/remove-recheck-file.sh`, run with `SYNCSCOPE_STATE_ROOT` pointing at a scratch tree, deletes exactly `fixtures/recheck/beach.png`.
  - `pause-service.sh` and `resume-service.sh` reject a protocol other than `ftp|sftp|webdav` with exit 64. Use a fake `docker` first on `PATH` that records its arguments; it must have been called with `compose … pause sftp`.
  - `change-device-files.sh`, with a fake `adb` first on `PATH` that records its arguments, calls `adb -s "$ANDROID_SERIAL" shell` to remove `/sdcard/SyncScopeE2E/Changed/beach.png` and to run `touch -d @1704153600` on `/sdcard/SyncScopeE2E/Changed/sunset.png`.
  - `MAESTRO/config.yaml` lists neither `staged/` nor its files.
- [X] T005 [P] Create `scripts/validation/hooks/remove-recheck-file.sh`, `change-device-files.sh`, `pause-service.sh <protocol>` and `resume-service.sh <protocol>` (POSIX `sh`, `set -eu`). `change-device-files.sh` uses `"$ANDROID_HOME/platform-tools/adb" -s "$ANDROID_SERIAL"`. The pause and resume hooks call `docker compose -f validation/services/compose.yaml pause|unpause <protocol>`, matching how `protocol-services.sh` addresses the compose file. Mark all four executable.
- [X] T006 Extend `scripts/validation/android-flow.sh` with staged pairs. After the workspace `maestro test` call in `e2e` mode, read `MAESTRO/staged/pairs.txt`, skipping `#` comments and blank lines. For each line, walk the alternating sequence: run `maestro test` with the same `-e` arguments on each flow and the host hook between them. Only the first flow of a line uses `clearState`. Export `ANDROID_SERIAL="$serial"` before the first hook runs.
  - When a hook starts with `pause-service.sh`, register the matching `resume-service.sh` in `cleanup()` before running it, so it always resumes.
  - Any failure fails the run.
  - Pass the new size variables with the other `-e` values: `SIZE_BEACH`, `SIZE_SYNC_2` (sunset + beach), `SIZE_IMAGES_5` (the five PNGs of the Gallery tree) and `SIZE_SYNCED_3` (sunset + beach + forest). Compute them with `wc -c` over the files `fixture-seed.sh` wrote, never as literals.
- [X] T007 Add the `release-smoke` mode to `scripts/validation/android-flow.sh`, plus a `package.json` script `"e2e:android:release-smoke": "scripts/validation/android-flow.sh release-smoke --api 31"`. The mode follows the step list in [contracts/maestro-mvp.md](./contracts/maestro-mvp.md#runner-additions-scriptsvalidationandroid-flowsh):
  1. Runs `pnpm assemble:release` with every `SYNCSCOPE_RELEASE_*` property unset, and asserts it exits non-zero with output containing `Release signing is not configured` (Story 4 sc. 4).
  2. Generates a throwaway PKCS12 keystore with `keytool -genkeypair` in `mktemp -d`, removed in `cleanup()`. It exports `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_FILE`, `_STORE_PASSWORD`, `_KEY_ALIAS` and `_KEY_PASSWORD`, then runs `pnpm assemble:release`, the documented command (sc. 3).
  3. Asserts that `aapt2 dump badging app-release.apk` reports `versionName` equal to `package.json`'s `version` and the `versionCode` derived as in research R17 (FR-022, sc. 6).
  4. Installs `app-release.apk` after `adb uninstall com.syncscope` (failure ignored), does **not** start Metro, and seeds the device fixtures.
  5. Asserts that `adb shell am start -W -a android.intent.action.VIEW -d 'syncscope-debug://configure-repository'` prints `Error: Activity not started, unable to resolve Intent`, and fails otherwise.
  6. Runs `maestro test` with the `-e` values on `MAESTRO/mvp/90-release-smoke.yaml`.
  7. Runs `adb install -r` with the same APK (an in-place update with the same key), then `maestro test` on `MAESTRO/mvp/91-release-update.yaml` (sc. 5).

  `pnpm test:foundation` must pass with T004.
- [X] T008 [P] Create `MAESTRO/mvp/.gitkeep` and `MAESTRO/staged/pairs.txt`, the latter with only a header comment explaining the format and that `config.yaml` must never list `staged/`. In `MAESTRO/config.yaml` add `- "mvp/*"` under `flows:` after `- "browse/*"`. Do **not** add `flowsOrder` entries here: each flow is added by the task that creates it.
- [X] T009 [P] Add `@react-navigation/native-stack` at the 7.x version matching the installed `@react-navigation/native` 7.4.1 (exact pin, as for the other dependencies) to `package.json` with `pnpm add`, and commit the existing `pnpm-workspace.yaml` `hermes-compiler` hoist with it (research R8). Add the jest mock or `transformIgnorePatterns` entry the package needs, following the existing setup for `@react-navigation/bottom-tabs`, so `pnpm test:ci` passes unchanged.

**Checkpoint**: fixtures seed, staged pairs and release-smoke run (with no flows yet), and the dependency is installed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contract version 5, schema version 4 and scan/deletion exclusivity. Several stories build on
all three.

**⚠️ CRITICAL**: no story work can begin until this phase is complete.

### Contract version 5 (TS and Kotlin in lockstep, parity-guarded)

- [X] T010 Bump the contract to version 5 on both sides: `CLOUD_SYNC_CONTRACT_VERSION = 5` in `src/native/CloudSyncContracts.ts` and `CONTRACT_VERSION = 5` in `KT/bridge/CloudSyncContracts.kt`.
  - Insert the new codes `TLS_UNTRUSTED`, `DELETION_IN_PROGRESS`, `REPOSITORY_CHANGED`, `PLAN_NOT_FOUND` and `PLAN_STALE` **just before `INTERNAL_ERROR`** in both code lists, with doc comments.
  - The native messages and actions are exactly those in [contracts/cloudsync-mvp.md](./contracts/cloudsync-mvp.md#error-codes-new). Put them where `KT/bridge/CloudSyncEnvelope.kt` keeps per-code text.
  - Reword the `REPOSITORY_NOT_CONFIGURED` doc comment in `CloudSyncContracts.ts` to "No repository has been saved yet; set one up in Settings › Repository."
  - Update `KTEST/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts` in the same task.
- [X] T011 Add the mirrored constants `REPOSITORY_DEFAULT_PORTS = {FTP: 21, SFTP: 22, WEBDAV: 80, WEBDAV_HTTPS: 443}` and `MAX_DELETION_PLAN_AGE_MILLIS = 15 * 60 * 1000`. On the TS side they go in `src/native/CloudSyncContracts.ts` (`as const`); on the Kotlin side in `KT/bridge/CloudSyncContracts.kt` as `object RepositoryDefaultPorts` and `const val MAX_DELETION_PLAN_AGE_MILLIS`. Extend the parity test to compare every value (same file as T010: do it after T010).
- [X] T012 Add an optional `field` to errors.
  - **Kotlin**: `KT/bridge/CloudSyncEnvelope.kt` `error(...)` takes `field: String? = null` and writes `error.field` only when non-null. `invalidField(field, reason)` passes `field`. Add the cases to `KTEST/bridge/CloudSyncEnvelopeTest.kt`.
  - **TS**: in `src/native/CloudSyncContracts.ts`, `CloudSyncError` gains `field?: RepositoryField | null`, where `RepositoryField = 'protocol' | 'host' | 'port' | 'username' | 'password' | 'remoteRoot'`. Add the same field to the Codegen `CloudSyncErrorDto` in `src/native/specs/NativeCloudSync.ts`.
- [X] T013 Add the v5 DTO types to `src/native/CloudSyncContracts.ts`, exactly as in [contracts/cloudsync-mvp.md](./contracts/cloudsync-mvp.md):
  - `SelectableEntriesDto` (`sizes` uses "-1 = size unknown");
  - `DeletionPlanDto`, `DeletionFailureDto` (reasons `'ALREADY_GONE' | 'CHANGED' | 'ACCESS_LOST' | 'FAILED'`) and `DeletionResultDto`, each with its `…Ok` / `…Result` union;
  - the repository summary gains `revision: number` and `webdavHttps: boolean`;
  - the save config gains `webdavHttps?: boolean`;
  - `ActiveSnapshotDto` gains `configRevision: number`.

  Add type-level tests to `src/native/__tests__/CloudSyncContracts.test.ts`.
- [X] T014 Change the Codegen spec `src/native/specs/NativeCloudSync.ts`: add `listSelectableEntries(snapshotId: string, querySpec: QuerySpecInput): Promise<OperationResultDto>` and change `executeLocalDeletion(planToken: string, includeUnsynced: boolean)`. Update the doc comment, which no longer says these are owned by later features.
  - In `KT/bridge/CloudSyncModule.kt`, add `override fun listSelectableEntries(...)` and adapt `executeLocalDeletion(planToken, includeUnsynced, promise)`. All three deletion and selection methods still resolve `NOT_IMPLEMENTED` here; they are wired in T046 and T067.
  - Update `KTEST/bridge/CloudSyncModuleTest.kt` and `src/native/__tests__/NativeCloudSyncBoundary.test.ts`. `pnpm assemble:debug` must pass, which runs Codegen.

### Schema version 4

- [X] T015 Add the schema version 4 columns to `KT/persistence/Entities.kt` ([data-model.md](./data-model.md#schema-change-version-3--4)):
  - `RemoteMatchKeyEntity.directories: String? = null`, doc: "Distinct remote parent directories of the files collapsed into this key, `\n`-separated, at most 16. `NULL` on rows written before version 4."
  - `RepositoryConfigEntity.webdavHttps: Boolean = false` with `@ColumnInfo(defaultValue = "0")`, doc: "WebDAV only: connect over HTTPS. Existing rows keep plain HTTP."

  Set `version = 4` and add `AutoMigration(from = 3, to = 4)` in `KT/persistence/SyncScopeDatabase.kt`. Export `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/4.json` by building. Extend `RemoteMatchKeyDao.copy` in `KT/persistence/Daos.kt` to copy `directories`.
- [X] T016 Add tests for the schema change.
  - `KTEST/persistence/MigrationTest.kt`: 3 → 4 keeps every existing row; `remote_match_key.directories` reads `NULL` and `repository_config.webdavHttps` reads `0`.
  - `KTEST/persistence/SchemaContractTest.kt`: `repository_config` still has no secret column.
  - `KTEST/persistence/SnapshotStoreTest.kt`: `RemoteMatchKeyDao.copy` carries `directories`.

  (Write the tests before T015 and make them fail.)

### Exclusivity

- [X] T017 Add tests to `KTEST/scan/ScanCoordinatorTest.kt` for:
  - `runExclusive { }` throws `ScanInProgress` while a run is active;
  - `start()` throws the new `DeletionInProgress` while an exclusive block runs;
  - a second `runExclusive { }` throws `DeletionInProgress` while the first is still running, so only one prepare or execute runs at a time (FR-021);
  - `isBusy()` is true in both cases;
  - an exclusive block that throws still releases the coordinator.
- [X] T018 Implement T017 in `KT/scan/ScanCoordinator.kt`:
  - `class DeletionInProgress : Exception(CloudSyncErrorCode.DELETION_IN_PROGRESS.name)`;
  - `suspend fun <T> runExclusive(block: suspend () -> T): T`, which under the existing `mutex` throws `ScanInProgress` if a run is active and `DeletionInProgress` if the exclusive flag is already set, then sets the flag, runs `block` outside the mutex, and clears the flag in `finally`;
  - `fun isBusy(): Boolean`.

  Map `DeletionInProgress` to the `DELETION_IN_PROGRESS` envelope wherever `KT/bridge/ScanOperations.kt` maps `ScanInProgress`, with a test in `KTEST/bridge/ScanOperationsTest.kt`.

**Checkpoint**: contract v5 compiles on both sides with parity green, the database migrates to version 4,
and the coordinator can run exclusive work.

---

## Phase 3: User Story 1 — Set up the backup server in the app (Priority: P1) 🎯 MVP

**Goal**: a Repository section in Settings and a form screen that saves, tests and approves SFTP keys,
with HTTPS for WebDAV.

**Independent Test**: on a fresh install, configure FTP, SFTP and WebDAV through the UI against the live
containers and see "Connected" (`MAESTRO/mvp/01-setup-*.yaml`, `02-setup-errors.yaml`).

### Native

- [X] T019 [P] [US1] Create `KTEST/bridge/RepositoryOperationsTest.kt` with fake DAO, credential, host-key and client factories, following `CloudSyncHostKeyModuleTest.kt`. It covers:
  - `webdavHttps` saved and returned by `summary()`, with absent meaning `false`;
  - `revision` in the summary;
  - port null → 21, 22, 80, or 443 with `webdavHttps`, read from `RepositoryDefaultPorts`;
  - each invalid field → `INVALID_QUERY` with `field` set;
  - `save` while `isBusy()` → `SCAN_IN_PROGRESS`, or `DELETION_IN_PROGRESS` when the coordinator reports an exclusive block, and nothing written;
  - the actions of `REPOSITORY_NOT_CONFIGURED` ("Set up your server in Settings › Repository.") and `CREDENTIAL_UNAVAILABLE` ("Enter the password again in Settings › Repository.");
  - SC-005: after `save` and `test` with the password `s3cret-Log-Probe`, no Robolectric `ShadowLog` entry contains that string.
- [X] T020 [US1] Implement T019 in `KT/bridge/RepositoryOperations.kt`:
  - parse `webdavHttps`;
  - `defaultPort(protocol, https)` from `RepositoryDefaultPorts`, replacing the inline `when`;
  - put `revision` and `webdavHttps` in the summary;
  - check busy through a constructor parameter `busy: () -> BusyState` (none / scan / deletion), wired in `KT/bridge/CloudSyncModule.kt` from the coordinator;
  - the reworded `NOT_CONFIGURED_ACTION` and `CREDENTIAL_UNAVAILABLE_ACTION`;
  - pass `webdavHttps` into `RemoteConfig` in `toRemoteConfig()`.
- [X] T021 [P] [US1] In `KT/remote/RemoteClient.kt`, add `RemoteConfig.webdavHttps: Boolean = false`, still excluded from `toString()`. In `KT/remote/WebDavRemoteClient.kt`:
  - extract `internal fun webdavScheme(config): String` (`https` when `webdavHttps`) and use it where the `HttpUrl.Builder` is built;
  - map `javax.net.ssl.SSLHandshakeException` and `SSLPeerUnverifiedException` to `RemoteClientException(TLS_UNTRUSTED, …)` in the existing failure mapping.

  Create `KTEST/remote/WebDavRemoteClientTest.kt`, which tests the scheme choice and the mapping of both SSL exceptions to `TLS_UNTRUSTED` through the extracted mapping function, with no network.

### JS

- [X] T022 [P] [US1] Update the repository wrappers in `src/native/CloudSync.ts`: `saveRepository` sends `webdavHttps`; the summary parser reads `revision` and `webdavHttps`; the error parser keeps `field` when it is a known `RepositoryField`. Add tests to `src/native/__tests__/CloudSync.test.ts`.
- [X] T023 [US1] Turn `src/navigation/AppNavigator.tsx` into a root native stack (`createNativeStackNavigator<RootStackParamList>()`, with `RootStackParamList = {Tabs: undefined; Repository: undefined}`).
  - `Tabs` renders the existing bottom-tab navigator with `headerShown: false`.
  - `Repository` renders `RepositoryScreen` (T026) with title "Repository".
  - Export the param list types.

  Update `__tests__/App.test.tsx` so that it still renders.
- [X] T024 [P] [US1] Create `src/repository/useRepository.ts` and `src/repository/__tests__/useRepository.test.tsx` (mocked `CloudSync`). The hook implements the state machine in [data-model.md](./data-model.md#repository-form-js-repositoryscreen--userepository): `idle → saving → testing → connected | failed | hostKeyPrompt`, then `rejected`. Tests cover:
  - save ok then test ok → `connected` with `entryCount`;
  - save `INVALID_QUERY` with a field → `failed` with that field;
  - test `AUTH_FAILED` → `failed`;
  - `SFTP_HOST_KEY_UNVERIFIED` → `hostKeyPrompt` (`changed: false`), then approve → re-test → `connected`;
  - `SFTP_HOST_KEY_CHANGED` → `hostKeyPrompt` (`changed: true`);
  - reject → `rejected`;
  - `SCAN_IN_PROGRESS` → `failed`;
  - test `CONNECTION_TIMEOUT` → `failed` with the timeout message (spec edge case "Slow or hanging server").

  The password is passed straight from the call argument and never kept in hook state.
- [X] T025 [P] [US1] Create `src/repository/HostKeyDialog.tsx` and `src/repository/__tests__/HostKeyDialog.test.tsx`. It is a Paper `Dialog` showing the algorithm and fingerprint (`Server key fingerprint <fp>`) with `Trust server key` and `Reject server key`.
  - When `changed`, it shows `Server key changed warning` first and labels the button `Trust new key`. The first tap reveals "Tap again to trust the new key", and only the second tap calls `onTrust`.
  - The tests cover both variants and the double confirmation.
- [X] T026 [US1] Create `src/screens/RepositoryScreen.tsx` and `src/screens/__tests__/RepositoryScreen.test.tsx`. The screen has:
  - a protocol `SegmentedButtons` (`Protocol FTP|SFTP|WebDAV`) and the text inputs `Host`, `Port` (placeholder from `REPOSITORY_DEFAULT_PORTS`, 443 when HTTPS), `User name`, `Password` (secure) and `Remote folder`;
  - a `Use HTTPS` switch shown only for WebDAV, on by default for a new configuration (research R4);
  - `Unencrypted connection warning` for FTP, or for WebDAV with HTTPS off;
  - `Save and test`, disabled while a required field is empty or `useScan` reports an active run (then also shows "A scan is running");
  - while `saving` or `testing`, an indeterminate progress indicator labelled `Checking connection` with "Connecting to the server…" ("Slow or hanging server"; the client's existing timeouts end it with `CONNECTION_TIMEOUT`);
  - the status line `Connected, <n> entries` or `Connection failed: <message>`, plus the action;
  - field errors under the field named by `error.field`;
  - `HostKeyDialog` on `hostKeyPrompt`.

  Prefill from `getRepositorySummary` except the password, whose helper text is "A password is stored. Leave empty to keep it." when `credentialPresent`. Register `navigation.addListener('beforeRemove', …)` to show a `Discard changes` / `Keep editing` dialog when the draft differs from the summary or a password was typed.

  Tests cover prefill, the warning visibility rules, the HTTPS default and port placeholder, a field error, the disabled save during a scan, the progress indicator and the timeout message, the discard prompt, the host-key dialog, and that typed values (except the password, which is cleared) survive an `AppState` change to `background` and back (spec edge case "App sent to background during setup"). Use themed `StyleSheet` styles only (005 lint rule).
- [X] T027 [US1] Create `src/repository/RepositorySection.tsx` and its test `src/repository/__tests__/RepositorySection.test.tsx`, and render it above `SourcesSection` in `src/screens/SettingsScreen.tsx`, updating that file's doc comment.
  - With no repository it shows `Repository not set up` and a `Set up repository` button.
  - Otherwise it shows the summary `Repository <PROTOCOL> <host>` with user, folder, "Password stored" or "Password needed", and `Edit repository`.
  - Both buttons `navigate('Repository')`, and the section re-reads the summary on screen focus.

  Update `src/screens/__tests__/SettingsScreen.test.tsx`.

### End-to-end

- [X] T028 [US1] Create `MAESTRO/mvp/01-setup-ftp.yaml`, `01-setup-sftp.yaml` and `01-setup-webdav.yaml` exactly as mapped in [contracts/maestro-mvp.md](./contracts/maestro-mvp.md#acceptance-scenario-mapping). Each uses `clearState`, `${<P>_HOST}`, `${<P>_PORT}`, `${<P>_USER}` and `${<P>_PASSWORD}`, root `gallery` (prefixed by `${<P>_ROOT}` as the seam does). Add a reusable `MAESTRO/subflows/setup-repository.yaml` with params `PROTOCOL`, `PORT`, `USER`, `PASSWORD`, `ROOT` and `HTTPS`, so T029, T036 and T042 reuse it. Add the three flows to `flowsOrder` after `browse/05-results-updated`.
- [X] T029 [US1] Create `MAESTRO/mvp/02-setup-errors.yaml` (wrong password → `Connection failed:`; fields kept and password empty; fix → `Connected`; edit host then back → `Discard changes`) and add it to `flowsOrder`.

**Checkpoint**: US1 works on its own: a user can set up any of the three protocols without adb.

---

## Phase 4: User Story 2 — From first launch to a first scan without help (Priority: P1)

**Goal**: every "fix this" message names a real place and leads there, and the Scan and Files tabs
guide a new user.

**Independent Test**: on a fresh install, follow only what the screens say until results appear
(`MAESTRO/mvp/03-first-run.yaml`).

- [X] T030 [P] [US2] Create `src/__tests__/noConnectScreenString.test.ts`. It reads every `.ts`/`.tsx` file under `src/` and every `.kt` file under `android/app/src/main/` with `fs`, and fails if any contains `Connect screen` (SC-003). It must pass after T010 and T020.
- [X] T031 [P] [US2] Create `src/navigation/fixTargets.ts` and `src/navigation/__tests__/fixTargets.test.ts`. The module exports `fixTargetFor(code): 'Repository' | 'Settings' | null` with exactly the mapping in research R5 (`REPOSITORY_NOT_CONFIGURED`, `CREDENTIAL_UNAVAILABLE`, `AUTH_FAILED`, `TLS_UNTRUSTED`, `SFTP_HOST_KEY_UNVERIFIED`, `SFTP_HOST_KEY_CHANGED` → `Repository`; `NO_SOURCES_SELECTED`, `GRANT_REVOKED` → `Settings`; everything else → `null`), and a `GoThereButton` component labelled `Go there`.
- [X] T032 [P] [US2] Add `configRevision` to the active snapshot in `KT/bridge/ScanOperations.kt` (from `SnapshotEntity.configRevision`), with a test in `KTEST/bridge/ScanOperationsTest.kt`. Parse it in `src/native/CloudSync.ts` with a test.
- [X] T033 [P] [US2] Create `src/setup/useSetupChecklist.ts` and `src/setup/__tests__/useSetupChecklist.test.tsx`. The hook derives `{repository: 'missing' | 'needsPassword' | 'ready', folders: 'none' | 'noneAvailable' | 'ready', resultsFromOldSettings: boolean}` exactly as in [data-model.md](./data-model.md#setup-checklist-js-derived-never-stored), re-reading on focus. Tests cover each value and that nothing is stored.
- [X] T034 [US2] Update `src/screens/ScanScreen.tsx` and `src/screens/__tests__/ScanScreen.test.tsx`:
  - a `Before you can scan` card listing `Set up the server` (→ `Repository`) and `Add a folder` (→ `Settings`) for each item not `ready`;
  - `Scan` disabled while either item is not ready (FR-007);
  - the notice `Results from previous server settings` with the text "These results were made with your previous server settings. Scan again." when `resultsFromOldSettings` (FR-010);
  - a `GoThereButton` next to any run or start error whose code has a fix target (FR-006).
- [X] T035 [US2] Update `src/screens/FilesScreen.tsx` and `src/screens/__tests__/FilesScreen.test.tsx`: the existing `No scan results yet` empty state gets the text "Results appear after a scan." and a `Go to Scan` button that navigates to the Scan tab (FR-008).
- [X] T036 [US2] Create `MAESTRO/mvp/03-first-run.yaml` as mapped (Story 2 rows) and add it to `flowsOrder`. It uses WebDAV through `subflows/setup-repository.yaml` and the existing `subflows/pick-folder.yaml` for `SyncScopeE2E/Gallery`, and ends with results visible in Files.

**Checkpoint**: US1 and US2 together give an adb-free path from install to results.

---

## Phase 5: User Story 4 — Install and run without a development machine (Priority: P1)

**Goal**: a release APK signed with the personal key, which allows the user-chosen cleartext and
contains no debug seams.

**Independent Test**: `pnpm e2e:android:release-smoke` installs the release APK with no Metro and
completes setup and a scan (`MAESTRO/mvp/90-release-smoke.yaml`).

- [X] T037 [US4] Add a script-contract test to `scripts/validation/validation-infrastructure.test.mjs` (after T004) that runs `android/gradlew -p android -q :app:printVersion --offline`. It parses `versionName=` and `versionCode=` and compares them with values computed from `package.json`'s `version` as in research R17 (`major * 10000 + minor * 100 + patch`). It also asserts that `android/app/build.gradle` no longer contains `versionName "1.0"` or `versionCode 1`. The test must fail until T038 (FR-022).
- [X] T038 [US4] Derive the version in `android/app/build.gradle` (research R17):
  - Read `../../package.json` with `groovy.json.JsonSlurper`.
  - Require `^(\d+)\.(\d+)\.(\d+)$`, with minor and patch < 100, else throw a `GradleException` naming `package.json`.
  - Set `versionName` to the version and `versionCode` to `major * 10000 + minor * 100 + patch`.
  - Register `tasks.register("printVersion")`, which prints `versionName=<v>` and `versionCode=<c>`.

  `pnpm test:foundation`, `pnpm assemble:debug` and `pnpm test:android:unit` must pass.
- [X] T039 [US4] Add script-contract assertions to `scripts/validation/validation-infrastructure.test.mjs` (after T004) that read `android/app/build.gradle` as text. The test must fail until T040.
  - `signingConfigs` defines `release` from the four `SYNCSCOPE_RELEASE_*` properties.
  - `buildTypes.release` uses `signingConfigs.release` and never `signingConfigs.debug`.
  - The release `manifestPlaceholders` set `usesCleartextTraffic: "true"`.
  - A `taskGraph.whenReady` check names `DEVELOPMENT.md` in its failure message.
- [X] T040 [US4] Edit `android/app/build.gradle` (research R8, R4):
  - Add `signingConfigs { release { … } }` reading `findProperty("SYNCSCOPE_RELEASE_STORE_FILE")` and the other three, set only when all four are present.
  - Set `buildTypes.release.signingConfig signingConfigs.release`.
  - Set `usesCleartextTraffic: "true"` in the release placeholders, with the comment "The user chooses the protocol; the form warns about unencrypted connections (D021)".
  - Add `gradle.taskGraph.whenReady { graph -> … }`, which throws a `GradleException` when any scheduled task's name contains `Release` and a property is missing. The message is: "Release signing is not configured. Set SYNCSCOPE_RELEASE_STORE_FILE, …_STORE_PASSWORD, …_KEY_ALIAS and …_KEY_PASSWORD in ~/.gradle/gradle.properties (DEVELOPMENT.md › Release key)."

  `pnpm assemble:debug` and `pnpm test:android:unit` must still pass with no properties set. `pnpm test:foundation` must pass.
- [X] T041 [US4] Add a "Release key" section to `DEVELOPMENT.md`. It covers:
  - the one-time `keytool -genkeypair -v -storetype PKCS12 -keystore ~/keys/syncscope-release.p12 -alias syncscope -keyalg RSA -keysize 4096 -validity 10000` command;
  - the four properties in `~/.gradle/gradle.properties`, or the `ORG_GRADLE_PROJECT_*` equivalents;
  - `pnpm assemble:release` and the APK path;
  - that losing the key forces an uninstall, which deletes the app's data, so back it up;
  - the `hermes-compiler` hoist and why it is needed for release bundling.
- [X] T042 [US4] Create `MAESTRO/mvp/90-release-smoke.yaml` (Story 4 row in the mapping) using `subflows/setup-repository.yaml` with SFTP, then add folder `SyncScopeE2E/Select`, scan, and results in Files. Add it to `flowsOrder` last, since it is valid on debug too. Run `pnpm e2e:android:release-smoke` after T043 and record the run in the PR.

- [X] T043 [US4] Create `MAESTRO/mvp/91-release-update.yaml` (Story 4 sc. 5). It uses `launchApp` without `clearState`, then asserts `Repository SFTP 10.0.2.2` in Settings and the results still visible in Files with no new scan. Add it to `flowsOrder` directly after `mvp/90-release-smoke`: in the debug workspace it proves the state survives a relaunch, and release-smoke step 7 runs it after the in-place `adb install -r`.

**Checkpoint**: the owner can install a self-contained APK and update it in place with the same key.

---

## Phase 6: User Story 5 — Select files and see how much space they take (Priority: P1)

**Goal**: multi-select in gallery and list view with an exact count and total size in the bottom-left
corner, and a selection bar that replaces the tabs.

**Independent Test**: `MAESTRO/mvp/04-select-size.yaml` against the Select fixture.

### Native

- [ ] T044 [US5] Add tests to `KTEST/persistence/SnapshotStoreTest.kt` for `selectableEntries(snapshotId, spec)`, with the same scope rules as `queryFiles` and `queryTreeChildren`:
  - gallery: images only, every filter;
  - list: direct `FILE` children of `parentId` in `sourceId` only;
  - directories never returned;
  - `pageSize`, `sort` and `search` ignored;
  - sizes `-1` for `NULL`.

  Add a budget case to `KTEST/persistence/SnapshotQueryPerformanceTest.kt`: 50 000 rows return in under 1 s on the JVM runner.
- [ ] T045 [US5] Implement T044. In `KT/persistence/Daos.kt`, add a `@RawQuery` selecting `entryId, sizeBytes, status, mimeType LIKE 'image/%'`, built by the same where-clause builder `SnapshotStore` uses for pages (extract it if needed, so the filter and view rules stay defined once). In `KT/persistence/SnapshotStore.kt`, add `selectableEntries`, returning four parallel arrays.
- [ ] T046 [US5] Implement `listSelectableEntries` in `KT/bridge/ScanOperations.kt`: `SNAPSHOT_NOT_FOUND` / `STALE_GENERATION` unless the snapshot is the active one; validate the query as `queryFiles` does; build the `selectable` envelope with `WritableArray`s. Wire it in `KT/bridge/CloudSyncModule.kt`, replacing the T014 stub, and add tests to `KTEST/bridge/ScanOperationsTest.kt` and `CloudSyncModuleTest.kt`.

### JS

- [ ] T047 [P] [US5] Add the `listSelectableEntries(snapshotId, query)` wrapper to `src/native/CloudSync.ts`, validating that the four arrays have equal length (else `INTERNAL_ERROR`) and mapping `-1` to `null`. Add tests.
- [ ] T048 [P] [US5] Create `src/selection/formatBytes.ts` and `src/selection/__tests__/formatBytes.test.ts`: decimal units `B, kB, MB, GB, TB` (1 kB = 1000 B), at most one decimal place, trailing `.0` dropped, locale separator via `Intl.NumberFormat`, `0` → `0 B`. Tests cover 0, 999, 1000, 1 234 567 and 1.2e9, plus a `de-DE` comma case.
- [ ] T049 [P] [US5] Create `src/selection/summary.ts` and `src/selection/__tests__/summary.test.ts`: `selectionSummary(items, view, filter) → {count, knownBytes, unknownSizeCount, hiddenByFilterCount}`, with the rules in [data-model.md](./data-model.md#selection-js-selectionprovider). "Hidden" means the status is not in the filter, or the item is not an image while in gallery view. Files in other list folders are not hidden.
- [ ] T050 [US5] Create `src/selection/SelectionProvider.tsx` (`useSelection()`) and `src/selection/__tests__/SelectionProvider.test.tsx`, with every transition in the data-model table:
  - long-press enters selection mode, tap toggles;
  - `selectAll(query)` merges the `listSelectableEntries` result;
  - clear, and leaving selection mode when the last item is removed;
  - kept across view and filter changes;
  - cleared, with a `notice` value, when `useScan`'s active `snapshotId` differs from the selection's;
  - `removeIds(ids)` for after a deletion.

  Mount it inside `FilesProvider` in `src/navigation/AppNavigator.tsx` (`FilesTab`).
- [ ] T051 [US5] Extend `src/files/a11y.ts` and `src/files/__tests__/a11y.test.ts`: tile and row labels take `selected: boolean` and append `, selected`; add builders for `Selection <n> selected, <size>` and `Selection details <text>`.
- [ ] T052 [US5] Update `src/files/GalleryTile.tsx` and `src/screens/GalleryScreen.tsx` with their tests:
  - `onLongPress` starts selection;
  - `onPress` toggles while selecting, and keeps its existing behaviour otherwise;
  - a check-circle overlay and `accessibilityState={{selected}}` on selected tiles (FR-017);
  - tile layout unchanged (`getItemLayout` stays valid).
- [ ] T053 [US5] Update `src/screens/ListScreen.tsx` and its test. File rows get the same long-press, toggle and selected state as tiles. Directory and source rows are never selectable, and tapping them navigates while the selection is kept (Story 5 scenario 7).
- [ ] T054 [US5] Create `src/selection/SelectionBar.tsx` and `src/selection/__tests__/SelectionBar.test.tsx`.
  - Bottom-left: `<n> selected · <formatBytes(knownBytes)>`, labelled `Selection <n> selected, <size>`.
  - A second line when non-zero: "<k> of unknown size", "<h> hidden by filter", labelled `Selection details …`.
  - Right: `Delete selected`, rendered only when an `onDelete` prop is given (wired in US6).
  - Bottom safe-area inset applied; themed styles only.
- [ ] T055 [US5] Update `src/screens/FilesScreen.tsx` and its test for selection mode:
  - `navigation.setOptions({tabBarStyle: {display: 'none'}, headerLeft: Clear selection ✕, headerRight: Select all})` while selecting, restored on exit;
  - `Select all` calls `selectAll` with the current view's query (gallery: the filter; list: the open folder's `sourceId` and `parentId`), disabled at the list's sources level;
  - `BackHandler` clears the selection while selecting;
  - render `SelectionBar`;
  - show the provider's snapshot-change notice as a snackbar: "Results were updated, so the selection was cleared."
- [ ] T056 [US5] Create `MAESTRO/mvp/04-select-size.yaml` as mapped (seam setup with SFTP, root `gallery`, source `SyncScopeE2E/Select`; assertions with `${SIZE_BEACH} B`, `${SIZE_SYNC_2} B` and `${SIZE_IMAGES_5} B`) and add it to `flowsOrder`.

**Checkpoint**: selection works in both views with exact count and size; Delete is not yet shown.

---

## Phase 7: User Story 6 — Safely delete selected files from the device (Priority: P1)

**Goal**: two-phase deletion with the server re-check (clarification 1), per-file outcomes, and results
updated without a rescan.

**Independent Test**: `MAESTRO/mvp/05-delete-synced.yaml` and the staged pairs 06 and 07 delete real
files, and only the ones that are safe to delete.

### Native: where matched files live on the server

- [ ] T057 [P] [US6] Extend `KTEST/scan/MatchIndexTest.kt`:
  - `add(entry, directory)` collects distinct directories per key;
  - more than 16 are capped at the first 16 in walk order;
  - `toRows` joins them with `\n`, and `fromRows` restores them;
  - non-regular entries add nothing;
  - `directoriesOf(nfcName, size, bucket)` returns `null` for a key from rows without `directories`.

  Then implement it in `KT/scan/MatchIndex.kt`, keeping `nfc` and `bucketOf` as the only definitions of the rules.
- [ ] T058 [US6] In `KT/scan/RemoteWalker.kt`, extract the retry policy into `internal suspend fun listWithRetry(session, directory, delay)` (same attempts and backoff) and pass the listed `directory` to `index.add(entry, directory)`. Update `KTEST/scan/RemoteWalkerTest.kt` to show that behaviour is unchanged and directories are recorded, and `KTEST/scan/ScanEngineTest.kt` to show staged match keys carry `directories`.

### Native: device-side delete

- [ ] T059 [P] [US6] Add to `KT/source/SafAccess.kt`:
  - `fun stat(documentUri: String): DocumentStat?` (size and modified time; `null` when absent);
  - `fun delete(documentUri: String): DeleteResult` (`DELETED`, `NOT_FOUND`, `DENIED`, `FAILED`) over `DocumentsContract.deleteDocument`.

  Implement both in `ContentResolverSafAccess` and `KTEST/source/FakeSafAccess.kt`, and test them in `KTEST/source/ContentResolverSafAccessTest.kt`.
- [ ] T060 [P] [US6] Create `KT/deletion/LocalDeleter.kt` and `KTEST/deletion/LocalDeleterTest.kt` (with `FakeSafAccess`). `deleteOne(row, sourceCanWrite) → DeletionOutcome` follows research R13 step by step:
  - no write grant → `ACCESS_LOST`;
  - `stat` null → `ALREADY_GONE`;
  - size or mtime differs → `CHANGED`, not deleted;
  - `delete` `DELETED` → `DELETED`;
  - `NOT_FOUND` plus `stat` null → `ALREADY_GONE`;
  - `DENIED` → `ACCESS_LOST`;
  - anything else → `FAILED`.

  One test per branch.

### Native: reflecting deletions in the snapshot

- [ ] T061 [US6] Add tests to `KTEST/persistence/SnapshotStoreTest.kt` for `recordDeletions(snapshotId, outcomes)` ([data-model.md](./data-model.md#deletion-write-rule-snapshotstorerecorddeletionssnapshotid-outcomes)):
  - only `DELETED` and `ALREADY_GONE` remove rows;
  - `snapshot_counts` and every ancestor's `descSynced`/`descUnsynced`/`descUnknown` are decremented by status, and pre-v3 `NULL` counts stay `NULL`;
  - one `local_deletion_overlay` row per removal with that state;
  - after random batches, the invariant holds (directory counts equal the remaining rows beneath by status, and `snapshot_counts` equals a `GROUP BY`);
  - a failure mid-batch rolls the whole batch back.
- [ ] T062 [US6] Implement T061: decrement queries in `KT/persistence/Daos.kt` and `@Transaction suspend fun recordDeletions` in `KT/persistence/SnapshotStore.kt`. Batches are at most 100 outcomes; the caller chunks.

### Native: re-check, plans and execution

- [ ] T063 [US6] Create `KTEST/deletion/DeletionRecheckTest.kt`, with a fake `RemoteClient` whose `list` returns scripted entries or throws, and a scripted `connect`. It covers:
  - a confirmed key stays `toDelete`;
  - a key whose stored directory now lacks the file goes to `unsynced`, `GONE_FROM_SERVER`;
  - a different size or bucket in the listing counts as gone;
  - a directory throwing `REMOTE_ROOT_NOT_FOUND` / `DIRECTORY_UNREADABLE` (404) counts as gone;
  - a directory failing with any other code puts the row in `refused`, `RECHECK_FAILED`, unless another of its directories confirms;
  - `directories == null` → `refused`, `SCAN_TOO_OLD`;
  - each directory is listed exactly once for many rows;
  - a connect failure (`AUTH_FAILED`, `CONNECTION_*`, `TLS_UNTRUSTED`, a host-key challenge) aborts with that code and no result;
  - `movedByRecheck` counts both moves;
  - SC-005: with the stored password `s3cret-Log-Probe`, no `ShadowLog` entry contains it after a re-check, including a failing one.
- [ ] T064 [US6] Implement T063 in `KT/deletion/DeletionRecheck.kt` (research R12, step 4). Use `MatchIndex.nfc`, `MatchIndex.bucketOf`, the snapshot's precision (`SnapshotStore.precisionOf`) and `listWithRetry` from T058. Open one session through `RemoteClientFactory` with the repository's `RemoteConfig` and the credential loaded as `RepositoryOperations.test` does, extracting a shared `connectRepository()` if that avoids duplication. Close the session and wipe the password in `finally`. Log only codes and counts, never the password, host, user or a remote path (D011, SC-005).
- [ ] T065 [US6] Create `KTEST/deletion/DeletionOperationsTest.kt` (fake store, recheck, deleter and clock). It covers:
  - **prepare refusals**: not the active snapshot → `STALE_GENERATION`; `configRevision` ≠ `revision` → `REPOSITORY_CHANGED`; busy → `SCAN_IN_PROGRESS`; empty IDs → `INVALID_QUERY`;
  - **grouping**: UNKNOWN rows → `refused`; UNSYNCED rows → `unsynced`; directories and unknown IDs → `missing`;
  - **totals**: `bytes` sum known sizes only;
  - **plan lifecycle**: a new prepare replaces the plan; a token older than `MAX_DELETION_PLAN_AGE_MILLIS` → `PLAN_NOT_FOUND`; a reused token → `PLAN_NOT_FOUND`; the active snapshot moved → `PLAN_STALE`;
  - **execute**: `includeUnsynced=false` never attempts `unsynced` rows; `refused` rows are never attempted; outcomes are committed in chunks of 100 through `recordDeletions`; `freedBytes` counts `DELETED` known sizes only; `failures` lists every attempted non-deleted row; `removedEntryIds` lists `DELETED` + `ALREADY_GONE`;
  - **exclusivity**: prepare and execute run inside `runExclusive`.
- [ ] T066 [US6] Implement T065 in `KT/deletion/DeletionOperations.kt`: an in-memory single plan with a random UUID token and the fields of the data-model "Deletion plan" table. Build the `plan` and `result` envelopes in `KT/bridge/CloudSyncEnvelope.kt` exactly as in [contracts/cloudsync-mvp.md](./contracts/cloudsync-mvp.md). No document URI or remote path goes into any envelope.
- [ ] T067 [US6] Wire `prepareLocalDeletion` and `executeLocalDeletion` in `KT/bridge/CloudSyncModule.kt` (replacing the T014 stubs) over one `DeletionOperations` built lazily on the background dispatcher like `coordinatorHolder`. Update the class doc comment, since no method is `NOT_IMPLEMENTED` now except `getSettings` and `setIncludeHidden`. Add module tests to `KTEST/bridge/CloudSyncModuleTest.kt`.
- [ ] T068 [P] [US6] In `src/scan/ScanProvider.tsx`, treat a `DELETION_IN_PROGRESS` reply to the app-open `LOCAL_REFRESH` as "skip this time" (no error shown), with a test in `src/scan/__tests__/useScan.test.tsx`.

### JS

- [ ] T069 [P] [US6] Add the `prepareLocalDeletion(snapshotId, entryIds)` and `executeLocalDeletion(planToken, includeUnsynced)` wrappers to `src/native/CloudSync.ts`, validating every DTO field. Add tests.
- [ ] T070 [US6] Create `src/selection/DeleteFlow.tsx` and `src/selection/__tests__/DeleteFlow.test.tsx`. It is a Paper dialog sequence:
  1. **Checking**: `Checking files on the server` with an indeterminate indicator while prepare runs.
  2. **Prepare error**: the message, the action, `Retry` and a `GoThereButton` when the code has a target. No confirmation is shown.
  3. **Confirmation**:
     - `Delete <n> backed-up files, <size>`;
     - `Not backed up <n>` with the checkbox `Also delete files that are not backed up`; ticking it shows `Confirm not backed up` ("These files exist only on this phone. Deleting them cannot be undone."), which must be tapped before `includeUnsynced` becomes true;
     - `Never deleted <n>` ("Their backup state is unknown"), plus `scanTooOld` text "Scan again to delete these" when non-zero;
     - `Moved by server check <n>` when non-zero;
     - `Scan age <text>`, with the existing staleness hint when older than `STALE_REMOTE_LISTING_MILLIS`;
     - the permanence note "Deleted files cannot be recovered.";
     - `Delete`, disabled when nothing would be deleted; `Cancel`.
  4. **Deleting**: "Deleting <n> files…".
  5. **Result**: `Deleted <n> files, freed <size>` and one `Could not delete <name>: <reason>` line per failure, with reason texts from one map.

  `PLAN_STALE` / `PLAN_NOT_FOUND` return to the checking step after "Review again". Tests cover every branch, including that `Delete` passes `includeUnsynced` only after both confirmations.
- [ ] T071 [US6] Wire deletion into `src/screens/FilesScreen.tsx` and `src/selection/SelectionBar.tsx`: pass `onDelete` to open `DeleteFlow` with the selection's IDs and `snapshotId`. On a result, call `removeIds(result.removedEntryIds)` and reload the current view from page 1, keeping the folder and filter (reuse the `usePagedQuery` reset used for snapshot changes). Update both tests.

### End-to-end

- [ ] T072 [US6] Create `MAESTRO/mvp/05-delete-synced.yaml` exactly as mapped (both halves; the second half edits the root to `gallery` through `Edit repository`, then `Rescan from scratch`) and add it to `flowsOrder`.
- [ ] T073 [US6] Create `MAESTRO/staged/06-recheck-removed-a.yaml` (clearState, seam setup with SFTP, root `recheck`, source `SyncScopeE2E/Recheck`, scan) and `MAESTRO/staged/06-recheck-removed-b.yaml` (assertions as mapped). Add the line `staged/06-recheck-removed-a.yaml|remove-recheck-file.sh|staged/06-recheck-removed-b.yaml` to `MAESTRO/staged/pairs.txt`.
- [ ] T074 [US6] Create `MAESTRO/staged/07-delete-offline-a.yaml` (clearState, seam setup with SFTP, root `gallery`, source `SyncScopeE2E/Offline`, scan), `-b.yaml` (select `beach.png` → `Delete selected` → the CONNECTION_* error with `Retry`, and no confirmation) and `-c.yaml` (`Rescan from scratch` → `beach.png, Synced` still listed, so zero files were deleted). Add the line `staged/07-delete-offline-a.yaml|pause-service.sh sftp|staged/07-delete-offline-b.yaml|resume-service.sh sftp|staged/07-delete-offline-c.yaml` to `MAESTRO/staged/pairs.txt`.

- [ ] T075 [US6] Create `MAESTRO/staged/08-changed-a.yaml` (clearState, seam setup with SFTP, root `gallery`, source `SyncScopeE2E/Changed`, scan, select `beach.png` and `sunset.png`, `Delete selected`, then wait for `Delete 2 backed-up files` and end with the dialog open) and `MAESTRO/staged/08-changed-b.yaml` (no `launchApp`, no `clearState`: tap `Delete` → `Deleted 0 files`, `Could not delete beach.png: Already gone`, `Could not delete sunset.png: Changed since the scan`; then `Rescan from scratch` → `sunset.png` still listed). Add the line `staged/08-changed-a.yaml|change-device-files.sh|staged/08-changed-b.yaml` to `MAESTRO/staged/pairs.txt` (Story 6 sc. 6).

**Checkpoint**: the whole MVP loop works: set up, scan, select, see the size, delete safely.

---

## Phase 8: User Story 3 — Pick folders Android allows (Priority: P2)

**Goal**: the user knows which folders Android refuses, and the picker starts in DCIM.

**Independent Test**: the hint and the DCIM start, asserted in `MAESTRO/mvp/03-first-run.yaml`.

- [ ] T076 [P] [US3] In `KT/source/SourcePicker.kt`, when `regrantSourceId == null`, put `EXTRA_INITIAL_URI = DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:DCIM")`. Re-grants keep the source's own URI. Add both cases to `KTEST/source/SourcePickerTest.kt`.
- [ ] T077 [P] [US3] In `src/sources/SourcesSection.tsx`, show the hint `Folder picker hint` with the text "Android does not allow the top level of the storage or the Download folder. Pick a folder such as DCIM or Pictures." above the add button. Add a test in `src/sources/__tests__/`.
- [ ] T078 [US3] Extend `MAESTRO/mvp/03-first-run.yaml` (after T036): assert `Folder picker hint` before tapping add, and assert the DocumentsUI header shows `DCIM` with a regex when the picker opens.

- [ ] T079 [US3] Extend `MAESTRO/sources/06-regrant.yaml` (feature 003): when the re-grant picker opens, assert that the DocumentsUI header shows the source's folder name and not `DCIM` (Story 3 sc. 3), so the DCIM start never applies to re-grants.

**Checkpoint**: all six stories are done.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T080 [P] Write the decision records in `docs/decisions/`, following the existing format, and update `docs/decisions/README.md`:
  - `0020-pre-delete-server-recheck.md` (research R11, R12, clarification 1);
  - `0021-release-signing-and-cleartext-policy.md` (R4, R8, clarification 2);
  - a dated "Amendment 2026-10-02" in `0008-two-phase-local-deletion.md` (the `includeUnsynced` argument and row removal with the overlay as audit, R13 and R14);
  - an update to `0018-debug-repository-seam.md` (the Connect screen exists, and the seam stays for non-setup flows).
- [ ] T081 [P] Update the docs pages:
  - `docs/architecture.md`: the root stack, the `deletion` package, the delivery list (no `NOT_IMPLEMENTED` deletion methods), schema version 4 and contract version 5;
  - `docs/sync-and-deletion-safety.md`: the re-check, per-file outcomes, what is never deleted, and that folders are never removed;
  - `docs/protocols.md`: replace "Known limit" with WebDAV HTTPS and `TLS_UNTRUSTED`, and the re-check's list-only access;
  - `docs/overview.md`.
- [ ] T082 [P] Update `README.md` (Principle VIII). User sections lead the page: "Install the app" (APK, unknown sources), "Set up your server" (protocols, the unencrypted warning, SFTP key check), "Pick folders" (the Android restriction), and "Free up space safely" (select, size, server check, what is never deleted, permanence).
- [ ] T083 [P] Update `DEVELOPMENT.md` › End-to-end flows: the new fixtures, the `staged/` pairs and hooks, `pnpm e2e:android:release-smoke`, the `mvp/` flows and the `SIZE_*` variables.
- [ ] T084 [P] Add the four `Unreleased` entries listed in plan.md (Constitution Check VI) to `CHANGELOG.md`.
- [ ] T085 Extend the accessibility sweep `src/test-utils/a11ySweep.ts` usage to `RepositoryScreen`, `RepositorySection`, `SelectionBar` and `DeleteFlow`, so every pressable has a label.
- [ ] T086 Apply the spec follow-ups: in `specs/009-full-loop-release/spec.md`, note that the release-smoke mode and WebDAV HTTPS ship in 006 and that retention must keep the active snapshot's match keys (FR-004's move to 006 FR-022 is already recorded there). Confirm `specs/007-tree-view-image-preview/spec.md` still matches the integration closure in plan.md.
- [ ] T087 Run the exit gate from [quickstart.md](./quickstart.md#1-automated-gates): `pnpm lint`, `pnpm typecheck`, `pnpm test:ci`, `pnpm test:android:unit`, `pnpm e2e:android` (API 31 and API 36: the 006 flows must pass on both), `pnpm e2e:android:release-smoke`, and `pnpm validation:services:stop` with the audit clean. Fix anything that fails, then do the manual walk-through in quickstart §3 on a real device.

---

## Dependencies & Execution Order

### Phases

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup (T009 for navigation types). Blocks every story.
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 4)**: after Phase 2. T034 uses the Repository route from T023, and T036 uses
  `subflows/setup-repository.yaml` from T028, so in practice it comes after US1.
- **US4 (Phase 5)**: after Phase 2. T042 uses the T028 subflow.
- **US5 (Phase 6)**: after Phase 2.
- **US6 (Phase 7)**: after US5 (selection, SelectionBar) and US1 (a saved repository, connection helper).
- **US3 (Phase 8)**: after Phase 2. T078 after T036.
- **Polish (Phase 9)**: after the stories it documents. T087 last.

### Within phases (beyond test-before-implementation)

- T001 → T002, T003. T004 → T005–T007.
- T010 → T011 (same files). T012, T013 → T014.
- T015/T016 → everything native in US6.
- T017 → T018 → T020, T066.
- T057 → T058 → T064.
- T059 → T060.
- T061 → T062 → T066.
- T063 → T064 → T066 → T067.
- T050 → T052–T055 → T071.
- T069 + T070 → T071.
- T004 → T037 → T038 → T039 → T040 (version and signing share `build.gradle`).
- T042 → T043. T005 + T070 → T075. T076 → T079.

### Story completion order

US1 → US2 → US4 can proceed in parallel with US5. US6 needs US1 and US5. US3 can be done any time after
Phase 2.

## Parallel Examples

**Phase 1**: T005, T008 and T009 together (after T004 for T005).

**US1**: T019, T021, T022, T024 and T025 at once (different files). Then T020, T023, T026, T027.

**US2**: T030, T031, T032 and T033 at once, then T034 and T035.

**US5**: T047, T048 and T049 at once while T044/T045 run on the native side.

**US6**: T057, T059 and T060 at once. Then T061/T062 and T063/T064 in parallel. Then T065–T067. On the JS
side, T068 and T069 run in parallel with the native work.

**Polish**: T080–T084 at once.

## Implementation Strategy

1. **First usable increment (US1 + US2)**: Phases 1–4 give a debug build in which a person sets up the
   server and reaches results without adb. Validate with flows 01–03.
2. **Installable (US4)**: Phase 5 makes it a self-contained APK. Install it on the real device (quickstart
   §2).
3. **Select (US5), then delete (US6)**: Phases 6–7 deliver the payoff. US6 is the highest-risk part (an
   irreversible action), so its JVM tests (T061, T063, T065) land and pass before any wiring task.
4. **Picker guidance (US3)**: Phase 8, a small P2 polish.
5. **Docs and the full gate**: Phase 9.

Commit after each task or tight group, as in features 002–005. Stop at any checkpoint to validate the
story on its own.
