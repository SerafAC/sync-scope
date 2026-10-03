import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, SegmentedButtons, Snackbar, Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, type NavigationProp } from '@react-navigation/native';

import { NO_SCAN_TEXT } from '../files/FilesViewParts';
import { FilterChips } from '../files/FilterChips';
import { useFiles, type FilesView } from '../files/useFiles';
import { useSourceAliases } from '../files/useSourceAliases';
import type { StatusCountDto } from '../native/CloudSyncContracts';
import type { RootTabParamList } from '../navigation/AppNavigator';
import { useScan } from '../scan/useScan';
import { spacing } from '../theme/spacing';
import { GalleryScreen } from './GalleryScreen';
import { ListScreen } from './ListScreen';

export const RESULTS_UPDATED = 'Results updated';
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
 */
export function FilesScreen({
  focused = true,
}: {
  focused?: boolean;
}): React.JSX.Element {
  const { view, setView } = useFiles();
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
        <ListScreen {...shared} onCountsChange={onListCounts} />
      </View>
      <Snackbar
        accessibilityLabel={RESULTS_UPDATED}
        duration={SNACKBAR_MILLIS}
        onDismiss={dismiss}
        visible={updated && focused}
      >
        {RESULTS_UPDATED}
      </Snackbar>
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
  switch: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
  },
  view: {
    flex: 1,
  },
});
