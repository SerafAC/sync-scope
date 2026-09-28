# S01 Research: Native CloudSync module and live protocol connect

**Depth:** Deep research. Unfamiliar-to-codebase native surface (zero Kotlin app code exists), three protocol libraries of which one is not yet in any dependency cache, a test-first persistence spec with no implementation, and validation scripts that currently point at a different repository root.

**Requirements owned:** R001 (connect FTP/SFTP/WebDAV with user+password), R002 (SFTP host-key TOFU), R003 (credentials never in Room), R004 (discovered timestamp precision), R018 (typed error envelopes). Enables R019 (`MainApplication` must register the package or nothing else in the app resolves).

---

## Summary

The slice is described in the roadmap as "fill in a pre-declared contract," but that undersells the gap on the native side. The **JavaScript half is genuinely complete and green** (17 Jest tests pass, `tsc --noEmit` clean). The **Kotlin half is empty**: `android/app/src/main/java/com/syncscope/` contains exactly two files, `MainActivity.kt` and `MainApplication.kt`, both untouched RN template. There is no `CloudSyncPackage`, no TurboModule implementation, no `RemoteClient`, and — the biggest surprise — **no Room persistence layer at all**.

Three findings dominate planning:

1. **The persistence layer is a test-first specification with zero implementation.** Six test files under `android/app/src/test/java/com/syncscope/persistence/` (599 lines) reference `SyncScopeDatabase`, 9 entity classes, 11 DAOs, `SnapshotStore`, `SnapshotQuery`, `PageTokenCodec`, and 3 exception types — none of which exist in main source. They are in the *same package*, so they compile against main source directly. **`pnpm test:android:unit` cannot compile today.** This is unimplemented scope sitting inside S01's blast radius, and the tests pin the API exactly (see "The Pinned Persistence Surface" below).

2. **Every validation script hardcodes `repo=/home/adi/projects/cloud-sync-checker`.** That directory exists and the digest-pinned Docker images are present locally, so the scripts *run* — they just build and test the **wrong repository**. `android-flow.sh` would invoke `/home/adi/projects/cloud-sync-checker/android/gradlew`, not this worktree's. Any androidTest "proof" produced before this is fixed is proof about a different codebase. A GSD hook actively blocks cross-repo reads from this worktree, confirming the boundary is real.

3. **`protocol-audit.sh` fails the build on remote content reads, not just writes.** For SFTP the forbidden pattern includes `open .*flags (READ|WRITE)` — so opening a remote file at all trips the audit, even read-only. FTP forbids `RETR` **and** `PORT|EPRT` (active mode banned → passive mandatory). WebDAV forbids `GET`, leaving only `OPTIONS`/`PROPFIND`/`HEAD`. The no-remote-download architectural rule is mechanically enforced by log audit at service teardown, and the `RemoteClient` contract must be listing-and-metadata only.

---

## Implementation Landscape

### Files that exist and constrain the work

| File | Purpose / constraint |
|---|---|
| `src/native/specs/NativeCloudSync.ts` | Codegen source of truth. 20 methods, all `Promise`-returning. `codegenConfig` in `package.json` generates `NativeCloudSyncSpec` into Java package `com.syncscope.codegen`. Do not rename methods — the boundary test asserts the spec's exact shape. |
| `src/native/CloudSyncContracts.ts` | `CLOUD_SYNC_CONTRACT_VERSION = 1`, `MAX_PAGE_SIZE = 200`, `DEFAULT_PAGE_SIZE = 50`, the `CloudSyncErrorCode` set, and `clampPageSize`. Kotlin must mirror these values exactly. |
| `src/native/CloudSync.ts` | The only permitted `TurboModuleRegistry` consumer. Uses `TurboModuleRegistry.get` (nullable), while the spec file's default export uses `getEnforcing`. |
| `src/native/__tests__/NativeCloudSyncBoundary.test.ts` | **Trap for executors.** Greps the spec for forbidden lowercased substrings including `mkdir`, `upload`, `localpath`, `rawpath`, `downloadfile`, `deleteremote`. Also scans all of `src/**` (excluding `__tests__`) and fails if `NativeModules` appears anywhere, or `TurboModuleRegistry` appears outside `CloudSync.ts` / `specs/NativeCloudSync.ts`. Any new Connect screen must go through the `CloudSync` wrapper. |
| `android/app/src/main/java/com/syncscope/MainApplication.kt` | `PackageList(this).packages.apply { }` — the marked insertion point for `add(CloudSyncPackage())`. Currently empty; this one line is the precondition for the whole milestone (R019). |
| `android/app/src/main/AndroidManifest.xml` | Has `INTERNET`. `android:usesCleartextTraffic="${usesCleartextTraffic}"` is a manifest placeholder with **no value defined in any `build.gradle`** — needs resolving, and FTP/WebDAV to `10.0.2.2` are plaintext (see Watch-outs). |
| `android/app/build.gradle` | Room 2.8.4 + KSP already wired. `ksp { arg("room.schemaLocation", "$projectDir/schemas") }` is set but `android/app/schemas/` **does not exist** — it is generated on first successful KSP run, and `SchemaContractTest` reads `schemas/com.syncscope.persistence.SyncScopeDatabase/1.json` relative to the module dir. Robolectric 4.16.1 is pinned to an offline m2 mirror in the toolchain cache. |
| `android/build.gradle` | minSdk 31, compileSdk 37, targetSdk 36, Kotlin 2.2.0, KSP 2.2.0-2.0.2, AGP 9 (`android.builtInKotlin=false`, `android.newDsl=false` opt-outs present). |
| `validation/services/compose.yaml` | Three digest-pinned services on `127.0.0.1`: sftp **32122**, webdav **32180**, ftp **32120** + passive **32200-32209**. |
| `scripts/validation/protocol-service.sh` | Generates a **random username/password per service start** into `/tmp/cloud-sync-checker-syncscope-<proto>/credentials` as `username=…\npassword=…`. Pins Docker 29.7.2 / Compose 5.5.1 exactly. |
| `scripts/validation/android-flow.sh` | Exports `SYNCSCOPE_{SFTP,WEBDAV,FTP}_CREDENTIAL_FILE` before the Gradle run — but those are **host** paths; instrumentation runs on-device and cannot read them (see Watch-outs). |
| `scripts/validation/protocol-audit.sh` | The read-only enforcement described above. Runs on `stop`, so a violation surfaces at teardown. |

### The pinned persistence surface

The existing tests require exactly this, in package `com.syncscope.persistence`:

- **`SyncScopeDatabase`** (Room `@Database`, version 1) with DAO accessors: `scanRunDao()`, `snapshotDao()`, `sourceRootDao()`, `localNodeDao()`, `remoteNodeDao()`, `remoteMatchKeyDao()`, `remoteAmbiguityDao()`, `snapshotCountsDao()`, `localDeletionOverlayDao()`, `trustedSftpHostKeyDao()`.
- **Entities with these exact constructor shapes** (from `PersistenceTestFixtures.kt` and `SchemaConstraintTest.kt`):
  - `ScanRunEntity(runId, generation, configRevision, includeHidden, phase, startedAtMillis, finishedAtMillis, terminalState, errorCode, errorSummary)`
  - `SnapshotEntity(snapshotId, scanRunId, completedAtMillis, coverage, configRevision, includeHidden, publishable)`
  - `SourceRootEntity(sourceId, treeUri, authority, volumeId, documentPath, canonicalRoot, alias, canWrite, addedAtMillis)`
  - `LocalNodeEntity(entryId, snapshotId, sourceId, parentId, kind, documentUri, documentId, name, mimeType, sizeBytes, modifiedUtcMillis, precisionMillis, status, issueCode)`
  - `RemoteMatchKeyEntity(matchKeyId, snapshotId, name, sizeBytes, precisionMillis, bucket, duplicateCount)` — positional 7-arg use appears in `SnapshotStoreTest`
  - `RemoteNodeEntity(id, snapshotId, parentId, path, name, type, depth, sizeBytes, modifiedUtcMillis, extra?)` — 10 positional args
  - `RemoteAmbiguityEntity(id, snapshotId, scope, ?, ?, ?, reason)` — 7 positional args
  - `SnapshotCountsEntity(id, snapshotId, sourceId?, status, count)`
  - `LocalDeletionOverlayEntity(id, snapshotId, localEntryId, state, atMillis)`
  - `TrustedSftpHostKeyEntity(id, host, port, algorithm, keyBase64, fingerprint, approvedAtMillis)` — **S01 owns this one**
- **`SnapshotStore(db)`** with `beginRun`, `stageSnapshot`, `stageLocalNodes`, `stageMatchKeys`, `publish(runId, generation, configRevision, terminalState, nowMillis)`, `recordFailedAttempt(runId, generation, terminalState, errorCode, summary, staleReason, nowMillis)`, `activeSnapshot()` (returns row with `snapshotId`, `staleReason`, `lastAttemptSummary`, `updatedAtMillis`), `abortAbandonedRuns(nowMillis)`, `queryFilePage(snapshotId, SnapshotQuery, pageToken)`.
- **`SnapshotQuery`** — a data class with defaults and `copy`, fields `filter/view/sort/sourceId/parentId/search/pageSize`, companion `DEFAULT_PAGE_SIZE`/`MAX_PAGE_SIZE = 200`/`MAX_SEARCH_LENGTH`, `boundedPageSize(Int?)`, `fingerprint()` (must vary on every dimension **except** `pageSize`), and `init` throwing `IllegalArgumentException` on over-long search. Requires Kotlin enums `FileFilter`, `FileView`, `FileSort`.
- **`PageTokenCodec`** object — `encode(snapshotId, queryFingerprint, sortKey, lastEntryId)`, `decode(String)`, `requireMatches(token, snapshotId, queryFingerprint)`. Token format is `v1.<base64>.<base64>…`; `decode` must reject `""`, `"not-a-token"`, `"v0.aaaa"` (wrong version), and `"v1.c25hcA==.ZnA="` (too few segments) with `PageTokenMismatchException`. Note `sortKey = "report;final.pdf"` must round-trip, so `;` is a plausible separator and needs escaping or base64 per-field.
- **Exceptions:** `PageTokenMismatchException`, `SnapshotNotFoundException`, `StaleGenerationException`.
- **Schema invariants `SchemaContractTest` asserts by name** — indexes `index_remote_match_key_snapshotId_name_sizeBytes`, `index_remote_match_key_snapshotId_name_sizeBytes_precisionMillis_bucket`, `index_local_node_snapshotId_name_sizeBytes`, `index_local_node_snapshotId_status_name`, `index_local_node_snapshotId_sourceId_parentId_kind_name`, `index_local_node_snapshotId_kind_modifiedUtcMillis`, `index_local_deletion_overlay_snapshotId_localEntryId`, `index_trusted_sftp_host_key_host_port_algorithm`, `index_source_root_canonicalRoot`, `index_scan_run_generation`, `index_snapshot_scanRunId`; FKs `local_node → snapshot` and `→ source_root`, `snapshot → scan_run`; an `active_snapshot` table; `repository_config` containing `credentialVersion` and none of password/secret/ciphertext/cipher/nonce/credential_blob/token. Cascade delete from `snapshot` must clear local_node, remote_node, remote_ambiguity, snapshot_counts, local_deletion_overlay. Wrong on-disk schema must throw `IllegalStateException` — i.e. **no `fallbackToDestructiveMigration`**.

**Planner judgement call:** S01's boundary-map deliverables need only `repository_config` + `trusted_sftp_host_key` + the Keystore credential. But Room generates one schema JSON for the whole `@Database`, and the test files are all in the compile path, so a partial entity set leaves `:app:testDebugUnitTest` red. Either (a) S01 declares the full entity/DAO set and implements `SnapshotStore`/`SnapshotQuery`/`PageTokenCodec` — larger but leaves the unit suite green; or (b) S01 declares all entities and DAOs (cheap, satisfies `SchemaContractTest` + `SchemaConstraintTest`) and defers `SnapshotStore` internals to S03, accepting that `SnapshotStoreTest`/`SnapshotQueryTest`/`PageTokenCodecTest` stay red until S03. Option (b) matches the boundary map; it needs an explicit decision about which Gradle verification command is S01's gate, because `:app:testDebugUnitTest` will not be fully green under it.

---

## Natural Seams

Roughly dependency-ordered; T1–T3 are the unblocker, T4–T6 are independent of each other.

1. **Room foundation.** Entities, DAOs, `SyncScopeDatabase`, enums, exceptions. Unblocks compilation of the whole test source set. Gate: `SchemaContractTest` + `SchemaConstraintTest`, and the generated `android/app/schemas/.../1.json` appearing.
2. **TurboModule skeleton + registration.** `CloudSyncPackage : BaseReactPackage` (overriding `getModule` and `getReactModuleInfoProvider` with `isTurboModule = true`), `CloudSyncModule : NativeCloudSyncSpec`, one `add(CloudSyncPackage())` line in `MainApplication.kt`. Every method returns a typed envelope; the not-yet-owned ones return `NOT_IMPLEMENTED`. Gate: `:app:assembleDebug`, then `TurboModuleRegistry.get('CloudSync') != null` on device. **Independent of protocol work and the highest-value unblocker for S02–S07.**
3. **Envelope + error-mapping layer.** Kotlin mirror of `contractVersion`, the `CloudSyncErrorCode` set, `MAX_PAGE_SIZE = 200`, and a `CloudSyncError(code, message, action)` builder that redacts host/user/path. R018. No exception may cross the bridge.
4. **`RemoteClient` interface + FTP client** (Commons Net 3.12.0). `connect`, `list(dir)`, per-entry name/size/mtime, `discoverPrecision()`.
5. **SFTP client + host-key TOFU** (SSHJ 0.40.0). Custom `HostKeyVerifier`, `trusted_sftp_host_key` persistence, `approveSftpHostKey`/`rejectSftpHostKey`. R002. Highest-risk single unit.
6. **WebDAV client** (OkHttp `PROPFIND`). Hand-rolled per MEM005.
7. **Credential storage.** EncryptedSharedPreferences + `credentialVersion` in `repository_config`. R003. Seam with T3 only.
8. **Repository config methods.** `saveRepository`, `getRepositorySummary`, `testRepository` wired to T4–T7.
9. **Validation-script repo-root fix.** Must land before any androidTest is trusted. Small but blocking for proof.
10. **androidTest against live containers.** The slice's actual proof. Depends on 9.

### First proof

**Seam 2 (TurboModule skeleton + `MainApplication` registration), gated by seam 1.** It is the precondition named in the boundary map for "every other slice," it is provable with `assembleDebug` plus a one-line device assertion, and it needs no protocol library, no container, and no credential plumbing. Do it before touching SSHJ.

---

## Dependencies and Libraries

| Library | Version | Status |
|---|---|---|
| Apache Commons Net (FTP) | **3.12.0** | **Already in the toolchain Gradle cache.** Use this version. |
| OkHttp (WebDAV PROPFIND) | 4.12.0 / 5.3.2 (+ `okhttp-android` 5.3.2) | **Already cached.** Prefer a cached version over a fresh resolve. |
| SSHJ (SFTP) | 0.40.0 (latest = release) | **Not in any cache.** Must be fetched; Maven Central returns 200 for the 0.40.0 POM, so the network path works. |
| BouncyCastle | many, incl. 1.80.2 / 1.81 | Cached. SSHJ makes BC optional (MEM005) but EdDSA host keys generally want it — the fixture sshd uses **ed25519** (`sshd_config` → `HostKey …ssh_host_ed25519_key`), so plan on `bcprov-jdk18on`. |
| Room / androidx.sqlite | 2.8.4 / 2.6.2 | Cached and already declared. **`room-compiler` (the KSP artifact) is *not* in the cache** — first KSP run will resolve it from network. |
| `androidx.security:security-crypto` | 1.1.0 stable available | **Not cached, not declared.** Needed for EncryptedSharedPreferences (R003). |
| `androidx.documentfile` | 1.1.0 | Not cached, not declared. S02's concern, not S01's. |

`newArchEnabled=true`, `hermesEnabled=true`, TurboModules always on in RN 0.87.

### API details worth pinning

- **`HostKeyVerifier` has two methods**, not one: `boolean verify(String hostname, int port, PublicKey key)` **and** `List<String> findExistingAlgorithms(String hostname, int port)`. A Kotlin object implementing only `verify` will not compile. Returning the persisted algorithm from `findExistingAlgorithms` is what lets SSHJ negotiate the pinned algorithm instead of silently renegotiating on key change.
- **Fingerprint format** is `SHA256:<base64>` (trailing `=` optional). `net.schmizz.sshj.transport.verification.FingerprintVerifier` / `SecurityUtils.getFingerprint` produce it. Persist the SHA256 form, and surface exactly that string in the approval prompt so the user can compare it against `ssh-keyscan` output.
- **FTP precision:** gate on `ftpClient.hasFeature("MDTM")`, then `mdtmInstant()` (returns `java.time.Instant`; format is `yyyyMMDDhhmmss` with an **optional** `.xxx`, GMT, "not all servers honor this"). Derive precision empirically from whether the returned instant carries sub-second nanos — do not assume 1000ms just because MDTM is advertised. `mlistDir()`/MLSD `modify` fact is the better-precision fallback; plain LIST parsing is the minute-granularity floor.
- **WebDAV precision is structurally 1000ms.** RFC 4918 requires `DAV:getlastmodified` in `rfc1123-date` form, which has no sub-second field. Apache `mod_dav` will not do better. Record `precisionMillis = 1000` for WebDAV and do not attempt `Win32LastModifiedTime` (a dead property the fixture does not set).
- **SFTP precision** comes from `SFTPv3`/`FileAttributes` mtime, seconds in protocol v3. The fixture deliberately provides `timestamps/bucket-start.bin` at `@1704067200.000000000` and `bucket-end.bin` at `@1704067200.999000000` — a same-second pair built to prove bucketing. Most fixture files share mtime `1704067200`.

---

## Verification

- `pnpm typecheck` and `pnpm test` — green today (17 tests); keep them green. `NativeCloudSyncBoundary.test.ts` is the guard on the JS boundary.
- `pnpm test:foundation` — `node --test scripts/validation/*.test.mjs`; `validation-infrastructure.test.mjs` asserts the image digests and the `cloud-sync-checker-validator.lock` path, so editing the scripts may require updating it in step.
- `cd android && ./gradlew :app:testDebugUnitTest` — **currently cannot compile.** Becomes the Room gate once seam 1 lands. See the judgement call above on whether it is fully green at S01 exit.
- `cd android && ./gradlew :app:assembleDebug` — gate for the TurboModule skeleton.
- `pnpm validation:services:start` → `pnpm validation:services:health` → `pnpm validation:android:api31` (`android-flow.sh connected --api 31`) → `pnpm validation:services:stop`. The `stop` step runs `protocol-audit.sh`; **teardown is part of the assertion**, so a run that passes its tests but dirties the protocol log still fails.
- Runtime registration check: `TurboModuleRegistry.get('CloudSync') != null` and `getContractVersion() === 1` from the app.
- Fixture expectations for androidTest: `flat/exact.txt`, `nested/alpha/nested.txt`, `duplicates/{a,b}/reusable.jpg` (identical size+mtime, proving duplicate collapse), `unicode/Grüße_日本_é.txt` + `unicode/é-decomposed.txt` (NFC vs NFD — name comparison must not silently normalize), `mismatch/size-mismatch.txt`, `timestamps/bucket-{start,end}.bin`, `.hidden/descendants/hidden.txt`, and `non-regular/{escape-link,named-pipe}` (a symlink pointing outside the root and a FIFO — both must be classified, not followed or hung on).

---

## Watch-outs

1. **Validation scripts build the wrong repo.** `repo=/home/adi/projects/cloud-sync-checker` in `protocol-service.sh:32`, `protocol-services.sh:6`, `android-flow.sh:19`. That path exists, so nothing errors — the gradle invocation just targets another checkout. Fix before trusting any androidTest result. `validation-infrastructure.test.mjs` also greps script contents, so keep `pnpm test:foundation` in the loop. `/tmp/cloud-sync-checker-*` state prefixes and the Robolectric/Maestro toolchain paths are separately allowlisted by `case` guards — renaming those prefixes trips `exit 64`.

2. **Credential files are host-side, instrumentation is device-side.** `android-flow.sh` exports `SYNCSCOPE_*_CREDENTIAL_FILE=/tmp/cloud-sync-checker-syncscope-*/credentials` into the *Gradle* environment. An androidTest running on the emulator cannot open those paths. The credentials are regenerated randomly on every service start, so they cannot be committed. Needs a deliberate mechanism — most likely reading the files in Gradle and passing them through as `testInstrumentationRunnerArguments`. **This is an unresolved design point the planner should assign explicitly**, not leave to an executor.

3. **Emulator host address.** `vsftpd.conf` sets `pasv_address=10.0.2.2`, the emulator's alias for the host loopback. Device-side clients must connect to `10.0.2.2:32120/32122/32180`, never `127.0.0.1`. The FTP client must use **passive** mode — `protocol-audit.sh` fails on `PORT|EPRT`.

4. **Cleartext traffic.** `usesCleartextTraffic="${usesCleartextTraffic}"` has no value defined in any `build.gradle`, and FTP control/WebDAV Basic to `10.0.2.2` are plaintext. Needs a manifest placeholder value or a `network_security_config` permitting cleartext to `10.0.2.2` — debug-only, so a release build does not ship a blanket cleartext permit.

5. **WebDAV Basic auth over cleartext** is the fixture's only auth mode (`AuthType Basic`, `AuthUserFile`). Fine against a loopback fixture; the error envelope must not echo the credential.

6. **`allowBackup="false"`** is already set, which matters for R003 — an EncryptedSharedPreferences file in a backup would defeat the Keystore boundary.

7. **The audit forbids reading remote file bodies.** SFTP `open` with any flags, FTP `RETR`, WebDAV `GET` all fail the audit. `RemoteClient` must expose listing and metadata only — no `InputStream` on a remote entry, not even behind a private helper.

8. **`fallbackToDestructiveMigration` is forbidden.** `SchemaConstraintTest.openingWrongSchemaFailsWithoutDestructiveFallback` asserts `IllegalStateException` on a mismatched on-disk schema.

9. **Docker/Compose versions are pinned to exact strings** (`29.7.2 29.7.2`, `5.5.1`). A host upgrade fails `protocol-service.sh start` with a clear message.

10. **`android/app/schemas/` does not exist yet.** `SchemaContractTest` reads it as a relative path, so it depends on the Gradle working directory being the module dir and on a prior successful KSP run. Expect the first `testDebugUnitTest` to need the schema generated in the same invocation.

11. **Unicode NFC/NFD fixtures are a deliberate trap.** Two files whose names differ only by composition. Whatever normalization the match key does (or refuses to do) should be decided here, where precision and key shape are being established, rather than discovered in S03.

---

## Don't Hand-Roll

- **The TurboModule spec class.** Codegen produces `NativeCloudSyncSpec` in `com.syncscope.codegen` from `package.json`'s `codegenConfig`. Extend it; never hand-write the JNI glue or the spec base.
- **SFTP fingerprint formatting.** Use SSHJ's `SecurityUtils.getFingerprint` / `FingerprintVerifier` rather than hashing the key yourself — matching OpenSSH's `SHA256:base64` byte-for-byte is what makes the prompt verifiable against `ssh-keyscan`.
- **FTP LIST parsing.** Commons Net's `FTPClient.listFiles()` with its `FTPFileEntryParser` handles server-dialect variance; `mlistDir()` where MLST is advertised.
- **`clampPageSize` semantics.** Mirror the existing TS implementation's exact behaviour (null/NaN/Infinity → 50, `<1` → 1, truncate, cap 200) instead of reinventing the edge cases; `SnapshotQueryTest` pins the Kotlin side to the same table.

---

## Skills

- **Installed and relevant:** none squarely on target. `.agents/skills/react-native-architecture/SKILL.md` is installed but Expo-centric (Expo Router, EAS Build, `npx expo install`) and does not address bare RN 0.87 New-Architecture TurboModules; treat it as low-signal here. `skills-lock.json` also carries `error-handling-patterns` (useful framing for the R018 envelope layer) and `mobile-android-design` (S04's concern, not S01's).
- **Gap worth filling — suggestions only, do not install:** `npx skills find "kotlin android room"`, `npx skills find "react native turbomodule new architecture"`, `npx skills find "sftp ssh host key verification"`.

## Sources

- [sshj `HostKeyVerifier`](https://github.com/hierynomus/sshj/blob/master/src/main/java/net/schmizz/sshj/transport/verification/HostKeyVerifier.java) — two-method interface
- [sshj `FingerprintVerifier`](https://github.com/hierynomus/sshj/blob/master/src/main/java/net/schmizz/sshj/transport/verification/FingerprintVerifier.java) — `SHA256:` fingerprint formats
- [Apache Commons Net `FTPClient` API](https://commons.apache.org/proper/commons-net/apidocs/org/apache/commons/net/ftp/FTPClient.html) — `hasFeature`, `mdtmInstant`, MLSD
- [RFC 4918 §15.7 `DAV:getlastmodified`](http://www.webdav.org/specs/rfc4918.html) — rfc1123-date, second precision
- [React Native New Architecture: Turbo Modules](https://github.com/reactwg/react-native-new-architecture/blob/main/docs/turbo-modules.md) — `BaseReactPackage`, `getReactModuleInfoProvider`, `isTurboModule`
- [Turbo Native Modules: Android](https://reactnative.dev/docs/next/turbo-native-modules-android)
<!-- gsd:state-version=88:0 -->
