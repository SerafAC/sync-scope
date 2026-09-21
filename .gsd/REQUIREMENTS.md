# Requirements

This file is the explicit capability and coverage contract for the project.

## Active

### R001 — Connect to one remote repository over FTP, SFTP, or WebDAV using username and password
- Class: core-capability
- Status: active
- Description: Connect to one remote repository over FTP, SFTP, or WebDAV using username and password
- Why it matters: Without a live connection to the cloud repository there is no remote side to compare against, so nothing in the app works
- Source: user
- Primary owning slice: M001/S01
- Validation: mapped
- Notes: One remote server, one remote root, one active profile for v1. Libraries: SSHJ (SFTP), Apache Commons Net (FTP), hand-rolled OkHttp PROPFIND (WebDAV). Proven against digest-pinned containers in validation/services/compose.yaml.

### R002 — SFTP host-key trust-on-first-use with explicit approve/reject; a changed key blocks the scan and re-prompts
- Class: compliance/security
- Status: active
- Description: SFTP host-key trust-on-first-use with explicit approve/reject; a changed key blocks the scan and re-prompts
- Why it matters: Blind host-key acceptance makes the SFTP connection trivially interceptable; deletion decisions based on a spoofed remote listing would destroy unbacked-up files
- Source: user
- Primary owning slice: M001/S01
- Validation: mapped
- Notes: Scaffold already declares approveSftpHostKey/rejectSftpHostKey and a trusted_sftp_host_key table with unique index on (host, port, algorithm). Never a silent reconnect on key change.

### R003 — Credentials never persist in Room; Keystore-backed storage only, enforced by schema test
- Class: compliance/security
- Status: active
- Description: Credentials never persist in Room; Keystore-backed storage only, enforced by schema test
- Why it matters: Room databases are trivially extractable from a rooted or backed-up device; a password column would leak the user's cloud account
- Source: inferred
- Primary owning slice: M001/S01
- Validation: mapped
- Notes: SchemaContractTest fails the build if repository_config grows a password/secret/ciphertext/cipher/nonce/credential_blob/token column. Only credentialVersion is permitted as a reference. Password lives in Android Keystore-backed EncryptedSharedPreferences.

### R004 — Discover and record each protocol's actual timestamp precision at connect time rather than hardcoding it
- Class: core-capability
- Status: active
- Description: Discover and record each protocol's actual timestamp precision at connect time rather than hardcoding it
- Why it matters: FTP MDTM precision is server-dependent (second at best, sometimes minute-granularity via LIST); a file compared at minute precision is materially weaker proof for deletion than one compared at second precision, and the user must not be misled about that
- Source: research
- Primary owning slice: M001/S01
- Validation: mapped
- Notes: Apache Commons Net docs confirm MDTM returns yyyyMMDDhhmmss with an optional .xxx fraction and that "not all FTP servers honor this". Use mdtmFile() where advertised, fall back to LIST parse precision otherwise and degrade the bucket accordingly. Feeds precisionMillis on remote_match_key.

### R005 — Select local folders from on-device and removable storage via the Android Storage Access Framework
- Class: core-capability
- Status: active
- Description: Select local folders from on-device and removable storage via the Android Storage Access Framework
- Why it matters: The selected folders are the entire input side of the app; without persistent multi-folder selection there is nothing to scan
- Source: user
- Primary owning slice: M001/S02
- Validation: mapped
- Notes: Sources persist across restart in source_root with unique canonicalRoot. Revoked SAF grants surface as unavailable rather than vanishing. Behaviour differs materially between API 31 and 36, so both are exercised.

### R006 — Foreground scan with visible progress and cancellation; partial runs never become the active snapshot
- Class: primary-user-loop
- Status: active
- Description: Foreground scan with visible progress and cancellation; partial runs never become the active snapshot
- Why it matters: Scanning thousands of files over FTP takes minutes; an opaque wait is unacceptable, and a half-finished scan promoted to active would make the user delete files that were never actually checked
- Source: user
- Primary owning slice: M001/S03
- Validation: mapped
- Notes: Foreground app only per user decision. One scan_run per attempt with monotonic generation. Backgrounding mid-scan stops the run and discards the partial snapshot.

### R007 — Determine sync status by file name plus size plus modified time within the protocol's precision bucket, ignoring directory structure entirely
- Class: core-capability
- Status: active
- Description: Determine sync status by file name plus size plus modified time within the protocol's precision bucket, ignoring directory structure entirely
- Why it matters: Android album directories and cloud-flattened remote layouts will never line up; the user explicitly said duplicates on both sides are fine and what matters is that a given file is backed up somewhere
- Source: user
- Primary owning slice: M001/S03
- Validation: mapped
- Notes: Collapsed remote_match_key on (snapshotId, name, sizeBytes, precisionMillis, bucket) turns this into an indexed exact lookup rather than an O(n x m) tree walk. Path-relative matching explicitly rejected.

### R008 — Gallery view as a flat virtualized grid over the snapshot, with an origin badge shown only on duplicates
- Class: primary-user-loop
- Status: active
- Description: Gallery view as a flat virtualized grid over the snapshot, with an origin badge shown only on duplicates
- Why it matters: Gallery is the fastest way to visually scan photos, but a flat grid has no path context, so identical-looking tiles need a badge answering "which of my folders is this one from"
- Source: user
- Primary owning slice: M001/S04
- Validation: mapped
- Notes: Badge shows the originating local folder only, never the remote path. A single unambiguous file in gallery gets no badge. Thousands of files means virtualized rendering over paged queryFiles reads.

### R009 — List view as a browsable directory listing with navigation down into folders and back up via breadcrumb
- Class: primary-user-loop
- Status: active
- Description: List view as a browsable directory listing with navigation down into folders and back up via breadcrumb
- Why it matters: The user corrected an earlier flat-list read: list view must let them browse directories up and down, because the path they navigated is the origin context
- Source: user
- Primary owning slice: M001/S04
- Validation: mapped
- Notes: Not a flattened dump of every file under every source. Uses queryTreeChildren with parentId, backed by index_local_node_snapshotId_sourceId_parentId_kind_name. Shows name, size, modified time, sync status. No origin badge needed.

### R010 — Tree view as a browsable expandable hierarchy over the same snapshot
- Class: primary-user-loop
- Status: active
- Description: Tree view as a browsable expandable hierarchy over the same snapshot
- Why it matters: Same browse requirement as list view, different presentation; users reasoning about which album to clear out think in hierarchy
- Source: user
- Primary owning slice: M001/S05
- Validation: mapped
- Notes: Shares the queryTreeChildren contract with list view. Open planning detail: when a filter is applied, directories whose children are all filtered out should still show (dimmed, with a count) rather than vanish, otherwise navigation dead-ends.

### R011 — Filter across all three views: all, synced, unsynced, and issues-unknown
- Class: primary-user-loop
- Status: active
- Description: Filter across all three views: all, synced, unsynced, and issues-unknown
- Why it matters: The whole point of the app is isolating the synced set so it can be deleted, and isolating the unknown set so it is never deleted
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: M001/S05
- Validation: mapped
- Notes: FileFilter in CloudSyncContracts.ts already carries ALL/SYNCED/UNSYNCED/ISSUES_UNKNOWN. Filter state applies consistently across gallery, list, and tree.

### R012 — Multi-select and local-only deletion: synced files by default, unsynced allowed behind a stronger warning, UNKNOWN refused outright
- Class: primary-user-loop
- Status: active
- Description: Multi-select and local-only deletion: synced files by default, unsynced allowed behind a stronger warning, UNKNOWN refused outright
- Why it matters: This is the payoff of the entire app; the user's own framing is that it exists to discover files that are synced and can be safely deleted
- Source: user
- Primary owning slice: M001/S06
- Validation: mapped
- Notes: Local files only; the app never deletes anything remote. UNKNOWN is refused even behind a warning because the remote state genuinely was not established. Multi-select works from any of the three views.

### R013 — Two-phase deletion: prepareLocalDeletion returns a plan token with an honest pre-flight breakdown, executeLocalDeletion commits it
- Class: failure-visibility
- Status: active
- Description: Two-phase deletion: prepareLocalDeletion returns a plan token with an honest pre-flight breakdown, executeLocalDeletion commits it
- Why it matters: Deletion is irreversible; a single-call delete with a force flag gives no way to show the user exactly what is about to happen, and a stale multi-select could silently delete the wrong set
- Source: inferred
- Primary owning slice: M001/S06
- Validation: mapped
- Notes: Breakdown reports how many synced, how many unsynced-and-warned, how many unknown-and-refused. Outcomes are per-file, never all-or-nothing. local_deletion_overlay records only actual successes so the catalog never claims a deletion that did not happen.

### R014 — Image preview from any view
- Class: core-capability
- Status: active
- Description: Image preview from any view
- Why it matters: Deciding whether a photo is worth keeping requires seeing it; a thumbnail grid alone is not enough to commit to an irreversible delete
- Source: user
- Primary owning slice: M001/S05
- Validation: mapped
- Notes: Images only for v1; video and documents are explicitly out of scope. Uses getLocalImageHandle, which reads local storage only and never downloads remote file content.

### R015 — Reopen behaviour: local side auto-refreshes, remote listing stays cached, and remote listing age is visible near any delete action
- Class: continuity
- Status: active
- Description: Reopen behaviour: local side auto-refreshes, remote listing stays cached, and remote listing age is visible near any delete action
- Why it matters: New photos taken since the last scan are exactly the ones the user wants flagged, so the cheap local re-stat runs automatically; but a stale remote listing plus an irreversible delete is a genuine hazard, so its age must be in front of the user at the moment of decision
- Source: user
- Primary owning slice: M001/S03
- Supporting slices: M001/S06
- Validation: mapped
- Notes: Remote listing is the expensive half and stays cached until an explicit rescan. Past a 7-day staleness threshold the app suggests a rescan rather than blocking; the threshold is a tunable default, not a hard rule.

### R016 — Rescan from scratch available as a first-class control, not a hidden setting
- Class: operability
- Status: active
- Description: Rescan from scratch available as a first-class control, not a hidden setting
- Why it matters: Cached remote state will drift; the user needs an obvious way to force a full re-check before acting on deletions
- Source: user
- Primary owning slice: M001/S03
- Validation: mapped
- Notes: Distinct from the automatic local refresh on open. Produces a new scan_run with a fresh generation and a new snapshot.

### R017 — Partial scans are visibly partial: affected files become UNKNOWN with an issueCode and the run reports an honest completion summary
- Class: failure-visibility
- Status: active
- Description: Partial scans are visibly partial: affected files become UNKNOWN with an issueCode and the run reports an honest completion summary
- Why it matters: A partial scan that looks indistinguishable from a clean one is the worst possible outcome for an app whose output drives irreversible deletion
- Source: user
- Primary owning slice: M001/S03
- Validation: mapped
- Notes: A scan never aborts wholesale on an unreadable directory or a dropped connection. Summary states plainly how many files could not be checked. UNKNOWN entries are refused by prepareLocalDeletion.

### R018 — Typed error envelopes with stable machine-readable codes and redacted actionable messages across the whole native boundary
- Class: failure-visibility
- Status: active
- Description: Typed error envelopes with stable machine-readable codes and redacted actionable messages across the whole native boundary
- Why it matters: The UI must be able to distinguish auth rejection from host unreachable from stale page token in order to offer the right recovery, and no error path may leak credentials or raw paths
- Source: inferred
- Primary owning slice: M001/S01
- Validation: mapped
- Notes: CloudSyncContracts.ts already defines the envelope shape and CloudSyncErrorCode set. No thrown exceptions cross the bridge. NATIVE_MODULE_UNAVAILABLE renders a hard error screen with no mock fallback.

### R019 — Installable debug and release APK that launches and runs the full loop on API 31 and API 36
- Class: launchability
- Status: active
- Description: Installable debug and release APK that launches and runs the full loop on API 31 and API 36
- Why it matters: Distribution is local APK only; if it does not install and run on both API levels the user has nothing they can actually use
- Source: user
- Primary owning slice: M001/S07
- Validation: mapped
- Notes: No Play Store, no signing pipeline, no CI. Requires MainApplication.kt to register the CloudSync package so the TurboModule resolves at runtime.

### R020 — Maestro e2e flows prove every user-visible claim against live protocol containers on both API levels
- Class: quality-attribute
- Status: active
- Description: Maestro e2e flows prove every user-visible claim against live protocol containers on both API levels
- Why it matters: The user set this as the proof bar, including for deletion; component tests with a mocked TurboModule are supporting evidence and never the proof
- Source: user
- Primary owning slice: M001/S07
- Supporting slices: M001/S02, M001/S03, M001/S04, M001/S05, M001/S06
- Validation: mapped
- Notes: Maestro 2.10.0 is installed and wired into android-flow.sh e2e, which runs maestro test on validation/maestro. That directory does not exist yet; the first slice needing a flow creates it. Deletion proof must remove a real file from real device storage, not a mocked DocumentFile.delete().

### R021 — Material 3 via react-native-paper only, no ad-hoc inline styles, defined spacing and density scale, accessibility labels on every interactive element
- Class: quality-attribute
- Status: active
- Description: Material 3 via react-native-paper only, no ad-hoc inline styles, defined spacing and density scale, accessibility labels on every interactive element
- Why it matters: The user asked for a slick and modern design and will judge the aesthetics personally; the mechanical parts of that can be enforced, and a11y labels are also what Maestro uses as selectors so the rule is self-enforcing
- Source: user
- Primary owning slice: M001/S04
- Supporting slices: M001/S05, M001/S06
- Validation: mapped
- Notes: Aesthetic judgement is explicitly left to human UAT on a real device at milestone end. No test pretends to score "slick".

### R022 — Docs under ./docs updated in the same slice as the change, and a user-focused README
- Class: operability
- Status: active
- Description: Docs under ./docs updated in the same slice as the change, and a user-focused README
- Why it matters: Stated in the user's constitution: documentation must be kept in sync, and the README must lead with user-focused instructions
- Source: user
- Primary owning slice: M001/S07
- Supporting slices: M001/S01, M001/S02, M001/S03, M001/S04, M001/S05, M001/S06
- Validation: mapped
- Notes: Per-slice, not batched at the end. S07 owns final coherence of the doc set.

## Validated

## Deferred

### R023 — Checksum verification as an optional stricter match mode
- Class: quality-attribute
- Status: deferred
- Description: Checksum verification as an optional stricter match mode
- Why it matters: Name plus size plus mtime can theoretically collide; a content hash would make deletion safety airtight
- Source: user
- Validation: unmapped
- Notes: Deferred because it requires downloading remote file content, which v1 explicitly forbids, and would make scans dramatically more expensive over FTP.

### R024 — Multiple connection profiles and per-folder remote root mapping
- Class: core-capability
- Status: deferred
- Description: Multiple connection profiles and per-folder remote root mapping
- Why it matters: A user with both a home NAS and a work server would eventually want to check folders against different targets
- Source: user
- Validation: unmapped
- Notes: User explicitly scoped v1 to one remote server and one remote root for all folders.

### R025 — Background or scheduled scanning with notification
- Class: operability
- Status: deferred
- Description: Background or scheduled scanning with notification
- Why it matters: Long scans would not require the user to keep the app open
- Source: user
- Validation: unmapped
- Notes: User chose foreground app only with visible progress for v1. Background work would add foreground-service lifecycle, doze handling, and notification permissions.

## Out of Scope

### R026 — No remote mutation of any kind: no upload, no remote delete, no download of remote file content
- Class: anti-feature
- Status: out-of-scope
- Description: No remote mutation of any kind: no upload, no remote delete, no download of remote file content
- Why it matters: Prevents scope confusion with backup/sync tools; the app is a read-only checker whose only write action is local deletion
- Source: user
- Validation: n/a
- Notes: The scaffold's NativeCloudSync spec comment already states the foundation ships no remote mutation and no remote file-content download, and that later features must preserve that boundary.

### R027 — No cloud-drive SDKs such as Google Drive, Dropbox, or S3; protocol-level FTP, SFTP, and WebDAV only
- Class: anti-feature
- Status: out-of-scope
- Description: No cloud-drive SDKs such as Google Drive, Dropbox, or S3; protocol-level FTP, SFTP, and WebDAV only
- Why it matters: Each SDK brings its own auth model and would balloon scope well past the protocol abstraction the user asked for
- Source: user
- Validation: n/a
- Notes: User specified FTP, sFTP, and WebDAV explicitly.

### R028 — No key-based auth, OAuth, or token auth
- Class: anti-feature
- Status: out-of-scope
- Description: No key-based auth, OAuth, or token auth
- Why it matters: Keeps the credential surface to exactly one shape, which is what the Keystore boundary and the schema test are built around
- Source: user
- Validation: n/a
- Notes: User answered "Username and password only" for v1 auth scope. Note this also sidesteps the SSHJ SSH-agent caveat that would need a Java 16+ runtime.

### R029 — No non-image preview: no video, no documents
- Class: anti-feature
- Status: out-of-scope
- Description: No non-image preview: no video, no documents
- Why it matters: Video and document rendering each bring their own decoding and viewer stack for no gain on the primary photo-clearing loop
- Source: user
- Validation: n/a
- Notes: User specified "Preview a file (image only)".

### R030 — No Play Store distribution, signing pipeline, or CI
- Class: anti-feature
- Status: out-of-scope
- Description: No Play Store distribution, signing pipeline, or CI
- Why it matters: Distribution is a local APK for the user's own device; release engineering would be pure overhead at this stage
- Source: user
- Validation: n/a
- Notes: User answered "Local debug/release APK" for distribution. Codebase brief confirms no CI exists today.

## Traceability

| ID | Class | Status | Primary owner | Supporting | Proof |
| --- | --- | --- | --- | --- | --- |
| R001 | core-capability | active | M001/S01 | none | mapped |
| R002 | compliance/security | active | M001/S01 | none | mapped |
| R003 | compliance/security | active | M001/S01 | none | mapped |
| R004 | core-capability | active | M001/S01 | none | mapped |
| R005 | core-capability | active | M001/S02 | none | mapped |
| R006 | primary-user-loop | active | M001/S03 | none | mapped |
| R007 | core-capability | active | M001/S03 | none | mapped |
| R008 | primary-user-loop | active | M001/S04 | none | mapped |
| R009 | primary-user-loop | active | M001/S04 | none | mapped |
| R010 | primary-user-loop | active | M001/S05 | none | mapped |
| R011 | primary-user-loop | active | M001/S04 | M001/S05 | mapped |
| R012 | primary-user-loop | active | M001/S06 | none | mapped |
| R013 | failure-visibility | active | M001/S06 | none | mapped |
| R014 | core-capability | active | M001/S05 | none | mapped |
| R015 | continuity | active | M001/S03 | M001/S06 | mapped |
| R016 | operability | active | M001/S03 | none | mapped |
| R017 | failure-visibility | active | M001/S03 | none | mapped |
| R018 | failure-visibility | active | M001/S01 | none | mapped |
| R019 | launchability | active | M001/S07 | none | mapped |
| R020 | quality-attribute | active | M001/S07 | M001/S02, M001/S03, M001/S04, M001/S05, M001/S06 | mapped |
| R021 | quality-attribute | active | M001/S04 | M001/S05, M001/S06 | mapped |
| R022 | operability | active | M001/S07 | M001/S01, M001/S02, M001/S03, M001/S04, M001/S05, M001/S06 | mapped |
| R023 | quality-attribute | deferred | none | none | unmapped |
| R024 | core-capability | deferred | none | none | unmapped |
| R025 | operability | deferred | none | none | unmapped |
| R026 | anti-feature | out-of-scope | none | none | n/a |
| R027 | anti-feature | out-of-scope | none | none | n/a |
| R028 | anti-feature | out-of-scope | none | none | n/a |
| R029 | anti-feature | out-of-scope | none | none | n/a |
| R030 | anti-feature | out-of-scope | none | none | n/a |

## Coverage Summary

- Active requirements: 22
- Mapped to slices: 22
- Validated: 0
- Unmapped active requirements: 0
