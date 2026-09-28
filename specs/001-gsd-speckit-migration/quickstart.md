# Quickstart: Validating the GSD → Spec Kit Migration

This file lists the checks that prove each user story is done. Run every command from the repository root.

## Prerequisites

- Node 24.11.1 and pnpm 11.3.0 (`pnpm install --frozen-lockfile`).
- JDK 21+ and the Android SDK with `ANDROID_HOME` set, for `pnpm test:android:unit`. See `DEVELOPMENT.md`
  once it exists, or MEM015 in the export.
- Docker 29.x, Compose 5.5.1 and an API 31 emulator image, for the S01 live gate. It is **required** before
  the merge commit.
- `sqlite3`, for the memory export step only.

## US1: Code consolidated

Run the gates while the merge is still uncommitted (after `git merge --no-ff --no-commit milestone/M001`
and the conflict resolution):

```sh
pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:android:unit                  # expect: all exit 0
pnpm validation:services:start && pnpm validation:services:health \
  && pnpm validation:android:api31 && pnpm validation:services:stop                    # expect: exit 0, 8/8 tests, 3 audits clean
```

After the merge commit:

```sh
git branch --merged master | grep -w milestone/M001                    # expect: listed
git log --oneline master..milestone/M001                               # expect: empty
git status --porcelain                                                 # expect: empty
git show --stat HEAD | grep -E 'CHANGELOG.md|docs/(README|architecture).md'   # expect: 3 files in the merge commit
git diff milestone/M001 HEAD -- . ':!.gsd' ':!specs' ':!.specify' ':!.claude' ':!CHANGELOG.md' ':!docs'  # expect: empty
```

## US2: Knowledge transferred

```sh
for n in $(seq -w 1 30); do git grep -qw "R0$n" -- specs docs || echo "missing R0$n"; done   # expect: no output
ls docs/decisions/00{01..15}-*.md | wc -l                                                   # expect: 15
grep -c '^| MEM' specs/001-gsd-speckit-migration/migration-map.md                           # expect: 22
```

For three items picked at random (one R, one D, one MEM), open the destination and confirm that the
meaning and rationale match the original.

## US3: Roadmap continues under Spec Kit

```sh
ls -d specs/00{2..8}-*                                             # expect: 7 feature dirs
grep -c '^- \[X\]' specs/002-*/tasks.md                            # expect: 8
grep -c '^- \[ \]' specs/002-*/tasks.md                            # expect: 0
grep -l 'Draft (seeded)' specs/00{3..8}-*/spec.md | wc -l          # expect: 6
grep -o 'specs/[^"]*' .specify/feature.json                        # expect: specs/003-local-source-selection
```

## US5: Constitution documentation baseline

```sh
ls README.md DEVELOPMENT.md CHANGELOG.md docs/README.md    # expect: all present
grep -n '## \[Unreleased\]' CHANGELOG.md                    # expect: match with S01 and migration entries
```

The first section of `README.md` must be user-facing, and it must not claim that scanning or deletion
already works.

## US4: GSD removed

First, every pre-removal item in
[contracts/transfer-verification.md](./contracts/transfer-verification.md) must be [X]. Then run:

```sh
git grep -nIwi -e gsd -e 'get-shit-done' -- . ':!specs/001-gsd-speckit-migration' ':!CHANGELOG.md'  # expect: empty
ls -a | grep -E '^\.(gsd|gsd-id|gsd-worktrees|bg-shell|mcp\.json)$'                                 # expect: empty
git branch --list milestone/M001                                                                   # expect: empty
git show --stat <removal-sha> | head                                                               # expect: only GSD paths plus .gitignore
pnpm lint && pnpm typecheck && pnpm test:ci && pnpm test:android:unit                              # expect: same as US1
pnpm validation:services:start && pnpm validation:services:health \
  && pnpm validation:android:api31 && pnpm validation:services:stop                                # expect: same as US1
```

Fresh-session check (SC-002): start a new agent session, ask what the next work is, and time how long it
takes to reach `specs/003-local-source-selection/spec.md`. Expect less than 5 minutes.

Revert drill (optional, on a throwaway branch):

```sh
git switch -c revert-drill && git revert --no-edit <removal-sha> && ls .gsd/DECISIONS.md && git switch master && git branch -D revert-drill
```
