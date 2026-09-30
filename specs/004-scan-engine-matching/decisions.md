# Decisions — 004-scan-engine-matching

## 2026-09-30 — Phase 1: Setup (Shared Infrastructure) [T001-T008]
**Q:** How should 004-scan-engine-matching get onto feature 003 (T001), given the implementer may not rewrite history?
**A:** Rebase onto 003 — the orchestrator ran `git rebase 003-local-source-selection` on 004-scan-engine-matching before relaunching. The rebase part of T001 is done; the implementer only needs to run T001's checks (LocalSourceEnumerator present, contract version 2).

## 2026-09-30 — Phase 3: User Story 1 (part 3/4) [T041-T048]
**Q:** vsftpd returns an empty LIST for the unreadable 0700 FTP directory, so the app can't tell it apart from an empty folder. How should SyncScope handle FTP in the partial-listing scenario?
**A:** CWD probe on empty LIST — in FtpRemoteClient, when LIST returns no entries, probe the folder with CWD. A 550 reply maps to DIRECTORY_UNREADABLE, and the session goes back to its original directory afterwards. Add JVM tests. Keep 02-partial-listing-ftp as written. Document it in docs/protocols.md.

## 2026-09-30 — Phase 3: User Story 1 (part 3/4) [T041-T048]
**Q:** T047 (and T050) need the emulator, which requires about 8 GB of free RAM. Only about 4.4 GB was free.
**A:** The user will free RAM and autopilot continues. T047 and T050 run on the emulator as specified. If memory is still short when the task runs, return "blocked" rather than working around it.
