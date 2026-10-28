# Implementation Plan: Faster E2E Validation Without Losing Proof

**Branch**: `008-e2e-performance` | **Date**: 2026-10-10 | **Spec**: [spec.md](./spec.md)

**Input**: Clarified specification in `specs/008-e2e-performance/spec.md`.

## Summary

Optimize the existing Bash/Maestro Android validation loop without changing its proof architecture.
First freeze the workload and acceptance inventory, then collect three comparable before/after
repetitions on API 31 and API 36. Add a small Node reporting module for phase timings, sanitized
command costs and matched-cohort comparisons. Fix invocation ownership before adding GPU probing.
Verify KVM and actual Intel/NVIDIA renderer availability, rank working graphics configurations by
measurements, and automatically report software fallback.

Then reduce redundant field editing/navigation, assemble the emulator APK once, and reuse only
validated immutable fixtures. Changes to progress UI, polling or rendering require measured evidence
and apply to normal app builds. Every original workspace and staged acceptance claim remains required.
There is no promised minimum speedup; a measured zero gain can be accepted with recorded tradeoffs.
Decisions and alternatives are in [research.md](./research.md).

## Technical Context

**Language/Version**: Existing Bash scripts; Node 24.11.1 built-in modules; TypeScript 6.0.3 and
React 19.2.3 for profile-justified UI changes; Kotlin 2.2.0 only if a measured native change is needed.

**Primary Dependencies**: React Native 0.87.0, React Native Paper 5.15.3, React Navigation 7,
Maestro 2.10.0, Android emulator 37.1.11, platform-tools 37.0.1, Linux KVM, Gradle 9.4.1,
existing Docker 29.x/Compose 5.5.1 protocol services. No new runtime or reporting dependency.
The app remains one Codegen TurboModule with Room/SAF and native credentials.

**Storage**: Local, private raw validation artifacts; allowlisted JSON/Markdown performance reports
under ignored `validation/evidence/performance/`; source-versioned workload metadata and fixture
validity markers outside scanned trees. No Room migration, preference change or bridge version bump.

**Testing**: Node built-in test runner with recording SDK/ADB/emulator/Docker/clock fakes; Jest 29.7
and Testing Library for changed UI units; existing JVM tests for any native changes; real Maestro
workspace plus seven staged parts against live FTP/SFTP/WebDAV on both APIs. New deterministic
performance tests must not inherit host-tool/device dependencies from older infrastructure tests.

**Target Platform**: Linux x86_64 host with KVM; headless Google APIs x86_64 AVDs on Android API 31
and API 36. App minSdk 31, compileSdk 37, targetSdk 36. Host graphics currently expose Intel Arc;
NVIDIA graphics availability must be rechecked, not inferred from its audio controller.

**Project Type**: Android mobile app with local developer validation tooling.

**Performance Goals**: Report absolute/relative median change for every frozen workload over exactly
three complete before and three complete after samples per API and matching acceleration cohort.
Report every regression and rejected alternative. No minimum percentage improvement. Candidate GPU
selection requires runtime compatibility plus comparable measurements, not brand preference.

**Constraints**:

- Retain real repository forms, SAF grants, deletion, live protocols, source/restart state and staged hooks.
- No test-only progress indicator, skipped running-state checks, broad synchronization disabling,
  reduced acceptance datasets or replacement of assertions with sleeps.
- No unapproved host package, power-policy, security-control, AVD wipe or foreign-process changes.
- Preserve sequential APIs and exclusive ownership; reuse never crosses invalid mutation boundaries.
- Keep raw argv, credentials, app text, deep links, screenshots and hierarchy dumps out of reports.
- Compare like CPU/GPU/renderer modes only; report configuration experiments separately.
- Keep resolution, density, CPUs, RAM and fixtures fixed during the initial optimization comparisons.
- Use existing API defaults and connected/release contracts; added CLI options are backward compatible.

**Scale/Scope**: 39 current workspace flows plus seven staged parts per API; eight frozen hotspot
workloads, including separate gallery/list breakdowns; default 20,000 bulk files, 2,000 gallery
images and 5,000 scroll files. Changes concentrate in `scripts/validation/` and Maestro helpers.
App changes remain conditional on profiles; tree/preview, selection-survival and full-loop release
features remain out of scope.

All design decisions are resolved in research.md. Runtime renderer support, actual speed changes
and whether profiling candidates merit code changes are validation outcomes, not unresolved requirements.

## Constitution Check

*GATE: evaluated before Phase 0 research and re-evaluated after Phase 1 design.*

| Principle | Before research | After design | Planned compliance |
| --- | --- | --- | --- |
| I. Simplicity First | PASS | PASS | Extend the current runner; one small Node reporting module, a finite workload/profile set, no general benchmark service. Required complexity is tracked below. |
| II. YAGNI | PASS | PASS | Every change traces to FR-001–012. No new CI, parallel APIs, event framework, speculative scan rewrite or tree/preview work. Profile-negative candidates are deferred. |
| III. DRY | PASS | PASS | One runtime hotspot manifest; existing workspace/staged registries remain authoritative. Existing fixture generators/manifests determine cache validity. One reporting implementation owns sanitization and comparison rules. Documentation links to contracts. |
| IV. Unit tests | PASS | PASS | Pair each tooling/helper change with deterministic fake-driven regression tests; pair every changed UI/native unit with its existing Jest/JVM tests. No network/device-dependent new unit test, skipped regression or untested production change. |
| V. E2E coverage | PASS | PASS | Named mappings in contracts/acceptance.md retain all 39 workspace flows and seven staged parts on both APIs, real protocols/SAF/deletion, and add field/fallback proof. Measurement mode never replaces full acceptance. |
| VI. Versioning and CHANGELOG | PASS | PASS | Record behavior/tooling changes under `Unreleased`; `package.json` stays the version authority. No release bump is required. |
| VII. Documentation under docs | PASS | PASS | Add `docs/validation-performance.md`, update docs index/architecture for implemented behavior, and retain D012/D017/D018. Correct stale guidance with measured evidence. |
| VIII. User-facing README | PASS | PASS | Tooling-only changes do not alter user setup. If a normal-build progress behavior changes, update the affected user guidance and accessibility description. Keep developer details linked to DEVELOPMENT.md. |
| IX. Developer guidance | PASS | PASS | Update DEVELOPMENT.md with actual CLI, SDK resolution, renderer/fallback behavior, workload/report commands, timings and real timeout limits. |
| Quality gates | PLANNED | PLANNED | Lint, typecheck, JS/script unit tests, native tests when native code changes, affected E2E and complete two-API acceptance remain merge gates. |

No unjustified violation or waiver is introduced. The gate passes for the design, not for unimplemented
code. Passing implementation tests and measured outcomes are still required.

## Project Structure

### Documentation (this feature)

```text
specs/008-e2e-performance/
├── spec.md
├── analysis.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── validation-runner.md
│   ├── acceleration.md
│   └── acceptance.md
└── tasks.md                       # next /speckit-tasks output, not created here
```

### Source Code (repository root, intended implementation)

```text
scripts/validation/
├── android-flow.sh                # ownership, timing, measure mode, one build, artifact routing
├── android-validator.sh           # candidate-owned startup, graphics verification/fallback
├── android-sdk.sh                 # reuse SDK resolution
├── device-fixtures.sh             # validated immutable reuse, mutable resets
├── fixture-manifest.mjs           # reuse existing manifest semantics
├── protocol-service.sh            # acquired/borrowed ownership and audits if required
├── protocol-services.sh
├── metro-service.sh               # acquired/borrowed lifecycle if required
├── performance-report.mjs         # NEW: allowlisted records, aggregation and comparison
├── performance-report.test.mjs    # NEW: synthetic artifacts and clock tests
├── performance-runner.test.mjs    # NEW: isolated lifecycle/tool fakes
├── acceleration-fault-check.mjs   # NEW: scoped automated runtime-failure acceptance harness
├── acceleration-fault-check.test.mjs # NEW: fake SDK/token/cleanup regressions
├── validation-infrastructure.test.mjs
└── hooks/                        # existing staged mutations and restoration

validation/
├── performance/hotspots.json      # NEW: single frozen runtime workload definition
├── maestro/
│   ├── config.yaml               # retain current full-suite registry/order
│   ├── subflows/                 # field replacement; launch separate from navigation
│   ├── performance/              # NEW: focused field/navigation proof, not a second suite
│   ├── scan/                     # mandatory progress/cancel/background assertions
│   ├── browse/                   # existing gallery acceptance
│   ├── polish/                   # existing gallery/list scrollbar acceptance
│   └── staged/                   # preserve seven parts and host-hook order
└── evidence/performance/          # ignored private raw data and sanitized report outputs

src/scan/ScanProvider.tsx                            # only after positive profiling
src/scan/__tests__/useScan.test.tsx
src/screens/{ScanScreen,GalleryScreen,ListScreen}.tsx # only after positive profiling
src/screens/__tests__/{ScanScreen,GalleryScreen,ListScreen}.test.tsx
src/files/usePagedQuery.ts                           # only after positive profiling
src/files/__tests__/usePagedQuery.test.tsx

docs/{validation-performance.md,architecture.md,README.md}
DEVELOPMENT.md
CHANGELOG.md
README.md                          # only if normal app behavior changes
```

**Structure Decision**: Work inside the existing Android validator rather than adding another
framework. Bash retains lifecycle orchestration; Node owns portable deterministic report logic.
Runtime hotspot metadata is not a duplicate of the full-suite inventory. Planned files above are
implementation targets, not files created by this planning command.

## Implementation Sequence and Evidence Gates

### 1. Freeze proof and collect baselines before optimizing

- Create the fixed manifest from contracts/acceptance.md and fingerprint it with the original flow
  inputs, prerequisites, fixtures and measurement boundaries.
- Inventory every workspace/staged assertion and state boundary. Record known optional-progress
  weakness explicitly; do not retroactively claim it was affirmative baseline proof.
- Add observational phase/report collection without editing interaction helpers or app behavior.
  Route each Maestro invocation to an explicit private artifact directory.
- Collect three pre-change repetitions per workload/API. Preserve the original software-renderer
  cohort. Before helper/app changes, also collect pre-change samples for any newly selected hardware
  profile that will be used for the after cohort.
- Record build, service, boot, install, seed, workspace, staged hooks/parts and cleanup independently.
  Account shared work once; record failures and unsupported artifact formats.

**Gate**: frozen inventory/workloads and complete baseline cohorts exist. Historical timing numbers
alone do not pass this gate.

### 2. Make resource ownership safe, then select acceleration

- Claim the complete invocation before shared service setup; keep the emulator-exclusive lock.
  Test ownership and failure cleanup with fakes before runtime GPU probes.
- Discover exposed Intel/NVIDIA graphics and installed modes; verify KVM. Probe only owned
  candidate processes, preserve diagnostic summaries before temporary-state cleanup, and never wipe AVDs.
- Verify guest renderer and process KVM/render-device evidence on both APIs. Reject hardware claims
  contradicted by software renderer or mismatched device identity.
- Compare working candidates under matched conditions with three repetitions of the fixed workloads.
  Select by measured rendering/picker results; use a simpler stable option for ties. Report unsupported
  NVIDIA availability distinctly from an attempted emulator failure.
- Give cached ranking its own app/APK/flow/helper/pacing/configuration identity, distinct from the
  acceleration/cohort fingerprint. Invalidate after relevant behavior or animation changes and allow
  only explicitly provisional selection until recalibrated.
- Implement and test the invocation-scoped SDK-overlay harness in contracts/acceleration.md, then
  automate real fallback and expected total-failure cases on both APIs. Preserve existing network/guest
  watchdog handling and never count injected failures as ordinary measurement samples.

**Gate**: contracts/acceleration.md is satisfied on both APIs. GPU configuration experiments are
reported separately from like-for-like optimization speed comparisons.

### 3. Optimize shared interactions without erasing their assertions

- Prove deterministic replacement across empty, prefilled, secure, middle-cursor and partial-selection
  fields on the pinned driver before adopting a cheaper helper. Preserve the reliable fallback when a
  cheaper supported operation cannot meet that matrix.
- Separate launch from navigation; callers explicitly retain clear-state, restart and staged isolation.
  Reuse setup only where the acceptance inventory identifies it as incidental.
- Make progress start/terminal checks mandatory and observable. First evaluate guest animation scales.
  Preserve enough controlled pacing for progress/cancellation/background observations; shorten it only
  after reliable evidence. No validation-specific app UI.
- Run helper contract tests and affected real-form/SAF/progress flows on both APIs after each change.

**Gate**: replacement/isolation/progress regressions pass and no original claim becomes optional.

### 4. Reuse valid builds/fixtures and profile only remaining hotspots

- Assemble the debug x86_64 APK once before the API loop and install the same digest twice.
  Keep release smoke's full architectures/signing/update and connected tests unchanged.
- Benchmark Gradle daemon reuse independently; never clean automatically or stop foreign daemons.
- Validate immutable fixture versions/content before reuse, reset mutations, and keep original dataset sizes.
- Profile remaining scan polling and gallery/list scroll work. Implement only demonstrated bottlenecks:
  serialized polling/unchanged-state suppression, raw-offset refs or allocation reduction, as applicable.
  Add stale-response, unmount, terminal state, paging/sort/anchor/selection regressions for every change.
- Record deferred candidates and rejected alternatives with evidence.

**Gate**: retained changes have measured or explicitly documented tradeoff justification and unit proof.
No profile means no speculative production edit.

### 5. Complete after measurements and full acceptance

- Recalibrate viable renderer candidates against the final app/helper/workload/animation inputs.
  Require current `rankingFingerprint` evidence; do not carry an original-code ranking across tuning.
  If the best renderer changes, collect its matching original-code baseline from retained inputs.
- Run three matched after samples for every fixed workload/API; compare medians, absolute changes and
  percentages with incompatibility reasons where cohorts differ.
- Run the full existing workspace and all seven staged parts on both APIs against live services.
  Diff the acceptance inventory and required assertion evidence, not just flow counts.
- Test report sanitization with credential/content canaries; inspect the sanitized human report.
- Publish actual measurements and configuration in developer documentation, including zero/negative
  results and tradeoffs. Correct the stale timing estimate and Metro timeout guidance.

**Gate**: SC-001–005 and all constitution quality gates pass. Do not mark the feature complete from
hotspot runs alone. Release-smoke is additionally required if shared CLI/lifecycle/build changes affect it.

## Risks

| Risk | Mitigation |
| --- | --- |
| Hardware mode boots but uses the wrong GPU or software | Require renderer/device/process evidence and reject inconsistent identity. |
| Multiple startup attempts interfere with foreign resources | Full-run claim and per-candidate ownership before probing; fake-driven failure/signal tests. |
| Replacing field input is unreliable on one API | Runtime regression matrix and reliable existing fallback; zero gain is preferable to flaky proof. |
| Fast scan makes running state invisible | Mandatory assertions with controlled pacing and terminal evidence, never an optional no-op. |
| Fixture checking costs more than regeneration | Measure both; keep the simpler correct path where reuse does not help. |
| Changing renderer invalidates the comparison | Pre-change matched hardware cohort and a separate graphics-experiment report. |
| Reports leak Maestro input or hierarchy text | Numeric/known-ID allowlist, private raw artifacts and secret/content-canary tests. |
| Shared service cleanup hides audit failures | Explicit audit/restore for acquired and borrowed resources; preserve original failure status. |

## Complexity Tracking

| Added complexity | Requirement and justification | Simpler alternative rejected because |
| --- | --- | --- |
| Finite graphics candidate state and verified fallback | FR-005 requires best working Intel/NVIDIA option, automatic fallback and actual identity | A single forced renderer either fails on incompatible drivers or silently ignores working acceleration. |
| Invocation-scoped fault-check harness and SDK overlay | FR-005/009 require repeatable real-runtime fallback/exhaustion proof without touching host controls | Unit fakes alone do not demonstrate real fallback boot; manual global driver changes violate ownership and safety constraints. |
| Full-run and per-resource ownership records | FR-005 and concurrency edge cases prohibit foreign cleanup | Existing harness markers/emulator-only lock cannot distinguish the owner of services or failed attempts. |
| Versioned measurement/fixture metadata and small Node reporter | FR-002/003/007/012 require reproducibility, no double counting, safe reuse and fixed cohorts | Existence/count checks and free-form console timing cannot establish validity or comparable results. |

These are requirement-driven design costs, not waived constitution violations. No new dependency,
database entity, bridge API or permanent profiling framework is planned.
