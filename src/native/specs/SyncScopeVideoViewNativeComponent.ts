import type { CodegenTypes, HostComponent, ViewProps } from 'react-native';
import { codegenNativeComponent } from 'react-native';

/**
 * Codegen contract for the native video view (009 research R7,
 * contracts/cloudsync-tree-preview.md "New native view: SyncScopeVideoView").
 *
 * The view takes a published snapshot and a `video/*` `FILE` entry of it and
 * resolves the local document natively, so no document URI ever reaches
 * JavaScript. It plays local content only (R026), muted by default, with the
 * platform `MediaController` for play/pause and seek.
 */

export type VideoPlaybackErrorEvent = Readonly<{
  /**
   * `NOT_A_VIDEO`: the entry is unknown, not a `FILE` or not `video/*`;
   * `UNAVAILABLE`: the local document cannot be opened;
   * `UNPLAYABLE`: the decoder failed.
   */
  // Inline: Codegen does not resolve a type alias inside an event payload.
  reason: 'NOT_A_VIDEO' | 'UNAVAILABLE' | 'UNPLAYABLE';
}>;

export type VideoPlaybackErrorReason = VideoPlaybackErrorEvent['reason'];

export type VideoReadyEvent = Readonly<{
  durationMillis: CodegenTypes.Double;
}>;

export interface NativeProps extends ViewProps {
  snapshotId: string;
  entryId: string;
  /** Volume 0 while true. */
  muted?: CodegenTypes.WithDefault<boolean, true>;
  /** Pauses or resumes; the `MediaController` also drives play and pause. */
  paused?: CodegenTypes.WithDefault<boolean, false>;
  onPlaybackError?: CodegenTypes.DirectEventHandler<VideoPlaybackErrorEvent> | null;
  onReady?: CodegenTypes.DirectEventHandler<VideoReadyEvent> | null;
}

export default codegenNativeComponent<NativeProps>(
  'SyncScopeVideoView',
) as HostComponent<NativeProps>;
