import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, ScrollView, StyleSheet, View } from 'react-native';
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
  type PageReader,
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
import { density, spacing } from '../theme/spacing';
import { chipCount } from '../theme/statusLabels';

export const NO_SOURCES_TEXT = 'No folders added yet.';

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
): ReadonlyMap<string, StatusCountDto[] | null> | null {
  const key = `${snapshotId}\u0000${filter}\u0000${sourceIds.join('\u0000')}`;
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
    // `key` covers snapshotId, filter and sourceIds.
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

/** A file row: name, size, modified time and status; never an origin badge (FR-002). */
function FileRow({ entry }: { entry: FileEntryDto }): React.JSX.Element {
  const details = [
    entry.sizeBytes == null ? null : formatSize(entry.sizeBytes),
    entry.modifiedUtcMillis == null
      ? null
      : formatTimestamp(entry.modifiedUtcMillis),
  ].filter(part => part != null);
  return (
    <View
      accessibilityLabel={fileRowLabel(entry.name, entry.status)}
      style={styles.fileRow}
    >
      <List.Item
        description={details.join(' · ')}
        left={FileIcon}
        style={styles.fileItem}
        title={entry.name}
      />
      <StatusChip status={entry.status} />
    </View>
  );
}

/**
 * The list view (FR-002): the sources at the top level, then each source's
 * folders by name through `queryTreeChildren`, with a breadcrumb back up.
 * Under a filter, every folder stays visible with its matching-file count.
 */
export function ListScreen(props: FilesViewProps): React.JSX.Element {
  const { snapshotId, scanLoading, aliases, onSnapshotLost } = props;
  const { filter } = useFiles();
  const nav = useListNavigation({
    snapshotId,
    sources: aliases.size > 0 ? aliases : null,
  });
  const { location } = nav;
  const folder = location.kind === 'folder' ? location : null;
  const parentId = folder?.path[folder.path.length - 1]?.entryId ?? null;

  const sourceIds = useMemo(() => [...aliases.keys()], [aliases]);
  const sourceCounts = useSourceCounts(snapshotId, sourceIds, filter);

  const query = useMemo<QuerySpec>(
    () => ({
      filter,
      view: 'LIST',
      sort: 'NAME_ASC',
      sourceId: folder?.sourceId ?? null,
      parentId,
      pageSize: PAGED_QUERY_PAGE_SIZE,
    }),
    [filter, folder?.sourceId, parentId],
  );
  const paged = usePagedQuery({
    snapshotId: folder != null ? nav.snapshotId : null,
    query,
    read: readTreeChildren,
    onSnapshotLost,
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
  const renderEntry = useCallback(
    ({ item }: { item: FileEntryDto }) =>
      item.kind === 'DIRECTORY' ? (
        <FolderRow
          matching={item.matchingFileCount}
          name={item.name}
          onPress={() => openFolder(item.entryId, item.name)}
        />
      ) : (
        <FileRow entry={item} />
      ),
    [openFolder],
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
  if (
    nav.relocating ||
    paged.phase === 'loading-first' ||
    paged.phase === 'idle'
  ) {
    body = <FilesMessage loading />;
  } else if (paged.entries.length === 0) {
    body =
      paged.phase === 'error' ? (
        <FilesMessage error={paged.error} onRetry={paged.retry} />
      ) : (
        <FilesMessage text={NO_MATCHES_TEXT} />
      );
  } else {
    body = (
      <FlatList
        ListFooterComponent={
          paged.phase === 'error' ? (
            <FilesMessage error={paged.error} onRetry={paged.retry} />
          ) : undefined
        }
        data={paged.entries}
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
