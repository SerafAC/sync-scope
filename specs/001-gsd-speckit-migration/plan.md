# Implementation Plan: Migrate SyncScope Project Management from GSD to Spec Kit

**Branch**: `001-gsd-speckit-migration` (work lands on `master`; see Structure Decision) | **Date**: 2026-09-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-gsd-speckit-migration/spec.md`

## Summary

The migration moves SyncScope from GSD to Spec Kit in five ordered stages:

1. **Freeze**: commit GSD's current state, export the knowledge that exists only in its database, commit
   the Spec Kit assets, and detach the GSD runtime so nothing rewrites `.gsd/` afterwards.
2. **Consolidate**: stage a `--no-ff` merge of `milestone/M001` into `master`. This brings in S01's code for
   T01–T08, which today exists only on that branch. Every quality gate, including the S01 live-container
   end-to-end gate, runs on the staged result before the merge is committed. The merge commit itself adds
   `CHANGELOG.md` and the first `./docs` pages (constitution VI and VII).
3. **Transfer**: move requirements, decisions, architecture and gotchas into Spec Kit specs, `./docs`,
   `README.md` and `DEVELOPMENT.md`, tracked by a migration map.
4. **Continue**: create feature 002 (S01) with its real status (T01–T08 done, re-proven during
   consolidation) and draft specs 003–008 for S02–S07. Point Spec Kit at feature 003.
5. **Remove**: once a verification checklist fully passes, delete every GSD artifact in one commit that a
   single revert can undo.

Two research findings changed the approach:

- T08 is implemented and recorded a passing live gate on 2026-09-23, but GSD never closed the task. The
  spec was corrected to match, and the gate is re-run on the staged merge.
- The only complete `DECISIONS.md` (the one containing D013–D015) is untracked on `master`. That is why
  the freeze commit comes before the merge.

## Technical Context

**Language/Version**: Markdown for documentation; POSIX sh and git for the migration steps. The repository
under migration is React Native 0.87 with TypeScript 6 and Kotlin 2.2.0, and none of that code is modified.

**Primary Dependencies**: git (2.38+ for `merge-tree --write-tree`), `sqlite3` (to export the GSD DB),
pnpm 11.3.0, Spec Kit 1.0.10 (`.specify/`)

**Storage**: Files in the repository. The GSD source is `.gsd/` (Markdown plus the SQLite `gsd.db`).

**Testing**: The existing quality gates must stay green: `pnpm lint`, `pnpm typecheck`, `pnpm test:ci` and
`pnpm test:android:unit`. S01's end-to-end gate must pass too: `pnpm validation:services:start && pnpm
validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`. There are
no Maestro flows yet, so `pnpm e2e:android` has nothing to run for S01. The migration is verified by the
scripted checks in [quickstart.md](./quickstart.md) and the
[transfer verification checklist](./contracts/transfer-verification.md).

**Target Platform**: A developer workstation (Linux) running the repository's toolchain, with Docker 29.x,
Compose 5.5.1 and an API 31 emulator for the S01 live gate.

**Project Type**: Repository and process migration of a mobile app (Android, React Native).

**Performance Goals**: N/A. SC-002 sets one human-facing target: a fresh session finds the next open work
item in under 5 minutes.

**Constraints**:

- No behaviour change to the application, build or validation (FR-005, FR-022).
- A `--no-ff` merge that preserves commit hashes (FR-003).
- No archive of untracked GSD history (clarified).
- Tracked-file removal in one commit (FR-021).
- No GSD process running after the freeze.
- No use of the word "GSD" in transferred content outside `specs/001-*` and `CHANGELOG.md` (FR-023).
  Trace tags use R-IDs, D-IDs and `M001/Sxx/Txx`.

**Scale/Scope**:

- 30 requirements, 15 decisions and 22 memories to transfer.
- 7 slices and 8 tasks to map.
- 13 branch commits (about 7,000 lines) to merge.
- About 280 tracked `.gsd/**` files after the merge.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle | Assessment | Status |
| --- | --- | --- |
| I. KISS | Plain git plus Markdown. There is no migration tooling or script to maintain, and verification is one-line shell checks. | PASS |
| II. YAGNI | S02–S07 get draft specs only (clarified). No new abstractions. Telemetry is discarded, not converted. | PASS |
| III. DRY | Each fact gets one destination (research R5). Decisions live only in `docs/decisions/`, and specs link to them. `gsd-export.md` is temporary and removed with GSD. Non-goals live once, in `docs/scope.md`. | PASS |
| IV. Unit tests for all code | No production code is written or changed. The merged S01 code comes with its unit tests, and they must pass on the staged merge before it is committed. | PASS (N/A for new code) |
| V. E2E for major requirements | The merge brings in S01 (R001–R004, R018). Its live-container end-to-end gate runs on the staged merge, and the merge is committed only if it passes. This satisfies the Quality Gates rule "end-to-end tests for every affected major requirement" before merge. | PASS |
| VI. Versioning + CHANGELOG | The merge commit itself creates `CHANGELOG.md` with an `Unreleased` entry for S01, so the changelog changes in the same change as the behaviour. The migration entry follows later. `package.json` is declared the version source. **Existing gap**: `versionName "1.0"` ≠ `0.0.1`; deferred to feature 011 (see Complexity Tracking). | PASS with justified deferral |
| VII. `./docs` mandatory | The merge commit adds `docs/README.md` and `docs/architecture.md`, describing the merged modules in the same change. US2 then expands `docs/` with overview, sync-and-deletion-safety, protocols, scope and decisions. | PASS |
| VIII. README user-facing | The merge has no user-visible change: S01 adds no UI, only native modules and tests. So `README.md` is not needed in the merge commit. It is created later, user-first, with an honest "current status" section. | PASS |
| IX. DEVELOPMENT.md | Created. It holds setup, gates, validation services, environment gotchas and the version source. | PASS |
| Quality gates | All of them, including the S01 live gate, run on the staged merge before it is committed, and again after removal. | PASS |

**Post-design re-check (after Phase 1)**: all principles still pass. The design adds no code, and the only
deviation is the Principle VI deferral, which existed before this feature.

## Project Structure

### Documentation (this feature)

```text
specs/001-gsd-speckit-migration/
├── spec.md
├── plan.md                  # this file
├── research.md              # Phase 0: findings R1–R10
├── data-model.md            # Phase 1: migration entities
├── quickstart.md            # Phase 1: validation commands per user story
├── contracts/
│   ├── migration-map.md         # format + required inventory
│   ├── decision-record.md       # docs/decisions/ template
│   └── transfer-verification.md # removal gate
├── checklists/
│   ├── requirements.md          # spec quality (exists)
│   └── transfer-verification.md # created in implementation from the contract
├── migration-map.md         # created in implementation; kept permanently
├── gsd-export.md            # created in implementation; deleted in the removal commit
└── tasks.md                 # /speckit-tasks
```

### Repository files created or changed

```text
README.md                    # new, user-facing
DEVELOPMENT.md               # new, developer-facing
CHANGELOG.md                 # new, Keep a Changelog, Unreleased
docs/
├── README.md                # index
├── overview.md
├── architecture.md
├── sync-and-deletion-safety.md
├── protocols.md
├── scope.md                 # v1 scope, deferred R023–R025, non-goals R026–R030
└── decisions/
    ├── README.md
    └── 0001-…md … 0015-…md
specs/
├── 002-native-cloudsync-connect/   # S01: spec, plan, research, tasks (T01–T08 [X] + re-verify [ ])
├── 003-local-source-selection/     # S02: spec (Draft, seeded)
├── 004-scan-engine-matching/       # S03
├── 005-gallery-list-filtering/     # S04
├── 009-tree-view-image-preview/    # S05
├── 010-multiselect-local-deletion/ # S06
└── 011-full-loop-release/          # S07
.gitignore                   # GSD block removed; generic entries kept (research R8)

# Removed in the final commit
.gsd/  .gsd-id  .gsd-worktrees/  .bg-shell/  .mcp.json  specs/001-…/gsd-export.md
# Removed outside git
branch milestone/M001 (git branch -d)
GSD entries in .claude/settings.local.json (globally git-ignored, so edited locally)
```

**Structure Decision**:

- Work is committed directly on `master`, which is the mainline that GSD preferences and the clarified
  merge target both use. `001-gsd-speckit-migration` is only the Spec Kit feature ID; no git branch is
  created for it, because a feature branch would have to be merged into `master` anyway right after the
  `milestone/M001` merge.
- Application directories (`src/`, `android/`, `scripts/`, `validation/`, `__tests__/`) receive only what
  the merge brings in.

## Execution Order and Commit Plan

> **Baseline deviation (2026-09-28)**: commits 769182d and e79e0f6 already put the Spec Kit files, the
> whole `.gsd/` tree and master's duplicate D015 script edits into git. Commit 0(a) is therefore covered by
> e79e0f6 plus a small follow-up, and the stage 1 merge has 17 expected conflicts: 15 add/add under
> `.gsd/**` (resolved by research R2) and 2 in `scripts/validation/` (resolved to `milestone/M001`). See
> `decisions.md`.

Each stage is one or more commits. Stages run strictly in order, and each stage's check (from
[quickstart.md](./quickstart.md)) must pass before the next stage starts.

| # | Stage | Commits | Gate to proceed |
| --- | --- | --- | --- |
| 0 | **Freeze, adopt Spec Kit, detach GSD** | (a) `chore(speckit): adopt Spec Kit and constitution v1.0.0`, which adds `.specify/`, `.claude/skills/speckit-*` and `specs/001-*`; (b) `chore: freeze GSD state before migration`, which contains every non-ignored `.gsd` file (the `*.md`, `phases/**`, `quarantine/**`, `*.json` and `*.jsonl`) and adds `specs/001-*/gsd-export.md` (research R4); (c) local only: remove the GSD servers from `.claude/settings.local.json` and restart the agent session | `git status` clean, no GSD process for this project. (Re-planned 2026-09-28: master's duplicate D015 script edits were committed in 769182d, so they are resolved to the branch's side during the stage 1 merge instead of being discarded.) |
| 1 | **Consolidate** | `git merge --no-ff --no-commit milestone/M001`. `.gsd/**` conflicts are resolved by the rule in research R2 and logged in the migration map. Add `CHANGELOG.md`, `docs/README.md` and `docs/architecture.md`. Run all gates on the staged result, including the S01 live gate. Only then run `git commit`, so these files and the evidence land in the merge commit | US1 checks; every gate green before the commit |
| 2 | **Transfer: docs** | `docs: …` commits: decisions 0001–0015, then architecture/protocols/safety/scope/overview, then README/DEVELOPMENT/CHANGELOG | US2 + US5 checks |
| 3 | **Transfer: features** | `docs(specs): …`: feature 002 in full (spec, plan, research, tasks with commit refs), then 003–008 as seeded drafts | US3 checks |
| 4 | **Verify** | `docs: complete migration map and transfer checklist` | Every item in [transfer-verification.md](./contracts/transfer-verification.md) `[X]` |
| 5 | **Remove** | One commit, `chore: remove GSD after migration to Spec Kit`: `git rm -r .gsd .bg-shell .mcp.json specs/001-*/gsd-export.md` plus the `.gitignore` edit. Then delete the untracked `.gsd/` runtime, `.gsd-id` and `.gsd-worktrees/`, and run `git branch -d milestone/M001` | US4 checks and post-removal checklist items |

**Rollback**:

- Stages 0–4 are additive, so reverting any commit is safe.
- Stage 5 is undone with one `git revert <sha>`, which restores the tracked files. The branch can be
  recreated from the merge commit's second parent. Untracked runtime is deliberately not recoverable
  (clarified).

**Risks**:

| Risk | Mitigation |
| --- | --- |
| GSD MCP server rewrites `.gsd/` after the freeze, because this session spawned it | Stage 0(c) detaches it right after the freeze commit. Transfer commits stage explicit paths, never `git commit -a`, so any leftover `.gsd` drift can only land in the removal commit. |
| Merged `master` fails a gate because of environment gaps (JDK, SDK) rather than code | Record it as a failure with its output and don't hide it (US1 scenario 3). Fix the environment by following the MEM015 guidance, and don't change code. |
| The live S01 gate can't run (no Docker or emulator) | The merge stays staged but uncommitted, and the migration stops for the maintainer to provide the environment. It is never skipped, because the constitution forbids merging without it. |

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Principle VI: version not yet derived from one source (`versionName "1.0"` vs `package.json` `0.0.1`) | This gap existed before the migration. Fixing it is a build change that needs its own unit test, and FR-005/FR-022 keep this migration free of build changes | Hand-editing `versionName` now still leaves two sources. The real fix is assigned to feature 011 (R019 release APK), and `DEVELOPMENT.md` declares `package.json` authoritative in the meantime. |
