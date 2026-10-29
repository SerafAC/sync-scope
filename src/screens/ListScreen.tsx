import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  FlatList,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { Breadcrumb } from '../files/Breadcrumb';
import { FastScroller } from '../files/FastScroller';
import {
  FilesMessage,
  NO_MATCHES_TEXT,
  NO_SCAN_TEXT,
  useReportToFilesScreen,
  type FilesViewProps,
} from '../files/FilesViewParts';
import { FileRow, formatSize } from '../files/FileRow';
import { FolderRow, PlaceholderRow } from '../files/FolderRow';
import { useFiles } from '../files/useFiles';
import { useOpenPreview } from '../files/useOpenPreview';
import { sumCounts, useSourceCounts } from '../files/useSourceCounts';
import { useListNavigation } from '../files/useListNavigation';
import {
  isPlaceholder,
  PAGED_QUERY_PAGE_SIZE,
  readTreeChildren,
  scrollAnchorOf,
  usePagedQuery,
  type IndexReader,
  type PagedRow,
} from '../files/usePagedQuery';
import { getScrollIndex } from '../native/CloudSync';
import type { QuerySpec, ScrollAnchor } from '../native/CloudSyncContracts';
import { useSelection } from '../selection/SelectionProvider';
import { density } from '../theme/spacing';
import { chipCount } from '../theme/statusLabels';

export const NO_SOURCES_TEXT = 'No folders added yet.';

/** The folder the list view shows; what "Select all" covers there (FR-015). */
export interface ListFolder {
  sourceId: string;
  /** null at the source root. */
  parentId: string | null;
}

export interface ListScreenProps extends FilesViewProps {
  /** The open folder, or null at the sources level, reported on every change. */
  onFolderChange?: (folder: ListFolder | null) => void;
}

export { formatSize };

/** The scroll index of a folder's files: the query carries the folder (research R4). */
const readIndex: IndexReader = (snapshotId, query, anchor) =>
  anchor == null
    ? getScrollIndex(snapshotId, query)
    : getScrollIndex(snapshotId, query, anchor);

/**
 * The first visible file's anchor, valid only in the folder (by its path of
 * names, which survives a new snapshot) and under the sort and filter it was
 * taken in.
 */
interface ScopedAnchor {
  scope: string;
  anchor: ScrollAnchor | null;
}

function sameAnchor(a: ScopedAnchor | null, b: ScopedAnchor): boolean {
  return (
    a != null &&
    a.scope === b.scope &&
    a.anchor?.sortValue === b.anchor?.sortValue &&
    a.anchor?.sortName === b.anchor?.sortName
  );
}

const VIEWABILITY = { itemVisiblePercentThreshold: 1 };

function keyOf(row: PagedRow): string {
  return isPlaceholder(row) ? row.key : row.entryId;
}

/**
 * The list view (FR-002): the sources at the top level, then each source's
 * folders through `queryTreeChildren`, with a breadcrumb back up.
 *
 * A folder is read by the band-segmented reader (007 research R3, R7): its
 * subfolders by name (`kind: 'DIRECTORY'`, always `NAME_ASC`) as the leading
 * segment, then its files in the list's sort (`kind: 'FILE'`), one segment
 * per band of the folder's scroll index, with placeholder rows of the fixed
 * `density.rowHeight` for bands not read yet. Folders are shown above the
 * files under every sort (FR-004). The `FastScroller` runs over the file
 * bands.
 * When a new snapshot replaces the rows, the folder is found again by name
 * (005 R2), then the list opens at the first file that was visible, or where
 * it would be, instead of at the top (research R8, FR-014).
 * Under a filter, every folder stays visible with its matching-file count.
 * File rows are selectable (FR-015); source and directory rows never are,
 * and tapping one navigates while the selection is kept (Story 5 sc. 7).
 * With nothing selected, a tap on a media file opens its preview (009 R8).
 */
export function ListScreen(props: ListScreenProps): React.JSX.Element {
  const {
    snapshotId,
    scanLoading,
    aliases,
    onSnapshotLost,
    onFolderChange,
    reloadKey = 0,
    visible = true,
  } = props;
  const { filter, sorts } = useFiles();
  const fileSort = sorts.LIST;
  const { isSelected, isSelecting, items, longPress, toggle } = useSelection();
  const nav = useListNavigation({
    snapshotId,
    sources: aliases.size > 0 ? aliases : null,
  });
  const { location } = nav;
  const folder = location.kind === 'folder' ? location : null;
  const parentId = folder?.path[folder.path.length - 1]?.entryId ?? null;
  const folderSourceId = folder?.sourceId ?? null;

  useEffect(() => {
    onFolderChange?.(
      folderSourceId == null ? null : { sourceId: folderSourceId, parentId },
    );
  }, [onFolderChange, folderSourceId, parentId]);

  const sourceIds = useMemo(() => [...aliases.keys()], [aliases]);
  const sourceCounts = useSourceCounts(
    snapshotId,
    sourceIds,
    filter,
    reloadKey,
  );

  const folderQuery = useMemo<QuerySpec>(
    () => ({
      filter,
      view: 'LIST',
      sort: 'NAME_ASC',
      sourceId: folderSourceId,
      parentId,
      kind: 'DIRECTORY',
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [filter, folderSourceId, parentId],
  );
  const fileQuery = useMemo<QuerySpec>(
    () => ({
      filter,
      view: 'LIST',
      sort: fileSort,
      sourceId: folderSourceId,
      parentId,
      kind: 'FILE',
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [filter, fileSort, folderSourceId, parentId],
  );
  const readSnapshot = folder != null ? nav.snapshotId : null;
  const scope = [
    fileSort,
    filter,
    folderSourceId,
    ...(folder?.path.map(level => level.name) ?? []),
  ].join('\u0000');
  const [anchor, setAnchor] = useState<ScopedAnchor | null>(null);
  const paged = usePagedQuery({
    snapshotId: readSnapshot,
    query: fileQuery,
    leadingQuery: folderQuery,
    read: readTreeChildren,
    readIndex,
    onSnapshotLost,
    reloadKey,
    anchor: anchor?.scope === scope ? anchor.anchor : null,
  });

  const totals = useMemo(
    () =>
      sourceCounts == null
        ? null
        : sumCounts(sourceIds.map(id => sourceCounts.get(id))),
    [sourceCounts, sourceIds],
  );
  const { relocate, snapshotId: navSnapshotId } = nav;
  const beforeAcknowledge = useCallback(async () => {
    if (navSnapshotId !== snapshotId) {
      await relocate();
    }
  }, [navSnapshotId, snapshotId, relocate]);
  useReportToFilesScreen(
    folder != null ? paged.counts : totals,
    paged.snapshotChanged,
    paged.acknowledgeSnapshotChange,
    props,
    beforeAcknowledge,
  );

  const { openFolder } = nav;
  const openPreview = useOpenPreview(readSnapshot);
  const renderEntry = useCallback(
    ({ item }: { item: PagedRow }) =>
      isPlaceholder(item) ? (
        <PlaceholderRow />
      ) : item.kind === 'DIRECTORY' ? (
        <FolderRow
          matching={item.matchingFileCount}
          name={item.name}
          onPress={() => openFolder(item.entryId, item.name)}
        />
      ) : (
        <FileRow
          entry={item}
          onLongPress={longPress}
          onPress={isSelecting ? toggle : openPreview}
          selected={isSelected(item.entryId)}
          snapshotId={readSnapshot}
        />
      ),
    [
      openFolder,
      isSelected,
      isSelecting,
      longPress,
      openPreview,
      readSnapshot,
      toggle,
    ],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: density.rowHeight,
      offset: density.rowHeight * index,
      index,
    }),
    [],
  );

  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  /** The first visible file among the folder's files: where the scrollbar's thumb rests. */
  const [firstIndex, setFirstIndex] = useState(0);
  const listRef = useRef<FlatList<PagedRow>>(null);
  /** Rows in one screen: the look-ahead of a band load. */
  const screenful = Math.max(1, Math.ceil(viewportHeight / density.rowHeight));
  const { loadRange, fileOffset } = paged;
  const loadVisible = useRef<(first: number, last: number) => void>(() => {});
  loadVisible.current = (first, last) => {
    setFirstIndex(Math.max(0, first - fileOffset));
    loadRange(first, last + screenful);
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
   * `scrollOffset` is the shown list's: false from the moment the list is
   * replaced by a loading state until its next scroll event.
   */
  const offsetValid = useRef(false);
  const listRows = paged.rows;
  const listShown =
    folder != null &&
    !nav.relocating &&
    paged.phase !== 'loading-first' &&
    paged.phase !== 'idle' &&
    listRows.length > 0;
  useEffect(() => {
    if (!listShown) {
      offsetValid.current = false;
    }
  }, [listShown]);
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      offsetValid.current = true;
      setScrollOffset(event.nativeEvent.contentOffset.y);
    },
    [],
  );
  // The anchor is the top row with any of it on screen (research R8); less
  // than a point of a row is not. A folder row there: the list reopens at
  // the top.
  useEffect(() => {
    if (!offsetValid.current) {
      return;
    }
    const row =
      listRows[Math.max(0, Math.floor((scrollOffset + 1) / density.rowHeight))];
    if (row == null || isPlaceholder(row)) {
      return;
    }
    const next = {
      scope,
      anchor: row.kind === 'FILE' ? scrollAnchorOf(row, fileSort) : null,
    };
    setAnchor(current => (sameAnchor(current, next) ? current : next));
  }, [fileSort, listRows, scope, scrollOffset]);
  const anchorShown = useRef(false);
  const pendingAnchor = paged.anchorIndex;
  useEffect(() => {
    if (pendingAnchor == null) {
      anchorShown.current = false;
    } else if (visible) {
      anchorShown.current = true;
    }
  }, [pendingAnchor, visible]);
  /** [index] counts the folder's files: the folder rows come before them. */
  const onJump = useCallback(
    (index: number) => {
      const row = fileOffset + index;
      loadRange(row, row + screenful);
      listRef.current?.scrollToIndex({ index: row, animated: false });
    },
    [fileOffset, loadRange, screenful],
  );

  /**
   * The list opened at the anchor while on screen. Until then a hidden list
   * holds its rows back: a list mounted hidden at a far index stays blank
   * when shown (Story 4 sc. 4).
   */
  const anchorRow =
    paged.anchorIndex == null ? undefined : fileOffset + paged.anchorIndex;
  const holdForAnchor = anchorRow != null && !visible && !anchorShown.current;

  if (snapshotId == null) {
    return scanLoading ? (
      <FilesMessage loading />
    ) : (
      <FilesMessage text={NO_SCAN_TEXT} />
    );
  }

  if (folder == null) {
    if (sourceIds.length === 0) {
      return <FilesMessage text={NO_SOURCES_TEXT} />;
    }
    return (
      <ScrollView testID="list-sources">
        {sourceIds.map(sourceId => {
          const alias = aliases.get(sourceId) ?? sourceId;
          const counts = sourceCounts?.get(sourceId) ?? null;
          return (
            <FolderRow
              key={sourceId}
              matching={chipCount(filter, counts)}
              name={alias}
              onPress={() => nav.openSource(sourceId, alias)}
            />
          );
        })}
      </ScrollView>
    );
  }

  const { phase, rows, scrollIndex } = paged;
  // Once folders are shown, the files' page 1 arrives below them without a spinner.
  const loading =
    phase === 'idle' ||
    phase === 'loading-first' ||
    (phase === 'loading-more' && rows.length === 0);
  let body: React.JSX.Element;
  if (nav.relocating || loading) {
    body = <FilesMessage loading />;
  } else if (holdForAnchor) {
    body = <View style={styles.folder} testID="list-body" />;
  } else if (rows.length === 0 && paged.error != null) {
    body = <FilesMessage error={paged.error} onRetry={paged.retry} />;
  } else if (rows.length === 0 && !paged.hasMore) {
    body = <FilesMessage text={NO_MATCHES_TEXT} />;
  } else {
    body = (
      <View onLayout={onLayout} style={styles.folder} testID="list-body">
        <FlatList
          ListFooterComponent={
            paged.error != null ? (
              <FilesMessage error={paged.error} onRetry={paged.retry} />
            ) : undefined
          }
          data={rows}
          extraData={items}
          getItemLayout={getItemLayout}
          initialScrollIndex={anchorRow}
          keyExtractor={keyOf}
          onEndReached={paged.loadMore}
          onEndReachedThreshold={1}
          onScroll={onScroll}
          onViewableItemsChanged={onViewableItemsChanged}
          ref={listRef}
          renderItem={renderEntry}
          scrollEventThrottle={32}
          showsVerticalScrollIndicator={scrollIndex == null}
          testID="list-entries"
          viewabilityConfig={VIEWABILITY}
        />
        {scrollIndex != null ? (
          <FastScroller
            bands={scrollIndex.bands}
            contentHeight={rows.length * density.rowHeight}
            onJump={onJump}
            firstIndex={firstIndex}
            scrollOffset={scrollOffset}
            unit={scrollIndex.unit}
            viewportHeight={viewportHeight}
          />
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.folder}>
      <Breadcrumb crumbs={nav.breadcrumb} goTo={nav.goTo} />
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  folder: {
    flex: 1,
  },
});
