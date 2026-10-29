---
description: "Dependency-ordered implementation tasks for tree view, image and video preview, the refresh re-check and selection carry-over"
---

# Tasks: Browsable Tree View, Image and Video Preview

**Input**: Design documents in `specs/009-tree-view-image-preview/`:
[spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Prerequisites**: Features 005–008 merged (`queryTreeChildren` with `matchingFileCount`,
`getLocalImageHandle`, the 006 selection model, the 007 `ViewMenu`/`ChoiceMenu`, sort contract v6 and
anchor restore, the 008 E2E runner).

**Tests**: Required by constitution principles IV and V and listed in the plan's Constitution Check.
Each part writes its unit tests first, sees them fail, and lands them with the implementation in the
same change. Each acceptance scenario maps to the named Maestro flow in
[contracts/maestro-tree-preview.md](./contracts/maestro-tree-preview.md#acceptance-scenario-mapping),
which lands with its part.

**Organization**: The spec has one user story, US1 (P1), whose seven acceptance scenarios cover tree
view, image and video preview, media thumbnails and the toolbar halves, plus selection parity in tree
view and the preview. These are split into four US1 phases, ordered as in the plan's sequencing
(toolbar → media → preview → tree), each independently testable by its own flow. FR-003 (the refresh
re-check) and the "selection survives an automatic refresh" follow-up are not part of a user story.
They get their own phases, labelled **[FR3]** and **[CARRY]** in place of a story label so that every
task still traces to a requirement (Principle II).

## Format and paths

- Checklist format: `- [ ] T### [P?] [Label?] Description with file path`.
- `[P]` means different files and no unmet prerequisite inside the same phase.
- Labels: `[US1]` for user story 1, `[FR3]` for FR-003 and `[CARRY]` for the selection carry-over. Setup,
  Foundational and Polish tasks have no label.
- Paths are relative to the repository root. Kotlin main sources are under
  `android/app/src/main/java/com/syncscope/`, and JVM tests under `android/app/src/test/java/com/syncscope/`
  (abbreviated `kt/` and `kt-test/` below).
- A task is complete only when its stated tests pass, not when its file is edited.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: The fixtures, hooks and flow wiring that every flow of this feature needs.

- [X] T001 [P] Add a 2 s, H.264 MP4 to the generated images in `scripts/validation/fixture-images.sh`, generated with `ffmpeg` and checked in like the images; make `--check` verify it without needing `ffmpeg` (only regeneration needs it).
- [X] T002 Add the `tree` device set to `scripts/validation/device-fixtures.sh`, written under `scan/tree/`: `Album/2024/` with 5 JPEGs `a1.jpg`–`a5.jpg` (`tree/05` deletes `a1`–`a3`, `staged/10` uses `a4` and `a5`); `Album/2025/` with `b1.jpg`, `new.jpg` and `clip.mp4` (the MP4 from T001); `Album/Docs/` with `doc.pdf`; an empty `Empty/`; and `Loose.jpg`. Use the existing `immutable_set` reuse with a fixed mtime so a valid set is kept between runs and a changed one (for example after `tree/05` deletes `a1`–`a3`) is reseeded before the next API level's workspace flows (`device-fixtures.sh` runs once per API level, before the workspace; the staged lines run after it in the same API run). Depends on T001.
- [X] T003 [P] Seed the same `tree` set, including `Album/2025/new.jpg`, under `<root>/scan/tree/` on all three servers in `scripts/validation/fixture-seed.sh`, and add it to the before-manifest that the services compare when they stop (`scripts/validation/fixture-manifest.mjs`). This follows quickstart.md ("`Album/2025/new.jpg` exists"); the staged line in T068 removes and restores it.
- [X] T004 [P] Let `scripts/validation/hooks/remove-recheck-file.sh` and `scripts/validation/hooks/restore-recheck-file.sh` take an optional fixture path (for example `scan/tree/Album/2025/new.jpg`) and its source copy. With no argument they keep today's behaviour exactly (`recheck/beach.png`), so `staged/06-recheck-removed` is unchanged. Keep the `SYNCSCOPE_STATE_ROOT` guard, reject paths with `..` or a leading `/`, and keep the no-op when the file is already present or absent. Likewise let `scripts/validation/hooks/change-device-files.sh` take an optional device path under `scan/` (used by `staged/10` in T078); with no argument it keeps today's behaviour for `staged/08-changed`.
- [X] T005 [P] Add script-contract tests for T001–T004 in `scripts/validation/tree-fixtures.test.mjs`: the `tree` set's names and counts, the MP4 is listed by `--check`, the seeded server tree includes `new.jpg`, each hook's path argument is validated (`remove-recheck-file.sh`, `restore-recheck-file.sh`, `change-device-files.sh`), the no-argument recheck hooks still target `recheck/beach.png`, and the no-argument `change-device-files.sh` still changes the `staged/08` files.
- [X] T006 Create `validation/maestro/tree/` and register it in `validation/maestro/config.yaml`: append `"tree/*"` to `flows` **after** `"performance/*"`, and list the five `tree/` flows at the end of `executionOrder.flowsOrder`, after the 008 regressions, in the order of the contract table. Do not edit 008's frozen assertion in `scripts/validation/validation-infrastructure.test.mjs` (the 39 original flows, then `APPENDED_REGRESSIONS`, and the glob list); instead split it so 008's part checks `ordered.slice(39, 39 + APPENDED_REGRESSIONS.length)`, and add a 009 test asserting the `tree` glob and the five flows come after it. Check `scripts/validation/performance-report.mjs` (`count < 39`) and `scripts/validation/performance-runner.test.mjs` still pass. `staged/` stays unlisted.
- [X] T007 [P] Add a reusable subflow `validation/maestro/subflows/scan-tree-set.yaml` that configures the given protocol's repository through the existing debug seam, adds the `scan/tree` source and runs a full scan to the summary, following the existing subflows in `validation/maestro/subflows/`.

**Checkpoint**: `pnpm test:foundation` passes; `scripts/validation/fixture-images.sh --check` lists the MP4.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Contract v7, schema 6, the single media rule and the shared server folder lister. Every
later phase depends on these.

**⚠️ CRITICAL**: No user story or supporting-requirement work starts until this phase is complete.

### Tests first

- [X] T008 [P] Add `version5RowsMigrateToVersion6WithTheDocumentIndexAndNullRecheckCounts` to `kt-test/persistence/MigrationTest.kt`: rows written at version 5 survive; the index `index_local_node_snapshotId_sourceId_documentId` exists on `(snapshotId, sourceId, documentId)`; `scan_run.recheckedFolders` and `scan_run.promotedFiles` exist and are `NULL` on migrated rows.
- [X] T009 [P] Add `kt-test/media/MediaKindTest.kt`: `of(mimeType)` returns image for `image/*`, video for `video/*`, and not media for `null`, `application/pdf`, `""` and `imagex/foo`; `SQL_MEDIA` selects exactly the `FILE` rows whose `mimeType` starts with `image/` or `video/` on an in-memory Room database.
- [X] T010 [P] Add `src/files/__tests__/media.test.ts`: `isMediaMime`, `mediaKindOf` and `formatDuration` (`m:ss` below one hour, `h:mm:ss` from one hour, `0:02` for 2 000 ms, rounding down). Include a parity table of MIME types shared with `MediaKindTest` (the same cases, the same answers), as the plan's DRY row asks.
- [X] T011 [P] Add `kt-test/remote/ServerFolderListerTest.kt` with a fake `RemoteClient`: one connect for several folders, each folder listed once with `RemoteWalker.listWithRetry`, the keys it returns, connection/auth/host-key failures surfaced as one typed failure, and cancellation.
- [X] T012 [P] Update the contract parity tests for version 7 in `kt-test/bridge/CloudSyncContractsParityTest.kt` and `src/native/__tests__/CloudSyncContracts.test.ts`: `CLOUD_SYNC_CONTRACT_VERSION` is 7 on both sides, `ScanPhase` includes `RECHECKING_REMOTE`, and `SelectableEntries` has `media` and no `images`.

### Implementation

- [X] T013 Bump the schema to version 6 in `kt/persistence/SyncScopeDatabase.kt` with `@AutoMigration(from = 5, to = 6)`; add the index on `(snapshotId, sourceId, documentId)` to `LocalNode` and the nullable `recheckedFolders INTEGER` and `promotedFiles INTEGER` to `ScanRun` in `kt/persistence/Entities.kt`; export the version 6 schema JSON. No data rewrite. Makes T008 pass.
- [X] T014 [P] Create `kt/media/MediaKind.kt` with `SQL_MEDIA` ("`kind = 'FILE'` and `mimeType` starts with `image/` or `video/`") and `of(mimeType)`. Makes T009 pass.
- [X] T015 [P] Create `src/files/media.ts` with `isMediaMime`, `mediaKindOf` and `formatDuration`. Makes T010 pass.
- [X] T016 Replace every `mimeType LIKE 'image/%'` with `MediaKind.SQL_MEDIA`: the gallery scope in `kt/persistence/SnapshotStore.kt` (`scopeOf`, line ~736), `selectableEntries` in the same file (`isImage` → `isMedia`, line ~525), and `statusCounts` in `kt/persistence/Daos.kt` (`imagesOnly` → `mediaOnly`, line ~245, and the KDoc at line ~155). Rename `imageEntry` to `mediaEntry` in `Daos.kt` and `SnapshotStore.kt` and let it return `video/*` entries too. Update `kt-test/persistence/SnapshotStoreTest.kt`: the gallery includes videos, `selectableEntries` sets `media` for images and videos. Depends on T014.
- [X] T017 Bump the contract to version 7 in `kt/bridge/CloudSyncContracts.kt` and `src/native/CloudSyncContracts.ts` together: add `RECHECKING_REMOTE` to `ScanPhase` (JS label "Checking the server for new backups"), rename the `SelectableEntries` wire field `images: boolean[]` to `media: boolean[]` in `kt/bridge/CloudSyncEnvelope.kt` and `src/native/CloudSync.ts`. Makes T012 pass.
- [X] T018 Rename `SelectionItem.isImage` to `isMedia` and make the gallery's "filtered out" rule follow it in `src/selection/summary.ts`, `src/selection/SelectionProvider.tsx` and their tests in `src/selection/__tests__/`. Depends on T017.
- [X] T019 Extract the folder connect-and-list and key matching from `kt/deletion/DeletionRecheck.kt` into `kt/remote/ServerFolderLister.kt` (one connection with the stored repository, credential and trusted host key; each folder listed once with `RemoteWalker.listWithRetry`; returns the listed keys per folder). Make `DeletionRecheck` use it. `kt-test/deletion/DeletionRecheckTest.kt` stays unchanged and green; T011 passes.

**Checkpoint**: `pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:android:unit` pass. The
existing `e2e:android` flows still pass (the gallery now also counts any videos already in fixtures).

---

## Phase 3: User Story 1, part A: The sort and view drop-downs share their row (Priority: P1) 🎯 MVP

**Goal**: The sort and view drop-downs each take half the toolbar row on the device (US1 sc. 7, FR-006, R10).

**Independent Test**: the staged line `staged/11-toolbar-halves` passes on API 31 and API 36. Host scripts run only between staged parts (`run_hook` in `scripts/validation/android-flow.sh`), so the device measurement is a staged hook, not a step inside a workspace flow.

- [X] T020 [US1] Spike: on an API 36 emulator, open Files and dump `uiautomator` bounds of `files-toolbar`, `files-sort-control` and `files-view-control` and of Paper `Menu`'s anchor wrapper. Record which box shrinks to its content, and the chosen fix (`alignSelf: 'stretch'` or `flex: 1` on `Menu`'s `style`), as a short note in `specs/009-tree-view-image-preview/research.md` under R10.
- [X] T021 [P] [US1] Add `scripts/validation/hooks/assert-equal-halves.sh`: using the `ANDROID_SERIAL` the runner exports to hooks, read a `uiautomator dump` through `adb`, find `files-toolbar` and the visible buttons `files-sort` and `files-view` by resource ID, and exit non-zero unless each button's width is 50 % ± 2 % of the toolbar's. Measure the buttons, not the `files-sort-control` / `files-view-control` wrappers: those already have `flex: 1` (`src/files/ChoiceMenu.tsx`) and measure about half the row even while the bug is present. Ignore `SYNCSCOPE_STATE_ROOT` beyond the usual guard. Add its script-contract test, with recorded dump fixtures that pass, that fail, and that reproduce today's bug (wrappers at half width, buttons narrower) and must fail, plus a missing-control case, in `scripts/validation/assert-equal-halves.test.mjs`.
- [X] T022 [P] [US1] Write the failing Jest test in `src/files/__tests__/ChoiceMenu.test.tsx`: the `Menu` gets the stretch style from T020, the anchor button `width: '100%'`, and the label `numberOfLines={1}` through `labelStyle`.
- [X] T023 [US1] Apply the fix in `src/files/ChoiceMenu.tsx` (an explicit `style={styles.menu}` on Paper's `Menu`, label truncation), keeping 007's wrapper styles and no inline styles. Makes T022 pass; `src/files/__tests__/SortMenu.test.tsx` and `ViewMenu.test.tsx` stay green.
- [X] T024 [US1] Write `validation/maestro/staged/11-toolbar-halves-a.yaml` (starts from `clearState`, scans the `tree` set over SFTP through the subflow from T007, because Files shows `NoScanResults` and no toolbar until a snapshot exists, then opens Files and waits until both drop-downs are visible) and `validation/maestro/staged/11-toolbar-halves-b.yaml` (both drop-downs are still visible and each opens its menu), and add `staged/11-toolbar-halves-a.yaml|assert-equal-halves.sh|staged/11-toolbar-halves-b.yaml` to `validation/maestro/staged/pairs.txt`. Ensure the IDs the script reads (`files-toolbar` in `src/screens/FilesScreen.tsx`, `files-sort` and `files-view` on the buttons in `src/files/ChoiceMenu.tsx`) stay in place, asserted in `src/screens/__tests__/FilesScreen.test.tsx`.

**Checkpoint**: the flow passes on both API levels.

---

## Phase 4: User Story 1, part B: Videos in the gallery and thumbnails in rows (Priority: P1)

**Goal**: Videos show in the gallery with a frame, a play badge and the duration; list rows show
thumbnails for images and videos (US1 sc. 5–6, FR-004, FR-005, R6). Tree rows get the same through
`FileRow` in Phase 6.

**Independent Test**: the gallery and list-view steps of `tree/04-video-gallery-preview-sftp` pass.

### Tests first

- [X] T025 [P] [US1] Extend `kt-test/image/LocalImageStoreTest.kt` and `kt-test/image/ContentResolverThumbnailSourceTest.kt`: a video's frame comes from `loadThumbnail`, or from the `MediaMetadataRetriever` fallback (`getScaledFrameAtTime(-1, OPTION_CLOSEST_SYNC, edge, edge)`) when that fails or returns nothing; the duration is read from `METADATA_KEY_DURATION`; the `<hash>.meta` sidecar is written atomically after the JPEG and holds the duration in milliseconds as decimal text; it is absent for images and for unreadable durations; a cache hit returns `durationMillis` with no decode. Use a fake retriever.
- [X] T026 [P] [US1] Extend `kt-test/bridge/ScanOperationsTest.kt`: `getLocalImageHandle` returns `{ uri, durationMillis }` for a video and `durationMillis: null` for an image; a non-media entry is `INVALID_QUERY` on `entryId` with "The media entryId is invalid."; no URI or document ID is logged.
- [X] T027 [P] [US1] Extend `src/native/__tests__/CloudSync.test.ts` and `src/files/__tests__/useLocalImage.test.tsx`: `localImageHandleOf` keeps a finite non-negative `durationMillis` and turns a negative, non-finite or missing value into `null`; `useLocalImage` exposes `durationMillis`.
- [X] T028 [P] [US1] Add `src/files/__tests__/MediaThumbnail.test.tsx`: an image renders the thumbnail; a video adds a play badge and the formatted duration, and no duration when it is `null`; a video whose frame cannot be read shows the `video-off` placeholder; the accessibility label names the file and says it is a video.
- [X] T029 [P] [US1] Write the failing tests for the shared row in `src/files/__tests__/FileRow.test.tsx`: image and video rows show a 40 dp thumbnail requested at a 128 px edge (with a play badge for videos) within `density.rowHeight`; other files keep their icon; the selected check icon and `, selected` label show as in list view today. Extend `src/files/__tests__/GalleryTile.test.tsx` for the video badge and duration.

### Implementation

- [X] T030 [US1] In `kt/image/LocalImageStore.kt`, accept `video/*` entries: try `ContentResolver.loadThumbnail`, fall back to `MediaMetadataRetriever` for the frame, read the duration with the same retriever, and write and read the `<hash>.meta` sidecar beside `<hash>.jpg` under `cacheDir/thumbnails/`, keyed by `sha256(entryId + "|" + edge)` as today. Makes T025 pass.
- [X] T031 [US1] Return `durationMillis` from `getLocalImageHandle` in `kt/bridge/ScanOperations.kt` and `kt/bridge/CloudSyncEnvelope.kt` (using `mediaEntry` from T016), with the new error message; mirror it in `src/native/CloudSync.ts` (`localImageHandleOf`) and `src/files/useLocalImage.ts`. Makes T026 and T027 pass.
- [X] T032 [US1] Create `src/files/MediaThumbnail.tsx` (thumbnail, play badge, duration via `formatDuration`, `video-off` placeholder) and use it in `src/files/GalleryTile.tsx`. Makes T028 and the `GalleryTile` part of T029 pass.
- [X] T033 [US1] Move `FileRow` out of `src/screens/ListScreen.tsx` (line ~251) into `src/files/FileRow.tsx`, add the 40 dp `MediaThumbnail` for media rows, and give it an optional `depth` that indents by `spacing.lg` per level up to depth 8 (used by the tree in Phase 6; list view passes none). Make `ListScreen` import it. Makes T029 pass; `src/screens/__tests__/ListScreen.test.tsx` stays green.
- [X] T034 [US1] Write the gallery and list-view part of `validation/maestro/tree/04-video-gallery-preview-sftp.yaml`: scan the `tree` set over SFTP (T007), assert the MP4 tile shows a play badge and "0:02", switch to List, open `Album` → `2025` and assert the MP4 row shows a thumbnail with a play badge. The preview and tree steps are added in T046 and T061.

**Checkpoint**: Jest and JVM suites green; the gallery shows the MP4 with its badge on both API levels.

---

## Phase 5: User Story 1, part C: Image and video preview, with selection (Priority: P1)

**Goal**: Tapping an image or video, when nothing is selected, opens a full preview from local storage;
videos play muted with play/pause and seek; the preview takes part in the selection (US1 sc. 2 and 4,
FR-002, R7, R8, R11).

**Independent Test**: `tree/03-preview-image-webdav` passes, and the preview steps of
`tree/04-video-gallery-preview-sftp` pass.

### Tests first

- [X] T035 [P] [US1] Add `kt-test/media/SyncScopeVideoViewManagerTest.kt` (Robolectric): props `snapshotId`, `entryId`, `muted` (default `true`) and `paused` (default `false`) are parsed; an unknown or non-video entry raises `onPlaybackError` with `NOT_A_VIDEO`, an unopenable document `UNAVAILABLE`, a `MediaPlayer` error `UNPLAYABLE`; `onReady` carries `durationMillis`; volume is 0 when muted; the `MediaPlayer` is released on detach and on host pause; the document URI is never in an event or a log.
- [X] T036 [P] [US1] Add `src/screens/__tests__/PreviewScreen.test.tsx`: an image shows the cached 256 px thumbnail first, then the image from `getLocalImageHandle` at the window's long edge in physical pixels, clamped by the 2048 px cap, with `resizeMode="contain"`; a video renders `SyncScopeVideoView` muted, and the mute toggle flips `muted`; `IMAGE_UNAVAILABLE` shows "This file is no longer on the device" and a Back button; `onPlaybackError` shows "This video can't be played"; the "Select this file" / "Unselect this file" toggle; the selection bar with Delete appears when something is selected; the preview closes after a deletion that removed the previewed file; a new snapshot keeps the file when it is carried, or shows "This file changed. Go back to see the latest results." when it is not.
- [X] T037 [P] [US1] Extend `src/screens/__tests__/GalleryScreen.test.tsx` and `src/screens/__tests__/ListScreen.test.tsx`: with nothing selected, a tap on a media file navigates to `Preview` with `{ snapshotId, entryId, name, mimeType, sizeBytes, status }`; a tap on a non-media file does nothing; while selecting, a tap toggles as today.
- [X] T038 [P] [US1] Extend `src/navigation/__tests__/` (the existing `AppNavigator` test) for the `Preview` stack screen and its params type.

### Implementation

- [X] T039 [US1] Create the Codegen spec `src/native/specs/SyncScopeVideoViewNativeComponent.ts` with the props and events of [the contract](./contracts/cloudsync-tree-preview.md#new-native-view-syncscopevideoview) (`snapshotId`, `entryId`, `muted` default `true`, `paused` default `false`, `onPlaybackError { reason: 'NOT_A_VIDEO' | 'UNAVAILABLE' | 'UNPLAYABLE' }`, `onReady { durationMillis }`), and add it to the Codegen config in `package.json` if components need listing there.
- [X] T040 [US1] Create `kt/media/SyncScopeVideoView.kt`: the view around `android.widget.VideoView` and a `MediaController`, and its view manager, resolving the document natively through `SnapshotStore.mediaEntry`; start muted with `MediaPlayer.setVolume(0, 0)` in `OnPreparedListener`; map errors to the three reasons; release on detach and on host pause. Register the manager in `kt/bridge/CloudSyncPackage.kt`. Makes T035 pass.
- [X] T041 [US1] Add the `Preview` route with `PreviewParams` to `src/navigation/AppNavigator.tsx` as a native stack screen above the tabs. Makes T038 pass.
- [X] T042 [US1] Create `src/screens/PreviewScreen.tsx`: the image path (cached thumbnail, then full image, error state), the video path (`SyncScopeVideoView`, mute toggle in the top bar), Material 3 via Paper, no inline styles, an accessibility label on every control, and the test IDs `preview-image` and `preview-video` that the flows use.
- [X] T043 [US1] Add selection to `src/screens/PreviewScreen.tsx`: the top-bar `IconButton` "Select this file" / "Unselect this file" on `SelectionProvider`, the existing `SelectionBar` at the bottom whenever something is selected, Delete through the existing `DeleteFlow`, and close after a completed deletion that removed the previewed file. Makes T036 pass (the "new snapshot" cases are completed in T077).
- [X] T044 [US1] Open the preview on tap in `src/screens/GalleryScreen.tsx` and `src/screens/ListScreen.tsx` (media and nothing selected → navigate; non-media → nothing; selecting → toggle), using `isMediaMime`. Makes T037 pass.
- [X] T045 [US1] Write `validation/maestro/tree/03-preview-image-webdav.yaml`: tap `Loose.jpg` in the gallery, in list view and (after Phase 6) in tree view; each time `preview-image` is visible; Back returns to the same view and position. Until T061 lands, the tree step is the last step and is added there.
- [X] T046 [US1] Add the preview steps to `validation/maestro/tree/04-video-gallery-preview-sftp.yaml`: tap the MP4 tile → `preview-video` is visible and plays muted; the controller's pause and seek respond (assert the controller's state or elapsed time changes).

**Checkpoint**: both preview flows pass on API 31 and API 36 (without their tree steps).

---

## Phase 6: User Story 1, part D: Tree view, with selection (Priority: P1)

**Goal**: A third view, Tree, shows the same hierarchy as list view as an expandable, flattened list of
fixed-height rows; folders with no matching files stay visible, dimmed, with "0", and expandable;
file rows join the selection (US1 sc. 1 and 3, FR-001, SC-002, R1–R4, R11).

**Independent Test**: `tree/01-expand-collapse-sftp`, `tree/02-filter-dimmed-ftp` and
`tree/05-tree-select-delete-ftp` pass.

### Tests first

- [X] T047 [P] [US1] Add `src/files/__tests__/useTree.test.tsx` with a fake `queryTreeChildren`: the root shows one `source` row per selected source; expanding a folder splices in its children, folders first by name then files in the current sort; collapsing removes its rows and drops its pages; a folder with more than one page ends in a `more` row that reads the next page with the opaque token when it becomes visible; a `placeholder` row shows while the first page loads; `STALE_GENERATION` recovers like list view; on a new snapshot every still-expanded name path is re-read in order, a path that no longer exists is dropped with its descendants, and the anchor row is re-found by its name path.
- [X] T048 [P] [US1] Add `src/files/__tests__/TreeView.test.tsx`: every row is `density.rowHeight` (56 dp) and `getItemLayout` matches; depth indents by `spacing.lg` up to depth 8 and deeper rows keep the depth-8 indent; a folder with `matchingFileCount === 0` is dimmed, shows "0" and still expands; folder rows are unselectable; a long-press on a file starts selecting, a tap toggles while selecting and opens the preview otherwise; no `FastScroller` is rendered; expand/collapse controls have accessibility labels.
- [X] T049 [P] [US1] Extend `src/files/__tests__/ViewMenu.test.tsx` and `kt-test/bridge/BrowsePreferencesTest.kt`: Tree is the third choice, and `view` accepts and remembers `TREE` through `getBrowsePreferences` / `setBrowsePreferences`.
- [X] T050 [P] [US1] Extend `src/files/__tests__/FilesProvider.test.tsx` and `src/screens/__tests__/FilesScreen.test.tsx`: the `TreeState` (`expanded` name paths, `anchor`) is held in `FilesProvider` for the session only and survives switching views and back; Files renders the tree for `TREE`; "Select all" in tree view uses the same `selectAllQuery` as list view at the root (no folder scope).

### Implementation

- [X] T051 [US1] Add `TREE` to the browse preferences' `view` in `kt/bridge/BrowsePreferences.kt` and the JS mirror in `src/native/CloudSyncContracts.ts`, and the Tree option to `src/files/ViewMenu.tsx`. Makes T049 pass.
- [X] T052 [US1] Add `TreeState` (`expanded: readonly (readonly string[])[]`, `anchor: readonly string[] | null`, as in [data-model.md](./data-model.md#tree-view-state-js-only-r1r3)) to `src/files/FilesProvider.tsx` and `src/files/useFiles.ts`, beside the list view's folder; not persisted.
- [X] T053 [US1] Create `src/files/useTree.ts`: derive the flattened rows (`source`, `folder`, `file`, `more`, `placeholder`, with the fields of the data-model table) from `queryTreeChildren` pages per expanded path, reusing `usePagedQuery`'s page reading and `STALE_GENERATION` recovery, and re-find expanded paths and the anchor on a new snapshot (as `useListNavigation` does for one folder). Makes T047 pass.
- [X] T054 [US1] Move `FolderRow` and `PlaceholderRow` out of `src/screens/ListScreen.tsx` (lines ~219 and ~288) into `src/files/FileRow.tsx` (or a sibling `src/files/FolderRow.tsx`), add the optional `depth`, an expand/collapse chevron and the dimmed "0" count, and keep `ListScreen` using them unchanged.
- [X] T055 [US1] Create `src/files/TreeView.tsx`: one `FlatList` of the `useTree` rows with `getItemLayout` at `density.rowHeight`, `FileRow` and `FolderRow` with `depth`, no `FastScroller`, and the selection behaviour of list view (long-press, toggle, `, selected` label; folders unselectable). Makes T048 pass.
- [X] T056 [US1] Create `src/screens/TreeScreen.tsx` hosting `TreeView` inside the Files tab, with the existing filter chips, sort drop-down, `SelectionBar` and `DeleteFlow`; tap opens the preview as in T044. Render it from `src/screens/FilesScreen.tsx` when the view is `TREE`, and make "Select all" use the root `selectAllQuery`. Makes T050 pass.
- [X] T057 [US1] Keep the place on new results in tree view (007 FR-014): record the first visible row's name path as `anchor` in `TreeState` on scroll, and scroll back to it after the re-read in `useTree`, also when the tree is hidden, in `src/files/TreeView.tsx`.
- [X] T058 [US1] Write `validation/maestro/tree/01-expand-collapse-sftp.yaml`: scan the `tree` set (T007), View → Tree, expand `Album` → `2024`, `2025`, `Docs` appear indented; expand `2025` → 3 files; collapse `Album` → its children are gone; switch to List and open `Album` → the same three folders.
- [X] T059 [US1] Write `validation/maestro/tree/02-filter-dimmed-ftp.yaml`: scan over FTP, View → Tree, filter "Unsynced" → `Album/Docs` is dimmed, shows "0" and still expands.
- [X] T060 [US1] Write `validation/maestro/tree/05-tree-select-delete-ftp.yaml`: in tree view expand `Album/2024`; with nothing selected, open the preview of `a3.jpg` and tap "Select this file" → "1 selected"; back in the tree, long-press `a1.jpg` (SYNCED) → "2 selected" and tap `a2.jpg` → "3 selected" (a tap toggles while selecting, R11; decision log 2026-10-29); Delete → the existing confirmation → the three files are gone from the tree. Touch only `a1`–`a3`, so `a4.jpg` and `a5.jpg` (used by `staged/10` later in the same API run), `Album/2025` (used by `staged/09`) and `Loose.jpg` stay. The flow does not restore the deleted files; `device-fixtures.sh` reseeds the changed set before the next API level's workspace flows (T002).
- [X] T061 [US1] Add the tree steps to `validation/maestro/tree/03-preview-image-webdav.yaml` (tap `Loose.jpg` in tree view → `preview-image`; Back → same view and position) and to `validation/maestro/tree/04-video-gallery-preview-sftp.yaml` (the MP4 tree row shows a thumbnail with a play badge).

**Checkpoint**: all five `tree/` flows and `staged/11` pass on API 31 and API 36. US1 is complete: every acceptance
scenario 1–7 and selection parity is covered (SC-001 for the `tree/` part, SC-002, SC-004).

---

## Phase 7: FR-003: Re-check unsynced files on the automatic refresh

**Goal**: Each `LOCAL_REFRESH` lists, read-only, the server folders of the backed-up neighbours of
re-checkable files, promotes files it finds, never demotes, and never fails the refresh (FR-003,
SC-003, R5, D023).

**Independent Test**: the staged pair `staged/09-resync` passes: a file uploaded after the scan shows
"Backed up" after a relaunch, with no full scan.

### Tests first

- [X] T062 [P] [FR3] Add `kt-test/scan/RefreshRecheckTest.kt` with a fake `ServerFolderLister` and in-memory Room: re-checkable means `UNSYNCED`, or `UNKNOWN` with an issue code other than `LOCAL_UNAVAILABLE` and `REMOTE_MTIME_MISSING`; neighbour folders are device folders `(parentId, sourceId)` with at least one re-checkable and one `SYNCED` file; candidates are the `remote_match_key.directories` of those `SYNCED` files, weighted by the number of re-checkable files pointing to them; at most `RECHECK_MAX_FOLDERS = 32`, highest weight first, ties by path; `RECHECK_BUDGET_MILLIS = 20 000` keeps the folders listed so far; new keys go in with `INSERT OR IGNORE` on `(snapshotId, name, sizeBytes, precisionMillis, bucket)` and existing keys, `duplicateCount` and `directories` are unchanged; a new key's `directories` is the listed folder; no re-checkable files or no candidates → no connect; connection, auth, host-key or listing failure → skipped, no exception.
- [X] T063 [P] [FR3] Extend `kt-test/scan/ScanEngineTest.kt`: `LOCAL_REFRESH` reports the `RECHECKING_REMOTE` phase between copying the remote state and reading the device; a found file becomes `SYNCED` through the unchanged `Matcher`; a not-found file keeps its verdict (never demoted); a re-check failure still publishes; `remoteListedAtMillis` is unchanged; `scan_run.recheckedFolders` is the number of folders listed successfully and `promotedFiles` the number of files re-checkable in the active snapshot and `SYNCED` in the new one, per `(sourceId, documentId)`; both `NULL` on `FULL` runs; cancellation stops the re-check like the rest of the run.
- [X] T064 [P] [FR3] Extend `kt-test/bridge/CloudSyncEnvelopeTest.kt`, `src/native/__tests__/CloudSync.test.ts` and `src/scan/__tests__/ScanSummaryCard.test.tsx`: the run DTO carries `recheckedFolders` and `promotedFiles` (`number | null`); the card shows "Re-checked N server folders, M files now backed up" (with singular forms, as in the staged flow: "Re-checked 1 server folder, 1 file now backed up") only when M > 0, and keeps the "Rescan to check new folders" hint; the phase label "Checking the server for new backups".

### Implementation

- [X] T065 [FR3] Create `kt/scan/RefreshRecheck.kt`: the candidate query, the 32-folder cap and order, the 20 s budget, listing through `ServerFolderLister` (T019), merging new keys into the staged snapshot's `remote_match_key` and the refresh's `MatchIndex`, and returning the listed-folder count. Makes T062 pass.
- [X] T066 [FR3] Run `RefreshRecheck` in `kt/scan/ScanEngine.kt` during `LOCAL_REFRESH`, reporting `RECHECKING_REMOTE` through `kt/scan/ScanProgress.kt`, swallowing its failures, then running the normal local phase; compute and store `recheckedFolders` and `promotedFiles` on the run. Makes T063 pass.
- [X] T067 [FR3] Expose the counters on the last run in `kt/bridge/CloudSyncEnvelope.kt`, `src/native/CloudSync.ts` and `src/native/CloudSyncContracts.ts`, and add the re-check line and phase label in `src/scan/ScanSummaryCard.tsx` (and wherever the phase label is mapped, e.g. `src/scan/useScan.ts`). Makes T064 pass.
- [X] T068 [FR3] Write the staged flows `validation/maestro/staged/09-resync-a.yaml`, `09-resync-b.yaml` and `09-resync-c.yaml` over SFTP and add the line `staged/09-resync-a.yaml|remove-recheck-file.sh scan/tree/Album/2025/new.jpg|staged/09-resync-b.yaml|restore-recheck-file.sh scan/tree/Album/2025/new.jpg|staged/09-resync-c.yaml` to `validation/maestro/staged/pairs.txt`, as in [the contract](./contracts/maestro-tree-preview.md#flows). **a**: set up the SFTP repository and the `tree` source, no scan. **b**: first assert that `Album/2025` holds `b1.jpg`, `new.jpg` and `clip.mp4`, so a missing fixture fails clearly; then full scan → `new.jpg` shows "Not backed up". **c**: relaunch (automatic refresh) → `new.jpg` shows "Backed up" with no full scan, and the card shows "Re-checked 1 server folder, 1 file now backed up". In `cleanup()` of `scripts/validation/android-flow.sh` (beside the existing `restore-recheck-file.sh` call, lines ~108–112), also run `restore-recheck-file.sh scan/tree/Album/2025/new.jpg`, so a run interrupted after part **a** leaves the seeded tree and the services' before-manifest check passes; failure sets `restoration=failed` like the existing call. Add a test for that cleanup in `scripts/validation/validation-infrastructure.test.mjs`.

**Checkpoint**: JVM and Jest suites green; `staged/09-resync` passes on both API levels; the
services' before-manifest check passes after the run.

---

## Phase 8: The selection survives an automatic refresh

**Goal**: On a new snapshot the selection keeps every selected file that is unchanged, by
`(sourceId, documentId)` with the same size and time, and drops only the rest with a notice (spec
"Selection survives an automatic refresh", R9).

**Independent Test**: the staged pair `staged/10-selection-survives` passes.

### Tests first

- [ ] T069 [P] [CARRY] Extend `kt-test/persistence/SnapshotStoreTest.kt` for `carrySelection(from, to, entryIds)`: an unchanged file is carried; a changed `sizeBytes` or `modifiedUtcMillis` is dropped (compared with `IS`, so two nulls match); a moved file (new `documentId`) is dropped; only `FILE` rows match; a status change is still carried; `from == to` carries every existing `FILE` entry; IDs are read in batches of 900; the result is `{ carried: [{ from, to }], dropped }`.
- [ ] T070 [P] [CARRY] Add a budget test in `kt-test/persistence/SnapshotQueryPerformanceTest.kt` (or a new `CarrySelectionPerformanceTest.kt` beside it): 50 000 selected files carried in under 300 ms on the JVM, using the index from T013.
- [ ] T071 [P] [CARRY] Extend `kt-test/bridge/CloudSyncModuleTest.kt` and `kt-test/bridge/ScanOperationsTest.kt`: `carrySelection` returns `SNAPSHOT_NOT_FOUND` for either missing snapshot, and `INVALID_QUERY` on `entryIds` for more than 50 000 IDs or a non-string ID; it never touches the server or the files and never returns a `documentId`.
- [ ] T072 [P] [CARRY] Extend `src/native/__tests__/CloudSync.test.ts` and `src/native/__tests__/NativeCloudSyncBoundary.test.ts` for the `carrySelection` wrapper and its `CarrySelectionResult` type.
- [ ] T073 [P] [CARRY] Extend `src/selection/__tests__/SelectionProvider.test.tsx` and update `src/screens/__tests__/FilesScreen.test.tsx` (line ~862): on a snapshot change, everything carried → the selection continues under the new IDs with no notice; some dropped → the notice "N selected files changed or were removed, so they were unselected." (and the singular "1 selected file changed or was removed, so it was unselected."); the call fails → the selection clears with the existing notice "Results were updated, so the selection was cleared."; each kept item takes its size and status from the new row.

### Implementation

- [ ] T074 [CARRY] Implement `carrySelection` in `kt/persistence/SnapshotStore.kt` (and its DAO query in `kt/persistence/Daos.kt`) with the matching rule of [data-model.md](./data-model.md#selection-carry-over-r9), in batches of 900. Makes T069 and T070 pass.
- [ ] T075 [CARRY] Add the bridge method in `kt/bridge/ScanOperations.kt`, `kt/bridge/CloudSyncModule.kt` and `kt/bridge/CloudSyncEnvelope.kt`, and in `src/native/specs/NativeCloudSync.ts`, `src/native/CloudSync.ts` and `src/native/CloudSyncContracts.ts`, with the validation of the contract. Makes T071 and T072 pass.
- [ ] T076 [CARRY] Call `carrySelection` in `src/selection/SelectionProvider.tsx` when the active snapshot changes, instead of clearing, with the notices above. Makes T073 pass.
- [ ] T077 [CARRY] Make `src/screens/PreviewScreen.tsx` follow a new snapshot: stay on the open file under its carried `entryId`, or show "This file changed. Go back to see the latest results." when it was dropped. Completes T036.
- [ ] T078 [CARRY] Write `validation/maestro/staged/10-selection-survives-a.yaml` and `10-selection-survives-b.yaml` over **SFTP** (the runner's staged state is the SFTP service, like every existing staged line) and add `staged/10-selection-survives-a.yaml|change-device-files.sh scan/tree/Album/2024/a4.jpg|staged/10-selection-survives-b.yaml` to `validation/maestro/staged/pairs.txt`, using the path argument from T004. **a**: scan the `tree` set, select `a4.jpg` and `a5.jpg` in `Album/2024`. Hook: touch `a4.jpg`. **b**: return to the foreground → the refresh completes → "1 selected" and the notice "1 selected file changed or was removed, so it was unselected." The touched file is reseeded by `device-fixtures.sh` before the next API level's workspace flows (T002).

**Checkpoint**: `staged/10-selection-survives` passes on both API levels; `staged/06`, `07` and `08`
still pass.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Documentation, release notes and the full gates (constitution principles VI–IX and the
Quality Gates).

- [ ] T079 [P] Add `docs/decisions/0023-refresh-recheck-of-unsynced-files.md` (R5; amends D020's rejected alternative "re-checking UNSYNCED files to promote them"; records the neighbour-folder limitation) and `docs/decisions/0024-video-preview-native-view.md` (R7; narrows R029), and list both in `docs/decisions/README.md`.
- [ ] T080 [P] Update `docs/scope.md` (R029 excludes documents only), `docs/overview.md` (tree view, preview, videos in the gallery, the re-check), `docs/architecture.md` (schema v6, contract v7, `SyncScopeVideoView`, `ServerFolderLister`, `MediaKind`, the `RECHECKING_REMOTE` phase, `carrySelection`), `docs/sync-and-deletion-safety.md` (the refresh can promote and never demotes; the neighbour-folder limitation; carry-over does not change deletion safety) and `docs/protocols.md` (the refresh may connect).
- [ ] T081 [P] Update `README.md` user sections: "Browse as a tree", "Preview photos and videos", and in "Read the results" how not-backed-up files update after the sync app uploads them, the brand-new-folder limitation, and that a selection is kept when results update.
- [ ] T082 [P] Update `DEVELOPMENT.md`: the `ffmpeg` prerequisite for regenerating the MP4 fixture only, the `tree/` flows, the staged lines 09, 10 and 11, and `assert-equal-halves.sh`.
- [ ] T083 [P] Add the `Unreleased` entries to `CHANGELOG.md`: "Added: tree view; image and video preview; videos in the gallery; thumbnails in list and tree rows", "Changed: the app-open refresh re-checks not-backed-up files on the server folders of their backed-up neighbours; your selection is kept when results update", "Fixed: the sort and view drop-downs each take half the row", "Changed: CloudSync contract version 7; scan store schema version 6".
- [ ] T084 Extend the accessibility sweep in `src/files/__tests__/a11y.test.ts` to `TreeView`, `FileRow`, `MediaThumbnail` and `PreviewScreen`: every new control has an accessibility label (R021).
- [ ] T085 Remove dead code left by the moves and renames (any remaining `isImage`, `imagesOnly`, `imageEntry`, the old row definitions in `src/screens/ListScreen.tsx`), and confirm no new dependency was added to `package.json` or `android/app/build.gradle` (Principle I).
- [ ] T086 Run the gates of [quickstart.md](./quickstart.md): `pnpm lint && pnpm typecheck`, `pnpm test:ci`, `pnpm test:android:unit` (the 50 k `carrySelection` budget under 300 ms), `pnpm test:foundation`, `scripts/validation/fixture-images.sh --check`, `pnpm e2e:android` (every `tree/*` flow and `staged/09`, `staged/10`, `staged/11` on API 31 and API 36, with all earlier flows still green) and `pnpm e2e:android:release-smoke`. Record any failure with its output; do not mark the feature done until all pass (SC-001).

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: none. T002 depends on T001; T006 before any `tree/` flow.
- **Foundational (Phase 2)**: after Setup. Blocks every later phase.
- **US1 A, toolbar (Phase 3)**: after Phase 2. Independent of the other parts.
- **US1 B, media (Phase 4)**: after Phase 2.
- **US1 C, preview (Phase 5)**: after Phase 4 (it uses `durationMillis`, `mediaEntry`, `MediaThumbnail` and the tap-to-open in rows).
- **US1 D, tree (Phase 6)**: after Phase 4 (`FileRow`) and Phase 5 (tap opens the preview; T061 extends the preview flows).
- **FR-003, re-check (Phase 7)**: after Phase 2 (`ServerFolderLister`, schema 6, contract v7) and T002–T004 (the `tree` set and hooks). Independent of Phases 3–6, except that the staged flows assert on list view only.
- **Selection carry (Phase 8)**: after Phase 2 (the index). T077 needs Phase 5.
- **Polish (Phase 9)**: after all phases.

### Within each phase

- Tests first, failing, then the implementation that makes them pass, in the same change.
- Kotlin store and bridge before the JS wrapper, the JS wrapper before the screens, the screens before the flow.

### Parallel opportunities

- Phase 1: T001, T003, T004, T007 together; T005 after them.
- Phase 2: T008–T012 together; then T013, T014, T015 together; T016 after T014; T017 after T012; T019 after T011.
- After Phase 2: Phase 3, Phase 4, Phase 7 and the native half of Phase 8 (T069–T075) can run side by side.
- Inside each phase, every "Tests first" task marked `[P]` can run together.

---

## Parallel Example: User Story 1, part B (media)

```bash
# Tests first, together:
Task: "T025 LocalImageStoreTest + ContentResolverThumbnailSourceTest video cases"
Task: "T026 ScanOperationsTest video handle and error message"
Task: "T027 CloudSync.test.ts + useLocalImage.test.tsx durationMillis"
Task: "T028 MediaThumbnail.test.tsx"
Task: "T029 FileRow.test.tsx + GalleryTile.test.tsx"

# Then the native half and the JS half:
Task: "T030 LocalImageStore video frame + sidecar"   # then T031
Task: "T032 MediaThumbnail + GalleryTile"           # then T033
```

## Parallel Example: after Phase 2

```bash
Task: "Phase 3 (T020–T024): toolbar halves"
Task: "Phase 4 (T025–T034): media thumbnails"
Task: "Phase 7 (T062–T068): refresh re-check"
Task: "Phase 8 native (T069–T075): carrySelection"
```

---

## Implementation Strategy

### MVP first

1. Phase 1 and Phase 2 (foundation).
2. Phase 3 (toolbar halves): small, and it proves the device-measuring check early (R10).
3. Phases 4–6: media, preview, tree. Stop and validate: all five `tree/` flows and `staged/11` pass, and US1 is complete.

### Incremental delivery

1. Foundation → the existing suites stay green with contract v7 and schema 6.
2. Toolbar → `staged/11` green.
3. Media → the gallery shows videos; list rows show thumbnails.
4. Preview → `tree/03`, `tree/04` green (without tree steps).
5. Tree → `tree/01`, `02`, `05` green; tree steps added to `03`, `04`.
6. Re-check → `staged/09` green.
7. Selection carry → `staged/10` green.
8. Polish → docs, README, DEVELOPMENT, CHANGELOG, full gates.

Each step ends with every gate it touches green, so it can be committed on its own.

## Notes

- `[P]` tasks touch different files with no unmet prerequisite.
- Document URIs and `documentId`s never cross the bridge or reach a log (R7, R9, contract guarantees).
- No new JS or native dependency; `ffmpeg` is a fixture-regeneration tool only.
- The two non-reproducible edge cases ("removed since the scan", "unplayable video") are covered by
  T025, T035 and T036, as recorded in the plan's Complexity Tracking.
