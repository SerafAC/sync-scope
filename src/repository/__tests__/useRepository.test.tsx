import {act, renderHook} from '@testing-library/react-native';

import {
  approveSftpHostKey,
  rejectSftpHostKey,
  saveRepository,
  testRepository,
} from '../../native/CloudSync';
import type {
  CloudSyncError,
  HostKeyChallengeDto,
  OperationError,
  RepositoryConfigInput,
  RepositoryFolderResultDto,
  RepositorySummaryDto,
} from '../../native/CloudSyncContracts';
import {
  NEW_REPOSITORY_DRAFT,
  draftOf,
  fieldErrorAt,
  folderResultAt,
  useRepository,
  withRemoteRoot,
  withRemoteRootAdded,
  withRemoteRootRemoved,
  type RepositoryFormState,
} from '../useRepository';

jest.mock('../../native/CloudSync', () => ({
  saveRepository: jest.fn(),
  testRepository: jest.fn(),
  approveSftpHostKey: jest.fn(),
  rejectSftpHostKey: jest.fn(),
}));

const saveMock = saveRepository as jest.MockedFunction<typeof saveRepository>;
const testMock = testRepository as jest.MockedFunction<typeof testRepository>;
const approveMock = approveSftpHostKey as jest.MockedFunction<
  typeof approveSftpHostKey
>;
const rejectMock = rejectSftpHostKey as jest.MockedFunction<
  typeof rejectSftpHostKey
>;

const CONFIG: RepositoryConfigInput = {
  protocol: 'SFTP',
  host: 'nas.local',
  port: null,
  username: 'alice',
  remoteRoots: ['/photos', '/backup'],
};

const CHALLENGE: HostKeyChallengeDto = {
  challengeId: 'c-1',
  host: 'nas.local',
  port: 22,
  algorithm: 'ssh-ed25519',
  fingerprint: 'SHA256:new',
  previousFingerprint: null,
};

const OK = {contractVersion: 5, status: 'ok'} as const;

function failure(error: Partial<CloudSyncError> & {code: string}): OperationError {
  return {
    contractVersion: 5,
    status: 'error',
    error: {message: `${error.code} message`, action: null, ...error},
  };
}

function connected(
  entryCount: number,
  folders: RepositoryFolderResultDto[] = [
    {path: '/photos', entryCount, error: null},
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

async function saveAndTest(password: string | null = 'secret') {
  const hook = renderHook(() => useRepository());
  await act(() => hook.result.current.saveAndTest(CONFIG, password));
  return hook;
}

describe('useRepository', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('starts idle and not busy', () => {
    const {result} = renderHook(() => useRepository());

    expect(result.current.state).toEqual({kind: 'idle'});
    expect(result.current.busy).toBe(false);
  });

  it('save ok then test ok → connected with entryCount', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(7));

    const {result} = await saveAndTest();

    expect(result.current.state).toEqual({
      kind: 'connected',
      entryCount: 7,
      folders: [{path: '/photos', entryCount: 7, error: null}],
    });
    expect(saveMock).toHaveBeenCalledWith(CONFIG, 'secret');
  });

  it('is busy while saving and testing', async () => {
    let finishSave: (value: typeof OK) => void = () => {};
    saveMock.mockReturnValue(new Promise(resolve => (finishSave = resolve)));
    let finishTest: (value: ReturnType<typeof connected>) => void = () => {};
    testMock.mockReturnValue(new Promise(resolve => (finishTest = resolve)));
    const {result} = renderHook(() => useRepository());

    let pending: Promise<boolean> = Promise.resolve(false);
    act(() => {
      pending = result.current.saveAndTest(CONFIG, 'secret');
    });
    expect(result.current.state).toEqual({kind: 'saving'});
    expect(result.current.busy).toBe(true);

    await act(async () => finishSave(OK));
    expect(result.current.state).toEqual({kind: 'testing'});
    expect(result.current.busy).toBe(true);

    await act(async () => {
      finishTest(connected(1));
      await pending;
    });
    expect(result.current.busy).toBe(false);
  });

  it('save INVALID_QUERY with a field → failed with that field, and no test', async () => {
    saveMock.mockResolvedValue(
      failure({code: 'INVALID_QUERY', field: 'port'}),
    );

    const {result} = await saveAndTest();

    expect(result.current.state).toMatchObject({
      kind: 'failed',
      error: {code: 'INVALID_QUERY', field: 'port'},
    });
    expect(testMock).not.toHaveBeenCalled();
  });

  it('test AUTH_FAILED → failed', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(failure({code: 'AUTH_FAILED'}));

    const {result} = await saveAndTest();

    expect(result.current.state).toMatchObject({
      kind: 'failed',
      error: {code: 'AUTH_FAILED'},
    });
  });

  it('SFTP_HOST_KEY_UNVERIFIED → hostKeyPrompt, then approve → re-test → connected', async () => {
    saveMock.mockResolvedValue(OK);
    testMock
      .mockResolvedValueOnce(
        failure({code: 'SFTP_HOST_KEY_UNVERIFIED', hostKeyChallenge: CHALLENGE}),
      )
      .mockResolvedValueOnce(connected(3));
    approveMock.mockResolvedValue(OK);

    const {result} = await saveAndTest();

    expect(result.current.state).toEqual({
      kind: 'hostKeyPrompt',
      challenge: CHALLENGE,
      changed: false,
    });

    await act(() => result.current.trust());

    expect(approveMock).toHaveBeenCalledWith('c-1');
    expect(testMock).toHaveBeenCalledTimes(2);
    expect(result.current.state).toMatchObject({kind: 'connected', entryCount: 3});
  });

  it('SFTP_HOST_KEY_CHANGED → hostKeyPrompt with changed: true', async () => {
    saveMock.mockResolvedValue(OK);
    const changed = {...CHALLENGE, previousFingerprint: 'SHA256:old'};
    testMock.mockResolvedValue(
      failure({code: 'SFTP_HOST_KEY_CHANGED', hostKeyChallenge: changed}),
    );

    const {result} = await saveAndTest();

    expect(result.current.state).toEqual({
      kind: 'hostKeyPrompt',
      challenge: changed,
      changed: true,
    });
  });

  it('reject → rejected, and nothing is approved', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(
      failure({code: 'SFTP_HOST_KEY_UNVERIFIED', hostKeyChallenge: CHALLENGE}),
    );
    rejectMock.mockResolvedValue(OK);

    const {result} = await saveAndTest();
    await act(() => result.current.reject());

    expect(rejectMock).toHaveBeenCalledWith('c-1');
    expect(approveMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({kind: 'rejected'});
  });

  it('trust or reject without a prompt does nothing', async () => {
    const {result} = renderHook(() => useRepository());

    await act(() => result.current.trust());
    await act(() => result.current.reject());

    expect(approveMock).not.toHaveBeenCalled();
    expect(rejectMock).not.toHaveBeenCalled();
    expect(result.current.state).toEqual({kind: 'idle'});
  });

  it('save SCAN_IN_PROGRESS → failed', async () => {
    saveMock.mockResolvedValue(failure({code: 'SCAN_IN_PROGRESS'}));

    const {result} = await saveAndTest();

    expect(result.current.state).toMatchObject({
      kind: 'failed',
      error: {code: 'SCAN_IN_PROGRESS'},
    });
  });

  it('test CONNECTION_TIMEOUT → failed with the timeout message', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(
      failure({
        code: 'CONNECTION_TIMEOUT',
        message: 'The SFTP server did not respond in time.',
        action: 'Check the network and try again.',
      }),
    );

    const {result} = await saveAndTest();

    expect(result.current.state).toEqual({
      kind: 'failed',
      error: {
        code: 'CONNECTION_TIMEOUT',
        message: 'The SFTP server did not respond in time.',
        action: 'Check the network and try again.',
      },
    });
  });

  it('a throwing wrapper ends failed instead of stuck busy', async () => {
    saveMock.mockRejectedValue(new Error('bridge gone'));

    const {result} = await saveAndTest();

    expect(result.current.state).toMatchObject({
      kind: 'failed',
      error: {code: 'NATIVE_MODULE_UNAVAILABLE'},
    });
    expect(result.current.busy).toBe(false);
  });

  it('passes the password straight through and never keeps it in state', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));

    const {result} = await saveAndTest('s3cret-Hook-Probe');

    expect(saveMock).toHaveBeenCalledWith(CONFIG, 's3cret-Hook-Probe');
    expect(JSON.stringify(result.current)).not.toContain('s3cret-Hook-Probe');
  });

  it('passes a null password through to keep the stored one', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));

    await saveAndTest(null);

    expect(saveMock).toHaveBeenCalledWith(CONFIG, null);
  });
});

describe('useRepository with several remote folders (contract v6)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('sends every folder in order', async () => {
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(connected(1));

    await saveAndTest();

    expect(saveMock).toHaveBeenCalledWith(
      expect.objectContaining({remoteRoots: ['/photos', '/backup']}),
      'secret',
    );
  });

  it('keeps a folder save error at its fieldIndex', async () => {
    saveMock.mockResolvedValue(
      failure({
        code: 'INVALID_QUERY',
        message: 'This folder is the same as, inside or around /photos.',
        field: 'remoteRoots',
        fieldIndex: 1,
      }),
    );

    const {result} = await saveAndTest();
    const state = result.current.state;

    expect(fieldErrorAt(state, 'remoteRoots', 1)?.message).toBe(
      'This folder is the same as, inside or around /photos.',
    );
    expect(fieldErrorAt(state, 'remoteRoots', 0)).toBeNull();
    expect(fieldErrorAt(state, 'host')).toBeNull();
    expect(testMock).not.toHaveBeenCalled();
  });

  it('shows a folder error without an index under the first folder', () => {
    const state: RepositoryFormState = {
      kind: 'failed',
      error: {
        code: 'INVALID_QUERY',
        message: 'The repository remoteRoots is invalid: it must be a list of folders.',
        action: null,
        field: 'remoteRoots',
      },
    };

    expect(fieldErrorAt(state, 'remoteRoots', 0)).toBe(state.error);
    expect(fieldErrorAt(state, 'remoteRoots', 1)).toBeNull();
  });

  it('keeps other field errors on their field', () => {
    const state: RepositoryFormState = {
      kind: 'failed',
      error: {code: 'INVALID_QUERY', message: 'Bad port.', action: null, field: 'port'},
    };

    expect(fieldErrorAt(state, 'port')).toBe(state.error);
    expect(fieldErrorAt(state, 'remoteRoots', 0)).toBeNull();
    expect(fieldErrorAt({kind: 'idle'}, 'port')).toBeNull();
  });

  it('keeps the per-folder lines of a passed test', async () => {
    const missing = {
      code: 'REMOTE_ROOT_NOT_FOUND',
      message: 'The folder was not found.',
      action: 'Check the folder.',
    };
    saveMock.mockResolvedValue(OK);
    testMock.mockResolvedValue(
      connected(5, [
        {path: '/photos', entryCount: 5, error: null},
        {path: '/backup', entryCount: null, error: missing},
      ]),
    );

    const {result} = await saveAndTest();
    const state = result.current.state;

    expect(state).toMatchObject({kind: 'connected', entryCount: 5});
    expect(folderResultAt(state, 0)).toEqual({path: '/photos', entryCount: 5, error: null});
    expect(folderResultAt(state, 1)?.error).toEqual(missing);
    expect(folderResultAt(state, 2)).toBeNull();
    expect(folderResultAt({kind: 'idle'}, 0)).toBeNull();
  });
});

describe('the repository draft (contract v6)', () => {
  const summary: RepositorySummaryDto = {
    protocol: 'FTP',
    host: 'nas.local',
    port: 21,
    username: 'alice',
    remoteRoots: ['/a', '/b'],
    precisionMillis: null,
    credentialPresent: true,
    hostKeyTrusted: null,
    revision: 1,
    webdavHttps: false,
  };

  it('starts a new form with one empty folder field', () => {
    expect(NEW_REPOSITORY_DRAFT.remoteRoots).toEqual(['']);
  });

  it('fills every saved folder in order, and one empty field when none was saved', () => {
    expect(draftOf(summary).remoteRoots).toEqual(['/a', '/b']);
    expect(draftOf({...summary, remoteRoots: []}).remoteRoots).toEqual(['']);
  });

  it('adds, edits and removes folder fields, keeping at least one', () => {
    const draft = draftOf(summary);

    const added = withRemoteRootAdded(draft);
    expect(added.remoteRoots).toEqual(['/a', '/b', '']);
    expect(withRemoteRoot(added, 2, '/c').remoteRoots).toEqual(['/a', '/b', '/c']);
    expect(withRemoteRootRemoved(added, 0).remoteRoots).toEqual(['/b', '']);
    const single = withRemoteRootRemoved(draft, 1);
    expect(single.remoteRoots).toEqual(['/a']);
    expect(withRemoteRootRemoved(single, 0)).toBe(single);
    expect(draft.remoteRoots).toEqual(['/a', '/b']);
  });
});
