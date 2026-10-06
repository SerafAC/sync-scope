---

description: "Task list for feature 007: Sorting, Fast Scrolling, Several Server Folders and an App Icon"
---

# Tasks: Sorting, Fast Scrolling, Several Server Folders and an App Icon

**Input**: Design documents from `/specs/007-sort-scroll-remote-folders/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/cloudsync-polish.md](./contracts/cloudsync-polish.md),
[contracts/maestro-polish.md](./contracts/maestro-polish.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED.

- Constitution Principle IV requires unit tests for all code, in the same change; a bug fix needs a
  regression test that fails without the fix (Story 4, Story 5).
- Principle V requires every P1 story and each protocol to map to a named Maestro flow against the live
  containers ([contracts/maestro-polish.md](./contracts/maestro-polish.md#acceptance-scenario-mapping)).

Each test task sits next to the implementation it verifies: write the test first and make sure it fails.

**Organization**: phases follow the spec's priorities, adjusted for one real dependency:

- P1 stories that stand on Phase 2 alone: US1 (sort), US3 (several server folders), US5 (large device
  folder).
- US2 (P2, scrollbar) needs US1's native sorts; it builds the scroll index and the band-segmented reader.
- US4 (P1, keep the place) needs US2's `anchorIndex` and segmented reader (research R8), so it comes
  right after US2.
- US7 (P2, icon) waits for the owner's image; its script can be built at any time.
- US6 (P3, wording) comes before US5: it is one task, and US5's flow 08 asserts its `Device folders`
  header.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task belongs to (US1–US7)
- Paths are relative to the repository root. Abbreviations:
  - `KT/` = `android/app/src/main/java/com/syncscope/`
  - `KTEST/` = `android/app/src/test/java/com/syncscope/`
  - `MAESTRO/` = `validation/maestro/`
- Before renaming or changing a symbol, run `graft callers <symbol> --depth all` to find every
  connected file (for example `remoteRoot`, `FileSort`, `usePagedQuery`).
- Each new Maestro flow declares `name: polish/<file>` and is added to `MAESTRO/config.yaml`
  `flowsOrder` (after `mvp/91-release-update`) by the task that creates it.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: device fixtures, the scroll manifest, the `polish/` flow directory and the picker spike. No
production behaviour.

- [X] T001 Add script-contract assertions to `scripts/validation/validation-infrastructure.test.mjs` for the new fixtures and manifest ([contracts/maestro-polish.md](./contracts/maestro-polish.md#fixtures)). The test must fail until T002 and T003 land.
  - `scripts/validation/scroll-manifest.sh` exists, is executable, and when sourced defines `scroll_name <i>`, `scroll_size <i>`, `scroll_mtime <i>` (for `i` in `0…4999`) and `narrow_name <i>`, `narrow_size <i>`, `narrow_mtime <i>` (for `i` in `0…199`). These are the one definition of the generated sources (Principle III).
  - Over all 5,000 `Scroll` indexes (at least 5,000 so flow 03 can prove SC-003): sizes span 2 KB (2,000 B) to 4 MB (4,000,000 B); mtimes span 30 calendar months; first characters cover a digit or symbol (`#` band) and every letter `a`–`z`, including at least one accented initial (for example `É`) and mixed case.
  - Over all 200 `Narrow` indexes: every size is within 3,000,000–5,000,000 B with at least 8 distinct sizes; all mtimes fall within 21 days.
  - Run with `print`, it outputs `KEY=value` lines for at least `FIRST_NAME_ASC`, `FIRST_NAME_DESC`, `FIRST_TIME_DESC`, `FIRST_TIME_ASC`, `FIRST_SIZE_DESC`, `FIRST_SIZE_ASC`, `LARGEST_NAME`, `BAND_MONTH_LABEL`, `BAND_MONTH_FIRST` (the first file, in `TIME_DESC` order, of the month band about three quarters down the track) and `BAND_LETTER_M_FIRST`. The name order follows research R2 (`SortName`: NFKD, accents removed, lowercase, `#` names first), and the test recomputes one value independently to check it.
  - `scripts/validation/device-fixtures.sh` seeds `/sdcard/SyncScopeE2E/TwoFolders` with the same file names, bytes and mtimes that `scripts/validation/fixture-seed.sh` writes under `scan/clean/a` and `scan/clean/b`; `/sdcard/SyncScopeE2E/Scroll` and `/sdcard/SyncScopeE2E/Narrow` from the manifest functions; and `/sdcard/DCIM/Big` with 10,000 empty `.jpg` files. Use the fake `adb` first on `PATH` pattern from 006 to record the commands.
  - `Big` and `Scroll` are skipped when already complete (a file count check), so a second run within one emulator boot does not recreate them.
- [X] T002 Create `scripts/validation/scroll-manifest.sh` (POSIX `sh`, `set -eu`) to make the manifest half of T001 pass.
  - Names, sizes and mtimes are pure functions of the index (no randomness). `Scroll` images are a base PNG from `scripts/validation/fixture-images.sh` padded with zero bytes to the target size (decoders ignore trailing bytes), so each file is still a valid image.
  - The `print` mode computes every expected value from the same functions; it never contains a literal file name or size.
- [X] T003 Extend `scripts/validation/device-fixtures.sh` to make the device half of T001 pass. Source `scroll-manifest.sh` for `Scroll` and `Narrow`; reuse the existing copy logic for `TwoFolders` (do not restate the `scan/clean` tree); create `DCIM/Big` with one `adb shell` loop (`for i in $(seq 1 10000); do : > /sdcard/DCIM/Big/IMG_$i.jpg; done`). Set mtimes with `touch -d @<epoch>`. Update the header comment (feature 007 sources). `pnpm test:foundation` must pass.
- [X] T004 Wire the runner and the flow directory.
  - `scripts/validation/android-flow.sh`: evaluate `scroll-manifest.sh print` once and pass every line as a Maestro `-e` variable, next to the existing `SIZE_*` values.
  - Create `MAESTRO/polish/.gitkeep`; in `MAESTRO/config.yaml` add `- "polish/*"` under `flows:` after `- "mvp/*"`.
  - Extend the T001 test: the runner passes `FIRST_SIZE_DESC` and `BAND_MONTH_LABEL`, and `config.yaml` lists `polish/*`. `pnpm test:foundation` must pass.
- [X] T005 The picker spike (research R15, quickstart §2; time-box: half a day). Run `scripts/validation/device-fixtures.sh` on the API 31 and API 36 emulators. In the debug app, open Settings › Folders › Add a folder, open `DCIM`, then `Big`.
  - Record in [research.md R15](./research.md#r15-the-empty-android-folder-picker), under a new "Spike result (date)" heading: what each API level shows (empty, loading bar or files); whether a different `EXTRA_INITIAL_URI` in `KT/source/SourcePicker.kt` (none, the volume root, `DCIM/Big` itself) or different intent flags change it; and whether selecting `Big` from `DCIM` without opening it works.
  - If the emulator offers a second volume (an SD card image), repeat the check there and record it (spec edge case "Picker on a removable card"); otherwise record that only the primary volume could be checked.
  - End the entry with the chosen branch: **A (intent fix)** or **B (hint)**. T048 implements it.

**Checkpoint**: fixtures seed, the manifest prints, `polish/` is registered, and the R15 branch is known.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: contract version 6, schema version 5 and the stored `sortName`. Several stories build on all
three.

**⚠️ CRITICAL**: no story work can begin until this phase is complete.

### Contract version 6 (TS and Kotlin in lockstep, parity-guarded)

- [X] T006 Write the failing contract tests in `KTEST/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts`:
  - `CLOUD_SYNC_CONTRACT_VERSION` / `CONTRACT_VERSION` is `6`;
  - `FileSort` has exactly `NAME_ASC`, `NAME_DESC`, `TIME_ASC`, `TIME_DESC`, `SIZE_ASC`, `SIZE_DESC`; `FileKind` is `DIRECTORY | FILE`; `ScrollUnit` is `LETTER | YEAR | MONTH | DAY | SIZE`, equal on both sides;
  - `SCROLL_BANDS_MIN = 5` and `SCROLL_BANDS_MAX = 15`, equal on both sides;
  - `FileIssueCode` includes `REMOTE_FOLDER_UNREAD` with the text "A backup folder could not be read, so this file may be backed up there." on both sides;
  - the `NO_SOURCES_SELECTED` action is "Add a folder in Settings › Device folders." on both sides.
- [X] T007 Implement T006 in `src/native/CloudSyncContracts.ts` and `KT/bridge/CloudSyncContracts.kt` (same names, doc comments citing research R1, R4–R6, R14, R16). `FILE_ISSUE_TEXT` gains `REMOTE_FOLDER_UNREAD`. Update the existing expectations that quote the old `NO_SOURCES_SELECTED` action in `src/screens/__tests__/ScanScreen.test.tsx`. Add a `CHANGELOG.md` `Unreleased` › Changed line "CloudSync contract version 6".
- [X] T008 Add the v6 read types to `src/native/CloudSyncContracts.ts`, exactly as in [contracts/cloudsync-polish.md](./contracts/cloudsync-polish.md): `ScrollIndexDto`, `ScrollBandDto` (`startToken: string | null` — "null for the first band: read it with a null token"; `letter` `'#'` or `'a'…'z'`; `startMillis`; `lowerBytes`; `unknown`), `ScrollAnchor` (`{sortValue: string | number | null; sortName: string}`), `BrowsePreferencesDto` (`view: 'GALLERY' | 'LIST'; gallerySort: FileSort; listSort: FileSort`), `FileEntryDto.sortName: string`, and the query spec's optional `kind?: FileKind | null`. Add type-level tests to `src/native/__tests__/CloudSyncContracts.test.ts` (same file as T006: after T007).
- [X] T009 Change the Codegen spec `src/native/specs/NativeCloudSync.ts`: `QuerySpecInput.kind?: string | null`, and the four methods `getScrollIndex(snapshotId, querySpec, anchor?)`, `browseRemoteFolders(config, transientPassword?, path?)`, `getBrowsePreferences()`, `setBrowsePreferences(preferences)`, with the signatures in the contract. In `KT/bridge/CloudSyncModule.kt` add the overrides; each resolves `NOT_IMPLEMENTED` until wired (T019, T039, T055). Update `KTEST/bridge/CloudSyncModuleTest.kt` and `src/native/__tests__/NativeCloudSyncBoundary.test.ts`. `pnpm assemble:debug` must pass (runs Codegen).

### Schema version 5 and `sortName`

- [X] T010 [P] Write `KTEST/scan/SortNameTest.kt` (failing): `SortName.of("Éclair") == "1eclair"`, `of("apple") == of("Apple")`, `of("Ä") == "1a"`, `of("2024.jpg") == "02024.jpg"`, `of("_x") == "0_x"`, `of("日本") ` starts with `0`, `of("")` is `"0"`; and `SortName.letterOf(sortName)` returns `#` for prefix `0` and the second character otherwise.
- [X] T011 Create `KT/scan/SortName.kt` (`object SortName`, research R2): Unicode NFKD (`java.text.Normalizer`), combining marks (`\p{Mn}`) removed, `lowercase(Locale.ROOT)`, prefixed `1` when the first character is now `a`–`z`, else `0`. `letterOf` as in T010. This is the only name folding in the code (Principle III). T010 must pass.
- [X] T012 Write the failing schema tests.
  - `KTEST/persistence/MigrationTest.kt`, 4 → 5: a saved repository keeps its folder, now read from `remoteRoots`; every existing `local_node` row has a non-empty `sortName` following the prefix rule on `lower(name)` (accents not folded, data-model › Migration); `remote_ambiguity.remotePath` is `NULL`; indexes `(snapshotId, kind, sizeBytes)` and `(snapshotId, kind, sortName)` exist.
  - `KTEST/persistence/SchemaContractTest.kt`: `repository_config` still has no secret column.
  - `KTEST/persistence/SnapshotStoreTest.kt`: the ambiguity copy used by `LOCAL_REFRESH` carries `remotePath`.
- [X] T013 Implement schema version 5 ([data-model.md](./data-model.md#schema-change-version-4--5)) to make T012 pass.
  - `KT/persistence/Entities.kt`: rename `RepositoryConfigEntity.remoteRoot` → `remoteRoots` (`TEXT` not null; doc: "The remote folders, `\n`-separated, in the user's order. An existing single folder is a one-element list."); add `LocalNodeEntity.sortName: String` with `@ColumnInfo(defaultValue = "''")` and the two indexes; add `RemoteAmbiguityEntity.remotePath: String? = null` (doc: "`REMOTE_FOLDER` gaps only: the configured folder that could not be read. `NULL` for every other scope.").
  - `KT/persistence/SyncScopeDatabase.kt`: `version = 5`, `AutoMigration(from = 4, to = 5, spec = Migration4To5::class)`; `Migration4To5` carries `@RenameColumn(tableName = "repository_config", fromColumnName = "remoteRoot", toColumnName = "remoteRoots")` and an `onPostMigrate` running one `UPDATE local_node SET sortName = CASE WHEN substr(lower(name),1,1) BETWEEN 'a' AND 'z' THEN '1' ELSE '0' END || lower(name)`.
  - Export `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/5.json` by building. Extend the ambiguity copy in `KT/persistence/Daos.kt` to copy `remotePath`.
  - Create `KT/remote/RemoteRoots.kt` with only `encode(List<String>): String` (`\n`-joined) and `decode(String): List<String>` (split on `\n`, blanks dropped) for now; US3 adds normalization and overlap. Adapt every current reader of `remoteRoot` (`KT/bridge/RepositoryOperations.kt`, `KT/bridge/CloudSyncModule.kt`, `KT/scan/ScanEngine.kt`, `android/app/src/debug/.../ConfigureRepositoryActivity.kt`, the instrumented and JVM test fixtures) to read `RemoteRoots.decode(remoteRoots).first()` and write `RemoteRoots.encode(listOf(root))`, so behaviour is unchanged until US3. The JS bridge shape stays `remoteRoot` until T040.
- [X] T014 Write `sortName` on every scanned row: in `KT/scan/ScanEngine.kt` `scanSource` (and the `LOCAL_REFRESH` path) set `sortName = SortName.of(name)` for every `FILE` and `DIRECTORY` row. Expose it as `FileEntryDto.sortName` in `KT/bridge/CloudSyncEnvelope.kt` (entry mapping for `queryFiles` and `queryTreeChildren`). Tests first in `KTEST/scan/ScanEngineTest.kt` (rows carry `SortName.of(name)` after a scan and after a refresh; a refresh over a snapshot migrated from version 4, whose rows hold the SQL `sortName` without accent folding, rewrites `sortName` on every row of the new snapshot, unchanged files included — spec edge case "Name order right after the update") and `KTEST/bridge/CloudSyncEnvelopeTest.kt` (the field is written).

**Checkpoint**: contract v6 compiles on both sides with parity green, the database migrates to version 5,
every row has a `sortName`, and behaviour is otherwise unchanged (`pnpm test:ci`, `pnpm test:android:unit`).

---

## Phase 3: User Story 1 — Sort the results (Priority: P1) 🎯 MVP

**Goal**: a sort drop-down and a view drop-down above gallery and list view; six sorts with unknown values
last; folders above files in list view; sort and view remembered across restarts.

**Independent Test**: flows `polish/01-sort` and `polish/02-sort-persists` on the `Scroll` fixture: each of
the six sorts puts the manifest's first file first, in gallery and list view, and the choice survives a
restart.

### Native: sort contract

- [X] T015 [P] [US1] Write the failing sort tests in `KTEST/persistence/SnapshotStoreTest.kt` and `KTEST/persistence/SnapshotQueryTest.kt` (research R1, R3):
  - each of the six sorts orders by `(key, sortName, entryId)` in the sort's direction; `NAME_*` is case- and accent-insensitive (`apple`, `Banana`, `Éclair` read a, b, e);
  - files with `NULL` `sizeBytes` / `modifiedUtcMillis` come last under both `SIZE_ASC` and `SIZE_DESC` (and both `TIME_*`) — the sentinel is `Long.MAX_VALUE` ascending and `-1` descending;
  - equal keys break by `sortName`, then `entryId`;
  - `kind = DIRECTORY` / `FILE` narrows the rows, and two specs that differ only in `kind` have different fingerprints;
  - paging is total for each sort: reading every page returns every row once, also when rows are deleted between pages (006 R14 pattern).
- [X] T016 [P] [US1] Write the failing token tests in `KTEST/persistence/PageTokenCodecTest.kt`: the cursor round-trips `(sortKey, sortName, lastEntryId)`; the token carries a format version byte; a token in the contract-5 format, or with an unknown version, decodes as `PAGE_TOKEN_MISMATCH`; tokens stay opaque, bound to snapshot and query, and clamped to 200 rows (D010).
- [X] T017 [US1] Implement T015/T016: `KT/persistence/SnapshotQuery.kt` (`FileSort.SIZE_ASC`, `SIZE_DESC`; `kind: FileKind?` in the query and its fingerprint), `KT/persistence/PageTokenCodec.kt` (versioned cursor with `sortName`), and `KT/persistence/SnapshotStore.kt`: one `sortKeyOf(sort)` (the only place sort keys are defined, Principle III) yielding `COALESCE(col, sentinel)`; `ORDER BY key, sortName, entryId` and the matching keyset predicate; `kind` in `scopeOf`. Remove the old `name`-based ordering.
- [X] T018 [US1] Extend `KTEST/persistence/SnapshotQueryPerformanceTest.kt`: on 50 k rows, a page under each of the six sorts stays within the existing page budget, and the existing 50 k-row insert budget still holds with the two new indexes. If the insert budget fails, drop `(snapshotId, kind, sortName)` first (plan › Risks) and record it in research R18.
- [X] T019 [US1] Browse preferences, native. Tests first in `KTEST/bridge/BrowsePreferencesTest.kt` (Robolectric `SharedPreferences`): defaults `GALLERY`, `TIME_DESC`, `NAME_ASC` on first read; stored values round-trip; an unknown stored value reads as its default; `set` stores only the given fields; an unknown value is rejected with `INVALID_QUERY` and nothing is stored. Then create `KT/bridge/BrowsePreferences.kt` (file `browse_preferences`, keys `view`, `gallerySort`, `listSort`) and wire `getBrowsePreferences` (payload key `preferences`, never fails) and `setBrowsePreferences` in `KT/bridge/CloudSyncModule.kt`, with cases in `KTEST/bridge/CloudSyncModuleTest.kt`.
- [X] T020 [US1] Accept the new query fields at the bridge: `KT/bridge/ScanOperations.kt` (or wherever `QuerySpecInput` is parsed) maps `sort` `SIZE_*` and `kind`; an unknown `kind` is `INVALID_QUERY`. Tests in `KTEST/bridge/ScanOperationsTest.kt`.

### JS

- [X] T021 [P] [US1] `src/native/CloudSync.ts`: wrappers `getBrowsePreferences()` and `setBrowsePreferences(partial)` with DTO guards (unknown values fall back to the defaults on read); pass `kind` through in `queryFiles`. Tests in `src/native/__tests__/CloudSync.test.ts`.
- [X] T022 [P] [US1] `src/files/a11y.ts`: one table of sort labels — option text `Name (A–Z)`, `Name (Z–A)`, `Date (newest first)`, `Date (oldest first)`, `Size (largest first)`, `Size (smallest first)` — and the accessibility labels `Sort: Name, A to Z`, `Sort: Name, Z to A`, `Sort: Date, newest first`, `Sort: Date, oldest first`, `Sort: Size, largest first`, `Sort: Size, smallest first` and `View: Gallery` / `View: List` (FR-017, contract selectors). Tests in `src/files/__tests__/a11y.test.ts`.
- [X] T023 [US1] `src/files/FilesProvider.tsx` and `src/files/useFiles.ts`: keep `gallerySort` and `listSort` per view and the view mode; load them with `getBrowsePreferences()` before the views mount (render the views only after the first read resolves); write each change with `setBrowsePreferences()`. The filter is not stored (005 R10). Sort, filter, view, folder and selection stay independent (FR-003). Tests in `src/files/__tests__/FilesProvider.test.tsx`: first-run defaults, stored values applied, writes on change, filter back at All after a remount.
- [X] T024 [P] [US1] Create `src/files/SortMenu.tsx` and `src/files/ViewMenu.tsx`: Paper `Menu`s anchored to outlined buttons whose label and accessibility label show the current choice (T022); the open sort menu lists the six options with the current one marked. No inline styles (005 FR-004). Tests in `src/files/__tests__/SortMenu.test.tsx` and `ViewMenu.test.tsx`, including `src/test-utils/a11ySweep.ts`.
- [X] T025 [US1] `src/screens/FilesScreen.tsx`: replace the gallery / list `SegmentedButtons` with `SortMenu` on the left and `ViewMenu` right next to it, both above the filter chips (FR-001); the sort menu edits the visible view's sort. Switching view keeps each view's folder and scroll position, as the switch did (Story 1 sc. 8). Tests in `src/screens/__tests__/FilesScreen.test.tsx`.
- [X] T026 [P] [US1] `src/screens/GalleryScreen.tsx`: read the sort from the provider instead of the fixed `TIME_DESC`. Tests in `src/screens/__tests__/GalleryScreen.test.tsx`: the sort goes into the query spec; a sort change reloads from page 1 and keeps the filter and the selection.
- [X] T027 [US1] `src/screens/ListScreen.tsx`: read a folder in two parts (research R3): its subfolders with `kind: 'DIRECTORY'` and `NAME_ASC`, then its files with `kind: 'FILE'` and the chosen sort, shown folders first (FR-004). The file read starts once the folder read has no next token. This two-read form is a deliberate short-lived step so US1 ships on its own; T063 replaces it with the segmented reader. Tests in `src/screens/__tests__/ListScreen.test.tsx`: folders above files under `SIZE_DESC`; a sort change reorders only the files; select all is unchanged.

### End-to-end

- [X] T028 [US1] Create `MAESTRO/polish/01-sort.yaml` per the mapping row (seam repository over WebDAV, `Scroll` scanned): the sort drop-down is left of the view drop-down and on first run shows `Sort: Date, newest first` in gallery and `Sort: Name, A to Z` in list (sc. 6); for each of the six sorts in gallery the first tile's label equals `${FIRST_…}`; in list view, open `Scroll` and, for each of the six sorts, the first file row equals `${FIRST_…}` with folders above files; pick the Synced filter and change the sort: the filter stays, then back to All: the sort stays (sc. 5); switch views and back: each keeps its sort; the largest file is reached in two taps from Files (SC-002). Story 1 sc. 9 (unknown last) is a recorded deviation proven by T015 and T052 (plan › Complexity Tracking). Register in `MAESTRO/config.yaml`.
- [X] T029 [US1] Create `MAESTRO/polish/02-sort-persists.yaml`: choose List and `Size (smallest first)`, `stopApp`, `launchApp`: List is shown with that sort and the filter is All. Register after 01.

**Checkpoint**: six sorts work in both views and are remembered; flows 01–02 pass on API 31 and API 36.

---

## Phase 4: User Story 3 — Check against several server folders (Priority: P1)

**Goal**: the repository holds one or more server folders, each typed or picked with a server folder
browser; a scan matches against all of them and completes honestly when some cannot be read.

**Independent Test**: flows `polish/04-remote-folders-webdav`, `polish/05-remote-folder-unread-ftp` and
`polish/06-remote-browse-sftp`, plus the extended `mvp/91-release-update`.

### Native: folders, save and test

- [ ] T030 [P] [US3] Write `KTEST/remote/RemoteRootsTest.kt` (failing): `normalize` trims, adds a leading `/`, collapses `//` and drops a trailing `/` (`" photos/ "` → `/photos`, `/` stays `/`); `overlapOf(list)` finds equal and nested folders at a `/` boundary (`/photos` and `/photos/2024` overlap; `/photos` and `/photos2` do not) and reports the later index plus the earlier folder; a folder containing `\n` is rejected; `encode`/`decode` round-trip and keep order.
- [ ] T031 [US3] Complete `KT/remote/RemoteRoots.kt` to make T030 pass: `normalize`, `validate(list)` returning either the normalized list or the first field error as `(fieldIndex, message)` with exactly the messages of the [save table](./contracts/cloudsync-polish.md#saverepositoryconfig-transientpassword) — empty or all blank → index `0`, "Add at least one remote folder."; newline → its index, "A folder name cannot contain a line break."; overlap → the later index, "This folder is the same as, inside or around `<other folder>`.". This is the only place the rule lives (Principle III).
- [ ] T032 [US3] Write the failing repository tests in `KTEST/bridge/RepositoryOperationsTest.kt`, `KTEST/bridge/CloudSyncEnvelopeTest.kt` and `KTEST/credential/RepositoryConfigBoundaryTest.kt`:
  - `saveRepository` takes `config.remoteRoots: string[]`; each validation case returns `field: 'remoteRoots'` with the right `fieldIndex` and message, and stores nothing;
  - a valid save stores the normalized list; changing the folders bumps `revision` (006);
  - `getRepositorySummary` returns `repository.remoteRoots` in order;
  - every folder is in `RemoteConfig.sensitiveValues` (redaction), and no password crosses the bridge (D011);
  - `testRepository` connects once and lists each folder: `folders: [{path, entryCount | null, error | null}]`, `entryCount` is the sum, the status is `ok` when connect and login succeed even if a folder fails; connect, login and host-key failures still fail the whole test;
  - precision discovery samples the first folder.
- [ ] T033 [US3] Implement T032: `KT/bridge/CloudSyncEnvelope.kt` (`error(..., fieldIndex: Int? = null)`, written only when non-null; the `folders` array in the connection payload), `KT/remote/RemoteClient.kt` (`RemoteConfig.rootPaths: List<String>`, every path in `sensitiveValues`), and `KT/bridge/RepositoryOperations.kt` (parse `remoteRoots` through `RemoteRoots.validate`, per-folder test, summary). Remove the T013 single-folder adapters from these files.

### Native: scanning several folders

- [ ] T034 [P] [US3] Write the failing walker tests in `KTEST/scan/RemoteWalkerTest.kt`: `walk` takes a list of folders and lists all of them; one folder failing after the retry policy adds a `REMOTE_FOLDER` gap with `reason` = its error code and `remotePath` = the folder, and the walk continues; every folder failing raises `RootListingFailed` with the first folder's code; one folder behaves exactly as today.
- [ ] T035 [US3] Implement T034 in `KT/scan/RemoteWalker.kt` (enqueue every root; the new `WalkAmbiguity` scope `REMOTE_FOLDER` with `remotePath`; only configured folders are recorded, never discovered paths — D011).
- [ ] T036 [P] [US3] Write the failing scan tests in `KTEST/scan/MatcherTest.kt`, `KTEST/scan/ScanEngineTest.kt` and `KTEST/bridge/ScanOperationsTest.kt`:
  - with a `REMOTE_FOLDER` gap, exact matches stay `SYNCED` and every other file is `UNKNOWN` with `issueCode = REMOTE_FOLDER_UNREAD`, never `UNSYNCED` (D006); without one, the first failure code as today;
  - the gap row stores `remotePath`; `coverage = INCOMPLETE`; the run publishes;
  - `LOCAL_REFRESH` copies `REMOTE_FOLDER` gaps with their paths (`REMOTE_SCOPES` includes it), so the warning survives the app-open refresh;
  - `ScanSummaryDto.unreadRemoteFolders` lists the gaps' `remotePath` in folder order, and is empty when every folder was read; `unreadableRemoteDirectories` still counts non-root directories only;
  - a matched file in the second folder is found by the D020 re-check (`KTEST/deletion/DeletionRecheckTest.kt`, FR-012).
- [ ] T037 [US3] Implement T036 in `KT/scan/Matcher.kt`, `KT/scan/ScanEngine.kt` (pass `rootPaths` to the walker, store `remotePath`, `REMOTE_SCOPES += REMOTE_FOLDER`), `KT/persistence/Daos.kt` and `KT/bridge/ScanOperations.kt` (`unreadRemoteFolders`), and `KT/deletion/DeletionRecheck.kt` if the test shows it still assumes one root. Remove the remaining T013 adapters.

### Native: browser and debug seam

- [ ] T038 [US3] Write the failing browser tests in `KTEST/bridge/RepositoryOperationsTest.kt` and `KTEST/bridge/CloudSyncHostKeyModuleTest.kt` for `browseRemoteFolders(config, transientPassword?, path?)` ([contract](./contracts/cloudsync-polish.md#browseremotefoldersconfig-transientpassword-path)):
  - `config` is validated by the same `parse()` as save, without requiring `remoteRoots`;
  - transient password used when given; otherwise the stored credential when `sameAccount` matches the saved repository; otherwise `CREDENTIAL_UNAVAILABLE` with the action "Enter the password to browse the server.";
  - `path` null or empty lists `/`; a missing path lists `/` with `fellBackToRoot: true`; `path` is normalized and `parent` is `null` at `/`;
  - `folders` holds directory names only, sorted case-insensitively; files and links are never listed;
  - an untrusted SFTP key returns the host-key challenge; after `approveSftpHostKey` the retry lists;
  - refused with `SCAN_IN_PROGRESS` / `DELETION_IN_PROGRESS`;
  - one connection, closed before returning, also on error; the repository row and the credential store are never written.
- [ ] T039 [US3] Implement T038 in `KT/bridge/RepositoryOperations.kt` (reuse `parse`, `sameAccount`, the error-to-place table and `RemoteClient.list`) and wire `browseRemoteFolders` in `KT/bridge/CloudSyncModule.kt` (payload key `remoteFolders`). In `android/app/src/debug/java/com/syncscope/debug/ConfigureRepositoryActivity.kt` accept repeated `root` parameters as `remoteRoots` in order, single `root` still working, with cases in `android/app/src/testDebug/java/com/syncscope/debug/ConfigureRepositoryActivityTest.kt` (D018).

### JS

- [ ] T040 [US3] TS contract and wrappers. In `src/native/CloudSyncContracts.ts`: `RepositoryField` replaces `'remoteRoot'` with `'remoteRoots'`; `CloudSyncError.fieldIndex?: number | null` (also in the Codegen `CloudSyncErrorDto`); the save config and repository summary use `remoteRoots: string[]`; the connection result gains `folders`; `RemoteFoldersDto`; `ScanSummaryDto.unreadRemoteFolders: string[]`. In `src/native/CloudSync.ts`: `browseRemoteFolders(config, transientPassword?, path?)` and the guards for the new fields. Tests in `src/native/__tests__/CloudSync.test.ts` and `CloudSyncContracts.test.ts`.
- [ ] T041 [P] [US3] `src/repository/serverAddress.ts`: a server URL with a path typed into Host fills `remoteRoots[0]` only and leaves the other folders alone (Story 3 sc. 8). Tests in `src/repository/__tests__/serverAddress.test.ts`.
- [ ] T042 [P] [US3] `src/repository/useRepository.ts`: the draft holds `remoteRoots: string[]` (at least one entry, `['']` on a new form); save errors are kept per `fieldIndex`; the test result keeps the per-folder lines. Tests in `src/repository/__tests__/useRepository.test.tsx`.
- [ ] T043 [P] [US3] Create `src/repository/RemoteFolderBrowser.tsx`: an RN `Modal` (`testID` `remote-browser`) opened with the form's draft, transient password and the field's path. It shows a breadcrumb, an `Up` action, one row per folder (label = folder name), `Use this folder`, a loading indicator and, on failure, the same cause and next step as the connection test; a host-key challenge opens the existing `HostKeyDialog` and retries after approval. Responses for a folder the user already left are ignored (request sequence number). It saves nothing. Tests in `src/repository/__tests__/RemoteFolderBrowser.test.tsx`: descend, up, fall back to root, stale response ignored, error shown, host-key retry, `Use this folder` returns the path, a11y sweep.
- [ ] T044 [US3] `src/screens/RepositoryScreen.tsx`: the remote folder becomes a list of fields (`testID` `repository.remoteRoots.<n>`), each with a `Browse remote folder <n+1>` button and a `Remove remote folder <n+1>` button hidden when only one folder is left, plus `Add another folder` (Story 3 sc. 1). A save error with `fieldIndex` shows under that field; a passed test shows "Connected" with one line per folder (entry count, or the error and its action under the folder's own field). Browse opens `RemoteFolderBrowser` for that field. Tests in `src/screens/__tests__/RepositoryScreen.test.tsx`.
- [ ] T045 [P] [US3] `src/repository/RepositorySection.tsx` lists every remote folder (Story 3 sc. 10). `src/scan/ScanSummaryCard.tsx` shows `Could not read <folder>` for each entry of `unreadRemoteFolders`. Where `FILE_ISSUE_TEXT` is rendered for a file (find it with `graft grep FILE_ISSUE_TEXT`), `REMOTE_FOLDER_UNREAD` appends the unread folder names. Tests in `src/repository/__tests__/RepositorySection.test.tsx`, `src/scan/__tests__/ScanSummaryCard.test.tsx` and the file row's test.

### End-to-end

- [ ] T046 [US3] Update the existing repository subflows for the new field selector (`MAESTRO/subflows/setup-repository.yaml` and any flow typing the remote folder) to `repository.remoteRoots.0`, then create:
  - `MAESTRO/polish/04-remote-folders-webdav.yaml` per the mapping row (two folders; the server URL with path `/scan/clean/a` typed into Host fills folder 1 only (sc. 8); Connected with a line per folder; `TwoFolders` all Synced; Settings › Repository lists both; deleting a file that exists only under `b` passes the server check (D020, sc. 9); remove `/scan/clean/b` → `b`'s remaining files Unsynced; `/scan/clean/a/x` → overlap error naming `/scan/clean/a`);
  - `MAESTRO/polish/05-remote-folder-unread-ftp.yaml` (seam with roots `/scan/clean/a` and `/scan/partial/restricted`: scan completes, `Could not read /scan/partial/restricted`, Unsynced count 0; then the seam sets roots `/scan/partial/restricted` and `/gallery-partial/restricted`: `Scan failed`, and Files still shows the previous result (sc. 6));
  - `MAESTRO/polish/06-remote-browse-sftp.yaml` (host-key dialog → Trust → lists `/`; `scan` › `clean` › `Use this folder` fills `/scan/clean`; wrong password → login error, field still editable);
  - extend `MAESTRO/mvp/91-release-update.yaml`: after the update, Settings › Repository shows the old folder as the only entry and a scan runs (Story 3 sc. 7).

  Register 04–06 in `MAESTRO/config.yaml`. The flows must pass on API 31 and API 36.

**Checkpoint**: several folders save, test, browse and scan; partial reads are honest; flows 04–06 and
91 pass.

---

## Phase 5: User Story 6 — "Device folders" in Settings (Priority: P3)

**Goal**: the Settings section and every pointer to it say "Device folders".

**Independent Test**: the Jest string test finds no "Settings › Folders" and no "Folders" header; flow 08
sees the `Device folders` header.

- [ ] T047 [US6] Write the failing tests: `src/screens/__tests__/SettingsScreen.test.tsx` (sections headed "Repository" and "Device folders"), and a new `src/__tests__/deviceFoldersWording.test.ts` that reads every `*.ts`/`*.tsx` under `src/` (tests excluded) and `KT/bridge/CloudSyncContracts.kt` and fails on `Settings › Folders` or a section header `Folders` (as 006's "no Connect screen" test). Then rename in `src/sources/SourcesSection.tsx` (header and doc comment), `src/screens/SettingsScreen.tsx` (comment) and every remaining user-visible string; JS names such as `FoldersItem` stay (research R16). Update `MAESTRO/subflows/open-sources.yaml` and any flow that taps `Folders` to `Device folders`.

**Checkpoint**: wording is consistent; existing `sources/*` flows still pass.

---

## Phase 6: User Story 5 — Add a device folder that holds many files (Priority: P1)

**Goal**: a 10,000-file folder can be added through Add a folder, by the intent fix or the hint (R15).

**Independent Test**: flow `polish/08-add-large-folder` adds `DCIM/Big` and sees it listed as available.

- [ ] T048 [US5] Implement the branch recorded by T005.
  - **Branch A (intent fix)**: change the intent in `KT/source/SourcePicker.kt`, with a regression test in `KTEST/source/SourcePickerTest.kt` that fails without the fix; add `MAESTRO/polish/08` steps that open `Big` inside the picker.
  - **Branch B (hint, expected)**: in `src/sources/SourcesSection.tsx`, the existing picker hint gains "For a folder with thousands of files, such as Camera, select it from its parent folder (tap the folder's name once and choose Use this folder) instead of opening it." Test in `src/sources/__tests__/SourcesSection.test.tsx`. In [contracts/maestro-polish.md](./contracts/maestro-polish.md#deviations-recorded-in-planmd--complexity-tracking), confirm Story 5 sc. 2–4 as not possible from the app. Under branch A, remove that deviation instead (flow 08 then covers sc. 2).
- [ ] T049 [US5] Create `MAESTRO/polish/08-add-large-folder.yaml` per the mapping row (clearState; Settings › `Device folders` › Add a folder; **branch B**: the hint shows, then in `DCIM` select `Big` from its parent; **branch A**: open `DCIM` › `Big`, its files show, back to `DCIM` and into `Big` again, its files show again (Story 5 sc. 2); both: `Use this folder` → `Allow`; `Big` is listed as available). Needs T047 (the `Device folders` label). Register in `MAESTRO/config.yaml`; pass on API 31 and API 36.

**Checkpoint**: the camera-sized folder can be added; flow 08 passes.

---

## Phase 7: User Story 2 — Jump through long results with a smart scrollbar (Priority: P2)

**Goal**: a scrollbar with letter, date or size labels that jumps to any band of the whole result,
including rows not loaded yet.

**Independent Test**: flow `polish/03-fast-scroll` on `Scroll` and `Narrow`: a thumb release lands on the
band's first file in each sort, and narrow sizes give at least 5 labels.

### Native: bands and the scroll index

- [ ] T050 [P] [US2] Write `KTEST/scan/ScrollBandsTest.kt` (failing) for a pure `ScrollBands` object (research R5, R6):
  - **Letters**: one band per non-empty letter, `#` first.
  - **Dates** (fixed `ZoneId` in the test): years when they give ≥ 5 non-empty bands, else months when they do, else days; ten years of files → year bands; three weeks → day bands; all on one day → one band; empty periods skipped; each band's `startMillis` is the local start of its period.
  - **Sizes**: wide range (`p95 / p5 ≥ 10`) uses 1-2-5 boundaries from `p5` to the max (50 KB–2 GB → `100 KB`, `1 MB`, `10 MB`… among them); narrow range uses step `nice((p95 − p5) / 10)` (3–5 MB → steps of 0.2 MB, ≥ 5 bands, SC-008); values below `p5` join the first band and above the last step a top band, so a few huge outliers get one band of their own; empty bands dropped; a band over half the files is split once with the narrow rule when there are ≥ 8 distinct sizes; more than `SCROLL_BANDS_MAX` bands are merged pairwise to ≤ 15; with ≥ 8 distinct sizes there are 5–15 bands and none holds over half the files unless over half share one size (FR-007a); all equal sizes → one band; `lowerBytes` strictly increase (labels never repeat).
- [ ] T051 [US2] Create `KT/scan/ScrollBands.kt` to make T050 pass, using `SCROLL_BANDS_MIN` / `SCROLL_BANDS_MAX` from `KT/bridge/CloudSyncContracts.kt`. The one place band rules live (Principle III).
- [ ] T052 [P] [US2] Write `KTEST/persistence/ScrollIndexTest.kt` (failing) for `SnapshotStore.scrollIndex(snapshotId, query, anchor?)`:
  - `unit` follows the sort (`LETTER` for name, `YEAR`/`MONTH`/`DAY` for date, `SIZE` for size); bands follow the sort's direction; the `unknown: true` band is last;
  - band counts add up to `totalCount` (`FILE` rows only); each `startIndex` is the sum of the counts before it; no empty band;
  - the first band's `startToken` is `null`; paging from any band's `startToken` returns that band's first row first;
  - scope equals the rows' scope (`scopeOf`): filter, view, source, parent and `kind`;
  - `anchorIndex` = the number of rows sorting before the anchor `(sortValue, sortName)`, clamped to `totalCount − 1`; a gone anchor gives its neighbour's index (Story 4 sc. 2); a wrong-typed `sortValue` gives `null`;
  - `SNAPSHOT_NOT_FOUND` and `STALE_GENERATION` as for paged reads.
- [ ] T053 [US2] Implement T052 in `KT/persistence/SnapshotStore.kt` and `KT/persistence/Daos.kt`: one indexed read of the sort column within `scopeOf` (a `GROUP BY` letter of `sortName` for names; the sorted values for sizes and dates), bands from `ScrollBands`, and each `startToken` minted with `PageTokenCodec` at a cursor just before the band's lower bound (D010 unchanged).
- [ ] T054 [US2] Extend `KTEST/persistence/SnapshotQueryPerformanceTest.kt`: `scrollIndex` under 150 ms on 50 k rows for each sort (research R4).
- [ ] T055 [US2] Wire `getScrollIndex` in `KT/bridge/ScanOperations.kt`, `KT/bridge/CloudSyncEnvelope.kt` (payload key `scrollIndex`, the band DTO) and `KT/bridge/CloudSyncModule.kt`; `pageToken` and `pageSize` are ignored. Tests in `KTEST/bridge/ScanOperationsTest.kt` and `KTEST/bridge/CloudSyncModuleTest.kt`. Amend D010 in `docs/decisions/0010-snapshot-paging-and-origin-badge.md` with the scroll index and band start tokens (token contract unchanged).

### JS

- [ ] T056 [P] [US2] `src/native/CloudSync.ts`: `getScrollIndex(snapshotId, querySpec, anchor?)` with DTO guards. Tests in `src/native/__tests__/CloudSync.test.ts`.
- [ ] T057 [P] [US2] Create `src/files/bandLabel.ts`: `LETTER` → `#` or the upper-case letter; `YEAR` → `YYYY`; `MONTH` → `MM.YYYY`; `DAY` → `DD.MM.YYYY`, all in the device's local time from `startMillis`; `SIZE` → `formatBytes(lowerBytes)` from `src/selection/formatBytes.ts`; the unknown band → `Unknown`. Tests in `src/files/__tests__/bandLabel.test.ts`.
- [ ] T058 [US2] Write the failing segment tests in `src/files/__tests__/usePagedQuery.test.tsx` (every existing test stays and must pass unchanged, research R7):
  - page 1 and the index are requested together; before the index arrives the hook behaves as today;
  - with the index, the result has its full length at once: loaded rows plus placeholders up to each band's `count`;
  - `loadBand(i)` (or the visible-range call) reads a band from its `startToken` forward until its `count` rows are in; duplicate calls do not duplicate reads;
  - a delayed band read shows placeholders, not an empty list (Story 2 sc. 6);
  - stale responses after a query or snapshot change are dropped; `STALE_GENERATION` and the deletion `reloadKey` keep their rules (005 R1, 006 R14); a `PAGE_TOKEN_MISMATCH` reloads;
  - a single band behaves like linear paging;
  - an optional leading segment (list view's folder read, `kind: 'DIRECTORY'`, `NAME_ASC`) is read first and placed before the file bands.
- [ ] T059 [US2] Implement T058 in `src/files/usePagedQuery.ts` (one segment per band, each with its rows, next token and phase).
- [ ] T060 [P] [US2] Write `src/files/__tests__/FastScroller.test.tsx` (failing): hidden when content ≤ 3 viewports; shown while scrolling and faded out 1.5 s after (fake timers); dragging maps the thumb position to a band and shows its label in `files.scroller.label`; release calls `onJump(band.startIndex)`; the thumb (`testID` `files.scroller.thumb`) is `accessibilityRole="adjustable"`, its `accessibilityValue` is the band label, and `increment` / `decrement` move to the next / previous band (Story 2 sc. 7); a new result while dragging ends the drag at the reached position.
- [ ] T061 [US2] Create `src/files/FastScroller.tsx` with `PanResponder` and `Animated` (no new dependency, research R9), labels from `bandLabel`, accessibility text from `src/files/a11y.ts` (add the scroller and placeholder labels there, with tests in `src/files/__tests__/a11y.test.ts`). No inline styles.
- [ ] T062 [US2] `src/screens/GalleryScreen.tsx`: render placeholders (theme surface variant tiles, labelled per `a11y.ts`), start band loads from `onViewableItemsChanged` with a one-screen look-ahead, keep `getItemLayout`, and add `FastScroller` whose jump calls `scrollToIndex`. Tests in `src/screens/__tests__/GalleryScreen.test.tsx`: placeholders, band load on view, jump, scroller absent for a short result, bands follow the filter (Story 2 sc. 8).
- [ ] T063 [US2] `src/screens/ListScreen.tsx`: replace the two linear reads from T027 with the segmented reader (folder read as the leading segment, file bands after it, fixed `density.rowHeight`), plus `FastScroller` over the file bands. Tests in `src/screens/__tests__/ListScreen.test.tsx`: folders first, jump lands on the band's first file, bands follow the folder.

### End-to-end

- [ ] T064 [US2] Create `MAESTRO/polish/03-fast-scroll.yaml` per the mapping row: gallery date sort, scroll, drag the thumb to the bottom quarter, release: the first tile equals `${BAND_MONTH_FIRST}` (label `${BAND_MONTH_LABEL}` seen during the drag); name sort, drag to `M`: the first tile starts with `m`/`M` (`${BAND_LETTER_M_FIRST}`); size sort on `Narrow` (filter by source): drag labels show `MB` with one decimal and at least 5 distinct labels over the track; filter Synced: no thumb. Register after 02; pass on API 31 and API 36. SC-003: after the date-sort release, wait for `${BAND_MONTH_FIRST}` with `extendedWaitUntil` and `timeout: 1000` (on API 31), so a slower landing fails the flow.

**Checkpoint**: the scrollbar works in all three sorts and both views; flow 03 passes.

---

## Phase 8: User Story 4 — Stay in place when results update (Priority: P1)

**Goal**: a rescan or app-open refresh keeps the first visible file at the top, in both views, also the
hidden one.

**Independent Test**: flow `polish/07-results-updated-keeps-place`: after an in-app rescan, the noted list
row and gallery tile are still at the top and "Results updated" shows.

- [ ] T065 [US4] Write the failing regression tests (they must fail on the current jump-to-top behaviour):
  - `src/files/__tests__/usePagedQuery.test.tsx`: the hook takes an anchor `(sortValue, sortName)`; on a snapshot change it requests the new index with that anchor, exposes `anchorIndex` once, and loads that band before reporting ready;
  - `src/screens/__tests__/GalleryScreen.test.tsx` and `ListScreen.test.tsx`: the view records the first visible file's anchor from `onViewableItemsChanged` (sort value by sort: `sortName`, `modifiedUtcMillis` or `sizeBytes`); on a new snapshot it scrolls to `anchorIndex`, not 0; a gone anchor lands on its neighbour (Story 4 sc. 2); list view relocates the folder by name first (005 R2), then the anchor; the "Results updated" notice still shows;
  - `src/screens/__tests__/FilesScreen.test.tsx`: the hidden view also restores its anchor when its snapshot changes (Story 4 sc. 4).
- [ ] T066 [US4] Implement T065 in `src/files/usePagedQuery.ts`, `src/screens/GalleryScreen.tsx`, `src/screens/ListScreen.tsx` and `src/screens/FilesScreen.tsx` (research R8). The anchor is used once per snapshot change.
- [ ] T067 [US4] Create `MAESTRO/polish/07-results-updated-keeps-place.yaml` per the mapping row (note the first tile and the first list row, rescan from the Scan tab, back to Files: `Results updated`, the noted row at the top, then Gallery: the noted tile at the top). Delete `MAESTRO/browse/05-results-updated.yaml` and its `flowsOrder` entry; register 07 after 06. Pass on API 31 and API 36.

**Checkpoint**: the place is kept in both views; flow 07 passes.

---

## Phase 9: User Story 7 — The app has its own icon (Priority: P2)

**Goal**: SyncScope's own adaptive, monochrome and legacy icons, generated from the owner's image.

**Independent Test**: the release-smoke run checks the APK's adaptive icon; the manual check in
quickstart §3 covers launcher shapes and themed icons.

- [ ] T068 [P] [US7] Write the failing script-contract test in `scripts/validation/validation-infrastructure.test.mjs`: run `scripts/icon/generate-icons.sh` on a 1024 × 1024 test image generated with `magick` into a scratch copy of `android/app/src/main/res`. It must produce `mipmap-anydpi/ic_launcher.xml` and `ic_launcher_round.xml` (each referencing a foreground, `@color/ic_launcher_background` and a `<monochrome>` layer); `values/ic_launcher_background.xml`; per density mdpi…xxxhdpi `ic_launcher.png` and `ic_launcher_round.png` at 48 dp (48, 72, 96, 144, 192 px) and `ic_launcher_foreground.png` / `ic_launcher_monochrome.png` at 108 dp (108, 162, 216, 324, 432 px); and `assets/icon/play-store-512.png` at 512 × 512. A missing `magick` makes the script exit non-zero with a clear message, and the test is skipped with a notice.
- [ ] T069 [US7] Create `scripts/icon/generate-icons.sh <source.png> [--background '#RRGGBB'] [--res <dir>] [--assets <dir>]` (POSIX `sh`, `set -eu`, ImageMagick 7) to make T068 pass (research R17): the foreground scaled into the central 66 dp safe zone, the monochrome layer as the foreground's alpha filled white, legacy square and round PNGs, the 512 px image, and the source copied to `assets/icon/source.png`.
- [ ] T070 [US7] **Blocked on the owner's image.** Run the script on it with the chosen background colour, commit the outputs in `android/app/src/main/res/` and `assets/icon/`, and check that `android/app/src/main/AndroidManifest.xml` references `@mipmap/ic_launcher` and `@mipmap/ic_launcher_round`. Extend the T068 test: no file under `res/mipmap-*` has the hash of a default React Native icon (SC-009).
- [ ] T071 [US7] Extend `release-smoke` in `scripts/validation/android-flow.sh`: `aapt2 dump badging app-release.apk` reports `application-icon` as `ic_launcher.xml`; extend `MAESTRO/mvp/90-release-smoke.yaml` so the launcher shows the app under its label. Assertions in `validation-infrastructure.test.mjs` for the new runner step.
- [ ] T072 [US7] Manual icon check (quickstart §3): launcher, app drawer, recent apps and Settings › Apps on API 31; circle, squircle and square shapes; themed icons on API 33+. Record the result in `specs/007-sort-scroll-remote-folders/quickstart.md` §3.

**Checkpoint**: the release APK shows the SyncScope icon.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: docs, the a11y sweep and the full gate.

- [ ] T073 [P] `CHANGELOG.md` `Unreleased`, per plan › Constitution Check VI: Added (sort by name, date or size; a scrollbar with date, letter and size labels; several server folders with a folder browser; the app icon); Changed (the gallery / list switch is a drop-down, and sort and view are remembered; Settings › Folders is now Device folders; a scan that cannot read some server folders completes and marks the affected files as unknown; name order ignores case and accents; scan store schema version 5); Fixed (the Files views no longer jump to the top when results update; adding a device folder with thousands of files — worded after the T005 branch).
- [ ] T074 [P] Create `docs/decisions/0022-several-remote-folders-partial-scan.md` (D022: several remote folders and the partial-scan rule, research R11, R14; amends the one-remote-root scope) and add it to `docs/decisions/README.md`.
- [ ] T075 [P] Update `docs/scope.md` (one server, several folders), `docs/overview.md` (glossary "Remote folders"; Source › "Settings › Device folders"; sorting and the scrollbar), `docs/sync-and-deletion-safety.md` (unread folders produce unknown, never not backed up), `docs/architecture.md` (schema v5, contract v6 methods, `ScrollBands`, segmented paging, the folder browser) and `docs/protocols.md` (folder listing for the browser).
- [ ] T076 [P] `README.md` user sections: "Sort and jump through your files", "Set up your server" (several folders, Browse), "Pick folders" (Device folders, the large-folder hint), "Read the results" (unread server folders).
- [ ] T077 [P] `DEVELOPMENT.md`: the icon script and its ImageMagick prerequisite; the `polish/` flows; the new device fixtures and `scroll-manifest.sh`; the repeated `root` in the debug seam.
- [ ] T078 [P] Spec follow-ups (plan › Integration closure): note in `specs/008-tree-view-image-preview/spec.md` the view drop-down, sort contract, `getScrollIndex` / segmented reader and anchor restore it consumes, and that list rows have a fixed height; note in `specs/010-full-loop-release/spec.md` that snapshot retention must keep `remote_ambiguity.remotePath` for the active snapshot.
- [ ] T079 Extend `src/test-utils/__tests__/a11ySweep.test.tsx` (or each component test) so the sweep covers `SortMenu`, `ViewMenu`, `FastScroller`, placeholders, `RemoteFolderBrowser` and the RepositoryScreen folder controls (FR-017).
- [ ] T080 Run the full gate from quickstart §1 on API 31 and API 36: `pnpm lint && pnpm typecheck`, `pnpm test:ci`, `pnpm test:android:unit`, `pnpm e2e:android`, `pnpm e2e:android:release-smoke`. Fix any failure before marking done.
- [ ] T081 Manual walk-through on the owner's phone (quickstart §4, steps 1–7), done by the owner after T080; record the outcome in `specs/007-sort-scroll-remote-folders/quickstart.md` §4.

---

## Dependencies & Execution Order

### Phases

- **Setup (Phase 1)**: no dependencies. T005 (spike) needs T003 (`DCIM/Big`).
- **Foundational (Phase 2)**: after Setup. Blocks every story.
- **US1 (Phase 3)**: after Phase 2.
- **US3 (Phase 4)**: after Phase 2. Independent of US1.
- **US6 (Phase 5)**: after Phase 2 (T007 already rewords the contract action).
- **US5 (Phase 6)**: after T005 and US6 (T049 needs T047's `Device folders` label).
- **US2 (Phase 7)**: after US1 (native sorts, `sortName` cursor, `kind`, T027's list split).
- **US4 (Phase 8)**: after US2 (`anchorIndex` in T052/T053, segmented reader in T059).
- **US7 (Phase 9)**: T068/T069 any time; T070–T072 when the owner's image arrives.
- **Polish (Phase 10)**: after the stories it documents; T080, then T081, last.

### Within phases (beyond test-before-implementation)

- T001 → T002, T003 → T004. T003 → T005.
- T006 → T007 → T008 (same files). T008 → T009.
- T010 → T011 → T014. T012 → T013 → T014.
- T015, T016 → T017 → T018, T020. T019 independent of T017. T021, T022 → T023 → T024 → T025.
- T017 → T027 (needs `kind`).
- T030 → T031 → T033. T032 → T033. T034 → T035 → T037. T036 → T037. T038 → T039.
- T033, T037, T039 → T040 → T042, T043 → T044. T040 → T045.
- T046 after T044, T045 and T039.
- T050 → T051 → T053. T052 → T053 → T054, T055 → T056.
- T058 → T059 → T062, T063. T060 → T061 → T062, T063.
- T065 → T066 → T067.
- T068 → T069 → T070 → T071.

### Story completion order

US1 and US3 in parallel, with US6 and then US5 alongside (both small). Then US2, then US4. US7 whenever the
image arrives.

## Parallel Examples

**Phase 2**: T010 (SortName test) in parallel with T006–T009 (contract) and T012 (schema tests).

**US1**: T015 and T016 together; T019, T021 and T022 alongside T017; T024 and T026 together after T023.

**US3**: T030, T034, T036 and T038 at once (different test files); then T031, T035 in parallel; on the JS
side T041, T042 and T043 together after T040.

**US2**: T050 and T052 together; T056, T057, T058 and T060 together on the JS side while T051/T053 run.

**Polish**: T073–T078 at once.

## Implementation Strategy

1. **Foundation**: Phases 1–2 (fixtures, spike result, contract v6, schema v5, `sortName`).
2. **First increment (US1)**: sorting in both views, remembered. Validate with flows 01–02. This is the
   MVP of the feature: the biggest files are two taps away (SC-002).
3. **Several folders (US3)**: the second P1 payoff; validate with flows 04–06 and the release update.
4. **Wording, then the small P1 fix (US6, US5)**: the `Device folders` rename, then the large-folder branch
   from the spike and flow 08.
5. **Scrollbar, then keeping the place (US2 → US4)**: US4 is a P1 bug but rides on US2's index and
   segmented reader; land T058/T059 with every existing `usePagedQuery` test still green before touching
   the views.
6. **Icon (US7)** when the image arrives; **Polish** and the full gate last.

Commit after each task or tight group, as in features 002–006. Stop at any checkpoint to validate the
story on its own.

Feature 007 merges as **one pull request**, as 006 did. The `CHANGELOG.md`, `./docs`, `README.md` and
`DEVELOPMENT.md` updates of Phase 10 therefore land in the same change as the code they describe
(Principles VI–IX). If a story is ever merged on its own, move its part of T073–T077 into that story.
