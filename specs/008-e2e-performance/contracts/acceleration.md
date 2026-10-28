# Contract: Verified Acceleration Selection and Fallback

**Status**: Planned runtime behavior. Historical compatibility is not a new boot or speed measurement.

## Discovery and safety

On each API, discover exposed Intel/NVIDIA display/3D devices, accessible render nodes, driver
capabilities and emulator-supported graphics modes. Check KVM availability before starting an x86_64
candidate. The inspected host requires explicit `-accel on`; unusable KVM means no candidate meets
this CPU profile and produces an actionable failure rather than silent software CPU emulation.

NVIDIA audio-only PCI exposure is not a GPU. Report absent/unusable options with a sanitized reason.
Do not install drivers, change host power/security settings, wipe an AVD or stop unrelated processes.
Retain the full-run/emulator locks and own each candidate PID/serial before acting on it.

## Candidate process

1. Discover supported modes and fingerprint host/emulator/image/driver/device settings.
2. Start exposed host OpenGL candidates with `-gpu host -feature -Vulkan -accel on`, using documented
   per-process device-selection variables only where that installed graphics stack supports them.
   Intel and NVIDIA routes are independent candidates when exposed.
3. Preserve existing boot, network and guest watchdog checks. Require runtime renderer evidence plus
   KVM/process/render-node evidence; boot completion alone does not verify graphics.
4. Probe a Vulkan-enabled host configuration only if current capabilities make it viable and a measured
   experiment justifies it; the previously failing unqualified host configuration is not the sole default.
5. For working hardware routes, obtain comparable fixed-workload measurements on both APIs, three
   repetitions per workload. Rank using the median rendering/picker subtotal H03/H07/H08, retaining
   all eight workload results and considering regressions/stability. Document exceptions/tradeoffs.
   A timing tie selects the simpler stable configuration, not a preferred vendor.
6. If hardware is unavailable/fails, attempt supported software profiles in a fixed documented order:
   `swiftshader`, then `software`, then other advertised software backends only if necessary.
   Verify and identify the actual backend; a generic software selector is not an actual renderer name.
7. Stop only the rejected candidate's owned resources before retry. Record each rejection and the
   selected fallback. If all candidates fail, exit nonzero with a sanitized actionable diagnostic.

`-gpu swiftshader_indirect` is historical runner behavior, not an advertised emulator 37.1.11 profile.
If used solely to reproduce the original baseline, verify its actual renderer and record that legacy
request; it does not become an assumed supported fallback.

Initial probes can establish a provisional working candidate, not “best available.” The first
calibration collects the full frozen workload across viable candidates. Subsequent auto runs can reuse
the ranked profile only while its `rankingFingerprint` matches, and must reverify the actual runtime mode.
Fallback without a comparable calibration is labeled provisional/unranked until measured; it cannot
claim best-working performance.

### Ranking validity

Keep `rankingFingerprint` separate from the acceleration/cohort `fingerprint`. It covers the frozen
workload definition, executed flow/helper closure, app input/APK identity, fixture identity, API/image,
tools/drivers/exposed candidate set, host power/resource settings, build/cache policy, guest resources
and animation settings. Ignore unrelated documentation and evidence-output changes.

Changed app/helper behavior, scan pacing, executed flows or animation settings invalidate the old
ranking even when the actual GPU/renderer is unchanged. Continue only with an explicit provisional
profile until recalibration completes; do not label the cached choice best-performing.

After US1 changes and again after any retained US3 production changes, recalibrate every viable
candidate on the current inputs using H01–H08 three times per API. Reuse those samples as normal after
samples only when every comparison condition matches. Final acceptance requires ranking evidence
whose `rankingFingerprint` matches the final executed app/workload/configuration.

If recalibration selects a renderer lacking a matched original-code baseline, collect that baseline
using the retained original APK/flow closure under matching settings before comparing. Do not alter
the workload, compare different modes, or add current-code identity to the before/after cohort key:
declared app/helper changes are exactly what that comparison measures.

## Evidence required

For every selected profile, report:

- host/API/image/tool/driver identity and exposed/unavailable GPU options;
- requested CPU mode and verified KVM use;
- requested graphics candidate, actual renderer/backend/GPU and observed Vulkan state;
- requested and observed memory, vCPUs, display size/density and animation scales;
- ordered rejected attempts, known failure reasons and selected fallback;
- comparable candidate timing references, `rankingFingerprint` and selection rationale, or explicit
  provisional/stale status.

Use an allowlist for diagnostics; do not copy emulator logs or host environment verbatim.
If device/renderer identity is ambiguous, do not label it verified hardware or rank it as such.
An API's observed RAM may exceed the requested value and must be recorded separately.

## Comparison rules

GPU selection experiments keep workload, fixtures, guest resources, animations and host settings fixed.
Their cross-mode timings explain configuration choice; they are not matched-mode optimization speedups.

Before helper/app changes, collect original-code baselines under each selected actual renderer.
After changes, compare only its matching cohorts. A fallback changes the cohort. Missing matching
pre-change evidence makes the speed comparison incomplete and requires a matched baseline, not
retroactive inference from the historical software run.

## Test matrix

**Deterministic fakes**: Intel only; both GPUs exposed; NVIDIA audio only; inaccessible device;
KVM unavailable; Vulkan initialization failure; wrong GPU despite requested offload; software renderer
under a host request; successful hardware; successive software fallback; all attempts fail; lock held;
foreign emulator already online; interruption during startup; changed fingerprint; requested/observed
memory disagreement. Assert the attempted order, known reasons and owned-resource cleanup.
Also verify ranking invalidation for app, helper, pacing and animation changes, unchanged-identity
reuse, exclusion of unrelated documentation changes, and a final gate rejecting stale ranking evidence.

**Real runtime, both APIs**: verify selected hardware when exposed, exercise form/picker/gallery/list,
verify software control cohorts, and demonstrate automatic fallback with the automated harness below.
Missing NVIDIA exposure is valid unavailability evidence, not proof
of NVIDIA compatibility. Never create an unsupported-host condition by altering global security or
drivers. Complete workspace/staged acceptance still runs under the selected actual profile.

## Automated runtime failure injection

Implement `scripts/validation/acceleration-fault-check.mjs` with Node built-in modules and deterministic
tests in `scripts/validation/acceleration-fault-check.test.mjs`. This is a developer acceptance harness,
not an app feature or a production fault switch.

Planned interface:

```text
node scripts/validation/acceleration-fault-check.mjs
  --api <31|36> [--api <31|36>]...
  --case <hardware-fallback|all-options-fail>
  --report-dir <directory>
```

The harness first acquires the same full-invocation claim as the normal runner, using its authoritative
lock definition, before any candidate launch. For each API it runs the existing validator's
start/healthcheck/stop lifecycle through normal SDK resolution and the emulator-exclusive lock.
It creates a private temporary SDK overlay with a generated emulator
wrapper and the unchanged real SDK tools/images. Only the child process receives the overlay and a
private injection token. Do not modify the installed emulator, AVD definition, parent environment or
public runner CLI.

The wrapper passes version/help/acceleration capability probes through unchanged. It injects a known
nonzero launch failure only for candidate starts carrying this invocation's token and owned AVD/API:

- `hardware-fallback`: reject every discovered host-graphics launch; forward software candidate
  launches to the real emulator. Require automatic reported fallback, a real software boot,
  runtime CPU/renderer verification and healthy owned-device readiness on both APIs.
- `all-options-fail`: reject every candidate launch; require exhaustion of supported options,
  an actionable nonzero validator result and no surviving acquired resources.

If no host candidate is exposed, retain its unavailability evidence but do not claim an injected
hardware-launch failure was exercised. Record that case incomplete; the inspected host's exposed
Intel route must supply the required hardware-failure demonstration. A missing usable software
continuation also makes `hardware-fallback` incomplete, not successful simulated boot evidence.

The harness exits zero only when the chosen case's expected result and cleanup assertions pass.
Thus the expected nonzero validator result in `all-options-fail` is a harness success, not a successful
validation run. Store only allowlisted case/API/attempt/actual-mode/expected-result/cleanup evidence
in `fault-check.json` under the report directory. Fault-injection results are never ranking or
before/after timing samples.

On failure, timeout or signal, stop only token-owned acquired candidate processes and remove only
the harness-created temporary overlay. Never wipe guest data or stop foreign/borrowed resources.
Unit tests use fake SDK/process boundaries to verify case parsing, probe passthrough, token scoping,
hardware/software routing, expected exit-status inversion, evidence sanitization and cleanup.
