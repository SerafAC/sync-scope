# Permission rules for unattended runs

Workflow subagents inherit the session's permission mode and rules. Any command not covered below will prompt, and a prompt inside a subagent is easy to miss from a phone. The rules come in two layers.

## Global: `~/.claude/settings.json`

These rules are safe everywhere. They're read-only, plus the skill's own parser:

```json
{
  "permissions": {
    "allow": [
      "Bash(python3 ~/.claude/skills/speckit-autopilot/scripts/units.py:*)",
      "Bash(git status:*)",
      "Bash(git diff:*)",
      "Bash(git log:*)",
      "Bash(git show:*)",
      "Bash(git branch --show-current)",
      "Bash(git rev-parse:*)",
      "Bash(date -Is)",
      "Bash(.specify/scripts/bash/check-prerequisites.sh:*)"
    ]
  }
}
```

If a rule written with `~` doesn't match in your version, use the expanded absolute path.

## Per project: `<project>/.claude/settings.local.json`

These rules write and commit, and the denies guard earlier units' work. Keep them scoped to the projects you run autopilot in. Denying `git push` globally would get in your way everywhere else.

```json
{
  "permissions": {
    "allow": [
      "Edit",
      "Write",
      "Bash(git add:*)",
      "Bash(git commit:*)",
      "Bash(git stash push:*)"
    ],
    "deny": [
      "Bash(git push:*)",
      "Bash(git reset --hard:*)",
      "Bash(git clean:*)",
      "Bash(git checkout -- :*)",
      "Bash(git restore:*)"
    ]
  }
}
```

Add the project's own **test / build / codegen** commands to the same file. For example, a Go + Wails + pnpm project needs:

```json
"Bash(go test:*)", "Bash(go build:*)", "Bash(go vet:*)",
"Bash(pnpm run:*)", "Bash(pnpm install:*)", "Bash(npx vitest:*)", "Bash(npx vue-tsc:*)",
"Bash(wails3 generate:*)"
```

Notes:

- `install.sh --project-perms <dir>` writes the per-project block, merging it with any existing `settings.local.json`.
- The first workflow launch in a session asks to approve the workflow itself. Approve it for the session.
- An alternative to a long allow list is to run the session in **auto mode**, which approves routine commands and still stops on risky ones. Keep the per-project `deny` block either way.
