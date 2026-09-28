import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';

import App from '../App';

jest.mock('../src/native/CloudSync', () => ({
  listSources: jest
    .fn()
    .mockResolvedValue({contractVersion: 2, status: 'ok', sources: []}),
  launchSourcePicker: jest.fn(),
  removeSource: jest.fn(),
}));

describe('SyncScope application shell', () => {
  it('shows the branded Material shell and all navigation destinations', () => {
    render(<App />);

    expect(screen.getByText('SyncScope')).toBeOnTheScreen();
    expect(screen.getByRole('header', {name: 'Files'})).toBeOnTheScreen();
    expect(screen.getByText('Scan')).toBeOnTheScreen();
    expect(screen.getByText('Settings')).toBeOnTheScreen();
  });

  it('navigates between destinations', async () => {
    render(<App />);

    fireEvent.press(screen.getByText('Scan'));
    expect(
      screen.getByText(
        'Scan controls and progress will appear here after setup.',
      ),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByText('Settings'));
    expect(
      await screen.findByRole('header', {name: 'Folders'}),
    ).toBeOnTheScreen();
    expect(screen.getByTestId('sources.add')).toBeOnTheScreen();
    expect(
      screen.queryByText('Repository and folder settings will appear here.'),
    ).toBeNull();
    expect(await screen.findByText('No folders added yet.')).toBeOnTheScreen();
  });
});
