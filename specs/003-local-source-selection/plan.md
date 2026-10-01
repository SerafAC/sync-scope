# Implementation Plan: Local Source Selection via SAF

**Branch**: `003-local-source-selection` | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-local-source-selection/spec.md` (clarified 2026-09-28)

## Summary

Let the user choose the local folders to check. **Settings › Folders** gets an Add folder button that opens
the Android system folder picker (Storage Access Framework). The chosen folder is stored as a `source_root`
row with a durable URI grant, a non-overlapping `canonicalRoot` and a generated alias. The list shows each
source's availability, computed live: Available, Access lost (grant revoked) or Storage missing. An
unavailable source can be re-granted (same folder only) or removed. Removal is confirmed, deletes the
source's scan data in one transaction and releases the grant.

The work is mostly native. A new `com.syncscope.source` package implements `listSources`,
`launchSourcePicker(regrantSourceId?)` and `removeSource` behind the existing envelope layer, plus the
`LocalSourceEnumerator` contract that feature 004 consumes. The optional re-grant parameter changes the
Codegen surface, so `CONTRACT_VERSION` becomes 2. JS gets typed wrappers, a `useSources` hook and a
`SourcesSection` UI. This feature creates `validation/maestro/` and its conventions. Seven flows cover
every acceptance scenario on API 31 and API 36, supported by device fixtures and one debug-only seam that
releases grants. Decisions are in [research.md](./research.md).

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 5 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule), React Native Paper
5.15, React Navigation 7, AndroidX Room, Kotlin coroutines, Android `DocumentsContract` /
`ContentResolver` / `StorageManager`. **No new dependencies.**

**Storage**: the Room scan store, table `source_root`. The schema is unchanged (version 1); only DAO
queries are added ([data-model.md](./data-model.md)).

**Testing**: Jest + Testing Library (JS); JUnit + Robolectric JVM tests (`pnpm test:android:unit`);
Maestro 2.10.0 flows on real emulators (`pnpm e2e:android`, D012); Node script-contract tests
(`pnpm test:foundation`).

**Target Platform**: Android, minSdk 31, targetSdk 36; validated on API 31 and API 36 emulators with an
SD card.

**Project Type**: mobile app (React Native presentation over one Kotlin TurboModule)

**Performance Goals**: `listSources` returns within 200 ms for up to 20 sources (one grant lookup and one
root query per source). The enumerator lists children with one `DocumentsContract` query per directory,
never one query per property (research R8). `SourceOperationsTest` guards the call counts behind the
`listSources` budget: one `persistedGrants()` call per list and at most one root query per source.

**Constraints**: SAF only, and no raw filesystem path crosses the bridge (`treeUri` and `canonicalRoot`
stay native). Providers are limited to on-device and removable storage (R2). No remote access in this
feature (R026 unaffected). Messages are redacted per D011.

**Scale/Scope**: a handful of sources per user. Android's cap on persisted grants per app (128 on API
30+) is far above that. One screen section, three bridge methods, seven Maestro flows.

All former unknowns are resolved in [research.md](./research.md). R10 (removable storage on the API 36
emulator) has a decided method and a decided failure behaviour; its observed result is recorded while
implementing.

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. The result is the same both times.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS, one justified item | No schema change; availability is computed rather than stored; aliases and overlap are pure functions. The one added seam (the `SafAccess` interface) and the debug-only grant-release activity are justified under Complexity Tracking. |
| II. YAGNI | PASS | Only the three owned methods, plus the enumerator the spec's Provides section requires. No alias editing, no source limit UI, no hidden-file filtering (`getSettings` / `setIncludeHidden` are not part of this feature; feature 005 is their proposed owner, see the note in [`specs/005-gallery-list-filtering/spec.md`](../005-gallery-list-filtering/spec.md#dependencies), Dependencies). |
| III. DRY | PASS | Error codes and `CONTRACT_VERSION` keep their single mirrored definitions under the parity test. Overlap, alias and canonical-root rules each have one implementation (`SourceTree`, `SourceAlias`). Maestro conventions get one durable home (`DEVELOPMENT.md`), and the contract page links to it. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | JVM: `SourceTreeTest`, `SourceAliasTest`, `SourceOperationsTest` (fake `SafAccess`), `SourcePickerTest`, `LocalSourceEnumeratorTest` (Robolectric fake provider), `SourceRootDaoTest` (cascade), `ContentResolverSafAccessTest` (Robolectric, the production `SafAccess`), `ReleaseGrantsActivityTest` (Robolectric, `testDebug`), and updates to `CloudSyncModuleTest` and the parity test. Jest: the wrappers, `useSources`, `SourcesSection`. Script contract: `device-fixtures.sh`. All deterministic, with no device state. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | P1 story US1: every acceptance scenario and FR-002/FR-005 map to a named Maestro flow ([contracts/maestro-conventions.md](./contracts/maestro-conventions.md#acceptance-scenario-mapping)), run on API 31 and API 36 with reproducible fixtures and no manual steps. The API 36 AVD is provisioned by a task. |
| VI. Versioning + CHANGELOG | PASS | `CHANGELOG.md` `Unreleased` gets "Added: select local folders…" and "Changed: CloudSync contract version 2". No app release in this feature. |
| VII. `./docs` | PASS | Update `docs/architecture.md` (source package, remove the three methods from "Not yet implemented", `validation/maestro/` now exists), `docs/overview.md` (Source glossary: availability states, alias); add `docs/decisions/0016-saf-source-identity-and-availability.md` and `0017-debug-grant-release-seam.md`. |
| VIII. README | PASS | Add the user-facing "Select folders" section (add, SD card, Access lost / Re-grant, Remove, the system folders Android won't let you pick). |
| IX. DEVELOPMENT.md | PASS | API 36 AVD provisioning, device fixtures, Maestro conventions and running a single flow; update the "API 36 coverage is deferred" gotcha. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit` and `e2e:android` (API 31 and 36) are the feature's exit gate. |

No unjustified violations. The gate passes.

## Project Structure

### Documentation (this feature)

```text
specs/003-local-source-selection/
├── spec.md                          # clarified 2026-09-28
├── plan.md                          # this file
├── research.md                      # R1–R14 decisions
├── data-model.md                    # source_root rules, availability, removal cascade, enumeration types
├── quickstart.md                    # how to validate
├── contracts/
│   ├── cloudsync-sources.md         # bridge surface, DTOs, error codes (contract v2)
│   └── maestro-conventions.md       # validation/maestro layout, selectors, scenario mapping
└── tasks.md                         # next: /speckit-tasks
```

### Source Code (repository root)

```text
android/app/src/main/java/com/syncscope/
├── bridge/
│   ├── CloudSyncModule.kt           # wire the 3 methods; ActivityEventListener for the picker
│   ├── CloudSyncContracts.kt        # CONTRACT_VERSION = 2; +5 error codes
│   └── CloudSyncEnvelope.kt         # conflictingSource on SOURCE_OVERLAP
├── source/                          # NEW
│   ├── SourceTree.kt                # tree URI → volumeId/documentPath/canonicalRoot; overlaps()
│   ├── SourceAlias.kt               # pure alias generation (FR-004)
│   ├── SafAccess.kt                 # interface + ContentResolver/StorageManager implementation
│   ├── SourceAvailability.kt        # the one R5 availability check (operations + enumerator)
│   ├── SourcePicker.kt              # single-slot activity-result bridge (R1)
│   ├── SourceOperations.kt          # list / add / regrant / remove → envelopes
│   └── LocalSourceEnumerator.kt     # SourceListing / LocalFile for feature 004
└── persistence/
    └── Daos.kt                      # SourceRootDao.deleteWithScanData, byCanonicalRoot helpers

android/app/src/debug/
├── AndroidManifest.xml              # NEW: debug-only ReleaseGrantsActivity + syncscope-debug:// link
└── java/com/syncscope/debug/ReleaseGrantsActivity.kt

android/app/src/test/java/com/syncscope/source/      # NEW JVM tests (listed in the Constitution Check)
android/app/src/test/java/com/syncscope/persistence/SourceRootDaoTest.kt

src/
├── native/
│   ├── specs/NativeCloudSync.ts     # launchSourcePicker(regrantSourceId?)
│   ├── CloudSyncContracts.ts        # v2, SourceDto & result types, error codes
│   └── CloudSync.ts                 # listSources / launchSourcePicker / removeSource wrappers
├── sources/                         # NEW
│   ├── useSources.ts                # load, refresh on AppState active, actions
│   └── SourcesSection.tsx           # list rows, chips, Add / Re-grant / Remove, dialog, snackbar
├── screens/SettingsScreen.tsx       # NEW: hosts SourcesSection
└── navigation/AppNavigator.tsx      # Settings tab renders SettingsScreen

validation/maestro/                  # NEW (layout in contracts/maestro-conventions.md)
scripts/validation/
├── device-fixtures.sh               # NEW: seeds SyncScopeE2E/ on primary and SD volumes
├── android-flow.sh                  # e2e mode: run device-fixtures.sh before maestro
└── validation-infrastructure.test.mjs  # + device-fixtures contract

docs/  README.md  DEVELOPMENT.md  CHANGELOG.md   # updates per Principles VI–IX
```

**Structure Decision**: this stays one Android app module plus the JS presentation layer, as in feature
002. The new native responsibility gets its own `source` package next to `bridge`, `credential`,
`persistence` and `remote`. JS source-selection UI goes in `src/sources/` and is hosted by a real
`SettingsScreen` in place of the placeholder.

## Integration closure

This feature hands feature 004:

- persisted, non-overlapping `source_root` rows with a durable grant each;
- `LocalSourceEnumerator.enumerate(source)` returning `Skipped(reason)` or `Available(files)`, never an
  empty listing for an unavailable source;
- real `listSources`, `launchSourcePicker` and `removeSource`;
- `validation/maestro/` with the conventions, subflows and fixture script that later flows reuse.

## Risks

| Risk | Mitigation |
| --- | --- |
| The API 36 emulator exposes no removable volume, or DocumentsUI treats it differently | Decided failure behaviour: the flow fails loudly and the result is escalated to the user, never skipped (R10). |
| DocumentsUI text or layout differs between API 31 and 36 | All system-UI selectors live in `subflows/pick-folder.yaml`, with `when:` branches (R11). |
| The API 36 AVD is not provisioned on the dev machine | An explicit provisioning task, with the steps in `DEVELOPMENT.md`. |
| The contract version bump breaks the boundary tests | Parity and `NativeCloudSyncBoundary` tests are updated in the same task as the bump. |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| `SafAccess` interface (one production implementation) | Principle IV requires deterministic unit tests without device state for list, add, re-grant and remove. | Robolectric shadows only partly support persisted URI grants, and would couple tests to shadow internals (R9). |
| Debug-only `ReleaseGrantsActivity` behind `syncscope-debug://release-grants` | Acceptance scenario 4 must be proven by Maestro (D012), and no adb or system UI revokes one app's persisted grant without also wiping app data. | `pm clear` also deletes the Room store; editing `urigrants.xml` as root needs a reboot and is fragile (R11). The seam is not in the release build and reproduces the real OS state. |
