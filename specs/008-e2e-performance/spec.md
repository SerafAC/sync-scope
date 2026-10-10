# Feature Specification: Faster E2E Validation Without Losing Proof

**Feature Branch**: `008-e2e-performance`

**Created**: 2026-10-10

**Status**: Draft (clarified; ready for planning)

**Input**: User description: "Analyse why e2e are so slow. Check if emulator is properly configured and
uses any hardware support it can. Check code if there are any suboptimal patterns used." Follow-up:
"Save this plan as the next spec draft. Move other uncompleted spec to next slots accordingly."

**Depends on**: [007-sort-scroll-remote-folders](../007-sort-scroll-remote-folders/spec.md), whose tasks
and real-device acceptance are complete, and the validation infrastructure delivered by features 002–006.

> This draft preserves the investigation and its prioritized recommendations. It does not claim that
> the optimizations are implemented or that their speedup has been measured. Complete planning before
> generating implementation tasks; clarified requirements take precedence over investigation recommendations.

## Context

The latest inspected successful workspace run completed 39 flows in 81.4 minutes on one API level.
Its seven staged flows added 6.2 minutes of flow execution, excluding process startup and host hooks.
Build, boot and fixture setup are outside those numbers. The default runner executes the full suite
sequentially on API 31 and API 36.

Most recorded time belongs to UI interactions and synchronization, not isolated scan execution. The
largest opportunities are repeated form entry, repeated app launches and folder picking, software
graphics, and progress animations that interfere with test synchronization. Application polling and
list rendering are secondary profiling candidates, not established primary causes.

The evidence and proposed work order are preserved in [analysis.md](./analysis.md). Historical timing
comments in the developer guide no longer describe the current suite; update them with new measured
results when this feature changes the validation workflow.

## Clarifications

### Session 2026-10-10

- Q: What measured speed improvement should be required before this feature is considered complete? → A: No fixed speedup target; a measured 0% gain is acceptable when faster alternatives would damage the test architecture or require disproportionate sacrifices, with evidence and tradeoffs recorded.
- Q: If hardware acceleration is unavailable or fails, should validation stop or be allowed to use software rendering? → A: Automatically report fallback, compare timings only between matching acceleration modes, and check both Intel and NVIDIA GPUs to select the best available working option.
- Q: May the validation build show a test-only static scan-progress indicator instead of the normal animated indicator? → A: No test-only progress UI; app-side progress changes must apply to normal builds too.
- Q: Which scenarios should be repeated for the before-and-after performance measurements? → A: Fix the hotspot set before changes: field/repository setup, launch/navigation, real folder picking, scan progress, and gallery/list scrolling, with three before-and-after repetitions per scenario on both APIs.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get trustworthy validation results sooner (Priority: P1)

As the developer, I want routine end-to-end validation to finish sooner without losing any proof that
the app can connect, pick folders, scan, browse, select and safely delete files on both supported APIs.

**Why this priority**: the long feedback cycle slows every subsequent feature, while deletion and
storage-access correctness cannot be traded for speed.

**Independent Test**: repeat the fixed hotspot scenarios three times before and after optimization on
each API, then run the complete workspace and staged flows on both APIs against live protocol services.

**Acceptance Scenarios**:

1. **Given** a recorded baseline and the same fixtures, host and API level, **When** the optimized
   validation runs, **Then** it reports the measured elapsed-time change without omitting acceptance
   scenarios; no gain is acceptable when evidence shows faster alternatives require unacceptable tradeoffs.
2. **Given** empty and prefilled repository fields, **When** a scenario replaces their values, **Then**
   the intended values are entered reliably regardless of initial cursor position.
3. **Given** an app that is already open, **When** a scenario only needs navigation, **Then** it avoids
   unnecessary relaunches while preserving the scenario's isolation requirements.
4. **Given** a short scan, **When** a scenario checks progress and completion, **Then** it observes the
   required state transitions rather than passing because the scan never started.
5. **Given** a deletion or storage-access acceptance scenario, **When** the optimized suite runs,
   **Then** it still acts on real device files and real storage grants, not mocked substitutes.

### User Story 2 - Use available emulator acceleration safely (Priority: P1)

As the developer, I want the validation emulator to use supported host acceleration and report its
actual mode, rather than silently running expensive software graphics or failing on unsupported drivers.

**Why this priority**: the host has working CPU and graphics acceleration, but the current runner forces
software graphics and a naive hardware-graphics switch crashes.

**Independent Test**: boot the validation configuration on both APIs, verify its actual CPU and graphics
acceleration, and run representative app, picker and scrolling scenarios.

**Acceptance Scenarios**:

1. **Given** the inspected host, **When** each validation emulator starts headlessly, **Then** supported
   CPU acceleration and the best available working graphics option are active and verifiable at runtime,
   considering both Intel and NVIDIA GPUs when exposed and usable.
2. **Given** unavailable or incompatible acceleration, **When** startup is attempted, **Then** the
   configuration automatically selects the next working option, including software graphics if needed,
   and clearly reports the fallback and its reason; if no option works, it fails with an actionable diagnostic.
3. **Given** an existing AVD or unrelated device, **When** acceleration is checked, **Then** the check
   does not erase its data, modify host security controls, or stop processes it does not own.

### User Story 3 - Know which optimizations actually help (Priority: P2)

As the developer, I want reproducible timings and focused profiles so I can prioritize verified
bottlenecks instead of refactoring application code on suspicion.

**Why this priority**: graphics configuration alone cannot account for all test-driver costs, and
profiling candidates should not become speculative production rewrites.

**Independent Test**: inspect a sanitized timing report that separates setup, test actions, waits and
application execution, with comparable before-and-after measurements.

**Acceptance Scenarios**:

1. **Given** nested test helpers, **When** durations are aggregated, **Then** child durations are not
   added again to their parents when calculating the overall command-time breakdown.
2. **Given** a polling or scrolling candidate, **When** profiling does not demonstrate a bottleneck,
   **Then** the candidate is deferred rather than changed without evidence.
3. **Given** changed launch or test instructions, **When** the feature is completed, **Then** the
   developer guide documents the actual configuration, workflow and measured timings.

### Edge Cases

- Hardware graphics is available but the default graphics API cannot initialize.
- A host has Intel and NVIDIA GPUs, but one graphics device is not exposed or its driver cannot initialize;
  nominal hardware presence does not establish an available working renderer.
- One API applies a larger minimum guest memory allocation than the requested value.
- A field is empty, prefilled, secure, partially selected, or focused in the middle of its text.
- A scan completes before the next test observation; progress checks must not silently become no-ops.
- A staged scenario intentionally continues existing state, while another scenario needs fresh state.
- Reduced animations affect accessibility, progress visibility or coordinate-based scrolling tests.
- A test-only static progress indicator would avoid synchronization overhead but would not exercise the
  normal app's progress UI; this alternative is excluded.
- A concurrent validation process owns a device, lock, service or port.
- Cold builds, warm builds, fixture generation and host power policy distort timing comparisons.
- Large-file fixtures are necessary for coverage and cannot simply be reduced to shorten the suite.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Validation MUST preserve every existing major acceptance claim on API 31 and API 36,
  including FTP, SFTP, WebDAV, real SAF access and real local deletion, as required by
  [D012](../../docs/decisions/0012-maestro-e2e-proof-bar.md).
- **FR-002**: Validation MUST record separate elapsed times for build, emulator startup, fixture setup,
  workspace flows and staged flows, without exposing credentials or user-generated content.
- **FR-003**: Timing comparisons MUST identify the host, API, fixture sizes, build-cache state,
  acceleration mode and relevant resource or power settings, and avoid nested-duration double counting.
  Speed comparisons MUST use matching CPU and graphics acceleration modes; actual GPU and renderer
  identities and any fallback MUST be recorded, with differing acceleration modes reported separately.
- **FR-004**: Shared interaction helpers MUST avoid redundant work while keeping deterministic field
  replacement, required state isolation and observable assertions.
- **FR-005**: Validation emulators MUST use supported CPU acceleration and select the best available
  working graphics option on the inspected host, checking both Intel and NVIDIA GPUs when available.
  Selection MUST be supported by successful runtime verification and comparable performance evidence,
  not GPU brand alone. Unavailable or incompatible options MUST trigger automatic fallback to the next
  working option, including software graphics if needed, with the actual mode and reason clearly reported.
  If no option works, validation MUST fail with an actionable diagnostic.
- **FR-006**: Changes to animations or synchronization MUST preserve progress, completion, cancellation
  and backgrounding assertions. They MUST NOT shorten validation by silently skipping assertions.
  Validation MUST exercise the same app-side progress UI as normal builds; test-only static progress
  indicators or other progress-UI substitutions are prohibited. App-side progress changes MUST apply
  to normal builds too; emulator animation settings may differ.
- **FR-007**: Build and fixture work MUST be reused where the same artifacts and fixture state remain
  valid, without weakening clean-state, mutation or staged-flow coverage.
- **FR-008**: Production polling or rendering changes MUST address measured bottlenecks and preserve
  scan state, paging, sorting, anchors, selection and stale-response behavior.
- **FR-009**: Changed helpers and production units MUST have deterministic regression tests; affected
  end-to-end scenarios and the complete suite MUST still pass on both APIs.
- **FR-010**: Developer-facing configuration, run instructions and timing guidance MUST be updated with
  the implemented behavior and measurements.
- **FR-011**: Optimization decisions MUST preserve the test architecture and existing proof requirements.
  Alternatives rejected for disproportionate complexity, maintenance cost or other sacrifices MUST have
  their evidence and tradeoffs recorded; a measured 0% speed gain is acceptable on that basis.
- **FR-012**: Before optimization changes, the representative measurement set MUST be fixed and its
  named scenarios recorded. It MUST cover field/repository setup, launch/navigation, real SAF folder
  picking, scan progress, and scrolling in both gallery and list views. Each selected scenario MUST
  run three times before and after changes on both APIs under comparable conditions; the set MUST
  NOT be changed after seeing results to omit unfavorable timings.

### Key Entities

- **Validation run**: one API's setup, complete workspace and staged scenarios, identified by its
  configuration and fixture set.
- **Timing baseline**: a comparable pre-change measurement with phase and command breakdowns.
- **Acceleration profile**: requested and verified CPU and graphics modes, plus any explicit fallback.
- **Acceptance inventory**: the existing scenarios and safety assertions that optimization must retain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On each API, the median elapsed time of the selected representative scenarios over three
  comparable runs is compared with their pre-change baseline; the report states absolute and relative
  changes for every scenario in the fixed hotspot set defined by FR-012. No fixed minimum speedup is
  required. A measured 0% gain is acceptable when the report demonstrates that faster alternatives
  would damage the test architecture or require disproportionate sacrifices, while all existing quality
  gates remain satisfied.
- **SC-002**: The complete existing workspace and all seven staged flows pass on both APIs, and the
  before-and-after acceptance inventory has no removed or silently skipped claims.
- **SC-003**: Both APIs boot headlessly with verified supported CPU acceleration and the best available
  working graphics option on the inspected host. Available Intel and NVIDIA options are checked;
  unsupported-mode checks demonstrate automatic, reported fallback or an actionable failure when no
  option works. Speed comparisons do not mix hardware-accelerated and software-rendered runs.
- **SC-004**: Field replacement regression cases pass for empty, prefilled and secure inputs and
  different cursor positions; progress, cancellation and backgrounding scenarios remain green while
  exercising the same app-side progress UI as normal builds.
- **SC-005**: A reproducible report accounts for the full run's phases and command costs without
  double counting or disclosing credentials.

## Assumptions

- This is an optimization of existing validation, not a new CI, remote testing service or benchmark
  framework. It does not waive any existing quality gate.
- The concrete optimization order in analysis.md is a planning input, not a guaranteed speedup.
- Full-loop release work stays in [011-full-loop-release](../011-full-loop-release/spec.md), and tree,
  preview and selection-survival work stays in [009-tree-view-image-preview](../009-tree-view-image-preview/spec.md).
- Both APIs remain required. Parallel API runs are not assumed; existing exclusive ownership remains
  unless a later plan justifies safe isolation.
- Host package installation, power-policy changes and destructive AVD operations require separate
  authorization. They are not implicitly authorized by saving this draft.
- A read-only check during clarification found accelerated Intel Arc OpenGL; NVIDIA's audio controller
  was exposed, but no NVIDIA graphics device was exposed and `nvidia-smi` found no supported GPU.
  NVIDIA emulator compatibility remains unverified; GPU availability MUST be rechecked during validation.
