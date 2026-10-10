# Research: Gallery View, Browsable List, Filtering and Material 3 Shell

Decisions behind [plan.md](./plan.md). Each entry gives the decision, why it was chosen, and what else was
considered. Code references are to the tree at commit `44a540a` (feature 004 merged).

## R1. How a view notices a new snapshot (the "STALE_GENERATION" recovery of FR-005)

- **Finding**: published snapshots are never deleted. `SnapshotStore.publish` flips the active pointer and
  `discardRun` only removes *staged* snapshots. `queryFiles` / `queryTreeChildren` take an explicit
  `snapshotId`, so a page token for the previous snapshot stays valid after a rescan. No query ever returns
  `STALE_GENERATION`; that code is raised only by publish and discard inside the engine. The only query
  errors are `SNAPSHOT_NOT_FOUND` (staged or missing snapshot) and `PAGE_TOKEN_MISMATCH`.
- **Decision**: the shared paged-query hook keys every read on `useScan().active.snapshotId`. When that ID
  changes while the view holds rows, the hook drops its rows and tokens, reloads page 1 for the new
  snapshot and raises a "Results updated" snackbar (spec clarification 4). `SNAPSHOT_NOT_FOUND` and
  `PAGE_TOKEN_MISMATCH` take the same path after one `refresh()` of the scan state. `STALE_GENERATION` is
  handled the same way if it ever appears, so the clarified wording still holds.
- **Rationale**: the snapshot ID is already the identity of "one consistent read" (D010), and `ScanProvider`
  already polls it while a run is active. No native change is needed, and rows from two snapshots can
  never be combined because each page is tied to the ID it was read for.
- **Note**: `ScanProvider` runs a `LOCAL_REFRESH` on every app open and return to foreground (004 FR-003),
  and each one publishes a new snapshot. The snackbar therefore appears after a foreground return whenever
  the Files tab has loaded rows. That is the accepted behaviour: the rows really were replaced.
- **Alternatives rejected**: making queries reject non-active snapshots with `STALE_GENERATION` (a
  breaking contract change that 004's tests pin, and it only moves the detection later, to the next page
  fetch); comparing generations in JS (the snapshot ID already carries that identity).

## R2. Re-locating the current folder in a new snapshot

- **Finding**: `local_node.entryId` is a fresh random ID per snapshot (`ScanEngine.newId()`), so a folder's
  ID does not survive a rescan.
- **Decision**: the list view's navigation stack stores `{ entryId, name }` per level plus the root
  `sourceId`. After a snapshot change it walks the names from the source root in the new snapshot. At each
  level it calls `queryTreeChildren(newSnapshot, parentId, { search: name, filter: 'ALL', … })` and keeps
  the `DIRECTORY` row whose name is exactly equal. The walk stops at the first level that is missing, which
  gives the nearest surviving ancestor (or the top level if the source itself was removed).
- **Rationale**: no new native method; `search` already exists (`LIKE` with escaping, ≤ 256 chars) and a
  folder name is bounded. The depth is the breadcrumb length, normally < 10 calls.
- **Alternatives rejected**: a stable path-hash entry ID (a change to 004's identity model and every test
  that inserts rows); a native `resolvePath` method (one more bridge method for a once-per-rescan walk).

## R3. Directory rows under a filter (clarification 3)

- **Finding**: `queryFilePage` applies the filter to every row, including directories, using the rolled-up
  directory status (worst-of, `DirectoryRollup`). Under `SYNCED`, a folder holding one unsynced file
  disappears, and a folder with no synced files at all is listed as long as it is empty. That is the
  opposite of the clarified rule.
- **Decision**:
  1. Directory rows are always returned by `queryTreeChildren`, whatever the filter. The filter narrows
     `FILE` rows only.
  2. At scan time, `DirectoryRollup` also counts the descendant files of each directory per status. The
     three counts are stored on the directory's `local_node` row (`descSynced`, `descUnsynced`,
     `descUnknown`; `NULL` on files). This is Room schema version 3, an additive `@AutoMigration` from 2.
  3. Each directory `FileEntryDto` carries `matchingFileCount`: the count for the active filter (`ALL` = the
     sum; `ISSUES_UNKNOWN` = `descUnknown`, since only `UNKNOWN` rows carry an issue code per `Matcher`).
     The UI dims a directory whose count is 0 and still lets the user open it.
- **Rationale**: the rollup already visits every file once and knows each ancestor chain, so counting there
  is O(files × depth) once per scan. Reads stay O(1) per row. A recursive CTE per directory on every page
  would cost up to 200 tree walks per page on 50 k rows.
- **Alternatives rejected**: a recursive CTE at read time (cost above); counting only direct children
  (misses matches in subfolders, which is what the user is looking for); a separate `directory_counts`
  table (a join on every page for data that is 1:1 with the directory row).
- **Old snapshots**: rows written before version 3 have `NULL` counts. `matchingFileCount` is then `null`
  and the row shows no count and is never dimmed. In practice a `LOCAL_REFRESH` on the next app open
  replaces such a snapshot.

## R4. The list view's top level

- **Finding**: `queryTreeChildren(snapshotId, null, …)` returns the direct children of *every* source root
  mixed together, which loses the "which folder am I in" context that FR-002 relies on.
- **Decision**: the list view's top level lists the **sources**: one row per source from `listSources`
  (alias), each showing its matching-file count under the active filter. Tapping a source descends with
  `queryTreeChildren(snapshotId, null, { sourceId })`. The breadcrumb reads `All folders › <alias> › …`.
  A source's count comes from the first-page `counts` of a one-row
  `queryTreeChildren(…, { sourceId, pageSize: 1 })` read, which is why counts honour `sourceId` (R6).
- **Rationale**: sources are what the user picked, and the alias is already their display name (D016). At
  most 20 sources (004 R9 scale), so ≤ 20 one-row reads.
- **Alternative rejected**: synthetic source-root rows from native (a new row kind in the contract).

## R5. Duplicate tiles and the origin badge (clarification 1, FR-001)

- **Decision**: `FileEntryDto` gains `nameInOtherSource: boolean`. For `GALLERY` reads it is computed in the
  page SQL as
  `EXISTS (SELECT 1 FROM local_node d WHERE d.snapshotId = n.snapshotId AND d.kind = 'FILE' AND d.name = n.name AND d.sourceId <> n.sourceId)`.
  The existing `(snapshotId, name, sizeBytes)` index serves the probe. For `LIST` reads it is always
  `false`: list view never shows a badge (FR-002), so the probe is skipped.
- **Badge text**: the tile's source alias, looked up in JS from `listSources` by `sourceId`. No new native
  field, and nothing path-like crosses the bridge.
- **Name equality**: the stored `name` (the original form, not NFC), compared case-sensitively. This
  matches what the user sees on the tiles. NFC/NFD twins across sources are rare and would only cost a
  missing badge, not a wrong status.
- **Alternatives rejected**: storing a duplicate flag at scan time (a source removal would have to rewrite
  rows in other sources); comparing name + size (rejected by the user in clarification 1).

## R6. Chip counts and the gallery's file set

- **Finding**: the first-page `counts` come from `statusCounts(snapshotId)`, which counts every `FILE` row
  of the snapshot whatever the view. The `GALLERY` row filter keeps `image/%` **and** `video/%`. So the
  gallery chips would count text files the gallery never shows, and the gallery would show videos the app
  cannot preview (R029).
- **Decision**:
  - `GALLERY` keeps `image/%` only, in line with the spec's assumption and R029.
  - Counts are scoped like the rows except for the filter itself: `kind = 'FILE'`, plus `image/%` for
    `GALLERY`, plus `sourceId` when given. `parentId` and `search` do **not** narrow counts. List-view chips
    therefore show snapshot-wide (or per-source, R4) totals, and the folder rows carry their own counts.
  - Chip counts: `ALL` = sum, `SYNCED`, `UNSYNCED`, `ISSUES_UNKNOWN` = `UNKNOWN` (equal by `Matcher`
    construction; a parity unit test pins it).
- **Rationale**: SC-002 needs "the number on the chip equals what the chip shows". Scoping counts by view
  makes that true in the gallery. Snapshot-wide counts in list view match the Scan tab summary, which is
  the snapshot's per-status count.
- **Alternatives rejected**: a JS-side count by paging everything (defeats D010); per-folder chip counts in
  list view (a recursive count per navigation, and the folder rows already show it).

## R7. Gallery thumbnails: `getLocalImageHandle` (moved from 007, user decision 2026-10-01)

- **Decision**: `getLocalImageHandle(snapshotId, entryId, { maxEdgePx })` is implemented in this feature.
  - Native looks up the row (must be a published snapshot and a `FILE` with an `image/*` MIME type) and its
    `documentUri`.
  - It calls `ContentResolver.loadThumbnail(documentUri, Size(maxEdge, maxEdge), signal)` (API 29+; the
    external-storage provider supports it). If that throws `UnsupportedOperationException`, it falls back
    to `BitmapFactory` with `inSampleSize`.
  - The result is written as JPEG (quality 85) to `cacheDir/thumbnails/<sha256(entryId|maxEdge)>.jpg`,
    reused when present, and returned as `{ uri: "file://…" }`.
  - `maxEdgePx` is clamped to 64…2048. The gallery asks for 256; 009's preview will ask for the screen's
    long edge.
  - Work runs on `Dispatchers.IO.limitedParallelism(4)`, so a fast fling cannot start hundreds of decodes.
- **Errors**: a new code `IMAGE_UNAVAILABLE` ("This image could not be read on the device." / "Check that
  the folder is still available, then rescan.") covers a file that is gone, a revoked grant and an
  undecodable file. A non-image entry → `INVALID_QUERY` (`field: "entryId"`). An unknown snapshot →
  `SNAPSHOT_NOT_FOUND`. The tile shows a broken-image icon and keeps its status chip.
- **Rationale**: `documentUri` must not cross the bridge (004 contract, `ScanOperations` header, D016
  spirit). A thumbnail in the app's own cache is not user data or a user path. Decoding full-resolution
  photos into a 3-column grid would exhaust memory. Content is read from local storage only, so R026
  (no remote content) is untouched.
- **Cache lifetime**: `cacheDir` is reclaimed by the OS under pressure. The key includes `entryId`, which is
  per snapshot, so old snapshots' thumbnails simply stop being requested. An explicit trim is deferred
  (YAGNI) and listed as a risk.
- **Alternatives rejected**: passing the SAF content URI to `<Image>` (leaks `documentUri` and loads full
  size); an in-memory LRU only (lost on every remount, so the grid re-decodes while scrolling back);
  base64 over the bridge (2–3× the bytes through the bridge on every tile).

## R8. Virtualized grid and list without new dependencies

- **Decision**: React Native `FlatList` with `numColumns={3}`, `getItemLayout` (fixed square tiles), and
  `windowSize` / `maxToRenderPerBatch` tuned. `onEndReached` fetches the next page (`pageSize` 100, under
  the 200 clamp). The list view uses `FlatList` with fixed-height `List.Item` rows.
- **Rationale**: no new dependency (Principle I). Fixed item sizes give `FlatList` O(1) layout, which is
  enough for 50 k rows read 100 at a time.
- **Alternative rejected**: `@shopify/flash-list` (a new native-adjacent dependency for a gain the
  thousands-of-tiles scenario does not need). Revisit only if the API 31 emulator flow shows blank-tile
  churn.

## R9. Material 3 shell: theme, spacing and density, no inline styles (FR-004)

- **Decision**: `src/theme/` holds the single source of truth:
  - `theme.ts`: the MD3 light/dark themes (moved out of `App.tsx`, still `MD3LightTheme` / `MD3DarkTheme`
    based) and the navigation theme derived from them;
  - `spacing.ts`: `spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 }`, `density = { tileGap: 2, rowHeight:
    56, chipHeight: 32 }` and `gridColumns = 3`.
  - Components read colours through `useTheme()` and build styles with `StyleSheet.create` from the tokens.
  - The existing `style={{ color: … }}` uses in `ScanScreen`, `ScanSummaryCard` and `SourcesSection` move
    to themed `StyleSheet`s or Paper `textColor` / `theme` props, so the rule holds app-wide.
  - ESLint: `react-native/no-inline-styles` is set to `error` (lint runs with `--max-warnings=0` already).
- **Accessibility-label convention**: every interactive element has an `accessibilityLabel`, which is also
  its Maestro selector. The labels are listed in [contracts/maestro-browse.md](./contracts/maestro-browse.md#selectors).
  A Jest helper renders each new screen and asserts that every pressable node has a non-empty label.
- **Alternatives rejected**: a styling library (new dependency); a custom Paper theme palette (aesthetic
  judgement is left to human acceptance per FR-004).

## R10. Filter state shared across views

- **Decision**: a `FilesProvider` around the Files tab holds `{ view: 'GALLERY' | 'LIST', filter }` in React
  state. Gallery and list (and 009's tree) read the same filter. It is not persisted across restarts (the
  clarify session left this as low-impact; the default is `ALL`).
- **Rationale**: FR-003 requires consistency across views, not persistence. In-memory state is the
  simplest way to meet it.

## R11. Fixed sort (clarification 5)

- **Decision**: gallery `TIME_DESC`, list `NAME_ASC`, set by the view. Directories and files are
  interleaved by name in list view, because 004's keyset cursor orders by `(sortColumn, entryId)` only.
- **Alternative rejected**: directories first (adds `kind` to the cursor and the token fingerprint for a
  cosmetic gain; it can come with a later sort feature).

## R12. Selection model (spec "Provides" to 006)

- **Decision**: not built here. This feature has no selection UI and no requirement that reads a
  selection. 006 builds the selection model on top of the `entryId`-keyed rows and status chips delivered
  here.
- **Rationale**: Principle II (YAGNI). An unused hook would be dead code until 006.
- **Follow-up**: the spec's "Provides" list is updated accordingly (status-aware rendering stays).

## R13. End-to-end fixtures

- **Decision**: real, decodable images are needed for thumbnails (the 004 `.jpg` fixtures are text).
  `device-fixtures.sh` gains three sources, built from a few tiny PNGs embedded as base64 in the script
  (no image tool dependency):
  - `SyncScopeE2E/Gallery`: `sunset.png`, `beach.png` and `album/forest.png` (all on the remote, so SYNCED),
    `harbor.png` and `album/notes.txt` (local only, so UNSYNCED), and an empty-after-filter folder
    `drafts/` holding only `draft.png` (UNSYNCED);
  - `SyncScopeE2E/GalleryTwin`: one `sunset.png` with different bytes (UNSYNCED, and a name twin of
    Gallery's `sunset.png`);
  - `SyncScopeE2E/GalleryBulk`: 2 000 copies of one PNG named `g0000.png`…`g1999.png` (UNSYNCED), for the
    thousands-of-tiles scenario.

  `fixture-seed.sh` gains the remote side `gallery/` with byte-identical `sunset.png`, `beach.png` and
  `album/forest.png`, with mtimes set as for `scan/clean`.
- **Rationale**: exact, reproducible counts per chip (SC-002) and one controlled name twin (scenario 3).
