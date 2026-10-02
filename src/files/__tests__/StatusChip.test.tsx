import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import { StyleSheet } from 'react-native';

import type { FileStatus } from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { STATUS_LABEL } from '../../theme/statusLabels';
import { STATUS_ICON, StatusChip } from '../StatusChip';

function renderChip(status: FileStatus, theme = MD3LightTheme) {
  return render(
    <PaperProvider theme={theme}>
      <StatusChip status={status} />
    </PaperProvider>,
  );
}

describe('StatusChip', () => {
  it.each([
    ['SYNCED', 'Synced'],
    ['UNSYNCED', 'Unsynced'],
    ['UNKNOWN', 'Unknown'],
  ] as const)('shows %s as "%s"', (status, label) => {
    renderChip(status);

    expect(screen.getByText(label)).toBeOnTheScreen();
  });

  it('uses a distinct icon per status', () => {
    expect(STATUS_ICON).toEqual({
      SYNCED: 'check-circle-outline',
      UNSYNCED: 'cloud-off-outline',
      UNKNOWN: 'help-circle-outline',
    });
    expect(new Set(Object.values(STATUS_ICON)).size).toBe(3);
  });

  it.each([
    ['SYNCED', 'primaryContainer', 'onPrimaryContainer'],
    ['UNSYNCED', 'errorContainer', 'onErrorContainer'],
    ['UNKNOWN', 'surfaceVariant', 'onSurfaceVariant'],
  ] as const)(
    'colours %s from the theme (%s / %s)',
    (status, background, foreground) => {
      for (const theme of [MD3LightTheme, MD3DarkTheme]) {
        const { unmount } = renderChip(status, theme);

        const chip = StyleSheet.flatten(
          screen.getByTestId('status-chip').props.style,
        );
        expect(chip.backgroundColor).toBe(theme.colors[background]);
        const text = StyleSheet.flatten(
          screen.getByText(STATUS_LABEL[status]).props.style,
        );
        expect(text.color).toBe(theme.colors[foreground]);
        unmount();
      }
    },
  );

  it('is not interactive, so the a11y sweep has nothing to flag', () => {
    const result = renderChip('UNSYNCED');

    expect(() => a11ySweep(result)).not.toThrow();
    expect(
      result.UNSAFE_root.findAll(n => typeof n.props.onPress === 'function'),
    ).toEqual([]);
  });
});
