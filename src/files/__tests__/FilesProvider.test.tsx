import React from 'react';
import {act, renderHook, waitFor} from '@testing-library/react-native';

import {
  getBrowsePreferences,
  setBrowsePreferences,
} from '../../native/CloudSync';
import type {
  BrowsePreferencesDto,
  BrowsePreferencesResult,
} from '../../native/CloudSyncContracts';
import {FilesProvider} from '../FilesProvider';
import {useFiles} from '../useFiles';

jest.mock('../../native/CloudSync', () => ({
  getBrowsePreferences: jest.fn(),
  setBrowsePreferences: jest.fn(),
}));

const getMock = getBrowsePreferences as jest.MockedFunction<
  typeof getBrowsePreferences
>;
const setMock = setBrowsePreferences as jest.MockedFunction<
  typeof setBrowsePreferences
>;

function stored(preferences: BrowsePreferencesDto): BrowsePreferencesResult {
  return {contractVersion: 6, status: 'ok', preferences};
}

const DEFAULTS: BrowsePreferencesDto = {
  view: 'GALLERY',
  gallerySort: 'TIME_DESC',
  listSort: 'NAME_ASC',
};

function wrapper({children}: {children: React.ReactNode}) {
  return <FilesProvider>{children}</FilesProvider>;
}

async function renderLoaded() {
  const rendered = renderHook(() => useFiles(), {wrapper});
  await waitFor(() =>
    expect(rendered.result.current.preferencesLoaded).toBe(true),
  );
  return rendered;
}

beforeEach(() => {
  jest.clearAllMocks();
  getMock.mockResolvedValue(stored(DEFAULTS));
  setMock.mockResolvedValue({contractVersion: 6, status: 'ok'});
});

describe('FilesProvider', () => {
  it('first run: the gallery, Date (newest first) there, Name (A–Z) in the list, every file shown', async () => {
    const {result} = renderHook(() => useFiles(), {wrapper});

    expect(result.current.preferencesLoaded).toBe(false);
    await waitFor(() => expect(result.current.preferencesLoaded).toBe(true));
    expect(result.current).toMatchObject({
      view: 'GALLERY',
      filter: 'ALL',
      sorts: {GALLERY: 'TIME_DESC', LIST: 'NAME_ASC'},
    });
    expect(getMock).toHaveBeenCalledTimes(1);
    expect(setMock).not.toHaveBeenCalled();
  });

  it('applies the stored view and sorts once the read resolves', async () => {
    getMock.mockResolvedValue(
      stored({view: 'LIST', gallerySort: 'SIZE_DESC', listSort: 'SIZE_ASC'}),
    );

    const {result} = await renderLoaded();

    expect(result.current).toMatchObject({
      view: 'LIST',
      filter: 'ALL',
      sorts: {GALLERY: 'SIZE_DESC', LIST: 'SIZE_ASC'},
    });
  });

  it('falls back to the defaults when the read fails or throws', async () => {
    getMock.mockResolvedValueOnce({
      contractVersion: 0,
      status: 'error',
      error: {code: 'INTERNAL_ERROR', message: 'x', action: null},
    });
    const first = await renderLoaded();
    expect(first.result.current).toMatchObject({
      view: 'GALLERY',
      sorts: {GALLERY: 'TIME_DESC', LIST: 'NAME_ASC'},
    });
    first.unmount();

    getMock.mockRejectedValueOnce(new Error('boom'));
    const second = await renderLoaded();
    expect(second.result.current.view).toBe('GALLERY');
  });

  it('writes each view and sort change, and only the changed field', async () => {
    const {result} = await renderLoaded();

    act(() => result.current.setView('LIST'));
    expect(setMock).toHaveBeenLastCalledWith({view: 'LIST'});

    act(() => result.current.setSort('LIST', 'SIZE_DESC'));
    expect(setMock).toHaveBeenLastCalledWith({listSort: 'SIZE_DESC'});

    act(() => result.current.setSort('GALLERY', 'NAME_DESC'));
    expect(setMock).toHaveBeenLastCalledWith({gallerySort: 'NAME_DESC'});

    expect(result.current.sorts).toEqual({
      GALLERY: 'NAME_DESC',
      LIST: 'SIZE_DESC',
    });
    expect(setMock).toHaveBeenCalledTimes(3);
  });

  it('never stores the filter', async () => {
    const {result} = await renderLoaded();

    act(() => result.current.setFilter('SYNCED'));

    expect(result.current.filter).toBe('SYNCED');
    expect(setMock).not.toHaveBeenCalled();
  });

  it('a failed write keeps the choice for this session', async () => {
    setMock.mockRejectedValue(new Error('boom'));
    const {result} = await renderLoaded();

    act(() => result.current.setSort('GALLERY', 'SIZE_ASC'));

    expect(result.current.sorts.GALLERY).toBe('SIZE_ASC');
  });

  it('a choice made before the read resolves wins over the stored one', async () => {
    let resolve: (value: BrowsePreferencesResult) => void = () => {};
    getMock.mockReturnValue(
      new Promise(r => {
        resolve = r;
      }),
    );
    const {result} = renderHook(() => useFiles(), {wrapper});

    act(() => result.current.setSort('GALLERY', 'SIZE_DESC'));
    await act(async () =>
      resolve(
        stored({view: 'LIST', gallerySort: 'NAME_ASC', listSort: 'TIME_ASC'}),
      ),
    );

    expect(result.current).toMatchObject({
      preferencesLoaded: true,
      view: 'LIST',
      sorts: {GALLERY: 'SIZE_DESC', LIST: 'TIME_ASC'},
    });
  });

  it('keeps sort, filter and view independent (FR-003)', async () => {
    const {result} = await renderLoaded();

    act(() => result.current.setFilter('UNSYNCED'));
    act(() => result.current.setSort('GALLERY', 'SIZE_DESC'));
    expect(result.current).toMatchObject({
      view: 'GALLERY',
      filter: 'UNSYNCED',
      sorts: {GALLERY: 'SIZE_DESC', LIST: 'NAME_ASC'},
    });

    act(() => result.current.setView('LIST'));
    expect(result.current).toMatchObject({
      view: 'LIST',
      filter: 'UNSYNCED',
      sorts: {GALLERY: 'SIZE_DESC', LIST: 'NAME_ASC'},
    });

    act(() => result.current.setFilter('ISSUES_UNKNOWN'));
    expect(result.current).toMatchObject({
      view: 'LIST',
      filter: 'ISSUES_UNKNOWN',
      sorts: {GALLERY: 'SIZE_DESC', LIST: 'NAME_ASC'},
    });
  });

  it('shares one filter between every consumer', async () => {
    const {result} = renderHook(
      () => ({gallery: useFiles(), list: useFiles()}),
      {wrapper},
    );
    await waitFor(() =>
      expect(result.current.gallery.preferencesLoaded).toBe(true),
    );

    act(() => result.current.gallery.setFilter('SYNCED'));

    expect(result.current.list.filter).toBe('SYNCED');
  });

  it('keeps a stable value while nothing changes', async () => {
    const {result, rerender} = await renderLoaded();
    const first = result.current;

    rerender({});

    expect(result.current).toBe(first);
  });

  it('after a remount: the stored view and sort come back, the filter is back at All', async () => {
    const first = await renderLoaded();
    act(() => {
      first.result.current.setView('LIST');
      first.result.current.setSort('LIST', 'SIZE_ASC');
      first.result.current.setFilter('SYNCED');
    });
    first.unmount();
    // What native stored from the writes above.
    getMock.mockResolvedValue(
      stored({view: 'LIST', gallerySort: 'TIME_DESC', listSort: 'SIZE_ASC'}),
    );

    const second = await renderLoaded();

    expect(second.result.current).toMatchObject({
      view: 'LIST',
      filter: 'ALL',
      sorts: {GALLERY: 'TIME_DESC', LIST: 'SIZE_ASC'},
    });
  });

  it('throws outside the provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => renderHook(() => useFiles())).toThrow(
        'useFiles must be used inside a FilesProvider',
      );
    } finally {
      spy.mockRestore();
    }
  });
});
