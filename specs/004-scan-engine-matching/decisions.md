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

## 2026-10-01 — Phase 3: User Story 1 [T044, T047, T049-T050]
**Q:** On FTP servers without MLSD (vsftpd), LIST shows only a date for older files, and the client reads it in the device time zone while matching at MDTM's 1 s precision, so FTP files almost never match. How should FtpRemoteClient get modified times?
**A:** LIST precision, read as UTC — when listing via LIST, take the precision from what LIST actually gives (the coarsest sample, at least 60 s, a whole day for date-only entries), using D004's LIST_GRANULARITY basis even when the server supports MDTM. Parse LIST dates as UTC. Accept that matching is coarser (a same-day change to a file with the same name and size counts as synced). Add JVM tests and document it in docs/protocols.md.

## 2026-10-01 — Phase 3: User Story 1 [T044, T047, T049-T050]
**Q:** 01-clean-scan-sftp's required progress-card check is flaky because a 7-file scan finishes before Maestro sees the card. How should T043's progress assertion be made reliable?
**A:** Debug-only scan delay — add a debug-build-only per-file throttle, set through the existing ConfigureRepository debug seam (or the same debug intent), and enable it in the 01 flows so the progress card is always visible. Release builds must be unaffected, so keep it out of release code paths. Keep PROGRESS=required strict in the 01 flows.
