import {TurboModuleRegistry} from 'react-native';

import {
  CloudSync,
  launchSourcePicker,
  listSources,
  queryFiles,
  removeSource,
} from '../CloudSync';
import {MAX_PAGE_SIZE} from '../CloudSyncContracts';
import type {Spec} from '../specs/NativeCloudSync';

describe('CloudSync typed wrapper', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports unavailability instead of throwing during detection', () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);
    expect(CloudSync.isAvailable()).toBe(false);
  });

  it('clamps page sizes before any native call', async () => {
    const queryFilesMock = jest.fn().mockResolvedValue({
      contractVersion: 1,
      status: 'ok',
      page: {entries: [], nextPageToken: null, counts: null},
    });
    jest
      .spyOn(TurboModuleRegistry, 'get')
      .mockReturnValue({queryFiles: queryFilesMock} as unknown as Spec);

    await queryFiles(
      'snapshot-1',
      {filter: 'ALL', view: 'LIST', sort: 'NAME_ASC', pageSize: 100000},
      null,
    );

    expect(queryFilesMock).toHaveBeenCalledWith(
      'snapshot-1',
      expect.objectContaining({pageSize: MAX_PAGE_SIZE}),
      null,
    );
  });

  it('passes native error envelopes through unchanged', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue({
      queryFiles: jest.fn().mockResolvedValue({
        contractVersion: 1,
        status: 'error',
        error: {
          code: 'PAGE_TOKEN_MISMATCH',
          message: 'Page token does not match the query.',
          action: 'RESTART_QUERY',
        },
      }),
    } as unknown as Spec);

    const result = await queryFiles('snapshot-1', {
      filter: 'SYNCED',
      view: 'LIST',
      sort: 'TIME_DESC',
    });

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('PAGE_TOKEN_MISMATCH');
      expect(result.error.action).toBe('RESTART_QUERY');
    }
  });

  it('throws a typed error when the native module is missing', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);
    await expect(CloudSync.getContractVersion()).rejects.toThrow(
      /CloudSync TurboModule is unavailable/,
    );
  });
});

const cameraSource = {
  sourceId: 'source-1',
  alias: 'Camera',
  volumeLabel: 'Internal shared storage',
  displayPath: 'SyncScopeE2E/Camera',
  isRemovable: false,
  canWrite: true,
  addedAtMillis: 1_700_000_000_000,
  availability: 'AVAILABLE',
};

function mockNative(methods: Record<string, jest.Mock>): void {
  jest
    .spyOn(TurboModuleRegistry, 'get')
    .mockReturnValue(methods as unknown as Spec);
}

describe('CloudSync source wrappers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('listSources', () => {
    it('normalises an ok envelope into ListSourcesOk', async () => {
      mockNative({
        listSources: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'ok',
          sources: [cameraSource],
        }),
      });

      const result = await listSources();

      expect(result).toEqual({
        contractVersion: 2,
        status: 'ok',
        sources: [cameraSource],
      });
    });

    it('treats a missing sources array as an empty list', async () => {
      mockNative({
        listSources: jest
          .fn()
          .mockResolvedValue({contractVersion: 2, status: 'ok'}),
      });

      const result = await listSources();

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.sources).toEqual([]);
      }
    });

    it('normalises an error envelope', async () => {
      mockNative({
        listSources: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'error',
          error: {code: 'INTERNAL_ERROR', message: 'Unexpected failure.'},
        }),
      });

      const result = await listSources();

      expect(result).toEqual({
        contractVersion: 2,
        status: 'error',
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Unexpected failure.',
          action: null,
          conflictingSource: null,
        },
      });
    });

    it('falls back to INTERNAL_ERROR when the error is untyped', async () => {
      mockNative({
        listSources: jest
          .fn()
          .mockResolvedValue({contractVersion: 2, status: 'error'}),
      });

      const result = await listSources();

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('launchSourcePicker', () => {
    it('passes null when no re-grant source is given', async () => {
      const launch = jest.fn().mockResolvedValue({
        contractVersion: 2,
        status: 'ok',
        outcome: 'ADDED',
        source: cameraSource,
      });
      mockNative({launchSourcePicker: launch});

      const result = await launchSourcePicker();

      expect(launch).toHaveBeenCalledWith(null);
      expect(result).toEqual({
        contractVersion: 2,
        status: 'ok',
        outcome: 'ADDED',
        source: cameraSource,
      });
    });

    it('passes the re-grant source ID through', async () => {
      const launch = jest.fn().mockResolvedValue({
        contractVersion: 2,
        status: 'ok',
        outcome: 'REGRANTED',
        source: cameraSource,
      });
      mockNative({launchSourcePicker: launch});

      const result = await launchSourcePicker('source-1');

      expect(launch).toHaveBeenCalledWith('source-1');
      expect(result.status === 'ok' && result.outcome).toBe('REGRANTED');
    });

    it('returns source: null on CANCELLED', async () => {
      mockNative({
        launchSourcePicker: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'ok',
          outcome: 'CANCELLED',
        }),
      });

      const result = await launchSourcePicker();

      expect(result).toEqual({
        contractVersion: 2,
        status: 'ok',
        outcome: 'CANCELLED',
        source: null,
      });
    });

    it('carries conflictingSource through on SOURCE_OVERLAP', async () => {
      mockNative({
        launchSourcePicker: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'error',
          error: {
            code: 'SOURCE_OVERLAP',
            message: 'This folder overlaps a folder you already added.',
            action:
              'Pick a folder that is not inside, or around, an existing one.',
            conflictingSource: {sourceId: 'source-1', alias: 'Camera'},
          },
        }),
      });

      const result = await launchSourcePicker();

      expect(result).toEqual({
        contractVersion: 2,
        status: 'error',
        error: {
          code: 'SOURCE_OVERLAP',
          message: 'This folder overlaps a folder you already added.',
          action:
            'Pick a folder that is not inside, or around, an existing one.',
          conflictingSource: {sourceId: 'source-1', alias: 'Camera'},
        },
      });
    });

    it('normalises other error envelopes without conflictingSource', async () => {
      mockNative({
        launchSourcePicker: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'error',
          error: {
            code: 'PICKER_BUSY',
            message: 'The folder picker is already open.',
            action: 'Finish or close the picker, then try again.',
          },
        }),
      });

      const result = await launchSourcePicker();

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('PICKER_BUSY');
        expect(result.error.conflictingSource).toBeNull();
      }
    });
  });

  describe('removeSource', () => {
    it('normalises a plain ok envelope', async () => {
      const remove = jest
        .fn()
        .mockResolvedValue({contractVersion: 2, status: 'ok', error: null});
      mockNative({removeSource: remove});

      const result = await removeSource('source-1');

      expect(remove).toHaveBeenCalledWith('source-1');
      expect(result).toEqual({contractVersion: 2, status: 'ok'});
    });

    it('normalises SOURCE_NOT_FOUND', async () => {
      mockNative({
        removeSource: jest.fn().mockResolvedValue({
          contractVersion: 2,
          status: 'error',
          error: {
            code: 'SOURCE_NOT_FOUND',
            message: 'That folder is no longer in your list.',
            action: 'Refresh the folder list.',
          },
        }),
      });

      const result = await removeSource('missing');

      expect(result).toEqual({
        contractVersion: 2,
        status: 'error',
        error: {
          code: 'SOURCE_NOT_FOUND',
          message: 'That folder is no longer in your list.',
          action: 'Refresh the folder list.',
          conflictingSource: null,
        },
      });
    });
  });
});
