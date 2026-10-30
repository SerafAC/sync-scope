# Research: Browsable Tree View, Image and Video Preview

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-28

Each item gives the decision, the rationale and the alternatives considered. Items marked *(agent)* were
decided while planning, not asked of the user; they can be reopened in review.

## R1: The tree is a flattened list of fixed-height rows *(agent)*

**Decision**: Tree view renders one `FlatList` of rows. Each row is a folder row (with a depth, an
expand/collapse chevron and the matching-file count) or a file row (with a depth and a thumbnail). An
expanded folder's children are read with `queryTreeChildren`, folders first by name and then the files in
the current sort, exactly as list view reads one folder (007 R3), and are spliced in below the folder row.
Every row is `density.rowHeight` tall, so `getItemLayout` stays valid. A folder with more than one page
of children shows a "Load more" row at the end of its children, which reads the next page when it
becomes visible (the same opaque token as list view, D010). Collapsing a folder removes its rows and drops
its pages.

**Rationale**: the 007 spec requires tree rows that reuse the paged reader to keep a fixed height. A
flattened list is the standard way to render an expandable tree on a virtualised list, and it reuses the
list row components and the `queryTreeChildren` contract unchanged (FR-001).

**Alternatives considered**: nested `FlatList`s per folder (rows of varying height, breaks
`getItemLayout` and virtualisation); a new native "flattened tree" query (a new contract method and
paging rules, with nothing gained at this scale).

## R2: No fast scrollbar in tree view *(agent)*

**Decision**: Tree view does not show the 007 `FastScroller`. Each expanded folder is paged on its own;
there is no single sorted result to band.

**Rationale**: the scroll index bands one sorted query. A tree with several expanded folders mixes
several queries at several depths, so a letter, date or size band has no single meaning. The 007 spec
leaves this choice to this feature.

**Alternatives considered**: one scroll index per expanded folder (several thumbs, confusing); a
positional scrollbar over the flattened rows (the row count is unknown until every page is read).

## R3: Tree state and keeping the place on new results *(agent)*

**Decision**: The expanded folders are kept as **name paths** from the source root (for example
`[sourceId, "DCIM", "Camera"]`), not entry IDs, because entry IDs are random per scan. On a new snapshot
the tree re-reads the root and each still-expanded path in order. A path that no longer exists is dropped
with its descendants. The first visible row is kept by its name path and re-found after the reload, so
the view does not jump to the top (007 FR-014). The tree view's state lives in `FilesProvider` next to the
list view's folder, so switching views and back keeps it for the session. It is not persisted.

**Rationale**: list view already re-finds its folder by name in a new snapshot
(`useListNavigation`, 005 R2), and the same rule extends naturally to several open folders.

**Alternatives considered**: persisting the expanded set in `SharedPreferences` (not asked for);
collapsing everything on a new snapshot (breaks 007 FR-014).

## R4: The filter and dimmed folders in the tree

**Decision**: No new rule. `queryTreeChildren` already returns every folder with `matchingFileCount`
(005 clarification 3), and the tree dims a folder whose count is 0 and still lets it expand, using the
same `FolderRow` styling as list view (FR-001, SC-002).

## R5: Re-checking unsynced files during the automatic refresh (FR-003) *(agent, refines clarification 1)*

**Context**: matching is directory-agnostic (D003): a device file counts as backed up when a file with the
same match key exists anywhere under the configured server folders. So there is no single server folder
where an unsynced file "should" be, and a protocol-level lookup by name does not exist on FTP, SFTP or
WebDAV. Clarification 1 rules out a full relisting during the refresh.

**Decision**: the refresh lists the **server folders where the file's synced neighbours are**:

1. Before re-reading the device, the refresh reads the active snapshot. It finds every device folder
   that holds at least one *re-checkable* file and at least one SYNCED file:
   - re-checkable means UNSYNCED, or UNKNOWN for a server reason (`REMOTE_FOLDER_UNREAD`, a listing-failure
     code);
   - UNKNOWN for `LOCAL_UNAVAILABLE` or `REMOTE_MTIME_MISSING` is not re-checked, because a listing cannot
     change those verdicts.
2. The candidate server folders are the union of the stored `remote_match_key.directories` of the SYNCED
   files in those device folders (D020 R11). For a camera folder, that is the server folder the earlier
   photos were backed up to.
3. The refresh connects once, with the stored repository, credential and trusted host key, and lists at
   most `RECHECK_MAX_FOLDERS = 32` folders. Folders are taken in order of how many re-checkable files
   they cover, most first. Each folder is listed once, with `RemoteWalker.listWithRetry`. The whole step
   has a 20 s budget and is cancellable like the rest of the run.
4. Every listed file adds its key to the refresh's `MatchIndex`, and only keys that are not already
   present are written to the new snapshot's `remote_match_key`. Then the normal local phase runs, and
   the `Matcher` rule table, unchanged, decides every file. An exact key wins even on an incomplete
   listing (rule 2), so a found file becomes SYNCED.
5. Nothing is demoted. A file that is not found keeps its previous verdict, because a partial listing
   cannot prove absence (D006). A connection, authentication, host-key or listing failure skips the
   re-check and does not fail the refresh, and the refresh publishes as it does today.
6. The refresh records `recheckedFolders` and `promotedFiles` on its run, and the scan summary card
   shows "Re-checked N server folders, M files now backed up" when M > 0.
7. `remoteListedAtMillis` is unchanged, because the listing as a whole is still the last full scan's.

**Limitation (documented)**: an unsynced file in a device folder with no backed-up neighbour has no
candidate server folder. Only a full scan can find it. This covers a new device folder, or a server
folder that has moved. The scan summary keeps its "Rescan to check new folders" hint.

**Rationale**: it delivers the clarified behaviour, re-checking unsynced files on every automatic refresh
with read-only listings and no full walk. It reuses D020's folder store, connection path and retry
policy, and the unchanged rule table. The common case, new photos in a camera folder whose older
photos were backed up, costs one listing.

**Alternatives considered**:

- A full relisting during the refresh: rejected in clarification 1.
- Mirroring the device path onto each server folder: the device-to-server folder mapping is unknown
  (R024 is deferred), and the guess fails for any non-mirrored layout.
- Re-listing the server folders whose modification time changed: the time is only visible from the
  parent folder's listing, so it still walks the whole tree, and WebDAV collection times are unreliable.
- Per-file `stat`: rejected in D020 for the same reasons.

This amends D020's rejected alternative "re-checking UNSYNCED files to promote them" and is recorded as a
new decision, **D023**. The folder listing and key matching shared with `DeletionRecheck` move into one
`ServerFolderLister` (DRY).

## R6: Videos in the gallery and as row thumbnails (FR-004, FR-005)

**Decision**:

- A *media* file is a `FILE` whose MIME type starts with `image/` or `video/`. One SQL predicate,
  `MediaKind.SQL_MEDIA`, replaces every `mimeType LIKE 'image/%'`:
  - the gallery scope (`scopeOf`);
  - `statusCounts(imagesOnly)`, renamed `mediaOnly`;
  - `selectableEntries`, where `isImage` becomes `isMedia`.

  One TS helper, `isMediaMime`, mirrors it.
- `getLocalImageHandle` accepts `video/` entries. For a video, `ContentResolverThumbnailSource` tries
  `ContentResolver.loadThumbnail` first. When that is unsupported or returns nothing, it falls back to
  `MediaMetadataRetriever.getScaledFrameAtTime(-1, OPTION_CLOSEST_SYNC, edge, edge)` on the document
  URI. The same retriever reads `METADATA_KEY_DURATION`.
- The handle result gains `durationMillis: number | null`. It is null for images, and for a video whose
  duration cannot be read. The duration is cached beside the JPEG as a small sidecar file
  (`<hash>.meta`, written atomically like the JPEG), so a cache hit still answers without a decode.
- The gallery tile and the row thumbnail draw a play badge and the duration (`m:ss`, or `h:mm:ss` from
  one hour) over video thumbnails. A video whose frame cannot be read shows a `video-off` placeholder
  instead of the broken-image icon.
- Row thumbnails are 40 dp squares inside the 56 dp row and request a 128 px edge. Directories and
  non-media files keep their icons.

**Rationale**: one predicate keeps the gallery, counts and select-all in step (DRY). The frame and the
duration come from platform APIs, with no dependency. The document URI still never crosses the bridge
(architecture "Local thumbnails").

**Alternatives considered**: storing the duration in `local_node` during the scan (a retriever per video
would slow every scan and refresh); a separate `getLocalVideoInfo` method (two round trips per tile for
one decode).

## R7: Video playback is a native view, not a JS library (FR-002) *(agent)*

**Decision**: A small Fabric native component, `SyncScopeVideoView` (Codegen spec in
`src/native/specs/SyncScopeVideoViewNativeComponent.ts`), wraps the platform `android.widget.VideoView`
with a `MediaController` for play/pause and seek. It takes `snapshotId` and `entryId` as props and
resolves the document URI natively through `SnapshotStore.imageEntry` (renamed `mediaEntry`), so no
document URI ever reaches JavaScript. It starts muted (`MediaPlayer.setVolume(0, 0)` in
`OnPreparedListener`). A mute toggle in the preview's top bar flips the `muted` prop. Playback errors
(`MediaPlayer.OnErrorListener`), and an entry that is unknown, not a video or unreadable, raise one
`onPlaybackError` event, and the preview shows the "This video can't be played" state. The player is
released when the view detaches and when the app goes to the background.

**Rationale**: every video player library for React Native takes a URI from JavaScript, which would put
the content URI on the bridge, contrary to the rule that document URIs stay native (architecture "Local
thumbnails", D011). `VideoView` is in the platform, so there is no new dependency (Principle I). The
project already ships Codegen native code.

**Alternatives considered**:

- `react-native-video` (Media3): a large dependency, and the URI would cross the bridge.
- Handing the file to the system player with an intent: that was option C in clarification 2, which the
  user did not choose.
- Media3 ExoPlayer in our own view: better codec coverage, but a new dependency that is not needed for
  local playback of camera videos.

`docs/scope.md` R029 is narrowed to "no document preview". **D024** records the video decision and the
native view.

## R8: The preview screen (FR-002)

**Decision**:

- `PreviewScreen` is a stack screen above the Files tab. Its params are `{ snapshotId, entryId, name,
  mimeType, sizeBytes, status }`, taken from the tapped row, so it renders at once.
- **Images**: `getLocalImageHandle` with the window's long edge in physical pixels, clamped by the
  existing 2048 px cap, drawn with `resizeMode="contain"`. While it loads, the 256 px gallery thumbnail,
  already cached, is shown first.
- **Videos**: `SyncScopeVideoView` (R7).
- **Tapping**: a file opens the preview from gallery, list and tree when nothing is selected, and when it
  is media. While selecting, a tap toggles, as today. A tap on a non-media file does nothing (edge case).
- **Errors**: a file that is gone or unreadable shows "This file is no longer on the device" for
  `IMAGE_UNAVAILABLE`, and a Back button.
- **Results update**: when a new snapshot arrives while the preview is open, the preview stays on the
  open file. Its `entryId` is carried over by R9, or the preview shows "This file changed. Go back to
  see the latest results."

**Rationale**: params from the row avoid a new "get entry" read. Showing the cached thumbnail first makes
the open feel instant.

**Alternatives considered**: swiping between files in the preview (not asked for, YAGNI); pinch-zoom
(not asked for).

## R9: Selection survives an automatic refresh (spec follow-up 2026-10-08) *(agent)*

**Decision**: carry the selection by a stable key, natively.

- A new bridge method, `carrySelection(fromSnapshotId, toSnapshotId, entryIds)`, matches each selected
  entry with the `FILE` in the new snapshot that has the same `(sourceId, documentId)`, **and** the same
  `sizeBytes` **and** the same `modifiedUtcMillis`. It returns `{ carried: [{ from, to }], dropped }`.
  - `documentId` is the SAF document ID. It is stable for an unchanged path within one grant, and it
    stays native-only as part of the stable key, with only entry IDs returned.
  - A changed size or time counts as "changed" and is dropped.
  - A status change, for example UNSYNCED to SYNCED after R5, is still carried. Deletion safety does not
    depend on the selection's status, because `prepareLocalDeletion` re-reads statuses and re-checks
    them against the server (D020).
- `SelectionProvider`, on a snapshot change, calls `carrySelection` instead of clearing.
  - Everything carried: the selection continues under the new snapshot ID, with no notice.
  - Some dropped: the notice reads "N selected files changed or were removed, so they were unselected."
  - The call fails, for example because the old snapshot is gone: the selection clears with the existing
    notice.
- Schema 5 → 6 adds the index `local_node(snapshotId, sourceId, documentId)`, so the carry is one indexed
  join, also for a 50 k select-all. A budget test asserts under 300 ms for 50 k on the JVM.

**Rationale**: it is the first option in the spec follow-up, and it keeps D020's safety unchanged. A
refresh now does useful work (R5), so a "keep the snapshot when nothing changed" shortcut would rarely
apply, and it would complicate the scan-history semantics of 006.

**Alternatives considered**: keying on the document URI in JavaScript (it would cross the bridge); not
publishing an unchanged refresh (rejected above; it can be added later if the extra writes matter).

## R10: The drop-down pair fills its row in equal halves (FR-006)

**Context**: 007 T082 gave both `ChoiceMenu` wrappers `flex: 1; minWidth: 0` and the buttons
`width: '100%'`, yet the drop-downs still do not fill the row on the device. Paper's `Menu` wraps its
anchor in its own `View`. That view shrinks to fit its content, because nothing makes it stretch, so the
button's `100%` is a percentage of the content width.

**Decision**: the first UI task is a short spike that confirms the cause on the device by dumping the
`uiautomator` bounds of `files-sort` and `files-view`. The fix then:

- gives the `Menu` an explicit `style={styles.menu}` with `alignSelf: 'stretch'`, or `flex: 1` if the
  dump shows the wrapper is the shrinking box;
- makes the label truncate with `numberOfLines={1}` through `labelStyle`;
- adds a Jest test asserting the styles;
- adds a Maestro check as a staged line, `staged/11-toolbar-halves-a|assert-equal-halves.sh|…-b`: the
  host hook (`assert-equal-halves.sh`) reads the `uiautomator dump` bounds and asserts each button
  (`files-sort`, `files-view`, not their `-control` wrappers, which already stretch) is 50 % ± 2 % of the
  toolbar's width on API 31 and API 36. It is a staged line because the runner runs host
  scripts only between staged parts, never inside a workspace flow.

**Rationale**: 007's fix passed unit tests and still failed on the device, so this time the acceptance
check measures the device layout itself.

**Spike result (T020, 2026-10-28)**: run on the `dependency_api36` emulator (1080 px wide), and again on
`dependency_api31`, with the debug build of this branch (007's T082 styles, Paper 5.15.3): Files opened
after scanning the `tree` set (`staged/11-toolbar-halves-a`), then a `uiautomator dump`. Bounds in px:

| Box | API 36 | API 31 |
| --- | --- | --- |
| `files-toolbar` | `[44,334][1036,450]`, 992 wide | `[44,343][1036,459]`, 992 wide |
| `files-sort-control` / `files-view-control` | 485 wide each | 485 wide each |
| Paper `Menu`'s anchor wrapper (unnamed `ViewGroup`) | 485 wide, same as the control | 485 wide |
| `files-sort-container` (the button's `Surface`) | 485 wide | 485 wide |
| `files-sort` / `files-view` (the buttons) | 479 wide each, 48.3 % | 479 wide each, 48.3 % |

- **No box shrinks to its content.** The anchor wrapper fills the control (a column, so its default
  `alignItems: 'stretch'` stretches it), and each button is the wrapper less its 3 px border on each side.
  The 22 px gap between the halves caps a button at 48.9 % of the row, so 48.3 % is the full half. The
  row is already in equal halves on both API levels with 007's styles, and `assert-equal-halves.sh`
  passes on both. The earlier device report predates T082 or came from another build.
- **Neither planned style is the fix.** In Paper 5.15.3 `Menu`'s `style` goes to the open menu's
  absolutely positioned wrapper inside the `Portal`, not to the anchor wrapper, which takes no style at
  all. `alignSelf: 'stretch'` or `flex: 1` there could only change the open menu, so `Menu` keeps no
  `style`.
- **Chosen fix**: keep 007's wrapper (`flex: 1; minWidth: 0`) and button (`width: '100%'`) styles, which
  the dump shows are enough, and make a long label truncate. Paper already sets `numberOfLines={1}` on the
  label, but a `Text` does not shrink in the button's row by default, so a long choice would overflow its
  half. `labelStyle={styles.label}` adds `flexShrink: 1`. `src/files/__tests__/ChoiceMenu.test.tsx`
  pins this, and `staged/11-toolbar-halves` measures the device. The recorded API 36 dump is the passing
  fixture of `scripts/validation/assert-equal-halves.test.mjs`.

## R11: Selection parity in tree view and the preview

**Decision**:

- **Tree view**: file rows use the list view's selection behaviour unchanged. A long-press starts
  selecting, a tap toggles while selecting, and the selected check icon and `, selected` label show.
  Folder rows stay unselectable (006). "Select all" in tree view selects every file matching the filter
  under the expanded roots' sources. That is the same `selectAllQuery` as list view at the root (no
  folder scope), because the tree has no single current folder.
- **Preview**: the top bar holds a "Select" toggle, an `IconButton` with a check-box icon labelled
  "Select this file" or "Unselect this file". The selection bar, with its count, size and Delete, shows
  at the bottom of the preview whenever something is selected, and Delete opens the existing
  `DeleteFlow`. After a completed deletion that removed the previewed file, the preview closes.

**Rationale**: it reuses `SelectionProvider`, `SelectionBar` and `DeleteFlow` as they are, as the spec
asks.
