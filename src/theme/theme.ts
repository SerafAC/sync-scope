import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import {MD3DarkTheme, MD3LightTheme, type MD3Theme} from 'react-native-paper';

/** The Material 3 Paper theme for the system colour scheme. */
export function paperThemeFor(isDark: boolean): MD3Theme {
  return isDark ? MD3DarkTheme : MD3LightTheme;
}

/** The React Navigation theme, coloured from the Paper theme so both agree. */
export function navigationThemeFor(
  isDark: boolean,
  paperTheme: MD3Theme,
): NavigationTheme {
  return isDark
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
}
