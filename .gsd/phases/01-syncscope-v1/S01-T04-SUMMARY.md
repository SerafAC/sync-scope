---
id: T04
parent: S01
milestone: M001
key_files:
  - android/app/src/main/java/com/syncscope/remote/TofuHostKeyVerifier.kt
  - android/app/src/main/java/com/syncscope/remote/HostKeyTrustStore.kt
  - android/app/src/main/java/com/syncscope/remote/SftpRemoteClient.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt
  - android/app/src/main/java/com/syncscope/persistence/Daos.kt
  - android/app/src/main/java/com/syncscope/remote/RemoteClient.kt
  - android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt
  - src/native/CloudSyncContracts.ts
  - android/app/build.gradle
  - android/app/src/test/java/com/syncscope/remote/TofuHostKeyVerifierTest.kt
  - android/app/src/test/java/com/syncscope/remote/SftpRemoteClientTest.kt
  - android/app/src/test/java/com/syncscope/bridge/CloudSyncHostKeyModuleTest.kt
  - android/app/src/test/java/com/syncscope/bridge/RecordingPromise.kt
key_decisions:
  - The verifier decides against a pre-loaded snapshot of trusted rows (HostKeyTrustStore.verifierFor), so SSHJ's transport thread does no DB I/O. A refusal is recorded on verifier.rejection and read after SSHJ's generic transport failure.
  - Trust is per host:port across algorithms: a key of any other algorithm for a trusted endpoint is SFTP_HOST_KEY_CHANGED, not a first contact. Approval goes through replaceEndpointKey, which reuses the row id and drops other-algorithm rows, so superseded keys never verify again.
  - UNVERIFIED is returned as ConnectOutcome.HostKeyApprovalRequired(challenge), per the existing RemoteClient contract; CHANGED is thrown as SftpHostKeyException. Both render the same structured error.hostKeyChallenge, and the message text stays host-free.
  - Pending challenges are in-memory only: 16 max, 15-minute TTL, newest per endpoint. After a restart the next connect simply asks again.
  - The SHA256 fingerprint is built from SSHJ's wire blob and self-verified with SSHJ's FingerprintVerifier, because SecurityUtils.getFingerprint only yields MD5. Parity with ssh-keygen is asserted in a test.
duration:
verification_result: passed
completed_at:
blocker_discovered: false
---

# T04: Added the SSHJ-backed read-only SftpRemoteClient with blocking TOFU host-key verification: an unknown key raises a SFTP_HOST_KEY_UNVERIFIED challenge and a differing key fails hard with SFTP_HOST_KEY_CHANGED. Fingerprints match OpenSSH SHA256 byte for byte, and approveSftpHostKey/rejectSftpHostKey are wired to trusted_sftp_host_key.

**Added the SSHJ-backed read-only SftpRemoteClient with blocking TOFU host-key verification: an unknown key raises a SFTP_HOST_KEY_UNVERIFIED challenge and a differing key fails hard with SFTP_HOST_KEY_CHANGED. Fingerprints match OpenSSH SHA256 byte for byte, and approveSftpHostKey/rejectSftpHostKey are wired to trusted_sftp_host_key.**

## What Happened

Added sshj 0.40.0 and bcprov-jdk18on 1.80.2 to android/app/build.gradle. SSHJ resolved from Maven Central. SSHJ's bcutil is pinned [1.80,1.81), so 1.80.2 keeps every BouncyCastle jar on one version.

TofuHostKeyVerifier implements both HostKeyVerifier methods. It decides against a snapshot of the endpoint's trusted rows that HostKeyTrustStore.verifierFor loads before connect, so SSHJ's transport thread never touches Room. The decisions are:
- presented key equals a trusted key → true;
- no trusted key for host:port → pending challenge raised, rejection = SftpHostKeyException(SFTP_HOST_KEY_UNVERIFIED), false;
- any other key, including one of a different algorithm → SFTP_HOST_KEY_CHANGED with previousFingerprint, false.
findExistingAlgorithms returns the pinned algorithms so SSHJ negotiates them first.

Fingerprints: SSHJ's SecurityUtils.getFingerprint only produces the legacy MD5 colon-hex form (exposed as SshFingerprints.md5). The SHA256 form is built as SHA-256 over SSHJ's own wire blob (Buffer.putPublicKey), unpadded base64. Every result is self-checked against SSHJ's FingerprintVerifier before it is shown. A test asserts equality with real `ssh-keygen -lf` output for OpenSSH-generated ed25519 keys (SHA256 and MD5).

HostKeyTrustStore joins Room and a HostKeyChallengeRegistry. The registry is in-memory, uses UUID ids, keeps one challenge per endpoint, holds at most 16, and expires them after 15 minutes. approve() consumes the challenge and calls the new TrustedSftpHostKeyDao.replaceEndpointKey transaction. That transaction deletes other-algorithm rows for the endpoint and reuses the existing row id, so re-approval updates the row rather than colliding with the unique index, and a superseded key can never verify again. reject() consumes the challenge and persists nothing. An unknown, consumed, or expired id throws RemoteClientException(HOST_KEY_CHALLENGE_NOT_FOUND). A process-wide HostKeyTrustStore.shared(context) exists so challenges raised by a connect can be answered via the module.

CloudSyncModule: approveSftpHostKey and rejectSftpHostKey now run through runOperation and return ok, or a typed error envelope; they never reject the promise. The store is injectable and lazily resolved on the IO dispatcher.

CloudSyncEnvelope.error gains an optional structured hostKeyChallenge (challengeId, host, port, algorithm, fingerprint, previousFingerprint). remoteFailure attaches it for SftpHostKeyException, and hostKeyApprovalRequired(challenge) builds the UNVERIFIED envelope. Messages remain host-free.

SftpRemoteClient uses SSHJ SSHClient(DefaultConfig) with 15s connect and 30s socket timeouts. When connect fails and the verifier refused the key, UNVERIFIED returns ConnectOutcome.HostKeyApprovalRequired(challenge) after disconnecting, and CHANGED throws. The password is passed as a copy because SSHJ blanks it. Listing is SFTPClient.ls (OPENDIR/READDIR); no file handle is ever opened. Symlink, FIFO, and modeless entries map to OTHER. mtime converts seconds to millis. Precision is 1000 ms with the new PrecisionBasis.SFTP_V3_WHOLE_SECONDS. SftpFailures maps auth, refused, timeout, lost, and SFTP PERMISSION_DENIED/NO_SUCH_* to the existing five codes with fixed host-free messages. SshSecurity swaps Android's stripped platform "BC" provider for the bundled full one, appended rather than preferred.

Contracts: the Kotlin enum and TS CloudSyncErrorCode gained SFTP_HOST_KEY_UNVERIFIED, SFTP_HOST_KEY_CHANGED, and HOST_KEY_CHALLENGE_NOT_FOUND in the same order, which the parity test checks. TS CloudSyncError gained an optional hostKeyChallenge with a HostKeyChallengeDto type. ConnectOutcome.HostKeyApprovalRequired now carries the full HostKeyChallenge, and RemoteClientException is open.

Tests: TofuHostKeyVerifierTest (12 cases, Robolectric in-memory Room), SftpRemoteClientTest (8 pure mapping cases), and CloudSyncHostKeyModuleTest (5 module/envelope cases). RecordingPromise moved to a shared test file and gained a latch-based await(), because Room suspend DAOs resolve on another thread.

## Verification

`cd android && ./gradlew :app:testDebugUnitTest --no-daemon` passed: 13 suites, 91 tests, 0 failures, including the new verifier, SFTP client, and host-key module tests. The plan greps passed: findExistingAlgorithms and getFingerprint are present in TofuHostKeyVerifier.kt, and there is no `.open(` in SftpRemoteClient.kt. `./gradlew :app:assembleDebug` succeeded. For the TS contract change, `npx tsc --noEmit` passed and `npx jest` passed 17/17. Real TOFU against the OpenSSH container is deferred to T08 per the plan.

## Verification Evidence

| # | Command | Exit Code | Verdict | Duration |
|---|---------|-----------|---------|----------|
| 1 | `cd android && ./gradlew :app:testDebugUnitTest --no-daemon (13 suites, 91 tests, 0 failures)` | 0 | pass | 45664ms |
| 2 | `grep -q findExistingAlgorithms/getFingerprint TofuHostKeyVerifier.kt && ! grep -q '.open(' SftpRemoteClient.kt` | 0 | pass | 50ms |
| 3 | `cd android && ./gradlew :app:assembleDebug --no-daemon` | 0 | pass | 42783ms |
| 4 | `npx tsc --noEmit && npx jest --silent (17 tests)` | 0 | pass | 5070ms |

## Deviations

- BouncyCastle: briefly tried 1.81; settled on the planned 1.80.2 so it matches SSHJ's transitive bcutil [1.80,1.81).
- Plan step 4 said to use SecurityUtils.getFingerprint for the SHA256:<base64> form, but that SSHJ API only produces MD5 colon-hex. The SHA256 form is computed with SecurityUtils.getMessageDigest over SSHJ's own key encoding and checked against SSHJ's FingerprintVerifier. getFingerprint is still used for the MD5 form. A test proves byte-for-byte equality with ssh-keygen.
- Added HostKeyTrustStore.kt, new DAO queries (forHost, deleteOtherAlgorithms, replaceEndpointKey), and a HOST_KEY_CHALLENGE_NOT_FOUND error code to both contracts. The Room schema is unchanged.
- Added SftpRemoteClientTest.kt and CloudSyncHostKeyModuleTest.kt beyond the planned verifier test, and moved RecordingPromise into a shared test file.

## Known Issues

- Live behaviour is not yet exercised against the OpenSSH container: SSHJ DefaultConfig on-device, the Android BC provider swap, and ed25519 KEX. T08 covers this.
- Nothing consumes the UNVERIFIED ConnectOutcome yet. testRepository and saveRepository (later tasks) must map it with envelope.hostKeyApprovalRequired and must build SftpRemoteClient with HostKeyTrustStore.shared(context) so challenges are answerable.

## Files Created/Modified

- `android/app/src/main/java/com/syncscope/remote/TofuHostKeyVerifier.kt`
- `android/app/src/main/java/com/syncscope/remote/HostKeyTrustStore.kt`
- `android/app/src/main/java/com/syncscope/remote/SftpRemoteClient.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncModule.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncEnvelope.kt`
- `android/app/src/main/java/com/syncscope/persistence/Daos.kt`
- `android/app/src/main/java/com/syncscope/remote/RemoteClient.kt`
- `android/app/src/main/java/com/syncscope/bridge/CloudSyncContracts.kt`
- `src/native/CloudSyncContracts.ts`
- `android/app/build.gradle`
- `android/app/src/test/java/com/syncscope/remote/TofuHostKeyVerifierTest.kt`
- `android/app/src/test/java/com/syncscope/remote/SftpRemoteClientTest.kt`
- `android/app/src/test/java/com/syncscope/bridge/CloudSyncHostKeyModuleTest.kt`
- `android/app/src/test/java/com/syncscope/bridge/RecordingPromise.kt`
<!-- gsd:state-version=47:0 -->
