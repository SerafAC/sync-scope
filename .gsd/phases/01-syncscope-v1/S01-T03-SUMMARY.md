---
id: T03
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/remote/RemoteClient.kt
  - android/app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt
  - android/app/src/test/java/com/syncscope/remote/FtpPrecisionTest.kt
  - android/app/build.gradle
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt
  - src/native/CloudSyncContracts.ts
key_decisions:
  - Remote failures are thrown as RemoteClientException carrying a CloudSyncErrorCode and a fixed, host-free message. The module maps them to coded envelopes before the INTERNAL_ERROR fallback. SFTP and WebDAV clients (T04/T05) should reuse the same five codes.
  - Precision is empirical, and the finest MDTM/MLSD sample wins across up to 5 files. LIST precision takes the coarsest sample's granularity (a year-form line gives 86400000ms), floored at 60000ms, so old files listed by date only are not falsely compared at minute width.
  - RemoteEntry.sizeBytes passes through FTPFile.getSize(), which is -1 when the server did not report a size.
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T03: Added the read-only RemoteClient contract (no content-read surface) and a passive-mode Commons Net FtpRemoteClient that derives timestamp precision empirically (MDTM nanos → MLSD modify fact → LIST granularity, 60s floor) and maps auth/refused/timeout/lost/unreadable failures to distinct redacted CloudSync error codes

**Added the read-only RemoteClient contract (no content-read surface) and a passive-mode Commons Net FtpRemoteClient that derives timestamp precision empirically (MDTM nanos → MLSD modify fact → LIST granularity, 60s floor) and maps auth/refused/timeout/lost/unreadable failures to distinct redacted CloudSync error codes**

## What Happened

Defined com.syncscope.remote.RemoteClient (connect/list/discoverPrecision/close) with RemoteConfig (toString hides host/user; sensitiveValues feeds redaction), sealed ConnectOutcome (Connected, HostKeyApprovalRequired for SFTP in T04), RemoteEntry(name,sizeBytes,modifiedUtcMillis,type) with REGULAR_FILE/DIRECTORY/OTHER, PrecisionFinding(precisionMillis,basis) with a PrecisionBasis enum (MDTM_SUBSECOND, MDTM_WHOLE_SECONDS, MLSD_SUBSECOND, MLSD_WHOLE_SECONDS, LIST_GRANULARITY, NO_SAMPLE_FILES), and RemoteClientException(code: CloudSyncErrorCode, message, action, replyCode, cause). The interface has no byte-reading surface (R026).

Added commons-net:commons-net:3.12.0 (resolved from the toolchain Gradle cache). FtpRemoteClient: 15s connect / 30s socket+data timeouts, UTF-8 control encoding, checks the connect reply, login, then enterLocalPassiveMode(). Listing uses mlistDir when FEAT advertises MLST, otherwise listFiles; Commons Net parses both. An empty array paired with a non-2xx reply becomes DIRECTORY_UNREADABLE. Dot entries and MLSD cdir/pdir are dropped, and symlinks/unknown types classify as OTHER. discoverPrecision samples up to 5 regular files in rootPath. The MDTM advertisement only decides whether to probe; the replies decide the result. Each reply's nanos map to 1000/100/10/1 ms and the finest sample wins, so one file landing on .000 cannot downgrade a millisecond server. If no MDTM reply is usable it falls back to the MLSD modify fraction, then to LIST Calendar-field granularity. That step takes the coarsest sample (year-form lines give a day), floored at 60000ms. With no regular files it returns NO_SAMPLE_FILES at 60000ms.

Error envelope: added AUTH_FAILED, CONNECTION_REFUSED, CONNECTION_TIMEOUT, CONNECTION_LOST, DIRECTORY_UNREADABLE to both the Kotlin CloudSyncErrorCode and src/native/CloudSyncContracts.ts in the same order, so parity tests stay green. CloudSyncEnvelope.remoteFailure(e, page, sensitive) builds coded redacted envelopes. CloudSyncModule.run catches RemoteClientException before the INTERNAL_ERROR fallback, keeps its code, and logs only code and numeric reply. Failure messages are fixed strings; the IOException text, which names host and port, is kept only as the cause.

## Verification

:app:testDebugUnitTest passes (full suite, including 22 new FtpPrecisionTest cases, 0 failures). The task-plan greps pass: RemoteClient.kt has no InputStream, FtpRemoteClient.kt has no retrieveFile, and it does contain enterLocalPassiveMode. :app:assembleDebug succeeds with commons-net. The Jest CloudSyncContracts test (6/6) and tsc --noEmit pass after the TS error-code additions. A grep for retrieveFile|InputStream|RETR|download|.read( across the remote package finds nothing.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon && ! grep -qi 'InputStream' app/src/main/java/com/syncscope/remote/RemoteClient.kt && ! grep -q 'retrieveFile' app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt && grep -q 'enterLocalPassiveMode' app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt` | 0 | pass (FtpPrecisionTest 22/22) | 58214ms |
| 2 | `cd android && ./gradlew :app:assembleDebug --no-daemon` | 0 | pass | 30000ms |
| 3 | `npx jest src/native/__tests__/CloudSyncContracts.test.ts && npx tsc --noEmit` | 0 | pass (6/6) | 4000ms |
| 4 | `grep -nE 'retrieveFile|InputStream|RETR|download|\.read\(' android/app/src/main/java/com/syncscope/remote/*.kt` | 1 | pass (no matches) | 50ms |

## Deviations

Added five error codes (AUTH_FAILED, CONNECTION_REFUSED, CONNECTION_TIMEOUT, CONNECTION_LOST, DIRECTORY_UNREADABLE) to src/native/CloudSyncContracts.ts as well as Kotlin, because the T02 parity test requires identical lists; the plan listed only Kotlin files. CloudSyncEnvelope and CloudSyncModule were also touched to route RemoteClientException. A fifth code, CONNECTION_LOST, was added beyond the plan's four categories for mid-session drops. LIST precision can exceed 60000ms (day) when dates-only lines are present, instead of a fixed 60000ms.

## Known Issues

LIST timestamps are interpreted by Commons Net in the JVM default zone unless the server's zone is configured. T08 should confirm UTC correctness against vsftpd, which usually offers MDTM/MLSD, so LIST is rarely the basis. Hidden (dot) files are not requested via LIST -a; MLSD returns them. The FTP password is converted to a String for FTPClient.login, which cannot be wiped (Commons Net API limitation).

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/remote/RemoteClient.kt`
- `android/app/src/main/java/com/syncscope/remote/FtpRemoteClient.kt`
- `android/app/src/test/java/com/syncscope/remote/FtpPrecisionTest.kt`
- `android/app/build.gradle`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt`
- `src/native/CloudSyncContracts.ts`
<!-- gsd:state-version=43:0 -->
