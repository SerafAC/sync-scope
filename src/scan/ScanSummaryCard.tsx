import React, {useMemo} from 'react';
import {StyleSheet, View} from 'react-native';
import {Surface, Text, useTheme} from 'react-native-paper';

import type {
  ActiveSnapshotDto,
  SkippedSourceDto,
} from '../native/CloudSyncContracts';
import {STATUS_LABEL} from '../theme/statusLabels';

const SKIP_REASON_TEXT: Record<SkippedSourceDto['reason'], string> = {
  GRANT_REVOKED: 'Access lost',
  STORAGE_MISSING: 'Storage missing',
  LOCAL_UNAVAILABLE: 'Could not be read completely',
};

/** Why the remote walk stopped early; the codes are CloudSyncErrorCode values. */
const INTERRUPTION_TEXT: Record<string, string> = {
  CONNECTION_LOST: 'the connection to the server was lost',
  CONNECTION_TIMEOUT: 'the server stopped responding',
  SERVER_ERROR: 'the server reported an error',
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** A coarse relative age, e.g. "5 minutes ago"; a future time reads "just now". */
export function formatAge(thenMillis: number, nowMillis: number): string {
  const elapsed = Math.max(0, nowMillis - thenMillis);
  if (elapsed < MINUTE) {
    return 'just now';
  }
  if (elapsed < HOUR) {
    return `${plural(Math.floor(elapsed / MINUTE), 'minute')} ago`;
  }
  if (elapsed < DAY) {
    return `${plural(Math.floor(elapsed / HOUR), 'hour')} ago`;
  }
  return `${plural(Math.floor(elapsed / DAY), 'day')} ago`;
}

/** An absolute local date and time, stable across renders (unlike the relative age). */
export function formatTimestamp(millis: number): string {
  return new Date(millis).toLocaleString();
}

/** The rescan hint for a remote listing older than STALE_REMOTE_LISTING_MILLIS (FR-003). */
export const RESCAN_SUGGESTED_TEXT =
  'The remote listing is more than 7 days old. A rescan from scratch is suggested before you delete anything.';

export function unreadableFoldersText(count: number): string {
  return `${count} remote ${count === 1 ? 'folder' : 'folders'} could not be read`;
}

type ScanSummaryCardProps = {
  active: ActiveSnapshotDto;
  isStale: boolean;
  /** The time the age is measured against; defaults to now. */
  now?: number;
};

/**
 * The active snapshot's completion summary (FR-005, FR-007): counts, what
 * could not be checked and why, the remote listing's age and the rescan hint
 * (FR-003). Every labelled element is a Maestro selector
 * (contracts/maestro-scan.md).
 */
export function ScanSummaryCard({
  active,
  isStale,
  now,
}: ScanSummaryCardProps): React.JSX.Element {
  const theme = useTheme();
  const themed = useMemo(
    () => StyleSheet.create({error: {color: theme.colors.error}}),
    [theme.colors.error],
  );
  const {summary} = active;
  const interruption = summary.remoteListingInterruptedBy;
  const listedAt = active.remoteListedAtMillis;

  return (
    <Surface accessibilityLabel="Scan summary" elevation={1} style={styles.card}>
      <Text accessibilityRole="header" variant="titleMedium">
        Scan summary
      </Text>
      <Text variant="bodyLarge">{`${STATUS_LABEL.SYNCED}: ${summary.synced}`}</Text>
      <Text variant="bodyLarge">{`${STATUS_LABEL.UNSYNCED}: ${summary.unsynced}`}</Text>
      <View accessibilityLabel="Files that could not be checked">
        <Text variant="bodyLarge">
          {`Files that could not be checked: ${summary.unknown}`}
        </Text>
      </View>
      {summary.unreadableRemoteDirectories > 0 ? (
        <Text style={themed.error} variant="bodyMedium">
          {unreadableFoldersText(summary.unreadableRemoteDirectories)}
        </Text>
      ) : null}
      {interruption != null ? (
        <Text style={themed.error} variant="bodyMedium">
          {`The remote listing was interrupted: ${
            INTERRUPTION_TEXT[interruption] ?? interruption
          }.`}
        </Text>
      ) : null}
      {summary.skippedSources.map(source => (
        <Text key={source.sourceId} style={themed.error} variant="bodyMedium">
          {`Skipped ${source.alias}: ${SKIP_REASON_TEXT[source.reason]}`}
        </Text>
      ))}
      <View accessibilityLabel="Remote listing age">
        <Text variant="bodySmall">
          {`Remote listing from ${formatTimestamp(listedAt)} (${formatAge(
            listedAt,
            now ?? Date.now(),
          )})`}
        </Text>
      </View>
      {isStale ? (
        <View accessibilityLabel="Rescan suggested">
          <Text variant="bodyMedium">{RESCAN_SUGGESTED_TEXT}</Text>
        </View>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    gap: 4,
    padding: 16,
  },
});
