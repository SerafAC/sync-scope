# Data Model: GSD → Spec Kit Migration

The "data" in this migration is the set of records that get transferred. Every entity lives in Markdown.
[migration-map.md](./contracts/migration-map.md) is the authoritative index that ties them together.

## MigrationMapRow

One row for each GSD artifact or knowledge item.

| Field | Type | Rules |
| --- | --- | --- |
| `source` | path or ID | A repo path (e.g. `.gsd/PROJECT.md`) or a knowledge ID (`R007`, `D003`, `MEM020`, `S01`, `S01/T08`). Unique. |
| `kind` | enum | `requirement`, `decision`, `memory`, `slice`, `task`, `document`, `tooling`, `runtime` |
| `disposition` | enum | `transfer`, `superseded`, `discard` |
| `destination` | path + anchor | Required when `disposition = transfer`. It MUST resolve to an existing file or heading. |
| `reason` | text | Required when `disposition` is `superseded` or `discard`. |
| `verified` | bool | `true` only after a reviewer has opened the destination and confirmed the meaning is kept. |

**State transitions**: `unmapped → mapped (disposition set) → verified`. Removal needs every row to be
`verified` ([FR-018](./spec.md)).

## Requirement (R-ID)

| Field | Source (`.gsd/REQUIREMENTS.md`) | Destination |
| --- | --- | --- |
| `id` | `R001`–`R030` | Kept as a trace tag, e.g. `**FR-003** … (R007)` |
| `class` | e.g. `core-capability` | Stated in the owning spec's FR, e.g. `(R007, core-capability)`, or in `docs/scope.md` |
| `status` | `active` / `deferred` / `out-of-scope` | active → a feature spec FR; deferred and out-of-scope → `docs/scope.md` |
| `owner` | `M001/Sxx` primary, plus supporting | Primary → the feature holding the FR; supporting → cross-references only |
| `rationale` | "Why it matters" + Notes | Carried into the FR or into the spec's context |
| `validation` | `mapped` (0 validated) | Not validated anywhere until its proof passes (FR-015) |

**Uniqueness rule**: each active R-ID has exactly one primary FR across features 002–008.

## Decision (D-ID)

Destination: `docs/decisions/00NN-<slug>.md`. See the [decision record contract](./contracts/decision-record.md).

| Field | Rules |
| --- | --- |
| `id` | `D001`–`D015`. The file number equals the ID number. |
| `status` | `accepted`, or `superseded by D0xx` |
| `context`, `choice`, `rationale`, `alternatives`, `revisable`, `made_by`, `when` | Copied from the GSD row with the meaning unchanged. The wording may be reformatted. |

Source of truth for the transfer: the master working copy of `.gsd/DECISIONS.md` (research R2), which is
the only copy that has D013–D015.

## Memory (MEM-ID)

| Field | Rules |
| --- | --- |
| `id` | `MEM001`–`MEM022` |
| `category` | `architecture` (these mirror decisions, so the disposition is `superseded` by the D-ID), `environment`, `gotcha` |
| `disposition` | MEM015–017 and MEM021 → `DEVELOPMENT.md`; MEM020 and MEM022 → `docs/protocols.md`; MEM018 → `discard` (stale, superseded by D015) |

## Slice → Feature

| Field | Rules |
| --- | --- |
| `slice` | `S01`–`S07` |
| `feature_dir` | `specs/002-…` to `specs/008-…` ([research R6](./research.md#r6-slice--feature-naming)) |
| `spec_status` | 002: full spec + plan + tasks, status `Complete`. 003–008: `Draft (seeded)` |
| `acceptance` | The slice's "After this" demo → acceptance scenarios |
| `dependencies` | The slice's `depends:[]` list and boundary-map inputs/outputs → a Dependencies section in the spec |
| `requirements` | The R-IDs whose primary owner is this slice |

## Task (S01 only)

| Field | Rules |
| --- | --- |
| `id` | `T001`–`T008` in the Spec Kit format, each tagged with its milestone trace `(M001/S01/T0x)`. The word "GSD" is never used (FR-023). |
| `status` | `[X]` for T01–T08. No open tasks: the live-gate re-run happens during consolidation |
| `commits` | The delivering commit hash(es) from `milestone/M001`, found through each commit message and the files the task changed |
| `evidence` | T08 cites the 2026-09-23 result (exit 0, 8/8 tests, audits clean) and the consolidation re-run recorded in `checklists/transfer-verification.md` |

## VerificationChecklist

See [contracts/transfer-verification.md](./contracts/transfer-verification.md). It is a set of boolean
gates. Removal is allowed only when every item is `[X]`.
