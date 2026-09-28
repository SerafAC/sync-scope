# Feature Specification: Migrate SyncScope Project Management from GSD to Spec Kit

**Feature Branch**: `001-gsd-speckit-migration`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Here is an android file sync checking app project, that was started with a GSD framework. Please review GSD documentation, project state, and plan migrating it to Spec Kit. Include removal of GSD related files in the plan, when they will be transfered and it will be safe to do so."

## Current State Review (input to this spec)

Findings from the review of `.gsd/`, `project-definition.md` and git state on 2026-09-28:

| Area | GSD source | State |
| --- | --- | --- |
| Vision & core value | `.gsd/PROJECT.md`, `project-definition.md` | Complete: "knowing, with honest confidence, which local files are safe to delete" |
| Requirements | `.gsd/REQUIREMENTS.md` | 30 requirements: R001–R022 active (0 validated), R023–R025 deferred, R026–R030 out of scope |
| Decisions | `.gsd/DECISIONS.md` | 15 decisions D001–D015, append-only, with rationale and revisability |
| Roadmap | `.gsd/phases/01-syncscope-v1/01-ROADMAP.md` | Milestone M001 with 7 slices S01–S07 and a slice-to-slice boundary map |
| Active work | `01-01-PLAN.md`, `S01-T0x-SUMMARY.md`, `STATE.md` | GSD DB says T01–T07 complete, T08 `in_progress`; but the branch holds T08's code and a summary recording the live gate **passed** on API 31 (2026-09-23) — status was never closed. Slice S01 itself is still `pending` |
| Context & research | `01-CONTEXT.md`, `01-01-RESEARCH.md`, `CODEBASE.md` | Layered discussion record, library research, codebase map |
| Lessons / gotchas | GSD memory store (`gsd.db`, `last-snapshot.md`) | Environment and protocol gotchas, e.g. MEM017–MEM022 (emulator `-no-window`, WebDAV multi-value `DAV` header, vsftpd FEAT audit scoping) |
| Preferences | `.gsd/PREFERENCES.md` | Verification commands and coding rules, now covered by the constitution |
| Code location | git | **S01 code (T01–T07, ~7,000 lines of Kotlin, tests and scripts) is committed only on branch `milestone/M001`, not on `master`.** `master` has an uncommitted, equivalent Docker-pin change (D015) plus formatting-only edits to a validation test |
| Tooling footprint | repo root | `.gsd/` (7 tracked files, the rest ignored), `.gsd-id`, `.gsd-worktrees/`, `.bg-shell/`, `.mcp.json` (GSD servers only), a GSD baseline block in `.gitignore`, GSD server entries in `.claude/settings.local.json` |
| Spec Kit | `.specify/`, `.claude/skills/speckit-*` | Installed; constitution v1.0.0 ratified; no specs yet |
| Constitution gaps | repo root | No `./docs`, `README.md`, `DEVELOPMENT.md` or `CHANGELOG.md` exist yet |

> **Plan-phase correction (2026-09-28)**: research found T08 implemented, with a passing live gate recorded
> on 2026-09-23, but never closed in GSD. This spec therefore treats T08 as complete. The live gate is
> re-run on the merged mainline during consolidation (User Story 1) before S01 counts as validated.

## Clarifications

### Session 2026-09-28

- Q: How should the seven GSD roadmap slices (S01–S07) become Spec Kit features? → A: One Spec Kit
  feature per slice, 7 features numbered 002–008 (S01 → 002 … S07 → 008).
- Q: Should S02–S07 get full specs now or only when started? → A: Seed a draft spec per slice now from
  its GSD text (demo, boundary outputs, owned R-IDs); fully specify/clarify each when that slice starts.
- Q: How should `milestone/M001` be integrated into `master`? → A: A non-fast-forward merge commit that
  keeps every branch commit and hash unchanged; no squash, rebase or history rewrite.
- Q: What happens to untracked GSD runtime history before removal? → A: Deleted without an archive; the
  exported knowledge plus git history are the only record kept.

## User Scenarios & Testing *(mandatory)*

The actor throughout is the project maintainer (a solo developer who also uses AI agents), who needs to
keep developing SyncScope with Spec Kit without losing anything GSD recorded.

### User Story 1 - Consolidate the code on one mainline (Priority: P1)

The maintainer wants all work done under GSD (S01 tasks T01–T08) on the mainline branch, with the
uncommitted edits on the mainline resolved, so that Spec Kit features start from the real current code
and not from a scaffold missing most of S01.

**Why this priority**: Every later step depends on it. Spec Kit plans made against `master` today would
describe the persistence layer, protocol clients and TurboModule as missing, which is wrong.

**Independent Test**: Check out the mainline and run all quality gates. The S01 Kotlin sources and tests
are present, and the working tree is clean. Lint, type check, JS unit, foundation and JVM unit tests pass,
and so does the S01 live-container end-to-end gate. The merge commit also carries the `CHANGELOG.md` and
`./docs` updates that describe the merged code.

**Acceptance Scenarios**:

1. **Given** S01 work exists only on `milestone/M001`, **When** consolidation completes, **Then** every
   file changed on that branch is present on the mainline with identical content, apart from conflicts that
   were resolved and recorded.
2. **Given** `master` has an uncommitted Docker-pin change equivalent to D015, **When** consolidation
   completes, **Then** exactly one Docker-pin implementation exists, the branch version is kept, and nothing
   is left uncommitted.
3. **Given** the merge is staged but not yet committed, **When** the quality gates run, including the S01
   live-container end-to-end gate, **Then** all of them pass before the merge commit is created. If any gate
   fails, the merge is not committed, and the failure is recorded rather than hidden.
4. **Given** the merge brings in new behaviour and architecture, **When** the merge commit is created,
   **Then** the same commit adds `CHANGELOG.md` (an `Unreleased` entry for S01) and a `./docs` entry
   describing the merged architecture, as constitution Principles VI and VII require.

---

### User Story 2 - Transfer the product knowledge into Spec Kit and project docs (Priority: P1)

The maintainer wants the vision, requirements, decisions, architecture, research and lessons that GSD
recorded moved to their Spec Kit or `./docs` locations. They should be complete and traceable by their
original IDs, so nothing needs to be looked up in `.gsd/` again.

**Why this priority**: This knowledge carries the project's deletion-safety reasoning, e.g. why UNKNOWN is
never deletable and why matching ignores directories. Losing it would push later work to reverse decisions
made on purpose.

**Independent Test**: Take any R-ID, D-ID or listed gotcha from the GSD inventory and find its
destination through the migration map. The destination content keeps its meaning and rationale.

**Acceptance Scenarios**:

1. **Given** 30 GSD requirements, **When** transfer completes, **Then** each R-ID (active, deferred and
   out-of-scope) appears in exactly one Spec Kit feature spec or in the documented v1 scope/non-goals, and
   keeps its original ID as a trace reference.
2. **Given** 15 GSD decisions, **When** transfer completes, **Then** each D-ID exists as a decision record
   under `./docs` with its choice, rationale, rejected alternatives and revisability.
3. **Given** the GSD project, codebase map, context and research documents, **When** transfer completes,
   **Then** `./docs` has an architecture overview, the sync-matching and deletion-safety rules, and the
   protocol notes, as Principle VII of the constitution requires.
4. **Given** the recorded gotchas and lessons, **When** transfer completes, **Then** every one that still
   applies appears in `DEVELOPMENT.md` (for environment/tooling) or `./docs` (for protocol behaviour).
   Stale ones are listed as dropped, with the reason.

---

### User Story 3 - Continue the roadmap as Spec Kit features (Priority: P1)

The maintainer wants the M001 roadmap (S01–S07) expressed as Spec Kit features. S01 should show its true, completed
status, and the next session should open on the next unfinished feature.

**Why this priority**: Without this, work cannot resume under Spec Kit. Once S01 is re-proven during
consolidation, the next concrete deliverable is S02 (feature 003).

**Independent Test**: Open the S01 feature's task list. It shows T01–T08 completed, with commit links, the
2026-09-23 evidence and the consolidation re-run evidence. Spec Kit's active-feature pointer names feature
003.

**Acceptance Scenarios**:

1. **Given** the 7 GSD slices, **When** transfer completes, **Then** each slice maps to a Spec Kit feature,
   and each slice's "After this" demo and boundary-map outputs become that feature's acceptance scenarios.
2. **Given** S01 with T01–T08 implemented but T08's completion never recorded, **When** transfer completes,
   **Then** the S01 feature has a spec, plan and task list with T01–T08 marked complete and linked to the
   commits that delivered them. The task list cites T08's 2026-09-23 evidence and the live-gate re-run from
   consolidation, and S01's requirements are marked validated on the strength of that re-run.
3. **Given** slices S02–S07 not started, **When** transfer completes, **Then** each has a draft spec seeded
   from its milestone slice text, ready for full specification and clarification when that slice starts.

---

### User Story 4 - Remove GSD from the repository safely (Priority: P2)

Once transfer is verified, the maintainer wants every GSD artifact removed from the repository, so there
is one workflow, one source of truth and no GSD tooling left behind.

**Why this priority**: It matters for the DRY principle and to keep agents from following stale GSD state.
But it must come last, because removing files before the transfer is verified loses data.

**Independent Test**: After removal, search the repository for GSD references. Only migration history
(changelog, migration map) mentions GSD. All quality gates still pass, and Spec Kit commands still work.

**Acceptance Scenarios**:

1. **Given** the transfer verification checklist has not fully passed, **When** removal is attempted,
   **Then** removal does not proceed.
2. **Given** the checklist has fully passed, **When** removal completes, **Then** `.gsd/`, `.gsd-id`,
   `.gsd-worktrees/`, `.bg-shell/`, the GSD MCP server definitions and the GSD-specific `.gitignore` block
   are gone. The consolidated `milestone/M001` branch is deleted.
3. **Given** removal is complete, **When** a reviewer needs a removed tracked GSD file, **Then** it can be
   restored from a single identifiable removal commit. Untracked GSD runtime history is deliberately not
   recoverable.
4. **Given** removal is complete, **When** quality gates and Spec Kit commands run, **Then** they behave
   exactly as before removal.

---

### User Story 5 - Meet the constitution's documentation baseline (Priority: P2)

The maintainer wants `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` and `./docs` in place, since the
constitution makes them mandatory and they are the destinations for the transferred knowledge.

**Why this priority**: The constitution cannot be followed without them, and User Story 2 needs somewhere
to put its content.

**Independent Test**: Each file exists, and `README.md` puts user-facing content before developer content.
`CHANGELOG.md` has an `Unreleased` entry for the migration, and the version matches the single version
source.

**Acceptance Scenarios**:

1. **Given** none of the four exist, **When** this feature completes, **Then** all four exist, and each
   follows the principle that governs it (VI–IX).
2. **Given** the app is not yet usable end to end, **When** a user reads `README.md`, **Then** it states
   what the app does, what works today and what doesn't. It does not claim capabilities that haven't been
   delivered.

### Edge Cases

- A merge conflict between `milestone/M001` and `master` on the same validation script: the branch
  version wins unless `master` has a later intended change. Each resolution is recorded in the migration
  map.
- A GSD requirement that spans several slices (e.g. R020 end-to-end proof, R022 docs): it goes to one
  primary feature, with cross-references from the supporting features. It is never duplicated as a
  separate requirement.
- GSD content that conflicts with the constitution (e.g. a PREFERENCES `auto_push: true` setting, or
  worktree isolation): the constitution wins, and the conflict is listed as dropped with the reason.
- Knowledge that exists only in GSD's binary database (memories not exported to Markdown): it is exported
  and reviewed before removal. If export fails, removal is blocked.
- An interrupted GSD session left a lock, worktree or background shell state: no GSD process may be
  running during removal. Any leftover worktree is checked for unmerged commits before deletion.
- Unversioned GSD runtime logs (activity, journal, audit, forensics) and the database: these are gitignored,
  so git history cannot recover them, and they are deleted without an archive. Anything worth keeping in
  them (memories, task summaries, the forensics findings) MUST be exported and reviewed before removal.
- Non-GSD agent skills in `.agents/skills`, `.claude/skills` and `skills-lock.json`: not GSD artifacts,
  and they must be kept.

## Requirements *(mandatory)*

### Functional Requirements

**Inventory and mapping**

- **FR-001**: The migration MUST produce a migration map covering every GSD artifact in the repository.
  Each one is classified as *transfer* (with its destination), *superseded* (with what replaces it) or
  *discard* (with the reason).
- **FR-002**: The migration map MUST list every R-ID, D-ID, slice, task and exported memory with its
  destination, so each can be traced one-to-one.

**Code consolidation**

- **FR-003**: All commits on `milestone/M001` MUST be integrated into the mainline before any
  transfer that describes code state is finalized. This MUST be done with a single non-fast-forward merge
  commit that keeps every original commit hash. Squashing, rebasing or otherwise rewriting the branch
  history is not allowed, so that task-to-commit links (FR-013) stay valid. The merge MUST be staged
  without committing. All constitution quality gates, including the S01 live-container end-to-end gate,
  MUST pass on the staged result before the merge commit is created. The merge commit MUST also add `CHANGELOG.md`, with an `Unreleased` entry for the merged S01
  capabilities, and a `./docs` architecture entry describing the merged code (constitution VI and VII:
  docs are updated in the same change as the behaviour).
- **FR-004**: Uncommitted changes on the mainline MUST be resolved: kept and committed, or discarded as
  duplicates of the branch. The working tree MUST be clean when consolidation completes.
- **FR-005**: The consolidation MUST NOT change application behaviour beyond what the branch commits already
  contain. The only non-branch content the merge commit may add is the documentation required by FR-003.

**Knowledge transfer**

- **FR-006**: Every GSD requirement (R001–R030) MUST be carried into Spec Kit feature specs or a documented
  v1 scope/non-goals record, with its class, status (active/deferred/out of scope), rationale and original ID.
  Transferred content MUST use neutral trace tags (R-IDs, D-IDs, `M001/Sxx/Txx`) and MUST NOT use the word
  "GSD" (FR-023).
- **FR-007**: Every GSD decision (D001–D015) MUST be carried into a decision record under `./docs`, keeping
  its ID, context, choice, rationale, rejected alternatives and revisability.
- **FR-008**: Product vision and core value MUST be carried into `README.md` (user-facing) and `./docs`
  (detail). Architecture and key patterns MUST be carried into `./docs`.
- **FR-009**: Research findings and discussion context that still apply MUST be carried into the relevant
  feature's Spec Kit research/plan artifacts or `./docs`.
- **FR-010**: Environment and tooling gotchas MUST be carried into `DEVELOPMENT.md`, and protocol-behaviour
  gotchas into `./docs`.
- **FR-011**: GSD preferences MUST be checked against the constitution. Rules the constitution doesn't
  already cover are either added to `DEVELOPMENT.md` or listed as dropped with the reason.

**Roadmap and work continuation**

- **FR-012**: Each GSD slice S01–S07 MUST map to exactly one Spec Kit feature, numbered in dependency order
  after this migration feature: S01 → 002, S02 → 003, S03 → 004, S04 → 005, S05 → 006, S06 → 007,
  S07 → 008.
- **FR-013**: The S01 feature MUST have a spec, plan and task list reflecting actual status. T01–T08 are
  complete, each linked to its delivering commits. T08 cites both its 2026-09-23 gate evidence and the
  live-gate re-run on the staged merge (FR-003). S01's requirements (R001–R004, R018) are marked validated
  only on the strength of that re-run (FR-015).
- **FR-014**: The features for S02–S07 MUST each have a draft spec seeded from the GSD slice text, with status
  `Draft (seeded)`. Each slice's demo becomes that spec's acceptance scenarios, its boundary-map
  inputs and outputs become its dependencies, and the R-IDs it owns become its requirements. These specs
  are not clarified or planned in this migration; each is completed with `/speckit-specify` and
  `/speckit-clarify` when that slice starts.
- **FR-015**: Requirement status MUST be accurate: nothing may be marked validated unless its proof exists
  (GSD recorded 0 validated).

**Constitution baseline**

- **FR-016**: `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` and a `./docs` index MUST be created per
  Principles VI–IX of the constitution.
- **FR-017**: `CHANGELOG.md` MUST record the migration under `Unreleased`.

**Safe removal**

- **FR-018**: Removal MUST be gated on a transfer verification checklist that passes in full. It MUST
  confirm:
  - every migration-map row is resolved;
  - every R-ID and D-ID resolves to its destination;
  - S01 status (T01–T08 complete, with the 2026-09-23 and consolidation gate evidence) is captured;
  - consolidation is complete and quality gates pass;
  - the GSD memory export has been reviewed;
  - no unmerged commits remain on any GSD branch or worktree.
- **FR-019**: Removal MUST cover:
  - `.gsd/`, `.gsd-id`, `.gsd-worktrees/` and `.bg-shell/`;
  - the GSD MCP server definitions (removing `.mcp.json` if nothing else is left in it);
  - GSD server entries in project agent settings;
  - GSD-only entries in `.gitignore`;
  - the `milestone/M001` branch;
  - untracked GSD runtime history. It is deleted without an archive, and only after FR-018 confirms that
    its memories, task summaries and forensics findings have been exported and reviewed.
- **FR-020**: Generic `.gitignore` entries in the GSD baseline block that still protect the project (for
  example `*.log`, `.vscode/`) MUST be kept or moved, not deleted blindly.
- **FR-021**: Removal of tracked files MUST happen in one dedicated commit, separate from transfer commits,
  so a single revert undoes it.
- **FR-022**: Removal MUST NOT touch non-GSD agent skills, Spec Kit files, application code, tests or
  validation infrastructure. It also MUST NOT touch the user-level GSD installation outside the repository.
- **FR-023**: After removal, GSD MUST NOT be referenced anywhere in the repository except in migration
  history (the migration map and `CHANGELOG.md`).

### Key Entities

- **Migration map**: The authoritative inventory of GSD artifacts. Each row has the source, its
  classification, the destination or reason, and verification status.
- **Requirement (R-ID)**: A GSD capability-contract entry with class, status, owning slice and rationale. It
  becomes a functional requirement in a Spec Kit feature and keeps its R-ID as a trace.
- **Decision (D-ID)**: An append-only architectural or process decision. It becomes a decision record in
  `./docs`.
- **Slice (S01–S07)**: A vertical unit of the M001 roadmap. It becomes one Spec Kit feature.
- **Task (T01–T08)**: A unit of work in S01. It becomes a task-list entry with completion status and the
  commit reference.
- **Transfer verification checklist**: The gate that must fully pass before removal.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 30 requirements, all 15 decisions, all 7 slices and all 8 S01 tasks can be traced to a
  Spec Kit or `./docs` destination (100% coverage in the migration map).
- **SC-002**: A developer starting a fresh session can find the next open work item (feature 003,
  S02 local source selection) and its acceptance criteria in under 5 minutes, using only Spec Kit
  artifacts and without opening any GSD file. Verified by a timed fresh-session check.
- **SC-003**: After removal, a repository-wide search for GSD finds zero references outside the migration
  history.
- **SC-004**: All quality gates, including the S01 live-container end-to-end gate, pass both before
  removal (on the staged merge) and after removal, with identical results.
- **SC-005**: No S01 code is lost: every file changed on `milestone/M001` exists on the mainline with
  identical content, or with a recorded conflict resolution.
- **SC-006**: Removing tracked GSD files takes a single commit, which a single revert fully restores.

## Assumptions

- The mainline branch is `master`, which is what GSD preferences and the only local mainline branch use.
  `milestone/M001` is merged into it, and no new branch name is required. The six "auto-commit after
  stop" commits are kept in history as they are.
- Untracked GSD runtime history (activity logs, journal, audit and event logs, forensics, backups, the
  database) is deleted without an archive, either inside or outside the repository. The exported knowledge
  and git history are the only record kept.
- The user-level GSD installation (`~/.gsd`, global CLI, MCP server package) is left alone. Uninstalling it
  is the maintainer's choice and outside this repository.
- `project-definition.md` is the original brief, not a GSD artifact. After its content is reflected in
  `README.md` and `./docs`, it stays as the historical brief.
- The constitution (v1.0.0) already captures GSD's coding rules (KISS, YAGNI, DRY, tests) and verification
  commands. Only rules it doesn't cover need transferring.
- The version stays at the current `package.json` value (0.0.1) with the migration under `Unreleased`.
  The migration doesn't change user-facing behaviour, so no version bump is required.
