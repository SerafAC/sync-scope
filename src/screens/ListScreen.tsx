import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { List, useTheme, type MD3Theme } from 'react-native-paper';

import { Breadcrumb } from '../files/Breadcrumb';
import {
  FilesMessage,
  NO_MATCHES_TEXT,
  NO_SCAN_TEXT,
  useReportToFilesScreen,
  type FilesViewProps,
} from '../files/FilesViewParts';
import { StatusChip } from '../files/StatusChip';
import { fileRowLabel, folderRowLabel } from '../files/a11y';
import { useFiles } from '../files/useFiles';
import { useListNavigation } from '../files/useListNavigation';
import {
  PAGED_QUERY_PAGE_SIZE,
  usePagedQuery,
  type PagedPhase,
  type PageReader,
  type UsePagedQueryResult,
} from '../files/usePagedQuery';
import { queryTreeChildren } from '../native/CloudSync';
import type {
  FileEntryDto,
  FileFilter,
  FileStatus,
  QuerySpec,
  StatusCountDto,
} from '../native/CloudSyncContracts';
import { formatTimestamp } from '../scan/ScanSummaryCard';
import { useSelection } from '../selection/SelectionProvider';
import { density, spacing } from '../theme/spacing';
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

/** `queryTreeChildren` as a {@link PageReader}: the parent travels in `query.parentId`. */
const readTreeChildren: PageReader = (snapshotId, query, pageToken) =>
  queryTreeChildren(snapshotId, query.parentId ?? null, query, pageToken);

/** Adds up per-status counts; null when any part is not known. */
function sumCounts(
  parts: readonly (StatusCountDto[] | null | undefined)[],
): StatusCountDto[] | null {
  const totals = new Map<FileStatus, number>();
  for (const part of parts) {
    if (part == null) {
      return null;
    }
    for (const { status, count } of part) {
      totals.set(status, (totals.get(status) ?? 0) + count);
    }
  }
  return [...totals].map(([status, count]) => ({ status, count }));
}

interface SourceCounts {
  key: string;
  bySource: ReadonlyMap<string, StatusCountDto[] | null>;
}

/**
 * Each source's page-1 `counts` from a one-row `queryTreeChildren` read of
 * its root (research R4). Counts are scoped by source and never narrowed by
 * the filter, so the chip model turns them into the filter's count.
 */
function useSourceCounts(
  snapshotId: string | null,
  sourceIds: readonly string[],
  filter: FileFilter,
  reloadKey: number,
): ReadonlyMap<string, StatusCountDto[] | null> | null {
  const key = `${snapshotId}\u0000${filter}\u0000${reloadKey}\u0000${sourceIds.join(
    '\u0000',
  )}`;
  const [loaded, setLoaded] = useState<SourceCounts | null>(null);

  useEffect(() => {
    if (snapshotId == null) {
      return;
    }
    let live = true;
    Promise.all(
      sourceIds.map(async sourceId => {
        try {
          const result = await queryTreeChildren(
            snapshotId,
            null,
            { filter, view: 'LIST', sort: 'NAME_ASC', sourceId, pageSize: 1 },
            null,
          );
          return [
            sourceId,
            result.status === 'ok' ? result.page.counts : null,
          ] as const;
        } catch {
          return [sourceId, null] as const;
        }
      }),
    ).then(entries => {
      if (live) {
        setLoaded({ key, bySource: new Map(entries) });
      }
    });
    return () => {
      live = false;
    };
    // `key` covers snapshotId, filter, reloadKey and sourceIds.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return loaded != null && loaded.key === key ? loaded.bySource : null;
}

function themedStyles(theme: MD3Theme) {
  return StyleSheet.create({
    dimmed: { color: theme.colors.onSurfaceDisabled },
  });
}

function FolderIcon({ color }: { color: string }): React.JSX.Element {
  return <List.Icon color={color} icon="folder-outline" />;
}

function FileIcon({ color }: { color: string }): React.JSX.Element {
  return <List.Icon color={color} icon="file-outline" />;
}

/** A selected file row's icon: a check mark, so the state is not colour alone (FR-017). */
function SelectedIcon({ color }: { color: string }): React.JSX.Element {
  return (
    <View testID="list-row-selected">
      <List.Icon color={color} icon="check-circle" />
    </View>
  );
}

/** A source or directory row: `N matching`, dimmed at 0 and still pressable (clarification 3). */
function FolderRow({
  name,
  matching,
  onPress,
}: {
  name: string;
  matching: number | null;
  onPress: () => void;
}): React.JSX.Element {
  const theme = useTheme();
  const themed = useMemo(() => themedStyles(theme), [theme]);
  const dimmed = matching === 0;
  return (
    <List.Item
      accessibilityLabel={folderRowLabel(name, matching)}
      description={matching == null ? undefined : `${matching} matching`}
      descriptionStyle={dimmed ? themed.dimmed : undefined}
      left={FolderIcon}
      onPress={onPress}
      style={styles.row}
      title={name}
      titleStyle={dimmed ? themed.dimmed : undefined}
    />
  );
}

/**
 * A file row: name, size, modified time and status; never an origin badge
 * (FR-002). A long-press starts the selection; [onPress] (given only while
 * selecting) toggles it. A selected row shows a check mark and announces
 * `, selected` (FR-015, FR-017).
 */
const FileRow = memo(function FileRowBody({
  entry,
  selected,
  onPress,
  onLongPress,
}: {
  entry: FileEntryDto;
  selected: boolean;
  onPress?: (entry: FileEntryDto) => void;
  onLongPress: (entry: FileEntryDto) => void;
}): React.JSX.Element {
  const details = [
    entry.sizeBytes == null ? null : formatSize(entry.sizeBytes),
    entry.modifiedUtcMillis == null
      ? null
      : formatTimestamp(entry.modifiedUtcMillis),
  ].filter(part => part != null);
  return (
    <Pressable
      accessibilityLabel={fileRowLabel(entry.name, entry.status, selected)}
      accessibilityState={{ selected }}
      onLongPress={() => onLongPress(entry)}
      onPress={onPress ? () => onPress(entry) : undefined}
      style={styles.fileRow}
    >
      <List.Item
        description={details.join(' · ')}
        left={selected ? SelectedIcon : FileIcon}
        style={styles.fileItem}
        title={entry.name}
      />
      <StatusChip status={entry.status} />
    </Pressable>
  );
});

/** The two reads of a folder (research R3) as one list: folders first, then files. */
interface ListReads {
  entries: FileEntryDto[];
  counts: StatusCountDto[] | null;
  /** Nothing to show yet: page 1 of the folders, or of the files of a folder without subfolders, is loading. */
  loading: boolean;
  /** Both reads are complete. */
  complete: boolean;
  error: UsePagedQueryResult['error'];
  retry: () => void;
  loadMore: () => void;
  snapshotChanged: boolean;
  acknowledgeSnapshotChange: () => void;
}

function useListReads(
  folders: UsePagedQueryResult,
  files: UsePagedQueryResult,
  foldersComplete: boolean,
): ListReads {
  const entries = useMemo(
    () =>
      files.entries.length === 0
        ? folders.entries
        : [...folders.entries, ...files.entries],
    [folders.entries, files.entries],
  );
  const failed = folders.phase === 'error' ? folders : files;
  const { loadMore: loadMoreFolders, acknowledgeSnapshotChange: ackFolders } =
    folders;
  const { loadMore: loadMoreFiles, acknowledgeSnapshotChange: ackFiles } =
    files;
  const loadMore = useCallback(() => {
    if (foldersComplete) {
      loadMoreFiles();
    } else {
      loadMoreFolders();
    }
  }, [foldersComplete, loadMoreFiles, loadMoreFolders]);
  const acknowledgeSnapshotChange = useCallback(() => {
    ackFolders();
    ackFiles();
  }, [ackFolders, ackFiles]);
  const startingPhases: readonly PagedPhase[] = ['idle', 'loading-first'];
  return {
    entries,
    // Counts are scoped by source, not by kind: both reads carry the same.
    counts: folders.counts ?? files.counts,
    // Once folders are shown, the files' page 1 arrives below them without a spinner.
    loading:
      startingPhases.includes(folders.phase) ||
      (foldersComplete &&
        folders.entries.length === 0 &&
        startingPhases.includes(files.phase)),
    complete: foldersComplete && files.phase === 'ready' && !files.hasMore,
    error: failed.phase === 'error' ? failed.error : null,
    retry: failed.retry,
    loadMore,
    snapshotChanged: folders.snapshotChanged || files.snapshotChanged,
    acknowledgeSnapshotChange,
  };
}

/**
 * The list view (FR-002): the sources at the top level, then each source's
 * folders through `queryTreeChildren`, with a breadcrumb back up.
 *
 * A folder is read in two parts (007 research R3): its subfolders by name
 * (`kind: 'DIRECTORY'`, always `NAME_ASC`), then, once that read has no next
 * page, its files in the list's sort (`kind: 'FILE'`). Folders are shown
 * above the files under every sort (FR-004). T063 replaces this with the
 * band-segmented reader.
 * Under a filter, every folder stays visible with its matching-file count.
 * File rows are selectable (FR-015); source and directory rows never are,
 * and tapping one navigates while the selection is kept (Story 5 sc. 7).
 */
export function ListScreen(props: ListScreenProps): React.JSX.Element {
  const {
    snapshotId,
    scanLoading,
    aliases,
    onSnapshotLost,
    onFolderChange,
    reloadKey = 0,
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
  const folders = usePagedQuery({
    snapshotId: readSnapshot,
    query: folderQuery,
    read: readTreeChildren,
    onSnapshotLost,
    reloadKey,
  });
  const foldersComplete = folders.phase === 'ready' && !folders.hasMore;
  const files = usePagedQuery({
    snapshotId: readSnapshot,
    query: fileQuery,
    read: readTreeChildren,
    onSnapshotLost,
    reloadKey,
    enabled: foldersComplete,
  });
  const paged = useListReads(folders, files, foldersComplete);

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
  const renderEntry = useCallback(
    ({ item }: { item: FileEntryDto }) =>
      item.kind === 'DIRECTORY' ? (
        <FolderRow
          matching={item.matchingFileCount}
          name={item.name}
          onPress={() => openFolder(item.entryId, item.name)}
        />
      ) : (
        <FileRow
          entry={item}
          onLongPress={longPress}
          onPress={isSelecting ? toggle : undefined}
          selected={isSelected(item.entryId)}
        />
      ),
    [openFolder, isSelected, isSelecting, longPress, toggle],
  );
  const getItemLayout = useCallback(
    (_: unknown, index: number) => ({
      length: density.rowHeight,
      offset: density.rowHeight * index,
      index,
    }),
    [],
  );

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

  let body: React.JSX.Element;
  if (nav.relocating || (paged.error == null && paged.loading)) {
    body = <FilesMessage loading />;
  } else if (paged.entries.length === 0 && paged.error != null) {
    body = <FilesMessage error={paged.error} onRetry={paged.retry} />;
  } else if (paged.entries.length === 0 && paged.complete) {
    body = <FilesMessage text={NO_MATCHES_TEXT} />;
  } else {
    body = (
      <FlatList
        ListFooterComponent={
          paged.error != null ? (
            <FilesMessage error={paged.error} onRetry={paged.retry} />
          ) : undefined
        }
        data={paged.entries}
        extraData={items}
        getItemLayout={getItemLayout}
        keyExtractor={item => item.entryId}
        onEndReached={paged.loadMore}
        onEndReachedThreshold={1}
        renderItem={renderEntry}
        testID="list-entries"
      />
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
  fileItem: {
    flex: 1,
    paddingVertical: 0,
  },
  fileRow: {
    alignItems: 'center',
    flexDirection: 'row',
    height: density.rowHeight,
    paddingRight: spacing.lg,
  },
  folder: {
    flex: 1,
  },
  row: {
    height: density.rowHeight,
    justifyContent: 'center',
    paddingVertical: 0,
  },
});
