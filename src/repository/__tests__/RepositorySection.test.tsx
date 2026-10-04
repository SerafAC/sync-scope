import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import {getRepositorySummary} from '../../native/CloudSync';
import type {
  OperationError,
  RepositorySummaryDto,
} from '../../native/CloudSyncContracts';
import {a11ySweep} from '../../test-utils/a11ySweep';
import {RepositorySection} from '../RepositorySection';

const mockNavigate = jest.fn();
// The latest focus callback, so a test can simulate the tab gaining focus again.
let mockFocusCallback: (() => void) | null = null;

jest.mock('@react-navigation/native', () => {
  const {useEffect} = jest.requireActual<typeof import('react')>('react');
  return {
    useNavigation: () => ({navigate: mockNavigate}),
    useFocusEffect: (callback: () => void) => {
      mockFocusCallback = callback;
      useEffect(() => callback(), [callback]);
    },
  };
});

jest.mock('../../native/CloudSync', () => ({getRepositorySummary: jest.fn()}));

const summaryMock = getRepositorySummary as jest.MockedFunction<
  typeof getRepositorySummary
>;

const SAVED: RepositorySummaryDto = {
  protocol: 'SFTP',
  host: '10.0.2.2',
  port: 2222,
  username: 'alice',
  remoteRoot: '/photos',
  precisionMillis: 1000,
  credentialPresent: true,
  hostKeyTrusted: true,
  revision: 1,
  webdavHttps: false,
};

const NOT_CONFIGURED: OperationError = {
  contractVersion: 5,
  status: 'error',
  error: {
    code: 'REPOSITORY_NOT_CONFIGURED',
    message: 'No repository has been set up yet.',
    action: 'Set up your server in Settings › Repository.',
  },
};

function ok(repository: RepositorySummaryDto) {
  return {contractVersion: 5, status: 'ok' as const, repository};
}

function renderSection() {
  return render(
    <PaperProvider>
      <RepositorySection />
    </PaperProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocusCallback = null;
});

describe('RepositorySection', () => {
  it('shows "not set up" and opens the form from Set up repository', async () => {
    summaryMock.mockResolvedValue(NOT_CONFIGURED);
    renderSection();

    expect(
      await screen.findByLabelText('Repository not set up'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Edit repository')).toBeNull();

    fireEvent.press(screen.getByLabelText('Set up repository'));
    expect(mockNavigate).toHaveBeenCalledWith('Repository');
  });

  it('summarises a saved repository with a stored password', async () => {
    summaryMock.mockResolvedValue(ok(SAVED));
    renderSection();

    expect(
      await screen.findByLabelText('Repository SFTP 10.0.2.2'),
    ).toBeOnTheScreen();
    expect(screen.getByText('User alice')).toBeOnTheScreen();
    expect(screen.getByText('Folder /photos')).toBeOnTheScreen();
    expect(screen.getByText('Password stored')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Set up repository')).toBeNull();

    fireEvent.press(screen.getByLabelText('Edit repository'));
    expect(mockNavigate).toHaveBeenCalledWith('Repository');
  });

  it('says a password is needed when none is stored', async () => {
    summaryMock.mockResolvedValue(
      ok({...SAVED, protocol: 'WEBDAV', credentialPresent: false}),
    );
    renderSection();

    expect(
      await screen.findByLabelText('Repository WebDAV 10.0.2.2'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Password needed')).toBeOnTheScreen();
  });

  it('shows another error under "not set up"', async () => {
    summaryMock.mockResolvedValue({
      contractVersion: 5,
      status: 'error',
      error: {code: 'INTERNAL_ERROR', message: 'Something broke.', action: null},
    } as OperationError);
    renderSection();

    expect(
      await screen.findByLabelText('Repository not set up'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Something broke.')).toBeOnTheScreen();
  });

  it('reads the summary again when the screen gains focus', async () => {
    summaryMock.mockResolvedValueOnce(NOT_CONFIGURED);
    renderSection();
    expect(
      await screen.findByLabelText('Repository not set up'),
    ).toBeOnTheScreen();

    summaryMock.mockResolvedValueOnce(ok(SAVED));
    await act(async () => {
      mockFocusCallback?.();
    });

    expect(
      await screen.findByLabelText('Repository SFTP 10.0.2.2'),
    ).toBeOnTheScreen();
    expect(summaryMock).toHaveBeenCalledTimes(2);
  });

  it('labels every control when not set up and when set up', async () => {
    summaryMock.mockResolvedValueOnce(NOT_CONFIGURED);
    const result = renderSection();
    await screen.findByLabelText('Set up repository');
    a11ySweep(result);

    summaryMock.mockResolvedValueOnce(ok(SAVED));
    await act(async () => {
      mockFocusCallback?.();
    });
    await screen.findByLabelText('Edit repository');
    a11ySweep(result);
  });
});
