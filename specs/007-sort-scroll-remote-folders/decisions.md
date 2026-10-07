## 2026-10-07 — Phase 7: User Story 2 — smart scrollbar [T058-T064]
**Q:** T064 needs 03-fast-scroll.yaml to pass on the API 31 and API 36 emulators, and neither is running. How should autopilot handle T064?
**A:** Run on emulators. Boot the dependency_api31 and dependency_api36 AVDs (~/Android/Sdk/emulator) with the project's validation scripts, run the flow, and tick T064 only once it passes on both. Delete validation/maestro/scratch/ and don't commit it. Then continue.

## 2026-10-07 — Phase 9: User Story 7 — The app has its own icon [T068-T072]
**Q:** T070 is blocked until the owner provides the icon image. What should autopilot do at Phase 9?
**A:** Do T068 and T069 now. Skip T070-T072 and leave them open until the owner provides the image.
