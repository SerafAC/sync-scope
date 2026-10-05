# D018: How do end-to-end scan flows configure the remote repository?

- **Status**: Accepted
- **Date / context**: 2026-09-30, feature 004 (scan engine, matching and snapshot lifecycle), plan
  (Complexity Tracking) and research R11
- **Scope**: testing
- **Made by**: agent
- **Revisable**: Yes. Feature 006 (MVP) built the repository screen; see the update of 2026-10-02 below. The seam
  can be removed once no flow needs a fast setup.

## Context

Every scan flow needs a saved and tested repository that points at the live FTP, SFTP or WebDAV container
([D012](./0012-maestro-e2e-proof-bar.md)). The app has no Connect screen until feature 006 (MVP), so Maestro has
no screen to type the server details into. The container credentials are random and regenerated on every
service start ([D014](./0014-container-credentials-via-runner-args.md)), so they cannot be built into the
app or the flows.

## Decision

A debug-only activity, `com.syncscope.debug.ConfigureRepositoryActivity`, lives in `android/app/src/debug/`
and is reached through the deep link
`syncscope-debug://configure-repository?protocol=…&host=…&port=…&username=…&password=…&root=…`. It runs the
production `RepositoryOperations.save`, then `test`. When the test returns an SFTP host-key challenge, it
approves it through the production `HostKeyTrustStore` and tests again. It shows `Repository configured` or
`Repository error: <CODE>` for Maestro to assert. `android-flow.sh` passes the per-run credentials to
Maestro as `-e` variables (`FTP_*`, `SFTP_*`, `WEBDAV_*`), and `subflows/configure-repository.yaml` opens
the link.

The same link takes an optional `scanDelayMs`, a debug-only per-file scan pause (decision log
2026-10-01) that keeps the progress card on screen long enough to assert in the `01-clean-scan-*` flows. A
link without it resets the pause to 0. The release source set's `ScanPacing` is a no-op.

**Credential exposure.** The password travels in the deep link's query string. Android's activity manager
and Maestro may log that URI, so the password can end up in the device log and in Maestro's output. This is
accepted only because the credentials are throwaway, per-run container credentials, regenerated on every
service start and valid only for loopback test servers, as in
[D014](./0014-container-credentials-via-runner-args.md). The seam itself never logs the intent or its URI,
never shows the password, and logs only an exception's class name on failure. It must never be used with a
real repository password.

## Rationale

The seam runs exactly the code the Connect screen will run: the saved configuration, the Keystore
credential and the trusted host key are what a real user would leave. That follows the seam rule set in
[D017](./0017-debug-grant-release-seam.md): debug source set only, a `syncscope-debug://` link, recorded
here, and real state rather than faked app state. The activity is not in the release build.

## Alternatives rejected

- Building the Connect screen now: it pulls feature 006 (MVP)'s scope forward.
- Pre-seeding Room and the Keystore from adb: it fakes app state and bypasses the credential boundary, so
  it would not prove that a saved repository works.
- Passing the credentials through an `adb push`ed file: it leaves the secret on the device filesystem
  (rejected in D014 for the same reason), and the seam would still need to read it.
- A debug flag that slows the scan down without going through the seam: it would be a second, separate
  test hook for the same flows; the pause rides on this seam and is off unless a flow asks for it.

## Update 2026-10-02

Feature 006 (MVP) added the repository screen (Settings › Repository), so the "no Connect screen" premise
no longer holds. The `mvp/` Maestro flows set up FTP, SFTP (including host-key approval) and WebDAV through
that screen and then scan (spec FR-013, SC-002).

The seam stays, debug-only and unchanged, for the scan, browse and deletion flows whose subject is not
setup: they need a configured repository quickly and with the per-run `scanDelayMs`, and typing six fields
through the UI in every flow would slow the suite without proving more (research R16). The seam is absent
from the release APK, and `android-flow.sh release-smoke` asserts that its link finds no activity there
([D021](./0021-release-signing-and-cleartext-policy.md)).

## Related

- Requirements: R001, R020
- Features: specs/004-scan-engine-matching (plan Complexity Tracking, research R11,
  `contracts/maestro-scan.md`)
- Decisions: [D012](./0012-maestro-e2e-proof-bar.md), [D014](./0014-container-credentials-via-runner-args.md),
  [D017](./0017-debug-grant-release-seam.md), [D021](./0021-release-signing-and-cleartext-policy.md)
- Features: specs/006-mvp (research R16, `contracts/maestro-mvp.md`)
