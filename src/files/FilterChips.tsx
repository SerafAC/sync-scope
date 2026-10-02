import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { Chip } from 'react-native-paper';

import type { FileFilter, StatusCountDto } from '../native/CloudSyncContracts';
import { spacing } from '../theme/spacing';
import { FILTER_LABEL, chipCount } from '../theme/statusLabels';
import { filterChipLabel } from './a11y';
import { useFiles } from './useFiles';

/** The chips, in display order. */
export const FILTER_ORDER: readonly FileFilter[] = [
  'ALL',
  'SYNCED',
  'UNSYNCED',
  'ISSUES_UNKNOWN',
];

/**
 * The shared status filter (FR-003): one chip per filter with its count from
 * the first page's `counts`, or no count while they are not known. Selecting
 * a chip sets the filter for every Files view.
 */
export function FilterChips({
  counts,
}: {
  counts: readonly StatusCountDto[] | null;
}): React.JSX.Element {
  const { filter, setFilter } = useFiles();

  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      testID="filter-chips"
    >
      {FILTER_ORDER.map(f => {
        const count = chipCount(f, counts);
        return (
          <Chip
            accessibilityLabel={filterChipLabel(f, count)}
            key={f}
            onPress={() => setFilter(f)}
            selected={f === filter}
            testID={`filter-chip-${f}`}
          >
            {count == null ? FILTER_LABEL[f] : `${FILTER_LABEL[f]} ${count}`}
          </Chip>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
