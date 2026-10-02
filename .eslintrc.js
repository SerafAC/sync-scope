module.exports = {
  root: true,
  extends: '@react-native',
  rules: {
    // Styles live in a StyleSheet (themed via useTheme() where colours are
    // needed), never inline (research R9).
    'react-native/no-inline-styles': 'error',
  },
};
