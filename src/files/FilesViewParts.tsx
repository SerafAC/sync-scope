import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';

import type {
  CloudSyncError,
  StatusCountDto,
} from '../native/CloudSyncContracts';
import { spacing } from '../theme/spacing';

// Parts shared by the gallery and the list view (`src/screens/`).

export const NO_MATCHES_TEXT = 'No files match this filter';
export const NO_SCAN_TEXT = 'No scan results yet';
export const LOADING_FILES_LABEL = 'Loading files';

/** Props of each Files view, wired by `FilesScreen`. */
export interface FilesViewProps {
  /** The active snapshot, or null before any completed scan. */
  snapshotId: string | null;
  /** The scan state has not answered yet, so "no snapshot" is not known. */
  scanLoading: boolean;
  /** Each source's alias by `sourceId`. */
  aliases: ReadonlyMap<string, string>;
  /** The chip counts of what the view shows; null while not known. */
  onCountsChange: (counts: StatusCountDto[] | null) => void;
  /** The view's rows were replaced by those of a new snapshot (FR-005). */
  onSnapshotChange: () => void;
  /** A read found the snapshot gone: re-read the scan state. */
  onSnapshotLost?: () => unknown;
  /** Bumped after a deletion: reload page 1, keeping the folder and filter. */
  reloadKey?: number;
  /**
   * The view is on screen (default true). A hidden view holds its list back
   * while a new snapshot's place is pending, and opens it there when shown
   * (007 Story 4 sc. 4, research R8).
   */
  visible?: boolean;
}

function errorText(error: CloudSyncError): string {
  return error.action ? `${error.message} ${error.action}` : error.message;
}

/** A centred status: `Loading files`, an empty-state text, or an error with `Retry`. */
export function FilesMessage({
  error,
  loading,
  onRetry,
  text,
}: {
  error?: CloudSyncError | null;
  loading?: boolean;
  onRetry?: () => void;
  text?: string;
}): React.JSX.Element {
  return (
    <View style={styles.message}>
      {loading ? (
        <ActivityIndicator accessibilityLabel={LOADING_FILES_LABEL} />
      ) : null}
      {text != null ? <Text variant="bodyLarge">{text}</Text> : null}
      {error != null ? (
        <Text variant="bodyMedium">{errorText(error)}</Text>
      ) : null}
      {error != null && onRetry != null ? (
        <Button accessibilityLabel="Retry" mode="contained" onPress={onRetry}>
          Retry
        </Button>
      ) : null}
    </View>
  );
}

/**
 * Reports a view's chip counts and snapshot changes to `FilesScreen`. On a
 * snapshot change, [beforeAcknowledge] runs first (the list view re-locates
 * its folder), then `onSnapshotChange`, then [acknowledge].
 */
export function useReportToFilesScreen(
  counts: StatusCountDto[] | null,
  snapshotChanged: boolean,
  acknowledge: () => void,
  {
    onCountsChange,
    onSnapshotChange,
  }: Pick<FilesViewProps, 'onCountsChange' | 'onSnapshotChange'>,
  beforeAcknowledge?: () => Promise<void>,
): void {
  const callbacks = useRef({
    onCountsChange,
    onSnapshotChange,
    beforeAcknowledge,
  });
  useEffect(() => {
    callbacks.current = { onCountsChange, onSnapshotChange, beforeAcknowledge };
  });

  useEffect(() => {
    callbacks.current.onCountsChange(counts);
  }, [counts]);

  useEffect(() => {
    if (!snapshotChanged) {
      return;
    }
    let live = true;
    const settle = async () => {
      await callbacks.current.beforeAcknowledge?.();
      if (live) {
        callbacks.current.onSnapshotChange();
        acknowledge();
      }
    };
    settle();
    return () => {
      live = false;
    };
  }, [snapshotChanged, acknowledge]);
}

const styles = StyleSheet.create({
  message: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
});
