# GSD State

**Active Milestone:** M001: SyncScope v1
**Active Slice:** S01: Native CloudSync module and live protocol connect
**Phase:** planning
**Requirements Status:** 22 active · 0 validated · 3 deferred · 5 out of scope

## Milestone Registry
- 🔄 **M001:** SyncScope v1

## Recent Decisions
- D008 (M001 Layer 2 architecture discussion): How local deletion is executed -> Two-phase: prepareLocalDeletion returns a plan token plus a breakdown of synced, unsynced-warned, and unknown-refused counts; executeLocalDeletion(planToken) commits with per-file outcomes written to local_deletion_overlay on success only
- D009 (M001 Layer 1 and Layer 2, driven by the user's answers on refresh behaviour and scan scale): Scan lifecycle and how freshness is handled between sessions -> Foreground-only scanning with one generation-stamped scan_run per attempt; the local side re-stats automatically on app open while the remote listing stays cached until an explicit rescan, and the remote listing's age is surfaced near any delete action
- D010 (M001 Layer 2, refined during depth verification when the user corrected the list and tree view behaviour): How the three views read scan results and how the origin of a file is shown -> All views read one snapshot through opaque page tokens clamped to 200 — gallery flat via queryFiles, list and tree parent-scoped via queryTreeChildren; the origin badge appears in gallery only, on duplicates only, naming the originating local folder
- D011 (M001 Layer 3, where the user chose sensible defaults after seeing the full list): How failures are represented and what happens when a scan cannot complete cleanly -> Typed discriminated envelopes with stable machine-readable codes and redacted messages across the whole bridge; a scan never aborts wholesale — affected files become UNKNOWN with an issueCode and the run reports an explicit incomplete-listing count
- D012 (M001 Layer 4, after verifying Maestro was already installed and wired into the e2e pipeline): What counts as proof that a user-visible capability works -> Maestro 2.10.0 flows in validation/maestro driving the real APK on API 31 and API 36 emulators against live digest-pinned protocol containers; component tests with a mocked TurboModule are supporting evidence, never the proof

## Blockers
- None

## Next Action
Slice S01 has no DB tasks. Plan slice tasks before execution.
