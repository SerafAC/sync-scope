# D001: How do JavaScript and native code communicate, and where does the engine live?

- **Status**: Accepted
- **Date / context**: M001 Layer 2 architecture discussion
- **Scope**: architecture
- **Made by**: collaborative
- **Revisable**: No. The contract is already declared and codegen-configured; changing it would invalidate
  the schema and test scaffolding.

## Context

The app needs FTP, SFTP and WebDAV clients, a scanner, a matcher and a local deleter, and it has to handle
thousands of file records. The question was which side of the React Native bridge owns that engine and how
wide the bridge is.

## Decision

A single `CloudSync` TurboModule is the entire JS-to-native API. Protocol clients, scanning, matching and
deletion all run in Kotlin, and JS is presentation only.

## Rationale

Protocol clients are JVM libraries, so running them natively avoids a JS-side socket stack and keeps
thousands of file records off the bridge. The scaffold already declares the complete method surface in
`src/native/specs/NativeCloudSync.ts` with versioned discriminated envelopes, so this fills in a
pre-declared contract rather than designing one.

## Alternatives rejected

- JS-side protocol clients via React Native networking — there is no viable SFTP/FTP story in JS, and it
  would push the whole catalog across the bridge.

## Related

- Requirements: R018, R019, R026
- Features: specs/002-native-cloudsync-connect
