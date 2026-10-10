# Feature Specification: Full-Loop Integration, Docs and Release APK

**Feature Branch**: `011-full-loop-release`

**Created**: 2026-09-28 (seeded from milestone slice M001/S07)

**Status**: Draft (seeded)

**Numbering**: Moved from slot 010 to 011 on 2026-10-10 to put E2E performance work next.

**Input**: Roadmap slice M001/S07, "Full-loop integration, docs, and release APK" (`risk:medium`,
`depends:[S01,S02,S03,S04,S05,S06]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [002-native-cloudsync-connect](../002-native-cloudsync-connect/spec.md) (complete),
[003-local-source-selection](../003-local-source-selection/spec.md),
[004-scan-engine-matching](../004-scan-engine-matching/spec.md),
[005-gallery-list-filtering](../005-gallery-list-filtering/spec.md),
[006-mvp](../006-mvp/spec.md),
[007-sort-scroll-remote-folders](../007-sort-scroll-remote-folders/spec.md) and
[009-tree-view-image-preview](../009-tree-view-image-preview/spec.md). Feature
[010](../010-multiselect-local-deletion/spec.md) was merged into 006.

## Dependencies (integration closure)

Consumes from all prior features (M001/S01–S06 → M001/S07): the assembled loop, namely

- the registered `CloudSync` TurboModule and the live FTP, SFTP and WebDAV protocol clients (feature 002);
- persisted local sources with durable SAF grants (feature 003);
- a completed snapshot with SYNCED, UNSYNCED and UNKNOWN statuses (feature 004);
- the Connect (repository) screen, first-run guidance and the installable APK build (feature 006);
- the three browsable views, gallery and list (feature 005) and tree with preview (feature 009);
- multi-select with the selection size, and two-phase local deletion with per-file outcomes (feature 006,
  which absorbed feature 010).

This feature exercises that loop end to end on both API 31 and API 36, and documents it in `./docs` and
`README.md`.

### Items to specify (handed over by earlier features)

Settle these when this feature is specified:

- **The include-hidden-files setting**: `getSettings` / `setIncludeHidden`, reassigned from feature 005
  ([005 spec, Dependencies](../005-gallery-list-filtering/spec.md#dependencies)). Both still return
  `NOT_IMPLEMENTED`, and scans run with `includeHidden = false`
  ([004 research R8](../004-scan-engine-matching/research.md#r8-hidden-files)).
- **Snapshot retention**: published snapshots are never pruned, and every app open publishes a
  `LOCAL_REFRESH` snapshot, so the scan store grows over time. Decide how many snapshots to keep (for
  example the last N) ([005 plan, Risks](../005-gallery-list-filtering/plan.md#risks)).
  Whatever is decided MUST keep the active snapshot's `remote_match_key` rows, including their
  `directories` column (schema version 4, feature 006): the pre-delete server re-check reads the server
  folders of each selected file from them, and a key without them is refused as `SCAN_TOO_OLD`
  ([D020](../../docs/decisions/0020-pre-delete-server-recheck.md)). A `LOCAL_REFRESH` copies the keys
  forward, so pruning older snapshots is safe as long as the active one keeps its keys.
  It MUST also keep the active snapshot's `remote_ambiguity` rows with their `remotePath` column (schema
  version 5, feature 007; spec follow-up, 2026-10-07): they record which configured remote folders could
  not be read, so the scan summary's unread-folder warning and the `REMOTE_FOLDER_UNREAD` reasons survive
  until a full scan reads every folder, and a `LOCAL_REFRESH` copies them forward
  ([D022](../../docs/decisions/0022-several-remote-folders-partial-scan.md)). Keeping the active snapshot
  whole already does this.

### Already delivered by feature 006 (spec follow-up, 2026-10-02)

Feature [006-mvp](../006-mvp/spec.md) ships parts this feature originally expected to build. Extend them
here rather than re-creating them:

- **Release-smoke mode.** `pnpm e2e:android:release-smoke` (`android-flow.sh release-smoke`) builds the
  release APK with `pnpm assemble:release` and a throwaway key, checks the signing failure without a key,
  the `package.json` version (`aapt2 dump badging`) and the absence of debug deep links, installs it with
  no Metro, runs `mvp/90-release-smoke` and checks an in-place update with `mvp/91-release-update`. It
  runs on API 31; this feature adds API 36 (FR-001, FR-004, SC-002, SC-004).
- **Release signing.** A personal key from `SYNCSCOPE_RELEASE_*` Gradle properties, with no debug-key
  fallback ([D021](../../docs/decisions/0021-release-signing-and-cleartext-policy.md)).
- **WebDAV over HTTPS.** The repository's `webdavHttps` flag, `TLS_UNTRUSTED` for an untrusted
  certificate, and release builds that allow user-chosen cleartext (D021).
- **Version derivation.** FR-004 moved to 006 FR-022 (recorded below).
- **The repository screen and the deletion flows**, which this feature's full-loop flow drives through
  the UI on both API levels.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run the whole loop on a real device build (Priority: P1)

The user installs the APK on their own device, connects to their server, picks folders, scans, filters and
browses the results, selects files and deletes the ones that are safely backed up, on both supported
Android API levels.

**Why this priority**: this is the first point at which the app is usable by the person it is built for;
every earlier feature is a part of this loop.

**Independent Test**: `pnpm e2e:android` is green on API 31 and API 36 for the complete loop against live
protocol containers, and the release APK installs and runs (slice demo).

**Acceptance Scenarios** (from the slice demo and its definition of operational completeness):

1. **Given** live protocol containers and an emulator on API 31, **When** `pnpm e2e:android` runs,
   **Then** the complete loop (connect, pick folders, scan, filter, browse, select, delete) is green.
2. **Given** the same containers and an emulator on API 36, **When** `pnpm e2e:android` runs, **Then** the
   same complete loop is green.
3. **Given** a release APK build, **When** it is installed on API 31 and on API 36, **Then** it installs,
   launches and runs the loop.
4. **Given** the assembled app, **When** any method a feature claims to own is called, **Then** no
   `NOT_IMPLEMENTED` envelope is returned.
5. **Given** the finished feature, **When** a user reads `README.md` and `./docs`, **Then** the README
   leads with user-focused instructions and `./docs` is coherent and current with the shipped behaviour.

### Edge Cases

- SAF grants survive process death, and a grant revoked between sessions is detected on open (feature 003
  behaviour, proven here end to end).
- A backgrounded scan stops cleanly without promoting a partial snapshot (feature 004 behaviour, proven
  here end to end).
- The e2e proof is never a component test with a mocked TurboModule, and the deletion proof removes a real
  file from real device storage, per [D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md).

## Requirements *(mandatory)*

### Functional Requirements

The existing wording of R019, R020 and R022 already covers API 36, so they are cited here as they stand
and no duplicate FR is added for API 36.

- **FR-001** (R019, launchability): An installable debug and release APK MUST launch and run the full loop
  on API 31 and API 36. Distribution is local APK only: no Play Store, no signing pipeline, no CI. It
  relies on `MainApplication.kt` registering the `CloudSync` package so the TurboModule resolves at
  runtime (delivered by feature 002).
- **FR-002** (R020, quality-attribute): Maestro e2e flows MUST prove every user-visible claim against live
  protocol containers on both API levels. Component tests with a mocked TurboModule are supporting
  evidence, never the proof. The deletion proof MUST remove a real file from real device storage, not a
  mocked `DocumentFile.delete()`, per [D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md).
- **FR-003** (R022, operability): Docs under `./docs` MUST be updated in the same change as each
  behaviour change, and `README.md` MUST be user-focused. Updates happen per feature, not batched at the
  end; this feature owns the final coherence of the doc set.
- **FR-004** (constitution Principle VI, versioning): **Moved to [006-mvp](../006-mvp/spec.md) FR-022**
  (2026-10-02 analysis), because 006 ships the first APK meant for a real device. This feature keeps the
  check that the release APK still reports the `package.json` version on API 36.

### Key Entities

- **Release APK**: the locally built, installable release variant of the app, carrying a version derived
  from `package.json`.
- **Full-loop e2e flow**: the Maestro flow set under `validation/maestro/` that drives connect, pick
  folders, scan, filter, browse, select and delete against live containers on each API level.

## Provides

The finished v1: the assembled, documented loop, proven end to end on API 31 and API 36, and a release APK
the user can install on their own device.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `pnpm e2e:android` exits 0 on API 31 and on API 36 for the complete loop against live
  containers.
- **SC-002**: The release APK installs and launches on both API levels.
- **SC-003**: No method a feature claims to own returns `NOT_IMPLEMENTED`.
- **SC-004**: The APK's `versionName` equals the `package.json` version on API 31 and API 36 (the
  derivation and its test ship in 006).
- **SC-005**: `README.md` leads with user-focused instructions, and `./docs` describes the shipped
  behaviour.

## Assumptions

- Distribution stays local APK only (R019 notes); a signing pipeline and CI are out of scope.
- The app performs no remote mutation of any kind (R026, [scope](../../docs/scope.md)).
