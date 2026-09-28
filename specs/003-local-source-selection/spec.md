# Feature Specification: Local Source Selection via SAF

**Feature Branch**: `003-local-source-selection`

**Created**: 2026-09-28 (seeded from milestone slice M001/S02)

**Status**: Draft (seeded)

**Input**: Roadmap slice M001/S02, "Local source selection via SAF" (`risk:medium`, `depends:[S01]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [002-native-cloudsync-connect](../002-native-cloudsync-connect/spec.md) (complete).

## Dependencies

Consumes from feature 002 (M001/S01 → M001/S02):

- A registered `CloudSyncPackage`, so `TurboModuleRegistry.get('CloudSync')` resolves at runtime.
- The typed envelope layer and the pattern of replacing a `NOT_IMPLEMENTED` method with a real one.
- The Room scan store, including the `source_root` table with its unique `canonicalRoot` index
  (`index_source_root_canonicalRoot`).

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
5. **Given** the flows above, **When** they run under Maestro, **Then** they pass on both API 31 and
   API 36.

### Edge Cases

- The same folder picked twice (the unique `canonicalRoot` applies).
- Removable storage behaving differently on API 36 than on API 31: surface the limitation explicitly
  rather than silently degrading (open question from the milestone discussion).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R005, core-capability): Users MUST be able to select local folders from on-device and
  removable storage via the Android Storage Access Framework. Sources MUST persist across restart in
  `source_root` with a unique `canonicalRoot`, and a revoked SAF grant MUST surface as unavailable rather
  than vanishing. Behaviour differs materially between API 31 and API 36, so both MUST be exercised. The
  selected folders are the entire input side of the app.

Supporting requirements (primary FR in another feature):

- R020 (feature 008): this feature's user-visible claims are proven by a Maestro flow against a real
  emulator; this feature creates `validation/maestro/` and sets the selector and assertion conventions
  later flows follow ([D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md)).
- R022 (feature 008): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **SourceRoot** (`source_root`): a selected folder with its tree URI, authority, volume, document path,
  unique `canonicalRoot`, alias, write capability and time added, plus a durable SAF URI grant.

## Provides

To feature 004 (scan engine and matching, M001/S02 → M001/S03):

- Persisted `source_root` rows with unique `canonicalRoot` and a durable SAF URI grant per selected folder.
- Real implementations of `listSources`, `launchSourcePicker` and `removeSource`.
- A local enumeration contract yielding name, size and modified time per file under a source, plus an
  availability flag when a grant has been revoked.
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
