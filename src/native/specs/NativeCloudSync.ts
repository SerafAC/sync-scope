import type {TurboModule} from 'react-native';
import {TurboModuleRegistry} from 'react-native';

/**
 * Codegen contract for the single CloudSync TurboModule.
 *
 * This is the only JavaScript/native application API. All results are
 * versioned, discriminated envelopes with stable machine-readable error
 * codes. Catalog queries return one bounded page at a time, tied to an
 * explicit snapshot; page tokens are opaque and rejected on any
 * snapshot/query/sort mismatch.
 *
 * The foundation ships no secret getters, no remote mutation, no remote
 * file-content download, and no raw local path operation, and later
 * features must preserve that boundary.
 */

export type CloudSyncErrorDto = {
  code: string;
  message: string;
  action?: string | null;
  /** saveRepository rejections only: the offending config key (contract v5). */
  field?: string | null;
};

export type FileEntryDto = {
  entryId: string;
  sourceId: string;
  parentId?: string | null;
  kind: string;
  name: string;
  mimeType?: string | null;
  sizeBytes?: number | null;
  modifiedUtcMillis?: number | null;
  status: string;
  issueCode?: string | null;
};

export type StatusCountDto = {
  status: string;
  count: number;
};

export type FilePageDto = {
  entries: FileEntryDto[];
  nextPageToken?: string | null;
  counts?: StatusCountDto[] | null;
};

export type FilePageResultDto = {
  contractVersion: number;
  status: string;
  page?: FilePageDto | null;
  error?: CloudSyncErrorDto | null;
};

export type OperationResultDto = {
  contractVersion: number;
  status: string;
  error?: CloudSyncErrorDto | null;
};

export type QuerySpecInput = {
  filter: string;
  view: string;
  sort: string;
  sourceId?: string | null;
  parentId?: string | null;
  search?: string | null;
  pageSize?: number | null;
};

export interface Spec extends TurboModule {
  /** Version of this contract; bumps when the surface changes. */
  getContractVersion(): Promise<number>;

  /** Bounded snapshot-scoped pages; rejects mismatched page tokens. */
  queryFiles(
    snapshotId: string,
    querySpec: QuerySpecInput,
    pageToken?: string | null,
  ): Promise<FilePageResultDto>;

  queryTreeChildren(
    snapshotId: string,
    parentId: string | null,
    querySpec: QuerySpecInput,
    pageToken?: string | null,
  ): Promise<FilePageResultDto>;

  /** Operations below resolve an `OperationResultDto` whose payload key
   * depends on the method; an unbuilt one resolves a typed NOT_IMPLEMENTED
   * envelope instead of rejecting. */
  getRepositorySummary(): Promise<OperationResultDto>;
  saveRepository(
    config: Object,
    transientPassword?: string | null,
  ): Promise<OperationResultDto>;
  testRepository(): Promise<OperationResultDto>;
  approveSftpHostKey(challengeId: string): Promise<OperationResultDto>;
  rejectSftpHostKey(challengeId: string): Promise<OperationResultDto>;
  listSources(): Promise<OperationResultDto>;
  /** Opens the SAF folder picker; with an ID it re-grants that source. */
  launchSourcePicker(
    regrantSourceId?: string | null,
  ): Promise<OperationResultDto>;
  removeSource(sourceId: string): Promise<OperationResultDto>;
  getSettings(): Promise<OperationResultDto>;
  setIncludeHidden(includeHidden: boolean): Promise<OperationResultDto>;
  /** `mode` is 'FULL' (default when absent) or 'LOCAL_REFRESH' (contract v3). */
  startScan(mode?: string | null): Promise<OperationResultDto>;
  cancelScan(runId: string): Promise<OperationResultDto>;
  getScanState(): Promise<OperationResultDto>;
  getLocalImageHandle(
    snapshotId: string,
    entryId: string,
    spec: Object,
  ): Promise<OperationResultDto>;
  /** Every FILE row the query would show, for "Select all" (contract v5). */
  listSelectableEntries(
    snapshotId: string,
    querySpec: QuerySpecInput,
  ): Promise<OperationResultDto>;
  /** Re-checks the selection on the server and returns a single-use plan. */
  prepareLocalDeletion(
    snapshotId: string,
    entryIds: Array<string>,
  ): Promise<OperationResultDto>;
  /** Runs a prepared plan; deletes not-backed-up files only with `includeUnsynced` (contract v5). */
  executeLocalDeletion(
    planToken: string,
    includeUnsynced: boolean,
  ): Promise<OperationResultDto>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('CloudSync');
