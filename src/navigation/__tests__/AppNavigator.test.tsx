import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import {
  NavigationContainer,
  createNavigationContainerRef,
  type RouteProp,
} from '@react-navigation/native';
import { PaperProvider, Text } from 'react-native-paper';

import { useFiles } from '../../files/useFiles';
import { ScanContext, type ScanState } from '../../scan/useScan';
import { useSelection } from '../../selection/SelectionProvider';
import {
  AppNavigator,
  type PreviewParams,
  type RootStackParamList,
} from '../AppNavigator';

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(() => new Promise(() => {})),
  setBrowsePreferences: jest.fn(),
}));

// The screens are stubs: this test is about the routes, not the screens.
jest.mock('../../screens/FilesScreen', () => ({
  FilesScreen: () => {
    const { Text: PaperText } = jest.requireActual('react-native-paper');
    return <PaperText>Files screen</PaperText>;
  },
}));
jest.mock('../../screens/ScanScreen', () => ({ ScanScreen: () => null }));
jest.mock('../../screens/SettingsScreen', () => ({
  SettingsScreen: () => null,
}));
jest.mock('../../screens/RepositoryScreen', () => ({
  RepositoryScreen: () => null,
}));
jest.mock('../../screens/PreviewScreen', () => ({
  PreviewScreen: ({
    route,
  }: {
    route: RouteProp<RootStackParamList, 'Preview'>;
  }) => <MockPreview params={route.params} />,
}));

/** Reads the shared Files and selection state: they must be provided above the stack. */
function MockPreview({ params }: { params: PreviewParams }): React.JSX.Element {
  const { view } = useFiles();
  const { isSelecting } = useSelection();
  return (
    <Text>
      {`Preview ${params.name} ${params.mimeType} ${params.status} ${params.sizeBytes} ${view} ${isSelecting}`}
    </Text>
  );
}

const SCAN: ScanState = {
  run: null,
  active: null,
  interrupted: null,
  loading: false,
  error: null,
  isRunning: false,
  isStale: false,
  scan: jest.fn(),
  cancel: jest.fn(),
  refresh: jest.fn(),
  dismissError: jest.fn(),
};

const PARAMS: PreviewParams = {
  snapshotId: 'snap-1',
  entryId: 'e-1',
  name: 'Loose.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 2048,
  status: 'SYNCED',
};

function renderApp() {
  const navigation = createNavigationContainerRef<RootStackParamList>();
  render(
    <PaperProvider>
      <ScanContext.Provider value={SCAN}>
        <NavigationContainer ref={navigation}>
          <AppNavigator />
        </NavigationContainer>
      </ScanContext.Provider>
    </PaperProvider>,
  );
  return navigation;
}

describe('AppNavigator', () => {
  it('opens on the tabs', async () => {
    const navigation = renderApp();

    expect(await screen.findByText('Files screen')).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('Files');
  });

  it('pushes the Preview stack screen above the tabs with its params', async () => {
    const navigation = renderApp();
    await screen.findByText('Files screen');

    act(() => navigation.navigate('Preview', PARAMS));

    expect(
      await screen.findByText(
        'Preview Loose.jpg image/jpeg SYNCED 2048 GALLERY false',
      ),
    ).toBeOnTheScreen();
    const route = navigation.getCurrentRoute();
    expect(route?.name).toBe('Preview');
    expect(route?.params).toEqual(PARAMS);
    // Above the tabs: the stack's root holds Tabs below Preview.
    expect(navigation.getRootState()?.routes.map(r => r.name)).toEqual([
      'Tabs',
      'Preview',
    ]);

    act(() => navigation.goBack());
    expect(await screen.findByText('Files screen')).toBeOnTheScreen();
    expect(navigation.getCurrentRoute()?.name).toBe('Files');
  });

  it('types the Preview params (data-model "Preview route params")', () => {
    const params: RootStackParamList['Preview'] = {
      snapshotId: 's',
      entryId: 'e',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: null,
      status: 'UNKNOWN',
    };
    // @ts-expect-error every field is required, here `status` is missing.
    const missing: RootStackParamList['Preview'] = {
      snapshotId: 's',
      entryId: 'e',
      name: 'clip.mp4',
      mimeType: 'video/mp4',
      sizeBytes: null,
    };
    const wrongStatus: RootStackParamList['Preview'] = {
      ...params,
      // @ts-expect-error a status is one of the FileStatus values.
      status: 'DELETED',
    };
    expect([params, missing, wrongStatus]).toHaveLength(3);
  });
});
