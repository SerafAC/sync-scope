import React, { useCallback, useEffect, useRef } from 'react';
import {
  FlatList,
  StyleSheet,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import type { FileFilter } from '../native/CloudSyncContracts';
import { useSelection } from '../selection/SelectionProvider';
import { density } from '../theme/spacing';
import { chipCount } from '../theme/statusLabels';
import { FileRow } from './FileRow';
import { FolderRow, PlaceholderRow } from './FolderRow';
import { useFiles } from './useFiles';
import { useOpenPreview } from './useOpenPreview';
import type { TreePath, TreeRow, UseTreeResult } from './useTree';

export interface TreeViewProps {
  /** The filter the rows were read under: a source row's count is its chip count. */
  filter: FileFilter;
  /** The snapshot the rows were read from; the preview and thumbnails read it. */
  snapshotId: string | null;
  tree: Pick<
    UseTreeResult,
    'rows' | 'toggle' | 'loadMore' | 'anchorIndex' | 'anchorGeneration'
  >;
  /**
   * The tree is on screen (default true). A hidden tree scrolls to a new
   * snapshot's anchor when it is shown (007 FR-014).
   */
  visible?: boolean;
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 };

function keyOf(row: TreeRow): string {
  return row.key;
}

function getItemLayout(_: unknown, index: number) {
  return {
    length: density.rowHeight,
    offset: density.rowHeight * index,
    index,
  };
}

/** The name path a row is re-found by on a new snapshot (research R3). */
function pathOf(row: TreeRow): TreePath {
  return row.kind === 'more' || row.kind === 'placeholder'
    ? row.folderPath
    : row.path;
}

function samePath(a: TreePath | null, b: TreePath): boolean {
  return (
    a != null && a.length === b.length && a.every((part, i) => part === b[i])
  );
}

/**
 * The tree view (research R1, R2, R11): one `FlatList` of the flattened
 * `useTree` rows, every row `density.rowHeight` high so `getItemLayout`
 * holds, indented by depth. Sources and folders expand and collapse with
 * a tap or their chevron, are dimmed with "0" when nothing beneath matches
 * the filter, and are never selectable. File rows select as in list view:
 * a long-press starts selecting, a tap toggles while selecting and
 * otherwise opens a media file's preview. A `more` row reads its folder's
 * next page once visible. No fast scrollbar: the rows mix several
 * queries, so no band has a single meaning.
 *
 * The first visible row's name path is kept as `anchor` in the tree state
 * after each user scroll; when `useTree` re-finds it on a new snapshot the
 * list scrolls back there, once shown if it is hidden (007 FR-014).
 */
export function TreeView({
  filter,
  snapshotId,
  tree,
  visible = true,
}: TreeViewProps): React.JSX.Element {
  const { rows, toggle, loadMore, anchorIndex, anchorGeneration } = tree;
  const { setTree } = useFiles();
  const {
    isSelected,
    isSelecting,
    items,
    longPress,
    toggle: select,
  } = useSelection();
  const openPreview = useOpenPreview(snapshotId);

  const renderRow = useCallback(
    ({ item }: { item: TreeRow }) => {
      switch (item.kind) {
        case 'source':
          return (
            <FolderRow
              depth={item.depth}
              expanded={item.expanded}
              matching={chipCount(filter, item.counts)}
              name={item.alias}
              onPress={() => toggle(item)}
            />
          );
        case 'folder':
          return (
            <FolderRow
              depth={item.depth}
              expanded={item.expanded}
              matching={item.matchingFileCount}
              name={item.name}
              onPress={() => toggle(item)}
            />
          );
        case 'file':
          return (
            <FileRow
              depth={item.depth}
              entry={item.entry}
              onLongPress={longPress}
              onPress={isSelecting ? select : openPreview}
              selected={isSelected(item.entry.entryId)}
              snapshotId={snapshotId}
            />
          );
        default:
          // A folder's next page or first page not read yet.
          return <PlaceholderRow depth={item.depth} />;
      }
    },
    [
      filter,
      isSelected,
      isSelecting,
      longPress,
      openPreview,
      select,
      snapshotId,
      toggle,
    ],
  );

  // FlatList takes one onViewableItemsChanged for its lifetime.
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;
  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: readonly { item?: TreeRow; index?: number | null }[];
    }) => {
      for (const token of viewableItems) {
        if (token.item?.kind === 'more') {
          loadMoreRef.current(token.item);
        }
      }
    },
  ).current;

  /**
   * The anchor is the top row with any of it on screen, recorded only when
   * the user's scroll settles: a re-read that shortens the rows also moves
   * the offset, and must not move the anchor with it.
   */
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const recordAnchor = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const offset = event.nativeEvent.contentOffset.y;
      const index = Math.max(0, Math.floor((offset + 1) / density.rowHeight));
      const row = rowsRef.current[index];
      if (row == null) {
        return;
      }
      const path = index === 0 ? null : pathOf(row);
      setTree(previous =>
        path == null
          ? previous.anchor == null
            ? previous
            : { ...previous, anchor: null }
          : samePath(previous.anchor, path)
          ? previous
          : { ...previous, anchor: path },
      );
    },
    [setTree],
  );
  /**
   * Scrolls back to the re-found anchor once per re-read. A hidden tree
   * keeps it pending and scrolls once shown and laid out: a list scrolled
   * while hidden has no height to scroll in.
   */
  const listRef = useRef<FlatList<TreeRow>>(null);
  const handledAnchor = useRef<number | null>(null);
  const pendingAnchor = useRef<number | null>(null);
  const laidOut = useRef(false);
  const scrollToPending = useCallback(() => {
    const index = pendingAnchor.current;
    if (index == null || !laidOut.current) {
      return;
    }
    pendingAnchor.current = null;
    if (index < rowsRef.current.length) {
      listRef.current?.scrollToIndex({ index, animated: false });
    }
  }, []);
  useEffect(() => {
    if (anchorIndex == null) {
      handledAnchor.current = null;
      pendingAnchor.current = null;
      return;
    }
    // Each re-find is its own generation: a re-find at the same index as the
    // last one still scrolls back, as the user may have scrolled away since.
    if (handledAnchor.current !== anchorGeneration) {
      handledAnchor.current = anchorGeneration;
      pendingAnchor.current = anchorIndex;
    }
    if (visible) {
      scrollToPending();
    }
  }, [anchorIndex, anchorGeneration, visible, scrollToPending]);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const onLayout = useCallback(
    (event: LayoutChangeEvent) => {
      laidOut.current = event.nativeEvent.layout.height > 0;
      if (visibleRef.current) {
        scrollToPending();
      }
    },
    [scrollToPending],
  );

  return (
    <FlatList
      data={rows}
      extraData={items}
      getItemLayout={getItemLayout}
      keyExtractor={keyOf}
      // A drag records where it is let go, and a fling where it stops.
      onLayout={onLayout}
      onMomentumScrollEnd={recordAnchor}
      onScrollEndDrag={recordAnchor}
      onViewableItemsChanged={onViewableItemsChanged}
      ref={listRef}
      renderItem={renderRow}
      style={styles.list}
      testID="tree-rows"
      viewabilityConfig={VIEWABILITY}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    flex: 1,
  },
});
