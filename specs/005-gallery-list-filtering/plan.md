# Implementation Plan: Gallery View, Browsable List, Filtering and Material 3 Shell

**Branch**: `005-gallery-list-filtering` | **Date**: 2026-10-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-gallery-list-filtering/spec.md` (clarified 2026-10-01)

## Summary

Replace the Files tab placeholder with a Material 3 browser over the active snapshot. The browser has two
views and one shared filter:

- **Gallery** is a 3-column virtualized `FlatList` of local image thumbnails, newest first, read through
  paged `queryFiles`. Each tile carries a status chip. When the same file name exists in another source
  folder, the tile also carries an origin badge with that source's alias.
- **List** browses directories. The top level shows the sources. Below that, `queryTreeChildren` pages rows
  by name, and a breadcrumb leads back up. Under a filter, every directory stays visible with a count of
  matching files beneath it, and it is dimmed when that count is 0.
- **Filter chips** (all, synced, unsynced, issues or unknown) apply to both views. Their counts come from
  the same snapshot read as the rows.

When a rescan publishes a new snapshot, the views reload from page 1. They keep the filter and the current
folder, re-located by name, and show "Results updated".

Native changes are small and additive:

- Room schema version 3 stores descendant file counts per status on directory rows, computed by the
  existing `DirectoryRollup`.
- The read rules change: directories ignore the filter, the gallery shows images only, and counts are
  scoped by view and source.
- `FileEntryDto` gains `nameInOtherSource` and `matchingFileCount`.
- `getLocalImageHandle` is implemented. It writes local-only, downscaled JPEG thumbnails to the app cache.
  It moved here from 007 by user decision, so 007 reuses it for the full preview.
- The contract version goes to 4.

A `src/theme/` module becomes the single source for the MD3 theme, spacing and density.
`react-native/no-inline-styles` becomes a lint error. Decisions are in [research.md](./research.md).

## Technical Context

**Language/Version**: Kotlin (Android app module, JVM 17 toolchain) and TypeScript 6 / React 19.2

**Primary Dependencies**: React Native 0.87 (New Architecture, Codegen TurboModule), React Native Paper
5.15 (MD3), React Navigation 7 (bottom tabs), AndroidX Room, Kotlin coroutines, and the Android
`ContentResolver.loadThumbnail` / `BitmapFactory`. **No new dependencies** (research R8).

**Storage**: the Room scan store, schema version 2 → 3 via `@AutoMigration`, three nullable columns on
`local_node` ([data-model.md](./data-model.md#schema-change-version-2--3)). Thumbnails are JPEGs in
`cacheDir/thumbnails/`, which the OS can reclaim.

**Testing**: Jest + Testing Library (JS). JUnit + Robolectric JVM tests (`pnpm test:android:unit`). Room
`MigrationTestHelper` for 2 → 3. Maestro 2.10.0 flows on API 31 and API 36 against the live SFTP container
(`pnpm e2e:android`, D012). Node script-contract tests (`pnpm test:foundation`).

**Target Platform**: Android, minSdk 31, targetSdk 36; validated on API 31 and API 36 emulators.

**Project Type**: mobile app (a React Native presentation layer over one Kotlin TurboModule)

**Performance Goals**:

- The first page (100 rows plus counts) of a 50 k-row snapshot is read in under 300 ms, asserted by a
  JVM budget test (`SnapshotQueryPerformanceTest`, tasks T020). A per-row duplicate probe is one indexed `EXISTS` lookup.
- Directory counts are O(1) column reads.
- Thumbnails are ≤ 256 px, at most 4 decodes run at once, and a cached thumbnail is served without a
  decode.
- The grid uses fixed item layout (`getItemLayout`), so scrolling never measures.

**Constraints**:

- Local content reads only; no remote content (R026).
- No document URI or user path crosses the bridge (D016, 004 contract).
- One snapshot per rendered list (D010).
- Pages are clamped to 200; this feature uses 100.
- Material 3 via Paper only, with no inline styles (FR-004).
- Sort is fixed per view, with no search UI (clarification 5).

**Scale/Scope**: up to 50 k local files across ≤ 20 sources (the 004 scale). One screen with two views,
one bridge method implemented, two DTO fields, one error code, five Maestro flows, and three device
fixture sources.

All unknowns are resolved in [research.md](./research.md).

## Constitution Check

*GATE: checked before Phase 0 and re-checked after Phase 1 design. The result is the same both times.*

| Principle | Status | How this plan complies |
| --- | --- | --- |
| I. Simplicity First | PASS | Snapshot change is detected from the snapshot ID the app already polls, with no new native signal (R1). The folder is re-located by name with the existing `search`, with no new method (R2). Directory counts reuse the rollup walk (R3). `FlatList`, not a new list library (R8). In-memory filter state (R10). Interleaved name sort keeps the cursor unchanged (R11). |
| II. YAGNI | PASS | No sort or search UI (clarification 5). No selection model until 006 needs it (R12). No hidden-files toggle (moved to 009). No thumbnail cache trimming beyond the OS (R7). No filter persistence (R10). |
| III. DRY | PASS | Theme, spacing and density are defined once in `src/theme/` (R9). Chip counts are derived from page-1 `counts` only. One paged-query hook serves the gallery, the list and the relocation walk (and 007's tree). `CONTRACT_VERSION`, `IMAGE_UNAVAILABLE` and the image-edge clamp are mirrored under the parity test. Status labels come from one `STATUS_LABEL` record. |
| IV. Unit tests (NON-NEGOTIABLE) | PASS | JVM tests:<br>• `DirectoryRollupTest` (counts and the invariant)<br>• `SnapshotStoreTest` (directories ignore the filter, image-only gallery, count scope, `nameInOtherSource`, `matchingFileCount`, pre-v3 null)<br>• `MigrationTest` (2 → 3)<br>• `LocalImageStoreTest` (fake resolver: cache hit, `loadThumbnail` fallback, unavailable, non-image, edge clamp)<br>• `ScanOperationsTest`, `CloudSyncModuleTest` and parity updates<br>Jest tests:<br>• contract v4 and wrappers<br>• `usePagedQuery` (snapshot change, stale response, filter switch, error recovery)<br>• `useListNavigation` (descend, ascend, relocation)<br>• `FilterChips`, `GalleryTile`, `GalleryScreen`, `ListScreen`, `FilesScreen`<br>• the accessibility-label sweep<br>Script-contract tests cover the new fixtures. Everything is deterministic, with no device or network. |
| V. E2E coverage (NON-NEGOTIABLE) | PASS | P1 US1: every acceptance scenario and FR-001…FR-005 map to a named Maestro flow ([contracts/maestro-browse.md](./contracts/maestro-browse.md#acceptance-scenario-mapping)) on API 31 and 36 against the live SFTP container. Fixtures are reproducible and nothing is manual. The protocols themselves are covered by 004's flows; browsing is protocol-agnostic. |
| VI. Versioning + CHANGELOG | PASS | `Unreleased` gets three entries: "Added: Files tab with gallery and folder list, filters and origin badges", "Changed: CloudSync contract version 4" and "Changed: scan store schema version 3". |
| VII. `./docs` | PASS | `architecture.md` (read rules, the image-handle path, theme module, and the delivery list where `getLocalImageHandle` moves to 005), `sync-and-deletion-safety.md` (how the filters map to statuses, and that directories ignore filters), `overview.md` (Files tab), and D010 (the badge rule refined: same name in another source, alias text). |
| VIII. README | PASS | A user-facing "Browse your files" section: gallery and list, what each filter shows, what the origin badge and dimmed folders mean, and "Results updated". |
| IX. DEVELOPMENT.md | PASS | The gallery fixtures (sources, remote roots, embedded PNGs), the browse flows, and the inline-styles lint rule. |
| Quality gates | Planned | Lint and typecheck, `test:ci`, `test:android:unit`, `test:foundation` and `e2e:android` (API 31 and 36) are the exit gate. |

No violations. The gate passes. The post-design re-check found no new complexity, so Complexity Tracking
is empty.

## Project Structure

### Documentation (this feature)

```text
specs/005-gallery-list-filtering/
├── spec.md                          # clarified 2026-10-01
├── plan.md                          # this file
├── research.md                      # R1–R13 decisions
├── data-model.md                    # schema v3, read rules, UI state and transitions
├── quickstart.md                    # how to validate
├── contracts/
│   ├── cloudsync-browse.md          # contract v4: DTO fields, read rules, getLocalImageHandle
│   └── maestro-browse.md            # fixtures, selectors, scenario → flow mapping
└── tasks.md                         # next: /speckit-tasks
```

### Source Code (repository root)

```text
android/app/src/main/java/com/syncscope/
├── scan/
│   ├── DirectoryRollup.kt           # + per-status descendant counts on each directory
│   └── ScanEngine.kt                # writes descSynced/descUnsynced/descUnknown on directory rows
├── persistence/
│   ├── Entities.kt                  # local_node + 3 nullable count columns
│   ├── SyncScopeDatabase.kt         # version 3, @AutoMigration(2 → 3)
│   ├── Daos.kt                      # statusCounts(snapshotId, imagesOnly, sourceId?); entry-for-image lookup
│   └── SnapshotStore.kt             # read rules (data-model): dirs ignore filter, image-only gallery,
│                                    #   nameInOtherSource probe, matchingFileCount
├── image/                           # NEW
│   └── LocalImageStore.kt           # loadThumbnail/BitmapFactory → cacheDir/thumbnails, limitedParallelism(4)
└── bridge/
    ├── CloudSyncContracts.kt        # CONTRACT_VERSION = 4; + IMAGE_UNAVAILABLE; image edge clamp
    ├── CloudSyncModule.kt           # wire getLocalImageHandle
    └── ScanOperations.kt            # map the 2 new entry fields; + imageHandle(...)

android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/3.json   # NEW (exported)
android/app/src/test/java/com/syncscope/{scan,persistence,image,bridge}/  # tests per Constitution Check

src/
├── native/
│   ├── CloudSyncContracts.ts        # v4, entry fields, LocalImage* DTOs, IMAGE_UNAVAILABLE, clampImageEdge
│   └── CloudSync.ts                 # getLocalImageHandle wrapper
├── theme/                           # NEW: single source for the MD3 shell (R9)
│   ├── theme.ts                     # paper + navigation themes (moved from App.tsx)
│   ├── spacing.ts                   # spacing, density, gridColumns
│   └── statusLabels.ts              # STATUS_LABEL, filter labels, chip a11y labels
├── files/                           # NEW
│   ├── FilesProvider.tsx            # shared { view, filter } (R10)
│   ├── usePagedQuery.ts             # paging, snapshot-change reset, stale-response guard (R1); reused by 007
│   ├── useListNavigation.ts         # stack, breadcrumb, relocation by name (R2); reused by 007
│   ├── useLocalImage.ts             # getLocalImageHandle per tile, cancelled on unmount
│   ├── FilterChips.tsx              # 4 chips with counts
│   ├── StatusChip.tsx               # status-aware rendering (provided to 006)
│   ├── GalleryTile.tsx              # thumbnail, status, origin badge
│   ├── Breadcrumb.tsx
│   └── a11y.ts                      # label builders (contracts/maestro-browse.md "Selectors")
├── screens/
│   ├── FilesScreen.tsx              # NEW: view switch + chips + Gallery/List + "Results updated" snackbar
│   ├── GalleryScreen.tsx            # NEW
│   ├── ListScreen.tsx               # NEW: sources level + folder level
│   ├── ScanScreen.tsx               # inline color styles → themed StyleSheet
│   └── PlaceholderScreen.tsx        # removed if unused once Files is real
├── scan/ScanSummaryCard.tsx         # inline color styles → themed StyleSheet
├── sources/SourcesSection.tsx       # inline color style → themed StyleSheet; alias lookup reused
└── navigation/AppNavigator.tsx      # Files tab renders FilesScreen inside FilesProvider
App.tsx                              # themes from src/theme
.eslintrc.js                         # react-native/no-inline-styles: error

validation/maestro/browse/           # NEW: 01…05 flows (contracts/maestro-browse.md)
validation/maestro/subflows/open-files.yaml   # NEW
scripts/validation/
├── device-fixtures.sh               # + SyncScopeE2E/Gallery, GalleryTwin, GalleryBulk (embedded PNGs)
├── fixture-seed.sh                  # + gallery/, gallery-partial/ (restricted 0700)
└── validation-infrastructure.test.mjs

docs/  README.md  DEVELOPMENT.md  CHANGELOG.md   # per Principles VI–IX
```

**Structure Decision**: one Android app module plus the JS presentation layer, as in 002–004. Native
thumbnail work gets its own `image` package, because it is local content I/O, a different concern from
the scan store. Browse glue stays in `bridge/ScanOperations.kt`, next to the existing query methods. JS
browsing code lives in `src/files/`: the hooks 007 reuses plus small components. The screens live in
`src/screens/`, following the existing layout.

## Integration closure

This feature hands feature 007:

- the theme module, `FilterChips`, `StatusChip` and the accessibility-label builders;
- `usePagedQuery` (with snapshot-change recovery) and `useListNavigation` (with breadcrumb and
  relocation), for the tree view;
- `queryTreeChildren` with filter-independent directories and `matchingFileCount`, which is exactly the
  dimmed-with-count rule 007's tree needs;
- `getLocalImageHandle` with a clamped `maxEdgePx`, which the preview calls with the screen's long edge.

It hands feature 006:

- `entryId`-keyed rows with `status`, rendered status-aware by `StatusChip`. The selection model itself is
  006's (research R12).

Spec follow-ups (cross-feature consistency, not blocking tasks):

- The 007 spec should drop "`getLocalImageHandle` implemented" from its Provides list and consume it from
  005. Its FR-001 clarification is answered by 005's directory rule.
- The 009 spec should list the include-hidden-files setting (reassigned in 005's clarify session).
- Already applied to the 005 spec: `getLocalImageHandle` moved in, FR-005's trigger is any snapshot change,
  and the selection model is left to 006 (R12).

## Risks

| Risk | Mitigation |
| --- | --- |
| Published snapshots are never pruned, and every app open publishes a `LOCAL_REFRESH`, so the database grows over time (a 004 behaviour that this feature makes more visible through thumbnails per snapshot `entryId`) | Out of scope here. It is recorded as a follow-up for 009 (retention of the last N snapshots). Thumbnails sit in `cacheDir`, which the OS reclaims. |
| A "Results updated" snackbar after every foreground return feels noisy | It only appears when the Files tab had rows loaded and the snapshot really changed. Revisit in human acceptance (quickstart §3). A follow-up could skip it when a `LOCAL_REFRESH` changed no statuses. |
| `loadThumbnail` behaves differently between API 31 and API 36 for SD-card documents | The `BitmapFactory` fallback is unit-tested, and the Maestro gallery flows run on both API levels. |
| The emulator renders 2 000 tiles slowly, which makes flow 01 flaky | Fixed tile layout, `pageSize` 100, and an assertion that only needs *some* later tile visible after scrolling. If needed, the flow's waits and scroll count are tuned; the bulk count never drops below 2 000 (spec scenario 1). |
| A name-equality badge misses an NFC/NFD twin across sources | Accepted (R5): a missing badge is cosmetic, and the status is still right. |

## Complexity Tracking

No entries. The Constitution Check has no violations to justify.
