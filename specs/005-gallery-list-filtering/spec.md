# Feature Specification: Gallery View, Browsable List, Filtering and Material 3 Shell

**Feature Branch**: `005-gallery-list-filtering`

**Created**: 2026-09-28 (seeded from milestone slice M001/S04)

**Status**: Clarified 2026-10-01, planned ([plan.md](./plan.md), [tasks.md](./tasks.md))

**Input**: Roadmap slice M001/S04, "Gallery view, browsable list, filtering, and Material 3 shell"
(`risk:medium`, `depends:[S03]`).

> Seeded from the roadmap slice's demo, dependencies and owned requirements, then clarified
> (2026-10-01) and planned.

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

**Moved here from 007** (user decision, 2026-10-01): `getLocalImageHandle`, the local-only image read,
because gallery tiles need thumbnails. Feature 007 reuses it for the full preview
([research R7](./research.md#r7-gallery-thumbnails-getlocalimagehandle-moved-from-007-user-decision-2026-10-01)).

**Not owned here**: the include-hidden-files setting (`getSettings` / `setIncludeHidden`) is reassigned to
feature 009. This feature keeps scanning with `includeHidden = false` and leaves both methods
`NOT_IMPLEMENTED`, as feature 004 does
([004 research R8](../004-scan-engine-matching/research.md#r8-hidden-files)).

## Clarifications

### Session 2026-10-01

- Q: When should two gallery tiles count as "duplicates" and get an origin badge? → A: When the same file name appears in two or more different source folders; the badge shows the source folder's name.
- Q: Should this feature own the include-hidden-files setting (`getSettings` / `setIncludeHidden`)? → A: No; reassigned to feature 009. Both methods stay `NOT_IMPLEMENTED` here.
- Q: In list view, when a filter is active and none of a directory's files match it, what happens to that directory row? → A: It stays visible, dimmed, with a count of matching files (0), and can still be opened; same rule as tree view (feature 007).
- Q: When a page request fails with `STALE_GENERATION` because a rescan published a new snapshot, what should the view do? → A: Reload automatically from page 1 of the new snapshot, keeping filter, sort and folder, with a short "Results updated" snackbar; if the folder no longer exists, fall back to its nearest existing ancestor.
- Q: Should users get sort or name-search controls in this feature? → A: No; fixed sort, no search. Gallery uses `TIME_DESC`, list view uses `NAME_ASC`.

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

1. **Given** a completed snapshot of thousands of image files (at least 2 000), **When** the user opens the gallery, **Then** a
   virtualized grid renders it through paged reads.
2. **Given** the gallery, **When** the user switches between the all, synced, unsynced and issues-unknown
   chips, **Then** the shown files and the chip counts agree with the snapshot: each chip's count equals the
   number of entries the current view shows under that filter (gallery: image files; list: all files).
3. **Given** two identical-looking files from different local folders, **When** they appear in the
   gallery, **Then** each tile whose file name also appears in another source folder carries an origin badge
   naming its source folder; a tile whose name appears in only one source folder carries no badge.
4. **Given** list view, **When** the user descends into a directory and then uses the breadcrumb, **Then**
   they navigate into and back out of directories.
5. **Given** any interactive element, **When** Maestro selects it, **Then** it is addressable by its
   accessibility label.

### Edge Cases

- A filter that leaves a directory with no matching files beneath it in list view: the directory row stays
  visible, dimmed, with a matching-file count of 0, and can still be opened (showing an empty filtered
  state). Feature 007's tree view uses the same rule.
- A rescan publishes a new snapshot while a view is paging (the active snapshot changes, or a read fails
  with `STALE_GENERATION`, `SNAPSHOT_NOT_FOUND` or `PAGE_TOKEN_MISMATCH`): the view discards its loaded rows
  and reloads from page 1 of the new active snapshot, keeping the current filter, sort and folder, and
  shows a short "Results updated" snackbar. If the current folder no longer exists in the new snapshot,
  list view falls back to the nearest ancestor that does (or the top level). Rows from two snapshots are
  never shown together.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R008, primary-user-loop): The gallery view MUST be a flat virtualized grid over the snapshot,
  with an origin badge shown only on duplicates. The badge shows the originating local folder, never the
  remote path, and reads use paged `queryFiles`, per
  [D010](../../docs/decisions/0010-snapshot-paging-and-origin-badge.md). A flat grid has no path context, so
  identical-looking tiles need a badge answering "which of my folders is this from". A tile is a duplicate
  when its file name appears in two or more different source folders of the snapshot (size and modified
  time are not compared; same-name files within one source folder are not duplicates). The badge shows that
  source folder's name.
- **FR-002** (R009, primary-user-loop): The list view MUST be a browsable directory listing with navigation
  down into folders and back up via breadcrumb, not a flattened dump of every file. It uses
  `queryTreeChildren` with `parentId` and shows name, size, modified time and sync status, with no origin
  badge. Its top level lists the selected source folders by alias, and each source is entered at its root. The path the user navigated is the origin context. Under an active filter, each directory row
  shows the count of matching files anywhere beneath it; a directory with a count of 0 stays visible,
  dimmed, and navigable rather than hidden.
- **FR-003** (R011, primary-user-loop): Filtering MUST offer all, synced, unsynced and issues-unknown, and
  filter state MUST apply consistently across gallery, list and tree. `FileFilter` in
  `src/native/CloudSyncContracts.ts` already carries `ALL` / `SYNCED` / `UNSYNCED` / `ISSUES_UNKNOWN`. The
  whole point of the app is isolating the synced set for deletion and the unknown set so it is never
  deleted.
- **FR-004** (R021, quality-attribute): The UI MUST use Material 3 via `react-native-paper` only, with no
  ad-hoc inline styles, a defined spacing and density scale, and accessibility labels on every interactive
  element. Accessibility labels are also the Maestro selectors, so the rule is self-enforcing. Aesthetic
  judgement ("slick and modern") is left to human acceptance on a real device, not to a test.
- **FR-005**: The shared paged-query hook MUST recover from a snapshot change (the active snapshot ID
  changes, or a read fails with `STALE_GENERATION`, `SNAPSHOT_NOT_FOUND` or `PAGE_TOKEN_MISMATCH`) by discarding loaded rows and
  reloading from the first page of the new active snapshot with the same filter, sort and folder, so
  displayed rows and chip counts always come from one snapshot. It MUST show a "Results updated" snackbar,
  and when the current folder is absent from the new snapshot it MUST fall back to the nearest existing
  ancestor.
- **FR-006**: Sort order MUST be fixed per view, with no user-facing sort or search controls: gallery
  `TIME_DESC` (newest first), list view `NAME_ASC`. `QuerySpec.search` is left unset.

Supporting requirements (primary FR in another feature):

- R020 (feature 009): the browse and filter loop is proven by a Maestro flow.
- R022 (feature 009): `./docs` is updated in the same change as this feature's behaviour.

### Key Entities

- **FileQuery**: filter, view, sort, source, parent, search and page size over one snapshot (this feature
  sets sort from the view and never sets search).
- **FilePage**: a bounded page of entries, an opaque page token, and first-page counts per status.
- **SelectionModel**: the view-agnostic set of selected `entryId`s. Built by feature 006, not here
  ([research R12](./research.md#r12-selection-model-spec-provides-to-006)).

## Provides

To feature 007 (tree view and preview, M001/S04 → M001/S05):

- The Material 3 shell: theme, spacing and density scale, filter-chip component, and the
  accessibility-label convention Maestro selectors depend on.
- A shared paged-query hook wrapping `queryFiles` and `queryTreeChildren`, with page-token handling and
  snapshot-change recovery (FR-005).
- `getLocalImageHandle` with a clamped `maxEdgePx`, for the full preview.
- The browsable-navigation pattern (breadcrumb, descend, ascend) established in list view, for tree view
  to reuse.

To feature 006 (MVP, which absorbed multi-select and deletion from M001/S06):

- `entryId`-keyed rows across gallery, list and tree, on which 006 builds its selection model.
- Status-aware rendering, so the selection UI can distinguish SYNCED, UNSYNCED and UNKNOWN entries before
  any delete is attempted.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro browse-and-filter flows (`browse/01`–`05`) pass against live containers on API 31
  and API 36.
- **SC-002**: In every flow run, each filter chip's count equals the snapshot's per-status count of the
  entries the current view shows: image files in the gallery, all files in list view (which therefore
  match the Scan summary).
- **SC-003**: Every interactive element has an accessibility label (enforced by the flows' selectors).

## Assumptions

- The gallery shows local images only; remote file content is never downloaded (R026, `docs/scope.md`).
