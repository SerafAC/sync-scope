# Decisions

## 2026-09-28 — Phase 1: Setup (Spec Kit adoption) [T001-T004]
**Q:** Commit e79e0f6 already holds the Spec Kit files, the full .gsd/ tree and master's duplicate D015 script edits (769182d), so merging milestone/M001 now hits 17 conflicts. Auto mode also refused the subagent's edits to constitution.md (T002) and requirements.md (T003). How should the migration continue?
**A:** Re-plan vs current master — update plan.md/tasks.md: e79e0f6 counts as the adoption commit (T004 becomes a small follow-up commit), T005 records the script diff instead of `git restore`, and T011 resolves the two `scripts/validation/` conflicts to milestone/M001's side. T002/T003 were applied by the main session and ticked; T001 and T004 are left for autopilot.
