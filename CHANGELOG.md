# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres
to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is taken from `package.json`.

## [Unreleased]

### Added

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

- CloudSync contract version 2: `launchSourcePicker` takes an optional re-grant source ID, and five error
  codes were added (`SOURCE_OVERLAP`, `SOURCE_UNSUPPORTED`, `SOURCE_REGRANT_MISMATCH`, `SOURCE_NOT_FOUND`,
  `PICKER_BUSY`).
- Project management migrated from GSD to Spec Kit; see
  [`specs/001-gsd-speckit-migration/migration-map.md`](./specs/001-gsd-speckit-migration/migration-map.md)
  for where each GSD artifact went.

### Removed

- GSD workflow tooling and state: `.gsd/`, the GSD MCP servers in `.mcp.json`, `.bg-shell/` and the
  `milestone/M001` branch. The GSD-only `.gitignore` entries went with them; the generic editor and
  operating-system entries moved under "Editor and operating-system files".
