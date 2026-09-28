# D015: How strictly do the validation scripts pin the host Docker version?

- **Status**: Accepted
- **Date / context**: M001/S01/T08, after host Docker drifted to 29.8.1 and blocked
  `validation:services:start`
- **Scope**: environment
- **Made by**: human
- **Revisable**: Yes.

## Context

`protocol-service.sh` required exactly Docker 29.7.2. A routine host patch update to 29.8.1 made
`validation:services:start` fail before any container started, blocking every live-container gate.

## Decision

`protocol-service.sh` accepts any Docker 29.x client and server (a major-version pin); a new major requires
a deliberate bump. Compose stays pinned at 5.5.1 for now.

## Rationale

The exact 29.7.2 pin broke on routine host patch updates (29.8.1) and would break for developers with
slightly different setups. Container reproducibility comes from the digest-pinned images, not the daemon
patch level.

## Alternatives rejected

- Keeping the exact 29.7.2 pin — breaks on routine host patch updates and on slightly different developer
  setups.

## Related

- Requirements: R020
- Features: specs/002-native-cloudsync-connect
