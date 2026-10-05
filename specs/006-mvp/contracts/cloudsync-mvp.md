# Contract: CloudSync version 5 (MVP)

The changes to the single TurboModule ([D001](../../../docs/decisions/0001-single-cloudsync-turbomodule.md))
for feature 006. `CLOUD_SYNC_CONTRACT_VERSION` goes from 4 to 5 in `src/native/CloudSyncContracts.ts` and
`CloudSyncContracts.kt`. Every new constant and code below is mirrored in both files under
`CloudSyncContractsParityTest`.

Boundaries that still hold: no password or document URI crosses the bridge, nothing is ever written on the
server, and no remote content is read (R026, D016).

## Codegen surface (`src/native/specs/NativeCloudSync.ts`)

```ts
listSelectableEntries(snapshotId: string, querySpec: QuerySpecInput): Promise<OperationResultDto>;
prepareLocalDeletion(snapshotId: string, entryIds: Array<string>): Promise<OperationResultDto>;
executeLocalDeletion(planToken: string, includeUnsynced: boolean): Promise<OperationResultDto>;
```

- `listSelectableEntries` is new.
- `prepareLocalDeletion` is unchanged in shape and now implemented.
- `executeLocalDeletion` gains `includeUnsynced` (D008 amendment, research R13).
- `CloudSyncErrorDto` gains `field?: string | null`.

## Error codes (new)

| Code | Raised by | Message / action (native is the single source) |
| --- | --- | --- |
| `TLS_UNTRUSTED` | test, scan, prepare (WebDAV over HTTPS) | "The server's certificate is not trusted by this phone." / "Use a certificate from a public authority, or connect with SFTP." |
| `DELETION_IN_PROGRESS` | `startScan`, `saveRepository`, prepare, execute | "Files are being deleted." / "Wait until the deletion finishes." |
| `REPOSITORY_CHANGED` | prepare | "These results were made with your previous server settings." / "Scan again before deleting." |
| `PLAN_NOT_FOUND` | execute | "This deletion is no longer available." / "Review the selection and tap Delete again." |
| `PLAN_STALE` | execute | "The results changed since you reviewed this deletion." / "Review the selection and tap Delete again." |

Reworded actions (unchanged codes):

- `REPOSITORY_NOT_CONFIGURED`: "Set up your server in Settings › Repository."
- `CREDENTIAL_UNAVAILABLE`: "Enter the password again in Settings › Repository."

`SCAN_IN_PROGRESS` is now also returned by `saveRepository`, `prepareLocalDeletion` and
`executeLocalDeletion`.

## Constants (new, mirrored)

```ts
export const REPOSITORY_DEFAULT_PORTS = {FTP: 21, SFTP: 22, WEBDAV: 80, WEBDAV_HTTPS: 443} as const;
export const MAX_DELETION_PLAN_AGE_MILLIS = 15 * 60 * 1000;
```

## Repository methods (existing, extended)

`saveRepository(config, transientPassword?)` `config`:

| Key | Type | Notes |
| --- | --- | --- |
| `protocol` | `'FTP' \| 'SFTP' \| 'WEBDAV'` | |
| `host` | string | required |
| `port` | number \| null | null → the default port for the protocol |
| `username` | string | required |
| `remoteRoot` | string | required, absolute |
| `webdavHttps` | boolean | **new**. WebDAV only; default `false` when absent, so existing callers (the D018 seam) keep http |

On a parse failure the error is `INVALID_QUERY` with `field` set to the offending key.

`getRepositorySummary()` → `repository` gains:

| Field | Type |
| --- | --- |
| `revision` | number |
| `webdavHttps` | boolean |

`testRepository`, `approveSftpHostKey` and `rejectSftpHostKey` are unchanged.

## Scan state (existing, extended)

`ActiveSnapshotDto` gains `configRevision: number`.

## `listSelectableEntries(snapshotId, querySpec)`

Selects every `FILE` row the same `querySpec` would show through `queryFiles` (gallery) or
`queryTreeChildren` (list, `parentId` = the open folder, `sourceId` required). It applies the same filter,
view and image-only rules, never returns directories, and ignores `pageSize`, `sort` and `search`.

```ts
interface SelectableEntriesDto {
  entryIds: string[];
  /** Same order as entryIds; -1 = size unknown. */
  sizes: number[];
  statuses: FileStatus[];
  images: boolean[];
}
// ok: { contractVersion, status: 'ok', selectable: SelectableEntriesDto }
```

Errors: `SNAPSHOT_NOT_FOUND`, `STALE_GENERATION` (not the active snapshot), `INVALID_QUERY`.

## `prepareLocalDeletion(snapshotId, entryIds)`

Builds a plan after the server re-check
([research R12](../research.md#r12-pre-delete-server-re-check-prepare)).

```ts
interface DeletionPlanDto {
  planToken: string;
  toDelete: {count: number; bytes: number};          // backed up, confirmed on the server
  unsynced: {count: number; bytes: number};          // not backed up (incl. moved by the re-check)
  refused: {count: number; scanTooOld: number};      // unknown state, never deleted (D006)
  movedByRecheck: number;                            // SYNCED rows the re-check moved out of toDelete
  missing: number;                                   // IDs that are not FILE rows of the snapshot
  unknownSizeCount: number;                          // rows in toDelete/unsynced with no size
  remoteListedAtMillis: number;                      // scan age at the point of decision (R015)
}
// ok: { contractVersion, status: 'ok', plan: DeletionPlanDto }
```

`bytes` sums known sizes only.

Errors:

- `SNAPSHOT_NOT_FOUND`, `STALE_GENERATION`, `REPOSITORY_CHANGED`, `REPOSITORY_NOT_CONFIGURED` and
  `CREDENTIAL_UNAVAILABLE`.
- `SCAN_IN_PROGRESS` and `DELETION_IN_PROGRESS`.
- Connection failures (`AUTH_FAILED`, `CONNECTION_*`, `REMOTE_ROOT_NOT_FOUND`, `TLS_UNTRUSTED`,
  `SFTP_HOST_KEY_UNVERIFIED`, `SFTP_HOST_KEY_CHANGED`). No plan exists after any error; for host-key
  codes the action is "Check the server in Settings › Repository."
- `INVALID_QUERY` for an empty `entryIds`.

## `executeLocalDeletion(planToken, includeUnsynced)`

Runs the plan ([research R13](../research.md#r13-plans-exclusivity-and-execution)). Deletes `toDelete`,
plus `unsynced` only when `includeUnsynced` is true, and never `refused`.

```ts
interface DeletionFailureDto {
  entryId: string;
  name: string;
  reason: 'ALREADY_GONE' | 'CHANGED' | 'ACCESS_LOST' | 'FAILED';
}
interface DeletionResultDto {
  deleted: number;
  freedBytes: number;             // known sizes of DELETED files
  failures: DeletionFailureDto[]; // every non-deleted file that was attempted
  removedEntryIds: string[];      // DELETED + ALREADY_GONE: rows no longer in the snapshot
}
// ok: { contractVersion, status: 'ok', result: DeletionResultDto }
```

Errors: `PLAN_NOT_FOUND`, `PLAN_STALE` and `SCAN_IN_PROGRESS`. An error means nothing was deleted. After
an ok result, the rows in `removedEntryIds` are gone from every read of the snapshot.

## JS wrappers (`src/native/CloudSync.ts`)

`listSelectableEntries`, `prepareLocalDeletion` and `executeLocalDeletion` follow the existing pattern:
they validate the envelope, map it to typed `…Result` unions, and turn a missing native module into
`NATIVE_MODULE_UNAVAILABLE`. `saveRepository` passes `webdavHttps`.
