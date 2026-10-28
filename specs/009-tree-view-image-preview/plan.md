# Implementation Plan: Browsable Tree View, Image and Video Preview

**Branch**: `009-tree-view-image-preview` | **Date**: 2026-10-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/009-tree-view-image-preview/spec.md` (clarified 2026-10-28,
2 questions, plus 2 items written straight from the user's input)

## Summary

Six parts on top of 005–008. Decisions are in [research.md](./research.md).

**1. Tree view** (FR-001, US1 sc. 1 and 3).

- The view drop-down gains a third choice, Tree, which is remembered like the others.
- Tree view is one flattened `FlatList` of fixed-height rows: sources, folders, files, "load more" rows
  and placeholders. Expanding a folder splices in its `queryTreeChildren` pages, folders first, then
  files in the current sort (R1).
- There is no fast scrollbar in the tree (R2). Expanded folders and the first visible row are kept as
  name paths, so a new snapshot keeps the place (R3).
- Folders with no matching files stay visible, dimmed, with "0", and can still be expanded (R4).

**2. Image and video preview** (FR-002, US1 sc. 2 and 4).

- Tapping a media file, when nothing is selected, opens `PreviewScreen` on the existing native stack.
- **Images**: `getLocalImageHandle` at the screen's long edge, with the cached gallery thumbnail shown
  first.
- **Videos**: a new Codegen native view, `SyncScopeVideoView`, around the platform `VideoView` and
  `MediaController`. It is muted by default, with play/pause and seek, and resolves the document natively
  so no URI crosses the bridge (R7, R8).

**3. Videos in the gallery and thumbnails in rows** (FR-004, FR-005).

- One `MediaKind` predicate (`image/` or `video/`) replaces every `LIKE 'image/%'` (R6).
- `getLocalImageHandle` takes videos: the frame comes from `loadThumbnail`, or from
  `MediaMetadataRetriever` as a fallback, and the result returns `durationMillis`, cached in a sidecar.
- Tiles and 40 dp row thumbnails show a play badge and the duration.

**4. Re-checking unsynced files on the automatic refresh** (FR-003, SC-003).

- `LOCAL_REFRESH` gains a `RECHECKING_REMOTE` phase. It lists, read-only, the server folders where the
  backed-up neighbours of unsynced and server-unknown files are stored: at most 32 folders in 20 s.
- New keys are added to the copied index, and the unchanged `Matcher` decides. Nothing is demoted, and
  a failure never fails the refresh (R5, new decision D023).
- The folder listing is shared with the pre-delete re-check through a new `ServerFolderLister` (DRY with
  D020).

**5. Selection** (spec sections "Selection in tree view and preview" and "Selection survives an
automatic refresh").

- Tree file rows and the preview join the 006 selection, with the selection bar and Delete (R11).
- On a new snapshot, a new `carrySelection` call keeps every selected file that is unchanged, matched by
  `(sourceId, documentId)` with the same size and time. A notice names only the dropped ones (R9).

**6. Toolbar halves** (FR-006). A spike confirms why 007's `flex: 1` fix does not stretch Paper's `Menu`
anchor on the device. The fix is checked by measuring the `uiautomator` bounds with a host hook between
the two parts of a staged line, because host scripts run only between staged parts (R10).

The contract goes to version 7 and the schema to version 6. There are 5 new workspace Maestro flows
(`tree/`) and 3 new staged lines (`staged/09`, `10`, `11`).

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 6 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule **and now one Codegen
native component**), React Native Paper 5.15 (MD3), React Navigation 7 (bottom tabs and native stack),
AndroidX Room, Kotlin coroutines, SAF.

- No new JS or native dependency. Video uses the platform's `VideoView`, `MediaController`,
  `MediaPlayer` and `MediaMetadataRetriever`.
- Tooling only: `ffmpeg`, used once to generate the 2 s MP4 fixture (`fixture-images.sh`). It is not needed
  at build or run time, and the generated file is checked in.

**Storage**:

- Room scan store, schema version 5 → 6 via `@AutoMigration`: one `local_node` index and two nullable
  `scan_run` counters ([data-model.md](./data-model.md#schema-change-version-5--6)).
- Thumbnail cache sidecar `<hash>.meta` for video durations.
- Browse preferences: `view` accepts `TREE`.

**Testing**:

- Jest + Testing Library (JS).
- JUnit + Robolectric JVM tests (`pnpm test:android:unit`), including `MigrationTestHelper` 5 → 6 and a
  50 k `carrySelection` budget test.
- Maestro 2.10.0 flows on API 31 and API 36 against the live FTP, SFTP and WebDAV containers
  (`pnpm e2e:android`).
- Node script-contract tests (`pnpm test:foundation`) for the tree fixtures and `assert-equal-halves.sh`.

**Target Platform**: Android, minSdk 31, targetSdk 36. Flows run on API 31 and API 36.

**Project Type**: mobile app (a React Native presentation layer over one Kotlin TurboModule and, new, one
native view)

**Performance Goals**: only the last two items are gates, asserted by unit tests (`RefreshRecheckTest`
for the 20 s budget, the 50 k `carrySelection` budget test). The first three are design targets: they are
not asserted in CI, because emulator decode and render times are not deterministic (Principle IV), and
they are checked in the quickstart's manual spot check.

- Expanding a folder shows its first page within the existing page budget. The read is the same
  `queryTreeChildren` as list view.
- A 256 px video thumbnail decodes in under 300 ms on the API 31 emulator, and a cache hit returns with
  no decode.
- The preview shows the cached thumbnail at once, and the full image within 1 s.
- The refresh re-check adds at most 20 s, and usually one listing, about 0.3–1 s over SFTP. A refresh with
  nothing to re-check does not connect.
- `carrySelection` takes under 300 ms for 50 k selected files, asserted on the JVM.

**Constraints**:

- R026: the re-check lists only, and the preview and the video view read local storage only.
- No document URI crosses the bridge or is logged, which is why video uses a native view (R7).
- D006 and D020: the re-check never demotes a file, never claims "not backed up" from a partial listing,
  and deletion still re-checks on the server before it deletes.
- Every tree row is `density.rowHeight` high (the 007 constraint).
- Material 3 via Paper, no inline styles, and an accessibility label on every new control (R021).
- Folders stay unselectable (006).

**Scale/Scope**: up to 50 k local files across ≤ 20 sources (the 004 scale).

- **New**: 1 bridge method, 1 native view, 1 screen (Preview), 1 Kotlin class (`ServerFolderLister`),
  1 schema step, the `TreeView` component and `useTree` hook.
- **Changed**: `getLocalImageHandle`, the gallery and selection SQL, `ScanEngine` (refresh),
  `DeletionRecheck` (uses the lister), `SelectionProvider`, Gallery, List, Files, `ViewMenu`,
  `ChoiceMenu` and `ScanSummaryCard`.
- **Flows**: 5 new workspace Maestro flows and 3 staged lines.

All unknowns are resolved in [research.md](./research.md). One cause is confirmed by a spike in the
first UI task, with the fix planned either way: why the toolbar does not stretch on the device (R10).

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS (with 2 recorded items) | No new dependencies. The tree reuses `queryTreeChildren`, the list rows and the paged reader, with no new native query (R1). The re-check reuses D020's stored folders, the retry policy and the unchanged `Matcher` (R5). Video uses the platform `VideoView`. Two added-complexity items are recorded below: the native video view, and the refresh re-check. |
| II. YAGNI | PASS | No swiping between files and no zoom in the preview. The tree state is not persisted. There is no scrollbar in the tree, no timer-driven refresh (clarification 1 chose the existing refresh triggers), and no document preview (R029 narrowed to documents). |
| III. DRY | PASS | `MediaKind` (Kotlin) and `media.ts` (TS) are the only media rules, with a parity test. `ServerFolderLister` serves both the deletion re-check and the refresh re-check. The tree's file rows reuse list view's row parts, moved into `src/files/FileRow.tsx`. Durations are formatted by one `formatDuration`. The selection bar and `DeleteFlow` are reused unchanged. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | **JVM**:<br>• `MigrationTest` (5 → 6)<br>• `MediaKindTest`<br>• `LocalImageStoreTest`: video frame fallback, the duration sidecar, a cache hit with duration<br>• `ScanOperationsTest`: a video handle, a non-media entry refused<br>• `SnapshotStoreTest`: the gallery includes videos, `selectableEntries.media`, `carrySelection` (unchanged, changed size, changed time, moved, missing snapshot, batches)<br>• `ServerFolderListerTest`<br>• `DeletionRecheckTest`, unchanged and still green through the lister<br>• `RefreshRecheckTest`: candidates from neighbours, the 32-folder cap and order, the budget, promotion, no demotion, a connection failure still publishes, no connect when there is nothing to re-check, the counters<br>• the budget test<br>• `SyncScopeVideoViewManagerTest` (Robolectric): prop parsing, error reasons, release on detach<br>• contract parity v7<br>**Jest**:<br>• `media.ts`<br>• `formatDuration`<br>• `useTree`: expand, collapse, paging, re-find on a new snapshot, dropped paths<br>• `TreeView` rows, dimmed folders, selection<br>• `FileRow` thumbnails and the play badge<br>• the `GalleryTile` video badge<br>• `PreviewScreen`: image, video, errors, select toggle, close after delete<br>• `SelectionProvider` carry (all carried, some dropped, failure clears)<br>• the `ViewMenu` Tree option<br>• `ChoiceMenu` stretch styles<br>• the `ScanSummaryCard` re-check line<br>• the a11y sweep<br>**Script-contract**: the tree fixtures, `assert-equal-halves.sh`.<br>All of it is deterministic, using fakes for the remote client and the retriever. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | Every acceptance scenario of US1 (P1), FR-003 and selection parity maps to a named flow on API 31 and API 36 ([contracts/maestro-tree-preview.md](./contracts/maestro-tree-preview.md#acceptance-scenario-mapping)). The flows cover FTP, SFTP and WebDAV. The two non-reproducible edge cases are recorded as a deviation below. |
| VI. Versioning + CHANGELOG | PASS | `Unreleased`:<br>• "Added: tree view; image and video preview; videos in the gallery; thumbnails in list and tree rows"<br>• "Changed: the app-open refresh re-checks not-backed-up files on the server folders of their backed-up neighbours; your selection is kept when results update"<br>• "Fixed: the sort and view drop-downs each take half the row"<br>• "Changed: CloudSync contract version 7; scan store schema version 6"<br>The version comes from `package.json`. |
| VII. `./docs` | PASS | **New decisions**: D023, refresh re-check of unsynced files (amends D020's rejected alternative); D024, video preview through a native view (narrows R029).<br>**Pages**:<br>• `scope.md`: R029 is documents only<br>• `overview.md`: tree view, preview, video in the gallery, the re-check<br>• `architecture.md`: schema v6, contract v7, the native view, `ServerFolderLister`, `MediaKind`, the `RECHECKING_REMOTE` phase<br>• `sync-and-deletion-safety.md`: the refresh can promote and never demotes, with the neighbour-folder limitation<br>• `protocols.md`: the refresh may connect |
| VIII. README | PASS | User sections: "Browse as a tree", "Preview photos and videos", and, in "Read the results", how not-backed-up files update after your sync app uploads them, and the limitation for brand-new folders. |
| IX. DEVELOPMENT.md | PASS | The `ffmpeg` prerequisite for regenerating the MP4 fixture, the `tree/` flows, the staged lines 09, 10 and 11, and `assert-equal-halves.sh`. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit`, `test:foundation`, `e2e:android` (API 31 and 36) and `release-smoke` are the exit gate. |

The gate passes, before and after the Phase 1 design. The items under Complexity Tracking are justified.

## Project Structure

### Documentation (this feature)

```text
specs/009-tree-view-image-preview/
├── plan.md              # This file
├── research.md          # Phase 0: R1–R11
├── data-model.md        # Phase 1: schema 6, media kind, re-check, carry-over, tree state
├── quickstart.md        # Phase 1: how to validate
├── contracts/
│   ├── cloudsync-tree-preview.md   # contract v7 and the native view
│   └── maestro-tree-preview.md     # flows and the scenario mapping
└── tasks.md             # Phase 2 (/speckit-tasks)
```

### Source Code (repository root)

```text
android/app/src/main/java/com/syncscope/
├── bridge/
│   ├── CloudSyncContracts.kt        # v7, LocalImageSpec, ScanPhase RECHECKING_REMOTE
│   ├── CloudSyncEnvelope.kt         # durationMillis, carry result, run counters
│   ├── CloudSyncModule.kt           # carrySelection
│   ├── CloudSyncPackage.kt          # registers SyncScopeVideoViewManager
│   └── ScanOperations.kt            # media handle, carrySelection
├── image/LocalImageStore.kt         # video frame fallback, duration sidecar
├── media/                           # NEW
│   ├── MediaKind.kt
│   └── SyncScopeVideoView.kt        # VideoView + MediaController, view manager
├── persistence/
│   ├── Entities.kt / Daos.kt        # index, run counters, mediaOnly
│   ├── SnapshotStore.kt             # MediaKind scope, selectableEntries.media, carrySelection
│   └── SyncScopeDatabase.kt         # version 6
├── remote/ServerFolderLister.kt     # NEW, extracted from DeletionRecheck
├── deletion/DeletionRecheck.kt      # uses ServerFolderLister
└── scan/
    ├── ScanEngine.kt                # LOCAL_REFRESH re-check phase
    └── RefreshRecheck.kt            # NEW, candidates, cap, budget, merge

src/
├── native/
│   ├── CloudSyncContracts.ts / CloudSync.ts   # v7, carrySelection, durationMillis, counters
│   └── specs/SyncScopeVideoViewNativeComponent.ts   # NEW
├── files/
│   ├── media.ts                     # NEW, isMediaMime, mediaKindOf, formatDuration
│   ├── FileRow.tsx                  # NEW, shared list/tree file row with thumbnail
│   ├── MediaThumbnail.tsx           # NEW, thumbnail + play badge + duration (tile and row)
│   ├── TreeView.tsx / useTree.ts    # NEW
│   ├── GalleryTile.tsx              # uses MediaThumbnail
│   ├── ChoiceMenu.tsx               # stretch fix
│   ├── ViewMenu.tsx / useFiles.ts / FilesProvider.tsx   # TREE view and tree state
│   └── useLocalImage.ts             # durationMillis
├── screens/
│   ├── PreviewScreen.tsx            # NEW
│   ├── TreeScreen.tsx               # NEW, the tree view inside Files
│   ├── GalleryScreen.tsx / ListScreen.tsx / FilesScreen.tsx   # tap opens preview, tree
├── navigation/AppNavigator.tsx      # Preview stack screen
├── scan/ScanSummaryCard.tsx         # re-check line
└── selection/SelectionProvider.tsx / summary.ts   # carry, isMedia

validation/maestro/tree/             # NEW, 5 flows
validation/maestro/staged/           # 09-resync-a/b/c, 10-selection-survives-a/b, 11-toolbar-halves-a/b
scripts/validation/                  # tree fixtures, MP4, assert-equal-halves.sh
docs/decisions/0023-*.md, 0024-*.md  # NEW
```

**Structure Decision**: the existing single React Native app with its Kotlin module. The new `media`
package holds the media rule and the video view. The tree is a sibling of the gallery and list screens
inside the Files tab.

## Phase sequencing (for `/speckit-tasks`)

1. **Foundation**: contract v7, schema 6, `MediaKind` + `media.ts` with the parity test, and
   `ServerFolderLister` extracted with `DeletionRecheck` still green.
2. **Toolbar spike and fix** (R10): small and independent, and it de-risks the measuring flow early.
3. **Media**: video thumbnails and duration, the gallery including videos, `MediaThumbnail`, `FileRow`
   thumbnails in list view.
4. **Preview**: `PreviewScreen` for images, then `SyncScopeVideoView` and video preview, then selection
   in the preview.
5. **Tree**: `useTree`, `TreeView`, the `ViewMenu` Tree option, keeping the place, selection in the tree.
6. **Refresh re-check**: `RefreshRecheck`, the engine phase, the run counters, the summary card line.
7. **Selection carry**: `carrySelection` with the budget test, then the `SelectionProvider` change.
8. **Flows, docs and release notes**: the Maestro flows of each part land with that part; this phase adds
   the docs, the README, `DEVELOPMENT.md`, the CHANGELOG and the full `e2e:android` run.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A Codegen native view for video (`SyncScopeVideoView`) | Clarification 2 asks for in-app playback, and document URIs must not cross the bridge | Any JS video library takes the URI from JS; the system player intent was not the chosen option |
| The refresh re-check (`RefreshRecheck`, a network step in a previously offline refresh) | Clarification 1 (FR-003) | A full relisting was rejected by the user. Without a re-check, an uploaded file stays "not backed up" until a manual full scan |
| E2E deviation: "file removed since the scan" and "unplayable video" have no Maestro flow | Making a file disappear or fail to decode between the scan and a tap needs a hook racing the UI, which is not reproducible | Covered by Robolectric (`LocalImageStoreTest`, `SyncScopeVideoViewManagerTest`) and Jest (`PreviewScreen` error states) |
