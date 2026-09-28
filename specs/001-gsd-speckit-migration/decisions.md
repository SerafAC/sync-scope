# Decisions

## 2026-09-28 — Phase 1: Setup (Spec Kit adoption) [T001-T004]
**Q:** Commit e79e0f6 already holds the Spec Kit files, the full .gsd/ tree and master's duplicate D015 script edits (769182d), so merging milestone/M001 now hits 17 conflicts. Auto mode also refused the subagent's edits to constitution.md (T002) and requirements.md (T003). How should the migration continue?
**A:** Re-plan vs current master — update plan.md/tasks.md: e79e0f6 counts as the adoption commit (T004 becomes a small follow-up commit), T005 records the script diff instead of `git restore`, and T011 resolves the two `scripts/validation/` conflicts to milestone/M001's side. T002/T003 were applied by the main session and ticked; T001 and T004 are left for autopilot.

## 2026-09-28 — Phase 2: Foundational [T005-T009]
**Q:** T008 (freeze commit) and T009 (detach GSD MCP servers, restart session) need the maintainer. How to proceed?
**A:** I commit + edit, you restart — the main session made the freeze commit (5619819). The auto-mode classifier refused the agent's edit of `.claude/settings.local.json`, so the maintainer removes gsd-workflow/gsd-browser there and restarts; the next autopilot run verifies with `pgrep -af 'gsd-pi|gsd-browser'` and `git status`, then ticks T009.
