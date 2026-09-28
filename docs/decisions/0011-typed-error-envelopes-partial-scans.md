# D011: How are failures represented, and what happens when a scan cannot complete cleanly?

- **Status**: Accepted
- **Date / context**: M001 Layer 3, where the user chose sensible defaults after seeing the full list
- **Scope**: observability
- **Made by**: collaborative
- **Revisable**: No. This is the app's core honesty guarantee.

## Context

Connections are rejected, hosts go away, directories are unreadable and page tokens go stale. The app's
output drives irreversible deletion, so the question was how every failure reaches the UI and what a scan
does when part of it fails.

## Decision

Typed discriminated envelopes with stable machine-readable codes and redacted messages across the whole
bridge. A scan never aborts wholesale: affected files become UNKNOWN with an `issueCode`, and the run
reports an explicit incomplete-listing count.

## Rationale

A partial scan that looks indistinguishable from a clean one is the worst possible outcome for an app whose
output drives irreversible deletion. Typed codes let the UI distinguish auth rejection from host unreachable
from stale page token and offer the right recovery, and redaction keeps credentials and raw paths out of
error text.

Supporting rules:

- No retry on auth (retrying a bad password locks accounts).
- Bounded backoff of three attempts on transient network errors only.
- Backgrounding discards the partial snapshot rather than promoting it.
- `NATIVE_MODULE_UNAVAILABLE` renders a hard error screen with no mock fallback.

## Alternatives rejected

none

## Related

- Requirements: R006, R017, R018
- Features: specs/002-native-cloudsync-connect, specs/004-scan-engine-matching
