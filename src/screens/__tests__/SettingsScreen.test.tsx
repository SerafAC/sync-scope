import React from 'react';
import {render, screen} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import {SettingsScreen} from '../SettingsScreen';
import {useSources} from '../../sources/useSources';

jest.mock('../../sources/useSources', () => ({useSources: jest.fn()}));

const useSourcesMock = useSources as jest.MockedFunction<typeof useSources>;

describe('SettingsScreen', () => {
  it('hosts the Folders section', () => {
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

    render(
      <PaperProvider>
        <SettingsScreen />
      </PaperProvider>,
    );

    expect(screen.getByRole('header', {name: 'Folders'})).toBeOnTheScreen();
    expect(screen.getByTestId('sources.add')).toBeOnTheScreen();
    expect(
      screen.queryByText('Repository and folder settings will appear here.'),
    ).toBeNull();
  });
});
