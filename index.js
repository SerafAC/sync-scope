/**
 * @format
 */

import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

if (__DEV__) {
  // Debug builds only (LogBox does not exist in release). Android 15+ cuts the
  // network of an app in the background, so opening the system folder picker
  // drops the Metro websocket and the JS runtime warns "Cannot connect to
  // Metro" while it silently reconnects. On edge-to-edge screens the warning
  // toast's container covers the bottom tab bar and swallows taps on it, which
  // broke the e2e flows on API 36 (T050). The reconnect needs no user action.
  LogBox.ignoreLogs(['Cannot connect to Metro']);
}

AppRegistry.registerComponent(appName, () => App);
