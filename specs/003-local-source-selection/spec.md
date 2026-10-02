# Feature Specification: Local Source Selection via SAF

**Feature Branch**: `003-local-source-selection`

**Created**: 2026-09-28 (seeded from milestone slice M001/S02)

**Status**: Planned (clarified 2026-09-28; [plan](./plan.md) and [tasks](./tasks.md) generated 2026-09-28)

**Input**: Roadmap slice M001/S02, "Local source selection via SAF" (`risk:medium`, `depends:[S01]`).

**Depends on**: [002-native-cloudsync-connect](../002-native-cloudsync-connect/spec.md) (complete).

## Dependencies

Consumes from feature 002 (M001/S01 → M001/S02):

- A registered `CloudSyncPackage`, so `TurboModuleRegistry.get('CloudSync')` resolves at runtime.
- The typed envelope layer and the pattern of replacing a `NOT_IMPLEMENTED` method with a real one.
- The Room scan store, including the `source_root` table with its unique `canonicalRoot` index
  (`index_source_root_canonicalRoot`).

## Clarifications

### Session 2026-09-28

- Q: When the user picks a folder that is already a source, or one nested in or containing an existing source, what happens? → A: Reject exact duplicates and any nested or containing folder, with a message naming the conflicting source.
- Q: What can the user do with an unavailable source, and how does a scan treat it? → A: Re-grant via the picker (must resolve to the same `canonicalRoot`) or remove it; scans skip it and report it as skipped.
- Q: How is a source's display alias set? → A: Auto-generated, not editable in v1: folder name, plus volume or parent folder only when needed for uniqueness.
- Q: What happens to a removed source's permission and saved scan data? → A: After confirmation, release the SAF permission and delete the `source_root` row and all its scan data in one transaction.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Choose the local folders to check (Priority: P1)

The user taps Add folder, picks folders through the Android system picker, including removable storage,
and the chosen sources persist across an app restart. A grant revoked between sessions shows the source
as unavailable rather than silently disappearing.

**Why this priority**: the selected folders are the entire input side of the app; without persistent
multi-folder selection there is nothing to scan.

**Independent Test**: a Maestro flow on both API 31 and API 36 (slice demo).

**Acceptance Scenarios** (from the slice demo):

1. **Given** no sources, **When** the user taps Add folder and picks a folder through the system picker,
   **Then** the folder is listed as a source.
2. **Given** removable storage is present, **When** the user picks a folder on it, **Then** it is accepted
   as a source like on-device storage.
3. **Given** saved sources, **When** the app is restarted, **Then** the same sources are listed.
4. **Given** a source whose grant was revoked between sessions, **When** the app opens, **Then** the
   source is shown as unavailable rather than disappearing.
5. **Given** an unavailable source, **When** the user chooses Re-grant and picks the same folder, **Then**
   the source becomes available again with its original identity and alias.
6. **Given** an unavailable source, **When** the user chooses Re-grant and picks a different folder,
   **Then** the re-grant is rejected and the source stays unavailable.
7. **Given** the flows above, **When** they run under Maestro, **Then** they pass on both API 31 and
   API 36.

### Edge Cases

- The same folder picked twice, or a folder nested in or containing an existing source: the pick is
  rejected, nothing is persisted, and the user sees a message naming the conflicting source (FR-002).
- The user cancels the system picker: nothing is persisted and the source list is unchanged.
- Removable storage behaving differently on API 36 than on API 31: surface the limitation explicitly
  rather than silently degrading (open question from the milestone discussion).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R005, core-capability): Users MUST be able to select local folders from on-device and
  removable storage via the Android Storage Access Framework. Sources MUST persist across restart in
  `source_root` with a unique `canonicalRoot`, and a revoked SAF grant MUST surface as unavailable rather
  than vanishing. Behaviour differs materially between API 31 and API 36, so both MUST be exercised. The
  selected folders are the entire input side of the app.
- **FR-002**: Sources MUST NOT overlap. A pick whose `canonicalRoot` equals, is nested in, or contains an
  existing source's `canonicalRoot` (same volume, path-prefix comparison) MUST be rejected with a typed
  error naming the conflicting source, and MUST NOT create a `source_root` row.
- **FR-003**: An unavailable source MUST offer two actions: Re-grant, which reopens the picker and
  accepts only a folder resolving to the same `canonicalRoot` (keeping `sourceId` and alias), and Remove.
  The local enumeration contract MUST report an unavailable source as skipped, never as empty. This
  feature proves that contract; continuing a scan over the remaining sources and surfacing the skipped one
  is feature 004's behaviour, built on it.
- **FR-004**: Each source's `alias` MUST be generated when the source is added and MUST NOT be editable in
  v1. It is the folder's display name, extended with the volume label (for example "SD card") and then
  the parent folder name only as far as needed to be unique among current sources. A stored alias stays
  stable: adding or removing other sources, or a Re-grant, does not change it.
- **FR-005**: Removing a source MUST require user confirmation. On confirmation, `removeSource` MUST
  release the persisted SAF URI permission, and delete the `source_root` row together with all scan data
  referencing that source, in one transaction. Cancelling leaves everything unchanged. Removal also works
  for an unavailable source, whose grant may already be gone.

Supporting requirements (primary FR in another feature):

- R020 (feature 009): this feature's user-visible claims are proven by a Maestro flow against a real
  emulator; this feature creates `validation/maestro/` and sets the selector and assertion conventions
  later flows follow ([D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md)).
- R022 (feature 009): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **SourceRoot** (`source_root`): a selected folder with its tree URI, authority, volume, document path,
  unique non-overlapping `canonicalRoot`, generated unique alias (FR-004), write capability and time
  added, plus a durable SAF URI grant.
- **Availability** (computed, not stored): "unavailable" in this spec means one of two states, shown to
  the user as **Access lost** (`GRANT_REVOKED`: the SAF grant is gone) or **Storage missing**
  (`STORAGE_MISSING`: the grant exists but the folder or its volume cannot be reached). Otherwise the
  source is **Available** (`AVAILABLE`). See [data-model.md](./data-model.md#availability-computed-on-read-not-stored).

## Provides

To feature 004 (scan engine and matching, M001/S02 → M001/S03):

- Persisted `source_root` rows with unique `canonicalRoot` and a durable SAF URI grant per selected folder.
- Real implementations of `listSources`, `launchSourcePicker` and `removeSource`.
- A local enumeration contract that returns either `Available`, yielding name, size and modified time per
  file under a source, or `Skipped(reason)` when the source is unavailable (grant revoked or storage
  missing), never an empty listing.
- `validation/maestro/` created, with the first flow establishing the selector and assertion conventions
  later flows follow.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro source-selection flow passes on API 31 and API 36 against a real emulator.
- **SC-002**: A source survives an app restart, and a revoked grant is reported as unavailable, in 100% of
  flow runs.

## Assumptions

- One remote root applies to all selected folders (see `docs/scope.md`, R024 deferred).
- Folder access goes through SAF only; no raw local path operation crosses the bridge.
