import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Button, Text, useTheme, type MD3Theme } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { selectionDetailsLabel, selectionLabel } from '../files/a11y';
import { spacing } from '../theme/spacing';
import { formatBytes } from './formatBytes';
import { useSelection } from './SelectionProvider';
import type { SelectionSummary } from './summary';

export interface SelectionBarProps {
  /** Shows `Delete selected` on the right; omitted until deletion is wired (US6). */
  onDelete?: () => void;
}

/** The second line: `1 of unknown size, 2 hidden by filter`; null when both are 0. */
export function selectionDetails(summary: SelectionSummary): string | null {
  const parts: string[] = [];
  if (summary.unknownSizeCount > 0) {
    parts.push(`${summary.unknownSizeCount} of unknown size`);
  }
  if (summary.hiddenByFilterCount > 0) {
    parts.push(`${summary.hiddenByFilterCount} hidden by filter`);
  }
  return parts.length > 0 ? parts.join(', ') : null;
}

function themedStyles(theme: MD3Theme, bottomInset: number) {
  return StyleSheet.create({
    bar: {
      backgroundColor: theme.colors.elevation.level2,
      paddingBottom: bottomInset + spacing.sm,
    },
    details: { color: theme.colors.onSurfaceVariant },
    summary: { color: theme.colors.onSurface },
  });
}

/**
 * The bar that replaces the bottom tabs while files are selected (FR-016):
 * the count and total size of the selection in its bottom-left corner, a
 * second line for files of unknown size or hidden by the filter (never
 * counted as zero silently), and `Delete selected` on the right when
 * [onDelete] is given. Renders nothing while nothing is selected.
 */
export function SelectionBar({
  onDelete,
}: SelectionBarProps): React.JSX.Element | null {
  const theme = useTheme();
  const { bottom } = useSafeAreaInsets();
  const themed = useMemo(() => themedStyles(theme, bottom), [theme, bottom]);
  const { isSelecting, summary } = useSelection();

  if (!isSelecting) {
    return null;
  }
  const size = formatBytes(summary.knownBytes);
  const details = selectionDetails(summary);

  return (
    <View style={[styles.bar, themed.bar]} testID="selection-bar">
      <View style={styles.text}>
        <Text
          accessibilityLabel={selectionLabel(summary.count, size)}
          style={themed.summary}
          variant="titleMedium"
        >
          {`${summary.count} selected · ${size}`}
        </Text>
        {details != null ? (
          <Text
            accessibilityLabel={selectionDetailsLabel(details)}
            style={themed.details}
            variant="bodySmall"
          >
            {details}
          </Text>
        ) : null}
      </View>
      {onDelete != null ? (
        <Button
          accessibilityLabel="Delete selected"
          icon="delete-outline"
          mode="contained"
          onPress={onDelete}
        >
          Delete
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
  },
  text: {
    flex: 1,
  },
});
