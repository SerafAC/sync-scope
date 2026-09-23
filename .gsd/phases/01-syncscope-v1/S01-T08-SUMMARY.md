---
id: T08
parent: S01
milestone: M001
key_files:
  - android/app/src/androidTest/java/com/syncscope/ProtocolConnectInstrumentedTest.kt
  - android/app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt
  - android/app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt
  - scripts/validation/android-validator.sh
  - scripts/validation/protocol-audit.sh
  - scripts/validation/protocol-service.sh
key_decisions:
  - A DAV class check must read every DAV header value (response.headers("DAV")), not response.header("DAV"): Apache sends the header twice and OkHttp keeps only the last, which names no class.
  - FTP precision discovery descends breadth-first to the nearest directory holding regular files, bounded at 16 directories, because a repository root commonly holds only folders and sampling just the root leaves precision permanently undiscovered.
  - protocol-audit.sh scans only vsftpd 'FTP command:' lines for the ftp forbidden set, because vsftpd's FEAT reply advertises EPRT on a response line; scoping preserves detection of genuine RETR/PORT/EPRT commands.
  - The validator emulator launches with -no-window, since agent and CI sessions have no DISPLAY and Qt's xcb plugin aborts the emulator with an error the validator can only report as a generic lock failure.
  - protocol-service.sh stop succeeds as a no-op when no owned state and no running project remain, so the gate's trailing services:stop does not fail after android-flow.sh has already torn down what it started; a project running without our state is still refused.
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T08: Live androidTest proving FTP, SFTP and WebDAV connect against the digest-pinned containers is green on API 31, and it exposed and fixed three real defects: a WebDAV multi-value DAV header bug, FTP precision that never sampled, and an FTP audit false positive

**Live androidTest proving FTP, SFTP and WebDAV connect against the digest-pinned containers is green on API 31, and it exposed and fixed three real defects: a WebDAV multi-value DAV header bug, FTP precision that never sampled, and an FTP audit false positive**

## What Happened

This was a retry after a provider-pause. The prior attempt had already written the 509-line `ProtocolConnectInstrumentedTest.kt` (committed by an auto-commit), so the work here was getting the live gate to actually run and then fixing what it proved broken.

**Recovering the gate.** The prior run failed in 21s with only "Emulator or validator lock failed to start." Two environment problems stacked. First, the killed run left `/tmp/cloud-sync-checker-api31` and the validator lock behind, and `android-validator.sh start` aborts when that state survives. Clearing it was not enough — the failure reproduced. Because the script's `cleanup_failed_start` deletes the state dir (and the emulator log with it), I reproduced the launch by hand and captured the real cause: this session has no `DISPLAY`, so Qt's xcb platform plugin failed fatally ("no Qt platform plugin could be initialized") and the emulator core-dumped ~2s in. It had booted fine at 07:54 when a desktop session was attached, which is why the log looked healthy. `QT_QPA_PLATFORM=offscreen` got further (gRPC up, display configured) but still core-dumped; `-no-window` booted cleanly to serial in 16s. Added `-no-window` to `android-validator.sh`. Note MEM018's Docker 29.7.2 pin did NOT block anything — the containers start fine on 29.8.1.

**What the live run then proved broken.** With the emulator up, 8 tests ran and 4 failed — all genuine client defects, each found only because this test talks to real servers:

1. *WebDAV (2 tests).* Apache answers OPTIONS with two `DAV` headers (`DAV: 1,2` and `DAV: <http://apache.org/dav/propset/fs/1>`). OkHttp's `Response.header("DAV")` returns only the *last*, which names no class, so `connect()` threw "does not offer WebDAV at the configured folder" against a perfectly good server. Fixed to flatten `headers("DAV")`. Confirmed against the live container by curl first: `DAV: 1,2`, PROPFIND 207.

2. *FTP (2 tests).* `discoverPrecision()` sampled only the configured root's immediate children, and the fixture root — like most real repository roots — holds only directories, so it returned `NO_SAMPLE_FILES` and precision was undiscoverable. Added a bounded breadth-first `findSampleDirectory` walk (cap `PRECISION_SCAN_DIRECTORIES = 16`, dot/cdir/pdir entries excluded via `toEntry`, shallowest samples win). Evidence the fix is real rather than cosmetic: the container's FTP log shows zero MDTM commands before and 2 MDTM commands after, so precision is now genuinely measured.

3. *FTP audit false positive (R026).* Even with tests passing, `protocol-audit.sh` failed the ftp teardown with "prohibited content or mutation operation observed". The matches were `EPRT` on `FTP response:` lines — vsftpd's own FEAT capability advertisement, not a client command. The unscoped grep would fail every clean run the moment a client calls FEAT. Scoped the ftp scan to `FTP command:` lines. Verified both directions: the real previously-failing log is now clean, while injected genuine `RETR` and active-mode `EPRT` command lines are still caught, and the sftp/webdav patterns still fire.

**One more sequencing defect.** The plan's 4-command chain ends in `validation:services:stop`, but `android-flow.sh` already stops the services it started and removes their state, so the trailing stop hit "Refusing to stop an unowned Compose project" and exited 1 — the literal verify chain could never pass. Made `stop` a no-op success when there is nothing left to stop, while still refusing when a project is genuinely running without our state.

Final clean-room run of the exact chain from the plan exits 0: 8/8 tests green on API 31, all three audits clean, zero unexpected remote changes. No fixture or mock was substituted for any container. Environment left clean (no containers, emulators, or validator state).

## Verification

Ran the exact verify chain from the task plan in a clean room (no emulator attached, validator state removed): `pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop` → exit 0 in 131.9s. 8/8 instrumented tests green on API 31 against the live digest-pinned containers, covering per-protocol auth success plus typed AUTH_FAILED on a wrong password, real listings of the seeded fixtures, the duplicates pair with identical size and mtime, both unicode compositions as distinct un-normalized entries, non-regular entries classified OTHER under a timeout, discovered precision with the bucket-start/bucket-end pair sharing one bucket, full SFTP TOFU (challenge → reject → re-challenge → approve → connect, SHA256: fingerprint), and TurboModule registration with getContractVersion() == 1. All three protocol audits reported a clean metadata-read allowlist and zero unexpected remote changes on teardown. Supporting: assembleDebug + assembleDebugAndroidTest exit 0; testDebugUnitTest exit 0 (guards the FtpRemoteClient and WebDavRemoteClient changes); targeted protocol-audit.sh regression checks confirm the scoping fix still catches genuine RETR/EPRT/sftp-open/webdav-GET violations. The FTP container log independently confirms read-only behavior: only FEAT, LIST, MDTM, PASS, PASV, QUIT, SYST, USER were issued.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop` | 0 | pass | 131906ms |
| 2 | `./android/gradlew -p android --no-daemon :app:assembleDebug :app:assembleDebugAndroidTest` | 0 | pass | 38000ms |
| 3 | `./android/gradlew -p android --no-daemon :app:testDebugUnitTest` | 0 | pass | 52000ms |
| 4 | `scripts/validation/protocol-audit.sh regression checks (real log clean; injected RETR/EPRT/sftp-open still caught)` | 0 | pass | 53ms |

## Deviations

The plan scoped T08's files to `ProtocolConnectInstrumentedTest.kt` and `android/app/build.gradle`. The test file needed no change (the prior attempt had written it) and `build.gradle` needed none — T07's credential bridging already worked. Instead, four files outside the declared list required edits, each because the live gate could not otherwise pass:

- `scripts/validation/android-validator.sh` — added `-no-window`; without it the emulator cannot start in a headless session, so no live run is possible at all.
- `android/app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt` and `FtpRemoteClient.kt` — two genuine client defects the live test exposed (multi-value DAV header, precision never sampling). These are T05/T03 code, but fixing what the proof test proves broken is the point of the proof test; leaving them would mean reporting a red gate.
- `scripts/validation/protocol-audit.sh` and `protocol-service.sh` — an R026 false positive and a stop-idempotency defect that each independently made the plan's verify chain unpassable.

No fixture or mock was substituted for any live container, and the audit fix was verified not to weaken R026 detection.

## Known Issues

- API 36 coverage was not run; the plan explicitly defers it to S07's integration closure.
- The `-no-window` flag is now unconditional, so the validator emulator never shows a window even on a workstation with a display attached. That is the right default for a validation harness, but someone wanting to watch a run visually must now remove the flag.
- MEM018 should be considered stale: it claims the Docker 29.7.2 pin blocks every live-container gate, but `validation:services:start` succeeded repeatedly on Docker 29.8.1 during this task.
- The FTP precision basis is whatever vsftpd yields empirically (observed: MDTM sampling now occurs); the test deliberately accepts any real measured basis rather than pinning a value, per the plan.

## Files Created/Modified

- `android/app/src/androidTest/java/com/syncscope/ProtocolConnectInstrumentedTest.kt`
- `android/app/src/main/java/com/syncscope/remote/WebDavRemoteClient.kt`
- `android/app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt`
- `scripts/validation/android-validator.sh`
- `scripts/validation/protocol-audit.sh`
- `scripts/validation/protocol-service.sh`
<!-- gsd:state-version=79:0 -->
