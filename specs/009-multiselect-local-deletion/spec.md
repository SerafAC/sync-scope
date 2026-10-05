# Feature Specification: Multi-Select and Two-Phase Local Deletion

**Feature Branch**: `009-multiselect-local-deletion`

**Created**: 2026-09-28 (seeded from milestone slice M001/S06)

**Status**: Merged into [006-mvp](../006-mvp/spec.md) (user decision, 2026-10-02)

This feature is not built on its own. Its whole scope (roadmap slice M001/S06, R012 and R013), multi-select
and safe two-phase deletion of local files, moved into the MVP so that the first usable build can delete
backed-up files. The MVP also adds the selection's total size in the bottom-left corner of the selection
bar.

Where the requirements now live:

- R012 (multi-select and local-only deletion, D006): [006 FR-015, FR-019](../006-mvp/spec.md#functional-requirements).
- R013 (two-phase deletion with per-file outcomes, D008): [006 FR-018, FR-020](../006-mvp/spec.md#functional-requirements).
- Selection in tree view and preview, which this draft expected from feature 008, is now delivered by
  [008-tree-view-image-preview](../008-tree-view-image-preview/spec.md) on top of the MVP's selection model.

The directory is kept so links from the migration records (feature 001) and the decision records stay
valid. It was numbered 008 until feature 007 (sorting, fast scrolling and several server folders) was
inserted on 2026-10-05.
