import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { PaperProvider, Text } from 'react-native-paper';

import { prepareLocalDeletion } from '../../native/CloudSync';
import { CLOUD_SYNC_CONTRACT_VERSION } from '../../native/CloudSyncContracts';
import { DeleteFlow } from '../DeleteFlow';

jest.mock('../../native/CloudSync', () => ({
  prepareLocalDeletion: jest.fn(),
  executeLocalDeletion: jest.fn(),
}));

const prepareMock = prepareLocalDeletion as jest.MockedFunction<
  typeof prepareLocalDeletion
>;

type Routes = { Home: undefined; Repository: undefined };
const Stack = createNativeStackNavigator<Routes>();

function Home(): React.JSX.Element {
  return (
    <DeleteFlow
      entryIds={['e-1']}
      onDeleted={jest.fn()}
      onDismiss={jest.fn()}
      snapshotId="snap-1"
      visible
    />
  );
}

function Repository(): React.JSX.Element {
  return <Text>Repository form</Text>;
}

/**
 * The app's real provider order: PaperProvider (and so its Portal host) wraps
 * the NavigationContainer, so the dialog renders outside the navigation tree.
 * Navigation is not mocked here; "Go there" must still find it.
 */
it('Go there in the error dialog navigates although the dialog is in a Portal', async () => {
  prepareMock.mockResolvedValue({
    contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
    status: 'error',
    error: {
      code: 'AUTH_FAILED',
      message: 'The server rejected the user name or password.',
      action: 'Check them in Settings › Repository.',
      conflictingSource: null,
    },
  });
  const navigation = createNavigationContainerRef<Routes>();
  render(
    <PaperProvider>
      <NavigationContainer ref={navigation}>
        <Stack.Navigator>
          <Stack.Screen component={Home} name="Home" />
          <Stack.Screen component={Repository} name="Repository" />
        </Stack.Navigator>
      </NavigationContainer>
    </PaperProvider>,
  );

  fireEvent.press(await screen.findByLabelText('Go there'));

  expect(await screen.findByText('Repository form')).toBeOnTheScreen();
  expect(navigation.getCurrentRoute()?.name).toBe('Repository');
});
