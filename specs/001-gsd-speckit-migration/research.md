# Research: GSD → Spec Kit Migration

**Feature**: [spec.md](./spec.md) | **Date**: 2026-09-28

Everything below was verified against the repository on 2026-09-28. Commands are shown so that each
finding can be re-checked.

## R1. Where the real S01 code lives

- **Finding**: `master` is 1 commit ahead of the merge base (`f37bc53`, GSD's own snapshot, which touches
  only `.gsd/`). `milestone/M001` is 13 commits ahead. Those 13 commits carry T01–T08: the Room persistence
  layer, the CloudSync TurboModule, the FTP/SFTP/WebDAV clients, the credential store, validation script
  fixes, and `ProtocolConnectInstrumentedTest.kt`.
- **Check**: `git log --oneline master..milestone/M001`
- **Decision**: merge `milestone/M001` into `master` with `--no-ff` (clarified).
- **Rationale**: keeps every commit hash, so task-to-commit links stay valid.
- **Alternatives considered**: squash, or rebase-and-clean. Both were rejected in clarification.

## R2. Merge conflict surface

- **Finding**:
  - `git merge-tree --write-tree master milestone/M001` exits 0, so the *committed* histories merge
    cleanly.
  - The merge is blocked only by the working tree:
    - **Tracked, modified on master**: `.gsd/CODEBASE.md`, `.gsd/migration/managed-outputs.json`,
      `.gsd/notifications.jsonl`, `scripts/validation/protocol-service.sh` and
      `scripts/validation/validation-infrastructure.test.mjs`.
    - **Untracked on master but tracked on the branch**: `.gsd/{DECISIONS,REQUIREMENTS,PROJECT,ROADMAP,
      QUEUE}.md`, `.gsd/.compat.json`, `.gsd/last-snapshot.md` and `.gsd/phases/**`.
- **Content comparison**:
  - `REQUIREMENTS.md`, `PROJECT.md`, `ROADMAP.md` and `QUEUE.md` are identical on both sides.
  - The master working copy of **`DECISIONS.md` is a superset**: it contains D013–D015, which the branch
    copy lacks.
  - `01-01-PLAN.md` and `01-ROADMAP.md` differ only in the `gsd:state-version` comment.
  - Only the branch has `S01-T08-SUMMARY.md`, the `S01-T0x-VERIFY.json` files and `.gsd/exec/**`.
  - The master working-tree script changes are a second, independent implementation of D015 (Docker 29.x
    pin). The branch already carries its own D015 implementation and tests: `protocol-service.sh:63-67`,
    and the tests "accepts any Docker 29 release" and "rejects a Docker major other than 29".
- **Decision**:
  1. Discard the master working-tree edits to the two validation scripts. The branch version wins, per
     FR-004 and FR-005.
  2. Before merging, commit master's GSD state as one *freeze* commit. It holds every non-ignored `.gsd`
     file: the untracked `*.md`, `phases/**`, `quarantine/**`, `.compat.json`, `audit-log.jsonl` and
     `routing-history.json`, plus the tracked `.gsd` modifications. That is simply `git add .gsd`, since
     `.gitignore` already excludes the runtime. Extra conflicts this creates fall under rule 3.
  3. Resolve `.gsd/**` conflicts file by file with the rule "keep the more complete copy": the master copy
     for `DECISIONS.md`, the branch copy for everything else.
- **Rationale**:
  - Freezing puts the only complete `DECISIONS.md` into git history, which the clarification accepts as
    the recovery record.
  - `.gsd/**` is deleted later anyway, so the conflict rule only has to preserve source material until
    the transfer is done.
- **Alternatives considered**:
  - Stash, then merge: rejected. It leaves `DECISIONS.md` D013–D015 untracked, and stashes are easy to lose.
  - Transfer knowledge before merging: rejected, because FR-003 orders the merge first.

## R3. True status of S01 / T08

- **Finding**:
  - The GSD DB (`tasks` table) has T01–T07 `complete` and T08 `in_progress`. All slices are `pending`.
  - `S01-T08-SUMMARY.md`, present only on the branch, records `verification_result: passed`. The exact
    live gate (`validation:services:start → health → android:api31 → services:stop`) exited 0 on
    2026-09-23: 8 of 8 instrumented tests green, and all three protocol audits clean.
  - `S01-T08-VERIFY.json` records an *earlier* failed attempt (ANDROID_HOME unbound). Commit `16d75ac`
    fixed that cause.
  - The T08 fixes are present on the branch:
    - `headers("DAV")` in `WebDavRemoteClient.kt:61`;
    - `PRECISION_SCAN_DIRECTORIES` in `FtpRemoteClient.kt`;
    - `-no-window` in `android-validator.sh:114`;
    - `FTP command:` scoping in `protocol-audit.sh:23`.
- **Decision**:
  - Record T08 as complete, citing the summary's evidence.
  - Re-run the S01 live gate on the *staged* merge, before the merge commit is created. The constitution's
    Quality Gates require end-to-end tests for every affected major requirement before a merge.
  - Mark S01's requirements validated in feature 002 only on the strength of that re-run.
  - The spec was corrected to match (see the "Plan-phase correction" note under Current State Review).
- **Rationale**:
  - Constitution Principle V says a feature isn't done until its e2e passes.
  - The recorded pass ran on the branch worktree, before the merge. A re-run on the mainline is cheap and
    removes any doubt about the merged result.
- **Alternatives considered**:
  - Trust the summary and mark S01 validated: rejected. The proof ran on pre-merge code, and GSD itself
    never closed the task.
  - Defer the re-run to feature 002: rejected. It would merge without the end-to-end gate, which the
    constitution forbids.

## R4. GSD knowledge that exists only in the database

- **Finding**: `.gsd/gsd.db` (SQLite) holds 22 memories.
  - **MEM001–MEM014 and MEM019**: mirrors of D001–D015. Nothing to transfer beyond the decisions.
  - **Unique knowledge**:
    - MEM015: JVM test prerequisites (ANDROID_HOME/`sdk.dir`, JDK 21+ launcher);
    - MEM016: `robolectric.properties` pins `application=android.app.Application`;
    - MEM017: pnpm install before Gradle and ANDROID_HOME export (its GSD-worktree framing is dropped);
    - MEM020: WebDAV multi-value `DAV` header;
    - MEM021: emulator `-no-window`;
    - MEM022: vsftpd FEAT audit scoping.
  - **Stale**: MEM018 (the Docker 29.7.2 pin blocks gates). D015 supersedes it, and T08's summary says
    so explicitly.
  - **Also in the DB**: requirement and decision rows that duplicate the Markdown files, workflow
    telemetry (attempts, gates, audit events) and task/slice status.
  - Task summaries and T08's "Known Issues" section hold further facts:
    - API 36 isn't covered yet (deferred to S07);
    - `-no-window` is unconditional;
    - the FTP precision basis is empirical.
- **Check**:
  `sqlite3 .gsd/gsd.db "select id, category, content from memories order by seq"`
- **Decision**:
  - Export memories and task/slice status to `gsd-export.md` in this feature's directory, using
    `sqlite3`, which is available at `/usr/bin/sqlite3`.
  - Review each entry against the migration map.
  - Remove `gsd-export.md` in the removal commit, so a revert recovers it.
  - Drop workflow telemetry, which has no ongoing value.
- **Rationale**: this meets the edge case "knowledge only in the binary DB must be exported and reviewed
  before removal", and needs no archive (clarified).
- **Alternatives considered**: keeping `gsd-export.md` permanently. Rejected: it would duplicate the
  destinations and break Principle III (DRY).

## R5. Destination layout for transferred knowledge

- **Decision**:

  | GSD source | Destination |
  | --- | --- |
  | Vision, core value, what exists | `README.md` (user-facing, honest status) and `docs/overview.md` |
  | Architecture / key patterns (`PROJECT.md`, `CODEBASE.md`) | `docs/architecture.md` |
  | Sync matching, UNKNOWN, deletion safety (D003, D004, D006, D008, D009, D011) | `docs/sync-and-deletion-safety.md` |
  | Protocol behaviour, precision, TOFU, gotchas MEM020/MEM022 | `docs/protocols.md` |
  | Decisions D001–D015 | `docs/decisions/NNNN-<slug>.md`, one file per decision, number = D-ID |
  | Env/tooling gotchas MEM015–MEM017, MEM021, validation infra | `DEVELOPMENT.md` |
  | Requirements R001–R022 | Functional requirements in features 002–008, tagged `(R0xx)` |
  | Deferred R023–R025, out of scope R026–R030 | `docs/scope.md` (v1 scope and non-goals), cited by specs |
  | Slices S01–S07 | `specs/002-…` to `specs/008-…` (clarified) |
  | S01 plan, research, context, task summaries | `specs/002-*/plan.md`, `research.md`, `tasks.md` |
  | PREFERENCES (verification commands, coding rules) | Constitution already covers them; `auto_push` and worktree isolation dropped |
  | Migration record | `specs/001-gsd-speckit-migration/migration-map.md` (kept) and `CHANGELOG.md` |

- **Rationale**:
  - **One file per decision** keeps D-IDs stable, keeps each rationale next to its revisability flag, and
    lets a future decision supersede one file without touching others. This resolves the question deferred
    from clarification.
  - **`docs/scope.md`**: deferred and out-of-scope items are cross-cutting (for example, R026 "no remote
    mutation" limits every feature). One non-goals document avoids repeating them in seven specs.
- **Alternatives considered**:
  - A single `DECISIONS.md` log: rejected. It is harder to supersede one entry and harder to link to.
  - Putting non-goals in each spec: rejected, because it duplicates content (DRY).

## R6. Slice → feature naming

- **Decision**:

  | Slice | Feature directory |
  | --- | --- |
  | S01 | `002-native-cloudsync-connect` |
  | S02 | `003-local-source-selection` |
  | S03 | `004-scan-engine-matching` |
  | S04 | `005-gallery-list-filtering` |
  | S05 | `008-tree-view-image-preview` |
  | S06 | `009-multiselect-local-deletion` |
  | S07 | `010-full-loop-release` |

  These are created with the Spec Kit sequential numbering already configured
  (`.specify/init-options.json` → `feature_numbering: sequential`).
- **Rationale**: short action-noun names derived from the slice titles, as Spec Kit's naming rule asks.

## R7. Removal footprint and safety

- **Finding**:
  - **Tracked GSD files** (after the merge): `.gsd/**`, which includes the branch's `.gsd/exec/**`
    (roughly 240 files), plus `.bg-shell/manifest.json` and `.mcp.json`.
  - **Untracked or ignored**: `.gsd-id`, `.gsd-worktrees/` (empty; `git worktree list` shows only the main
    worktree) and `.gsd/` runtime (db, activity, journal, audit, forensics, backups, runtime, quarantine).
  - **Agent settings**: `.claude/settings.local.json` lists `enabledMcpjsonServers: [gsd-workflow,
    gsd-browser]`. The user's global git ignore excludes this file, so it is edited locally and never
    committed.
  - **Running process**: this session spawned a live GSD MCP server process from `.mcp.json`.
  - **False positives for a "gsd" search**: `pnpm-lock.yaml` (base64 hashes) and the `*.xsd` schemas
    under `.agents/skills/*/scripts/office/` (substrings of other words).
- **Decision**:
  1. Removal runs only after the transfer verification checklist passes ([contracts/transfer-verification.md](./contracts/transfer-verification.md)).
  2. Stop the GSD MCP server right after the freeze commit, long before `.gsd/` is deleted, so it can't
     rewrite `.gsd/` mid-migration. That means removing the servers from `.claude/settings.local.json` and
     restarting the agent session. `.mcp.json` itself goes in the removal commit.
  3. Delete `milestone/M001` with `git branch -d` (not `-D`), so git refuses if the merge is incomplete.
  4. Search for references with a word-boundary search that excludes the migration map and CHANGELOG:
     `git grep -nIwi -e gsd -e 'get-shit-done' -- . ':!specs/001-gsd-speckit-migration' ':!CHANGELOG.md'`.
     `-w` and `-I` rule out the lockfile and xsd false positives.
- **Rationale**: `-d` and the checklist gate make an unsafe removal fail loudly instead of losing data.

## R8. `.gitignore` GSD baseline block

- **Decision**:
  - **Drop the GSD-only entries**: `.gsd-worktrees/`, `.gsd-backups/`, `.gsd-id`, `.bg-shell/`,
    `.gsd-migration-import-*/`, every `.gsd/...` line, and `.mcp.json` (the file is removed, and if a
    future MCP config needs to be ignored, that is a deliberate choice).
  - **Keep the generic entries that protect this stack**, moved under "Editor and operating-system files":
    `Thumbs.db`, `*.swo`, `*~`, `.vscode/`, `*.code-workspace`, `*.log`, `.cache/`, `tmp/`.
  - **Drop the entries for other stacks**, which are not relevant (YAGNI): `.next/`, `dist/`, `build/`
    (already covered by `**/build/`), `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `target/`, `vendor/`,
    and the Windows reserved device names.
- **Rationale**: FR-020 says entries that still protect the project are kept or moved, not deleted blindly.

## R9. Versioning baseline (Constitution VI)

- **Finding**: `package.json` has `version` `0.0.1`. `android/app/build.gradle:86-87` has `versionCode 1`
  and `versionName "1.0"`. So there are two sources, and they disagree.
- **Decision**:
  - `package.json` is the single authoritative version, as `DEVELOPMENT.md` will state.
  - Deriving `versionName` from it is a build change that needs its own unit test (Principle IV). It is
    assigned to feature 008 (S07, release APK, R019) and recorded in Complexity Tracking.
  - `CHANGELOG.md` starts at `Unreleased` against 0.0.1.
- **Rationale**: FR-005 and FR-022 keep this migration free of application and build changes. The gap is
  already there, and the migration makes it visible without widening its own scope.
- **Alternatives considered**: hand-editing `versionName "0.0.1"` now. Rejected, because two sources would
  still exist.

## R10. Spec Kit assets not yet committed

- **Finding**: `.specify/` and `.claude/skills/speckit-*` are untracked.
- **Decision**: commit them in the first migration commit, together with the constitution. Every later
  step depends on them.
