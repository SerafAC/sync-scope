# Overview

SyncScope is an Android app that tells you which of your local files are already backed up to your cloud,
so you can safely delete them from the device.

You point it at one remote repository over FTP, SFTP or WebDAV with a username and password, select local
folders from on-device and removable storage, and scan. Each local file comes back marked SYNCED, UNSYNCED
or UNKNOWN. You browse the results in a gallery grid, a browsable list or a browsable tree, filter to just
the synced set, multi-select, and delete locally.

The app never writes to the cloud. It never uploads, never deletes remotely and never downloads remote file
content. Its only mutating action is deleting local files (R026).

## Core value

**Knowing, with honest confidence, which local files are safe to delete.**

In the user's own words: *"this app is to discover files that are sync and can be safely deleted."* Sync
status is a deletion-safety signal, not a backup dashboard. Everything else — three views, filtering,
preview, aesthetics — exists to serve that decision. If scope must shrink, the thing that survives is a
trustworthy SYNCED / UNSYNCED / UNKNOWN verdict plus a safe way to act on it.

The corollary matters as much as the value itself: the app must never make a partial or stale result look
like a clean one. See [sync and deletion safety](./sync-and-deletion-safety.md).

## The user loop

1. **Connect** to one remote repository over FTP, SFTP or WebDAV with a username and password (R001), in
   **Settings › Repository**, and name one or more folders on it that hold the backup, typed or picked
   with **Browse** ([D022](./decisions/0022-several-remote-folders-partial-scan.md)). SFTP host keys are trusted on first use, after the user checks the
   fingerprint (R002). WebDAV can use HTTPS. A setup checklist on the Scan tab leads a new user to this
   step and the next.
2. **Pick folders** on device or removable storage through the Storage Access Framework (R005), in
   **Settings › Device folders**. Android refuses the top level of the storage and the Download folder;
   the app says so, the picker starts in DCIM, and the hint explains that a folder with thousands of
   files can look empty for a while in the picker.
3. **Scan** in the foreground, with visible progress and cancellation (R006).
4. **Browse and filter** the results on the **Files** tab in gallery, list or tree view (R008, R009,
   R010), filtered to all, synced, unsynced or issues-unknown (R011), with an image preview from any view
   (R014). Each view has its own sort (name, date or size, either way) and a scrollbar that jumps through
   a long result by date, letter or size band. Gallery and list view, with the filters, are delivered by
   feature 005, their sorting and scrollbar by feature 007; tree view and preview by feature 009.
5. **Select** files, from any of the three views (R012). A selection bar shows the count and total size.
   Gallery and list view are delivered by feature 006 (MVP); tree view and preview by feature 009.
6. **Delete locally**, after the selected backed-up files are re-checked on the server and an honest
   pre-flight breakdown of what will happen (R012, R013,
   [D020](./decisions/0020-pre-delete-server-recheck.md)). Only files are deleted, never folders and never
   anything on the server.

The app ships as an APK signed with the owner's personal release key, installed directly on the phone
with no development machine ([D021](./decisions/0021-release-signing-and-cleartext-policy.md)).

Scope limits for v1 are in [scope](./scope.md).

## Glossary

| Term | Meaning |
| --- | --- |
| SYNCED | A local file with a remote file of the same name and size whose modified time falls in the same precision bucket ([D003](./decisions/0003-directory-agnostic-sync-matching.md)). It is proven backed up somewhere, and deletable by default. |
| UNSYNCED | A local file that was checked and has no matching remote file. Deletion is allowed only behind a stronger warning. |
| UNKNOWN | A local file whose remote state was never established — the remote directory was unreadable, the listing aborted mid-scan, or the timestamp precision was unusable. It carries an `issueCode` saying why, has its own filter, and is never deletable ([D006](./decisions/0006-unknown-status-never-deletable.md)). |
| Snapshot | One consistent, persisted result of a scan run. All views read one snapshot at a time; a partial run never becomes the active snapshot ([D009](./decisions/0009-foreground-scan-and-freshness.md), [D010](./decisions/0010-snapshot-paging-and-origin-badge.md)). |
| Remote folders | The folders on the remote repository that every local file is compared against, together: a file is SYNCED when a match is in any of them. There is at least one; folders never overlap (one cannot be inside another), and each is typed or picked with the server folder browser. When some but not all of them cannot be read, the scan completes and every file without a match is UNKNOWN with the reason `REMOTE_FOLDER_UNREAD` naming the folder ([D022](./decisions/0022-several-remote-folders-partial-scan.md)). Until feature 007 there was a single "remote root". |
| Source | A local folder the user selected through the Storage Access Framework, from on-device or removable storage, in **Settings › Device folders**. Sources persist across restarts. Sources never overlap: a folder that is the same as, inside, or around an existing source is rejected with a message naming that source. Each source gets an alias generated once when it is added and never edited: the folder name, extended with the volume label and then parent folder names only as far as needed to be unique (for example "Camera" and "Camera (SDCARD)"). Rules: [D016](./decisions/0016-saf-source-identity-and-availability.md). |
| Source availability | Computed each time the list is shown, never stored. **Available**: the folder can be read. **Access lost** (`GRANT_REVOKED`): Android no longer grants the app access; the user can Re-grant by picking the same folder again, or remove the source. **Storage missing** (`STORAGE_MISSING`): access is granted but the folder or its volume cannot be reached, for example because the SD card was taken out. An unavailable source stays listed rather than vanishing, and scanning (feature 004) treats it as skipped, never as empty. |
| Files tab | Where the results of the active snapshot are browsed. **Gallery** is a grid of the local images, newest first by default; **List** browses the selected sources folder by folder, with a breadcrumb back up, folders above files. One set of filter chips (All, Synced, Unsynced, Issues or unknown) applies to both, and each chip shows how many files of that view match it ([005 spec](../specs/005-gallery-list-filtering/spec.md)). A view drop-down switches between them, and a sort drop-down orders each view by name, date or size; the view and each view's sort are remembered across restarts. New results keep the file that was at the top in place ([007 spec](../specs/007-sort-scroll-remote-folders/spec.md)). |
| Sort | Name (A–Z, Z–A), date of last change (newest or oldest first) or size (largest or smallest first). Name order ignores case and accents, and names that do not start with a letter come first, under `#`. Files with an unknown date or size come last in both directions, and equal values are ordered by name. |
| Scrollbar | Shown on the right edge of gallery and list view when the result is longer than three screens. Dragging the thumb jumps anywhere in the result, also to files not read yet, and shows the band under it: a year, month or day for the date sort (whichever gives at least five bands), a letter or `#` for the name sort, a size range from the sizes shown for the size sort, and `Unknown` last. With TalkBack it steps band by band. |
| Selection | The set of files picked for deletion in the current results, kept across view and filter changes and cleared when a new snapshot replaces the results. Directories are never selectable. |
| Deletion plan | The breakdown `prepareLocalDeletion` returns after the server re-check: files to delete, not backed up, and refused. Only the confirmed plan is executed, once, within 15 minutes, on the results it was made from ([D008](./decisions/0008-two-phase-local-deletion.md)). |
| Repository | The one backup server the app compares against, set up in **Settings › Repository**: protocol, address, port, user, one or more remote folders, the password (kept in Android Keystore-backed storage, never shown again) and, for WebDAV, whether to use HTTPS. |
| Origin badge | A label on a gallery tile naming the tile's source by its alias. It appears only when a file with the same name exists in another source, because a flat grid gives no other clue which folder a photo is from ([D010](./decisions/0010-snapshot-paging-and-origin-badge.md)). |
