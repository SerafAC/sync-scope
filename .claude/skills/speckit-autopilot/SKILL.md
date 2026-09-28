---
name: speckit-autopilot
description: Semi-automated GitHub Spec Kit implementation. Splits the open tasks in specs/<feature>/tasks.md into small units and runs each one through a fresh implementer subagent, a skeptical verifier and a committer, then moves on to the next unit, stopping only when the work or the requested scope is done or a human decision is needed. Use this whenever the user says "speckit-autopilot" or "speckit autopilot", or asks to run, continue or resume Spec Kit implementation of tasks.md ("speckit-autopilot the next 3 phases", "continue implementing tasks.md", "implement US2 from the spec", "run tasks T011-T015", "keep going on the feature"), and also for a dry run of what would be implemented next. Only for repos with a .specify/ directory. Prefer it over running /speckit.implement directly for anything bigger than a single task.
---

# Spec Kit autopilot

Implements `specs/<feature>/tasks.md` one small unit at a time. Each unit gets a fresh implementer, an independent verifier and its own commit. The main session (you) only orchestrates: it prepares inputs, launches the `speckit-autopilot-run` workflow, and handles whatever comes back.

Two principles shape everything below:

- **tasks.md is the only state.** The next unit is always re-derived from the checkboxes by `scripts/units.py`. Never carry "where we were" in your head or rely on workflow resume. That way the user can stop, edit tasks.md or restart at any moment and the next run still does the right thing.
- **Blockers become questions.** The user is often steering from a phone via Remote Control. Anything that needs a human goes through AskUserQuestion with concrete options. It must never be a silent failure or a wall of text.

Paths below: `SKILL_DIR` is this skill's base directory (the "Base directory for this skill" line shown when it loads; usually `~/.claude/skills/speckit-autopilot`), `FEAT` is `specs/<feature>`, and `AP` is `FEAT/.autopilot`.

## Arguments

Everything after the trigger is optional:

- **scope**, passed verbatim to units.py: empty or `all`, `4 phases`, `phase 3`, `phases 3-5`, `tasks T011-T015, T040`, `US2`
- **`dry-run`**: show the units and launch nothing
- **feature name**: when the user names one, e.g. "/speckit-autopilot 003 phase 4"

## 1. Preflight (once per invocation)

0. **Spec Kit project.** The repo root (`git rev-parse --show-toplevel`) must contain `.specify/` and `specs/`. If it doesn't, say this isn't a Spec Kit project and stop. The skill is usually installed globally, so it can be invoked in any repo.
1. **Feature.** Take `git branch --show-current` and look for `specs/<branch>/`. If there's no exact match, try the leading number (`003-…`). If still nothing, or the user named a feature, list the `specs/*/` directories that have open tasks and ask. Remember the directory name as `feature`.
2. **tasks.md** must exist in `FEAT`. If it's missing, stop and suggest `/speckit.tasks`.
3. **Local state stays out of git.** Make sure `.git/info/exclude` contains `specs/*/.autopilot/`, and append it if it doesn't. Run logs and config are machine-local. Excluding them keeps the tree clean between units, and it never touches the project's `.gitignore`.
4. **Clean tree.** Run `git status --porcelain`. If it's dirty, ask: *Continue on top* (the changes will be folded into the next unit's commit, which is right after an interrupted autopilot run), *Stash them* (`git stash push -u -m "speckit-autopilot preflight"`), or *Stop*. The committer stages everything in the tree, so unrelated edits would otherwise land in a feature commit.
5. **Implement command.** Use the first of these that exists: `.claude/skills/speckit-implement/SKILL.md` (Spec Kit ≥0.4), `.claude/commands/speckit.implement.md` (older versions), `.claude/commands/speckit-implement.md`. If none exists, pass an empty string. The implementer then falls back to generic Spec Kit conventions, and you should tell the user.
6. **Config and test command.** Read `AP/config.json` if it exists (`{"testCommand": "...", "maxTasks": 8}`). If it has no `testCommand`, infer one from plan.md (Testing / Tech Stack sections) and the repo (`package.json` scripts, `Makefile`, `go.mod`, `pyproject.toml`, `Cargo.toml`, CI files). Ask once with AskUserQuestion, offering your best guess as the recommended option plus an "Other" field. Save the answer to `AP/config.json`. Tests are the verifier's main evidence, so a wrong command makes every verdict meaningless. That's why you confirm it once rather than guessing on every run.
7. **Checklist gate.** Spec Kit's implement command stops to ask when `FEAT/checklists/*.md` has unchecked items, and subagents can't ask. Do the check here: count the `- [ ]` lines per checklist file. If any are open and `FEAT/decisions.md` doesn't already record "proceed despite open checklists", ask. Record the answer as a decision (see step 4), or stop on "no".

## 2. Derive the units

```bash
python3 SKILL_DIR/scripts/units.py FEAT/tasks.md --scope "<scope>" --max-tasks <config.maxTasks or 8> [--exclude "<skip list>"]
```

The script prints JSON with `units`, `all_done`, `covers_all`, `remaining`, `total` and `warnings`. Exit code 2 means a bad scope: show its error, which lists the valid forms. Show the warnings to the user; they say things like "phase 3 already complete".

- If `all_done` is true, report that and stop.
- If `units` is empty, the scope has nothing open. Say so and include the warnings, then stop.
- If this is a **dry run**, show a compact table (unit, task IDs, phase progress) and the total, then stop without launching anything. Include the command the real run would use.

`--max-tasks` splits a large phase into several units so every implementer starts on a small, fresh context. `0` means one unit per phase.

## 3. Launch the workflow

Call the Workflow tool with `scriptPath: "<absolute SKILL_DIR>/workflows/speckit-autopilot-run.js"` and these `args`, as a real JSON object and not a string:

```json
{
  "feature": "<feature>",
  "featureDir": "specs/<feature>",
  "implementCommand": "<path from preflight step 5>",
  "unitsScript": "<absolute path to SKILL_DIR/scripts/units.py>",
  "testCommand": "<config.testCommand>",
  "coversAll": <covers_all from units.py>,
  "units": <units array from units.py>
}
```

For each unit, the workflow implements, verifies (with one fix attempt), commits and moves on. It returns at the first unit that needs a human. It never pushes.

If the Workflow tool is unavailable, or it fails because dynamic workflows are disabled or the script can't be loaded, use the **fallback** in `references/fallback.md`. The loop is the same, with plain subagents.

## 4. Handle the result

Every result has `status`, `commits` (`[{sha, message, unit}]`) and `summary`. Most statuses also include `unit`.

| status | what to do |
|---|---|
| `all_done` / `scope_done` | Re-run units.py (no scope) to get what remains. Report the commits made, the tasks done this run, and what remains (phases and counts). For `scope_done`, offer to continue with the next phase. Mention any `finished[].expected_failures` (test-first tests that are still failing on purpose). |
| `needs_decision` / `blocked` | AskUserQuestion with the agent's `question` and `options` (add a "Stop here" option if it's missing). Append the Q&A to `FEAT/decisions.md` and commit **only that file** (`git commit -m "docs(<feature>): record decision" -- FEAT/decisions.md`), so the next implementer sees it and the tree stays clean. Then **go back to step 2**: re-derive the units and relaunch. Don't resume the old run, because tasks.md may have changed. If the answer is "stop" or "skip", handle it as in the next row. |
| `failed` / `verify_failed` | Show the `summary` and `problems`, then ask: **Retry** (go back to step 2; the partial work stays in the tree and the next implementer continues from it), **Skip unit** (`git stash push -u -m "speckit-autopilot: skipped <ids>"` so the half-done work is kept but out of the way, add the unit's task IDs to this session's skip list for `--exclude`, then go back to step 2), or **Stop** (leave the tree as it is and say so). |

Record decisions in this format, in `FEAT/decisions.md`:

```markdown
## <ISO date> — <unit title> [<ids_label>]
**Q:** <question>
**A:** <chosen option> — <option description or the user's free text>
```

Stop the loop when the scope is done, when the user says stop, or when the same unit fails twice in a row after a retry (ask before a third attempt). The workflow is resilient, but repeated failure means the spec or plan needs a human.

## 5. Run log

After every workflow run, append one entry to `AP/run-log.md`, including dry runs and runs that failed. Get timestamps from `date -Is`; workflow scripts can't read the clock.

```markdown
## <started ISO> → <ended ISO>  scope: "<scope>"  status: <status>
- units: <ids_label per unit, in order>
- commits: <sha message> (one per line) | none
- outcome: <summary; question+answer or problems if any>
```

This log is the audit trail for unattended runs. It's the first place to look when the user asks "what happened overnight?".

## Permissions

Long runs stall on permission prompts, and nobody at a phone can see a prompt that appears inside a subagent. Before the first real run, check whether the project allows the rules listed in `references/permissions.md`. If it doesn't, show the user that snippet and offer to add it. Never add rules without the user saying yes.

## Final report

Keep it short enough for a phone screen: status line, commits (sha + subject), tasks done / remaining, and the next suggested command (e.g. `/speckit-autopilot phase 5`). Don't paste diffs.
