import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Icon, Text, useTheme, type MD3Theme } from 'react-native-paper';

import type { FileStatus } from '../native/CloudSyncContracts';
import { spacing } from '../theme/spacing';
import { STATUS_LABEL } from '../theme/statusLabels';

/** One icon per status, so the status never depends on colour alone. */
export const STATUS_ICON: Record<FileStatus, string> = {
  SYNCED: 'check-circle-outline',
  UNSYNCED: 'cloud-off-outline',
  UNKNOWN: 'help-circle-outline',
};

function colorsFor(
  status: FileStatus,
  theme: MD3Theme,
): { background: string; foreground: string } {
  switch (status) {
    case 'SYNCED':
      return {
        background: theme.colors.primaryContainer,
        foreground: theme.colors.onPrimaryContainer,
      };
    case 'UNSYNCED':
      return {
        background: theme.colors.errorContainer,
        foreground: theme.colors.onErrorContainer,
      };
    case 'UNKNOWN':
      return {
        background: theme.colors.surfaceVariant,
        foreground: theme.colors.onSurfaceVariant,
      };
  }
}

const ICON_SIZE = 14;

/**
 * A small, non-interactive status marker: icon plus `STATUS_LABEL[status]`,
 * coloured from the theme only. Used by gallery tiles and list rows, and by
 * 006's (MVP) status-aware rendering.
 */
export function StatusChip({
  status,
}: {
  status: FileStatus;
}): React.JSX.Element {
  const theme = useTheme();
  const { background, foreground } = colorsFor(status, theme);
  const themed = useMemo(
    () =>
      StyleSheet.create({
        background: { backgroundColor: background },
        text: { color: foreground },
      }),
    [background, foreground],
  );

  return (
    <View style={[styles.chip, themed.background]} testID="status-chip">
      <Icon color={foreground} size={ICON_SIZE} source={STATUS_ICON[status]} />
      <Text style={themed.text} variant="labelSmall">
        {STATUS_LABEL[status]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs / 2,
  },
});
