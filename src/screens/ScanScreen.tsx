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
import {useNavigation, type NavigationProp} from '@react-navigation/native';

import type {
  CloudSyncError,
  ScanMode,
  ScanPhase,
  ScanRunDto,
} from '../native/CloudSyncContracts';
import type {RootStackParamList, RootTabParamList} from '../navigation/AppNavigator';
import {GoThereButton} from '../navigation/fixTargets';
import {ScanSummaryCard, formatTimestamp} from '../scan/ScanSummaryCard';
import {useScan} from '../scan/useScan';
import {spacing} from '../theme/spacing';
import {
  useSetupChecklist,
  type FoldersItem,
  type RepositoryItem,
} from '../setup/useSetupChecklist';

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

const REPOSITORY_TEXT: Record<Exclude<RepositoryItem, 'ready'>, string> = {
  missing: 'Enter the details of the server that holds your backup.',
  needsPassword: 'Enter the server password again.',
};

const FOLDERS_TEXT: Record<Exclude<FoldersItem, 'ready'>, string> = {
  none: 'Add a folder from this device to check.',
  noneAvailable:
    'None of your folders can be read any more. Add a folder or allow access again.',
};

type ChecklistNavigation = NavigationProp<
  Pick<RootStackParamList, 'Repository'> & Pick<RootTabParamList, 'Settings'>
>;

/**
 * "Before you can scan" (FR-007, research R6): each missing item says what is
 * missing and opens the place where it is set up.
 */
function SetupChecklistCard({
  repository,
  folders,
}: {
  repository: RepositoryItem;
  folders: FoldersItem;
}): React.JSX.Element {
  const navigation = useNavigation<ChecklistNavigation>();
  return (
    <Surface
      accessibilityLabel="Before you can scan"
      elevation={1}
      style={styles.card}>
      <Text variant="titleMedium">Before you can scan</Text>
      {repository !== 'ready' ? (
        <View style={styles.checklistItem}>
          <Text variant="bodyMedium">{REPOSITORY_TEXT[repository]}</Text>
          <Button
            accessibilityLabel="Set up the server"
            icon="server"
            mode="contained-tonal"
            onPress={() => navigation.navigate('Repository')}
            style={styles.checklistButton}>
            Set up the server
          </Button>
        </View>
      ) : null}
      {folders !== 'ready' ? (
        <View style={styles.checklistItem}>
          <Text variant="bodyMedium">{FOLDERS_TEXT[folders]}</Text>
          <Button
            accessibilityLabel="Add a folder"
            icon="folder-plus-outline"
            mode="contained-tonal"
            onPress={() => navigation.navigate('Settings')}
            style={styles.checklistButton}>
            Add a folder
          </Button>
        </View>
      ) : null}
    </Surface>
  );
}

/** FR-010: the shown results were made with server settings that have since changed. */
function OldSettingsNotice(): React.JSX.Element {
  return (
    <Surface
      accessibilityLabel="Results from previous server settings"
      elevation={1}
      style={styles.card}>
      <Text variant="titleMedium">Results from previous server settings</Text>
      <Text variant="bodyMedium">
        These results were made with your previous server settings. Scan again.
      </Text>
    </Surface>
  );
}

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
            <GoThereButton
              code={run.error.code}
              textColor={theme.colors.onErrorContainer}
            />
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
 * The Scan tab: what is still needed before a first scan (with a way to each
 * place), Scan / Rescan from scratch / Cancel scan, live progress, the last
 * run, why an interrupted run did not complete (with "Go there" when the error
 * has a fix target), and the active snapshot's summary. Every labelled element
 * is a Maestro selector (contracts/maestro-scan.md, contracts/maestro-mvp.md).
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
  const checklist = useSetupChecklist();
  const theme = useTheme();
  const themed = useMemo(
    () =>
      StyleSheet.create({
        snackbarText: {color: theme.colors.inverseOnSurface},
      }),
    [theme.colors.inverseOnSurface],
  );
  const scanLabel = active == null ? 'Scan' : 'Rescan from scratch';
  // Until the checklist has answered nothing is known to be missing, so Scan stays offered.
  const setupMissing =
    !checklist.loading &&
    (checklist.repository !== 'ready' || checklist.folders !== 'ready');

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
        {setupMissing ? (
          <SetupChecklistCard
            folders={checklist.folders}
            repository={checklist.repository}
          />
        ) : null}
        <View style={styles.actions}>
          <Button
            accessibilityLabel={scanLabel}
            disabled={isRunning || setupMissing}
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
        {active != null && checklist.resultsFromOldSettings ? (
          <OldSettingsNotice />
        ) : null}
        {active != null ? (
          <ScanSummaryCard active={active} isStale={isStale} />
        ) : null}
      </ScrollView>
      {error != null ? (
        <Snackbar
          action={{label: 'Dismiss', onPress: dismissError}}
          onDismiss={dismissError}
          visible>
          <View>
            <Text style={themed.snackbarText} variant="bodyMedium">
              {errorText(error)}
            </Text>
            <GoThereButton
              code={error.code}
              onGo={dismissError}
              textColor={theme.colors.inversePrimary}
            />
          </View>
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
  checklistButton: {
    alignSelf: 'flex-start',
  },
  checklistItem: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
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
