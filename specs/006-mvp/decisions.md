## 2026-10-04 — Phase 9: Polish & Cross-Cutting Concerns [T087]
**Q:** How may the exit gate isolate a single Maestro flow while debugging?
**A:** Never move, delete or trim tracked flows or `validation/maestro/config.yaml` — run the single flow file directly with the maestro CLI instead. Any temporary change must be reverted before returning, and the final gate must run the full, unmodified suite.

## 2026-10-04 — Phase 9: Polish & Cross-Cutting Concerns [T087]
**Q:** On API 36, Maestro's first tap on a header button ("Select all" / "Clear selection") after a fresh launch never reaches the app; a second Maestro tap and a first adb tap both work, and API 31 always passes. How should the exit gate handle this?
**A:** Pass on API 31, log known issue — the gate passes with the full suite green on API 31. Flows with header taps (mvp/04, mvp/05, staged/06-b, staged/08-b) may fail on API 36 for this reason only; any other API 36 failure still blocks. Known issue to follow up in a later feature: confirm on a real API 36 device whether users lose the first header tap.
