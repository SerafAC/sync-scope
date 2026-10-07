## 2026-10-07 — Phase 7: User Story 2 — smart scrollbar [T058-T064]
**Q:** T064 needs 03-fast-scroll.yaml to pass on the API 31 and API 36 emulators, and neither is running. How should autopilot handle T064?
**A:** Run on emulators. Boot the dependency_api31 and dependency_api36 AVDs (~/Android/Sdk/emulator) with the project's validation scripts, run the flow, and tick T064 only once it passes on both. Delete validation/maestro/scratch/ and don't commit it. Then continue.

## 2026-10-07 — Phase 9: User Story 7 — The app has its own icon [T068-T072]
**Q:** T070 is blocked until the owner provides the icon image. What should autopilot do at Phase 9?
**A:** Do T068 and T069 now. Skip T070-T072 and leave them open until the owner provides the image.

## 2026-10-07 — Phase 10: Polish & Cross-Cutting Concerns [T073-T081]
**Q:** In T080, everything passes except 3 Maestro flows on API 36: mvp/04-select-size, mvp/05-delete-synced and staged/08-changed-b. They fail on the known API 36 header first-tap issue from 006 (the first tap on "Select all" or "Clear selection" is lost). API 31 is fully green. Tick T080?
**A:** Apply the 006 rule. The gate is API 31 fully green, plus the API 36 flows run one by one, which are all green except the 3 header-tap flows. The known issue is logged here (see also specs/006-mvp/decisions.md). Tick T080. T081 stays for the owner's real-phone walk-through.
Note: `pnpm e2e:android:release-smoke` refuses to run while ~/.gradle/gradle.properties holds SYNCSCOPE_RELEASE_* signing properties. Run it with a GRADLE_USER_HOME that has no gradle.properties.
