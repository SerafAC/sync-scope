# Project

## What This Is

SyncScope is a React Native Android app that tells you which of your local files are already backed up to your cloud, so you can safely delete them from the device.

You point it at one remote repository over FTP, SFTP, or WebDAV with a username and password, select local folders from on-device and removable storage, and scan. Each local file comes back marked SYNCED, UNSYNCED, or UNKNOWN. You browse the results in a gallery grid, a browsable list, or a browsable tree; filter to just the synced set; multi-select; and delete locally.

The app never writes to the cloud. It never uploads, never deletes remotely, never downloads remote file content. Its only mutating action is deleting local files.

Current state: a foundation scaffold exists (RN 0.87 + TypeScript + Kotlin/Room + validation infrastructure). The `CloudSync` TurboModule contract is fully declared in TypeScript but has no Kotlin implementation yet — every native method except the two catalog queries returns a typed `NOT_IMPLEMENTED` envelope, and `MainApplication.kt` registers no CloudSync package.

## Core Value

**Knowing, with honest confidence, which local files are safe to delete.**

In the user's own words: *"this app is to discover files that are sync and can be safely deleted."* Sync status is a deletion-safety signal, not a backup dashboard. Everything else — three views, filtering, preview, aesthetics — exists to serve that decision. If scope must shrink, the thing that survives is: a trustworthy SYNCED/UNSYNCED/UNKNOWN verdict plus a safe way to act on it.

The corollary matters as much as the value itself: the app must never make a partial or stale result look like a clean one.

## Project Shape

- **Complexity:** complex
- **Why:** three network protocols with differing timestamp precision, a native Kotlin engine behind a versioned TurboModule bridge, SAF/scoped-storage behaviour that diverges across API 31 and 36, and an irreversible delete as the primary user action
- **Web stack:** not a web UI — React Native Android app, verified with Maestro 2.10.0 on real emulators

## Current State

**What exists and works:**

- React Native 0.87 with the new architecture enabled, Hermes, TypeScript 6 strict, pnpm 11.3.0, Node 24.11.1
- Android: minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0, KSP for Room codegen
- `src/native/CloudSyncContracts.ts` — versioned DTOs, discriminated error envelopes, `clampPageSize`, `MAX_PAGE_SIZE = 200`
- `src/native/specs/NativeCloudSync.ts` — the complete TurboModule contract, codegen-configured to `com.syncscope.codegen`
- `src/native/CloudSync.ts` — typed JS client wrapper; no ad hoc native access elsewhere
- Room schema contract tests: `local_node`, `remote_match_key`, `snapshot`, `scan_run`, `source_root`, `local_deletion_overlay`, `repository_config`, `trusted_sftp_host_key`, with match/paging indexes asserted
- `SchemaContractTest` fails the build if `repository_config` grows a password/secret/ciphertext/nonce/token column
- Validation infrastructure: digest-pinned FTP (vsftpd), SFTP (OpenSSH), and WebDAV (Apache) containers on 127.0.0.1; fixture seeding; emulator orchestration via `android-flow.sh` for API 31 and 36
- Maestro 2.10.0 installed and wired into `pnpm e2e:android`
- Navigation shell with Material Design icons, `react-native-paper` 5.15.3

**What does not exist yet:**

- Any Kotlin implementation of the CloudSync TurboModule — `MainApplication.kt` registers no package, so every native call currently dies at `TurboModuleRegistry`
- Any protocol client (FTP, SFTP, WebDAV)
- `validation/maestro/` — the runner is fully wired but there are zero flow files
- `./docs` — not started

## Architecture / Key Patterns

**One native TurboModule is the entire JS-to-native API.** `CloudSync` is the only bridge surface. JS is presentation only; protocol clients, scanning, matching, and deletion all run in Kotlin. Every result is a versioned discriminated envelope with a stable machine-readable error code and a redacted message — no exceptions cross the bridge.

**Room is the scan store; secrets never touch it.** Scan snapshots persist natively rather than in JS memory. The password lives in Android Keystore-backed EncryptedSharedPreferences, referenced from Room only as `credentialVersion`. That boundary is enforced by a build-failing test, not by convention.

**Matching ignores directory structure.** A collapsed `remote_match_key` on `(snapshotId, name, sizeBytes, precisionMillis, bucket)` turns sync determination into an indexed exact lookup. Android album layouts and cloud-flattened remote layouts are never expected to line up.

**Snapshot-scoped opaque paging, clamped to 200.** All three views read one consistent snapshot through `queryFiles` (flat, for gallery) and `queryTreeChildren` (parent-scoped, for list and tree). Page tokens are rejected on snapshot, query, or sort mismatch.

**Two-phase deletion.** `prepareLocalDeletion` returns a plan token plus an honest breakdown; `executeLocalDeletion` commits with per-file outcomes into `local_deletion_overlay`.

**Verification against real servers, not mocks.** Robolectric + Room for unit logic, `androidTest` against live containers for protocol clients, Maestro on real emulators for every user-visible claim.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract, requirement status, and coverage mapping.

## Milestone Sequence

- [ ] M001: SyncScope v1 — Connect to one FTP/SFTP/WebDAV repository, scan selected local folders, and safely delete the files proven to be backed up
