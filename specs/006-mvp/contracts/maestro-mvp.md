# Contract: MVP end-to-end flows

Follows the conventions of features 003–005 (`DEVELOPMENT.md` › End-to-end flows is authoritative). The
flows live in `validation/maestro/mvp/` and run after `browse/` on API 31 and API 36 (the levels `pnpm e2e:android` runs) against the live FTP, SFTP and
WebDAV containers (D012, FR-013). Each flow is added to `validation/maestro/config.yaml` by the task that
creates it, never before the file exists.

Repository setup in these flows goes **through the UI**. The other directories keep the D018 seam, so the
seam stays.

## Fixtures

New device sources, seeded by `scripts/validation/device-fixtures.sh` with the same bytes and modified
times as the remote copies (the existing Gallery technique, 005 research R13):

| Device source | Contents | Used by |
| --- | --- | --- |
| `SyncScopeE2E/Delete` | a copy of `Gallery` (`sunset.png`, `beach.png`, `album/forest.png`, `harbor.png`, `album/notes.txt`, `drafts/draft.png`) | 05 |
| `SyncScopeE2E/Recheck` | a copy of `Gallery` | 06 |
| `SyncScopeE2E/Offline` | a copy of `Gallery` | 07 |
| `SyncScopeE2E/Select` | a copy of `Gallery` | 04 |
| `SyncScopeE2E/Changed` | a copy of `Gallery` | 08 |

New remote root `recheck/` is a copy of `gallery/` that `fixture-seed.sh` re-creates on every run, because
flow 06 mutates it. Expected sizes come from `fixture-manifest.sh`, and `android-flow.sh` passes the
formatted values to Maestro as `-e` variables (`SIZE_SYNCED_3`, `SIZE_IMAGES_5`, …). The flows never
hard-code byte counts.

## Runner additions (`scripts/validation/android-flow.sh`)

- **Staged pairs.** A flow that changes server state mid-scenario is split into parts a and b. Both
  live in `validation/maestro/staged/`, which `config.yaml` does not list, so the workspace run skips
  them. After the workspace run, the runner reads `validation/maestro/staged/pairs.txt`. Each line is an
  alternating sequence `<flow>|<hook and args>|<flow>[|<hook>|<flow>…]`, and the runner runs each flow
  with `maestro test` and each host hook between them. Only the first flow of a line starts from
  `clearState`. Hooks live in `scripts/validation/hooks/`:
  - `remove-recheck-file.sh` deletes `$SYNCSCOPE_STATE_ROOT/fixtures/recheck/beach.png` on the host. The
    tree is bind-mounted read-only into every container, so the servers see the removal at once.
  - `change-device-files.sh` (device side, through `adb -s "$ANDROID_SERIAL"`, which the runner exports)
    deletes `/sdcard/SyncScopeE2E/Changed/beach.png` and sets a new mtime on
    `/sdcard/SyncScopeE2E/Changed/sunset.png` with `touch -d @1704153600`.
  - `pause-service.sh <protocol>` and `resume-service.sh <protocol>` run `docker compose pause` /
    `unpause` on that service. The runner registers resume in its `trap`, so it always runs.
- **`release-smoke`** mode:
  1. Runs `pnpm assemble:release` with no `SYNCSCOPE_RELEASE_*` properties and asserts it fails with the
     "Release signing is not configured" message (Story 4 sc. 4).
  2. Generates a throwaway keystore in `mktemp -d` and builds with `pnpm assemble:release`, the documented
     command (sc. 3), through `ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_*`.
  3. Asserts that `aapt2 dump badging` reports `versionName` and `versionCode` derived from
     `package.json` (FR-022, sc. 6).
  4. Installs the APK with Metro stopped.
  5. Asserts that `adb shell am start -W -a android.intent.action.VIEW -d
     'syncscope-debug://configure-repository'` reports no resolvable activity.
  6. Runs `mvp/90-release-smoke.yaml`.
  7. Re-installs the same APK with `adb install -r` (an in-place update with the same key) and runs
     `mvp/91-release-update.yaml` (sc. 5).
  8. Deletes the keystore.

## Selectors (new)

Every control is tapped by its accessibility label (FR-017, 005 convention).

| Element | Label |
| --- | --- |
| Settings section | `Repository not set up`; `Repository <PROTOCOL> <host>` (summary) |
| Buttons | `Set up repository`, `Edit repository` |
| Form fields | `Protocol FTP`, `Protocol SFTP`, `Protocol WebDAV`, `Host`, `Port`, `User name`, `Password`, `Remote folder`, `Use HTTPS` |
| Form actions and status | `Save and test`; `Connected, <n> entries`; `Connection failed: <message>`; `Unencrypted connection warning` |
| Host-key dialog | `Server key fingerprint <fp>`, `Trust server key`, `Trust new key`, `Reject server key`, `Server key changed warning` |
| Discard dialog | `Discard changes`, `Keep editing` |
| Checklist (Scan tab) | `Before you can scan`, `Set up the server`, `Add a folder`, `Scan` (disabled state asserted) |
| Old-settings notice | `Results from previous server settings` |
| Files empty state | `No scan results yet`, `Go to Scan` |
| Folders hint | `Folder picker hint` |
| Selection | tile or row label + `, selected`; `Clear selection`; `Select all`; `Selection <n> selected, <size>`; `Selection details <text>`; `Delete selected` |
| Confirmation | `Checking files on the server`; `Delete <n> backed-up files, <size>`; `Not backed up <n>`; `Never deleted <n>`; `Moved by server check <n>`; `Scan age <text>`; `Also delete files that are not backed up`; `Confirm not backed up`; `Delete`; `Cancel` |
| Result | `Deleted <n> files, freed <size>`; `Could not delete <name>: <reason>` |
| Errors with a target | `Go there` |

## Acceptance scenario mapping

| Spec item | Flow | Setup | Asserts |
| --- | --- | --- | --- |
| Story 1 sc. 1–2, 6; FR-001–003; SC-002 (FTP) | `01-setup-ftp.yaml` | clearState | `Repository not set up` → form → FTP, host `10.0.2.2`, container port, user and password from `-e`, root `gallery` → `Unencrypted connection warning` visible → `Save and test` → `Connected, <n> entries`. Back in Settings, `Repository FTP 10.0.2.2`. `Edit repository` shows every field prefilled and `Password` empty with "A password is stored" |
| Story 1 sc. 2, 4; FR-004; SC-002 (SFTP) | `01-setup-sftp.yaml` | clearState | Same steps with SFTP → `Server key fingerprint` → `Trust server key` → `Connected` |
| Story 1 sc. 2; SC-002 (WebDAV) | `01-setup-webdav.yaml` | clearState | WebDAV with `Use HTTPS` off → warning → `Connected` |
| Story 1 sc. 3; FR-003 | `02-setup-errors.yaml` | clearState | Wrong password → `Connection failed:` with the AUTH_FAILED message; host and user still filled, password empty; fix the password → `Connected`. Edit the host, then back → `Discard changes` dialog |
| Story 1 sc. 5 (changed key) | JVM + Jest (plan.md Complexity Tracking deviation) | — | Rotating the SFTP container's key breaks every later SFTP flow. `TofuHostKeyVerifierTest` (exists) proves detection, and the `useRepository` and `HostKeyDialog` tests prove the warning dialog and the second confirmation |
| Story 2 sc. 1–3; FR-006–008; SC-003 | `03-first-run.yaml` | clearState | Scan tab: `Before you can scan`, `Set up the server`, `Add a folder`, `Scan` disabled. Files tab: `No scan results yet` → `Go to Scan`. `Set up the server` → form (WebDAV) → `Connected`; `Add a folder` → picker (the `pick-folder` subflow) → Scan enabled → scan → results in Files |
| Story 3 sc. 1–2; FR-009 | `03-first-run.yaml` | as above | `Folder picker hint` visible; the picker's title shows `DCIM` when it opens (asserted on the DocumentsUI header) |
| Story 3 sc. 3 | `sources/06-regrant.yaml` (extended) | as in feature 003 | When the re-grant picker opens, the DocumentsUI header shows the source's folder name, not `DCIM` |
| Story 5 sc. 1–4, 6; FR-015–017; SC-006 | `04-select-size.yaml` | seam: SFTP, root `gallery`; source Select; scan | Gallery: long-press `beach.png, Synced` → `beach.png, Synced, selected`, tabs hidden, `Selection 1 selected, ${SIZE_BEACH}`. Tap `sunset.png` → `2 selected, ${SIZE_SYNC_2}`. `Select all` (gallery: the 5 images) → `Selection 5 selected, ${SIZE_IMAGES_5}`. Filter Synced → `Selection details 2 hidden by filter`. List view → `drafts` folder opens and the selection is kept. Back → selection cleared, tabs visible |
| Story 6 sc. 1–5, 10; FR-018–020a; SC-007, SC-008 | `05-delete-synced.yaml` | seam: SFTP, root `gallery-partial`; source Delete; scan | List view, Delete source → `Select all` in the source root, then in `album`, then in `drafts` (6 files) → `Delete selected` → `Checking files on the server` → `Delete 3 backed-up files, ${SIZE_SYNCED_3}`, `Never deleted 3` → `Delete` → `Deleted 3 files, freed ${SIZE_SYNCED_3}`. The files disappear from the list; `album` folder still present (FR-020a). A follow-up `Rescan from scratch` shows `harbor.png`, `notes.txt`, `draft.png` still Unknown and no `beach.png`, `sunset.png`, `forest.png`, which proves real device deletion (D012) |
| Story 6 sc. 3 (unsynced opt-in) | `05-delete-synced.yaml` (second half) | edit the root to `gallery` in the form, `Rescan from scratch` (the remaining `harbor.png`, `notes.txt`, `draft.png` are now Unsynced) | Select `harbor.png, Unsynced` → confirmation shows `Delete 0 backed-up files`, `Not backed up 1`, and `Delete` is disabled. `Also delete files that are not backed up` → `Confirm not backed up` → `Delete` → `Deleted 1 files`; `notes.txt` and `draft.png` remain |
| Story 6 sc. 7; FR-018a; SC-010 | `staged/06-recheck-removed-a.yaml` / `-b.yaml`, hook `remove-recheck-file.sh` | seam: SFTP, root `recheck`; source Recheck; scan (part a) | Part b: select `beach.png`, `sunset.png` (both Synced) → `Delete selected` → `Moved by server check 1`, `Delete 1 backed-up files` → `Delete` → `Deleted 1 files`; `beach.png` is still listed after a rescan, now Unsynced |
| Story 6 sc. 8; FR-018a; SC-010 | `staged/07-delete-offline-a.yaml` → `pause-service.sh sftp` → `-b.yaml` → `resume-service.sh sftp` → `-c.yaml` | seam: SFTP, root `gallery`; source Offline; scan | Part b: select `beach.png` → `Delete selected` → error with the CONNECTION_* message and `Retry`; no confirmation appears. Part c (after resume): a rescan still lists `beach.png, Synced`, so zero files were deleted |
| Story 4 sc. 1–2; FR-012; SC-004 | `90-release-smoke.yaml` (release-smoke mode) | release APK, no Metro | App launches → Settings → set up SFTP through the form → `Connected` → add folder → scan → results in Files |
| Story 4 sc. 3, 4, 6; FR-012, FR-022; SC-011 | release-smoke runner steps 1–3 | release build | The build without properties fails with the documented message; `pnpm assemble:release` builds; `aapt2` version equals `package.json` |
| Story 4 sc. 5 | `91-release-update.yaml` (release-smoke step 7) | the same APK re-installed with `adb install -r` | Settings shows `Repository SFTP 10.0.2.2`; Files still shows the results without a new scan |
| Story 6 sc. 6; FR-020 | `staged/08-changed-a.yaml` → `change-device-files.sh` → `staged/08-changed-b.yaml` | seam: SFTP, root `gallery`; source Changed; scan | Part a: select `beach.png` and `sunset.png` (both Synced) → `Delete selected` → confirmation `Delete 2 backed-up files` and stops with the dialog open. Part b (no `launchApp`, no `clearState`): `Delete` → `Deleted 0 files`, `Could not delete beach.png: Already gone`, `Could not delete sunset.png: Changed since the scan`; `sunset.png` is still on the device after a rescan |
| Story 2 sc. 4 | JVM + Jest (plan.md Complexity Tracking deviation) | — | Keystore invalidation cannot be triggered from a test. The `RepositoryOperationsTest` `CREDENTIAL_UNAVAILABLE` case and the `useSetupChecklist` / `fixTargets` tests prove the message and the route to the form |
| Story 5 sc. 5 | JVM + Jest (deviation) | — | SAF reports a size for every fixture file. The `selectionSummary`, `SelectionBar` and `SnapshotStoreTest` (`-1` size) tests prove the separate unknown-size count |
| Story 6 sc. 9 | Jest (deviation) | — | The device clock cannot be moved safely mid-suite. The `DeleteFlow` test proves the staleness hint for a listing older than `STALE_REMOTE_LISTING_MILLIS` |
| FR-021 | JVM | — | `ScanCoordinatorTest`: `runExclusive` refuses during a run and during another exclusive block, and `start` refuses during an exclusive block. A Maestro flow cannot time a scan and a deletion together deterministically |

Re-check grouping, the 16-directory cap, `SCAN_TOO_OLD`, `CHANGED` and `ALREADY_GONE` at execute, plan
expiry and staleness, count decrements and the size formatting are proven by JVM and Jest tests (see
plan.md, Constitution Check IV).
