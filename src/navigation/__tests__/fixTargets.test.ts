import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import {CloudSyncErrorCode} from '../../native/CloudSyncContracts';
import {GoThereButton, fixTargetFor} from '../fixTargets';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({navigate: mockNavigate}),
}));

/** Research R5: the one table from an error code to the place that fixes it. */
const EXPECTED: Record<string, 'Repository' | 'Settings'> = {
  REPOSITORY_NOT_CONFIGURED: 'Repository',
  CREDENTIAL_UNAVAILABLE: 'Repository',
  AUTH_FAILED: 'Repository',
  TLS_UNTRUSTED: 'Repository',
  SFTP_HOST_KEY_UNVERIFIED: 'Repository',
  SFTP_HOST_KEY_CHANGED: 'Repository',
  NO_SOURCES_SELECTED: 'Settings',
  GRANT_REVOKED: 'Settings',
};

function renderButton(code: string | null | undefined, onGo?: () => void) {
  return render(
    React.createElement(
      PaperProvider,
      null,
      React.createElement(GoThereButton, {code, onGo}),
    ),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('fixTargetFor', () => {
  it.each(Object.entries(EXPECTED))('maps %s to %s', (code, target) => {
    expect(fixTargetFor(code)).toBe(target);
  });

  it('maps every other contract error code to null', () => {
    const others = Object.values(CloudSyncErrorCode).filter(
      code => !(code in EXPECTED),
    );
    expect(others.length).toBeGreaterThan(0);
    for (const code of others) {
      expect(fixTargetFor(code)).toBeNull();
    }
  });

  it('maps unknown, empty and missing codes to null', () => {
    expect(fixTargetFor('SOMETHING_NEW')).toBeNull();
    expect(fixTargetFor('')).toBeNull();
    expect(fixTargetFor(null)).toBeNull();
    expect(fixTargetFor(undefined)).toBeNull();
  });
});

describe('GoThereButton', () => {
  it('navigates to the Repository form for a repository error', () => {
    renderButton('AUTH_FAILED');

    fireEvent.press(screen.getByLabelText('Go there'));

    expect(mockNavigate).toHaveBeenCalledWith('Repository');
  });

  it('navigates to Settings for a folder error', () => {
    renderButton('NO_SOURCES_SELECTED');

    fireEvent.press(screen.getByLabelText('Go there'));

    expect(mockNavigate).toHaveBeenCalledWith('Settings');
  });

  it('calls onGo after navigating', () => {
    const onGo = jest.fn();
    renderButton('REPOSITORY_NOT_CONFIGURED', onGo);

    fireEvent.press(screen.getByLabelText('Go there'));

    expect(mockNavigate).toHaveBeenCalledWith('Repository');
    expect(onGo).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a code without a target', () => {
    renderButton('CONNECTION_TIMEOUT');

    expect(screen.queryByLabelText('Go there')).toBeNull();
  });

  it('renders nothing without a code', () => {
    renderButton(null);

    expect(screen.queryByLabelText('Go there')).toBeNull();
  });
});
