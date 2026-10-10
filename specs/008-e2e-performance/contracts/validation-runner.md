# Contract: Validation Runner and Sanitized Reports

**Status**: Planned interface, not implemented by `/speckit-plan`.

## CLI compatibility and additions

Current commands and API defaults remain valid:

```sh
pnpm e2e:android
scripts/validation/android-flow.sh e2e --api 31
scripts/validation/android-flow.sh connected --api 31
pnpm e2e:android:release-smoke
```

`pnpm e2e:android` supplies API 31 and 36. Direct runner invocation defaults to API 31.
Do not reinterpret `connected` or `release-smoke`, invent existing Maestro tags, or change staged order.

Planned syntax:

```text
android-flow.sh <connected|e2e|release-smoke|measure>
  [--api <31|36>]...
  [--graphics <auto|host-opengl|software>]
  [--report-dir <directory>]
```

- Existing modes gain optional reporting/graphics selection without changing their proof subject.
- `measure` runs only frozen H01–H08, with **three repetitions per requested API**. Completion requires
  both APIs for feature acceptance, even though an API-specific development run is permitted.
- `auto` performs verified selection/fallback. `host-opengl` probes available host OpenGL device routes
  first; `software` starts from supported software modes for reproducible control cohorts. All retain
  explicit KVM CPU acceleration. Actual mode and any fallback override assumptions from the flag.
- Profiles are finite reproduction choices, not arbitrary shell flags or GPU-vendor guarantees.
- No `--flow`, tag, arbitrary repetition or fixture-size override is added to measurement mode.
- `--report-dir` creates a new invocation subdirectory rather than overwriting existing results.
  Evidence stays in the workspace's ignored validation evidence area by default.
- Invalid modes/options/APIs, missing values and unsupported profile names fail before resource setup.
- Success exits zero only after required scenario/assertion, service audit and restoration checks.
  Startup, incompatible artifacts, validation, audit, timeout and interruption failures remain nonzero.

Use existing SDK resolution (`ANDROID_HOME`, `ANDROID_SDK_ROOT`, then `$HOME/Android/Sdk`) and pinned
Maestro tool resolution. Do not hardcode a developer's SDK/cache path in public commands.
Credential-file handling stays private; no shell tracing or argv/environment echoing.

## Ownership and lifecycle

Acquire the full-run claim before starting services or Metro. Preserve the emulator-exclusive lock.
Borrowing a healthy project service is explicit; never treat its existence as acquisition by this run.
Each emulator attempt has its own recorded process and serial, verified against the prior device
inventory and process identity, not “first emulator online.”

On failure/signal: stop only acquired resources, resume paused SFTP, restore remote fixtures, audit
protocol operations, and preserve the original exit status. Borrowed services still receive scoped
audit/manifest verification but are not stopped. Concurrent rejection must not mutate existing state.
Keep diagnostics long enough to generate sanitized fallback evidence before owned state is removed.

## Timing boundaries and artifacts

Record monotonic segments for build, services, emulator boot/verification, installation, remote/device
fixture setup, workspace or measurement, staged execution, cleanup/audit and other host work.
Count shared build/services once. If a service start contains fixture seeding, split it rather than
adding inclusive parent and child time. Staged totals include host hooks and process startup, with
nonadditive part/hook diagnostics.

Use pinned Maestro's `--test-output-dir`/`--debug-output` support to route each workspace, staged part
and hotspot repetition into a unique private raw-artifact directory. Do not discover “latest” runs.
Record failed/time-out invocations even when no command artifact was produced.

Publication outputs:

```text
<report-dir>/<invocation-id>/
├── run.json                 # allowlisted metadata, phases, samples, assertion results
├── report.md                # sanitized human summary
└── raw/                     # private local Maestro/profiler data, never publication input verbatim
```

Raw data may contain credentials and fixture UI content. Use restrictive access, keep it ignored,
never upload it, and never render it into report text. Keep profile data separate from normal timing
samples so instrumentation overhead cannot alter the before/after cohort.

## Report/comparison contract

`run.json` follows [data-model.md](../data-model.md), version 1. Publication uses an allowlist of
known IDs/statuses, numeric costs and validated configuration/hardware identities. Exclude arbitrary
commands, argv, environment, secure values, full URLs, user paths and UI text. Known error codes replace
raw diagnostics. Test this with synthetic credential and content canaries.

Planned comparison command:

```sh
node scripts/validation/performance-report.mjs \
  --before validation/evidence/performance/before \
  --after validation/evidence/performance/after \
  --output validation/evidence/performance/comparison.json
```

It produces the sanitized JSON comparison and a sibling Markdown summary. Its output must:

1. include H01–H08 on API 31 and 36 even if samples are missing or failed;
2. require three successful original scheduled samples per side for median comparison;
3. show absolute change and relative improvement, including zero and negative improvements;
4. explain every incompatibility, especially actual CPU/GPU/renderer or animation/resource differences;
5. present cross-renderer experiments separately, with no pooled “optimization speedup”;
6. reconcile disjoint host phases and keep leaf costs/helper diagnostics nonadditive;
7. include deferred/rejected alternatives and their evidence/tradeoffs;
8. retain the before/after acceptance inventory and explicitly report missing/optional original claims.

Selection evidence must have a `rankingFingerprint` matching the executed app/helper/configuration.
A stale ranking may accompany explicitly provisional diagnostic runs, but cannot pass the final
best-working-renderer acceptance gate. Do not require identical app/helper identities in matched
before/after cohorts; those declared optimization inputs legitimately change. Exclude runtime
fault-injection harness outputs from ranking and timing samples.

Malformed/unknown-schema evidence fails parsing rather than silently dropping records.
Missing or incompatible required cohorts produce a nonzero incomplete-comparison result, with a
diagnostic report. A negative speed change alone is not a parsing failure or a fixed-threshold gate.

## Deterministic regression expectations

Use isolated temporary state and recording tools/clock fakes to cover:

- old CLI/defaults; invalid options before setup; exactly three repetitions and fixed manifest;
- one debug build/two API installs, unchanged release/connected behavior;
- full-run contention, acquired/borrowed resources, foreign serials and failed-start cleanup;
- all staged hooks/parts and restoration, including no launch in `08-changed-b`;
- nested flat command records, repeated executions, malformed artifacts and missing samples;
- same-count fixture corruption, obsolete generator versions and failed-seed markers;
- mismatched renderers/cache/settings, unknown metadata, medians, zero baselines and regressions;
- app/helper/pacing/animation ranking invalidation, current-ranking final gates and fault-output exclusion;
- credential/content-canary sanitization and no raw output/path copying.

No fake-driven test replaces the real two-API acceptance in [acceptance.md](./acceptance.md).
