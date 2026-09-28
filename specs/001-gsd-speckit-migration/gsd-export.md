# GSD Database Export

> Temporary migration export, deleted in the GSD removal commit.

Source: `.gsd/gsd.db` (SQLite), exported 2026-09-28 for feature 001-gsd-speckit-migration (task T006).

## Memories

Query: `select id, category, content, coalesce(superseded_by,'') from memories order by seq`

| ID | Category | Content | Superseded by |
| --- | --- | --- | --- |
| MEM001 | architecture | How JavaScript and native code communicate, and where the engine lives Chose: A single CloudSync TurboModule is the entire JS-to-native API; protocol clients, scanning, matching, and deletion all run in Kotlin, and JS is presentation only. Rationale: Protocol clients are JVM libraries, so running them native avoids a JS-side socket stack and keeps thousands of file records off the bridge. The scaffold already declares the complete method surface …. |  |
| MEM002 | architecture | Where scan state and credentials are stored Chose: Room holds the scan store (local_node, remote_match_key, snapshot, scan_run, source_root, local_deletion_overlay, repository_config, trusted_sftp_host_key); the password goes to Android Keystore-back…. Rationale: Room databases are trivially extractable from a rooted or backed-up device. SchemaContractTest fails the build if repository_config grows a password, secret, ciphertext, cipher, nonce, credential_blo…. |  |
| MEM003 | architecture | How a local file is determined to be synced with its remote counterpart Chose: Match on a collapsed remote_match_key of (snapshotId, name, sizeBytes, precisionMillis, bucket); local nodes look up by (name, sizeBytes) then compare mtime inside the protocol's precision bucket. Di…. Rationale: The user was explicit that duplicates on both sides are fine and what matters is that a given file is backed up somewhere: Android uses app-dependent album directories while cloud syncing flattens th…. |  |
| MEM004 | architecture | How timestamp precision is established for mtime comparison Chose: Discover and record each protocol's actual timestamp precision at connect time rather than hardcoding it; FTP uses mdtmFile() where the server advertises MDTM and degrades to LIST-parse precision oth…. Rationale: Apache Commons Net documents MDTM as yyyyMMDDhhmmss with an optional .xxx fraction and notes that not all FTP servers honor it, so FTP is second-precision at best and sometimes minute-granularity via…. |  |
| MEM005 | architecture | Which Kotlin libraries implement the FTP, SFTP, and WebDAV clients Chose: SSHJ 0.40.x for SFTP, Apache Commons Net for FTP, and a hand-rolled OkHttp PROPFIND for WebDAV. Rationale: SSHJ made Bouncy Castle optional rather than a hard dependency and landed Android compatibility work in 0.31.0; it needs Java 8+, which minSdk 31 clears. Its SSH-agent caveat requiring a Java 16+ run…. |  |
| MEM006 | architecture | How the UNKNOWN file status is treated relative to synced and unsynced Chose: UNKNOWN is a distinct, never-deletable status with its own ISSUES_UNKNOWN filter chip and an issueCode explaining why; prepareLocalDeletion refuses UNKNOWN entries outright rather than warning about …. Rationale: Deletion safety is the entire point of the app, and UNKNOWN means the remote state was genuinely never established — remote directory unreadable, listing aborted mid-scan, or timestamp precision unus…. |  |
| MEM007 | architecture | How SFTP host keys are trusted Chose: Blocking trust-on-first-use: the first connect surfaces a fingerprint challenge, approval persists to trusted_sftp_host_key, rejection aborts, and a changed key later fails the connection hard and re…. Rationale: Blind host-key acceptance makes the SFTP connection trivially interceptable, and deletion decisions based on a spoofed remote listing would destroy unbacked-up files. The scaffold already committed t…. |  |
| MEM008 | architecture | How local deletion is executed Chose: Two-phase: prepareLocalDeletion returns a plan token plus a breakdown of synced, unsynced-warned, and unknown-refused counts; executeLocalDeletion(planToken) commits with per-file outcomes written to…. Rationale: Deletion is irreversible and the whole app exists to drive it. A plan token lets the confirmation dialog show exactly what will happen and prevents a stale multi-select from deleting the wrong set. P…. |  |
| MEM009 | architecture | Scan lifecycle and how freshness is handled between sessions Chose: Foreground-only scanning with one generation-stamped scan_run per attempt; the local side re-stats automatically on app open while the remote listing stays cached until an explicit rescan, and the re…. Rationale: The user chose foreground-only with visible progress, and chose automatic local refresh because new photos are exactly the ones worth flagging. The remote listing is the expensive half and stays cach…. |  |
| MEM010 | architecture | How the three views read scan results and how the origin of a file is shown Chose: All views read one snapshot through opaque page tokens clamped to 200 — gallery flat via queryFiles, list and tree parent-scoped via queryTreeChildren; the origin badge appears in gallery only, on du…. Rationale: Thousands of files across three views need one consistent read, and page tokens rejected on snapshot, query, or sort mismatch prevent torn reads during a rescan. The user corrected an early flat-list…. |  |
| MEM011 | architecture | How failures are represented and what happens when a scan cannot complete cleanly Chose: Typed discriminated envelopes with stable machine-readable codes and redacted messages across the whole bridge; a scan never aborts wholesale — affected files become UNKNOWN with an issueCode and the…. Rationale: A partial scan that looks indistinguishable from a clean one is the worst possible outcome for an app whose output drives irreversible deletion. Typed codes let the UI distinguish auth rejection from…. |  |
| MEM012 | architecture | What counts as proof that a user-visible capability works Chose: Maestro 2.10.0 flows in validation/maestro driving the real APK on API 31 and API 36 emulators against live digest-pinned protocol containers; component tests with a mocked TurboModule are supporting…. Rationale: The user set this bar explicitly, including for deletion: a Maestro test is enough proof, and a mocked DocumentFile.delete() is not. The infrastructure already exists — android-flow.sh orchestrates c…. |  |
| MEM013 | architecture | Whether S01 implements the full Room persistence layer or only the repository_config and trusted_sftp_host_key rows its boundary map names Chose: S01 implements the complete pinned persistence surface — all 10 entities, their DAOs, SyncScopeDatabase, SnapshotQuery, PageTokenCodec, SnapshotStore, and the three exception types — so that the enti…. Rationale: Six test files under android/app/src/test/java/com/syncscope/persistence/ (582 lines) already pin this API exactly and live in the same Kotlin package as main source, so they compile against it direc…. |  |
| MEM014 | architecture | How randomly-generated, host-side protocol container credentials reach an androidTest running on the emulator Chose: android/app/build.gradle reads the SYNCSCOPE_{SFTP,WEBDAV,FTP}_CREDENTIAL_FILE paths from the Gradle environment at configuration time and forwards the parsed username/password into android.defaultCo…. Rationale: protocol-service.sh regenerates a random username/password per service start into /tmp/cloud-sync-checker-syncscope-<proto>/credentials, so the values cannot be committed. android-flow.sh exports tho…. |  |
| MEM015 | environment | Android JVM unit tests need three local prerequisites this machine did not have: an ANDROID_HOME/sdk.dir (only a root-owned /opt/android-sdk with build-tools existed, so android/local.properties now points at ~/Android/Sdk), a JDK 21+ test launcher because Robolectric refuses to sandbox SDK 36 on Java 17, and the android-all-instrumented-16-robolectric-13921718-i7 jar in the pinned Robolectric cache, which only shipped the SDK 23 artifact.</content><br><parameter name="confidence">0.9 |  |
| MEM016 | gotcha | Robolectric boots the manifest's MainApplication, whose ReactNativeApplicationEntryPoint calls SoLoader and NPEs off-device; android/app/src/test/resources/robolectric.properties pins application=android.app.Application so JVM tests never touch native loading. Also use java.util.Base64, not android.util.Base64, in main source reached from unit tests — the latter is an unmocked stub.</content><br><parameter name="confidence">0.9 |  |
| MEM017 | gotcha | GSD worktrees can lose gitignored setup between attempts: before any Gradle run, ensure node_modules exists (pnpm install --frozen-lockfile --prefer-offline, never a symlink since .gitignore uses `node_modules/` which does not match symlinks) and export ANDROID_HOME=$HOME/Android/Sdk (no local.properties). Unit tests need JDK 21 via the Gradle toolchain (Robolectric SDK 36). |  |
| MEM018 | environment | Host Docker drifted to 29.8.1 (Compose still 5.5.1) by 2026-09-21, so scripts/validation/protocol-service.sh start fails with 'Docker 29.7.2 is required.' before any container starts. The pin is also asserted by validation-infrastructure.test.mjs. Every live-container gate (validation:services:start, android-flow.sh) is blocked until the host is downgraded or the pin is deliberately bumped. |  |
| MEM019 | architecture | How strictly the validation scripts pin the host Docker version Chose: protocol-service.sh accepts any Docker 29.x client and server (major-version pin); a new major requires a deliberate bump. Compose stays pinned at 5.5.1 for now.. Rationale: The exact 29.7.2 pin broke on routine host patch updates (29.8.1) and would break for developers with slightly different setups. Container reproducibility comes from the digest-pinned images, not the…. |  |
| MEM020 | gotcha | Apache mod_dav answers OPTIONS with two DAV headers ("DAV: 1,2" and "DAV: <http://apache.org/dav/propset/fs/1>"), and OkHttp's Response.header("DAV") returns only the LAST value, which names no class. Any DAV class check must use response.headers("DAV") and flatten all values, or a perfectly good WebDAV server reads as not-WebDAV. |  |
| MEM021 | environment | The API 31 validator emulator must be launched with -no-window: agent/CI sessions have no DISPLAY, and without the flag Qt's xcb platform plugin fails fatally ("no Qt platform plugin could be initialized") and android-validator.sh reports only "Emulator or validator lock failed to start." QT_QPA_PLATFORM=offscreen gets further but still core-dumps. Also note android-validator.sh start aborts if /tmp/cloud-sync-checker-api31 survives an interrupted run, or if any emulator is still attached to adb. |  |
| MEM022 | gotcha | protocol-audit.sh must scan only vsftpd "FTP command:" lines: vsftpd answers FEAT by advertising its own capabilities, EPRT among them, on "FTP response:" lines, so an unscoped grep fails every clean run the moment a client calls FEAT. Scoping to command lines still catches a genuine RETR/PORT/EPRT command. |  |

## Task status

Query: `select id, status from tasks`

| ID | Status |
| --- | --- |
| T01 | complete |
| T02 | complete |
| T03 | complete |
| T04 | complete |
| T05 | complete |
| T06 | complete |
| T07 | complete |
| T08 | in_progress |

## Slice status

Query: `select id, status from slices`

| ID | Status |
| --- | --- |
| S01 | pending |
| S02 | pending |
| S03 | pending |
| S04 | pending |
| S05 | pending |
| S06 | pending |
| S07 | pending |
