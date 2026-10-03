import {TurboModuleRegistry} from 'react-native';

import {
  CloudSync,
  approveSftpHostKey,
  cancelScan,
  getLocalImageHandle,
  getRepositorySummary,
  getScanState,
  launchSourcePicker,
  listSelectableEntries,
  listSources,
  queryFiles,
  rejectSftpHostKey,
  removeSource,
  saveRepository,
  startScan,
  testRepository,
} from '../CloudSync';
import {
  CLOUD_SYNC_CONTRACT_VERSION,
  GALLERY_THUMBNAIL_EDGE_PX,
  IMAGE_ERROR_TEXT,
  LOCAL_IMAGE_MAX_EDGE_PX,
  LOCAL_IMAGE_MIN_EDGE_PX,
  MAX_PAGE_SIZE,
} from '../CloudSyncContracts';
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

const runningRun = {
  runId: 'run-1',
  generation: 4,
  mode: 'FULL',
  phase: 'LISTING_REMOTE',
  terminalState: null,
  startedAtMillis: 1_700_000_000_000,
  finishedAtMillis: null,
  progress: {
    remoteDirectoriesListed: 2,
    remoteFilesListed: 10,
    localFilesEnumerated: 0,
    localFilesMatched: 0,
  },
  error: null,
  cancelReason: null,
};

const activeSnapshot = {
  snapshotId: 'snap-1',
  completedAtMillis: 1_700_000_100_000,
  remoteListedAtMillis: 1_700_000_050_000,
  precisionMillis: 1000,
  configRevision: 2,
  coverage: 'COMPLETE',
  summary: {
    synced: 4,
    unsynced: 3,
    unknown: 0,
    unreadableRemoteDirectories: 0,
    remoteListingInterruptedBy: null,
    skippedSources: [],
  },
};

const scanInProgress = {
  contractVersion: 3,
  status: 'error',
  error: {
    code: 'SCAN_IN_PROGRESS',
    message: 'A scan is already running.',
    action: 'Wait for it to finish, or cancel it.',
  },
};

describe('CloudSync scan wrappers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('startScan', () => {
    it('passes null when no mode is given and normalises ok', async () => {
      const native = jest.fn().mockResolvedValue({
        contractVersion: 3,
        status: 'ok',
        runId: 'run-1',
        generation: 4,
        stray: 'ignored',
      });
      mockNative({startScan: native});

      const result = await startScan();

      expect(native).toHaveBeenCalledWith(null);
      expect(result).toEqual({
        contractVersion: 3,
        status: 'ok',
        runId: 'run-1',
        generation: 4,
      });
    });

    it('passes the mode through', async () => {
      const native = jest.fn().mockResolvedValue({
        contractVersion: 3,
        status: 'ok',
        runId: 'run-2',
        generation: 5,
      });
      mockNative({startScan: native});

      await startScan('LOCAL_REFRESH');
      await startScan('FULL');

      expect(native).toHaveBeenNthCalledWith(1, 'LOCAL_REFRESH');
      expect(native).toHaveBeenNthCalledWith(2, 'FULL');
    });

    it('normalises an error envelope', async () => {
      mockNative({startScan: jest.fn().mockResolvedValue(scanInProgress)});

      expect(await startScan('FULL')).toEqual({
        contractVersion: 3,
        status: 'error',
        error: {
          code: 'SCAN_IN_PROGRESS',
          message: 'A scan is already running.',
          action: 'Wait for it to finish, or cancel it.',
          conflictingSource: null,
        },
      });
    });

    it('treats an ok envelope without a run ID as INTERNAL_ERROR', async () => {
      mockNative({
        startScan: jest
          .fn()
          .mockResolvedValue({contractVersion: 3, status: 'ok'}),
      });

      const result = await startScan();

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('INTERNAL_ERROR');
      }
    });
  });

  describe('cancelScan', () => {
    it('passes the run ID and normalises ok', async () => {
      const native = jest
        .fn()
        .mockResolvedValue({contractVersion: 3, status: 'ok'});
      mockNative({cancelScan: native});

      expect(await cancelScan('run-1')).toEqual({
        contractVersion: 3,
        status: 'ok',
      });
      expect(native).toHaveBeenCalledWith('run-1');
    });

    it('normalises SCAN_NOT_FOUND', async () => {
      mockNative({
        cancelScan: jest.fn().mockResolvedValue({
          contractVersion: 3,
          status: 'error',
          error: {
            code: 'SCAN_NOT_FOUND',
            message: 'That scan is no longer known.',
            action: 'Refresh the scan screen.',
          },
        }),
      });

      const result = await cancelScan('gone');

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('SCAN_NOT_FOUND');
        expect(result.error.action).toBe('Refresh the scan screen.');
      }
    });
  });

  describe('getScanState', () => {
    it('normalises an ok envelope with a run and an active snapshot', async () => {
      mockNative({
        getScanState: jest.fn().mockResolvedValue({
          contractVersion: 3,
          status: 'ok',
          run: runningRun,
          active: activeSnapshot,
        }),
      });

      expect(await getScanState()).toEqual({
        contractVersion: 3,
        status: 'ok',
        run: runningRun,
        active: activeSnapshot,
      });
    });

    it('parses the active snapshot configRevision (contract v5)', async () => {
      mockNative({
        getScanState: jest.fn().mockResolvedValue({
          contractVersion: 5,
          status: 'ok',
          run: null,
          active: {...activeSnapshot, configRevision: 7},
        }),
      });

      const result = await getScanState();

      expect(result.status).toBe('ok');
      if (result.status === 'ok') {
        expect(result.active?.configRevision).toBe(7);
      }
    });

    it('reads a missing or malformed configRevision as 0, never undefined', async () => {
      for (const configRevision of [undefined, null, '7']) {
        mockNative({
          getScanState: jest.fn().mockResolvedValue({
            contractVersion: 5,
            status: 'ok',
            run: null,
            active: {...activeSnapshot, configRevision},
          }),
        });

        const result = await getScanState();

        expect(result.status).toBe('ok');
        if (result.status === 'ok') {
          expect(result.active?.configRevision).toBe(0);
        }
      }
    });

    it('maps missing run and active to null', async () => {
      mockNative({
        getScanState: jest
          .fn()
          .mockResolvedValue({contractVersion: 3, status: 'ok'}),
      });

      expect(await getScanState()).toEqual({
        contractVersion: 3,
        status: 'ok',
        run: null,
        active: null,
      });
    });

    it('normalises an error envelope', async () => {
      mockNative({
        getScanState: jest.fn().mockResolvedValue({
          contractVersion: 3,
          status: 'error',
          error: {code: 'INTERNAL_ERROR', message: 'Something failed.'},
        }),
      });

      const result = await getScanState();

      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('INTERNAL_ERROR');
        expect(result.error.action).toBeNull();
      }
    });
  });

  it('resolves NATIVE_MODULE_UNAVAILABLE when the module is missing', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);

    for (const result of [
      await startScan(),
      await cancelScan('run-1'),
      await getScanState(),
    ]) {
      expect(result.status).toBe('error');
      if (result.status === 'error') {
        expect(result.error.code).toBe('NATIVE_MODULE_UNAVAILABLE');
      }
    }
  });
});

describe('CloudSync getLocalImageHandle wrapper (contract v4)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const v = CLOUD_SYNC_CONTRACT_VERSION;

  it('passes the IDs and the edge through and normalises ok', async () => {
    const native = jest.fn().mockResolvedValue({
      contractVersion: v,
      status: 'ok',
      handle: {uri: 'file:///cache/thumbnails/e-1_256.jpg', stray: 'ignored'},
      stray: 'ignored',
    });
    mockNative({getLocalImageHandle: native});

    const result = await getLocalImageHandle('snap-1', 'e-1', {
      maxEdgePx: GALLERY_THUMBNAIL_EDGE_PX,
    });

    expect(native).toHaveBeenCalledWith('snap-1', 'e-1', {maxEdgePx: 256});
    expect(result).toEqual({
      contractVersion: v,
      status: 'ok',
      handle: {uri: 'file:///cache/thumbnails/e-1_256.jpg'},
    });
  });

  it('normalises an IMAGE_UNAVAILABLE error envelope', async () => {
    mockNative({
      getLocalImageHandle: jest.fn().mockResolvedValue({
        contractVersion: v,
        status: 'error',
        error: {
          code: 'IMAGE_UNAVAILABLE',
          ...IMAGE_ERROR_TEXT.IMAGE_UNAVAILABLE,
        },
      }),
    });

    expect(
      await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 256}),
    ).toEqual({
      contractVersion: v,
      status: 'error',
      error: {
        code: 'IMAGE_UNAVAILABLE',
        message: 'This image could not be read on the device.',
        action: 'Check that the folder is still available, then rescan.',
        conflictingSource: null,
      },
    });
  });

  it.each([
    ['an ok envelope without a handle', {contractVersion: v, status: 'ok'}],
    [
      'an ok envelope with a non-string uri',
      {contractVersion: v, status: 'ok', handle: {uri: 42}},
    ],
    ['an error envelope without a code', {contractVersion: v, status: 'error'}],
    ['a null result', null],
    ['a non-object result', 'ok'],
  ])('turns %s into a typed INTERNAL_ERROR', async (_label, envelope) => {
    mockNative({getLocalImageHandle: jest.fn().mockResolvedValue(envelope)});

    const result = await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 256});

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.contractVersion).toBe(v);
    }
  });

  it('turns a rejected native call into INTERNAL_ERROR instead of throwing', async () => {
    mockNative({
      getLocalImageHandle: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 256});

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('clamps the requested edge before the native call', async () => {
    const native = jest.fn().mockResolvedValue({
      contractVersion: v,
      status: 'ok',
      handle: {uri: 'file:///cache/thumbnails/e-1.jpg'},
    });
    mockNative({getLocalImageHandle: native});

    await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 10});
    await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 9999});
    await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: Number.NaN});
    await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 512.7});

    expect(native.mock.calls.map(call => call[2])).toEqual([
      {maxEdgePx: LOCAL_IMAGE_MIN_EDGE_PX},
      {maxEdgePx: LOCAL_IMAGE_MAX_EDGE_PX},
      {maxEdgePx: GALLERY_THUMBNAIL_EDGE_PX},
      {maxEdgePx: 512},
    ]);
  });

  it('resolves NATIVE_MODULE_UNAVAILABLE when the module is missing', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);

    const result = await getLocalImageHandle('snap-1', 'e-1', {maxEdgePx: 256});

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('NATIVE_MODULE_UNAVAILABLE');
    }
  });
});

describe('CloudSync listSelectableEntries wrapper (contract v5)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const v = CLOUD_SYNC_CONTRACT_VERSION;
  const gallery = {filter: 'ALL', view: 'GALLERY', sort: 'NAME_ASC'} as const;
  const wire = {
    entryIds: ['e-1', 'e-2', 'e-3'],
    sizes: [70, -1, 0],
    statuses: ['SYNCED', 'UNKNOWN', 'UNSYNCED'],
    images: [true, true, false],
  };

  it('passes the snapshot and query through and maps -1 to null', async () => {
    const native = jest.fn().mockResolvedValue({
      contractVersion: v,
      status: 'ok',
      selectable: {...wire, stray: 'ignored'},
    });
    mockNative({listSelectableEntries: native});

    const result = await listSelectableEntries('snap-1', gallery);

    expect(native).toHaveBeenCalledWith('snap-1', gallery);
    expect(result).toEqual({
      contractVersion: v,
      status: 'ok',
      selectable: {
        entryIds: ['e-1', 'e-2', 'e-3'],
        sizes: [70, null, 0],
        statuses: ['SYNCED', 'UNKNOWN', 'UNSYNCED'],
        images: [true, true, false],
      },
    });
  });

  it('accepts an empty selection', async () => {
    mockNative({
      listSelectableEntries: jest.fn().mockResolvedValue({
        contractVersion: v,
        status: 'ok',
        selectable: {entryIds: [], sizes: [], statuses: [], images: []},
      }),
    });

    const result = await listSelectableEntries('snap-1', gallery);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.selectable.entryIds).toEqual([]);
    }
  });

  it('normalises a STALE_GENERATION error envelope', async () => {
    mockNative({
      listSelectableEntries: jest.fn().mockResolvedValue({
        contractVersion: v,
        status: 'error',
        error: {
          code: 'STALE_GENERATION',
          message: 'These results were replaced by a newer scan.',
          action: 'Select the files again.',
        },
      }),
    });

    expect(await listSelectableEntries('snap-1', gallery)).toEqual({
      contractVersion: v,
      status: 'error',
      error: {
        code: 'STALE_GENERATION',
        message: 'These results were replaced by a newer scan.',
        action: 'Select the files again.',
        conflictingSource: null,
      },
    });
  });

  it.each([
    ['sizes shorter than entryIds', {...wire, sizes: [70, -1]}],
    ['statuses longer than entryIds', {...wire, statuses: [...wire.statuses, 'SYNCED']}],
    ['images shorter than entryIds', {...wire, images: [true]}],
    ['a missing array', {entryIds: wire.entryIds, sizes: wire.sizes, statuses: wire.statuses}],
    ['an unknown status', {...wire, statuses: ['SYNCED', 'DELETED', 'UNSYNCED']}],
    ['a non-numeric size', {...wire, sizes: [70, '1', 0]}],
    ['a non-string entryId', {...wire, entryIds: ['e-1', 2, 'e-3']}],
    ['a non-boolean image flag', {...wire, images: [true, 1, false]}],
    ['no selectable payload', undefined],
  ])('turns %s into a typed INTERNAL_ERROR', async (_label, selectable) => {
    mockNative({
      listSelectableEntries: jest
        .fn()
        .mockResolvedValue({contractVersion: v, status: 'ok', selectable}),
    });

    const result = await listSelectableEntries('snap-1', gallery);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INTERNAL_ERROR');
      expect(result.contractVersion).toBe(v);
    }
  });

  it('turns a rejected native call into INTERNAL_ERROR instead of throwing', async () => {
    mockNative({
      listSelectableEntries: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await listSelectableEntries('snap-1', gallery);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('INTERNAL_ERROR');
    }
  });

  it('resolves NATIVE_MODULE_UNAVAILABLE when the module is missing', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);

    const result = await listSelectableEntries('snap-1', gallery);

    expect(result.status).toBe('error');
    if (result.status === 'error') {
      expect(result.error.code).toBe('NATIVE_MODULE_UNAVAILABLE');
    }
  });
});

describe('CloudSync repository wrappers (contract v5)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const summary = {
    protocol: 'WEBDAV',
    host: 'nas.local',
    port: 443,
    username: 'alice',
    remoteRoot: '/photos',
    precisionMillis: null,
    credentialPresent: true,
    hostKeyTrusted: null,
    revision: 3,
    webdavHttps: true,
  };

  it('saveRepository sends webdavHttps and the typed password', async () => {
    const save = jest.fn().mockResolvedValue({contractVersion: 5, status: 'ok'});
    mockNative({saveRepository: save});

    const result = await saveRepository(
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

    expect(result).toEqual({contractVersion: 5, status: 'ok'});
    expect(save).toHaveBeenCalledWith(
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
  });

  it('saveRepository sends webdavHttps false when absent and null for an empty password', async () => {
    const save = jest.fn().mockResolvedValue({contractVersion: 5, status: 'ok'});
    mockNative({saveRepository: save});

    await saveRepository(
      {protocol: 'FTP', host: 'h', port: 21, username: 'u', remoteRoot: '/'},
      '',
    );

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({webdavHttps: false}),
      null,
    );
  });

  it('keeps a known error field and drops an unknown one', async () => {
    const error = (field: unknown) => ({
      contractVersion: 5,
      status: 'error',
      error: {
        code: 'INVALID_QUERY',
        message: 'The repository port is invalid.',
        action: 'Correct the port and save again.',
        field,
      },
    });
    const save = jest
      .fn()
      .mockResolvedValueOnce(error('port'))
      .mockResolvedValueOnce(error('webdavHttps'));
    mockNative({saveRepository: save});
    const config = {
      protocol: 'FTP' as const,
      host: 'h',
      port: 0,
      username: 'u',
      remoteRoot: '/',
    };

    const known = await saveRepository(config, 'p');
    const unknown = await saveRepository(config, 'p');

    expect(known.status === 'error' && known.error.field).toBe('port');
    expect(unknown.status === 'error' && unknown.error.field).toBeUndefined();
    expect(unknown.status === 'error' && unknown.error.code).toBe(
      'INVALID_QUERY',
    );
  });

  it('getRepositorySummary reads revision and webdavHttps', async () => {
    mockNative({
      getRepositorySummary: jest
        .fn()
        .mockResolvedValue({contractVersion: 5, status: 'ok', repository: summary}),
    });

    const result = await getRepositorySummary();

    expect(result).toEqual({contractVersion: 5, status: 'ok', repository: summary});
  });

  it('getRepositorySummary defaults a missing revision and webdavHttps', async () => {
    const older: Record<string, unknown> = {...summary};
    delete older.revision;
    delete older.webdavHttps;
    mockNative({
      getRepositorySummary: jest.fn().mockResolvedValue({
        contractVersion: 5,
        status: 'ok',
        repository: {...older, protocol: 'SFTP', hostKeyTrusted: false},
      }),
    });

    const result = await getRepositorySummary();

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.repository.revision).toBe(0);
      expect(result.repository.webdavHttps).toBe(false);
      expect(result.repository.hostKeyTrusted).toBe(false);
    }
  });

  it('getRepositorySummary passes REPOSITORY_NOT_CONFIGURED through', async () => {
    mockNative({
      getRepositorySummary: jest.fn().mockResolvedValue({
        contractVersion: 5,
        status: 'error',
        error: {
          code: 'REPOSITORY_NOT_CONFIGURED',
          message: 'No repository has been set up yet.',
          action: 'Set up your server in Settings › Repository.',
        },
      }),
    });

    const result = await getRepositorySummary();

    expect(result.status === 'error' && result.error.code).toBe(
      'REPOSITORY_NOT_CONFIGURED',
    );
  });

  it('getRepositorySummary treats a malformed repository as INTERNAL_ERROR', async () => {
    mockNative({
      getRepositorySummary: jest
        .fn()
        .mockResolvedValue({contractVersion: 5, status: 'ok', repository: {}}),
    });

    const result = await getRepositorySummary();

    expect(result.status === 'error' && result.error.code).toBe('INTERNAL_ERROR');
  });

  it('testRepository returns the connection and carries a host-key challenge', async () => {
    const connection = {
      protocol: 'SFTP',
      reachable: true,
      entryCount: 4,
      precisionMillis: 1000,
      precisionBasis: 'SFTP_V3_WHOLE_SECONDS',
      precisionPersisted: true,
    };
    const challenge = {
      challengeId: 'c-1',
      host: 'nas.local',
      port: 22,
      algorithm: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
      previousFingerprint: null,
    };
    mockNative({
      testRepository: jest
        .fn()
        .mockResolvedValueOnce({contractVersion: 5, status: 'ok', connection})
        .mockResolvedValueOnce({
          contractVersion: 5,
          status: 'error',
          error: {
            code: 'SFTP_HOST_KEY_UNVERIFIED',
            message: 'The server key is not trusted yet.',
            action: null,
            hostKeyChallenge: challenge,
          },
        }),
    });

    const ok = await testRepository();
    const prompt = await testRepository();

    expect(ok).toEqual({contractVersion: 5, status: 'ok', connection});
    expect(prompt.status === 'error' && prompt.error.hostKeyChallenge).toEqual(
      challenge,
    );
  });

  it('approve and reject pass the challenge ID through', async () => {
    const approve = jest.fn().mockResolvedValue({contractVersion: 5, status: 'ok'});
    const reject = jest.fn().mockResolvedValue({contractVersion: 5, status: 'ok'});
    mockNative({approveSftpHostKey: approve, rejectSftpHostKey: reject});

    expect((await approveSftpHostKey('c-1')).status).toBe('ok');
    expect((await rejectSftpHostKey('c-2')).status).toBe('ok');
    expect(approve).toHaveBeenCalledWith('c-1');
    expect(reject).toHaveBeenCalledWith('c-2');
  });

  it('resolves NATIVE_MODULE_UNAVAILABLE when the module is missing', async () => {
    jest.spyOn(TurboModuleRegistry, 'get').mockReturnValue(null);

    for (const result of [
      await getRepositorySummary(),
      await saveRepository({
        protocol: 'FTP',
        host: 'h',
        port: null,
        username: 'u',
        remoteRoot: '/',
      }),
      await testRepository(),
      await approveSftpHostKey('c'),
      await rejectSftpHostKey('c'),
    ]) {
      expect(result.status === 'error' && result.error.code).toBe(
        'NATIVE_MODULE_UNAVAILABLE',
      );
    }
  });
});
