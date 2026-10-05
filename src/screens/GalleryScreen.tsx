import React, { useCallback, useMemo } from 'react';
import {
  FlatList,
  StyleSheet,
  useWindowDimensions,
  type ListRenderItemInfo,
} from 'react-native';
import { ActivityIndicator } from 'react-native-paper';

import {
  FilesMessage,
  NO_MATCHES_TEXT,
  NO_SCAN_TEXT,
  useReportToFilesScreen,
  type FilesViewProps,
} from '../files/FilesViewParts';
import { GalleryTile, galleryTileSize } from '../files/GalleryTile';
import { useFiles } from '../files/useFiles';
import { PAGED_QUERY_PAGE_SIZE, usePagedQuery } from '../files/usePagedQuery';
import { queryFiles } from '../native/CloudSync';
import type { FileEntryDto, QuerySpec } from '../native/CloudSyncContracts';
import { useSelection } from '../selection/SelectionProvider';
import { density, gridColumns, spacing } from '../theme/spacing';

/**
 * The gallery (FR-001): a virtualized three-column grid of the active
 * snapshot's images, newest first (clarification 5), read page by page
 * through `queryFiles` under the shared filter. A long-press starts the
 * selection; while selecting, a tap toggles a tile (FR-015).
 */
export function GalleryScreen(props: FilesViewProps): React.JSX.Element {
  const { snapshotId, scanLoading, aliases, onSnapshotLost, reloadKey } =
    props;
  const { filter } = useFiles();
  const { isSelected, isSelecting, items, longPress, toggle } = useSelection();
  const { width } = useWindowDimensions();
  const tileSize = galleryTileSize(width);

  const query = useMemo<QuerySpec>(
    () => ({
      filter,
      view: 'GALLERY',
      sort: 'TIME_DESC',
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [filter],
  );
  const paged = usePagedQuery({
    snapshotId,
    query,
    read: queryFiles,
    onSnapshotLost,
    reloadKey,
  });
  useReportToFilesScreen(
    paged.counts,
    paged.snapshotChanged,
    paged.acknowledgeSnapshotChange,
    props,
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<FileEntryDto>) =>
      snapshotId == null ? null : (
        <GalleryTile
          alias={aliases.get(item.sourceId)}
          entry={item}
          onLongPress={longPress}
          onPress={isSelecting ? toggle : undefined}
          selected={isSelected(item.entryId)}
          snapshotId={snapshotId}
        />
      ),
    [aliases, snapshotId, isSelected, isSelecting, longPress, toggle],
  );

  const getItemLayout = useCallback(
    (_: unknown, index: number) => {
      // With numColumns, the list lays out rows: `index` is a row index.
      const length = tileSize + density.tileGap;
      return { length, offset: length * index, index };
    },
    [tileSize],
  );

  if (snapshotId == null) {
    return scanLoading ? (
      <FilesMessage loading />
    ) : (
      <FilesMessage text={NO_SCAN_TEXT} />
    );
  }
  if (paged.phase === 'loading-first' || paged.phase === 'idle') {
    return <FilesMessage loading />;
  }
  if (paged.entries.length === 0) {
    return paged.phase === 'error' ? (
      <FilesMessage error={paged.error} onRetry={paged.retry} />
    ) : (
      <FilesMessage text={NO_MATCHES_TEXT} />
    );
  }

  return (
    <FlatList
      ListFooterComponent={
        paged.phase === 'error' ? (
          <FilesMessage error={paged.error} onRetry={paged.retry} />
        ) : paged.phase === 'loading-more' ? (
          <ActivityIndicator
            accessibilityLabel="Loading more files"
            style={styles.footer}
          />
        ) : undefined
      }
      columnWrapperStyle={styles.row}
      data={paged.entries}
      extraData={items}
      getItemLayout={getItemLayout}
      keyExtractor={item => item.entryId}
      maxToRenderPerBatch={30}
      numColumns={gridColumns}
      onEndReached={paged.loadMore}
      onEndReachedThreshold={1}
      removeClippedSubviews
      renderItem={renderItem}
      testID="gallery-grid"
      windowSize={7}
    />
  );
}

const styles = StyleSheet.create({
  footer: {
    padding: spacing.lg,
  },
  row: {
    gap: density.tileGap,
    marginBottom: density.tileGap,
  },
});
