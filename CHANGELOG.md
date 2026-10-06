# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is taken from `package.json`.

## [Unreleased]

### Added

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

- CloudSync contract version 6 (feature 007): `SIZE_ASC` and `SIZE_DESC` sorts, `FileKind`, `ScrollUnit`
  and the scroll band bounds, the `REMOTE_FOLDER_UNREAD` file issue code, and the `NO_SOURCES_SELECTED`
  action now points to Settings › Device folders.
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

- FTP: a remote folder the server account cannot open is reported as unreadable even when vsftpd lists it
  as a single entry of its own name, instead of being walked into as a subfolder (found by the feature
  007 flow `polish/05-remote-folder-unread-ftp`).

### Removed

- GSD workflow tooling and state: `.gsd/`, the GSD MCP servers in `.mcp.json`, `.bg-shell/` and the
  `milestone/M001` branch. The GSD-only `.gitignore` entries went with them; the generic editor and
  operating-system entries moved under "Editor and operating-system files".
