import {act, renderHook, waitFor} from '@testing-library/react-native';
import {AppState, type AppStateStatus} from 'react-native';

import {
  launchSourcePicker,
  listSources,
  removeSource,
} from '../../native/CloudSync';
import type {SourceDto} from '../../native/CloudSyncContracts';
import {useSources} from '../useSources';

jest.mock('../../native/CloudSync', () => ({
  listSources: jest.fn(),
  launchSourcePicker: jest.fn(),
  removeSource: jest.fn(),
}));

const listSourcesMock = listSources as jest.MockedFunction<typeof listSources>;
const launchSourcePickerMock = launchSourcePicker as jest.MockedFunction<
  typeof launchSourcePicker
>;
const removeSourceMock = removeSource as jest.MockedFunction<
  typeof removeSource
>;

function source(overrides: Partial<SourceDto> = {}): SourceDto {
  return {
    sourceId: 'source-1',
    alias: 'Camera',
    volumeLabel: 'Internal shared storage',
    displayPath: 'SyncScopeE2E/Camera',
    isRemovable: false,
    canWrite: true,
    addedAtMillis: 1,
    availability: 'AVAILABLE',
    ...overrides,
  };
}

function listOk(sources: SourceDto[]) {
  return {contractVersion: 2, status: 'ok' as const, sources};
}

let appStateListener: ((state: AppStateStatus) => void) | null = null;
const removeAppStateListener = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  appStateListener = null;
  jest
    .spyOn(AppState, 'addEventListener')
    .mockImplementation((type, listener) => {
      if (type === 'change') {
        appStateListener = listener as (state: AppStateStatus) => void;
      }
      return {remove: removeAppStateListener};
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useSources', () => {
  it('loads the sources on mount', async () => {
    listSourcesMock.mockResolvedValue(listOk([source()]));

    const {result} = renderHook(() => useSources());

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([source()]);
    expect(result.current.error).toBeNull();
    expect(listSourcesMock).toHaveBeenCalledTimes(1);
  });

  it('reloads when the app returns to the foreground', async () => {
    listSourcesMock.mockResolvedValueOnce(listOk([source()]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    listSourcesMock.mockResolvedValueOnce(
      listOk([source({availability: 'GRANT_REVOKED'})]),
    );
    await act(async () => {
      appStateListener?.('background');
    });
    expect(listSourcesMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() =>
      expect(result.current.sources[0]?.availability).toBe('GRANT_REVOKED'),
    );
    expect(listSourcesMock).toHaveBeenCalledTimes(2);
  });

  it('stops listening to AppState on unmount', async () => {
    listSourcesMock.mockResolvedValue(listOk([]));
    const {result, unmount} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    unmount();

    expect(removeAppStateListener).toHaveBeenCalled();
  });

  it('add() launches the picker and then refreshes the list', async () => {
    listSourcesMock.mockResolvedValueOnce(listOk([]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    launchSourcePickerMock.mockResolvedValue({
      contractVersion: 2,
      status: 'ok',
      outcome: 'ADDED',
      source: source(),
    });
    listSourcesMock.mockResolvedValueOnce(listOk([source()]));

    await act(async () => {
      await result.current.add();
    });

    expect(launchSourcePickerMock).toHaveBeenCalledWith();
    expect(listSourcesMock).toHaveBeenCalledTimes(2);
    expect(result.current.sources).toEqual([source()]);
    expect(result.current.error).toBeNull();
  });

  it('add() cancelled leaves the list unchanged and shows no error', async () => {
    listSourcesMock.mockResolvedValueOnce(listOk([source()]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    launchSourcePickerMock.mockResolvedValue({
      contractVersion: 2,
      status: 'ok',
      outcome: 'CANCELLED',
      source: null,
    });

    await act(async () => {
      await result.current.add();
    });

    expect(result.current.sources).toEqual([source()]);
    expect(result.current.error).toBeNull();
    expect(listSourcesMock).toHaveBeenCalledTimes(1);
  });

  it('regrant(sourceId) launches the picker for that source', async () => {
    listSourcesMock.mockResolvedValueOnce(
      listOk([source({availability: 'GRANT_REVOKED'})]),
    );
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    launchSourcePickerMock.mockResolvedValue({
      contractVersion: 2,
      status: 'ok',
      outcome: 'REGRANTED',
      source: source(),
    });
    listSourcesMock.mockResolvedValueOnce(listOk([source()]));

    await act(async () => {
      await result.current.regrant('source-1');
    });

    expect(launchSourcePickerMock).toHaveBeenCalledWith('source-1');
    expect(result.current.sources[0]?.availability).toBe('AVAILABLE');
  });

  it('remove(sourceId) removes the source and then refreshes', async () => {
    listSourcesMock.mockResolvedValueOnce(listOk([source()]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    removeSourceMock.mockResolvedValue({contractVersion: 2, status: 'ok'});
    listSourcesMock.mockResolvedValueOnce(listOk([]));

    await act(async () => {
      await result.current.remove('source-1');
    });

    expect(removeSourceMock).toHaveBeenCalledWith('source-1');
    expect(listSourcesMock).toHaveBeenCalledTimes(2);
    expect(result.current.sources).toEqual([]);
  });

  it('exposes an error envelope with its conflicting source', async () => {
    listSourcesMock.mockResolvedValue(listOk([source()]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    launchSourcePickerMock.mockResolvedValue({
      contractVersion: 2,
      status: 'error',
      error: {
        code: 'SOURCE_OVERLAP',
        message: 'This folder overlaps a folder you already added.',
        action: 'Pick a folder that is not inside, or around, an existing one.',
        conflictingSource: {sourceId: 'source-1', alias: 'Camera'},
      },
    });

    await act(async () => {
      await result.current.add();
    });

    expect(result.current.error).toEqual({
      code: 'SOURCE_OVERLAP',
      message: 'This folder overlaps a folder you already added.',
      action: 'Pick a folder that is not inside, or around, an existing one.',
      conflictingSource: {sourceId: 'source-1', alias: 'Camera'},
    });
    expect(result.current.sources).toEqual([source()]);

    act(() => {
      result.current.dismissError();
    });
    expect(result.current.error).toBeNull();
  });

  it('exposes a remove error without a conflicting source', async () => {
    listSourcesMock.mockResolvedValue(listOk([source()]));
    const {result} = renderHook(() => useSources());
    await waitFor(() => expect(result.current.loading).toBe(false));

    removeSourceMock.mockResolvedValue({
      contractVersion: 2,
      status: 'error',
      error: {
        code: 'SOURCE_NOT_FOUND',
        message: 'That folder is no longer in your list.',
        action: 'Refresh the folder list.',
      },
    });

    await act(async () => {
      await result.current.remove('missing');
    });

    expect(result.current.error).toEqual({
      code: 'SOURCE_NOT_FOUND',
      message: 'That folder is no longer in your list.',
      action: 'Refresh the folder list.',
      conflictingSource: null,
    });
  });

  it('exposes a list error and keeps the previous list', async () => {
    listSourcesMock.mockResolvedValueOnce({
      contractVersion: 2,
      status: 'error',
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected failure.',
        action: null,
      },
    });

    const {result} = renderHook(() => useSources());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([]);
    expect(result.current.error?.code).toBe('INTERNAL_ERROR');
  });

  it('exposes a thrown wrapper as a typed error instead of rejecting', async () => {
    listSourcesMock.mockRejectedValueOnce(
      new Error('CloudSync TurboModule is unavailable on this platform'),
    );

    const {result} = renderHook(() => useSources());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.sources).toEqual([]);
    expect(result.current.error?.code).toBe('NATIVE_MODULE_UNAVAILABLE');

    launchSourcePickerMock.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.add();
    });
    expect(result.current.error?.code).toBe('NATIVE_MODULE_UNAVAILABLE');

    removeSourceMock.mockRejectedValueOnce(new Error('boom'));
    await act(async () => {
      await result.current.remove('source-1');
    });
    expect(result.current.error?.code).toBe('NATIVE_MODULE_UNAVAILABLE');
  });
});
