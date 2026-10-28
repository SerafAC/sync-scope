import React, { memo, useMemo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme } from 'react-native-paper';

import { GALLERY_THUMBNAIL_EDGE_PX } from '../native/CloudSyncContracts';
import { spacing } from '../theme/spacing';
import { mediaThumbnailLabel } from './a11y';
import { formatDuration, mediaKindOf } from './media';
import { useLocalImage } from './useLocalImage';

/** Below this edge in dp the thumbnail uses its compact badge and icons (list and tree rows). */
const COMPACT_BELOW_DP = 64;

const ICON_SIZE = { regular: 32, compact: 20 } as const;
const PLAY_ICON_SIZE = { regular: 28, compact: 16 } as const;

export interface MediaThumbnailProps {
  /** The snapshot the entry was read from; nothing is read while null. */
  snapshotId: string | null;
  entryId: string;
  /** The file name, for the accessibility label. */
  name: string;
  /** `video/…` adds the play badge and the duration; anything else is drawn as an image. */
  mimeType: string | null;
  /** The long edge in px to ask `getLocalImageHandle` for; the gallery edge by default. */
  edge?: number;
  /** A square of this many dp; omitted, the thumbnail fills its parent. */
  size?: number;
  /** Prefix of the part IDs: `<testID>-image`, `-placeholder`, `-broken`, `-video-off`, `-play`, `-duration`. */
  testID?: string;
}

/**
 * The local thumbnail of an image or a video (009 research R6, FR-004,
 * FR-005), shared by gallery tiles and list and tree rows. While it loads it
 * shows an empty placeholder. An image that cannot be read shows the
 * broken-image icon; a video whose frame cannot be read shows `video-off`. A
 * video's frame carries a play badge and, when known, its duration
 * (`formatDuration`). Its accessibility label names the file and its kind.
 * It reads local storage only, through `useLocalImage`.
 */
export const MediaThumbnail = memo(function MediaThumbnailBody({
  snapshotId,
  entryId,
  name,
  mimeType,
  edge = GALLERY_THUMBNAIL_EDGE_PX,
  size,
  testID = 'media-thumbnail',
}: MediaThumbnailProps): React.JSX.Element {
  const theme = useTheme();
  const kind = mediaKindOf(mimeType) === 'video' ? 'video' : 'image';
  const { uri, durationMillis, failed } = useLocalImage(
    snapshotId,
    entryId,
    edge,
  );
  const compact = size != null && size < COMPACT_BELOW_DP;
  const scale = compact ? 'compact' : 'regular';
  const duration =
    kind === 'video' && uri != null && durationMillis != null
      ? formatDuration(durationMillis)
      : null;

  const themed = useMemo(
    () =>
      StyleSheet.create({
        badge: {
          backgroundColor: theme.colors.inverseSurface,
        },
        badgeText: {
          color: theme.colors.inverseOnSurface,
        },
        box: {
          backgroundColor: theme.colors.surfaceVariant,
        },
        size: size == null ? styles.fill : { height: size, width: size },
      }),
    [
      size,
      theme.colors.inverseOnSurface,
      theme.colors.inverseSurface,
      theme.colors.surfaceVariant,
    ],
  );

  return (
    <View
      accessibilityLabel={mediaThumbnailLabel(name, kind, duration)}
      accessibilityRole="image"
      style={[styles.box, themed.box, themed.size]}
      testID={testID}
    >
      {uri != null ? (
        <Image
          source={{ uri }}
          style={styles.image}
          testID={`${testID}-image`}
        />
      ) : failed ? (
        <View
          style={styles.center}
          testID={`${testID}-${kind === 'video' ? 'video-off' : 'broken'}`}
        >
          <Icon
            color={theme.colors.onSurfaceVariant}
            size={ICON_SIZE[scale]}
            source={kind === 'video' ? 'video-off' : 'image-broken-variant'}
          />
        </View>
      ) : (
        <View style={styles.center} testID={`${testID}-placeholder`} />
      )}
      {kind === 'video' && uri != null ? (
        <>
          <View pointerEvents="none" style={styles.playLayer}>
            <View
              style={[compact ? styles.playCompact : styles.play, themed.badge]}
              testID={`${testID}-play`}
            >
              <Icon
                color={theme.colors.inverseOnSurface}
                size={PLAY_ICON_SIZE[scale]}
                source="play"
              />
            </View>
          </View>
          {duration != null ? (
            <Text
              numberOfLines={1}
              style={[
                compact ? styles.durationCompact : styles.duration,
                themed.badge,
                themed.badgeText,
              ]}
              testID={`${testID}-duration`}
              variant="labelSmall"
            >
              {duration}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    overflow: 'hidden',
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  duration: {
    borderRadius: spacing.xs,
    bottom: spacing.xs,
    overflow: 'hidden',
    paddingHorizontal: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
  },
  durationCompact: {
    borderTopLeftRadius: spacing.xs,
    bottom: 0,
    fontSize: 9,
    lineHeight: 11,
    overflow: 'hidden',
    paddingHorizontal: 2,
    position: 'absolute',
    right: 0,
  },
  fill: {
    flex: 1,
  },
  image: {
    flex: 1,
  },
  play: {
    borderRadius: 20,
    opacity: 0.85,
    padding: spacing.xs,
  },
  playCompact: {
    borderRadius: 10,
    opacity: 0.85,
    padding: 2,
  },
  playLayer: {
    alignItems: 'center',
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
