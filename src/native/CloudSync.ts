import {TurboModuleRegistry} from 'react-native';

import {
  CLOUD_SYNC_CONTRACT_VERSION,
  CLOUD_SYNC_MODULE_NAME,
  CloudSyncErrorCode,
  REPOSITORY_FIELDS,
  clampImageEdge,
  clampPageSize,
  type CloudSyncError,
  type DeletionFailureDto,
  type DeletionFailureReason,
  type DeletionPlanDto,
  type DeletionResultDto,
  type ExecuteLocalDeletionResult,
  type FileStatus,
  type HostKeyChallengeDto,
  type LaunchSourcePickerResult,
  type ListSourcesResult,
  type LocalImageHandleResult,
  type LocalImageSpec,
  type OperationError,
  type OperationResult,
  type PrepareLocalDeletionResult,
  type QueryFilesResult,
  type QuerySpec,
  type RepositoryConfigInput,
  type RepositoryConnectionDto,
  type RepositoryField,
  type RepositorySummaryDto,
  type RepositorySummaryResult,
  type ActiveSnapshotDto,
  type ScanMode,
  type ScanRunDto,
  type ScanStateResult,
  type SelectableEntries,
  type SelectableEntriesResult,
  type SourceDto,
  type SourcePickerOutcome,
  type StartScanResult,
  type TestRepositoryResult,
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
  runId?: unknown;
  generation?: unknown;
  run?: unknown;
  active?: unknown;
  handle?: unknown;
  selectable?: unknown;
  repository?: unknown;
  connection?: unknown;
  plan?: unknown;
  result?: unknown;
};

type NativeErrorShape = {
  code?: unknown;
  message?: unknown;
  action?: unknown;
  conflictingSource?: {sourceId?: unknown; alias?: unknown} | null;
  hostKeyChallenge?: unknown;
  field?: unknown;
};

function isRepositoryField(value: unknown): value is RepositoryField {
  return (REPOSITORY_FIELDS as readonly unknown[]).includes(value);
}

function hostKeyChallengeOf(value: unknown): HostKeyChallengeDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const c = value as Record<string, unknown>;
  if (
    typeof c.challengeId !== 'string' ||
    typeof c.host !== 'string' ||
    typeof c.port !== 'number' ||
    typeof c.algorithm !== 'string' ||
    typeof c.fingerprint !== 'string'
  ) {
    return null;
  }
  return {
    challengeId: c.challengeId,
    host: c.host,
    port: c.port,
    algorithm: c.algorithm,
    fingerprint: c.fingerprint,
    previousFingerprint:
      typeof c.previousFingerprint === 'string' ? c.previousFingerprint : null,
  };
}

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
  // Kept only when typed: an unknown field name never reaches the form.
  if (isRepositoryField(nativeError.field)) {
    error.field = nativeError.field;
  }
  const challenge = hostKeyChallengeOf(nativeError.hostKeyChallenge);
  if (challenge != null) {
    error.hostKeyChallenge = challenge;
  }
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

/**
 * Scan methods resolve an envelope even without the native module, so a
 * polling screen never has to catch: the error is NATIVE_MODULE_UNAVAILABLE.
 */
function scanModule(): Spec | null {
  return TurboModuleRegistry.get<Spec>(CLOUD_SYNC_MODULE_NAME) ?? null;
}

function moduleUnavailable(): OperationError {
  return {
    contractVersion: CLOUD_SYNC_CONTRACT_VERSION,
    status: 'error',
    error: {
      code: CloudSyncErrorCode.NATIVE_MODULE_UNAVAILABLE,
      message: 'The scan service is not available.',
      action: 'Restart the app.',
      conflictingSource: null,
    },
  };
}

/**
 * Starts a scan run. A missing [mode] is sent as null, which native treats as
 * FULL. Connection and listing failures end the run later; they are read from
 * getScanState, never from this result.
 */
export async function startScan(mode?: ScanMode): Promise<StartScanResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.startScan(mode ?? null)) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  if (typeof result.runId !== 'string' || typeof result.generation !== 'number') {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    runId: result.runId,
    generation: result.generation,
  };
}

/** Cancels the run [runId]; idempotent for a run that already ended. */
export async function cancelScan(runId: string): Promise<OperationResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.cancelScan(runId)) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {contractVersion: contractVersionOf(result), status: 'ok'};
}

/** The running run (else the latest one) and the active snapshot; safe to poll. */
export async function getScanState(): Promise<ScanStateResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.getScanState()) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    run: result.run != null ? (result.run as ScanRunDto) : null,
    active: activeSnapshotOf(result.active),
  };
}

/**
 * The active snapshot as native sends it. `configRevision` (contract v5) is read
 * defensively: a missing or malformed value is 0, a revision no saved repository
 * has (they start at 1), so the Scan tab suggests a rescan rather than trusting it.
 */
function activeSnapshotOf(value: unknown): ActiveSnapshotDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const active = value as ActiveSnapshotDto & {configRevision?: unknown};
  return {
    ...active,
    configRevision:
      typeof active.configRevision === 'number' ? active.configRevision : 0,
  };
}

/**
 * A local-only, downscaled JPEG of the image [entryId] of snapshot [snapshotId] (contract v4).
 * `spec.maxEdgePx` is clamped to LOCAL_IMAGE_MIN_EDGE_PX..LOCAL_IMAGE_MAX_EDGE_PX before the call.
 * Resolves an envelope for every outcome: a missing module, a rejected call or an unexpected
 * shape becomes a typed error, never a throw.
 */
export async function getLocalImageHandle(
  snapshotId: string,
  entryId: string,
  spec: LocalImageSpec,
): Promise<LocalImageHandleResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  let result: NativeEnvelope | null | undefined;
  try {
    result = (await module.getLocalImageHandle(snapshotId, entryId, {
      maxEdgePx: clampImageEdge(spec.maxEdgePx),
    })) as NativeEnvelope | null | undefined;
  } catch {
    result = null;
  }
  if (result == null || typeof result !== 'object') {
    return normalizeOperationError({status: 'error', error: null});
  }
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const handle = result.handle as {uri?: unknown} | null | undefined;
  if (handle == null || typeof handle.uri !== 'string') {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    handle: {uri: handle.uri},
  };
}

/**
 * Every FILE row [querySpec] would show in the active snapshot [snapshotId], for
 * "Select all" (contract v5). Native ignores `pageSize`, `sort` and `search`; a
 * LIST query needs its `sourceId` and `parentId` (null: the source's top level).
 * The four arrays must be parallel: a length mismatch or a malformed value is
 * INTERNAL_ERROR, never a partial selection. An unknown size (`-1`) becomes null.
 */
export async function listSelectableEntries(
  snapshotId: string,
  querySpec: QuerySpec,
): Promise<SelectableEntriesResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  let result: NativeEnvelope | null | undefined;
  try {
    result = (await module.listSelectableEntries(
      snapshotId,
      querySpec,
    )) as NativeEnvelope | null | undefined;
  } catch {
    result = null;
  }
  if (result == null || typeof result !== 'object') {
    return normalizeOperationError({status: 'error', error: null});
  }
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const selectable = selectableEntriesOf(result.selectable);
  if (selectable == null) {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {contractVersion: contractVersionOf(result), status: 'ok', selectable};
}

const FILE_STATUSES: readonly unknown[] = [
  'SYNCED',
  'UNSYNCED',
  'UNKNOWN',
] satisfies FileStatus[];

function selectableEntriesOf(value: unknown): SelectableEntries | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const {entryIds, sizes, statuses, images} = value as Record<string, unknown>;
  if (
    !Array.isArray(entryIds) ||
    !Array.isArray(sizes) ||
    !Array.isArray(statuses) ||
    !Array.isArray(images)
  ) {
    return null;
  }
  const count = entryIds.length;
  if (
    sizes.length !== count ||
    statuses.length !== count ||
    images.length !== count ||
    !entryIds.every(id => typeof id === 'string') ||
    !sizes.every(size => typeof size === 'number' && Number.isFinite(size)) ||
    !statuses.every(status => FILE_STATUSES.includes(status)) ||
    !images.every(image => typeof image === 'boolean')
  ) {
    return null;
  }
  return {
    entryIds: entryIds as string[],
    sizes: (sizes as number[]).map(size => (size < 0 ? null : size)),
    statuses: statuses as FileStatus[],
    images: images as boolean[],
  };
}

/**
 * Calls one scan-module method and returns its envelope, or null when the call
 * rejected or resolved something that is not an object. Null module: null too,
 * so callers check [scanModule] first to report NATIVE_MODULE_UNAVAILABLE.
 */
async function callEnvelope(
  call: (module: Spec) => Promise<unknown>,
  module: Spec,
): Promise<NativeEnvelope | null> {
  let result: unknown;
  try {
    result = await call(module);
  } catch {
    return null;
  }
  return result != null && typeof result === 'object'
    ? (result as NativeEnvelope)
    : null;
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isTotals(value: unknown): value is {count: number; bytes: number} {
  if (value == null || typeof value !== 'object') {
    return false;
  }
  const {count, bytes} = value as Record<string, unknown>;
  return isCount(count) && isCount(bytes);
}

function deletionPlanOf(value: unknown): DeletionPlanDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  const refused = v.refused as Record<string, unknown> | null | undefined;
  if (
    typeof v.planToken !== 'string' ||
    v.planToken.length === 0 ||
    !isTotals(v.toDelete) ||
    !isTotals(v.unsynced) ||
    refused == null ||
    typeof refused !== 'object' ||
    !isCount(refused.count) ||
    !isCount(refused.scanTooOld) ||
    !isCount(v.movedByRecheck) ||
    !isCount(v.missing) ||
    !isCount(v.unknownSizeCount) ||
    !isCount(v.remoteListedAtMillis)
  ) {
    return null;
  }
  return {
    planToken: v.planToken,
    toDelete: {count: v.toDelete.count, bytes: v.toDelete.bytes},
    unsynced: {count: v.unsynced.count, bytes: v.unsynced.bytes},
    refused: {count: refused.count, scanTooOld: refused.scanTooOld},
    movedByRecheck: v.movedByRecheck,
    missing: v.missing,
    unknownSizeCount: v.unknownSizeCount,
    remoteListedAtMillis: v.remoteListedAtMillis,
  };
}

const DELETION_FAILURE_REASONS: readonly unknown[] = [
  'ALREADY_GONE',
  'CHANGED',
  'ACCESS_LOST',
  'FAILED',
] satisfies DeletionFailureReason[];

function deletionFailureOf(value: unknown): DeletionFailureDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const {entryId, name, reason} = value as Record<string, unknown>;
  if (
    typeof entryId !== 'string' ||
    typeof name !== 'string' ||
    !DELETION_FAILURE_REASONS.includes(reason)
  ) {
    return null;
  }
  return {entryId, name, reason: reason as DeletionFailureReason};
}

function deletionResultOf(value: unknown): DeletionResultDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const v = value as Record<string, unknown>;
  if (
    !isCount(v.deleted) ||
    !isCount(v.freedBytes) ||
    !Array.isArray(v.failures) ||
    !Array.isArray(v.removedEntryIds) ||
    !v.removedEntryIds.every(id => typeof id === 'string')
  ) {
    return null;
  }
  const failures = v.failures.map(deletionFailureOf);
  if (failures.some(failure => failure == null)) {
    return null;
  }
  return {
    deleted: v.deleted,
    freedBytes: v.freedBytes,
    failures: failures as DeletionFailureDto[],
    removedEntryIds: v.removedEntryIds as string[],
  };
}

/**
 * Re-checks the selected [entryIds] of the active snapshot on the server and
 * returns a single-use plan (contract v5). Nothing is deleted. A malformed plan
 * is INTERNAL_ERROR, never a partial one.
 */
export async function prepareLocalDeletion(
  snapshotId: string,
  entryIds: readonly string[],
): Promise<PrepareLocalDeletionResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = await callEnvelope(
    m => m.prepareLocalDeletion(snapshotId, [...entryIds]),
    module,
  );
  if (result == null) {
    return normalizeOperationError({status: 'error', error: null});
  }
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const plan = deletionPlanOf(result.plan);
  if (plan == null) {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {contractVersion: contractVersionOf(result), status: 'ok', plan};
}

/**
 * Runs the plan [planToken] (contract v5). Not-backed-up files are deleted only
 * when [includeUnsynced] is true; unknown-state files never are. An error means
 * nothing was deleted.
 */
export async function executeLocalDeletion(
  planToken: string,
  includeUnsynced: boolean,
): Promise<ExecuteLocalDeletionResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = await callEnvelope(
    m => m.executeLocalDeletion(planToken, includeUnsynced),
    module,
  );
  if (result == null) {
    return normalizeOperationError({status: 'error', error: null});
  }
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const deletion = deletionResultOf(result.result);
  if (deletion == null) {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    result: deletion,
  };
}

/** The saved repository, or REPOSITORY_NOT_CONFIGURED. Never carries the password. */
export async function getRepositorySummary(): Promise<RepositorySummaryResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.getRepositorySummary()) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const repository = repositorySummaryOf(result.repository);
  if (repository == null) {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {contractVersion: contractVersionOf(result), status: 'ok', repository};
}

function repositorySummaryOf(value: unknown): RepositorySummaryDto | null {
  if (value == null || typeof value !== 'object') {
    return null;
  }
  const r = value as Record<string, unknown>;
  if (
    (r.protocol !== 'FTP' && r.protocol !== 'SFTP' && r.protocol !== 'WEBDAV') ||
    typeof r.host !== 'string' ||
    typeof r.port !== 'number' ||
    typeof r.username !== 'string' ||
    typeof r.remoteRoot !== 'string'
  ) {
    return null;
  }
  return {
    protocol: r.protocol,
    host: r.host,
    port: r.port,
    username: r.username,
    remoteRoot: r.remoteRoot,
    precisionMillis:
      typeof r.precisionMillis === 'number' ? r.precisionMillis : null,
    credentialPresent: r.credentialPresent === true,
    hostKeyTrusted:
      typeof r.hostKeyTrusted === 'boolean' ? r.hostKeyTrusted : null,
    revision: typeof r.revision === 'number' ? r.revision : 0,
    webdavHttps: r.webdavHttps === true,
  };
}

/**
 * Saves the single repository. [password] is sent only when typed: null keeps the
 * stored one for the same server and account (native rule). A parse failure is
 * INVALID_QUERY with `error.field` naming the form field.
 */
export async function saveRepository(
  config: RepositoryConfigInput,
  password?: string | null,
): Promise<OperationResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.saveRepository(
    {
      protocol: config.protocol,
      host: config.host,
      port: config.port,
      username: config.username,
      remoteRoot: config.remoteRoot,
      webdavHttps: config.webdavHttps ?? false,
    },
    password != null && password !== '' ? password : null,
  )) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {contractVersion: contractVersionOf(result), status: 'ok'};
}

/**
 * Connects to the saved repository and lists its folder. An unknown or changed SFTP
 * key resolves SFTP_HOST_KEY_UNVERIFIED / _CHANGED with `error.hostKeyChallenge`.
 */
export async function testRepository(): Promise<TestRepositoryResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.testRepository()) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  const connection = result.connection as
    | Partial<RepositoryConnectionDto>
    | null
    | undefined;
  if (connection == null || typeof connection.entryCount !== 'number') {
    return normalizeOperationError({...result, status: 'error', error: null});
  }
  return {
    contractVersion: contractVersionOf(result),
    status: 'ok',
    connection: connection as RepositoryConnectionDto,
  };
}

/** Trusts the SFTP key of [challengeId]; the caller tests again afterwards. */
export async function approveSftpHostKey(
  challengeId: string,
): Promise<OperationResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.approveSftpHostKey(challengeId)) as NativeEnvelope;
  if (result.status !== 'ok') {
    return normalizeOperationError(result);
  }
  return {contractVersion: contractVersionOf(result), status: 'ok'};
}

/** Rejects the SFTP key of [challengeId]; nothing is trusted. */
export async function rejectSftpHostKey(
  challengeId: string,
): Promise<OperationResult> {
  const module = scanModule();
  if (module == null) {
    return moduleUnavailable();
  }
  const result = (await module.rejectSftpHostKey(challengeId)) as NativeEnvelope;
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
  startScan,
  cancelScan,
  getScanState,
  getLocalImageHandle,
  listSelectableEntries,
  prepareLocalDeletion,
  executeLocalDeletion,
  getRepositorySummary,
  saveRepository,
  testRepository,
  approveSftpHostKey,
  rejectSftpHostKey,
};
