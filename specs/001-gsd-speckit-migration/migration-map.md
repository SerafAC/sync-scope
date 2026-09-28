# Migration Map: GSD to Spec Kit

**Contract**: [contracts/migration-map.md](./contracts/migration-map.md)

Every GSD source item has exactly one row. Disposition is `transfer` or `discard`. A `transfer` row names an
existing destination path (optionally with `#anchor`); a `discard` row gives the reason. `Verified` is `[X]`
only after the destination has been read and its meaning confirmed. Rows are filled in during User Stories
2-5; this skeleton was created by T007 with every disposition empty.

## Tooling

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.mcp.json` |  |  | [ ] |
| `.claude/settings.local.json` (GSD entries) |  |  | [ ] |
| `.gitignore` (GSD block) |  |  | [ ] |
| `.bg-shell/` |  |  | [ ] |
| `.gsd-id` |  |  | [ ] |
| `.gsd-worktrees/` |  |  | [ ] |
| `milestone/M001` branch |  |  | [ ] |
| master working-tree script edits (duplicate D015, committed in 769182d) |  |  | [ ] |

## Document

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.gsd/PROJECT.md` |  |  | [ ] |
| `.gsd/CODEBASE.md` |  |  | [ ] |
| `.gsd/CONTEXT.md` |  |  | [ ] |
| `.gsd/KNOWLEDGE.md` |  |  | [ ] |
| `.gsd/PREFERENCES.md` |  |  | [ ] |
| `.gsd/STATE.md` |  |  | [ ] |
| `.gsd/ROADMAP.md` |  |  | [ ] |
| `.gsd/QUEUE.md` |  |  | [ ] |
| `.gsd/last-snapshot.md` |  |  | [ ] |
| `.gsd/REQUIREMENTS.md` |  |  | [ ] |
| `.gsd/DECISIONS.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/01-ROADMAP.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/01-CONTEXT.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/01-01-PLAN.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-CONTINUE.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md` |  |  | [ ] |
| `.gsd/phases/01-syncscope-v1/S01-T08-SUMMARY.md` |  |  | [ ] |
| `.gsd/forensics/report-2026-09-21-21-15-37.md` |  |  | [ ] |

## Requirement

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| R001 |  |  | [ ] |
| R002 |  |  | [ ] |
| R003 |  |  | [ ] |
| R004 |  |  | [ ] |
| R005 |  |  | [ ] |
| R006 |  |  | [ ] |
| R007 |  |  | [ ] |
| R008 |  |  | [ ] |
| R009 |  |  | [ ] |
| R010 |  |  | [ ] |
| R011 |  |  | [ ] |
| R012 |  |  | [ ] |
| R013 |  |  | [ ] |
| R014 |  |  | [ ] |
| R015 |  |  | [ ] |
| R016 |  |  | [ ] |
| R017 |  |  | [ ] |
| R018 |  |  | [ ] |
| R019 |  |  | [ ] |
| R020 |  |  | [ ] |
| R021 |  |  | [ ] |
| R022 |  |  | [ ] |
| R023 |  |  | [ ] |
| R024 |  |  | [ ] |
| R025 |  |  | [ ] |
| R026 |  |  | [ ] |
| R027 |  |  | [ ] |
| R028 |  |  | [ ] |
| R029 |  |  | [ ] |
| R030 |  |  | [ ] |

## Decision

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| D001 |  |  | [ ] |
| D002 |  |  | [ ] |
| D003 |  |  | [ ] |
| D004 |  |  | [ ] |
| D005 |  |  | [ ] |
| D006 |  |  | [ ] |
| D007 |  |  | [ ] |
| D008 |  |  | [ ] |
| D009 |  |  | [ ] |
| D010 |  |  | [ ] |
| D011 |  |  | [ ] |
| D012 |  |  | [ ] |
| D013 |  |  | [ ] |
| D014 |  |  | [ ] |
| D015 |  |  | [ ] |

## Memory

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| MEM001 |  |  | [ ] |
| MEM002 |  |  | [ ] |
| MEM003 |  |  | [ ] |
| MEM004 |  |  | [ ] |
| MEM005 |  |  | [ ] |
| MEM006 |  |  | [ ] |
| MEM007 |  |  | [ ] |
| MEM008 |  |  | [ ] |
| MEM009 |  |  | [ ] |
| MEM010 |  |  | [ ] |
| MEM011 |  |  | [ ] |
| MEM012 |  |  | [ ] |
| MEM013 |  |  | [ ] |
| MEM014 |  |  | [ ] |
| MEM015 |  |  | [ ] |
| MEM016 |  |  | [ ] |
| MEM017 |  |  | [ ] |
| MEM018 |  |  | [ ] |
| MEM019 |  |  | [ ] |
| MEM020 |  |  | [ ] |
| MEM021 |  |  | [ ] |
| MEM022 |  |  | [ ] |

## Slice

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| S01 |  |  | [ ] |
| S02 |  |  | [ ] |
| S03 |  |  | [ ] |
| S04 |  |  | [ ] |
| S05 |  |  | [ ] |
| S06 |  |  | [ ] |
| S07 |  |  | [ ] |

## Task

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| S01/T01 |  |  | [ ] |
| S01/T02 |  |  | [ ] |
| S01/T03 |  |  | [ ] |
| S01/T04 |  |  | [ ] |
| S01/T05 |  |  | [ ] |
| S01/T06 |  |  | [ ] |
| S01/T07 |  |  | [ ] |
| S01/T08 |  |  | [ ] |

## Runtime

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.gsd/gsd.db*` |  |  | [ ] |
| `.gsd/activity/` |  |  | [ ] |
| `.gsd/journal/` |  |  | [ ] |
| `.gsd/audit/` |  |  | [ ] |
| `.gsd/event-log.jsonl` |  |  | [ ] |
| `.gsd/runtime/` |  |  | [ ] |
| `.gsd/quarantine/` |  |  | [ ] |
| `.gsd/backups/` |  |  | [ ] |
| `.gsd/recovery-applications/` |  |  | [ ] |
| `.gsd/exec/` |  |  | [ ] |
| `.gsd/migration/` |  |  | [ ] |
| `.gsd/*.json` |  |  | [ ] |
| `.gsd/*.jsonl` |  |  | [ ] |
