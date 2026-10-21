---
description: "Dependency-ordered implementation tasks for faster Android E2E validation"
---

# Tasks: Faster E2E Validation Without Losing Proof

**Input**: Design documents in `specs/008-e2e-performance/`:
[spec.md](./spec.md), [plan.md](./plan.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md).

**Prerequisites**: Features 002–007 and the existing validation services/AVDs. No new project,
dependency, database migration or bridge version is required.

**Tests**: Required by FR-009 and constitution principles IV–V. Write deterministic regressions
before their fixes, observe the expected failure, then deliver passing tests with the implementation
in the same change. Device/network dependencies belong in E2E, not new unit tests.

**Organization**: Setup → shared foundation/baseline → US2 (P1 acceleration) → US1 (P1 faster
trustworthy validation) → US3 (P2 attribution/profiling) → final gates. The two P1 stories are ordered
this way to collect original-code hardware baselines before changing helpers/app/build/fixtures.
Their labels still match the specification.

## Format and paths

- Checklist format: `- [ ] T### [P?] [US#?] Description with file path`.
- `[P]` means different files with no unmet prerequisite within the stated parallel group.
- Story labels appear only in story phases. All paths are relative to the repository root.
- Ignored evidence paths below are local outputs, not committed credentials or uploaded artifacts.
- Task completion requires its stated validation, not merely a file edit or an attempted command.
- A conditional production optimization can close with an evidence-backed defer decision when its
  profile is negative. Required behavior, regression failures and missing acceptance cannot be deferred.

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Freeze scope, workload selection, acceptance claims and evidence policy before any tuning.

- [X] T001 Verify the pinned toolchain, API 31/36 AVDs, live protocol prerequisites and current resource ownership without changing host policy; record the source/dirty-input identity, known original software launch and authorization boundaries in `validation/evidence/performance/preflight.md`, following `specs/008-e2e-performance/quickstart.md`.
- [X] T002 [P] Create `validation/performance/hotspots.json` from the eight H01–H08 paths in `specs/008-e2e-performance/contracts/acceptance.md`, including ordered prerequisites, whole-flow boundaries, H08 gallery/list diagnostics, reset policy and fixture sizes; preserve the exact constraints "repetition count fixed at **3**, APIs fixed at **31 and 36**" and "All eight scenarios and both APIs must appear."
- [X] T003 [P] Capture the ordered 39 workspace entries, seven staged parts, mandatory assertions, protocol/API claims, mutation hooks and existing documented deviations from `validation/maestro/config.yaml` and `validation/maestro/staged/pairs.txt` in `validation/evidence/performance/acceptance-before.json`; preserve "`executed`, `failed`, `missing` and `pre-existing documented deviation`" and do not claim debug release-named flows prove signed installation/update.
- [X] T004 Establish private invocation/raw evidence directories and a baseline-input retention procedure in `docs/validation-performance.md`, using the already ignored `validation/evidence/performance/` area; retain runnable synthetic flow/helper inputs and the baseline APK when built, use restrictive access, keep credentials/full URLs/UI content out of published records, and never overwrite prior results.

**Checkpoint**: Workload subjects/boundaries and original claims are fixed. T002 and T003 may run
together after T001; T004 follows both. No app/helper/build/fixture/GPU optimization has started.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Safe shared ownership and observational measurement needed by every story.

**Blocking gate**: Complete T005–T014 before story implementation. These tasks may add observability
and required ownership safety, but must not optimize interactions, app behavior, build frequency,
fixture work or guest animation settings. Preserve the original software cohort rather than relabeling
a changed actual renderer as equivalent.

### Tests first

- [X] T005 [P] Add synthetic versioned-record, allowlist, elapsed-time, median/cohort and credential/content-canary tests in `scripts/validation/performance-report.test.mjs`; assert "Initial report version 1; unsupported versions fail validation.", "elapsed milliseconds must be finite and nonnegative", three original successful samples per side, explicit incompatible/missing rows and the zero-baseline diagnostic.
- [X] T006 [P] Build isolated recording SDK/ADB/emulator/Maestro/Docker/Metro/clock fakes and lifecycle tests in `scripts/validation/performance-runner.test.mjs`; cover legacy CLI/API defaults, lock rejection before services, acquired/borrowed resources, foreign serials, failed startup, timeouts/signals and all staged hooks without touching real hardcoded state paths.

### Shared records, ownership and baseline execution

- [X] T007 Implement invocation/API/sample records, allowlisted JSON/Markdown output, basic whole-flow medians and matched-cohort comparison in `scripts/validation/performance-report.mjs` per `specs/008-e2e-performance/data-model.md`; preserve "Unique opaque local identifier; never a credential or full user path.", "Stable pseudonymous ID, OS/kernel, CPU and tool/driver versions; no hostname/account name.", "Revision and dirty-input fingerprint, including flow/helper/app inputs; not just Git HEAD." and "Known sanitized category; no raw command, exception or environment dump.", with modes "`connected`, `e2e`, `release-smoke` or new `measure`", "`running`, `passed`, `failed` or `interrupted`; incomplete is never success", sample "`repetition` 1–3"/"`passed|failed|interrupted`" and APK/fixture identity; unknown metadata/schema and invalid durations must fail explicitly.
- [X] T008 Acquire a full-invocation claim before any shared setup and track partial acquisition, PID/serial identity and ownership through cleanup in `scripts/validation/android-flow.sh` and `scripts/validation/android-validator.sh`; preserve the emulator-exclusive lock, "`acquired|borrowed`" and "`unclaimed → acquired/borrowed → verified → released`", never select the first online emulator without identity proof, and never stop a foreign or merely attempted resource.
- [X] T009 Implement explicit acquired/borrowed lifecycle and scoped audits in `scripts/validation/protocol-service.sh`, `scripts/validation/protocol-services.sh` and `scripts/validation/metro-service.sh`; preserve prestarted connected-test services, do not tear down borrowed resources, register SFTP resume before pause, restore the remote recheck fixture on failure/signal, and preserve the original nonzero exit status.
- [X] T010 Add monotonic phase events and read-only actual-mode/resource metadata to `scripts/validation/android-flow.sh`, `scripts/validation/android-validator.sh` and `scripts/validation/protocol-service.sh`, consumed by `scripts/validation/performance-report.mjs`; separate build/services/boot/install/remote-and-device fixtures/workspace/staged/cleanup/other, split service seeding from inclusive setup, count shared work once, and record requested versus observed RAM without changing the original renderer or resource settings.
- [X] T011 Route every workspace/staged/hotspot Maestro invocation to an explicit private artifact directory using the pinned `--test-output-dir`/`--debug-output` support in `scripts/validation/android-flow.sh`; ingest known command metadata/statuses and mandatory assertion evidence in `scripts/validation/performance-report.mjs`, record missing artifacts/timeouts as failures, and never serialize `evaluatedCommand`, arbitrary argv/environment, screenshots, hierarchy text or raw logs.
- [X] T012 Add fixed `measure` execution and optional reporting/profile argument validation to `scripts/validation/android-flow.sh` per `specs/008-e2e-performance/contracts/validation-runner.md`; retain direct default API 31 and package alias API 31/36, schedule exactly three repetitions of H01–H08, restore independent prerequisites, reject arbitrary flow/tag/repetition/fixture overrides before setup, and preserve every failed sample; use the verified original software launch for baseline collection until US2 supplies candidate selection.
- [X] T013 Run `node --test scripts/validation/performance-report.test.mjs scripts/validation/performance-runner.test.mjs` and the affected existing script contracts, fixing failures before baseline execution; document the observational/ownership-only delta and runnable original-input retention in `docs/validation-performance.md`, with `scripts/validation/android-flow.sh` still preserving workspace order, staged continuations, connected/release behavior and baseline app/helper/fixture semantics.
- [X] T014 Capture H01–H08 three times on both APIs under the original actual software profile, then capture one complete original workspace-plus-staged two-API phase baseline using `scripts/validation/android-flow.sh`; store private samples, source/flow closure and original APK references in `validation/evidence/performance/before-software/` and `validation/evidence/performance/original-inputs/`, retaining failures and original build/fixture/resource settings; if a supported software request yields a different renderer, keep that experiment separate and complete the matching original-mode cohort.

**Checkpoint**: Foundation tests pass; original software samples and phase/claim evidence exist.
The historical 81.4-minute artifact alone does not satisfy T014. Diagnostic reruns never replace
unfavorable scheduled samples. If a baseline cannot run, stop before optimization and report the blocker.

---

## Phase 3: User Story 2, Use Available Emulator Acceleration Safely (Priority: P1)

**Goal**: Verified KVM/actual renderer selection, working Intel/NVIDIA routes when exposed,
evidence-based ranking, automatic reported fallback and owned-resource safety.

**Independent Test**: On both APIs, verify CPU/GPU/runtime identity and H03/H07/H08 behavior, retain
all H01–H08 calibration results, and demonstrate scoped fallback/actionable total failure without
changing host controls, AVD data or foreign resources.

### Tests first

- [X] T015 [P] [US2] Add discovery, profile/attempt-state, renderer verification, candidate ranking and fingerprint-invalidation tests in `scripts/validation/performance-acceleration.test.mjs`; cover Intel only, both exposed GPUs, NVIDIA audio only, inaccessible nodes, KVM/Vulkan failure, wrong GPU/software-under-host, RAM disagreement, software fallback and exhaustion; assert app/helper/pacing/animation changes invalidate ranking, unchanged inputs permit reuse, unrelated docs do not invalidate it, and stale evidence cannot pass final acceptance.
- [X] T016 [P] [US2] Extend `scripts/validation/performance-runner.test.mjs` with candidate-specific PID/serial cleanup, concurrent lock rejection, startup interruption and private diagnostic retention tests; assert no AVD wiping, host security/power/driver changes, foreign-process termination or borrowed-resource teardown, and verify connected/release CLI compatibility.

### Implementation and runtime evidence

- [X] T017 [US2] Discover currently exposed display/3D devices, accessible render nodes, installed emulator graphics modes and usable KVM in `scripts/validation/android-validator.sh`; check Intel and NVIDIA independently, classify audio-only NVIDIA as unavailable rather than attempted-incompatible, and record allowlisted capability/driver/image identities in `scripts/validation/performance-report.mjs`.
- [X] T018 [US2] Implement bounded, exclusively owned candidate boot attempts in `scripts/validation/android-validator.sh`, starting host OpenGL routes with `-gpu host -feature -Vulkan -accel on` and only verified per-process device selectors; preserve readiness/network/guest-watchdog handling and the unchanged resolution, density, RAM and vCPU request during comparison.
- [X] T019 [US2] Verify guest renderer/backend/device plus KVM/process/render-node identity in `scripts/validation/android-validator.sh` and emit attempt/profile records through `scripts/validation/performance-report.mjs`; preserve "discovered → claimed → starting → ready → verified → measured → selected" and "`unavailable`, `boot-failed`, `verification-failed` or `measurement-failed`", and never mark ambiguous identity or software rendering as verified hardware.
- [X] T020 [US2] Implement automatic graphics fallback in `scripts/validation/android-validator.sh`: try supported `swiftshader`, then `software`, then other advertised software backends only if needed, recording each actual backend and sanitized rejection reason; release only the failed candidate, reject unusable KVM for this CPU profile, and fail actionably/nonzero when no candidate works instead of assuming legacy `swiftshader_indirect` is supported.
- [X] T021 [US2] Integrate candidate calibration and ranking with the fixed `validation/performance/hotspots.json` execution in `scripts/validation/android-flow.sh` and `scripts/validation/performance-report.mjs`; collect three repetitions per candidate/API for all eight workloads, rank the H03/H07/H08 median subtotal with stability/regression tradeoffs and simpler-option tie-breaking, and label unmeasured fallback provisional rather than best-performing.
- [X] T022 [US2] Complete finite "`auto`, `host-opengl` or `software`" routing and actual-mode cohort identity in `scripts/validation/android-flow.sh` and `scripts/validation/performance-report.mjs`; implement separate `rankingFingerprint` over frozen workload, executed flow/helper closure, app/APK, fixtures, API/image/tools/drivers/exposed candidates, host power/resources, build/cache and guest/animation settings; invalidate changed ranking inputs but ignore unrelated docs/evidence, preserve legitimate declared app/helper changes in before/after cohorts, and mark stale selection provisional rather than best-performing.
- [X] T023 [US2] Run `node --test scripts/validation/performance-acceleration.test.mjs scripts/validation/performance-runner.test.mjs scripts/validation/performance-report.test.mjs` plus affected existing infrastructure tests and fix all failures before real candidate probes; preserve the runtime/test evidence in `validation/evidence/performance/acceleration-unit.md`.
- [X] T024 [US2] Before US1 changes, calibrate exposed working graphics routes and record verified profiles on API 31/36 via `scripts/validation/android-flow.sh`; capture matching original-app/original-helper H01–H08 baselines in `validation/evidence/performance/before-host/` for every selected actual renderer, preserve software controls, record unavailable NVIDIA truthfully, and retain all unsuccessful/regressed candidate results without changing fixtures/cache/resources.
- [X] T025 [US2] First add deterministic SDK/process/token/lock/probe-routing/exit-status/sanitization/cleanup tests in `scripts/validation/acceleration-fault-check.test.mjs`, then implement `scripts/validation/acceleration-fault-check.mjs` with the shared authoritative full-run claim and child-only SDK-overlay emulator wrapper specified in `specs/008-e2e-performance/contracts/acceleration.md`; pass tests before running both `--case hardware-fallback` and `--case all-options-fail` with `--api 31 --api 36`, record real software boot or expected nonzero validator exhaustion in separate sanitized `fault-check.json` outputs and `validation/evidence/performance/acceleration-fallback.md`, and assert no installed-SDK/global-driver/AVD/foreign-resource changes or ranking/timing use of injected samples.
- [X] T026 [US2] Enable verified ranked automatic selection for normal validation in `scripts/validation/android-flow.sh` and `scripts/validation/android-validator.sh`, reverify identity on every run, and exercise actual app/form/picker/gallery/list behavior on both APIs under the selected profile; store results in `validation/evidence/performance/acceleration-acceptance.md`, treating unexpected fallback as a new cohort instead of a hardware speed result.
- [X] T027 [US2] Check US2's exposed-device inventory, candidate timing rationale, selected CPU/GPU evidence, fallback diagnostics and resource ownership against `specs/008-e2e-performance/contracts/acceleration.md`; write the local acceptance decision in `validation/evidence/performance/us2-acceptance.md`, keeping missing calibration, ambiguous identities or unrun required probes as blockers.
- [X] T028 [US2] Update `DEVELOPMENT.md`, `docs/validation-performance.md`, `docs/architecture.md` and `CHANGELOG.md` with implemented acceleration/profile/ownership behavior and measured compatibility evidence; retain SDK resolution and authorization limits, describe NVIDIA unavailability versus compatibility, and add behavior changes under `Unreleased` without changing the version source.

**Checkpoint**: US2 works without helper/app optimization. Verified original-code hardware and
software cohorts are available before US1. A provisional fallback is not an evidence-backed
best-renderer claim. Full integrated suite acceptance remains required at T047 and T063.

---

## Phase 4: User Story 1, Get Trustworthy Validation Results Sooner (Priority: P1)

**Goal**: Less redundant field/navigation/animation/build/fixture work while retaining every
existing safety and storage claim.

**Independent Test**: Field, isolation and progress regressions pass on both APIs; all eight fixed
workloads have three comparable before/after samples per API; the complete original workspace and
seven staged parts still pass against live protocols and real SAF/deletion. No fixed speedup is required.

### Tests first

- [X] T029 [P] [US1] Add an injected field/selection/keyboard model and actual-helper contract tests in `scripts/validation/performance-helpers.test.mjs` covering empty/prefilled/secure/numeric fields, cursor start/middle/end, partial selection, missing Select all and roots longer than 128 characters; require exact ordinary values and synthetic-authentication evidence for secure values rather than exposing them.
- [X] T030 [P] [US1] Add launch/navigation contract regressions in `scripts/validation/performance-navigation.test.mjs` for already-open MainActivity, repository-seam Activity return, stopped/restart/grant-release callers and staged continuation; assert navigation-only helpers do not launch/reset and `validation/maestro/staged/08-changed-b.yaml` never launches.
- [X] T031 [P] [US1] Add scan-start/terminal/synchronization regressions in `scripts/validation/performance-progress.test.mjs` for never-started, fast-completed, failed, cancelled and backgrounded scans; assert required progress cannot become optional and disappearance alone cannot establish a new run, using synthetic state/generation observations rather than a real device.
- [X] T032 [P] [US1] Extend build/CLI/staged lifecycle tests in `scripts/validation/performance-runner.test.mjs` for one debug build/two installs, the supported emulator-only x86_64 override, unchanged release ABI/signing/update and connected behavior, Gradle policy accounting, preserved continuation state and failure restoration.
- [X] T033 [P] [US1] Add recording ADB/generator fixture-validity tests in `scripts/validation/performance-fixtures.test.mjs` for same-count corruption, stale generator/parameter fingerprints, failed seed markers, missing volumes and mutable-tree resets; enforce "A failed seed never leaves a valid marker" and "Same count with corrupt content is invalid" without accessing real storage.

### Implementation and affected acceptance

- [X] T034 [US1] Add real-form field replacement regression scenarios in `validation/maestro/performance/01-field-replacement.yaml` and register them after the original ordered entries in `validation/maestro/config.yaml`; extend `scripts/validation/validation-infrastructure.test.mjs` to require the original ordered 39-flow prefix plus the new regression rather than weakening original inventory checks, cover the T029 matrix on normal inputs, and keep the frozen H01–H08 subjects and real setup/authentication proof.
- [X] T035 [US1] Probe contextual Select all, overflow behavior where needed, empty detection, numeric/secure selection and actual replacement semantics on both APIs using `validation/maestro/performance/01-field-replacement.yaml`; record compatibility/timing in `validation/evidence/performance/field-selection.md` before adopting a cheaper helper, and reject unsupported `eraseText.all`, replace flags or Ctrl+A/End keys.
- [X] T036 [US1] Implement the verified one-focus/selection/replacement path and single keyboard hide in `validation/maestro/subflows/fill-field.yaml`, passing `scripts/validation/performance-helpers.test.mjs` and the real field matrix; never make missing selection/value assertions optional, and retain the original helper only if required regressions pass when a faster path is unsupported, otherwise fix correctness without claiming speed gain.
- [X] T037 [US1] Make `validation/maestro/subflows/open-sources.yaml` navigation-only and update its callers in `validation/maestro/subflows/setup-repository.yaml`, `validation/maestro/sources/01-add-internal.yaml`, `validation/maestro/sources/04-restart-persists.yaml`, `validation/maestro/sources/05-revoked-unavailable.yaml`, `validation/maestro/polish/08-add-large-folder.yaml` and every other discovered call site; callers must explicitly preserve MainActivity return, real restart/grant-release and staged lifecycle while avoiding duplicate launch for already-ready tabs; also fix the Settings load race (decision 2026-10-18): wait for the "Loading repository" and "Loading folders" indicators to clear before scrolling to `sources.add` in `open-sources.yaml` and `pick-folder.yaml`, and scroll to the new `sources.row.alias` row in `add-scan-source.yaml` before asserting it.
- [X] T038 [US1] Make `validation/maestro/subflows/start-scan.yaml` establish a new run/generation and expected terminal outcome for fast scans, and retain mandatory visible-progress proof for its running-state callers in `validation/maestro/scan/01-clean-scan-ftp.yaml`, `validation/maestro/scan/01-clean-scan-sftp.yaml`, `validation/maestro/scan/01-clean-scan-webdav.yaml` and `validation/maestro/scan/05-background-discards.yaml`; pass `scripts/validation/performance-progress.test.mjs` without sleeps or silent optional assertions.
- [X] T039 [US1] Benchmark reduced guest animation settings using owned runs through `scripts/validation/android-validator.sh`, preserving normal app progress UI, cancellation/backgrounding/a11y and scrolling; record separate configuration cohorts in `validation/evidence/performance/animations.md`, collect matching original-code settings from retained baseline inputs before adoption, and defer the change if the required evidence or assertions cannot be preserved.
- [X] T040 [US1] Reduce artificial scan pacing only if repeated both-API observations retain the required running/terminal/cancel/background transitions in `validation/maestro/scan/01-clean-scan-ftp.yaml`, `validation/maestro/scan/01-clean-scan-sftp.yaml`, `validation/maestro/scan/01-clean-scan-webdav.yaml` and `validation/maestro/scan/05-background-discards.yaml`; keep controlled pacing when necessary and document the retained/deferred choice in `validation/evidence/performance/scan-pacing.md`.
- [X] T041 [US1] Move debug assembly once before the API loop in `scripts/validation/android-flow.sh`, use the existing `-PreactNativeArchitectures=x86_64` override from `android/gradle.properties`, and install the same recorded APK digest on both APIs; preserve normal Gradle output validation and all release architecture/signing/update and connected-instrumentation paths rather than skipping builds because an APK exists.
- [X] T042 [US1] Benchmark healthy Gradle daemon reuse separately in `scripts/validation/android-flow.sh` and record task/cache/daemon outcomes in `validation/evidence/performance/build-reuse.md`; retain the simplest demonstrated policy, keep matched hotspot cache conditions, separate build-policy experiments from action speedups, and never implicitly clean or stop unrelated daemons.
- [X] T043 [US1] Add generator/parameter fingerprints and validated path/type/count/size/content/required-mtime checks for immutable `Bulk`, `GalleryBulk`, `Narrow`, `Scroll` and `DCIM/Big` sets in `scripts/validation/device-fixtures.sh`, reusing `scripts/validation/fixture-manifest.mjs` semantics where applicable; preserve "`unknown → validating → valid/reseed`" and "`seeding → valid` only after success", write completion markers outside scanned trees, replace count-only reuse, keep original dataset sizes, and compare validation cost against regeneration before retaining caching.
- [X] T044 [US1] Preserve resets/restoration for mutable gallery/deletion/TwoFolders and remote recheck fixtures in `scripts/validation/device-fixtures.sh`, `scripts/validation/android-flow.sh` and `scripts/validation/hooks/restore-recheck-file.sh`; reset before independent repetitions/APIs but never between staged continuation parts, preserve real removable-storage requirements, and pass `scripts/validation/performance-fixtures.test.mjs`.
- [X] T045 [US1] Run the new helper/navigation/progress/fixture/build tests and affected existing infrastructure contracts, then the real field/setup/SAF/restart/progress/cancel/background/gallery/list scenarios on both APIs via `scripts/validation/android-flow.sh` and the prepared pinned Maestro path; record passing assertion evidence in `validation/evidence/performance/us1-regressions.md` without inventing a runner `--flow` option or logging credential arguments.
- [X] T046 [US1] Exclude NVIDIA from automatic graphics discovery and candidate ranking for normal validation and measurement (decision 2026-10-20: NVIDIA dropped; no `nvx` calls), then recalibrate all remaining viable candidates (`host-intel-1`, `software-swiftshader`) on the current app/helper/pacing/configuration through `scripts/validation/android-flow.sh`, three H01–H08 repetitions per API/candidate, and require current `rankingFingerprint` evidence before claiming the best renderer; make `--graphics auto` the default for normal validation (`e2e:android` in `package.json` and/or `scripts/validation/android-flow.sh`) before this recalibration so the resulting rankings are current, and publish the fresh ranking store as `validation/evidence/performance/acceleration-ranking.json` (deferred from T026, decision 2026-10-18); reuse compatible calibration samples as after cohorts in `validation/evidence/performance/after-host/` and `validation/evidence/performance/after-software/`, collect a matching retained-original-input baseline if the winning renderer changes, and use `scripts/validation/performance-report.mjs` for medians/changes without dropping failures, pooling modes or equating ranking identity with cohort equality.
- [X] T047 [US1] Run `pnpm e2e:android` from `package.json` on the ranked automatic profile (NVIDIA excluded, decision 2026-10-20; the best of `host-intel-1` and `software-swiftshader` per API), including the complete workspace and all seven staged parts on API 31/36 against live FTP/SFTP/WebDAV and actual SAF/deletion; diff mandatory assertion evidence against `validation/evidence/performance/acceptance-before.json` and record `validation/evidence/performance/us1-acceptance.md`, requiring every original claim plus new regressions and successful audit/restoration.
- [X] T048 [US1] Update `DEVELOPMENT.md`, `docs/validation-performance.md` and `CHANGELOG.md` with implemented helper/progress/build/fixture behavior and the US1 measured tradeoffs, preserving zero-gain decisions and deferred alternatives; correct stale timing guidance using the new evidence and keep `Unreleased` entries with the corresponding behavior changes.

**Checkpoint**: US1 is independently validated on the US2 profiles, with all original claims intact.
This is the smallest useful delivery increment: foundation + required US2 acceleration + US1.
US3 may subsequently invalidate after samples if it changes production code; refresh only affected
evidence, and rerun final acceptance on the final tree.

---

## Phase 5: User Story 3, Know Which Optimizations Actually Help (Priority: P2)

**Goal**: Trustworthy command attribution, separately identified application profiles, measured-only
production edits and developer documentation of actual outcomes.

**Independent Test**: Inspect an allowlisted report reconciling wall phases and nonoverlapping command
costs, with separate app profiles, all fixed matched comparisons and evidence-backed defer decisions.
Changed app units preserve scan, stale-response, paging, sorting, anchors and selection behavior.

### Evidence gate before optional app edits

- [ ] T049 [US3] Profile bridge-read latency/concurrency, equal-DTO/context commits and progress-animation versus hierarchy-idle costs around `src/scan/ScanProvider.tsx` and `src/screens/ScanScreen.tsx` under repeated representative scans; write separate instrumented observations and retain/defer decisions in `validation/evidence/performance/profiles/scan.md`, excluding profiler runs from normal medians and proposing no test-only UI or event framework.
- [ ] T050 [US3] Profile React commits/anchor effects, frame stalls/FastScroller responsiveness and allocation/GC during H07/H08 around `src/screens/GalleryScreen.tsx`, `src/screens/ListScreen.tsx` and `src/files/usePagedQuery.ts`; record repeated evidence in `validation/evidence/performance/profiles/browse.md`, acknowledge existing per-segment placeholder caching, and identify only demonstrated offset/flattening/grid bottlenecks for subsequent edits.

### Tests first for report work and profile-positive units

- [ ] T051 [P] [US3] Extend `scripts/validation/performance-report.test.mjs` with flat `commands.json` wrapper/embedded-definition/retry/repeat fixtures, malformed/ambiguous records, missing artifacts, phase reconciliation, incomplete cohorts, both percentage signs and secret/content canaries; assert "embedded `runFlowCommand.commands` are definitions, not an additional list of executed samples" and that zero baseline duration produces a diagnostic, not infinity.
- [ ] T052 [P] [US3] If T049 demonstrates a polling bottleneck, add deferred-read/rejection, overlap/coalescing, equal-DTO/new-generation, unmount, terminal/error/interruption and cancel-by-ID regressions in `src/scan/__tests__/useScan.test.tsx` before changing the provider; otherwise record the evidence-backed defer in `validation/evidence/performance/profiles/polling-decision.md` without inventing a production change or waived test.
- [ ] T053 [P] [US3] For profile-positive units only, add offset/anchor-boundary, folder-offset, hidden-view restore, paging/sort/selection/stale-response and progress-accessibility regressions in `src/screens/__tests__/GalleryScreen.test.tsx`, `src/screens/__tests__/ListScreen.test.tsx`, `src/files/__tests__/usePagedQuery.test.tsx` and `src/screens/__tests__/ScanScreen.test.tsx`; document unmeasured/negative candidates in `validation/evidence/performance/profiles/ui-test-scope.md`, not speculative edits.

### Attribution, conditional implementation and results

- [ ] T054 [US3] Complete leaf command-category aggregation, inclusive-but-nonadditive helper diagnostics, wall-phase reconciliation and the final JSON/Markdown comparison in `scripts/validation/performance-report.mjs`; process executed flat records once, count actual retry instances, keep app execution separately profiled, include H01–H08/API rows even when incomplete, and preserve `after − before` and `(before − after) / before × 100` with explicit incompatible/unknown metadata and rejected-alternative evidence.
- [ ] T055 [US3] Only if T049/T052 justify it, serialize/coalesce slow polling and suppress genuinely unchanged semantic updates in `src/scan/ScanProvider.tsx`, preserving terminal/error/interruption, foreground refresh, new generation and unmount behavior; pass `src/scan/__tests__/useScan.test.tsx`, or close the candidate with a concrete defer rationale in `validation/evidence/performance/profiles/scan.md`.
- [ ] T056 [US3] Only for bottlenecks established by T050/T053, reduce raw-offset state/anchor work or residual result-sized allocations in `src/screens/GalleryScreen.tsx`, `src/screens/ListScreen.tsx` and `src/files/usePagedQuery.ts`; retain thumb/visible-row semantics, folder-first offsets, placeholder lengths/keys, sorting/anchors/selection and generation/query invalidation, passing the corresponding tests or recording the measured defer in `validation/evidence/performance/profiles/browse.md`.
- [ ] T057 [US3] Only if T049/T053 demonstrate that synchronization alone cannot address progress animation cost without losing proof, make a narrowly scoped accessible progress change in `src/screens/ScanScreen.tsx` that applies identically to normal and validation builds; pass `src/screens/__tests__/ScanScreen.test.tsx` and actual progress/completion/cancel/background flows, otherwise record defer in `validation/evidence/performance/profiles/scan.md`; test-only static indicators/build branches are prohibited.
- [ ] T058 [US3] Run the affected Jest paths from `specs/008-e2e-performance/quickstart.md`, `pnpm lint`, `pnpm typecheck` and script-report tests, plus `pnpm test:android:unit` if native code changed, then affected scan/gallery/list real flows on both APIs; retain results in `validation/evidence/performance/us3-regressions.md` and remove temporary profiling hooks before normal after measurements.
- [ ] T059 [US3] After retained T055–T057 changes, recalibrate viable candidates on the current app/helper/pacing/animation inputs through `scripts/validation/android-flow.sh`, require current `rankingFingerprint`, and refresh invalidated after cohorts with three H01–H08 repetitions per API/matched profile, reusing eligible calibration samples; if the winner changes, collect its retained-original-input baseline before running `node scripts/validation/performance-report.mjs --before validation/evidence/performance/before-host --after validation/evidence/performance/after-host --output validation/evidence/performance/comparison.json` and applicable software comparisons, retaining failures and separate cross-mode experiments.
- [ ] T060 [US3] Write the sanitized local final measurement/tradeoff summary in `docs/validation-performance.md` and implemented commands/current timings in `DEVELOPMENT.md`; link private synthetic evidence by safe identifiers, show separate setup/action/wait/app-profile costs without double counting, retain all zero/regressed/deferred candidates, and do not publish raw logs, full URLs, credentials or user content.

**Checkpoint**: US3 distinguishes automation costs from measured app execution, and every retained
production edit has deterministic and real-runtime proof. Negative profiles result in documented
deferral, not an event/paging/scan rewrite. No instrumented timing sample joins a normal cohort.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Verify the final integrated tree, documentation and all required evidence.

- [ ] T061 Run `pnpm test:ci` from `package.json`, all new `scripts/validation/performance-*.test.mjs` tests and `scripts/validation/acceleration-fault-check.test.mjs`, fixing failures and skipped changed-unit regressions; run `pnpm test:android:unit` when native code changed, and store an accurate final local/unit gate summary in `validation/evidence/performance/final-unit-gates.md`.
- [ ] T062 Run `pnpm lint` with zero warnings and `pnpm typecheck` from `package.json`, check shell syntax for every changed `scripts/validation/*.sh` file and inspect the final diff for unintended host/package/ABI/schema/bridge changes; record results in `validation/evidence/performance/final-static-gates.md`.
- [ ] T063 Reject stale/provisional ranking evidence before final acceptance: selected profiles must have `rankingFingerprint` matching the final executed app/helper/workload/configuration; run `pnpm e2e:android` on that code/profile, record disjoint phases and actual identity in `validation/evidence/performance/final-acceptance/`, and verify the original 39 entries plus regressions, seven staged parts, both APIs, live protocols and real SAF/deletion against `validation/evidence/performance/acceptance-before.json`, with no optionalized claims, failed audits/restoration or injected fault samples.
- [ ] T064 Run `pnpm e2e:android:release-smoke` for the shared CLI/lifecycle/build changes, retaining signed standalone/install/update proof and release architecture policy; write sanitized results in `validation/evidence/performance/final-release-smoke.md` rather than counting debug workspace release-named flows as release proof.
- [ ] T065 [P] After final runtime evidence, update `docs/architecture.md`, `docs/README.md`, `docs/validation-performance.md` and `DEVELOPMENT.md` to match the final runner/ownership/reuse/profiling behavior, actual measured timings and real Metro/validation limits; update `README.md` only for normal-build user-visible changes, linking developer detail instead of duplicating it.
- [ ] T066 [P] Audit `CHANGELOG.md` for all behavior/tooling changes under `Unreleased`, verify `package.json` remains the authoritative version without an unrequested release bump, and check report allowlists and evidence ignore/access policy against `specs/008-e2e-performance/plan.md`; final documentation consistency is checked at T067 after T065.
- [ ] T067 Execute the full walkthrough in `specs/008-e2e-performance/quickstart.md` using still-valid gate evidence where inputs match, verify SC-001–005 and FR-001–012 against this task list and local reports, and write `validation/evidence/performance/completion.md` with counts/profiles/timings/zero-gain tradeoffs and accurate remaining blockers; do not mark the feature complete while comparisons, original claims or required tests remain missing/failed.

**Checkpoint**: All constitution gates pass on the final code. Artifact/report checks cannot substitute
for actual full E2E. A zero gain needs recorded tradeoffs, not a waived quality gate.

---

## Dependencies & Execution Order

### Phase and story graph

```text
Setup T001–T004
    ↓
Foundation + original software baseline T005–T014
    ↓
US2: verified acceleration + original hardware baseline T015–T028 (P1)
    ↓
US1: interaction/build/fixture changes + matched after + full proof T029–T048 (P1)
    ↓
US3: attribution/profiles + conditional app changes + refreshed after T049–T060 (P2)
    ↓
Final integrated gates and documentation T061–T067
```

- **Setup**: T001 first; T002/T003 are independent; T004 follows both.
- **Foundation**: T005/T006 can start together after Setup. T007 follows T005; T008 follows T006;
  T009 follows T008; T010 requires T007–T009; T011 follows T010; T012 follows T002/T011;
  T013 follows all shared changes; T014 requires passing T013. No optimization before T014.
- **US2**: T015/T016 are independent after T014. Discovery T017 precedes launch T018 and verification
  T019; fallback T020 follows ownership/verification; calibration T021 and cohort integration T022
  precede unit gate T023. T024 captures original-code working-profile baselines; T025 verifies
  fallback only after its own harness tests and implementation pass; T026 enables ranked default;
  T027/T028 close proof and docs.
- **US1**: T029–T033 can start together after US2. T034/T035 precede replacement T036.
  Navigation T037 depends on T030; progress T038 depends on T031; animation/pacing T039/T040
  require affirmative progress and compatible baselines. Build T041/T042 depends on T032 and
  fixture T043/T044 on T033. T045 validates retained changes; T046 collects matched after;
  T046 also recalibrates current ranking and captures any newly required matched baseline before its
  comparisons; T047 runs the full suite; T048 closes documentation.
- **US3**: T049/T050 establish profiles before optional production edits. T051–T053 can proceed
  independently after those evidence gates; T054 follows T051, T055 follows T049/T052,
  T056 follows T050/T053, and T057 follows T049/T053. T058 validates retained edits, T059 refreshes
  ranking and invalidated after evidence, collecting a newly selected renderer's original baseline
  before comparison; T060 completes attribution/guide.
- **Polish**: T061–T064 require all story checkpoints. T065/T066 may proceed together after final
  runtime evidence; T067 follows both and all final gates.

Story independence means each checkpoint has its own acceptance test, not that shared runtime
ownership or baseline dependencies can be ignored. Run real devices/services/API candidates
sequentially. Do not parallelize tasks that edit the same file, operate the same guest, own services
or mutate shared fixtures.

### Critical invariants

1. Freeze H01–H08 before results; do not change subjects, fixture sizes, prerequisites or boundaries
   to hide poor timings. Source/helper/flow fingerprints record the declared optimization separately
   from the stable workload-definition fingerprint.
2. Three original successful scheduled samples per side are required for each scenario/API/actual-mode
   median. A failed cohort stays incomplete; diagnostic reruns are separate.
3. T024 precedes T036–T044. GPU configuration experiments are separate; software-before/hardware-after
   is never reported as a matched optimization gain.
4. A changed animation/resource/cache policy requires a compatible original-code cohort, using retained
   runnable baseline inputs without discarding user changes. If unavailable, defer the tuning or keep
   its comparison explicitly incomplete; do not infer a baseline.
5. Staged first parts alone clear state; hooks preserve continuation state and `08-changed-b` never
   launches. Failure cleanup resumes/restores/audits only acquired or authorized scoped resources.
6. Production profile candidates are conditional; final proof/report/documentation tasks are not.
   Tests and behavior documentation ship with their corresponding implementation, not in a later
   unrelated change with failing tests left behind.
7. Ranking freshness and cohort comparability are different identities. App/helper/pacing/animation
   changes require current-code candidate recalibration; final best-renderer claims require a matching
   `rankingFingerprint`. Declared optimization input changes do not make a matched cohort incompatible.
8. T025's SDK overlay/token wrapper exists only in its child validator environment. Capability probes
   pass through, software-fallback proof boots the real emulator, expected exhaustion preserves the
   validator's failure, and injected results never enter calibration or before/after samples.

## Parallel Examples

### US2, after T014

```text
T015: Discovery/verification/ranking fakes in scripts/validation/performance-acceleration.test.mjs
T016: Candidate ownership/lifecycle fakes in scripts/validation/performance-runner.test.mjs
```

The two test files are independent. Runtime candidate calibration/fallback is not parallel.

### US1, after T028

```text
T029: Field model in scripts/validation/performance-helpers.test.mjs
T030: Navigation model in scripts/validation/performance-navigation.test.mjs
T031: Progress model in scripts/validation/performance-progress.test.mjs
T032: Build/lifecycle cases in scripts/validation/performance-runner.test.mjs
T033: Fixture cases in scripts/validation/performance-fixtures.test.mjs
```

Once tests are ready, replacement/navigation/progress YAML and runner changes still require scheduling
around shared helper/caller files. No implied parallel editing of `android-flow.sh`.

### US3, after T049/T050

```text
T051: Command/report fixtures in scripts/validation/performance-report.test.mjs
T052: Profile-positive polling regressions in src/scan/__tests__/useScan.test.tsx
T053: Profile-positive screen/paging regressions in src/screens/__tests__/ and src/files/__tests__/
```

T052/T053 need their positive profile evidence. A negative profile closes the candidate via a documented
defer decision; it does not create unnecessary code/tests. Keep profile instrumentation and runtime
measurements serialized and out of normal timing cohorts.

## Requirement Coverage

| Requirement / success criterion | Principal tasks |
| --- | --- |
| FR-001, SC-002 | T003, T006, T009, T011, T030–T031, T037–T038, T044–T047, T063–T064 |
| FR-002, SC-005 | T005, T007, T010–T014, T022, T046, T051, T054, T059–T060, T063 |
| FR-003 | T001, T005, T007, T010, T014, T019, T021–T024, T039, T042, T046, T051, T054, T059 |
| FR-004, SC-004 | T029–T031, T034–T040, T045, T047, T053, T057–T058, T063 |
| FR-005, SC-003 | T001, T006, T008–T009, T015–T028, T046, T059, T063 |
| FR-006 | T031, T038–T040, T045, T049, T053, T057–T058, T063 |
| FR-007 | T032–T033, T041–T044, T045, T062–T064 |
| FR-008 | T049–T050, T052–T053, T055–T058 |
| FR-009 | T005–T006, T013, T015–T016, T023, T029–T033, T045, T047, T051–T053, T058, T061–T064 |
| FR-010 | T004, T013, T028, T048, T060, T065–T066 |
| FR-011, SC-001 | T021, T024, T035–T036, T039–T040, T042–T043, T046, T048–T060, T067 |
| FR-012 | T002, T005, T012, T014, T021, T024, T046, T059, T067 |

## Implementation Strategy

### Smallest useful delivery

1. Complete Setup/Foundation and capture the real original software baseline.
2. Complete US2 so hardware selection is safe and original-code hardware cohorts exist.
3. Complete US1, its three matched after repetitions and complete two-API proof.
4. Apply the relevant final gates/documentation tasks before merging that increment. No minimum gain,
   but no missing original claim, failed changed-unit test or undocumented tradeoff.

US1 alone without safe ownership, measurement foundation and working-profile baselines is not a valid
MVP for this feature. US3 adds attribution and only evidence-justified production work.

### Incremental delivery

- Each changed unit carries its deterministic regression and affected E2E evidence.
- Keep source/runtime profile identity and comparison provenance explicit after every retained change.
- Stop at failed baseline, ownership, field, progress or acceptance checkpoints; fix the blocker
  rather than removing its assertion or shrinking fixtures.
- Reuse valid evidence only when code/configuration/fixtures have not invalidated it.
- Run final full workspace/staged acceptance on the final integrated tree, and release smoke for
  the shared runner/lifecycle/build changes.
- No automatic host installation, driver/power/security change, destructive AVD operation, external
  upload or Git publication is part of these tasks.
