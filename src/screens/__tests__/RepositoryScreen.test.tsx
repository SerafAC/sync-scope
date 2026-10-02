import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';
import {PaperProvider} from 'react-native-paper';

import {
  approveSftpHostKey,
  getRepositorySummary,
  saveRepository,
  testRepository,
} from '../../native/CloudSync';
import type {
  OperationError,
  RepositorySummaryDto,
} from '../../native/CloudSyncContracts';
import {useScan, type ScanState} from '../../scan/useScan';
import {a11ySweep} from '../../test-utils/a11ySweep';
import {
  PASSWORD_STORED_HINT,
  RepositoryScreen,
  UNENCRYPTED_WARNING,
} from '../RepositoryScreen';

jest.mock('../../native/CloudSync', () => ({
  getRepositorySummary: jest.fn(),
  saveRepository: jest.fn(),
  testRepository: jest.fn(),
  approveSftpHostKey: jest.fn(),
  rejectSftpHostKey: jest.fn(),
}));

jest.mock('../../scan/useScan', () => ({useScan: jest.fn()}));

const summaryMock = getRepositorySummary as jest.MockedFunction<
  typeof getRepositorySummary
>;
const saveMock = saveRepository as jest.MockedFunction<typeof saveRepository>;
const testMock = testRepository as jest.MockedFunction<typeof testRepository>;
const approveMock = approveSftpHostKey as jest.MockedFunction<
  typeof approveSftpHostKey
>;
const useScanMock = useScan as jest.MockedFunction<typeof useScan>;

const SAVED: RepositorySummaryDto = {
  protocol: 'SFTP',
  host: 'nas.local',
  port: 2222,
  username: 'alice',
  remoteRoot: '/photos',
  precisionMillis: 1000,
  credentialPresent: true,
  hostKeyTrusted: true,
  revision: 2,
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

const OK = {contractVersion: 5, status: 'ok'} as const;

function connected(entryCount: number) {
  return {
    contractVersion: 5,
    status: 'ok' as const,
    connection: {
      protocol: 'SFTP' as const,
      reachable: true,
      entryCount,
      precisionMillis: 1000,
      precisionBasis: 'SFTP_V3_WHOLE_SECONDS',
      precisionPersisted: true,
    },
  };
}

function failure(
  code: string,
  extra: Partial<OperationError['error']> = {},
): OperationError {
  return {
    contractVersion: 5,
    status: 'error',
    error: {code, message: `${code} message`, action: null, ...extra},
  };
}

type BeforeRemoveListener = (event: {
  preventDefault: () => void;
  data: {action: {type: string}};
}) => void;

function fakeNavigation() {
  let beforeRemove: BeforeRemoveListener | null = null;
  const navigation = {
    addListener: jest.fn((type: string, listener: BeforeRemoveListener) => {
      if (type === 'beforeRemove') {
        beforeRemove = listener;
      }
      return () => {
        beforeRemove = null;
      };
    }),
    dispatch: jest.fn(),
  };
  const leave = () => {
    const event = {
      preventDefault: jest.fn(),
      data: {action: {type: 'GO_BACK'}},
    };
    act(() => beforeRemove?.(event));
    return event;
  };
  return {navigation, leave};
}

function scanState(isRunning = false): ScanState {
  return {
    run: null,
    active: null,
    interrupted: null,
    loading: false,
    error: null,
    isRunning,
    isStale: false,
    scan: jest.fn(),
    cancel: jest.fn(),
    refresh: jest.fn(),
    dismissError: jest.fn(),
  };
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;

async function renderScreen(
  summary: RepositorySummaryDto | null = null,
  options: {scanning?: boolean} = {},
) {
  summaryMock.mockResolvedValue(
    summary == null
      ? NOT_CONFIGURED
      : {contractVersion: 5, status: 'ok', repository: summary},
  );
  useScanMock.mockReturnValue(scanState(options.scanning));
  const {navigation, leave} = fakeNavigation();
  const result = render(
    <PaperProvider>
      <RepositoryScreen
        navigation={navigation as never}
        route={{key: 'repository', name: 'Repository'} as never}
      />
    </PaperProvider>,
  );
  await screen.findByLabelText('Save and test');
  return {...result, navigation, leave};
}

function typeInto(label: string, value: string) {
  fireEvent.changeText(screen.getByLabelText(label), value);
}

describe('RepositoryScreen', () => {
  beforeEach(() => {
    // clearAllMocks, not resetAllMocks: the safe-area mock from jest.setup.js must keep its implementation.
    jest.clearAllMocks();
    testMock.mockReset();
    appStateListener = null;
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((eventType, listener) => {
        if (eventType === 'change') {
          appStateListener = listener as (state: AppStateStatus) => void;
        }
        return {remove: jest.fn()};
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prefills every field except the password, and says a password is stored', async () => {
    await renderScreen(SAVED);

    expect(screen.getByLabelText('Host')).toHaveDisplayValue('nas.local');
    expect(screen.getByLabelText('Port')).toHaveDisplayValue('2222');
    expect(screen.getByLabelText('User name')).toHaveDisplayValue('alice');
    expect(screen.getByLabelText('Remote folder')).toHaveDisplayValue(
      '/photos',
    );
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
    expect(screen.getByText(PASSWORD_STORED_HINT)).toBeOnTheScreen();
    // A stored password means the form can be saved without typing one.
    expect(screen.getByLabelText('Save and test')).toBeEnabled();
  });

  it('starts empty for a new repository and needs every required field', async () => {
    await renderScreen(null);

    expect(screen.getByLabelText('Host')).toHaveDisplayValue('');
    expect(screen.queryByText(PASSWORD_STORED_HINT)).toBeNull();
    expect(screen.getByLabelText('Save and test')).toBeDisabled();

    typeInto('Host', 'nas.local');
    typeInto('User name', 'alice');
    typeInto('Remote folder', '/photos');
    expect(screen.getByLabelText('Save and test')).toBeDisabled();
    typeInto('Password', 'secret');
    expect(screen.getByLabelText('Save and test')).toBeEnabled();
  });

  it('shows the unencrypted warning for FTP and plain-HTTP WebDAV only', async () => {
    await renderScreen(null);

    expect(screen.queryByLabelText('Unencrypted connection warning')).toBeNull();

    fireEvent.press(screen.getByLabelText('Protocol FTP'));
    expect(
      screen.getByLabelText('Unencrypted connection warning'),
    ).toHaveTextContent(UNENCRYPTED_WARNING);
    expect(screen.queryByLabelText('Use HTTPS')).toBeNull();

    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));
    expect(screen.queryByLabelText('Unencrypted connection warning')).toBeNull();

    fireEvent(screen.getByLabelText('Use HTTPS'), 'valueChange', false);
    expect(
      screen.getByLabelText('Unencrypted connection warning'),
    ).toBeOnTheScreen();
  });

  it('turns HTTPS on by default for a new WebDAV setup, with the matching port placeholder', async () => {
    await renderScreen(null);

    expect(screen.getByLabelText('Port').props.placeholder).toBe('22');
    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));

    expect(screen.getByLabelText('Use HTTPS').props.value).toBe(true);
    expect(screen.getByLabelText('Port').props.placeholder).toBe('443');

    fireEvent(screen.getByLabelText('Use HTTPS'), 'valueChange', false);
    expect(screen.getByLabelText('Port').props.placeholder).toBe('80');

    fireEvent.press(screen.getByLabelText('Protocol FTP'));
    expect(screen.getByLabelText('Port').props.placeholder).toBe('21');
  });

  it('keeps a saved WebDAV repository on plain HTTP when it was saved that way', async () => {
    await renderScreen({...SAVED, protocol: 'WEBDAV', port: 80});

    expect(screen.getByLabelText('Use HTTPS').props.value).toBe(false);
    expect(
      screen.getByLabelText('Unencrypted connection warning'),
    ).toBeOnTheScreen();
  });

  it('sends the draft, the typed password and webdavHttps, then shows Connected', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(4));
    await renderScreen(null);

    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));
    typeInto('Host', ' nas.local ');
    typeInto('User name', 'alice');
    typeInto('Password', 'secret');
    typeInto('Remote folder', '/photos');
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(await screen.findByLabelText('Connected, 4 entries')).toBeOnTheScreen();
    expect(saveMock).toHaveBeenCalledWith(
      {
        protocol: 'WEBDAV',
        host: 'nas.local',
        port: null,
        username: 'alice',
        remoteRoot: '/photos',
        webdavHttps: true,
      },
      'secret',
    );
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('sends no password when one is stored and the field is empty', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));
    await renderScreen(SAVED);

    typeInto('Remote folder', '/other');
    fireEvent.press(screen.getByLabelText('Save and test'));

    await screen.findByLabelText('Connected, 1 entries');
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({port: 2222, remoteRoot: '/other', webdavHttps: false}),
      null,
    );
  });

  it('shows a field error under the field it names, not as a connection failure', async () => {
    saveMock.mockResolvedValue(
      failure('INVALID_QUERY', {
        message: 'The repository port is invalid: it must be a whole number from 1 to 65535.',
        field: 'port',
      }),
    );
    await renderScreen(SAVED);

    typeInto('Port', '70000');
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByText(
        'The repository port is invalid: it must be a whole number from 1 to 65535.',
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByText(/Connection failed/)).toBeNull();
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({port: 70000}),
      null,
    );
    expect(testMock).not.toHaveBeenCalled();
  });

  it('disables saving while a scan is running and says so', async () => {
    await renderScreen(SAVED, {scanning: true});

    expect(screen.getByText('A scan is running')).toBeOnTheScreen();
    expect(screen.getByLabelText('Save and test')).toBeDisabled();
  });

  it('shows progress while checking, then the timeout message with its action', async () => {
    saveMock.mockResolvedValue(OK);
    let finishTest: (value: OperationError) => void = () => {};
    testMock.mockReturnValue(new Promise(resolve => (finishTest = resolve)));
    await renderScreen(SAVED);

    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(await screen.findByLabelText('Checking connection')).toBeOnTheScreen();
    expect(screen.getByText('Connecting to the server…')).toBeOnTheScreen();
    expect(screen.getByLabelText('Save and test')).toBeDisabled();

    await act(async () =>
      finishTest(
        failure('CONNECTION_TIMEOUT', {
          message: 'The SFTP server did not respond in time.',
          action: 'Check the network and try again.',
        }),
      ),
    );

    expect(
      await screen.findByLabelText(
        'Connection failed: The SFTP server did not respond in time.',
      ),
    ).toBeOnTheScreen();
    expect(screen.getByText('Check the network and try again.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Checking connection')).toBeNull();
  });

  it('keeps the typed fields after a failure but empties the password', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(failure('AUTH_FAILED'));
    await renderScreen(null);

    typeInto('Host', 'nas.local');
    typeInto('User name', 'alice');
    typeInto('Password', 'wrong');
    typeInto('Remote folder', '/photos');
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('Connection failed: AUTH_FAILED message'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Host')).toHaveDisplayValue('nas.local');
    expect(screen.getByLabelText('User name')).toHaveDisplayValue('alice');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('asks before leaving with unsaved changes', async () => {
    const {navigation, leave} = await renderScreen(SAVED);

    typeInto('Host', 'other.local');
    const event = leave();

    expect(event.preventDefault).toHaveBeenCalled();
    expect(screen.getByLabelText('Discard changes')).toBeOnTheScreen();

    // Paper animates the dialog out, so its closing is not asserted here.
    fireEvent.press(screen.getByLabelText('Keep editing'));
    expect(navigation.dispatch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Host')).toHaveDisplayValue('other.local');

    leave();
    fireEvent.press(screen.getByLabelText('Discard changes'));
    expect(navigation.dispatch).toHaveBeenCalledWith({type: 'GO_BACK'});
    // The re-dispatched action is let through.
    expect(leave().preventDefault).not.toHaveBeenCalled();
  });

  it('treats a typed password as an unsaved change', async () => {
    const {leave} = await renderScreen(SAVED);

    typeInto('Password', 'new');

    expect(leave().preventDefault).toHaveBeenCalled();
  });

  it('leaves without asking when nothing changed', async () => {
    const {leave} = await renderScreen(SAVED);

    expect(leave().preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Discard changes')).toBeNull();
  });

  it('leaves without asking once the changes are saved', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));
    const {leave} = await renderScreen(SAVED);

    typeInto('Remote folder', '/other');
    summaryMock.mockResolvedValue({
      contractVersion: 5,
      status: 'ok',
      repository: {...SAVED, remoteRoot: '/other', revision: 3},
    });
    fireEvent.press(screen.getByLabelText('Save and test'));
    await screen.findByLabelText('Connected, 1 entries');
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2));

    expect(leave().preventDefault).not.toHaveBeenCalled();
  });

  it('asks to trust an unknown SFTP key and tests again after trusting', async () => {
    saveMock.mockResolvedValue(OK);
    testMock
      .mockResolvedValueOnce(
        failure('SFTP_HOST_KEY_UNVERIFIED', {
          hostKeyChallenge: {
            challengeId: 'c-1',
            host: 'nas.local',
            port: 2222,
            algorithm: 'ssh-ed25519',
            fingerprint: 'SHA256:abc',
            previousFingerprint: null,
          },
        }),
      )
      .mockResolvedValueOnce(connected(2));
    approveMock.mockResolvedValue(OK);
    await renderScreen(SAVED);

    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('Server key fingerprint SHA256:abc'),
    ).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Trust server key'));

    expect(await screen.findByLabelText('Connected, 2 entries')).toBeOnTheScreen();
    expect(approveMock).toHaveBeenCalledWith('c-1');
  });

  it('keeps the typed values but clears the password when the app goes to the background', async () => {
    await renderScreen(null);

    typeInto('Host', 'nas.local');
    typeInto('User name', 'alice');
    typeInto('Password', 'secret');
    act(() => appStateListener?.('background'));
    act(() => appStateListener?.('active'));

    expect(screen.getByLabelText('Host')).toHaveDisplayValue('nas.local');
    expect(screen.getByLabelText('User name')).toHaveDisplayValue('alice');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('labels every control', async () => {
    const result = await renderScreen(null);
    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));

    a11ySweep(result);
  });
});
