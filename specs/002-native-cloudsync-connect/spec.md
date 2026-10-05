# Feature Specification: Native CloudSync Module and Live Protocol Connect

**Feature Branch**: `002-native-cloudsync-connect`

**Created**: 2026-09-28 (transferred from milestone slice M001/S01)

**Status**: Complete

**Input**: Roadmap slice M001/S01, "Native CloudSync module and live protocol connect" (`risk:high`,
`depends:[]`). Delivered on the `milestone/M001` branch between 2026-09-21 and 2026-09-23, and merged into
`master` in merge commit `82188c4` on 2026-09-28.

**Depends on**: nothing (first feature of the v1 roadmap).

## Summary

Stand up the Kotlin half of SyncScope: a registered `CloudSync` TurboModule backed by a real Room
persistence layer, three read-only protocol clients (FTP, SFTP, WebDAV) behind one `RemoteClient`
contract, Keystore-backed credential storage, and discovered per-protocol timestamp precision. Everything
is proven by `androidTest` against the live digest-pinned validation containers, not fixtures.

## Validation evidence

The primary requirements below are marked **Validated** on the strength of two live-gate runs of
`pnpm validation:services:start && pnpm validation:services:health && pnpm validation:android:api31 && pnpm validation:services:stop`:

1. **Original delivery (2026-09-23, M001/S01/T08)**: exit 0 on API 31, 8/8 instrumented tests green, all
   three protocol audits reported a clean metadata-read allowlist with zero unexpected remote changes.
2. **Consolidation re-run (2026-09-28)**: the same chain, run on the staged, uncommitted merge of
   `milestone/M001` into `master` before merge commit `82188c4` was made. Exit 0, 8/8 instrumented tests on
   `dependency_api31(AVD) - 12`, and `ftp`, `webdav` and `sftp` audits each reported "metadata-read
   operation allowlist is clean" and "zero unexpected remote changes". `pnpm lint`, `pnpm typecheck`,
   `pnpm test:ci` (10 foundation + 17 Jest tests) and `pnpm test:android:unit` (120 JVM tests, 0 failures)
   also exited 0 on the staged merge. The full output is recorded in feature 001's transfer-verification
   checklist, section "US1 consolidation evidence (2026-09-28)".

Validation rests on the consolidation re-run: it proves the code now on `master`, not only the branch.
API 36 coverage was not run here; it belongs to feature 010 (R019, R020).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect to the repository over FTP, SFTP or WebDAV (Priority: P1)

The user enters an FTP, SFTP or WebDAV host plus username and password. The app connects to the live
server, lists the remote root read-only, and reports the protocol's discovered timestamp precision. For
SFTP it first surfaces the host-key fingerprint for explicit approval.

**Why this priority**: without a live connection there is no remote side to compare against, so nothing
else in the app works. Every later feature consumes the `CloudSync` module and the `RemoteClient`
contract this feature delivers.

**Independent Test**: the S01 live gate above. `ProtocolConnectInstrumentedTest` runs on an API 31
emulator against the digest-pinned vsftpd, OpenSSH and Apache WebDAV containers, and the protocol audit on
teardown is part of the assertion.

**Acceptance Scenarios** (from the slice demo and the slice must-haves):

1. **Given** the debug APK is installed, **When** JS calls `TurboModuleRegistry.get('CloudSync')`, **Then**
   the module resolves and `getContractVersion()` returns `1`
   (`cloudSyncPackageRegistersTheTurboModuleAndReportsContractVersion`).
2. **Given** a live FTP or WebDAV container, **When** the user saves the repository with the correct
   username and password and tests it, **Then** the connection succeeds; **and When** the password is wrong,
   **Then** a typed `AUTH_FAILED` envelope is returned, not an exception
   (`ftpConnectsThroughTheModuleAndRejectsAWrongPassword`,
   `webDavConnectsThroughTheModuleAndRejectsAWrongPassword`).
3. **Given** a live FTP, SFTP or WebDAV container with the seeded fixtures, **When** the root is listed,
   **Then** `flat/exact.txt` and `nested/alpha/nested.txt` appear with plausible size and mtime, files and
   directories are distinguished, the `duplicates/{a,b}/reusable.jpg` pair reports identical size and
   mtime, both unicode compositions appear as distinct un-normalized entries, `non-regular/escape-link` and
   `non-regular/named-pipe` are classified `OTHER` without being followed or hanging, and the
   `timestamps/bucket-start.bin` / `bucket-end.bin` pair falls in one bucket at the discovered precision
   (`ftpListingMatchesTheSeededFixtures`, `sftpListingMatchesTheSeededFixtures`,
   `webDavListingMatchesTheSeededFixtures`).
4. **Given** an SFTP server whose host key is not yet trusted, **When** the user connects, **Then** the
   connect is refused with an `SFTP_HOST_KEY_UNVERIFIED` challenge carrying a `challengeId` and an
   `SHA256:`-prefixed fingerprint; **When** the user rejects it, **Then** nothing is persisted and a retry
   re-challenges; **When** the user approves it, **Then** the key is stored and the next connect succeeds
   without a challenge (`sftpHostKeyTofuThenConnectThroughTheModule`).
5. **Given** a trusted SFTP host whose key has since changed, **When** the user connects, **Then** the
   connect fails hard with `SFTP_HOST_KEY_CHANGED` and never reconnects silently (JVM:
   `TofuHostKeyVerifierTest`, `CloudSyncHostKeyModuleTest`).
6. **Given** a completed live run, **When** `pnpm validation:services:stop` tears the containers down,
   **Then** `protocol-audit.sh` reports no FTP `RETR`/`PORT`/`EPRT` command, no SFTP `open … flags`, and no
   WebDAV `GET`, proving the client is listing-and-metadata only (R026).
7. **Given** the Android JVM test source set, **When** `pnpm test:android:unit` runs, **Then** it compiles
   and passes, including all pre-existing persistence tests (`SchemaContractTest`, `SchemaConstraintTest`,
   `SnapshotStoreTest`, `SnapshotQueryTest`, `PageTokenCodecTest`), and
   `android/app/schemas/com.syncscope.persistence.SyncScopeDatabase/1.json` contains `credentialVersion`
   in `repository_config` and no password, secret, ciphertext, cipher, nonce, credential_blob or token
   column.
8. **Given** the module, **When** any of the 13 spec methods owned by later features is called, **Then**
   it resolves a typed `NOT_IMPLEMENTED` envelope and never throws across the bridge.

### Edge Cases

- A repository root that holds only directories: FTP precision discovery walks breadth-first to the
  nearest directory with regular files (bounded at 16 directories) instead of reporting precision as
  undiscoverable.
- Apache sends the `DAV` header twice; the WebDAV client reads every value, not only the last.
- vsftpd advertises `EPRT` in its `FEAT` reply; the FTP audit scans only `FTP command:` lines so a clean run
  is not failed by a capability advertisement.
- A malformed or missing WebDAV `getlastmodified` yields a null mtime (later marked UNKNOWN), never an
  aborted listing. A truncated multistatus body is an error, never a shorter listing.
- Pending SFTP host-key challenges live in memory only (16 max, 15-minute TTL); after a restart the next
  connect asks again.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** (R001, core-capability): The app MUST connect to one remote repository over FTP, SFTP or
  WebDAV using a username and password. One remote server, one remote root and one active profile for v1.
  Libraries: SSHJ (SFTP), Apache Commons Net (FTP), hand-rolled OkHttp PROPFIND (WebDAV), per
  [D005](../../docs/decisions/0005-protocol-client-libraries.md). Without a live connection there is no
  remote side to compare against. **Validated** (consolidation live gate, 2026-09-28, merge `82188c4`).
- **FR-002** (R002, compliance/security): SFTP host keys MUST use trust-on-first-use with explicit
  approve/reject, and a changed key MUST block the connection and re-prompt, never reconnect silently, per
  [D007](../../docs/decisions/0007-sftp-host-key-tofu.md). Blind acceptance would let a spoofed listing
  drive deletion of files that were never backed up. **Validated** (consolidation live gate, 2026-09-28,
  merge `82188c4`).
- **FR-003** (R003, compliance/security): Credentials MUST never persist in Room. The password lives only
  in Android Keystore-backed storage and Room holds only `credentialVersion`; `SchemaContractTest` fails
  the build if `repository_config` grows a secret column, per
  [D002](../../docs/decisions/0002-room-scan-store-keystore-credentials.md) and
  [D013](../../docs/decisions/0013-full-persistence-layer-in-s01.md). A Room database is extractable from
  a rooted or backed-up device. **Validated** (consolidation live gate and `pnpm test:android:unit`,
  2026-09-28, merge `82188c4`).
- **FR-004** (R004, core-capability): Each protocol's actual timestamp precision MUST be discovered and
  recorded at connect time, with the basis it was derived from, rather than hardcoded, per
  [D004](../../docs/decisions/0004-discovered-timestamp-precision.md). A file matched at minute precision
  is materially weaker proof for deletion than one matched at second precision, and the user must not be
  misled about that. **Validated** (consolidation live gate, 2026-09-28, merge `82188c4`).
- **FR-005** (R018, failure-visibility): Every call across the native boundary MUST return a typed
  envelope with a stable machine-readable code and a redacted, actionable message; no exception may cross
  the bridge and no message may carry a credential, host, username or raw path, per
  [D011](../../docs/decisions/0011-typed-error-envelopes-partial-scans.md). The UI must distinguish auth
  rejection from an unreachable host to offer the right recovery. **Validated** (consolidation live gate,
  2026-09-28, merge `82188c4`).

Supporting requirements (primary FR in another feature):

- R019 (feature 010): this feature registers `CloudSyncPackage` in `MainApplication.kt`, the precondition
  for the TurboModule resolving at runtime.
- R022 (feature 010): `docs/architecture.md` and `docs/README.md` describe the modules this feature added,
  and were added in the merge commit itself.
- R026 ([scope](../../docs/scope.md)): the `RemoteClient` contract exposes no way to read remote file
  bytes, and the protocol audit enforces it.

### Key Entities

- **RepositoryConfig** (`repository_config`): protocol, host, port, username, remote root, discovered
  `precisionMillis` and `credentialVersion`. One row for v1. No secret column.
- **TrustedSftpHostKey** (`trusted_sftp_host_key`): host, port, algorithm, key, `SHA256:` fingerprint and
  approval time. Unique on (host, port, algorithm); trust is per host:port across algorithms.
- **Credential**: the password in Keystore-backed `EncryptedSharedPreferences`, referenced only by
  `credentialVersion`.
- **RemoteEntry**: name, size, modified time and type (`REGULAR_FILE`, `DIRECTORY`, `OTHER`) returned by
  a listing.
- **PrecisionFinding**: `precisionMillis` plus the basis it was derived from.
- The full scan-store schema (`scan_run`, `snapshot`, `source_root`, `local_node`, `remote_node`,
  `remote_match_key`, `remote_ambiguity`, `snapshot_counts`, `local_deletion_overlay`, `active_snapshot`)
  exists and is tested, per D013, but is populated by features 003–009.

## Provides

What this feature hands to later features (roadmap boundary map):

### To feature 003 (local source selection, M001/S01 → M001/S02)

- A registered `CloudSyncPackage` in `MainApplication.kt`, so `TurboModuleRegistry.get('CloudSync')`
  resolves at runtime. This is the precondition for every other feature.
- Real implementations of `getRepositorySummary`, `saveRepository`, `testRepository`,
  `approveSftpHostKey` and `rejectSftpHostKey`, returning typed envelopes instead of `NOT_IMPLEMENTED`.
- A `RemoteClient` Kotlin interface that puts FTP, SFTP and WebDAV behind one read-only listing contract:
  connect, list a directory, and report each entry's name, size and modified time.
- A persisted `repository_config` row plus a Keystore-backed credential, referenced only by
  `credentialVersion`.
- A discovered and recorded `precisionMillis` per configured protocol, available to the matcher.

### To feature 004 (scan engine and matching, M001/S01 → M001/S03)

- The `RemoteClient` listing contract the scan engine drives to enumerate the remote root.
- `precisionMillis` as the bucket width for mtime comparison.
- The typed error envelope vocabulary (`CloudSyncError` code, redacted message and recovery action) that
  mid-scan failures reuse to populate `issueCode`.
- A working `SnapshotStore`, `SnapshotQuery` and `PageTokenCodec` for the scan engine to populate and for
  features 005 and 008 to page through.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The S01 live gate exits 0 on API 31 with 8/8 instrumented tests and three clean protocol
  audits. Met on 2026-09-23 and again on 2026-09-28 on the staged merge.
- **SC-002**: `pnpm lint`, `pnpm typecheck`, `pnpm test:ci` and `pnpm test:android:unit` all exit 0. Met on
  2026-09-28 on the staged merge.
- **SC-003**: No remote file content is read: the FTP container log shows only `FEAT`, `LIST`, `MDTM`,
  `PASS`, `PASV`, `QUIT`, `SYST` and `USER` (observed on 2026-09-23), and every protocol audit is clean on
  both runs.

## Assumptions

- No Connect screen UI was built in this feature; it adds native modules and tests only, and the demo is
  proven through the `CloudSync` module methods such a screen calls. The connect step of the user loop is
  exercised through the UI end to end in feature 010 (R020).
- API 36 was not exercised here; API 31 is this feature's proof level, and API 36 is feature 010's
  integration closure.
- Known issues carried forward are listed in `DEVELOPMENT.md` ("Known issues from the S01 live gate"):
  the validator emulator's `-no-window` flag is unconditional, and API 36 coverage is deferred.
