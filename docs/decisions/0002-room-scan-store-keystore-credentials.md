# D002: Where are scan state and credentials stored?

- **Status**: Accepted
- **Date / context**: M001 Layer 2 architecture discussion
- **Scope**: architecture
- **Made by**: collaborative
- **Revisable**: No. The boundary is enforced by a build-failing test.

## Context

A scan produces thousands of file records that three views must read consistently, and the app holds the
password for the user's cloud account. Both need a home on the device, and the device may be rooted or
backed up.

## Decision

Room holds the scan store (`local_node`, `remote_match_key`, `snapshot`, `scan_run`, `source_root`,
`local_deletion_overlay`, `repository_config`, `trusted_sftp_host_key`). The password goes to Android
Keystore-backed `EncryptedSharedPreferences`, referenced from Room only as `credentialVersion`.

## Rationale

Room databases are trivially extractable from a rooted or backed-up device. `SchemaContractTest` fails the
build if `repository_config` grows a password, secret, ciphertext, cipher, nonce, credential_blob or token
column, so the boundary is enforced by test rather than convention. Thousands of files also means the
snapshot must live in a database, not in JS memory.

## Alternatives rejected

- An encrypted blob in Room — the schema test explicitly forbids it, and Keystore is the platform answer.

## Related

- Requirements: R003
- Features: specs/002-native-cloudsync-connect
