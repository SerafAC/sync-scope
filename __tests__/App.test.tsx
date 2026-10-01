import React from 'react';
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';

import App from '../App';
import { getScanState, startScan } from '../src/native/CloudSync';

jest.mock('../src/native/CloudSync', () => ({
  listSources: jest
    .fn()
    .mockResolvedValue({ contractVersion: 2, status: 'ok', sources: [] }),
  launchSourcePicker: jest.fn(),
  removeSource: jest.fn(),
  getScanState: jest
    .fn()
    .mockResolvedValue({
      contractVersion: 3,
      status: 'ok',
      run: null,
      active: null,
    }),
  startScan: jest.fn(),
  cancelScan: jest.fn(),
}));

describe('SyncScope application shell', () => {
  it('shows the branded Material shell and all navigation destinations', async () => {
    render(<App />);

    expect(screen.getByText('SyncScope')).toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Files' })).toBeOnTheScreen();
    expect(screen.getByText('Scan')).toBeOnTheScreen();
    expect(screen.getByText('Settings')).toBeOnTheScreen();
    await waitFor(() => expect(getScanState).toHaveBeenCalled());
  });

  it('does not start a local refresh without an active snapshot', async () => {
    render(<App />);

    await waitFor(() => expect(getScanState).toHaveBeenCalled());
    expect(startScan).not.toHaveBeenCalled();
  });

  it('navigates between destinations', async () => {
    render(<App />);

    fireEvent.press(screen.getByText('Scan'));
    expect(
      await screen.findByText(
        'Checks every file in your folders against the backup.',
      ),
    ).toBeOnTheScreen();
    expect(await screen.findByLabelText('Scan')).toBeOnTheScreen();
    expect(
      screen.queryByText(
        'Scan controls and progress will appear here after setup.',
      ),
    ).toBeNull();

    fireEvent.press(screen.getByText('Settings'));
    expect(
      await screen.findByRole('header', { name: 'Folders' }),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sources.add')).toBeOnTheScreen();
    expect(
      screen.queryByText('Repository and folder settings will appear here.'),
    ).toBeNull();
    expect(await screen.findByText('No folders added yet.')).toBeOnTheScreen();
  });
});
