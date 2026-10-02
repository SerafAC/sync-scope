# Quickstart: validating gallery, list and filtering

How to prove this feature works. Behaviour is specified in [spec.md](./spec.md), the read rules and state
in [data-model.md](./data-model.md), the bridge surface in
[contracts/cloudsync-browse.md](./contracts/cloudsync-browse.md), and the flows in
[contracts/maestro-browse.md](./contracts/maestro-browse.md).

## Prerequisites

- Feature 004 merged (it is on `master` at `77a5b83`).
- The toolchain from `DEVELOPMENT.md`: pnpm, JDK 17, the Android SDK, Docker 29.x / Compose 5.5.1, and
  Maestro 2.10.0. Keep Gradle at the pinned wrapper version.
- API 31 and API 36 AVDs with an SD card (as for features 003 and 004).

## 1. Static checks and unit tests (no device, no network)

```sh
pnpm lint && pnpm typecheck  # react-native/no-inline-styles is an error now
pnpm test:ci                 # Jest: contract v4 + wrapper, usePagedQuery, useListNavigation,
                             # FilterChips, GalleryScreen, ListScreen, a11y-label sweep
pnpm test:android:unit       # JVM: DirectoryRollup counts, SnapshotStore read rules,
                             # migration 2→3, LocalImageStore, ScanOperations, parity
pnpm test:foundation         # device-fixtures / fixture-seed script contracts (gallery fixtures)
```

Expected: all pass. The tests must cover these cases in particular:

- `DirectoryRollupTest`: nested counts, where the sum over a source's top level equals its per-status file
  counts, and an empty directory gets 0 / 0 / 0.
- `SnapshotStoreQueryTest`:
  - under `SYNCED`, a directory holding only unsynced files is still returned with `matchingFileCount = 0`;
  - gallery excludes `video/*`;
  - counts ignore `filter` / `parentId` and honour `view` / `sourceId`;
  - `nameInOtherSource` is true across sources and false within one source;
  - a pre-v3 row gives `matchingFileCount = null`.
- `usePagedQuery` tests:
  - a change of the active `snapshotId` drops rows and raises "Results updated";
  - a late page-2 response for the old snapshot is ignored;
  - a filter switch drops rows without a snackbar;
  - `SNAPSHOT_NOT_FOUND` triggers one scan-state refresh and a reload.
- `useListNavigation` tests: relocation by name falls back to the deepest level that still exists.

## 2. Live end-to-end (real emulator, real containers)

```sh
pnpm validation:services:start && pnpm validation:services:health
pnpm e2e:android             # runs validation/maestro/ on API 31, then API 36
pnpm validation:services:stop   # also runs the read-only protocol audit
```

Expected: every flow in [contracts/maestro-browse.md](./contracts/maestro-browse.md) passes on both API
levels, and the 003 / 004 flows still pass. The protocol audit shows no content read or write. Thumbnails
come from local storage only.

To run a single flow while iterating, follow `DEVELOPMENT.md` › End-to-end flows (running one flow).

## 3. Manual acceptance on a real device (FR-004 aesthetics)

1. Add a camera folder with a few hundred photos and scan it.
2. In the Files tab, check: the grid scrolls smoothly, thumbnails appear without the tiles jumping, and the
   chips, badges, dimmed folders and breadcrumb read clearly in both light and dark mode.
3. Note the outcome in the PR. This is the human acceptance that FR-004 leaves out of the automated tests.
