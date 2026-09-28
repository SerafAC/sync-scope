# Contract: Transfer Verification Checklist (removal gate)

**File**: `specs/001-gsd-speckit-migration/checklists/transfer-verification.md`, created during
implementation.

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
- [ ] **Map complete**: every inventory item in [migration-map.md](./migration-map.md) has a row, and every
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
