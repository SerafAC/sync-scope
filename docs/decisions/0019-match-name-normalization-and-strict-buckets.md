# D019: How are names and modified times compared when matching?

- **Status**: Accepted
- **Date / context**: 2026-09-30, feature 004 (scan engine, matching and snapshot lifecycle), spec
  clarifications 2 and 3
- **Scope**: architecture
- **Made by**: human
- **Revisable**: No for v1. It refines [D003](./0003-directory-agnostic-sync-matching.md) without revising
  it: the key is still `(snapshotId, name, sizeBytes, precisionMillis, bucket)`.

## Context

[D003](./0003-directory-agnostic-sync-matching.md) matches a local file to a remote one on name, size and a
modified time inside the protocol's precision bucket, but left two things open:

- **Unicode forms.** The protocol clients and the Android storage provider hand names over unnormalized,
  so the same name can arrive in NFC (`é` as one code point) on one side and NFD (`e` plus a combining
  accent) on the other. Byte comparison would call that file not backed up. Letter case is a separate
  question: some servers and file systems fold it, Android's does not.
- **Bucket edges.** Two modified times can be closer together than one precision unit yet fall on either
  side of a bucket boundary (the `timestamps/bucket-start.bin` / `bucket-end.bin` fixture). It was open
  whether such a pair, or a pair in adjacent buckets, should match.

## Decision

- **Names**: both the local and the remote name are normalized to Unicode NFC
  (`java.text.Normalizer.normalize(name, NFC)`) before the match key is built or looked up. Comparison is
  **case-sensitive**: `IMG.jpg` and `img.jpg` do not match. The name stored and shown is the original.
- **Modified times**: with the scan's discovered precision `p`, `bucket = Math.floorDiv(mtimeMillis, p)`,
  and a match requires **equal buckets**. Adjacent buckets and absolute-difference tolerance are not
  accepted, so a pair straddling a bucket boundary does not match.

Both rules live only in `MatchIndex`. `MatcherTest` and `MatchIndexTest` pin them: an NFC/NFD pair matches,
a case-only difference does not, and a straddling pair does not (SC-001).

## Rationale

The verdict drives an irreversible delete, so every error must fall on the safe side. NFC normalization
removes a false UNSYNCED caused only by encoding. Case-insensitive matching would add false SYNCED results
for files that differ only in case. Strict buckets keep the rule an exact indexed lookup, and the
occasional miss at an edge shows as UNSYNCED, never as a false SYNCED.

## Alternatives rejected

- Byte-for-byte names: an NFC/NFD pair of the same name would never match.
- Case-insensitive names: can call a different file a backup.
- Accepting the adjacent bucket, or any difference below one precision unit: widens the window to almost
  two precision units, and needs a range lookup instead of an exact key.

## Related

- Requirements: R007
- Features: specs/004-scan-engine-matching (spec clarifications 2 and 3, FR-002, SC-001; research R3)
- Decisions: [D003](./0003-directory-agnostic-sync-matching.md), [D004](./0004-discovered-timestamp-precision.md)
