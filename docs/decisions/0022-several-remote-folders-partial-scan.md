# D022: Several remote folders on one server, and a scan that cannot read some of them

- **Status**: Accepted
- **Date / context**: 2026-10-05, feature 007 (sorting, fast scrolling, several server folders),
  clarifications 1 and 3, research R11 and R14
- **Scope**: architecture
- **Made by**: human (server folders rather than device folders, clarification 1; finish with an honest
  partial result rather than fail, clarification 3); agent (how the folders are stored, validated and
  walked, R11 and R14)
- **Revisable**: Yes, the storage. If folders ever need their own settings, the newline-separated column
  can become a table. The rule that an unread folder makes the other files UNKNOWN, never UNSYNCED, is
  not revisable for v1.

## Context

Until feature 007, v1 compared every selected device folder against **one remote root** on one server
([scope](../scope.md)). A real backup is often spread over several folders on the same server, for
example `/photos` and `/phone-backup/DCIM`, and a file is backed up if it is in any of them. With one root
the user had to pick a common parent and walk everything under it, or miss files that were backed up.

Several folders raise a question one root did not have: what a scan means when some folders can be read
and others cannot. With one root, an unreadable root failed the scan (004 FR-006), and a folder below it
that could not be read made the listing incomplete, so unmatched files became UNKNOWN (D011).

## Decision

- **One server, one or more folders.** The repository keeps one server, one account and one connection
  profile, and gains an ordered list of remote folders. Every device file is matched against all of
  them together with the existing rules ([D003](./0003-directory-agnostic-sync-matching.md),
  [D019](./0019-match-name-normalization-and-strict-buckets.md)). There is still no per-folder mapping
  from device folders to server folders, and no second server (R024 stays deferred).
- **Storage** (R11). Schema version 5 renames `repository_config.remoteRoot` to `remoteRoots`, which
  holds the folders separated by `\n`, in the user's order, by a Room `@RenameColumn` auto-migration. A
  repository saved before is a one-element list with no data copy (FR-013).
- **Validation in one place** (R11). `RemoteRoots` trims each folder, adds the leading `/`, collapses
  repeated `/` and drops the trailing one. Save refuses an empty list, a newline in a folder, and two
  folders that are the same or where one is inside the other at a `/` boundary; the field error carries
  `field: 'remoteRoots'` and `fieldIndex`, and its message names the other folder (FR-009). JavaScript
  does not repeat the rule.
- **Partial scan** (R14). The walk enqueues every folder. A folder that still fails after the retry
  policy is recorded as a gap of the new scope `REMOTE_FOLDER`, with the configured folder in
  `remote_ambiguity.remotePath`, and the walk carries on. The listing is then incomplete, so `Matcher`
  keeps its rules: files with an exact match in a folder that was read stay SYNCED, and every other file
  is UNKNOWN with the issue code `REMOTE_FOLDER_UNREAD`, never UNSYNCED. The scan summary lists the
  folders in `unreadRemoteFolders`, and the Scan tab and the file's issue text name them. `LOCAL_REFRESH`
  copies the gap rows, so the warning stays until a full scan reads every folder.
- **All folders unread.** When no folder can be read, the walk raises `RootListingFailed` with the first
  folder's code: the scan fails and the current result stays. With one folder this is exactly the
  earlier behaviour.
- **Only configured folders are stored.** A gap row holds a folder the user typed, which already crosses
  the bridge in the repository summary; paths found during the walk are never stored there
  ([D011](./0011-typed-error-envelopes-partial-scans.md)).

## Rationale

A folder that cannot be read is the same situation as a subfolder that cannot be read, one level up:
some of the server was not seen. Reusing the incomplete-listing path means no new verdict rule, and the
honesty guarantee carries over: a file is called "not backed up" only when the whole configured backup
was listed, and UNKNOWN files are never deletable ([D006](./0006-unknown-status-never-deletable.md)).
Failing the whole scan for one unreadable folder (for example a share that is offline) would throw away
every verdict the readable folders support, which the user rejected in clarification 3.

A renamed column keeps one source of truth for the folder list, and the newline encoding follows the
precedent of `remote_match_key.directories` (D020). The pre-delete re-check
([D020](./0020-pre-delete-server-recheck.md)) needs no change, because it lists the absolute server
folders stored per match key, whichever configured folder they came from (FR-012).

## Alternatives rejected

- Failing the scan when any folder cannot be read: rejected in clarification 3; one offline share would
  block every result.
- Treating files that are missing from the readable folders as UNSYNCED: the copy may be in the folder
  that was not read, and an UNSYNCED verdict invites a deletion decision on wrong information.
- A `remote_folder` table: a join and a manual migration for an ordered list of short strings.
- An `extraRoots` column next to `remoteRoot`: two places holding one list.
- Several servers or a per-folder mapping (R024): out of v1 scope; one server with several folders
  covers the case the user asked for.

## Related

- Requirements: R001, R024 (still deferred), R026
- Features: specs/007-sort-scroll-remote-folders (clarifications 1 and 3, FR-009 to FR-013, User Story
  3; research R11 to R14; data-model "Schema change: version 4 → 5")
- Decisions: [D003](./0003-directory-agnostic-sync-matching.md),
  [D006](./0006-unknown-status-never-deletable.md),
  [D011](./0011-typed-error-envelopes-partial-scans.md),
  [D018](./0018-debug-repository-seam.md) (the debug seam accepts `root` more than once),
  [D020](./0020-pre-delete-server-recheck.md)
- Amends: the one-remote-root statement in [scope](../scope.md#v1-scope)
