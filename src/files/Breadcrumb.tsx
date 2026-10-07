import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, useTheme } from 'react-native-paper';

import { spacing } from '../theme/spacing';
import { breadcrumbLabel } from './a11y';
import type { Crumb } from './useListNavigation';

const SEPARATOR_SIZE = 16;

/**
 * The list view's path (FR-002): `All folders › <alias> › …`. Pressing a
 * crumb goes back up to it; the last crumb is where the user is, so it is
 * disabled. Feature 008's tree view reuses it with `useListNavigation`.
 */
export function Breadcrumb({
  crumbs,
  goTo,
}: {
  crumbs: readonly Crumb[];
  goTo: (index: number) => void;
}): React.JSX.Element {
  const theme = useTheme();
  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      testID="breadcrumb"
    >
      {crumbs.map((crumb, position) => {
        const last = position === crumbs.length - 1;
        return (
          <View key={crumb.index} style={styles.crumb}>
            {position > 0 ? (
              <Icon
                color={theme.colors.onSurfaceVariant}
                size={SEPARATOR_SIZE}
                source="chevron-right"
              />
            ) : null}
            <Button
              accessibilityLabel={breadcrumbLabel(crumb.name)}
              compact
              disabled={last}
              mode="text"
              onPress={() => goTo(crumb.index)}
            >
              {crumb.name}
            </Button>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // A ScrollView grows by default: the trail keeps its own height and the
  // folder's list below gets the rest.
  bar: {
    flexGrow: 0,
  },
  crumb: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  row: {
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
});
