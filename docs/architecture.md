# Architecture

SyncScope is a React Native Android app that reports which local files are already backed up to one
remote repository (FTP, SFTP or WebDAV), so they can be deleted from the device safely. The app never
writes to the remote: it never uploads, deletes remotely or downloads file content. Its only mutating
action is deleting local files.

This page describes the architecture and its key patterns. The native layer described here was merged from
M001/S01 (T01–T08); patterns owned by later features are marked as such. Each pattern links to the decision
record that holds its rationale, which this page does not repeat.

## Platform

- React Native 0.87 with the new architecture enabled, Hermes, TypeScript 6 strict, pnpm 11.3.0,
  Node 24.11.1.
- Android: minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0, KSP for Room code generation.
- UI: a navigation shell with Material Design icons and `react-native-paper` 5.15.3.

## Key patterns

| Pattern | Decision |
| --- | --- |
| One native TurboModule is the entire JS-to-native API | [D001](./decisions/0001-single-cloudsync-turbomodule.md) |
| Room is the scan store; secrets never touch it | [D002](./decisions/0002-room-scan-store-keystore-credentials.md), [D013](./decisions/0013-full-persistence-layer-in-s01.md) |
| Matching ignores directory structure | [D003](./decisions/0003-directory-agnostic-sync-matching.md) |
| Timestamp precision is discovered, not assumed | [D004](./decisions/0004-discovered-timestamp-precision.md) |
| Snapshot-scoped opaque paging, clamped to 200 | [D010](./decisions/0010-snapshot-paging-and-origin-badge.md) |
| Two-phase deletion | [D008](./decisions/0008-two-phase-local-deletion.md) |
| Typed envelopes; partial scans stay visibly partial | [D011](./decisions/0011-typed-error-envelopes-partial-scans.md) |
| Verification against real servers, not mocks | [D012](./decisions/0012-maestro-e2e-proof-bar.md) |

### One TurboModule boundary

`CloudSync` is the only bridge between JavaScript and native code
([D001](./decisions/0001-single-cloudsync-turbomodule.md)).

- The contract is declared in TypeScript in `src/native/specs/NativeCloudSync.ts` (codegen package
  `com.syncscope.codegen`), with its DTOs and error envelopes in `src/native/CloudSyncContracts.ts`. JS
  calls it only through the typed wrapper `src/native/CloudSync.ts`; there is no ad hoc native access
  elsewhere.
- The Kotlin implementation is `CloudSyncModule`, registered by `CloudSyncPackage` in `MainApplication.kt`.
- JS is presentation only. Protocol clients, scanning, matching and deletion run in Kotlin.
- Every method resolves a versioned, discriminated envelope with a stable machine-readable error code and a
  redacted message ([D011](./decisions/0011-typed-error-envelopes-partial-scans.md)). Work runs on a
  background dispatcher, and any throwable becomes a redacted `INTERNAL_ERROR` envelope, so no Kotlin
  exception crosses the bridge. The Kotlin and TypeScript error-code lists are kept in the same order, and a
  parity test compares them.

### Room scan store; credentials never touch it

Scan snapshots, sources, repository configuration and trusted SFTP host keys persist natively in Room, not
in JS memory ([D002](./decisions/0002-room-scan-store-keystore-credentials.md)). The schema covers
`local_node`, `remote_match_key`, `snapshot`, `scan_run`, `source_root`, `local_deletion_overlay`,
`repository_config` and `trusted_sftp_host_key`, with the match and paging indexes asserted by tests. The
full persistence surface — entities, DAOs, `SyncScopeDatabase`, `SnapshotQuery`, `PageTokenCodec`,
`SnapshotStore` and the persistence exceptions — landed together
([D013](./decisions/0013-full-persistence-layer-in-s01.md)). Exported schemas under `android/app/schemas/`
are reviewed source for migrations, and a mismatched on-disk schema fails rather than falling back to a
destructive migration.

The password never enters Room: `repository_config` refers to it only by `credentialVersion`, and the
secret itself lives in `CredentialStore` (Android Keystore-backed `EncryptedSharedPreferences`,
`AES256_GCM` master key).

**Enforced by `SchemaContractTest`.** The test reads the exported Room schema and fails the build if
`repository_config` gains a password, secret, ciphertext, cipher, nonce, credential_blob or token column, so
the credential boundary is enforced by a test, not by convention. The manifest also sets
`allowBackup="false"`, so the encrypted preferences never leave the device in a backup.

### Matching ignores directory structure

A collapsed `remote_match_key` on `(snapshotId, name, sizeBytes, precisionMillis, bucket)` turns sync
determination into an indexed exact lookup. Android album layouts and cloud-flattened remote layouts are
never expected to line up ([D003](./decisions/0003-directory-agnostic-sync-matching.md)). The precision
feeding `precisionMillis` is measured per server at connect time
([D004](./decisions/0004-discovered-timestamp-precision.md)); see [protocols](./protocols.md) and
[sync and deletion safety](./sync-and-deletion-safety.md).

### Snapshot-scoped opaque paging, clamped to 200

All three views read one consistent snapshot ([D010](./decisions/0010-snapshot-paging-and-origin-badge.md)):

- `queryFiles` is flat, for the gallery.
- `queryTreeChildren` is parent-scoped, for list and tree.
- Page tokens are opaque (`PageTokenCodec`) and are rejected on snapshot, query or sort mismatch, which
  prevents torn reads during a rescan.
- Page size is clamped to `MAX_PAGE_SIZE = 200` on both sides. `clampPageSize` in TypeScript and its Kotlin
  mirror share the same edge cases (null, NaN or Infinity → 50; below 1 → 1; truncate; cap 200), and
  `SnapshotQueryTest` pins the Kotlin side to the same table.

### Two-phase deletion

`prepareLocalDeletion` returns a plan token plus an honest breakdown; `executeLocalDeletion` commits with
per-file outcomes into `local_deletion_overlay`, recording successes only
([D008](./decisions/0008-two-phase-local-deletion.md)). UNKNOWN entries are refused outright
([D006](./decisions/0006-unknown-status-never-deletable.md)). Both methods are declared in the contract and
are delivered by feature 007.

### Verification against real servers, not mocks

Robolectric + Room for unit logic, `androidTest` against live containers for protocol clients, and Maestro on
real emulators for every user-visible claim ([D012](./decisions/0012-maestro-e2e-proof-bar.md)). See
[Validation infrastructure](#validation-infrastructure).

## Native packages

All under `android/app/src/main/java/com/syncscope/`:

| Package | Role |
| --- | --- |
| `bridge` | `CloudSyncModule` and `CloudSyncPackage`, the envelope builder (`CloudSyncEnvelope`), native contract constants (`CloudSyncContracts`), and `RepositoryOperations`, which saves, summarises and tests the repository configuration. |
| `persistence` | The Room database (`SyncScopeDatabase`), its entities and DAOs, `SnapshotStore`, snapshot queries and the opaque page-token codec. |
| `remote` | The read-only `RemoteClient` interface and its FTP, SFTP and WebDAV implementations (`RemoteClientFactory`, `PropfindParser` for WebDAV), plus SFTP host-key trust (`HostKeyTrustStore`, `TofuHostKeyVerifier`). |
| `credential` | `CredentialStore`: the repository password in `EncryptedSharedPreferences` under an Android Keystore `AES256_GCM` master key. |

## Remote clients

Each client lists remote metadata only; the `RemoteClient` interface has no byte-reading surface, which
enforces R026 by construction. `discoverPrecision()` measures the timestamp precision the server actually
delivers and reports how it was derived (`PrecisionFinding`, `PrecisionBasis`), so a weak comparison basis
stays visible to matching. An unknown SFTP host key raises a challenge that the user approves or rejects
through `approveSftpHostKey` / `rejectSftpHostKey` (trust on first use,
[D007](./decisions/0007-sftp-host-key-tofu.md)). Library choices are in
[D005](./decisions/0005-protocol-client-libraries.md); per-protocol behaviour is in
[protocols](./protocols.md).

## Repository layout

| Path | Contents |
| --- | --- |
| `App.tsx`, `index.js` | App entry point. |
| `src/native/` | The TurboModule spec, contracts and typed client, with their Jest tests in `src/native/__tests__/` (including `NativeCloudSyncBoundary.test.ts`, the guard on the JS boundary). |
| `src/navigation/`, `src/screens/` | The navigation shell and placeholder screens. |
| `android/app/src/main/java/com/syncscope/` | `MainActivity`, `MainApplication` and the native packages above. |
| `android/app/src/test/` | JVM unit tests (Robolectric + Room), including the persistence contract tests and `robolectric.properties`. |
| `android/app/src/androidTest/` | Instrumented tests, including `ProtocolConnectInstrumentedTest` against the live containers. |
| `scripts/validation/` | Container, emulator, fixture and audit orchestration, with its `node --test` suites. |
| `validation/services/` | The Compose file and server configs for the protocol containers. |

## Validation infrastructure

The validation stack proves behaviour against real servers and real emulators.

- **Protocol containers.** `validation/services/compose.yaml` runs digest-pinned FTP (vsftpd), SFTP
  (OpenSSH) and WebDAV (Apache `mod_dav`) images on `127.0.0.1`, serving a read-only fixture tree.
  `scripts/validation/protocol-service.sh` and `protocol-services.sh` start, health-check and stop them
  (`pnpm validation:services:start`, `:health`, `:stop`). They generate fresh random credentials on every
  start, and require Docker 29.x and Compose 5.5.1
  ([D015](./decisions/0015-docker-major-version-pin.md)).
- **Fixtures.** `fixture-seed.sh` and `fixture-manifest.sh` seed and describe the fixture tree: flat and
  nested files, a duplicates pair with identical size and mtime, NFC/NFD unicode names, a size mismatch, a
  same-second timestamp bucket pair, hidden files, and non-regular entries (a symlink escaping the root and
  a FIFO).
- **Read-only audit.** Stopping the services runs `protocol-audit.sh` over each server's log, so teardown is
  part of the assertion: a run that passes its tests but performed a forbidden operation still fails. See
  [protocols](./protocols.md#the-read-only-guarantee).
- **Emulator orchestration.** `android-flow.sh` and `android-validator.sh` boot the API 31 or API 36
  emulator, install the APK and run the instrumented tests (`pnpm validation:android:api31`,
  `pnpm validation:android:api36`) or Maestro flows (`pnpm e2e:android`). `android-sdk.sh` resolves
  `ANDROID_HOME`.
- **Credentials to the device.** Gradle forwards the per-run container credentials into
  `testInstrumentationRunnerArguments`, and the emulator reaches the host at `10.0.2.2`
  ([D014](./decisions/0014-container-credentials-via-runner-args.md)).
- **Script tests.** `pnpm test:foundation` (`node --test scripts/validation/*.test.mjs`) asserts the image
  digests, version pins and script contracts.

The full live gate for the native layer is:

```sh
pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop
```

Environment prerequisites and known pitfalls are in [DEVELOPMENT.md](../DEVELOPMENT.md#environment-gotchas).

## Not yet implemented

13 spec methods still resolve a typed `NOT_IMPLEMENTED` envelope: `queryFiles`, `queryTreeChildren`,
`listSources`, `launchSourcePicker`, `removeSource`, `getSettings`, `setIncludeHidden`, `startScan`,
`cancelScan`, `getScanState`, `getLocalImageHandle`, `prepareLocalDeletion` and `executeLocalDeletion`.
`validation/maestro/` does not exist yet; the first feature that needs a flow creates it.
