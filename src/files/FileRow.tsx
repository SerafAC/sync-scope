import React, { memo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { List } from 'react-native-paper';

import type { FileEntryDto } from '../native/CloudSyncContracts';
import { formatTimestamp } from '../scan/ScanSummaryCard';
import { density, spacing } from '../theme/spacing';
import { MediaThumbnail } from './MediaThumbnail';
import { StatusChip } from './StatusChip';
import { fileRowLabel } from './a11y';
import { isMediaMime } from './media';

/** The square of a row's thumbnail in dp; it fits within `density.rowHeight`. */
export const FILE_ROW_THUMBNAIL_SIZE = 40;

/** The long edge in px a row's thumbnail is requested at (research R6). */
export const FILE_ROW_THUMBNAIL_EDGE_PX = 128;

/** The deepest level that still indents; deeper rows keep this indent. */
export const FILE_ROW_MAX_DEPTH = 8;

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** `512 B`, `1.5 KB`, `12 MB`: one decimal below 10 units. */
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const shown =
    unit === 0 || value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${shown} ${UNITS[unit]}`;
}

/** The left indent of a row at [depth]: `spacing.lg` per level, up to depth 8. */
export function fileRowIndent(depth: number | undefined): number {
  if (depth == null || !(depth > 0)) {
    return 0;
  }
  return Math.min(Math.floor(depth), FILE_ROW_MAX_DEPTH) * spacing.lg;
}

function FileIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <View testID="file-row-icon">
      <List.Icon color={color} icon="file-outline" />
    </View>
  );
}

/** A selected file row's icon: a check mark, so the state is not colour alone (FR-017). */
function SelectedIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <View testID="list-row-selected">
      <List.Icon color={color} icon="check-circle" />
    </View>
  );
}

export interface FileRowProps {
  /** The snapshot [entry] was read from; a media row's thumbnail reads nothing while null. */
  snapshotId: string | null;
  entry: FileEntryDto;
  selected: boolean;
  /** A tap; given only while selecting (it toggles). */
  onPress?: (entry: FileEntryDto) => void;
  /** A long-press starts the selection with this row (FR-015). */
  onLongPress: (entry: FileEntryDto) => void;
  /** The tree depth: indents by `spacing.lg` per level, up to depth 8. List view passes none. */
  depth?: number;
}

/**
 * A file row, shared by list and tree views: name, size, modified time and
 * status; never an origin badge (FR-002). An image or a video shows its
 * 40 dp local thumbnail, requested at a 128 px edge, with a play badge and
 * duration for videos (research R6, FR-005); other files keep the file icon.
 * A long-press starts the selection; [onPress] (given only while selecting)
 * toggles it. A selected row shows a check mark and announces `, selected`
 * (FR-015, FR-017). Every row is `density.rowHeight` high, at any depth.
 */
export const FileRow = memo(function FileRowBody({
  snapshotId,
  entry,
  selected,
  onPress,
  onLongPress,
  depth,
}: FileRowProps): React.JSX.Element {
  const details = [
    entry.sizeBytes == null ? null : formatSize(entry.sizeBytes),
    entry.modifiedUtcMillis == null
      ? null
      : formatTimestamp(entry.modifiedUtcMillis),
  ].filter(part => part != null);
  const indent = fileRowIndent(depth);
  const media = isMediaMime(entry.mimeType);
  const renderThumbnail = () => (
    <View style={styles.thumbnail}>
      <MediaThumbnail
        decorative
        edge={FILE_ROW_THUMBNAIL_EDGE_PX}
        entryId={entry.entryId}
        mimeType={entry.mimeType}
        name={entry.name}
        size={FILE_ROW_THUMBNAIL_SIZE}
        snapshotId={snapshotId}
        testID="file-row-thumbnail"
      />
    </View>
  );
  const left = selected ? SelectedIcon : media ? renderThumbnail : FileIcon;
  return (
    <Pressable
      accessibilityLabel={fileRowLabel(entry.name, entry.status, selected)}
      accessibilityState={{ selected }}
      onLongPress={() => onLongPress(entry)}
      onPress={onPress ? () => onPress(entry) : undefined}
      style={[styles.row, indent > 0 ? { paddingLeft: indent } : null]}
    >
      <List.Item
        description={details.join(' · ')}
        left={left}
        style={styles.item}
        title={entry.name}
      />
      <StatusChip status={entry.status} />
    </Pressable>
  );
});

const styles = StyleSheet.create({
  item: {
    flex: 1,
    paddingVertical: 0,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    height: density.rowHeight,
    paddingRight: spacing.lg,
  },
  thumbnail: {
    justifyContent: 'center',
    marginLeft: spacing.lg,
  },
});
