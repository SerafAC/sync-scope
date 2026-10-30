import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  FilesMessage,
  NO_SCAN_TEXT,
  useReportToFilesScreen,
  type FilesViewProps,
} from '../files/FilesViewParts';
import { TreeView } from '../files/TreeView';
import { useFiles } from '../files/useFiles';
import { sumCounts, useSourceCounts } from '../files/useSourceCounts';
import { useTree, type TreeRow } from '../files/useTree';
import { NO_SOURCES_TEXT } from './ListScreen';

/**
 * The tree view in the Files tab (009 FR-001, research R1–R4, R11): the
 * selected sources as expandable roots, read through `useTree` with the
 * shared filter and the list's sort, and the expanded paths kept in
 * `FilesProvider` across view switches. The filter chips, sort drop-down,
 * selection bar and delete dialog are the Files tab's own (`FilesScreen`);
 * the chips count every source, as at the list view's sources level. A tap
 * on a media file opens its preview while nothing is selected (R8).
 */
export function TreeScreen(props: FilesViewProps): React.JSX.Element {
  const {
    snapshotId,
    scanLoading,
    aliases,
    onSnapshotLost,
    reloadKey = 0,
    visible = true,
  } = props;
  const { filter, sorts, tree: state, setTree } = useFiles();
  const tree = useTree({
    snapshotId,
    sources: aliases,
    filter,
    sort: sorts.TREE,
    state,
    onStateChange: setTree,
    onSnapshotLost,
    reloadKey,
  });

  const sourceIds = useMemo(() => [...aliases.keys()], [aliases]);
  const sourceCounts = useSourceCounts(
    snapshotId,
    sourceIds,
    filter,
    reloadKey,
  );
  const totals = useMemo(
    () =>
      sourceCounts == null
        ? null
        : sumCounts(sourceIds.map(id => sourceCounts.get(id))),
    [sourceCounts, sourceIds],
  );
  useReportToFilesScreen(
    totals,
    tree.snapshotChanged,
    tree.acknowledgeSnapshotChange,
    props,
  );

  // A collapsed source has read nothing yet: its count comes from the root read.
  const rows = useMemo<TreeRow[]>(
    () =>
      tree.rows.map(row =>
        row.kind === 'source' && row.counts == null
          ? { ...row, counts: sourceCounts?.get(row.sourceId) ?? null }
          : row,
      ),
    [tree.rows, sourceCounts],
  );
  const shown = useMemo(() => ({ ...tree, rows }), [tree, rows]);

  if (snapshotId == null) {
    return scanLoading ? (
      <FilesMessage loading />
    ) : (
      <FilesMessage text={NO_SCAN_TEXT} />
    );
  }
  if (sourceIds.length === 0) {
    return <FilesMessage text={NO_SOURCES_TEXT} />;
  }
  return (
    <View style={styles.tree} testID="tree-body">
      <TreeView
        filter={filter}
        snapshotId={snapshotId}
        tree={shown}
        visible={visible}
      />
      {tree.error != null ? (
        <FilesMessage error={tree.error} onRetry={tree.retry} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  tree: {
    flex: 1,
  },
});
