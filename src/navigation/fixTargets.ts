import React from 'react';
import {Button} from 'react-native-paper';
import {useNavigation, type NavigationProp} from '@react-navigation/native';

import type {RootStackParamList, RootTabParamList} from './AppNavigator';

/** A place in the app where the user fixes what an error is about. */
export type FixTarget = 'Repository' | 'Settings';

/**
 * Research R5: native code owns the message text (D011); this table alone maps an
 * error code to the place that fixes it, so error surfaces can offer "Go there"
 * (FR-006). `GRANT_REVOKED` is a source availability and skip reason rather than
 * an operation error code, and is mapped here so a skipped folder leads to Settings.
 */
const FIX_TARGETS: Readonly<Record<string, FixTarget>> = {
  REPOSITORY_NOT_CONFIGURED: 'Repository',
  CREDENTIAL_UNAVAILABLE: 'Repository',
  AUTH_FAILED: 'Repository',
  TLS_UNTRUSTED: 'Repository',
  SFTP_HOST_KEY_UNVERIFIED: 'Repository',
  SFTP_HOST_KEY_CHANGED: 'Repository',
  NO_SOURCES_SELECTED: 'Settings',
  GRANT_REVOKED: 'Settings',
};

/** The place that fixes [code], or null when the user has nowhere to go. */
export function fixTargetFor(code: string | null | undefined): FixTarget | null {
  if (code == null || !Object.prototype.hasOwnProperty.call(FIX_TARGETS, code)) {
    return null;
  }
  return FIX_TARGETS[code] ?? null;
}

/** The routes a fix target names: the stacked Repository form and the Settings tab. */
type FixTargetParamList = Pick<RootStackParamList, 'Repository'> &
  Pick<RootTabParamList, 'Settings'>;

/**
 * "Go there": shown next to an error whose code has a fix target, and nothing
 * otherwise. Rendered inside a tab, so `Repository` resolves in the parent stack.
 * [onGo] runs after navigating (for example to dismiss the error); [textColor]
 * fits the button to a dark surface such as a snackbar.
 */
export function GoThereButton({
  code,
  onGo,
  textColor,
}: {
  code: string | null | undefined;
  onGo?: () => void;
  textColor?: string;
}): React.JSX.Element | null {
  const navigation = useNavigation<NavigationProp<FixTargetParamList>>();
  const target = fixTargetFor(code);
  if (target == null) {
    return null;
  }
  return React.createElement(Button, {
    accessibilityLabel: 'Go there',
    children: 'Go there',
    icon: 'arrow-right',
    mode: 'text',
    onPress: () => {
      navigation.navigate(target);
      onGo?.();
    },
    textColor,
  });
}
