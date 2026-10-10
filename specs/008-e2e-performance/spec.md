# Feature Specification: Faster E2E Validation Without Losing Proof

**Feature Branch**: `008-e2e-performance` (proposed; no branch created)

**Created**: 2026-10-10

**Status**: Draft (saved from the E2E performance analysis; not clarified or planned)

**Input**: User description: "Analyse why e2e are so slow. Check if emulator is properly configured and
uses any hardware support it can. Check code if there are any suboptimal patterns used." Follow-up:
"Save this plan as the next spec draft. Move other uncompleted spec to next slots accordingly."

**Depends on**: [007-sort-scroll-remote-folders](../007-sort-scroll-remote-folders/spec.md), whose tasks
and real-device acceptance are complete, and the validation infrastructure delivered by features 002–006.

> This draft preserves the investigation and its prioritized recommendations. It does not claim that
> the optimizations are implemented or that their speedup has been measured. Complete specification
> clarification and planning before generating implementation tasks.

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

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Get trustworthy validation results sooner (Priority: P1)

As the developer, I want routine end-to-end validation to finish sooner without losing any proof that
the app can connect, pick folders, scan, browse, select and safely delete files on both supported APIs.

**Why this priority**: the long feedback cycle slows every subsequent feature, while deletion and
storage-access correctness cannot be traded for speed.

**Independent Test**: compare representative scenarios before and after optimization, then run the
complete workspace and staged flows on both APIs against live protocol services.

**Acceptance Scenarios**:

1. **Given** a recorded baseline and the same fixtures, host and API level, **When** the optimized
   validation runs, **Then** it records a shorter elapsed time without omitting acceptance scenarios.
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
   CPU and graphics acceleration are active and verifiable at runtime.
2. **Given** unavailable or incompatible acceleration, **When** startup is attempted, **Then** the
   configuration either fails with an actionable diagnostic or reports an explicitly chosen fallback.
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
- One API applies a larger minimum guest memory allocation than the requested value.
- A field is empty, prefilled, secure, partially selected, or focused in the middle of its text.
- A scan completes before the next test observation; progress checks must not silently become no-ops.
- A staged scenario intentionally continues existing state, while another scenario needs fresh state.
- Reduced animations affect accessibility, progress visibility or coordinate-based scrolling tests.
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
- **FR-004**: Shared interaction helpers MUST avoid redundant work while keeping deterministic field
  replacement, required state isolation and observable assertions.
- **FR-005**: Validation emulators MUST use supported CPU and graphics acceleration on the inspected
  host; unsupported configurations MUST produce actionable diagnostics or an explicit fallback.
- **FR-006**: Changes to animations or synchronization MUST preserve progress, completion, cancellation
  and backgrounding assertions. They MUST NOT shorten validation by silently skipping assertions.
- **FR-007**: Build and fixture work MUST be reused where the same artifacts and fixture state remain
  valid, without weakening clean-state, mutation or staged-flow coverage.
- **FR-008**: Production polling or rendering changes MUST address measured bottlenecks and preserve
  scan state, paging, sorting, anchors, selection and stale-response behavior.
- **FR-009**: Changed helpers and production units MUST have deterministic regression tests; affected
  end-to-end scenarios and the complete suite MUST still pass on both APIs.
- **FR-010**: Developer-facing configuration, run instructions and timing guidance MUST be updated with
  the implemented behavior and measurements.

### Key Entities

- **Validation run**: one API's setup, complete workspace and staged scenarios, identified by its
  configuration and fixture set.
- **Timing baseline**: a comparable pre-change measurement with phase and command breakdowns.
- **Acceleration profile**: requested and verified CPU and graphics modes, plus any explicit fallback.
- **Acceptance inventory**: the existing scenarios and safety assertions that optimization must retain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On each API, the median elapsed time of the selected representative scenarios over three
  comparable runs is lower than their pre-change baseline; the report states absolute and relative gains.
- **SC-002**: The complete existing workspace and all seven staged flows pass on both APIs, and the
  before-and-after acceptance inventory has no removed or silently skipped claims.
- **SC-003**: Both APIs boot headlessly with verified hardware acceleration on the inspected host;
  unsupported-mode checks yield an explicit diagnostic or documented fallback.
- **SC-004**: Field replacement regression cases pass for empty, prefilled and secure inputs and
  different cursor positions; progress, cancellation and backgrounding scenarios remain green.
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
