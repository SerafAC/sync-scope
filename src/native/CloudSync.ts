import {TurboModuleRegistry} from 'react-native';

import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  clampPageSize,
  type CloudSyncError,
  type LaunchSourcePickerResult,
  type ListSourcesResult,
  type OperationError,
  type OperationResult,
  type QueryFilesResult,
  type QuerySpec,
  type SourceDto,
  type SourcePickerOutcome,
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

/**
 * Plain envelope as the generated bridge returns it. Source methods carry
 * payload fields (`sources`, `outcome`, `source`) beyond the Codegen
 * `OperationResultDto`, so they are read defensively here.
 */
type NativeEnvelope = {
  contractVersion?: number | null;
  status: string;
  error?: unknown;
  sources?: unknown;
  outcome?: unknown;
  source?: unknown;
};

type NativeErrorShape = {
  code?: unknown;
  message?: unknown;
  action?: unknown;
  conflictingSource?: {sourceId?: unknown; alias?: unknown} | null;
};

function contractVersionOf(result: NativeEnvelope): number {
  return typeof result.contractVersion === 'number'
    ? result.contractVersion
    : CLOUD_SYNC_CONTRACT_VERSION;
}

function normalizeOperationError(result: NativeEnvelope): OperationError {
  const nativeError = result.error as NativeErrorShape | null | undefined;
  if (nativeError == null || typeof nativeError.code !== 'string') {
    return {
      contractVersion: contractVersionOf(result),
      status: 'error',
      error: {
        code: CloudSyncErrorCode.INTERNAL_ERROR,
        message: 'Native operation failed without a typed error.',
        action: null,
        conflictingSource: null,
      },
    };
  }
  const conflict = nativeError.conflictingSource;
  const error: CloudSyncError = {
    code: nativeError.code,
    message: typeof nativeError.message === 'string' ? nativeError.message : '',
    action: typeof nativeError.action === 'string' ? nativeError.action : null,
    conflictingSource:
      conflict != null &&
      typeof conflict.sourceId === 'string' &&
      typeof conflict.alias === 'string'
        ? {sourceId: conflict.sourceId, alias: conflict.alias}
        : null,
  };
  return {contractVersion: contractVersionOf(result), status: 'error', error};
}

export async function listSources(): Promise<ListSourcesResult> {
  const result = (await nativeModule().listSources()) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    sources: Array.isArray(result.sources)
      ? (result.sources as SourceDto[])
      : [],
  };
}

/**
 * Opens the system folder picker. With [regrantSourceId] it re-grants that
 * source (the same folder only); without it the pick adds a new source.
 */
export async function launchSourcePicker(
  regrantSourceId?: string | null,
): Promise<LaunchSourcePickerResult> {
  const result = (await nativeModule().launchSourcePicker(
    regrantSourceId ?? null,
  )) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const outcome = result.outcome as SourcePickerOutcome;
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    outcome,
    source:
      outcome === 'CANCELLED' || result.source == null
        ? null
        : (result.source as SourceDto),
  };
}

export async function removeSource(sourceId: string): Promise<OperationResult> {
  const result = (await nativeModule().removeSource(
    sourceId,
  )) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {contractVersion: contractVersionOf(result), status: 'ok'};
}

export const CloudSync = {
  isAvailable: isCloudSyncAvailable,
  getContractVersion,
  queryFiles,
  queryTreeChildren,
  listSources,
  launchSourcePicker,
  removeSource,
};
