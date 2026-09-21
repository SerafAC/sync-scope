---
id: T02
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncPackage.kt
  - android/app/src/main/java/com/syncscope/MainApplication.kt
  - android/app/build.gradle
  - android/app/src/test/java/com/syncscope/bridge/CloudSyncEnvelopeTest.kt
  - android/app/src/test/java/com/syncscope/bridge/CloudSyncContractsParityTest.kt
  - android/app/src/test/java/com/syncscope/bridge/CloudSyncModuleTest.kt
key_decisions:
  - Module methods never reject: runOperation/runPage wrap each block, catch Throwable, and resolve a redacted INTERNAL_ERROR envelope. Page methods keep the FilePageResultDto shape (page:null). Later tasks replace only the block passed to runOperation/runPage.
  - CloudSyncEnvelope takes injectable map/array factories (default Arguments.*), so envelope and module logic are JVM-testable with JavaOnlyMap without JNI.
  - redact() takes an optional list of sensitive values (configured host, username, root) that are stripped verbatim before the regex passes; protocol tasks should pass the repository config values.
  - defaultConfig sets usesCleartextTraffic=false, so any build type that doesn't opt in (including future ones) denies cleartext.
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T02: Registered the CloudSync TurboModule (codegen NativeCloudSyncSpec subclass on a background coroutine scope) with a redacting envelope layer that turns every throwable into an INTERNAL_ERROR envelope, a TS-parity contracts mirror, and per-build-type cleartext manifest placeholders

**Registered the CloudSync TurboModule (codegen NativeCloudSyncSpec subclass on a background coroutine scope) with a redacting envelope layer that turns every throwable into an INTERNAL_ERROR envelope, a TS-parity contracts mirror, and per-build-type cleartext manifest placeholders**

## What Happened

Ran :app:generateCodegenArtifactsFromSchema and confirmed the generated abstract class com.syncscope.codegen.NativeCloudSyncSpec (19 @ReactMethod methods, each with a trailing Promise). No spec base or JNI glue was hand-written.

Added com.syncscope.bridge:
- CloudSyncContracts: MODULE_NAME, CONTRACT_VERSION=1, MAX_PAGE_SIZE=200, DEFAULT_PAGE_SIZE=50, plus a clampPageSize that matches the TS semantics. The CloudSyncErrorCode enum holds exactly the 7 TS codes.
- CloudSyncEnvelope: ok(), error(code, message, action, sensitive), pageError (FilePageResultDto shape with page:null), page(entries, nextPageToken, counts) nested under `page` as in TS QueryFilesOk, notImplemented/pageNotImplemented, and internalError(Throwable). redact(message, sensitive) first strips known sensitive values verbatim (case-insensitive, longest first), then strips URLs, user@host, IPv4 and IPv6 addresses, Windows and Unix/~ paths, and hostnames. Messages and actions are always redacted. Map and array factories default to Arguments.createMap/createArray and are injectable, so JVM tests use JavaOnlyMap.
- CloudSyncModule: extends NativeCloudSyncSpec, NAME="CloudSync". All work runs in CoroutineScope(SupervisorJob()+Dispatchers.IO), cancelled in invalidate(). getContractVersion resolves 1. Every other method resolves NOT_IMPLEMENTED through runOperation or runPage; the query methods resolve a page-shaped envelope. runOperation/runPage catch Throwable, log a redacted line under tag CloudSync, and resolve INTERNAL_ERROR. Promises are never rejected. These are internal hooks, so later tasks only swap the block.
- CloudSyncPackage: a BaseReactPackage whose getModule returns CloudSyncModule for the name "CloudSync". The ReactModuleInfo sets isTurboModule=true.

MainApplication now calls add(CloudSyncPackage()), replacing the placeholder comment. In build.gradle, defaultConfig sets the usesCleartextTraffic placeholder to "false", debug sets "true" (debugOptimized inherits it through initWith), and release explicitly sets "false".

Added 19 JVM tests: CloudSyncEnvelopeTest (10), CloudSyncContractsParityTest (3, which reads src/native/CloudSyncContracts.ts), and CloudSyncModuleTest (6, Robolectric).

## Verification

- `./gradlew :app:assembleDebug` succeeded, and both plan greps (`add(CloudSyncPackage())` and `usesCleartextTraffic`) matched.
- The debug merged manifest has usesCleartextTraffic="true".
- The resolved build-type placeholders are release=false, debug=true, debugOptimized=true, defaultConfig=false.
- `:app:testDebugUnitTest` passed 44/44: the 19 new bridge tests plus all prior persistence and foundation tests.
- The Jest suite passed 4/4 suites and 17/17 tests, including NativeCloudSyncBoundary.test.ts. No src/** files were modified.
- Device-level TurboModuleRegistry resolution is deferred to T08, as the plan says.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:assembleDebug --no-daemon && grep -q 'add(CloudSyncPackage())' app/src/main/java/com/syncscope/MainApplication.kt && grep -q 'usesCleartextTraffic' app/build.gradle` | 0 | pass | 189618ms |
| 2 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon (44 tests, 0 failures)` | 0 | pass | 43252ms |
| 3 | `npx jest --silent (4 suites, 17 tests incl. NativeCloudSyncBoundary)` | 0 | pass | 3867ms |
| 4 | `gradle init-script printPlaceholders: release=[usesCleartextTraffic:false], debug=true` | 0 | pass | 32476ms |

## Deviations

- Added a defaultConfig placeholder (false) in addition to the per-build-type values.
- Unit tests build the module on BridgeReactContext, because ReactApplicationContext is abstract in RN 0.87 and BridgeReactContext is RN's @VisibleForTesting concrete class.
- The page ok envelope nests entries, nextPageToken, and counts under `page`, matching TS QueryFilesOk and FilePageResultDto.

## Known Issues

Release variant packaging (`:app:processReleaseMainManifest`) cannot run in this environment: createBundleReleaseJsAndAssets can't find a hermesc binary. This existed before this task. The release placeholder was checked through the resolved Gradle model instead.

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncPackage.kt`
- `android/app/src/main/java/com/syncscope/MainApplication.kt`
- `android/app/build.gradle`
- `android/app/src/test/java/com/syncscope/bridge/CloudSyncEnvelopeTest.kt`
- `android/app/src/test/java/com/syncscope/bridge/CloudSyncContractsParityTest.kt`
- `android/app/src/test/java/com/syncscope/bridge/CloudSyncModuleTest.kt`
<!-- gsd:state-version=39:0 -->
