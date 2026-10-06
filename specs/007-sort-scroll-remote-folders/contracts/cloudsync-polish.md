# Contract: CloudSync version 6

Changes to the single TurboModule ([D001](../../../docs/decisions/0001-single-cloudsync-turbomodule.md))
for feature 007. `CLOUD_SYNC_CONTRACT_VERSION` goes from 5 to 6 in `src/native/CloudSyncContracts.ts` and
`CloudSyncContracts.kt`. Every new constant, enum value and code below is mirrored in both files under
`CloudSyncContractsParityTest`.

Boundaries that still hold:

- No password leaves native code, and no document URI crosses the bridge (D011, D016).
- The only remote paths that cross are the configured folders, which the repository summary already
  exposes, and folder names that the folder browser lists.
- Nothing is written on the server, and no remote file content is read (R026).

## Codegen surface (`src/native/specs/NativeCloudSync.ts`)

```ts
type QuerySpecInput = {
  filter: string; view: string; sort: string;
  sourceId?: string | null; parentId?: string | null; search?: string | null; pageSize?: number | null;
  kind?: string | null;                                  // new: 'DIRECTORY' | 'FILE'
};

getScrollIndex(snapshotId: string, querySpec: QuerySpecInput, anchor?: Object | null): Promise<OperationResultDto>;
browseRemoteFolders(config: Object, transientPassword?: string | null, path?: string | null): Promise<OperationResultDto>;
getBrowsePreferences(): Promise<OperationResultDto>;
setBrowsePreferences(preferences: Object): Promise<OperationResultDto>;
```

`CloudSyncErrorDto` gains `fieldIndex?: number | null` (with `field: 'remoteRoots'`).

## Enums and constants (mirrored)

```ts
export type FileSort = 'NAME_ASC' | 'NAME_DESC' | 'TIME_ASC' | 'TIME_DESC' | 'SIZE_ASC' | 'SIZE_DESC';
export type FileKind = 'DIRECTORY' | 'FILE';
export type ScrollUnit = 'LETTER' | 'YEAR' | 'MONTH' | 'DAY' | 'SIZE';
export const SCROLL_BANDS_MIN = 5;      // date unit choice, size bands (R5, R6)
export const SCROLL_BANDS_MAX = 15;     // size bands (R5)
```

`FileIssueCode` gains `REMOTE_FOLDER_UNREAD` with the native text "A backup folder could not be read, so
this file may be backed up there."

The action that points to device folders is reworded (FR-016): `NO_SOURCES_SELECTED` → "Add a folder in
Settings › Device folders."

## Paged reads (`queryFiles`, `queryTreeChildren`), changed

- **Sorts**: `sort` accepts `SIZE_ASC` and `SIZE_DESC`. Every sort orders by
  `(key, sortName, entryId)`, with unknown values last in both directions
  ([data model](../data-model.md#sort-keys-and-ordering)). Name sorts are case- and accent-insensitive.
- **`kind`**: narrows the rows to that kind and is part of the token fingerprint.
- **Page tokens**: the token format is versioned. Tokens from contract 5 are rejected with
  `PAGE_TOKEN_MISMATCH`, which existing JS recovery handles. Tokens are still opaque, clamped to 200 rows
  and bound to the snapshot and query (D010).

## `getScrollIndex`

Request: the same `querySpec` the view pages with (`pageToken` and `pageSize` are ignored). The `anchor`
is optional:

```ts
{ sortValue: string | number | null, sortName: string }   // the first visible file's sort value and sortName
```

`FileEntryDto` gains `sortName: string`, so the view can build an anchor without a second read.

Result payload key `scrollIndex`:

```ts
interface ScrollIndexDto {
  unit: ScrollUnit;
  totalCount: number;                 // FILE rows only; in LIST the folder read is separate
  bands: ScrollBandDto[];             // in sort order; never empty bands
  anchorIndex: number | null;         // only when an anchor was passed
}
interface ScrollBandDto {
  startIndex: number;
  count: number;
  startToken: string | null;          // null for the first band: read it with a null token
  letter?: string | null;             // LETTER: '#' or 'a'…'z'
  startMillis?: number | null;        // YEAR / MONTH / DAY: local start of the period
  lowerBytes?: number | null;         // SIZE
  unknown?: boolean;                  // last band: files without a size or date
}
```

Errors:

- `SNAPSHOT_NOT_FOUND` and `STALE_GENERATION`, as for paged reads.
- `INVALID_QUERY` for a bad query, as today.
- An anchor of the wrong type for the sort (a string sort value for a size sort) is ignored, and
  `anchorIndex` is `null`.

**Guarantees** (`SnapshotStoreTest`, `ScrollIndexTest`):

- The band counts add up to `totalCount`, and each `startIndex` is the sum of the counts before it.
- Paging from a band's `startToken` returns that band's first row first.
- The index honours the same filter, view, source and parent scope as the rows.

## Repository methods, changed

### `saveRepository(config, transientPassword?)`

`config.remoteRoot` is replaced by `config.remoteRoots: string[]` (1 or more). Validation is native
(`RemoteRoots`, research R11). Field errors:

| Case | `field` | `fieldIndex` | Message |
| --- | --- | --- | --- |
| list empty or all blank | `remoteRoots` | `0` | "Add at least one remote folder." |
| contains a newline | `remoteRoots` | the folder's index | "A folder name cannot contain a line break." |
| equal to or nested with an earlier folder | `remoteRoots` | the later folder's index | "This folder is the same as, inside or around `<other folder>`." |

### `getRepositorySummary()`

`repository.remoteRoot` is replaced by `repository.remoteRoots: string[]`.

### `testRepository()`

Payload `connection` keeps all of its fields; `entryCount` becomes the sum over folders. It adds:

```ts
folders: Array<{ path: string; entryCount: number | null; error: CloudSyncErrorDto | null }>;
```

The status is `ok` when the server connected and logged in, whatever the per-folder outcomes. Connect,
login and host-key failures still fail the whole test, as today.

## `browseRemoteFolders(config, transientPassword?, path?)`

- `config`: the form's current draft, in the same shape as `saveRepository`. It is validated by the same
  `parse()`; `remoteRoots` is not required here.
- `transientPassword`: the password typed in the form. When it is absent, the stored credential is used if
  the draft's protocol, host, port and user match the saved repository; otherwise the call fails with
  `CREDENTIAL_UNAVAILABLE` and the action "Enter the password to browse the server."
- `path`: the folder to list; `null` or empty means `/`. A path that does not exist returns the listing of
  `/` with `fellBackToRoot: true`.

Result payload key `remoteFolders`:

```ts
interface RemoteFoldersDto {
  path: string;                 // normalized
  parent: string | null;        // null at '/'
  folders: string[];            // directory names, sorted case-insensitively; files and links never listed
  fellBackToRoot: boolean;
}
```

Errors: the same envelope as `testRepository`, including the SFTP host-key challenge
(`SFTP_HOST_KEY_UNVERIFIED` / `SFTP_HOST_KEY_CHANGED` with the challenge), followed by `approveSftpHostKey` and a
retry. It is refused with `SCAN_IN_PROGRESS` or `DELETION_IN_PROGRESS` as save is. It never writes to the
repository row or the credential store, and it opens one connection, which it closes before returning.

## Scan state, changed

`ScanSummaryDto` gains:

```ts
unreadRemoteFolders: string[];   // configured folders the last full scan could not read, in folder order
```

The list is empty when every folder was read. `coverage` is `INCOMPLETE` whenever it is not empty.
`unreadableRemoteDirectories` keeps counting non-root directories only.

## `getBrowsePreferences()` / `setBrowsePreferences(preferences)`

```ts
interface BrowsePreferencesDto { view: 'GALLERY' | 'LIST'; gallerySort: FileSort; listSort: FileSort }
```

- `getBrowsePreferences()` resolves payload key `preferences` and never fails: missing or unknown values
  read as the defaults (`GALLERY`, `TIME_DESC`, `NAME_ASC`).
- `setBrowsePreferences()` stores whatever fields are given and resolves `ok`. An unknown value is
  rejected with `INVALID_QUERY` and nothing is stored.

## Debug seam (D018)

`syncscope-debug://configure-repository` accepts the `root` query parameter more than once. The values
become `remoteRoots` in order. Existing single-`root` links keep working.
