# Implementation Plan: Native CloudSync Module and Live Protocol Connect

**Branch**: `002-native-cloudsync-connect` | **Date**: 2026-09-28 (transferred; built 2026-09-21 to
2026-09-23) | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-native-cloudsync-connect/spec.md`

**Status**: Complete. This plan records how milestone slice M001/S01 was planned and built. It is not a
plan for new work. See [tasks.md](./tasks.md) for the delivering commits and [research.md](./research.md)
for the findings and decisions behind it.

## Summary

**Goal**: stand up the Kotlin half of SyncScope: a registered `CloudSync` TurboModule backed by a real Room
persistence layer, three read-only protocol clients (FTP, SFTP, WebDAV) behind one `RemoteClient`
contract, Keystore-backed credential storage, and discovered per-protocol timestamp precision. Everything
is proven by `androidTest` against the live digest-pinned containers, not fixtures.

At the start, the JavaScript half was complete and green (17 Jest tests, `tsc --noEmit` clean), while the
Kotlin half held only the React Native template's `MainActivity.kt` and `MainApplication.kt`. There was no
`CloudSyncPackage`, no TurboModule implementation, no `RemoteClient`, and no Room persistence layer,
although six JVM test files already pinned that layer's API.

## Must-haves

- `cd android && ./gradlew :app:testDebugUnitTest` compiles and passes, including all pre-existing
  persistence tests (`SchemaContractTest`, `SchemaConstraintTest`, `SnapshotStoreTest`, `SnapshotQueryTest`,
  `PageTokenCodecTest`). At the start the test source set could not compile at all.
- `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json` is generated and committed,
  containing `credentialVersion` in `repository_config` and none of password, secret, ciphertext, cipher,
  nonce, credential_blob or token.
- `cd android && ./gradlew :app:assembleDebug` succeeds with `CloudSyncPackage` registered in
  `MainApplication.kt`, and `TurboModuleRegistry.get('CloudSync')` resolves on device with
  `getContractVersion()` returning 1.
- `getRepositorySummary`, `saveRepository`, `testRepository`, `approveSftpHostKey` and `rejectSftpHostKey`
  return real typed envelopes instead of `NOT_IMPLEMENTED`. The remaining 13 spec methods return a typed
  `NOT_IMPLEMENTED` envelope and never throw across the bridge.
- `pnpm validation:android:api31` runs `:app:connectedDebugAndroidTest` against **this** repository (the
  validation scripts no longer hardcode another checkout's path) and proves, against the live containers:
  real FTP/SFTP/WebDAV auth, real listings of the seeded fixtures, real SFTP host-key TOFU with an
  `SHA256:` fingerprint the user approves or rejects, and a measured `precisionMillis` per protocol.
- `pnpm validation:services:stop` passes `protocol-audit.sh` for all three protocols: no `RETR`/`PORT`/`EPRT`
  on FTP, no `open … flags` on SFTP, no `GET` on WebDAV. This proves the `RemoteClient` contract is
  listing-and-metadata only (R026).
- `pnpm typecheck`, `pnpm test` (17 Jest tests, including `NativeCloudSyncBoundary`) and
  `pnpm test:foundation` stay green.

## Proof level

This feature proves **Contract + Integration**.

- **Contract**: Robolectric/Room JVM tests prove the schema invariants, the credentials-never-in-Room
  boundary, page-token round-tripping, and snapshot publish/stale-generation semantics. Jest keeps the JS
  boundary honest.
- **Integration**: `androidTest` on a real API 31 emulator exercises all three protocol clients against the
  live digest-pinned containers, with real auth, real listings, real host-key TOFU and empirically measured
  timestamp precision. There are no fixtures and no mocks in the protocol path. The protocol-audit teardown
  is part of the assertion, not a separate check.

API 36 and Maestro end-to-end flows are out of this feature's proof level; they are feature 010's
integration closure.

## Integration closure

This is the first feature and consumes nothing. It closes by handing features 003–010:

- a resolvable `TurboModuleRegistry.get('CloudSync')`, the precondition R019 names for the whole roadmap;
- a `RemoteClient` listing contract with `precisionMillis` for feature 004's matcher;
- the `CloudSyncError` code/message/action envelope vocabulary that feature 004 reuses for `issueCode`;
- a working `SnapshotStore`, `SnapshotQuery` and `PageTokenCodec` that feature 004 populates and features
  005 and 008 page through.

This was verified by asserting on device that the module resolves and returns contract version 1 from JS,
and by the full JVM suite being green rather than uncompilable.

**Observability**: the typed error envelope (R018) is the single observability surface across the native
boundary. Every failure crosses as `{code, message, action}` with host, username and path redacted, and no
Kotlin exception propagates to JS. Connect-time discovery records the measured `precisionMillis` and how it
was derived (MDTM with sub-second nanos, MDTM seconds, MLSD `modify`, or the LIST minute floor), so a weak
comparison basis is visible rather than silent. The SFTP fingerprint is shown in the exact
`SHA256:<base64>` form OpenSSH prints, so a user can compare it with `ssh-keyscan` output.

## Technical Context

**Language/Version**: Kotlin 2.2.0 (native), TypeScript 6 strict (JS boundary, unchanged in shape)

**Primary Dependencies**: React Native 0.87 (new architecture, TurboModules, Hermes), Room 2.8.4 + KSP,
Apache Commons Net 3.12.0, SSHJ 0.40.0 with BouncyCastle `bcprov-jdk18on` 1.80.2, OkHttp,
`androidx.security:security-crypto` 1.1.0

**Storage**: Room (`SyncScopeDatabase`, version 1, exported schema, no destructive fallback) and
Keystore-backed `EncryptedSharedPreferences` for the password

**Testing**: Robolectric 4.16.1 JVM tests (`pnpm test:android:unit`), Jest (`pnpm test`), node foundation
tests (`pnpm test:foundation`), and `androidTest` against live containers (`pnpm validation:android:api31`)

**Target Platform**: Android, minSdk 31, compileSdk 37, targetSdk 36; proven on API 31

**Constraints**: listing and metadata only (no remote content read); FTP passive mode only; emulator
reaches the host containers at `10.0.2.2` (FTP 32120 with passive 32200–32209, SFTP 32122, WebDAV 32180);
cleartext is permitted in debug builds only

## Constitution Check

Checked retrospectively against `.specify/memory/constitution.md` v1.0.0, which was ratified after this
feature was built.

| Principle | Status | Evidence |
| --- | --- | --- |
| I. Simplicity First (KISS) | PASS | One TurboModule boundary ([D001](../../docs/decisions/0001-single-cloudsync-turbomodule.md)); one `RemoteClient` interface for three protocols; WebDAV hand-rolled over OkHttp instead of a WebDAV library ([D005](../../docs/decisions/0005-protocol-client-libraries.md)). |
| II. Build Only What Is Needed (YAGNI) | PASS | Only `getContractVersion` and the five repository and host-key methods this feature owns were implemented; the other 13 spec methods resolve `NOT_IMPLEMENTED`. The full persistence layer was built because the existing test suite pinned it ([D013](../../docs/decisions/0013-full-persistence-layer-in-s01.md)). |
| III. Single Source of Truth (DRY) | PASS | `CloudSyncContracts.kt` mirrors `src/native/CloudSyncContracts.ts`, and `CloudSyncContractsParityTest` fails the build on drift. Codegen produces the spec base class; it is not hand-written. |
| IV. Unit Tests for All Code | PASS | Each task shipped JVM tests (`CloudSyncEnvelopeTest`, `CloudSyncModuleTest`, `FtpPrecisionTest`, `TofuHostKeyVerifierTest`, `SftpRemoteClientTest`, `PropfindParserTest`, `RepositoryConfigBoundaryTest`, and the persistence suite). 120 JVM tests pass. |
| V. End-to-End Coverage | PASS (API 31) | `ProtocolConnectInstrumentedTest` covers FTP, SFTP and WebDAV against live containers, and each acceptance scenario maps to a named test in [spec.md](./spec.md). API 36 and Maestro flows are feature 010's closure (R019, R020). |
| VI. Versioning + CHANGELOG | PASS with deferral | `CHANGELOG.md` gained an `Unreleased` entry for this feature in merge commit `82188c4`. The `versionName` / `package.json` mismatch predates this feature and is assigned to feature 010. |
| VII. `./docs` mandatory | PASS | `docs/README.md` and `docs/architecture.md` were added in the merge commit that brought this feature to `master`. |
| VIII. README user-facing | N/A | No user-visible UI change. |
| IX. DEVELOPMENT.md | PASS | Environment gotchas found while building this feature are recorded in `DEVELOPMENT.md`. |
| Quality gates | PASS | All gates, including the live gate, passed on the staged merge on 2026-09-28. |

## Project Structure

### Documentation (this feature)

```text
specs/002-native-cloudsync-connect/
├── spec.md       # Complete; R001–R004 and R018 validated
├── plan.md       # This file
├── research.md   # Findings, discussion context and per-task key decisions
└── tasks.md      # T001–T008, all complete, with delivering commits
```

### Source Code (repository root)

```text
android/app/src/main/java/com/syncscope/
├── MainApplication.kt           # registers CloudSyncPackage
├── bridge/                      # the TurboModule and its envelope layer
│   ├── CloudSyncModule.kt       # extends codegen NativeCloudSyncSpec; NAME = "CloudSync"
│   ├── CloudSyncPackage.kt      # BaseReactPackage, isTurboModule = true
│   ├── CloudSyncContracts.kt    # Kotlin mirror of src/native/CloudSyncContracts.ts
│   ├── CloudSyncEnvelope.kt     # ok/error/page envelopes and redact()
│   └── RepositoryOperations.kt  # saveRepository / testRepository / getRepositorySummary
├── credential/
│   └── CredentialStore.kt       # Keystore-backed EncryptedSharedPreferences, credentialVersion
├── persistence/                 # Room scan store (all 10 entities, D013)
│   ├── Entities.kt
│   ├── Daos.kt
│   ├── SyncScopeDatabase.kt
│   ├── SnapshotQuery.kt
│   ├── PageTokenCodec.kt
│   ├── SnapshotStore.kt
│   └── PersistenceExceptions.kt
└── remote/                      # read-only protocol clients
    ├── RemoteClient.kt          # listing-and-metadata contract, RemoteEntry, PrecisionFinding
    ├── RemoteClientFactory.kt
    ├── FtpRemoteClient.kt       # Commons Net, passive mode, MDTM/MLSD/LIST precision
    ├── SftpRemoteClient.kt      # SSHJ, never opens a remote file
    ├── TofuHostKeyVerifier.kt   # blocking trust-on-first-use
    ├── HostKeyTrustStore.kt     # trusted-key snapshot and pending challenges
    ├── WebDavRemoteClient.kt    # OkHttp OPTIONS + PROPFIND only
    └── PropfindParser.kt

android/app/src/test/java/com/syncscope/          # Robolectric/JVM tests (bridge, credential, persistence, remote)
android/app/src/androidTest/java/com/syncscope/   # ProtocolConnectInstrumentedTest (live containers)
android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json
scripts/validation/                                # repo root derived from script location; runner-arg credentials
```

**Structure Decision**: one Android app module. Native code is grouped by responsibility in four
packages (`bridge`, `credential`, `persistence`, `remote`); JS stays presentation-only behind
`src/native/CloudSync.ts`.

## Complexity Tracking

No violations introduced by this feature. The pre-existing Principle VI version-source gap is tracked in
feature 010.
