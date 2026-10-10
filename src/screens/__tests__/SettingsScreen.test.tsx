import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';

import { getRepositorySummary } from '../../native/CloudSync';
import { SettingsScreen } from '../SettingsScreen';
import { useSources } from '../../sources/useSources';

jest.mock('../../sources/useSources', () => ({ useSources: jest.fn() }));
jest.mock('../../native/CloudSync', () => ({
  getRepositorySummary: jest.fn(),
}));
jest.mock('@react-navigation/native', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigation: () => ({ navigate: jest.fn() }),
    useFocusEffect: (callback: () => void) => {
      useEffect(() => callback(), [callback]);
    },
  };
});

const useSourcesMock = useSources as jest.MockedFunction<typeof useSources>;
const summaryMock = getRepositorySummary as jest.MockedFunction<
  typeof getRepositorySummary
>;

describe('SettingsScreen', () => {
  it('hosts the Repository section above the Device folders section', async () => {
    useSourcesMock.mockReturnValue({
      sources: [],
      loading: false,
      error: null,
      refresh: jest.fn(),
      add: jest.fn(),
      regrant: jest.fn(),
      remove: jest.fn(),
      dismissError: jest.fn(),
    });
    summaryMock.mockResolvedValue({
      contractVersion: 5,
      status: 'error',
      error: {
        code: 'REPOSITORY_NOT_CONFIGURED',
        message: 'No repository has been set up yet.',
        action: 'Set up your server in Settings › Repository.',
      },
    });

    render(
      <PaperProvider>
        <SettingsScreen />
      </PaperProvider>,
    );

    expect(
      await screen.findByLabelText('Repository not set up'),
    ).toBeOnTheScreen();
    const headers = screen.getAllByRole('header').map(h => h.props.children);
    expect(headers).toEqual(['Repository', 'Device folders']);
    expect(screen.getByTestId('sources.add')).toBeOnTheScreen();
    expect(
      screen.queryByText('Repository and folder settings will appear here.'),
    ).toBeNull();
  });
});
