import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useIsFocused } from '@react-navigation/native';
import { Icon } from 'react-native-paper';

import { FilesProvider } from '../files/FilesProvider';
import { FilesScreen } from '../screens/FilesScreen';
import { ScanScreen } from '../screens/ScanScreen';
import { SettingsScreen } from '../screens/SettingsScreen';

export type RootTabParamList = {
  Files: undefined;
  Scan: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

/** The Files tab: its view and filter live as long as the tab is mounted. */
function FilesTab(): React.JSX.Element {
  const focused = useIsFocused();
  return (
    <FilesProvider>
      <FilesScreen focused={focused} />
    </FilesProvider>
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
