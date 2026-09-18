import React from 'react';
import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';

import {PlaceholderScreen} from '../screens/PlaceholderScreen';

export type RootTabParamList = {
  Files: undefined;
  Scan: undefined;
  Settings: undefined;
};

const Tab = createBottomTabNavigator<RootTabParamList>();

const descriptions: Record<keyof RootTabParamList, string> = {
  Files: 'File browsing will appear here after setup and a completed scan.',
  Scan: 'Scan controls and progress will appear here after setup.',
  Settings: 'Repository and folder settings will appear here.',
};

export function AppNavigator(): React.JSX.Element {
  return (
    <Tab.Navigator
      initialRouteName="Files"
      screenOptions={{
        headerTitle: 'SyncScope',
        tabBarLabelPosition: 'below-icon',
      }}>
      {(Object.keys(descriptions) as Array<keyof RootTabParamList>).map(name => (
        <Tab.Screen key={name} name={name}>
          {() => (
            <PlaceholderScreen
              description={descriptions[name]}
              title={name}
            />
          )}
        </Tab.Screen>
      ))}
    </Tab.Navigator>
  );
}
