# Data Model: Validation Performance Evidence

**Feature**: [spec.md](./spec.md)

**Contracts**: [runner/report](./contracts/validation-runner.md),
[acceleration](./contracts/acceleration.md), [acceptance](./contracts/acceptance.md)

These are local tooling records, not new application database entities. Room schema, CloudSync
contract, credentials and browse preferences remain unchanged.

## 1. Validation invocation and per-API run

**Invocation** represents one runner command and owns shared build/services plus sequential API runs.

| Field | Meaning / validation |
| --- | --- |
| `schemaVersion` | Initial report version 1; unsupported versions fail validation. |
| `invocationId` | Unique opaque local identifier; never a credential or full user path. |
| `mode` | `connected`, `e2e`, `release-smoke` or new `measure`. |
| `source` | Revision and dirty-input fingerprint, including flow/helper/app inputs; not just Git HEAD. |
| `host` | Stable pseudonymous ID, OS/kernel, CPU and tool/driver versions; no hostname/account name. |
| `workloadFingerprint` | Digest of the frozen manifest, preconditions and measurement boundaries. |
| `build` | APK digest, ABI, task outcomes, cache/daemon policy and observed cache state. |
| `fixtureSet` | Generator/version digests, counts and logical byte sizes; mutable restoration state. |
| `apiRuns` | References to one run for each requested API, in actual execution order. |
| `sharedPhases` | Build/services/remote fixtures and other shared segments counted once. |
| `status` | `running`, `passed`, `failed` or `interrupted`; incomplete is never success. |
| `failureCode` | Known sanitized category; no raw command, exception or environment dump. |

**Per-API run** contains `runId`, `invocationId`, API 31/36, image revision, acceleration-profile
reference, requested/observed guest resources, animation settings, scenario samples, acceptance
results and phase segments. Guest serial/PID ownership belongs in private lifecycle state; a report
may use opaque resource IDs.

**Relationships**: one invocation → one build and fixture definition → one or two API runs;
each API run → one verified acceleration profile → many phase/scenario records.

**Transitions**: `claimed → preparing → validating → auditing → passed`; any stage may enter
`failed`/`interrupted`, then cleanup/audit. Cleanup does not overwrite the original failure.

## 2. Frozen hotspot definition and sample

The runtime definition is `validation/performance/hotspots.json`, created during implementation from
the fixed H01–H08 table in contracts/acceptance.md. It is the single source for measurement selection.

**Definition fields**:

- stable `scenarioId`, synthetic display name and project-relative existing flow path;
- ordered prerequisite flows/actions and reset/restoration policy;
- required fixture fingerprint/count settings;
- whole-flow measurement boundary and optional diagnostic subsection boundaries;
- repetition count fixed at **3**, APIs fixed at **31 and 36**;
- baseline freeze timestamp and definition fingerprint.

**Sample fields**: invocation/API/scenario/profile IDs, `repetition` 1–3, input fingerprints,
elapsed milliseconds, `passed|failed|interrupted`, known failure code, raw-artifact opaque reference,
phase references and allowlisted command categories. H08 also records gallery/list subsection
diagnostics without replacing its full-flow sample.

**Validation**:

- All eight scenarios and both APIs must appear. Each cohort has exactly three scheduled repetitions.
- Restore required preconditions before every independent repetition; prerequisite cost is separate,
  not silently omitted from total validation wall time.
- Failed samples remain failures and make the median comparison incomplete. A diagnostic rerun gets
  a separate identity; it never replaces an unfavorable sample.
- Helpers may change internally, but the workload subject, fixture size, required assertions and
  whole-flow boundaries do not change after the freeze.
- No real user files, secure values or arbitrary UI text enter the definition or sample.

## 3. Acceleration profile and attempt

| Field | Meaning |
| --- | --- |
| `requestedProfile` | Finite CLI selector: `auto`, `host-opengl` or `software`. |
| `cpu` | Requested `on`, observed KVM status and sanitized evidence flags. |
| `candidates` | Exposed Intel/NVIDIA device IDs and available software modes; unavailable reasons. |
| `attempts` | Ordered candidate ID, supported flags/backend, readiness and verification outcome. |
| `actualGraphics` | Hardware/software, backend, actual guest GPU/renderer/vendor and driver identity. |
| `vulkan` | Requested/observed enablement; uncertainty is explicit, never assumed verified. |
| `fallback` | Whether a lower option was selected and known, sanitized reasons for rejections. |
| `selectionEvidence` | References to compatible candidate timings, ranking/tie decision and current/provisional/stale status. |
| `fingerprint` | CPU/graphics/device/renderer/tool/image identity used for cohort matching. |
| `rankingFingerprint` | Calibration input identity including app/APK, executed flow/helper closure and configuration; stale values cannot prove best-performing selection. |

**Attempt states**: `discovered → claimed → starting → ready → verified → measured → selected`.
An attempt may become `unavailable`, `boot-failed`, `verification-failed` or `measurement-failed`;
only its owned resources are then released before the next attempt.

Hardware presence without renderer verification is not `verified`. NVIDIA audio-only exposure is
`unavailable`, not `boot-failed`. A software fallback changes the actual mode/fingerprint and therefore
cannot join a hardware comparison cohort.

`rankingFingerprint` includes the frozen workload, executed flow/helper closure, app/APK, fixtures,
API/image, tools/drivers/exposed candidates, host power/resource settings, build/cache policy, guest
resources and animations. App/helper/pacing/animation changes invalidate ranking without necessarily
changing the acceleration/cohort `fingerprint`. Recalibrate on current inputs before final acceptance;
unrelated documentation/evidence changes do not invalidate it. Keep declared optimization input
changes out of the cohort equality rule so valid before/after comparisons remain possible.

Fault-injection harness evidence is separate from profile samples: known case, API, attempt outcomes,
actual mode when a real boot occurs, expected/observed validator result and cleanup result. An expected
all-options failure can pass the harness but never becomes a successful validation or timing sample.

## 4. Timing segment and command cost

**Host segment fields**: segment ID, invocation/API/scenario scope, phase name, monotonic start/end,
elapsed duration, status and optional parent diagnostic ID. Big integer nanoseconds may be serialized
as decimal strings; elapsed milliseconds must be finite and nonnegative.

Report-level phases are disjoint: build, services, emulator startup/verification, installation,
fixture setup, workspace/measurement, staged, cleanup/audit and other. Split remote seeding from
service setup where needed; do not count both an inclusive service duration and its fixture child.
Shared work appears once at invocation scope. Per-API views reference it without duplicating it.

**Command record input**: pinned Maestro flat `commands.json` records contain command-type objects
and metadata such as status, timestamp, duration, sequence number and depth.

**Published command-cost fields**: known command category, execution count, nonoverlapping leaf
duration and status. Payloads, `evaluatedCommand`, text, credentials and full paths are not copied.

**Aggregation rules**:

- Process the executed record list once; embedded `runFlowCommand.commands` are definitions, not
  an additional list of executed samples.
- Distinguish executed retry/repeat instances. Count actual leaf intervals, excluding wrapper
  intervals already containing children. Reject malformed/ambiguous record structures.
- Inclusive helper views are useful diagnostics, not additive command totals.
- Command time does not equal application execution. Profile traces remain separate evidence.
- Reconcile disjoint phase sum to invocation wall time with explicit `other` time. Report leaf costs
  and driver/unclassified overhead separately rather than pretending they exhaust phase wall time.

## 5. Timing baseline and comparison

A **baseline** is a frozen collection of the samples above before optimization, not the historical
single successful run. A **comparison** references before/after collections and emits one row per
scenario/API/compatible acceleration cohort.

**Row fields**: before/after sample IDs and medians, absolute elapsed change, percentage elapsed
change, improvement percentage, compatibility status and reasons. Elapsed change is
`after − before`; improvement is `(before − after) / before × 100`. Zero baseline duration is invalid
for a percentage and must produce a diagnostic, not infinity.

**Cohort key**: scenario-definition/fixture identity, host/API/image/toolchain, build-cache policy,
CPU/GPU/renderer/driver identity, guest resources/animation settings and relevant host power/resource
settings. Source/APK identities differ only as the declared optimization input, not as hidden variables.
Whole-run build reuse has its own phase comparison rather than being disguised as a hotspot gain.

Different modes/settings produce incompatible rows or separate experiment tables, never a combined
speedup. Unknown critical metadata also makes comparison incompatible. Three valid samples per side
are necessary; all fixed scenarios remain visible in the report even when comparison is incomplete.

## 6. Acceptance inventory

**Fields**: stable flow/claim ID, authoritative registry/path, API/protocol, major assertion and
requiredness, preconditions, lifecycle/reset rules, mutation hooks, retained evidence reference and
explicit pre-existing deviation.

Record the original 39 workspace entries and seven staged parts before optimization. New regression
flows may be added but cannot replace an original claim. Inventory results distinguish `executed`,
`failed`, `missing` and `pre-existing documented deviation`; a skipped/optional required assertion is
not executed proof.

This tooling inventory does not upgrade documented unit-only/aesthetic deviations to device proof,
nor does debug execution of release-named flows prove signed standalone release behavior.

## 7. Fixture validity and resource ownership

**Fixture validity**: generator/parameter digest, expected paths/types/counts/sizes/content/required
mtimes, completion marker and mutable/immutable classification. `unknown → validating → valid/reseed`
and `seeding → valid` only after success. A failed seed never leaves a valid marker. Same count with
corrupt content is invalid. Mutable trees are restored/reset at their established boundaries.

**Ownership** is private transient runner state: invocation token, acquired lock, resource type,
candidate ID, PID/serial/container marker, `acquired|borrowed`, and acquisition outcome.
`unclaimed → acquired/borrowed → verified → released`; startup failure may leave a partially acquired
resource that needs targeted cleanup. Attempted acquisition alone never grants permission to stop
something. Borrowed resources are audited but not stopped; lock rejection performs no shared setup.

No new persistent application entity, migration or user preference is introduced.
