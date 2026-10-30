import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Icon } from 'react-native-paper';

import { FilesProvider } from '../files/FilesProvider';
import type { FileStatus } from '../native/CloudSyncContracts';
import { FilesScreen } from '../screens/FilesScreen';
import { PreviewScreen } from '../screens/PreviewScreen';
import { RepositoryScreen } from '../screens/RepositoryScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { SelectionProvider } from '../selection/SelectionProvider';

export type RootTabParamList = {
  Files: undefined;
  Scan: undefined;
  Settings: undefined;
};

/**
 * The preview's params (009 data-model "Preview route params", research R8),
 * taken from the tapped row so the preview renders at once.
 */
export type PreviewParams = {
  snapshotId: string;
  entryId: string;
  name: string;
  mimeType: string;
  sizeBytes: number | null;
  status: FileStatus;
};

/**
 * The root stack (research R1): the bottom tabs, with the Repository form pushed
 * above them so back handling and the discard prompt come from the stack, and
 * the image and video preview (009 research R8) above the Files tab.
 */
export type RootStackParamList = {
  Tabs: undefined;
  Repository: undefined;
  Preview: PreviewParams;
};

const Tab = createBottomTabNavigator<RootTabParamList>();
const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * The Files tab. Its view, filter and selection are provided above the root
 * stack, so the preview pushed above the tabs shares them (009 research R11).
 */
function FilesTab(): React.JSX.Element {
  const focused = useIsFocused();
  return <FilesScreen focused={focused} />;
}

type TabBarIconProps = {
  color: string;
  size: number;
};

function makeTabBarIcon(
  source: string,
): (props: TabBarIconProps) => React.JSX.Element {
  return function TabBarIcon({ color, size }: TabBarIconProps) {
    return <Icon color={color} size={size} source={source} />;
  };
}

const tabBarIcons: Record<
  keyof RootTabParamList,
  (props: TabBarIconProps) => React.JSX.Element
> = {
  Files: makeTabBarIcon('folder-outline'),
  Scan: makeTabBarIcon('radar'),
  Settings: makeTabBarIcon('cog-outline'),
};

function TabsNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Files"
      screenOptions={{
        headerTitle: 'SyncScope',
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tab.Screen
        component={FilesTab}
        name="Files"
        options={{ tabBarIcon: tabBarIcons.Files }}
      />
      <Tab.Screen
        component={ScanScreen}
        name="Scan"
        options={{ tabBarIcon: tabBarIcons.Scan }}
      />
      <Tab.Screen
        component={SettingsScreen}
        name="Settings"
        options={{ tabBarIcon: tabBarIcons.Settings }}
      />
    </Tab.Navigator>
  );
}

export function AppNavigator(): React.JSX.Element {
  return (
    <FilesProvider>
      <SelectionProvider>
        <Stack.Navigator initialRouteName="Tabs">
          <Stack.Screen
            component={TabsNavigator}
            name="Tabs"
            options={{ headerShown: false }}
          />
          <Stack.Screen
            component={RepositoryScreen}
            name="Repository"
            options={{ title: 'Repository' }}
          />
          <Stack.Screen
            component={PreviewScreen}
            name="Preview"
            options={{ headerShown: false }}
          />
        </Stack.Navigator>
      </SelectionProvider>
    </FilesProvider>
  );
}
