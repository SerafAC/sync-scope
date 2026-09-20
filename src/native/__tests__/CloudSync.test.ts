import {TurboModuleRegistry} from 'react-native';

import {CloudSync, queryFiles} from '../CloudSync';
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
