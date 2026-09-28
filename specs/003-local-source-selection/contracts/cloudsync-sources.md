# Contract: CloudSync source methods (contract version 2)

The authoritative sources are `src/native/specs/NativeCloudSync.ts` (Codegen spec),
`src/native/CloudSyncContracts.ts` (TypeScript DTOs and error codes) and
`android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt` (Kotlin mirror, checked by
`CloudSyncContractsParityTest`). This page describes the intended change; the code wins where they differ.

## Surface change

| Item | Before | After |
| --- | --- | --- |
| `CONTRACT_VERSION` (TS and Kotlin) | 1 | **2** |
| `listSources()` | `NOT_IMPLEMENTED` | implemented |
| `launchSourcePicker()` | `launchSourcePicker(): Promise<OperationResultDto>` | `launchSourcePicker(regrantSourceId?: string \| null): Promise<OperationResultDto>` |
| `removeSource(sourceId)` | `NOT_IMPLEMENTED` | implemented |

All three methods resolve an envelope and never reject, like every other method (D011).

## DTOs (TypeScript, `CloudSyncContracts.ts`)

```ts
export type SourceAvailability = 'AVAILABLE' | 'GRANT_REVOKED' | 'STORAGE_MISSING';

export interface SourceDto {
  sourceId: string;
  alias: string;             // generated, unique, stable (FR-004)
  volumeLabel: string;       // e.g. "Internal shared storage", "SDCARD"
  displayPath: string;       // path within the volume; "" for a volume root
  isRemovable: boolean;
  canWrite: boolean;
  addedAtMillis: number;
  availability: SourceAvailability;
}

export interface ListSourcesOk { contractVersion: number; status: 'ok'; sources: SourceDto[]; }
export type ListSourcesResult = ListSourcesOk | OperationError;

export type SourcePickerOutcome = 'ADDED' | 'REGRANTED' | 'CANCELLED';
export interface LaunchSourcePickerOk {
  contractVersion: number; status: 'ok';
  outcome: SourcePickerOutcome;
  source: SourceDto | null;  // null only when outcome is CANCELLED
}
export type LaunchSourcePickerResult = LaunchSourcePickerOk | OperationError;

// removeSource resolves the existing OperationResult (plain ok, or error).
```

`CloudSyncError` gains one optional structured field, following the `hostKeyChallenge` precedent, so the
alias never has to pass through message redaction:

```ts
conflictingSource?: {sourceId: string; alias: string} | null; // present on SOURCE_OVERLAP only
```

## Behaviour

### `listSources()`

- Resolves `ok` with every `source_root` row, ordered by `addedAtMillis` ascending, each with its
  availability computed at call time (research R5).
- With no sources it resolves `ok` with `sources: []`.

### `launchSourcePicker(regrantSourceId?)`

| Situation | Result |
| --- | --- |
| The user picks a valid, non-overlapping folder (no `regrantSourceId`) | `ok`, `outcome: ADDED`, `source` = the new row |
| The user backs out of the picker | `ok`, `outcome: CANCELLED`, `source: null`, nothing persisted |
| The pick overlaps an existing source (FR-002) | error `SOURCE_OVERLAP` + `conflictingSource` |
| The pick comes from a provider other than external storage | error `SOURCE_UNSUPPORTED` |
| `regrantSourceId` is given and the pick has the same `canonicalRoot` | `ok`, `outcome: REGRANTED`, `source` keeps its `sourceId` and `alias` |
| `regrantSourceId` is given and the pick is a different folder | error `SOURCE_REGRANT_MISMATCH`; the row is unchanged |
| `regrantSourceId` is unknown | error `SOURCE_NOT_FOUND` (checked before the picker opens) |
| The picker is already open, or there is no foreground activity | error `PICKER_BUSY` |

In every error case the grant taken for the rejected pick is released. A re-grant checks V1 then V3 and
never the overlap rule V2, so a different folder always gives `SOURCE_REGRANT_MISMATCH` (data-model
"Validation rules").

### `removeSource(sourceId)`

- Deletes the row and all its scan data in one transaction, then releases the grant (data-model
  "Removal cascade"). Resolves plain `ok`. It works for sources in every availability state.
- An unknown `sourceId` gives the error `SOURCE_NOT_FOUND`.
- It does not prompt: the confirmation dialog is JS UI (FR-005).

## New error codes

These are inserted just before `INTERNAL_ERROR`, in the same order in the TypeScript and Kotlin lists, so
the parity test's order rule holds.

| Code | Message (redacted, user-facing) | Action |
| --- | --- | --- |
| `SOURCE_OVERLAP` | "This folder overlaps a folder you already added." | "Pick a folder that is not inside, or around, an existing one." |
| `SOURCE_UNSUPPORTED` | "Only folders on this device or its SD card can be added." | "Pick a folder from internal storage or the SD card." |
| `SOURCE_REGRANT_MISMATCH` | "That is a different folder from the one that lost access." | "Pick the same folder again, or remove the source." |
| `SOURCE_NOT_FOUND` | "That folder is no longer in your list." | "Refresh the folder list." |
| `PICKER_BUSY` | "The folder picker is already open." | "Finish or close the picker, then try again." |

## JS wrapper (`src/native/CloudSync.ts`)

It gains `listSources()`, `launchSourcePicker(regrantSourceId?)` and `removeSource(sourceId)`, each
normalising the plain Codegen object into its discriminated result type, as `normalizePageResult` does
today. Presentation code calls only these wrappers.

## Kotlin enumeration contract (native only, for feature 004)

It does not cross the bridge. See [data-model.md](../data-model.md#localfile-and-sourcelisting-kotlin-only-provided-to-feature-004).

```kotlin
interface LocalSourceEnumerator {
  fun enumerate(source: SourceRootEntity): SourceListing
}
```
