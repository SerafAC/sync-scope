import React from 'react';
import {act, renderHook} from '@testing-library/react-native';

import {FilesProvider} from '../FilesProvider';
import {useFiles} from '../useFiles';

function wrapper({children}: {children: React.ReactNode}) {
  return <FilesProvider>{children}</FilesProvider>;
}

describe('FilesProvider', () => {
  it('starts on the gallery with every file shown', () => {
    const {result} = renderHook(() => useFiles(), {wrapper});

    expect(result.current.view).toBe('GALLERY');
    expect(result.current.filter).toBe('ALL');
  });

  it('changes the view and the filter independently', () => {
    const {result} = renderHook(() => useFiles(), {wrapper});

    act(() => result.current.setFilter('UNSYNCED'));
    expect(result.current).toMatchObject({view: 'GALLERY', filter: 'UNSYNCED'});

    act(() => result.current.setView('LIST'));
    expect(result.current).toMatchObject({view: 'LIST', filter: 'UNSYNCED'});

    act(() => result.current.setFilter('ISSUES_UNKNOWN'));
    expect(result.current).toMatchObject({
      view: 'LIST',
      filter: 'ISSUES_UNKNOWN',
    });
  });

  it('shares one filter between every consumer', () => {
    const {result} = renderHook(
      () => ({gallery: useFiles(), list: useFiles()}),
      {wrapper},
    );

    act(() => result.current.gallery.setFilter('SYNCED'));

    expect(result.current.list.filter).toBe('SYNCED');
  });

  it('keeps a stable value while nothing changes', () => {
    const {result, rerender} = renderHook(() => useFiles(), {wrapper});
    const first = result.current;

    rerender({});

    expect(result.current).toBe(first);
  });

  it('is not persisted: a new provider starts again from the defaults', () => {
    const first = renderHook(() => useFiles(), {wrapper});
    act(() => {
      first.result.current.setView('LIST');
      first.result.current.setFilter('SYNCED');
    });
    first.unmount();

    const second = renderHook(() => useFiles(), {wrapper});

    expect(second.result.current).toMatchObject({
      view: 'GALLERY',
      filter: 'ALL',
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
