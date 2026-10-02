import React from 'react';
import { StatusBar, useColorScheme } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import MaterialDesignIcons from '@react-native-vector-icons/material-design-icons';

import { AppNavigator } from './src/navigation/AppNavigator';
import { ScanProvider } from './src/scan/ScanProvider';
import { navigationThemeFor, paperThemeFor } from './src/theme/theme';

// pnpm's isolated layout keeps optional peers out of Paper's require path, so
// Paper receives its Material Design icon renderer explicitly instead of
// resolving '@react-native-vector-icons/material-design-icons' itself.
type PaperSettings = NonNullable<
  React.ComponentProps<typeof PaperProvider>['settings']
>;
type GlyphName = React.ComponentProps<typeof MaterialDesignIcons>['name'];

const paperSettings: PaperSettings = {
  icon: ({ name, color, size }) => (
    <MaterialDesignIcons color={color} name={name as GlyphName} size={size} />
  ),
};

function App(): React.JSX.Element {
  const isDarkMode = useColorScheme() === 'dark';
  const paperTheme = paperThemeFor(isDarkMode);
  const navigationTheme = navigationThemeFor(isDarkMode, paperTheme);

  return (
    <SafeAreaProvider>
      <PaperProvider settings={paperSettings} theme={paperTheme}>
        <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
        <ScanProvider>
          <NavigationContainer theme={navigationTheme}>
            <AppNavigator />
          </NavigationContainer>
        </ScanProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

export default App;
