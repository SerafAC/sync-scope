# D010: How do the three views read scan results, and how is a file's origin shown?

- **Status**: Accepted
- **Date / context**: M001 Layer 2, refined during depth verification when the user corrected the list and
  tree view behaviour
- **Scope**: architecture
- **Made by**: collaborative
- **Revisable**: No for the paging contract, which is already declared and clamped on both sides. The badge
  rule is a UI detail that can be refined.

## Context

Gallery, list and tree all present the same thousands of files, and a rescan can publish a new snapshot
while a view is paging. Duplicates across local folders look identical in a flat grid.

## Decision

All views read one snapshot through opaque page tokens clamped to 200: gallery flat via `queryFiles`, list
and tree parent-scoped via `queryTreeChildren`. The origin badge appears in gallery only, on duplicates
only, naming the originating local folder.

**Badge rule, refined by feature 005** (clarification 1): a gallery tile is a duplicate when a file with the
same name exists in another source folder of the snapshot; size and modified time are not compared, and
same-named files within one source folder are not duplicates. The badge shows that tile's source alias,
never the remote path. The paging contract above is unchanged.

## Rationale

Thousands of files across three views need one consistent read, and page tokens rejected on snapshot, query
or sort mismatch prevent torn reads during a rescan. The user corrected an early flat-list reading: list and
tree must browse directories up and down, so the path the user navigated is itself the origin context and
no badge is needed there. Gallery is a flat grid with no path context, so a badge exists purely to
disambiguate identical-looking tiles.

## Alternatives rejected

- Loading the whole catalog into JS state — memory blowup and torn reads.

## Related

- Requirements: R008, R009, R010, R011
- Features: [005](../../specs/005-gallery-list-filtering/spec.md) (gallery, list view and the refined
  badge rule, [research R5](../../specs/005-gallery-list-filtering/research.md#r5-duplicate-tiles-and-the-origin-badge-clarification-1-fr-001)),
  specs/007-tree-view-image-preview
