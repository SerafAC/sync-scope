# Research: Local Source Selection via SAF

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-09-28

Each entry records a decision, why it was chosen, and what was rejected. Every "NEEDS CLARIFICATION" from
the Technical Context is resolved here; the two items that can only be settled on a real emulator (R10, R11)
have a decided method and a decided failure behaviour, and their outcome is recorded during implementation.

## R1. How the picker is launched from the TurboModule

- **Decision**: `launchSourcePicker` builds an `Intent.ACTION_OPEN_DOCUMENT_TREE` and starts it with
  `currentActivity.startActivityForResult`, and the module registers an `ActivityEventListener` on the
  `ReactApplicationContext` to receive the result. The pending `Promise` is held in a single slot; a second
  call while the picker is open resolves `PICKER_BUSY`. No activity (app backgrounded) resolves
  `PICKER_BUSY` too, since the user can simply retry. If the process dies while the picker is open, the
  result is lost and nothing is persisted, which is the same outcome as a cancel.
- **Rationale**: this is the standard React Native pattern for activity results and needs no new
  dependency. The `ActivityResultRegistry` API needs a `ComponentActivity` owner and a registration before
  `onStart`, which does not fit a TurboModule called at an arbitrary time.
- **Alternatives rejected**: a JS-side picker library (adds a dependency and puts SAF handling in JS,
  against "JS is presentation only"); a dedicated transparent activity (one more component for the same
  result).

## R2. Which providers are accepted as sources

- **Decision**: only trees from `com.android.externalstorage.documents` are accepted, that is on-device
  shared storage (`primary`) and removable volumes (`XXXX-XXXX`). Any other authority (Downloads provider,
  media provider, Drive, other apps' providers) is rejected with `SOURCE_UNSUPPORTED` and the grant is
  released immediately.
- **Rationale**: the product answer was "On-device and removable storage only" (project definition Q&A).
  Only this provider has tree document IDs of the stable `volumeId:path` form that canonical roots and the
  overlap rule rely on. Cloud-drive providers are also a non-goal (R027).
- **Alternatives rejected**: accepting any provider (no stable path, so no overlap rule, and it drifts into
  R027 territory).

## R3. `canonicalRoot` and the overlap rule (FR-002)

- **Decision**: parse the tree URI with `DocumentsContract.getTreeDocumentId`. For
  `primary:DCIM/Camera` this gives `volumeId = primary` and `documentPath = DCIM/Camera` (trailing slashes
  trimmed, empty for a volume root). `canonicalRoot = "<authority>/<volumeId>:<documentPath>"`. Two roots
  overlap when they share authority and `volumeId` and one path equals the other or is a prefix of it at a
  `/` boundary (`DCIM` overlaps `DCIM/Camera`; `DCIM` does not overlap `DCIM2`). A volume root overlaps
  everything on its volume. The comparison keeps the case the picker returns, because DocumentsUI always
  returns the on-disk spelling of the chosen folder.
- **Rationale**: a pure string function over the tree document ID can be unit-tested on the JVM and needs no
  I/O. The unique index on `canonicalRoot` that already exists stays as the last line of defence for the
  exact-duplicate case.
- **Alternatives rejected**: resolving real filesystem paths (not available through SAF, and against the
  "no raw local path" boundary); comparing `treeUri` strings (the same folder can be encoded differently).

## R4. Re-grant needs a target (FR-003)

- **Decision**: add an optional parameter, `launchSourcePicker(regrantSourceId?: string | null)`. With an
  ID, the picker opens with `EXTRA_INITIAL_URI` set to the source's tree URI. The result must resolve to the
  same `canonicalRoot`, or it is rejected with `SOURCE_REGRANT_MISMATCH` and the new grant is released.
  On success only `treeUri` and `canWrite` are refreshed; `sourceId`, `alias` and `addedAtMillis` are kept.
  Because the Codegen surface changes, `CONTRACT_VERSION` goes from 1 to 2 in both
  `CloudSyncContracts.ts` and `CloudSyncContracts.kt`, and the existing parity test guards the pair.
- **Rationale**: acceptance scenario 6 requires a re-grant of a *different* folder to be rejected, which is
  impossible to tell apart from a normal add without knowing which source is being re-granted. The
  contract rule is "bumps when the surface changes"; JS and native ship in one APK, so the bump costs
  nothing.
- **Alternatives rejected**: a separate `regrantSource(sourceId)` method (a second method that duplicates the
  picker plumbing); implicitly re-granting when an add matches an unavailable source's root (cannot reject
  scenario 6).

## R5. Availability is computed, not stored

- **Decision**: `listSources` computes availability for each row on every call:
  1. `GRANT_REVOKED` when no entry in `contentResolver.persistedUriPermissions` matches the row's `treeUri`
     with read permission;
  2. `STORAGE_MISSING` when the grant exists but querying the tree's root document fails or returns no row
     (volume unmounted, SD card removed, folder deleted);
  3. otherwise `AVAILABLE`.
  The JS screen calls `listSources` on mount and whenever the app returns to the foreground (`AppState`
  becomes `active`), so a grant lost while the app was in the background shows up without a restart.
- **Rationale**: a stored flag would go stale the moment the OS changes the grant. The check is one binder
  call plus one small query per source, and v1 users select a handful of folders.
- **Alternatives rejected**: a `status` column in `source_root` (needs a schema migration and is wrong
  whenever it is not refreshed); a single "unavailable" state with no reason (the user needs to know
  whether to re-grant or re-insert the SD card).

## R6. Alias generation (FR-004)

- **Decision**: a pure function `SourceAlias.generate(candidate, existing)` returns the first unique form of:
  1. the folder name (last path segment), or the volume label for a volume root;
  2. `"<name> (<volume label>)"`;
  3. `"<name> (<volume label>, <parent>)"`, then with more parent segments (`"<grandparent>/<parent>"`)
     until it is unique.
  Uniqueness is checked case-insensitively against the aliases already stored. The walk always ends,
  because distinct `canonicalRoot` values differ in volume or in some path segment. Volume labels come from
  `StorageManager.storageVolumes` (`StorageVolume.getDescription`), for example "Internal shared storage"
  or "SDCARD" on the emulator. The alias is computed once when the source is added and never recomputed.
- **Rationale**: it matches the clarified rule and the user's note that folders only need an autogenerated
  alias "for the user knowledge only". A pure function is fully unit-testable.
- **Alternatives rejected**: numeric suffixes such as "Camera 2" (they don't say where the folder is);
  recomputing aliases when sources change (FR-004 requires them to stay stable).

## R7. Removal transaction (FR-005)

- **Decision**: `SourceRootDao.deleteWithScanData(sourceId)` is one `@Transaction` that deletes, in order,
  `local_deletion_overlay` rows whose `localEntryId` belongs to the source's `local_node` rows,
  `remote_ambiguity` and `snapshot_counts` rows with that `sourceId`, the source's `local_node` rows, and
  finally the `source_root` row. The Room transaction runs first; the SAF permission is released after it
  commits, and a `SecurityException` from the release is ignored because the grant may already be gone
  (the unavailable-source case). An unknown `sourceId` resolves `SOURCE_NOT_FOUND`.
- **Rationale**: `local_node.sourceId` has a foreign key to `source_root` without a cascade, so the child
  rows must go first or SQLite rejects the delete. Browse counts are computed live from `local_node`
  (`LocalNodeDao.statusCounts`), so the remaining sources' results stay correct. Releasing the grant after
  the commit means a crash between the two steps can at worst leave an unused grant, never a row without a
  grant.
- **Alternatives rejected**: adding `onDelete = CASCADE` to the foreign key (a schema migration for a
  one-query saving); keeping old snapshot rows (the clarified answer requires deleting them).
- **Note**: the confirmation dialog is JS UI; `removeSource` itself does not prompt.

## R8. Local enumeration contract for feature 004

- **Decision**: `LocalSourceEnumerator.enumerate(source): SourceListing`, where `SourceListing` is either
  `Skipped(reason)` (the availability reason from R5) or `Available(files: Sequence<LocalFile>)`. Each
  `LocalFile` carries `documentId`, `parentDocumentId`, `name`, `sizeBytes`, `modifiedUtcMillis`,
  `mimeType` and `isDirectory`. The walk uses `DocumentsContract.buildChildDocumentsUriUsingTree` queries
  with an explicit projection, breadth-first and lazy. Hidden (dot) entries are returned and marked with
  `isHidden`; filtering them belongs to `setIncludeHidden`, which feature 004 owns.
- **Rationale**: the spec's Provides section promises it and FR-003 requires "skipped, never empty". Direct
  `DocumentsContract` queries are much faster than `DocumentFile`, which issues one query per property.
- **Alternatives rejected**: `DocumentFile.listFiles()` (N+1 queries); leaving enumeration to feature 004
  (the spec assigns the contract here).

## R9. Seam for injecting test doubles in JVM tests

- **Decision**: one interface, `SafAccess`, wraps the Android calls the source logic needs
  (`persistedGrants()`, `takeGrant(uri)`, `releaseGrant(uri)`, `rootExists(uri)`, `volumeLabel(volumeId)`).
  `SourceOperations` takes it as a constructor parameter, as `RepositoryOperations` takes its factories.
  The production implementation is a thin wrapper over `ContentResolver` and `StorageManager`.
- **Rationale**: Principle IV forbids unit tests that depend on device state; a fake `SafAccess` makes the
  list, add, re-grant and remove paths deterministic JVM tests. It follows the existing
  `RemoteClientFactory` injection precedent.
- **Alternatives rejected**: Robolectric shadows of `ContentResolver` persisted permissions (their support
  for persisted URI grants is partial and would couple the tests to shadow internals).

## R10. Removable storage on API 31 and API 36 emulators (open question from the spec)

- **Decision**: both AVDs are created with `hw.sdCard = yes` and `sdcard.size = 512 MB`; the emulator then
  exposes the SD card as a public removable volume (`/storage/XXXX-XXXX`), which DocumentsUI lists as
  "SDCARD". The existing `dependency_api31` AVD already has this. The API 36 AVD
  (`dependency_api36`, `system-images;android-36;google_apis;x86_64`) does not exist yet on the dev machine
  and is provisioned by a task, with the steps added to `DEVELOPMENT.md`. The device-fixture script finds
  the volume with `sm list-volumes public`.
- **Failure behaviour (decided)**: if API 36 exposes no public volume, or DocumentsUI refuses to pick a
  folder on it, the removable-storage flow **fails**. It is never skipped. The observed limitation is then
  recorded in `docs/` and in the spec's Edge Cases, and it goes to the user as a decision. This meets the
  spec's "surface the limitation explicitly rather than silently degrading".
- **Known platform restriction** (API 30 and later, so both targets): DocumentsUI refuses the root of
  primary storage, `Download/`, `Android/data/` and `Android/obb/` as a tree. The volume root of a removable
  card is allowed. This is system behaviour, not app logic, and it is documented in the README folder
  section.

## R11. Driving DocumentsUI and revoking a grant under Maestro

- **Picker**: the flows call one shared subflow, `subflows/pick-folder.yaml`, which takes the volume label
  and folder path as parameters. It opens the roots drawer, taps the volume, taps each path segment, then
  taps "Use this folder" and "Allow". The labels are stable across API 31 and API 36; any layout difference
  is handled inside the subflow with `runFlow: when: visible:` branches, so the flows themselves stay
  identical. Selectors on DocumentsUI use visible text because its resource IDs are not a public contract.
- **Revocation**: no adb or system UI can revoke a single persisted URI grant without also wiping app data
  (`pm clear` would delete the Room store too). The flows therefore use a **debug-only** seam: an exported
  activity in `android/app/src/debug/`, reached by the deep link `syncscope-debug://release-grants`, that
  calls `releasePersistableUriPermission` for every held grant and finishes. That leaves exactly the OS
  state a real revocation leaves (the URI is absent from `persistedUriPermissions`). The activity is not in
  the release manifest. Maestro reaches it with `openLink`, then relaunches the app.
- **Storage missing**: `STORAGE_MISSING` is covered by JVM tests only. It is not a spec acceptance
  scenario, and unmounting a volume mid-flow would make the e2e suite depend on emulator mount timing.
- **Alternatives rejected**: `adb root` and editing `urigrants.xml` (needs a reboot and is fragile);
  UiAutomator instrumented tests (D012 makes Maestro the proof bar).

## R12. Seeding device fixtures

- **Decision**: a new `scripts/validation/device-fixtures.sh` runs in `android-flow.sh` e2e mode after the
  APK install and before `maestro test`. It creates `SyncScopeE2E/Camera` and `SyncScopeE2E/Camera/Nested`
  on primary storage and `SyncScopeE2E/Camera` on the removable volume, each with one small file. The same
  folder name on two volumes exercises alias disambiguation, and the nested folder exercises the overlap
  rule. The script is idempotent, and `validation-infrastructure.test.mjs` gains a contract assertion for
  it, as for the other scripts.
- **Rationale**: flows must use reproducible fixtures with no manual steps (Principle V).

## R13. Maestro layout and conventions (R020, D012)

- **Decision**: `validation/maestro/config.yaml` pins `executionOrder.flowsOrder` and
  `continueOnFailure: false`, because later flows depend on state from earlier ones (restart and revoke
  build on added sources). The first flow starts with `launchApp: clearState: true`. App selectors use
  `testID` values named `<screen>.<element>[.<qualifier>]` (for example `sources.add`, `sources.row`,
  `sources.row.status`, `sources.dialog.confirm`), and assertions check user-visible text. The conventions
  are written up in [contracts/maestro-conventions.md](./contracts/maestro-conventions.md) and linked from
  `DEVELOPMENT.md`.

## R14. Where the Sources UI lives

- **Decision**: the Settings tab's placeholder is replaced by a `SettingsScreen` containing one "Folders"
  section (`SourcesSection`). It shows each source's alias, volume label and folder path, an availability
  chip, Re-grant (only when unavailable) and Remove actions, an Add folder button, a Paper `Dialog` to
  confirm removal, and a `Snackbar` for typed errors. The data goes through a small `useSources` hook that
  owns loading, refresh on foreground and the three actions. No new dependencies; React Native Paper and
  React Navigation are already installed.
- **Rationale**: the Settings placeholder already says "Repository and folder settings will appear here".
  The repository section arrives with a later feature and slots into the same screen.
