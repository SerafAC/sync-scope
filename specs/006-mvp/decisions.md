## 2026-10-04 — Phase 9: Polish & Cross-Cutting Concerns [T087]
**Q:** How may the exit gate isolate a single Maestro flow while debugging?
**A:** Never move, delete or trim tracked flows or `validation/maestro/config.yaml` — run the single flow file directly with the maestro CLI instead. Any temporary change must be reverted before returning, and the final gate must run the full, unmodified suite.
