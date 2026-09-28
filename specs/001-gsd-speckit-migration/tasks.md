---

description: "Task list for migrating SyncScope project management from GSD to Spec Kit"
---

# Tasks: Migrate SyncScope Project Management from GSD to Spec Kit

**Input**: Design documents from `/specs/001-gsd-speckit-migration/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: This feature has no test tasks because it writes no production code (plan, Constitution Check
IV). The stories are verified instead by the scripted checks in [quickstart.md](./quickstart.md), by the
existing quality gates, and by the S01 live-container end-to-end gate. These appear below as verification
tasks.

**Organization**: Tasks are grouped by user story. The phase order follows the dependencies between
stories, not their priority alone. US5 (P2) comes before US4 (P2) because removal needs the full
documentation baseline in place.

**Working rules for every task**:

- Work on `master`, from the repository root.
- Never modify `src/`, `android/`, `scripts/`, `validation/` or `__tests__/` except through the merge in
  T010.
- Stage explicit paths. Never use `git commit -a` or `git add -A`, so that stray `.gsd/` drift can't enter
  a transfer commit.
- In every file you write outside `specs/001-gsd-speckit-migration/` and `CHANGELOG.md`, **never write the
  word "GSD"** (FR-023). Use neutral trace tags instead: R-IDs, D-IDs, MEM-IDs and `M001/Sxx/Txx`. The
  `.gsd/...` source paths may only be cited inside `specs/001-gsd-speckit-migration/`.
- If a check fails, stop and record its output in
  `specs/001-gsd-speckit-migration/checklists/transfer-verification.md` rather than working around it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: The task can run in parallel with others (it touches different files and depends on no
  incomplete task).
- **[Story]**: The user story the task belongs to (US1–US5).

---

## Phase 1: Setup (Spec Kit adoption)

**Purpose**: Put Spec Kit itself under version control and record the starting state.

- [X] T001 Record the baseline in `specs/001-gsd-speckit-migration/checklists/transfer-verification.md`.
  Create the file by copying every item from
  `specs/001-gsd-speckit-migration/contracts/transfer-verification.md`, all unchecked. Then append a
  "Baseline (2026-09-28)" section containing the output of:
  - `git status --porcelain`
  - `git worktree list`
  - `git log --oneline master..milestone/M001` (expect 13 commits)
  - `git merge-tree --write-tree --name-only master milestone/M001` (re-planned 2026-09-28: expect exit 1
    with 17 conflicts, 15 add/add under `.gsd/**` and 2 content conflicts in `scripts/validation/`; see
    `decisions.md`)
- [X] T002 [P] Delete the `<!-- Sync Impact Report … -->` HTML comment at the top of
  `.specify/memory/constitution.md`. It is scratch text and must be removed before commit. Change no
  other line.
- [X] T003 [P] In `specs/001-gsd-speckit-migration/checklists/requirements.md`, replace the Notes bullet
  "archive untracked GSD history outside the repository" with "delete untracked GSD history without an
  archive (clarified 2026-09-28)".
- [X] T004 Commit the Phase 1 follow-up. (Re-planned 2026-09-28: `.specify/`, `.claude/skills/speckit-*`
  and `specs/001-gsd-speckit-migration` were already committed in e79e0f6, which counts as the adoption
  commit.)
  - `git add .specify/memory/constitution.md specs/001-gsd-speckit-migration/checklists`
  - `git commit -m "chore(speckit): finalize constitution v1.0.0 and record migration baseline"`

  Then verify that `git ls-files .specify .claude/skills specs | head` lists the Spec Kit files and that
  `git status --porcelain` shows nothing under `.specify/`, `.claude/skills/speckit-*` or `specs/`
  (except `specs/*/.autopilot/`, which is git-excluded).

---

## Phase 2: Foundational (freeze GSD state, detach GSD runtime; blocks all user stories)

**Purpose**: Put every piece of GSD source material into git (research R2, R4), then make sure nothing
can rewrite it (research R7).

**⚠️ CRITICAL**: No user story work can begin until T009 is done.

- [X] T005 (Re-planned 2026-09-28.) Master's duplicate of D015 is no longer uncommitted: it was committed
  in 769182d, so `git restore` no longer applies. Do not touch `scripts/` here. Instead record in
  `checklists/transfer-verification.md` the output of
  `git diff master milestone/M001 -- scripts/validation/protocol-service.sh scripts/validation/validation-infrastructure.test.mjs`
  and note that T011 resolves both files to the branch's side, which carries the authoritative D015
  implementation and its tests (research R2).
- [X] T006 [P] Export the GSD database to `specs/001-gsd-speckit-migration/gsd-export.md` with
  `sqlite3 .gsd/gsd.db`. Add the header note "Temporary migration export, deleted in the GSD removal
  commit." Then write three sections:
  - `## Memories`: one Markdown table row per memory, from
    `select id, category, content, coalesce(superseded_by,'') from memories order by seq`. Include the full
    `content` without truncating it, and escape pipes. Expect 22 rows, MEM001–MEM022.
  - `## Task status`: from `select id, status from tasks`.
  - `## Slice status`: from `select id, status from slices`.
- [X] T007 [P] Create `specs/001-gsd-speckit-migration/migration-map.md` following
  `specs/001-gsd-speckit-migration/contracts/migration-map.md`:
  - One table per kind, in this order: tooling, document, requirement, decision, memory, slice, task,
    runtime.
  - Columns `| Source | Disposition | Destination / Reason | Verified |`.
  - One row for every item in the contract's "Required inventory": R001–R030, D001–D015, MEM001–MEM022,
    S01–S07, S01/T01–T08, and every document, tooling and runtime path listed there.
  - Leave Disposition and Destination empty, and set Verified to `[ ]`.
- [X] T008 Commit the freeze:
  - `git add .gsd specs/001-gsd-speckit-migration/gsd-export.md specs/001-gsd-speckit-migration/migration-map.md`.
    This adds every non-ignored `.gsd` file (the `*.md`, `phases/**`, `quarantine/**`, `*.json` and
    `*.jsonl`), as research R2 describes. `.gitignore` already excludes the runtime.
  - `git commit -m "chore: freeze GSD state before migration"`

  Then verify that `git status --porcelain` is empty.
- [X] T009 Detach the GSD runtime. This is local only, because `.claude/settings.local.json` is globally
  git-ignored.
  1. Remove `"gsd-workflow"` and `"gsd-browser"` from `enabledMcpjsonServers` in
     `.claude/settings.local.json`. Delete the key if the list becomes empty, and delete the file if it
     becomes `{}`.
  2. **Ask the maintainer to restart the agent session.**
  3. After the restart, confirm that `pgrep -af 'gsd-pi|gsd-browser'` shows no process for this project
     and that `git status --porcelain` is still empty.
  4. Tick "GSD runtime detached" in `checklists/transfer-verification.md`.

**Checkpoint**: The complete `DECISIONS.md` (with D013–D015) and the knowledge that lived only in the
database are now in git, and nothing can rewrite `.gsd/` any more.

---

## Phase 3: User Story 1 — Consolidate the code on one mainline (Priority: P1) 🎯 MVP

**Goal**: S01's code (M001/S01/T01–T08) is on `master` with every commit hash kept. It is proven by every
gate, including the live end-to-end gate, before the merge commit exists. The merge commit carries the
matching CHANGELOG and docs.

**Independent Test**: [quickstart.md § US1](./quickstart.md#us1-code-consolidated).

- [X] T010 [US1] Stage the merge without committing it:
  `git merge --no-ff --no-commit milestone/M001`. Never squash or rebase (FR-003).
- [X] T011 [US1] Resolve any conflicts using the rule in research R2:
  - For `.gsd/DECISIONS.md`, keep master's side (`git checkout --ours .gsd/DECISIONS.md`). It is the only
    copy that contains D013–D015.
  - For every other conflicted `.gsd/**` path, keep the branch's side (`git checkout --theirs <path>`).
  - For `scripts/validation/protocol-service.sh` and
    `scripts/validation/validation-infrastructure.test.mjs`, keep the branch's side
    (`git checkout --theirs <path>`). These conflicts come from master's duplicate D015 commit 769182d
    (re-planned 2026-09-28, see `decisions.md`); the branch's side is authoritative.
  - If any other conflict falls outside `.gsd/**`, **stop and ask the maintainer**.
  - `git add` each resolved path.
  - Add one `tooling` row per resolved file to `specs/001-gsd-speckit-migration/migration-map.md`, naming
    the side that won.
- [X] T012 [P] [US1] Create `CHANGELOG.md` in Keep a Changelog format. Under `## [Unreleased]` → `### Added`,
  add one entry describing the merged S01 capabilities:
  - Room persistence layer;
  - CloudSync TurboModule registration;
  - read-only FTP, SFTP and WebDAV clients with discovered timestamp precision;
  - SFTP host-key trust-on-first-use;
  - Keystore-backed credential storage;
  - validation-script fixes.

  Don't write the word "GSD" in this entry. This satisfies constitution VI, which requires the changelog
  in the same change as the behaviour.
- [X] T013 [P] [US1] Create `docs/README.md` and `docs/architecture.md`, which satisfies constitution VII
  (docs in the same change as the behaviour).
  - `docs/README.md`: a one-line index. Later tasks add links to it.
  - `docs/architecture.md`: an initial description of the merged native layer. Cover:
    - the single CloudSync TurboModule boundary;
    - the packages `android/app/src/main/java/com/syncscope/{bridge,persistence,remote,credential}`;
    - the Room scan store, and the rule that credentials never touch it;
    - that 13 spec methods still return `NOT_IMPLEMENTED`.

  Sources are `.gsd/PROJECT.md` and the merged code. T019 expands this file.
- [X] T014 [US1] Verify that nothing was lost (SC-005). Both of these must be empty:
  - `git diff milestone/M001 -- . ':!.gsd' ':!specs' ':!.specify' ':!.claude' ':!CHANGELOG.md' ':!docs'`
    (this compares the working tree to the branch);
  - `git log --oneline master..milestone/M001` after the commit in T016.

  Record the first result in `checklists/transfer-verification.md` now.
- [X] T015 [US1] Run every gate on the **staged, uncommitted** merge, and record each command's exit code
  and output tail in `checklists/transfer-verification.md`:
  - `pnpm install --frozen-lockfile`
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test:ci`
  - `pnpm test:android:unit`
  - the S01 live gate:
    `pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`.
    Expect exit 0, 8/8 instrumented tests and three clean protocol audits.

  If a failure comes from the environment (JDK, `ANDROID_HOME`, a leftover `/tmp/cloud-sync-checker-api31`,
  or a missing emulator `-no-window`), fix the environment using MEM015 and MEM021 in `gsd-export.md`, and
  never change code to get past it. If a gate still fails, or Docker or the emulator is unavailable,
  **do not commit the merge**. Stop and ask the maintainer (plan, Risks).
- [X] T016 [US1] Commit the merge only after every item in T015 passes. Run
  `git add CHANGELOG.md docs specs/001-gsd-speckit-migration`, then
  `git commit -m "Merge milestone/M001: S01 native CloudSync module and live protocol connect (M001/S01/T01–T08)"`.
  Afterwards:
  - Re-run `git log --oneline master..milestone/M001` and expect it to be empty.
  - Confirm that `git show --stat HEAD` lists `CHANGELOG.md`, `docs/README.md` and `docs/architecture.md`.
  - Tick "Consolidated", "Gates green on the staged merge" and "Docs in the merge commit" in the checklist.
  - Commit the checklist with `git add specs/001-gsd-speckit-migration/checklists && git commit -m "docs: record S01 consolidation evidence"`.

**Checkpoint**: `master` holds the real S01 code, proven end to end, and documented in the same change.

---

## Phase 4: User Story 2 — Transfer product knowledge into docs (Priority: P1)

**Goal**: Every decision, the architecture, the safety rules, the protocol behaviour, the scope and the
gotchas live in `./docs` or `DEVELOPMENT.md`. Each one can be traced by its ID.

**Independent Test**: [quickstart.md § US2](./quickstart.md#us2-knowledge-transferred).

**Source rule**:

- Decisions come only from `.gsd/DECISIONS.md` on merged `master`.
- Requirements come from `.gsd/REQUIREMENTS.md`.
- Architecture comes from `.gsd/PROJECT.md` and `.gsd/CODEBASE.md`.
- Gotchas come from `specs/001-gsd-speckit-migration/gsd-export.md`.

Keep the meaning; reformatting is fine. Follow the neutral-wording rule.

- [X] T017 [P] [US2] Create the decision records D001–D008 in `docs/decisions/`, following
  `specs/001-gsd-speckit-migration/contracts/decision-record.md`:
  - `0001-single-cloudsync-turbomodule.md`
  - `0002-room-scan-store-keystore-credentials.md`
  - `0003-directory-agnostic-sync-matching.md`
  - `0004-discovered-timestamp-precision.md`
  - `0005-protocol-client-libraries.md`
  - `0006-unknown-status-never-deletable.md`
  - `0007-sftp-host-key-tofu.md`
  - `0008-two-phase-local-deletion.md`

  Give every record Status `Accepted` and fill every template section, writing `none` where the original
  recorded nothing. List the related R-IDs, meaning the R-IDs whose Notes name the decision's subject.
- [X] T018 [P] [US2] Create the decision records D009–D015 in `docs/decisions/`, following the same
  contract:
  - `0009-foreground-scan-and-freshness.md`
  - `0010-snapshot-paging-and-origin-badge.md`
  - `0011-typed-error-envelopes-partial-scans.md`
  - `0012-maestro-e2e-proof-bar.md`
  - `0013-full-persistence-layer-in-s01.md`
  - `0014-container-credentials-via-runner-args.md`
  - `0015-docker-major-version-pin.md`
- [X] T019 [P] [US2] Expand `docs/architecture.md`, which T013 started. Add:
  - the full "Architecture / Key Patterns" content from `.gsd/PROJECT.md` and `.gsd/CODEBASE.md`;
  - snapshot-scoped paging clamped to 200;
  - two-phase deletion;
  - the enforcement of the Keystore credential boundary by `SchemaContractTest`;
  - the validation infrastructure.

  Link each pattern to its decision record instead of restating the rationale.
- [X] T020 [P] [US2] Create `docs/overview.md` with:
  - the vision and core value ("knowing, with honest confidence, which local files are safe to delete");
  - the user loop: connect → pick folders → scan → browse and filter → select → delete locally;
  - a glossary of SYNCED, UNSYNCED, UNKNOWN, snapshot, remote root and source.
- [X] T021 [P] [US2] Create `docs/sync-and-deletion-safety.md`. Cover:
  - matching by name + size + mtime within the precision bucket, ignoring directories;
  - precision discovered at connect time;
  - UNKNOWN is never deletable;
  - partial scans are shown as partial;
  - two-phase delete with a pre-flight breakdown;
  - the remote-listing age shown near delete, with a rescan suggested after 7 days.

  Link D003, D004, D006, D008, D009 and D011, and cite R007, R012, R013, R015 and R017.
- [X] T022 [P] [US2] Create `docs/protocols.md`. Cover:
  - **FTP** (Apache Commons Net): the MDTM / MLSD / LIST precision basis, and the breadth-first precision
    sample capped at `PRECISION_SCAN_DIRECTORIES = 16`.
  - **SFTP** (SSHJ): blocking trust-on-first-use with a `SHA256:` fingerprint.
  - **WebDAV** (OkHttp PROPFIND): the multi-value `DAV` header (MEM020).
  - **The read-only guarantee**: how `scripts/validation/protocol-audit.sh` enforces it, including the
    `FTP command:` scoping for vsftpd (MEM022).
  - **Validation container ports**: `10.0.2.2` FTP 32120, SFTP 32122, WebDAV 32180.

  Sources are `.gsd/phases/01-syncscope-v1/S01-T0{3,4,5,8}-SUMMARY.md` and `01-01-RESEARCH.md`.
- [X] T023 [P] [US2] Create `docs/scope.md`:
  - v1 scope in one paragraph: one server, one remote root, one profile, foreground only, local APK;
  - a "Deferred" section with R023, R024 and R025;
  - a "Non-goals" section with R026, R027, R028, R029 and R030.

  Each entry keeps its R-ID, its class, its "Why it matters" and the rationale from its Notes.
- [X] T024 [US2] Create `DEVELOPMENT.md` with a `## Environment gotchas` section:
  - MEM015: `ANDROID_HOME`/`sdk.dir`, and the JDK 21+ test launcher.
  - MEM016: `robolectric.properties` pins `android.app.Application`.
  - MEM017: run `pnpm install --frozen-lockfile` before Gradle, and export `ANDROID_HOME`. Leave out the
    worktree framing.
  - MEM021: the emulator needs `-no-window`, and stale `/tmp/cloud-sync-checker-api31` state has to be
    cleared.
  - The known issues from M001/S01/T08: `-no-window` is unconditional, and API 36 coverage is deferred
    to feature 008.

  US5 completes the rest of the file.
- [X] T025 [US2] Add the decision index and the docs links:
  - Create `docs/decisions/README.md`. It depends on T017 and T018. Give it one table with the columns
    ID, title (linked), status, scope and date. State "Append-only: reverse a decision with a new record
    that supersedes it; new records continue from 0016."
  - Add links to `overview.md`, `sync-and-deletion-safety.md`, `protocols.md`, `scope.md` and
    `decisions/README.md` in `docs/README.md`, one line each.
- [X] T026 [US2] Fill the rows of `specs/001-gsd-speckit-migration/migration-map.md` for decision, memory,
  document and PREFERENCES:
  - **Decisions**: D001–D015 → `transfer`, pointing to their `docs/decisions/` files.
  - **Memories**:
    - MEM001–MEM014 and MEM019 → `superseded`, by the matching D-ID.
    - MEM015–MEM017 and MEM021 → `transfer`, to `DEVELOPMENT.md#environment-gotchas`.
    - MEM020 and MEM022 → `transfer`, to `docs/protocols.md`.
    - MEM018 → `discard`, reason "stale; superseded by D015".
  - **Documents**: each `.gsd/*.md` → its destination, or `superseded` or `discard` with a reason.
  - **`.gsd/PREFERENCES.md`**:
    - `verification_commands` and `custom_instructions` → `superseded` by the constitution.
    - `git.auto_push: true` and `git.isolation: worktree` → `discard`, reason "conflicts with the
      constitution's reviewed-commit workflow; not adopted".
    - `main_branch: master` → `transfer`, to `DEVELOPMENT.md`.
- [X] T027 [US2] Verify US2:
  1. Run the D and MEM checks in quickstart § US2.
  2. Spot-check D003, MEM020 and one D-ID picked at random against the originals.
  3. Set `Verified [X]` on every row filled in T026.
  4. Commit with
     `git add docs DEVELOPMENT.md specs/001-gsd-speckit-migration && git commit -m "docs: transfer decisions, architecture and gotchas into ./docs"`.

**Checkpoint**: No decision or gotcha needs `.gsd/` any more.

---

## Phase 5: User Story 3 — Continue the roadmap as Spec Kit features (Priority: P1)

**Goal**: S01 becomes feature 002, complete and validated. S02–S07 become draft features 003–008, and
Spec Kit points at 003.

**Independent Test**: [quickstart.md § US3](./quickstart.md#us3-roadmap-continues-under-spec-kit).

**Source rule**:

- Take the slice text from `.gsd/phases/01-syncscope-v1/01-ROADMAP.md`: the "After this" demo,
  `depends:[]` and the Boundary Map.
- Take requirements from `.gsd/REQUIREMENTS.md`.
- Use the structure of `.specify/templates/spec-template.md`.
- Tag every FR with its R-ID and class, e.g. `(R005, core-capability)`.
- Link to `docs/decisions/` instead of restating decisions. Follow the neutral-wording rule.

- [X] T028 [US3] Create `specs/002-native-cloudsync-connect/spec.md` from M001/S01, with status `Complete`:
  - Primary FRs R001, R002, R003, R004 and R018, each marked **Validated** and citing the consolidation
    live-gate evidence recorded in T015.
  - Acceptance scenarios: the S01 demo plus the S01 must-haves in `.gsd/phases/01-syncscope-v1/01-01-PLAN.md`.
  - A "Provides" section listing the S01→S02 and S01→S03 boundary outputs.
- [X] T029 [US3] Create `specs/002-native-cloudsync-connect/plan.md` and
  `specs/002-native-cloudsync-connect/research.md`:
  - `plan.md`: the goal, must-haves, proof level and integration closure from `01-01-PLAN.md`; a
    Constitution Check table against `.specify/memory/constitution.md`; and the Kotlin package structure.
  - `research.md`: the findings from `.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md` and the layers of
    `01-CONTEXT.md` that still apply, plus the `key_decisions` from the front matter of
    `S01-T01…T08-SUMMARY.md`, in the Decision / Rationale / Alternatives format.
- [X] T030 [US3] Create `specs/002-native-cloudsync-connect/tasks.md` in Spec Kit format. Every task is
  `[X]`, tagged with its milestone trace and its delivering commit(s) from `milestone/M001`:

  | Task | Trace | Commit(s) |
  | --- | --- | --- |
  | T001 | `(M001/S01/T01)` | `7c4d394` |
  | T002 | `(M001/S01/T02)` | `ca9dd60` |
  | T003 | `(M001/S01/T03)` | `9500a9c` |
  | T004 | `(M001/S01/T04)` | `3001c5d` |
  | T005 | `(M001/S01/T05)` | `a01bb64` |
  | T006 | `(M001/S01/T06)` | `bb37998` |
  | T007 | `(M001/S01/T07)` | `f331aad` |
  | T008 | `(M001/S01/T08)` | `8e38f68`, `c04b121`, `16d75ac` |

  - For each task, confirm the hash with `git show --stat <sha>` against the task's file list.
  - T008 cites two pieces of evidence: "live gate exit 0 on API 31, 8/8 instrumented tests, three protocol
    audits clean, 2026-09-23", and the consolidation re-run from T015, with its date and merge sha.
  - Add no open tasks.
- [X] T031 [P] [US3] Seed `specs/003-local-source-selection/spec.md` from M001/S02:
  - Status `Draft (seeded)`.
  - Depends on 002.
  - Primary requirement R005. Supporting R020 and R022.
  - Demo: Add folder through the SAF picker (including removable storage), sources persist across restart,
    a revoked grant shows as unavailable, proven by Maestro on API 31 and API 36.
  - Provides the S02→S03 outputs, including creating `validation/maestro/`.
- [X] T032 [P] [US3] Seed `specs/004-scan-engine-matching/spec.md` from M001/S03:
  - Status `Draft (seeded)`.
  - Depends on 002 and 003.
  - Primary requirements R006, R007, R015, R016 and R017. Supporting R020 and R022.
  - Include the demo and the S03→S04 and S03→S05 outputs.
- [X] T033 [P] [US3] Seed `specs/005-gallery-list-filtering/spec.md` from M001/S04:
  - Status `Draft (seeded)`.
  - Depends on 004.
  - Primary requirements R008, R009, R011 and R021. Supporting R020 and R022.
  - Include the demo and the S04→S05 and S04→S06 outputs.
- [X] T034 [P] [US3] Seed `specs/006-tree-view-image-preview/spec.md` from M001/S05:
  - Status `Draft (seeded)`.
  - Depends on 005.
  - Primary requirements R010 and R014. Supporting R011, R021 and R022.
  - Add the open detail from R010's Notes (directories filtered to empty stay visible, dimmed, with a
    count) as a `[NEEDS CLARIFICATION]` item.
  - Include the demo and the S05→S06 outputs.
- [X] T035 [P] [US3] Seed `specs/007-multiselect-local-deletion/spec.md` from M001/S06:
  - Status `Draft (seeded)`.
  - Depends on 005 and 006.
  - Primary requirements R012 and R013. Supporting R015, R021 and R022.
  - Include the demo and the S06→S07 outputs.
- [X] T036 [P] [US3] Seed `specs/008-full-loop-release/spec.md` from M001/S07:
  - Status `Draft (seeded)`.
  - Depends on 002–007.
  - Primary requirements R019, R020 and R022. Their existing wording already covers API 36; cite them and
    add no duplicate FR.
  - Include the demo and the integration closure.
  - Add one new FR: derive Android `versionName` and `versionCode` from the `package.json` version, with a
    unit test. This is the Principle VI deferral recorded in
    `specs/001-gsd-speckit-migration/plan.md` Complexity Tracking.
- [X] T037 [US3] Fill the requirement, slice and task rows of
  `specs/001-gsd-speckit-migration/migration-map.md`:
  - each active R-ID → its primary spec FR anchor;
  - R023–R030 → `docs/scope.md`;
  - S01–S07 → `specs/002…008`;
  - T01–T08 → `specs/002-native-cloudsync-connect/tasks.md`.

  Then run the R-trace loop from quickstart § US2. It must print nothing, and each active R-ID must be a
  primary FR in exactly one of `specs/00{2..8}-*/spec.md`. Set these rows to Verified `[X]`.
- [X] T038 [US3] Point Spec Kit at the next feature: write
  `{"feature_directory": "specs/003-local-source-selection"}` to `.specify/feature.json`. Run the checks in
  quickstart § US3, then commit with
  `git add specs .specify/feature.json && git commit -m "docs(specs): transfer M001 roadmap into Spec Kit features 002–008"`.

**Checkpoint**: A fresh session opens on feature 003 (SC-002).

---

## Phase 6: User Story 5 — Constitution documentation baseline (Priority: P2)

**Goal**: `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` and the `docs/` index satisfy constitution
Principles VI–IX.

**Independent Test**: [quickstart.md § US5](./quickstart.md#us5-constitution-documentation-baseline).

- [ ] T039 [P] [US5] Create `README.md`, user-facing content first:
  1. What SyncScope does and why, in one paragraph taken from `docs/overview.md`.
  2. An honest **Current status**: connecting over FTP, SFTP and WebDAV is implemented and proven.
     Selecting sources, scanning, the views and deletion are not available yet.
  3. The supported protocols, and what the app never does: no upload, no remote delete, no download.
  4. How to install a debug APK.
  5. Only then, a "For developers" link to `DEVELOPMENT.md` and `docs/`.

  Claim nothing that hasn't been delivered.
- [ ] T040 [US5] Complete `DEVELOPMENT.md`. This extends T024 and depends on it. Add:
  - Prerequisites: Node 24.11.1, pnpm 11.3.0, JDK 21+, the Android SDK (minSdk 31 / compileSdk 37 /
    targetSdk 36), Docker 29.x, Compose 5.5.1 and Maestro 2.10.0.
  - Every `package.json` script, grouped as build / quality gates / validation services / emulator flows.
  - The S01 live gate command.
  - The mainline branch, `master`.
  - The Spec Kit workflow (specify → clarify → plan → tasks → implement), with `.specify/feature.json` as
    the active-feature pointer.
  - Versioning: the `version` in `package.json` is the single source of truth, and aligning `versionName`
    is tracked in `specs/008-full-loop-release`.
  - The release and CHANGELOG procedure.
  - Links to `docs/` for technical depth.
- [ ] T041 [P] [US5] Extend `CHANGELOG.md` under `## [Unreleased]`:
  - `### Added`: project docs under `docs/`, plus README, DEVELOPMENT and the Spec Kit feature specs
    002–008.
  - `### Changed`: project management migrated from GSD to Spec Kit, see
    `specs/001-gsd-speckit-migration/migration-map.md`.

  Leave the "Removed" line to T047.
- [ ] T042 [US5] Run the checks in quickstart § US5, then commit with
  `git add README.md DEVELOPMENT.md CHANGELOG.md && git commit -m "docs: add README and DEVELOPMENT, extend CHANGELOG"`.

**Checkpoint**: The constitution baseline is in place, and every transfer destination exists.

---

## Phase 7: User Story 4 — Remove GSD safely (Priority: P2)

**Goal**: No GSD artifact is left in the repository, and one revert undoes the removal of tracked files.

**Independent Test**: [quickstart.md § US4](./quickstart.md#us4-gsd-removed).

**⚠️ GATE**: T043 has to end with every pre-removal item marked `[X]`. If any item fails, **stop** and do
not run T044–T047.

- [ ] T043 [US4] Complete the pre-removal gate in
  `specs/001-gsd-speckit-migration/checklists/transfer-verification.md`:
  1. Run every check listed under "Items", including the "Neutral wording" dry run.
  2. Tick each item that passes and record its evidence.
  3. Confirm that every row in `migration-map.md` has a disposition and is marked `Verified [X]`.
  4. Fill any tooling and runtime rows that are still empty as `discard`, with the reasons from research R7.
  5. Commit with
     `git add specs/001-gsd-speckit-migration && git commit -m "docs: complete migration map and transfer checklist"`.
- [ ] T044 [US4] Make the single removal commit (FR-021):
  1. Stage the deletions with
     `git rm -r -q .gsd .bg-shell .mcp.json specs/001-gsd-speckit-migration/gsd-export.md`.
  2. Edit `.gitignore` as research R8 describes:
     - delete the whole `# ── GSD baseline (auto-generated) ──` block;
     - re-add `Thumbs.db`, `*.swo`, `*~`, `.vscode/`, `*.code-workspace`, `*.log`, `.cache/` and `tmp/`
       under `# Editor and operating-system files`;
     - drop `.gsd*`, `.bg-shell/`, `.mcp.json`, `.next/`, `dist/`, `build/`, `__pycache__/`, `*.pyc`,
       `.venv/`, `venv/`, `target/`, `vendor/` and the Windows device names.
  3. Commit with `git add .gitignore && git commit -m "chore: remove GSD after migration to Spec Kit"`.
  4. Verify that `git show --stat HEAD` touches only those paths.
- [ ] T045 [US4] Delete the untracked GSD leftovers and the branch:
  - Run `rm -rf .gsd .gsd-id .gsd-worktrees`. This removes the ignored runtime that T044 left behind, and
    it is deleted without an archive (clarified).
  - Run `git branch -d milestone/M001`, with `-d` and never `-D`. If git refuses, stop, because that means
    some work is not merged.
- [ ] T046 [US4] Run the post-removal checks listed in `checklists/transfer-verification.md`:
  - The GSD reference search, which must return nothing:
    `git grep -nIwi -e gsd -e 'get-shit-done' -- . ':!specs/001-gsd-speckit-migration' ':!CHANGELOG.md'`.
  - The `ls -a` check.
  - `git branch --list milestone/M001`, which must return nothing.
  - The full gate set from T015, including the S01 live gate. The results must match T015.

  Tick the items that pass.
- [ ] T047 [US4] Record the removal:
  - Add a footer to `migration-map.md`: `Removal commit: <sha from T044>`.
  - Add `### Removed` — GSD workflow tooling and state (`.gsd/`, the GSD MCP servers in `.mcp.json`,
    `.bg-shell/`, the `milestone/M001` branch) — to `CHANGELOG.md` under `[Unreleased]`.
  - Commit with
    `git add CHANGELOG.md specs/001-gsd-speckit-migration && git commit -m "docs: record GSD removal verification"`.

**Checkpoint**: One workflow, one source of truth.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T048 Fresh-session check (SC-002). Start a new agent session, ask "what is the next work?", and time
  how long it takes to reach `specs/003-local-source-selection/spec.md` and its acceptance scenarios using
  only Spec Kit artifacts. Record the elapsed time in `checklists/transfer-verification.md`. It must be
  under 5 minutes. If it isn't, improve the `DEVELOPMENT.md` pointer and repeat the check.
- [ ] T049 [P] Run all of `specs/001-gsd-speckit-migration/quickstart.md` from top to bottom on the final
  `master`. Fix any stale path or link in `README.md`, `DEVELOPMENT.md` or `docs/**` in its own commit;
  never touch the removal commit.
- [ ] T050 [P] Optional revert drill from quickstart § US4, done on a throwaway branch (`revert-drill`).
  Confirm that `.gsd/DECISIONS.md` comes back, then delete the branch. Record the result in
  `checklists/transfer-verification.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup** (T001–T004): no dependencies.
- **Foundational** (T005–T009): depends on Setup and **blocks every story**. T009 needs the maintainer to
  restart the agent session.
- **US1** (T010–T016): depends on Foundational.
- **US2** (T017–T027): depends on US1, because the docs describe the merged code and the decisions come
  from the merged `.gsd/DECISIONS.md`.
- **US3** (T028–T038): depends on US1, and T028 needs the T015 evidence. It can overlap with US2, except:
  - T028–T036 link to `docs/decisions/` (T017, T018);
  - T037 needs `docs/scope.md` (T023).
- **US5** (T039–T042): depends on US2 (T024 and `docs/*`) and on US3 (T039 describes status, T040
  references feature 008).
- **US4** (T043–T047): depends on US1, US2, US3 and US5 all being complete. This is the FR-018 gate.
- **Polish** (T048–T050): depends on US4.

### Story completion order

```text
Setup → Foundational (incl. detach) → US1 → { US2 ∥ US3 } → US5 → US4 → Polish
```

### Within stories

- T012 and T013 go before T014–T016. T016 depends on T015 passing in full.
- T025 depends on T017 and T018. T026 and T027 depend on T017–T025.
- T030 depends on T028 and T029. T037 and T038 depend on T028–T036.
- T040 depends on T024.
- T044 depends on T043, with no exceptions.

---

## Parallel Examples

```text
# Phase 1: T002 and T003 touch different files
T002 constitution comment removal  ∥  T003 checklist note fix

# Phase 2: independent new files
T006 gsd-export.md  ∥  T007 migration-map.md skeleton

# US1: the files for the merge commit
T012 CHANGELOG.md  ∥  T013 docs/README.md + docs/architecture.md

# US2: each doc is its own file
T017 decisions 0001–0008 ∥ T018 decisions 0009–0015 ∥ T019 architecture ∥ T020 overview
∥ T021 sync-and-deletion-safety ∥ T022 protocols ∥ T023 scope

# US3: the six seeded draft specs
T031 ∥ T032 ∥ T033 ∥ T034 ∥ T035 ∥ T036

# US5
T039 README ∥ T041 CHANGELOG
```

---

## Implementation Strategy

### MVP (User Story 1 only)

Phases 1–3 (T001–T016) put S01's code on `master`. By that point it is proven by every gate, including
the live end-to-end gate, and it is documented in the same commit, with all GSD material in git. That
alone unblocks real development without losing anything, and it is safe to stop there because no GSD
files are deleted.

### Incremental delivery

1. MVP (US1): the code is consolidated and proven.
2. US2: the knowledge lives in `docs/`, and `.gsd/` is no longer needed for decisions or gotchas.
3. US3: Spec Kit drives the work, and the next session opens on feature 003.
4. US5: the constitution baseline is complete.
5. US4: GSD is removed, only through the T043 gate, and one revert undoes it.

### Points where the maintainer is needed

- T009: restart the agent session.
- T011: any conflict outside `.gsd/**`.
- T015: a gate fails that no environment fix can resolve, or Docker or the emulator is unavailable.
- T045: `git branch -d` refuses.
