# D016: How is a local source identified, kept from overlapping, and reported when it becomes unreachable?

- **Status**: Accepted
- **Date / context**: 2026-09-28, feature 003 (local source selection via SAF), clarify and plan
- **Scope**: architecture
- **Made by**: human (the overlap, re-grant, alias and removal rules, in the 2026-09-28 clarifications) and
  agent (the provider limit, the canonical-root format and computed availability, research R2–R5)
- **Revisable**: Yes. Accepting more document providers would need a new identity rule, because the
  overlap check relies on the external-storage provider's `volumeId:path` document IDs.

## Context

Sources are the entire input side of the app: every scan starts from the folders the user picked through
the Storage Access Framework (SAF). SAF gives the app a tree URI and a persisted grant, not a filesystem
path. The same folder can be encoded as different URIs, grants can be revoked by the OS or the user while
the app is closed, and an SD card can be taken out. The app needs a stable identity for each folder, a way
to stop two sources from counting the same files twice, and an honest answer to "can this source be read
right now?".

## Decision

- **Providers.** Only trees from `com.android.externalstorage.documents` (on-device shared storage and
  removable volumes) are accepted. Any other provider is rejected with `SOURCE_UNSUPPORTED` and the grant
  just taken is released (R2).
- **Canonical root.** Each source's identity is
  `canonicalRoot = "<authority>/<volumeId>:<documentPath>"`, parsed from the tree document ID
  (`DocumentsContract.getTreeDocumentId`), with slashes trimmed and an empty path for a volume root. The
  existing unique index on `source_root.canonicalRoot` backs it up (R3).
- **No overlap.** A new pick is rejected with `SOURCE_OVERLAP`, naming the conflicting source, when it has
  the same authority and volume as an existing source and one path equals the other or is its prefix at a
  `/` boundary. A volume root overlaps everything on its volume. Nothing is persisted (FR-002).
- **Computed availability.** Availability is computed on every `listSources` call and never stored:
  `GRANT_REVOKED` ("Access lost") when no persisted grant with read permission matches the tree URI, then
  `STORAGE_MISSING` ("Storage missing") when the root-document query fails or returns no row, otherwise
  `AVAILABLE`. The screen reloads the list whenever the app returns to the foreground (R5). The local
  enumeration contract reports an unavailable source as `Skipped(reason)`, never as an empty listing.
- **Re-grant by target.** `launchSourcePicker(regrantSourceId?)` takes the ID of the source being
  re-granted. The pick must resolve to that source's `canonicalRoot`, or it is rejected with
  `SOURCE_REGRANT_MISMATCH`. On success only `treeUri` and `canWrite` change; `sourceId`, `alias` and
  `addedAtMillis` are kept. The added parameter changed the Codegen surface, so the contract version went
  from 1 to 2 (R4).
- **Alias.** Generated once when the source is added, never edited or recomputed: the folder name, then
  "name (volume label)", then parent folder names added until it is unique case-insensitively (FR-004, R6).
- **Removal.** After the user confirms in the UI, the source's row and all its scan data are deleted in one
  Room transaction, and the grant is released after the commit (FR-005, R7).

## Rationale

A pure string function over the tree document ID can be unit-tested without a device and needs no I/O,
and only the external-storage provider gives document IDs of the stable `volumeId:path` form that makes
the overlap rule possible. A stored availability flag would go stale the moment the OS changed a grant;
computing it costs one grant lookup and one small query per source, and users select a handful of folders.
Two unavailable states tell the user what to do: re-grant for Access lost, re-insert the card for Storage
missing. Re-grant needs a target, or a re-grant of a different folder could not be told apart from a
normal add, and the spec requires it to be rejected.

## Alternatives rejected

- Accepting any document provider — no stable path, so no overlap rule; cloud-drive providers are also a
  v1 non-goal.
- Comparing `treeUri` strings, or resolving real filesystem paths — the same folder can be encoded
  differently, and raw paths are outside SAF and must not cross the bridge.
- A stored `status` column in `source_root` — needs a schema migration and is wrong whenever it is not
  refreshed.
- A single "unavailable" state — the user could not tell whether to re-grant or re-insert the SD card.
- A separate `regrantSource` method, or re-granting implicitly when an add matches an unavailable source —
  the first duplicates the picker plumbing; the second cannot reject a re-grant of a different folder.
- Numeric alias suffixes such as "Camera 2" — they do not say where the folder is.
- `onDelete = CASCADE` on the `local_node` foreign key — a schema migration to save one query.

## Related

- Requirements: R005
- Features: specs/003-local-source-selection (spec FR-001–FR-005; research R2–R5, R6, R7), and
  specs/004-scan-engine-matching, which consumes the enumeration contract
- Decisions: [D001](./0001-single-cloudsync-turbomodule.md),
  [D011](./0011-typed-error-envelopes-partial-scans.md)
