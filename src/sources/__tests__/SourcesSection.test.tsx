import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import type {SourceDto} from '../../native/CloudSyncContracts';
import {SourcesSection} from '../SourcesSection';
import {useSources, type UseSourcesResult} from '../useSources';

jest.mock('../useSources', () => ({useSources: jest.fn()}));

const useSourcesMock = useSources as jest.MockedFunction<typeof useSources>;

function source(overrides: Partial<SourceDto> = {}): SourceDto {
  return {
    sourceId: 'source-1',
    alias: 'Camera',
    volumeLabel: 'Internal shared storage',
    displayPath: 'SyncScopeE2E/Camera',
    isRemovable: false,
    canWrite: true,
    addedAtMillis: 1,
    availability: 'AVAILABLE',
    ...overrides,
  };
}

function hookState(
  overrides: Partial<UseSourcesResult> = {},
): UseSourcesResult {
  return {
    sources: [],
    loading: false,
    error: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    add: jest.fn().mockResolvedValue(undefined),
    regrant: jest.fn().mockResolvedValue(undefined),
    remove: jest.fn().mockResolvedValue(undefined),
    dismissError: jest.fn(),
    ...overrides,
  };
}

function renderSection(state: UseSourcesResult) {
  useSourcesMock.mockReturnValue(state);
  return render(
    <PaperProvider>
      <SourcesSection />
    </PaperProvider>,
  );
}

function row(index: number) {
  const rows = screen.getAllByTestId('sources.row');
  const found = rows[index];
  if (found === undefined) {
    throw new Error(`No sources.row at index ${index}`);
  }
  return within(found);
}

const threeSources = [
  source(),
  source({
    sourceId: 'source-2',
    alias: 'Camera (SDCARD)',
    volumeLabel: 'SDCARD',
    isRemovable: true,
    addedAtMillis: 2,
    availability: 'GRANT_REVOKED',
  }),
  source({
    sourceId: 'source-3',
    alias: 'Music',
    displayPath: 'Music',
    volumeLabel: 'Removable storage',
    isRemovable: true,
    addedAtMillis: 3,
    availability: 'STORAGE_MISSING',
  }),
];

describe('SourcesSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows each row with alias, volume label, folder path and status', () => {
    renderSection(hookState({sources: threeSources}));

    const rows = screen.getAllByTestId('sources.row');
    expect(rows).toHaveLength(3);

    const first = row(0);
    expect(first.getByTestId('sources.row.alias')).toHaveTextContent('Camera');
    expect(first.getByText('Internal shared storage')).toBeOnTheScreen();
    expect(first.getByText('SyncScopeE2E/Camera')).toBeOnTheScreen();
    expect(first.getByTestId('sources.row.status')).toHaveTextContent(
      'Available',
    );

    expect(row(1).getByTestId('sources.row.alias')).toHaveTextContent(
      'Camera (SDCARD)',
    );
    expect(row(1).getByTestId('sources.row.status')).toHaveTextContent(
      'Access lost',
    );
    expect(row(2).getByTestId('sources.row.status')).toHaveTextContent(
      'Storage missing',
    );
  });

  it('shows Re-grant only for unavailable sources', () => {
    const state = hookState({sources: threeSources});
    renderSection(state);

    expect(row(0).queryByTestId('sources.row.regrant')).toBeNull();
    expect(row(1).getByTestId('sources.row.regrant')).toBeOnTheScreen();
    expect(row(2).getByTestId('sources.row.regrant')).toBeOnTheScreen();

    fireEvent.press(row(1).getByTestId('sources.row.regrant'));
    expect(state.regrant).toHaveBeenCalledWith('source-2');
  });

  it('calls add when Add folder is pressed', () => {
    const state = hookState();
    renderSection(state);

    fireEvent.press(screen.getByTestId('sources.add'));

    expect(state.add).toHaveBeenCalledTimes(1);
  });

  it('removes only after the dialog is confirmed', () => {
    const state = hookState({sources: threeSources});
    renderSection(state);

    fireEvent.press(row(1).getByTestId('sources.row.remove'));
    expect(screen.getByTestId('sources.dialog.confirm')).toBeOnTheScreen();
    expect(
      screen.getByText(/"Camera \(SDCARD\)" will be removed/),
    ).toBeOnTheScreen();
    expect(state.remove).not.toHaveBeenCalled();

    fireEvent.press(screen.getByTestId('sources.dialog.confirm'));

    expect(state.remove).toHaveBeenCalledTimes(1);
    expect(state.remove).toHaveBeenCalledWith('source-2');
  });

  it('cancelling the dialog changes nothing', () => {
    const state = hookState({sources: threeSources});
    renderSection(state);

    fireEvent.press(row(0).getByTestId('sources.row.remove'));
    fireEvent.press(screen.getByTestId('sources.dialog.cancel'));

    expect(state.remove).not.toHaveBeenCalled();
    expect(screen.queryByTestId('sources.dialog.confirm')).toBeNull();
    expect(screen.getAllByTestId('sources.row')).toHaveLength(3);
  });

  it('shows an error in the snackbar', () => {
    renderSection(
      hookState({
        sources: [source()],
        error: {
          code: 'PICKER_BUSY',
          message: 'The folder picker is already open.',
          action: 'Finish or close the picker, then try again.',
          conflictingSource: null,
        },
      }),
    );

    expect(screen.getByTestId('sources.error')).toBeOnTheScreen();
    expect(
      screen.getByText(/The folder picker is already open\./),
    ).toBeOnTheScreen();
  });

  it('names the conflicting source on SOURCE_OVERLAP', () => {
    renderSection(
      hookState({
        sources: [source()],
        error: {
          code: 'SOURCE_OVERLAP',
          message: 'This folder overlaps a folder you already added.',
          action:
            'Pick a folder that is not inside, or around, an existing one.',
          conflictingSource: {sourceId: 'source-1', alias: 'Camera'},
        },
      }),
    );

    expect(
      within(screen.getByTestId('sources.error')).getByText(/overlaps.*Camera/),
    ).toBeOnTheScreen();
  });

  it('shows no snackbar without an error', () => {
    renderSection(hookState({sources: [source()]}));

    expect(screen.queryByTestId('sources.error')).toBeNull();
  });
});
