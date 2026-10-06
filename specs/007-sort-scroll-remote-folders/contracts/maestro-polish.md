# Contract: end-to-end flows for feature 007

These flows follow the conventions of features 003–006; `DEVELOPMENT.md` › End-to-end flows is the
authoritative description.

- **Where and when**: the flows live in `validation/maestro/polish/` and run after `mvp/`, on API 31 and
  API 36, against the live FTP, SFTP and WebDAV containers (D012).
- **Registration**: each flow is added to `validation/maestro/config.yaml` by the task that creates it.
- **Repository setup**: through the UI wherever folders are the subject; the D018 seam (now with repeated
  `root`) everywhere else.

## Fixtures

### Remote (`scripts/validation/fixture-seed.sh`)

- No new trees. The flows reuse `scan/clean/a`, `scan/clean/b` (two readable folders) and
  `scan/partial/restricted` and `gallery-partial/restricted`, which are unreadable to the service
  accounts (004 and 006 fixtures).

### Device (`scripts/validation/device-fixtures.sh`)

| Device source | Contents | Used by |
| --- | --- | --- |
| `SyncScopeE2E/TwoFolders` | copies of the files of `scan/clean/a` and `scan/clean/b`, with the same bytes and mtimes | 04, 05 |
| `SyncScopeE2E/Scroll` | 5,000 small images generated on the device: sizes from 2 KB to 4 MB, mtimes spread over 30 months, names spread over `#` and `a`–`z` | 01, 02, 03, 07 |
| `SyncScopeE2E/Narrow` | 200 images, all 3–5 MB, mtimes within 3 weeks | 03 |
| `DCIM/Big` | 10,000 empty `.jpg` files, created by one `adb shell` loop | 08 |

The generated sources are deterministic: names, sizes and mtimes come from the file index. The expected
first file of each sort and each band comes from `scripts/validation/scroll-manifest.sh`, the same way
`fixture-manifest.sh` supplies sizes today. `android-flow.sh` passes the values to Maestro as `-e`
variables (`FIRST_SIZE_DESC`, `FIRST_NAME_ASC`, `BAND_MONTH_LABEL`, `BAND_MONTH_FIRST`, …). The flows
never hard-code names or sizes.

## Selectors

| Element | Selector |
| --- | --- |
| Sort drop-down | accessibility label `Sort: <choice>`, for example `Sort: Size, largest first` |
| Sort option | text `Name (A–Z)` … `Size (smallest first)` |
| View drop-down | accessibility label `View: Gallery` / `View: List` |
| Scrollbar thumb | `testID` `files.scroller.thumb`; label bubble `files.scroller.label` |
| Remote folder field *n* | `testID` `repository.remoteRoots.<n>`; Browse button label `Browse remote folder <n+1>`; remove button label `Remove remote folder <n+1>` |
| Add folder | text `Add another folder` |
| Browser | `testID` `remote-browser`; a row's label is the folder name; `Use this folder`; `Up` |
| Unread folder warning | text `Could not read <folder>` on the Scan tab's summary card |
| Settings section | header `Device folders` |

## Runner additions

- `scroll-manifest.sh`: prints the expected values for the generated `Scroll` (5,000 files, enough for SC-003) and `Narrow` sources.
- `device-fixtures.sh`: adds the four sources. `Big` and `Scroll` are created once per emulator boot and
  reused, because `Big` takes about 20 s.
- No new staged pairs. Flow 07 publishes its new results with an in-app rescan, so it needs no host hook.

## Acceptance scenario mapping

| Spec scenario | Flow | Start state | Steps and assertions |
| --- | --- | --- | --- |
| Story 1 sc. 1–6, 8; FR-001–005; SC-001, SC-002 | `01-sort.yaml` | seam repo (WebDAV), `Scroll` scanned | Drop-downs present (sort left of view), gallery shows `Sort: Date, newest first` and list `Sort: Name, A to Z` on first run (sc. 6). For each of the six sorts in gallery: the first tile's label equals the manifest's first file. List: open `Scroll`; for each of the six sorts the first file row equals the manifest's first file, and folders stay above files. Pick the Synced filter, change the sort: the filter stays Synced; change the filter back to All: the sort stays (sc. 5). Switch views and back: each view keeps its sort. Two taps from Files reach the largest file (SC-002). Story 1 sc. 9 is a recorded deviation (below). |
| Story 1 sc. 7; FR-003 | `02-sort-persists.yaml` | after 01 | Choose List + `Size (smallest first)`, `stopApp`, `launchApp`: List is shown with that sort and the filter is All. |
| Story 2 sc. 1–5, 8; FR-006, FR-007, FR-007a, FR-007b; SC-003, SC-008 | `03-fast-scroll.yaml` | `Scroll` (5,000 files) and `Narrow` scanned | Gallery, date sort: scroll, then drag the thumb to the bottom quarter; on release, the manifest's first file of that month band is visible within 1 s (`extendedWaitUntil` with `timeout: 1000` started right after the release, SC-003) and is the first visible tile. Name sort: drag to `m`; the first tile starts with `m`/`M`. Size sort on `Narrow` (filter by source): the label during the drag shows a `MB` value with one decimal, and at least 5 distinct labels are seen over the track. Filter Synced: the thumb is absent (short result). |
| Story 3 sc. 1–4, 8–10; FR-009, FR-010, FR-011, FR-012; SC-004 | `04-remote-folders-webdav.yaml` | clearState, setup through the UI | Enter `/x` in folder 1, `Add another folder`, enter `/scan/clean/b`; then type the WebDAV server URL with the path `/scan/clean/a` into Host: folder 1 reads `/scan/clean/a` and folder 2 still `/scan/clean/b` (sc. 8). Save: Connected with a line per folder. Scan with `TwoFolders`: every file Synced. Settings › Repository lists both. Select one file that exists only under `b` and delete it: the server check confirms it (D020, sc. 9) and it leaves the list. Remove `/scan/clean/b`, Save, rescan: `b`'s remaining files are Unsynced. Enter `/scan/clean/a/x` as a second folder: the overlap error names `/scan/clean/a`. |
| Story 3 sc. 5, 6; FR-011; SC-004a | `05-remote-folder-unread-ftp.yaml` | seam repo (FTP) with roots `/scan/clean/a` and `/scan/partial/restricted` | Scan completes; the summary card shows `Could not read /scan/partial/restricted`; the Unsynced chip count is 0; `b`'s files are under Issues or unknown with the folder named. Then the seam sets roots `/scan/partial/restricted` and `/gallery-partial/restricted`; Scan: `Scan failed` shows, and the Files tab still shows the previous result's counts (sc. 6). |
| Story 3 sc. 11, 12; FR-009a | `06-remote-browse-sftp.yaml` | clearState, SFTP form filled, not saved | `Browse`: the host-key dialog appears → Trust → the browser lists `/`. Open `scan`, `clean`, `Use this folder` → the field reads `/scan/clean`. Wrong password → `Browse` shows the login error, and the field stays editable. |
| Story 4 sc. 1, 3, 4; FR-014; SC-005 | `07-results-updated-keeps-place.yaml` (replaces `browse/05-results-updated.yaml`) | `Scroll` scanned | Gallery: scroll down about 40 rows and note the first tile (read from its label into a variable). Switch to List, open `Scroll`, scroll down, and note the first row. Scan tab → Scan → back to Files: `Results updated` shows, the noted list row is at the top, then switch to Gallery: the noted tile is at the top. |
| Story 5 sc. 1, 5 (branch B) or sc. 1, 2 (branch A); FR-015; SC-006 | `08-add-large-folder.yaml` | clearState | Settings › `Device folders` (Story 6 sc. 1) › Add a folder. **Branch B** (chosen by the R15 spike): the hint about large folders shows; in the picker, in `DCIM`, open `Big` and tap `Use this folder` at once, without waiting for its files (DocumentsUI offers no way to select a folder from its parent, research R15 › Spike result). **Branch A**: in the picker open `DCIM` › `Big`: its files show; go back to `DCIM` and open `Big` again: its files show again (sc. 2). Both: `Use this folder` → `Allow`: `Big` is listed as available. |
| Story 7 sc. 1, 2, 5; FR-018; SC-009 | `90-release-smoke.yaml` (extended) and `android-flow.sh release-smoke` | release APK | `aapt2 dump badging` shows `application-icon` as `ic_launcher.xml` (adaptive). The launcher shows the app under its label. No default RN icon bytes remain (hash check in the script-contract test). |
| Story 3 sc. 7; FR-013 | `91-release-update.yaml` (extended) | previous release installed with one folder | After the update, Settings › Repository shows that folder as the only entry, and a scan runs. |

## Deviations (recorded in plan.md › Complexity Tracking)

| Scenario | Why there is no Maestro flow | Proven by |
| --- | --- | --- |
| Story 1 sc. 9 (unknown size or date last) | Android reports a size and a modified time for every file the app can read through SAF, so no device fixture can have an unknown value | JVM `SnapshotStoreTest` (`NULL` last under each sort, T015) and the scroll index's `Unknown` band test (T052) |
| Story 2 sc. 7 (TalkBack adjust actions) | Maestro cannot send accessibility actions | Jest `FastScroller` tests of `accessibilityActions` and the a11y sweep |
| Story 2 sc. 6 (loading state after a far jump) | The loading state lasts milliseconds against the emulator | Jest `usePagedQuery` segment tests with a delayed reader |
| Story 4 sc. 2 (anchor file gone) | Needs a device file to vanish between two snapshots while the view is scrolled | JVM `anchorIndex` tests and Jest view tests |
| Story 5 sc. 2–4 (contents after navigating back, spinner, cancel on back): confirmed not possible from the app, branch B | The picker is Android's own activity (R15). The spike (API 31 and API 36, primary storage and SD card) found that no starting URI or intent flag changes the blank list DocumentsUI shows while it loads a 10,000-file folder, so the app can neither show a loading indicator nor cancel the load. Sc. 5's hint is worded as the spike found works (open the folder and tap Use this folder at once), since selecting a folder from its parent is not offered | The spike result in research R15; the hint by Jest `SourcesSection` tests and flow 08 |
| Story 7 sc. 3 (themed icon) | Needs a launcher setting that Maestro cannot toggle | Script-contract test: the monochrome layer exists and is referenced |
| Story 6 sc. 2 (wording everywhere) | Text audit, not a flow | Jest "no `Settings › Folders` string" test, as the "no Connect screen" test in 006 |
