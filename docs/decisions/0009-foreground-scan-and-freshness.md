# D009: What is the scan lifecycle, and how is freshness handled between sessions?

- **Status**: Accepted
- **Date / context**: M001 Layer 1 and Layer 2, driven by the user's answers on refresh behaviour and scan
  scale
- **Scope**: architecture
- **Made by**: collaborative
- **Revisable**: Yes. The seven-day threshold in particular is an unresearched default meant to be tuned
  after real use.

## Context

A full scan lists the remote repository, which over FTP can take minutes, and stats every selected local
file. Between sessions the user takes new photos, and the remote side may change without the app knowing.

## Decision

Foreground-only scanning, with one generation-stamped `scan_run` per attempt. The local side re-stats
automatically on app open, while the remote listing stays cached until an explicit rescan. The remote
listing's age is surfaced near any delete action.

## Rationale

The user chose foreground-only with visible progress, and chose automatic local refresh because new photos
are exactly the ones worth flagging. The remote listing is the expensive half and stays cached. The
consequence is that a file can show SYNCED from a stale listing after being removed remotely. Because the
user acts on that verdict by deleting, staleness is a data-loss hazard rather than a cosmetic one, so the
listing age must be visible at the moment of decision. Past a seven-day threshold the app suggests a rescan
without blocking.

## Alternatives rejected

none

## Related

- Requirements: R006, R015, R016, R025
- Features: specs/004-scan-engine-matching, specs/007-multiselect-local-deletion
