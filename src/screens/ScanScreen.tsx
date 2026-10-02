import React, {useMemo} from 'react';
import {ScrollView, StyleSheet, View} from 'react-native';
import {
  ActivityIndicator,
  Button,
  ProgressBar,
  Snackbar,
  Surface,
  Text,
  useTheme,
} from 'react-native-paper';
import {SafeAreaView} from 'react-native-safe-area-context';

import type {
  CloudSyncError,
  ScanMode,
  ScanPhase,
  ScanRunDto,
} from '../native/CloudSyncContracts';
import {ScanSummaryCard, formatTimestamp} from '../scan/ScanSummaryCard';
import {useScan} from '../scan/useScan';

const MODE_TEXT: Record<ScanMode, string> = {
  FULL: 'Full scan',
  LOCAL_REFRESH: 'Local refresh',
};

const PHASE_TEXT: Record<ScanPhase, string> = {
  CONNECTING: 'Connecting to the server',
  LISTING_REMOTE: 'Listing the backup',
  COPYING_REMOTE: 'Reusing the last backup listing',
  ENUMERATING_LOCAL: 'Checking the files on this device',
  PUBLISHING: 'Saving the results',
  PUBLISHED: 'Completed',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
  ABORTED: 'Stopped when the app closed',
};

function errorText(error: CloudSyncError): string {
  return error.action ? `${error.message} ${error.action}` : error.message;
}

function ScanProgressCard({run}: {run: ScanRunDto}): React.JSX.Element {
  const {progress} = run;
  return (
    <Surface accessibilityLabel="Scan progress" elevation={1} style={styles.card}>
      <Text variant="titleMedium">{PHASE_TEXT[run.phase]}</Text>
      <ProgressBar indeterminate />
      <Text variant="bodyMedium">
        {`Remote folders listed: ${progress.remoteDirectoriesListed}`}
      </Text>
      <Text variant="bodyMedium">
        {`Remote files listed: ${progress.remoteFilesListed}`}
      </Text>
      <Text variant="bodyMedium">
        {`Local files found: ${progress.localFilesEnumerated}`}
      </Text>
      <Text variant="bodyMedium">
        {`Local files matched: ${progress.localFilesMatched}`}
      </Text>
    </Surface>
  );
}

function LastScan({run}: {run: ScanRunDto}): React.JSX.Element {
  const finished = run.finishedAtMillis;
  return (
    <View accessibilityLabel="Last scan" style={styles.lastScan}>
      <Text variant="labelLarge">{MODE_TEXT[run.mode]}</Text>
      <Text variant="bodyMedium">{`Generation ${run.generation}`}</Text>
      <Text variant="bodyMedium">
        {run.terminalState === null
          ? 'In progress'
          : `${run.terminalState === 'COMPLETED' ? 'Completed' : 'Ended'} ${
              finished != null ? formatTimestamp(finished) : ''
            }`.trim()}
      </Text>
    </View>
  );
}

/** Why the last run the user needs to know about did not complete (FR-001, FR-006). */
function Interruption({run}: {run: ScanRunDto}): React.JSX.Element | null {
  const theme = useTheme();
  const themed = useMemo(
    () =>
      StyleSheet.create({
        failedCard: {backgroundColor: theme.colors.errorContainer},
        onError: {color: theme.colors.onErrorContainer},
      }),
    [theme.colors.errorContainer, theme.colors.onErrorContainer],
  );
  if (run.terminalState === 'FAILED') {
    return (
      <Surface
        accessibilityLabel="Scan failed"
        elevation={0}
        style={[styles.card, themed.failedCard]}>
        <Text style={themed.onError} variant="titleMedium">
          Scan failed
        </Text>
        {run.error != null ? (
          <>
            <Text style={themed.onError} variant="bodyMedium">
              {run.error.message}
            </Text>
            {run.error.action ? (
              <Text style={themed.onError} variant="bodyMedium">
                {run.error.action}
              </Text>
            ) : null}
          </>
        ) : null}
        <Text style={themed.onError} variant="bodySmall">
          The previous results below are unchanged.
        </Text>
      </Surface>
    );
  }
  if (run.terminalState === 'CANCELLED') {
    return (
      <Text variant="titleMedium">
        {run.cancelReason === 'BACKGROUNDED' ? 'Cancelled (app left)' : 'Cancelled'}
      </Text>
    );
  }
  return null;
}

/**
 * The Scan tab: Scan / Rescan from scratch / Cancel scan, live progress, the
 * last run, why an interrupted run did not complete, and the active
 * snapshot's summary. Every labelled element is a Maestro selector
 * (contracts/maestro-scan.md).
 */
export function ScanScreen(): React.JSX.Element {
  const {
    run,
    active,
    interrupted,
    loading,
    error,
    isRunning,
    isStale,
    scan,
    cancel,
    dismissError,
  } = useScan();
  const scanLabel = active == null ? 'Scan' : 'Rescan from scratch';

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" variant="titleLarge">
          Scan
        </Text>
        <Text variant="bodyMedium">
          Checks every file in your folders against the backup.
        </Text>
        {loading ? <ActivityIndicator accessibilityLabel="Loading scan" /> : null}
        <View style={styles.actions}>
          <Button
            accessibilityLabel={scanLabel}
            disabled={isRunning}
            icon="radar"
            mode="contained"
            onPress={() => scan()}>
            {scanLabel}
          </Button>
          {isRunning ? (
            <Button
              accessibilityLabel="Cancel scan"
              mode="outlined"
              onPress={() => cancel()}>
              Cancel scan
            </Button>
          ) : null}
        </View>
        {run != null && isRunning ? <ScanProgressCard run={run} /> : null}
        {run != null ? <LastScan run={run} /> : null}
        {interrupted != null ? <Interruption run={interrupted} /> : null}
        {active != null ? (
          <ScanSummaryCard active={active} isStale={isStale} />
        ) : null}
      </ScrollView>
      {error != null ? (
        <Snackbar
          action={{label: 'Dismiss', onPress: dismissError}}
          onDismiss={dismissError}
          visible>
          {errorText(error)}
        </Snackbar>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    borderRadius: 16,
    gap: 4,
    padding: 16,
  },
  content: {
    gap: 16,
    padding: 24,
  },
  lastScan: {
    gap: 2,
  },
  safeArea: {
    flex: 1,
  },
});
