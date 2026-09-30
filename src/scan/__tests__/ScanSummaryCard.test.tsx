import React from 'react';
import {render, screen, within} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import type {ActiveSnapshotDto} from '../../native/CloudSyncContracts';
import {ScanSummaryCard, formatAge, formatTimestamp} from '../ScanSummaryCard';

const NOW = 1_800_000_000_000;

function active(overrides: Partial<ActiveSnapshotDto> = {}): ActiveSnapshotDto {
  return {
    snapshotId: 'snap-1',
    completedAtMillis: NOW - 60_000,
    remoteListedAtMillis: NOW - 3 * 60 * 60 * 1000,
    precisionMillis: 1000,
    coverage: 'COMPLETE',
    summary: {
      synced: 4,
      unsynced: 3,
      unknown: 0,
      unreadableRemoteDirectories: 0,
      remoteListingInterruptedBy: null,
      skippedSources: [],
    },
    ...overrides,
  };
}

function renderCard(snapshot: ActiveSnapshotDto, isStale = false) {
  return render(
    <PaperProvider>
      <ScanSummaryCard active={snapshot} isStale={isStale} now={NOW} />
    </PaperProvider>,
  );
}

describe('ScanSummaryCard', () => {
  it('shows the synced, unsynced and could-not-check counts', () => {
    renderCard(active());

    const summary = within(screen.getByLabelText('Scan summary'));
    expect(summary.getByText('Synced: 4')).toBeOnTheScreen();
    expect(summary.getByText('Unsynced: 3')).toBeOnTheScreen();
    expect(
      within(screen.getByLabelText('Files that could not be checked')).getByText(
        'Files that could not be checked: 0',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/remote folders? could not be read/)).toBeNull();
    expect(screen.queryByText(/interrupted/)).toBeNull();
    expect(screen.queryByText(/^Skipped/)).toBeNull();
  });

  it('states how many remote folders could not be read, singular and plural', () => {
    const one = renderCard(
      active({
        coverage: 'INCOMPLETE',
        summary: {...active().summary, unknown: 6, unreadableRemoteDirectories: 1},
      }),
    );
    expect(screen.getByText('1 remote folder could not be read')).toBeOnTheScreen();
    expect(screen.getByText('Files that could not be checked: 6')).toBeOnTheScreen();
    one.unmount();

    renderCard(
      active({
        coverage: 'INCOMPLETE',
        summary: {...active().summary, unreadableRemoteDirectories: 3},
      }),
    );
    expect(screen.getByText('3 remote folders could not be read')).toBeOnTheScreen();
  });

  it('shows the interrupted listing with the text of its code', () => {
    renderCard(
      active({
        coverage: 'INCOMPLETE',
        summary: {...active().summary, remoteListingInterruptedBy: 'CONNECTION_LOST'},
      }),
    );

    expect(
      screen.getByText(
        'The remote listing was interrupted: the connection to the server was lost.',
      ),
    ).toBeOnTheScreen();
  });

  it('names each skipped source by alias with its reason', () => {
    renderCard(
      active({
        summary: {
          ...active().summary,
          skippedSources: [
            {sourceId: 's1', alias: 'Scan', reason: 'GRANT_REVOKED'},
            {sourceId: 's2', alias: 'Camera (SDCARD)', reason: 'STORAGE_MISSING'},
            {sourceId: 's3', alias: 'Bulk', reason: 'LOCAL_UNAVAILABLE'},
          ],
        },
      }),
    );

    expect(screen.getByText('Skipped Scan: Access lost')).toBeOnTheScreen();
    expect(screen.getByText('Skipped Camera (SDCARD): Storage missing')).toBeOnTheScreen();
    expect(
      screen.getByText('Skipped Bulk: Could not be read completely'),
    ).toBeOnTheScreen();
  });

  it('shows the remote listing age as a time and a relative age', () => {
    const snapshot = active();
    renderCard(snapshot);

    const age = screen.getByLabelText('Remote listing age');
    expect(within(age).getByText(
      `Remote listing from ${formatTimestamp(snapshot.remoteListedAtMillis)} (3 hours ago)`,
    )).toBeOnTheScreen();
  });

  it('suggests a rescan only when stale', () => {
    const fresh = renderCard(active(), false);
    expect(screen.queryByLabelText('Rescan suggested')).toBeNull();
    fresh.unmount();

    renderCard(active(), true);
    expect(screen.getByLabelText('Rescan suggested')).toBeOnTheScreen();
  });
});

describe('formatAge', () => {
  it.each([
    [10_000, 'just now'],
    [60_000, '1 minute ago'],
    [5 * 60_000, '5 minutes ago'],
    [60 * 60_000, '1 hour ago'],
    [26 * 60 * 60_000, '1 day ago'],
    [8 * 24 * 60 * 60_000, '8 days ago'],
  ])('formats %d ms as %s', (elapsed, text) => {
    expect(formatAge(NOW - elapsed, NOW)).toBe(text);
  });

  it('never reports a negative age', () => {
    expect(formatAge(NOW + 5_000, NOW)).toBe('just now');
  });
});
