# Feature Specification: Browsable Tree View and Image Preview

**Feature Branch**: `009-tree-view-image-preview`

**Created**: 2026-09-28 (seeded from milestone slice M001/S05)

**Status**: Draft (seeded)

**Numbering**: Moved from slot 008 to 009 on 2026-10-10 to put E2E performance work next.

**Input**: Roadmap slice M001/S05, "Browsable tree view and image preview" (`risk:medium`,
`depends:[S04]`).

> This is a seeded draft. It carries the roadmap slice's demo, dependencies and owned requirements
> verbatim in meaning. It has not been clarified or planned yet: complete it with `/speckit-specify` and
> `/speckit-clarify` when this feature starts, then `/speckit-plan`.

**Depends on**: [005-gallery-list-filtering](../005-gallery-list-filtering/spec.md), [006-mvp](../006-mvp/spec.md)
(selection model, selection bar and deletion) and
[007-sort-scroll-remote-folders](../007-sort-scroll-remote-folders/spec.md) (the view-mode drop-down, where
tree view becomes the third choice, the sort contract and keeping the scroll position on new results).

## Dependencies

Consumes from feature 005 (M001/S04 → M001/S05):

- The Material 3 shell, filter-chip component and accessibility-label convention.
- The shared paged-query hook over `queryFiles` and `queryTreeChildren`, with `STALE_GENERATION` recovery.
- The browsable-navigation pattern (breadcrumb, descend, ascend) from list view.
- `getLocalImageHandle` with a clamped `maxEdgePx`, the local-only image read. It moved from this feature
  to 005 (user decision, 2026-10-01), because gallery tiles need thumbnails; the preview reuses it with the
  screen's long edge ([005 research R7](../005-gallery-list-filtering/research.md#r7-gallery-thumbnails-getlocalimagehandle-moved-from-007-user-decision-2026-10-01)).
- `queryTreeChildren` returning every directory whatever the filter, each with `matchingFileCount` (the
  directory rule below).

Consumes from feature 007 (spec follow-up, 2026-10-07; [007 plan, Integration closure](../007-sort-scroll-remote-folders/plan.md#integration-closure)):

- **The view drop-down** (`ViewMenu`, on `ChoiceMenu`), where tree view becomes the third choice, and the
  remembered browse preferences (`getBrowsePreferences` / `setBrowsePreferences`, native
  `SharedPreferences`), whose `view` gains a tree value; a tree sort, if any, is stored the same way.
- **The sort contract** (contract version 6): `NAME_*`, `TIME_*` and `SIZE_*` ordered by
  `(key, sortName, entryId)`, with `sortName` the case- and accent-folded name (`SortName`) and unknown
  sizes and dates last in both directions; and the query's `kind` (`DIRECTORY` / `FILE`). The tree
  applies it to each folder's files, with folders first by name, as list view does
  ([007 research R1–R3](../007-sort-scroll-remote-folders/research.md#r1-sort-contract-six-sorts-unknown-values-last-total-order)).
- **The scroll index and the segmented reader**: `getScrollIndex(snapshotId, querySpec, anchor?)` and the
  band-segmented `usePagedQuery`, with placeholders for bands not read yet and the `FastScroller`. The
  tree may reuse them per expanded folder or skip the scrollbar; decide when this feature is planned
  ([007 research R4, R7](../007-sort-scroll-remote-folders/research.md#r7-band-segmented-paging-in-the-views)).
- **Anchor restore on new results** (FR-014 of 007): on a new snapshot a view re-finds its first visible
  file by sort value and `sortName` (`anchorIndex`) instead of jumping to the top, also when hidden. The
  tree follows the same rule ([R8](../007-sort-scroll-remote-folders/research.md#r8-keeping-the-place-when-results-update)).
- **List rows have a fixed height** (`density.rowHeight`, with `getItemLayout`): the segmented reader
  places placeholder rows and the scrollbar maps the thumb to a row by that height. Tree rows that reuse
  the reader must keep a fixed height too (an expanded folder's children are rows of the same height,
  not nested lists of varying size).

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
  Settled by feature 005 (clarification 3, shared by list and tree): such a directory stays visible,
  dimmed, with the count of matching files anywhere beneath it (0), and can still be opened
  ([005 spec, Edge Cases](../005-gallery-list-filtering/spec.md#edge-cases)).
- **FR-002** (R014, core-capability): Users MUST be able to preview an image from any view. Images only for
  v1 (video and documents are out of scope, R029). Preview uses `getLocalImageHandle`, which reads local
  storage only and never downloads remote file content. A thumbnail grid alone is not enough to commit to
  an irreversible delete.

Supporting requirements (primary FR in another feature):

- R011 (feature 005): the all / synced / unsynced / issues-unknown filter applies consistently in tree
  view.
- R021 (feature 005): tree view and preview use the Material 3 shell and accessibility labels.
- R022 (feature 011): `./docs` is updated in the same change as this feature's behaviour.

## Selection in tree view and preview

Multi-select and deletion moved into [006-mvp](../006-mvp/spec.md) (user decision, 2026-10-02), which
delivers them for gallery and list view. This feature MUST extend the MVP's selection model, selection bar
(count and total size in the bottom-left corner) and Delete action to tree view and to the image preview,
completing selection parity across all three views. Directories stay unselectable, as in 006.

### Selection survives an automatic refresh (spec follow-up, 2026-10-08)

Found in the 007 real-device check: the app starts a `LOCAL_REFRESH` on open and on every return to the
foreground (`ScanProvider`, FR-003 of 006). Each refresh publishes a new snapshot, even when no file
changed, and `SelectionProvider` clears the selection whenever the active snapshot changes ("Results were
updated, so the selection was cleared."). On a phone with many files, the refresh finishes a few seconds
after launch, so a selection started in that window is lost, and switching apps for a moment does the
same. Scroll position already survives (007 FR-014); the selection should too. Settle when this feature
is specified:

- When the active snapshot changes, the selection MUST keep every selected file that is still present
  and unchanged in the new snapshot. It MUST be cleared, with a notice, only for the files that are gone
  or changed. The notice names how many were dropped, and no notice is shown when none were.
- Entry IDs are random per scan (`ScanEngine.scanSource`, `newId()`), so carrying the selection over needs
  a stable key, for example `(sourceId, relative path)` or the document URI. The data-model choice is to
  be made in this feature's plan.
- Alternatively, or as well: a refresh that changed nothing could keep the current snapshot instead of
  publishing a new one, which avoids the reset and the extra write. Weigh this against keeping the
  scan-history semantics of 006.
- Deletion safety does not change: the server re-check (D020) still runs against the snapshot the
  selection was carried into, and a file that changed is never carried over silently.

## Provides

To feature 011 (full loop and release): tree view and preview with selection parity, for the full-loop
flow's "browse, select" steps.

(`getLocalImageHandle` is no longer provided here: feature 005 implements it, see Dependencies.)

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The Maestro tree-and-preview flow passes against live containers.
- **SC-002**: With any filter applied, no directory path dead-ends navigation.

## Assumptions

- Preview reads local content only; the remote side stays listing-and-metadata only (R026, `docs/scope.md`).
