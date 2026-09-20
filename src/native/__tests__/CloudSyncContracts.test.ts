import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPageSize,
  isErrorResult,
} from '../CloudSyncContracts';

describe('CloudSync versioned contract', () => {
  it('exposes a stable positive contract version', () => {
    expect(CLOUD_SYNC_CONTRACT_VERSION).toBe(1);
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

  it('discriminates error envelopes from success envelopes', () => {
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'error',
        error: {code: 'PAGE_TOKEN_MISMATCH', message: 'mismatch', action: null},
      }),
    ).toBe(true);
    expect(
      isErrorResult({
        contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
        status: 'ok',
      }),
    ).toBe(false);
  });
});
