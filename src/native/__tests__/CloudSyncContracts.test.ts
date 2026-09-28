import * as fs from 'fs';
import * as path from 'path';

import type {
  LaunchSourcePickerResult,
  ListSourcesResult,
  SourceDto,
} from '../CloudSyncContracts';
import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  SOURCE_ERROR_TEXT,
  clampPageSize,
  isErrorResult,
} from '../CloudSyncContracts';

describe('CloudSync versioned contract', () => {
  it('exposes a stable positive contract version', () => {
    expect(CLOUD_SYNC_CONTRACT_VERSION).toBe(2);
    expect(Number.isInteger(CLOUD_SYNC_CONTRACT_VERSION)).toBe(true);
  });

  it('targets exactly one native module name', () => {
    expect(CLOUD_SYNC_MODULE_NAME).toBe('CloudSync');
  });

  it('bounds every catalog page across the bridge', () => {
    expect(MAX_PAGE_SIZE).toBe(200);
    expect(DEFAULT_PAGE_SIZE).toBeGreaterThanOrEqual(50);
    expect(DEFAULT_PAGE_SIZE).toBeLessThanOrEqual(100);
  });

  it('clamps requested page sizes into the supported range', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(null)).toBe(DEFAULT_PAGE_SIZE);
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(25)).toBe(25);
    expect(clampPageSize(5000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(Number.NaN)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('keeps stable machine-readable error codes', () => {
    expect(Object.values(CloudSyncErrorCode)).toEqual(
      expect.arrayContaining([
        'NOT_IMPLEMENTED',
        'NATIVE_MODULE_UNAVAILABLE',
        'INVALID_QUERY',
        'PAGE_TOKEN_MISMATCH',
        'SNAPSHOT_NOT_FOUND',
        'STALE_GENERATION',
        'INTERNAL_ERROR',
      ]),
    );
  });

  it('inserts the source error codes, in order, just before INTERNAL_ERROR', () => {
    expect(Object.values(CloudSyncErrorCode).slice(-6)).toEqual([
      'SOURCE_OVERLAP',
      'SOURCE_UNSUPPORTED',
      'SOURCE_REGRANT_MISMATCH',
      'SOURCE_NOT_FOUND',
      'PICKER_BUSY',
      'INTERNAL_ERROR',
    ]);
  });

  it('carries the exact message and action for each source error code', () => {
    expect(SOURCE_ERROR_TEXT).toEqual({
      SOURCE_OVERLAP: {
        message: 'This folder overlaps a folder you already added.',
        action: 'Pick a folder that is not inside, or around, an existing one.',
      },
      SOURCE_UNSUPPORTED: {
        message: 'Only folders on this device or its SD card can be added.',
        action: 'Pick a folder from internal storage or the SD card.',
      },
      SOURCE_REGRANT_MISMATCH: {
        message: 'That is a different folder from the one that lost access.',
        action: 'Pick the same folder again, or remove the source.',
      },
      SOURCE_NOT_FOUND: {
        message: 'That folder is no longer in your list.',
        action: 'Refresh the folder list.',
      },
      PICKER_BUSY: {
        message: 'The folder picker is already open.',
        action: 'Finish or close the picker, then try again.',
      },
    });
  });

  it('discriminates error envelopes from success envelopes', () => {
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {
          code: 'PAGE_TOKEN_MISMATCH',
          message: 'mismatch',
          action: null,
        },
      }),
    ).toBe(true);
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
      }),
    ).toBe(false);
  });

  it('describes sources without any native-only location field', () => {
    const source: SourceDto = {
      sourceId: 'src-1',
      alias: 'Camera',
      volumeLabel: 'Internal shared storage',
      displayPath: 'DCIM/Camera',
      isRemovable: false,
      canWrite: true,
      addedAtMillis: 1,
      availability: 'AVAILABLE',
    };
    const listed: ListSourcesResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'ok',
      sources: [source],
    };
    const cancelled: LaunchSourcePickerResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'ok',
      outcome: 'CANCELLED',
      source: null,
    };
    const overlap: LaunchSourcePickerResult = {
      contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
      status: 'error',
      error: {
        code: CloudSyncErrorCode.SOURCE_OVERLAP,
        message: SOURCE_ERROR_TEXT.SOURCE_OVERLAP.message,
        action: SOURCE_ERROR_TEXT.SOURCE_OVERLAP.action,
        conflictingSource: {sourceId: 'src-1', alias: 'Camera'},
      },
    };
    expect(isErrorResult(listed)).toBe(false);
    expect(isErrorResult(cancelled)).toBe(false);
    expect(isErrorResult(overlap)).toBe(true);

    const contract = fs.readFileSync(
      path.join(__dirname, '..', 'CloudSyncContracts.ts'),
      'utf8',
    );
    expect(contract).not.toMatch(/\btreeUri\b/);
    expect(contract).not.toMatch(/\bcanonicalRoot\b/);
  });
});
