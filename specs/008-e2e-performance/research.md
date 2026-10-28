# Research: Faster E2E Validation Without Losing Proof

**Date**: 2026-10-10

**Feature**: [spec.md](./spec.md)

**Evidence boundary**: Planning research only. No optimization, new emulator boot, full E2E run,
or controlled speedup measurement was performed by this planning workflow.

## R1. Preserve the proof architecture

**Decision**: Keep Maestro 2.10.0, the existing Android runner, live FTP/SFTP/WebDAV services, real
SAF grants and real local deletion on API 31 and API 36. Optimize inside that architecture. Keep
the APIs sequential and preserve their exclusive ownership and staged mutation boundaries.

**Rationale**: [D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md) and constitution principles
IV–V make mocked storage or protocol acceptance an invalid substitute. The spec explicitly excludes
new CI, remote test services and a general benchmark framework.

**Alternatives considered**:

- Replace UI setup and SAF coverage with debug seams: rejected for acceptance claims that explicitly
  require the real form or picker. Existing approved seams may remain in their established scenarios.
- Parallel API execution: deferred because services, ports, fixtures and locks are shared.
- Reduce large fixtures or remove slow scenarios: rejected because that changes the proof.

## R2. Freeze the workload, not a desired speedup

**Decision**: Record the named hotspot set before any optimization. Measure three before and three
after repetitions per named scenario on each API. Retain every result, including failures and
regressions. Compare medians only within matching host, API, fixture, build/cache, CPU/GPU renderer
and resource-setting cohorts.

**Rationale**: FR-003, FR-011 and FR-012 require reproducibility without cherry-picking. The historical
81.4-minute workspace and 6.2-minute staged totals in [analysis.md](./analysis.md) are diagnostic
evidence, not the controlled baseline. The 6.2-minute figure excludes staged host hooks and startup.

**Alternatives considered**:

- Require a fixed percentage improvement: rejected by the clarified specification.
- Drop unfavorable scenarios or replace failed repetitions: rejected; incomplete cohorts are not
  valid three-repetition comparisons.
- Treat a hardware-after/software-before difference as a like-for-like speedup: rejected. Report
  acceleration experiments separately and collect matched-mode cohorts.

## R3. Separate wall time, command costs and application profiles

**Decision**: Measure host phases with monotonic elapsed time. Account for build, boot, fixture
setup, workspace and staged execution separately, with explicit other/cleanup time for reconciliation.
Derive command-category totals from nonoverlapping executed leaf intervals. Parent helper durations
remain diagnostic inclusive views and must never be added to child totals. Application execution
profiles are separate evidence, not estimates inferred from Maestro tap durations.

**Rationale**: The inspected command costs are mostly UI interaction and synchronization. A tap
duration is not a measurement of scan-engine work. Nested `runFlow` and retry/repeat wrappers
otherwise inflate totals.

**Alternatives considered**:

- Add every duration from Maestro output: rejected because wrappers overlap descendants.
- Equate leaf duration sum with total wall time: rejected because startup, gaps and host hooks exist.
- Label time not explained by leaf commands as app execution: rejected; it is unclassified overhead
  until a profile attributes it.

## R4. Apply progress changes to the normal app or do not make them

**Decision**: Do not add a test-only static indicator or a validation-specific progress UI. First
measure reduced emulator animation settings and the cost of the existing progress synchronization.
Any justified app-side progress change uses the same code and presentation in normal and validation
builds, with accessible progress, completion, cancellation and backgrounding coverage preserved.

**Rationale**: The clarified FR-006 supersedes the static-test-indicator suggestion in analysis.md.
Short scans must produce affirmative start/terminal evidence rather than an optional assertion that
passes when nothing happened.

**Alternatives considered**:

- Static test-mode progress UI: explicitly prohibited.
- Broad synchronization disablement or unconditional sleeps: rejected as a substitute for assertions.
- Remove pacing immediately: rejected until the required running state is reliably observable.

## R5. Treat application code as a profiling-dependent scope

**Decision**: Polling and scrolling changes are conditional on profiles demonstrating their cost.
Retain the current native scan engine and existing bridge/database contracts unless measured evidence
requires a narrowly scoped change. A deferred candidate gets an evidence-backed decision, not a
placeholder implementation.

**Rationale**: analysis.md identifies these as secondary candidates, while UI automation dominates
the measured command costs. FR-008 requires preservation of stale-response guards, scan state,
paging, sorting, anchors and selection.

**Alternatives considered**:

- Rewrite the scan engine or replace polling with an event framework: not justified by current evidence.
- Bundle selection-survival work: rejected; that remains owned by feature 009.
- Add permanent production profiling infrastructure: rejected when a bounded local profile suffices.

## R6. Discover and verify renderers instead of guessing from GPU brands

**Decision**: On the inspected Linux x86_64 host, require usable KVM and launch with explicit
`-accel on`. Discover exposed graphics devices and supported emulator modes before probing
hardware candidates. Start with the previously successful OpenGL configuration
`-gpu host -feature -Vulkan`; check available Intel and NVIDIA device routes independently, and
verify the actual guest renderer. Rank working candidates using reproducible rendering/picker
measurements on each API, not a preference for a vendor. Fall back automatically to an installed,
supported software mode when hardware candidates fail, recording every reason.

**Rationale**: Read-only checks during planning found emulator **37.1.11.0**, usable KVM, and
`-help-gpu` support for `auto`, `host`, `software`, `lavapipe`, `swiftshader` and `swangle`.
The current indirect SwiftShader flag is not among those advertised modes, so it must not be the
assumed portable fallback. The historical investigation verified `host` with Vulkan disabled on
both APIs; it did not benchmark it. Public Android troubleshooting documents the same workaround.

The planning host check found accelerated Mesa **26.2.3** Intel Arc OpenGL. PCI enumeration exposed
only NVIDIA's audio function, not a NVIDIA display/3D device, and `nvidia-smi` failed with
`No supported GPUs were found`. Record NVIDIA as unavailable on this observation, not as tested and
incompatible with the emulator. Recheck at validation time because device exposure can change.

The emulator was not on this shell's `PATH`; the successful checks used
`/home/adi/Android/Sdk/emulator/emulator`. The runner's SDK resolution, not that host-specific
absolute path, belongs in developer commands.

**Alternatives considered**:

- Unqualified `-gpu host`: rejected as the only candidate because the previous Vulkan initialization failed.
- Blind `auto` selection: not enough to establish the renderer, fallback reason or best working option.
- Install Vulkan/NVIDIA drivers or change power/security policy: requires separate authorization;
  unnecessary for the previously verified Intel OpenGL route.
- Identify NVIDIA from its audio controller: rejected; no usable graphics device was established.
- Silently use software CPU emulation: rejected for this x86_64/KVM validation profile. If KVM is
  unusable, no candidate meets its CPU requirement and startup must fail with an actionable diagnostic.

## R7. Extend the existing runner with a small measurement mode

**Decision**: Keep Bash orchestration and Node's built-in filesystem/test APIs. Add one finite
`measure` mode, a report-directory option and a graphics-profile selector to the existing runner.
A small `performance-report.mjs` owns sanitization, report validation, command aggregation and
comparison. Store the fixed workload definition once in `validation/performance/hotspots.json`.
Do not introduce another test runner or npm dependency.

**Rationale**: The current runner accepts `connected`, `e2e` and `release-smoke`, with repeated
`--api` flags only. `pnpm e2e:android` explicitly supplies both APIs; direct invocation defaults
to API 31. Node 24.11.1 and pnpm 11.3.0 are already installed. Existing foundation tests use
`node --test scripts/validation/*.test.mjs` and provide fake external tools.

**Alternatives considered**:

- Standalone benchmark framework with configurable repetitions and arbitrary workloads: unnecessary
  complexity and an opportunity to change the required workload after observing results.
- Treat `before-software` and `after-auto` as directly comparable: forbidden; the comparator must
  reject or partition different verified acceleration modes.
- Parse free-form console output to infer all phase boundaries: less reliable than explicit monotonic
  phase events; Maestro command reports still supply the action breakdown.

## R8. Acquire resources before using them and release only owned resources

**Decision**: Claim the whole validation invocation before starting shared services/Metro, retain
the emulator-exclusive lock, and carry invocation/candidate ownership through startup, verification
and cleanup. A failed startup never authorizes stopping an unrelated emulator. Record borrowed
healthy resources separately; do not stop them. Audit borrowed protocol services and their manifests
without assuming teardown will perform the audit.

**Rationale**: Research found that services currently start before the emulator lock, markers identify
the harness rather than the invocation, and the first online emulator is selected without proving
ownership against the saved device inventory. Graphics fallback adds more startup attempts and must
not amplify these existing gaps. Preserve the documented use of prestarted services for connected tests.

**Alternatives considered**:

- Kill every emulator or stop every harness container before retrying: prohibited by FR-005.
- Delete/wipe the existing AVD to get a clean renderer probe: prohibited and unnecessary.
- Ignore failed startups in cleanup ownership: unsafe because a partial process can remain.
- Parallelize APIs while changing resource handling: outside this bounded optimization.

## R9. Reuse builds and immutable fixtures with evidence

**Decision**: Assemble the debug APK once before the API loop, using the supported Gradle
`-PreactNativeArchitectures=x86_64` override for this emulator-only artifact. Install its recorded
digest on both APIs. Preserve release architecture defaults, signing/update smoke and connected
instrumentation behavior. Let Gradle validate incremental outputs; do not infer validity from APK
existence. Benchmark daemon policy separately from other changes.

Reuse only immutable device fixture sets after a source-derived version and inventory/content check.
Write their validity marker after successful seeding, outside scanned trees. Upgrade the current
count-only `Scroll`/`DCIM/Big` checks; count alone does not establish validity. Continue restoring
or regenerating every mutable/deleted fixture before an independent scenario or API.

**Rationale**: Debug assembly currently occurs inside the API loop with `--no-daemon`. `Bulk`,
`GalleryBulk` and `Narrow` regenerate, while the existing reuse checks can miss corrupt files.
Remote fixtures already have detailed manifests; use that pattern rather than duplicate definitions.
Baseline acceptance datasets remain 20,000 bulk files, 2,000 gallery images and 5,000 scroll files.

**Alternatives considered**:

- Skip build when an APK exists: stale-output risk.
- Cache every fixture across deletion/staged tests: invalidates clean-state and mutation proof.
- Validate only file count: misses replaced/truncated/corrupt content.
- Change resolution, RAM, vCPU count or fixture sizes simultaneously: deferred to separate experiments
  if profiles justify them; matching cohorts must retain those settings.

## R10. Preserve full acceptance and staged ordering

**Decision**: Derive the acceptance inventory from `validation/maestro/config.yaml`, the staged
registry and their assertions before optimization, recording 39 workspace entries and all seven
staged parts. Require every original claim, protocol and API to retain executed assertion evidence.
Freeze the eight hotspot workloads described in [contracts/acceptance.md](./contracts/acceptance.md),
including their prerequisite sequences; measurement mode is not the final acceptance suite.

The three staged sequences remain:

1. `06-a` → remove the remote recheck file → `06-b`;
2. `07-a` → pause SFTP → `07-b` → resume SFTP → `07-c`;
3. `08-a` → mutate device files → `08-b`.

**Rationale**: Source workflows and `polish/01` → `02` intentionally share state. Clearing state
between staged parts removes the behavior being proved. Runner/service cleanup restores the remote
recheck file and resumes SFTP even after a failure.

**Alternatives considered**:

- Execute all selected YAML files independently without preconditions: invalid source/restart proof.
- Add staged flows to the workspace glob: bypasses required host mutation hooks.
- Accept matching flow counts without checking mandatory assertions: can hide optional/no-op checks.
- Call a hotspot run the complete suite: only the unchanged workspace plus staged execution qualifies.

## R11. Use real contextual selection only after proving replacement

**Decision**: Evaluate one focus/selection/replacement cycle in the real form: type directly into an
empty field; for nonempty input, use contextual **Select all** and replace the selection. Hide the
keyboard once and require the resulting value. Adopt this path only after the ordinary/secure/numeric,
cursor-start/middle/end, partial-selection and long-root matrix passes on both APIs. If unsupported,
retain the reliable existing helper for its established cases and defer the optimization; do not
silently proceed after a missing selection action. New long-input correctness cases must pass before
claiming a general replacement contract.

**Rationale**: Static inspection of installed Maestro 2.10.0 found no `eraseText.all`, no input
replace flag, and no End/MoveEnd/Ctrl+A/SelectAll key enum. An omitted erase count defaults to 50.
The Android RPC name `eraseAllText` does not establish cursor-independent semantics.
The current helper's two tap/erase cycles compensate for cursor placement but cost substantial time.
Contextual selection and secure-field replacement remain runtime compatibility tests, not assumptions.

**Alternatives considered**:

- `eraseText: {all: true}` or `pressKey: Ctrl+A`: unsupported by the pinned driver.
- Tap a presumed field end or reduce the erase count without checking cursor position: nondeterministic.
- Optional Select all followed by typing: can append to stale content and falsely appear successful.
- Inspect/report the secure value: prohibited; prove it through authentication with synthetic credentials,
  plus masked length/clearing assertions where the platform exposes them safely.

## R12. Move lifecycle responsibility to callers, preserving seam returns

**Decision**: Make `open-sources` navigation-only and update each caller to own its launch/reset/restart
transition. Already-open MainActivity callers avoid duplicate launches. Callers using the repository
debug seam must explicitly return to MainActivity; stopped/revoked/restart scenarios keep their launches.
Staged continuation `08-changed-b` must not launch at all.

**Rationale**: `ConfigureRepositoryActivity` remains open with its status message; package foreground
does not mean the tab UI is ready. D018 permits that real production setup seam only for incidental
setup, not dedicated form proof. D017 grant-release proof also keeps its actual OS grant transition.

**Alternatives considered**:

- Delete every launch from the helper and assume callers are ready: breaks seam and restart flows.
- Add a global “skip all launches” switch: obscures ownership and scenario isolation.
- Reuse all repository/source setup globally: invalid for dedicated setup, reset and staged subjects.

## R13. Make fast scan proof affirmative, and profile before production edits

**Decision**: Required-progress flows assert running visibility, the terminal result and progress
absence. Other fast-scan flows establish a new run/generation and its expected terminal outcome even
if running UI is missed between observations. Capture previous generation when present. An optional
running wait followed only by progress disappearance is not proof of a scan.

For production candidates, measure bridge latency/concurrency and equal-state React commits,
scroll commits/anchor effects, and allocation/GC separately from normal benchmark runs. Serialize
polling or suppress equal updates only if profiles justify it; preserve terminal/error/interruption
delivery. Ref-backed scroll offsets must preserve semantic anchors/thumb updates, folder offsets and
hidden-view restoration. `usePagedQuery` already caches per-segment placeholder arrays; optimize only
demonstrated residual flattening/grid allocations, not a presumed absence of caching.

**Rationale**: `start-scan.yaml` currently has an optional running wait. Clean scans require running
visibility and deliberately pace seven files at 4,000 ms each. The app's polling can overlap and raw
offset state can render often, but neither has yet been demonstrated to dominate end-to-end cost.
Instrumented profiler runs cannot be mixed into ordinary before/after timing cohorts.

**Alternatives considered**:

- Remove all pacing or require every fast scan to expose a long running window: weak proof or needless delay.
- New event-based scan infrastructure: not justified by current measurements.
- Suppress equal objects by reference identity alone: fresh DTOs and new generations require semantic checks.
- Broad placeholder/paging rewrite: risks existing generation and query invalidation guarantees.

## R14. Separate ranking freshness from before/after cohort equality

**Decision**: Add `rankingFingerprint` for the executed app/APK, flow/helper closure, pacing,
workload/fixture identity and current host/guest/tool/candidate/animation/cache settings. Keep it
distinct from the acceleration/cohort fingerprint. Recalibrate viable candidates after US1 changes
and any retained US3 production changes; final acceptance requires ranking evidence for the final
inputs. A stale cached choice is provisional, never a best-performing claim.

**Rationale**: Helper, animation and app optimizations can alter which GPU configuration performs
best even when devices/drivers remain unchanged. Original-code ranking is insufficient evidence for
final selection. Conversely, requiring unchanged app/helper identity in a before/after cohort would
reject the very optimization being measured.

**Alternatives considered**:

- Reuse original ranking whenever the GPU/driver is unchanged: misses execution-workload changes.
- Include current app/helper identity in before/after equality: makes valid optimization comparisons
  impossible.
- Infer a baseline if the final winning renderer changes: prohibited; use retained original inputs
  to collect its matched baseline instead.

## R15. Automate runtime fault checks without a production fault switch

**Decision**: Add a small Node `acceleration-fault-check.mjs` harness and fake-driven tests. Use a
private temporary SDK overlay and emulator wrapper in only the child validator environment, passing
capability probes unchanged and rejecting token-owned candidate launches for the two fixed cases
defined in [contracts/acceleration.md](./contracts/acceleration.md). Forward software launches to
the real emulator for hardware-fallback proof. Treat expected all-options exhaustion as harness
success while retaining the validator's failure status.

**Rationale**: Unit fakes cannot demonstrate a real fallback boot, and an unspecified manual injection
is not reproducible E2E. Existing SDK resolution provides the bounded child-process seam without
altering the installed SDK, app, public runner CLI, drivers, AVD definition or foreign processes.
Fault-check results are separate acceptance evidence, never calibration or timing samples.

**Alternatives considered**:

- Disable global GPU drivers/security or wipe an AVD: prohibited.
- Add app/normal-runner fault modes: unnecessary production interface complexity.
- Fake a successful software boot: does not meet the real-runtime proof requirement.
- Replace T025 with unit coverage only: loses its required runtime acceptance demonstration.

## Research completion

Design unknowns are resolved by the decisions above. GPU support/ranking, contextual selection
compatibility, progress visibility and application bottleneck measurements have explicit experiment
and fallback/defer rules. They are implementation evidence to collect, not missing user decisions.
No planned optimization or speed gain is claimed as implemented.

## External documentation checked

Public documentation searches corroborated the emulator's hardware/software rendering modes and
the documented Vulkan-disable workaround. The local emulator's supported flags and actual runtime
renderer remain the authority for this host; documentation does not establish compatibility or speed.

- [Android emulator acceleration](https://developer.android.com/studio/run/emulator-acceleration)
- [Android emulator troubleshooting](https://developer.android.com/studio/run/emulator-troubleshooting)
- [Maestro eraseText reference](https://docs.maestro.dev/api-reference/commands/erasetext)
- [Maestro pressKey reference](https://docs.maestro.dev/api-reference/commands/presskey)

No source above establishes a portable Select All key combination for the pinned Maestro CLI.
Field replacement must use capabilities verified against that version rather than guessed commands.
