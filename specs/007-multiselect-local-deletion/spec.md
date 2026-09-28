# Feature Specification: Multi-Select and Two-Phase Local Deletion

**Feature Branch**: `007-multiselect-local-deletion`

**Created**: 2026-09-28 (seeded from milestone slice M001/S06)

**Status**: Draft (seeded)

**Input**: Roadmap slice M001/S06, "Multi-select and two-phase local deletion" (`risk:high`,
`depends:[S04,S05]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [005-gallery-list-filtering](../005-gallery-list-filtering/spec.md) and
[006-tree-view-image-preview](../006-tree-view-image-preview/spec.md).

## Dependencies

Consumes from feature 005 (M001/S04 → M001/S06):

- A view-agnostic selection model holding `entryId` sets across gallery, list and tree.
- Status-aware rendering that distinguishes SYNCED, UNSYNCED and UNKNOWN entries before any delete is
  attempted.

Consumes from feature 006 (M001/S05 → M001/S06):

- Multi-select in tree view and preview, completing selection parity across all three views.
- `getLocalImageHandle` and the local-content-read path.

Consumes from feature 004: the remote listing's age (R015) to show at the point of decision.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Delete the files that are safely backed up (Priority: P1)

The user multi-selects files in any view, sees a pre-flight breakdown naming how many are synced, how many
are unsynced and warned, and how many are unknown and refused, confirms, and real files disappear from real
device storage, with per-file outcomes reported.

**Why this priority**: this is the payoff of the whole app, which exists "to discover files that are
synced and can be safely deleted".

**Independent Test**: a Maestro flow that deletes real files from real device storage (slice demo). A
mocked `DocumentFile.delete()` does not count as proof.

**Acceptance Scenarios** (from the slice demo):

1. **Given** files selected in gallery, list or tree, **When** the user asks to delete them, **Then** a
   pre-flight breakdown states how many are synced, how many are unsynced and warned, and how many are
   unknown and refused.
2. **Given** a selection containing UNKNOWN files, **When** the user confirms, **Then** the UNKNOWN files
   are refused outright, not merely warned.
3. **Given** a selection containing UNSYNCED files, **When** the user proceeds, **Then** a stronger
   warning is required before they are deleted.
4. **Given** a confirmed plan, **When** it executes, **Then** the real files disappear from device storage,
   per-file outcomes are reported, and the catalog reflects only the deletions that actually happened.
5. **Given** the confirmation screen, **When** it is shown, **Then** the remote listing's age is visible
   at the point of decision.

### Edge Cases

- A file already gone, a permission denied, or a SAF grant revoked between prepare and execute: each is
  reported per file, never all-or-nothing.
- A stale selection: the plan token ties execution to exactly the set the user confirmed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R012, primary-user-loop): Users MUST be able to multi-select from any of the three views and
  delete locally only: synced files by default, unsynced files allowed behind a stronger warning, and
  UNKNOWN files refused outright, per [D006](../../docs/decisions/0006-unknown-status-never-deletable.md).
  The app never deletes anything remote. UNKNOWN is refused even behind a warning because the remote state
  genuinely was not established.
- **FR-002** (R013, failure-visibility): Deletion MUST be two-phase: `prepareLocalDeletion` returns a plan
  token with an honest pre-flight breakdown (synced, unsynced-and-warned, unknown-and-refused), and
  `executeLocalDeletion(planToken)` commits it with per-file outcomes. `local_deletion_overlay` records
  only actual successes, so the catalog never claims a deletion that did not happen, per
  [D008](../../docs/decisions/0008-two-phase-local-deletion.md). Deletion is irreversible, and a
  single-call delete could silently delete a stale selection.

Supporting requirements (primary FR in another feature):

- R015 (feature 004): the remote listing's age is visible near any delete action, with a rescan suggested
  past the staleness threshold.
- R021 (feature 005): selection and confirmation UI follow the Material 3 shell and accessibility labels.
- R022 (feature 008): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **DeletionPlan**: a plan token plus the breakdown of synced, unsynced-warned and unknown-refused entries.
- **LocalDeletionOverlay** (`local_deletion_overlay`): per-entry deletion outcomes, recording successes
  only, so the current snapshot reflects deletions without a rescan.

## Provides

To feature 008 (full loop and release, M001/S06 → M001/S07):

- Real `prepareLocalDeletion` returning a plan token plus a breakdown of synced, unsynced-warned and
  unknown-refused counts.
- Real `executeLocalDeletion(planToken)` with per-file outcomes written to `local_deletion_overlay` on
  success only.
- The remote-listing-age surface rendered at the point of deletion decision.
- A Maestro flow proving real files are removed from real device storage.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro deletion flow removes real files from real device storage and the catalog
  reflects it.
- **SC-002**: No UNKNOWN entry is ever deleted.
- **SC-003**: `local_deletion_overlay` never records a deletion that did not happen.

## Assumptions

- Local deletion is the app's only write action; no remote mutation of any kind (R026, `docs/scope.md`).
