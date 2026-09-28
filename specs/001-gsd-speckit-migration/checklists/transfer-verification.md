# Transfer Verification Checklist (removal gate)

**Contract**: [contracts/transfer-verification.md](../contracts/transfer-verification.md)

GSD removal (User Story 4) MUST NOT start until every item is `[X]`. Each item names the check that proves
it.

## Items

- [ ] **GSD runtime detached**: `pgrep -af 'gsd-pi|gsd-browser'` shows no process for this project, and
      `.claude/settings.local.json` enables no GSD MCP server. Done right after the freeze commit.
- [ ] **Consolidated**: `git branch --merged master` lists `milestone/M001`, `git log master..milestone/M001`
      is empty, and `git status --porcelain` is empty.
- [ ] **No stray work**: `git worktree list` shows only the main worktree, and `.gsd-worktrees/` is empty.
- [ ] **Gates green on the staged merge, before the merge commit**: `pnpm lint`, `pnpm typecheck`,
      `pnpm test:ci`, `pnpm test:android:unit`, and the S01 live gate
      (`pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`)
      all exit 0. Record the output tails and the live-gate test count.
- [ ] **Docs in the merge commit**: `git show --stat <merge-sha>` includes `CHANGELOG.md`, `docs/README.md`
      and `docs/architecture.md`.
- [ ] **Map complete**: every inventory item in [migration-map.md](../contracts/migration-map.md) has a row, and every
      row is `Verified [X]`.
- [ ] **Requirements traced**: all 30 R-IDs resolve (`git grep -w R0NN` finds each one in `specs/` or
      `docs/scope.md`). Each active R-ID has exactly one primary FR, and that FR states its class.
- [ ] **Decisions traced**: 15 files `docs/decisions/0001-*.md` to `0015-*.md` exist and are listed in the
      index.
- [ ] **Memories reviewed**: every MEM row in `gsd-export.md` has a disposition in the map.
- [ ] **S01 captured**: `specs/002-*/tasks.md` shows T001–T008 `[X]`, with commit refs and both pieces of
      gate evidence. `specs/002-*/spec.md` marks R001–R004 and R018 validated.
- [ ] **S02–S07 seeded**: `specs/003-*` to `specs/008-*` each have a `spec.md` with status `Draft (seeded)`,
      and `.specify/feature.json` points at `specs/003-local-source-selection`.
- [ ] **Docs baseline**: `README.md`, `DEVELOPMENT.md`, `CHANGELOG.md` and `docs/README.md` exist.
      `CHANGELOG.md` has an `Unreleased` migration entry.
- [ ] **Neutral wording**: the post-removal search below, run now with `':!.gsd' ':!.gitignore' ':!.mcp.json' ':!.bg-shell'`
      added to its exclusions, already returns nothing.

## Post-removal checks (recorded after the removal commit)

- [ ] `git grep -nIwi -e gsd -e 'get-shit-done' -- . ':!specs/001-gsd-speckit-migration' ':!CHANGELOG.md'`
      returns nothing (SC-003).
- [ ] The same gate commands as above, including the S01 live gate, return the same results (SC-004).
- [ ] The removal is exactly one commit; its hash is recorded in the migration-map footer (SC-006).
- [ ] `git branch --list milestone/M001` is empty.
- [ ] Fresh-session check (SC-002): a new agent session asked "what is next?" reaches
      `specs/003-local-source-selection/spec.md` and its acceptance scenarios in under 5 minutes, using only
      Spec Kit artifacts. Record the elapsed time.

## Baseline (2026-09-28)

Recorded on `master` at `1fc1130` (re-planned baseline, see `../decisions.md`). Commit
`e79e0f6` counts as the Spec Kit adoption commit. The working tree holds only the Phase 1 follow-up edits
(T002, T003 and this file).

### `git status --porcelain`

```text
 M .specify/memory/constitution.md
 M specs/001-gsd-speckit-migration/checklists/requirements.md
?? specs/001-gsd-speckit-migration/checklists/transfer-verification.md
```

### `git worktree list`

```text
/home/adi/projects/sync-scope 1fc1130 [master]
```

### `git log --oneline master..milestone/M001` (expect 13 commits)

```text
16d75ac fix: resolve the Android SDK path instead of dereferencing an unset ANDROID_HOME
38f0dcf chore: auto-commit after stop
c04b121 chore: auto-commit after stop
a402a66 chore: auto-commit after stop
8e38f68 chore: auto-commit after stop
f331aad feat: Validation scripts now derive the repo root from their own loca...
bb37998 feat: Added Keystore-backed CredentialStore (EncryptedSharedPreferenc...
a01bb64 feat: Added the read-only OkHttp WebDavRemoteClient (OPTIONS + PROPFI...
3001c5d feat: Added the SSHJ-backed read-only SftpRemoteClient with blocking...
9500a9c feat: Added the read-only RemoteClient contract (no content-read surf...
ca9dd60 feat: Registered the CloudSync TurboModule (codegen NativeCloudSyncSp...
ab3d95c chore: auto-commit after stop
7c4d394 chore: auto-commit after stop
(13 commits)
```

### `git merge-tree --write-tree --name-only master milestone/M001` (expect exit 1, 17 conflicts)

15 add/add conflicts under `.gsd/**` and 2 content conflicts in `scripts/validation/`, as expected by the
re-plan. T011 resolves the two `scripts/validation/` conflicts to `milestone/M001`'s side.

```text
1e82b16866ff9f71165a1f8c30482ceeea5265d9
.gsd/.compat.json
.gsd/DECISIONS.md
.gsd/last-snapshot.md
.gsd/phases/01-syncscope-v1/01-01-PLAN.md
.gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
.gsd/phases/01-syncscope-v1/01-CONTEXT.md
.gsd/phases/01-syncscope-v1/01-ROADMAP.md
.gsd/phases/01-syncscope-v1/S01-CONTINUE.md
.gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
.gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
scripts/validation/protocol-service.sh
scripts/validation/validation-infrastructure.test.mjs

Auto-merging .gsd/.compat.json
CONFLICT (add/add): Merge conflict in .gsd/.compat.json
Auto-merging .gsd/DECISIONS.md
CONFLICT (add/add): Merge conflict in .gsd/DECISIONS.md
Auto-merging .gsd/last-snapshot.md
CONFLICT (add/add): Merge conflict in .gsd/last-snapshot.md
Auto-merging .gsd/phases/01-syncscope-v1/01-01-PLAN.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-01-PLAN.md
Auto-merging .gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-01-RESEARCH.md
Auto-merging .gsd/phases/01-syncscope-v1/01-CONTEXT.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-CONTEXT.md
Auto-merging .gsd/phases/01-syncscope-v1/01-ROADMAP.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/01-ROADMAP.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-CONTINUE.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-CONTINUE.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T01-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T02-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T03-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T04-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T05-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T06-SUMMARY.md
Auto-merging .gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
CONFLICT (add/add): Merge conflict in .gsd/phases/01-syncscope-v1/S01-T07-SUMMARY.md
Auto-merging scripts/validation/protocol-service.sh
CONFLICT (content): Merge conflict in scripts/validation/protocol-service.sh
Auto-merging scripts/validation/validation-infrastructure.test.mjs
CONFLICT (content): Merge conflict in scripts/validation/validation-infrastructure.test.mjs
(exit 1)
```
