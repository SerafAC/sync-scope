# D005: Which Kotlin libraries implement the FTP, SFTP and WebDAV clients?

- **Status**: Accepted
- **Date / context**: M001 Layer 2, decided by the agent at the user's direction ("your call on all
  three"), then validated by a focused research pass
- **Scope**: library
- **Made by**: agent
- **Revisable**: Yes. Locked at planning time, but M001/S01 proves it against the real containers and may
  force a swap.

## Context

The native engine (D001) needs one client per protocol, running on Android with minSdk 31, using username
and password authentication only.

## Decision

SSHJ 0.40.x for SFTP, Apache Commons Net for FTP, and a hand-rolled OkHttp PROPFIND for WebDAV.

## Rationale

SSHJ made Bouncy Castle optional rather than a hard dependency and landed Android compatibility work in
0.31.0; it needs Java 8+, which minSdk 31 clears. Its SSH-agent caveat requiring a Java 16+ runtime is
irrelevant because auth is username and password only. WebDAV's read-only surface is small enough that
writing PROPFIND by hand costs less than Sardine's thinly maintained old HTTP stack.

Residual risk: whether a Bouncy Castle-free SSHJ negotiates the server's host-key and cipher algorithms. If
it needs `bcprov-jdk18on` added, that is a dependency line, not a redesign, and M001/S01 surfaces it as a
blocker rather than a silent detour. (M001/S01/T04 did add `bcprov-jdk18on` 1.80.2; see
[protocols](../protocols.md).)

## Alternatives rejected

- JSch for SFTP — abandoned.
- Sardine for WebDAV — its thinly maintained old HTTP stack costs more than a hand-written PROPFIND.

## Related

- Requirements: R001, R028
- Features: specs/002-native-cloudsync-connect
