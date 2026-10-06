# Research: Sorting, Fast Scrolling, Several Server Folders and an App Icon

Phase 0 of [plan.md](./plan.md). Each entry records a decision, why it was taken, and what was rejected.
Spec references are to [spec.md](./spec.md) (clarified 2026-10-05, 5 questions).

## R1. Sort contract: six sorts, unknown values last, total order

**Decision**

- `FileSort` gains `SIZE_ASC` and `SIZE_DESC` next to `NAME_*` and `TIME_*` (contract v6). The UI labels map
  one to one: Name (A–Z) / (Z–A), Date (newest first) / (oldest first), Size (largest first) / (smallest
  first).
- Every sort orders by `(primary key, sortName, entryId)` in the sort's direction. Name ties are broken
  by `sortName` (R2), so equal sizes or dates read alphabetically; `entryId` makes the order total, so
  keyset paging never repeats or skips a row (FR-005).
- Unknown values come last in both directions (FR-005): the primary key is
  `COALESCE(col, sentinel)` with the sentinel `Long.MAX_VALUE` for ascending and `-1` for descending. This
  changes today's `TIME_ASC`, which put unknown times first; nothing relies on that order.
- The page token keeps D010's opaque, clamped contract. Its cursor grows from `(sortKey, lastEntryId)` to
  `(sortKey, sortName, lastEntryId)`; `PageTokenCodec` gets a format version, so a token minted by an
  older build is rejected as `PAGE_TOKEN_MISMATCH`, which `usePagedQuery` already recovers from.

**Rationale**: one rule for all six sorts, no per-sort special cases in SQL. The spec asked for "name, then
path" as the tie-break; rows have no stored path, and `entryId` is the existing stable tie-breaker within
a snapshot, so the plan uses name, then `entryId`. The visible effect is the same: equal keys read by name.

**Alternatives rejected**: `ORDER BY col IS NULL, col` (a fourth cursor component and an extra index
column for no gain over a sentinel); OFFSET paging (D010 fixes keyset tokens and OFFSET breaks while rows
are deleted, 006 R14).

## R2. Name order and letter bands: a stored `sortName`

**Decision**: `local_node` gets `sortName TEXT NOT NULL` (schema v5), computed once per row by the scan in
one Kotlin function `SortName.of(name)`:

1. Unicode NFKD, combining marks removed, lowercased with `Locale.ROOT` (`É` → `e`, `Ä` → `a`).
2. Prefixed with `1` when the first character is now `a`–`z`, else `0`.

So all `#` names (digits, symbols, non-Latin scripts) sort first, then `a`…`z`, and every letter band is
one contiguous range of the sort (FR-007, Story 2 sc. 3). Name sorts order by `sortName` (case- and
accent-insensitive, as users expect) instead of today's binary `name`. The letter of a row is
`#` for prefix `0`, else the second character of `sortName`.

The migration fills existing rows in SQL (`lower(name)` with the same prefix rule, accents not folded).
Old snapshots are replaced by the app-open `LOCAL_REFRESH` anyway, which recomputes `sortName`.

**Rationale**: SQLite's `NOCASE` folds ASCII only and puts `é` after `z`, which would split letter bands.
A stored key keeps the sort indexable and the band query a `GROUP BY`.

**Alternatives rejected**: a custom SQLite collation (Room/Android cannot register one portably on the
framework SQLite); sorting in Kotlin (breaks keyset paging over 50 k rows).

## R3. List view: folders first, as their own read

**Decision**: `QuerySpec` gains an optional `kind: 'DIRECTORY' | 'FILE'` that narrows the rows (part of the
query fingerprint). List view reads a folder in two parts: its subfolders (`kind: 'DIRECTORY'`, always
`NAME_ASC`), then its files (`kind: 'FILE'`, the chosen sort). The JS list shows the folders first, then
the files (FR-004). Gallery reads `FILE` rows only already.

**Rationale**: a single keyset over "folders by name, then files by size descending" needs a mixed-direction
composite cursor. Two plain reads keep each one a simple keyset query and reuse everything else.

**Alternatives rejected**: `ORDER BY kind, CASE …` in one query (mixed directions, fragile tokens); sorting
folders with the files (spec FR-004 says folders stay on top).

## R4. The scroll index: one native read per result

**Decision**: a new bridge method `getScrollIndex(snapshotId, querySpec, anchor?)`
([contract](./contracts/cloudsync-polish.md#getscrollindex)) returns, for the files of the query:

- `totalCount`, the `unit` (`LETTER`, `YEAR`, `MONTH`, `DAY`, `SIZE`) and the ordered `bands`, each with its
  lower bound (`letter`, `startMillis` or `lowerBytes`), `startIndex`, `count` and a `startToken`;
- an `unknown` band at the end for files without a size or date (they sort last, R1);
- `anchorIndex` when an anchor is passed (R8).

`startToken` is an ordinary opaque page token (D010) whose cursor sits just before the band's lower
bound, so reading from it returns the band's first row. Bands are computed in Kotlin from one indexed read
of the sort column (a `GROUP BY` for letters; the sorted values for sizes and dates, at most 50 k longs).
Filters, view, folder and source scope the index exactly as they scope the rows (Story 2 sc. 8).

Budget: under 150 ms for 50 k rows on the JVM budget test next to `SnapshotQueryPerformanceTest`; the
device call is well inside SC-003's 1 s.

**Rationale**: the thumb must reach rows that are not loaded (FR-006) without loading every page in
between. Band start tokens give random access while keeping D010's keyset contract.

**Alternatives rejected**: loading pages until the target (50 k rows is 250 calls); OFFSET reads (R1);
computing bands in JS (needs every row).

## R5. Dynamic size bands

**Decision** (FR-007a, user decision 2026-10-05). From the sorted sizes of the files shown:

1. Take the 5th and 95th percentiles `p5`, `p95`.
2. **Wide range** (`p95 / p5 ≥ 10`): boundaries from the 1-2-5 series (… `100 KB`, `200 KB`, `500 KB`,
   `1 MB`, `2 MB`, `5 MB` …) between `p5` and the maximum.
3. **Narrow range** (`p95 / p5 < 10`): a linear step `nice((p95 − p5) / 10)`, where `nice` rounds to 1, 2
   or 5 × 10ⁿ bytes (so 0.2 MB for files of 3–5 MB), starting at `floor(p5 / step) × step`. Everything
   above the last step joins a top band; everything below `p5` joins the first.
4. Drop empty bands. If a band still holds more than half of the files and the files have at least 8
   distinct sizes, split it once with the narrow rule applied to its own values. If more than 15 bands
   remain, merge neighbours pairwise until at most 15.

Bands carry `lowerBytes`; JS labels them with the existing `formatBytes` (decimal units, 006 R10), which
gives labels such as `3 MB`, `3.2 MB`, `500 KB`. The label means "from this size up to the next band".

**Rationale**: percentiles keep a few huge files from stretching every band (spec edge case), and the two
regimes give round labels in both a 50 KB–2 GB library and a 3–5 MB one (Story 2 sc. 5). It is a pure
function, unit-tested on fixed size lists, including SC-008's fixtures.

**Alternatives rejected**: equal-count quantile bands (labels like `3.137 MB`); the fixed list from the
first draft (the user rejected it).

## R6. Adaptive date bands

**Decision** (FR-007b): from the sorted modified times, in the device's time zone
(`ZoneId.systemDefault()`), count non-empty years; if fewer than 5, count months; if fewer than 5, use days.
Labels are `YYYY`, `MM.YYYY` or `DD.MM.YYYY`, built in JS from `startMillis` and `unit`. Dates are banded
natively because the bands must line up with the rows the native sort returns.

**Rationale**: the coarsest unit with at least 5 bands is the rule the user accepted; one unit per
scrollbar keeps labels comparable.

## R7. Band-segmented paging in the views

**Decision**: `usePagedQuery` grows into a segmented reader. When the index arrives, the result is the
concatenation of its bands. Each band is read lazily from its `startToken`, forward, until the band's
`count` rows are in. Rows of bands not yet read are placeholders, so the list has its full length at once:
the gallery keeps fixed tiles, and list rows get the fixed `density.rowHeight` they already use, so
`getItemLayout` works and `scrollToIndex` reaches any band. Visible bands load from
`onViewableItemsChanged`. List view puts its folder read (R3) in front as segment 0.

The first page and the index are requested together, so the first paint is not delayed. Before the index
arrives, the view behaves exactly as today. Stale-response guards, `STALE_GENERATION` recovery and the
deletion `reloadKey` keep their current rules (005 R1, 006 R14).

**Rationale**: one paging mechanism for linear scrolling and jumps, built from tokens the native side
already understands. A single band (for example all files on one day) degenerates to today's linear
paging.

**Alternatives rejected**: a second "jump" mode next to linear paging (two code paths to keep in step);
bidirectional keyset paging (reverse queries for every sort).

## R8. Keeping the place when results update

**Decision** (FR-014): each view keeps, from `onViewableItemsChanged`, an anchor for its first visible
file: its primary sort value and `sortName`. These are values, not IDs, because entry IDs change with
every snapshot. On a snapshot change (rescan or app-open refresh), the view asks for the new index with
that anchor. Native counts the rows that sort before the anchor and returns it as `anchorIndex`; the view
scrolls there and reads that band. The file itself, when it still exists, lands at the top. When it is
gone, its neighbour does (Story 4 sc. 2). List view relocates the folder by name first, as it already does
(005 R2), then applies the anchor. The hidden view does the same when its snapshot changes, so it is in
place when shown. The "Results updated" snackbar is unchanged.

**Rationale**: this is the bug the user reported. Today the snapshot change drops the rows and reloads
page 1, which is what jumps to the top.

## R9. The scrollbar control

**Decision**: a `FastScroller` component built on React Native's `PanResponder` and `Animated` (no new
dependency):

- It shows only when the content is more than three viewports tall (FR-006), and fades out 1.5 s after
  scrolling stops.
- While dragging, a label bubble shows the band under the thumb. On release, the view scrolls to that
  band's `startIndex`.
- For TalkBack it is `accessibilityRole="adjustable"`, its `accessibilityValue` is the band label, and the
  increment and decrement actions move to the next or previous band (FR-008).

**Alternatives rejected**: `react-native-gesture-handler` plus Reanimated (two native dependencies for one
control); FlatList's built-in indicator (no labels, and not draggable on Android).

## R10. Sort and view drop-downs, remembered

**Decision**: the Files toolbar replaces the `SegmentedButtons` with two Paper `Menu`s anchored to outlined
buttons, sort first, then view (FR-001). Each button shows its current choice in its label and
accessibility label (FR-017).

The view mode and each view's sort are stored natively in `SharedPreferences` through two new bridge
methods, `getBrowsePreferences` and `setBrowsePreferences` (clarification 5). `FilesProvider` loads them
before the views mount and writes on change. The filter stays in memory (005 R10).

**Rationale**: no new JS dependency, and preferences need no schema or migration.

**Alternatives rejected**:

- `@react-native-async-storage/async-storage`: a new native dependency for three values.
- Reusing `getSettings`: it belongs to feature 010's hidden-files setting, and implementing half of it
  here would blur that ownership.

## R11. Several remote folders: storage and validation

**Decision**:

- **Storage**: `repository_config.remoteRoot` is renamed to `remoteRoots` by the 4 → 5
  `@AutoMigration` (`@RenameColumn`) and holds the folders `\n`-separated, in the order the user gave.
  An existing single folder is therefore already a valid one-element list (FR-013, Story 3 sc. 7). The
  `remote_match_key.directories` column (006) set the precedent for this encoding.
- **Normalization and overlap**: one Kotlin type, `RemoteRoots`, owns both (Principle III). A folder is
  trimmed, `/`-prefixed, its repeated `/` collapsed and its trailing `/` dropped. Two folders overlap when
  they are equal or one is a path prefix of the other at a `/` boundary. A newline in a folder is
  rejected. Save refuses an empty list or an overlap with a field error (`field: 'remoteRoots'`, plus the
  new `fieldIndex`), and its message names the other folder (FR-009). JS does not repeat the rule; it shows
  the error at that field.
- **Connection**: `RemoteConfig` carries `rootPaths: List<String>`; precision discovery samples the first
  folder. Every folder joins `sensitiveValues` for redaction.
- **Debug seam**: `ConfigureRepositoryActivity` accepts `root` more than once (D018).

**Rationale**: the rename keeps one source of truth with no data copy, and the migration is automatic.

**Alternatives rejected**: a `remote_folder` table (a join and a manual migration for an ordered list of
short strings); an extra `extraRoots` column next to `remoteRoot` (two places holding one list).

## R12. Testing every folder

**Decision**: `testRepository` connects once, then lists each folder. The result keeps `entryCount` (the
total) and adds `folders: [{ path, entryCount | null, error | null }]`. It is `ok` when the server
connected, even if some folders failed. The form then shows "Connected" with a per-folder line, and a
failing folder shows its error and suggested action under its own field (FR-010). Only connect, login and
host-key failures fail the test as a whole, as today.

**Rationale**: a mistyped folder is a field-level problem, not a broken server. Saving still succeeds, so
the user can fix one folder without retyping the rest.

## R13. The server folder browser

**Decision** (FR-009a, clarification 2): a new bridge method
`browseRemoteFolders(config, transientPassword?, path?)` validates `config` with the same `parse()` as
save, connects, lists `path` (or `/` when null), and returns `{ path, parent, folders: string[] }`, holding
directory names only. It never saves anything.

- **Password**: when `transientPassword` is absent and the account matches the stored one (`sameAccount`),
  the stored credential is used. Otherwise the call returns `CREDENTIAL_UNAVAILABLE`, with an action asking
  for the password.
- **Host key**: an untrusted SFTP key returns the existing host-key challenge. The JS side reuses
  `HostKeyDialog` and retries after approval (spec edge case).
- **Connections and errors**: one connection per call, closed at once. A missing start path falls back to
  `/` (Story 3 sc. 11). Errors use the same envelope and fix actions as the connection test (sc. 12).
- **UI**: an RN `Modal` inside `RepositoryScreen`, so the typed password never leaves the form's state.
  It shows a breadcrumb, a list of folders, "Use this folder" and a loading indicator. Responses for a
  folder the user has already left are ignored (a request sequence number, as in `usePagedQuery`).
- **Overlap**: the browser lets the user pick any folder; save refuses an overlap (R11).

**Rationale**: the existing `list` call, `parse` and host-key machinery cover everything, so the browser
is mostly UI.

**Alternatives rejected**:

- A stack screen: the password would have to travel in navigation params.
- A persistent browse session: it needs connection lifetime management, and the per-folder reconnect costs
  about 0.3 s, which is acceptable.

## R14. A scan that cannot read some folders

**Decision** (FR-011, clarification 3):

- **Walk**: `RemoteWalker.walk` takes the list of folders, enqueues them all and keeps today's rules
  below them.
- **A folder failing**: when a folder fails after the retry policy, the walk records a new gap scope
  `REMOTE_FOLDER` whose reason is the error code, together with the folder path in a new nullable column
  `remote_ambiguity.remotePath` (schema v5). It then carries on with the other folders.
- **All folders failing**: the walk raises `RootListingFailed` with the first folder's code, so the scan
  fails and the current result stays. With one folder this is exactly today's behaviour (Story 3 sc. 6).
- **File verdicts**: a folder gap makes the listing `Incomplete`, so `Matcher` keeps its rules. Files
  with an exact match stay SYNCED; every other file is UNKNOWN, never UNSYNCED. Their `issueCode` is the
  new `FileIssueCode.REMOTE_FOLDER_UNREAD` whenever a folder gap exists, and otherwise the first failure
  code, as today.
- **Warning**: `ScanSummaryDto` gains `unreadRemoteFolders: string[]`. The Scan tab's summary card shows
  the warning naming them, and a file row with `REMOTE_FOLDER_UNREAD` appends the names to its issue text
  (Story 3 sc. 5).
- **Refresh**: `LOCAL_REFRESH` copies the gap rows with their paths (`REMOTE_SCOPES` gains
  `REMOTE_FOLDER`), so the warning survives the app-open refresh until a full scan reads every folder.

**D011**: only configured folders, which already cross the bridge in the repository summary, are
recorded. Paths discovered during the walk are never stored in a gap row.

**Rationale**: the walker already has the "incomplete listing → UNKNOWN" path (004 clarification 1).
Folder failures become one more kind of gap, so no new verdict rule is needed and the honesty guarantee
(D006) carries over.

## R15. The empty Android folder picker

**Findings**: the folder picker is the system DocumentsUI activity started by `ACTION_OPEN_DOCUMENT_TREE`
([SourcePicker](../../android/app/src/main/java/com/syncscope/source/SourcePicker.kt)). The app controls
only the intent: its flags and `EXTRA_INITIAL_URI` (DCIM since 006 R7). It cannot draw a loading
indicator inside the picker or cancel the picker's own folder loads. Public sources describe neither an
app-side cause nor a fix for large folders showing empty
([Android docs](https://developer.android.com/training/data-storage/shared/documents-files)).

**Decision**: the first task is a time-boxed spike that reproduces the bug on the API 31 and API 36
emulators with a 10,000-file folder (the new `Big` device fixture). It checks whether the intent's starting
URI or flags change the outcome, and the result is recorded in this entry. Then:

- **If an intent change fixes it**: ship that change, with a regression test in `SourcePickerTest`.
- **Otherwise (expected)**: ship the hint the user chose. Before the picker opens, `SourcesSection`'s
  existing picker hint adds: "For a folder with thousands of files, such as Camera, select it from its
  parent folder (tap the folder's name once and choose Use this folder) instead of opening it."
  Story 5 sc. 3 and 4 (spinner, cancel on back) are then recorded as not possible from the app, and the
  E2E flow adds the large folder the hinted way.

No in-app device folder browser and no picker replacement, per the user's "do not implement too complex
solutions" (clarification 4).

### Spike result (2026-10-06)

Setup: `scripts/validation/device-fixtures.sh` on the `dependency_api31` and `dependency_api36` emulators
(emulator 37.1.11.0), so `/sdcard/DCIM/Big` held 10,000 empty `.jpg` files. The picker was started with
`adb shell am start -a android.intent.action.OPEN_DOCUMENT_TREE`, which is the intent `SourcePicker`
sends (same action, same `EXTRA_INITIAL_URI`); its contents were read with `uiautomator dump` and
screenshots, once a second at first, then after 5, 15 and 30 s. DocumentsUI was force-stopped before each
start, so no run reused a cached listing.

What each API level shows when `Big` is opened from `DCIM`:

| | API 31 | API 36 |
| --- | --- | --- |
| First open | "Files in Big" header over a blank list, **no loading bar or spinner**, for 1–2 s; then the files | the same blank list for 3–5 s; then the files |
| Back to `DCIM`, open `Big` again | blank for 1–2 s, then the files | blank for 3–5 s, then the files |
| Still blank after 30 s | never | never |

- **Starting point and flags**: `EXTRA_INITIAL_URI` unset or the volume root (both open the storage
  root), `DCIM` (today's value) and `DCIM/Big` itself all give the same blank-then-files delay once `Big`
  is shown. Adding or leaving out the read, write and persistable grant flags changes nothing. The delay is
  DocumentsUI loading the 10,000 rows from `ExternalStorageProvider`; no part of the intent reaches it.
- **Selecting `Big` from `DCIM` without opening it**: not possible on either level. In tree-pick mode a tap
  on a folder opens it, and a long press neither selects it nor offers an action; `Use this folder` always
  means the folder currently shown.
- **`Use this folder` while the list is still blank** works on both levels: it shows the system
  "Allow … to access files in Big?" dialog at once, before any file is listed.
- **Removable card**: both emulators have a public SD card volume (`0000-0000`). With 10,000 files in
  `DCIM/Big` there, the picker behaves as on primary storage (API 31: blank 1–2 s; API 36: blank 3–5 s;
  the same on a second open).

The emulators did not reproduce a folder that stays empty: they show a blank list with no progress
indicator for a few seconds, which is the symptom a user reads as "empty" and backs out of. The phone's
`Camera` folder (thousands of real photos, slower storage) will take longer, but nothing in the intent
changes it.

**Chosen branch: B (hint).** No intent change fixes or shortens the blank list, so T048 ships the hint, not
an intent fix. The hint text above ("select it from its parent folder … instead of opening it") describes
a gesture DocumentsUI does not offer on API 31 or 36, so the hint has to say what works instead, for
example: "A folder with thousands of files, such as Camera, can look empty for a while. Open it and tap
Use this folder; you do not need to wait for its files to show." Flow 08 then adds `Big` by opening it
and tapping `Use this folder` straight away, not "from its parent". Story 5 sc. 3 and 4 (spinner, cancel
on back) stay recorded as not possible from the app.

## R16. "Device folders"

**Decision**: the Settings section header and every string that points to it say "Settings › Device
folders" (FR-016). The action text is defined once per side in the mirrored contracts:
`CloudSyncContracts.kt` and `.ts`, which the parity test keeps equal. JS names such as `FoldersItem` stay;
they are not user-visible. The Maestro subflow `open-sources.yaml` and its selectors change with the
label.

## R17. The app icon

**Decision** (FR-018): a script, `scripts/icon/generate-icons.sh <source.png> [--background '#RRGGBB']`,
uses ImageMagick (`magick`) to produce the following from the owner's image:

- the adaptive icon: `mipmap-anydpi/ic_launcher.xml` and `ic_launcher_round.xml`, with a foreground PNG at
  108 dp per density (the image scaled into the central 66 dp safe zone), a background colour in
  `values/ic_launcher_background.xml`, and a monochrome layer (the foreground's alpha filled white) for
  themed icons;
- the square and round legacy PNGs at 48 dp per density (mdpi to xxxhdpi), replacing the default React
  Native icons;
- `assets/icon/play-store-512.png`, with the source image kept as `assets/icon/source.png`.

The owner's image is committed with the outputs, so they can be regenerated. A script-contract test in
`scripts/validation/` checks the output set and sizes from a generated test image. It is skipped with a
message when `magick` is missing, and the release-smoke run checks the APK's icon in its place.
`DEVELOPMENT.md` documents the script. The work waits for the image, and nothing else depends on it.

**Rationale**: the user asked to "prepare all formats needed and place them where needed", and a script
makes that repeatable when the image changes. `minSdk` is 31, so the adaptive icon is what every
supported launcher shows; the legacy PNGs are kept because the manifest references them, and the
spec asks for them (Story 7 sc. 4).

**Alternatives rejected**: Android Studio's Image Asset wizard (manual and not reproducible); a vector
foreground (the source is a raster image).

## R18. Schema v5 and indexes

**Decision**: one `@AutoMigration(4 → 5)` with a spec class:

- **Columns**: `@RenameColumn` `repository_config.remoteRoot` → `remoteRoots`; adds
  `local_node.sortName` (default `''`, filled in `onPostMigrate`, R2) and the nullable
  `remote_ambiguity.remotePath`.
- **Indexes**: adds `(snapshotId, kind, sizeBytes)` and `(snapshotId, kind, sortName)` for the gallery's
  size and name sorts. Date sorts already have `(snapshotId, kind, modifiedUtcMillis)`. List view sorts
  within one folder, which the `(snapshotId, sourceId, parentId, kind, name)` index already narrows.

`MigrationTest` covers 4 → 5, and the 50 k-row budget tests cover each sort and the index read.

**Rationale**: two more indexes add some cost to each 50 k-row publish, which the existing insert budget
test must confirm stays within its limit. Without them, every size or name jump would sort the whole
gallery in a temporary B-tree, which costs far more.
