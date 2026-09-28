# GSD context snapshot (2026-09-22T21:27:42.942Z)

## Active context
Active: M001 / S01 / T08 - androidTest proving live FTP, SFTP, and WebDAV connect against the digest-pinned containers

## Top project memories
- [MEM018] (environment) Host Docker drifted to 29.8.1 (Compose still 5.5.1) by 2026-09-21, so scripts/validation/protocol-service.sh start fails with 'Docker 29.7.2 is required.' before any container starts. The pin is also asserted by validation-infrastructure.test.mjs. Every live-container gate (validation:services:start, android-flow.sh) is blocked until the host is downgraded or the pin is deliberately bumped.
- [MEM017] (gotcha) GSD worktrees can lose gitignored setup between attempts: before any Gradle run, ensure node_modules exists (pnpm install --frozen-lockfile --prefer-offline, never a symlink since .gitignore uses `node_modules/` which does not match symlinks) and export ANDROID_HOME=$HOME/Android/Sdk (no local.properties). Unit tests need JDK 21 via the Gradle toolchain (Robolectric SDK 36).
- [MEM001] (architecture) How JavaScript and native code communicate, and where the engine lives Chose: A single CloudSync TurboModule is the entire JS-to-native API; protocol clients, scanning, matching, and deletion all run in Kotlin, and JS is presentation only. Rationale: Protocol clients are JVM libraries, so running them native avoids a JS-side socket stack and keeps thousands of file records off the bridge. The scaffold already declares the complete method surface ….
- [MEM002] (architecture) Where scan state and credentials are stored Chose: Room holds the scan store (local_node, remote_match_key, snapshot, scan_run, source_root, local_deletion_overlay, repository_config, trusted_sftp_host_key); the password goes to Android Keystore-back…. Rationale: Room databases are trivially extractable from a rooted or backed-up device. SchemaContractTest fails the build if repository_config grows a password, secret, ciphertext, cipher, nonce, credential_blo….
- [MEM003] (architecture) 
…[truncated]
