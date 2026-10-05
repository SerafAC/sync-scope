import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PaperProvider, Text } from 'react-native-paper';

import type { StatusCountDto } from '../../native/CloudSyncContracts';
import { a11ySweep } from '../../test-utils/a11ySweep';
import { FILTER_ORDER, FilterChips } from '../FilterChips';
import { FilesProvider } from '../FilesProvider';
import { useFiles } from '../useFiles';

const COUNTS: StatusCountDto[] = [
  { status: 'SYNCED', count: 3 },
  { status: 'UNSYNCED', count: 3 },
];

function CurrentFilter(): React.JSX.Element {
  return <Text testID="current-filter">{useFiles().filter}</Text>;
}

function renderChips(counts: StatusCountDto[] | null) {
  return render(
    <PaperProvider>
      <FilesProvider>
        <FilterChips counts={counts} />
        <CurrentFilter />
      </FilesProvider>
    </PaperProvider>,
  );
}

describe('FilterChips', () => {
  it('takes only the height of its chips, not a share of the screen', () => {
    renderChips(COUNTS);

    expect(screen.getByTestId('filter-chips')).toHaveStyle({ flexGrow: 0 });
  });

  it('shows the four chips in order, with exact labels and counts', () => {
    renderChips(COUNTS);

    expect(FILTER_ORDER).toEqual([
      'ALL',
      'SYNCED',
      'UNSYNCED',
      'ISSUES_UNKNOWN',
    ]);
    const labels = FILTER_ORDER.map(
      f => screen.getByTestId(`filter-chip-${f}`).props.accessibilityLabel,
    );
    expect(labels).toEqual([
      'Filter All, 6',
      'Filter Synced, 3',
      'Filter Unsynced, 3',
      'Filter Issues or unknown, 0',
    ]);
    expect(screen.getByText('All 6')).toBeOnTheScreen();
    expect(screen.getByText('Synced 3')).toBeOnTheScreen();
    expect(screen.getByText('Unsynced 3')).toBeOnTheScreen();
    expect(screen.getByText('Issues or unknown 0')).toBeOnTheScreen();
  });

  it('shows no count while the counts are not known', () => {
    renderChips(null);

    expect(screen.getByLabelText('Filter All')).toBeOnTheScreen();
    expect(screen.getByLabelText('Filter Issues or unknown')).toBeOnTheScreen();
    expect(screen.getByText('All')).toBeOnTheScreen();
    expect(screen.getByText('Issues or unknown')).toBeOnTheScreen();
    expect(screen.queryByText(/\d/)).toBeNull();
  });

  it('selects the shared filter, and a press changes it', () => {
    renderChips(COUNTS);

    expect(screen.getByLabelText('Filter All, 6')).toBeSelected();
    expect(screen.getByLabelText('Filter Synced, 3')).not.toBeSelected();

    fireEvent.press(screen.getByLabelText('Filter Synced, 3'));

    expect(screen.getByTestId('current-filter')).toHaveTextContent('SYNCED');
    expect(screen.getByLabelText('Filter Synced, 3')).toBeSelected();
    expect(screen.getByLabelText('Filter All, 6')).not.toBeSelected();

    fireEvent.press(screen.getByLabelText('Filter Issues or unknown, 0'));
    expect(screen.getByTestId('current-filter')).toHaveTextContent(
      'ISSUES_UNKNOWN',
    );
  });

  it('passes the a11y sweep', () => {
    expect(() => a11ySweep(renderChips(COUNTS))).not.toThrow();
    expect(() => a11ySweep(renderChips(null))).not.toThrow();
  });
});
