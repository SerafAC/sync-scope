# Migration Map: GSD to Spec Kit

**Contract**: [contracts/migration-map.md](./contracts/migration-map.md)

Every GSD source item has exactly one row. Disposition is `transfer`, `superseded` or `discard`. A `transfer` row names an
existing destination path (optionally with `#anchor`); a `superseded` or `discard` row gives the reason. `Verified` is `[X]`
only after the destination has been read and its meaning confirmed. Rows are filled in during User Stories
2-5; this skeleton was created by T007 with every disposition empty.

## Tooling

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.mcp.json` | discard | registered the GSD MCP servers (gsd-workflow, gsd-browser) only; deleted in the removal commit (research R7) | [X] |
| `.claude/settings.local.json` (GSD entries) | discard | local, never committed; GSD MCP servers disabled after the freeze commit (T009, research R7) | [X] |
| `.gitignore` (GSD block) | superseded | by `.gitignore` "Editor and operating-system files": generic entries kept there, GSD-only and other-stack entries dropped (research R8) | [X] |
| `.bg-shell/` | discard | GSD background-shell manifest; no product knowledge (research R7) | [X] |
| `.gsd-id` | discard | untracked GSD project id; deleted without archive (research R7, T045) | [X] |
| `.gsd-worktrees/` | discard | empty; `git worktree list` shows only the main worktree (research R7) | [X] |
| `milestone/M001` branch | discard | fully merged in `82188c4` (`git log master..milestone/M001` empty); deleted with `git branch -d` (research R7, T045) | [X] |
| master working-tree script edits (duplicate D015, committed in 769182d) | superseded | by milestone/M001's authoritative D015 implementation in `scripts/validation/`, kept by the merge (T011, research R2) | [X] |
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
| `.gsd/PREFERENCES.md` → `git.main_branch: master` | transfer | DEVELOPMENT.md#branches-and-workflow ("The mainline branch is `master`") | [X] |
| `.gsd/PREFERENCES.md` → `version`, `mode: solo` | discard | GSD tool settings; no meaning outside GSD | [X] |
| `.gsd/STATE.md` | superseded | by Spec Kit feature status (tasks.md per feature, .specify/feature.json); GSD runtime status snapshot, its S01/T08 status is reconciled in research R3 | [X] |
| `.gsd/ROADMAP.md` | superseded | by the Spec Kit features 002–008 (see Slice rows); lists only milestone M001 with no further content | [X] |
| `.gsd/QUEUE.md` | superseded | by the Spec Kit features 002–008 (see Slice rows); lists only milestone M001 with no further content | [X] |
| `.gsd/last-snapshot.md` | discard | GSD auto-generated context snapshot; its memories are covered row by row in the Memory table and its active context by research R3 | [X] |
| `.gsd/REQUIREMENTS.md` | superseded | by the per-requirement rows in the Requirement table (R001–R022 → specs/002–008, R023–R030 → docs/scope.md) | [X] |
| `.gsd/DECISIONS.md` | transfer | docs/decisions/README.md (one record per D-ID; see Decision rows) | [X] |
| `.gsd/phases/01-syncscope-v1/01-ROADMAP.md` | superseded | by the Spec Kit features 002–008 (see Slice rows); each spec's "Provides" section carries its boundary-map handoff | [X] |
| `.gsd/phases/01-syncscope-v1/01-CONTEXT.md` | transfer | specs/002-native-cloudsync-connect/research.md#milestone-discussion-context-that-still-applies; architectural decisions in docs/decisions/, scope in docs/scope.md | [X] |
| `.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md` | transfer | specs/002-native-cloudsync-connect/research.md#findings-from-the-pre-build-research | [X] |
| `.gsd/phases/01-syncscope-v1/01-01-PLAN.md` | transfer | specs/002-native-cloudsync-connect/plan.md | [X] |
| `.gsd/phases/01-syncscope-v1/S01-CONTINUE.md` | discard | GSD auto-compaction resume note for S01/T08; T08 is complete (see specs/002-native-cloudsync-connect/tasks.md) | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T001, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T002, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T003, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T004, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T005, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T006, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T007, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/S01-T08-SUMMARY.md` | transfer | specs/002-native-cloudsync-connect/tasks.md (T008, commit refs) and specs/002-native-cloudsync-connect/research.md#key-decisions-recorded-per-task | [X] |
| `.gsd/phases/01-syncscope-v1/*-VERIFY.json` (9 files) | superseded | by the gate evidence in specs/002-native-cloudsync-connect/tasks.md and specs/002-native-cloudsync-connect/spec.md#validation-evidence | [X] |
| `.gsd/forensics/report-2026-09-21-21-15-37.md` | discard | GSD auto-mode tooling failures (dispatch loops, worktree orphans); no product knowledge | [X] |

## Requirement

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| R001 | transfer | specs/002-native-cloudsync-connect/spec.md#FR-001 (primary FR) | [X] |
| R002 | transfer | specs/002-native-cloudsync-connect/spec.md#FR-002 (primary FR) | [X] |
| R003 | transfer | specs/002-native-cloudsync-connect/spec.md#FR-003 (primary FR) | [X] |
| R004 | transfer | specs/002-native-cloudsync-connect/spec.md#FR-004 (primary FR) | [X] |
| R005 | transfer | specs/003-local-source-selection/spec.md#FR-001 (primary FR) | [X] |
| R006 | transfer | specs/004-scan-engine-matching/spec.md#FR-001 (primary FR) | [X] |
| R007 | transfer | specs/004-scan-engine-matching/spec.md#FR-002 (primary FR) | [X] |
| R008 | transfer | specs/005-gallery-list-filtering/spec.md#FR-001 (primary FR) | [X] |
| R009 | transfer | specs/005-gallery-list-filtering/spec.md#FR-002 (primary FR) | [X] |
| R010 | transfer | specs/006-tree-view-image-preview/spec.md#FR-001 (primary FR) | [X] |
| R011 | transfer | specs/005-gallery-list-filtering/spec.md#FR-003 (primary FR) | [X] |
| R012 | transfer | specs/007-multiselect-local-deletion/spec.md#FR-001 (primary FR) | [X] |
| R013 | transfer | specs/007-multiselect-local-deletion/spec.md#FR-002 (primary FR) | [X] |
| R014 | transfer | specs/006-tree-view-image-preview/spec.md#FR-002 (primary FR) | [X] |
| R015 | transfer | specs/004-scan-engine-matching/spec.md#FR-003 (primary FR) | [X] |
| R016 | transfer | specs/004-scan-engine-matching/spec.md#FR-004 (primary FR) | [X] |
| R017 | transfer | specs/004-scan-engine-matching/spec.md#FR-005 (primary FR) | [X] |
| R018 | transfer | specs/002-native-cloudsync-connect/spec.md#FR-005 (primary FR) | [X] |
| R019 | transfer | specs/008-full-loop-release/spec.md#FR-001 (primary FR) | [X] |
| R020 | transfer | specs/008-full-loop-release/spec.md#FR-002 (primary FR) | [X] |
| R021 | transfer | specs/005-gallery-list-filtering/spec.md#FR-004 (primary FR) | [X] |
| R022 | transfer | specs/008-full-loop-release/spec.md#FR-003 (primary FR) | [X] |
| R023 | transfer | docs/scope.md (Deferred, `### R023`) | [X] |
| R024 | transfer | docs/scope.md (Deferred, `### R024`) | [X] |
| R025 | transfer | docs/scope.md (Deferred, `### R025`) | [X] |
| R026 | transfer | docs/scope.md (Non-goals, `### R026`) | [X] |
| R027 | transfer | docs/scope.md (Non-goals, `### R027`) | [X] |
| R028 | transfer | docs/scope.md (Non-goals, `### R028`) | [X] |
| R029 | transfer | docs/scope.md (Non-goals, `### R029`) | [X] |
| R030 | transfer | docs/scope.md (Non-goals, `### R030`) | [X] |

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
| S01 | transfer | specs/002-native-cloudsync-connect/spec.md (Complete; plan.md, research.md, tasks.md alongside) | [X] |
| S02 | transfer | specs/003-local-source-selection/spec.md (Draft (seeded)) | [X] |
| S03 | transfer | specs/004-scan-engine-matching/spec.md (Draft (seeded)) | [X] |
| S04 | transfer | specs/005-gallery-list-filtering/spec.md (Draft (seeded)) | [X] |
| S05 | transfer | specs/006-tree-view-image-preview/spec.md (Draft (seeded)) | [X] |
| S06 | transfer | specs/007-multiselect-local-deletion/spec.md (Draft (seeded)) | [X] |
| S07 | transfer | specs/008-full-loop-release/spec.md (Draft (seeded)) | [X] |

## Task

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| S01/T01 | transfer | specs/002-native-cloudsync-connect/tasks.md (T001 [X], commit(s) 7c4d394) | [X] |
| S01/T02 | transfer | specs/002-native-cloudsync-connect/tasks.md (T002 [X], commit(s) ca9dd60) | [X] |
| S01/T03 | transfer | specs/002-native-cloudsync-connect/tasks.md (T003 [X], commit(s) 9500a9c) | [X] |
| S01/T04 | transfer | specs/002-native-cloudsync-connect/tasks.md (T004 [X], commit(s) 3001c5d) | [X] |
| S01/T05 | transfer | specs/002-native-cloudsync-connect/tasks.md (T005 [X], commit(s) a01bb64) | [X] |
| S01/T06 | transfer | specs/002-native-cloudsync-connect/tasks.md (T006 [X], commit(s) bb37998) | [X] |
| S01/T07 | transfer | specs/002-native-cloudsync-connect/tasks.md (T007 [X], commit(s) f331aad) | [X] |
| S01/T08 | transfer | specs/002-native-cloudsync-connect/tasks.md (T008 [X], commit(s) 8e38f68, c04b121, 16d75ac) | [X] |

## Runtime

| Source | Disposition | Destination / Reason | Verified |
| --- | --- | --- | --- |
| `.gsd/gsd.db*` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/activity/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/journal/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/audit/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/event-log.jsonl` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/runtime/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/quarantine/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/backups/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/recovery-applications/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/exec/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/migration/` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/milestones/` | discard | untracked GSD milestone scaffold (empty `M001/slices/`); no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/*.json` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |
| `.gsd/*.jsonl` | discard | GSD runtime state; no product knowledge; deleted without archive (research R7, T044/T045) | [X] |

**Removal commit**: `4aaa624` (`chore: remove GSD after migration to Spec Kit`)
