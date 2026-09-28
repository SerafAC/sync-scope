---
id: T06
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/credential/CredentialStore.kt
  - android/app/src/main/java/com/syncscope/bridge/RepositoryOperations.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt
  - android/app/src/main/java/com/syncscope/remote/RemoteClientFactory.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt
  - src/native/CloudSyncContracts.ts
  - android/app/src/main/java/com/syncscope/persistence/Daos.kt
  - android/app/src/main/java/com/syncscope/remote/HostKeyTrustStore.kt
  - android/app/build.gradle
  - android/app/src/test/java/com/syncscope/credential/RepositoryConfigBoundaryTest.kt
key_decisions:
  - Payload-carrying ok envelopes nest data under a named key (connection for testRepository, repository for getRepositorySummary); OperationResultDto's TS type still only declares contractVersion/status/error, so the T07 UI must widen it.
  - A null transientPassword on save reuses the stored credential only for an identical protocol/host/port/username whose credential version is still current; any other account requires a password.
  - Precision is persisted with a revision-guarded UPDATE so a test racing a save never writes precision onto a different endpoint; precisionMillis 0 means unknown and is reported to JS as null.
  - CredentialStore is injectable over a SharedPreferences factory; the Keystore-backed EncryptedSharedPreferences cannot run under Robolectric, so JVM tests exercise the same version logic over plain prefs.
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T06: Added Keystore-backed CredentialStore (EncryptedSharedPreferences + AES256_GCM MasterKey, versioned so rotated credentials are detected) and real saveRepository/testRepository/getRepositorySummary envelopes via RepositoryOperations and a RemoteClientFactory; the password never reaches Room and is wiped on every path

**Added Keystore-backed CredentialStore (EncryptedSharedPreferences + AES256_GCM MasterKey, versioned so rotated credentials are detected) and real saveRepository/testRepository/getRepositorySummary envelopes via RepositoryOperations and a RemoteClientFactory; the password never reaches Room and is wiped on every path**

## What Happened

Added androidx.security:security-crypto:1.1.0. The new com.syncscope.credential.CredentialStore takes a SharedPreferences factory: in production, CredentialStore.shared(context) builds EncryptedSharedPreferences under an AES256_GCM Keystore MasterKey, and tests pass plain prefs so the real version logic is exercised. store(CharArray): Long commits the password under a strictly increasing version (the last-issued counter survives clear(), so versions are never reused) and wipes the caller's array. load(version) returns null unless the version is the current one. isCurrent(version) is the presence check. clear() removes the password. Versions are Long because RepositoryConfigEntity.credentialVersion is Long.

New bridge/RepositoryOperations.kt (wired into CloudSyncModule through injectable repositoryConfig/credentialStore/remoteClients factories, defaulting to SyncScopeDatabase, CredentialStore.shared, and RemoteClientFactory.default):
- save validates protocol (FTP/SFTP/WEBDAV, case-insensitive), host (bare host, ≤253 chars, no whitespace or / \ @ ? #), port (a whole number 1-65535, defaulting per protocol when omitted), username (non-blank, no control characters), and remoteRoot (absolute, no . or .. segments, default "/"). Invalid input returns INVALID_QUERY with error.field naming the field and never echoing the value. The password goes straight to CredentialStore. A null password is accepted only when re-saving the same protocol/host/port/username whose credential is still current, so a password is never carried over to a different account. The row is replaced (single profile) with the revision bumped and precision reset to 0, meaning unknown.
- test loads the credential by version (CREDENTIAL_UNAVAILABLE if it is missing or rotated, before any client is built) and builds the client via RemoteClientFactory. It runs connect, then list(root), then discoverPrecision, and persists precision through a new revision-guarded DAO update, updatePrecision(revision, precision), so a save that lands mid-test is never overwritten. It returns ok with connection {protocol, reachable, entryCount, precisionMillis, precisionBasis, precisionPersisted}. HostKeyApprovalRequired returns the T04 SFTP_HOST_KEY_UNVERIFIED challenge envelope. A RemoteClientException keeps its code and is scrubbed with the config's sensitive values. finally always closes the client and zeroes the password; other throwables fall through to the module's INTERNAL_ERROR.
- summary returns repository {protocol, host, port, username, remoteRoot, precisionMillis (null until tested), credentialPresent boolean, hostKeyTrusted (SFTP only, via the new HostKeyTrustStore.isTrusted; null otherwise)}. With no row it returns REPOSITORY_NOT_CONFIGURED.

Save and test are serialised by a Mutex. Two error codes, REPOSITORY_NOT_CONFIGURED and CREDENTIAL_UNAVAILABLE, were added to the Kotlin enum and mirrored in src/native/CloudSyncContracts.ts (the parity test passes). CloudSyncEnvelope gained ok(key, payload), map(), invalidField(), and an optional field on error(). CloudSyncModuleTest's NOT_IMPLEMENTED list dropped the three now-real methods. approveSftpHostKey/rejectSftpHostKey were already real from T04.

## Verification

:app:testDebugUnitTest passed (RepositoryConfigBoundaryTest 16/16, CloudSyncModuleTest 6/6, SchemaContractTest 6/6, CloudSyncContractsParityTest 3/3, all other suites green). :app:assembleDebug succeeded. The plan's grep checks passed (credentialVersion is in schema 1.json; no 'password' in Entities.kt). jest src/native passed 15/15 and tsc --noEmit is clean after the TS error-code mirror. Live connection behaviour is deferred to T08 per the plan.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon` | 0 | pass | 71248ms |
| 2 | `cd android && ./gradlew :app:assembleDebug --no-daemon` | 0 | pass | 30000ms |
| 3 | `grep -q 'credentialVersion' app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json && ! grep -qi 'password' app/src/main/java/com/syncscope/persistence/Entities.kt` | 0 | pass | 50ms |
| 4 | `npx jest src/native` | 0 | pass | 5000ms |
| 5 | `npx tsc --noEmit` | 0 | pass | 4000ms |

## Deviations

credentialVersion is Long, not Int, to match the existing RepositoryConfigEntity column. The repository logic lives in a new bridge/RepositoryOperations.kt rather than inline in CloudSyncModule. Added two error codes (REPOSITORY_NOT_CONFIGURED, CREDENTIAL_UNAVAILABLE), mirrored into the TS contracts, for the plan's typed not-configured and credential-missing envelopes. Added RepositoryConfigDao.updatePrecision and HostKeyTrustStore.isTrusted (no schema change).

## Known Issues

EncryptedSharedPreferences needs a String, so a JVM String copy of the password briefly exists inside the store and cannot be wiped; the bridge's transientPassword is also a String. All CharArrays are zeroed. security-crypto 1.1.0 marks EncryptedSharedPreferences deprecated with no successor, and the deprecation warning is suppressed. If a credential store succeeds but the Room write fails, the old row's version is no longer current, so test reports CREDENTIAL_UNAVAILABLE (fail-safe, not silent reuse). The Keystore path itself runs only on a device; it is exercised in T08 androidTest.

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/credential/CredentialStore.kt`
- `android/app/src/main/java/com/syncscope/bridge/RepositoryOperations.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt`
- `android/app/src/main/java/com/syncscope/remote/RemoteClientFactory.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt`
- `src/native/CloudSyncContracts.ts`
- `android/app/src/main/java/com/syncscope/persistence/Daos.kt`
- `android/app/src/main/java/com/syncscope/remote/HostKeyTrustStore.kt`
- `android/app/build.gradle`
- `android/app/src/test/java/com/syncscope/credential/RepositoryConfigBoundaryTest.kt`
<!-- gsd:state-version=61:0 -->
