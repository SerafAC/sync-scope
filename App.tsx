import React from 'react';
import {StatusBar, useColorScheme} from 'react-native';
import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  NavigationContainer,
} from '@react-navigation/native';
import {
  MD3DarkTheme,
  MD3LightTheme,
  PaperProvider,
} from 'react-native-paper';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {AppNavigator} from './src/navigation/AppNavigator';

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const paperTheme = isDarkMode ? MD3DarkTheme : MD3LightTheme;
  const navigationTheme = isDarkMode
    ? {
        ...NavigationDarkTheme,
        colors: {
          ...NavigationDarkTheme.colors,
          background: paperTheme.colors.background,
          card: paperTheme.colors.surface,
          primary: paperTheme.colors.primary,
          text: paperTheme.colors.onSurface,
        },
      }
    : {
        ...NavigationDefaultTheme,
        colors: {
          ...NavigationDefaultTheme.colors,
          background: paperTheme.colors.background,
          card: paperTheme.colors.surface,
          primary: paperTheme.colors.primary,
          text: paperTheme.colors.onSurface,
        },
      };

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <NavigationContainer theme={navigationTheme}>
          <AppNavigator />
        </NavigationContainer>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

export default App;
