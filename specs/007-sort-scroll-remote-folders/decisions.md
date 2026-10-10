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

## 2026-10-10 — Dropdown widths and shared WebDAV path [T082-T085]

**Request:** Gallery/List must match the sort control's width and the pair must fill the row. WebDAV
Host must retain the path shared by all folders, such as `domain.xyz/remote.php/dav/alice`, rather than
moving it into folder 1.

**Decision:**

- Give each dropdown anchor an equal flexible slot, with zero minimum width, and stretch its outlined
  button to fill it. Keep the existing gap and outer margins. Open menu options retain their full text.
- For WebDAV, keep the encoded shared endpoint path in the existing `host` string. Split only scheme,
  port and username into their fields, dropping any URL password. Scheme-less addresses use the
  selected protocol; parsing is idempotent when Host blurs again. Never infer a server-specific prefix.
- Treat every WebDAV remote folder as relative to that endpoint, even when written with a leading
  slash. `/` addresses the endpoint itself; the browser cannot go above it. Connection testing, scans
  and deletion re-checks all use the same native URL builder.
- Keep endpoint paths case-sensitive and DNS names case-insensitive when deciding whether the saved
  password can be reused. Reject malformed authorities, controls, backslashes, queries and fragments
  at the native boundary without echoing them. Preserve encoded endpoint segments.
- Keep FTP/SFTP URL-to-folder parsing unchanged. Existing WebDAV bare-host settings with complete
  remote paths keep working. Do not auto-migrate paths: the intended endpoint cannot be inferred
  reliably. No schema or bridge-shape change is needed.

This supersedes the WebDAV part of Story 3 scenario 8 and historical T041/T046, not their FTP/SFTP
behaviour. The correction is tracked in Phase 11 of [tasks.md](./tasks.md).
