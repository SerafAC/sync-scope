# Contract: CloudSync browse reads and local image handles (contract version 4)

The authoritative sources are `src/native/specs/NativeCloudSync.ts` (Codegen spec),
`src/native/CloudSyncContracts.ts` (TypeScript DTOs and codes) and
`android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt` (the Kotlin mirror, checked by
`CloudSyncContractsParityTest`). This page describes the intended change; where they differ, the code wins.

## Surface change

| Item | Before (v3, feature 004) | After (v4) |
| --- | --- | --- |
| `CONTRACT_VERSION` (TS and Kotlin) | 3 | **4** |
| `FileEntryDto` | 10 fields | + `nameInOtherSource`, + `matchingFileCount` |
| `queryFiles` / `queryTreeChildren` | 004 read rules | Read rules in [data-model.md](../data-model.md#read-rules-changes-to-snapshotstorequeryfilepage) |
| `getLocalImageHandle(snapshotId, entryId, spec)` | `NOT_IMPLEMENTED` | implemented |
| Error codes | — | + `IMAGE_UNAVAILABLE` |

The Codegen signatures are unchanged (`getLocalImageHandle` already takes `spec: Object`), so no native
spec regeneration beyond the version constant. `getSettings` / `setIncludeHidden` stay `NOT_IMPLEMENTED`
(spec, reassigned to 009). `prepareLocalDeletion` / `executeLocalDeletion` stay `NOT_IMPLEMENTED` (006).

## DTOs (TypeScript, `CloudSyncContracts.ts`)

```ts
export interface FileEntryDto {
  entryId: string;
  sourceId: string;
  parentId: string | null;
  kind: LocalNodeKind;
  name: string;
  mimeType: string | null;
  sizeBytes: number | null;
  modifiedUtcMillis: number | null;
  status: FileStatus;
  issueCode: string | null;
  /**
   * GALLERY reads: a FILE with the same name exists in another source of this snapshot,
   * so the tile shows its source's alias as an origin badge. Always false for LIST reads.
   */
  nameInOtherSource: boolean;
  /**
   * DIRECTORY rows: files anywhere beneath it that match the query's filter. 0 means the row is shown
   * dimmed. null for FILE rows and for snapshots written before contract 4.
   */
  matchingFileCount: number | null;
}

export interface LocalImageSpec {
  /** Longest edge in px of the returned image; clamped to 64…2048. */
  maxEdgePx: number;
}

export interface LocalImageHandleDto {
  /** `file://` URI of a JPEG in the app's own cache. Never a document URI or a user path. */
  uri: string;
}

export interface LocalImageHandleOk {
  contractVersion: number;
  status: 'ok';
  handle: LocalImageHandleDto;
}
export type LocalImageHandleResult = LocalImageHandleOk | OperationError;

export const LOCAL_IMAGE_MIN_EDGE_PX = 64;
export const LOCAL_IMAGE_MAX_EDGE_PX = 2048;
/** Gallery tiles request this edge (research R7). */
export const GALLERY_THUMBNAIL_EDGE_PX = 256;
```

`clampImageEdge` (TS) and `LocalImageSpec.bounded` (Kotlin) mirror each other under the parity test, as
`clampPageSize` / `boundedPageSize` already do.

## Behaviour

### `queryFiles` / `queryTreeChildren`

The paging contract is unchanged: opaque tokens, a clamp of 200, `SNAPSHOT_NOT_FOUND`,
`PAGE_TOKEN_MISMATCH`, `INVALID_QUERY`. Changed rules:

- `queryTreeChildren` returns every `DIRECTORY` child whatever `querySpec.filter` is. The filter narrows
  `FILE` children only. Each directory carries `matchingFileCount` for that filter.
- `view: 'GALLERY'` selects `FILE` rows with an `image/*` MIME type only (video removed, R029).
- First-page `counts` are scoped by `view` (gallery = images) and `sourceId`, never by `filter`, `parentId`
  or `search`.
- `nameInOtherSource` is computed for `GALLERY` reads and is `false` for `LIST` reads.

### `getLocalImageHandle(snapshotId, entryId, spec)`

| Situation | Result |
| --- | --- |
| Snapshot not published | error `SNAPSHOT_NOT_FOUND` |
| `entryId` not in that snapshot, a `DIRECTORY`, or not `image/*` | error `INVALID_QUERY`, `field: "entryId"` |
| `spec.maxEdgePx` missing or not a number | error `INVALID_QUERY`, `field: "maxEdgePx"` |
| Document gone, grant revoked, storage missing, or not decodable | error `IMAGE_UNAVAILABLE` |
| A cached image for `(entryId, clamped edge)` exists | `ok` with its URI, no decode |
| Otherwise | decode at ≤ the clamped edge, write the JPEG to the cache, `ok` with its URI |

The method reads local storage only. It never opens a remote connection (R026), and the protocol audit
needs no change. It never logs the document URI. At most four decodes run at once; further calls queue.

## New error code

Inserted just before `INTERNAL_ERROR`, in the same order in TypeScript and Kotlin.

| Code | Message (redacted, user-facing) | Action |
| --- | --- | --- |
| `IMAGE_UNAVAILABLE` | "This image could not be read on the device." | "Check that the folder is still available, then rescan." |

## JS wrapper (`src/native/CloudSync.ts`)

```ts
export function getLocalImageHandle(
  snapshotId: string,
  entryId: string,
  spec: LocalImageSpec,
): Promise<LocalImageHandleResult>;
```

It validates the envelope as the existing wrappers do (`contractVersion`, `status`), and an unexpected
shape becomes a typed `INTERNAL_ERROR`, never a throw.
