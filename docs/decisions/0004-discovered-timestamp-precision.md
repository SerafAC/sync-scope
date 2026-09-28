# D004: How is timestamp precision established for mtime comparison?

- **Status**: Accepted
- **Date / context**: M001 focused research pass, promoted from an implementation detail to a named S01
  deliverable
- **Scope**: architecture
- **Made by**: agent
- **Revisable**: Yes. The discovery mechanism stays, but the specific buckets get refined once measured
  against the real containers in M001/S01.

## Context

Sync matching compares modification times, but each protocol, and each server, reports them at a
different granularity. The question was whether precision is a per-protocol constant or something measured.

## Decision

Discover and record each protocol's actual timestamp precision at connect time rather than hardcoding it.
FTP uses `mdtmFile()` where the server advertises MDTM and degrades to LIST-parse precision otherwise.

## Rationale

Apache Commons Net documents MDTM as `yyyyMMDDhhmmss` with an optional `.xxx` fraction and notes that not
all FTP servers honor it, so FTP is second-precision at best and sometimes minute-granularity via LIST. A
file compared at minute precision is materially weaker proof for deletion than one compared at second
precision. Hardcoding per-protocol precision would silently produce wrong sync verdicts against a server
that behaves differently, and wrong here means the user deletes a file that is not actually backed up.

## Alternatives rejected

- Hardcoded per-protocol precision — silently produces wrong sync verdicts against a server that behaves
  differently.

## Related

- Requirements: R004
- Features: specs/002-native-cloudsync-connect, specs/004-scan-engine-matching
