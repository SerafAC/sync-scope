# Architecture

SyncScope is a React Native Android app that reports which local files are already backed up to one
remote repository (FTP, SFTP or WebDAV), so they can be deleted from the device safely. The app never
writes to the remote: it never uploads, deletes remotely or downloads file content. Its only mutating
action is deleting local files.

This page describes the architecture and its key patterns. The native layer described here was merged from
M001/S01 (T01–T08); patterns owned by later features are marked as such. Each pattern links to the decision
record that holds its rationale, which this page does not repeat.

## Platform

- React Native 0.87 with the new architecture enabled, Hermes, TypeScript 6 strict, pnpm 11.3.0,
  Node 24.11.1.
- Android: minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0, KSP for Room code generation.
- UI: Material 3 through `react-native-paper` 5.15.3 only, with Material Design icons. The theme, spacing
  and density scale live in `src/theme/`, and `react-native/no-inline-styles` is a lint error (see
  [Material 3 shell](#material-3-shell-one-theme-module)).

## Key patterns

| Pattern | Decision |
| --- | --- |
| One native TurboModule is the entire JS-to-native API | [D001](./decisions/0001-single-cloudsync-turbomodule.md) |
| Room is the scan store; secrets never touch it | [D002](./decisions/0002-room-scan-store-keystore-credentials.md), [D013](./decisions/0013-full-persistence-layer-in-s01.md) |
| Matching ignores directory structure | [D003](./decisions/0003-directory-agnostic-sync-matching.md) |
| Timestamp precision is discovered, not assumed | [D004](./decisions/0004-discovered-timestamp-precision.md) |
| Snapshot-scoped opaque paging, clamped to 200 | [D010](./decisions/0010-snapshot-paging-and-origin-badge.md) |
| Two-phase deletion | [D008](./decisions/0008-two-phase-local-deletion.md) |
| Typed envelopes; partial scans stay visibly partial | [D011](./decisions/0011-typed-error-envelopes-partial-scans.md) |
| Sources are SAF grants with a canonical root; availability is computed | [D016](./decisions/0016-saf-source-identity-and-availability.md) |
| Verification against real servers, not mocks | [D012](./decisions/0012-maestro-e2e-proof-bar.md) |

### One TurboModule boundary

`CloudSync` is the only bridge between JavaScript and native code
([D001](./decisions/0001-single-cloudsync-turbomodule.md)).

- The contract is declared in TypeScript in `src/native/specs/NativeCloudSync.ts` (codegen package
  `com.syncscope.codegen`), with its DTOs and error envelopes in `src/native/CloudSyncContracts.ts`. JS
  calls it only through the typed wrapper `src/native/CloudSync.ts`; there is no ad hoc native access
  elsewhere.
- The Kotlin implementation is `CloudSyncModule`, registered by `CloudSyncPackage` in `MainApplication.kt`.
- JS is presentation only. Protocol clients, scanning, matching and deletion run in Kotlin.
- Every method resolves a versioned, discriminated envelope with a stable machine-readable error code and a
  redacted message ([D011](./decisions/0011-typed-error-envelopes-partial-scans.md)). Work runs on a
  background dispatcher, and any throwable becomes a redacted `INTERNAL_ERROR` envelope, so no Kotlin
  exception crosses the bridge. The Kotlin and TypeScript error-code lists are kept in the same order, and a
  parity test compares them.
- The contract is at version 4 (`CLOUD_SYNC_CONTRACT_VERSION` in TypeScript, `CONTRACT_VERSION` in
  Kotlin); the parity test checks that both sides carry the same version. Version 2 added the optional
  re-grant source ID to `launchSourcePicker`. Version 3 (feature 004) made `startScan` take an optional
  mode (`FULL` or `LOCAL_REFRESH`), implemented `startScan`, `cancelScan`, `getScanState`, `queryFiles`
  and `queryTreeChildren` with their scan DTOs, added the scan error codes (such as `SCAN_IN_PROGRESS` and
  `REFRESH_UNAVAILABLE`) and the file issue codes `REMOTE_MTIME_MISSING` and `LOCAL_UNAVAILABLE`, mirrored
  in both languages under the parity test. Version 4 (feature 005) added `nameInOtherSource` and
  `matchingFileCount` to `FileEntryDto`, implemented `getLocalImageHandle` and added the
  `IMAGE_UNAVAILABLE` error code; the details are in the
  [005 browse contract](../specs/005-gallery-list-filtering/contracts/cloudsync-browse.md).

### Room scan store; credentials never touch it

Scan snapshots, sources, repository configuration and trusted SFTP host keys persist natively in Room, not
in JS memory ([D002](./decisions/0002-room-scan-store-keystore-credentials.md)). The schema covers
`local_node`, `remote_match_key`, `snapshot`, `scan_run`, `source_root`, `local_deletion_overlay`,
`repository_config` and `trusted_sftp_host_key`, with the match and paging indexes asserted by tests. The
full persistence surface — entities, DAOs, `SyncScopeDatabase`, `SnapshotQuery`, `PageTokenCodec`,
`SnapshotStore` and the persistence exceptions — landed together
([D013](./decisions/0013-full-persistence-layer-in-s01.md)). Exported schemas under `android/app/schemas/`
are reviewed source for migrations, and a mismatched on-disk schema fails rather than falling back to a
destructive migration.

The schema is at **version 3** (feature 005). Each step is a Room `@AutoMigration`, covered by
`MigrationTest`:

- Version 2 (feature 004) added `scan_run.mode` (`FULL` or `LOCAL_REFRESH`, default `FULL`) and the
  nullable `snapshot.remoteListedAtMillis`, the remote listing's age, which a local refresh copies from
  the snapshot it builds on.
- Version 3 (feature 005) added the nullable `local_node.descSynced`, `descUnsynced` and `descUnknown`:
  on directory rows, the number of files anywhere beneath with each status, written by `DirectoryRollup`.
  They are `NULL` on file rows and on rows written before version 3
  ([005 data model](../specs/005-gallery-list-filtering/data-model.md#schema-change-version-2--3)).

The password never enters Room: `repository_config` refers to it only by `credentialVersion`, and the
secret itself lives in `CredentialStore` (Android Keystore-backed `EncryptedSharedPreferences`,
`AES256_GCM` master key).

**Enforced by `SchemaContractTest`.** The test reads the exported Room schema and fails the build if
`repository_config` gains a password, secret, ciphertext, cipher, nonce, credential_blob or token column, so
the credential boundary is enforced by a test, not by convention. The manifest also sets
`allowBackup="false"`, so the encrypted preferences never leave the device in a backup.

### Matching ignores directory structure

A collapsed `remote_match_key` on `(snapshotId, name, sizeBytes, precisionMillis, bucket)` turns sync
determination into an indexed exact lookup. Android album layouts and cloud-flattened remote layouts are
never expected to line up ([D003](./decisions/0003-directory-agnostic-sync-matching.md)). The precision
feeding `precisionMillis` is measured per server at connect time
([D004](./decisions/0004-discovered-timestamp-precision.md)); see [protocols](./protocols.md) and
[sync and deletion safety](./sync-and-deletion-safety.md).

### One scan engine, two modes

The `scan` package turns the repository and the selected folders into a snapshot. One `ScanEngine` runs
both modes ([004 research R2](../specs/004-scan-engine-matching/research.md#r2-scan-modes-full-and-local_refresh-are-the-same-engine)):

- **`FULL`** (Scan and Rescan from scratch) connects, discovers precision, lists the remote breadth-first
  through `RemoteWalker` into an in-memory `MatchIndex`, enumerates each source through
  `LocalSourceEnumerator`, applies the `Matcher` rule table to each file, rolls statuses up to
  directories (`DirectoryRollup`) and publishes.
- **`LOCAL_REFRESH`** (on app open) copies the active snapshot's remote keys and remote-side failures, and
  re-enumerates only the local side.

`ScanCoordinator` holds at most one run at a time, publishes progress at most every 250 ms, and cancels
the run on `cancelScan` or when the host activity pauses. Every attempt is one `scan_run` with a fresh
generation. A cancelled, backgrounded or `FAILED` run deletes its staged snapshot, so only a completed run
is ever promoted ([D009](./decisions/0009-foreground-scan-and-freshness.md)). JS polls `getScanState`
every 500 ms while a run is active. The matching rules are in
[sync and deletion safety](./sync-and-deletion-safety.md).

### Snapshot-scoped opaque paging, clamped to 200

All three views read one consistent snapshot ([D010](./decisions/0010-snapshot-paging-and-origin-badge.md)):

- `queryFiles` is flat, for the gallery.
- `queryTreeChildren` is parent-scoped, for list and tree.
- Page tokens are opaque (`PageTokenCodec`) and are rejected on snapshot, query or sort mismatch, which
  prevents torn reads during a rescan.
- Page size is clamped to `MAX_PAGE_SIZE = 200` on both sides. `clampPageSize` in TypeScript and its Kotlin
  mirror share the same edge cases (null, NaN or Infinity → 50; below 1 → 1; truncate; cap 200), and
  `SnapshotQueryTest` pins the Kotlin side to the same table.

The read rules since contract version 4 (feature 005,
[data model](../specs/005-gallery-list-filtering/data-model.md#read-rules-changes-to-snapshotstorequeryfilepage)):

- The gallery (`view: GALLERY`) reads `FILE` rows with an `image/*` MIME type only.
- `queryTreeChildren` always returns every directory child; the filter narrows file rows only. Each
  directory carries `matchingFileCount`, its descendant count for the active filter, read from the
  version 3 columns.
- First-page `counts` are scoped by view (images only in the gallery) and by `sourceId`, never by the
  filter, the parent or the search, so the chip counts match what the view can show.
- `nameInOtherSource` is set on a gallery row when a file with the same name exists in another source of
  the snapshot (one indexed `EXISTS` probe per row). It drives the origin badge
  ([D010](./decisions/0010-snapshot-paging-and-origin-badge.md)) and is always false in list reads.

On the JS side, `src/files/usePagedQuery.ts` holds the pages of one snapshot. When the active snapshot
changes, or a read fails with `STALE_GENERATION`, `SNAPSHOT_NOT_FOUND` or `PAGE_TOKEN_MISMATCH`, it drops
its rows and reloads from page 1 with the same query, and drops any response that belongs to an older
snapshot or query ([005 research R1](../specs/005-gallery-list-filtering/research.md#r1-how-a-view-notices-a-new-snapshot-the-stale_generation-recovery-of-fr-005)).
`useListNavigation.ts` finds the list view's folder again by name in the new snapshot, falling back to the
nearest ancestor that still exists ([R2](../specs/005-gallery-list-filtering/research.md#r2-re-locating-the-current-folder-in-a-new-snapshot)).

### Local thumbnails, never remote content

`getLocalImageHandle(snapshotId, entryId, {maxEdgePx})` returns a `file://` URI of a downscaled JPEG in the
app's cache, `cacheDir/thumbnails/`, named by a hash of the entry ID and the edge. The edge is clamped to
64…2048 px on both sides of the bridge, gallery tiles ask for 256 px, and feature 006's preview reuses the
method with the screen's long edge. `LocalImageStore` (the `image` package) serves a cached file without
decoding, and otherwise decodes through `ContentResolver.loadThumbnail` with a `BitmapFactory` fallback, at
most four decodes at once. It reads local storage only, never opens a remote connection (R026) and never
passes or logs a document URI. An unreadable image is the typed `IMAGE_UNAVAILABLE` error. The cache is
left to the OS to reclaim ([005 research R7](../specs/005-gallery-list-filtering/research.md#r7-gallery-thumbnails-getlocalimagehandle-moved-from-006-user-decision-2026-10-01)).

### Material 3 shell: one theme module

`src/theme/` is the single source of the UI's look ([005 research R9](../specs/005-gallery-list-filtering/research.md#r9-material-3-shell-theme-spacing-and-density-no-inline-styles-fr-004)):
`theme.ts` builds the Paper MD3 theme and the matching React Navigation theme, `spacing.ts` holds the
spacing scale, the dense-layout sizes and the gallery column count, and `statusLabels.ts` holds the
user-facing status and filter labels. Components style themselves through a `StyleSheet`, themed with
`useTheme()` where colours are needed; inline styles fail lint. Every interactive element has an
accessibility label, built in `src/files/a11y.ts`, and those labels are the Maestro selectors of the
browse flows.

### Two-phase deletion

`prepareLocalDeletion` returns a plan token plus an honest breakdown; `executeLocalDeletion` commits with
per-file outcomes into `local_deletion_overlay`, recording successes only
([D008](./decisions/0008-two-phase-local-deletion.md)). UNKNOWN entries are refused outright
([D006](./decisions/0006-unknown-status-never-deletable.md)). Both methods are declared in the contract and
are delivered by feature 007.

### Local sources through the Storage Access Framework

The user's folders are `source_root` rows, each holding a persisted SAF tree-URI grant
([D016](./decisions/0016-saf-source-identity-and-availability.md)). Only on-device and removable storage
(`com.android.externalstorage.documents`) is accepted. Each row has a `canonicalRoot` built from the tree
document ID, and a new pick that equals, contains or is nested in an existing root is rejected. Availability
(Available, Access lost, Storage missing) is computed on every `listSources` call and never stored. A
re-grant must pick the same folder, and removal deletes the row with all its scan data in one transaction
before releasing the grant. `treeUri` and `canonicalRoot` stay native; no raw path crosses the bridge. The
user-facing screen is **Settings › Folders** (`src/sources/`).

### Verification against real servers, not mocks

Robolectric + Room for unit logic, `androidTest` against live containers for protocol clients, and Maestro on
real emulators for every user-visible claim ([D012](./decisions/0012-maestro-e2e-proof-bar.md)). See
[Validation infrastructure](#validation-infrastructure).

## Native packages

All under `android/app/src/main/java/com/syncscope/`:

| Package | Role |
| --- | --- |
| `bridge` | `CloudSyncModule` and `CloudSyncPackage`, the envelope builder (`CloudSyncEnvelope`), native contract constants (`CloudSyncContracts`), `RepositoryOperations`, which saves, summarises and tests the repository configuration, and `ScanOperations`, which turns `startScan`, `cancelScan`, `getScanState`, `queryFiles`, `queryTreeChildren` and `getLocalImageHandle` into envelopes. |
| `persistence` | The Room database (`SyncScopeDatabase`), its entities and DAOs, `SnapshotStore`, snapshot queries and the opaque page-token codec. |
| `remote` | The read-only `RemoteClient` interface and its FTP, SFTP and WebDAV implementations (`RemoteClientFactory`, `PropfindParser` for WebDAV), plus SFTP host-key trust (`HostKeyTrustStore`, `TofuHostKeyVerifier`). |
| `credential` | `CredentialStore`: the repository password in `EncryptedSharedPreferences` under an Android Keystore `AES256_GCM` master key. |
| `source` | Local folder selection through the Storage Access Framework: `SourceTree` (tree URI to volume, path and `canonicalRoot`, plus the overlap rule), `SourceAlias` (generated aliases), `SafAccess` (the seam over `ContentResolver` and `StorageManager`, with `ContentResolverSafAccess` as the production implementation), `SourceAvailability` (the computed availability check), `SourcePicker` (the single-slot activity-result bridge for `launchSourcePicker`), `SourceOperations` (list, add, re-grant and remove as envelopes) and `LocalSourceEnumerator` (the enumeration contract the scan consumes). Rules: [D016](./decisions/0016-saf-source-identity-and-availability.md). |
| `scan` | The scan engine (feature 004): `MatchIndex` (the NFC name, size and bucket key, with `bucketOf` and `MTIME_UNKNOWN_BUCKET`), `Matcher` (the pure matching rule table), `RemoteWalker` (breadth-first remote listing with retries and the `FAILED` boundary), `DirectoryRollup` (worst-of directory status and per-status descendant file counts), `ScanEngine` (`FULL` and `LOCAL_REFRESH` end to end), `ScanCoordinator` and `ScanProgress` (the single running scan, its progress and cancellation) and `ScanPacing` (a no-op in release; a debug-only per-file pause for the e2e flows). Rules: [D003](./decisions/0003-directory-agnostic-sync-matching.md), [D019](./decisions/0019-match-name-normalization-and-strict-buckets.md). |
| `image` | `LocalImageStore` (feature 005): local-only thumbnails for `getLocalImageHandle`, cached under `cacheDir/thumbnails/`; see [Local thumbnails](#local-thumbnails-never-remote-content). |

## Remote clients

Each client lists remote metadata only; the `RemoteClient` interface has no byte-reading surface, which
enforces R026 by construction. `discoverPrecision()` measures the timestamp precision the server actually
delivers and reports how it was derived (`PrecisionFinding`, `PrecisionBasis`), so a weak comparison basis
stays visible to matching. An unknown SFTP host key raises a challenge that the user approves or rejects
through `approveSftpHostKey` / `rejectSftpHostKey` (trust on first use,
[D007](./decisions/0007-sftp-host-key-tofu.md)). Library choices are in
[D005](./decisions/0005-protocol-client-libraries.md); per-protocol behaviour is in
[protocols](./protocols.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `App.tsx`, `index.js` | App entry point. |
| `src/native/` | The TurboModule spec, contracts and typed client, with their Jest tests in `src/native/__tests__/` (including `NativeCloudSyncBoundary.test.ts`, the guard on the JS boundary). |
| `src/navigation/`, `src/screens/` | The navigation shell and screens: `SettingsScreen`, `ScanScreen` and the Files tab's `FilesScreen`, which switches between `GalleryScreen` and `ListScreen` under one set of filter chips. |
| `src/theme/` | The Material 3 shell: Paper and navigation themes, spacing and density, status and filter labels. |
| `src/files/` | The Files tab's building blocks (feature 005): `FilesProvider` (the view and filter shared by gallery and list), `usePagedQuery` (paging with snapshot-change recovery), `useListNavigation` (breadcrumb, descend, ascend, relocation by name), `useLocalImage`, `FilterChips`, `StatusChip`, `GalleryTile`, `Breadcrumb` and the accessibility-label builders in `a11y.ts`. Feature 006 reuses the hooks for the tree view. |
| `src/sources/` | The Settings › Folders UI: `useSources` and `SourcesSection`. |
| `src/scan/` | App-wide scan state: `ScanProvider` (wraps the app, polls `getScanState` while a run is active and starts a `LOCAL_REFRESH` on open and on return to the foreground), `useScan` (state and actions for screens, including the 7-day staleness check) and `ScanSummaryCard`. |
| `android/app/src/main/java/com/syncscope/` | `MainActivity`, `MainApplication` and the native packages above. |
| `android/app/src/debug/` | Debug-only code, not in the release build: the `ReleaseGrantsActivity` grant-release seam ([D017](./decisions/0017-debug-grant-release-seam.md)), the `ConfigureRepositoryActivity` configure-repository seam ([D018](./decisions/0018-debug-repository-seam.md)) and the debug `ScanPacing`. `android/app/src/release/` holds the release no-op `ScanPacing`. |
| `android/app/src/test/` | JVM unit tests (Robolectric + Room), including the persistence contract tests and `robolectric.properties`. |
| `android/app/src/androidTest/` | Instrumented tests, including `ProtocolConnectInstrumentedTest` against the live containers. |
| `scripts/validation/` | Container, emulator, fixture and audit orchestration, with its `node --test` suites. |
| `validation/services/` | The Compose file and server configs for the protocol containers. |
| `validation/maestro/` | Maestro end-to-end flows, one directory per feature area (`sources/`, `scan/`, `browse/`), with shared `subflows/` and a pinned `config.yaml` order. |

## Validation infrastructure

The validation stack proves behaviour against real servers and real emulators.

- **Protocol containers.** `validation/services/compose.yaml` runs digest-pinned FTP (vsftpd), SFTP
  (OpenSSH) and WebDAV (Apache `mod_dav`) images on `127.0.0.1`, serving a read-only fixture tree.
  `scripts/validation/protocol-service.sh` and `protocol-services.sh` start, health-check and stop them
  (`pnpm validation:services:start`, `:health`, `:stop`). They generate fresh random credentials on every
  start, and require Docker 29.x and Compose 5.5.1
  ([D015](./decisions/0015-docker-major-version-pin.md)).
- **Fixtures.** `fixture-seed.sh` and `fixture-manifest.sh` seed and describe the fixture tree: flat and
  nested files, a duplicates pair with identical size and mtime, NFC/NFD unicode names, a size mismatch, a
  same-second timestamp bucket pair, hidden files, and non-regular entries (a symlink escaping the root and
  a FIFO). The `scan/` subtree holds the scan flows' remote side: `scan/clean/` and `scan/partial/`, whose
  `restricted/` folder is `0700` and host-owned so every server reports a real permission error.
- **Read-only audit.** Stopping the services runs `protocol-audit.sh` over each server's log, so teardown is
  part of the assertion: a run that passes its tests but performed a forbidden operation still fails. See
  [protocols](./protocols.md#the-read-only-guarantee).
- **Emulator orchestration.** `android-flow.sh` and `android-validator.sh` boot the API 31 or API 36
  emulator, install the APK and run the instrumented tests (`pnpm validation:android:api31`,
  `pnpm validation:android:api36`) or Maestro flows (`pnpm e2e:android`). `android-sdk.sh` resolves
  `ANDROID_HOME`.
- **Maestro flows.** `validation/maestro/` holds the end-to-end flows; `pnpm e2e:android` runs them on
  API 31 and then API 36, after `device-fixtures.sh` seeds the `SyncScopeE2E/` folders on internal storage
  and the SD card (including the `Scan` and `Bulk` sources of the scan flows). The scan flows configure
  the live containers through the debug-only `syncscope-debug://configure-repository` seam
  ([D018](./decisions/0018-debug-repository-seam.md)), which runs the production save, test and host-key
  approval, and `android-flow.sh` passes the per-run container credentials to Maestro as `-e` variables. The layout, selector, assertion, seam and fixture conventions are in
  [DEVELOPMENT.md](../DEVELOPMENT.md#end-to-end-flows-maestro).
- **Credentials to the device.** Gradle forwards the per-run container credentials into
  `testInstrumentationRunnerArguments`, and the emulator reaches the host at `10.0.2.2`
  ([D014](./decisions/0014-container-credentials-via-runner-args.md)).
- **Script tests.** `pnpm test:foundation` (`node --test scripts/validation/*.test.mjs`) asserts the image
  digests, version pins and script contracts.

The full live gate for the native layer is:

```sh
pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop
```

Environment prerequisites and known pitfalls are in [DEVELOPMENT.md](../DEVELOPMENT.md#environment-gotchas).

## Not yet implemented

4 spec methods still resolve a typed `NOT_IMPLEMENTED` envelope:

- `getSettings` and `setIncludeHidden`, the include-hidden-files setting. Scans run with
  `includeHidden = false` until then. Feature 008 owns them, reassigned from 005
  ([005 spec, Dependencies](../specs/005-gallery-list-filtering/spec.md#dependencies)).
- `prepareLocalDeletion` and `executeLocalDeletion`, delivered by feature 007.

`getLocalImageHandle` moved from feature 006 to feature 005, which delivers it for the gallery thumbnails;
006 reuses it for the full preview.
