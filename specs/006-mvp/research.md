# Research: MVP — a Usable App on a Real Device

Decisions for [spec.md](./spec.md) (clarified 2026-10-02). Each entry gives the decision, the rationale and
the alternatives rejected. Code references are to the state after feature 005.

## R1. Repository form: a stack screen above the tabs

- **Decision**: Add `@react-navigation/native-stack` (7.x, same family as the installed
  `@react-navigation/native` 7 and `react-native-screens` 4). The root becomes a stack with two routes:
  `Tabs` (the existing bottom tabs) and `Repository` (the form). Settings shows a Repository section with
  the saved summary and an "Edit" or "Set up" button that pushes `Repository`. The unsaved-changes prompt
  uses the stack's `beforeRemove` event, which catches both the header back arrow and the system back
  button.
- **Rationale**: a form with six fields, a keyboard and a discard prompt needs its own screen. The stack
  gives back handling and `beforeRemove` for free. `react-native-screens`, which is the only native part, is
  already installed for the tabs, so no new native code is added.
- **Alternatives rejected**:
  - An inline edit mode inside the Settings scroll view. Leaving through a tab press would need a custom
    `tabPress` guard, and the keyboard covers the lower fields.
  - A full-screen Paper `Modal`. Back handling, keyboard avoidance and focus have to be written by hand,
    which is more code than the dependency.

## R2. Save, test and SFTP host-key flow in the UI

- **Decision**: "Save" calls `saveRepository(config, password?)` and then `testRepository()`. Both
  already exist (feature 002). The JS hook `useRepository` (`src/repository/`) drives this state machine:
  `idle → saving → testing → connected | failed | hostKeyPrompt`.
  - **Unknown SFTP key** (`SFTP_HOST_KEY_UNVERIFIED` with `hostKeyChallenge`): a dialog shows the
    algorithm and SHA-256 fingerprint with "Trust" and "Reject". "Trust" calls `approveSftpHostKey`, then
    `testRepository` again. "Reject" calls `rejectSftpHostKey`, and the section shows "Server key
    rejected".
  - **Changed SFTP key** (`SFTP_HOST_KEY_CHANGED`): the dialog leads with a warning that the key changed,
    shows the new fingerprint, and makes the trust button say "Trust new key". Trusting needs a second
    confirmation tap.
  - **Password**: on edit the field is empty, with the helper text "A password is stored. Leave empty to
    keep it." Sending no password keeps the stored one only when host, port, protocol and user are
    unchanged. That is the existing `sameAccount` rule, enforced natively.
  - **Field errors**: native `parse` stays the only validator. Today its `invalidField` envelope carries
    the field only inside the message text, so the error DTO gains an optional `field` (`protocol`, `host`,
    `port`, `username`, `password`, `remoteRoot`), and the form puts the message under that field. The JS
    side does no validation of its own beyond disabling "Save" while a required field is empty.
  - **Port**: optional. When empty, the protocol's default applies: FTP 21, SFTP 22, WebDAV 80, or 443
    with HTTPS (R4). The defaults become a mirrored constant (`REPOSITORY_DEFAULT_PORTS` in both contract
    files, under `CloudSyncContractsParityTest`). `RepositoryOperations.defaultPort` reads it, and the
    form shows it as placeholder text.
  - **Draft survival**: the form state lives in the screen component, which stays mounted while the app is
    in the background. The password is never kept outside the field's component state.
- **Rationale**: it reuses every native operation unchanged, keeps one state machine with unit tests, and
  matches spec Story 1 scenarios 2–6.
- **Alternatives rejected**: a separate "Test" button before saving. The native test reads the *saved*
  configuration, so testing unsaved values would need a new native method.

## R3. Scan and repository edits are mutually exclusive

- **Decision**: `RepositoryOperations.save` refuses with `SCAN_IN_PROGRESS` while the coordinator has an
  active run (FR-011). It checks through a new `ScanCoordinator.isBusy()`, which also covers a running
  deletion (R13). The form disables "Save" and shows "A scan is running" while `useScan` reports an active
  run. The native check is the guarantee, and the disabled button is only a hint.
- **Rationale**: the native side is the one place that knows for sure. The UI state alone can race.
- **Alternatives rejected**: cancelling the scan when the user saves. That loses work silently.

## R4. WebDAV over HTTPS, and cleartext in release builds

- **Finding**: the WebDAV client hard-codes `http` (`docs/protocols.md`, "Known limit"), and the release
  manifest sets `usesCleartextTraffic=false`. A release APK therefore cannot reach any WebDAV server. FTP
  is plain TCP and is not affected by the cleartext flag, but it also sends the password unencrypted.
- **Decision**:
  - The repository config gains `webdavHttps` (boolean). The form shows a "Use HTTPS" switch for WebDAV
    only, on by default for a new configuration. Existing rows migrate to `false` (http), which keeps the
    debug test containers working.
  - The release build allows cleartext (`usesCleartextTraffic=true`). The app makes HTTP requests only to
    the server the user typed in, so the policy that matters is the user's choice. The form shows a warning
    under the protocol picker when the choice is unencrypted (FTP, or WebDAV without HTTPS): "The password
    and file names are sent unencrypted. Use only on a network you trust."
  - HTTPS uses the system trust store. A certificate the phone does not trust (for example self-signed)
    fails with the new code `TLS_UNTRUSTED`: "The server's certificate is not trusted by this phone." The
    message suggests SFTP. Trusting user certificates is out of scope.
- **Rationale**: without this, WebDAV, one of the three supported protocols, would not work in the APK the
  MVP exists to ship. A per-host network security config cannot name a host the user types at runtime.
- **Alternatives rejected**:
  - Keeping cleartext blocked and offering HTTPS only. This breaks plain-HTTP WebDAV on a home network,
    which is the common NAS setup, with no workaround.
  - Bundling a `network_security_config` that trusts user CAs. That widens trust for every connection, and
    certificate pinning UX is out of MVP scope.

## R5. Messages name places that exist

- **Decision**: `RepositoryOperations.NOT_CONFIGURED_ACTION` becomes "Set up your server in Settings ›
  Repository." `CREDENTIAL_UNAVAILABLE_ACTION` becomes "Enter the password again in Settings ›
  Repository." Native code stays the single source of message text (D011). JS maps error codes to a
  navigation target in one table (`src/navigation/fixTargets.ts`: `REPOSITORY_NOT_CONFIGURED`,
  `CREDENTIAL_UNAVAILABLE`, `AUTH_FAILED`, `TLS_UNTRUSTED`, `SFTP_HOST_KEY_*` → `Repository`;
  `NO_SOURCES_SELECTED`, `GRANT_REVOKED` → `Settings`). Error surfaces render an extra "Go there" button
  when the code has a target. A unit test fails if "Connect screen" appears in any `.kt` or `.ts(x)`
  string under `src/` or `android/app/src/main` (SC-003). The `CloudSyncContracts.ts` doc comment is
  reworded too.
- **Rationale**: the message text and the navigation target are separate pieces of knowledge, each with
  one owner. The grep test keeps SC-003 true from now on.
- **Alternatives rejected**: native returning a route name. Navigation is a UI concern, and D001 keeps
  native code UI-agnostic.

## R6. Setup checklist (Scan and Files tabs)

- **Decision**: a JS hook `useSetupChecklist()` derives `{repository: 'missing' | 'needsPassword' |
  'ready', folders: 'none' | 'noneAvailable' | 'ready'}`. It reads `getRepositorySummary` and
  `listSources`, which already return `credentialPresent` and per-source availability, plus `useScan`. It
  re-reads on tab focus. The Scan tab shows a "Before you can scan" card listing the missing items, each
  with a button to its place, and disables "Scan" until both items are ready (FR-007). The Files tab's
  empty state ("No results yet. Run a scan to see which files are backed up.") gets a "Go to Scan" button
  (FR-008).
- **Rationale**: it is computed and never stored (spec Key Entities), and built only from methods that
  already exist.
- **Alternatives rejected**: a native `getSetupState` method. It would duplicate what two existing
  methods already return.

## R7. Folder picker hint and start folder

- **Decision**:
  - `SourcesSection` shows a one-line hint above "Add folder": "Android does not allow the top level of
    the storage or the Download folder. Pick a folder such as DCIM or Pictures."
  - For a new folder (not a re-grant), `SourcePicker.intent` passes `EXTRA_INITIAL_URI =
    DocumentsContract.buildDocumentUri("com.android.externalstorage.documents", "primary:DCIM")`. If DCIM
    does not exist, the system picker ignores the hint and opens at its default location, so no existence
    check is needed. Re-grants keep using the source's own URI (feature 003).
- **Rationale**: Android enforces the restriction and cannot be bypassed under SAF (D016). The hint and
  the start folder are the whole fix.
- **Alternatives rejected**:
  - `MANAGE_EXTERNAL_STORAGE`. It breaks D016 and is not allowed on Play.
  - Detecting the refusal. The picker never tells the app; the user just cannot confirm.

## R8. Installable APK: release build, personal key, no debug seams

- **Decision**:
  - `android/app/build.gradle` gets `signingConfigs.release`, read from the Gradle properties
    `SYNCSCOPE_RELEASE_STORE_FILE`, `SYNCSCOPE_RELEASE_STORE_PASSWORD`, `SYNCSCOPE_RELEASE_KEY_ALIAS` and
    `SYNCSCOPE_RELEASE_KEY_PASSWORD`. These live in `~/.gradle/gradle.properties` or come from
    `ORG_GRADLE_PROJECT_*` environment variables, never from the repository.
  - A `gradle.taskGraph.whenReady` check fails any `*Release` packaging task when a property is missing,
    with a message pointing to `DEVELOPMENT.md` §"Release key". Debug and unit-test builds never need the
    key, and there is no fallback to the debug key (clarification 2).
  - `pnpm assemble:release` already exists and becomes the documented command. `DEVELOPMENT.md` documents
    the one-time `keytool -genkeypair` command, where to keep the keystore, and that losing it forces an
    uninstall.
  - The release variant bundles the JS (React Native's default for release), so it needs no Metro. This
    depends on the uncommitted `pnpm-workspace.yaml` change that hoists `hermes-compiler`, which this
    feature commits with an explanation in `DEVELOPMENT.md`.
  - Debug seams already live in `src/debug/` and are absent from release. The end-to-end check (R16)
    asserts that `syncscope-debug://` links do not resolve on the release APK.
  - The version is derived from `package.json` (R17).
- **Rationale**: a stable personal key is what lets later builds update in place (clarification 2).
  Reading it from Gradle properties is the standard React Native setup.
- **Alternatives rejected**:
  - A keystore committed with a dummy password. The key leaks.
  - Debug-key fallback. Rejected in clarification 2.

## R9. Selection model and "select all"

- **Decision**:
  - A JS `SelectionProvider` (inside `FilesProvider`) holds `{snapshotId, items: Map<entryId, {sizeBytes:
    number | null, status, isImage}>}`. The count, the total of known sizes, the number of files of
    unknown size, and the number hidden by the current filter are pure derived values (`selectionSummary`
    in `src/selection/summary.ts`).
  - Long-press and tap read their item data from the row already on screen.
  - "Select all" calls a new native method, `listSelectableEntries(snapshotId, querySpec)`. It returns
    every `FILE` row the query would show (same filter, view and parent rules as `queryFiles` and
    `queryTreeChildren`, gallery images only, directories never), as one compact response of parallel
    arrays: `entryIds`, `sizes` (−1 for unknown), `statuses`, `images`. The JS side merges them into the
    map, so the count and total are exact without paging (FR-016).
  - "Hidden by filter" means a selected file whose status or image-ness does not match the current view
    and filter. Files in other folders of list view are not counted as hidden, because the user navigated
    away from them knowingly.
  - When `useScan` reports a different active `snapshotId`, the selection clears and a snackbar says
    "Results were updated, so the selection was cleared."
- **Rationale**: an explicit ID set is what `prepareLocalDeletion(snapshotId, entryIds)` already takes,
  and a set survives filter and view changes trivially. One bulk call keeps "select all" responsive: 50 k
  rows of a short ID, a number and two flags are about 2 MB, read in one indexed query.
- **Alternatives rejected**:
  - A query-based selection ("all of filter X except …"). Keeping it across filter changes, and counting
    it, would need set algebra on the native side for every change.
  - Paging `queryFiles` 200 rows at a time for "select all". That is 250 bridge round trips for 50 k
    files.

## R10. Selection layout and size formatting

- **Decision**:
  - While the selection is non-empty, `FilesScreen` sets `tabBarStyle: {display: 'none'}` on its tab
    route and renders `SelectionBar` at the bottom. On the left it shows "37 selected · 1.2 GB", plus a
    second line "2 of unknown size · 5 hidden by filter" when either count is non-zero. On the right it
    holds a "Delete" button.
  - The header shows a ✕ (clear) on the left and "Select all" on the right, through `navigation.setOptions`.
  - The hardware back button clears the selection (`BackHandler` while selecting).
  - Selected tiles and rows show a check-circle overlay and set `accessibilityState={{selected: true}}`.
    The label builders in `src/files/a11y.ts` add ", selected" (FR-017).
  - `formatBytes` (`src/selection/formatBytes.ts`) uses decimal units (1 kB = 1000 B, as Android's
    Settings › Storage does), at most one decimal place, and `Intl.NumberFormat` for the locale's decimal
    separator. Zero is "0 B".
- **Rationale**: this is clarification 3, built with existing navigation and Paper parts.
- **Alternatives rejected**: calling native `Formatter.formatShortFileSize` over the bridge. That is an
  async call for every tap.

## R11. Server locations of matched files (for the re-check)

- **Finding**: the re-check (clarification 1) must list the server folder that holds each matched file,
  but scans keep only collapsed match keys (`remote_match_key`: NFC name, size, bucket, duplicate count).
  `remote_node` exists in the schema but is never written (004 data-model).
- **Decision**: schema version 4 adds `remote_match_key.directories` (TEXT, nullable). It holds the
  distinct remote parent directories of the files collapsed into that key, newline-separated, at most 16.
  `MatchIndex` collects them during the walk. `LOCAL_REFRESH` already copies match keys, so the column
  rides along with no new copy step. Rows written before version 4 have `NULL`, and their files cannot be
  re-checked (R12, reason `SCAN_TOO_OLD`).
- **Rationale**: one nullable column on a table that already has exactly the right key and a unique index
  on it, so lookup is the existing exact-key path. Writing `remote_node` would add one row per server file
  (100 k+) and a second copy on every app-open refresh.
- **Alternatives rejected**:
  - Writing `remote_node` for every regular file, plus a new index. Too much storage, multiplied by
    snapshots that are never pruned.
  - Re-walking the whole server tree on every delete. That takes minutes for a large backup.
- **Cap rationale**: more than 16 copies of one file in different folders is a pathological case. If all
  16 stored folders lost the file, it is treated as gone. That errs towards "not backed up", the safe side
  (D019 spirit).

## R12. Pre-delete server re-check (prepare)

- **Decision**: `prepareLocalDeletion(snapshotId, entryIds)` does the following:
  1. Refuses with:
     - `SNAPSHOT_NOT_FOUND` / `STALE_GENERATION` unless `snapshotId` is the active snapshot;
     - `REPOSITORY_CHANGED` when the snapshot's `configRevision` differs from the saved repository's
       `revision`;
     - `SCAN_IN_PROGRESS` / `DELETION_IN_PROGRESS` while busy (R13).
  2. Loads the selected `FILE` rows. Unknown IDs and directories are ignored and counted as `missing`.
  3. Puts UNKNOWN rows in `refused` (D006).
  4. Re-checks SYNCED rows. For each, it looks up its key (`MatchIndex.nfc(name)`, size, `bucketOf(mtime,
     precision)`) and that key's `directories`.
     - `directories == NULL` → `refused`, reason `SCAN_TOO_OLD` ("Scan again to delete these files").
     - Otherwise group the rows by directory, connect once (`RemoteClientFactory`, with the stored host
       key; an untrusted or changed key fails the prepare with the `SFTP_HOST_KEY_*` code), and list each
       directory once in sequence. The retry policy is `RemoteWalker.listWithRetry`, extracted so walk
       and re-check share it (Principle III).
     - A row stays `toDelete` when any of its directories still lists a regular file with the same key
       (same NFC name, size and bucket at the snapshot's precision).
     - A directory answering "not found" counts as "gone". A directory failing any other way counts as
       "could not check". A row with no confirming directory and at least one "could not check" goes to
       `refused` (`RECHECK_FAILED`). Otherwise it goes to `unsynced` (`GONE_FROM_SERVER`), and both count
       towards `movedByRecheck`.
     - A connection or authentication failure before any listing fails the whole prepare with that code,
       and no plan exists (clarification 1, "nothing is deleted").
  5. Puts UNSYNCED rows in `unsynced`.
  6. Stores the plan (R13) and returns the token plus counts, byte totals and `remoteListedAtMillis`.
- **Rationale**: it lists only the folders that hold the selected files. A typical selection spans a few
  camera folders, so it is a handful of listings. It reuses the matching rules (`MatchIndex`) and the
  retry policy instead of restating them.
- **Alternatives rejected**:
  - A per-file `stat` on the server. Not every protocol client exposes it, the interface only has
    `list`, and N round trips cost more than a few listings.
  - Re-checking UNSYNCED files too, to promote them. YAGNI: the user is told they are not backed up, and
    a scan promotes them.

## R13. Plans, exclusivity and execution

- **Decision**:
  - **Plan store.** `DeletionOperations` (`android/.../deletion/`) keeps at most one plan in memory:
    token (random UUID), `snapshotId`, the rows per group, and `createdAtMillis`. A new prepare replaces
    the old plan. A plan is single-use, expires after 15 minutes (`PLAN_NOT_FOUND`), and is refused when
    the active snapshot moved (`PLAN_STALE`, spec edge case "Stale confirmation"). Process death loses the
    plan; that is safe, because the user simply re-prepares.
  - **Exclusivity.** `ScanCoordinator` gains `runExclusive(block)`. Under its existing mutex it refuses
    with `SCAN_IN_PROGRESS` when a run is active, and with `DELETION_IN_PROGRESS` when another exclusive
    block is already running, so only one prepare or execute runs at a time. Otherwise it marks the
    coordinator busy so `start()` refuses with the new `DELETION_IN_PROGRESS`. Prepare and execute run through it (FR-021). The app-open
    `LOCAL_REFRESH` treats `DELETION_IN_PROGRESS` as "skip this time".
  - **Execute.** `executeLocalDeletion(planToken, includeUnsynced)`: the second argument is the stronger
    acknowledgement (spec Story 6 scenario 3). Without it, `unsynced` rows are skipped. For each row:
    1. Check the source's grant: no write grant → `ACCESS_LOST`.
    2. Query the document's size and modified time through SAF: missing → `ALREADY_GONE`; size or mtime
       different from the row → `CHANGED`, and the file is not deleted.
    3. `DocumentsContract.deleteDocument`: true → `DELETED`; false or `FileNotFoundException` →
       `ALREADY_GONE` when a re-query confirms absence, else `FAILED`; `SecurityException` →
       `ACCESS_LOST`.

    Rows with status `DELETED` or `ALREADY_GONE` are committed every 100 files (R14). The call returns
    the totals and the failures (`entryId`, name, reason).
  - **D008 amendment.** `executeLocalDeletion` gains the `includeUnsynced` argument. The two-phase
    decision stands; the acknowledgement belongs to the confirmation, after the breakdown has been shown.
    This is recorded as a dated amendment in D008.
- **Rationale**: an in-memory plan is enough for a confirmation dialog that lives for seconds. Checking
  each file before deleting covers spec scenario 6, where files changed between confirm and delete.
- **Alternatives rejected**:
  - Persisting plans in Room. Nothing needs them across a process restart.
  - Re-preparing with an `includeUnsynced` flag. That is a second server re-check for the same selection.

## R14. Reflecting deletions without a rescan

- **Decision**: each committed batch runs in one Room transaction (`SnapshotStore.recordDeletions`). For
  every removed row it:
  - deletes the `local_node` row;
  - decrements the matching `snapshot_counts` row (source and status);
  - decrements `descSynced`, `descUnsynced` or `descUnknown` on every ancestor directory row, found by
    walking `parentId`;
  - inserts a `local_deletion_overlay` row (`state` `DELETED` or `ALREADY_GONE`, `atMillis`) as the
    audit record.

  The reads (`queryFiles`, `queryTreeChildren`, `statusCounts`, `listSelectableEntries`) need no change.
  After execute, the Files tab reloads page 1 and keeps its folder, as on a snapshot change.
- **Rationale**: removing rows means no read query changes and no risk of one forgetting an overlay
  filter. The overlay still records only real outcomes (D008). An interrupted run leaves every committed
  batch consistent, and the next app-open `LOCAL_REFRESH` re-enumerates the device, so a file deleted
  just before a crash also disappears then (spec edge case "Deletion interrupted").
- **Alternatives rejected**:
  - Keeping rows and filtering with `NOT EXISTS (overlay)` in every query. Every read path, including
    precomputed folder counts, would need it.
  - Starting a `LOCAL_REFRESH` after each deletion. It re-enumerates every source, which is seconds to
    minutes, and the results would be wrong until it ends.

## R15. "Results are from older server settings"

- **Decision**: `ActiveSnapshotDto` gains `configRevision`, and the repository summary gains `revision`
  (both already stored). The Scan tab shows "These results were made with your previous server settings.
  Scan again." when they differ (FR-010). Prepare refuses with `REPOSITORY_CHANGED` in that case (R12).
- **Rationale**: both numbers are already in the database. Only two DTO fields are added.

## R16. End-to-end proof

- **Decision**: a new Maestro directory, `validation/maestro/mvp/`, runs after `browse/` against the live
  containers, on both levels `pnpm e2e:android` runs (API 31 and API 36) ([contracts/maestro-mvp.md](./contracts/maestro-mvp.md)).
  - Repository setup goes through the UI for FTP, SFTP (including key approval) and WebDAV. The existing
    scan and browse flows keep the D018 seam, and D018 is updated to say it remains for flows that need a
    fast setup.
  - **Re-check flows.** The server copy must disappear, or the server must become unreachable, between
    the scan and the delete. `android-flow.sh` runs staged a/b flow pairs after the workspace (listed in
    `validation/maestro/staged/pairs.txt`), with a host-side hook between the parts that deletes a fixture
    file or pauses the container. The same mechanism proves a device file changing between the
    confirmation and the delete: a device-side hook removes one file and touches another while the
    confirmation dialog stays open.
  - **Release smoke.** `android-flow.sh release-smoke` builds the release APK, signed with a throwaway key
    the script generates in a temp directory, installs it with no Metro running, and runs
    `mvp/90-release-smoke`. Before that, it asserts that `adb shell am start -d syncscope-debug://…`
    finds no activity (SC-004). It also:
    - builds once with no signing properties and asserts the build fails with the documented message
      (Story 4 sc. 4);
    - builds through `pnpm assemble:release`, the documented command (sc. 3);
    - asserts `aapt2 dump badging` reports the `package.json` version (FR-022);
    - re-installs the same APK with `adb install -r` and runs `mvp/91-release-update`, which checks the
      server, folders and results survived (sc. 5).
  - **Scenarios with no deterministic end-to-end setup** are proven by JVM and Jest tests and recorded as
    deviations in plan.md's Complexity Tracking:
    - a changed SFTP host key (Story 1 sc. 5): the container's key cannot be rotated without breaking the
      rest of the suite;
    - an unreadable stored password (Story 2 sc. 4): Android Keystore invalidation cannot be triggered
      from a test;
    - files of unknown size (Story 5 sc. 5): SAF reports a size for every fixture file;
    - a scan older than seven days (Story 6 sc. 9): the device clock cannot be moved safely mid-suite.
- **Rationale**: Principle V needs every P1 story on a real runtime, and FR-013 names these proofs. A staged
  pair is the smallest addition that lets a flow change server state mid-scenario.
- **Alternatives rejected**:
  - Debug-only seams to fake an old scan, an unreadable password or a rotated key. Each would add a
    test-only code path into production logic, which D017 allows only for real OS state.
  - Changing the repository root to simulate a missing file. `REPOSITORY_CHANGED` correctly refuses
    that.
  - Mocked deletes. D012 forbids them.

## R17. Version derived from `package.json`

- **Decision**: `android/app/build.gradle` reads `package.json` with `groovy.json.JsonSlurper` at
  configuration time and sets:
  - `versionName` = the `version` string;
  - `versionCode` = `major * 10000 + minor * 100 + patch`. It rejects (fails the build) a version that is
    not plain `MAJOR.MINOR.PATCH`, or a minor or patch ≥ 100.

  A Gradle task `:app:printVersion` prints `versionName=…` and `versionCode=…`. A script-contract test runs
  it and compares the output with the values it computes from `package.json` (FR-022, the "test MUST
  prove the derivation"). Release-smoke checks the installed APK the same way.
- **Rationale**: this was moved from 009 FR-004 by the 2026-10-02 analysis (constitution VI). The APK
  this feature ships is the first one meant for a real phone, and Android shows its version in app info.
  `package.json` stays the single source (Principle III).
- **Alternatives rejected**:
  - Hard-coding `versionName "0.0.1"`. That is two sources that drift.
  - A Node pre-build step that writes a properties file. It is one more generated file for the same
    result.
