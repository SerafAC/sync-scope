# D007: How are SFTP host keys trusted?

- **Status**: Accepted
- **Date / context**: M001 Layer 2, decided by the agent at the user's direction
- **Scope**: security
- **Made by**: agent
- **Revisable**: No. A silent-reconnect fallback would defeat the purpose.

## Context

SFTP authenticates the server by its host key. The app has no prior knowledge of the user's server key,
and its deletion verdicts are only as trustworthy as the remote listing it reads.

## Decision

Blocking trust-on-first-use. The first connect surfaces a fingerprint challenge; approval persists to
`trusted_sftp_host_key`; rejection aborts; and a changed key later fails the connection hard and
re-prompts rather than reconnecting silently.

## Rationale

Blind host-key acceptance makes the SFTP connection trivially interceptable, and deletion decisions based on
a spoofed remote listing would destroy files that are not backed up. The scaffold already committed to this
shape with `approveSftpHostKey`, `rejectSftpHostKey` and a unique index on `(host, port, algorithm)`. The
cost is one extra UI flow in connection setup, which is worth it given the consequence.

## Alternatives rejected

- Blind host-key acceptance — makes the connection trivially interceptable.
- Silent reconnect on a changed key — defeats the purpose of trusting a key at all.

## Related

- Requirements: R002
- Features: specs/002-native-cloudsync-connect
