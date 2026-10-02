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

1. **Connect** to one remote repository over FTP, SFTP or WebDAV with a username and password (R001). SFTP
   host keys are trusted on first use (R002).
2. **Pick folders** on device or removable storage through the Storage Access Framework (R005).
3. **Scan** in the foreground, with visible progress and cancellation (R006).
4. **Browse and filter** the results on the **Files** tab in gallery, list or tree view (R008, R009,
   R010), filtered to all, synced, unsynced or issues-unknown (R011), with an image preview from any view
   (R014). Gallery and list view, with the filters, are delivered by feature 005; tree view and preview by
   feature 007.
5. **Select** files, from any of the three views (R012).
6. **Delete locally**, after an honest pre-flight breakdown of what will happen (R012, R013).

Scope limits for v1 are in [scope](./scope.md).

## Glossary

| Term | Meaning |
| --- | --- |
| SYNCED | A local file with a remote file of the same name and size whose modified time falls in the same precision bucket ([D003](./decisions/0003-directory-agnostic-sync-matching.md)). It is proven backed up somewhere, and deletable by default. |
| UNSYNCED | A local file that was checked and has no matching remote file. Deletion is allowed only behind a stronger warning. |
| UNKNOWN | A local file whose remote state was never established — the remote directory was unreadable, the listing aborted mid-scan, or the timestamp precision was unusable. It carries an `issueCode` saying why, has its own filter, and is never deletable ([D006](./decisions/0006-unknown-status-never-deletable.md)). |
| Snapshot | One consistent, persisted result of a scan run. All views read one snapshot at a time; a partial run never becomes the active snapshot ([D009](./decisions/0009-foreground-scan-and-freshness.md), [D010](./decisions/0010-snapshot-paging-and-origin-badge.md)). |
| Remote root | The single folder on the remote repository that every local file is compared against. v1 has one remote root for all selected folders. |
| Source | A local folder the user selected through the Storage Access Framework, from on-device or removable storage, in **Settings › Folders**. Sources persist across restarts. Sources never overlap: a folder that is the same as, inside, or around an existing source is rejected with a message naming that source. Each source gets an alias generated once when it is added and never edited: the folder name, extended with the volume label and then parent folder names only as far as needed to be unique (for example "Camera" and "Camera (SDCARD)"). Rules: [D016](./decisions/0016-saf-source-identity-and-availability.md). |
| Source availability | Computed each time the list is shown, never stored. **Available**: the folder can be read. **Access lost** (`GRANT_REVOKED`): Android no longer grants the app access; the user can Re-grant by picking the same folder again, or remove the source. **Storage missing** (`STORAGE_MISSING`): access is granted but the folder or its volume cannot be reached, for example because the SD card was taken out. An unavailable source stays listed rather than vanishing, and scanning (feature 004) treats it as skipped, never as empty. |
| Files tab | Where the results of the active snapshot are browsed. **Gallery** is a grid of the local images, newest first; **List** browses the selected sources folder by folder, with a breadcrumb back up. One set of filter chips (All, Synced, Unsynced, Issues or unknown) applies to both, and each chip shows how many files of that view match it ([005 spec](../specs/005-gallery-list-filtering/spec.md)). |
| Origin badge | A label on a gallery tile naming the tile's source by its alias. It appears only when a file with the same name exists in another source, because a flat grid gives no other clue which folder a photo is from ([D010](./decisions/0010-snapshot-paging-and-origin-badge.md)). |
