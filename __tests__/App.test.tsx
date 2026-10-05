import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { PaperProvider } from 'react-native-paper';

import App from '../App';
import { getScanState, startScan } from '../src/native/CloudSync';
import {
  AppNavigator,
  type RootStackParamList,
} from '../src/navigation/AppNavigator';
import { ScanProvider } from '../src/scan/ScanProvider';

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
  getRepositorySummary: jest.fn().mockResolvedValue({
    contractVersion: 5,
    status: 'error',
    error: {
      code: 'REPOSITORY_NOT_CONFIGURED',
      message: 'No repository has been set up yet.',
      action: 'Set up your server in Settings › Repository.',
    },
  }),
  saveRepository: jest.fn(),
  testRepository: jest.fn(),
  approveSftpHostKey: jest.fn(),
  rejectSftpHostKey: jest.fn(),
}));

describe('SyncScope application shell', () => {
  it('shows the branded Material shell and all navigation destinations', async () => {
    render(<App />);

    expect(screen.getByText('SyncScope')).toBeOnTheScreen();
    expect(screen.getByText('Files')).toBeOnTheScreen();
    expect(screen.getByLabelText('Gallery view')).toBeOnTheScreen();
    expect(screen.getByLabelText('List view')).toBeOnTheScreen();
    expect(screen.getByText('Scan')).toBeOnTheScreen();
    expect(screen.getByText('Settings')).toBeOnTheScreen();
    await waitFor(() => expect(getScanState).toHaveBeenCalled());
  });

  it('shows the Files tab with no scan results before any scan', async () => {
    render(<App />);

    expect(await screen.findByLabelText('No scan results yet')).toBeOnTheScreen();
    expect(screen.getByText('Results appear after a scan.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Go to Scan')).toBeOnTheScreen();
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

  it('leads from the empty Files tab to the Scan checklist and on to each place', async () => {
    const navigation = createNavigationContainerRef<RootStackParamList>();
    render(
      <PaperProvider>
        <ScanProvider>
          <NavigationContainer ref={navigation}>
            <AppNavigator />
          </NavigationContainer>
        </ScanProvider>
      </PaperProvider>,
    );

    fireEvent.press(await screen.findByLabelText('Go to Scan'));
    expect(
      await screen.findByLabelText('Before you can scan'),
    ).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('Scan');

    fireEvent.press(screen.getByLabelText('Set up the server'));
    expect(await screen.findByLabelText('Save and test')).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('Repository');

    act(() => navigation.goBack());
    fireEvent.press(await screen.findByLabelText('Add a folder'));
    expect(await screen.findByTestId('sources.add')).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('Settings');
  });

  it('pushes the Repository form above the tabs on the root stack', async () => {
    const navigation = createNavigationContainerRef<RootStackParamList>();
    render(
      <PaperProvider>
        <ScanProvider>
          <NavigationContainer ref={navigation}>
            <AppNavigator />
          </NavigationContainer>
        </ScanProvider>
      </PaperProvider>,
    );
    await waitFor(() => expect(navigation.isReady()).toBe(true));

    act(() => navigation.navigate('Repository'));

    expect(await screen.findByLabelText('Save and test')).toBeOnTheScreen();
    // The native stack header is configured natively, so its title is a prop, not text.
    expect(
      screen.UNSAFE_root.findAll(node => node.props.title === 'Repository')
        .length,
    ).toBeGreaterThan(0);
    expect(navigation.getCurrentRoute()?.name).toBe('Repository');
  });
});
