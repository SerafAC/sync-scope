import React, {useMemo, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {
  ActivityIndicator,
  Button,
  Dialog,
  Portal,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';

import type {SourceAvailability, SourceDto} from '../native/CloudSyncContracts';
import {useSources, type SourcesError} from './useSources';

const STATUS_TEXT: Record<SourceAvailability, string> = {
  AVAILABLE: 'Available',
  GRANT_REVOKED: 'Access lost',
  STORAGE_MISSING: 'Storage missing',
};

/**
 * Snackbar text for a typed error. On SOURCE_OVERLAP the conflicting
 * source's alias comes from structured data, never from the message.
 */
export function sourcesErrorText(error: SourcesError): string {
  const summary =
    error.code === 'SOURCE_OVERLAP' && error.conflictingSource != null
      ? `This folder overlaps "${error.conflictingSource.alias}", a folder you already added.`
      : error.message;
  return error.action ? `${summary} ${error.action}` : summary;
}

type SourceRowProps = {
  source: SourceDto;
  onRegrant: (sourceId: string) => void;
  onRemove: (source: SourceDto) => void;
};

function SourceRow({
  source,
  onRegrant,
  onRemove,
}: SourceRowProps): React.JSX.Element {
  const theme = useTheme();
  const available = source.availability === 'AVAILABLE';
  const chipBackground = available
    ? theme.colors.secondaryContainer
    : theme.colors.errorContainer;
  const chipText = available
    ? theme.colors.onSecondaryContainer
    : theme.colors.onErrorContainer;
  const chipStyles = useMemo(
    () =>
      StyleSheet.create({
        background: {backgroundColor: chipBackground},
        text: {color: chipText},
      }),
    [chipBackground, chipText],
  );

  return (
    <Surface elevation={1} style={styles.row} testID="sources.row">
      <View style={styles.rowHeader}>
        <Text
          style={styles.alias}
          testID="sources.row.alias"
          variant="titleMedium">
          {source.alias}
        </Text>
        <View style={[styles.chip, chipStyles.background]}>
          <Text
            style={chipStyles.text}
            testID="sources.row.status"
            variant="labelMedium">
            {STATUS_TEXT[source.availability]}
          </Text>
        </View>
      </View>
      <Text variant="bodyMedium">{source.volumeLabel}</Text>
      {source.displayPath !== '' ? (
        <Text variant="bodySmall">{source.displayPath}</Text>
      ) : null}
      <View style={styles.rowActions}>
        {available ? null : (
          <Button
            mode="text"
            onPress={() => onRegrant(source.sourceId)}
            testID="sources.row.regrant">
            Re-grant
          </Button>
        )}
        <Button
          mode="text"
          onPress={() => onRemove(source)}
          testID="sources.row.remove">
          Remove
        </Button>
      </View>
    </Surface>
  );
}

/**
 * Settings › Folders: the added sources with their availability, Add folder,
 * Re-grant (unavailable sources only), Remove with confirmation (FR-005) and
 * a snackbar for typed errors (research R14).
 */
export function SourcesSection(): React.JSX.Element {
  const {sources, loading, error, add, regrant, remove, dismissError} =
    useSources();
  const [pendingRemoval, setPendingRemoval] = useState<SourceDto | null>(null);

  const confirmRemoval = () => {
    const target = pendingRemoval;
    setPendingRemoval(null);
    if (target != null) {
      remove(target.sourceId);
    }
  };

  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" variant="titleLarge">
        Folders
      </Text>
      <Text variant="bodyMedium">
        The folders on this device that SyncScope checks against your backup.
      </Text>
      {loading ? (
        <ActivityIndicator accessibilityLabel="Loading folders" />
      ) : null}
      {!loading && sources.length === 0 ? (
        <Text variant="bodyMedium">No folders added yet.</Text>
      ) : null}
      {sources.map(source => (
        <SourceRow
          key={source.sourceId}
          onRegrant={regrant}
          onRemove={setPendingRemoval}
          source={source}
        />
      ))}
      <Button
        icon="folder-plus-outline"
        mode="contained"
        onPress={() => add()}
        style={styles.addButton}
        testID="sources.add">
        Add folder
      </Button>
      <Portal>
        {pendingRemoval != null ? (
          <Dialog onDismiss={() => setPendingRemoval(null)} visible>
            <Dialog.Title>Remove folder?</Dialog.Title>
            <Dialog.Content>
              <Text variant="bodyMedium">
                {`"${pendingRemoval.alias}" will be removed from the list and its scan results deleted. Files on your device are not touched.`}
              </Text>
            </Dialog.Content>
            <Dialog.Actions>
              <Button
                onPress={() => setPendingRemoval(null)}
                testID="sources.dialog.cancel">
                Cancel
              </Button>
              <Button onPress={confirmRemoval} testID="sources.dialog.confirm">
                Remove
              </Button>
            </Dialog.Actions>
          </Dialog>
        ) : null}
      </Portal>
      {error != null ? (
        <Snackbar
          action={{label: 'Dismiss', onPress: dismissError}}
          onDismiss={dismissError}
          testID="sources.error"
          visible>
          {sourcesErrorText(error)}
        </Snackbar>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  addButton: {
    alignSelf: 'flex-start',
  },
  alias: {
    flexShrink: 1,
  },
  chip: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  row: {
    borderRadius: 16,
    gap: 4,
    padding: 16,
  },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  section: {
    gap: 12,
  },
});
