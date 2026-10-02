import {
  DarkTheme as NavigationDarkTheme,
  DefaultTheme as NavigationDefaultTheme,
} from '@react-navigation/native';
import {MD3DarkTheme, MD3LightTheme} from 'react-native-paper';

import {density, gridColumns, spacing} from '../spacing';
import {navigationThemeFor, paperThemeFor} from '../theme';

describe('paperThemeFor', () => {
  it('picks the MD3 theme for the colour scheme', () => {
    expect(paperThemeFor(true)).toBe(MD3DarkTheme);
    expect(paperThemeFor(false)).toBe(MD3LightTheme);
  });
});

describe('navigationThemeFor', () => {
  it.each([
    ['dark', true, NavigationDarkTheme],
    ['light', false, NavigationDefaultTheme],
  ])(
    'colours the %s navigation theme from the paper theme',
    (_, isDark, base) => {
      const paper = paperThemeFor(isDark);
      const nav = navigationThemeFor(isDark, paper);

      expect(nav.dark).toBe(base.dark);
      expect(nav.fonts).toBe(base.fonts);
      expect(nav.colors.background).toBe(paper.colors.background);
      expect(nav.colors.card).toBe(paper.colors.surface);
      expect(nav.colors.primary).toBe(paper.colors.primary);
      expect(nav.colors.text).toBe(paper.colors.onSurface);
      expect(nav.colors.border).toBe(base.colors.border);
      expect(nav.colors.notification).toBe(base.colors.notification);
    },
  );
});

describe('spacing tokens', () => {
  it('match the design scale', () => {
    expect(spacing).toEqual({xs: 4, sm: 8, md: 12, lg: 16, xl: 24});
    expect(density).toEqual({tileGap: 2, rowHeight: 56, chipHeight: 32});
    expect(gridColumns).toBe(3);
  });
});
