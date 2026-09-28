# Tasks: Fixture Feature

**Input**: Design documents from `specs/001-fixture/`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel
- [ ] This checklist line has no task ID and must be ignored

---

## Phase 1: Setup

- [x] T001 Create project structure
- [X] T002 [P] Configure linting

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [X] T003 Add base model
- [ ] T004 [P] Add config loader in `src/config.py`
- [ ] T005 Wire logging

**Checkpoint**: Foundation ready

---

## Phase 3: User Story 1 – Upload a file (Priority: P1) 🎯 MVP

### Tests for User Story 1 ⚠️

- [ ] T006 [P] [US1] Write failing upload test
- [x] T007 [P] [US1] Write failing size-limit test

### Implementation for User Story 1

- [ ] T008 [US1] Implement upload endpoint
- [ ] T009 [US1] Implement size limit
  - [ ] T010 [US1] Nested task still counts

---

## Phase 4: User Story 2 — Share a link (Priority: P2)

- [ ] T011 [P] [US2] Write failing share-link test
- [ ] T012 [US2] Implement share links
- [ ] T013 [US2] Expire links after 24h
- [ ] T014 [US2] Revoke links
- [ ] T015 [US2] Audit log for shares

---

## Phase 5: User Story 3 - Admin view (Priority: P3)

- [X] T016 [US3] Admin list page
- [X] T017 [US3] Admin delete action

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T018 [P] Docs update
- [ ] T019 Performance pass

---

## Dependencies & Execution Order

- T004 depends on T003

```bash
# Example only, must be ignored:
- [ ] T999 Fenced example task
```

## Notes

- Commit after each task
