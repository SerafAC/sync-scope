# Contract: CloudSync changes for feature 009 (contract version 7)

`CLOUD_SYNC_CONTRACT_VERSION` goes from 6 to 7 in `src/native/CloudSyncContracts.ts` and
`bridge/CloudSyncContracts.kt` together. The contract parity test covers both.

## Changed: `getLocalImageHandle(snapshotId, entryId, spec)`

- **Accepts**: a `FILE` whose MIME type is `image/*` **or `video/*`**. Any other entry stays
  `INVALID_QUERY` on `entryId`, and the message becomes "The media entryId is invalid."
- **Result**: `{ status: 'ok', handle: { uri: string, durationMillis: number | null } }`.
  - `durationMillis` is null for images, and for videos whose duration cannot be read.
  - JS rejects a negative or non-finite value as null (`localImageHandleOf`).
- **Errors**: unchanged (`SNAPSHOT_NOT_FOUND`, `INVALID_QUERY`, `IMAGE_UNAVAILABLE`).
- **Guarantees**: unchanged. It reads local storage only, never opens a remote connection, and never
  returns or logs a document URI.

## Changed: `queryFiles` with `view: 'GALLERY'`, `selectAll` and the gallery counts

The gallery reads `FILE` rows whose MIME type is `image/*` or `video/*` (`MediaKind.SQL_MEDIA`). Paging,
sorts, tokens and the scroll index are unchanged. The `SelectableEntries` wire field `images: boolean[]`
is renamed `media: boolean[]`.

## New: `carrySelection(fromSnapshotId, toSnapshotId, entryIds)`

```ts
type CarrySelectionResult =
  | { status: 'ok'; carried: { from: string; to: string }[]; dropped: number }
  | { status: 'error'; error: CloudSyncError }; // SNAPSHOT_NOT_FOUND (either snapshot), INVALID_QUERY
```

- `entryIds`: at most 50 000, and each must be a string. Anything else is `INVALID_QUERY` on `entryIds`.
- The matching rule is in [data-model.md](../data-model.md#selection-carry-over-r9). It reads only, and
  never touches the server or the files.
- `from` may be the same as `to`. Then every existing `FILE` entry is carried.

## Changed: `getScanState` / the last run

The run DTO gains `recheckedFolders: number | null` and `promotedFiles: number | null`. Both are null for
`FULL` runs and for runs written before schema version 6.

## Changed: `LOCAL_REFRESH` behaviour (no signature change)

`startScan('LOCAL_REFRESH')` now runs the server re-check of
[research R5](../research.md#r5-re-checking-unsynced-files-during-the-automatic-refresh-fr-003-agent-refines-clarification-1)
between copying the remote state and reading the device:

- The progress phase `RECHECKING_REMOTE` is added to `ScanPhase`, and the JS mirror shows it as "Checking
  the server for new backups".
- A failure inside the re-check never fails the run: there is no new error code, and the run publishes.
- A refresh with no re-checkable files, or no candidate folders, does not connect at all.

## New native view: `SyncScopeVideoView`

A Codegen component spec, `src/native/specs/SyncScopeVideoViewNativeComponent.ts`.

| Prop / event | Type | Meaning |
| --- | --- | --- |
| `snapshotId` | `string` | The published snapshot |
| `entryId` | `string` | A `video/*` `FILE` of it; the view resolves the document natively |
| `muted` | `boolean` (default `true`) | Volume 0 when true |
| `paused` | `boolean` (default `false`) | Pauses or resumes; the `MediaController` also drives play and pause |
| `onPlaybackError` | `{ reason: 'NOT_A_VIDEO' \| 'UNAVAILABLE' \| 'UNPLAYABLE' }` | Unknown or non-video entry; the document cannot be opened; the decoder fails |
| `onReady` | `{ durationMillis: number }` | The video is prepared |

The view never exposes the document URI, and it releases its `MediaPlayer` on detach and on host pause.
It plays local content only (R026).
