# Validation performance evidence

## Current boundary

Feature 008 setup freezes measurement subjects and original acceptance claims; it does **not**
implement a faster runner, select a renderer or establish a timing baseline.
The existing runner still accepts only `connected`, `e2e` and `release-smoke` with repeated `--api`
arguments. Direct invocation defaults to API 31; `pnpm e2e:android` requests API 31 followed by 36.
`measure`, graphics selection and reporting options in the
[feature walkthrough](../specs/008-e2e-performance/quickstart.md) are planned, not available commands.
Existing running instructions remain in [DEVELOPMENT.md](../DEVELOPMENT.md).

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
invocations/<opaque-invocation>/
  retention-reference.json          original snapshot reference
  raw/                              private Maestro/profiler/debug artifacts
  reports/                          explicitly allowlisted derived records
```

Setup created a unique invocation with private raw/report directories and a unique original-input
snapshot. Its 351 archived original files were verified byte-identical to revision
`fcdb8ca87ea43b0e52ab1f0c0ac40fe94f959191`. The exact archive digest, full file digests and opaque
identifiers are in local `retention.json`; the preflight records the original 337-file input fingerprint.
The working tree now includes setup-only metadata/tests/task markers; do not label it clean.
No baseline APK was built or opportunistically adopted from an existing build directory.
No boot, protocol authentication, mounted-volume check, acceptance run or speedup is claimed.

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

Every Maestro invocation must eventually receive a distinct explicit private output/debug directory.
The current runner has **not** yet been changed to route these outputs; Phase 2 must implement and
test that routing before baseline collection. Empty setup `raw/` directories are not Maestro evidence.
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
   original archive. Do not invent a current `--flow`/input-root/renderer option.

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

Preflight observed no active validation emulator, protocol containers or Metro, but a pre-existing ADB
server. No resource was acquired or stopped. Repeat checks before runtime work; an absence observed
earlier does not grant ownership later. The full-invocation claim and acquired/borrowed cleanup fixes
remain Phase 2 work. Never stop pre-existing services/emulators to acquire a lock, wipe AVDs or change
host packages, power/driver/security policy without separate authorization.

Full workspace and staged acceptance, signed release qualification, matched three-sample baselines
and after measurements remain required. Current private setup evidence is not any of those gates.
