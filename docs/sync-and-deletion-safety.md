# Sync and deletion safety

The app exists to drive one irreversible action: deleting local files. This page describes the rules that
make its SYNCED / UNSYNCED / UNKNOWN verdict trustworthy and its deletions safe. Rationale lives in the
linked decision records.

## Matching: name + size + mtime, never directory structure

A local file is SYNCED when a remote file exists with the same **name**, the same **size**, and a
**modified time in the same precision bucket** (R007, [D003](./decisions/0003-directory-agnostic-sync-matching.md),
refined by [D019](./decisions/0019-match-name-normalization-and-strict-buckets.md)).

- **Directories are ignored entirely.** Android album directories and cloud-flattened remote layouts will
  never line up. Duplicates on both sides are fine: what matters is that a given file is backed up
  somewhere. Remote duplicates collapse into one key with a count, so `duplicates/a/reusable.jpg` and
  `duplicates/b/reusable.jpg` are one entry.
- Matching is an exact lookup on a collapsed `remote_match_key` of
  `(snapshotId, name, sizeBytes, precisionMillis, bucket)`. During a scan the engine holds the same key in
  an in-memory `MatchIndex`, so each local file costs one hash lookup.
- A stricter checksum mode is deferred (R023, see [scope](./scope.md#deferred)), because it would require
  downloading remote content.

### Names: NFC, case-sensitive

Both the local and the remote name are normalized to Unicode **NFC** before the key is built or looked up.
The protocol clients and the Android storage provider hand names over exactly as stored, so a name written
as `é` (one code point) on the device and as `e` plus a combining accent (NFD) on the server is the same
key. The name stored on `local_node` and shown to the user is the original, not the normalized form.

Comparison stays **case-sensitive**: `IMG.jpg` and `img.jpg` do not match. A case-insensitive match could
call a file backed up because a different file with a similar name exists.

### Modified time: the same bucket, strictly

With the scan's discovered precision `p` (in milliseconds), a modified time `t` falls in bucket
`floor(t / p)` (`Math.floorDiv`, so pre-1970 times bucket correctly). A match requires **equal buckets**.
An adjacent bucket is not a match, and neither is "within one precision unit".

For example, at `p = 1000`, local `12:00:00.999` and remote `12:00:01.000` are one millisecond apart but
straddle a bucket edge (buckets `…000` and `…001`), so they do **not** match, and the file is UNSYNCED.
Local `12:00:00.000` and remote `12:00:00.999` are in the same bucket and match. The error is deliberately
on the safe side: a near miss shows as not backed up, never as a false SYNCED.

### The matching rules

Each local file gets a status and, when UNKNOWN, an `issueCode`. The rules are applied in order and the
first that applies wins; the full table is in the
[004 data model](../specs/004-scan-engine-matching/data-model.md#matching-rules-matcher-file-rows).

| # | Condition | Status | `issueCode` |
| --- | --- | --- | --- |
| 1 | The device reported no size or no modified time for the local file | UNKNOWN | `LOCAL_UNAVAILABLE` |
| 2 | The exact key (NFC name, size, bucket) is in the remote listing | SYNCED | — |
| 3 | The name and size are listed, but only for a remote file without a modified time | UNKNOWN | `REMOTE_MTIME_MISSING` |
| 4 | The remote listing is incomplete | UNKNOWN | the code of the first listing failure, such as `DIRECTORY_UNREADABLE` or `CONNECTION_LOST` |
| 5 | Otherwise | UNSYNCED | — |

Rule 2 comes before rule 4: a file that found its match stays SYNCED even when part of the listing failed.

Hidden local entries (names starting with `.`) and everything under them are not scanned in v1. Remote
hidden entries **are** listed and matched, which can only turn a false UNSYNCED into a correct SYNCED.

### Directories: worst-of rollup

Directory rows carry a status rolled up from every file below them: UNKNOWN if any is UNKNOWN, else
UNSYNCED if any is UNSYNCED, else SYNCED. An empty directory is SYNCED, since there is nothing in it to
lose. A folder never looks safer than its contents. Directory rows have no `issueCode`, and the summary
counts files only.

## Filters: isolating the synced and the unknown sets

The four filters exist so the user can isolate the set that is safe to delete and the set that must never
be deleted (R011). One filter is shared by every view (gallery, list and, in feature 009, tree), and it
maps directly to the stored file status:

| Filter | Files shown |
| --- | --- |
| `ALL` | every file |
| `SYNCED` | status SYNCED |
| `UNSYNCED` | status UNSYNCED |
| `ISSUES_UNKNOWN` | status UNKNOWN, whatever its `issueCode`: exactly the set that is never deletable |

- **Counts come from the same snapshot as the rows.** Each chip's count is read with the first page, from
  the same snapshot, and counts what that view can show: image files in the gallery, all files in list
  view (so list counts equal the Scan summary). When a rescan publishes a new snapshot, the view drops
  its rows and reloads them and the counts together, so a count never describes a different snapshot
  than the rows below it ([005 spec, FR-005](../specs/005-gallery-list-filtering/spec.md#functional-requirements)).
- **Directories ignore the filter.** A filter narrows file rows only. Every directory stays listed, with
  the number of files beneath it that match the filter. A directory with no match is dimmed with
  "0 matching" but can still be opened, so the folder structure looks the same under every filter. Feature
  009's tree view follows the same rule
  ([005 research R3](../specs/005-gallery-list-filtering/research.md#r3-directory-rows-under-a-filter-clarification-3)).
  A directory's own worst-of status is unchanged and still shown.

## Precision is discovered at connect time

Timestamp precision is measured for each server when the app connects, not hardcoded per protocol
([D004](./decisions/0004-discovered-timestamp-precision.md)). FTP is second-precision at best and sometimes
only minute- or day-granular via LIST; a file compared at minute precision is materially weaker proof than
one compared at second precision. A full scan discovers the precision again and uses it for the whole run.
The discovered precision and how it was derived are recorded with the snapshot, so a weak comparison basis
stays visible. Per-protocol details are in [protocols](./protocols.md).

## UNKNOWN is never deletable

UNKNOWN means the app could not establish whether the file is backed up: the remote directory was
unreadable, the listing stopped mid-scan, the remote gave no modified time, or the device could not read
the file's own size or modified time ([D006](./decisions/0006-unknown-status-never-deletable.md)).

- It is a distinct status with its own `ISSUES_UNKNOWN` filter chip and an `issueCode` explaining why.
  Remote causes reuse the error codes (`DIRECTORY_UNREADABLE`, `CONNECTION_LOST`, `CONNECTION_TIMEOUT`,
  `SERVER_ERROR`); the scan-only codes are `REMOTE_MTIME_MISSING`, `REMOTE_FOLDER_UNREAD` (one of the
  configured remote folders could not be read; the file's issue text names it) and the local-side
  `LOCAL_UNAVAILABLE`.
- `prepareLocalDeletion` refuses UNKNOWN entries outright, even behind a warning (R012, R017).
- UNSYNCED files may be deleted, but only behind a stronger warning; SYNCED files are the default target
  (R012).

## Partial scans are shown as partial

A scan never aborts wholesale on an unreadable directory or a dropped connection
([D011](./decisions/0011-typed-error-envelopes-partial-scans.md), R017). Three failures are kept apart,
because each needs a different answer:

| Failure | What the run does | Effect on files |
| --- | --- | --- |
| **Incomplete remote listing**: at least one configured remote folder was listed, then a folder below it could not be read, or the connection dropped and three attempts failed | Completes and is promoted, marked incomplete | Matched files stay SYNCED; every unmatched file is UNKNOWN with the failure's code, never UNSYNCED, because its copy may be in the part that was not listed |
| **Unread remote folder**: one or more of the configured remote folders could not be read after the retry policy, while at least one other was read ([D022](./decisions/0022-several-remote-folders-partial-scan.md)) | Completes and is promoted, marked incomplete; the summary names each unread folder | Files with a match in a folder that was read stay SYNCED; every other file is UNKNOWN with `REMOTE_FOLDER_UNREAD`, never UNSYNCED, because its copy may be in the folder that was not read |
| **Unreachable remote**: connect, login, host-key check or the listing of every configured remote folder fails before anything is listed | Ends `FAILED` with the typed error and its recovery action; auth failures are never retried | No new snapshot; the previous one stays active, with its listing age shown |
| **Unreadable local file or folder**: the device reports no size or modified time, or a folder's listing fails part way | Completes | The file is UNKNOWN with `LOCAL_UNAVAILABLE`; a folder that could not be listed fully, or was skipped (`GRANT_REVOKED`, `STORAGE_MISSING`), is named in the summary with its reason |

- The completion summary states plainly how many files could not be checked, which configured remote
  folders could not be read, how many folders below them could not be read, whether the listing was
  interrupted and which device folders were skipped.
- The unread configured folders are kept with the snapshot (`remote_ambiguity.remotePath`), so the
  app-open refresh keeps the warning and the UNKNOWN verdicts until a full scan reads every folder. "Not
  backed up" is never claimed from a listing that missed a configured folder.
- Only a completed run becomes the active snapshot. A run that is cancelled, stopped because the user
  left the app, or `FAILED` has its staged snapshot deleted and is never promoted
  ([D009](./decisions/0009-foreground-scan-and-freshness.md)).
- Errors cross the native boundary as typed envelopes with stable codes and redacted messages, so the UI can
  tell auth rejection from an unreachable host and offer the right recovery.

## Two-phase delete with a pre-flight breakdown

Deletion always happens in two steps ([D008](./decisions/0008-two-phase-local-deletion.md), R013):

1. `prepareLocalDeletion(snapshotId, entryIds)` re-checks the selection on the server (below) and returns
   a plan token and a breakdown: the files to delete with their total size, the files not backed up, the
   refused files, how many files the re-check moved, and the listing age. The confirmation dialog shows
   exactly this.
2. `executeLocalDeletion(planToken, includeUnsynced)` commits that plan. Without `includeUnsynced`, which
   the user sets only by acknowledging that those files exist nowhere else, not-backed-up files are kept.

Prepare refuses, and no plan exists, when the results are not the active snapshot, when the server
settings changed since the scan (`REPOSITORY_CHANGED`), or while a scan or another deletion runs. Execute
refuses a plan that is unknown, used, older than 15 minutes (`PLAN_NOT_FOUND`) or made on results that have
since been replaced (`PLAN_STALE`). A stale selection or confirmation therefore never deletes a different
set. Scans and deletions never run at the same time.

### The server re-check

Before a plan is made, every selected SYNCED file is checked again on the server
([D020](./decisions/0020-pre-delete-server-recheck.md), clarification 1 of feature 006):

- Each scan stores, per match key, the server folders (at most 16) that held the matched files. The
  re-check connects once and lists only those folders, once each. It reads listings only: no file
  content, no write (R026). The stored folders are full server paths, so the re-check works the same
  whichever of several configured remote folders the match was found in (feature 007 FR-012).
- A file stays "to delete" only if one of its folders still lists a file with the same NFC name, size
  and modified-time bucket, by the same rules as the scan.
- If every folder answered and none holds it, the file moves to **not backed up**
  (`GONE_FROM_SERVER`). If no folder confirmed it and at least one could not be listed, it moves to
  **refused** (`RECHECK_FAILED`). A file from a scan made before the folders were stored is refused
  (`SCAN_TOO_OLD`, "scan again").
- If the server cannot be reached, the login fails or the SFTP host key is not trusted, the whole prepare
  fails with that error. No plan exists, so **nothing is deleted**; the user can retry.

UNSYNCED files are not re-checked, and UNKNOWN files are refused without one.

### Per-file outcomes

Execute checks each file on the device just before deleting it, and reports one outcome per file. One
file's failure never stops the rest.

| Outcome | When | Effect |
| --- | --- | --- |
| `DELETED` | The file matched the plan and the storage provider deleted it | Row removed from the results |
| `ALREADY_GONE` | The file was no longer on the device | Row removed from the results |
| `CHANGED` | Its size or modified time differs from the scan | Not deleted; stays in the results |
| `ACCESS_LOST` | The folder's grant is gone or read-only | Not deleted; stays in the results |
| `FAILED` | The provider refused and the file is still there | Not deleted; stays in the results |

Every 100 files, one transaction removes the `DELETED` and `ALREADY_GONE` rows, decrements the snapshot's
and every ancestor folder's counts, and writes a `local_deletion_overlay` row as the audit record. The
results therefore never show as deleted a file that is still on the device, and need no rescan. If the
app is killed mid-run, every committed batch stays committed, and the next app-open refresh catches up
with anything deleted after the last commit. The result dialog shows the number deleted, the space freed
and each file that was not deleted, with its reason.

### What is never deleted

- **UNKNOWN files**, whatever the user chooses ([D006](./decisions/0006-unknown-status-never-deletable.md)).
- **Files the re-check could not confirm** (`RECHECK_FAILED`, `SCAN_TOO_OLD`).
- **Not-backed-up files**, unless the user explicitly acknowledged the stronger warning.
- **Files that changed** on the device since the scan.
- **Folders.** Only the confirmed files are deleted. A folder left empty stays on the device and in the
  results with 0 files, and a folder added as a source is never removed (clarification 4 of feature 006).
- **Anything on the server.** The app deletes local files only (R026).

Deletion goes through the Storage Access Framework and is permanent: Android has no recycle bin for it,
and the confirmation says so.

## Remote-listing age near delete

On reopen, the local side re-stats automatically, while the remote listing stays cached until an explicit
rescan (R015, [D009](./decisions/0009-foreground-scan-and-freshness.md)).

- The refresh is a `LOCAL_REFRESH` run: it copies the active snapshot's remote match keys **and its
  remote-side failures** into a new snapshot, then enumerates and matches the local side again. An
  incomplete listing therefore stays incomplete after a refresh: an unmatched file stays UNKNOWN and never
  turns UNSYNCED. Only a full rescan lists the remote again.
- The refresh is skipped when there is no active snapshot or the repository configuration changed since
  it was taken, because the cached listing belongs to another repository; the user runs a full scan.

- A file can therefore show SYNCED from a stale listing after it was removed remotely. Because the user acts
  on that verdict by deleting, the remote listing's age is shown near any delete action.
- Past **7 days**, the app suggests a rescan without blocking, on the Scan tab and in the deletion
  confirmation. The server re-check covers only the selected files, so the suggestion stays. The threshold is a tunable default, not a
  hard rule.
- Rescan from scratch is a first-class control, not a hidden setting (R016).
