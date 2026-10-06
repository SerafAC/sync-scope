# Implementation Plan: Sorting, Fast Scrolling, Several Server Folders and an App Icon

**Branch**: `007-sort-scroll-remote-folders` | **Date**: 2026-10-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-sort-scroll-remote-folders/spec.md` (clarified 2026-10-05,
5 questions, plus 2 questions asked before writing)

## Summary

Six parts on top of the 006 MVP. Decisions are in [research.md](./research.md).

**1. Sorting** (Story 1).

- A sort drop-down and a view drop-down replace the gallery / list switch. Both are Paper `Menu`s, and
  their choices are remembered natively in `SharedPreferences` (R10).
- Native reads add `SIZE_*` sorts, put unknown values last, break ties by a new stored `sortName`, which
  is case- and accent-insensitive, and keep D010's opaque keyset tokens (R1, R2).
- List view reads folders first, by name, as a separate `kind: 'DIRECTORY'` read (R3).

**2. Smart scrollbar** (Story 2).

- A new `getScrollIndex` read returns the result's bands with counts and a start token per band (R4):
  - letters, `#` and a–z;
  - adaptive date bands of years, months or days (R6);
  - dynamic size bands from percentiles, snapped to 1-2-5 values (R5).
- `usePagedQuery` becomes band-segmented: placeholders fill unread bands, so the thumb can jump anywhere
  and the band loads on arrival (R7). The `FastScroller` control uses `PanResponder` and `Animated`, and
  is adjustable for TalkBack (R9).

**3. Keeping the place** (Story 4, a bug): on a new snapshot, each view re-finds its first visible file by
sort value and name (`anchorIndex`) instead of jumping to the top (R8).

**4. Several server folders** (Story 3).

- **Storage and validation**: `remoteRoot` becomes the `\n`-separated `remoteRoots` (a column rename,
  R11), with native normalization and an overlap check.
- **Test**: the connection test reports each folder (R12).
- **Browser**: a modal server folder browser in the Repository form lists folders through a new
  `browseRemoteFolders` call, with the existing host-key flow (R13).
- **Scan**: if some folders cannot be read, it still completes. Unmatched files become UNKNOWN with
  `REMOTE_FOLDER_UNREAD`, and the summary names the folders. If none can be read, it fails as today (R14).

**5. Small fixes**: the picker bug starts with a spike and ends in an intent fix or the large-folder hint
(R15, no complex workaround). Settings › Folders becomes "Device folders" (R16).

**6. App icon** (Story 7, when the image arrives): a repeatable ImageMagick script generates the adaptive,
monochrome and legacy icons and a 512 px image (R17).

The contract goes to version 6 and the schema to version 5. There are 8 new Maestro flows, and 2 existing
release flows are extended.

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 6 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule), React Native Paper
5.15 (MD3, including `Menu`), React Navigation 7, AndroidX Room, Kotlin coroutines, SAF.

- No new JS or native dependency. The scrollbar uses React Native's `PanResponder` and `Animated`, and the
  preferences use Android `SharedPreferences`.
- Tooling: ImageMagick 7 (`magick`) for the icon script only; it is not needed at build or run time.

**Storage**:

- Room scan store, schema version 4 → 5 via `@AutoMigration` with `@RenameColumn` and `onPostMigrate`:
  `remoteRoots`, `local_node.sortName` with two indexes, and `remote_ambiguity.remotePath`
  ([data-model.md](./data-model.md#schema-change-version-4--5)).
- Browse preferences in `SharedPreferences` (`browse_preferences`).

**Testing**:

- Jest + Testing Library (JS).
- JUnit + Robolectric JVM tests (`pnpm test:android:unit`), including `MigrationTestHelper` for 4 → 5 and
  50 k-row budget tests.
- Maestro 2.10.0 flows on API 31 and API 36 against the live FTP, SFTP and WebDAV containers
  (`pnpm e2e:android`, D012), plus `release-smoke`.
- Node script-contract tests (`pnpm test:foundation`) for the new fixtures, the manifest and the icon
  script.

**Target Platform**: Android, minSdk 31, targetSdk 36. Flows run on API 31 and API 36.

**Project Type**: mobile app (a React Native presentation layer over one Kotlin TurboModule)

**Performance Goals**:

- `getScrollIndex` under 150 ms for 50 k files; each sorted page under the existing page budget, both
  asserted on the JVM next to `SnapshotQueryPerformanceTest` (R4, R18).
- A thumb release reaches its band's first file within 1 s on the API 31 emulator (SC-003), on the
  5,000-file `Scroll` fixture. That is one index read, cached per result, plus one page read. Flow 03
  proves it with an `extendedWaitUntil` of 1,000 ms started right after the release.
- The first paint is not delayed: page 1 and the index are requested in parallel (R7).
- Browsing a server folder takes one connection, one listing and a close; about 0.3–1 s per folder over
  SFTP.

**Constraints**:

- D010: tokens stay opaque, bound to the snapshot and query, and clamped to 200 rows.
- No remote write and no remote content read; the browser lists only (R026).
- No password leaves native code, and only configured folders cross the bridge (D011).
- UNKNOWN files are never deleted (D006); "not backed up" is never claimed on a partial listing.
- Material 3 via Paper, no inline styles (005 FR-004). Every new control has an accessibility label
  (FR-017, R021).
- No in-app device folder browser and no picker replacement (clarification 4).

**Scale/Scope**: up to 50 k local files across ≤ 20 sources (the 004 scale), and up to 10 remote folders
in practice (no hard limit; each costs one walk).

- **New**: 4 bridge methods, 1 issue code, 1 schema step, a `FastScroller` component, a folder browser
  modal and the icon script.
- **Changed**: 4 screens (Files, Gallery, List, Repository), Settings and Sources, the scan walker and the
  repository operations.
- **Flows**: 8 new Maestro flows, 2 extended.

All unknowns are resolved in [research.md](./research.md). One question stays open on purpose: the
picker's root cause. It is decided by the first task's spike, with both outcomes planned (R15).

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS (with 2 recorded items) | No new dependencies. Segmented paging replaces linear paging instead of running beside it (R7). Several folders reuse the incomplete-listing path rather than adding a verdict rule (R14). The folder list is a renamed column, not a table (R11). The browser is a modal over existing `parse`/`list`/host-key code (R13). The picker fix is capped at a hint (R15). Two added-complexity items are recorded under Complexity Tracking: the stored `sortName`, and the segmented reader. |
| II. YAGNI | PASS | No per-folder device→server mapping, and no second server (R024 stays out). No persistent browse session. No in-app device folder browser. Bands are computed on demand and never stored. The legacy icon PNGs are kept only because the manifest references them and Story 7 sc. 4 asks for them. The filter is not persisted. |
| III. DRY | PASS | Folder normalization and overlap live only in `RemoteRoots`. The sort keys live only in `SnapshotStore` (`sortKeyOf`), and `SortName.of` is the only name folding. The band rules live in one `ScrollBands` object. Messages are native, with the `NO_SOURCES_SELECTED` action mirrored under the parity test. `formatBytes` (006) labels the size bands. The browser reuses `parse`, `sameAccount`, `HostKeyDialog` and the error-to-place table. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | **JVM**:<br>• `MigrationTest` (4 → 5)<br>• `SortNameTest`<br>• `SnapshotStoreTest`: six sorts, unknown last, tie-break, `kind`, token versions, paging totality under deletions<br>• `ScrollBandsTest`: letters, the date unit choice, the size regimes, the outlier band, the split and merge rules, SC-008's fixtures<br>• `ScrollIndexTest`: counts, start tokens, `anchorIndex`, scope<br>• the budget tests<br>• `RemoteRootsTest`: normalize, overlap, newline<br>• `RepositoryOperationsTest`: `remoteRoots` save errors with `fieldIndex`, per-folder test, browse with transient / stored / missing password, host key, busy refusals<br>• `RemoteWalkerTest`: several roots, one failing → `REMOTE_FOLDER`, all failing → `RootListingFailed`<br>• `ScanEngineTest`: `REMOTE_FOLDER_UNREAD` verdicts, `remotePath`, the refresh copy<br>• `BrowsePreferencesTest`<br>• contract parity and module tests<br>**Jest**:<br>• contract v6 wrappers<br>• `FilesProvider` preference load and save<br>• the sort and view menus<br>• `usePagedQuery` segments: placeholders, lazy band loads, stale guards, reload, anchor restore<br>• `FastScroller`: show and hide, drag-to-band mapping, a11y actions<br>• Gallery and List with bands, folder segment first<br>• `RepositoryScreen` folder list, field errors by index, per-folder test lines<br>• `RemoteFolderBrowser`<br>• the `ScanSummaryCard` unread-folders warning<br>• the file issue text with folder names<br>• the a11y sweep<br>• a "no `Settings › Folders`" string test<br>**Script-contract**: the scroll manifest, the new device fixtures, the icon script.<br>All of it is deterministic. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | Every P1 story (1, 3, 4, 5) maps to named flows on API 31 and API 36 ([contracts/maestro-polish.md](./contracts/maestro-polish.md#acceptance-scenario-mapping)), and so does P2 Story 2. The protocols are covered across 04 (WebDAV), 05 (FTP) and 06 (SFTP); each still has its 006 setup flow. Story 7 is covered by the release smoke and Story 3 sc. 7 by the release-update flow. Seven scenarios without a Maestro flow are recorded as deviations under Complexity Tracking; every other P1 scenario has a flow step that exercises it. |
| VI. Versioning + CHANGELOG | PASS | `Unreleased`:<br>• "Added: sort by name, date or size; a scrollbar with date, letter and size labels; several server folders with a folder browser; the app icon"<br>• "Changed: the gallery / list switch is a drop-down, and sort and view are remembered; Settings › Folders is now Device folders; a scan that cannot read some server folders completes and marks the affected files as unknown"<br>• "Fixed: the Files views no longer jump to the top when results update; adding a device folder with thousands of files" (worded after the R15 spike)<br>• "Changed: CloudSync contract version 6; scan store schema version 5"<br>The version comes from `package.json` (006 R17); the release bump is not part of this feature. |
| VII. `./docs` | PASS | **New decision**: D022, several remote folders and the partial-scan rule (R11, R14), which amends the one-remote-root scope.<br>**Amended decision**: D010 adds the scroll index and band start tokens; the token contract is unchanged (R4).<br>**Pages**:<br>• `scope.md`: one server, several folders<br>• `overview.md`: the Remote root glossary becomes "Remote folders"; Source › "Settings › Device folders"; the sort and scrollbar<br>• `sync-and-deletion-safety.md`: unread folders produce unknown, never not-backed-up<br>• `architecture.md`: the schema v5, the contract v6 methods, `ScrollBands`, segmented paging, the browser<br>• `protocols.md`: folder listing for the browser |
| VIII. README | PASS | User sections: "Sort and jump through your files" (the drop-downs and the scrollbar), "Set up your server" (several folders, Browse), "Pick folders" (Device folders, the large-folder hint), "Read the results" (unread server folders). |
| IX. DEVELOPMENT.md | PASS | The icon script and its ImageMagick prerequisite; the `polish/` flows; the new device fixtures and `scroll-manifest.sh`; the repeated `root` in the debug seam. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit`, `test:foundation`, `e2e:android` (API 31 and 36) and `release-smoke` are the exit gate. |

The gate passes, before and after the Phase 1 design. The items under Complexity Tracking are justified;
none are unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/007-sort-scroll-remote-folders/
├── spec.md                    # clarified 2026-10-05
├── plan.md                    # this file
├── research.md                # R1–R18
├── data-model.md              # schema v5, sort keys, scroll index, preferences, JS state
├── quickstart.md              # gates, picker spike, icon, manual walk-through
├── contracts/
│   ├── cloudsync-polish.md    # contract v6
│   └── maestro-polish.md      # fixtures, selectors, scenario → flow mapping, deviations
├── checklists/requirements.md
└── tasks.md                   # next: /speckit-tasks
```

### Source Code (repository root)

```text
android/app/schemas/.../5.json                       # NEW (exported)
android/app/src/main/res/                            # icon outputs (R17): mipmap-anydpi/ic_launcher*.xml,
                                                     #   mipmap-*/ic_launcher{,_round,_foreground,_monochrome}.png,
                                                     #   values/ic_launcher_background.xml
android/app/src/main/java/com/syncscope/
├── bridge/
│   ├── CloudSyncContracts.kt                        # v6; SIZE_* sorts, FileKind, ScrollUnit, REMOTE_FOLDER_UNREAD,
│   │                                                #   band constants, reworded NO_SOURCES_SELECTED action
│   ├── CloudSyncEnvelope.kt                         # scrollIndex, remoteFolders, preferences DTOs; fieldIndex
│   ├── CloudSyncModule.kt                           # wire getScrollIndex, browseRemoteFolders, get/setBrowsePreferences
│   ├── RepositoryOperations.kt                      # remoteRoots parse/save, per-folder test, browse (R11–R13)
│   ├── BrowsePreferences.kt                         # NEW: SharedPreferences read/write with defaults (R10)
│   └── ScanOperations.kt                            # scroll index; unreadRemoteFolders in the summary
├── deletion/DeletionRecheck.kt                      # only if it still assumes one root (FR-012)
├── persistence/
│   ├── Entities.kt                                  # remoteRoots, sortName + 2 indexes, remotePath
│   ├── SyncScopeDatabase.kt                         # version 5, Migration4To5 spec
│   ├── SnapshotQuery.kt                             # FileSort SIZE_*, kind
│   ├── PageTokenCodec.kt                            # versioned cursor with sortName
│   ├── SnapshotStore.kt                             # sortKeyOf, unknown-last ordering, kind scope, scrollIndex()
│   └── Daos.kt                                      # sort-column reads for bands; remotePath in the copy
├── remote/
│   ├── RemoteClient.kt                              # RemoteConfig.rootPaths
│   └── RemoteRoots.kt                               # NEW: normalize, overlap, encode/decode (R11)
├── scan/
│   ├── RemoteWalker.kt                              # several roots; REMOTE_FOLDER gaps (R14)
│   ├── ScanEngine.kt                                # roots list, remotePath, sortName on rows, refresh scope
│   ├── Matcher.kt                                   # REMOTE_FOLDER_UNREAD issue code on incomplete listings
│   ├── SortName.kt                                  # NEW (R2)
│   └── ScrollBands.kt                               # NEW: letter, date and size band rules (R5, R6)
├── source/SourcePicker.kt                           # only if the R15 spike finds an intent fix
└── debug/ConfigureRepositoryActivity.kt             # repeated `root`
android/app/src/test/java/com/syncscope/{bridge,persistence,remote,scan}/   # per Check IV

src/
├── native/
│   ├── specs/NativeCloudSync.ts                     # 4 methods, QuerySpecInput.kind, error fieldIndex
│   ├── CloudSyncContracts.ts                        # v6 types, constants, codes
│   └── CloudSync.ts                                 # wrappers and DTO guards
├── files/
│   ├── FilesProvider.tsx / useFiles.ts              # per-view sort, persisted view and sorts (R10)
│   ├── usePagedQuery.ts                             # band segments, placeholders, anchor restore (R7, R8)
│   ├── FastScroller.tsx                             # NEW (R9)
│   ├── bandLabel.ts                                 # NEW: band → label text (letters, dates, formatBytes)
│   ├── SortMenu.tsx / ViewMenu.tsx                  # NEW: the two drop-downs (R10)
│   └── a11y.ts                                      # labels for menus, scroller, placeholders
├── screens/
│   ├── FilesScreen.tsx                              # toolbar with the two menus; hidden view keeps its anchor
│   ├── GalleryScreen.tsx                            # sort from provider, scroller, placeholders
│   ├── ListScreen.tsx                               # folder segment first, file sort, scroller
│   ├── RepositoryScreen.tsx                         # folder list, Browse, per-folder test lines
│   └── SettingsScreen.tsx                           # "Device folders"
├── repository/
│   ├── RemoteFolderBrowser.tsx                      # NEW: modal browser (R13)
│   ├── RepositorySection.tsx                        # lists every remote folder
│   ├── useRepository.ts                             # remoteRoots, per-folder results
│   └── serverAddress.ts                             # URL path fills folder 0 only
├── scan/ScanSummaryCard.tsx                         # unread-folders warning
├── (file row that renders FILE_ISSUE_TEXT)          # REMOTE_FOLDER_UNREAD names the unread folders
├── selection/formatBytes.ts                         # reused unchanged for size band labels
└── sources/SourcesSection.tsx                       # "Device folders" header; large-folder hint (R15)

scripts/icon/generate-icons.sh                       # NEW (R17)
assets/icon/{source.png,play-store-512.png}          # NEW when the image arrives
validation/maestro/polish/                           # NEW: 01–08 per contracts/maestro-polish.md
validation/maestro/mvp/{90-release-smoke,91-release-update}.yaml   # extended
validation/maestro/browse/05-results-updated.yaml    # replaced by polish/07
validation/maestro/subflows/open-sources.yaml        # "Device folders"
validation/maestro/config.yaml                       # + polish/*
scripts/validation/
├── device-fixtures.sh                               # + TwoFolders, Scroll, Narrow, DCIM/Big
├── scroll-manifest.sh                               # NEW
├── android-flow.sh                                  # pass scroll-manifest values; release-smoke icon check
└── validation-infrastructure.test.mjs               # + manifest, fixtures, icon script
docs/  README.md  DEVELOPMENT.md  CHANGELOG.md       # per Principles VI–IX
```

**Structure Decision**: one Android app module plus the JS presentation layer, as in 002–006. The new
native logic sits next to its subject:

- band rules and name folding in `scan/`, because they are computed from scan-time values;
- folder parsing in `remote/`;
- preferences in `bridge/`, because they are bridge-only state.

On the JS side, browsing components stay in `src/files/` and the browser in `src/repository/`.

## Integration closure

This feature hands **feature 008** (tree view and preview):

- the view drop-down, where tree view becomes the third choice, and the persisted preferences, which gain
  a `tree` view value;
- the sort contract (`SIZE_*`, `sortName`, unknown last, `kind`), which the tree applies to each folder's
  files with folders first;
- `getScrollIndex` and the segmented `usePagedQuery`, which the tree reuses per expanded folder (or
  skips; 008 decides);
- anchor restore on new results (R8), which the tree follows.

It hands **feature 010** (full loop and release):

- a repository with several folders, set up through the UI, for the full-loop flow;
- the `polish/` flows and the `Scroll` / `Big` device fixtures;
- the icon in the release APK, already checked by release-smoke.

Spec follow-ups (cross-feature consistency, not blocking tasks):

- 008 spec: consume the items above, and record that list rows have a fixed height (the segmented reader
  needs it).
- 010 spec: snapshot retention must keep `remote_ambiguity.remotePath` for the active snapshot (it already
  keeps the active snapshot whole).

## Risks

| Risk | Mitigation |
| --- | --- |
| The R15 spike finds no app-side cause, so Story 5 sc. 3–4 (spinner, cancel) cannot ship | Planned outcome: the hint. The deviation is recorded, and the user said to keep it simple. |
| The segmented reader regresses the 005/006 paging guarantees (stale responses, snapshot loss, deletion reload) | The existing `usePagedQuery` tests stay and must pass unchanged. A single band reproduces today's linear behaviour, so most paths are unchanged. |
| Placeholder rows flash grey during a fast fling over unloaded bands | Band loads start at `onViewableItemsChanged`, with a one-screen look-ahead. Placeholders use the theme's surface variant, not a spinner per tile. |
| Two new `local_node` indexes slow publishing | The 50 k-row insert budget test must stay within its limit. If not, drop `(snapshotId, kind, sortName)` first, because name sorts in the gallery are the least common choice. |
| Name order changes (case- and accent-insensitive) and surprises a user used to the old order | It matches how file managers sort. The change is noted in the CHANGELOG. |
| A very slow server makes `Browse` feel stuck | A loading indicator, a back action that ignores the late answer, and the existing connect timeouts. |
| `magick` is missing on a developer machine | The script stops with a clear message, and the script-contract test is skipped with a notice; the outputs are committed, so only regenerating needs it. |
| Changing an existing snapshot's name order invalidates live page tokens after the update | The token version byte rejects old tokens, and `usePagedQuery` recovers by reloading (existing `PAGE_TOKEN_MISMATCH` path). |

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| A stored, indexed `local_node.sortName` (Principle I: new persisted value) | Letter bands must be contiguous ranges of the sort, and name sorts should ignore case and accents (FR-007, Story 2 sc. 3) | SQLite `NOCASE` folds ASCII only, so `é` sorts after `z` and splits bands. A custom collation cannot be registered on framework SQLite. Sorting in Kotlin breaks keyset paging (R2). |
| `usePagedQuery` becomes band-segmented with placeholders (Principle I: more complex hook) | The thumb must reach rows not yet loaded within 1 s (FR-006, SC-003), and the place must be kept on new results (FR-014) | Loading every page up to the target means 250 calls at 50 k files. OFFSET reads break D010 and are unstable under deletions. A second "jump mode" beside linear paging would be two code paths (R7). |
| Constitution V deviation: Story 1 sc. 9 (unknown size or date last) has no Maestro flow | Android reports a size and a modified time for every file readable through SAF, so no device fixture can carry an unknown value | Proven by JVM `SnapshotStoreTest` (`NULL` last under each sort) and the scroll index's `Unknown` band test. |
| Constitution V deviation: Story 2 sc. 7 (TalkBack adjust) has no Maestro flow | Maestro cannot perform accessibility actions | Proven by Jest `FastScroller` accessibility tests and the a11y sweep. |
| Constitution V deviation: Story 2 sc. 6 (loading state after a far jump) has no Maestro flow | Against the emulator the state lasts milliseconds, so an assertion would be flaky | Proven by Jest segment tests with a delayed reader. |
| Constitution V deviation: Story 4 sc. 2 (anchor file gone) has no Maestro flow | Needs a device file removed between two snapshots while the view is scrolled; a staged device hook could do it, but the position assertion would depend on emulator scroll physics | Proven by JVM `anchorIndex` tests (gone anchor → neighbour index) and Jest view tests. |
| Constitution V deviation: Story 5 sc. 2–4 under the hint branch (contents after navigating back, spinner, cancel on back) | The picker is Android's activity; these are only possible with an app-side cause (R15) | If the spike finds one (branch A), a `SourcePickerTest` regression test plus flow 08, which then also covers sc. 2; otherwise the documented hint (clarification 4), proven by flow 08. |
| Constitution V deviation: Story 7 sc. 3 (themed icon) has no Maestro flow | Maestro cannot toggle the launcher's themed-icon setting | Proven by the script-contract test (monochrome layer present and referenced) and the manual check in quickstart §3. |
| Constitution V deviation: Story 6 sc. 2 (wording everywhere) is a text audit | Not a user flow | Proven by a Jest string test, like 006's "no Connect screen" test, plus the `Device folders` header assertion in flow 08. |
