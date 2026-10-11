# Implementation Decisions

## 2026-10-11 — Foundational (Blocking Prerequisites) [T005-T012]
**Q:** T005–T012 still has a verified signal-cleanup defect after one fix attempt. How should autopilot proceed?
**A:** Retry T005–T012 and reopen its checkboxes (recommended) — Preserve the uncommitted implementation, reopen all eight unit checkboxes, and derive a fresh retry from tasks.md. Repair standalone protocol-services cleanup to consult authoritative acquisition receipts after interruption, release only acquired resources, leave borrowed resources untouched, preserve the original nonzero exit status, and add the missing regression before independent verification.
