# D024: How are videos played in the preview?

- **Status**: Accepted
- **Date / context**: 2026-10-28, feature 009 (tree view, image and video preview), spec clarification 2
  and FR-002, research R7
- **Scope**: architecture
- **Made by**: human (play videos in the app, muted by default, with play/pause and seek; R029 narrowed to
  documents, clarification 2); agent (a platform `VideoView` in a Codegen native view, R7)
- **Revisable**: Yes, the player. If codec coverage ever matters more than the dependency count, the view
  can wrap Media3 ExoPlayer behind the same props and event. The rule that no document URI crosses the
  bridge is not revisable for v1.
- **Amends**: R029 in [scope](../scope.md) (out of scope: previews of documents only)

## Context

Until feature 009, R029 kept every preview out of v1 scope: tiles showed thumbnails, and tapping a file did
nothing. Clarification 2 asked for a full preview of photos and videos, with videos playing the local file
in the app, muted by default, with play/pause and seek.

Every React Native video library takes the media URI from JavaScript. Local document URIs never cross the
bridge or appear in a log (architecture "Local thumbnails", [D011](./0011-typed-error-envelopes-partial-scans.md)):
the thumbnail path already resolves them natively and hands JavaScript only a cache file.

## Decision

- **A Codegen native component, `SyncScopeVideoView`** (spec in
  `src/native/specs/SyncScopeVideoViewNativeComponent.ts`, view and manager in
  `android/app/src/main/java/com/syncscope/media/SyncScopeVideoView.kt`), registered by `CloudSyncPackage`.
  It wraps the platform `android.widget.VideoView` with a `MediaController` for play/pause and seek.
- **Props are ids, not URIs.** It takes `snapshotId` and `entryId`, and resolves the local document natively
  through `SnapshotStore.mediaEntry`, off the main thread. The URI is in no prop, no event and no log line.
- **Muted by default.** The volume is set to 0 when the player is prepared; the preview's top bar has a mute
  toggle that flips the `muted` prop.
- **One error event.** `onPlaybackError` carries only a `reason`: `NOT_A_VIDEO` (unknown snapshot or entry,
  or not a `video/` file), `UNAVAILABLE` (the local document cannot be opened) or `UNPLAYABLE` (the decoder
  failed). The preview shows "This video can't be played".
- **Released when not visible.** The player is released when the view detaches and when the app goes to the
  background, and opens again on return.
- **Local content only** (R026). The view never reads anything from the server.
- **R029 narrowed.** Photos and videos have a preview; documents still do not.

## Rationale

`VideoView`, `MediaController` and `MediaPlayer` are in the platform, so there is no new dependency
(Principle I), and camera videos are local files in codecs the platform decodes. A native view keeps the
existing rule that document URIs stay native, which a JavaScript player would break. The project already
ships Codegen native code, so a view is a small addition.

## Alternatives rejected

- `react-native-video` (Media3): a large dependency, and the URI would cross the bridge.
- Handing the file to the system player with an intent: option C of clarification 2, which the user did not
  choose.
- Media3 ExoPlayer in our own view: better codec coverage, but a new dependency that is not needed for local
  playback of camera videos.

## Related

- Requirements: R021, R026, R029 (narrowed)
- Features: specs/009-tree-view-image-preview (clarification 2, FR-002; research R7, R8; contracts
  "cloudsync-tree-preview")
- Decisions: [D001](./0001-single-cloudsync-turbomodule.md),
  [D011](./0011-typed-error-envelopes-partial-scans.md)
