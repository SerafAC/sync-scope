---

description: "Task list for feature 002 (native CloudSync module and live protocol connect), transferred complete"
---

# Tasks: Native CloudSync Module and Live Protocol Connect

**Input**: Design documents from `/specs/002-native-cloudsync-connect/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md)

**Status**: All tasks are complete. They were built on the `milestone/M001` branch between 2026-09-21 and
2026-09-23 and reached `master` in merge commit `82188c4` on 2026-09-28. Each task carries its milestone
trace `(M001/S01/Txx)` and the commit(s) on `milestone/M001` that delivered it. There are no open tasks.

**Tests**: each task shipped its own JVM tests; T008 is the live `androidTest` gate.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[Story]**: the user story the task belongs to (US1 in [spec.md](./spec.md)).

---

## Phase 1: Foundational (blocking prerequisites)

- [X] T001 [US1] Implement the Room persistence layer pinned by the existing test suite: all ten entities
  with the exact constructor shapes the tests use, their DAOs, `SyncScopeDatabase` (version 1, exported
  schema, no destructive fallback), `SnapshotQuery`, `PageTokenCodec`, `SnapshotStore` and the three
  exception types, in `android/app/src/main/java/com/syncscope/persistence/`, plus the exported schema
  `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json` (per
  [D013](../../docs/decisions/0013-full-persistence-layer-in-s01.md)).
  `(M001/S01/T01)` Commit: `7c4d394`.
  Verify: `:app:testDebugUnitTest` compiles and passes; the schema JSON has `credentialVersion` and no
  password column.
- [X] T002 [US1] Register the CloudSync TurboModule: `CloudSyncModule` over the codegen
  `NativeCloudSyncSpec`, `CloudSyncPackage`, the `CloudSyncContracts` Kotlin mirror, the
  `CloudSyncEnvelope` layer with `redact()`, `add(CloudSyncPackage())` in `MainApplication.kt`, and the
  per-build-type `usesCleartextTraffic` placeholder in `android/app/build.gradle`. Every method resolves a
  typed envelope and none throws across the bridge.
  `(M001/S01/T02)` Commit: `ca9dd60`.
  Verify: `:app:assembleDebug` succeeds; `CloudSyncEnvelopeTest`, `CloudSyncContractsParityTest` and
  `CloudSyncModuleTest` pass.

---

## Phase 2: User Story 1 — Connect to the repository over FTP, SFTP or WebDAV (Priority: P1)

**Goal**: three read-only protocol clients behind one `RemoteClient` contract, Keystore-backed
credentials, and the five real repository and host-key bridge methods, proven against live containers.

**Independent Test**: the live gate in T008.

- [X] T003 [US1] Define the listing-and-metadata-only `RemoteClient` contract (`RemoteEntry`,
  `PrecisionFinding`) and implement `FtpRemoteClient` over Commons Net 3.12.0 in passive mode, with
  empirically measured precision (MDTM, then MLSD `modify`, then the LIST minute floor) in
  `android/app/src/main/java/com/syncscope/remote/`.
  `(M001/S01/T03)` Commit: `9500a9c`.
  Verify: `FtpPrecisionTest` passes; `RemoteClient.kt` has no `InputStream`; `FtpRemoteClient.kt` has no
  `retrieveFile` and calls `enterLocalPassiveMode`.
- [X] T004 [US1] Implement `SftpRemoteClient` over SSHJ 0.40.0 (never opening a remote file) and the
  blocking trust-on-first-use `TofuHostKeyVerifier` with `HostKeyTrustStore`, plus real
  `approveSftpHostKey` / `rejectSftpHostKey` on `CloudSyncModule` (per
  [D007](../../docs/decisions/0007-sftp-host-key-tofu.md)).
  `(M001/S01/T04)` Commit: `3001c5d`.
  Verify: `TofuHostKeyVerifierTest`, `SftpRemoteClientTest` and `CloudSyncHostKeyModuleTest` pass.
- [X] T005 [US1] Implement `WebDavRemoteClient` as hand-rolled OkHttp `OPTIONS` + `PROPFIND` only, with
  `PropfindParser` and structural 1000 ms precision (per
  [D005](../../docs/decisions/0005-protocol-client-libraries.md)).
  `(M001/S01/T05)` Commit: `a01bb64`.
  Verify: `PropfindParserTest` passes; `WebDavRemoteClient.kt` issues no `MKCOL` or `GET`.
- [X] T006 [US1] Implement Keystore-backed `CredentialStore` (`EncryptedSharedPreferences`,
  `credentialVersion`), `RemoteClientFactory`, and real `saveRepository`, `testRepository` and
  `getRepositorySummary` in `RepositoryOperations.kt` (per
  [D002](../../docs/decisions/0002-room-scan-store-keystore-credentials.md)).
  `(M001/S01/T06)` Commit: `bb37998`.
  Verify: `RepositoryConfigBoundaryTest` and `SchemaContractTest` pass; `Entities.kt` has no password
  column.
- [X] T007 [US1] Derive the repository root in `scripts/validation/android-flow.sh`,
  `protocol-service.sh` and `protocol-services.sh` from each script's own location, and pass the container
  credentials to the device as instrumentation runner arguments in `android/app/build.gradle` (per
  [D014](../../docs/decisions/0014-container-credentials-via-runner-args.md)).
  `(M001/S01/T07)` Commit: `f331aad`.
  Verify: `pnpm test:foundation` passes; no script assigns the old hardcoded repository path;
  `build.gradle` sets `testInstrumentationRunnerArguments`.
- [X] T008 [US1] Write `android/app/src/androidTest/java/com/syncscope/ProtocolConnectInstrumentedTest.kt`
  proving live FTP, SFTP and WebDAV connect, listings, host-key TOFU, measured precision and TurboModule
  registration against the digest-pinned containers, and fix what the live run exposed: the WebDAV
  multi-value `DAV` header, FTP precision that never sampled, the FTP audit false positive, the headless
  emulator (`-no-window`), idempotent `services:stop`, and the unset `ANDROID_HOME` in the validation
  scripts.
  `(M001/S01/T08)` Commits: `8e38f68`, `c04b121`, `16d75ac`.
  Evidence:
  1. Live gate exit 0 on API 31, 8/8 instrumented tests, three protocol audits clean, 2026-09-23.
  2. Consolidation re-run on 2026-09-28, on the staged merge of `milestone/M001` into `master` before
     merge commit `82188c4`: the same chain
     (`pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`)
     exited 0 with 8/8 instrumented tests and three clean protocol audits (zero unexpected remote
     changes). Recorded in feature 001's transfer-verification checklist, section "US1 consolidation
     evidence (2026-09-28)".

**Checkpoint**: R001, R002, R003, R004 and R018 are validated (see [spec.md](./spec.md)).

---

## Dependencies & Execution Order

- T001 and T002 came first: T001 made the JVM test source set compile, and T002 is the precondition for
  every later feature.
- T003 defined the `RemoteClient` contract that T004 and T005 implement.
- T006 depends on T003–T005 (it builds the right client per protocol).
- T008 depends on T007: before T007, a connected run tested another checkout.
