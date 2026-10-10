# Feature Specification: MVP — a Usable App on a Real Device

**Feature Branch**: `006-mvp`

**Created**: 2026-10-02

**Status**: Draft

**Input**: User description: "Insert a new spec between 005 (which is already implemented) and 006, call it
MVP and make scope of that spec to get currently a usable version of the application." Prompted by two
real-device findings on 2026-10-02: a scan fails with "No repository has been set up yet. Enter the server
details on the Connect screen" although the app has no Connect screen, and adding a folder fails with
Android's "Cannot use this folder" message with no guidance in the app.

**Scope extension** (user decision, 2026-10-02): "make it part of the mvp: multiselect; safe deleting
selected files on local device; add counting total size of files on multiselect and display it at the
bottom left corner". This merges the scope of the former feature 010 (multi-select and two-phase local
deletion, roadmap slice M001/S06) into this feature; [010](../010-multiselect-local-deletion/spec.md) is
kept only as a pointer here.

**Depends on**: [002-native-cloudsync-connect](../002-native-cloudsync-connect/spec.md),
[003-local-source-selection](../003-local-source-selection/spec.md),
[004-scan-engine-matching](../004-scan-engine-matching/spec.md) and
[005-gallery-list-filtering](../005-gallery-list-filtering/spec.md) (all complete).

## Context

Features 002–005 built every part of the read-only loop: protocol clients and repository storage, folder
selection, the scan, and the gallery and list views. A person holding only the phone still cannot use it:

- The repository can only be configured through a debug-only deep link
  ([D018](../../docs/decisions/0018-debug-repository-seam.md)), which needs adb and puts the password in
  the device log. The native save, test, summary and host-key operations exist (feature 002) but have no
  screen.
- Error and empty states point at a "Connect screen" that does not exist.
- Android refuses some folders (storage root, Download) in its picker, and the app gives no hint.
- The only build that has been run on a device is the debug build, which needs a development machine
  running alongside it.

- Files can be found but not acted on: there is no way to select them, and `prepareLocalDeletion` /
  `executeLocalDeletion` still return `NOT_IMPLEMENTED`.

This feature closes those gaps and nothing more. It is the point where the app does what it exists for,
on its owner's phone with no developer tools: show which photos are not backed up yet, and safely delete
the ones that are.

## Scope

**In scope**: repository setup and editing in the app, SFTP host-key approval in the app, guidance that
leads a new user from first launch to a first scan, folder-picker guidance, multi-select in gallery and
list view with a running total size of the selection, safe two-phase deletion of selected files from the
device, and an installable build, carrying the project's version, that runs on a real device without a
development machine.

**Out of scope** (unchanged owners):

- Tree view and image preview, including selection inside tree view and preview —
  [009-tree-view-image-preview](../009-tree-view-image-preview/spec.md).
- The include-hidden-files setting, snapshot retention, the
  full-loop proof on API 36 and the final docs pass —
  [011-full-loop-release](../011-full-loop-release/spec.md).
- Multiple repositories, removing a repository without replacing it, and any remote write (R026).

## Clarifications

### Session 2026-10-02

- Q: Before deleting, should the app re-check the selected files on the server, or rely on the last
  scan's results? → A: Re-check. Preparing a deletion re-checks each selected backed-up file on the
  server; files that no longer match are not deleted, and without a connection nothing is deleted.
- Q: How should the installable APK be signed? → A: With a personal release key created once and kept
  outside the repository; its location and passwords come from local Gradle properties or environment
  variables, and the build stops with a clear message when they are missing.
- Q: While files are selected, how should the bottom of the screen be laid out? → A: The selection bar
  replaces the bottom tab bar while selecting, with count and size on its left and Delete on its right;
  "select all" and "clear" (✕) sit in the top bar; the tabs return when selection ends.
- Q: When deleting files leaves a folder empty, should the app remove that folder too? → A: No. Only
  the confirmed files are deleted; folders are left as they are.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Set up the backup server in the app (Priority: P1)

On a fresh install, the user opens Settings, finds a Repository section, enters the server type (FTP,
SFTP or WebDAV), address, port, user name, password and the remote folder that holds their backups, and
saves. The app checks the connection and tells them in plain words whether it worked. For an SFTP server
seen for the first time, the app shows the server's key fingerprint and asks whether to trust it.

**Why this priority**: without a repository nothing can be scanned. This is the blocker found on the
device.

**Independent Test**: on a fresh install, configure each protocol through the UI against the live test
containers and see the success state; then start a scan and see it run instead of failing with
"no repository".

**Acceptance Scenarios**:

1. **Given** no repository is saved, **When** the user opens Settings, **Then** a Repository section says
   no server is set up and offers to set one up.
2. **Given** the setup form, **When** the user enters valid details and saves, **Then** the details are
   stored, the connection is tested, and the section shows the server type, address, user, remote folder
   and a "Connected" result.
3. **Given** wrong credentials, an unreachable host or a missing remote folder, **When** the user saves,
   **Then** the app shows what went wrong and what to do, keeps what the user typed (except the password,
   which is never shown again), and the user can correct it and retry.
4. **Given** an SFTP server whose key the app has not seen, **When** the connection is tested, **Then**
   the app shows the key fingerprint and asks the user to trust or reject it; trusting completes the test,
   rejecting leaves the server untrusted and says so.
5. **Given** an SFTP server whose key has changed since it was trusted, **When** the connection is
   tested, **Then** the app warns that the key changed, shows the new fingerprint, and does not connect
   unless the user explicitly trusts the new key.
6. **Given** a saved repository, **When** the user opens the form again, **Then** every field except the
   password is filled in, and the password field says a password is stored.

---

### User Story 2 - From first launch to a first scan without help (Priority: P1)

A new user who has just installed the app is led, step by step, to a first scan: set up the server, add
at least one folder, scan. Wherever something is missing, the app says what is missing and takes the user
straight to the place where they fix it.

**Why this priority**: the device test showed that a user who meets an error referring to a screen that
does not exist is stuck. Every message must lead somewhere real.

**Independent Test**: on a fresh install, follow only what the screens say until results appear in the
Files tab.

**Acceptance Scenarios**:

1. **Given** no repository and no folders, **When** the user opens the Scan tab, **Then** it lists what
   is still needed (server, folders), and each item opens the place where it is set up.
2. **Given** a scan that fails because no repository is saved, **When** the error is shown, **Then** it
   names the place where the server is set up and offers to go there; no message refers to a
   "Connect screen" or any other screen that does not exist.
3. **Given** no completed scan, **When** the user opens the Files tab, **Then** it explains that results
   appear after a scan and offers to go to the Scan tab.
4. **Given** a repository whose stored password can no longer be read (for example after the device's
   security settings changed), **When** a scan or test is attempted, **Then** the app asks the user to
   re-enter the password in the repository form.

---

### User Story 3 - Pick folders Android allows (Priority: P2)

When adding a folder, the user is told before the picker opens that Android does not allow the top level
of the storage or the Download folder, and that folders such as DCIM or Pictures work. The picker opens in
a folder where photos are usually kept.

**Why this priority**: the system's refusal ("Cannot use this folder") cannot be changed by the app, but
without a hint the user cannot tell whether the app is broken.

**Independent Test**: add a folder on a device or emulator with Android 11 or later and check the hint
and the picker's starting folder.

**Acceptance Scenarios**:

1. **Given** the Folders section, **When** the user is about to add a folder, **Then** a short hint names
   the folders Android refuses and suggests ones that work.
2. **Given** a new folder is being added (not a re-grant), **When** the picker opens, **Then** it starts
   in the device's camera folder, or in shared storage when that folder does not exist.
3. **Given** a re-grant of an existing folder, **When** the picker opens, **Then** it still starts at
   that folder (feature 003 behaviour, unchanged).

---

### User Story 4 - Install and run without a development machine (Priority: P1)

The user installs one APK file on their own phone and the app runs on its own: no computer attached, no
development server, no debug-only links in the build.

**Why this priority**: a build that only works next to a developer's computer is not usable by its owner.

**Independent Test**: build the installable APK, install it on a device or emulator with no development
server running, and complete Stories 1 and 2.

**Acceptance Scenarios**:

1. **Given** the installable APK, **When** it is installed on Android 12 (API 31) or later and launched
   with no computer connected, **Then** the app starts and works.
2. **Given** the installable APK, **When** its contents are checked, **Then** the debug-only deep links
   (repository setup, grant release) are not present.
3. **Given** a developer following `DEVELOPMENT.md`, **When** they build the installable APK, **Then** one
   documented command produces it, signed with their personal release key, and the key and its
   passwords are never committed to the repository.
4. **Given** the personal release key is not set up, **When** the installable APK is built, **Then** the
   build stops with a message saying how to set it up; it never falls back to the debug key.
5. **Given** an installed APK, **When** a later build signed with the same key is installed, **Then** it
   updates in place and the saved server, folders and scan results are kept.
6. **Given** the installed APK, **When** its version is checked (Android's app info), **Then** it equals
   the project's version.

---

### User Story 5 - Select files and see how much space they take (Priority: P1)

In gallery or list view, the user long-presses a file to start selecting, then taps more files to add or
remove them. While anything is selected, a selection bar takes the place of the bottom tabs: its
bottom-left corner shows how many files are selected and their total size (for example "37 selected ·
1.2 GB"), updating with every tap, and its right side holds Delete. The top bar holds "select all" and
"clear" (✕). The user can select every file the current view shows (current filter, and current folder
in list view) in one action, and clear the selection in one action.

**Why this priority**: deleting is done on many files at once, and the size tells the user how much space
a clean-up will free before they commit to it.

**Independent Test**: after a scan of the test fixtures, select files in gallery and in list view and
compare the shown count and total with the fixture sizes.

**Acceptance Scenarios**:

1. **Given** gallery or list view with no selection, **When** the user long-presses a file, **Then**
   selection mode starts with that file selected, the selection bar replaces the bottom tabs, and the
   top bar shows "select all" and "clear".
2. **Given** selection mode, **When** the user taps a file, **Then** it is added or removed, its selected
   state is visible on the tile or row (not by colour alone), and the count and total size in the
   bottom-left corner update immediately.
3. **Given** selection mode, **When** the user chooses "select all", **Then** every file matching the
   current filter (in the current folder, in list view) is selected, including ones not yet scrolled into
   view, and the count and total cover all of them.
4. **Given** a selection, **When** the user switches between gallery and list view or changes the filter,
   **Then** the selection is kept; files hidden by the new filter stay selected and remain counted, and
   the bar says how many selected files are hidden by the current filter.
5. **Given** selected files whose size is not known, **When** the total is shown, **Then** it counts the
   known sizes and says how many files have an unknown size, instead of treating them as zero silently.
6. **Given** a selection, **When** the user clears it or presses back, **Then** selection mode ends and
   the bottom tabs return in place of the selection bar.
7. **Given** directories in list view, **When** the user is in selection mode, **Then** directories
   cannot be selected; tapping one still opens it, and the selection is kept.

---

### User Story 6 - Safely delete selected files from the device (Priority: P1)

With files selected, the user taps Delete. Before anything is removed, the app shows what will happen:
how many selected files are backed up and will be deleted, how many are not backed up (and are only
deleted after a stronger, explicit warning), and how many have an unknown backup state and will never be
deleted. It also shows the total size that will be freed and how old the server listing is. The user
confirms, the files are removed from the phone only, and the app reports the outcome per file.

**Why this priority**: this is what the app exists for: clearing space by deleting photos that are
safely on the server, without ever losing one that is not.

**Independent Test**: a Maestro flow that deletes real files from real device storage after a scan
against a live container, and checks that unknown-state files survive. A mocked delete does not count
([D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md)).

**Acceptance Scenarios**:

1. **Given** a selection, **When** the user taps Delete, **Then** the app re-checks every selected
   backed-up file on the server, showing progress, and then a confirmation shows the number and total
   size of backed-up files to delete, the number of not-backed-up files, the number of unknown-state
   files that will be refused, and the age of the scan, before anything is deleted.
2. **Given** a selection with only backed-up files, **When** the user confirms, **Then** those files are
   removed from device storage and disappear from the results without a new scan.
3. **Given** a selection that includes not-backed-up files, **When** the confirmation is shown, **Then**
   they are excluded by default; the user can include them only by explicitly acknowledging a stronger
   warning that those files exist nowhere else.
4. **Given** a selection that includes unknown-state files, **When** the user confirms, **Then** those
   files are never deleted, whatever the user chooses, and the confirmation says so
   ([D006](../../docs/decisions/0006-unknown-status-never-deletable.md)).
5. **Given** a confirmed deletion, **When** it finishes, **Then** the app shows how many files were
   deleted, how much space was freed, and lists each file that could not be deleted with the reason.
6. **Given** files that changed between the confirmation and the deletion (already gone, modified, folder
   access lost), **When** the deletion runs, **Then** each such file is reported individually and the
   rest are still deleted; the results never show a file as deleted that is still on the device.
7. **Given** a selected backed-up file whose server copy has since been removed or changed, **When** the
   re-check runs, **Then** that file is moved out of "to delete" (to not backed up, or to unknown when
   the server could not answer for it), the confirmation says how many files the re-check moved, and the
   file is not deleted unless the not-backed-up rules allow it.
8. **Given** the server cannot be reached or the re-check fails as a whole, **When** the user taps
   Delete, **Then** nothing is deleted, and the app says the server must be reachable to delete and
   offers to retry.
9. **Given** a scan older than the staleness threshold, **When** the confirmation is shown, **Then** it
   still shows the scan's age and suggests a new scan, because the re-check covers only the selected
   files.
10. **Given** any deletion, **When** it runs, **Then** nothing on the server is changed (R026); the
   re-check only reads file information, never file contents.

### Edge Cases

- **Saving while a scan runs**: changing the repository during a scan is not allowed; the form says a scan
  is running and saving becomes possible when it ends.
- **Repository changed after a scan**: results from a previous scan stay visible, and the Scan tab says
  they were made against the previous server settings and a new scan is recommended.
- **Same server, new folder**: when only the remote folder or port changes for the same server and user,
  the stored password is kept and need not be retyped (existing feature 002 rule). A different server or
  user always needs a password.
- **Empty or invalid fields**: the form marks the field and does not save; port must be a number in the
  valid range and defaults to the protocol's standard port when left empty.
- **Leaving the form**: leaving with unsaved changes asks whether to discard them.
- **Password handling**: the password is never displayed after saving, never written to the device log,
  and never sent anywhere except to the configured server.
- **Slow or hanging server**: the connection check shows progress and ends with a timeout message instead
  of waiting forever.
- **App sent to background during setup**: what the user typed (except the password) is still there when
  they come back.
- **Selection and a new snapshot**: when a scan or app-open refresh replaces the results while files are
  selected, the selection is cleared and the user is told why, because the selected entries belong to the
  old results.
- **Very large selection**: "select all" over thousands of files stays responsive, and its count and
  total are exact, not estimated from loaded pages.
- **Server settings changed after the scan**: deleting is refused, and the app asks for a new scan
  first, because the results were matched against the previous server.
- **Stale confirmation**: if the results change between opening the confirmation and confirming, the
  deletion does not run on the old plan; the user is asked to review again.
- **Nothing deletable**: a selection with only unknown-state files shows why nothing can be deleted and
  offers no Delete confirmation.
- **Folder left empty**: a folder whose files were all deleted stays on the device and in the results,
  showing 0 files; the app does not remove it.
- **Deletion interrupted** (app closed, process killed): files already deleted stay deleted and are
  reflected in the results the next time the app opens; nothing is reported as deleted that is not.
- **Scan running**: deleting is blocked while a scan is running, and a scan cannot start while a deletion
  runs.
- **Size display**: sizes follow the device's locale and the units Android's own storage screens use
  (decimal KB, MB, GB) with at most one decimal place; a selection of zero known bytes shows "0 B".

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Settings MUST contain a Repository section that shows the saved server (type, address,
  port, user, remote folder, and whether a password is stored) or states that none is set up.
- **FR-002**: Users MUST be able to create and edit the repository through a form with: server type
  (FTP, SFTP, WebDAV), address, port, user name, password and remote folder.
- **FR-003**: Saving MUST store the details and then test the connection, showing either success
  (including the number of entries found in the remote folder) or a failure with its cause and a
  suggested action.
- **FR-004**: For SFTP, the app MUST show the server key fingerprint and let the user trust or reject it
  when the key is unknown, and MUST warn clearly and require explicit trust when the key has changed.
- **FR-005**: The password MUST never be displayed after saving, never prefilled in plain text, and never
  logged; editing a saved repository MUST show that a password is stored without revealing it.
- **FR-006**: Every user-facing message that tells the user to set up or fix something MUST name a place
  that exists in the app and, where the screen allows it, offer to go there. No message may refer to a
  "Connect screen".
- **FR-007**: The Scan tab MUST show what is still missing before a scan can run (repository, folders)
  with a way to reach each, and MUST not offer a scan that is certain to fail for that reason.
- **FR-008**: The Files tab MUST explain what to do when no scan has completed yet.
- **FR-009**: The Folders section MUST explain, before the picker opens, which folders Android refuses
  and suggest folders that work; the picker MUST start in the camera folder when adding a new folder.
- **FR-010**: The Scan tab MUST indicate when the shown results were made with different repository
  settings than the ones now saved.
- **FR-011**: Changing the repository MUST be blocked while a scan is running.
- **FR-012**: There MUST be an installable APK that runs on a real device with Android 12 (API 31) or
  later without a development machine, built by one documented command, with debug-only seams excluded.
  It MUST be signed with the developer's personal release key, created once as `DEVELOPMENT.md` documents
  and kept outside the repository; the key's location and passwords come from local Gradle properties or
  environment variables, never from committed files. When they are missing, the build MUST fail with a
  message explaining the setup, and MUST NOT fall back to the debug key.
- **FR-013** (constitution V): Maestro flows MUST prove, against the live FTP, SFTP and WebDAV test
  containers on API 31 and API 36 (the levels `pnpm e2e:android` runs), that the repository can be set up through the UI (including SFTP key approval) and
  that a scan then runs; the existing scan flows MAY switch from the debug seam to the UI where that keeps
  them simple. The debug seam (D018) stays available for flows that need it. A Maestro flow MUST also
  prove selection with its count and total size, and deletion of real files from real device storage,
  including that unknown-state files survive (FR-018, FR-019).
- **FR-014** (constitution VII–IX): `README.md` MUST describe installing the APK, the first-run steps and
  safe deletion in user terms; `./docs` and `DEVELOPMENT.md` MUST describe the repository screen,
  selection and deletion, and the APK build.
- **FR-015** (R012, multi-select): Users MUST be able to select multiple files in gallery and list view:
  long-press starts selection, tap toggles a file, "select all" selects every file matching the current view
  (filter, and folder in list view), and "clear" or back ends selection; "select all" and "clear" sit in the
  top bar. Directories are never selectable. The selection is kept across switching view and filter, and
  cleared, with a notice, when the results are replaced by a new snapshot.
- **FR-016** (selection size and layout): While files are selected, a selection bar MUST replace the
  bottom tab bar (so the user cannot switch tabs mid-selection), with Delete on its right and, in its
  bottom-left corner, the number of selected files and their total size, updated on every change. Files
  without a known size MUST be reported as a separate count, never silently counted as zero. The count
  and total MUST be exact for "select all", including files not loaded on screen.
- **FR-017** (selection accessibility): The selected state MUST be shown by more than colour (for example
  a check mark) and announced by screen readers, following the feature 005 accessibility-label convention
  (R021).
- **FR-018** (R012, R013, safe deletion): Deleting MUST be two-phase
  ([D008](../../docs/decisions/0008-two-phase-local-deletion.md)): first a plan with an honest breakdown of
  the selection (backed-up files to delete with their total size, not-backed-up files, unknown-state files
  refused) and the server listing's age (R015), then execution of exactly that confirmed plan. A plan whose
  underlying results changed MUST NOT be executed.
- **FR-018a** (pre-delete server re-check): Preparing a plan MUST re-check, on the server, every selected
  file the scan classed as backed up: it stays "to delete" only if the server file it was matched to is
  still present with the same name, size and modification time (within the repository's timestamp
  precision). A file whose server copy is gone or different MUST move to not backed up; a file the server
  could not answer for MUST move to unknown. If the server cannot be reached, no plan is made and nothing
  is deleted. The re-check reads file information only and changes nothing on the server (R026).
- **FR-019** (R012, deletion rules): Backed-up (SYNCED) files are deleted by default; not-backed-up
  (UNSYNCED) files are excluded unless the user explicitly acknowledges a stronger warning; unknown-state
  (UNKNOWN) files MUST never be deleted ([D006](../../docs/decisions/0006-unknown-status-never-deletable.md)).
  Only files on the device are deleted; nothing on the server is ever changed (R026).
- **FR-020** (R013, outcomes): Deletion MUST report the outcome per file (deleted, already gone, changed
  since the scan, access lost, failed), keep going past individual failures, and show the number deleted, the space freed and
  each failure. The results MUST reflect only deletions that actually happened, without a new scan.
- **FR-020a** (files only): Deletion MUST remove only the confirmed files. It MUST NOT remove any folder,
  including folders that become empty, and never a folder added as a source.
- **FR-021**: Deleting MUST be blocked while a scan runs, and a scan MUST not start while a deletion runs.
  Only one deletion (review or execution) can run at a time.
- **FR-022** (constitution VI, moved from feature 011 FR-004): The APK's `versionName` and `versionCode`
  MUST be derived from the `package.json` version, the single authoritative version source, and a test
  MUST prove the derivation. The installable APK is the first build meant for a real device, so it must
  carry the project's real version.

### Key Entities

- **Repository**: the one backup server the app compares against: server type, address, port, user,
  remote folder, a stored password (held in secure storage, never shown) and, for SFTP, the trusted server
  key. Already persisted by feature 002; this feature gives it a screen.
- **Setup checklist**: the derived state "repository set up? at least one folder available?" that the Scan
  and Files tabs use to guide a new user. Computed, never stored.
- **Installable APK**: the self-contained build the user installs on their phone.
- **Selection**: the set of selected files in the current results, independent of view and filter, with
  its count, total known size and count of files of unknown size. It belongs to one snapshot.
- **Deletion plan**: the confirmed breakdown of a selection (to delete, not backed up, refused) with the
  total size to free and the listing age, tied to exactly the results it was made from (D008).
- **Deletion outcome**: per-file result of executing a plan; only real successes change the results
  (`local_deletion_overlay`, already in the schema since feature 002).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A person with the APK, a phone and their server details reaches scan results on a fresh
  install without a computer, adb or outside help, in under 5 minutes excluding scan time.
- **SC-002**: Setting up each of FTP, SFTP and WebDAV through the screen succeeds against the live test
  containers, proven by Maestro flows on API 31.
- **SC-003**: No user-facing text in the app refers to a screen that does not exist (zero occurrences of
  "Connect screen" in user-visible strings).
- **SC-004**: The installable APK installs and launches on a device or emulator with no development
  server running, and contains no `syncscope-debug://` handlers.
- **SC-005**: The password never appears on screen after saving and never in the device log during setup,
  test or scan.
- **SC-006**: For any selection of the test fixtures, the count and total size shown in the bottom-left
  corner equal the fixtures' actual count and summed size, including after "select all".
- **SC-007**: The Maestro deletion flow removes real backed-up files from real device storage, and every
  unknown-state file in the selection is still on the device afterwards.
- **SC-008**: Zero files are deleted that the confirmation did not list as "to delete", and the results
  never show as deleted a file that is still on the device.
- **SC-009**: A user can free space by deleting all backed-up photos of one folder in under 1 minute
  after a scan, using "select all" with the "synced" filter.
- **SC-010**: A file whose server copy is removed after the scan is never deleted from the device, proven
  by a Maestro flow against a live container; with the server unreachable, a deletion attempt deletes zero
  files.
- **SC-011**: The installed APK reports the same version as `package.json`.

## Assumptions

- One repository per install, as in features 002–004; replacing it is the only way to change servers.
- One personal release key signs every installable build from now on, so later builds (including
  feature 011's) update in place; losing the key means uninstalling, which deletes the app's data. Play
  Store distribution, CI and signing pipelines stay out of scope (R019 notes).
- Scans still run with hidden files excluded; the setting stays with feature 011.
- API 31 is this feature's proof level, as in features 002–005; API 36 is proven in feature 011.
- The camera folder (DCIM) is the most likely place for the photos the user wants to check.
- Deletion through the Storage Access Framework is permanent; Android offers no recycle bin for it. The
  confirmation says so.
- A deletion keeps running if the app goes to the background (unlike a scan, which is cancelled), and
  every batch it has already recorded stays recorded. It touches only folders the user granted with write access; a folder
  granted read-only reports its files as "access lost" per file.
- The staleness threshold for the server listing is the one feature 004 already uses for the freshness
  notice (R015, [D009](../../docs/decisions/0009-foreground-scan-and-freshness.md)).
- Selection in tree view and in the image preview arrives with feature 009, which reuses this feature's
  selection model and bar.

## Provides

To [009-tree-view-image-preview](../009-tree-view-image-preview/spec.md) and
[011-full-loop-release](../011-full-loop-release/spec.md):

- A Connect (repository) screen, so 011's full-loop flow can drive "connect" through the UI as its spec
  describes.
- The setup checklist and the "go to where it is fixed" message convention for later error states.
- The installable APK build command with version derivation, which 011 extends with its API 36 full-loop
  proof.
- The view-agnostic selection model and selection bar (count and total size), which 009 extends to tree
  view and preview.
- Real `prepareLocalDeletion` and `executeLocalDeletion` with per-file outcomes, and a Maestro flow that
  deletes real files, which 011's full-loop flow reuses.
