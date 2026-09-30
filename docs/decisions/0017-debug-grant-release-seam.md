# D017: How do end-to-end flows revoke a persisted folder grant?

- **Status**: Accepted
- **Date / context**: 2026-09-28, feature 003 (local source selection via SAF), plan (research R11)
- **Scope**: testing
- **Made by**: agent
- **Revisable**: Yes, if Android gains an adb command that revokes one app's persisted URI grant without
  clearing its data.

## Context

Acceptance scenario 4 of feature 003 ("a source whose grant was revoked between sessions is shown as
unavailable") must be proven by a Maestro flow on a real emulator
([D012](./0012-maestro-e2e-proof-bar.md)). No adb command or system UI revokes a single app's persisted
SAF grant while keeping its data: `pm clear` also deletes the Room store that holds the sources.

## Decision

A debug-only activity, `com.syncscope.debug.ReleaseGrantsActivity`, lives in `android/app/src/debug/` and
is reached through the deep link `syncscope-debug://release-grants`. It calls
`releasePersistableUriPermission` for every grant the app holds and finishes. Maestro opens it with
`openLink` and then relaunches the app.

This is the first test-only seam, and it sets the rule for later ones: a seam lives only in
`android/app/src/debug/`, is reached through a `syncscope-debug://` deep link, is recorded here in
`docs/decisions/`, and must reproduce a real OS state, never fake app state.

## Rationale

Releasing the grants leaves exactly the OS state a real revocation leaves: the URI is absent from
`persistedUriPermissions`, while the `source_root` rows stay. The app's real availability check then runs
unchanged. The activity is in the debug source set only, so the release build does not contain it.

## Alternatives rejected

- `pm clear` — also deletes the Room store, so there is nothing left to show as unavailable.
- `adb root` and editing `urigrants.xml` — needs a reboot and is fragile.
- UiAutomator instrumented tests — D012 makes Maestro the proof bar.
- A debug flag that makes the app report sources as revoked — fakes app state instead of reproducing the
  OS state, so it would not prove the real check.

## Related

- Requirements: R005, R020
- Features: specs/003-local-source-selection (research R11; flows `sources/05-revoked-unavailable`,
  `sources/06-regrant` and `sources/07-remove`)
- Decisions: [D012](./0012-maestro-e2e-proof-bar.md), [D016](./0016-saf-source-identity-and-availability.md)
