import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  IconButton,
  List,
  Text,
  useTheme,
  type MD3Theme,
} from 'react-native-paper';

import { density } from '../theme/spacing';
import { fileRowIndent } from './FileRow';
import { folderRowLabel, folderToggleLabel, placeholderLabel } from './a11y';

function themedStyles(theme: MD3Theme) {
  return StyleSheet.create({
    count: { color: theme.colors.onSurfaceVariant },
    dimmed: { color: theme.colors.onSurfaceDisabled },
  });
}

function FolderIcon({ color }: { color: string }): React.JSX.Element {
  return <List.Icon color={color} icon="folder-outline" />;
}

export interface FolderRowProps {
  name: string;
  /** Matching files anywhere beneath; 0 dims the row, null shows no count. */
  matching: number | null;
  /** List view: opens the folder. Tree view: expands or collapses it. */
  onPress: () => void;
  /** The tree depth: indents by `spacing.lg` per level, up to depth 8. List view passes none. */
  depth?: number;
  /**
   * Tree view only: the folder is expanded. When given, the row shows an
   * expand/collapse chevron (`Expand <name>` / `Collapse <name>`) that calls
   * [onPress], and the count on the right instead of `N matching` below.
   */
  expanded?: boolean;
}

/**
 * A source or directory row, shared by list and tree views
 * (clarification 3): dimmed at 0 matching files and still pressable. List
 * view shows `N matching` under the name; tree view (with [expanded]) shows
 * a chevron, the indent of its [depth] and the count, "0" dimmed, on the
 * right. Every row is `density.rowHeight` high. Folders are never
 * selectable (006).
 */
export function FolderRow({
  name,
  matching,
  onPress,
  depth,
  expanded,
}: FolderRowProps): React.JSX.Element {
  const theme = useTheme();
  const themed = useMemo(() => themedStyles(theme), [theme]);
  const dimmed = matching === 0;
  const tree = expanded != null;
  const indent = fileRowIndent(depth);
  const renderLeft = tree
    ? ({ color }: { color: string }) => (
        <View style={styles.left}>
          <IconButton
            accessibilityLabel={folderToggleLabel(name, expanded)}
            accessibilityState={{ expanded }}
            icon={expanded ? 'chevron-down' : 'chevron-right'}
            onPress={onPress}
            size={20}
            style={styles.chevron}
          />
          <FolderIcon color={color} />
        </View>
      )
    : FolderIcon;
  const renderCount =
    tree && matching != null
      ? () => (
          <Text
            style={[styles.count, dimmed ? themed.dimmed : themed.count]}
            testID="folder-row-count"
            variant="labelLarge"
          >
            {String(matching)}
          </Text>
        )
      : undefined;
  return (
    <List.Item
      accessibilityLabel={folderRowLabel(name, matching)}
      accessibilityState={tree ? { expanded } : undefined}
      description={
        tree || matching == null ? undefined : `${matching} matching`
      }
      descriptionStyle={dimmed ? themed.dimmed : undefined}
      left={renderLeft}
      onPress={onPress}
      right={renderCount}
      style={[styles.row, indent > 0 ? { paddingLeft: indent } : null]}
      title={name}
      titleStyle={dimmed ? themed.dimmed : undefined}
    />
  );
}

/** A row not read yet: the fixed row height, no spinner (007 research R7). */
export function PlaceholderRow({
  depth,
}: {
  depth?: number;
}): React.JSX.Element {
  const indent = fileRowIndent(depth);
  return (
    <View
      accessibilityLabel={placeholderLabel()}
      accessible
      style={[styles.row, indent > 0 ? { paddingLeft: indent } : null]}
      testID="list-placeholder"
    />
  );
}

const styles = StyleSheet.create({
  chevron: {
    margin: 0,
  },
  count: {
    alignSelf: 'center',
  },
  left: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  row: {
    height: density.rowHeight,
    justifyContent: 'center',
    paddingVertical: 0,
  },
});
