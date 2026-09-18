module.exports = {
  preset: '@react-native/jest-preset',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  transformIgnorePatterns: [
    'node_modules/.pnpm/(?!(?:@react-native\\+.*|@react-navigation\\+.*|react-native@|react-native-paper@|react-native-safe-area-context@|react-native-screens@))',
    'node_modules/(?!\\.pnpm|(?:@react-native|@react-navigation|react-native|react-native-paper|react-native-safe-area-context|react-native-screens)/)',
  ],
};
