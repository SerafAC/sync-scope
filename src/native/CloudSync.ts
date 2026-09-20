import {TurboModuleRegistry} from 'react-native';

import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  clampPageSize,
  type QueryFilesResult,
  type QuerySpec,
} from './CloudSyncContracts';
import type {Spec} from './specs/NativeCloudSync';

/**
 * Typed client for the single generated CloudSync TurboModule. Presentation
 * code consumes this wrapper only; no ad hoc native module access elsewhere.
 */

function nativeModule(): Spec {
  const module = TurboModuleRegistry.get<Spec>(CLOUD_SYNC_MODULE_NAME);
  if (module == null) {
    throw new Error(
      `${CLOUD_SYNC_MODULE_NAME} TurboModule is unavailable on this platform`,
    );
  }
  return module;
}

export function isCloudSyncAvailable(): boolean {
  return TurboModuleRegistry.get<Spec>(CLOUD_SYNC_MODULE_NAME) != null;
}

export async function getContractVersion(): Promise<number> {
  return nativeModule().getContractVersion();
}

export async function queryFiles(
  snapshotId: string,
  querySpec: QuerySpec,
  pageToken?: string | null,
): Promise<QueryFilesResult> {
  const result = await nativeModule().queryFiles(
    snapshotId,
    {...querySpec, pageSize: clampPageSize(querySpec.pageSize)},
    pageToken ?? null,
  );
  return normalizePageResult(result);
}

export async function queryTreeChildren(
  snapshotId: string,
  parentId: string | null,
  querySpec: QuerySpec,
  pageToken?: string | null,
): Promise<QueryFilesResult> {
  const result = await nativeModule().queryTreeChildren(
    snapshotId,
    parentId,
    {...querySpec, pageSize: clampPageSize(querySpec.pageSize)},
    pageToken ?? null,
  );
  return normalizePageResult(result);
}

function normalizePageResult(result: {
  contractVersion: number;
  status: string;
  page?: unknown;
  error?: {code: string; message: string; action?: string | null} | null;
}): QueryFilesResult {
  // The generated bridge returns plain objects; re-tag them into the
  // discriminated union without trusting arbitrary fields.
  if (result.status === 'ok') {
    return result as QueryFilesResult;
  }
  const nativeError = result.error;
  return {
    contractVersion: result.contractVersion ?? CLOUD_SYNC_CONTRACT_VERSION,
    status: 'error',
    error:
      nativeError != null
        ? {
            code: nativeError.code,
            message: nativeError.message,
            action: nativeError.action ?? null,
          }
        : {
            code: CloudSyncErrorCode.INTERNAL_ERROR,
            message: 'Native query failed without a typed error.',
            action: null,
          },
  };
}

export const CloudSync = {
  isAvailable: isCloudSyncAvailable,
  getContractVersion,
  queryFiles,
  queryTreeChildren,
};
