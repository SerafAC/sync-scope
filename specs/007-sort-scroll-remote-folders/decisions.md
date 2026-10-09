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

## 2026-10-08 — Known issue: API 36 header first tap (from 006)
**Q:** Do real users lose the first tap on "Select all" or "Clear selection" on Android 16?
**A:** No. The owner checked both on a real Android 16 phone, from a fresh launch, and both work on the first tap. The emulator failures are caused by the test setup, not the app. While the system folder picker is open, Android 15+ closes the backgrounded app's sockets (logcat: `Destroyed live tcp sockets for uids=…`), so the debug build loses its Metro connection. React Native then shows its "Fast Refresh disconnected. Reload app to reconnect." banner: a native `PopupWindow` just below the status bar (bounds 0,136–1080,236) that covers the top bar's ✕ and "Select all", and that a tap anywhere dismisses (`DefaultDevLoadingViewImplementation.kt`). Maestro skips that window ("Skipping null root node for window: Popup Window"), so it taps the button underneath, the banner takes the tap, and the second tap works. In the failing runs (for example `~/.maestro/tests/2026-10-07_164222/mvp_05-delete-synced`), the banner appears 40 ms after `Cannot connect to Metro` and is dismissed exactly at the lost tap. Release builds have no Metro and no banner, which is why release-smoke and the real phone pass. API 31 does not close background sockets.
**Fix (2026-10-09):** `index.js` drops that banner in debug builds only (with the matching LogBox warnings, and RN's runtime deep-import warning for the patch itself, whose toast would otherwise cover the tab bar). The same API 36 run surfaced two flow races, fixed with it: the eight flows that start with `launchApp: clearState: true` now wait for the cleared app's "No scan results yet" instead of "Settings", which the previous run's closing window could still match; and `mvp/90-release-smoke` reopens the app from the launcher after its T071 drawer check, so `mvp/91` does not match the drawer's own "Settings". With these, the full API 36 workspace and every staged pair pass (`android-flow.sh e2e --api 36`, exit 0), including mvp/04, mvp/05 and staged/08-b. The 006 rule that let header-tap flows fail on API 36 no longer applies: any API 36 failure now blocks the gate.

## 2026-10-09 — Real-device acceptance [T081]

The owner confirmed the manual real-device walk-through passed and requested that T081 be marked
complete, the pending changes committed, and a pull request prepared. The outcome is recorded in
[quickstart §4](./quickstart.md#4-manual-walk-through-on-the-owners-phone).
