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
| Two-phase deletion, re-checked on the server first | [D008](./decisions/0008-two-phase-local-deletion.md), [D020](./decisions/0020-pre-delete-server-recheck.md) |
| A personal release key; cleartext only by the user's choice | [D021](./decisions/0021-release-signing-and-cleartext-policy.md) |
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
- The contract is at version 6 (`CLOUD_SYNC_CONTRACT_VERSION` in TypeScript, `CONTRACT_VERSION` in
  Kotlin); the parity test checks that both sides carry the same version. Version 2 added the optional
  re-grant source ID to `launchSourcePicker`. Version 3 (feature 004) made `startScan` take an optional
  mode (`FULL` or `LOCAL_REFRESH`), implemented `startScan`, `cancelScan`, `getScanState`, `queryFiles`
  and `queryTreeChildren` with their scan DTOs, added the scan error codes (such as `SCAN_IN_PROGRESS` and
  `REFRESH_UNAVAILABLE`) and the file issue codes `REMOTE_MTIME_MISSING` and `LOCAL_UNAVAILABLE`, mirrored
  in both languages under the parity test. Version 4 (feature 005) added `nameInOtherSource` and
  `matchingFileCount` to `FileEntryDto`, implemented `getLocalImageHandle` and added the
  `IMAGE_UNAVAILABLE` error code; the details are in the
  [005 browse contract](../specs/005-gallery-list-filtering/contracts/cloudsync-browse.md). Version 5
  (feature 006) added `listSelectableEntries`, implemented `prepareLocalDeletion` and
  `executeLocalDeletion(planToken, includeUnsynced)`, added `webdavHttps` and `revision` to the repository
  summary, `configRevision` to the active snapshot and an optional `field` to error envelopes, mirrored
  `REPOSITORY_DEFAULT_PORTS` and `MAX_DELETION_PLAN_AGE_MILLIS`, and added the error codes `TLS_UNTRUSTED`,
  `DELETION_IN_PROGRESS`, `REPOSITORY_CHANGED`, `PLAN_NOT_FOUND` and `PLAN_STALE`; the details are in the
  [006 contract](../specs/006-mvp/contracts/cloudsync-mvp.md). Version 6 (feature 007) added four
  methods: `getScrollIndex(snapshotId, querySpec, anchor?)` (the scrollbar's bands and the anchor
  position, below), `browseRemoteFolders(config, transientPassword?, path?)` (the server folder browser),
  and `getBrowsePreferences` / `setBrowsePreferences` (the view and each view's sort, kept in Android
  `SharedPreferences` by `BrowsePreferences`). It also added the `SIZE_ASC` and `SIZE_DESC` sorts,
  `FileKind` and the query's optional `kind`, `ScrollUnit` with `SCROLL_BANDS_MIN` / `SCROLL_BANDS_MAX`,
  `FileEntryDto.sortName`, the file issue code `REMOTE_FOLDER_UNREAD`, the summary's
  `unreadRemoteFolders`, a per-folder connection test result, `remoteRoots` in place of `remoteRoot`, and
  an optional `fieldIndex` on error envelopes; the details are in the
  [007 contract](../specs/007-sort-scroll-remote-folders/contracts/cloudsync-polish.md).

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

The schema is at **version 5** (feature 007). Each step is a Room `@AutoMigration`, covered by
`MigrationTest`:

- Version 2 (feature 004) added `scan_run.mode` (`FULL` or `LOCAL_REFRESH`, default `FULL`) and the
  nullable `snapshot.remoteListedAtMillis`, the remote listing's age, which a local refresh copies from
  the snapshot it builds on.
- Version 3 (feature 005) added the nullable `local_node.descSynced`, `descUnsynced` and `descUnknown`:
  on directory rows, the number of files anywhere beneath with each status, written by `DirectoryRollup`.
  They are `NULL` on file rows and on rows written before version 3
  ([005 data model](../specs/005-gallery-list-filtering/data-model.md#schema-change-version-2--3)).
- Version 4 (feature 006) added the nullable `remote_match_key.directories`, the distinct server folders
  (at most 16, newline-separated) of the files collapsed into a key, which the pre-delete re-check lists
  ([D020](./decisions/0020-pre-delete-server-recheck.md)), and `repository_config.webdavHttps` (default
  `false`) ([006 data model](../specs/006-mvp/data-model.md)).
- Version 5 (feature 007) renamed `repository_config.remoteRoot` to `remoteRoots`, the remote folders one
  per line in the user's order (`@RenameColumn`, so a saved folder becomes a one-element list,
  [D022](./decisions/0022-several-remote-folders-partial-scan.md)); added `local_node.sortName`, the
  case- and accent-folded name every name sort and letter band reads (`SortName`), with the indexes
  `(snapshotId, kind, sizeBytes)` and `(snapshotId, kind, sortName)`; and added the nullable
  `remote_ambiguity.remotePath`, the configured folder a `REMOTE_FOLDER` gap could not read. The
  migration fills `sortName` from `lower(name)` in SQL; the next scan or refresh rewrites it with accents
  folded ([007 data model](../specs/007-sort-scroll-remote-folders/data-model.md#schema-change-version-4--5)).

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

- **`FULL`** (Scan and Rescan from scratch) connects, discovers precision, lists every configured remote
  folder breadth-first through `RemoteWalker` into an in-memory `MatchIndex` (a folder that cannot be
  read becomes a `REMOTE_FOLDER` gap and the walk goes on; only when none can be read does the scan fail,
  [D022](./decisions/0022-several-remote-folders-partial-scan.md)), enumerates each source through
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
  prevents torn reads during a rescan. Since contract version 6 the token's cursor holds the sort key,
  the `sortName` and the entry ID behind a format version byte, so a token from an older version is a
  `PAGE_TOKEN_MISMATCH`.
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

The sort rules since contract version 6 (feature 007,
[data model](../specs/007-sort-scroll-remote-folders/data-model.md#sort-keys-and-ordering)):

- Six sorts: `NAME_*` on `sortName`, `TIME_*` on the modified time and `SIZE_*` on the size, each
  ordered by `(key, sortName, entryId)` in the sort's direction, so every sort is total. A `NULL` size or
  time reads as a sentinel that puts it last in both directions. `SnapshotStore.sortKeyOf` is the only
  place the keys are defined.
- A query's `kind` narrows the rows to `DIRECTORY` or `FILE`. List view reads its folders as their own
  segment, by name, before the files in the chosen sort.
- **Scroll index.** `getScrollIndex` returns the bands of a result in one read, each with its count, its
  first row's position and a page token that starts at it: letters (`#`, `a`–`z`) for a name sort; years,
  months or days for a date sort (the coarsest unit that gives at least `SCROLL_BANDS_MIN` bands); and
  size ranges cut from the percentiles of the sizes shown and snapped to 1-2-5 values for a size sort,
  between `SCROLL_BANDS_MIN` and `SCROLL_BANDS_MAX` bands; files with an unknown key form a last
  `Unknown` band. The band rules live only in `ScrollBands`. Given an anchor (a sort value and a
  `sortName`), the index also returns `anchorIndex`, the position that row has, or would have, in the
  result.

On the JS side, `src/files/usePagedQuery.ts` holds the pages of one snapshot. Since feature 007 it is
**band-segmented** ([research R7](../specs/007-sort-scroll-remote-folders/research.md#r7-band-segmented-paging-in-the-views)):
it requests page 1 and the scroll index at once, then keeps one segment per band, each read from its
band's start token and padded with placeholder rows up to the band's count, so the list has its full
length and the `FastScroller` can jump to any band; a band is read when it comes into view. When new
results arrive, the view passes the anchor of its first visible file, and the hook scrolls to the
returned `anchorIndex` instead of the top ([R8](../specs/007-sort-scroll-remote-folders/research.md#r8-keeping-the-place-when-results-update)).
When the active snapshot changes, or a read fails with `STALE_GENERATION`, `SNAPSHOT_NOT_FOUND` or
`PAGE_TOKEN_MISMATCH`, it drops its rows and reloads with the same query, and drops any response that belongs to an older
snapshot or query ([005 research R1](../specs/005-gallery-list-filtering/research.md#r1-how-a-view-notices-a-new-snapshot-the-stale_generation-recovery-of-fr-005)).
`useListNavigation.ts` finds the list view's folder again by name in the new snapshot, falling back to the
nearest ancestor that still exists ([R2](../specs/005-gallery-list-filtering/research.md#r2-re-locating-the-current-folder-in-a-new-snapshot)).

### Local thumbnails, never remote content

`getLocalImageHandle(snapshotId, entryId, {maxEdgePx})` returns a `file://` URI of a downscaled JPEG in the
app's cache, `cacheDir/thumbnails/`, named by a hash of the entry ID and the edge. The edge is clamped to
64…2048 px on both sides of the bridge, gallery tiles ask for 256 px, and feature 008's preview reuses the
method with the screen's long edge. `LocalImageStore` (the `image` package) serves a cached file without
decoding, and otherwise decodes through `ContentResolver.loadThumbnail` with a `BitmapFactory` fallback, at
most four decodes at once. It reads local storage only, never opens a remote connection (R026) and never
passes or logs a document URI. An unreadable image is the typed `IMAGE_UNAVAILABLE` error. The cache is
left to the OS to reclaim ([005 research R7](../specs/005-gallery-list-filtering/research.md#r7-gallery-thumbnails-getlocalimagehandle-moved-from-007-user-decision-2026-10-01)).

### Material 3 shell: one theme module

`src/theme/` is the single source of the UI's look ([005 research R9](../specs/005-gallery-list-filtering/research.md#r9-material-3-shell-theme-spacing-and-density-no-inline-styles-fr-004)):
`theme.ts` builds the Paper MD3 theme and the matching React Navigation theme, `spacing.ts` holds the
spacing scale, the dense-layout sizes and the gallery column count, and `statusLabels.ts` holds the
user-facing status and filter labels. Components style themselves through a `StyleSheet`, themed with
`useTheme()` where colours are needed; inline styles fail lint. Every interactive element has an
accessibility label, built in `src/files/a11y.ts`, and those labels are the Maestro selectors of the
browse flows.

### Two-phase deletion

The `deletion` package (feature 006) implements the two phases
([D008](./decisions/0008-two-phase-local-deletion.md), amended 2026-10-02):

- **`prepareLocalDeletion(snapshotId, entryIds)`** (`DeletionOperations`) splits the selection into to
  delete, not backed up and refused. UNKNOWN entries are refused outright
  ([D006](./decisions/0006-unknown-status-never-deletable.md)). Every SYNCED entry is re-checked on the
  server by `DeletionRecheck`, which lists only the folders stored for its match key
  ([D020](./decisions/0020-pre-delete-server-recheck.md)). It returns a plan token, the counts and byte
  totals, how many files the re-check moved, and the listing age. The single plan lives in memory, is
  single-use and expires after 15 minutes.
- **`executeLocalDeletion(planToken, includeUnsynced)`** checks each file through SAF and deletes it with
  `LocalDeleter` (`DELETED`, `ALREADY_GONE`, `CHANGED`, `ACCESS_LOST`, `FAILED`). Every 100 files,
  `SnapshotStore.recordDeletions` removes the deleted rows, decrements the snapshot and ancestor-folder
  counts and writes `local_deletion_overlay` as the audit, in one transaction. Folders are never deleted.
- Both run through `ScanCoordinator.runExclusive`, so a scan and a deletion never overlap
  (`SCAN_IN_PROGRESS`, `DELETION_IN_PROGRESS`).

On the JS side, `src/selection/` holds the selection (`SelectionProvider`, an ID map tied to one
snapshot, filled by `listSelectableEntries` for "select all"), its summary and `formatBytes`, the
`SelectionBar` that replaces the tab bar while selecting, and `DeleteFlow`, the checking, confirmation and
result dialogs. The safety rules are in [sync and deletion safety](./sync-and-deletion-safety.md).

### Local sources through the Storage Access Framework

The user's folders are `source_root` rows, each holding a persisted SAF tree-URI grant
([D016](./decisions/0016-saf-source-identity-and-availability.md)). Only on-device and removable storage
(`com.android.externalstorage.documents`) is accepted. Each row has a `canonicalRoot` built from the tree
document ID, and a new pick that equals, contains or is nested in an existing root is rejected. Availability
(Available, Access lost, Storage missing) is computed on every `listSources` call and never stored. A
re-grant must pick the same folder, and removal deletes the row with all its scan data in one transaction
before releasing the grant. `treeUri` and `canonicalRoot` stay native; no raw path crosses the bridge. The
user-facing screen is **Settings › Device folders** (`src/sources/`).

### Verification against real servers, not mocks

Robolectric + Room for unit logic, `androidTest` against live containers for protocol clients, and Maestro on
real emulators for every user-visible claim ([D012](./decisions/0012-maestro-e2e-proof-bar.md)). See
[Validation infrastructure](#validation-infrastructure).

## Native packages

All under `android/app/src/main/java/com/syncscope/`:

| Package | Role |
| --- | --- |
| `bridge` | `CloudSyncModule` and `CloudSyncPackage`, the envelope builder (`CloudSyncEnvelope`), native contract constants (`CloudSyncContracts`), `RepositoryOperations`, which saves, summarises and tests the repository configuration, `ScanOperations`, which turns `startScan`, `cancelScan`, `getScanState`, `queryFiles`, `queryTreeChildren`, `getScrollIndex`, `listSelectableEntries` and `getLocalImageHandle` into envelopes, and `BrowsePreferences` (feature 007), the remembered view and sorts in `SharedPreferences`. `RepositoryOperations` also serves `browseRemoteFolders`. |
| `deletion` | Feature 006: `DeletionOperations` (the plan store and the prepare and execute orchestration), `DeletionRecheck` (the server re-check of SYNCED files, [D020](./decisions/0020-pre-delete-server-recheck.md)) and `LocalDeleter` (SAF verify-then-delete per file). |
| `persistence` | The Room database (`SyncScopeDatabase`), its entities and DAOs, `SnapshotStore`, snapshot queries and the opaque page-token codec. |
| `remote` | The read-only `RemoteClient` interface and its FTP, SFTP and WebDAV implementations (`RemoteClientFactory`, `PropfindParser` for WebDAV), `RemoteRoots` (feature 007: the remote folder list's normalization, overlap check and encoding, [D022](./decisions/0022-several-remote-folders-partial-scan.md)), plus SFTP host-key trust (`HostKeyTrustStore`, `TofuHostKeyVerifier`). |
| `credential` | `CredentialStore`: the repository password in `EncryptedSharedPreferences` under an Android Keystore `AES256_GCM` master key. |
| `source` | Local folder selection through the Storage Access Framework: `SourceTree` (tree URI to volume, path and `canonicalRoot`, plus the overlap rule), `SourceAlias` (generated aliases), `SafAccess` (the seam over `ContentResolver` and `StorageManager`, with `ContentResolverSafAccess` as the production implementation), `SourceAvailability` (the computed availability check), `SourcePicker` (the single-slot activity-result bridge for `launchSourcePicker`), `SourceOperations` (list, add, re-grant and remove as envelopes) and `LocalSourceEnumerator` (the enumeration contract the scan consumes). Rules: [D016](./decisions/0016-saf-source-identity-and-availability.md). |
| `scan` | The scan engine (feature 004): `MatchIndex` (the NFC name, size and bucket key, with `bucketOf` and `MTIME_UNKNOWN_BUCKET`), `Matcher` (the pure matching rule table), `RemoteWalker` (breadth-first listing of every remote folder with retries, `REMOTE_FOLDER` gaps and the `FAILED` boundary), `SortName` (the one name folding, feature 007), `ScrollBands` (the letter, date and size band rules of the scroll index, feature 007), `DirectoryRollup` (worst-of directory status and per-status descendant file counts), `ScanEngine` (`FULL` and `LOCAL_REFRESH` end to end), `ScanCoordinator` and `ScanProgress` (the single running scan, its progress and cancellation, and `runExclusive` for deletions) and `ScanPacing` (a no-op in release; a debug-only per-file pause for the e2e flows). Rules: [D003](./decisions/0003-directory-agnostic-sync-matching.md), [D019](./decisions/0019-match-name-normalization-and-strict-buckets.md). |
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
| `src/navigation/`, `src/screens/` | The navigation shell and screens. The root is a native stack (`@react-navigation/native-stack`) with two routes: `Tabs` (the bottom tabs Scan, Files and Settings) and `Repository` (`RepositoryScreen`, the server form, with a discard prompt on `beforeRemove`). The tabs hold `SettingsScreen`, `ScanScreen` and the Files tab's `FilesScreen`, which switches between `GalleryScreen` and `ListScreen` under one set of filter chips. `fixTargets.ts` maps an error code to the place that fixes it, for the "Go there" buttons. |
| `src/repository/` | The Settings › Repository UI (feature 006): `useRepository` (the save, test and host-key state machine), `RepositorySection` and `HostKeyDialog`; since feature 007 also `RemoteFolderBrowser`, the modal server folder browser behind each remote folder's **Browse** button. It calls `browseRemoteFolders` with the form's details, so a typed password stays in the form's state, reuses `HostKeyDialog` for an untrusted SFTP key, and ignores the answer for a folder the user already left. |
| `src/setup/` | `useSetupChecklist`, the derived "server set up, folder available" state behind the Scan tab's checklist and the Files tab's empty state. |
| `src/selection/` | Multi-select and deletion (feature 006): `SelectionProvider`, `summary.ts`, `formatBytes.ts`, `SelectionBar` and `DeleteFlow`. |
| `src/theme/` | The Material 3 shell: Paper and navigation themes, spacing and density, status and filter labels. |
| `src/files/` | The Files tab's building blocks (feature 005): `FilesProvider` (the view and filter shared by gallery and list, and since feature 007 each view's sort, loaded from and saved to the browse preferences), `usePagedQuery` (band-segmented paging with snapshot-change recovery and anchor restore), `SortMenu` and `ViewMenu` (the two drop-downs, on `ChoiceMenu`), `FastScroller` (the scrollbar, on `PanResponder` and `Animated`, adjustable for TalkBack) with `bandLabel.ts`, `useListNavigation` (breadcrumb, descend, ascend, relocation by name), `useLocalImage`, `FilterChips`, `StatusChip`, `GalleryTile`, `Breadcrumb` and the accessibility-label builders in `a11y.ts`. Feature 008 reuses the hooks for the tree view. |
| `src/sources/` | The Settings › Device folders UI: `useSources` and `SourcesSection`. |
| `src/scan/` | App-wide scan state: `ScanProvider` (wraps the app, polls `getScanState` while a run is active and starts a `LOCAL_REFRESH` on open and on return to the foreground), `useScan` (state and actions for screens, including the 7-day staleness check) and `ScanSummaryCard`. |
| `android/app/src/main/java/com/syncscope/` | `MainActivity`, `MainApplication` and the native packages above. |
| `android/app/src/debug/` | Debug-only code, not in the release build: the `ReleaseGrantsActivity` grant-release seam ([D017](./decisions/0017-debug-grant-release-seam.md)), the `ConfigureRepositoryActivity` configure-repository seam ([D018](./decisions/0018-debug-repository-seam.md)) and the debug `ScanPacing`. `android/app/src/release/` holds the release no-op `ScanPacing`. |
| `android/app/src/test/` | JVM unit tests (Robolectric + Room), including the persistence contract tests and `robolectric.properties`. |
| `android/app/src/androidTest/` | Instrumented tests, including `ProtocolConnectInstrumentedTest` against the live containers. |
| `scripts/validation/` | Container, emulator, fixture and audit orchestration, with its `node --test` suites. |
| `validation/services/` | The Compose file and server configs for the protocol containers. |
| `validation/maestro/` | Maestro end-to-end flows, one directory per feature area (`sources/`, `scan/`, `browse/`, `mvp/`, `polish/`), with shared `subflows/` and a pinned `config.yaml` order, plus the `staged/` pairs, which run outside the workspace. |

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
  and the SD card (including the `Scan` and `Bulk` sources of the scan flows and the `Delete`, `Recheck`,
  `Offline`, `Select` and `Changed` sources of the 006 flows). The `mvp/01-setup-*` flows set up each protocol
  through the repository screen; the other scan, browse and deletion flows configure the live containers
  through the debug-only `syncscope-debug://configure-repository` seam
  ([D018](./decisions/0018-debug-repository-seam.md)), which runs the production save, test and host-key
  approval, and `android-flow.sh` passes the per-run container credentials to Maestro as `-e` variables.
  After the workspace, `android-flow.sh` runs the `staged/` a/b pairs with a host- or device-side hook
  between the parts (a server file removed, a container paused, a device file changed).
  `pnpm e2e:android:release-smoke` builds, installs and checks the release APK with no Metro running. The layout, selector, assertion, seam and fixture conventions are in
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

2 spec methods still resolve a typed `NOT_IMPLEMENTED` envelope: `getSettings` and `setIncludeHidden`, the
include-hidden-files setting. Scans run with `includeHidden = false` until then. Feature 010 owns them,
reassigned from 005 ([005 spec, Dependencies](../specs/005-gallery-list-filtering/spec.md#dependencies)).

`prepareLocalDeletion` and `executeLocalDeletion` were delivered by feature 006 (MVP), together with the
new `listSelectableEntries`.

`getLocalImageHandle` moved from feature 008 to feature 005, which delivers it for the gallery thumbnails;
008 reuses it for the full preview.
