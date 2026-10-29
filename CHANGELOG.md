# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is taken from `package.json`.

## [Unreleased]

### Added

- Tree view; image and video preview; videos in the gallery; thumbnails in list and tree rows (feature
  009). The view drop-down gains **Tree**: every device folder as an expandable tree, folders first,
  files in the list's sort, folders with no matching file dimmed but expandable, and the expanded folders
  and the place kept when results update. Tapping a photo or video in any view, when nothing is
  selected, opens a full preview: photos at screen size after the cached thumbnail, videos playing the
  local file muted, with play/pause and seek, through the new native view `SyncScopeVideoView`
  ([D024](./docs/decisions/0024-video-preview-native-view.md)); files can be selected from the preview.
  The gallery shows videos with a play badge and their duration, and list and tree rows show a 40 dp
  thumbnail. Selection works in tree view, and its **Select all** selects every matching file of every
  folder. New flows `validation/maestro/tree/` (5) and staged lines `09-resync`, `10-selection-survives`
  and `11-toolbar-halves`, with the hook `assert-equal-halves.sh`; decisions D023 and D024.

- Verified emulator acceleration for the validation runner (feature 008, US2):
  `scripts/validation/android-flow.sh --graphics auto|host-opengl|software` discovers the exposed Intel
  host GPU and the emulator's software modes, and requires KVM. It verifies the actual renderer after
  every boot and falls back in a fixed order (`swiftshader`, `software`, then others), releasing only
  the rejected emulator. When nothing works it fails with an actionable message. `measure --graphics
  auto` calibrates one candidate per invocation on the frozen workload and ranks each API. Later `auto`
  runs reuse the ranking only while its `rankingFingerprint` matches. `pnpm e2e:android` now runs with
  `--graphics auto` and the published ranking `validation/evidence/performance/acceleration-ranking.json`.
  On the development host it ranks `host-intel-1` on both APIs, and the full suite passes on both with
  that profile. The NVIDIA GPU is excluded from discovery and ranking, and no script calls `nvx`. A
  direct `android-flow.sh` call without `--graphics` keeps the original emulator launch. A developer
  harness, `scripts/validation/acceleration-fault-check.mjs`, proves fallback and exhaustion by
  injecting launch failures.
- Feature 008 validation regressions (US1). `validation/maestro/performance/01-field-replacement` runs
  after the 39 original flows and checks real-form replacement of empty, prefilled, secure and numeric
  fields and of remote roots longer than 128 characters, on both APIs. Host contract tests cover the
  field helper, navigation, scan-start proof, the runner and the fixtures
  (`scripts/validation/performance-{helpers,navigation,progress,runner,fixtures}.test.mjs`).
- Measurement-owned validation emulators receive a finite four-hour lifetime through an authenticated
  full-invocation mode claim. Other modes retain 2.5 hours, borrowed emulators remain unchanged, and
  Metro stays capped at four hours; no arbitrary lifetime override or action-speedup claim is added.

- E2E performance draft in `specs/008-e2e-performance/`, with measured bottlenecks, verified headless
  hardware acceleration on both API levels and a prioritized optimization scope that preserves the
  existing proof bar. Later specs move to 009 (tree and preview), 010 (the merged deletion placeholder)
  and 011 (full-loop release), with cross-feature references updated.
- Sorting, a smart scrollbar and several server folders (feature 007): gallery and list view each have
  a sort drop-down with name, date (last modified) and size, ascending and descending, and files with
  an unknown size or date come last; list view keeps folders above files, by name, under every sort; a
  scrollbar on the right edge of a result longer than three screens jumps anywhere in it, also to files
  not read yet, and shows the band under the thumb: a year, month or day for the date sort, a letter or
  `#` for the name sort and a size range for the size sort, with an `Unknown` band last, and it can be
  stepped band by band with TalkBack; the repository holds several remote folders on the one server,
  each with a **Browse** button that opens a folder-only browser of the server, and saving tests every
  folder and reports each one (D022). A script, `scripts/icon/generate-icons.sh`, builds the adaptive,
  monochrome and legacy launcher icons and a 512 px image from one source image with ImageMagick; the
  app's own icon is generated from the owner's artwork, including a themed monochrome layer. Proven by
  Maestro flows in `validation/maestro/polish/`.
- Repository setup screen, first-run guidance, multi-select with selection size, safe two-phase deletion
  and a release APK build (feature 006, MVP): Settings › Repository sets up and edits the FTP, SFTP or
  WebDAV server and tests it, with SFTP key approval in the app (and a warning when a trusted key
  changed); the Scan tab lists what is missing before a first scan, error messages name the place that
  fixes them with "Go there", and the Files tab explains that results appear after a scan; the folder
  picker hint names the folders Android refuses and the picker starts in DCIM; gallery and list view
  support long-press selection, "Select all" and a selection bar with the count and total size; deleting
  re-checks every selected backed-up file on the server, shows a breakdown, never deletes UNKNOWN files,
  deletes not-backed-up files only after a stronger confirmation, never removes folders, and reports each
  file it did not delete (D020, D008 amendment); and `pnpm assemble:release` builds an APK that runs
  without a development machine, signed with a personal release key kept outside the repository (D021).
  Proven by Maestro flows in `validation/maestro/mvp/` and `staged/`, and by
  `pnpm e2e:android:release-smoke`.
- Files tab with a photo gallery and a folder list, filters for synced / unsynced / issues, and origin
  badges on same-named photos from different folders (feature 005): the gallery is a virtualized grid of
  local thumbnails, newest first, read page by page; the list browses each source folder by folder with a
  breadcrumb; the filter and its counts are shared by both views; a folder with no matching files is
  dimmed with "0 matching" but can still be opened; and a new scan result reloads the view with "Results
  updated", keeping the filter and the folder. The UI uses Material 3 through `react-native-paper` with
  no inline styles. Proven by Maestro flows in `validation/maestro/browse/`.
- Scan your folders and see which files are backed up (SYNCED / UNSYNCED / UNKNOWN), with rescan and
  automatic local refresh (feature 004): the Scan tab shows live progress and can cancel; matching uses
  the NFC-normalized, case-sensitive name, the size and the modified time in the same precision bucket
  (D019); a remote folder that cannot be read or a dropped connection makes the scan visibly incomplete,
  with unmatched files UNKNOWN and counted as "files that could not be checked"; an unreachable remote
  fails the scan and keeps the previous result; reopening the app refreshes the local side against the
  cached remote listing, whose age is shown, with a rescan hint after 7 days; and leaving the app
  cancels a running scan and discards its partial result. Proven by Maestro flows in
  `validation/maestro/scan/` against live FTP, SFTP and WebDAV containers, using a debug-only
  configure-repository seam (D018).
- Select local folders to check, on internal storage and on an SD card, in Settings › Folders (feature
  003): folders are picked through the Android system folder picker and kept across restarts, overlapping
  folders are refused, each folder gets a generated alias, a folder whose access was lost is shown as
  **Access lost** with **Re-grant**, and folders can be removed after confirmation, which also deletes
  their scan data (D016).
- Maestro end-to-end flows in `validation/maestro/`, run on API 31 and API 36 by `pnpm e2e:android`, with
  device fixtures seeded by `scripts/validation/device-fixtures.sh` and a debug-only grant-release seam
  (D017).
- Native CloudSync layer and live protocol connect (M001/S01/T01–T08): a Room persistence layer for scan
  snapshots, the CloudSync TurboModule registered in `MainApplication`, read-only FTP, SFTP and WebDAV
  clients that discover each server's real timestamp precision, SFTP host-key trust-on-first-use with an
  explicit approve/reject challenge, Android Keystore-backed credential storage that keeps passwords out of
  Room, and fixes to the validation scripts (D015).
- Project documentation under `docs/`: overview, architecture, sync and deletion safety, protocols, scope
  and decision records.
- `README.md` for users and `DEVELOPMENT.md` for developers.
- Spec Kit feature specifications 002–008 under `specs/`, carrying the remaining v1 roadmap.

### Changed

- The app-open refresh re-checks not-backed-up files on the server folders of their backed-up neighbours
  (feature 009, FR-003, [D023](./docs/decisions/0023-refresh-recheck-of-unsynced-files.md)): it lists, read-only,
  at most 32 such folders within 20 s, and a file found there becomes SYNCED with no full scan; nothing is
  demoted, a failure never fails the refresh, and with nothing to re-check it does not connect. The
  scan summary says "Re-checked N server folders, M files now backed up". A file in a device folder with
  no backed-up file still needs a full scan. Your selection is kept when results update: unchanged
  files stay selected with their new status, and a notice names how many changed files were unselected.
- CloudSync contract version 7 (feature 009): `carrySelection`, `getLocalImageHandle` for videos with
  `durationMillis`, the gallery and `SelectableEntries.media` covering `image/*` and `video/*`,
  `QuerySpec.wholeSource`, the `RECHECKING_REMOTE` scan phase, the run's `recheckedFolders` and
  `promotedFiles`, and the `TREE` view; scan store schema version 6: the `local_node`
  `(snapshotId, sourceId, documentId)` index and the nullable `scan_run.recheckedFolders` and
  `promotedFiles`, added by a Room auto-migration.

- The validation runner builds the debug APK once per invocation, for x86_64 only
  (`-PreactNativeArchitectures=x86_64`, `--no-daemon`), and installs that same APK on API 31 and API 36.
  Release, signing, update and connected builds are unchanged. Daemon reuse was measured and not
  adopted (feature 008, US1).
- `scripts/validation/device-fixtures.sh` keeps the five large, immutable fixture sets only when a
  marker with a generator/parameter fingerprint and a full tree digest still matches, and reseeds
  otherwise. This replaces count-only reuse and regeneration on every run. Validating all five takes
  about 90–100 s per API, against about 10 minutes to regenerate them. Mutable fixtures are still reset
  per API and per measured repetition, never between the parts of a staged line (feature 008, US1).
- `validation/maestro/subflows/open-sources.yaml` is navigation only, and its callers own the
  launch, restart or seam return. `subflows/start-scan.yaml` now proves that the tap started a run (a
  new generation, then its terminal line with no progress card) instead of an optional running wait.
  The workspace cap is 7,200 s per API. With these changes, the H01/H02 setup flows are 13–22 % faster
  and H03–H07 are 3–21 % slower on both renderers. The total is about flat. A full two-API
  `pnpm e2e:android` takes about 3 hours on the development host. Reduced guest animations and shorter
  scan pacing were measured and deferred (feature 008, US1; `docs/validation-performance.md`).
- The gallery / list switch in the Files tab is now a view drop-down next to the sort drop-down, and the
  view and each view's sort are remembered across restarts, starting at date, newest first for gallery
  and name, A to Z for list (feature 007).
- Settings › Folders is now **Settings › Device folders**, and every message that points to it says so
  (feature 007).
- A scan that cannot read some of the remote folders still completes: files found in a folder that was
  read stay backed up, every other file is unknown with a reason naming the unread folder, never not
  backed up, and the scan summary names each folder it could not read. A scan that can read none of
  them fails and keeps the current result, as before (D022).
- Name order ignores case and accents (`apple`, `Banana`, `Éclair`), and `#` collects names that do not
  start with a letter. A result kept from before the update ignores case at once and accents after the
  next scan or app-open refresh (feature 007).
- CloudSync contract version 6 (feature 007): `SIZE_ASC` and `SIZE_DESC` sorts, `FileKind`, `ScrollUnit`
  and the scroll band bounds, the `REMOTE_FOLDER_UNREAD` file issue code, and the `NO_SOURCES_SELECTED`
  action now points to Settings › Device folders; `getScrollIndex`, `browseRemoteFolders`,
  `getBrowsePreferences` and `setBrowsePreferences`; the repository's `remoteRoot` became the list
  `remoteRoots`, the connection test reports each folder, and a field error carries `fieldIndex`.
- Scan store schema version 5 (feature 007): `repository_config.remoteRoot` renamed to `remoteRoots`
  (one folder per line), `local_node.sortName` with two indexes, and `remote_ambiguity.remotePath`, by a
  Room auto-migration from version 4. A repository saved before keeps its folder as the only entry.
- Release builds allow user-chosen unencrypted connections (FTP, and WebDAV without HTTPS), with a
  warning in the repository form; WebDAV can use HTTPS, on by default for a new setup, and an untrusted
  certificate is reported as `TLS_UNTRUSTED` (D021).
- CloudSync contract version 5 (`listSelectableEntries`, `prepareLocalDeletion` and
  `executeLocalDeletion(planToken, includeUnsynced)` implemented, `webdavHttps`, `revision`,
  `configRevision` and the error `field`, five new error codes); scan store schema version 4
  (`remote_match_key.directories` and `repository_config.webdavHttps`, by a Room auto-migration from
  version 3).
- The app version now comes from `package.json`: `versionName` is the version and `versionCode` is
  `major * 10000 + minor * 100 + patch`, printed by `:app:printVersion`.
- CloudSync contract version 4: `FileEntryDto` gains `nameInOtherSource` and `matchingFileCount`;
  `getLocalImageHandle` is implemented (moved from feature 006) and returns local-only thumbnails; the
  `IMAGE_UNAVAILABLE` error code was added; directories in `queryTreeChildren` ignore the filter, and the
  gallery reads images only.
- Scan store schema version 3: `local_node.descSynced`, `descUnsynced` and `descUnknown`, per-status
  descendant file counts on directory rows, added by a Room auto-migration from version 2.
- CloudSync contract version 3: `startScan` takes an optional mode (`FULL` or `LOCAL_REFRESH`);
  `startScan`, `cancelScan`, `getScanState`, `queryFiles` and `queryTreeChildren` are implemented; scan
  error codes and the file issue codes `REMOTE_MTIME_MISSING` and `LOCAL_UNAVAILABLE` were added.
- Scan store schema version 2: `scan_run.mode` and `snapshot.remoteListedAtMillis`, added by a Room
  auto-migration from version 1.
- The FTP client reads LIST dates as UTC and, on servers without MLST, takes its precision from what LIST
  prints; an empty LIST is confirmed with a `CWD` probe so an unreadable folder is reported as such.
- CloudSync contract version 2: `launchSourcePicker` takes an optional re-grant source ID, and five error
  codes were added (`SOURCE_OVERLAP`, `SOURCE_UNSUPPORTED`, `SOURCE_REGRANT_MISMATCH`, `SOURCE_NOT_FOUND`,
  `PICKER_BUSY`).
- Project management migrated from GSD to Spec Kit; see
  [`specs/001-gsd-speckit-migration/migration-map.md`](./specs/001-gsd-speckit-migration/migration-map.md)
  for where each GSD artifact went.

### Fixed

- The sort and view drop-downs each take half the row on the device (feature 009, FR-006); the staged
  line `11-toolbar-halves` measures it.

- The validation field helper (`validation/maestro/subflows/fill-field.yaml`) now replaces long
  values completely, for example remote roots longer than 128 characters. It erases the measured length
  until the field reads back unchanged, then requires the exact typed value. Before, it erased two
  fixed 128-character steps and could leave part of a long root behind (feature 008, US1).
- Validation flows no longer race the Settings screen on API 36. `open-sources.yaml` waits for the
  Settings tab to be selected and for its sections to load before scrolling to Add folder, and a newly
  added source row is scrolled to before it is asserted (feature 008, US1).
- The validation FTP service now restarts on failure. The pinned `vsftpd` image intermittently
  segfaults, and with no restart policy FTP stayed down for the rest of an invocation. A restarted
  container keeps its fixture account and appends to its scoped audit log. Every protocol container
  restart inside an invocation (count, and die/start times) is recorded with the lifecycle evidence
  and shown in the performance report. SFTP and WebDAV still never restart.
- The fast scroller's thumb now jumps to the band under the finger when it is released: the release
  maps the touch-up point instead of the last processed move, so a fast drag no longer lands one band
  early. A new result arriving mid-drag no longer ends the drag; the release maps over the bands then
  shown. This is a baseline-input change for the 008 performance baseline (app JavaScript only; the
  debug APK, flows, fixtures and settings are unchanged).
- Adding a folder no longer races the automatic local refresh that coming back from the system
  folder picker starts: a scan now waits until a folder the picker has already returned is saved (or
  rejected) before it reads the source list, so the refresh includes the new folder instead of
  republishing the previous summary. A scan never waits while the picker is still open.
- Pinned Maestro initialization timestamp quantization no longer rejects the consecutive completed
  variables/configuration pair sharing an identical one-millisecond interval. Its duration is counted
  once; genuine overlaps, malformed artifacts and missing/failed mandatory assertions still block.
  Earlier failed campaign results remain unchanged and separate from fresh baseline collection.
- Validation command accounting no longer rejects a quantized one-millisecond leaf whose next
  consecutive sibling at the same depth starts in that same millisecond; the shared millisecond is
  counted once. Real overlaps and failed or missing mandatory assertions still block.
- Validation command accounting now uses one general millisecond-rounding rule instead of the
  initialization and same-start special cases: adjacent, consecutive-sequence, completed commands may
  overlap by at most 1 ms when the later one is at the same depth or exactly one level deeper, and the
  shared time is counted once. Larger overlaps, deeper-by-two steps, non-integer timing,
  order/status problems and failed or missing mandatory assertions still block. The rule is now
  fully general: any two completed commands may share at most 1 ms, whatever their depth, adjacency
  or the records between them, and time already counted for earlier commands is counted once.
  Overlaps above 1 ms, non-integer timing and any overlap involving a failed, warned or running
  command still block.
- Validation watchdog setup now checks each original `llkd` stop request and waits for asynchronous
  shutdown before returning adbd to the normal shell user. Failed/unknown observations remain startup
  failures with private stage diagnostics; readiness and process/serial identity are rechecked.
  App, helpers, guest rendering/resources/animations and all runtime limits remain unchanged.
- Expired validation-owned Metro scratch state can be released after its saved PID and process group
  are absent and port 8081 is unoccupied, with matching invocation/acquisition proof and retained logs.
  Borrowed, foreign, reused-PID and ambiguous resources remain untouched; runtime limits are unchanged.
- Original E2E performance metadata now observes fixture bytes with batched `stat`, reads effective
  unset animation scales through a read-only shell probe, resolves whitespace/absolute image paths,
  and rejects unknown baseline settings before measurement. Original failed campaigns remain
  separate and retained; no application, interaction, fixture or renderer optimization is included.
- Sort and Gallery/List dropdowns now have equal widths and fill the available Files toolbar row.
- WebDAV Host retains the shared endpoint path instead of moving it into the first remote folder.
  Remote folders and the folder browser are relative to that endpoint; connection tests, scans and
  deletion re-checks use it consistently. Existing bare-host configurations still work unchanged.
- Android 16 debug builds no longer lose the first tap on selection controls to React Native's
  disconnected Fast Refresh banner after the system folder picker closes the Metro connection.
  Maestro setup flows also wait for the fresh app's empty state instead of the previous window.
- The Files views no longer jump to the top when new results arrive: each view keeps the file that was
  at the top, or the place where it would be in the current sort when it is gone, and still shows
  "Results updated"; the view that is not showing keeps its place too (feature 007).
- Adding a device folder with thousands of files, such as Camera: Android's folder picker shows such a
  folder blank, with no progress indicator, for a few seconds, which looked like an empty folder. The
  app cannot change the picker, so the hint before it opens now says that the folder can look empty for
  a while and that **Use this folder** works without waiting for its files (feature 007, research R15).
- FTP: a remote folder the server account cannot open is reported as unreadable even when vsftpd lists it
  as a single entry of its own name, instead of being walked into as a subfolder (found by the feature
  007 flow `polish/05-remote-folder-unread-ftp`).

### Removed

- GSD workflow tooling and state: `.gsd/`, the GSD MCP servers in `.mcp.json`, `.bg-shell/` and the
  `milestone/M001` branch. The GSD-only `.gitignore` entries went with them; the generic editor and
  operating-system entries moved under "Editor and operating-system files".
