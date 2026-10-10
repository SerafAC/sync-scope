# E2E Performance Analysis and Prioritized Work

**Recorded**: 2026-10-10
**Status**: Investigation complete; implementation recommendations only
**Specification**: [spec.md](./spec.md)

## Measured baseline

The latest inspected complete successful Maestro workspace artifact,
`~/.maestro/tests/2026-10-09_012028`, contains 39 flows and no failed commands. Its elapsed workspace
time is 81.4 minutes on one API. The subsequent seven successful staged flow artifacts from
`2026-10-09_024204` through `2026-10-09_024854` total 373.4 seconds (6.2 minutes) of flow execution.
Host hooks, process startup, emulator boot, build and fixture setup are additional.

Command durations below exclude parent `runFlow`, `repeat` and retry wrappers so nested durations are
not counted twice. Leaf command time totals 4,744.8 seconds; it is not identical to workspace wall time.

| Command category | Seconds | Share of leaf command time |
| --- | ---: | ---: |
| Taps, including synchronization | 2,307.2 | 48.6% |
| Assertions and condition waits | 939.4 | 19.8% |
| Text deletion | 574.2 | 12.1% |
| Text entry | 199.4 | 4.2% |
| Scroll-to-element | 189.6 | 4.0% |
| App launches | 144.9 | 3.1% |
| Keyboard hiding | 131.9 | 2.8% |
| Explicit animation waits | 95.2 | 2.0% |

These are automation command costs, not isolated application execution times. In a sample of ten
picker/scan taps, the median interval between the tap log and "Tap aimed via settled hierarchy" is
0.918 seconds, illustrating synchronization overhead even before the remaining action work.

Additional measurements:

- 72 app launches, including 31 with clear state.
- 54 `fill-field.yaml` calls: 1,262.8 seconds total, median 23.1 seconds.
- 108 `eraseText: 128` commands: median 5.18 seconds each.
- 35 `pick-folder.yaml` calls: 768.2 seconds total, median 22.0 seconds.
- Eight `setup-repository.yaml` calls: 1,141.7 seconds total, median 142.9 seconds.
- These helper totals overlap where helpers call one another; do not add them to the leaf totals or
  sum overlapping helpers as independent costs.
- Three clean-scan flows set a 4,000 ms per-file delay over seven files, deliberately adding at least
  84 seconds per API.

The default runner runs the full workspace and staged scenarios sequentially on API 31 and API 36.
Historical estimates of a 55-minute run are no longer representative of the inspected current suite.

## Host and emulator findings

- Host CPU: Intel Core Ultra 9 185H, 22 logical CPUs, VT-x available.
- `emulator -accel-check`: KVM installed and usable.
- Both AVDs: x86_64, four virtual CPUs, 1080 × 2340 at 440 dpi.
- Current launch flags in `scripts/validation/android-validator.sh` force software graphics:
  `-gpu swiftshader_indirect -memory 2048`.
- The saved pre-investigation hardware configuration also identifies SwiftShader on both AVDs.
- The API 36 runtime allocates approximately 2.5 GiB despite the 2 GiB request; requested memory must
  not be confused with the observed allocation.
- Window and transition animation scales are 1.0; animator duration is unset rather than explicitly
  disabled.
- Host graphics: Intel Arc, accelerated Mesa OpenGL, render node accessible to the current user.
- Host Vulkan loader is installed, but the `vulkan-intel` package and Intel driver manifest are absent.
- Host storage is NVMe. At inspection, host load and memory pressure did not show a major bottleneck,
  and the short memory sample showed no ongoing host swap-in/out.
- CPU governor is `powersave`, energy preference `power`. This is a profiling variable, not proof of
  throttling or permission to alter host policy.
- Four virtual CPUs are a reasonable starting point; assigning every host CPU is not automatically
  faster. Guest memory and lower rendering resolution should be benchmarked before changing them.

### Runtime acceleration checks

A read-only API 31 boot using `-gpu host -accel on` failed with
`VK_ERROR_INITIALIZATION_FAILED` and "No physical devices available."

Read-only headless boots succeeded on **both API 31 and API 36** with:

```text
-gpu host -feature -Vulkan -accel on
```

Their guest renderer reported the Android Emulator OpenGL ES Translator over Mesa Intel Arc.
The emulator processes held `/dev/dri/renderD128`, `/dev/kvm`, a KVM VM handle and four KVM vCPU
handles. Both diagnostic instances were stopped; no project code or runner configuration was changed.

This verifies compatibility, not the E2E speedup. Simply changing to `-gpu host` without handling the
Vulkan failure would break startup. Installing a host driver is a separate authorized operation; the
verified OpenGL configuration works without it.

## Proposed work order

### 1. Fix expensive form replacement and redundant launches

- `validation/maestro/subflows/fill-field.yaml` taps and erases each field twice, hides the keyboard
  twice and repeats visibility handling. The second cycle compensates for arbitrary cursor placement.
- Investigate deterministic select-all-and-replace or an equivalent cursor-independent operation.
  Clear only when needed, and retain empty, prefilled, secure-input and editing regression coverage.
- `subflows/open-sources.yaml` relaunches the app even after callers have already launched it.
  Separate launch from navigation rather than removing scenario isolation indiscriminately.
- Avoid repeated full setup in unrelated scenarios where a proven setup can safely be reused. Keep
  dedicated real-form and real-SAF coverage on both APIs; D012 forbids replacing it with mocks.

### 2. Enable verified hardware graphics

- Use the working headless hardware-graphics configuration above, with explicit CPU acceleration.
- Report the actual renderer and acceleration status. Specify a clear failure or explicit fallback
  policy instead of silently accepting software rendering.
- Compare representative form, picker, gallery and scrollbar scenarios before claiming a gain.
- Profile guest memory and display resolution only if necessary. Several scrolling flows use
  coordinates and API-specific layouts, so a resolution change needs corresponding validation.

### 3. Reduce avoidable animation and synchronization overhead

- Benchmark reduced platform animations in the validation environment, preserving assertions that
  prove progress, cancellation, backgrounding and scrolling.
- `src/screens/ScanScreen.tsx` uses an indeterminate progress bar. The clean-scan flows document that
  hierarchy snapshots can wait up to ten seconds for the UI to idle.
- Improve progress synchronization or consider a static test-mode indicator, then reduce the artificial
  scan pacing if required progress can still be observed reliably.
- Do not replace state-based assertions with unconditional sleeps or remove the required progress check.

### 4. Reuse builds and valid fixture work

- `scripts/validation/android-flow.sh` assembles the debug APK inside the API loop and uses
  `--no-daemon`. Consider assembling once before the loop and reusing a healthy build daemon.
- `android/gradle.properties` builds four ABIs; an emulator-only build can target x86_64, while
  distributable release builds must retain their required architectures.
- Bulk (20,000 files) and GalleryBulk (2,000 images) are regenerated every run, including modes or
  selected flows that may not consume them. Preserve deterministic fixture validity and restore
  mutated files; do not reduce acceptance datasets simply to shorten the run.
- Existing caching of Scroll and DCIM/Big is useful. Any expanded reuse needs a reliable fixture
  version/validity check, not merely assuming stale data is correct.
- Parallel APIs are not the initial optimization: the runner currently uses shared locks, ports,
  services and mutable fixtures, which would need deliberate isolation first.

### 5. Profile application polling and list rendering

These are secondary candidates, not demonstrated primary causes:

- `src/scan/ScanProvider.tsx`: asynchronous polling every 500 ms can overlap when reads are slow;
  fresh run/active objects update context on every poll. Consider serialized reads and avoiding
  unchanged state updates, or events if justified by measured results.
- `src/screens/GalleryScreen.tsx` and `ListScreen.tsx`: scroll offsets enter React state every 32 ms,
  causing screen renders and anchor effects. Profile keeping raw offsets in refs and updating anchors
  only when the visible row changes.
- `src/files/usePagedQuery.ts` and `GalleryScreen.galleryGrid`: page changes rebuild result-sized
  placeholder/grid arrays even though rendering is virtualized. Investigate only if allocations or
  rendering profiles show a material bottleneck.
- Preserve generation guards, sorting, anchors and selection semantics. Selection survival across
  automatic refresh remains owned by the tree/preview draft, not this optimization.

The native scan already avoids obvious per-file database work: one explicit-projection SAF query per
directory, in-memory matching, and 500-row insert batches. No broad scan-engine rewrite is justified
by the present evidence.

## Validation approach for planning

1. Capture comparable baselines, including build/boot/seed/workspace/staged phases and actual renderer.
2. Repeat representative scenarios three times before and after each major optimization on each API.
3. Run deterministic regression tests for changed helpers and production units.
4. Run the complete workspace and staged scenarios on both APIs against live protocol services.
5. Compare the acceptance inventory and publish sanitized measurements and current developer guidance.

The investigation did not execute a new full E2E run, measure an optimization speedup, or implement
any recommendation. No absolute speedup is promised by this draft.
