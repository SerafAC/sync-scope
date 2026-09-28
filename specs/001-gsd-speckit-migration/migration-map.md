# Migration Map: GSD to Spec Kit

**Contract**: [contracts/migration-map.md](./contracts/migration-map.md)

Every GSD source item has exactly one row. Disposition is `transfer`, `superseded` or `discard`. A `transfer` row names an
existing destination path (optionally with `#anchor`); a `superseded` or `discard` row gives the reason. `Verified` is `[X]`
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
| merge conflict: `.gsd/DECISIONS.md` | transfer | `.gsd/DECISIONS.md` — master's side (ours) won; only copy with D013–D015 (T011, research R2) | [X] |
| merge conflict: `.gsd/.compat.json` | transfer | `.gsd/.compat.json` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/last-snapshot.md` | transfer | `.gsd/last-snapshot.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/01-01-PLAN.md` | transfer | `.gsd/phases/01-syncscope-v1/01-01-PLAN.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md` | transfer | `.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/01-CONTEXT.md` | transfer | `.gsd/phases/01-syncscope-v1/01-CONTEXT.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/01-ROADMAP.md` | transfer | `.gsd/phases/01-syncscope-v1/01-ROADMAP.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-CONTINUE.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-CONTINUE.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md` | transfer | `.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md` — milestone/M001's side (theirs) won (T011, research R2) | [X] |
| merge conflict: `scripts/validation/protocol-service.sh` | transfer | `scripts/validation/protocol-service.sh` — milestone/M001's side (theirs) won; authoritative D015 implementation, master's duplicate 769182d dropped (T011, research R2) | [X] |
| merge conflict: `scripts/validation/validation-infrastructure.test.mjs` | transfer | `scripts/validation/validation-infrastructure.test.mjs` — milestone/M001's side (theirs) won; authoritative D015 implementation, master's duplicate 769182d dropped (T011, research R2) | [X] |

## Document

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.gsd/PROJECT.md` | transfer | docs/overview.md (vision, core value, user loop) and docs/architecture.md (architecture / key patterns) | [X] |
| `.gsd/CODEBASE.md` | transfer | docs/architecture.md | [X] |
| `.gsd/CONTEXT.md` | superseded | by the constitution (.specify/memory/constitution.md, Quality Gates); auto-detected stack list and verification commands only | [X] |
| `.gsd/KNOWLEDGE.md` | discard | empty template: Rules, Patterns and Lessons Learned tables have no rows | [X] |
| `.gsd/PREFERENCES.md` → `verification_commands` | superseded | by the constitution's quality gates (.specify/memory/constitution.md: `pnpm lint`, `pnpm typecheck`, `pnpm test:ci`, e2e) | [X] |
| `.gsd/PREFERENCES.md` → `custom_instructions` | superseded | by the constitution (Principles I KISS, II YAGNI, III DRY, V end-to-end coverage; tests mandatory) | [X] |
| `.gsd/PREFERENCES.md` → `git.auto_push: true` | discard | conflicts with the constitution's reviewed-commit workflow; not adopted | [X] |
| `.gsd/PREFERENCES.md` → `git.isolation: worktree` | discard | conflicts with the constitution's reviewed-commit workflow; not adopted | [X] |
| `.gsd/PREFERENCES.md` → `git.main_branch: master` | transfer | DEVELOPMENT.md (mainline branch section added by T040) | [ ] |
| `.gsd/PREFERENCES.md` → `version`, `mode: solo` | discard | GSD tool settings; no meaning outside GSD | [X] |
| `.gsd/STATE.md` | superseded | by Spec Kit feature status (tasks.md per feature, .specify/feature.json); GSD runtime status snapshot, its S01/T08 status is reconciled in research R3 | [X] |
| `.gsd/ROADMAP.md` | superseded | by the Spec Kit features 002–008 (see Slice rows); lists only milestone M001 with no further content | [X] |
| `.gsd/QUEUE.md` | superseded | by the Spec Kit features 002–008 (see Slice rows); lists only milestone M001 with no further content | [X] |
| `.gsd/last-snapshot.md` | discard | GSD auto-generated context snapshot; its memories are covered row by row in the Memory table and its active context by research R3 | [X] |
| `.gsd/REQUIREMENTS.md` | superseded | by the per-requirement rows in the Requirement table (R001–R022 → specs/002–008, R023–R030 → docs/scope.md) | [X] |
| `.gsd/DECISIONS.md` | transfer | docs/decisions/README.md (one record per D-ID; see Decision rows) | [X] |
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
| `.gsd/forensics/report-2026-09-21-21-15-37.md` | discard | GSD auto-mode tooling failures (dispatch loops, worktree orphans); no product knowledge | [X] |

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
| D001 | transfer | docs/decisions/0001-single-cloudsync-turbomodule.md | [X] |
| D002 | transfer | docs/decisions/0002-room-scan-store-keystore-credentials.md | [X] |
| D003 | transfer | docs/decisions/0003-directory-agnostic-sync-matching.md | [X] |
| D004 | transfer | docs/decisions/0004-discovered-timestamp-precision.md | [X] |
| D005 | transfer | docs/decisions/0005-protocol-client-libraries.md | [X] |
| D006 | transfer | docs/decisions/0006-unknown-status-never-deletable.md | [X] |
| D007 | transfer | docs/decisions/0007-sftp-host-key-tofu.md | [X] |
| D008 | transfer | docs/decisions/0008-two-phase-local-deletion.md | [X] |
| D009 | transfer | docs/decisions/0009-foreground-scan-and-freshness.md | [X] |
| D010 | transfer | docs/decisions/0010-snapshot-paging-and-origin-badge.md | [X] |
| D011 | transfer | docs/decisions/0011-typed-error-envelopes-partial-scans.md | [X] |
| D012 | transfer | docs/decisions/0012-maestro-e2e-proof-bar.md | [X] |
| D013 | transfer | docs/decisions/0013-full-persistence-layer-in-s01.md | [X] |
| D014 | transfer | docs/decisions/0014-container-credentials-via-runner-args.md | [X] |
| D015 | transfer | docs/decisions/0015-docker-major-version-pin.md | [X] |

## Memory

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| MEM001 | superseded | by D001 (architecture memory mirroring the decision) — docs/decisions/0001-single-cloudsync-turbomodule.md | [X] |
| MEM002 | superseded | by D002 (architecture memory mirroring the decision) — docs/decisions/0002-room-scan-store-keystore-credentials.md | [X] |
| MEM003 | superseded | by D003 (architecture memory mirroring the decision) — docs/decisions/0003-directory-agnostic-sync-matching.md | [X] |
| MEM004 | superseded | by D004 (architecture memory mirroring the decision) — docs/decisions/0004-discovered-timestamp-precision.md | [X] |
| MEM005 | superseded | by D005 (architecture memory mirroring the decision) — docs/decisions/0005-protocol-client-libraries.md | [X] |
| MEM006 | superseded | by D006 (architecture memory mirroring the decision) — docs/decisions/0006-unknown-status-never-deletable.md | [X] |
| MEM007 | superseded | by D007 (architecture memory mirroring the decision) — docs/decisions/0007-sftp-host-key-tofu.md | [X] |
| MEM008 | superseded | by D008 (architecture memory mirroring the decision) — docs/decisions/0008-two-phase-local-deletion.md | [X] |
| MEM009 | superseded | by D009 (architecture memory mirroring the decision) — docs/decisions/0009-foreground-scan-and-freshness.md | [X] |
| MEM010 | superseded | by D010 (architecture memory mirroring the decision) — docs/decisions/0010-snapshot-paging-and-origin-badge.md | [X] |
| MEM011 | superseded | by D011 (architecture memory mirroring the decision) — docs/decisions/0011-typed-error-envelopes-partial-scans.md | [X] |
| MEM012 | superseded | by D012 (architecture memory mirroring the decision) — docs/decisions/0012-maestro-e2e-proof-bar.md | [X] |
| MEM013 | superseded | by D013 (architecture memory mirroring the decision) — docs/decisions/0013-full-persistence-layer-in-s01.md | [X] |
| MEM014 | superseded | by D014 (architecture memory mirroring the decision) — docs/decisions/0014-container-credentials-via-runner-args.md | [X] |
| MEM015 | transfer | DEVELOPMENT.md#environment-gotchas | [X] |
| MEM016 | transfer | DEVELOPMENT.md#environment-gotchas | [X] |
| MEM017 | transfer | DEVELOPMENT.md#environment-gotchas | [X] |
| MEM018 | discard | stale; superseded by D015 | [X] |
| MEM019 | superseded | by D015 (architecture memory mirroring the decision) — docs/decisions/0015-docker-major-version-pin.md | [X] |
| MEM020 | transfer | docs/protocols.md | [X] |
| MEM021 | transfer | DEVELOPMENT.md#environment-gotchas | [X] |
| MEM022 | transfer | docs/protocols.md | [X] |

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
