---

description: "Task list for feature 005: Gallery View, Browsable List, Filtering and Material 3 Shell"
---

# Tasks: Gallery View, Browsable List, Filtering and Material 3 Shell

**Input**: Design documents from `/specs/005-gallery-list-filtering/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/cloudsync-browse.md](./contracts/cloudsync-browse.md),
[contracts/maestro-browse.md](./contracts/maestro-browse.md), [quickstart.md](./quickstart.md)

**Tests**: REQUIRED. Constitution Principle IV requires unit tests for all code, in the same change.
Principle V requires every acceptance scenario of the P1 story to map to a named Maestro flow on API 31 and
API 36 against the live containers. Each test task sits next to the implementation it verifies: write the
test first and make sure it fails.

**Organization**: the spec has one user story (US1, P1). Phase 2 holds the contract version 4 surface, the
schema version 3 change and the Material 3 shell that every part of US1 builds on. The story itself is
split into sub-phases (native reads → native image handle → JS hooks → UI → e2e), each with a checkpoint.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: the user story the task belongs to (US1)
- Paths are relative to the repository root. Kotlin package root:
  `android/app/src/main/java/com/syncscope/` (abbreviated `KT/`); JVM tests:
  `android/app/src/test/java/com/syncscope/` (abbreviated `KTEST/`).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the remote and device fixtures and the Maestro workspace entries that the e2e proof depends on.
No production code.

- [ ] T001 [P] Add a contract test for the new remote fixtures in `scripts/validation/validation-infrastructure.test.mjs` (research R13). Seeding a scratch root with `scripts/validation/fixture-seed.sh` must produce:
  - `gallery/sunset.png`, `gallery/beach.png` and `gallery/album/forest.png`, each a valid PNG (it starts with the bytes `89 50 4E 47 0D 0A 1A 0A`), the three files with pairwise different bytes;
  - `gallery-partial/` with the same three files, byte-identical to `gallery/`, plus `gallery-partial/restricted/hidden.png`;
  - `gallery-partial/restricted` with mode `700` and every other new directory `755`;
  - every new file with mtime `@1704067200`.

  `fixture-manifest.mjs` must still list the whole tree. The test must fail until T002 lands.
- [ ] T002 Extend `scripts/validation/fixture-seed.sh` to make T001 pass. Embed three tiny distinct PNGs (for example 2×2 px in three different solid colours) as base64 constants in the script and decode them with `base64 -d`; no image tool may be required. Name them `PNG_SUNSET`, `PNG_BEACH` and `PNG_FOREST`, and add a fourth, `PNG_TWIN`, whose **byte length differs** from `PNG_SUNSET` (for example 3×3 px; matching compares name, size and mtime, so an equal size would make the twin SYNCED), and a fifth, `PNG_HARBOR`, for T003. A script-contract assertion checks that the length of `PNG_TWIN` differs from that of `PNG_SUNSET`. Write `gallery/` and `gallery-partial/` as in T001 and set mtimes with `touch -d @1704067200`. Run `chmod 0700 "$root/gallery-partial/restricted"` **after** the existing `find … chmod 0755` line, as 004 does for `scan/partial/restricted`. `pnpm test:foundation` must pass.
- [ ] T003 Add contract assertions for the new device fixtures to `scripts/validation/validation-infrastructure.test.mjs` (same file as T001: do it after T001). `scripts/validation/device-fixtures.sh` must create the following, stay idempotent, and set every mtime with `touch -d @1704067200`:
  - `/sdcard/SyncScopeE2E/Gallery/` with `sunset.png`, `beach.png` and `album/forest.png`, byte-identical to the remote `gallery/` copies (so they come out SYNCED);
  - also in `Gallery/`: `harbor.png` (`PNG_HARBOR`), `album/notes.txt` (`gallery notes\n`) and `drafts/draft.png` (`PNG_HARBOR` bytes), all local only, so UNSYNCED;
  - `/sdcard/SyncScopeE2E/GalleryTwin/sunset.png` with `PNG_TWIN` bytes: a different **size** from the remote `sunset.png`, so UNSYNCED (not SYNCED), but the same name;
  - `/sdcard/SyncScopeE2E/GalleryBulk/` with `GALLERY_BULK_FILES` (default `2000`) copies of one PNG named `g0000.png` … `g1999.png`.

  The test must fail until T004 lands. The PNG constants must be shared with `fixture-seed.sh` through one sourced file `scripts/validation/fixture-images.sh` (Principle III), not copied.
- [ ] T004 Extend `scripts/validation/device-fixtures.sh` to make T003 pass. Source `scripts/validation/fixture-images.sh` (created here and also sourced by `fixture-seed.sh` from T002). Push each image once with `adb push` of a temp file. Generate GalleryBulk with one `adb shell` loop that `cp`s the pushed PNG, in the same style as 004's Bulk loop. `pnpm test:foundation` must pass.
- [ ] T005 [P] Create `validation/maestro/browse/.gitkeep`. In `validation/maestro/config.yaml`, add `- "browse/*"` under `flows:` after `- "scan/*"`. Do **not** add `flowsOrder` entries here: each flow is added by the task that creates it (T042–T046), so `pnpm e2e:android` never lists a missing file.
- [ ] T006 [P] Create `validation/maestro/subflows/open-files.yaml`. It taps the `Files` tab (left of `Scan`), waits up to 15 s for `Gallery view` to be visible, then waits until `Loading files` is not visible. Use the same header comment style as `subflows/open-scan.yaml`.

**Checkpoint**: fixtures seed on the containers and the device; the browse workspace is registered.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the contract version 4 surface, the Room schema version 3 and the Material 3 shell that the
reads, the hooks and the screens all depend on.

**⚠️ CRITICAL**: no Phase 3 work can begin until this phase is complete.

### Contract version 4 (TS and Kotlin in lockstep, parity-guarded)

- [ ] T007 Bump the contract to version 4 on both sides in one change. Set `CLOUD_SYNC_CONTRACT_VERSION = 4` in `src/native/CloudSyncContracts.ts` and `CONTRACT_VERSION = 4` in `KT/bridge/CloudSyncContracts.kt`. Insert `IMAGE_UNAVAILABLE` **just before `INTERNAL_ERROR`** in both code lists, with message "This image could not be read on the device." and action "Check that the folder is still available, then rescan." ([contracts/cloudsync-browse.md](./contracts/cloudsync-browse.md#new-error-code)). Update `KTEST/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts` in the same task.
- [ ] T008 Add the v4 DTO changes to `src/native/CloudSyncContracts.ts`, exactly as in [contracts/cloudsync-browse.md](./contracts/cloudsync-browse.md#dtos-typescript-cloudsynccontractsts):
  - `FileEntryDto` gains `nameInOtherSource: boolean` (doc: "GALLERY reads: a FILE with the same name exists in another source of this snapshot … Always false for LIST reads") and `matchingFileCount: number | null` (doc: "DIRECTORY rows: files anywhere beneath it that match the query's filter. 0 means the row is shown dimmed. null for FILE rows and for snapshots written before contract 4");
  - add `LocalImageSpec { maxEdgePx: number }`, `LocalImageHandleDto { uri: string }`, `LocalImageHandleOk` and `LocalImageHandleResult`;
  - add `LOCAL_IMAGE_MIN_EDGE_PX = 64`, `LOCAL_IMAGE_MAX_EDGE_PX = 2048`, `GALLERY_THUMBNAIL_EDGE_PX = 256`, and `clampImageEdge(px)`, which clamps to 64…2048 and maps a non-finite value to 256.

  Add the Kotlin mirror `object LocalImageSpec { const val MIN_EDGE_PX = 64; const val MAX_EDGE_PX = 2048; fun bounded(px: Int): Int }` in `KT/bridge/CloudSyncContracts.kt`, and extend the parity test to check that both clamps agree on `-1, 0, 63, 64, 256, 2048, 2049`. Add type-level and clamp tests to `src/native/__tests__/CloudSyncContracts.test.ts`.
- [ ] T009 Add the `getLocalImageHandle(snapshotId, entryId, spec: LocalImageSpec): Promise<LocalImageHandleResult>` wrapper to `src/native/CloudSync.ts`. Follow the existing wrappers: check `contractVersion` and `status`, and turn any unexpected shape into a typed `INTERNAL_ERROR`, never a throw. Send `maxEdgePx` through `clampImageEdge`. Add tests to `src/native/__tests__/CloudSync.test.ts` covering ok, an `IMAGE_UNAVAILABLE` error, a malformed envelope, and a clamped edge. Leave the Codegen spec `src/native/specs/NativeCloudSync.ts` unchanged, since its signature already fits; confirm `NativeCloudSyncBoundary.test.ts` still passes.

### Schema version 3 (directory descendant counts)

- [ ] T010 [P] Add a failing migration test in `KTEST/persistence/MigrationTest.kt`. Migrate a version-2 database holding one `DIRECTORY` and one `FILE` row of a published snapshot to version 3. Both rows must survive unchanged, and `descSynced`, `descUnsynced` and `descUnknown` must read `NULL` on both. Extend `KTEST/persistence/SchemaContractTest.kt` so that version 3 has the three columns as nullable `INTEGER`, with no new index.
- [ ] T011 Add `descSynced: Long?`, `descUnsynced: Long?` and `descUnknown: Long?` (default `null`) to `LocalNodeEntity` in `KT/persistence/Entities.kt`. The KDoc reads: "`DIRECTORY` rows: number of `FILE` rows anywhere beneath it with status …; `NULL` on `FILE` rows and on rows written before version 3". Bump `KT/persistence/SyncScopeDatabase.kt` to `version = 3` with `AutoMigration(from = 2, to = 3)`. Build once to export `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/3.json` and commit it. Make T010 pass. Fix every `LocalNodeEntity(...)` construction in tests and `KTEST/persistence/PersistenceTestFixtures.kt` / `KTEST/scan/ScanTestFixtures.kt` that breaks.
- [ ] T012 Add failing tests to `KTEST/scan/DirectoryRollupTest.kt` for the new per-directory counts returned by `finish()`:
  - a file two levels deep counts in both ancestors;
  - an empty directory gets `0 / 0 / 0`;
  - a file directly under a source root (`parentId == null`) counts in no directory;
  - **invariant**: for a generated tree, the sum of a source's top-level directory counts plus its top-level files per status equals its per-status file total;
  - the existing worst-of status and `issueCode == null` expectations still hold.
- [ ] T013 Extend `KT/scan/DirectoryRollup.kt` to make T012 pass. `Verdict` stays as it is. `finish()` returns, per directory, the status plus `DescendantCounts(synced: Long, unsynced: Long, unknown: Long)`, for example as a new `DirectoryResult(verdict, counts)`. Count each recorded file once into every ancestor on its parent walk. Use a separate full walk, not the early-exit `raise`, because counts must reach every ancestor even when the status is already worst. Keep the cycle check.
- [ ] T014 Make `KT/scan/ScanEngine.kt` write the counts: where `directories` are built from `verdicts` (after `acc.rollup.finish()`), copy `descSynced`, `descUnsynced` and `descUnknown` from the result. Add a case to `KTEST/scan/ScanEngineTest.kt` (FULL and LOCAL_REFRESH): a published snapshot has non-null counts on every `DIRECTORY` row and null counts on every `FILE` row, and the counts match a hand-computed fixture.

### Material 3 shell (FR-004, research R9)

- [ ] T015 [P] Create `src/theme/spacing.ts` with `spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const`, `density = { tileGap: 2, rowHeight: 56, chipHeight: 32 } as const` and `gridColumns = 3`. Create `src/theme/theme.ts`, which exports `paperThemeFor(isDark)` (`MD3DarkTheme` / `MD3LightTheme`) and `navigationThemeFor(isDark, paperTheme)`; move the navigation-theme mapping out of `App.tsx` verbatim. Update `App.tsx` to use both. Add `src/theme/__tests__/theme.test.ts`, which checks that the navigation colours equal the paper theme's `background`, `surface`, `primary` and `onSurface` in both modes.
- [ ] T016 [P] Create `src/theme/statusLabels.ts` as the one source of truth for user-facing status and filter text:
  - `STATUS_LABEL: Record<FileStatus, string>` = `{ SYNCED: 'Synced', UNSYNCED: 'Unsynced', UNKNOWN: 'Unknown' }`;
  - `FILTER_LABEL: Record<FileFilter, string>` = `{ ALL: 'All', SYNCED: 'Synced', UNSYNCED: 'Unsynced', ISSUES_UNKNOWN: 'Issues or unknown' }`;
  - `chipCount(filter, counts)`, implementing the chip model in [data-model.md](./data-model.md#chip-model): `ALL` = sum, `ISSUES_UNKNOWN` = `counts[UNKNOWN] ?? 0`, and a null `counts` → `null`.

  Unit-test it in `src/theme/__tests__/statusLabels.test.ts`. Replace any duplicated status strings in `src/scan/ScanSummaryCard.tsx` with `STATUS_LABEL` if the text is identical; if it differs, leave it and note why in the test file (Principle III, coincidental duplication).
- [ ] T017 [P] Create `src/files/a11y.ts` with the label builders from [contracts/maestro-browse.md](./contracts/maestro-browse.md#selectors), each pure:
  - `filterChipLabel(filter, count)` → `Filter All, 6`;
  - `galleryTileLabel(name, status, originAlias?)` → `sunset.png, Unsynced, from GalleryTwin`;
  - `originBadgeLabel(alias)` → `Origin GalleryTwin`;
  - `folderRowLabel(name, matching)` → `Folder album, 2 matching`, with `, no matches` appended when `matching === 0` and no count part when `matching` is null;
  - `fileRowLabel(name, status)`;
  - `breadcrumbLabel(name)` → `Breadcrumb All folders`.

  Unit-test every builder in `src/files/__tests__/a11y.test.ts`.
- [ ] T018 (after T015 and T016) Set `'react-native/no-inline-styles': 'error'` in `.eslintrc.js`. Move the existing inline colour styles in `src/screens/ScanScreen.tsx` (the `style={{color: theme.colors.onErrorContainer}}` uses), `src/scan/ScanSummaryCard.tsx` (`style={{color: theme.colors.error}}`) and `src/sources/SourcesSection.tsx` (`style={{color: chipColors.color}}`) to a themed `StyleSheet` created from `useTheme()` (for example a `useMemo` of `StyleSheet.create`), or to Paper's `textColor` / `theme` props. Rendering must be unchanged: the existing `ScanScreen`, `ScanSummaryCard` and `SourcesSection` tests must pass untouched. `pnpm lint` must pass with zero warnings.
- [ ] T019 Add `src/test-utils/a11ySweep.ts`. Given a Testing Library render result, it finds every node with `onPress` or `accessibilityRole` in `button | link | checkbox | togglebutton | tab`, and fails with the node's text when its `accessibilityLabel` is missing or empty. Add `src/test-utils/__tests__/a11ySweep.test.tsx`, which proves that it fails on an unlabeled `Pressable` and passes on a labeled one.

**Checkpoint**: contract v4 compiles on both sides with parity green; schema 3 migrates; scans write the
descendant counts; theme, labels and the a11y sweep exist; lint forbids inline styles. `pnpm lint &&
pnpm typecheck && pnpm test:ci && pnpm test:android:unit` pass.

---

## Phase 3: User Story 1 - Browse and filter the scan results (Priority: P1) 🎯 MVP

**Goal**: the Files tab shows a virtualized gallery and a browsable list of the active snapshot. One
filter applies to both, chip counts agree with the snapshot, duplicate tiles carry origin badges, folders
never dead-end under a filter, and a rescan reloads the view without mixing snapshots.

**Independent Test**: the five Maestro flows in
[contracts/maestro-browse.md](./contracts/maestro-browse.md#acceptance-scenario-mapping) pass on API 31
and API 36 against the live SFTP container.

### 3a. Native read rules (`SnapshotStore`, `ScanOperations`)

- [ ] T020 [P] [US1] Add failing tests to `KTEST/persistence/SnapshotStoreTest.kt` for the read rules in [data-model.md](./data-model.md#read-rules-changes-to-snapshotstorequeryfilepage), using a fixture of two sources, nested directories and mixed statuses:
  1. **Directories ignore the filter.** `queryFilePage` with a `parentId`, or `topLevelOnly`, under `SYNCED` returns a directory whose descendants are all UNSYNCED, with `matchingFileCount = 0`. FILE rows are still narrowed by the filter.
  2. **`matchingFileCount` per filter.** `ALL` = `descSynced + descUnsynced + descUnknown`, `SYNCED` = `descSynced`, `UNSYNCED` = `descUnsynced`, `ISSUES_UNKNOWN` = `descUnknown`. It is `null` on FILE rows, and `null` on a directory row whose counts are `NULL` (pre-v3).
  3. **Gallery is images only.** `view = GALLERY` returns `image/png` but not `video/mp4`, `text/plain` or directories.
  4. **Count scope.** First-page `counts` ignore `filter`, `parentId` and `search`, count `kind = 'FILE'` only, add `mimeType LIKE 'image/%'` for GALLERY, and honour `sourceId`.
  5. **`nameInOtherSource`.** In GALLERY it is true for `a.png` in source 1 when source 2 also has a FILE `a.png`, and false when the twin is in the same source. It is case-sensitive (`A.png` vs `a.png` → false), and false for every LIST read.
  6. **Paging.** Keyset paging across a page boundary still returns every row once under each rule.
  7. **Tokens.** A page token minted under the old rules is still accepted, since the fingerprint is unchanged.
  8. **Performance budget** (plan Performance Goals), in `KTEST/persistence/SnapshotQueryPerformanceTest.kt`: insert 50 000 FILE rows over 2 sources (half images, 5 % name twins across sources) and 2 000 directories into an in-memory Room database. The first GALLERY page (100 rows + counts + duplicate probe) and the first `queryTreeChildren` page under `SYNCED` each complete in under 300 ms, as the median of 5 runs after one warm-up. If the budget is missed or flaky on CI, record the measured value in the test file and escalate to the user; never raise the limit silently.
- [ ] T021 [US1] Implement the read rules in `KT/persistence/SnapshotStore.kt` and `KT/persistence/Daos.kt` to make T020 pass:
  - **Filter clause.** Apply the filter clause to `kind = 'FILE'` rows only *when `parentId` is set or `topLevelOnly`* (`(kind = 'DIRECTORY' OR <filter>)`). `queryFiles` without a parent keeps 004's behaviour.
  - **Gallery clause.** Change it to `kind = 'FILE' AND mimeType LIKE 'image/%'`.
  - **Counts.** Replace `statusCounts(snapshotId)` with a `@RawQuery` (or two `@Query` variants) `statusCounts(snapshotId, imagesOnly: Boolean, sourceId: String?)`.
  - **Duplicate probe.** For GALLERY, select `EXISTS (SELECT 1 FROM local_node d WHERE d.snapshotId = local_node.snapshotId AND d.kind = 'FILE' AND d.name = local_node.name AND d.sourceId <> local_node.sourceId) AS nameInOtherSource` alongside the row, through a small result class (for example `LocalNodeRow(@Embedded node, nameInOtherSource: Boolean)`).
  - **`FileEntry`.** Add `nameInOtherSource: Boolean` and `matchingFileCount: Long?`, the latter computed from the filter and the `desc*` columns, with `null` if any is `NULL`.

  Keep the fingerprint unchanged.
- [ ] T022 [US1] Map the two new fields in `KT/bridge/ScanOperations.kt` `page(...)`: `putBoolean("nameInOtherSource", …)` and `putNullableNumber("matchingFileCount", …)`. Extend `KTEST/bridge/ScanOperationsTest.kt` so that both fields appear on every entry (`false` / `null` on LIST file rows), and no entry contains a `documentUri`, `documentId` or path key.

**Checkpoint**: JVM tests green; `queryFiles` / `queryTreeChildren` serve the v4 rules.

### 3b. Native local image handle (`getLocalImageHandle`, research R7)

- [ ] T023 [P] [US1] Add failing tests in `KTEST/image/LocalImageStoreTest.kt` (Robolectric) behind a small seam `interface ThumbnailSource { fun load(documentUri: String, edgePx: Int): Bitmap }`, with a fake:
  1. A first call decodes once and writes `cacheDir/thumbnails/<sha256(entryId + "|" + edge)>.jpg`; a second call with the same `(entryId, edge)` returns the same URI without decoding.
  2. The returned `uri` starts with `file://` and contains neither the document URI nor the document ID.
  3. The edge is clamped through `LocalImageSpec.bounded` (10 → 64, 5000 → 2048).
  4. The pure function `sampleSizeFor(width, height, edge)` returns the largest power of two keeping the long edge ≥ `edge` after division, and 1 when the image is already small: (4000, 3000, 256) → 8, (300, 200, 256) → 1, (256, 256, 256) → 1, (3000, 4000, 256) → 8.
  4b. In `KTEST/image/ContentResolverThumbnailSourceTest.kt` (Robolectric, with a shadowed `ContentResolver`), an `UnsupportedOperationException` from `loadThumbnail` makes the production `ThumbnailSource` fall back to `BitmapFactory` decoding with `sampleSizeFor`, and the returned bitmap's long edge is ≤ `edge`.
  5. `FileNotFoundException` / `SecurityException` / a null bitmap → `ImageUnavailable`.
  6. At most 4 loads run at once (use a gate in the fake and count the concurrent entries).
- [ ] T024 [US1] Implement `KT/image/LocalImageStore.kt` to make T023 pass:
  - the production `ContentResolverThumbnailSource` calls `ContentResolver.loadThumbnail(Uri.parse(documentUri), Size(edge, edge), null)` and, on `UnsupportedOperationException`, reads the bounds (`inJustDecodeBounds`), decodes through `openInputStream` with `inSampleSize = sampleSizeFor(w, h, edge)` and scales the result down so the long edge is ≤ `edge`;
  - `sampleSizeFor` is a top-level pure function in the same file;
  - it writes JPEG quality 85 atomically (temp file + rename) into `cacheDir/thumbnails/`;
  - it runs on `Dispatchers.IO.limitedParallelism(4)`;
  - it never logs the document URI.
- [ ] T025 [US1] Add the snapshot lookup for images: a DAO query in `KT/persistence/Daos.kt` and a `SnapshotStore.imageEntry(snapshotId, entryId)` that returns the row's `documentUri` and `mimeType` only when the snapshot is publishable and the row is a `FILE`. It throws `SnapshotNotFoundException` for an unpublished snapshot. Test it in `KTEST/persistence/SnapshotStoreTest.kt`: published file, directory, unknown entry, staged snapshot.
- [ ] T026 [US1] Add `imageHandle(snapshotId, entryId, spec: ReadableMap)` to `KT/bridge/ScanOperations.kt` and wire `getLocalImageHandle` in `KT/bridge/CloudSyncModule.kt`, replacing `notImplemented`. Update the class KDoc that lists the methods not yet built. Follow the [behaviour table](./contracts/cloudsync-browse.md#getlocalimagehandlesnapshotid-entryid-spec):
  - an unpublished snapshot → `SNAPSHOT_NOT_FOUND`;
  - an entry that is unknown, a `DIRECTORY`, or not `image/*` → `INVALID_QUERY` with `field: "entryId"`;
  - a missing or non-numeric `maxEdgePx` → `INVALID_QUERY` with `field: "maxEdgePx"`;
  - `ImageUnavailable` → `IMAGE_UNAVAILABLE`;
  - otherwise `ok` with `handle: { uri }`.

  Extend `KTEST/bridge/ScanOperationsTest.kt` and `KTEST/bridge/CloudSyncModuleTest.kt` (remove `getLocalImageHandle` from the still-`NOT_IMPLEMENTED` list and keep `getSettings`, `setIncludeHidden`, `prepareLocalDeletion` and `executeLocalDeletion` in it).

**Checkpoint**: `pnpm test:android:unit` green; the bridge serves thumbnails from local storage only.

### 3c. JS state and hooks (`src/files/`)

- [ ] T027 [P] [US1] Create `src/files/FilesProvider.tsx` and `src/files/useFiles.ts`. The context value is `{ view: 'GALLERY' | 'LIST', filter: FileFilter, setView, setFilter }`, initially `{ GALLERY, ALL }`, held in React state and not persisted (research R10). `useFiles()` throws outside the provider, like `useScan`. Test in `src/files/__tests__/FilesProvider.test.tsx`.
- [ ] T028 [P] [US1] Write failing tests in `src/files/__tests__/usePagedQuery.test.tsx` for `usePagedQuery({ snapshotId, read, query })`. `read` is an injected `(snapshotId, query, token) => Promise<QueryFilesResult>`, so both `queryFiles` and `queryTreeChildren` fit. The tests follow the state machine in [data-model.md](./data-model.md#filepage-spec-entity-as-held-by-usepagedquery):
  1. Page 1 loads entries and `counts`. `loadMore()` appends page 2 and keeps page-1 `counts`. `loadMore()` with no token, or while loading, is a no-op.
  2. A change of `snapshotId` while rows are shown drops the rows, reloads page 1 for the new ID and reports `snapshotChanged: true` once (the "Results updated" signal). A change while nothing was shown does not report it.
  3. A late page-2 response for the old `snapshotId` or the old query is ignored and never appended.
  4. A change of `query` (filter or parent) drops the rows and reloads, with no `snapshotChanged`.
  5. `SNAPSHOT_NOT_FOUND`, `PAGE_TOKEN_MISMATCH` or `STALE_GENERATION` from `read` calls the injected `onSnapshotLost()` once (wired to `useScan().refresh`) and reloads after `snapshotId` updates. Any other error sets `phase: 'error'` with the `CloudSyncError` and offers `retry()`.
  6. `snapshotId == null` stays `idle` and never calls `read`.
- [ ] T029 [US1] Implement `src/files/usePagedQuery.ts` to make T028 pass. Request `pageSize: 100`. Guard responses with a request sequence number plus the `(snapshotId, queryKey)` they were issued for, where `queryKey` is a stable JSON of the query. Expose `{ entries, counts, phase, error, loadMore, retry, snapshotChanged, acknowledgeSnapshotChange }`. Add a KDoc stating that 006's tree view reuses it.
- [ ] T030 [P] [US1] Write failing tests in `src/files/__tests__/useListNavigation.test.tsx` for `useListNavigation`, with the location model in [data-model.md](./data-model.md#navigation-stack-list-view):
  1. It starts at `{ kind: 'sources' }`. `openSource(sourceId, alias)` → folder at the source root (`path[0].entryId === null`). `openFolder(entryId, name)` pushes. `goTo(index)` truncates, and `goTo(-1)` returns to sources.
  2. `breadcrumb` yields `All folders`, then the alias, then each name.
  3. On a `snapshotId` change, `relocate()` walks the names with an injected `findChildDirectory(snapshotId, sourceId, parentId, name)`. When every level is found, the path holds the new entry IDs. When level 2 of 3 is missing, it stops at level 1. When the source is no longer in the sources list, it returns to `{ kind: 'sources' }`.
  4. Name matching is exact (`album` does not match `album2`, which a `LIKE` search would also return).
  5. The exact match is on page 2 of the search results (page 1 holds 200 other names containing `a`): relocation still finds it, and gives up only after the last page.
- [ ] T031 [US1] Implement `src/files/useListNavigation.ts` to make T030 pass. Implement the production `findChildDirectory` with `queryTreeChildren(snapshotId, parentId, { filter: 'ALL', view: 'LIST', sort: 'NAME_ASC', sourceId, search: name, pageSize: 200 })`, keeping the `DIRECTORY` row whose `name === name` (research R2). `search` is a substring match, so keep following `nextPageToken` until an exact match is found or no token remains; never conclude "missing" from page 1 alone. Add a KDoc stating that 006's tree view reuses the stack and breadcrumb.
- [ ] T032 [P] [US1] Create `src/files/useLocalImage.ts`. `useLocalImage(snapshotId, entryId, edge = GALLERY_THUMBNAIL_EDGE_PX)` returns `{ uri: string | null, failed: boolean }`. It calls `getLocalImageHandle` once per `(snapshotId, entryId, edge)` and ignores the result after unmount. Test in `src/files/__tests__/useLocalImage.test.tsx` covering ok, `IMAGE_UNAVAILABLE` → `failed`, and unmount before resolve (no state update).
- [ ] T033 [P] [US1] Create `src/files/useSourceAliases.ts`, which returns a `Map<sourceId, alias>` from `listSources` (reuse the read in `src/sources/useSources.ts`; do not duplicate its envelope handling) and refreshes when the active snapshot changes. Test in `src/files/__tests__/useSourceAliases.test.tsx`.

**Checkpoint**: Jest green for every hook; no UI yet.

### 3d. UI (`src/files/`, `src/screens/`)

- [ ] T034 [P] [US1] Create `src/files/StatusChip.tsx`: a small, non-interactive Paper `Chip` (or `Text` with an icon) that shows `STATUS_LABEL[status]`, with a distinct icon per status (`check-circle-outline`, `cloud-off-outline`, `help-circle-outline`) and colours from the theme only. Export it for 007's status-aware rendering. Test in `src/files/__tests__/StatusChip.test.tsx`.
- [ ] T035 [P] [US1] Create `src/files/FilterChips.tsx`: four Paper `Chip`s in `ALL`, `SYNCED`, `UNSYNCED`, `ISSUES_UNKNOWN` order, with `selected` from `useFiles().filter`, `onPress` → `setFilter`, the text `FILTER_LABEL[f]` plus the count from `chipCount` (no count while `counts` is null), and `accessibilityLabel` from `filterChipLabel`. Spacing comes from `src/theme/spacing.ts`. Test in `src/files/__tests__/FilterChips.test.tsx`: counts render, a press changes the filter, labels are exact, and the a11y sweep (T019) passes.
- [ ] T036 [P] [US1] Create `src/files/GalleryTile.tsx`: a fixed square (`(screenWidth - (gridColumns - 1) * density.tileGap) / gridColumns`). It shows the `useLocalImage` thumbnail, a placeholder while loading, and an `image-broken-variant` icon when it failed, with a `StatusChip` overlay. When `entry.nameInOtherSource` is true and the alias is known, it also shows an origin badge (Paper `Badge` or small `Chip`, `accessibilityLabel` `originBadgeLabel(alias)`). The tile's `accessibilityLabel` comes from `galleryTileLabel(name, status, nameInOtherSource ? alias : undefined)`. Test in `src/files/__tests__/GalleryTile.test.tsx`: there is no badge when `nameInOtherSource` is false, the badge shows the alias, the broken-image state, and the a11y sweep passes.
- [ ] T037 [US1] Create `src/screens/GalleryScreen.tsx`:
  - a `FlatList` with `numColumns={gridColumns}`, `getItemLayout` for the fixed tile size, `onEndReached` → `loadMore`, and `windowSize={7}` / `maxToRenderPerBatch={30}` / `removeClippedSubviews`;
  - rows from `usePagedQuery` with `read = queryFiles` and query `{ filter, view: 'GALLERY', sort: 'TIME_DESC', pageSize: 100 }` (clarification 5);
  - an empty state `No files match this filter` when page 1 is empty, `No scan results yet` when there is no active snapshot, and a `Loading files` indicator during the first load;
  - an error state with the error's message and action and a `Retry` button.

  It reports `counts` up to `FilesScreen` through a prop callback. Test in `src/screens/__tests__/GalleryScreen.test.tsx` with a mocked `CloudSync`: the query is sent as specified, `loadMore` runs on end reached, the empty, no-snapshot and error states render, and the a11y sweep passes.
- [ ] T038 [P] [US1] Create `src/files/Breadcrumb.tsx`: a horizontal `ScrollView` of Paper text `Button`s separated by `›` (`chevron-right` icon), each with `accessibilityLabel` from `breadcrumbLabel(name)` and `onPress` → `goTo(index)`; the last crumb is disabled. Test in `src/files/__tests__/Breadcrumb.test.tsx`.
- [ ] T039 [US1] Create `src/screens/ListScreen.tsx`:
  - **Sources level.** One Paper `List.Item` per source (alias, folder icon, `N matching`), with the count from page-1 `counts` of a `queryTreeChildren(snapshotId, null, { filter, view: 'LIST', sort: 'NAME_ASC', sourceId, pageSize: 1 })` read per source, summed by `chipCount(filter, counts)` (research R4). Rows with a count of 0 are dimmed (`opacity` from a themed style, e.g. `theme.colors.onSurfaceDisabled` text) and still pressable. `accessibilityLabel` comes from `folderRowLabel`.
  - **Folder level.** `usePagedQuery` with `read = (s, q, t) => queryTreeChildren(s, location.path.at(-1).entryId, q, t)` and query `{ filter, view: 'LIST', sort: 'NAME_ASC', sourceId, pageSize: 100 }`, with fixed-height `List.Item` rows (`density.rowHeight`) and the `Breadcrumb` on top.
    - Directory rows: folder icon, `N matching` from `matchingFileCount` (no count when null), dimmed when 0, and a press → `openFolder`.
    - File rows: name, size (formatted), modified time and a `StatusChip`, and no origin badge (FR-002).
    - An empty folder under a filter shows `No files match this filter`.

  Test in `src/screens/__tests__/ListScreen.test.tsx`: the sources level with counts, descending and ascending through the breadcrumb, dimming at 0 and at null, file rows without a badge, and the a11y sweep.
- [ ] T040 [US1] Create `src/screens/FilesScreen.tsx`:
  - a Paper `SegmentedButtons` with `Gallery view` and `List view` (`accessibilityLabel` on each), bound to `useFiles().view`;
  - `FilterChips` fed by the counts the active view reports;
  - the active view, both views mounted and only the active one visible, so each keeps its scroll position and location on switch;
  - a Paper `Snackbar` `Results updated` (`accessibilityLabel` the same, 4 s), shown when either view reports `snapshotChanged`, which then calls `acknowledgeSnapshotChange`. `ListScreen` runs `relocate()` before acknowledging.

  Test in `src/screens/__tests__/FilesScreen.test.tsx`: the view switch keeps the filter (FR-003), a snapshot change shows the snackbar once, and the a11y sweep passes.
- [ ] T041 [US1] Wire the Files tab in `src/navigation/AppNavigator.tsx`. Replace the `FilesScreen` placeholder function with `src/screens/FilesScreen.tsx` wrapped in `FilesProvider`. Delete `src/screens/PlaceholderScreen.tsx` and its test if nothing else imports them (Principle II). Update any navigator test that asserted the placeholder text.

**Checkpoint**: `pnpm lint && pnpm typecheck && pnpm test:ci` green; the app shows a working Files tab on an
emulator with a scanned snapshot.

### 3e. End-to-end flows (`validation/maestro/browse/`)

Each flow starts from `clearState`, configures SFTP through `subflows/configure-repository.yaml` with the
remote root named below (under the SFTP root, for example `${SFTP_ROOT}/gallery`), adds sources through
`subflows/add-scan-source.yaml`, runs `subflows/start-scan.yaml`, waits for the summary, then runs
`subflows/open-files.yaml`. Every assertion uses the labels in
[contracts/maestro-browse.md](./contracts/maestro-browse.md#selectors). Each task adds its flow to
`flowsOrder` in `validation/maestro/config.yaml` after the last `scan/*` entry.

- [ ] T042 [US1] Create `validation/maestro/browse/01-gallery-thousands.yaml` (`name: browse/01-gallery-thousands`). Use remote root `gallery` and source `SyncScopeE2E/GalleryBulk` only. Assert `Filter All, 2000`. Assert that a tile matching `g\d{4}\.png, Unsynced` is visible. Then run 15 `scroll` steps and assert again that a tile matching `g\d{4}\.png, Unsynced` is visible, proving that pages keep loading (scenario 1). Add it to `flowsOrder`.
- [ ] T043 [US1] Create `validation/maestro/browse/02-gallery-filters.yaml` (`name: browse/02-gallery-filters`). Use remote root `gallery` and sources `SyncScopeE2E/Gallery` and `SyncScopeE2E/GalleryTwin`. Assert:
  - chips `Filter All, 6`, `Filter Synced, 3`, `Filter Unsynced, 3`, `Filter Issues or unknown, 0`;
  - under All, `Origin Gallery` and `Origin GalleryTwin` are visible, and `beach.png, Synced` is visible with no `from` suffix (scenario 3);
  - tap `Filter Synced, 3`: `beach.png, Synced`, `forest.png, Synced` and `sunset.png, Synced, from Gallery` are visible and `harbor.png, Unsynced` is not;
  - tap `Filter Unsynced, 3`: `harbor.png, Unsynced`, `draft.png, Unsynced` and `sunset.png, Unsynced, from GalleryTwin` are visible;
  - tap `Filter Issues or unknown, 0`: `No files match this filter` (scenario 2).

  Add it to `flowsOrder`.
- [ ] T044 [US1] Create `validation/maestro/browse/03-gallery-issues-unknown.yaml` (`name: browse/03-gallery-issues-unknown`). Use remote root `gallery-partial` and the same two sources. Assert chips `Filter All, 6`, `Filter Synced, 3`, `Filter Unsynced, 0` and `Filter Issues or unknown, 3`. Tap Issues: `harbor.png, Unknown`, `draft.png, Unknown` and `sunset.png, Unknown, from GalleryTwin` are visible. Add it to `flowsOrder`.
- [ ] T045 [US1] Create `validation/maestro/browse/04-list-browse.yaml` (`name: browse/04-list-browse`). Use remote root `gallery` and both sources. The steps:
  1. Tap `List view`: `Filter All, 7` is selected, and `Folder Gallery, 6 matching` and `Folder GalleryTwin, 1 matching` are visible.
  2. Tap `Folder Gallery, 6 matching` → `Folder album, 2 matching` → `forest.png, Synced` and `notes.txt, Unsynced` are visible.
  3. Tap `Breadcrumb Gallery` → `Folder album, 2 matching` is visible again.
  4. Tap `Breadcrumb All folders` → `Folder Gallery, 6 matching` is visible (scenario 4).
  5. Tap `Filter Synced, 3`: `Folder Gallery, 3 matching` and `Folder GalleryTwin, 0 matching, no matches` are visible.
  6. Inside Gallery, `Folder drafts, 0 matching, no matches` is visible, and tapping it shows `No files match this filter` (clarification 3).
  7. Tap `Gallery view`: `Filter Synced, 3` is still selected, and `harbor.png, Unsynced` is not visible (FR-003).

  Add it to `flowsOrder`.
- [ ] T046 [US1] Create `validation/maestro/browse/05-results-updated.yaml` (`name: browse/05-results-updated`). Use remote root `gallery` and source `SyncScopeE2E/Gallery`. The steps:
  1. Tap `List view` → `Folder Gallery, 6 matching` → `Folder album, 2 matching`.
  2. Run `subflows/open-scan.yaml`, tap `Rescan from scratch` and wait for the summary.
  3. Tap the Files tab: `Results updated`, `Breadcrumb album` and `forest.png, Synced` are visible (FR-005, clarification 4).

  Add it to `flowsOrder`.
- [ ] T047 [US1] Run the whole Maestro workspace with `pnpm validation:services:start && pnpm e2e:android` on API 31 and API 36. The 003 and 004 flows must still pass, plus `browse/01`…`05`. If flow 01 is slow on API 31, do not lower `GALLERY_BULK_FILES` below 2 000 (spec scenario 1); tune the flow's waits and scroll count instead, and record the tuned values in `DEVELOPMENT.md`. Never weaken the other assertions. Run `pnpm validation:services:stop` and confirm that the protocol audit reports no content read or write. If a flow fails for a reason outside this feature, stop and escalate to the user.

**Checkpoint**: US1 is complete and independently proven: every acceptance scenario has a passing named flow
on both API levels.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T048 [P] Update `./docs` (Principle VII):
  - `docs/architecture.md`: the v4 read rules, the `image` package and the thumbnail cache path, the `src/theme/` and `src/files/` modules, and the delivery list where `getLocalImageHandle` moves from 006 to 005;
  - `docs/sync-and-deletion-safety.md`: how the four filters map to statuses, that `ISSUES_UNKNOWN` equals the UNKNOWN set, and that directories ignore filters and show matching counts;
  - `docs/overview.md`: the Files tab in the glossary/flow.

  Link to the spec and research rather than restating volatile details.
- [ ] T049 [P] Update `docs/decisions/0010-snapshot-paging-and-origin-badge.md`: refine the badge rule to "same file name in another source folder; the badge shows the source's alias" (005 clarification 1), and add 005 to Related. The paging contract is unchanged.
- [ ] T050 [P] Add a user-facing "Browse your files" section to `README.md`, after the Scan section (Principle VIII). Cover gallery vs list, what each of the four filters shows, what the origin badge means, why some folders are dimmed with "0 matching", and what "Results updated" means.
- [ ] T051 [P] Update `DEVELOPMENT.md` (Principle IX): the gallery fixtures (sources, remote roots `gallery` / `gallery-partial`, `scripts/validation/fixture-images.sh`, `GALLERY_BULK_FILES`), the `browse/` flows and their order, and the `react-native/no-inline-styles` lint rule with the themed-StyleSheet pattern.
- [ ] T052 [P] Add three entries under `Unreleased` in `CHANGELOG.md` (Principle VI): "Added: Files tab with a photo gallery and a folder list, filters for synced / unsynced / issues, and origin badges on same-named photos from different folders", "Changed: CloudSync contract version 4", and "Changed: scan store schema version 3".
- [ ] T053 [P] Cross-feature spec follow-ups from [plan.md](./plan.md#integration-closure), wording only:
  - in `specs/006-tree-view-image-preview/spec.md`, move `getLocalImageHandle` from "Provides" to "Consumes from feature 005", and note that the directory rule in FR-001's open question is settled by 005 (dimmed with a matching count, still navigable);
  - in `specs/008-full-loop-release/spec.md`, add the include-hidden-files setting (`getSettings` / `setIncludeHidden`, reassigned from 005) and snapshot retention (the plan's Risks) as items to specify.
- [ ] T054 Run the quickstart end to end ([quickstart.md](./quickstart.md) §1 and §2): `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:android:unit && pnpm test:foundation`, then `pnpm e2e:android` on API 31 and API 36. Record the results in the PR description. List quickstart §3 (manual aesthetic acceptance on a real device) as a checklist item for the human reviewer. Do not mark it done.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies. T001 → T002 and T003 → T004 (each test before its script). T002 and T004 share `fixture-images.sh`: create it in whichever lands first, and the other sources it.
- **Foundational (Phase 2)**: depends on nothing in Phase 1 (fixtures are only needed by 3e). It blocks all of Phase 3.
  - Contract: T007 → T008 → T009.
  - Schema: T010 → T011 → T012 → T013 → T014.
- **Setup ordering**: T001 → T003 (same test file).
  - Shell: T015, T016, T017 and T019 in parallel; T018 after T015 and T016 (T016 may also touch `ScanSummaryCard.tsx`).
- **US1 (Phase 3)**:
  - 3a (T020 → T021 → T022) needs T008 and T011.
  - 3b (T023 → T024; T025; then T026) needs T007, T008 and T021 (shared `Daos.kt` / `SnapshotStore.kt` edits: do T025 after T021).
  - 3c needs T008 and T009 for the types. T028 → T029, T030 → T031; T027, T032 and T033 in parallel.
  - 3d needs 3c, T015–T017 and T019. T034, T035, T036 and T038 in parallel; then T037 (needs T036), T039 (needs T034 and T038), T040 (needs T037 and T039), and T041.
  - 3e needs 3a, 3b, 3d and Phase 1. T042–T046 can be written in parallel, but each edits `config.yaml`, so merge them in order. T047 runs last.
- **Polish (Phase 4)**: T048–T053 in parallel after 3d (the docs describe built behaviour). T054 last.

### Within US1

Tests come before implementation in every pair (T020/T021, T023/T024, T028/T029, T030/T031, and the
component tests inside T034–T040). Native reads come before the bridge, the bridge before the JS hooks,
the hooks before the screens, and the screens before the e2e flows.

## Parallel Example: User Story 1

```text
# After Phase 2, native and JS tracks run side by side:
Track A (native):   T020 → T021 → T022 → T025 → T026      with T023 → T024 alongside
Track B (JS hooks): T027 | T028 → T029 | T030 → T031 | T032 | T033
# Then the leaf components together:
T034 [P] StatusChip   T035 [P] FilterChips   T036 [P] GalleryTile   T038 [P] Breadcrumb
# Then: T037 GalleryScreen, T039 ListScreen → T040 FilesScreen → T041 navigator
# Flows authored together, merged in order: T042 … T046 → T047
```

## Implementation Strategy

### MVP (User Story 1 is the whole feature)

1. Phase 1 (fixtures) and Phase 2 (contract v4, schema v3, shell). Gate: unit suites green.
2. 3a and 3b (native), then 3c (hooks). Gate: JVM and Jest green.
3. 3d (UI). Gate: a manual look on an emulator with a scanned snapshot.
4. 3e (flows), then T047 on both API levels. **Stop and validate**: the feature is shippable here.
5. Phase 4 (docs, changelog, cross-spec wording), then T054.

### Incremental delivery inside US1

Gallery-first is a valid intermediate commit: T037 with T040 rendering only the gallery, plus T042–T044.
List view (T038, T039, T045) and snapshot-change recovery (T046) follow. Each sub-phase checkpoint leaves
the build, lint and unit suites green.

## Notes

- [P] tasks touch different files and do not depend on an incomplete task.
- Write each test first and see it fail, then implement.
- Commit after each task or logical group; never commit with failing or skipped tests (Principle IV).
- Never pass a document URI, document ID or user path across the bridge, and never log one.
- Keep Gradle at the pinned wrapper version.
