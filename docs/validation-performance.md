# Validation performance evidence

## Current boundary

Feature 008 foundation adds observational reporting, private artifact routing and resource-ownership
safety. It does **not** optimize app behavior, interactions, builds, fixtures or guest settings, or
establish a timing baseline merely by passing unit tests.
The runner accepts `connected`, `e2e`, `release-smoke` and `measure`, repeated `--api` arguments,
`--report-dir`, and `--graphics auto|host-opengl|software`. Direct invocation still defaults to API 31;
`pnpm e2e:android` still requests API 31 followed by 36 and, without `--graphics`, keeps the original
**legacy launch request** (`-gpu swiftshader_indirect`), reported as software, until T046 makes
`--graphics auto` the default after the T037 Settings flow-race fix. `swiftshader_indirect` is
only that baseline reproduction, never a fallback.

US2 (verified acceleration) is implemented; see [Graphics acceleration](#graphics-acceleration-us2)
for the selection, fallback and ownership behavior and its measured compatibility evidence.
Existing acceptance instructions remain in [DEVELOPMENT.md](../DEVELOPMENT.md).

The authorized recovery collects separately per API to respect Metro's unchanged four-hour cap.
Only newly acquired `measure` emulators receive a bounded **14,400-second** cap; standalone,
connected, e2e and release-smoke keep **9,000 seconds**. Borrowed emulators retain their original
deadline. There is no user-controlled lifetime override. This lifecycle policy is explicit recovery
provenance, not an app/action speedup or a graphics/resource/animation change.

After the contract gates pass, the original-mode collection commands are:

```sh
scripts/validation/android-flow.sh measure --api 31 \
  --graphics software --report-dir validation/evidence/performance/before-software
scripts/validation/android-flow.sh measure --api 36 \
  --graphics software --report-dir validation/evidence/performance/before-software
scripts/validation/android-flow.sh e2e --api 31 \
  --graphics software --report-dir validation/evidence/performance/before-software
scripts/validation/android-flow.sh e2e --api 36 \
  --graphics software --report-dir validation/evidence/performance/before-software
```

Each command creates a unique invocation directory; the last two are the required complete phase/
acceptance baseline, not another hotspot sample. Startup failure, unknown actual software/KVM
identity, missing artifacts or failed assertions are failures, not baseline completion. If the
original cohort cannot run, stop before any optimization; never silently substitute a modern backend.

The single frozen workload definition is
[`validation/performance/hotspots.json`](../validation/performance/hotspots.json).
It records the eight original full flows, ordered external prerequisites, independent reset policy,
default fixture parameters, whole-flow boundaries and nonadditive H08 gallery/list diagnostics.
The schedule is fixed at three before and three after repetitions on both APIs. Do not replace
failed scheduled samples with diagnostic reruns, omit regressions, reduce fixtures or turn a passing
H08 subsection into a passing mixed-view flow. External setup costs stay separately accounted for.
Original helper digests identify the retained baseline inputs; they do not prohibit declared later
helper changes. The definition fingerprint is SHA-256 of recursively key-sorted, compact UTF-8 JSON
with only `definitionFingerprint` omitted. JSON formatting does not change it.

Acceptance authority remains the ordered workspace registry and staged registry, as mapped in the
[acceptance contract](../specs/008-e2e-performance/contracts/acceptance.md).
The private `acceptance-before.json` records all 39 workspace entries and seven staged parts,
per-API/protocol claims, source-located assertion definitions, conditional/optional observations,
state boundaries, host hooks and seven documented feature-007 deviations.
Lifecycle definitions come from actual block-style Maestro command nodes, including scalar
`stopApp`/`launchApp`, with source lines and command-list locations. `clearState` and `stopApp`
under a launch are launch options, never extra commands; `null` means unspecified, not `false`.
Home followed by `launchApp` with `stopApp: false` preserves background/foreground of the same
process, unlike an explicit stop/relaunch. Inline wrapper commands are definitions, not additional
executions. The dependency-free capture rejects unsupported/ambiguous forms rather than silently
dropping a boundary; synthetic regressions cover these rules and original restart/staged flows.
Statuses distinguish **executed**, **failed**, **missing** and **pre-existing documented deviation**.
At setup all runtime claims are missing, not passed: source inventory is not executed proof.
The original default `start-scan` optional running wait is explicitly a weakness, not affirmative
scan-start evidence. Debug workspace execution of release-named flows never proves signed standalone
installation or an in-place signed APK update; existing `release-smoke` mode supplies that proof.

## Private local layout

`validation/evidence/` is already Git-ignored; do not add evidence to Git, force-add it, upload it or
publish it as a build artifact. Under its `performance/` child:

```text
preflight.md                         sanitized, point-in-time availability/ownership checks
acceptance-before.json               frozen original claims; runtime evidence initially missing
acceptance-before.lifecycle-v1.json  immutable original capture, including known metadata errors
acceptance-before.lifecycle-v2.json  corrected command-node metadata; canonical inventory points here
original-inputs/<opaque-snapshot>/
  source.tar                        runnable original app/flows/helpers/fixtures/configuration
  retention.json                    revision, dirty-input identity, file/archive digests, APK state
  hotspots.json                     retained frozen workload definition
  preflight.md
  acceptance-before.json
  acceptance-before.lifecycle-v1.json
  acceptance-before.lifecycle-v2.json
  baseline.apk                      added only from the actual baseline build
  baseline-apk.json                  digest and producing invocation/build provenance
invocations/<opaque-invocation>/     setup retention allocation (not a runner claim)
  retention-reference.json          original snapshot reference
  raw/
  reports/
before-software/<opaque-invocation>/
  run.json                          allowlisted finalized record, including failures
  report.md                         sanitized derived summary
  record.private.json               in-progress local record, not final proof
  start.private                     monotonic invocation origin
  raw/                              private Maestro/build/validator/lifecycle artifacts
```

Setup created a unique invocation with private raw/report directories and a unique original-input
snapshot. Its 351 archived original files were verified byte-identical to revision
`fcdb8ca87ea43b0e52ab1f0c0ac40fe94f959191`. The exact archive digest, full file digests and opaque
identifiers are in local `retention.json`; the preflight records the original 337-file input fingerprint.
Those setup observations are historical, not the current invocation's source or dirty-state identity.
No baseline APK was built or opportunistically adopted from an existing build directory.
Setup did not claim boot, protocol authentication, mounted-volume checks, acceptance or speedup.

Use `umask 077`, directory modes `0700` and regular evidence-file modes `0600`. Retained executable
source may use `0700` when extracted; do not remove its executable bit. Never relax parent-directory
access or change project/host policy to make collection work. Refuse unexpected symlinks, foreign
ownership or an existing destination instead of replacing it. Protect artifacts even if a tool
defaults its own file modes: keep their parent private, then normalize local artifact files to `0600`.
Do not recursively chmod the repository, SDK, AVDs, shared services or dependency caches.

From the repository root, create a **new** invocation before each collection (this allocates evidence,
not an emulator/service ownership claim):

```sh
repo=$(git rev-parse --show-toplevel)
umask 077
evidence="$repo/validation/evidence/performance"
# The existing evidence root must already be owner-private and not a symlink.
test -d "$evidence" && test ! -L "$evidence"
mkdir -p "$evidence/invocations"
invocation=$(mktemp -d "$evidence/invocations/run-XXXXXXXXXX")
mkdir "$invocation/raw" "$invocation/reports"
```

Every runner Maestro invocation now receives a distinct explicit private output/debug directory through
the pinned `--test-output-dir` and `--debug-output` options. Workspace, staged parts and scheduled
hotspots never use implicit "latest" discovery. Missing or unsupported command artifacts fail the
invocation even when Maestro exits zero. Empty setup `raw/` directories are not Maestro evidence.
Use a fresh directory for every API/scenario/repetition/attempt; retain failures and interruptions.
Never rerun into a prior result directory or overwrite `preflight.md`, acceptance inventory, snapshot,
sample or comparison. A later preflight belongs to its own invocation.

### Metadata-only inventory corrections

The setup lifecycle correction preserves both the original capture and its corrected successor,
in the current evidence directory **and** retained snapshot. `acceptance-before.json` is now the
canonical reference to the exclusively created `acceptance-before.lifecycle-v2.json`;
`acceptance-before.lifecycle-v1.json` retains the previous bytes unchanged. The successor's
`lifecycleCorrection` records the predecessor digest, extractor digest, reason and correction time.
No prior version, retained archive, retention manifest, preflight or runtime result was overwritten.
Only lifecycle metadata and explicit correction lineage changed; frozen source/workload identities,
assertions, statuses, staged hooks and release qualifications remain unchanged.

Use `scripts/validation/performance-acceptance.mjs`'s `retainLifecycleCorrection` only for this
metadata repair: it verifies each flow against its frozen digest, requires existing owner-private
evidence, retains the prior file before advancing the canonical reference, and rejects existing
version destinations or repeat repairs. A partial failure leaves retained records intact; inspect
the lineage rather than retrying over it. This is not permission to replace measurements, change
workloads or upgrade source definitions to device proof. Run its synthetic regressions with
`node --test scripts/validation/performance-acceptance.test.mjs` (also in `pnpm test:foundation`).

## Retain runnable baseline inputs before tuning

1. Record Git revision **and actual input bytes/dirty state** before optimization. Include app/native
   source, assets, package/lock/build configuration, every measured flow and its transitive helper
   closure, fixture generators, protocol configuration and staged hooks. Hash project-relative paths
   and contents; HEAD alone is insufficient. Record the frozen manifest fingerprint separately.
2. Create an exclusive private snapshot. For a clean input set, archive the recorded revision using
   the setup allowlist: `android/`, `assets/`, `src/`, `scripts/validation/`, `validation/maestro/`,
   `validation/services/`, app entry files and package/lock/Metro/Babel/TypeScript/Jest/lint configs.
   Retain the Gradle wrapper and executable script modes. Verify archive members against the actual
   original bytes, then retain a member-digest manifest and archive digest in `retention.json`.
   This is the procedure used by setup; the later frozen hotspot definition is retained separately.
3. If inputs are dirty, retain the actual changed files and reviewed nonignored untracked input
   files alongside that archive, with paths/digests and an explicit overlay list. Include deletions
   and original executable modes. Validate the reconstructed tree against the recorded input digest.
   Never archive HEAD alone and call it the dirty baseline. Do not use stash/reset/checkout to
   discard user changes. Reject an incomplete or secret-bearing snapshot before measurements.
4. Do **not** capture `.env*`, service credential files, signing material, `local.properties`,
   host environment, user files, `.git/`, generated build trees, service/AVD state or `node_modules/`.
   Synthetic flow/fixture source is replay input, not an excuse to preserve runtime passwords.
   Replay regenerates synthetic credentials via the approved services. Retain pinned tool/image,
   dependency-lock and resource/cache identities, not private configuration dumps.
5. Extract into a **new** private replay directory, never over the working repository, an AVD or
   prior snapshot. Reuse only matching already-prepared pinned tools/dependencies. Do not implicitly
   install packages, launch services, alter cache policy or discard user work. If matching dependencies
   are unavailable, report that blocker rather than improvising a different toolchain.
6. Retain the original runner too. Later replay may apply reviewed observational/ownership-only
   orchestration changes; record that overlay separately and leave original app/helpers/fixtures,
   pacing, build frequency and guest settings intact. A new `measure` mode does not exist in the
   original archive. Retain the executed foundation orchestration and its digests as a separately
   identified overlay before collection; it is not the original runner. Reconstruct by extracting
   the original archive first, then the explicitly recorded overlay into a new private directory.
   Retain the frozen manifest separately and verify every reconstructed input's bytes and executable
   mode against the recorded closure. Do not invent a current `--flow` or input-root option.

### Foundation delta and contract gate (T013)

The foundation changes are ownership/observation only:

- Claim the complete invocation before any service or Metro setup, retain the emulator lock, and
  verify the saved emulator process/session, console port, AVD and serial rather than selecting the
  first online device. Private `acquired|borrowed|released` receipts are authoritative across signals
  and acquisition handoff. Stop only acquired resources; audit/healthcheck borrowed ones.
- Register SFTP resume before pause, restore the remote recheck tree and run scoped protocol audits
  during cleanup. Preserve the original nonzero status even if cleanup also fails.
- Add monotonic disjoint build/services/boot/install/remote-and-device-fixture/workspace/measurement/
  staged/cleanup/other phases. Split service seed time from service startup; never count shared
  work twice. Capture requested versus observed resources and actual runtime renderer/KVM identity
  read-only. Command costs exclude inclusive wrappers and are not application profiles.
- Route raw artifacts privately and allowlist version-1 reports. Exclude credentials, complete URLs,
  UI/hierarchy text, arbitrary arguments/environment and raw errors. Missing assertions/artifacts
  remain failures; existing optional progress observations are not upgraded into required proof.
- Schedule the frozen H01–H08 exactly three times per requested API, retaining failed samples.
  Restore independent fixture prerequisites using the original generators and sizes; do not replace
  failures with diagnostic reruns. Reject dataset/repetition/flow overrides before setup. Read the
  schedule on a dedicated descriptor, not stdin: Android fixture commands forward stdin and must
  never drain the remaining repetitions.

Review against the retained original revision found no changes to `android/`, `src/`, app entry/
asset inputs, Maestro flows/helpers/registries, fixture generators/manifests or service compose
configuration. The staged compose hook only resolves its existing state path through the shared
lifecycle primitive. The original 39-flow workspace order, all seven staged continuations and their
hooks remain unchanged; `08-changed-b` never launches. Connected instrumentation still builds per
API and supports prestarted services; release smoke retains unsigned-build rejection, signed
standalone installation/update, release ABI policy and no Metro. Debug assembly remains per API,
`--no-daemon`, with the default ABIs; no build reuse, fixture-cache improvement, progress substitution,
shorter pacing, animation override or graphics fallback has been introduced.

The original launcher still requests indirect SwiftShader, 2048 MiB and the existing AVD resources.
Ownership adds a fixed console port/process proof but does not change the graphics/CPU request.
The reporter records its actual outcome; it does not infer equivalence from a profile name.

T013 validation on the foundation tree passed:

```sh
node --test scripts/validation/performance-report.test.mjs \
  scripts/validation/performance-runner.test.mjs
pnpm test:foundation
```

The focused gate passed **40 tests** and the full affected script-contract gate passed **109 tests**,
with zero failures, cancellations or skips, both initially and after the stdin regression repair.
The strengthened schedule test deliberately lets the fixture child consume stdin: before the repair
it executed only **2 of 48** scheduled samples; after the repair all 48 samples and all 50 original
fixture-reset calls execute, with every injected timeout retained. This includes production-script fakes
for ownership, handoff signals, timeout descendants, staged restoration, borrowed services, connected/
release compatibility, unchanged fixture contracts and report canaries. These are deterministic
contract tests, not real Android acceptance or a software baseline. No extension hooks are registered.
The first real T014 attempt verified original-launch software rendering and KVM on **both APIs**
without changing the legacy graphics request. The actual producing debug APK and all 359 executed
source inputs (plus the separately identified 15-file foundation overlay) were retained privately.
API 31 H01 repetition 1 passed, but a fixture child drained the schedule and the runner incorrectly
advanced to API 36. The owned attempt was interrupted with exit 130; its original sample, source,
APK, raw artifacts and failed/incomplete finalized report remain unchanged. Acquired emulator, Metro
and protocol resources were released, with restoration/audits preserved. No replacement campaign or
optimization was started.

This attempt is **not** a T014 baseline: 47 scheduled samples and the complete workspace/staged
phase run remain missing. Its fixture-byte observation timed out, and the unset animator-scale
observation is explicitly unknown; neither may be inferred or used in matched comparisons.
The schedule repair is contract-tested, but a fresh collection policy must preserve the interrupted
attempt as incomplete rather than hide it or promote its single successful sample into a cohort.
T014 remains unchecked. Historical totals and source definitions cannot satisfy that gate.

### Authorized T014 metadata recovery

The binding recovery decision permits correctness repairs to observational metadata and a separate
fresh original-mode campaign, not tuning. Fixture-byte observation now batches `stat` calls with
`find -exec ... {} +` rather than launching one process per file. It still measures the same original
trees and logical sizes; seeding, fixture contents/counts, reset policy and cache behavior are unchanged.
An unsuccessful, empty or malformed observation fails explicitly instead of silently keeping unknown
bytes. This is an observation-cost repair, not fixture caching or workload reduction.

An unset `animator_duration_scale` row is not evidence of a zero or assumed default scale.
API 31 does not expose the effective scale in its WindowManager text dump. The private shell probe
[`SyncScopeAnimationScales.java`](../scripts/validation/SyncScopeAnimationScales.java) calls only
`WindowManagerGlobal.getWindowManagerService()` and `IWindowManager.getAnimationScales()` through
reflection. Existing Java and SDK build-tools 37.0.0 D8 compile it; a uniquely named guest JAR is
removed with a shell trap and host-side `finally` cleanup. It is never loaded into the application,
does not write settings or replace progress UI, and reports only three numeric scales. Real owned
API 31/36 observations returned **1 / 1 / 1**, without changing the original settings.

The image observer also accepts INI whitespace and absolute or SDK-relative `image.sysdir.1`;
this fixes missing image identity without touching the AVD or system image. Original-mode measurement
now rejects unknown image, resource or animation metadata before scenarios. Deterministic regressions
failed before these repairs; `pnpm test:foundation` subsequently passed **112 tests**, with no failures,
cancellations or skips. Fake compiler/SDK processes keep the new tests independent of host tools.

The original interrupted invocation remains immutable and separate. Recovery startup failures and
zero-sample interruptions are also retained with explicit lineage; none is pooled into a fresh cohort.
Read-only metadata diagnostics deliberately stop before workspace/hotspot execution and are never
timing samples. One API 36 diagnostic failed to stop the guest watchdog; its failure and owned cleanup
remain visible. A successful getter diagnostic does not waive later startup or acceptance failures.
The fresh campaign retains a new runnable source closure and correctness overlay, copying each
producing APK before a later build and checking its digest against the retained original APK.
Until all 48 scheduled samples and the complete two-API workspace/staged baseline pass,
T014 remains incomplete and no app/helper/build/fixture/GPU optimization is permitted.

The final fresh recovery campaign `fresh-f25d8197ea5baa8059878fbd`, invocation
`inv-037c13889bd904d7c643fbeb`, executed **all 48 original scheduled attempts**:
API 31 passed **23/24** and API 36 passed **13/24**, for **36 passed / 12 failed**.
API 31 H08 repetition 3 ended with a driver timeout/I/O failure during an action.
API 36 H05 repetitions 2–3 and every H06/H07/H08 repetition failed required assertions.
All failures remain in the finalized private report and their distinct raw directories;
no diagnostic rerun replaced a scheduled sample. These are incomplete cohorts, not medians or
successful baseline proof. The complete workspace/staged phase baseline was **not started**
after the failed measurement gate. T014 remains unchecked; further recovery needs a decision,
not an optimization or a retry that hides the failures.

Both APIs verified KVM and the **same actual original software renderer**, known image identities,
unchanged 4-vCPU/1080×2340/density-440 resources, and effective animation scales **1/1/1**.
The original 2048-MiB request yielded 2,015,100 KiB on API 31 and 2,531,828 KiB on API 36.
Observed logical fixture bytes were **10,805,362,433**. Both producing APKs matched the retained
original APK digest and were copied with build provenance into
`original-inputs/recovery-f25d8197ea5baa8059878fbd`, alongside its 360-file runnable source
closure and separately identified correctness overlay. The historical interrupted evidence was
verified byte-identical. Emulator and protocol receipts were released and remote restoration passed.
The unchanged **14,400-second Metro deadline** expired during the nearly five-hour campaign;
the API 36 assertion failures began after that deadline. The existing stop path refused its now-dead
process, leaving the original Metro receipt `acquired` and its owned state behind. This cleanup failure
is preserved, not relabeled successful. Under a fresh full-invocation lock, matching acquisition
claims, a proven absent saved PID and an unoccupied port authorized removal of only that expired
invocation-owned scratch state. `late-owned-cleanup.json` and the private retained Metro log record
the late release without changing the failed report or original receipts. No device/container/process
remained active, no Metro state remained, and both ownership locks were free. The Metro lifetime and
expired-owner stop behavior were **not changed**; they and the independent API 31 I/O failure are
remaining recovery blockers.

### API-specific recovery diagnosis and unchanged-limit blocker

The subsequent binding decision authorizes H08 diagnosis and expired-owner cleanup repair, then
separate API-specific campaigns, **not** a runtime-limit increase, workload change or optimization.
Read-only inspection of the retained failed H08 evidence identifies a second deadline: the executed,
retained `android-validator.sh` starts each emulator under **9,000 seconds**, independently of
Metro's **14,400 seconds**. Its retained digest still matches the current validator.

API 31's boot-phase start through the final failed H08 measurement end spans **9,002.357 seconds**.
The final command artifact stops at a running view-selection tap; **71 mandatory assertions passed,
none failed**, but later flow assertions are unexecuted. The driver reports lost device transport,
and the emulator log records graceful termination. These observations and the unchanged timeout
align the I/O symptom with emulator expiration, not an established app/view-selection bug.
The flow is still failed, not a successful H08 subsection or replaceable sample. Graphics-log warnings
alone do not establish an alternative crash cause.

The first two successful API 31 H08 flows took **291.608 / 294.901 seconds**; repetition 3 ended at
**276.671 seconds** while incomplete. Original device-fixture phases already consumed
**4,889.944 seconds** and measured flow bodies **4,028.185 seconds**, excluding other accounted work.
Changing the requested APIs does not change this within-API schedule or extend its emulator lifetime.
Consequently API-specific collection alone cannot resolve the observed per-emulator cutoff. No new
scheduled campaign or full workspace/staged phase run was started; T014 remains unchecked pending
an explicit lifetime/scheduling decision. Both caps, original workloads/settings and all prior
campaigns/APKs/source snapshots remain unchanged, with no pooling or replaced samples.

The authorized cleanup fix treats an expired owned Metro separately from a live owned process.
It requires the exact acquired receipt, nonempty matching invocation claim, owner-checked regular
identity files, an absent saved PID (rejecting reuse), no remaining saved process group, and an
unoccupied port. Failed socket/group observations are not proof of absence. It retains the diagnostic
before deleting only that owned scratch directory and writes `released` without sending a signal.
Borrowed/foreign/ambiguous state is refused, and diagnostic-copy failure preserves state and receipt.
Existing live-owned and borrowed service behavior is unchanged; original nonzero invocation status
is not converted to success.

The expired-owned positive regression failed before the fix with the existing refusal; all **15**
new expiry cases pass afterward. `pnpm test:foundation` passed **127 tests** with no failures,
cancellations or skips, and changed shell syntax passed. No extension hooks are registered.

### Measurement-only lifetime recovery

The latest binding decision narrowly supersedes the unchanged-emulator-limit restriction above.
The runner writes a private finite mode record after acquiring the complete invocation lock.
Validator acquisition requires the matching token/API receipt, owner-private regular record and
the inherited locked invocation descriptor before selecting the measurement-only 14,400-second cap.
It does not infer measurement from a free-standing environment mode or accept arbitrary seconds.
Borrowing returns without changing the existing emulator's policy; emulator descendants do not
inherit the invocation lock. Private validator diagnostics retain `invocation-mode` and
`emulator-lifetime-seconds` beside the original PID/serial/process proof.

The cap regression failed at 9,000 seconds before repair, and the unauthenticated-record regression
also failed before repair. Positive measurement, unchanged connected/e2e/standalone/release policy,
borrower immutability, missing inherited lock, token mismatch, symlink and extra-line rejection now
pass. `pnpm test:foundation` passed **133 tests**, zero failures/cancellations/skips. Metro remains
14,400 seconds; workload, fixture/cache/build policy, original APK/app/helpers, software renderer,
resources and animation scales remain unchanged. All earlier evidence remains immutable and
separate; no successful sample from a failed/interrupted campaign joins the recovery cohort.
T014 is still incomplete until both API-specific 24-sample schedules and both original complete
workspace-plus-seven-staged runs succeed with required assertion/actual-mode evidence.

The separate bounded recovery campaign `bounded-ac02243e0bfd17ff2193aa76` retained a new 360-file
runnable source archive, finite lifetime policy and references to the original APK. Its first
API 31 invocation, `inv-39bab9aeb5a8dd98e632bf7a`, failed startup while stopping the original guest
watchdog (`llkd`), before building or executing any hotspot sample. Validator diagnostics confirm
the measurement-only **14,400-second** policy was selected; no action-speed or actual-renderer
acceptance claim is made from this incomplete boot. No API 36 collection or workspace/staged run
started, and no replacement campaign followed the failure. The finalized failed report and raw
diagnostics remain private and unchanged. All acquired emulator/Metro/protocol receipts are
`released`, remote restoration passed, both locks are free, no managed process remains, and all
**867** pre-existing evidence/snapshot files were verified byte-identical afterward. T014 remains
unchecked pending a decision on the newly encountered startup blocker.

### Authorized watchdog setup recovery

The binding watchdog decision authorizes diagnosis and correctness repair, not skipping shutdown or
changing its intended root/stop/unroot policy. The old helper sends two asynchronous `ctl.stop`
requests in one shell, immediately unroots, then tests only whether one property is *not* `running`.
It neither waits for affirmative stop completion nor preserves the ADB read's exit status through its
pipeline. It also omits unroot restoration when a stop request fails. Those are reproducible setup
defects; failed/empty/unknown reads must not count as stopped services.

The retained original failure has no stage-level watchdog observations, so its exact failing
subcommand cannot be reconstructed. A separate owned, non-measurement diagnosis on both APIs used
an invocation-local SDK observation wrapper without modifying the installed SDK or AVD. Both
original starts succeeded, observed `llkd-1` stopped and returned UID 2000, then released their
emulators. These diagnostics are not scheduled baseline samples and do not erase or explain away
the retained failure. Deterministic delayed-shutdown regressions reproduced the original one-shot
failure on both APIs before the repair; additional regressions exposed acceptance of failed, empty
and malformed reads, missing service-0 checks and incomplete restoration.

The corrected helper separately checks both original stop requests, polls asynchronous
`running|restarting` states with at most 60 observations, requires affirmative `llkd-1:stopped`,
and verifies `llkd-0:stopped` or a successful empty read indicating that the image has no service 0.
An empty service-1 result, any failed read, unknown state, exhausted polling or failed root/unroot/UID
transition is a startup failure. Rooted stop/observation failures still attempt normal-shell
restoration without converting the failure to success. Existing ADB command timeouts and post-stop
boot/network checks remain; serial/process identity is additionally rechecked after the transition.
Private `watchdog.private` diagnostics contain only fixed stage/status categories.

All 14 initial focused watchdog regressions failed before repair and passed afterward.
The full `pnpm test:foundation` gate, including the existing watchdog contract and additional
absent-service/read-failure coverage, passed **149 tests** with zero failures, cancellations or skips.
Shell syntax passed. No extension hooks are registered.

No emulator restart, deadline override, assertion waiver, fixture/build/cache change or app/helper/
rendering/resource/animation optimization is introduced. The measurement-only emulator cap remains
14,400 seconds, all other acquired modes remain 9,000 seconds, borrowed lifetimes remain unchanged
and Metro remains 14,400 seconds. Failed/interrupted campaigns stay immutable and separate.
T014 still requires fresh API-specific 24-sample schedules and complete 39-workspace/seven-staged
baseline acceptance on each API; setup correctness tests and diagnostic boots do not satisfy it.

The explicitly separate campaign `watchdog-recovery-cac5cf3e5e0d6c956241dbc8`, invocation
`inv-6adee9f3be3a4e4c9f16ddff`, passed repaired watchdog startup and verified original software/KVM
identity on API 31. It retained a new 360-file runnable source snapshot and the exact producing
original-digest APK. It recorded **15 scheduled samples: 14 passed / 1 failed** before being
deliberately interrupted at the new reporting blocker (exit 130). API 36 measurement and both
complete workspace/staged runs were not started. No successful sample is pooled into another cohort.

H05 repetition 2 remains `failed: unsupported-artifact`. Its private driver artifact has 75 completed
records, two skipped nonmandatory records, and 20 executed mandatory assertions with none failed or
missing. The reporter rejects a one-millisecond overlap between sequential initialization records:
`defineVariablesCommand` (sequence 60, depth 0) and `applyConfigurationCommand` (sequence 61, depth 1)
both have duration 1 ms and the same quantized start/end. The existing adjacent-boundary correction
requires strictly advancing starts/ends and therefore rejects this distinct case. These observed
driver counts do **not** promote the failed sample or finalize valid report proof.

Changing that ambiguity rule or issuing another replacement recovery requires an explicit decision.
No parser tolerance was loosened, failed report rewritten, sample rerun or optimization started.
All acquired emulator/Metro/protocol receipts are released, remote restoration passed, both locks
are free, and no managed process remains. All **949** pre-existing campaign/snapshot files were
verified byte-identical. The new failure, interruption, APK, inputs and cleanup evidence are retained
privately; T014 remains unchecked.

### Authorized initialization timestamp recovery

The latest binding decision authorizes a narrow pinned-driver parser correction and a **separate**
fresh recovery, not broad overlap tolerance or later US3 attribution work. Two deterministic
initialization regressions failed before repair with `unsupported-artifact-overlap`.
The correction accepts only consecutive completed `defineVariablesCommand` then
`applyConfigurationCommand` leaves, consecutive sequence numbers, configuration depth exactly one
deeper, and the same integer start/end enclosing **exactly one millisecond**. It preserves both
execution counts, charges the shared interval once and leaves raw records unchanged.
The existing strictly advancing adjacent-boundary correction remains unchanged.

Different types/order/depth, nonconsecutive sequences, failed/warned/running records, fractional or
longer intervals and any third conflicting interval still fail. Mandatory assertions are unchanged:
failed or skipped required assertions cannot become successful proof. Malformed metadata remains
invalid and command payloads are never published. The focused reporter gate passed **16 tests**;
`pnpm test:foundation` passed **151 tests**, zero failures/cancellations/skips. An earlier invocation
of the full test command exceeded the agent's 180-second command timeout; the complete rerun with
adequate host-command time passed, without changing validation runtime limits.

Read-only diagnostic ingestion accepted all **64** retained pinned command artifacts, including
the formerly rejected H05 initialization pair. This diagnostic does not rewrite any prior
`run.json`, change H05's stored failed status, establish a median or count any old sample in recovery.
The prior interruption/failure and all older evidence remain immutable. Fresh collection retains
the executed source closure and original-digest producing APK, uses independent API-specific
invocations, and requires all 48 newly scheduled successful hotspot samples plus both complete
39-workspace/seven-staged phase baselines. Original app/helpers/build/cache/fixtures/resources,
actual software renderer and animation settings remain unchanged. T014 remains unchecked until
every required runtime/assertion/artifact/audit/restoration check passes; another scheduled failure
blocks any replacement campaign pending a new decision.

The explicitly separate campaign `timestamp-recovery-4c6efa0d138ca305c5a434fe`, invocation
`inv-1aae26e8b524c85de8408241`, verified the original software renderer/KVM and retained a new
360-file runnable source closure and the exact original-digest producing APK. API 31 recorded
**22 scheduled samples: 21 passed / 1 failed**. H01–H07 each passed all three repetitions; H08
repetition 1 failed a mandatory `files.scroller.thumb` assertion in `show-scrollbar.yaml`.
The parser accepted this artifact: **29 mandatory assertions executed / 1 failed / 0 missing**.
This is a new real assertion blocker, not the repaired initialization accounting corner.
Its cause is not established; no app/helper/fixture/settings change or speculative repair was made.

Collection stopped safely on that scheduled failure, retaining it as `failed: validation` and
the invocation interruption as exit **130**. The remaining **26** scheduled samples, API 36 and
both complete workspace/staged phase baselines were not executed. No replacement campaign or
optimization was started, and none of the 21 successful samples is pooled into another baseline.
The campaign's private `recovery-outcome.json` and `final-unit-gate.json` record all acquired resources released, successful
scoped FTP/SFTP/WebDAV audits and unchanged remote manifests, successful restoration, free ownership
locks and no managed processes. The final foundation rerun again passed **151/151**; shell syntax and
diff checks passed. All **1,108** pre-existing evidence/snapshot files remained
byte-identical. T014 remains unchecked; diagnosis/replacement collection requires a new decision.

### Authorized H08 scrollbar helper deviation

Read-only diagnosis of the retained H08 failure found a timing race, not an app defect. The swipe in
`validation/maestro/subflows/show-scrollbar.yaml` used Maestro's default wait for the screen to
settle. Under API 31 software rendering that wait took **3.32 s** in the failed repetition (versus
1.67–2.34 s in 24 passing runs), outlasting the app's 1.5 s scrollbar fade, so the faded thumb had
already left the hierarchy when `files.scroller.thumb` was asserted.

The binding decision authorizes exactly one helper change, recorded here as a **baseline deviation**:
that swipe now sets `waitToSettleTimeoutMs: 50`, matching the drag swipes already in
`polish/03-fast-scroll.yaml`. The `files.scroller.thumb` assertion and its timeout are unchanged.
A contract test in `scripts/validation/performance-hotspots.test.mjs` failed before the change and
passes after it. No app, fixture, build, resource, renderer or animation setting changed; the frozen
`hotspots.json` closure digests still describe the original helper bytes, so the new campaign's
source fingerprint differs from earlier campaigns and its retention record names this overlay.
All existing campaigns, including `timestamp-recovery-4c6efa0d138ca305c5a434fe` with its H08
failure and interruption, stay immutable and separate; none of their samples is pooled.

The explicitly separate campaign `scrollbar-recovery-d27d08dc5e709c748eaceac2` (360-file source
closure; only the helper and its contract test differ from the prior snapshot; foundation gate
**152/152**) ran API 31 invocation `inv-5d116db1ad682cf201cd55ba`: **24 scheduled samples, 24 passed**,
including all three H08 repetitions, with original software/KVM identity, restoration passed and
the producing APK retained (digest matches the original APK). The API 36 invocation
`inv-1926b11183da3286b786f081` then stopped during boot, before any sample, on the private
collector's identity check: it compared resource metadata byte-for-byte and observed RAM was
2,531,820 KiB versus the original 2,531,828 KiB (requested RAM, vCPUs, size, density, renderer,
backend, image and animation scales all matched). The collector then re-sent SIGTERM every 500 ms;
the second signal interrupted the runner's cleanup after Metro release, leaving the API 36 emulator
and the three protocol services acquired. They were released afterward through the project's own
stop paths with the matching invocation claim (audits clean, zero unexpected remote changes,
recheck restoration passed); the lifecycle receipts are retained with the invocation, whose record
stays unfinalized. API 36 measurement and both phase baselines did not run. All **1,317**
pre-existing evidence files remain byte-identical. T014 remains unchecked pending a decision.

The separate campaign `signal-recovery-89ed1eec4d205c0d331169fb` (collector and runner signal fixes,
foundation gate **153/153**) was started inside an agent turn. A full campaign takes about 7–9 hours,
so the collector died when the turn returned. API 31 invocation `inv-40c518a649c70d5c2253a43b` was
interrupted during boot with **0 samples**; its record stays unfinalized as written. The emulator had
already been released, but the FTP/SFTP/WebDAV services and Metro state were left behind. They were
released through the project's own stop paths with the matching invocation claim and acquired
receipts (audits clean, zero unexpected remote changes). The lifecycle receipts and Metro log are kept
with the invocation, and `blocker.json`/`recovery-outcome.json` record the interruption. The campaign
is immutable and none of it is pooled. The next separate campaign,
`detached-2ad2b57c4e176ef5046f5334`, uses the same verified source closure, input fingerprint and
collector (no source change; all **1,581** earlier evidence files re-verified, **1,629** files now
pinned as prior evidence). It is prepared but not started: the main session launches it detached
(`setsid nohup`) so the collector outlives any agent turn.

The detached campaign `detached-2ad2b57c4e176ef5046f5334` ran API 31 invocation
`inv-e624a2debeef7e4dd9fbb8ac`: **24 scheduled samples, 24 passed**, with the producing APK retained.
API 36 invocation `inv-60f817c0623bc7f9fd5284ea` passed 19 samples, then H07 repetition 2 (artifact
`raw-36-20`) was recorded as `failed: unsupported-artifact` with 0 assertions executed and 1 missing.
The collector stopped on that scheduled failure (exit **130**); both phase baselines did not run and
the host was left clean. The campaign is immutable and none of its samples is pooled.

Read-only diagnosis found a **parser defect, not a flow or app failure**. The Maestro artifact is
complete and every command completed. Two adjacent commands in one subflow, a sub-millisecond
`applyConfigurationCommand` (reported as 1 ms) and the next `evalScriptCommand`, have the same
millisecond timestamp. The overlap check accepted only strictly advancing starts or the variables
and configuration pair at startup, so it rejected the whole artifact. In the passing repetition
the same configuration command was reported as 0 ms, so there was no overlap. Two fail-first tests
in `scripts/validation/performance-report.test.mjs` cover this. The parser now accepts this shape only for completed,
consecutive, same-depth leaves where the earlier one spans exactly one integer millisecond and the
later one ends after it, and it charges the shared millisecond once. Real overlaps, other
orderings, failed or missing mandatory assertions and malformed metadata still fail. With the fix,
`raw-36-20` parses with **19 mandatory assertions executed / 0 failed / 0 missing**, and every retained
artifact in every earlier campaign now parses. The recorded failure itself is not rewritten.
The foundation gate passed **155/155**.

The next separate campaign, `parser-recovery-3376d40f31c5b1311ed6fa6f`, retains a new 360-file
source closure, where only `performance-report.mjs` and its test differ from the prior snapshot
(input fingerprint `faf6a2ed…`). It uses the unchanged collector and the original app, helpers
(including the authorized H08 scrollbar deviation), fixtures, build, resources, renderer and
animation settings. All **2,024** existing evidence files are pinned as prior evidence. It is prepared
but not started. The main session launches it detached, and T014 stays unchecked until all 48
samples and both complete phase baselines pass.


The campaign `parser-recovery-3376d40f31c5b1311ed6fa6f` ran API 31 invocation
`inv-c314692041f5ca13575c0d42` and stopped (exit **130**) after H04 repetition 2 (artifact `raw-31-11`)
was recorded as `failed: unsupported-artifact`, although Maestro reports every step completed. A
read-only re-parse throws `unsupported-artifact-overlap`: `defineVariablesCommand` (10 ms) and the next
`applyConfigurationCommand`, one level deeper, overlap by exactly 1 ms. This was the third
millisecond-rounding false alarm. The campaign, its recorded failure and its retained APK stay
immutable and separate; none of its samples is pooled. API 36 and both phase baselines did not run.

The special-cased exceptions in `ingestCommands` are replaced by **one general rounding rule**:
adjacent, consecutive-sequence, completed commands with integer millisecond timing may overlap by
at most 1 ms when the later command is at the same depth or exactly one level deeper. The shared
time is charged once. Overlaps above 1 ms, shallower steps, steps two or more levels deeper,
non-adjacent or out-of-order overlaps, incomplete statuses and failed or missing mandatory
assertions still fail. Fail-first tests cover the `raw-31-11` shape, the allowed same-depth and
one-deeper shapes, and the rejections; earlier tests were narrowed only where the amended rule now
deliberately accepts a 1 ms overlap. The foundation gate passed **158/158**.

An offline gate re-parsed all **165** retained Maestro command artifacts from every campaign with
the previous and the new parser: all **164** previously accepted artifacts produce identical output,
none is newly rejected, and only `raw-31-11` newly parses (**21** mandatory assertions executed /
0 failed / 0 missing). Recorded sample statuses are not rewritten.

The next separate campaign, `rounding-recovery-3eb1de13d9b024a157606b8f`, retains a new 360-file
source closure in which only `performance-report.mjs` and its test differ from the prior snapshot
(input fingerprint `38975d55…`). It uses the byte-identical collector and the original app, helpers
(including the authorized H08 scrollbar deviation), fixtures, build, resources, renderer and
animation settings. All **2,155** existing evidence files are pinned as prior evidence. It is prepared
but not started; the main session launches it detached, and T014 stays unchecked until all 48
samples and both complete phase baselines pass.

The campaign `rounding-recovery-3eb1de13d9b024a157606b8f` passed **47 of 48** scheduled samples.
API 36 H08 repetition 3 (`raw-36-24`) failed: `show-scrollbar.yaml` asserted `files.scroller.thumb`
visible, and the next `copyTextFrom id: files.scroller.thumb`, 2 ms later, never found it because
the app's 1.5 s scrollbar fade fired between the two hierarchy reads. Both phase baselines did not
run. The campaign, its failure and its retained APKs stay immutable and separate; none of its
samples is pooled.

### Authorized H08 show-and-read retry deviation

The binding decision authorizes a second H08 helper change, recorded here as a **baseline
deviation**: in `validation/maestro/polish/03-fast-scroll.yaml`, each of the **8** pairs of
`show-scrollbar.yaml` plus the following thumb read (2 `assertVisible` with the expected band label,
6 `copyTextFrom`) is wrapped in a Maestro `retry` with `maxRetries: 2`, so a fade re-shows the thumb
and reads it again. Every label value, assertion, timeout and later label check is unchanged, and a
wrong label still fails all three attempts. A contract test in
`scripts/validation/performance-hotspots.test.mjs` failed before the change and passes after it;
`maestro check-syntax` (pinned 2.10.0) accepts the flow. No app, fixture, build, resource, renderer or
animation setting changed.

The pinned Maestro writes every executed step to `commands-*.json` (its `executedSteps` list, each
attempt with a new sequence number), so a fired retry keeps its `FAILED` first-attempt thumb read.
The binding decision authorizes a narrow **recovered-retry rule** in `ingestCommands`: a non-optional
`FAILED` leaf counts as recovered (not failed, and not a mandatory assertion either way; its time is
still charged) only if it lies inside a `COMPLETED` `retryCommand` by sequence (after the retry and
before the retry's next same-or-shallower record) and by time span, and an identical command with a
later sequence `COMPLETED` inside the same retry. Failures outside a retry, a retry that ends
`FAILED`, `WARNED`/`RUNNING`/optional failures, missing mandatory assertions and real overlaps still
fail; the 1 ms rounding rule is unchanged. Fail-first tests in
`scripts/validation/performance-report.test.mjs` cover both pair shapes and every rejection; the
foundation gate passed **161/161**.

An offline gate re-parsed all **213** retained Maestro command artifacts with the previous and the new
parser: all **213** produce identical output (none contains a `retryCommand`), none is newly accepted
or rejected, and recorded sample statuses are not rewritten.

The next separate campaign, `retry-recovery-74d3c4001208c2e11fec2df3`, retains a new 360-file source
closure in which only `03-fast-scroll.yaml`, `performance-hotspots.test.mjs`, `performance-report.mjs`
and its test differ from the prior snapshot (input fingerprint `978ac80e…`). It uses the byte-identical
collector and the original app, fixtures, build, resources, renderer and animation settings, with both
authorized H08 helper deviations. All **2,584** existing evidence files are pinned as prior evidence.
It is prepared but not started; the main session launches it detached, and T014 stays unchecked until
all 48 samples and both complete phase baselines pass.

The campaign `retry-recovery-74d3c4001208c2e11fec2df3` ran API 31 invocation
`inv-47de444e45209dbdaf570d3a` and stopped (exit **130**) after **21 of 22** recorded API 31 samples
passed. H08 repetition 1 (`raw-31-22`) failed (**28** mandatory assertions executed / **1** failed /
0 missing) on the scrollbar-fade race at a site the show-and-read retry did not cover: a bare short
`swipe` followed by `assertVisible id: files.scroller.thumb` in sections 1 and 2 of
`03-fast-scroll.yaml`, with no retry and the default settle wait; the swipe took 2.58 s, past the
1.5 s fade. API 36 and both phase baselines did not run, and the host was left clean. The campaign,
its failure and its retained APK stay immutable and separate; none of its samples is pooled.

### Authorized H08 thumb-read sweep deviation

The binding decision authorizes a third H08 helper change, recorded here as a **baseline
deviation**: the whole H08 flow (`03-fast-scroll.yaml` and the subflows it uses) was swept, and
every positive read of `files.scroller.thumb` after a scroll now sits inside a Maestro `retry` with
`maxRetries: 2` whose commands first redo the scroll that shows the thumb. The 8 existing
show-and-read pairs already did so (the read inside `show-scrollbar.yaml` is only reached through
them); the 2 bare short swipe plus `assertVisible` steps are now wrapped the same way (**10** retries
in all), and their swipes, like every scroll inside these retries, use `waitToSettleTimeoutMs: 50`.
The short Synced result's `assertNotVisible id: files.scroller.thumb` is an absence check, not a
read, and is unchanged. Every assertion, label value, timeout and later label check is unchanged, and
a wrong label still fails every attempt. A contract test in
`scripts/validation/performance-hotspots.test.mjs` that rejects any positive thumb read outside such a
retry failed before the change and passes after it; `maestro check-syntax` (pinned 2.10.0) accepts the
flow, and the foundation gate passed **162/162**. The
recovered-retry and 1 ms rounding parser rules are unchanged (`performance-report.mjs` is
byte-identical), so no retained artifact can parse differently. No app, fixture, build, resource,
renderer or animation setting changed.

The next separate campaign, `thumb-recovery-71ce4ac14b10b22c33312dda`, retains a new 360-file source
closure in which only `03-fast-scroll.yaml` and `performance-hotspots.test.mjs` differ from the prior
snapshot (input fingerprint `121c2f23…`). It uses the byte-identical collector and the original app,
fixtures, build, resources, renderer and animation settings, with all three authorized H08 helper
deviations. All **2,785** existing evidence files are pinned as prior evidence. It is prepared but not
started; the main session launches it detached, and T014 stays unchecked until all 48 samples and
both complete phase baselines pass.

The campaign `thumb-recovery-71ce4ac14b10b22c33312dda` ran API 31 invocation
`inv-3bd2889b9e3dc33caeb0d769` and stopped (exit **130**) after **12 of 13** recorded API 31 samples
passed (H01–H04, three repetitions each).
H05 repetition 1 (`raw-31-13`) failed with 0 mandatory assertions executed / 1 failed: the host FTP
validation container's `vsftpd` (the container's PID 1) segfaulted after H01 repetition 3's last FTP
session, and because the compose services use `restart: "no"` FTP stayed down, so H05 got
`CONNECTION_REFUSED`. The host has four earlier `vsftpd` segfaults on record, so the binding decision
classifies this as a rare host flake, not a harness, flow or app defect. API 36 and both phase
baselines did not run, and the host was left clean. The campaign, its failed sample and its retained
APK stay immutable and separate; none of its samples is pooled or replaced.

The next separate campaign, `ftp-rerun-77f7a555775973c43fb2268b`, is an **unchanged rerun**: its
source closure (360 files, input fingerprint `121c2f23…`), parser, collector, flows, app, fixtures,
build, resources, renderer and animation settings and all three authorized H08 helper deviations are
byte-identical to `thumb-recovery-71ce4ac14b10b22c33312dda`; no code changed. The foundation gate
passed **162/162**, and all **2,929** existing evidence files are pinned as prior evidence. It is
prepared but not started; the main session launches it detached, and T014 stays unchecked until all
48 samples and both complete phase baselines pass.

### Authorized app race fix (baseline-input change)

The campaign `ftp-rerun-77f7a555775973c43fb2268b` ran API 31 invocation
`inv-7f21ec33dfaa80f908871b6f` and stopped (exit **130**) after **17 of 18** recorded API 31 samples
passed. H06 repetition 3 (`raw-31-18`, `scan/05-background-discards`) failed its mandatory
`Unsynced` check: after the Bulk folder was added, the summary still read the first scan's
`Unsynced: 3`. API 36 and both phase baselines did not run, and the host was left clean.

Read-only diagnosis of the retained artifact shows an **app race**, not a flow or fixture problem.
Android delivers the folder picker's result before the activity resumes; the resume starts the
automatic local refresh (FR-003), and that refresh read the source list before
`SourceOperations.onPicked` had saved the new folder. The picker finished at 23:57:58.017 and the
refresh published Generation 2 at 23:57:58, about a second later, so it covered only the first source.
Repetitions 1 and 2 passed only because the save happened to win the race.

The binding decision authorizes an app fix with tests first. `SourcePicker.awaitSettled()` now
suspends while a pick that the picker has already returned is being saved or rejected. It never waits
while the picker is still open. `ScanOperations.start` calls it before it reads the source list, so
every scan, including the automatic refresh, sees the new folder. Three new Robolectric tests failed
before the change. The module-level one reproduced the race exactly: `startScan` resolved
`NO_SOURCES_SELECTED` while the picked folder was still being saved. With the fix, the full Android
unit suite passes **635/635** and the foundation gate **162/162**. Flows, helpers, the parser,
fixtures, build settings, resources, renderer and animation settings are unchanged, and so are all
three authorized H08 deviations.

This is a **baseline-input change**: the app source, and therefore the debug APK, differ from the
original. The next separate campaign, `race-recovery-caf35ec840c216e7433397da`, keeps a new 360-file
source closure in which only the seven race-fix files (three app and four test sources) differ from
the prior snapshot (input fingerprint `a88f0ed7…`). It retains the corrected debug APK as
`corrected-reference.apk` (`d1e430fb…`, built with `--no-daemon :app:assembleDebug`; an up-to-date
rebuild reproduced the digest) next to the unchanged `originalAPKReference`. The campaign's collector
differs from the prior one only in what it compares the producing APK with: the corrected reference
digest instead of the original one, with `matchesOriginalAPK: false` recorded. All **3,108**
existing evidence files are pinned as prior evidence. The failed campaign, its failed sample and its
retained APK stay immutable and separate, and none of its samples is pooled. The campaign is prepared
but not started: the main session launches it detached. T014 stays unchecked until all 48 samples and
both complete phase baselines pass.

The campaign `race-recovery-caf35ec840c216e7433397da` ran API 31 invocation
`inv-ec6b6d11db5131d674789437` and stopped (exit **1**) about two minutes in, before any sample, with
`producing-apk-mismatch`. The validator's own `--no-daemon :app:assembleDebug` build (22 of 139 tasks
executed) produced `app-debug.apk` `b7e9ed37…` (176,766,094 bytes), while the preparing unit had
pinned `d1e430fb…` from its own, differently invoked build. The source closure was unchanged; the
debug APK digest is simply not reproducible across differently invoked builds. API 36 and both phase
baselines did not run, and the host was left clean. The campaign stays immutable and separate.

The binding decision pins the validator-built digest. The next separate campaign,
`apk-pin-17c5e90d7ead8f8c4ea78f24`, keeps the same 360-file source closure (all member digests and
modes re-verified, input fingerprint `a88f0ed7…` recomputed) and retains the validator-produced APK as
`corrected-reference.apk` (`b7e9ed37…`), copied from the build output without running Gradle and
traced to its producing invocation and build log. `d1e430fb…` is recorded as the superseded pin.
The collector is byte-identical to the previous one and still requires the exact producing digest.
The parser, flows, helpers, app, fixtures, build settings, resources, renderer and animation settings
are unchanged. The foundation gate passed **162/162**, and all **3,166** existing evidence files are
pinned as prior evidence. The campaign is prepared but not started: the main session launches it
detached. T014 stays unchecked until all 48 samples and both complete phase baselines pass.

The campaign `apk-pin-17c5e90d7ead8f8c4ea78f24` ran API 31 invocation
`inv-c89b8ea5825537a30c220ca3`, and the producing APK matched the `b7e9ed37…` pin. It stopped
(exit **130**) after **14 of 15** recorded API 31 samples passed. H05 repetition 3 (`raw-31-15`)
failed before any flow command ran, with 0 mandatory assertions executed and 1 missing. Maestro's
on-device server died during its first `deviceInfo` call (`DeviceServerDiedException`, the adb
channel closed, gRPC `UNAVAILABLE`). The binding decision classifies this as an infrastructure
flake, seen once before in `fresh-f25d8197ea5baa8059878fbd`, not as a harness, flow or app defect.
API 36 and both phase baselines did not run, and the host was left clean. The campaign, its failed
sample and its retained APK stay immutable and separate. None of its samples is pooled or replaced.

The next separate campaign, `server-rerun-565667d55f1b159bb3dd1d23`, is an **unchanged rerun** of
`apk-pin-17c5e90d7ead8f8c4ea78f24`. No code changed. Its 360-file source closure was re-verified
against the working tree, and the recomputed input fingerprint is still `a88f0ed7…`. The
collector is byte-identical to the previous one. The parser, flows, helpers, app (including the
authorized race fix), fixtures, build settings, resources, renderer and animation settings and all
three authorized H08 deviations are unchanged. The campaign keeps the exact-digest check and pins the
same validator-built APK, `b7e9ed37…` (176,766,094 bytes), copied from the previous snapshot without
running Gradle. The foundation gate passed **162/162**, and all **3,318** existing evidence files are
pinned as prior evidence. The campaign is prepared but not started: the main session launches it
detached. T014 stays unchecked until all 48 samples and both complete phase baselines pass.

### Authorized FastScroller release fix (baseline-input change)

The campaign `server-rerun-565667d55f1b159bb3dd1d23` ran API 31 invocation
`inv-038f2d9a53c645a1b56f8888`, and the producing APK matched the `b7e9ed37…` pin. It stopped
(exit **130**) after **21 of 22** recorded API 31 samples passed; H01–H07 passed three times each,
including all three H06 repetitions with the race fix. H08 repetition 1 (`raw-31-22`,
`polish/03-fast-scroll`) failed: the thumb-visibility retry passed, and the following thumb drag took
the thumb, but it released one month band early (`09.2023` instead of `08.2023`), so the band row
`mimg-0188.png` never appeared. API 36 and both phase baselines did not run, and the host was left
clean.

Read-only diagnosis found an **app-side** cause, not a flow-timing problem. The API 31 drag has only
about ±22 px of margin inside the target band, and timing and load matched the passing runs.
`FastScroller` mapped the release from the last processed move rather than the touch-up point, and
a bands change during the drag ended the drag early. The binding decision authorizes an app fix with
tests first. The release now maps the touch-up point (`pageY` of the release event minus the
gesture's start; `gesture.dy` only when no touch-up point is available), and a bands change during a
drag no longer ends it: the release maps over the bands shown at that time. This deliberately
replaces 007's "a new result while dragging ends the drag" behavior. Two new Jest tests failed before
the change: a release whose final move was never processed jumped to band b (`250`) instead of
band d (`750`), and a mid-drag result called `onJump` before the release. The full Jest suite passes
**737/737** (46 suites) and the foundation gate **162/162**. Flows, helpers, timeouts, the parser,
fixtures, build settings, resources, renderer and animation settings are unchanged, and so are the
race fix and all three authorized H08 deviations.

This is a **baseline-input change** to the app's JavaScript. The debug APK carries no JS bundle
(Metro serves the app code), and no Gradle input changed, so the APK pin stays the validator-produced
`b7e9ed37…` (176,766,094 bytes). The build output still holds that digest. It was copied from the
previous snapshot without running Gradle, and the collector still requires the exact producing digest.
If the validator's own build produced anything else, the campaign would stop before any sample.

The next separate campaign, `drag-fix-a2022730fb10326787b2c210`, keeps a new 360-file source closure
in which only `src/files/FastScroller.tsx` and its test differ from the prior snapshot. Its input
fingerprint is `ac5c4863…`, computed by the runner's own closure rule, which was rechecked by
recomputing the prior `a88f0ed7…`. The collector differs from the prior one only in its capture note,
which names the FastScroller fix. All **3,522** existing evidence files are pinned as prior evidence.
The failed campaign, its failed sample and its retained APK stay immutable and separate, and none of
its samples is pooled. The campaign is prepared but not started: the main session launches it
detached. T014 stays unchecked until all 48 samples and both complete phase baselines pass.

### Authorized FTP restart on failure (baseline deviation)

The campaign `drag-fix-a2022730fb10326787b2c210` passed **all 48** scheduled measurement samples
(API 31 invocation `inv-c65317eb75da473f24d7260e` 24/24, API 36 invocation
`inv-60d761314a5ac315ab057ee8` 24/24, both with the original actual software mode, fixtures and
measurement lifetime). The API 31 phase baseline, invocation `inv-35b1ee23fae4610a43e2ce14`, then
failed (exit **1**) at `mvp/02-setup-errors` because FTP refused connections. The container's
`vsftpd` (PID 1) segfaulted at 20:55:13 with the same null dereference at `vsftpd+0x12a80` as on
2026-10-13, so this is a repeatable bug in the pinned validation FTP image, not a flow or app
defect. It has stopped 2 of the last 6 campaigns, and with `restart: "no"` FTP stayed down for the
rest of the invocation. The API 36 phase baseline did not run, and the host was left clean. The
campaign stays immutable and separate, including its 48 passing samples: none is pooled into a later
campaign.

The binding decision authorizes restarting FTP on failure and recording every restart:

- `validation/services/compose.yaml` sets `restart: on-failure` for the FTP service only. SFTP and
  WebDAV keep `restart: "no"`. The image digest, ports, mounts, secret and security options are
  unchanged.
- Docker restarts the same container, so the FTP branch of
  `validation/services/runtime-entrypoint.sh` had to be made restart-safe for the policy to work.
  It skips `useradd` when the fixture account already exists (a second `useradd` exits nonzero under
  `set -e`, which would restart-loop with FTP down), and it creates the `vsftpd` audit log only when
  it is missing, so the scoped audit keeps every entry from before the crash. A first start is
  unchanged: the per-acquisition state and its audit directory are always new.
- `scripts/validation/protocol-service.sh` records the summed `RestartCount` of the scope's
  containers when the scope begins (`<protocol>.restart-count`). The scoped audit (on stop for an
  acquired service, on audit for a borrowed one) writes `<protocol>.restarts`: the count before and
  after, then each `die`/`start` event inside the scope from `docker events`. The count delta is
  authoritative; the event times come from the daemon's bounded event history. A record that cannot
  be read or contains anything other than validated count and event lines fails the audit. The
  lifecycle copy retains it as `raw/lifecycle/<protocol>.restarts`.
- `performance-report.mjs finish` adds an optional, allowlisted `serviceRestarts` field to the run
  record (protocol, restart count, and `die`/`start` events with Unix millisecond times) and a
  "Service | Container restarts | Restart events" table to `report.md`. A restart does not fail a
  run by itself: samples and flows that fail because of an outage still fail. Older records without
  the field validate unchanged.

Five new contract tests failed before the change: FTP must use `on-failure` while SFTP and WebDAV
keep `"no"`; the entrypoint must keep the account and the log; a production-harness `e2e` run whose
FTP container restarts once must retain `ftp.restarts` and show `ftp | 1 | die …, start …` in the
report; a malformed event record must fail the audit; and `validateRun` must accept only the
allowlisted restart fields. A throwaway container from the pinned image (no published ports, removed
afterwards) confirmed the restart-safe entrypoint brings `vsftpd` back after a re-entry with the
account and log intact, and that `RestartCount` and the `die`/`start` events read as recorded. The
offline gate re-validated all 60 retained run records with the changed validator: all still pass and
none changes. The parser's command ingestion is untouched.

This is a **baseline deviation** in the validation services, not in the app, flows, helpers,
timeouts, fixtures, build settings, resources, renderer or animation settings. It carries over the
race fix, the FastScroller release fix and all three authorized H08 deviations, and the APK pin stays
the validator-produced `b7e9ed37…`. The collector also requires all three restart records in each
child run and copies them into each child's validation record.

The next separate campaign, `ftp-restart-1f6f12f67e0758837bc2f785`, keeps a new 360-file source
closure in which only the seven files of this change differ from the prior snapshot
(`compose.yaml`, `runtime-entrypoint.sh`, `protocol-service.sh`, `performance-report.mjs` and the
three contract-test files). Its input fingerprint is `cd38bba3…`, computed by the runner's own
closure rule. The APK pin, `b7e9ed37…` (176,766,094 bytes), was copied from the prior snapshot
without running Gradle; no Gradle input changed, and the build output still holds that digest. The
collector differs from the prior one only in the restart-record requirement and its capture note.
The foundation gate passed **167/167**, and all **4,133** existing evidence files are pinned as prior
evidence. The campaign repeats the full schedule: all 48 samples and both complete phase baselines.
It is prepared but not started: the main session launches it detached. T014 stays unchecked until
all 48 samples and both complete phase baselines pass.

### Per-cohort collection and adb root/unroot uid proof

Campaign `ftp-restart-1f6f12f67e0758837bc2f785` passed measure-31 (24/24, input fingerprint
`cd38bba3…`, APK `b7e9ed37…`), then stopped at measure-36 startup: both llkd services were stopped,
but `adb unroot` exited nonzero (`unroot:failed` in `raw/validator-36/watchdog.private`), so no API 36
sample ran. The campaign stays immutable and is listed beside any later passing cohort run.

The binding decision splits T014 into four cohorts (measure-31, measure-36, e2e-31, e2e-36). A cohort
counts once it has one fully passing run; a failed run of a cohort is retained unchanged and listed
next to the passing one, and only that cohort is rerun. Nothing within a run is ever replaced.

`adb root` and `adb unroot` restart adbd, and the client can lose its channel and exit nonzero although
the restart worked. `scripts/validation/android-validator.sh` now records such an exit
(`root:nonzero`/`unroot:nonzero`) instead of failing on it, and proves each switch only by the
observed shell uid (0 after root, 2000 after unroot) within the existing 60-poll `await_shell_uid`
bound (`root-uid:verified`/`unroot-uid:verified`). A uid that never arrives still fails setup and
still releases the emulator; a failed root still restores the shell user before failing. A
production-harness test (both APIs, nonzero root and nonzero unroot with the switch completed)
failed before the change; the existing fault matrix still fails on every unproven switch.

This change is inside `scripts/validation/`, which the runner's input fingerprint covers, so the
fingerprint of the current tree is `a7507241…`, not `cd38bba3…` (reverting only this change's two
files gives back `cd38bba3…` exactly).

The binding follow-up decision accepts this setup-only difference. The measure-31 run of
`ftp-restart-1f6f12f67e0758837bc2f785` (`inv-59eb9e1677265a9a6989f26e`, fingerprint `cd38bba3…`)
stays counted, and the remaining cohorts (measure-36, e2e-31, e2e-36) run under `a7507241…` with
the same validator-built APK pin `b7e9ed37…`. The two fingerprints differ only in
`scripts/validation/android-validator.sh` and `scripts/validation/performance-runner.test.mjs`. The
unified diff of these two files is kept as `fingerprint-diff.private.patch` in the new snapshot. The
preparation recomputed both fingerprints: the current tree gives `a7507241…`, and putting back only
the two files from the prior `source.tar` gives `cd38bba3…`. No app, flow, helper, fixture,
workload, timeout, build, resource, renderer, animation or assertion input differs.

The cohort campaign `cohort-18b8b392b89115071d59e2f9` keeps the same 360-file source closure; only
those two files differ from the prior snapshot. The APK pin was copied from the prior snapshot
without running Gradle, and the build output still holds `b7e9ed37…`. The foundation gate passed
**172/172**. An offline gate re-validated all 64 retained run records (31 `run.json`, 33
`record.private.json`) with the unchanged validator: all were accepted and none changed. All
**4,410** existing evidence files are pinned as prior evidence.

The collector differs from the prior one in five ways:

- It runs only measure-36, e2e-31 and e2e-36.
- A scheduled-sample failure stops only its own child.
- A failed cohort is retained with its own `<cohort>.blocker.json`, and the next cohort still runs.
  A signal interruption stops the whole campaign.
- Completeness combines the counted measure-31 run with the new measure-36 run, after checking the
  counted run's digests, fingerprint, APK and original mode.
- `completion.json` lists every cohort's status.

Every per-run check is unchanged: original mode and fixtures, lifetime policy, the exact producing APK
digest, the restart records, three passing repetitions of H01–H08 per API, and all eight acceptance
flows per phase baseline. The campaign is prepared but not started: the main session launches it
detached. T014 stays unchecked until every cohort has one fully passing run.

### Cohort results so far and the widened 1 ms rounding rule

Cohort campaign `cohort-18b8b392b89115071d59e2f9` (fingerprint `a7507241…`, APK `b7e9ed37…`) passed
measure-36 (`inv-9a9c13f77bd689b5f1d64519`) and e2e-36 (`inv-403c4ce5dd7b7bf4949d0f56`). Its e2e-31
run (`inv-36ff76c94d84263140edcff6`) ran 39/39 Maestro flows with 0 service restarts, but the parser
rejected `scan/05-background-discards` with `unsupported-artifact-overlap`: leaf seq 48 (depth 3)
overlaps seq 49 (depth 2) by 1 ms. Counted cohorts are now measure-31
(`ftp-restart-1f6f12f67e0758837bc2f785`, `inv-59eb9e1677265a9a6989f26e`), measure-36 and e2e-36
(`cohort-18b8b392b89115071d59e2f9`). Only e2e-31 remains.

The binding decision reran e2e-31 unchanged as `e2e31-rerun-04631f308125be791669cd65`. Its unit
never wrote a `precollection-gate.json`; the gate it ran is recorded here from its retained
`retention.json` and `campaign.json`, and re-checked read-only now:

| Check | Result |
| --- | --- |
| Foundation tests (`pnpm test:foundation`) | 172 passed, 0 failed, 0 cancelled, 0 skipped |
| Input fingerprint | `a7507241…`, unchanged; no code or parser change |
| Source closure | 360 files, `source.tar` `486f6710…`, identical to `cohort-18b8b392b89115071d59e2f9` |
| APK pin | `b7e9ed37…`, copied from the prior snapshot without running Gradle |
| Prior evidence pinned | 5,195 files; all still match their pinned digests |
| Collector | `cohort-18b8b392b89115071d59e2f9` collector, e2e-31 only; capture text and the counted-cohort list changed |

That rerun (`inv-11713e9af7206baaab1dc507`) also ran 39/39 flows, then the parser rejected
`polish/01-sort`: leaf seq 211 (depth 1) overlaps leaf seq 213 (depth 0) by 1 ms, and only the
`runFlowCommand` wrapper seq 212 lies between them. Both failed e2e-31 runs stay immutable and are
listed beside any passing rerun; nothing is pooled or replaced.

Across all 548 retained `commands.json` artifacts, every overlap is exactly 1 ms (31 at the same
depth, 4 one level deeper, 2 one level shallower; both shallower ones are on e2e-31). The binding
decision widens the rule in `ingestCommands`: adjacent completed leaves may overlap by at most 1 ms
when their depth changes by at most one level either way, and only wrapper records
(`runFlowCommand`, `repeatCommand`, `retryCommand`) with no missing sequence number lie between
them. The shared millisecond is charged once. Overlaps above 1 ms, two-level depth changes, failed,
warned or running leaves, non-adjacent leaves, a non-wrapper record (a skipped leaf, say) or a
missing sequence between them, and fractional timing still fail. Tests built from both real shapes
failed before the change.

Offline gate, comparing the parser before and after the change:

| Gate | Result |
| --- | --- |
| `commands.json` artifacts (548) | 546 accepted with identical output; 0 newly rejected; 0 changed |
| Newly parsed | exactly the two known rejections (`cohort-18b8b392…` `scan_05-background-discards`, `e2e31-rerun-04631f30…` `polish_01-sort`) |
| Run records (72: 35 `run.json`, 37 `record.private.json`) | all accepted, `validateRun` output identical |
| Recorded statuses | never rewritten; both failed e2e-31 runs keep `failed` |

The parser and its test are inside the input fingerprint, so the current tree gives `09490278…`.
Putting back only `scripts/validation/performance-report.mjs` and
`scripts/validation/performance-report.test.mjs` from the prior snapshot gives `a7507241…` exactly.
The two files' unified diff is kept as `fingerprint-diff.private.patch` in the new snapshot, beside the
earlier adb setup-only relation (`cd38bba3…` to `a7507241…`). No app, flow, helper, fixture,
workload, timeout, build, resource, renderer, animation, setup or assertion input differs.

The e2e-31-only campaign `widened-rounding-f7cfa3959e5aff2f8088a420` is prepared but not started. It
keeps the same 360-file closure (only the two parser files differ), the APK pin `b7e9ed37…` (the
build output still matches; Gradle was not run), and the previous collector with only its capture
text changed. It counts measure-31, measure-36 and e2e-36 as above, lists both failed e2e-31 runs,
and pins all 5,463 existing evidence files. The foundation gate passed **175/175** (172 earlier tests
plus the three new rounding tests). Its `precollection-gate.json` records these results. The main session launches it detached. T014 stays
unchecked until e2e-31 has one fully passing run.

### Third e2e-31 failure and the general ≤1 ms rounding rule

The e2e-31-only campaign `widened-rounding-f7cfa3959e5aff2f8088a420` (`inv-cc8a5edf18bd715487228aa9`,
fingerprint `09490278…`, APK `b7e9ed37…`) ran 39/39 Maestro flows with 0 service restarts, then the
parser rejected `mvp/02-setup-errors` with `unsupported-artifact-overlap`: leaf seq 98
(`defineVariablesCommand`, depth 0) ends at …047, while the zero-duration seq 99 and seq 100 (both
depth 1) start at …046, so seq 100 overlaps the non-adjacent seq 98 by 1 ms. The campaign stays
immutable and is listed beside the two earlier failed e2e-31 runs; nothing is pooled or replaced.

Each shape-specific widening exposed the next shape, and across every retained artifact each
leaf-pair overlap is at most 1 ms and involves only completed leaves. The binding decision makes the
rule in `ingestCommands` fully general: any overlap of 1 ms or less between two completed leaves is
millisecond rounding, whatever their depth, adjacency or the records between them. The overlap is
the length of the two intervals' intersection. Time is charged once: a leaf loses the union of its
intersections with all earlier leaves, so a millisecond shared by several leaves is never subtracted
twice. Any overlap over 1 ms, fractional timing in an overlap, or any overlap involving a failed,
warned or running leaf still fails, and failed or missing mandatory assertions are unaffected.
Tests from all three real shapes (`cohort-18b8b392…` scan/05 seq 48→49, `e2e31-rerun-04631f30…`
polish/01-sort seq 211→213, `widened-rounding-f7cfa395…` mvp/02-setup-errors seq 98 vs 100) plus
charged-once and rejection tests were written first; the new-shape tests failed with
`unsupported-artifact-overlap` before the change. Earlier tests that asserted rejection of
depth changes, gaps or records between leaves now assert acceptance, as the decision requires.

Offline gate over all retained artifacts:

| Gate | Result |
| --- | --- |
| `commands.json` artifacts (587) against the parser in force (`09490278…`) | 586 accepted with identical output; 0 newly rejected; 0 changed |
| Newly parsed | only `widened-rounding-f7cfa395…` `mvp_02-setup-errors` |
| Against the `a7507241…` parser | 583 identical; newly parsed: the three known rejections plus `widened-rounding-f7cfa395…` `polish_07-results-updated-keeps-place`, which that run already parsed under the widened parser (never rejected in any run) |
| Run records (74: 36 `run.json`, 38 `record.private.json`) | all accepted, `validateRun` output identical |
| Recorded statuses | never rewritten; all three failed e2e-31 runs keep `failed` |

The parser and its test are inside the input fingerprint, so the current tree gives `b45602e4…`.
Putting back only `scripts/validation/performance-report.mjs` and
`scripts/validation/performance-report.test.mjs` from `widened-rounding-f7cfa395…` gives `09490278…`
exactly, and from `cohort-18b8b392…` gives `a7507241…` exactly. Their unified diff is kept as
`fingerprint-diff.private.patch` in the new snapshot, beside the earlier relations (`cd38bba3…` to
`a7507241…`, adb setup only; `a7507241…` to `09490278…`, parser only). No app, flow, helper, fixture,
workload, timeout, build, resource, renderer, animation, setup or assertion input differs.

The e2e-31-only campaign `general-rounding-5bcf928b5a0a715b3d8ee2f1` is prepared but not started. It
keeps the same 360-file closure (only the two parser files differ), the APK pin `b7e9ed37…` (the
build output still matches; Gradle was not run), and the previous collector with only its capture
text changed. It counts measure-31 (`ftp-restart-1f6f12f67e0758837bc2f785`), measure-36 and e2e-36
(`cohort-18b8b392b89115071d59e2f9`), lists all three failed e2e-31 runs, and pins all 5,732
existing evidence files. The foundation gate passed **179/179** (175 earlier tests plus four new
rounding tests). Its `precollection-gate.json` records these results. The main session launches it
detached. T014 stays unchecked until e2e-31 has one fully passing run.

### T014 complete: original software baseline cohorts

The main session launched `general-rounding-5bcf928b5a0a715b3d8ee2f1` detached. Its e2e-31 run
(`inv-a9c6fd327af944ed21831980`, fingerprint `b45602e4…`, APK `b7e9ed37…`) passed: the supervisor
and child both exited 0, all eight phases passed (boot, build, install, two device-fixture phases,
workspace, staged, cleanup), all eight acceptance invocations executed, Maestro reported 39/39 flows
passed, the ftp/sftp/webdav containers restarted 0 times, and the remote audits found zero
unexpected remote changes. The run kept original mode and fixtures, the 9,000-second non-measurement
emulator lifetime, KVM with the verified actual software renderer (no fallback), animation scales of
1, and the retained producing APK, whose digest matches the pin. The host was clean afterwards (no
emulator, Maestro, Metro or protocol container left running).

The completion check re-verified independently in the verification unit:

| Check | Result |
| --- | --- |
| Prior evidence pinned by the campaign | 5,732 files, all byte-identical to their pinned digests |
| Counted run records | measure-31, measure-36 and e2e-36 `run.json` digests match their pins |
| `hotspot-cohort-validation.json` | `complete: true`; 16 API/scenario rows (H01–H08 × API 31/36) all `matched`, three passing samples each (48 total) |
| Foundation tests (`pnpm test:foundation`) | 179 passed, 0 failed |

The four counted cohorts, all with the validator-built APK `b7e9ed37…` and the original actual
software profile, are:

| Cohort | Campaign | Invocation | Fingerprint | Result |
| --- | --- | --- | --- | --- |
| measure-31 | `ftp-restart-1f6f12f67e0758837bc2f785` | `inv-59eb9e1677265a9a6989f26e` | `cd38bba3…` | 24/24 samples passed |
| measure-36 | `cohort-18b8b392b89115071d59e2f9` | `inv-9a9c13f77bd689b5f1d64519` | `a7507241…` | 24/24 samples passed |
| e2e-36 | `cohort-18b8b392b89115071d59e2f9` | `inv-403c4ce5dd7b7bf4949d0f56` | `a7507241…` | workspace + staged passed |
| e2e-31 | `general-rounding-5bcf928b5a0a715b3d8ee2f1` | `inv-a9c6fd327af944ed21831980` | `b45602e4…` | workspace + staged passed |

The fingerprints differ only as recorded above: `cd38bba3…` to `a7507241…` in the adb root/unroot
setup files, and `a7507241…` to `09490278…` to `b45602e4…` in the parser and its tests. No app,
flow, helper, fixture, workload, timeout, build, resource, renderer, animation or assertion input
differs between the counted cohorts. The failed e2e-31 runs stay retained and listed beside the
passing one, unchanged and not pooled: `cohort-18b8b392…` (`inv-36ff76c94d84263140edcff6`),
`e2e31-rerun-04631f308125be791669cd65` (`inv-11713e9af7206baaab1dc507`) and
`widened-rounding-f7cfa3959e5aff2f8088a420` (`inv-cc8a5edf18bd715487228aa9`), as do every earlier
failed or interrupted campaign in `before-software/`. This evidence is for baseline completeness only:
it makes no before/after optimization or lifetime speedup claim. T014 is complete.

### Preserve the APK when the baseline is actually built

Immediately after the producing baseline build succeeds, before any subsequent build/tuning, copy
that **exact** debug APK into the associated original-input snapshot using exclusive creation.
Record its SHA-256, byte size, ABI, build task/outcomes, invocation identifier, source/dirty-input
fingerprint and cache/daemon policy. Do not infer provenance from an APK's existence or timestamp.
Mark APK state `not-built` until then; a source archive is not an APK baseline.

For example, after setting `SNAPSHOT`, `BASELINE_APK` and `BUILD_INVOCATION_ID` to the retained snapshot,
actual produced artifact and producing opaque invocation, use Node's built-in file APIs:

```sh
export SNAPSHOT BASELINE_APK BUILD_INVOCATION_ID
node --input-type=module <<'NODE'
import {constants} from 'node:fs';
import {copyFile, chmod, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';

const {SNAPSHOT, BASELINE_APK, BUILD_INVOCATION_ID} = process.env;
if (!SNAPSHOT || !BASELINE_APK || !/^[a-zA-Z0-9-]+$/.test(BUILD_INVOCATION_ID ?? '')) {
  throw new Error('Missing private snapshot, produced APK or opaque build invocation');
}
const target = join(SNAPSHOT, 'baseline.apk');
await copyFile(BASELINE_APK, target, constants.COPYFILE_EXCL);
await chmod(target, 0o600);
const bytes = await readFile(target);
await writeFile(join(SNAPSHOT, 'baseline-apk.json'), JSON.stringify({
  schemaVersion: 1,
  invocationId: BUILD_INVOCATION_ID,
  artifact: 'baseline.apk',
  sha256: createHash('sha256').update(bytes).digest('hex'),
  sizeBytes: bytes.length,
  provenance: 'Refer to producing invocation source/build/cache/ABI records',
}, null, 2) + '\n', {flag: 'wx', mode: 0o600});
NODE
```

Keep the producing build records with the snapshot; this example is only exclusive artifact capture,
not a replacement for provenance or the future reporter. If metadata capture fails after the copy,
retain that partial capture as incomplete and use a new snapshot/capture identity; do not overwrite it.

### T024 host-graphics calibration: one candidate per invocation

The first `measure --graphics auto` design calibrated every candidate in one invocation under one
Metro, which its 14,400-second cap cannot fit (one software cohort alone took about 3 h). Following
the 2026-10-16 decision, a calibrating invocation now measures **exactly one** planned candidate with
its own Metro, and its 24 samples are that renderer's own cohort. `calibration-plan` picks the first
planned candidate of the stored per-API round that has no result yet; `rank` adds the invocation's
result to the round in the report directory's `acceleration-ranking.json` (`calibrations[api]`).
The API is ranked (`apis[api]`, with `calibrationInvocations`) only once every planned candidate has a
result and none failed its measurement; until then each invocation's selection is `provisional`. Changed
pre-boot inputs, a changed ranking fingerprint or a finished round that did not rank start a new round,
and the old one is kept in `calibrationHistory`, never merged. A candidate that fails to boot is
recorded as `boot-failed` and its invocation exits nonzero, because it measured no baseline. Workloads,
samples, assertions and the Metro and emulator caps are unchanged. Fail-first tests are in
`scripts/validation/performance-runner.test.mjs` and `scripts/validation/performance-report.test.mjs`.
The foundation gate passed **216/216**.

The detached campaign `host-calibration-4fc2d85e6646bf6816eb1593` (`before-host/`) is prepared but not
started. It runs six invocations, API 31 then 36, each calibrating one of `host-intel-1`,
`host-nvidia-1` and `software-swiftshader` (the software control), all into one shared report
directory. Its collector runs `nvx on` before discovery, checks the NVIDIA power state before every
child, records it in `nvidia-power.json`, and runs `nvx off` at the end, also on failure or signal.
A candidate's own boot or measurement failure is retained and the campaign continues. A signal,
changed source or prior evidence, NVIDIA power loss or non-discovery, an unexpected candidate, a
producing APK other than the pin `b7e9ed37…`, or changed image, guest resources or animation
scales stops it. The snapshot pins a 362-file closure: the T014 closure plus the acceleration module
and its test. Its input fingerprint `dacf09e0…` differs from T014's `b45602e4…` only in US2
acceleration setup files (`android-flow.sh`, `android-validator.sh`, the report/acceleration modules
and their tests). The diff from `d61ce5f` is kept as `fingerprint-diff.private.patch`. App,
flows, fixtures, workload, build, guest resources, animation settings, timeouts and assertions are
unchanged. All 6,055 earlier evidence files are pinned.

**Result (T024 complete).** The main session ran the campaign detached; its collector exited 0 and
`completion.json` is `passed`. All six invocations passed 24/24 samples with KVM and the requested
renderer verified, the APK pin matched, and `nvidia-power.json` shows NVIDIA `on` at every child
checkpoint and `off` after the final `nvx off`. H03/H07/H08 median subtotals (s):

| API | host-intel-1 | host-nvidia-1 | software-swiftshader (control) | Ranked selection |
| --- | --- | --- | --- | --- |
| 31 | **424.1** | 440.9 | 473.0 | host-intel-1 (no tie, no tradeoff) |
| 36 | 440.4 | **429.7** | 474.7 | host-nvidia-1 (2.5 % ahead; H04 faster on Intel) |

Both APIs are `ranked` in `runs/acceleration-ranking.json` (ranking fingerprints `463d12c9…` and
`ca45f96e…`). Every candidate's 24 samples are its original-code (APK `b7e9ed37…`) H01–H08 baseline
for later matched-mode comparison; the software control is kept beside them, and T014's legacy
`swiftshader_indirect` cohorts stay the original-mode reference. No candidate failed; one FTP
container restart in `measure-31-software-swiftshader` is recorded (all its samples passed). Guest
Vulkan was observed `enabled` on API 31 and `absent` on API 36.

NVIDIA availability is power-dependent: on this Optimus host the RTX 4070 (10de:2820, renderD129)
is exposed only after `nvx on`. In the default `off` state discovery truthfully reports
`host-nvidia-1` as unavailable (`audio-only`). That is unavailability, not incompatibility; the
calibration proves the powered route works. Because the exposed candidate set is a ranking input, a
run with NVIDIA off does not match these rankings. The validator never changes host power itself.
The per-renderer summary is in `before-host/host-calibration.md`.

### T025 automated fallback check

`node scripts/validation/acceleration-fault-check.mjs --api 31 --api 36 --case <hardware-fallback|all-options-fail> --report-dir <dir>`
is a developer acceptance harness, not a runner option. It takes the same `invocation.lock` claim as
`android-flow.sh`, then drives the real validator lifecycle under `--graphics auto` semantics with a
private SDK overlay whose generated emulator wrapper rejects only this run's token-scoped launches of
the owned AVD. Probes pass through, the installed SDK, AVDs and parent environment are untouched, and
the overlay is removed afterwards. It writes an allowlisted `fault-check.json` (`rankingUse: false`,
`timingSamples: 0`) and exits 0 only when the case's expected result and cleanup checks hold, so the
expected validator exit 1 of `all-options-fail` is a harness pass. On 2026-10-17, with NVIDIA in its
default unpowered state, `hardware-fallback` fell back from the injected `host-intel-1` to verified
KVM `software-swiftshader` with a healthy device on both APIs, and `all-options-fail` exhausted all
five candidates in order with the actionable message and clean release on both APIs. A first
`hardware-fallback` run was rejected by a harness evaluation bug (graphics kind read from the wrong
record); it is retained, the bug was fixed fail-first, and the rerun passed. Details:
`validation/evidence/performance/acceleration-fallback.md`.

### T026 ranked-selection acceptance campaign

Ranked automatic selection already works through the existing runner path: `android-flow.sh e2e
--graphics auto` reads `acceleration-ranking.json` in its report directory, tries the ranked candidate
first, reverifies KVM, renderer, driver, image, guest resources and animation scales after boot, and
labels the selection `current` only when the recomputed `rankingFingerprint` matches. A different actual
candidate is `provisional`, changed inputs are `stale`. T026 therefore changes no helper or app file:
editing `android-flow.sh` or `android-validator.sh` would change the ranking's `helperClosure` input and
make both rankings stale, which the 2026-10-17 decision rules out (keep the rankings, no recalibration).
Ranked selection needs `nvx on`, because the exposed candidate set is a ranking input; with NVIDIA
off, auto falls back to the next option and is truthfully labeled stale.

The detached campaign `ranked-acceptance-3382f9f6de494bb4f8e83778` (`acceptance-host/`) ran
two children. It runs two normal `e2e --api <31|36> --graphics auto` invocations into one report
directory whose ranking store is a byte-identical copy of the T024 store (`ac220731…`). Its collector
runs `nvx on` before discovery, checks the NVIDIA power state before and after each child, and runs
`nvx off` at the end, also on failure or signal. A run counts as a ranked hardware acceptance only when
the full workspace plus staged e2e passes (8 acceptance invocations, assertions executed, none failed
or missing) and the ranked choice (`host-intel-1` on API 31, `host-nvidia-1` on API 36) was reused
with selection `current`, no rejected attempt, KVM, hardware graphics, and the same renderer, driver,
image, configured guest resources, animation scales and fixtures as that candidate's calibration run.
A passing run with a fallback or other identity difference is recorded as a separate cohort, never as
a hardware result, and no run is a timing sample. A signal, changed source, prior evidence or ranking
store, NVIDIA power loss, an APK other than the pin `b7e9ed37…`, or a lifetime/identity fault stops
it. Its input fingerprint `7a71c4b4…` differs from T024's `dacf09e0…` only by the two added T025
fault-check files (reporting-only; all ranking repository inputs are unchanged). The snapshot pins
364 source files and the campaign pins all 7,480 earlier evidence files. Foundation gate: **226/226**.

**Result (incomplete).** The main session ran it detached; the collector exited 1 with
`blocker.json` reason `not-ranked-hardware-accepted`. `e2e-31` (`inv-a89a8dc1…`) is
`ranked-hardware-accepted` on `host-intel-1` and stands. `e2e-36` (`inv-90fff888…`) selected
`host-nvidia-1` with selection `current` and every identity check true, but Maestro failed 1 of 20
flows: `browse/02-gallery-filters`, where the GalleryTwin source row was not visible right after the
folder picker returned (it passed in all 7 earlier recorded runs). Its outcome is `acceptance-failed`.
NVIDIA stayed `on` at every checkpoint and was turned `off` at the end; the ranking store is unchanged.
Both runs are retained unchanged.

Per the 2026-10-17 decision (rerun API 36 unchanged), the detached campaign
`e2e36-rerun-d12a1b72ab3bc4ee788fdf40` (`acceptance-host/`) was then run detached. It runs only
`e2e --api 36 --graphics auto` with the same collector logic (byte-identical below a new header), the
same snapshot and input fingerprint `7a71c4b4…` (all 364 source files rechecked unchanged, so no code,
flow or ranking input differs), a fresh byte-identical copy of the T024 ranking store (`ac220731…`),
and NVIDIA on for the whole run. It pins all 7,946 earlier evidence files, including the failed
campaign. Foundation gate: **226/226**. It was launched detached from the repository root with
`setsid nohup node validation/evidence/performance/acceptance-host/e2e36-rerun-d12a1b72ab3bc4ee788fdf40/collect.private.mjs > validation/evidence/performance/acceptance-host/e2e36-rerun-d12a1b72ab3bc4ee788fdf40/supervisor.private.log 2>&1; echo $? > validation/evidence/performance/acceptance-host/e2e36-rerun-d12a1b72ab3bc4ee788fdf40/supervisor.exit`.

**Result (T026 complete on API 31; API 36 deferred).** The rerun `inv-22798599…` also selected
`host-nvidia-1` with selection `current` and every identity check true, and failed at 31 of 32 flows:
`polish/01-sort` could not find `sources.add` inside the add-scan-source loop. A read-only diagnosis
(2026-10-18 decision) found a race in `validation/maestro/subflows/open-sources.yaml` and
`pick-folder.yaml`: Settings first renders the Repository and Device folders sections as loading
spinners, so `scrollUntilVisible sources.add` succeeds on that pre-load frame, then the loaded rows push
the button or the new row off-screen and the following tap or wait does not scroll. Faster NVIDIA
rendering on API 36 exposes it. Because any flow fix makes both rankings stale, T026 is accepted on the
API 31 ranked pass (`inv-a89a8dc1…`, `host-intel-1`, 8 invocations, 1,184 assertions, 0 failed or
missing), and API 36 on `host-nvidia-1` stays **blocked by this flow race**. The fix is folded into
T037; T046's recalibration and T047's full both-API e2e prove it. All three runs are retained. Details:
`validation/evidence/performance/acceleration-acceptance.md`; the US2 contract check and local decision
are in `validation/evidence/performance/us2-acceptance.md`.

## Graphics acceleration (US2)

**Profiles.** `--graphics` is one of a finite set. `auto` discovers exposed host GPUs (Intel and NVIDIA
are independent candidates, each with its render node and per-process selector), then the emulator's
advertised software modes; it tries the ranked candidate first when the report directory holds a
ranking for the API, otherwise exposed host routes before software. `host-opengl` tries exposed host
routes, then software, without ranking. `software` tries only the software modes, in the fixed order
`swiftshader`, `software`, then `lavapipe` and `swangle` only if needed. Host routes launch with
`-gpu host -feature -Vulkan -accel on`. KVM is required: if it is unusable, no candidate meets the CPU
profile and the validator fails with an actionable message instead of emulating the CPU in software.

**Verification and fallback.** Boot completion does not verify graphics. After boot the validator
records the actual CPU mode, renderer, backend, driver, guest Vulkan state, image, guest resources
(requested and observed RAM separately) and animation scales, and rejects a candidate whose identity is
ambiguous or wrong (for example a software renderer under a host request). A rejected candidate's own
emulator is released before the next attempt, and every attempt is recorded with a sanitized reason. If
every candidate fails, the validator exits nonzero. A fallback is a different cohort, labelled
`provisional`, never a hardware speed result.

**Ranking.** `measure --graphics auto` without a current ranking calibrates one planned candidate per
invocation on the frozen H01–H08 workload (three repetitions); the API is ranked by the H03/H07/H08
median subtotal once every planned candidate has a result, with tradeoffs and a 2 % tie band that
prefers the simpler option. `acceleration-ranking.json` in the report directory stores it with a
separate `rankingFingerprint` over workload, flow/helper closure, APK, fixtures, API/image, tools,
drivers, exposed candidates, host power and resources, build/cache policy and guest/animation settings.
Later `auto` runs reuse it only while that fingerprint matches (`current`); changed inputs make it
`stale`, and the selection is then not called best-performing.

**Measured compatibility on this host (2026-10-16/17).** Calibration (T024) ranked `host-intel-1` on
API 31 (424.1 s against 440.9 s for NVIDIA and 473.0 s for the swiftshader control) and `host-nvidia-1`
on API 36 (429.7 s against 440.4 s for Intel and 474.7 s for swiftshader). These are cross-mode
configuration timings, not optimization speedups. The ranked API 31 profile passed full workspace plus
staged acceptance (T026). On API 36 the ranked NVIDIA profile booted and verified twice but its
acceptance is blocked by the flow race above. The automated fault check (T025) proved fallback from an
injected host failure to verified `software-swiftshader`, and clean nonzero exhaustion of all five
candidates, on both APIs.

**NVIDIA unavailability versus compatibility.** On this Optimus host the RTX 4070 is exposed only after
`nvx on`; in the default `off` state discovery reports `host-nvidia-1` unavailable (`audio-only`). That
is unavailability, not incompatibility: the powered route calibrated and verified on both APIs. The
exposed candidate set is a ranking input, so ranked selection needs `nvx on`; with NVIDIA off, `auto`
falls back to the next option and labels the selection stale. The validator never changes host power.

**Limits.** The SDK is resolved only through `scripts/validation/android-sdk.sh` (`ANDROID_HOME`); the
validator never installs or changes drivers, the installed SDK, AVD definitions, host power or security
settings, and never wipes an AVD or stops a foreign or borrowed emulator. NVIDIA power is switched only
by an explicitly authorized campaign collector, which records it in `nvidia-power.json` and turns it
off at the end. A Vulkan-enabled host route was not probed, because no measured experiment justified it.

## Safe records and comparability

Published records must be allowlisted: opaque IDs, source/workload/APK/fixture digests, API, known
phase/command/status categories, numeric durations and explicit incompatibility/deviation reasons.
Use a stable pseudonymous host ID; omit hostname, account name and full user paths.
Never copy arbitrary argv, environment, `evaluatedCommand`, exception text, full URLs, credentials,
hierarchy/UI text, screenshots, video or raw logs into reports or documentation. Raw tools can contain
these values and remain private locally; sanitization must be tested with credential/content canaries.
Source-located assertion metadata is not a dump of assertion text or actual UI content.

Compare matching **actual** CPU/GPU/renderer/image/tool/fixture/resource/animation/cache cohorts only.
The original launcher requests legacy indirect SwiftShader with 2048 MiB; the installed emulator does
not advertise that legacy backend. Its actual behavior needs runtime verification, not a presumed
rename to a modern software backend. Requested RAM is not observed RAM. Current Intel render-device
access is not emulator compatibility; NVIDIA audio-only exposure is not an available graphics route.
Candidate/configuration experiments are separate from optimization comparisons.

Setup preflight observed no active validation emulator, protocol containers or Metro, but a pre-existing ADB
server. No resource was acquired or stopped. Repeat checks before runtime work; an absence observed
earlier does not grant ownership later. The foundation implements the full-invocation claim and
acquired/borrowed cleanup; receipts, not these historical observations, authorize cleanup.
Never stop pre-existing services/emulators to acquire a lock, wipe AVDs or change
host packages, power/driver/security policy without separate authorization.

Full workspace and staged acceptance, signed release qualification, matched three-sample baselines
and after measurements remain required. Current private setup evidence is not any of those gates.
