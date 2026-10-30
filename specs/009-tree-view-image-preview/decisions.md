
## 2026-10-29 — Phase 6: Tree view, with selection (part 2/2) [T055-T061]
**Q:** Select all in tree view: should it select the filtered files across all scanned sources (as research.md R11 says), or be unavailable in tree view (which is what the committed T050 test enforces)?
**A:** Implement R11 by calling once per source (recommended) — When the view is TREE, Select all runs listSelectableEntries once per source with the filter and no folder, and merges the results (TREE-specific path in FilesScreen/SelectionProvider). Update the T050 selectAllQuery test to expect one root LIST query per source. No native change. Also amend the T060 task text in tasks.md to match the flow's working step order (select through the preview first, then long-press a1 and tap a2), since a tap toggles selection while selecting (R11). Chosen automatically per the user's standing "take recommended" rule.

## 2026-10-29 — Phase 6: Tree view, with selection [T056]
**Q:** What should "Select all" in tree view select: every file in each source that matches the filter, including files in subfolders, or only the files directly under each source's root (what the one-LIST-query-per-source code does)?
**A:** Every matching file in each source, with a small native change (recommended) — Matches R11 and the spec. selectableEntries gets a "whole source" mode (a TREE view value, or a LIST query flag that turns off topLevelOnly). Bridge, CloudSyncContracts and types updated; Kotlin and JS tests added; T050's test expects one such query per source. This supersedes "No native change" in the previous 2026-10-29 decision; the rest of that decision (per-source queries merged in JS, T060 text amendment) still stands. Chosen automatically per the user's standing "take recommended" rule.

**Note for implementers and verifiers:** the full test command takes ~15+ minutes (scripts/validation/performance-runner.test.mjs alone is ~13 min), longer than the 10-minute foreground shell limit. Run it with Bash run_in_background and wait for completion; a foreground timeout is not a test failure.

## 2026-10-29T19:04:57+01:00 — Polish: e2e gate [T086]
**Q:** staged/07-delete-offline-b failed on API 31: the delete was refused with "A scan is already running." because the launch's local refresh now re-checks the paused SFTP server (FR-003) and holds the run until the connect times out (~35 s). Fix the flow or the product?
**A:** Fix the flow (recommended) — refusing a delete while a scan runs is 006 behaviour and Retry works once the refresh ends; 07-b now waits on the Scan tab for the local refresh to complete before deleting, like staged/09-resync-c.

## 2026-10-30T10:31:31+01:00 — Polish: release smoke [T086]
**Q:** `pnpm e2e:android:release-smoke` refuses to run while `~/.gradle/gradle.properties` holds the real release key, so it keeps colliding with the local setup. Keep it as a T086 gate?
**A:** Remove it (user) — the release build will be its own test in a CI/CD pipeline. The `release-smoke` mode, its package script, tests and docs are gone; the two flows it shared with the debug workspace stay, renamed `mvp/90-standalone-setup` and `mvp/91-relaunch-keeps-data`. T086 no longer includes it.
