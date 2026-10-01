import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Icon } from 'react-native-paper';

import { PlaceholderScreen } from '../screens/PlaceholderScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootTabParamList = {
  Files: undefined;
  Scan: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const filesPlaceholderDescription =
  'File browsing will appear here after setup and a completed scan.';

function FilesScreen(): React.JSX.Element {
  return (
    <PlaceholderScreen
      description={filesPlaceholderDescription}
      title="Files"
    />
  );
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

export function AppNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Files"
      screenOptions={{
        headerTitle: 'SyncScope',
        tabBarLabelPosition: 'below-icon',
      }}
    >
      <Tab.Screen
        component={FilesScreen}
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
