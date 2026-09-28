# Feature Specification: Browsable Tree View and Image Preview

**Feature Branch**: `006-tree-view-image-preview`

**Created**: 2026-09-28 (seeded from milestone slice M001/S05)

**Status**: Draft (seeded)

**Input**: Roadmap slice M001/S05, "Browsable tree view and image preview" (`risk:medium`,
`depends:[S04]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [005-gallery-list-filtering](../005-gallery-list-filtering/spec.md).

## Dependencies

Consumes from feature 005 (M001/S04 → M001/S05):

- The Material 3 shell, filter-chip component and accessibility-label convention.
- The shared paged-query hook over `queryFiles` and `queryTreeChildren`, with `STALE_GENERATION` recovery.
- The browsable-navigation pattern (breadcrumb, descend, ascend) from list view.

Consumes from feature 004 (M001/S03 → M001/S05):

- Working `queryTreeChildren(snapshotId, parentId, querySpec, pageToken)`, backed by
  `index_local_node_snapshotId_sourceId_parentId_kind_name`.
- `parentId` and `kind` (FILE / DIRECTORY) on every `local_node` row.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse the results as a tree and preview images (Priority: P1)

The user expands and collapses directories in tree view, navigating the same hierarchy as list view, and
taps an image to open a full preview. With a filter applied, directories whose children are all filtered
out remain visible, dimmed, with a count, rather than dead-ending navigation.

**Why this priority**: users deciding which album to clear out think in hierarchy, and deciding whether a
photo is worth keeping requires seeing it before an irreversible delete.

**Independent Test**: a Maestro flow (slice demo).

**Acceptance Scenarios** (from the slice demo):

1. **Given** a completed snapshot, **When** the user expands and collapses directories in tree view,
   **Then** the hierarchy matches the one list view navigates.
2. **Given** an image in any view, **When** the user taps it, **Then** a full preview opens from local
   storage.
3. **Given** a filter that excludes all children of a directory, **When** the user views the tree,
   **Then** the directory stays visible, dimmed, with a count, rather than vanishing.

### Edge Cases

- A non-image file tapped for preview (video and documents are out of scope, R029).
- A local file removed since the scan when its preview is opened.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R010, primary-user-loop): The tree view MUST be a browsable, expandable hierarchy over the
  same snapshot, sharing the `queryTreeChildren` contract with list view. Users reasoning about which album
  to clear out think in hierarchy. [NEEDS CLARIFICATION: when a filter is applied, directories whose
  children are all filtered out should stay visible, dimmed, with a count, rather than vanish, so
  navigation does not dead-end. Settle the exact behaviour (which count is shown, whether such directories
  can be expanded, and whether list view follows the same rule) when this feature is specified.]
- **FR-002** (R014, core-capability): Users MUST be able to preview an image from any view. Images only for
  v1 (video and documents are out of scope, R029). Preview uses `getLocalImageHandle`, which reads local
  storage only and never downloads remote file content. A thumbnail grid alone is not enough to commit to
  an irreversible delete.

Supporting requirements (primary FR in another feature):

- R011 (feature 005): the all / synced / unsynced / issues-unknown filter applies consistently in tree
  view.
- R021 (feature 005): tree view and preview use the Material 3 shell and accessibility labels.
- R022 (feature 008): `./docs` is updated in the same change as this feature's behaviour.

## Provides

To feature 007 (multi-select and deletion, M001/S05 → M001/S06):

- Multi-select surfaced in tree view and preview, completing selection parity across all three views.
- `getLocalImageHandle` implemented, establishing the local-content-read path that never touches remote
  content.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro tree-and-preview flow passes against live containers.
- **SC-002**: With any filter applied, no directory path dead-ends navigation.

## Assumptions

- Preview reads local content only; the remote side stays listing-and-metadata only (R026, `docs/scope.md`).
