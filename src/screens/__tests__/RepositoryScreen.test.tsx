import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { PaperProvider } from 'react-native-paper';

import {
  approveSftpHostKey,
  browseRemoteFolders,
  getRepositorySummary,
  saveRepository,
  testRepository,
} from '../../native/CloudSync';
import type {
  OperationError,
  RepositoryFolderResultDto,
  RepositorySummaryDto,
} from '../../native/CloudSyncContracts';
import { useScan, type ScanState } from '../../scan/useScan';
import { a11ySweep } from '../../test-utils/a11ySweep';
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
  browseRemoteFolders: jest.fn(),
}));

jest.mock('../../scan/useScan', () => ({ useScan: jest.fn() }));

const summaryMock = getRepositorySummary as jest.MockedFunction<
  typeof getRepositorySummary
>;
const saveMock = saveRepository as jest.MockedFunction<typeof saveRepository>;
const testMock = testRepository as jest.MockedFunction<typeof testRepository>;
const approveMock = approveSftpHostKey as jest.MockedFunction<
  typeof approveSftpHostKey
>;
const browseMock = browseRemoteFolders as jest.MockedFunction<
  typeof browseRemoteFolders
>;
const useScanMock = useScan as jest.MockedFunction<typeof useScan>;

const SAVED: RepositorySummaryDto = {
  protocol: 'SFTP',
  host: 'nas.local',
  port: 2222,
  username: 'alice',
  remoteRoots: ['/photos'],
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

const OK = { contractVersion: 5, status: 'ok' } as const;

function connected(
  entryCount: number,
  folders: RepositoryFolderResultDto[] = [
    { path: '/photos', entryCount, error: null },
  ],
) {
  return {
    contractVersion: 6,
    status: 'ok' as const,
    connection: {
      protocol: 'SFTP' as const,
      reachable: true,
      entryCount,
      folders,
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
    error: { code, message: `${code} message`, action: null, ...extra },
  };
}

type BeforeRemoveListener = (event: {
  preventDefault: () => void;
  data: { action: { type: string } };
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
      data: { action: { type: 'GO_BACK' } },
    };
    act(() => beforeRemove?.(event));
    return event;
  };
  return { navigation, leave };
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
  options: { scanning?: boolean } = {},
) {
  summaryMock.mockResolvedValue(
    summary == null
      ? NOT_CONFIGURED
      : { contractVersion: 5, status: 'ok', repository: summary },
  );
  useScanMock.mockReturnValue(scanState(options.scanning));
  const { navigation, leave } = fakeNavigation();
  const result = render(
    <PaperProvider>
      <RepositoryScreen
        navigation={navigation as never}
        route={{ key: 'repository', name: 'Repository' } as never}
      />
    </PaperProvider>,
  );
  await screen.findByLabelText('Save and test');
  return { ...result, navigation, leave };
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
        return { remove: jest.fn() };
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
    expect(screen.getByLabelText('Remote folder 1')).toHaveDisplayValue(
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
    typeInto('Remote folder 1', '/photos');
    expect(screen.getByLabelText('Save and test')).toBeDisabled();
    typeInto('Password', 'secret');
    expect(screen.getByLabelText('Save and test')).toBeEnabled();
  });

  it('shows the unencrypted warning for FTP and plain-HTTP WebDAV only', async () => {
    await renderScreen(null);

    expect(
      screen.queryByLabelText('Unencrypted connection warning'),
    ).toBeNull();

    fireEvent.press(screen.getByLabelText('Protocol FTP'));
    expect(
      screen.getByLabelText('Unencrypted connection warning'),
    ).toHaveTextContent(UNENCRYPTED_WARNING);
    expect(screen.queryByLabelText('Use HTTPS')).toBeNull();

    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));
    expect(
      screen.queryByLabelText('Unencrypted connection warning'),
    ).toBeNull();

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
    await renderScreen({ ...SAVED, protocol: 'WEBDAV', port: 80 });

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
    typeInto('Remote folder 1', '/photos');
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('/photos: 4 entries'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Connected')).toBeOnTheScreen();
    expect(saveMock).toHaveBeenCalledWith(
      {
        protocol: 'WEBDAV',
        host: 'nas.local',
        port: null,
        username: 'alice',
        remoteRoots: ['/photos'],
        webdavHttps: true,
      },
      'secret',
    );
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('fills the other fields from a URL typed into Host when it loses focus', async () => {
    await renderScreen(null);

    typeInto('Port', '22');
    typeInto('Host', 'https://alice@cloud.example.com/remote.php/dav/');
    fireEvent(screen.getByLabelText('Host'), 'blur');

    expect(screen.getByLabelText('Host')).toHaveDisplayValue(
      'cloud.example.com/remote.php/dav',
    );
    expect(screen.getByLabelText('Use HTTPS').props.value).toBe(true);
    // The protocol changed and the URL named no port, so the default applies.
    expect(screen.getByLabelText('Port')).toHaveDisplayValue('');
    expect(screen.getByLabelText('Port').props.placeholder).toBe('443');
    expect(screen.getByLabelText('User name')).toHaveDisplayValue('alice');
    expect(screen.getByLabelText('Remote folder 1')).toHaveDisplayValue('');
  });

  it('splits a URL in Host on save even if the field never lost focus', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(2));
    await renderScreen(null);

    typeInto('User name', 'alice');
    typeInto('Password', 'secret');
    typeInto('Host', 'ftp://nas.local:2121/photos');
    // The folder comes from the URL, so saving is already allowed.
    expect(screen.getByLabelText('Save and test')).toBeEnabled();
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('/photos: 2 entries'),
    ).toBeOnTheScreen();
    expect(saveMock).toHaveBeenCalledWith(
      {
        protocol: 'FTP',
        host: 'nas.local',
        port: 2121,
        username: 'alice',
        remoteRoots: ['/photos'],
        webdavHttps: false,
      },
      'secret',
    );
    expect(screen.getByLabelText('Host')).toHaveDisplayValue('nas.local');
  });

  it('sends no password when one is stored and the field is empty', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));
    await renderScreen(SAVED);

    typeInto('Remote folder 1', '/other');
    fireEvent.press(screen.getByLabelText('Save and test'));

    await screen.findByLabelText('/photos: 1 entries');
    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 2222,
        remoteRoots: ['/other'],
        webdavHttps: false,
      }),
      null,
    );
  });

  it('shows a field error under the field it names, not as a connection failure', async () => {
    saveMock.mockResolvedValue(
      failure('INVALID_QUERY', {
        message:
          'The repository port is invalid: it must be a whole number from 1 to 65535.',
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
      expect.objectContaining({ port: 70000 }),
      null,
    );
    expect(testMock).not.toHaveBeenCalled();
  });

  it('disables saving while a scan is running and says so', async () => {
    await renderScreen(SAVED, { scanning: true });

    expect(screen.getByText('A scan is running')).toBeOnTheScreen();
    expect(screen.getByLabelText('Save and test')).toBeDisabled();
  });

  it('shows progress while checking, then the timeout message with its action', async () => {
    saveMock.mockResolvedValue(OK);
    let finishTest: (value: OperationError) => void = () => {};
    testMock.mockReturnValue(new Promise(resolve => (finishTest = resolve)));
    await renderScreen(SAVED);

    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('Checking connection'),
    ).toBeOnTheScreen();
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
    expect(
      screen.getByText('Check the network and try again.'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Checking connection')).toBeNull();
  });

  it('keeps the typed fields after a failure but empties the password', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(failure('AUTH_FAILED'));
    await renderScreen(null);

    typeInto('Host', 'nas.local');
    typeInto('User name', 'alice');
    typeInto('Password', 'wrong');
    typeInto('Remote folder 1', '/photos');
    fireEvent.press(screen.getByLabelText('Save and test'));

    expect(
      await screen.findByLabelText('Connection failed: AUTH_FAILED message'),
    ).toBeOnTheScreen();
    expect(screen.getByLabelText('Host')).toHaveDisplayValue('nas.local');
    expect(screen.getByLabelText('User name')).toHaveDisplayValue('alice');
    expect(screen.getByLabelText('Password')).toHaveDisplayValue('');
  });

  it('asks before leaving with unsaved changes', async () => {
    const { navigation, leave } = await renderScreen(SAVED);

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
    expect(navigation.dispatch).toHaveBeenCalledWith({ type: 'GO_BACK' });
    // The re-dispatched action is let through.
    expect(leave().preventDefault).not.toHaveBeenCalled();
  });

  it('treats a typed password as an unsaved change', async () => {
    const { leave } = await renderScreen(SAVED);

    typeInto('Password', 'new');

    expect(leave().preventDefault).toHaveBeenCalled();
  });

  it('leaves without asking when nothing changed', async () => {
    const { leave } = await renderScreen(SAVED);

    expect(leave().preventDefault).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Discard changes')).toBeNull();
  });

  it('leaves without asking once the changes are saved', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));
    const { leave } = await renderScreen(SAVED);

    typeInto('Remote folder 1', '/other');
    summaryMock.mockResolvedValue({
      contractVersion: 5,
      status: 'ok',
      repository: { ...SAVED, remoteRoots: ['/other'], revision: 3 },
    });
    fireEvent.press(screen.getByLabelText('Save and test'));
    await screen.findByLabelText('/photos: 1 entries');
    await waitFor(() => expect(summaryMock).toHaveBeenCalledTimes(2));

    expect(leave().preventDefault).not.toHaveBeenCalled();
  });

  it('leaves without asking once saved, even when native filled in the default port', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(6));
    const { leave } = await renderScreen(SAVED);

    fireEvent.press(screen.getByLabelText('Protocol WebDAV'));
    typeInto('Port', '');
    summaryMock.mockResolvedValue({
      contractVersion: 5,
      status: 'ok',
      repository: { ...SAVED, protocol: 'WEBDAV', port: 80, revision: 3 },
    });
    fireEvent.press(screen.getByLabelText('Save and test'));
    await screen.findByLabelText('/photos: 6 entries');
    await waitFor(() =>
      expect(screen.getByTestId('repository.port').props.value).toBe('80'),
    );

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

    expect(
      await screen.findByLabelText('/photos: 2 entries'),
    ).toBeOnTheScreen();
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

  it('labels every control when editing, after a failure and in the discard prompt', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(
      failure('AUTH_FAILED', { action: 'Check the user name and password.' }),
    );
    const result = await renderScreen(SAVED);

    typeInto('Host', 'other.local');
    fireEvent.press(screen.getByLabelText('Save and test'));
    await screen.findByLabelText(/^Connection failed:/);
    a11ySweep(result);

    typeInto('Host', 'third.local');
    result.leave();
    expect(screen.getByLabelText('Discard changes')).toBeOnTheScreen();
    a11ySweep(result);
  });

  it('labels every control of the host-key dialog', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(
      failure('SFTP_HOST_KEY_CHANGED', {
        hostKeyChallenge: {
          challengeId: 'c-2',
          host: 'nas.local',
          port: 2222,
          algorithm: 'ssh-ed25519',
          fingerprint: 'SHA256:new',
          previousFingerprint: 'SHA256:old',
        },
      }),
    );
    const result = await renderScreen(SAVED);

    fireEvent.press(screen.getByLabelText('Save and test'));
    await screen.findByLabelText('Server key fingerprint SHA256:new');

    a11ySweep(result);
  });

  describe('several remote folders (Story 3, contract v6)', () => {
    const TWO: RepositorySummaryDto = {
      ...SAVED,
      remoteRoots: ['/scan/clean/a', '/scan/clean/b'],
    };

    it('shows one folder field with Browse and Add another folder, and no Remove (sc. 1)', async () => {
      await renderScreen(null);

      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '',
      );
      expect(screen.getByLabelText('Browse remote folder 1')).toBeOnTheScreen();
      expect(screen.queryByLabelText('Remove remote folder 1')).toBeNull();
      expect(screen.getByLabelText('Add another folder')).toBeOnTheScreen();
    });

    it('adds and removes folder fields, always keeping one', async () => {
      await renderScreen(null);

      fireEvent.press(screen.getByLabelText('Add another folder'));
      typeInto('Remote folder 1', '/a');
      typeInto('Remote folder 2', '/b');
      expect(screen.getByTestId('repository.remoteRoots.1')).toHaveDisplayValue(
        '/b',
      );
      expect(screen.getByLabelText('Remove remote folder 1')).toBeOnTheScreen();
      expect(screen.getByLabelText('Browse remote folder 2')).toBeOnTheScreen();

      fireEvent.press(screen.getByLabelText('Remove remote folder 1'));

      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/b',
      );
      expect(screen.queryByTestId('repository.remoteRoots.1')).toBeNull();
      expect(screen.queryByLabelText('Remove remote folder 1')).toBeNull();
    });

    it('prefills every saved folder in order', async () => {
      await renderScreen(TWO);

      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/scan/clean/a',
      );
      expect(screen.getByTestId('repository.remoteRoots.1')).toHaveDisplayValue(
        '/scan/clean/b',
      );
    });

    it('sends every field in order, blank ones too, and needs at least one folder', async () => {
      saveMock.mockResolvedValue(OK);
      testMock.mockResolvedValue(connected(1));
      await renderScreen({ ...SAVED, remoteRoots: ['/a'] });

      typeInto('Remote folder 1', ' ');
      expect(screen.getByLabelText('Save and test')).toBeDisabled();
      typeInto('Remote folder 1', ' /a ');
      fireEvent.press(screen.getByLabelText('Add another folder'));
      fireEvent.press(screen.getByLabelText('Add another folder'));
      typeInto('Remote folder 3', '/c');
      fireEvent.press(screen.getByLabelText('Save and test'));
      await screen.findByLabelText('Connected');

      expect(saveMock).toHaveBeenCalledWith(
        expect.objectContaining({ remoteRoots: ['/a', '', '/c'] }),
        null,
      );
    });

    it('shows a folder save error under the folder it names', async () => {
      const message =
        'This folder is the same as, inside or around /scan/clean/a.';
      saveMock.mockResolvedValue(
        failure('INVALID_QUERY', {
          message,
          field: 'remoteRoots',
          fieldIndex: 1,
        }),
      );
      await renderScreen(TWO);

      typeInto('Remote folder 2', '/scan/clean/a/x');
      fireEvent.press(screen.getByLabelText('Save and test'));

      await screen.findByText(message);
      expect(screen.getAllByText(message)).toHaveLength(1);
      expect(screen.queryByText(/Connection failed/)).toBeNull();
      // In form order, the error sits between the second field and its Browse button.
      const order = screen.UNSAFE_root.findAll(
        node =>
          typeof node.type === 'string' &&
          (node.props.testID === 'repository.remoteRoots.0' ||
            node.props.testID === 'repository.remoteRoots.1' ||
            node.props.accessibilityLabel === 'Browse remote folder 2' ||
            (String(node.type) === 'Text' && node.props.children === message)),
      );
      const at = (match: (props: Record<string, unknown>) => boolean) =>
        order.findIndex(node => match(node.props));
      const second = at(props => props.testID === 'repository.remoteRoots.1');
      const shown = at(props => props.children === message);
      const browse = at(
        props => props.accessibilityLabel === 'Browse remote folder 2',
      );
      expect(
        at(props => props.testID === 'repository.remoteRoots.0'),
      ).toBeLessThan(second);
      expect(second).toBeLessThan(shown);
      expect(shown).toBeLessThan(browse);
      expect(screen.getByTestId('repository.remoteRoots.1')).toHaveDisplayValue(
        '/scan/clean/a/x',
      );
    });

    it('shows Connected with a line per folder, and a failing folder error with its action under its field (sc. 2)', async () => {
      saveMock.mockResolvedValue(OK);
      testMock.mockResolvedValue(
        connected(3, [
          { path: '/scan/clean/a', entryCount: 3, error: null },
          {
            path: '/scan/clean/b',
            entryCount: null,
            error: {
              code: 'REMOTE_ROOT_NOT_FOUND',
              message: 'The remote folder was not found.',
              action: 'Check the remote folder.',
            },
          },
        ]),
      );
      await renderScreen(TWO);

      fireEvent.press(screen.getByLabelText('Save and test'));

      expect(await screen.findByLabelText('Connected')).toBeOnTheScreen();
      expect(
        screen.getByLabelText('/scan/clean/a: 3 entries'),
      ).toBeOnTheScreen();
      expect(
        screen.getByLabelText('/scan/clean/b: could not be read'),
      ).toBeOnTheScreen();
      expect(
        screen.getByText('The remote folder was not found.'),
      ).toBeOnTheScreen();
      expect(screen.getByText('Check the remote folder.')).toBeOnTheScreen();
    });

    it('keeps a shared WebDAV path in Host without replacing either folder (sc. 8)', async () => {
      await renderScreen(TWO);

      typeInto('Host', 'https://nas.local/scan/other');
      fireEvent(screen.getByLabelText('Host'), 'blur');

      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/scan/clean/a',
      );
      expect(screen.getByTestId('repository.remoteRoots.1')).toHaveDisplayValue(
        '/scan/clean/b',
      );
      expect(screen.getByLabelText('Host')).toHaveDisplayValue(
        'nas.local/scan/other',
      );
      // A second blur must not reinterpret the retained path as folder 1.
      fireEvent(screen.getByLabelText('Host'), 'blur');
      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/scan/clean/a',
      );
    });

    it('saves and browses with an unsplit WebDAV URL and separate folder paths', async () => {
      saveMock.mockResolvedValue(OK);
      testMock.mockResolvedValue(connected(2));
      browseMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        remoteFolders: {
          path: '/photos',
          parent: '/',
          folders: [],
          fellBackToRoot: false,
        },
      });
      await renderScreen(TWO);
      typeInto('Host', 'https://nas.local:8443/remote.php/dav/alice');
      typeInto('Remote folder 1', '/photos');
      typeInto('Password', 'typed');
      fireEvent.press(screen.getByLabelText('Browse remote folder 1'));
      await screen.findByTestId('remote-browser');
      expect(browseMock).toHaveBeenCalledWith(
        {
          protocol: 'WEBDAV',
          host: 'nas.local/remote.php/dav/alice',
          port: 8443,
          username: 'alice',
          webdavHttps: true,
        },
        'typed',
        '/photos',
      );
      fireEvent.press(screen.getByLabelText('Use this folder'));
      fireEvent.press(screen.getByLabelText('Save and test'));
      await waitFor(() =>
        expect(saveMock).toHaveBeenCalledWith(
          {
            protocol: 'WEBDAV',
            host: 'nas.local/remote.php/dav/alice',
            port: 8443,
            username: 'alice',
            webdavHttps: true,
            remoteRoots: ['/photos', '/scan/clean/b'],
          },
          'typed',
        ),
      );
    });

    it('Browse opens the server folder browser at that field and Use this folder fills it (sc. 11)', async () => {
      browseMock
        .mockResolvedValueOnce({
          contractVersion: 6,
          status: 'ok',
          remoteFolders: {
            path: '/scan/clean/b',
            parent: '/scan/clean',
            folders: ['x'],
            fellBackToRoot: false,
          },
        })
        .mockResolvedValueOnce({
          contractVersion: 6,
          status: 'ok',
          remoteFolders: {
            path: '/scan/clean/b/x',
            parent: '/scan/clean/b',
            folders: [],
            fellBackToRoot: false,
          },
        });
      await renderScreen(TWO);
      typeInto('Password', 'typed');

      fireEvent.press(screen.getByLabelText('Browse remote folder 2'));
      expect(await screen.findByTestId('remote-browser')).toBeOnTheScreen();
      expect(browseMock).toHaveBeenCalledWith(
        {
          protocol: 'SFTP',
          host: 'nas.local',
          port: 2222,
          username: 'alice',
          webdavHttps: false,
        },
        'typed',
        '/scan/clean/b',
      );
      fireEvent.press(await screen.findByLabelText('x'));
      await screen.findByText('No folders here');
      fireEvent.press(screen.getByLabelText('Use this folder'));

      await waitFor(() =>
        expect(screen.queryByTestId('remote-browser')).toBeNull(),
      );
      expect(screen.getByTestId('repository.remoteRoots.1')).toHaveDisplayValue(
        '/scan/clean/b/x',
      );
      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/scan/clean/a',
      );
      expect(saveMock).not.toHaveBeenCalled();
    });

    it('Browse without a typed password relies on the stored one, and Cancel keeps the field', async () => {
      browseMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        remoteFolders: {
          path: '/',
          parent: null,
          folders: ['scan'],
          fellBackToRoot: true,
        },
      });
      await renderScreen(TWO);

      fireEvent.press(screen.getByLabelText('Browse remote folder 1'));
      await screen.findByLabelText('scan');
      expect(browseMock).toHaveBeenCalledWith(
        expect.anything(),
        null,
        '/scan/clean/a',
      );
      fireEvent.press(screen.getByLabelText('Close folder browser'));

      await waitFor(() =>
        expect(screen.queryByTestId('remote-browser')).toBeNull(),
      );
      expect(screen.getByTestId('repository.remoteRoots.0')).toHaveDisplayValue(
        '/scan/clean/a',
      );
    });

    it('labels every control with several folders and in the folder browser', async () => {
      browseMock.mockResolvedValue({
        contractVersion: 6,
        status: 'ok',
        remoteFolders: {
          path: '/',
          parent: null,
          folders: ['scan'],
          fellBackToRoot: false,
        },
      });
      const result = await renderScreen(TWO);
      a11ySweep(result);

      fireEvent.press(screen.getByLabelText('Browse remote folder 1'));
      await screen.findByLabelText('scan');
      a11ySweep(result);
    });
  });
});
