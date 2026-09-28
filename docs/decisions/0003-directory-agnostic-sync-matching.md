# D003: How is a local file determined to be synced with its remote counterpart?

- **Status**: Accepted
- **Date / context**: M001 Layer 2 architecture discussion, grounded in the user's Q&A answers about
  directory mismatch
- **Scope**: architecture
- **Made by**: human
- **Revisable**: No for v1. The Room indexes and schema tests are built around this shape; a stricter
  checksum mode is deferred as R023.

## Context

Android stores photos in app-dependent album directories, while cloud syncing flattens them and applies
its own album scheme, so local and remote trees will never line up. The matcher still has to answer, for
every local file, whether it is backed up somewhere.

## Decision

Match on a collapsed `remote_match_key` of `(snapshotId, name, sizeBytes, precisionMillis, bucket)`. Local
nodes look up by `(name, sizeBytes)`, then compare mtime inside the protocol's precision bucket. Directory
structure is never compared.

## Rationale

The user was explicit that duplicates on both sides are fine and that what matters is that a given file is
backed up somewhere. Because the trees never line up, directory structure carries no signal. The collapsed
key turns sync determination into an indexed exact lookup rather than an O(n x m) tree walk.

## Alternatives rejected

- Path-relative matching — breaks the moment the remote flattens, which the user says is the normal case.

## Related

- Requirements: R007, R023
- Features: specs/004-scan-engine-matching
