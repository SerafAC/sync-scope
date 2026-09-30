# Decisions — 004-scan-engine-matching

## 2026-09-30 — Phase 1: Setup (Shared Infrastructure) [T001-T008]
**Q:** How should 004-scan-engine-matching get onto feature 003 (T001), given the implementer may not rewrite history?
**A:** Rebase onto 003 — the orchestrator ran `git rebase 003-local-source-selection` on 004-scan-engine-matching before relaunching. The rebase part of T001 is done; the implementer only needs to run T001's checks (LocalSourceEnumerator present, contract version 2).
