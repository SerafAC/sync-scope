import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react-native';
import {PaperProvider} from 'react-native-paper';

import {
  approveSftpHostKey,
  browseRemoteFolders,
  rejectSftpHostKey,
} from '../../native/CloudSync';
import type {
  BrowseRemoteFoldersResult,
  HostKeyChallengeDto,
  OperationError,
  RemoteFoldersDto,
} from '../../native/CloudSyncContracts';
import {a11ySweep} from '../../test-utils/a11ySweep';
import {
  FELL_BACK_TEXT,
  KEY_REJECTED_TEXT,
  RemoteFolderBrowser,
  type RemoteFolderBrowserProps,
} from '../RemoteFolderBrowser';

jest.mock('../../native/CloudSync', () => ({
  browseRemoteFolders: jest.fn(),
  approveSftpHostKey: jest.fn(),
  rejectSftpHostKey: jest.fn(),
}));

const browseMock = browseRemoteFolders as jest.MockedFunction<
  typeof browseRemoteFolders
>;
const approveMock = approveSftpHostKey as jest.MockedFunction<
  typeof approveSftpHostKey
>;
const rejectMock = rejectSftpHostKey as jest.MockedFunction<
  typeof rejectSftpHostKey
>;

const CONFIG = {
  protocol: 'SFTP' as const,
  host: 'nas.local',
  port: 2222,
  username: 'alice',
};

const CHALLENGE: HostKeyChallengeDto = {
  challengeId: 'c-1',
  host: 'nas.local',
  port: 2222,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:new',
  previousFingerprint: null,
};

const OK = {contractVersion: 6, status: 'ok'} as const;

function listing(
  path: string,
  folders: string[],
  fellBackToRoot = false,
): BrowseRemoteFoldersResult {
  const parent =
    path === '/' ? null : path.slice(0, path.lastIndexOf('/')) || '/';
  const remoteFolders: RemoteFoldersDto = {path, parent, folders, fellBackToRoot};
  return {contractVersion: 6, status: 'ok', remoteFolders};
}

function failure(
  code: string,
  extra: Partial<OperationError['error']> = {},
): OperationError {
  return {
    contractVersion: 6,
    status: 'error',
    error: {code, message: `${code} message`, action: null, ...extra},
  };
}

/** A browse answer the test resolves by hand, to order late answers. */
function deferred() {
  let resolve: (value: BrowseRemoteFoldersResult) => void = () => {};
  const promise = new Promise<BrowseRemoteFoldersResult>(done => {
    resolve = done;
  });
  return {promise, resolve};
}

async function renderBrowser(overrides: Partial<RemoteFolderBrowserProps> = {}) {
  const props: RemoteFolderBrowserProps = {
    visible: true,
    config: CONFIG,
    password: 'typed',
    initialPath: '',
    onUse: jest.fn(),
    onClose: jest.fn(),
    ...overrides,
  };
  const result = render(
    <PaperProvider>
      <RemoteFolderBrowser {...props} />
    </PaperProvider>,
  );
  await act(async () => {});
  return {...result, props};
}

async function press(label: string) {
  fireEvent.press(screen.getByLabelText(label));
  await act(async () => {});
}

describe('RemoteFolderBrowser', () => {
  beforeEach(() => {
    // Not resetAllMocks: it would also reset the safe-area mock the dialogs read.
    for (const mock of [browseMock, approveMock, rejectMock]) {
      mock.mockReset();
    }
  });

  it('opens at the field path with the draft and typed password, and lists only folder rows', async () => {
    browseMock.mockResolvedValue(listing('/scan', ['clean', 'partial']));

    await renderBrowser({initialPath: ' /scan '});

    expect(screen.getByTestId('remote-browser')).toBeOnTheScreen();
    expect(browseMock).toHaveBeenCalledWith(CONFIG, 'typed', '/scan');
    expect(screen.getByLabelText('clean')).toBeOnTheScreen();
    expect(screen.getByLabelText('partial')).toBeOnTheScreen();
    expect(screen.getByLabelText('Go to /scan')).toBeOnTheScreen();
  });

  it('opens at the top when the field is empty', async () => {
    browseMock.mockResolvedValue(listing('/', ['scan']));

    await renderBrowser({initialPath: ''});

    expect(browseMock).toHaveBeenCalledWith(CONFIG, 'typed', '');
    expect(screen.getByLabelText('Up one folder')).toBeDisabled();
  });

  it('descends into a folder and goes back up', async () => {
    browseMock
      .mockResolvedValueOnce(listing('/', ['scan']))
      .mockResolvedValueOnce(listing('/scan', ['clean']))
      .mockResolvedValueOnce(listing('/scan/clean', []))
      .mockResolvedValueOnce(listing('/scan', ['clean']))
      .mockResolvedValueOnce(listing('/', ['scan']));
    await renderBrowser();

    await press('scan');
    await press('clean');
    expect(screen.getByText('No folders here')).toBeOnTheScreen();
    await press('Up one folder');
    await press('Go to /');

    expect(browseMock.mock.calls.map(call => call[2])).toEqual([
      '',
      '/scan',
      '/scan/clean',
      '/scan',
      '/',
    ]);
    expect(screen.getByLabelText('scan')).toBeOnTheScreen();
  });

  it('says so when the start folder could not be opened and the top is shown', async () => {
    browseMock.mockResolvedValue(listing('/', ['scan'], true));

    await renderBrowser({initialPath: '/gone'});

    expect(screen.getByText(FELL_BACK_TEXT)).toBeOnTheScreen();
    expect(screen.getByLabelText('scan')).toBeOnTheScreen();
  });

  it('ignores the answer for a folder the user already left', async () => {
    const slow = deferred();
    browseMock
      .mockResolvedValueOnce(listing('/', ['a', 'b']))
      .mockReturnValueOnce(slow.promise)
      .mockResolvedValueOnce(listing('/', ['a', 'b']));
    await renderBrowser();

    fireEvent.press(screen.getByLabelText('a'));
    await act(async () => {});
    expect(screen.getByLabelText('Loading folders')).toBeOnTheScreen();
    // Back to the top while /a is still loading.
    await press('Go to /');
    await act(async () => slow.resolve(listing('/a', ['late'])));

    expect(screen.queryByLabelText('late')).toBeNull();
    expect(screen.getByLabelText('b')).toBeOnTheScreen();
  });

  it('shows the cause and the next step of a failure, keeps the form usable and retries', async () => {
    browseMock
      .mockResolvedValueOnce(
        failure('AUTH_FAILED', {
          message: 'The server refused the user name or password.',
          action: 'Check the user name and password.',
        }),
      )
      .mockResolvedValueOnce(listing('/', ['scan']));
    const {props} = await renderBrowser();

    expect(
      screen.getByText('Connection failed: The server refused the user name or password.'),
    ).toBeOnTheScreen();
    expect(screen.getByText('Check the user name and password.')).toBeOnTheScreen();
    expect(screen.getByLabelText('Use this folder')).toBeDisabled();

    await press('Try again');
    expect(screen.getByLabelText('scan')).toBeOnTheScreen();
    expect(props.onUse).not.toHaveBeenCalled();
  });

  it('shows a failing wrapper as an error instead of loading forever', async () => {
    browseMock.mockRejectedValue(new Error('bridge gone'));

    await renderBrowser();

    expect(
      screen.getByText('Connection failed: The repository service is not available.'),
    ).toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading folders')).toBeNull();
  });

  it('asks to trust an unknown SFTP key and lists the same folder after trusting', async () => {
    browseMock
      .mockResolvedValueOnce(
        failure('SFTP_HOST_KEY_UNVERIFIED', {hostKeyChallenge: CHALLENGE}),
      )
      .mockResolvedValueOnce(listing('/scan', ['clean']));
    approveMock.mockResolvedValue(OK);
    await renderBrowser({initialPath: '/scan'});

    expect(screen.getByText('Trust this server?')).toBeOnTheScreen();
    await press('Trust server key');

    expect(approveMock).toHaveBeenCalledWith('c-1');
    expect(browseMock).toHaveBeenLastCalledWith(CONFIG, 'typed', '/scan');
    expect(screen.getByLabelText('clean')).toBeOnTheScreen();
  });

  it('a rejected key lists nothing and says the server is not trusted', async () => {
    browseMock.mockResolvedValue(
      failure('SFTP_HOST_KEY_UNVERIFIED', {hostKeyChallenge: CHALLENGE}),
    );
    rejectMock.mockResolvedValue(OK);
    await renderBrowser();

    await press('Reject server key');

    expect(rejectMock).toHaveBeenCalledWith('c-1');
    expect(approveMock).not.toHaveBeenCalled();
    expect(browseMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(KEY_REJECTED_TEXT)).toBeOnTheScreen();
  });

  it('Use this folder returns the folder being shown', async () => {
    browseMock
      .mockResolvedValueOnce(listing('/', ['scan']))
      .mockResolvedValueOnce(listing('/scan', ['clean']))
      .mockResolvedValueOnce(listing('/scan/clean', []));
    const {props} = await renderBrowser();

    await press('scan');
    await press('clean');
    await press('Use this folder');

    expect(props.onUse).toHaveBeenCalledWith('/scan/clean');
  });

  it('closes without returning a folder', async () => {
    browseMock.mockResolvedValue(listing('/', ['scan']));
    const {props} = await renderBrowser();

    await press('Close folder browser');

    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onUse).not.toHaveBeenCalled();
  });

  it('lists nothing while closed, and starts again at the field path when reopened', async () => {
    browseMock
      .mockResolvedValueOnce(listing('/a', []))
      .mockResolvedValueOnce(listing('/b', ['x']));
    const {props, rerender} = await renderBrowser({visible: false});
    expect(browseMock).not.toHaveBeenCalled();

    const view = (visible: boolean, initialPath: string) => (
      <PaperProvider>
        <RemoteFolderBrowser {...props} initialPath={initialPath} visible={visible} />
      </PaperProvider>
    );
    rerender(view(true, '/a'));
    await act(async () => {});
    rerender(view(false, '/a'));
    rerender(view(true, '/b'));
    await act(async () => {});

    expect(browseMock.mock.calls.map(call => call[2])).toEqual(['/a', '/b']);
    expect(screen.getByLabelText('x')).toBeOnTheScreen();
  });

  it('labels every control, also with an error and in the host-key dialog', async () => {
    browseMock.mockResolvedValueOnce(listing('/scan', ['clean']));
    const listed = await renderBrowser({initialPath: '/scan'});
    a11ySweep(listed);
    listed.unmount();

    browseMock.mockResolvedValueOnce(failure('CONNECTION_REFUSED'));
    const failed = await renderBrowser();
    a11ySweep(failed);
    failed.unmount();

    browseMock.mockResolvedValueOnce(
      failure('SFTP_HOST_KEY_UNVERIFIED', {hostKeyChallenge: CHALLENGE}),
    );
    a11ySweep(await renderBrowser());
  });
});
