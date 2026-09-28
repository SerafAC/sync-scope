# GSD State

**Active Milestone:** M001: SyncScope v1
**Active Slice:** S01: Native CloudSync module and live protocol connect
**Phase:** executing
**Requirements Status:** 22 active · 0 validated · 3 deferred · 5 out of scope

## Milestone Registry
- 🔄 **M001:** SyncScope v1

## Recent Decisions
- D010 (M001 Layer 2, refined during depth verification when the user corrected the list and tree view behaviour): How the three views read scan results and how the origin of a file is shown -> All views read one snapshot through opaque page tokens clamped to 200 — gallery flat via queryFiles, list and tree parent-scoped via queryTreeChildren; the origin badge appears in gallery only, on duplicates only, naming the originating local folder
- D011 (M001 Layer 3, where the user chose sensible defaults after seeing the full list): How failures are represented and what happens when a scan cannot complete cleanly -> Typed discriminated envelopes with stable machine-readable codes and redacted messages across the whole bridge; a scan never aborts wholesale — affected files become UNKNOWN with an issueCode and the run reports an explicit incomplete-listing count
- D012 (M001 Layer 4, after verifying Maestro was already installed and wired into the e2e pipeline): What counts as proof that a user-visible capability works -> Maestro 2.10.0 flows in validation/maestro driving the real APK on API 31 and API 36 emulators against live digest-pinned protocol containers; component tests with a mocked TurboModule are supporting evidence, never the proof
- D013 (Planning M001/S01; research flagged this as an explicit open judgement call for the planner.): Whether S01 implements the full Room persistence layer or only the repository_config and trusted_sftp_host_key rows its boundary map names -> S01 implements the complete pinned persistence surface — all 10 entities, their DAOs, SyncScopeDatabase, SnapshotQuery, PageTokenCodec, SnapshotStore, and the three exception types — so that the entire existing JVM test suite compiles and passes at S01 exit.
- D014 (Planning M001/S01; research flagged this as an unresolved design point that must be assigned explicitly rather than left to an executor.): How randomly-generated, host-side protocol container credentials reach an androidTest running on the emulator -> android/app/build.gradle reads the SYNCSCOPE_{SFTP,WEBDAV,FTP}_CREDENTIAL_FILE paths from the Gradle environment at configuration time and forwards the parsed username/password into android.defaultConfig.testInstrumentationRunnerArguments; the androidTest reads them via InstrumentationRegistry.getArguments(). Host addresses are 10.0.2.2 with the compose ports, never 127.0.0.1.

## Blockers
- None

## Next Action
Execute T01: Implement the Room persistence layer pinned by the existing test suite in slice S01.
