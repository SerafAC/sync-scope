import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';
import {
  Button,
  IconButton,
  SegmentedButtons,
  Snackbar,
  Text,
} from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import { NO_SCAN_TEXT } from '../files/FilesViewParts';
import { FilterChips } from '../files/FilterChips';
import { useFiles, type FilesView } from '../files/useFiles';
import { useSourceAliases } from '../files/useSourceAliases';
import { PAGED_QUERY_PAGE_SIZE } from '../files/usePagedQuery';
import type {
  CloudSyncError,
  DeletionResultDto,
  QuerySpec,
  StatusCountDto,
} from '../native/CloudSyncContracts';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useScan } from '../scan/useScan';
import { DeleteFlow } from '../selection/DeleteFlow';
import { SelectionBar } from '../selection/SelectionBar';
import { useSelection } from '../selection/SelectionProvider';
import { spacing } from '../theme/spacing';
import { GalleryScreen } from './GalleryScreen';
import { ListScreen, type ListFolder } from './ListScreen';

export const RESULTS_UPDATED = 'Results updated';

function selectAllErrorText(error: CloudSyncError): string {
  return error.action ? `${error.message} ${error.action}` : error.message;
}
const SNACKBAR_MILLIS = 4000;

const VIEW_BUTTONS = [
  {
    value: 'GALLERY',
    label: 'Gallery',
    icon: 'view-grid-outline',
    accessibilityLabel: 'Gallery view',
  },
  {
    value: 'LIST',
    label: 'List',
    icon: 'format-list-bulleted',
    accessibilityLabel: 'List view',
  },
];

type CountsByView = Record<FilesView, StatusCountDto[] | null>;

/** What the open delete dialog works on, fixed when `Delete selected` is tapped. */
interface DeletionTarget {
  snapshotId: string;
  entryIds: readonly string[];
}

/** The top bar's ✕ while selecting (FR-015). */
function ClearSelectionButton({
  onClear,
}: {
  onClear: () => void;
}): React.JSX.Element {
  return (
    <IconButton
      accessibilityLabel="Clear selection"
      icon="close"
      onPress={onClear}
    />
  );
}

/** The top bar's "Select all" while selecting (FR-015). */
function SelectAllButton({
  disabled,
  onSelectAll,
}: {
  disabled: boolean;
  onSelectAll: () => void;
}): React.JSX.Element {
  return (
    <Button
      accessibilityLabel="Select all"
      disabled={disabled}
      onPress={onSelectAll}
      style={styles.selectAll}
    >
      Select all
    </Button>
  );
}

/**
 * What "Select all" covers (FR-015): in the gallery, every image under the
 * filter; in the list, the open folder's direct files under the filter.
 * Null at the list's sources level, where there is nothing to select.
 */
export function selectAllQuery(
  view: FilesView,
  filter: QuerySpec['filter'],
  listFolder: ListFolder | null,
): QuerySpec | null {
  if (view === 'GALLERY') {
    return {
      filter,
      view: 'GALLERY',
      sort: 'TIME_DESC',
      pageSize: PAGED_QUERY_PAGE_SIZE,
    };
  }
  if (listFolder == null) {
    return null;
  }
  return {
    filter,
    view: 'LIST',
    sort: 'NAME_ASC',
    sourceId: listFolder.sourceId,
    parentId: listFolder.parentId,
    pageSize: PAGED_QUERY_PAGE_SIZE,
  };
}

/**
 * Selection mode (FR-015, FR-016): while files are selected, the bottom tabs
 * are hidden (the selection bar takes their place), the top bar holds
 * "Clear selection" ✕ and "Select all", and back clears the selection.
 * Everything is restored when the selection ends.
 */
function useSelectionMode(
  selectQuery: QuerySpec | null,
  focused: boolean,
): void {
  const navigation =
    useNavigation<BottomTabNavigationProp<RootTabParamList, 'Files'>>();
  const { isSelecting, selectingAll, selectAll, clear } = useSelection();

  useEffect(() => {
    if (!isSelecting) {
      navigation.setOptions({
        tabBarStyle: undefined,
        headerLeft: undefined,
        headerRight: undefined,
      });
      return;
    }
    const onSelectAll = () => {
      if (selectQuery != null) {
        selectAll(selectQuery);
      }
    };
    navigation.setOptions({
      tabBarStyle: { display: 'none' },
      headerLeft: () => <ClearSelectionButton onClear={clear} />,
      headerRight: () => (
        <SelectAllButton
          disabled={selectQuery == null || selectingAll}
          onSelectAll={onSelectAll}
        />
      ),
    });
  }, [navigation, isSelecting, selectingAll, selectQuery, selectAll, clear]);

  useEffect(() => {
    if (!isSelecting || !focused) {
      return;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        clear();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isSelecting, focused, clear]);
}

/** FR-008: before any completed scan, say where results come from and lead to the Scan tab. */
function NoScanResults(): React.JSX.Element {
  const navigation =
    useNavigation<NavigationProp<Pick<RootTabParamList, 'Scan'>>>();
  return (
    <View accessibilityLabel={NO_SCAN_TEXT} style={styles.empty}>
      <Text variant="titleMedium">{NO_SCAN_TEXT}</Text>
      <Text variant="bodyMedium">Results appear after a scan.</Text>
      <Button
        accessibilityLabel="Go to Scan"
        icon="radar"
        mode="contained"
        onPress={() => navigation.navigate('Scan')}
      >
        Go to Scan
      </Button>
    </View>
  );
}

/**
 * The Files tab: a gallery / list switch, the shared filter chips, and both
 * views. Both stay mounted and only the active one is shown, so each keeps
 * its scroll position and folder across a switch. When a view's rows are
 * replaced by a new snapshot, a "Results updated" snackbar is shown (FR-005)
 * the next time the tab is [focused]. Before any completed scan it shows
 * only an explanation and a way to the Scan tab (FR-008); the views stay
 * mounted, hidden, so nothing is lost when the first results arrive.
 * While files are selected, the selection bar replaces the bottom tabs
 * (`useSelectionMode`), and a snackbar says when a new scan result cleared
 * the selection. `Delete selected` opens the delete dialog for the selection;
 * after a deletion the removed files leave the selection and both views
 * reload page 1 in place, keeping their folder and filter (research R14).
 */
export function FilesScreen({
  focused = true,
}: {
  focused?: boolean;
}): React.JSX.Element {
  const { view, setView, filter } = useFiles();
  const selection = useSelection();
  const scan = useScan();
  const snapshotId = scan.active?.snapshotId ?? null;
  const aliases = useSourceAliases();
  const [counts, setCounts] = useState<CountsByView>({
    GALLERY: null,
    LIST: null,
  });
  const [updated, setUpdated] = useState(false);

  const onGalleryCounts = useCallback(
    (next: StatusCountDto[] | null) =>
      setCounts(current => ({ ...current, GALLERY: next })),
    [],
  );
  const onListCounts = useCallback(
    (next: StatusCountDto[] | null) =>
      setCounts(current => ({ ...current, LIST: next })),
    [],
  );
  const [listFolder, setListFolder] = useState<ListFolder | null>(null);
  const selectQuery = useMemo(
    () => selectAllQuery(view, filter, listFolder),
    [view, filter, listFolder],
  );
  useSelectionMode(selectQuery, focused);

  const [deletion, setDeletion] = useState<DeletionTarget | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { snapshotId: selectionSnapshotId, items, removeIds } = selection;
  const openDelete = useCallback(() => {
    if (selectionSnapshotId != null && items.size > 0) {
      setDeletion({
        snapshotId: selectionSnapshotId,
        entryIds: [...items.keys()],
      });
    }
  }, [selectionSnapshotId, items]);
  const closeDelete = useCallback(() => setDeletion(null), []);
  const onDeleted = useCallback(
    (result: DeletionResultDto) => {
      removeIds(result.removedEntryIds);
      setReloadKey(key => key + 1);
    },
    [removeIds],
  );

  const onSnapshotChange = useCallback(() => setUpdated(true), []);
  const dismiss = useCallback(() => setUpdated(false), []);
  const onViewChange = useCallback(
    (value: string) => setView(value as FilesView),
    [setView],
  );

  const shared = {
    snapshotId,
    scanLoading: scan.loading,
    aliases,
    onSnapshotChange,
    onSnapshotLost: scan.refresh,
    reloadKey,
  };

  // Only once the scan state has answered is "no results" known.
  const noResults = !scan.loading && snapshotId == null;

  return (
    <SafeAreaView edges={['left', 'right']} style={styles.screen}>
      {noResults ? (
        <NoScanResults />
      ) : (
        <>
          <SegmentedButtons
            buttons={VIEW_BUTTONS}
            onValueChange={onViewChange}
            style={styles.switch}
            value={view}
          />
          <FilterChips counts={counts[view]} />
        </>
      )}
      <View
        style={view === 'GALLERY' && !noResults ? styles.view : styles.hidden}
        testID="files-gallery"
      >
        <GalleryScreen {...shared} onCountsChange={onGalleryCounts} />
      </View>
      <View
        style={view === 'LIST' && !noResults ? styles.view : styles.hidden}
        testID="files-list"
      >
        <ListScreen
          {...shared}
          onCountsChange={onListCounts}
          onFolderChange={setListFolder}
        />
      </View>
      <Snackbar
        accessibilityLabel={RESULTS_UPDATED}
        duration={SNACKBAR_MILLIS}
        onDismiss={dismiss}
        visible={updated && focused && selection.notice == null}
      >
        {RESULTS_UPDATED}
      </Snackbar>
      <Snackbar
        accessibilityLabel={selection.notice ?? undefined}
        duration={SNACKBAR_MILLIS}
        onDismiss={selection.dismissNotice}
        visible={selection.notice != null && focused}
      >
        {selection.notice ?? ''}
      </Snackbar>
      <Snackbar
        accessibilityLabel={
          selection.error == null
            ? undefined
            : selectAllErrorText(selection.error)
        }
        duration={SNACKBAR_MILLIS}
        onDismiss={selection.dismissError}
        visible={selection.error != null && focused}
      >
        {selection.error == null ? '' : selectAllErrorText(selection.error)}
      </Snackbar>
      {/* While the dialog is open its own Delete is the only one on screen. */}
      <SelectionBar onDelete={deletion == null ? openDelete : undefined} />
      {deletion != null ? (
        <DeleteFlow
          entryIds={deletion.entryIds}
          onDeleted={onDeleted}
          onDismiss={closeDelete}
          snapshotId={deletion.snapshotId}
          visible
        />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  hidden: {
    display: 'none',
  },
  screen: {
    flex: 1,
  },
  selectAll: {
    marginRight: spacing.sm,
  },
  switch: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  view: {
    flex: 1,
  },
});
