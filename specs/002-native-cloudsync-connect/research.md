# Research: Native CloudSync Module and Live Protocol Connect

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

This file carries forward the research done before milestone slice M001/S01 was built, the parts of the
milestone discussion record that still apply, and the key decisions recorded as each task finished.
Decisions that became project-wide are linked to `docs/decisions/` rather than restated.

**Requirements owned**: R001, R002, R003, R004, R018. **Enables**: R019 (`MainApplication` must register
the package or nothing else in the app resolves).

## Findings from the pre-build research

1. **The persistence layer was a test-first specification with no implementation.** Six test files under
   `android/app/src/test/java/com/syncscope/persistence/` referenced `SyncScopeDatabase`, the entity
   classes, the DAOs, `SnapshotStore`, `SnapshotQuery`, `PageTokenCodec` and three exception types, none
   of which existed. They share the main source package, so `pnpm test:android:unit` could not compile.
   Resolved by [D013](../../docs/decisions/0013-full-persistence-layer-in-s01.md): implement the whole
   pinned surface.
2. **The validation scripts built the wrong repository.** `android-flow.sh`, `protocol-service.sh` and
   `protocol-services.sh` hardcoded `repo=/home/adi/projects/cloud-sync-checker`. That path existed, so
   nothing errored; the Gradle run simply tested another checkout. Fixed in T007 by deriving the repo root
   from each script's own location.
3. **`protocol-audit.sh` fails the build on remote content reads, not only writes.** SFTP forbids
   `open .*flags (READ|WRITE)`, FTP forbids `RETR` and `PORT|EPRT` (so passive mode is mandatory), and
   WebDAV forbids `GET`, leaving `OPTIONS`/`PROPFIND`/`HEAD`. The `RemoteClient` contract must therefore be
   listing-and-metadata only (R026).
4. **Container credentials are host-side, instrumentation is device-side.** `protocol-service.sh`
   generates random credentials per start into `/tmp/cloud-sync-checker-syncscope-<proto>/credentials`,
   which the emulator cannot read. Resolved by
   [D014](../../docs/decisions/0014-container-credentials-via-runner-args.md): Gradle reads the files and
   passes them as instrumentation runner arguments.
5. **The cleartext manifest placeholder had no value.** `usesCleartextTraffic="${usesCleartextTraffic}"`
   was undefined, and FTP control and WebDAV Basic to `10.0.2.2` are plaintext. Resolved in T002 per build
   type: `true` for debug, `false` for release and by default.
6. **Precision differs structurally by protocol.** FTP MDTM returns `yyyyMMDDhhmmss` with an *optional*
   fraction and "not all FTP servers honor this", so precision must be measured; MLSD `modify` is the
   better fallback and LIST parsing is the minute floor. SFTP v3 `FileAttributes` mtime is whole seconds.
   WebDAV `DAV:getlastmodified` is an RFC 1123 date (RFC 4918 §15.7) with no sub-second field, so 1000 ms
   is structural. See [D004](../../docs/decisions/0004-discovered-timestamp-precision.md) and
   `docs/protocols.md`.
7. **Unicode NFC/NFD fixtures are a deliberate trap.** Two fixture names differ only by composition. The
   clients must not normalize names silently, so that feature 004's match key knows which composition
   arrives.
8. **`fallbackToDestructiveMigration` is forbidden.** `SchemaConstraintTest` asserts
   `IllegalStateException` on a mismatched on-disk schema.

### Libraries

| Library | Version | Note |
| --- | --- | --- |
| Apache Commons Net (FTP) | 3.12.0 | Already cached locally |
| OkHttp (WebDAV PROPFIND) | cached 4.x/5.x | Prefer a cached version |
| SSHJ (SFTP) | 0.40.0 | Resolved from Maven Central |
| BouncyCastle `bcprov-jdk18on` | 1.80.2 | The fixture's ed25519 host key needs it for EdDSA |
| Room / KSP | 2.8.4 | `room-compiler` resolved from network on first KSP run |
| `androidx.security:security-crypto` | 1.1.0 | For `EncryptedSharedPreferences` (R003) |

Library choices and rejected alternatives (JSch, Sardine) are recorded in
[D005](../../docs/decisions/0005-protocol-client-libraries.md).

### Don't hand-roll

- The TurboModule spec base class: codegen produces `NativeCloudSyncSpec` in `com.syncscope.codegen`.
- FTP LIST parsing: use Commons Net's `listFiles()` / `mlistDir()`.
- `clampPageSize` semantics: mirror the TS behaviour exactly (null/NaN/Infinity → 50, `<1` → 1, truncate,
  cap 200).

## Milestone discussion context that still applies

The milestone discussion (2026-09-20) set constraints this feature relied on and that later features still
inherit:

- **Deletion-safety framing**: sync status is a deletion-safety signal, not a backup dashboard. A weak or
  partial result must never look like a clean one.
- **Architecture**: one TurboModule as the only JS↔native API
  ([D001](../../docs/decisions/0001-single-cloudsync-turbomodule.md)); Room as the scan store with secrets
  outside it ([D002](../../docs/decisions/0002-room-scan-store-keystore-credentials.md)); blocking SFTP
  TOFU ([D007](../../docs/decisions/0007-sftp-host-key-tofu.md)); verification against real servers, not
  mocks.
- **Error handling defaults** ([D011](../../docs/decisions/0011-typed-error-envelopes-partial-scans.md)):
  typed envelopes everywhere; connection failures fail fast with no automatic retry on auth; bounded
  backoff (3 attempts) for transient network errors only; `NATIVE_MODULE_UNAVAILABLE` renders a hard error
  screen with no mock fallback.
- **Scaffold boundary to preserve**: no secret getters, no remote mutation, no remote file-content
  download, and no raw local path operation across the bridge. `NativeCloudSyncBoundary.test.ts` enforces
  it on the JS side.
- **Residual risk (closed)**: whether SSHJ negotiates the fixture's algorithms without BouncyCastle. It
  needed `bcprov-jdk18on`, which was a dependency line, not a redesign.

## Key decisions recorded per task

### T001 (M001/S01/T01): Room persistence layer

- **Decision**: fix the verification gate's missing SDK location with a git-ignored
  `android/local.properties` (`sdk.dir`) rather than relying on `ANDROID_HOME`.
- **Rationale**: the gate shell does not inherit `ANDROID_HOME`.
- **Alternatives**: exporting `ANDROID_HOME` in every gate invocation; see `DEVELOPMENT.md` (MEM015,
  MEM017).

### T002 (M001/S01/T02): TurboModule skeleton and envelope layer

- **Decision**: module methods never reject. `runOperation`/`runPage` wrap each block, catch `Throwable`
  and resolve a redacted `INTERNAL_ERROR` envelope; page methods keep the `FilePageResultDto` shape
  (`page: null`). Later tasks replace only the block they pass in.
  **Rationale**: no exception may cross the bridge (R018). **Alternatives**: per-method try/catch, which
  repeats the rule 18 times.
- **Decision**: `CloudSyncEnvelope` takes injectable map/array factories (default `Arguments.*`).
  **Rationale**: envelope and module logic become JVM-testable with `JavaOnlyMap`, without JNI.
  **Alternatives**: testing only on device.
- **Decision**: `redact()` takes an optional list of sensitive values (configured host, username, root)
  that are stripped verbatim before the regex passes. **Rationale**: regexes alone cannot know which
  strings are the user's. **Alternatives**: regex-only redaction.
- **Decision**: `defaultConfig` sets `usesCleartextTraffic=false`, so any build type that does not opt in
  denies cleartext. **Rationale**: a future build type cannot ship a blanket cleartext permit by accident.
  **Alternatives**: set it only on release.

### T003 (M001/S01/T03): RemoteClient contract and FTP client

- **Decision**: remote failures are thrown as `RemoteClientException` carrying a `CloudSyncErrorCode` and a
  fixed, host-free message; the module maps them to coded envelopes before the `INTERNAL_ERROR` fallback.
  SFTP and WebDAV reuse the same codes. **Rationale**: one mapping point, and messages are safe by
  construction. **Alternatives**: free-form messages redacted later.
- **Decision**: precision is empirical; the finest MDTM/MLSD sample wins across up to five files. LIST
  precision takes the coarsest sample's granularity (a year-form line gives 86 400 000 ms), floored at
  60 000 ms. **Rationale**: old files listed by date only must not be falsely compared at minute width.
  **Alternatives**: assume 1000 ms whenever MDTM is advertised.
- **Decision**: `RemoteEntry.sizeBytes` passes through `FTPFile.getSize()`, which is -1 when the server
  reports no size. **Rationale**: an unknown size stays visibly unknown. **Alternatives**: coerce to 0.

### T004 (M001/S01/T04): SFTP client and host-key TOFU

- **Decision**: the verifier decides against a pre-loaded snapshot of trusted rows
  (`HostKeyTrustStore.verifierFor`), so SSHJ's transport thread does no database I/O; a refusal is recorded
  on `verifier.rejection` and read after SSHJ's generic transport failure. **Rationale**: no blocking DB
  work on the transport thread. **Alternatives**: query Room inside `verify()`.
- **Decision**: trust is per host:port across algorithms. A key of any other algorithm for a trusted
  endpoint is `SFTP_HOST_KEY_CHANGED`, not a first contact. Approval goes through `replaceEndpointKey`,
  which reuses the row id and drops other-algorithm rows. **Rationale**: an attacker cannot bypass a
  pinned key by offering a different algorithm, and superseded keys never verify again.
  **Alternatives**: trust per (host, port, algorithm) only.
- **Decision**: `UNVERIFIED` is returned as `ConnectOutcome.HostKeyApprovalRequired(challenge)`; `CHANGED`
  is thrown as `SftpHostKeyException`. Both render the same structured `error.hostKeyChallenge` with
  host-free message text. **Rationale**: first contact is an expected outcome, a changed key is a failure.
  **Alternatives**: throw both.
- **Decision**: pending challenges are in memory only (16 max, 15-minute TTL, newest per endpoint).
  **Rationale**: after a restart the next connect simply asks again. **Alternatives**: persist challenges.
- **Decision**: the `SHA256:` fingerprint is built from SSHJ's wire blob and self-verified with SSHJ's
  `FingerprintVerifier`, because `SecurityUtils.getFingerprint` only yields MD5; parity with `ssh-keygen`
  is asserted in a test. **Rationale**: the prompt must match OpenSSH byte for byte.
  **Alternatives**: MD5 fingerprints.

### T005 (M001/S01/T05): WebDAV client

- **Decision**: OkHttp redirects are disabled, and collection URLs always end in a trailing slash.
  **Rationale**: OkHttp turns a redirected `OPTIONS` into a `GET`, which the audit fails even for reads.
  **Alternatives**: follow redirects.
- **Decision**: a truncated or unclosed multistatus body is an error (`SERVER_ERROR`), never a shorter
  listing; the parser requires the `DAV:multistatus` root to close. **Rationale**: the platform parser
  accepts EOF with unclosed tags, and a silently short listing would look clean. **Alternatives**: accept
  partial bodies.
- **Decision**: `REMOTE_ROOT_NOT_FOUND` and `SERVER_ERROR` were added to `CloudSyncErrorCode` in Kotlin and
  TS in the same order. A 404 is `REMOTE_ROOT_NOT_FOUND` only for connect or root requests; a 404 on a
  subdirectory is `DIRECTORY_UNREADABLE`. **Rationale**: the UI offers different recovery for each.
  **Alternatives**: one generic not-found code.
- **Decision**: WebDAV precision is structural: 1000 ms with `PrecisionBasis.RFC1123_WHOLE_SECONDS`, no
  network probe, and `Win32LastModifiedTime` is not consulted. **Rationale**: RFC 4918 allows no better.
  **Alternatives**: probe a dead property the fixture does not set.
- **Decision**: calls use `enqueue` plus `suspendCancellableCoroutine`, parsing bodies on OkHttp's
  callback thread. **Rationale**: coroutine cancellation aborts an in-flight listing through
  `call.cancel()`. **Alternatives**: blocking `execute()`.

### T006 (M001/S01/T06): credential storage and repository methods

- **Decision**: payload-carrying ok envelopes nest data under a named key (`connection` for
  `testRepository`, `repository` for `getRepositorySummary`). `OperationResultDto`'s TS type still declares
  only `contractVersion`/`status`/`error`, so the first UI that reads these must widen it.
  **Rationale**: keeps the envelope shape stable. **Alternatives**: flat payload fields.
- **Decision**: a null `transientPassword` on save reuses the stored credential only for an identical
  protocol/host/port/username whose credential version is still current; any other account requires a
  password. **Rationale**: a credential never silently follows a changed endpoint.
  **Alternatives**: always require the password.
- **Decision**: precision is persisted with a revision-guarded `UPDATE`, and `precisionMillis` 0 means
  unknown and is reported to JS as null. **Rationale**: a test racing a save never writes precision onto
  a different endpoint. **Alternatives**: unconditional update.
- **Decision**: `CredentialStore` is injectable over a `SharedPreferences` factory. **Rationale**:
  Keystore-backed `EncryptedSharedPreferences` cannot run under Robolectric, so JVM tests exercise the
  same version logic over plain preferences. **Alternatives**: device-only tests.

### T007 (M001/S01/T07): validation scripts and runner-argument credentials

- **Decision**: instrumentation argument keys are `<proto>User` / `<proto>Password` with proto in
  `sftp`, `ftp`, `webdav`; a protocol is added only when both are present. **Rationale**: tests can treat
  an absent key as "container not provisioned". **Alternatives**: always add keys, possibly empty.
- **Decision**: leave the exact Docker version pin untouched in this task. **Rationale**: it was a
  deliberate environment guard outside the task's allowed edits. It was later relaxed to a major-version
  pin by [D015](../../docs/decisions/0015-docker-major-version-pin.md).

### T008 (M001/S01/T08): live androidTest

- **Decision**: a DAV class check reads every `DAV` header value (`response.headers("DAV")`), not
  `response.header("DAV")`. **Rationale**: Apache sends the header twice and OkHttp's single-value accessor
  keeps only the last, which names no class. **Alternatives**: none viable. See `docs/protocols.md`.
- **Decision**: FTP precision discovery descends breadth-first to the nearest directory holding regular
  files, bounded at 16 directories. **Rationale**: a repository root commonly holds only folders, and
  sampling only the root left precision permanently undiscovered. **Alternatives**: sample only the root.
- **Decision**: `protocol-audit.sh` scans only vsftpd `FTP command:` lines for the FTP forbidden set.
  **Rationale**: vsftpd's `FEAT` reply advertises `EPRT` on a response line; scoping keeps detection of
  genuine `RETR`/`PORT`/`EPRT` commands. **Alternatives**: unscoped grep, which fails every clean run.
- **Decision**: the validator emulator launches with `-no-window`. **Rationale**: agent and CI sessions have
  no `DISPLAY`, and Qt's xcb plugin aborts the emulator with an error the validator can only report as a
  generic lock failure. **Alternatives**: `QT_QPA_PLATFORM=offscreen`, which still crashed.
- **Decision**: `protocol-service.sh stop` succeeds as a no-op when no owned state and no running project
  remain; a project running without its state is still refused. **Rationale**: the gate's trailing
  `services:stop` must not fail after `android-flow.sh` has already torn down what it started.
  **Alternatives**: drop the trailing stop from the gate.
