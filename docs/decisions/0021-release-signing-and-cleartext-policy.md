# D021: How is the installable APK signed, and may it use unencrypted connections?

- **Status**: Accepted
- **Date / context**: 2026-10-02, feature 006 (MVP), spec clarification 2, research R4 and R8
- **Scope**: security
- **Made by**: human (signing, clarification 2); agent (cleartext policy and WebDAV HTTPS, R4)
- **Revisable**: Signing: no, while one personal key signs every installable build (changing it forces
  an uninstall). Cleartext: yes, if the app gains a way to trust user certificates or drops FTP and plain
  HTTP WebDAV.

## Context

Feature 006 ships the first build meant for the owner's own phone, with no development machine
attached. Two things stood in the way:

- **Signing.** The React Native template signs release builds with the debug key. A build signed with a
  key that changes cannot update an installed app in place, and a key committed to the repository leaks.
- **Cleartext.** The release manifest set `usesCleartextTraffic=false`, and the WebDAV client hard-coded
  `http`. A release APK could therefore reach no WebDAV server at all. FTP is plain TCP and is not
  affected by the flag, but it also sends the password unencrypted. A network security config cannot name
  a host the user types in at runtime.

## Decision

- **A personal release key, outside the repository** (clarification 2, R8). `signingConfigs.release` in
  `android/app/build.gradle` reads `SYNCSCOPE_RELEASE_STORE_FILE`, `SYNCSCOPE_RELEASE_STORE_PASSWORD`,
  `SYNCSCOPE_RELEASE_KEY_ALIAS` and `SYNCSCOPE_RELEASE_KEY_PASSWORD` from Gradle properties
  (`~/.gradle/gradle.properties`, or `ORG_GRADLE_PROJECT_*` environment variables). A
  `gradle.taskGraph.whenReady` check fails any release task, before any work, when one is missing, with a
  message pointing to `DEVELOPMENT.md` › Release key. There is no fallback to the debug key. Debug and
  unit-test builds never need the key. `pnpm assemble:release` is the one documented command.
- **No debug seams in release.** The `syncscope-debug://` activities ([D017](./0017-debug-grant-release-seam.md),
  [D018](./0018-debug-repository-seam.md)) live only in the debug source set. `android-flow.sh
  release-smoke` asserts the links resolve to no activity on the installed release APK.
- **Cleartext is the user's choice** (R4). The release build type sets `usesCleartextTraffic=true`; the
  default config still denies it unless a build type opts in. The app only connects to the server the
  user typed in, so the policy that matters is theirs. The repository form shows, under the protocol
  picker, "The password and file names are sent unencrypted. Use only on a network you trust." for FTP and
  for WebDAV without HTTPS.
- **WebDAV over HTTPS.** The repository gains `webdavHttps` (schema version 4). The form's "Use HTTPS"
  switch is on by default for a new WebDAV setup; rows from before version 4 migrate to `false`. HTTPS
  uses the system trust store only. A certificate the phone does not trust (for example self-signed)
  fails with `TLS_UNTRUSTED`, whose action suggests a public certificate or SFTP.

## Rationale

A stable personal key is what lets every later build, including feature 009's, update in place and keep
the saved server, folders and results. Reading it from Gradle properties is the standard React Native
setup and keeps the secret out of git. Failing fast is better than a silently debug-signed APK that
cannot later be updated.

Without cleartext, one of the three supported protocols would not work in the APK the MVP exists to ship,
and plain-HTTP WebDAV on a home NAS is the common setup. The warning makes the risk an informed choice,
HTTPS is the default for new WebDAV setups, and SFTP stays the recommendation.

## Alternatives rejected

- A keystore committed with a dummy password: the key leaks, and anyone can sign an update.
- Falling back to the debug key when the properties are missing: rejected in clarification 2; the next
  properly signed build could not update it.
- Keeping cleartext blocked and offering HTTPS only: breaks plain-HTTP WebDAV with no workaround.
- A `network_security_config` that trusts user CAs: widens trust for every connection; certificate
  management is out of MVP scope.

## Related

- Requirements: R019 (notes), R030
- Features: specs/006-mvp (clarification 2, FR-012, FR-022, Story 4; research R4, R8, R17)
- Decisions: [D005](./0005-protocol-client-libraries.md), [D017](./0017-debug-grant-release-seam.md),
  [D018](./0018-debug-repository-seam.md)
