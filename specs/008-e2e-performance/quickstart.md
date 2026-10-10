# Quickstart: Validate the E2E Performance Work

**Status**: Implementation validation guide. New `measure`/graphics/report interfaces below are
planned and will not run until implemented. No baseline or speedup was captured during planning.

## Prerequisites

- Existing developer setup in [DEVELOPMENT.md](../../DEVELOPMENT.md): pinned Node/pnpm, supported Java,
  Android SDK/images, Maestro 2.10.0, Docker/Compose, Metro and actual removable-volume fixtures.
- API 31 and 36 x86_64 AVDs; usable KVM; access to exposed graphics render devices.
- No concurrent validator owner. Never stop another process to acquire its lock.
- Default acceptance datasets and synthetic project fixtures, not user folders or credentials.
- Writable ignored evidence directory. Raw artifacts remain private and must not be uploaded.

Use the repository's SDK resolution. The emulator need not be on shell `PATH`; check its resolved
binary rather than treating that absence as missing acceleration. A NVIDIA audio function alone does
not establish GPU availability.

## 1. Verify current gates before implementation

From the repository root:

```sh
pnpm lint
pnpm typecheck
pnpm test:ci
```

Focused existing UI regressions, when relevant:

```sh
pnpm exec jest --runInBand \
  src/scan/__tests__/useScan.test.tsx \
  src/screens/__tests__/ScanScreen.test.tsx \
  src/screens/__tests__/GalleryScreen.test.tsx \
  src/screens/__tests__/ListScreen.test.tsx \
  src/files/__tests__/usePagedQuery.test.tsx
```

Run `pnpm test:android:unit` for native changes. Expected: no failed/skipped changed-unit regressions,
zero lint warnings and no type errors. Older foundation tests may invoke real offline host tools;
new performance/lifecycle unit tests must use isolated fakes.

## 2. Freeze workloads and collect original-code baselines

Before helper/app/build/fixture optimizations, freeze H01–H08 and their prerequisite/fingerprint
definition from [contracts/acceptance.md](./contracts/acceptance.md). Inventory the 39 workspace
entries, seven staged parts and mandatory assertions. Add observational reporting first.

**After measurement mode exists**, collect the original software control cohort:

```sh
scripts/validation/android-flow.sh measure --api 31 --api 36 \
  --graphics software \
  --report-dir validation/evidence/performance/before-software
```

Verify actual renderer equivalence rather than assuming the new software selector equals the old
indirect SwiftShader request. Keep original legacy-mode evidence separately if its actual mode differs.

Discover/calibrate hardware candidates with the same original app/helper inputs, then collect the
matching before cohort for the selected hardware profile:

```sh
scripts/validation/android-flow.sh measure --api 31 --api 36 \
  --graphics host-opengl \
  --report-dir validation/evidence/performance/before-host
```

Expected: eight workloads × three repetitions × two APIs in each cohort, real SAF/progress/scroll
actions, explicit fixture/cache/resources, requested and verified acceleration identities, and
separate phase costs. GPU calibration may require additional cohorts. Failures remain visible;
do not replace samples or change the workload. No app optimization starts without its valid baseline.

## 3. Validate acceleration and fallback

Follow [contracts/acceleration.md](./contracts/acceleration.md):

- Check currently exposed Intel and NVIDIA graphics and supported emulator modes.
- Verify guest renderer, KVM and process/device ownership on both APIs; report requested/observed RAM.
- Rank viable candidates with comparable original-code measurements, not a brand rule. Record a
  separate `rankingFingerprint` covering app/APK, executed flow/helper closure, pacing and configuration.
- Exercise the automated child-scoped SDK-overlay harness below to demonstrate real software fallback
  and expected total failure. Do not alter host drivers/security or wipe existing AVDs.
- Confirm lock rejection performs no service setup, foreign cleanup or state deletion.

**After the fault-check harness exists**, run both cases:

```sh
node --test scripts/validation/acceleration-fault-check.test.mjs

node scripts/validation/acceleration-fault-check.mjs \
  --api 31 --api 36 --case hardware-fallback \
  --report-dir validation/evidence/performance/fault-hardware

node scripts/validation/acceleration-fault-check.mjs \
  --api 31 --api 36 --case all-options-fail \
  --report-dir validation/evidence/performance/fault-exhaustion
```

Expected: hardware-fallback injects only owned host-launch failures and verifies a real software boot.
All-options-fail returns a nonzero validator result but a zero harness result only when exhaustion,
diagnostics and cleanup match expectations. No exposed host candidate means incomplete injected-host
coverage, not a claimed failure demonstration. `fault-check.json` is separate acceptance evidence;
never use injected results as normal benchmark or ranking samples.

Expected: verified actual mode and rejection reasons. Audio-only NVIDIA remains unavailable, not
claimed tested-compatible. Unranked fallback is provisional until measured.

## 4. Check each retained optimization

After new deterministic tests exist:

```sh
node --test scripts/validation/performance-report.test.mjs \
  scripts/validation/performance-runner.test.mjs
pnpm test:foundation
```

Run affected existing flows using the prepared runner/device and private protocol arguments as
documented in DEVELOPMENT.md. The current runner has no arbitrary `--flow` option; do not invent one.

Expected:

- Field matrix passes on both APIs, including secure/cursor/long-root cases; no stale appended text.
- Navigation-only helpers avoid duplicate launch but preserve seam return, restart and staged state.
- Progress is required when it is the subject; fast scans prove a new run and terminal result.
- One debug build supplies both API installations; release architecture defaults remain unchanged.
- Valid immutable fixtures reuse safely; same-count corruption reseeds, and mutations still reset.
- Negative profiles defer production rewrites. Any changed UI units pass their paging/anchor/selection
  and stale-response regressions. Instrumented profiles are separate from normal timing samples.
- Nested durations are not counted twice and credential/content canaries never enter published reports.

## 5. Collect matched after cohorts and compare

Before final after collection, recalibrate all viable candidates on the current app/helper/pacing/
animation inputs, three H01–H08 repetitions per candidate/API. Repeat after retained production
changes. Final ranking evidence must match the final `rankingFingerprint`; otherwise selection is
provisional and cannot pass the best-working-renderer gate. Compatible current calibration samples
may also supply after samples without rerunning them.

If the selected actual renderer changes, collect its matching original-code baseline using the
retained original APK/flow closure before comparing. Keep ranking input identity separate from cohort
equality; declared optimization changes must not make every before/after pair incompatible.

Use the same actual renderer/settings as its before cohort:

```sh
scripts/validation/android-flow.sh measure --api 31 --api 36 \
  --graphics host-opengl \
  --report-dir validation/evidence/performance/after-host

node scripts/validation/performance-report.mjs \
  --before validation/evidence/performance/before-host \
  --after validation/evidence/performance/after-host \
  --output validation/evidence/performance/comparison.json
```

Collect the after-software cohort too when comparing retained software-mode optimizations. If hardware
falls back, the comparator must reject the hardware/software pairing; use its matched cohort instead.
Changed animation or memory/display settings require separate cohorts, not a hidden speedup claim.

Expected: all eight scenario/API rows, three original successful samples per side, median absolute
and relative changes, explicit incompatibilities and zero/negative results. No fixed minimum gain
applies. A zero-gain decision needs the rejected-alternative evidence and architecture tradeoffs.
See [data-model.md](./data-model.md) for the comparison key and phase accounting.

## 6. Run complete acceptance and publish measured guidance

Existing full-suite command, still required:

```sh
pnpm e2e:android
```

Expected: all original 39 workspace entries plus seven staged parts pass on both APIs against live
FTP/SFTP/WebDAV, actual SAF and real deletion. Required assertions execute; inventories show no loss.
SFTP resumes and remote mutation fixtures restore on success and failure. The selected profile's
ranking evidence matches the final executed app/helper/configuration, not just the original baseline.

If shared CLI/lifecycle/build changes affect signed-release validation:

```sh
pnpm e2e:android:release-smoke
```

Debug workspace release-named flows do not replace standalone signed/update proof.

Finally rerun the local gates and update DEVELOPMENT.md, docs/validation-performance.md,
docs/architecture.md, docs index and CHANGELOG.md with implemented behavior and sanitized measurements.
Update user guidance if normal progress behavior changes. Correct historical timing/timeout claims
using actual evidence. Publish no raw Maestro/profiler artifacts or credential-bearing logs.
