# D023: How does the automatic refresh find files the sync app has uploaded since the scan?

- **Status**: Accepted
- **Date / context**: 2026-10-28, feature 009 (tree view, image and video preview), spec clarification 1
  and FR-003, research R5
- **Scope**: architecture
- **Made by**: human (re-check not-backed-up files on the existing automatic refresh, without a full
  relisting, clarification 1); agent (which server folders are listed, the caps and the merge, R5)
- **Revisable**: Yes, the choice of folders. If a tree of server files (`remote_node`) or a device-to-server
  folder mapping (R024) is added later, the candidate folders can come from there and the neighbour-folder
  limitation goes away. The rules that the re-check only lists, never demotes and never fails the refresh
  are not revisable for v1.
- **Amends**: [D020](./0020-pre-delete-server-recheck.md), its rejected alternative "Re-checking UNSYNCED
  files to promote them"

## Context

The app-open refresh (`LOCAL_REFRESH`, [D009](./0009-foreground-scan-and-freshness.md)) re-reads the device
and copies the last full scan's server keys. It never connected. A photo taken after the scan, and
uploaded by the user's sync app a minute later, therefore stayed "Not backed up" until the next manual full
scan, which on a large backup takes minutes. Clarification 1 asked for the automatic refresh to re-check
those files, and ruled out a full relisting of the server.

Matching ignores directories ([D003](./0003-directory-agnostic-sync-matching.md)): a device file is backed
up when a file with the same match key exists anywhere under the configured server folders. So there is no
single server folder where an unsynced file "should" be, and FTP, SFTP and WebDAV have no lookup by name.

D020 rejected re-checking UNSYNCED files at deletion time, because a deletion never touches them. That
reasoning still holds for deletion; this record adds the re-check to the refresh instead.

## Decision

- **Neighbour folders.** Before it re-reads the device, the refresh reads the active snapshot and finds
  every device folder that holds at least one *re-checkable* file and at least one SYNCED file.
  Re-checkable means UNSYNCED, or UNKNOWN for a server reason (`REMOTE_FOLDER_UNREAD` or a listing-failure
  code). UNKNOWN for `LOCAL_UNAVAILABLE` or `REMOTE_MTIME_MISSING` is not re-checked, because a listing
  cannot change it.
- **Candidate server folders.** The union of the stored `remote_match_key.directories` (D020) of the SYNCED
  files in those device folders, each weighted by the re-checkable files it covers. At most
  `RECHECK_MAX_FOLDERS = 32` are listed, the heaviest first, ties by path.
- **One connection, read-only listings** (R026). The refresh connects once with the stored repository,
  credential and trusted host key, and lists each candidate folder once with the walk's retry policy,
  through `ServerFolderLister`, which the pre-delete re-check (`DeletionRecheck`) now shares. The whole
  step, the `RECHECKING_REMOTE` scan phase, has a 20 s budget (`RECHECK_BUDGET_MILLIS`); when it runs out,
  the folders listed so far are kept. It is cancellable like the rest of the run.
- **Merge, then the unchanged rule table.** Every listed key the refresh does not hold yet is added to the
  new snapshot's `remote_match_key` (`INSERT OR IGNORE`) and to its `MatchIndex`. Existing keys, counts and
  directories never change. The `Matcher` then decides every file as before, so an exact key found in a
  listed folder makes the file SYNCED.
- **Never demotes, never fails the refresh.** A file that is not found keeps its previous verdict, because
  a partial listing cannot prove absence ([D006](./0006-unknown-status-never-deletable.md)). A connection,
  authentication, host-key or listing failure skips the re-check, and the refresh publishes as before.
- **No connection when there is nothing to do.** With no re-checkable file or no candidate folder, the
  refresh stays offline.
- **Counters.** Schema version 6 adds `scan_run.recheckedFolders` and `scan_run.promotedFiles`. The scan
  summary card says "Re-checked N server folders, M files now backed up" when M > 0.
  `remoteListedAtMillis` is unchanged: the listing as a whole is still the last full scan's.
- **Only counts and codes are logged**, never a host, user or path
  ([D011](./0011-typed-error-envelopes-partial-scans.md)).

### Limitation: files with no backed-up neighbour

An unsynced file in a device folder that holds no SYNCED file has no candidate server folder, so the
refresh cannot find it. This covers a brand-new device folder, and a backup whose server folder has moved
since the scan. Only a full scan finds those files. The scan summary keeps its "Rescan to check new
folders" hint, and the README says so.

## Rationale

The common case, new photos in a camera folder whose older photos were already backed up, costs one
listing, about 0.3–1 s over SFTP, and reuses D020's folder store, connection path and retry policy. Merging
keys into the copied index and letting the unchanged `Matcher` decide means no new verdict rule: a file is
promoted only on an exact key, exactly as a full scan would promote it, and nothing becomes deletable that a
full scan would not have made deletable. Deletion still re-checks every SYNCED file on the server before it
deletes (D020), so a promotion by the refresh does not weaken deletion safety.

## Alternatives rejected

- A full relisting during the refresh: rejected in clarification 1; minutes on a large backup, on every
  app open.
- Mirroring the device path onto each server folder: the device-to-server folder mapping is unknown (R024
  is deferred), and the guess fails for any non-mirrored layout.
- Re-listing the server folders whose modification time changed: that time is visible only from the parent
  folder's listing, so it still walks the whole tree, and WebDAV collection times are unreliable.
- A per-file `stat`: rejected in D020 for the same reasons.
- Demoting SYNCED files the listing no longer shows: a 20 s, capped listing is partial by design; absence
  is proved only by a full scan, and deletion re-checks anyway.

## Related

- Requirements: R012, R026
- Features: specs/009-tree-view-image-preview (clarification 1, FR-003, SC-003; research R5; data-model
  "Schema change: version 5 → 6")
- Decisions: [D003](./0003-directory-agnostic-sync-matching.md),
  [D006](./0006-unknown-status-never-deletable.md), [D009](./0009-foreground-scan-and-freshness.md),
  [D011](./0011-typed-error-envelopes-partial-scans.md), [D020](./0020-pre-delete-server-recheck.md)
  (amended), [D022](./0022-several-remote-folders-partial-scan.md)
