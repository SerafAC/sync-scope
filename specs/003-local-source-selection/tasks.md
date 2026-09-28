---

description: "Task list for feature 003: Local Source Selection via SAF"
---

# Tasks: Local Source Selection via SAF

**Input**: Design documents from `/specs/003-local-source-selection/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/cloudsync-sources.md](./contracts/cloudsync-sources.md),
[contracts/maestro-conventions.md](./contracts/maestro-conventions.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle IV (unit tests for all code, same change) and Principle V
(every acceptance scenario of the P1 story maps to a named Maestro flow on API 31 and API 36). Each test
task sits next to the implementation it verifies. Write the test first and make sure it fails.

**Organization**: the spec has one user story (US1, P1). Shared contract and pure-logic work that every
part of US1 builds on is in Phase 2; the story itself is split into sub-phases (native → JS → e2e) with
checkpoints.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task belongs to (US1)
- Paths are relative to the repository root. Kotlin package root:
  `android/app/src/main/java/com/syncscope/` (abbreviated `KT/`), JVM tests:
  `android/app/src/test/java/com/syncscope/` (abbreviated `KTEST/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the emulator, fixture and Maestro scaffolding the e2e proof depends on. No production code.

- [ ] T001 Provision the API 36 validation AVD `dependency_api36` from `system-images;android-36;google_apis;x86_64` with `hw.sdCard = yes` and `sdcard.size = 512 MB` (the same SD card settings as the existing `dependency_api31`, research R10); boot it once, run `adb shell sm list-volumes public` and record whether a public removable volume appears (the observed R10 result) in `specs/003-local-source-selection/research.md` under R10. If no public volume appears, stop and escalate to the user (R10 failure behaviour: never skip).
- [ ] T002 [P] Add a contract test for `scripts/validation/device-fixtures.sh` in `scripts/validation/validation-infrastructure.test.mjs`, in the style of the existing script assertions: the script exists and is executable, uses `set -eu`, takes the target device from `ANDROID_SERIAL`, discovers the removable volume with `sm list-volumes public`, creates `SyncScopeE2E/Camera` and `SyncScopeE2E/Camera/Nested` on primary storage and `SyncScopeE2E/Camera` on the removable volume, and is idempotent (uses `mkdir -p`, overwrites the fixture file). It must fail until T003 lands.
- [ ] T003 Create `scripts/validation/device-fixtures.sh` (research R12): via `adb shell`, create `/sdcard/SyncScopeE2E/Camera/` and `/sdcard/SyncScopeE2E/Camera/Nested/` with one small file each, find the removable volume UUID with `sm list-volumes public` and create `/storage/<UUID>/SyncScopeE2E/Camera/` with one small file; exit non-zero with a clear message when no public volume is mounted (R10: fail loudly). Idempotent. Make T002 pass (`pnpm test:foundation`).
- [ ] T004 Wire fixtures into e2e mode in `scripts/validation/android-flow.sh`: in the `e2e` branch, run `scripts/validation/device-fixtures.sh` for each API level after the APK install and before `maestro test "$repo/validation/maestro"`; extend `scripts/validation/validation-infrastructure.test.mjs` to assert that ordering.
- [ ] T005 [P] Create the Maestro layout per [contracts/maestro-conventions.md](./contracts/maestro-conventions.md): `validation/maestro/config.yaml` with `executionOrder.flowsOrder` listing `sources/01-add-internal` … `sources/07-remove` in order and `continueOnFailure: false`, plus empty directories `validation/maestro/subflows/` and `validation/maestro/sources/` (flow files are added in Phase 3).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract version 2 surface and the pure, device-free rules that the native operations,
the JS layer and the enumerator all depend on.

**⚠️ CRITICAL**: no Phase 3 work can begin until this phase is complete.

### Contract version 2 (TS and Kotlin in lockstep, parity-guarded)

- [ ] T006 Bump the contract to version 2 on both sides in one change: in `src/native/CloudSyncContracts.ts` set `CLOUD_SYNC_CONTRACT_VERSION = 2` and in `KT/bridge/CloudSyncContracts.kt` set `CONTRACT_VERSION = 2`; insert the five new error codes `SOURCE_OVERLAP`, `SOURCE_UNSUPPORTED`, `SOURCE_REGRANT_MISMATCH`, `SOURCE_NOT_FOUND`, `PICKER_BUSY` **in that order, just before `INTERNAL_ERROR`** in both the TypeScript and Kotlin lists, each with the exact message and action from the "New error codes" table in [contracts/cloudsync-sources.md](./contracts/cloudsync-sources.md) (e.g. `SOURCE_OVERLAP`: "This folder overlaps a folder you already added." / "Pick a folder that is not inside, or around, an existing one."). Update `KTEST/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts` expectations in the same task.
- [ ] T007 Add the source DTOs to `src/native/CloudSyncContracts.ts` exactly as in the contract: `SourceAvailability = 'AVAILABLE' | 'GRANT_REVOKED' | 'STORAGE_MISSING'`; `SourceDto {sourceId, alias, volumeLabel, displayPath, isRemovable, canWrite, addedAtMillis, availability}`; `ListSourcesOk`/`ListSourcesResult`; `SourcePickerOutcome = 'ADDED' | 'REGRANTED' | 'CANCELLED'`; `LaunchSourcePickerOk {contractVersion, status: 'ok', outcome, source: SourceDto | null}` ("null only when outcome is CANCELLED")/`LaunchSourcePickerResult`; and the optional error field `conflictingSource?: {sourceId: string; alias: string} | null` ("present on SOURCE_OVERLAP only"), next to `hostKeyChallenge`. `treeUri` and `canonicalRoot` MUST NOT appear in any DTO.
- [ ] T008 Change the Codegen spec in `src/native/specs/NativeCloudSync.ts` to `launchSourcePicker(regrantSourceId?: string | null): Promise<OperationResultDto>`; update `KT/bridge/CloudSyncModule.kt` to the new generated signature `launchSourcePicker(regrantSourceId: String?, promise: Promise)` (still `notImplemented` for now so the build stays green); update `src/native/__tests__/NativeCloudSyncBoundary.test.ts` for the new parameter.
- [ ] T009 Extend the error envelope in `KT/bridge/CloudSyncEnvelope.kt` with an optional structured `conflictingSource {sourceId, alias}` field written only for `SOURCE_OVERLAP`, following the `hostKeyChallenge` precedent so the alias never passes through message redaction (D011); add cases to `KTEST/bridge/CloudSyncEnvelopeTest.kt` (present on `SOURCE_OVERLAP`, absent on every other code, alias not redacted).

### Pure source rules (JVM, no I/O)

- [ ] T010 [P] Write `KTEST/source/SourceTreeTest.kt` first: tree document ID `primary:DCIM/Camera` → `volumeId = primary`, `documentPath = DCIM/Camera`; trailing slashes trimmed; volume root → empty `documentPath`; `canonicalRoot = "<authority>/<volumeId>:<documentPath>"`; overlap cases — equal paths overlap, `DCIM` overlaps `DCIM/Camera` (both directions), `DCIM` does **not** overlap `DCIM2`, a volume root overlaps every path on its volume, different `volumeId` never overlaps; case is kept as returned (no case folding); authority other than `com.android.externalstorage.documents` is reported as unsupported (V1).
- [ ] T011 [P] Implement `KT/source/SourceTree.kt` (research R3): a pure parser from authority + tree document ID (callers get the ID via `DocumentsContract.getTreeDocumentId`) to `volumeId`, `documentPath` ("Path within the volume without leading or trailing `/`. Empty for a volume root.") and `canonicalRoot`; `overlaps(a, b)` per V2 ("for every existing row with the same `authority` and `volumeId`, neither `documentPath` may equal the other or be its prefix at a `/` boundary. An empty path (a volume root) overlaps every path on its volume."); `isSupportedAuthority` accepting only `com.android.externalstorage.documents`. Make T010 pass.
- [ ] T012 [P] Write `KTEST/source/SourceAliasTest.kt` first: first unique form wins — folder name; volume label for a volume root; `"<name> (<volume label>)"`; `"<name> (<volume label>, <parent>)"`; then `"<grandparent>/<parent>"` and further segments until unique; uniqueness is case-insensitive (`camera` collides with `Camera`); two `Camera` folders on primary and SD produce `Camera` and `Camera (SDCARD)`; the walk always terminates for distinct `canonicalRoot` values.
- [ ] T013 [P] Implement `KT/source/SourceAlias.kt` (research R6, FR-004): pure `generate(candidate, existingAliases): String` making T012 pass. The alias is "Generated once, unique case-insensitively, never edited or recomputed" — the function has no update path.

### Seam and persistence

- [ ] T014 [P] Create `KT/source/SafAccess.kt` (research R9): interface `SafAccess { persistedGrants(); takeGrant(uri); releaseGrant(uri); rootExists(uri); volumeLabel(volumeId) }` plus the production implementation over `ContentResolver` (`takePersistableUriPermission`/`releasePersistableUriPermission`/`persistedUriPermissions`, root-document query with an explicit projection) and `StorageManager.storageVolumes` (`StorageVolume.getDescription`; "Removable storage" when the volume is not mounted). `releaseGrant` swallows `SecurityException`. Keep the production class thin. Constitution Principle IV still requires it to be unit-tested: write `KTEST/source/ContentResolverSafAccessTest.kt` (Robolectric) first, covering `rootExists` false when the root query throws or returns no row, `volumeLabel` falling back to "Removable storage" for an unmounted `volumeId`, and `releaseGrant` swallowing `SecurityException`.
- [ ] T015 [P] Write `KTEST/persistence/SourceRootDaoTest.kt` first (Robolectric in-memory Room, reuse `KTEST/persistence/PersistenceTestFixtures.kt`): `deleteWithScanData(sourceId)` removes, for that source only, `local_deletion_overlay` rows whose `localEntryId` is one of the source's `local_node.entryId`, `remote_ambiguity` rows, `snapshot_counts` rows, `local_node` rows and the `source_root` row; another source's rows, snapshots and match keys are untouched; a failure mid-way rolls everything back; `byCanonicalRoot` finds an exact match.
- [ ] T016 Add to `SourceRootDao` in `KT/persistence/Daos.kt` (research R7, data-model "Removal cascade"): `@Transaction open suspend fun deleteWithScanData(sourceId: String)` deleting in this order — (1) `local_deletion_overlay` by the source's `local_node.entryId`s, (2) `remote_ambiguity` by `sourceId`, (3) `snapshot_counts` by `sourceId`, (4) `local_node` by `sourceId` ("their foreign key to `source_root` has no cascade"), (5) the `source_root` row — plus a `byCanonicalRoot(canonicalRoot)` query. No schema change: `SyncScopeDatabase` stays at version 1 and `android/app/schemas/.../1.json` is unchanged. Make T015 pass.

**Checkpoint**: `pnpm typecheck`, `pnpm test:ci` and `pnpm test:android:unit` pass with contract v2; the
three methods still resolve `NOT_IMPLEMENTED`.

---

## Phase 3: User Story 1 - Choose the local folders to check (Priority: P1) 🎯 MVP

**Goal**: the user adds folders (internal and SD card) through the system picker in Settings › Folders;
sources persist across restart, show Available / Access lost / Storage missing, can be re-granted (same
folder only) or removed after confirmation; overlapping picks are rejected naming the conflicting source.

**Independent Test**: `pnpm e2e:android` runs `validation/maestro/sources/01…07` green on API 31 and API 36
(SC-001, SC-002), mapped per [contracts/maestro-conventions.md](./contracts/maestro-conventions.md#acceptance-scenario-mapping).

### 3a. Native operations (Kotlin)

- [ ] T017 [P] [US1] Write `KTEST/source/SourceOperationsTest.kt` first, with a fake `SafAccess` and in-memory Room: **list** — rows ordered by `addedAtMillis` ascending, empty list → `sources: []`, availability evaluated in R5 order (no persisted read grant matching `treeUri` → `GRANT_REVOKED`; grant present but `rootExists` false → `STORAGE_MISSING`; else `AVAILABLE`), `volumeLabel`/`displayPath`/`isRemovable = volumeId != "primary"` mapped per data-model SourceDto; with 20 sources, one `list()` calls `persistedGrants()` exactly once and `rootExists` at most once per source (plan Performance Goals: "one grant lookup and one root query per source"); **add** — new UUID `sourceId`, generated alias, `canWrite` from the grant, grant taken; unsupported authority → `SOURCE_UNSUPPORTED`; overlap → `SOURCE_OVERLAP` with `conflictingSource` = the first conflicting row; every rejection persists nothing and releases the grant just taken; **re-grant** — unknown id → `SOURCE_NOT_FOUND` (before any pick); same `canonicalRoot` → `REGRANTED`, only `treeUri` and `canWrite` refreshed, `sourceId`/`alias`/`addedAtMillis` kept; different folder → `SOURCE_REGRANT_MISMATCH`, row unchanged, new grant released; a different folder that also overlaps *another* source still gives `SOURCE_REGRANT_MISMATCH` (re-grant checks V1 then V3 and never V2, data-model "Validation rules"); **remove** — cascade called, grant released after commit, works when the grant is already gone, unknown id → `SOURCE_NOT_FOUND`.
- [ ] T018 [US1] Implement `KT/source/SourceOperations.kt` (constructor takes `SafAccess`, `SourceRootDao` and a clock/UUID source, like `RepositoryOperations` takes its factories): `list()`, `onPicked(treeUri, regrantSourceId?)` and `remove(sourceId)`. Put the R5 availability evaluation (grant lookup, then root query) in its own file, `KT/source/SourceAvailability.kt`, as the single implementation that `SourceOperations` and `LocalSourceEnumerator` (T024) both call (Principle III). Operations return the envelope-ready results described in [contracts/cloudsync-sources.md](./contracts/cloudsync-sources.md) "Behaviour" (validation rules V1–V4 from data-model.md; "A pick rejected by V1–V3 persists nothing, and the grant just taken is released"). Make T017 pass.
- [ ] T019 [P] [US1] Write `KTEST/source/SourcePickerTest.kt` first (Robolectric): the single-slot pending promise — a second launch while one is pending resolves `PICKER_BUSY`; no current activity resolves `PICKER_BUSY`; `RESULT_CANCELED` or null data resolves `CANCELLED` with `source: null` and persists nothing; a re-grant launch sets `EXTRA_INITIAL_URI` to the source's tree URI; an unrelated request code is ignored; the slot is cleared after every outcome.
- [ ] T020 [US1] Implement `KT/source/SourcePicker.kt` (research R1): build `Intent.ACTION_OPEN_DOCUMENT_TREE` with read/write persistable flags, start it with `currentActivity.startActivityForResult`, receive the result through an `ActivityEventListener` registered on the `ReactApplicationContext`, hold the pending promise in a single slot, and hand the picked URI to `SourceOperations.onPicked`. Make T019 pass.
- [ ] T021 [US1] Wire the three methods in `KT/bridge/CloudSyncModule.kt`: replace `notImplemented` for `listSources`, `launchSourcePicker(regrantSourceId, promise)` (check `SOURCE_NOT_FOUND` before opening the picker) and `removeSource(sourceId, promise)` with `runOperation` calls into `SourceOperations`/`SourcePicker`; construct `SafAccess`/`SourceOperations`/`SourcePicker` lazily with the existing `memoize` pattern; register and unregister the `ActivityEventListener` in init/`invalidate()`; update the KDoc that lists unimplemented methods.
- [ ] T022 [US1] Update `KTEST/bridge/CloudSyncModuleTest.kt`: the three methods no longer resolve `NOT_IMPLEMENTED`; each resolves (never rejects) the envelope shapes from the contract, using `KTEST/bridge/RecordingPromise.kt` and a fake `SafAccess`; `getContractVersion` resolves 2.
- [ ] T023 [P] [US1] Write `KTEST/source/LocalSourceEnumeratorTest.kt` first (Robolectric fake `DocumentsProvider` or fake cursor source): an unavailable source (`GRANT_REVOKED` or `STORAGE_MISSING`) returns `Skipped(reason)` and **never** `Available` with an empty sequence (FR-003); an available source yields every file and directory breadth-first and lazily with `documentId`, `parentDocumentId` (null for direct children of the root), `name`, `isDirectory`, `isHidden` ("name starts with `.`"), `mimeType`, `sizeBytes` ("null for directories"), `modifiedUtcMillis` ("null when the provider reports 0 or nothing"); hidden entries are returned, not filtered; one child query per directory.
- [ ] T024 [US1] Implement `KT/source/LocalSourceEnumerator.kt` (research R8, data-model "LocalFile and SourceListing"): `interface LocalSourceEnumerator { fun enumerate(source: SourceRootEntity): SourceListing }`, the sealed `SourceListing = Available(files: Sequence<LocalFile>) | Skipped(reason)`, `data class LocalFile`, and the production implementation using `DocumentsContract.buildChildDocumentsUriUsingTree` with an explicit projection and the R5 availability check from `KT/source/SourceAvailability.kt` (created in T018; do not duplicate it, Principle III). Make T023 pass.

**Checkpoint**: `pnpm test:android:unit` green; the native side is complete and independently tested.

### 3b. JS wrappers and presentation

- [ ] T025 [P] [US1] Write tests first in `src/native/__tests__/CloudSync.test.ts`: `listSources()`, `launchSourcePicker(regrantSourceId?)` and `removeSource(sourceId)` normalise plain Codegen objects into `ListSourcesResult`, `LaunchSourcePickerResult` and `OperationResult` (ok and error, `conflictingSource` carried through on `SOURCE_OVERLAP`, `source: null` on `CANCELLED`), like the existing `normalizePageResult` tests.
- [ ] T026 [US1] Implement the three wrappers in `src/native/CloudSync.ts`, each normalising into its discriminated result type. Presentation code calls only these wrappers. Make T025 pass.
- [ ] T027 [P] [US1] Write `src/sources/__tests__/useSources.test.ts` first (mock `src/native/CloudSync.ts`): loads on mount; reloads when `AppState` becomes `active` (a grant lost in the background shows without restart, R5); `add()` → `launchSourcePicker()` then refresh, `CANCELLED` leaves the list unchanged and shows no error; `regrant(sourceId)` → `launchSourcePicker(sourceId)`; `remove(sourceId)` → `removeSource(sourceId)` then refresh; error envelopes are exposed as `{code, message, action, conflictingSource}` for the snackbar.
- [ ] T028 [US1] Implement `src/sources/useSources.ts` making T027 pass (loading, refresh on foreground, the three actions, last error).
- [ ] T029 [P] [US1] Write `src/sources/__tests__/SourcesSection.test.tsx` first (Testing Library, mocked `useSources`): each row shows alias, volume label and folder path with testIDs `sources.row`, `sources.row.alias`, `sources.row.status`; the status chip reads "Available", "Access lost" or "Storage missing"; `sources.row.regrant` appears only when not `AVAILABLE`; `sources.row.remove` opens a Paper `Dialog` and only `sources.dialog.confirm` calls `remove` (`sources.dialog.cancel` changes nothing, FR-005); `sources.add` calls `add`; an error shows in a `Snackbar` with testID `sources.error`, and for `SOURCE_OVERLAP` the text names the conflicting source's alias.
- [ ] T030 [US1] Implement `src/sources/SourcesSection.tsx` (research R14) with React Native Paper, using exactly the testIDs from [contracts/maestro-conventions.md](./contracts/maestro-conventions.md#selectors). Make T029 pass.
- [ ] T031 [US1] Create `src/screens/SettingsScreen.tsx` hosting a "Folders" section that renders `SourcesSection`, and change `src/navigation/AppNavigator.tsx` so the Settings tab renders `SettingsScreen` instead of `PlaceholderScreen` (drop the Settings placeholder text); add `src/screens/__tests__/SettingsScreen.test.tsx` and update `__tests__/App.test.tsx` if it asserts the old placeholder.

**Checkpoint**: `pnpm lint`, `pnpm typecheck`, `pnpm test:ci` green; the Folders section works in a
debug build.

### 3c. Debug seam and Maestro flows (end-to-end proof, Principle V)

- [ ] T032 [US1] Add the debug-only grant-release seam (research R11). Write `android/app/src/testDebug/java/com/syncscope/debug/ReleaseGrantsActivityTest.kt` (Robolectric, runs under `testDebugUnitTest`) first: with persisted grants present, launching the activity releases every one and the activity finishes; with none, it just finishes (Principle IV). Then add `android/app/src/debug/AndroidManifest.xml` declaring an exported `com.syncscope.debug.ReleaseGrantsActivity` with an intent filter for `syncscope-debug://release-grants`, and `android/app/src/debug/java/com/syncscope/debug/ReleaseGrantsActivity.kt` that calls `releasePersistableUriPermission` for every entry in `contentResolver.persistedUriPermissions`, then `finish()`es. Confirm it is absent from the release build (`./gradlew :app:processReleaseMainManifest` output has no `syncscope-debug`).
- [ ] T033 [P] [US1] Create `validation/maestro/subflows/open-sources.yaml`: launch the app (no `clearState`) and open Settings › Folders, waiting for `sources.add`.
- [ ] T034 [P] [US1] Create `validation/maestro/subflows/pick-folder.yaml` with params `VOLUME` and `PATH`: open the DocumentsUI roots drawer, tap the volume by visible text, tap each `PATH` segment, tap "Use this folder" then "Allow"; handle API 31/36 layout differences only here with `runFlow: when: visible:` branches (R11).
- [ ] T035 [US1] Create `validation/maestro/sources/01-add-internal.yaml` (US1-1): `launchApp: clearState: true` (the only flow that clears state), open Folders; first cover the cancel edge case: tap `sources.add`, press `back` to leave the picker, and assert no `sources.row` is visible and no `sources.error` is shown; then tap `sources.add` again and pick `SyncScopeE2E/Camera` on internal storage, assert a row with alias "Camera" and status "Available".
- [ ] T036 [US1] Create `validation/maestro/sources/02-add-removable.yaml` (US1-2, `# requires: 01-add-internal`): pick `SyncScopeE2E/Camera` on the SD card volume ("SDCARD"), assert a second row with alias "Camera (SDCARD)" and "Available". Per R10 this flow must fail, never be skipped, if no removable volume is present.
- [ ] T037 [US1] Create `validation/maestro/sources/03-reject-overlap.yaml` (edge case / FR-002, `# requires: 01-add-internal`): pick `SyncScopeE2E/Camera/Nested` on internal storage, assert `sources.error` shows the overlap message naming "Camera", and the list still has exactly two rows.
- [ ] T038 [US1] Create `validation/maestro/sources/04-restart-persists.yaml` (US1-3, SC-002): `stopApp` then `launchApp` without `clearState`, assert the same two rows in the same order.
- [ ] T039 [US1] Create `validation/maestro/sources/05-revoked-unavailable.yaml` (US1-4, SC-002): `openLink: syncscope-debug://release-grants`, relaunch, assert both rows still listed with status "Access lost" and a visible `sources.row.regrant`.
- [ ] T040 [US1] Create `validation/maestro/sources/06-regrant.yaml` (US1-6 then US1-5): Re-grant the internal "Camera" row and pick a different folder (`SyncScopeE2E/Camera/Nested`) → assert the mismatch message and the row still "Access lost"; Re-grant again picking `SyncScopeE2E/Camera` → assert "Available" with alias still "Camera".
- [ ] T041 [US1] Create `validation/maestro/sources/07-remove.yaml` (FR-005, `# requires: 06-regrant`): target the SD card row, which is still "Access lost" after flow 06, as `index: 1` of `sources.row` (rows are ordered by `addedAtMillis`), and first assert its status reads "Access lost". Tap its `sources.row.remove`, then `sources.dialog.cancel` → both rows still present; tap it again, then `sources.dialog.confirm` → only the "Camera" row remains. This proves end to end that removal works for an unavailable source.
- [ ] T042 [US1] Run `pnpm e2e:android` (API 31 then API 36) until all seven flows pass on both (US1-7, SC-001). Record any API-level difference handled in `subflows/pick-folder.yaml` in research.md R11; if API 36 fails at the SD card step, record the observation in research.md R10 and the spec's Edge Cases and escalate to the user instead of skipping.

**Checkpoint**: User Story 1 is complete and proven end to end on API 31 and API 36.

---

## Phase 4: Polish & Cross-Cutting Concerns (Principles VI–IX)

**Purpose**: documentation and release notes required in the same change, plus the final quality gates.

- [ ] T043 [P] Update `docs/architecture.md`: add the `com.syncscope.source` package (SourceTree, SourceAlias, SafAccess, SourcePicker, SourceOperations, LocalSourceEnumerator), remove `listSources`/`launchSourcePicker`/`removeSource` from "Not yet implemented" and change its count from 13 to 10 methods, note contract version 2, and state that `validation/maestro/` now exists (link to DEVELOPMENT.md rather than restating conventions).
- [ ] T044 [P] Update `docs/overview.md` glossary for Source: availability states (Available, Access lost = `GRANT_REVOKED`, Storage missing = `STORAGE_MISSING`), generated alias rule, no-overlap rule.
- [ ] T045 [P] Add `docs/decisions/0016-saf-source-identity-and-availability.md` (canonicalRoot, overlap, computed availability, re-grant by target, R2–R5) and `docs/decisions/0017-debug-grant-release-seam.md` (R11), and list both in `docs/decisions/README.md`.
- [ ] T046 [P] Add the user-facing "Select folders" section to `README.md` (Principle VIII order): Add folder, SD card folders, Access lost → Re-grant, Remove with confirmation, and the folders Android will not let you pick (root of internal storage, `Download/`, `Android/data/`, `Android/obb/`, R10).
- [ ] T047 [P] Update `DEVELOPMENT.md`: API 36 AVD provisioning steps (T001), `scripts/validation/device-fixtures.sh`, the Maestro conventions from [contracts/maestro-conventions.md](./contracts/maestro-conventions.md) as their durable home (layout, selectors, assertions, seams, fixtures), how to run a single flow, and replace the "API 36 coverage is deferred" gotcha with the current state.
- [ ] T048 [P] Update `CHANGELOG.md` `Unreleased`: "Added: select local folders (internal storage and SD card) to check, with Access lost / Re-grant and Remove" and "Changed: CloudSync contract version 2 (`launchSourcePicker` takes an optional re-grant source ID)".
- [ ] T049 Run the full quality gate from [quickstart.md](./quickstart.md): `pnpm lint && pnpm typecheck`, `pnpm test:ci`, `pnpm test:android:unit`, `pnpm e2e:android`; all green with zero lint warnings, and the parity test passing with `CONTRACT_VERSION` 2 and the five new codes in the same order on both sides.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies. T001 (API 36 AVD) blocks only T042/T049, but do it first because
  its outcome can trigger an R10 escalation. T003 depends on T002; T004 on T003.
- **Foundational (Phase 2)**: T006 → T007 → T008 (same TS contract files, in sequence); T009 after T006.
  T010–T016 are independent of the contract tasks. Blocks all of Phase 3.
- **US1 (Phase 3)**:
  - 3a: T018 needs T011, T013, T014, T016, T017; T020 needs T018, T019; T021 needs T008, T009, T018, T020;
    T022 after T021; T024 needs T014, T018 (for `SourceAvailability.kt`) and T023.
  - 3b: T026 needs T007, T025; T028 needs T026, T027; T030 needs T028, T029; T031 needs T030.
  - 3c: T032 is independent of 3b; T033/T034 need T005; T035–T041 need T021, T031, T032, T033, T034 and
    T004; T042 needs all of them plus T001.
- **Polish (Phase 4)**: T043–T048 can start once the behaviour they describe exists (after T042 for final
  wording); T049 is last.

### User Story Dependencies

- **US1 (P1)** is the only story. It depends on Phase 2 and on Phase 1's fixtures and Maestro layout for
  its e2e proof.

### Within US1

- Tests before implementation (each `…Test` task precedes its implementation task and must fail first).
- Pure rules → operations → picker → module wiring → JS wrappers → hook → UI → e2e flows.

### Parallel Opportunities

- Phase 1: T002 and T005.
- Phase 2: T010/T011, T012/T013, T014 and T015 can all proceed in parallel with the T006→T008 contract chain.
- Phase 3: T017, T019 and T023 (test files) in parallel; the whole 3b chain can run in parallel with 3a
  once T007 is done (JS tests mock the native layer); T032, T033 and T034 in parallel with 3a/3b.
- Phase 4: T043–T048 all touch different files.

---

## Parallel Example: User Story 1

```bash
# Native tests, written first, together:
Task: "Write SourceOperationsTest in android/app/src/test/java/com/syncscope/source/SourceOperationsTest.kt"
Task: "Write SourcePickerTest in android/app/src/test/java/com/syncscope/source/SourcePickerTest.kt"
Task: "Write LocalSourceEnumeratorTest in android/app/src/test/java/com/syncscope/source/LocalSourceEnumeratorTest.kt"

# JS track alongside the native track (after T007):
Task: "Write wrapper tests in src/native/__tests__/CloudSync.test.ts"
Task: "Write useSources tests in src/sources/__tests__/useSources.test.ts"
Task: "Write SourcesSection tests in src/sources/__tests__/SourcesSection.test.tsx"

# E2E scaffolding alongside both:
Task: "Debug seam in android/app/src/debug/java/com/syncscope/debug/ReleaseGrantsActivity.kt"
Task: "Subflow validation/maestro/subflows/pick-folder.yaml"
Task: "Subflow validation/maestro/subflows/open-sources.yaml"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1: provision API 36 and settle R10 early; fixtures and Maestro layout.
2. Phase 2: contract v2 and the pure rules (critical, blocks everything).
3. Phase 3a → 3b → 3c, stopping at each checkpoint to validate.
4. **STOP and VALIDATE**: all seven flows green on API 31 and API 36.
5. Phase 4: docs, README, DEVELOPMENT.md, CHANGELOG, full quality gate. The feature is not done until
   Phase 4 passes (Quality Gates).

### Incremental Delivery

The spec has a single story, so the increments are the sub-phase checkpoints: native operations proven
by JVM tests (3a), a usable Folders screen (3b), then the e2e proof (3c). Each is a sensible commit point.

---

## Notes

- [P] = different files, no dependency on an incomplete task.
- Never let `treeUri`, `canonicalRoot` or a raw filesystem path cross the bridge.
- `STORAGE_MISSING` is covered by JVM tests only (research R11), not by a Maestro flow.
- System-UI selectors (DocumentsUI text) live only in `validation/maestro/subflows/`.
- Commit after each task or logical group; stop at any checkpoint to validate.
