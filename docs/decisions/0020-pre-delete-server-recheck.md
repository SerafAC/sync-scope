# D020: How does a deletion confirm that a file is still on the server?

- **Status**: Accepted
- **Date / context**: 2026-10-02, feature 006 (MVP), spec clarification 1, research R11 and R12
- **Scope**: architecture
- **Made by**: human (re-check or not, clarification 1); agent (how the re-check finds and lists the
  server folders, R11 and R12)
- **Revisable**: Yes, the folder store. If snapshot retention or a tree of server files
  (`remote_node`) is added later, the re-check can read its folders from there instead. The rule that
  a backed-up file is re-checked before it is deleted is not revisable for v1.

## Context

A scan's verdict can be hours or days old when the user deletes. In the meantime the server copy can
be removed, renamed or replaced by a different file. Deleting the local copy on the strength of the
old verdict alone would delete a file that exists nowhere else, which is the one thing the app must
never do.

Re-checking needs to know where on the server each matched file lives. Until schema version 3, a scan
kept only collapsed match keys (`remote_match_key`: NFC name, size, precision bucket, duplicate count),
because matching ignores directories ([D003](./0003-directory-agnostic-sync-matching.md)). `remote_node`
exists in the schema but is never written.

## Decision

- **Re-check before every deletion** (clarification 1). `prepareLocalDeletion` re-checks every selected
  file the scan called SYNCED on the server. A file stays "to delete" only if a server file with the
  same match key (NFC name, size and precision bucket, by the [D019](./0019-match-name-normalization-and-strict-buckets.md)
  rules in `MatchIndex`) is still listed. UNSYNCED files are not re-checked, and UNKNOWN files are
  refused without a check ([D006](./0006-unknown-status-never-deletable.md)).
- **Server folders per match key** (R11). Schema version 4 adds `remote_match_key.directories`: the
  distinct remote parent folders of the files collapsed into that key, newline-separated, at most 16
  (`MatchIndex.MAX_DIRECTORIES_PER_KEY`). `MatchIndex` collects them during the walk, and
  `LOCAL_REFRESH` copies them with the keys. Rows written before version 4 have `NULL`.
- **List only those folders** (R12). The re-check groups the selected SYNCED files by folder, connects
  once with the stored repository and trusted host key, and lists each folder once, with the retry
  policy shared with the scan walk (`RemoteWalker.listWithRetry`). It never reads file contents and
  never writes (R026).
- **Outcomes per file**:

  | Situation | Result | Reason |
  | --- | --- | --- |
  | A listed folder still holds a file with the same key | stays "to delete" | — |
  | Every folder answered, none holds the key (or answered "not found") | moved to not backed up | `GONE_FROM_SERVER` |
  | No folder confirmed it and at least one could not be listed | moved to refused | `RECHECK_FAILED` |
  | The key has no stored folders (scan older than schema version 4) | refused | `SCAN_TOO_OLD` |

  The confirmation shows how many files the re-check moved (`movedByRecheck`).
- **All or nothing on connection.** A connection, authentication or host-key failure before any listing
  fails the whole prepare with that code. No plan exists, so nothing can be deleted.
- **Same server only.** Prepare refuses with `REPOSITORY_CHANGED` when the snapshot was made with an
  earlier repository revision, because its keys were matched against another server or folder.

## Rationale

The verdict drives an irreversible delete, so it is confirmed at the last responsible moment, and every
uncertainty falls on the safe side: a folder that cannot be listed refuses the file, a missing folder
list refuses it, and a lost connection deletes nothing. Listing only the folders that hold the selection
keeps the check to a handful of requests for a typical camera selection, through the one `list` call
every protocol client already has. One nullable column on the existing keyed table keeps the lookup an
exact-key read.

The cap of 16 folders per key is a guard against pathological duplication. If all 16 stored folders
lost the file, it is treated as gone, which errs towards "not backed up".

## Alternatives rejected

- Trusting the last scan's verdict (no re-check): rejected in clarification 1; a server copy removed
  after the scan would be lost.
- Writing `remote_node` for every server file: one row per server file (100 k and more) per snapshot,
  copied again on every app-open refresh, only to answer "which folder".
- Re-walking the whole server tree on every delete: minutes for a large backup.
- A per-file `stat` on the server: not every client exposes it, and N round trips cost more than a few
  listings.
- Re-checking UNSYNCED files to promote them: not needed; the user is told they are not backed up, and a
  scan promotes them.

## Related

- Requirements: R012, R013, R026
- Features: specs/006-mvp (clarification 1, FR-018a, Story 6 sc. 7 and 8, SC-010; research R11, R12;
  data-model "Schema change")
- Decisions: [D003](./0003-directory-agnostic-sync-matching.md),
  [D006](./0006-unknown-status-never-deletable.md), [D008](./0008-two-phase-local-deletion.md),
  [D019](./0019-match-name-normalization-and-strict-buckets.md)
