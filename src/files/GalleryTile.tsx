import React, { useMemo } from 'react';
import { Image, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Badge, Icon, useTheme } from 'react-native-paper';

import type { FileEntryDto } from '../native/CloudSyncContracts';
import { density, gridColumns, spacing } from '../theme/spacing';
import { StatusChip } from './StatusChip';
import { galleryTileLabel, originBadgeLabel } from './a11y';
import { useLocalImage } from './useLocalImage';

/** The edge of one square gallery tile on a screen [screenWidth] wide. */
export function galleryTileSize(screenWidth: number): number {
  return (screenWidth - (gridColumns - 1) * density.tileGap) / gridColumns;
}

const BROKEN_ICON_SIZE = 32;

export interface GalleryTileProps {
  /** The snapshot [entry] was read from. */
  snapshotId: string;
  entry: FileEntryDto;
  /** The alias of the entry's source, or undefined while not known. */
  alias: string | undefined;
}

/**
 * One gallery tile: the local thumbnail (a placeholder while it loads, a
 * broken-image icon when it cannot be read), a status chip, and, when the
 * same file name exists in another source folder, an origin badge with this
 * file's source alias (FR-001, clarification 1).
 */
export function GalleryTile({
  snapshotId,
  entry,
  alias,
}: GalleryTileProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const size = galleryTileSize(width);
  const { uri, failed } = useLocalImage(snapshotId, entry.entryId);
  const origin = entry.nameInOtherSource && alias ? alias : undefined;

  const themed = useMemo(
    () =>
      StyleSheet.create({
        tile: {
          backgroundColor: theme.colors.surfaceVariant,
          height: size,
          width: size,
        },
      }),
    [size, theme.colors.surfaceVariant],
  );

  return (
    <View
      accessibilityLabel={galleryTileLabel(entry.name, entry.status, origin)}
      style={[styles.tile, themed.tile]}
      testID={`gallery-tile-${entry.entryId}`}
    >
      {uri != null ? (
        <Image
          source={{ uri }}
          style={styles.image}
          testID="gallery-tile-image"
        />
      ) : failed ? (
        <View style={styles.center} testID="gallery-tile-broken">
          <Icon
            color={theme.colors.onSurfaceVariant}
            size={BROKEN_ICON_SIZE}
            source="image-broken-variant"
          />
        </View>
      ) : (
        <View style={styles.center} testID="gallery-tile-placeholder" />
      )}
      <View style={styles.status}>
        <StatusChip status={entry.status} />
      </View>
      {origin != null ? (
        <Badge
          accessibilityLabel={originBadgeLabel(origin)}
          style={styles.badge}
          testID="gallery-tile-badge"
        >
          {origin}
        </Badge>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    maxWidth: '90%',
    paddingHorizontal: spacing.xs,
    position: 'absolute',
    right: spacing.xs,
    top: spacing.xs,
  },
  center: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  image: {
    flex: 1,
  },
  status: {
    bottom: spacing.xs,
    left: spacing.xs,
    position: 'absolute',
  },
  tile: {
    overflow: 'hidden',
  },
});
