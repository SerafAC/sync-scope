import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {Icon} from 'react-native-paper';

import {PlaceholderScreen} from '../screens/PlaceholderScreen';
import {SettingsScreen} from '../screens/SettingsScreen';

export type RootTabParamList = {
  Files: undefined;
  Scan: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

type PlaceholderTab = Exclude<keyof RootTabParamList, 'Settings'>;

const placeholderDescriptions: Record<PlaceholderTab, string> = {
  Files: 'File browsing will appear here after setup and a completed scan.',
  Scan: 'Scan controls and progress will appear here after setup.',
};

type TabBarIconProps = {
  color: string;
  size: number;
};

function makeTabBarIcon(
  source: string,
): (props: TabBarIconProps) => React.JSX.Element {
  return function TabBarIcon({color, size}: TabBarIconProps) {
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
      }}>
      {(Object.keys(placeholderDescriptions) as PlaceholderTab[]).map(name => (
        <Tab.Screen
          key={name}
          name={name}
          options={{tabBarIcon: tabBarIcons[name]}}>
          {() => (
            <PlaceholderScreen
              description={placeholderDescriptions[name]}
              title={name}
            />
          )}
        </Tab.Screen>
      ))}
      <Tab.Screen
        component={SettingsScreen}
        name="Settings"
        options={{tabBarIcon: tabBarIcons.Settings}}
      />
    </Tab.Navigator>
  );
}
