import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  StyleSheet,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
  type ListRenderItemInfo,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { ActivityIndicator, useTheme } from 'react-native-paper';

import { FastScroller } from '../files/FastScroller';
import {
  FilesMessage,
  NO_MATCHES_TEXT,
  NO_SCAN_TEXT,
  useReportToFilesScreen,
  type FilesViewProps,
} from '../files/FilesViewParts';
import { GalleryTile, galleryTileSize } from '../files/GalleryTile';
import { placeholderLabel } from '../files/a11y';
import { useFiles } from '../files/useFiles';
import {
  isPlaceholder,
  PAGED_QUERY_PAGE_SIZE,
  scrollAnchorOf,
  usePagedQuery,
  type IndexReader,
  type PagedRow,
} from '../files/usePagedQuery';
import { getScrollIndex, queryFiles } from '../native/CloudSync';
import type { QuerySpec, ScrollAnchor } from '../native/CloudSyncContracts';
import { useSelection } from '../selection/SelectionProvider';
import { density, gridColumns, spacing } from '../theme/spacing';

const readIndex: IndexReader = (snapshotId, query, anchor) =>
  anchor == null
    ? getScrollIndex(snapshotId, query)
    : getScrollIndex(snapshotId, query, anchor);

/** The first visible file's anchor, valid only for the sort and filter it was taken under. */
interface ScopedAnchor {
  scope: string;
  anchor: ScrollAnchor;
}

function sameAnchor(a: ScopedAnchor | null, b: ScopedAnchor): boolean {
  return (
    a != null &&
    a.scope === b.scope &&
    a.anchor.sortValue === b.anchor.sortValue &&
    a.anchor.sortName === b.anchor.sortName
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 };

/** An empty cell that ends a band's last grid row, so every band starts a row. */
interface FillerCell {
  readonly filler: true;
  readonly key: string;
}

type GalleryCell = PagedRow | FillerCell;

function isFiller(cell: GalleryCell): cell is FillerCell {
  return (cell as Partial<FillerCell>).filler === true;
}

function keyOf(cell: GalleryCell): string {
  return isFiller(cell) || isPlaceholder(cell) ? cell.key : cell.entryId;
}

interface GalleryGrid {
  cells: GalleryCell[];
  /** For each cell, the index in `rows` of its row, or of the row before a filler. */
  rowOf: number[];
  /** For each band, the index of its first cell: always the start of a grid row. */
  bandCells: number[];
}

/**
 * Lays [rows] out in [columns] so each band of the scroll index starts a new
 * grid row: a jump puts the band's first file top left (Story 2 sc. 6, flow
 * polish/03). Without bands the cells are the rows.
 */
export function galleryGrid(
  rows: readonly PagedRow[],
  bandStarts: readonly number[],
  columns: number,
): GalleryGrid {
  if (bandStarts.length === 0) {
    return { cells: [...rows], rowOf: rows.map((_, i) => i), bandCells: [] };
  }
  const cells: GalleryCell[] = [];
  const rowOf: number[] = [];
  const bandCells: number[] = [];
  bandStarts.forEach((start, band) => {
    const end = bandStarts[band + 1] ?? rows.length;
    bandCells.push(cells.length);
    for (let i = start; i < end; i += 1) {
      const row = rows[i];
      if (row != null) {
        cells.push(row);
        rowOf.push(i);
      }
    }
    while (band < bandStarts.length - 1 && cells.length % columns !== 0) {
      cells.push({ filler: true, key: `filler-${band}-${cells.length}` });
      rowOf.push(Math.max(start, end - 1));
    }
  });
  return { cells, rowOf, bandCells };
}

/** A tile of a band not read yet: the theme's surface variant, no spinner (plan › Risks). */
function PlaceholderTile({ size }: { size: number }): React.JSX.Element {
  const theme = useTheme();
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
      accessibilityLabel={placeholderLabel()}
      accessible
      style={themed.tile}
      testID="gallery-placeholder"
    />
  );
}

/**
 * The gallery (FR-001): a virtualized three-column grid of the active
 * snapshot's images in the gallery's own sort (007 FR-003, newest first on
 * first run), read through `queryFiles` under the shared filter.
 * A sort change reloads from page 1 and keeps the filter and the selection. A long-press starts the
 * selection; while selecting, a tap toggles a tile (FR-015).
 *
 * Page 1 and the scroll index are read together (007 research R7): once the
 * index is in, the grid has its full length, with placeholder tiles for the
 * bands not read yet. Bands load as they come into view, one screen ahead,
 * and the `FastScroller` jumps to any band (FR-006).
 *
 * The first visible file is kept as the scroll anchor (research R8). When a
 * new snapshot replaces the rows, the grid opens at that file, or where it
 * would be, instead of at the top (FR-014), also while the gallery is hidden.
 */
export function GalleryScreen(props: FilesViewProps): React.JSX.Element {
  const {
    snapshotId,
    scanLoading,
    aliases,
    onSnapshotLost,
    reloadKey,
    visible = true,
  } = props;
  const { filter, sorts } = useFiles();
  const sort = sorts.GALLERY;
  const { isSelected, isSelecting, items, longPress, toggle } = useSelection();
  const { width, height: windowHeight } = useWindowDimensions();
  const tileSize = galleryTileSize(width);
  const rowLength = tileSize + density.tileGap;
  const sized = useMemo(
    () => StyleSheet.create({ filler: { height: tileSize, width: tileSize } }),
    [tileSize],
  );

  const query = useMemo<QuerySpec>(
    () => ({
      filter,
      view: 'GALLERY',
      sort,
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [filter, sort],
  );
  const scope = `${sort}\u0000${filter}`;
  const [anchor, setAnchor] = useState<ScopedAnchor | null>(null);
  const paged = usePagedQuery({
    snapshotId,
    query,
    read: queryFiles,
    readIndex,
    onSnapshotLost,
    reloadKey,
    anchor: anchor?.scope === scope ? anchor.anchor : null,
  });
  useReportToFilesScreen(
    paged.counts,
    paged.snapshotChanged,
    paged.acknowledgeSnapshotChange,
    props,
  );

  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  /** The first visible file among the files: where the scrollbar's thumb rests. */
  const [firstIndex, setFirstIndex] = useState(0);
  const listRef = useRef<FlatList<GalleryCell>>(null);
  const { rows, bandStarts, scrollIndex } = paged;
  const grid = useMemo(
    () => galleryGrid(rows, bandStarts, gridColumns),
    [rows, bandStarts],
  );
  const gridRef = useRef(grid);
  gridRef.current = grid;
  const viewport = viewportHeight > 0 ? viewportHeight : windowHeight;
  /** Tiles in one screen: the look-ahead of a band load. */
  const screenful = Math.ceil(viewport / rowLength) * gridColumns;

  const { loadRange } = paged;
  const loadVisible = useRef<(first: number, last: number) => void>(() => {});
  // Viewable indexes are cells; band loads take indexes of `rows`.
  loadVisible.current = (first, last) => {
    const { rowOf } = gridRef.current;
    const from = rowOf[first];
    const to = rowOf[Math.min(last, rowOf.length - 1)];
    if (from != null) {
      setFirstIndex(from);
    }
    if (from != null && to != null) {
      loadRange(from, to + screenful);
    }
  };
  // FlatList takes one onViewableItemsChanged for its lifetime.
  const onViewableItemsChanged = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: readonly { index?: number | null }[];
    }) => {
      const indexes = viewableItems
        .map(token => token.index)
        .filter((index): index is number => index != null);
      if (indexes.length > 0) {
        loadVisible.current(Math.min(...indexes), Math.max(...indexes));
      }
    },
  ).current;

  const onLayout = useCallback(
    (event: LayoutChangeEvent) =>
      setViewportHeight(event.nativeEvent.layout.height),
    [],
  );
  /**
   * `scrollOffset` is the shown grid's: false from the moment the grid is
   * replaced by a loading state until its next scroll event.
   */
  const offsetValid = useRef(false);
  const gridShown =
    snapshotId != null &&
    paged.phase !== 'loading-first' &&
    paged.phase !== 'idle' &&
    rows.length > 0;
  useEffect(() => {
    if (!gridShown) {
      offsetValid.current = false;
    }
  }, [gridShown]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetValid.current = true;
      setScrollOffset(event.nativeEvent.contentOffset.y);
    },
    [],
  );
  // The anchor is the first file of the top grid row with any of its tiles
  // on screen (research R8): the first file the user sees.
  useEffect(() => {
    if (!offsetValid.current) {
      return;
    }
    const { cells, rowOf } = grid;
    // Less than a point of a row, or only the gap below it, is not on screen.
    const top = Math.max(0, scrollOffset + 1);
    let gridRow = Math.floor(top / rowLength);
    if (top - gridRow * rowLength > tileSize) {
      gridRow += 1;
    }
    let cell = gridRow * gridColumns;
    while (cell < cells.length && isFiller(cells[cell] as GalleryCell)) {
      cell += 1;
    }
    const at = rowOf[cell];
    const row = at == null ? undefined : rows[at];
    if (row == null || isPlaceholder(row)) {
      return;
    }
    const next = { scope, anchor: scrollAnchorOf(row, sort) };
    setAnchor(current => (sameAnchor(current, next) ? current : next));
  }, [grid, rowLength, rows, scope, scrollOffset, sort, tileSize]);
  /** [index] is a file's position among the files: a band's `startIndex`. */
  const onJump = useCallback(
    (index: number) => {
      const bands = scrollIndex?.bands ?? [];
      const band = bands.findIndex(
        b => index >= b.startIndex && index < b.startIndex + b.count,
      );
      const start = bandStarts[band];
      const cell = grid.bandCells[band];
      const first = bands[band];
      if (start == null || cell == null || first == null) {
        return;
      }
      const offset = index - first.startIndex;
      loadRange(start + offset, start + offset + screenful);
      listRef.current?.scrollToIndex({
        index: Math.floor((cell + offset) / gridColumns),
        animated: false,
      });
    },
    [bandStarts, grid.bandCells, loadRange, scrollIndex, screenful],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<GalleryCell>) =>
      snapshotId == null ? null : isFiller(item) ? (
        <View style={sized.filler} testID="gallery-filler" />
      ) : isPlaceholder(item) ? (
        <PlaceholderTile size={tileSize} />
      ) : (
        <GalleryTile
          alias={aliases.get(item.sourceId)}
          entry={item}
          onLongPress={longPress}
          onPress={isSelecting ? toggle : undefined}
          selected={isSelected(item.entryId)}
          snapshotId={snapshotId}
        />
      ),
    [
      aliases,
      snapshotId,
      isSelected,
      isSelecting,
      longPress,
      toggle,
      tileSize,
      sized,
    ],
  );

  /** The grid row of the anchor after a snapshot change: where the grid opens. */
  const { anchorIndex } = paged;
  const anchorRow = useMemo(() => {
    if (anchorIndex == null) {
      return undefined;
    }
    const bands = scrollIndex?.bands ?? [];
    const band = bands.findIndex(
      b => anchorIndex >= b.startIndex && anchorIndex < b.startIndex + b.count,
    );
    const first = bands[band];
    const cell = grid.bandCells[band];
    const at =
      first == null || cell == null
        ? anchorIndex
        : cell + anchorIndex - first.startIndex;
    return Math.floor(at / gridColumns);
  }, [anchorIndex, grid.bandCells, scrollIndex]);
  /**
   * The grid opened at the anchor while on screen. Until then a hidden
   * gallery holds its grid back: a list mounted hidden at a far index stays
   * blank when shown (Story 4 sc. 4).
   */
  const anchorShown = useRef(false);
  useEffect(() => {
    if (anchorRow == null) {
      anchorShown.current = false;
    } else if (visible) {
      anchorShown.current = true;
    }
  }, [anchorRow, visible]);
  const holdForAnchor = anchorRow != null && !visible && !anchorShown.current;

  const getItemLayout = useCallback(
    (_: unknown, index: number) =>
      // With numColumns, the list lays out rows: `index` is a row index.
      ({ length: rowLength, offset: rowLength * index, index }),
    [rowLength],
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
  if (rows.length === 0) {
    return paged.phase === 'error' ? (
      <FilesMessage error={paged.error} onRetry={paged.retry} />
    ) : (
      <FilesMessage text={NO_MATCHES_TEXT} />
    );
  }

  if (holdForAnchor) {
    return <View style={styles.gallery} testID="gallery" />;
  }

  const index = scrollIndex;
  return (
    <View onLayout={onLayout} style={styles.gallery} testID="gallery">
      <FlatList
        ListFooterComponent={
          paged.phase === 'error' ? (
            <FilesMessage error={paged.error} onRetry={paged.retry} />
          ) : paged.phase === 'loading-more' && index == null ? (
            <ActivityIndicator
              accessibilityLabel="Loading more files"
              style={styles.footer}
            />
          ) : undefined
        }
        columnWrapperStyle={styles.row}
        data={grid.cells}
        extraData={items}
        getItemLayout={getItemLayout}
        initialScrollIndex={anchorRow}
        keyExtractor={keyOf}
        maxToRenderPerBatch={30}
        numColumns={gridColumns}
        onEndReached={paged.loadMore}
        onEndReachedThreshold={1}
        onScroll={onScroll}
        onViewableItemsChanged={onViewableItemsChanged}
        ref={listRef}
        removeClippedSubviews
        renderItem={renderItem}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={index == null}
        testID="gallery-grid"
        viewabilityConfig={VIEWABILITY}
        windowSize={7}
      />
      {index != null ? (
        <FastScroller
          bands={index.bands}
          contentHeight={Math.ceil(grid.cells.length / gridColumns) * rowLength}
          onJump={onJump}
          firstIndex={firstIndex}
          scrollOffset={scrollOffset}
          unit={index.unit}
          viewportHeight={viewport}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    padding: spacing.lg,
  },
  gallery: {
    flex: 1,
  },
  row: {
    gap: density.tileGap,
    marginBottom: density.tileGap,
  },
});
