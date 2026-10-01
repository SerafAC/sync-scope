# Feature Specification: Gallery View, Browsable List, Filtering and Material 3 Shell

**Feature Branch**: `005-gallery-list-filtering`

**Created**: 2026-09-28 (seeded from milestone slice M001/S04)

**Status**: Draft (seeded)

**Input**: Roadmap slice M001/S04, "Gallery view, browsable list, filtering, and Material 3 shell"
(`risk:medium`, `depends:[S03]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [004-scan-engine-matching](../004-scan-engine-matching/spec.md).

## Dependencies

Consumes from feature 004 (M001/S03 → M001/S04):

- A completed `snapshot` with populated `local_node` rows carrying `status` and `issueCode`.
- Working `queryFiles(snapshotId, querySpec, pageToken)` with bounded pages, first-page `counts`, the
  `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN` filter and the sort options.
- Working `startScan`, `cancelScan` and `getScanState`.
- The active-snapshot invariant and a readable remote-listing age.
- Working `queryTreeChildren` with `parentId` and `kind` on every `local_node` row (M001/S03 → M001/S05,
  used here by the browsable list).

**Proposed ownership (to confirm in `/speckit-clarify`)**: this feature is the proposed owner of
`getSettings` / `setIncludeHidden`, the include-hidden-files setting. Feature 004 scans with
`includeHidden = false` and leaves both methods `NOT_IMPLEMENTED`
([004 research R8](../004-scan-engine-matching/research.md#r8-hidden-files)). Confirm or reassign the
ownership here.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse and filter the scan results (Priority: P1)

The user browses a virtualized gallery grid of the snapshot, switches filter chips between all, synced,
unsynced and issues-unknown with counts that agree with the snapshot, sees origin badges on duplicate tiles
naming the originating local folder, and navigates into and back out of directories in list view via
breadcrumb.

**Why this priority**: isolating the synced set is how the user finds what can be deleted, and isolating
the unknown set is how they avoid deleting what was never checked.

**Independent Test**: a Maestro flow (slice demo).

**Acceptance Scenarios** (from the slice demo):

1. **Given** a completed snapshot of thousands of files, **When** the user opens the gallery, **Then** a
   virtualized grid renders it through paged reads.
2. **Given** the gallery, **When** the user switches between the all, synced, unsynced and issues-unknown
   chips, **Then** the shown files and the chip counts agree with the snapshot.
3. **Given** two identical-looking files from different local folders, **When** they appear in the
   gallery, **Then** each tile carries an origin badge naming its originating local folder; an unambiguous
   tile carries no badge.
4. **Given** list view, **When** the user descends into a directory and then uses the breadcrumb, **Then**
   they navigate into and back out of directories.
5. **Given** any interactive element, **When** Maestro selects it, **Then** it is addressable by its
   accessibility label.

### Edge Cases

- A filter that leaves a directory empty in list view (the tree-view rule is feature 006's open detail).
- A page token from an older snapshot generation (`STALE_GENERATION` recovery).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R008, primary-user-loop): The gallery view MUST be a flat virtualized grid over the snapshot,
  with an origin badge shown only on duplicates. The badge shows the originating local folder, never the
  remote path, and reads use paged `queryFiles`, per
  [D010](../../docs/decisions/0010-snapshot-paging-and-origin-badge.md). A flat grid has no path context, so
  identical-looking tiles need a badge answering "which of my folders is this from".
- **FR-002** (R009, primary-user-loop): The list view MUST be a browsable directory listing with navigation
  down into folders and back up via breadcrumb, not a flattened dump of every file. It uses
  `queryTreeChildren` with `parentId` and shows name, size, modified time and sync status, with no origin
  badge. The path the user navigated is the origin context.
- **FR-003** (R011, primary-user-loop): Filtering MUST offer all, synced, unsynced and issues-unknown, and
  filter state MUST apply consistently across gallery, list and tree. `FileFilter` in
  `src/native/CloudSyncContracts.ts` already carries `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN`. The
  whole point of the app is isolating the synced set for deletion and the unknown set so it is never
  deleted.
- **FR-004** (R021, quality-attribute): The UI MUST use Material 3 via `react-native-paper` only, with no
  ad-hoc inline styles, a defined spacing and density scale, and accessibility labels on every interactive
  element. Accessibility labels are also the Maestro selectors, so the rule is self-enforcing. Aesthetic
  judgement ("slick and modern") is left to human acceptance on a real device, not to a test.

Supporting requirements (primary FR in another feature):

- R020 (feature 008): the browse and filter loop is proven by a Maestro flow.
- R022 (feature 008): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **FileQuery**: filter, view, sort, source, parent, search and page size over one snapshot.
- **FilePage**: a bounded page of entries, an opaque page token, and first-page counts per status.
- **SelectionModel**: the view-agnostic set of selected `entryId`s (provided to feature 007).

## Provides

To feature 006 (tree view and preview, M001/S04 → M001/S05):

- The Material 3 shell: theme, spacing and density scale, filter-chip component, and the
  accessibility-label convention Maestro selectors depend on.
- A shared paged-query hook wrapping `queryFiles` and `queryTreeChildren`, with page-token handling and
  `STALE_GENERATION` recovery.
- The browsable-navigation pattern (breadcrumb, descend, ascend) established in list view, for tree view
  to reuse.

To feature 007 (multi-select and deletion, M001/S04 → M001/S06):

- A view-agnostic selection model holding `entryId` sets across gallery, list and tree.
- Status-aware rendering, so the selection UI can distinguish SYNCED, UNSYNCED and UNKNOWN entries before
  any delete is attempted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro browse-and-filter flow passes against live containers.
- **SC-002**: Filter chip counts equal the snapshot's per-status counts in every flow run.
- **SC-003**: Every interactive element has an accessibility label (enforced by the flows' selectors).

## Assumptions

- The gallery shows local images only; remote file content is never downloaded (R026, `docs/scope.md`).
