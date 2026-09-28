# Architecture

SyncScope is a React Native Android app that reports which local files are already backed up to one
remote repository (FTP, SFTP or WebDAV), so they can be deleted from the device safely. The app never
writes to the remote: it never uploads, deletes remotely or downloads file content. Its only mutating
action is deleting local files.

This page describes the native layer as merged from M001/S01 (T01–T08). Later work expands it.

## One TurboModule boundary

`CloudSync` is the only bridge between JavaScript and native code.

- The contract is declared in TypeScript in `src/native/specs/NativeCloudSync.ts` (codegen package
  `com.syncscope.codegen`), with its DTOs and error envelopes in `src/native/CloudSyncContracts.ts`. JS
  calls it only through the typed wrapper `src/native/CloudSync.ts`.
- The Kotlin implementation is `CloudSyncModule`, registered by `CloudSyncPackage` in `MainApplication.kt`.
- JS is presentation only. Protocol clients, scanning, matching and deletion run in Kotlin.
- Every method resolves a versioned, discriminated envelope with a stable machine-readable error code and a
  redacted message. Work runs on a background dispatcher, and any throwable becomes a redacted
  `INTERNAL_ERROR` envelope, so no Kotlin exception crosses the bridge.

## Native packages

All under `android/app/src/main/java/com/syncscope/`:

| Package | Role |
| --- | --- |
| `bridge` | `CloudSyncModule` and `CloudSyncPackage`, the envelope builder (`CloudSyncEnvelope`), native contract constants (`CloudSyncContracts`), and `RepositoryOperations`, which saves, summarises and tests the repository configuration. |
| `persistence` | The Room database (`SyncScopeDatabase`), its entities and DAOs, `SnapshotStore`, snapshot queries and the opaque page-token codec. |
| `remote` | The read-only `RemoteClient` interface and its FTP, SFTP and WebDAV implementations (`RemoteClientFactory`, `PropfindParser` for WebDAV), plus SFTP host-key trust (`HostKeyTrustStore`, `TofuHostKeyVerifier`). |
| `credential` | `CredentialStore`: the repository password in `EncryptedSharedPreferences` under an Android Keystore `AES256_GCM` master key. |

## Room scan store; credentials never touch it

Scan snapshots, sources, repository configuration and trusted SFTP host keys persist natively in Room,
not in JS memory. The password never enters Room: `repository_config` refers to it only by a credential
version, and the secret itself lives in `CredentialStore`. `SchemaContractTest` fails the build if
`repository_config` gains a password, secret, ciphertext, nonce or token column, so this boundary is
enforced by a test, not by convention.

## Remote clients

Each client lists remote metadata only. `discoverPrecision()` measures the timestamp precision the server
actually delivers and reports how it was derived (`PrecisionFinding`, `PrecisionBasis`), so a weak
comparison basis stays visible to matching. An unknown SFTP host key raises a challenge that the user
approves or rejects through `approveSftpHostKey` / `rejectSftpHostKey` (trust on first use).

## Not yet implemented

13 spec methods still resolve a typed `NOT_IMPLEMENTED` envelope: `queryFiles`, `queryTreeChildren`,
`listSources`, `launchSourcePicker`, `removeSource`, `getSettings`, `setIncludeHidden`, `startScan`,
`cancelScan`, `getScanState`, `getLocalImageHandle`, `prepareLocalDeletion` and `executeLocalDeletion`.
