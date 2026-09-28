# M001: SyncScope v1

**Vision:** Connect to one FTP, SFTP, or WebDAV repository, scan selected local folders, and safely delete the files proven to be backed up. Sync status is a deletion-safety signal: the app exists to discover files that are synced and can be safely deleted, and it must never make a partial or stale result look like a clean one.

## Success Criteria

- User connects to a live FTP, SFTP, or WebDAV server with username and password, approving the SFTP host-key fingerprint on first connect
- User selects local folders from on-device and removable storage, and those selections survive an app restart
- User runs a scan with visible progress and gets a snapshot marking every file SYNCED, UNSYNCED, or UNKNOWN
- User browses results in a flat gallery grid, a browsable list, and a browsable tree, filtering by all / synced / unsynced / issues-unknown in each
- User multi-selects files in any view, sees an honest pre-flight breakdown, confirms, and the files actually disappear from device storage
- A scan that could not read part of the remote completes anyway, marks affected files UNKNOWN with an issue code, and says plainly how many files could not be checked
- Reopening the app auto-refreshes the local side while the remote listing stays cached, with the remote's age visible near any delete action
- The release APK installs and runs the full loop on both API 31 and API 36

## Slices

- [ ] **S01: Native CloudSync module and live protocol connect** `risk:high` `depends:[]`
  > After this: Connect screen accepts an FTP, SFTP, or WebDAV host plus username and password, connects to the live digest-pinned containers, surfaces an SFTP host-key fingerprint for explicit approval, and reports the protocol's discovered timestamp precision. Proven by androidTest against real containers, not fixtures.

- [ ] **S02: Local source selection via SAF** `risk:medium` `depends:[S01]`
  > After this: User taps Add folder, picks folders through the system picker including removable storage, and the sources persist across an app restart. A grant revoked between sessions shows the source as unavailable rather than silently disappearing. Proven by a Maestro flow on both API 31 and API 36.

- [ ] **S03: Scan engine, matching, and snapshot lifecycle** `risk:high` `depends:[S01,S02]`
  > After this: User taps Scan, watches live progress through a multi-minute run, and gets a snapshot where every file is SYNCED, UNSYNCED, or UNKNOWN. An unreadable remote directory does not abort the run — affected files become UNKNOWN with an issueCode and the summary states how many files could not be checked. Rescan from scratch and local auto-refresh on open both work. Proven by Maestro plus Robolectric matcher tests.

- [ ] **S04: Gallery view, browsable list, filtering, and Material 3 shell** `risk:medium` `depends:[S03]`
  > After this: User browses a virtualized gallery grid of the snapshot, switches filter chips between all, synced, unsynced, and issues-unknown with counts that agree with the snapshot, sees origin badges on duplicate tiles naming the originating local folder, and navigates into and back out of directories in list view via breadcrumb. Proven by a Maestro flow.

- [ ] **S05: Browsable tree view and image preview** `risk:medium` `depends:[S04]`
  > After this: User expands and collapses directories in tree view, navigating the same hierarchy as list view, and taps an image to open a full preview. With a filter applied, directories whose children are all filtered out remain visible dimmed with a count rather than dead-ending navigation. Proven by a Maestro flow.

- [ ] **S06: Multi-select and two-phase local deletion** `risk:high` `depends:[S04,S05]`
  > After this: User multi-selects files in any view, sees a pre-flight breakdown naming how many are synced, how many unsynced and warned, and how many unknown and refused, confirms, and real files disappear from real device storage with per-file outcomes reported. Proven by a Maestro flow deleting real files.

- [ ] **S07: Full-loop integration, docs, and release APK** `risk:medium` `depends:[S01,S02,S03,S04,S05,S06]`
  > After this: pnpm e2e:android is green on API 31 and API 36 for the complete loop — connect, pick folders, scan, filter, browse, select, delete — against live containers. The release APK installs and runs. ./docs and README are current.

## Boundary Map

### S01 → S02

Produces:
- A registered `CloudSyncPackage` in `MainApplication.kt` so `TurboModuleRegistry.get('CloudSync')` resolves at runtime — the precondition for every other slice
- Real implementations of `getRepositorySummary`, `saveRepository`, `testRepository`, `approveSftpHostKey`, `rejectSftpHostKey` returning typed envelopes instead of `NOT_IMPLEMENTED`
- A `RemoteClient` Kotlin interface abstracting FTP, SFTP, and WebDAV behind one read-only listing contract: connect, list a directory, and report per-entry name, size, and modified time
- A persisted `repository_config` row plus a Keystore-backed credential, referenced only by `credentialVersion`
- A discovered and recorded `precisionMillis` per configured protocol, available to the matcher

Consumes:
- nothing (first slice)

### S01 → S03

Produces:
- The `RemoteClient` listing contract the scan engine drives to enumerate the remote root
- `precisionMillis` as the bucket width for mtime comparison
- The typed error envelope vocabulary (`CloudSyncError` code plus redacted message plus recovery action) that mid-scan failures reuse to populate `issueCode`

Consumes:
- nothing (first slice)

### S02 → S03

Produces:
- Persisted `source_root` rows with unique `canonicalRoot` and a durable SAF URI grant per selected folder
- Real implementations of `listSources`, `launchSourcePicker`, and `removeSource`
- A local enumeration contract yielding name, size, and modified time per file under a source, plus an availability flag when a grant has been revoked
- `validation/maestro/` created, with the first flow establishing the selector and assertion conventions later flows follow

### S03 → S04

Produces:
- A completed `snapshot` row with `scan_run` generation, populated `local_node` rows carrying `status` (SYNCED / UNSYNCED / UNKNOWN) and `issueCode`, and collapsed `remote_match_key` rows
- Working `queryFiles(snapshotId, querySpec, pageToken)` returning bounded pages plus first-page `counts`, honouring the `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN` filter and the sort options
- Working `startScan`, `cancelScan`, and `getScanState` with progress the UI can render
- The active-snapshot invariant: only a completed run is ever promoted, and the remote listing's age is readable

### S03 → S05

Produces:
- Working `queryTreeChildren(snapshotId, parentId, querySpec, pageToken)` for parent-scoped listing, backed by `index_local_node_snapshotId_sourceId_parentId_kind_name`
- `parentId` and `kind` (FILE / DIRECTORY) populated on every `local_node` row so hierarchy navigation is possible

### S04 → S05

Produces:
- The Material 3 shell: theme, spacing and density scale, filter-chip component, and the accessibility-label convention Maestro selectors depend on
- A shared paged-query hook wrapping `queryFiles` and `queryTreeChildren` with page-token handling and `STALE_GENERATION` recovery
- The browsable-navigation pattern (breadcrumb, descend, ascend) established in list view for tree view to reuse

### S04 → S06

Produces:
- A view-agnostic selection model holding `entryId` sets across gallery, list, and tree
- Status-aware rendering so the selection UI can distinguish SYNCED, UNSYNCED, and UNKNOWN entries before any delete is attempted

### S05 → S06

Produces:
- Multi-select surfaced in tree view and preview, completing selection parity across all three views
- `getLocalImageHandle` implemented, establishing the local-content-read path that never touches remote content

### S06 → S07

Produces:
- Real `prepareLocalDeletion` returning a plan token plus a breakdown of synced, unsynced-warned, and unknown-refused counts
- Real `executeLocalDeletion(planToken)` with per-file outcomes written to `local_deletion_overlay` on success only
- The remote-listing-age surface rendered at the point of deletion decision
- A Maestro flow proving real files are removed from real device storage

### S06 → S07 (integration closure)

Consumes from all prior slices:
- The assembled loop — registered TurboModule, live protocol clients, persisted sources, completed snapshot, three browsable views, and two-phase deletion — which S07 exercises end to end on both API 31 and API 36 and documents in `./docs` and README
<!-- gsd:state-version=88:0 -->
