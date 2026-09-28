# Decisions

## 2026-09-28 — Phase 1: Setup (Spec Kit adoption) [T001-T004]
**Q:** Commit e79e0f6 already holds the Spec Kit files, the full .gsd/ tree and master's duplicate D015 script edits (769182d), so merging milestone/M001 now hits 17 conflicts. Auto mode also refused the subagent's edits to constitution.md (T002) and requirements.md (T003). How should the migration continue?
**A:** Re-plan vs current master — update plan.md/tasks.md: e79e0f6 counts as the adoption commit (T004 becomes a small follow-up commit), T005 records the script diff instead of `git restore`, and T011 resolves the two `scripts/validation/` conflicts to milestone/M001's side. T002/T003 were applied by the main session and ticked; T001 and T004 are left for autopilot.

## 2026-09-28 — Phase 2: Foundational [T005-T009]
**Q:** T008 (freeze commit) and T009 (detach GSD MCP servers, restart session) need the maintainer. How to proceed?
**A:** I commit + edit, you restart — the main session made the freeze commit (5619819). The auto-mode classifier refused the agent's edit of `.claude/settings.local.json`, so the maintainer removes gsd-workflow/gsd-browser there and restarts; the next autopilot run verifies with `pgrep -af 'gsd-pi|gsd-browser'` and `git status`, then ticks T009.

## 2026-09-28 — Preflight: checklist gate [all]
**Q:** checklists/transfer-verification.md has 18 open items (removal gate). Proceed with implementation anyway?
**A:** Proceed (Recommended) — proceed despite open checklists; implementers tick items as their checks pass, and Phase 7 (GSD removal) still requires every item [X].

## 2026-09-28 — Phase 3: User Story 1 — Consolidate the code on one mainline [T010-T016]
**Q:** T016 needs two commits (merge commit with exact message, then evidence commit) and the run was told not to commit. How should T016 be carried out?
**A:** Main session does T016 — runs T016 as written (git add, merge commit, post-checks, tick checklist items and T016, evidence commit); no push; autopilot then continues with Phase 4.
