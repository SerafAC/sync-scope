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
  LogBox.ignoreLogs(['Cannot connect to Metro', 'Disconnected from Metro']);

  // The same drop also makes HMRClient show its "Fast Refresh disconnected.
  // Reload app to reconnect." banner: a native PopupWindow under the status
  // bar that covers the top bar, takes the next tap anywhere on it to dismiss
  // itself, and is invisible to Maestro. The first tap on "Select all" or ✕
  // was lost to it on API 36 (decisions.md, 2026-10-08). Only that message is
  // dropped; a reload after the picker still restores Fast Refresh. RN warns
  // about the deep import at runtime, and its LogBox toast would cover the tab
  // bar the same way, so that one warning is ignored too.
  LogBox.ignoreLogs([
    "Deep imports from the 'react-native' package are deprecated ('react-native/Libraries/Utilities/DevLoadingView')",
  ]);
  const DevLoadingView =
    // eslint-disable-next-line @react-native/no-deep-imports -- debug-only patch of RN's dev banner
    require('react-native/Libraries/Utilities/DevLoadingView').default;
  const showMessage = DevLoadingView.showMessage;
  DevLoadingView.showMessage = (message, type, options) => {
    if (message.startsWith('Fast Refresh disconnected')) {
      return;
    }
    showMessage.call(DevLoadingView, message, type, options);
  };
}

AppRegistry.registerComponent(appName, () => App);
