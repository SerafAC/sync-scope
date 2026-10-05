import React, { memo, useMemo } from 'react';
import {
  Image,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
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
const CHECK_ICON_SIZE = 24;

export interface GalleryTileProps {
  /** The snapshot [entry] was read from. */
  snapshotId: string;
  entry: FileEntryDto;
  /** The alias of the entry's source, or undefined while not known. */
  alias: string | undefined;
  /** The tile is in the selection: a check mark and `, selected` (FR-017). */
  selected?: boolean;
  /** A tap; the gallery passes it only while selecting (it toggles). */
  onPress?: (entry: FileEntryDto) => void;
  /** A long-press starts the selection with this tile (FR-015). */
  onLongPress?: (entry: FileEntryDto) => void;
}

/**
 * One gallery tile: the local thumbnail (a placeholder while it loads, a
 * broken-image icon when it cannot be read), a status chip, and, when the
 * same file name exists in another source folder, an origin badge with this
 * file's source alias (FR-001, clarification 1). A selected tile shows a
 * check-circle overlay and announces `, selected` (FR-017); the tile size
 * never changes, so the grid's `getItemLayout` stays valid.
 */
export const GalleryTile = memo(function GalleryTileBody({
  snapshotId,
  entry,
  alias,
  selected = false,
  onPress,
  onLongPress,
}: GalleryTileProps): React.JSX.Element {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const size = galleryTileSize(width);
  const { uri, failed } = useLocalImage(snapshotId, entry.entryId);
  const origin = entry.nameInOtherSource && alias ? alias : undefined;

  const themed = useMemo(
    () =>
      StyleSheet.create({
        check: {
          backgroundColor: theme.colors.surface,
          borderRadius: CHECK_ICON_SIZE / 2,
        },
        selected: {
          borderColor: theme.colors.primary,
        },
        tile: {
          backgroundColor: theme.colors.surfaceVariant,
          height: size,
          width: size,
        },
      }),
    [
      size,
      theme.colors.primary,
      theme.colors.surface,
      theme.colors.surfaceVariant,
    ],
  );

  return (
    <Pressable
      accessibilityLabel={galleryTileLabel(
        entry.name,
        entry.status,
        origin,
        selected,
      )}
      accessibilityState={{ selected }}
      onLongPress={onLongPress ? () => onLongPress(entry) : undefined}
      onPress={onPress ? () => onPress(entry) : undefined}
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
      {selected ? (
        <>
          <View
            pointerEvents="none"
            style={[styles.selectedFrame, themed.selected]}
            testID="gallery-tile-selected"
          />
          <View style={[styles.check, themed.check]}>
            <Icon
              color={theme.colors.primary}
              size={CHECK_ICON_SIZE}
              source="check-circle"
            />
          </View>
        </>
      ) : null}
    </Pressable>
  );
});

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
  check: {
    left: spacing.xs,
    position: 'absolute',
    top: spacing.xs,
  },
  image: {
    flex: 1,
  },
  selectedFrame: {
    borderWidth: 3,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
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
