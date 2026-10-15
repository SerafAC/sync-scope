import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  advance, assertCurrentRanking, collectRankingInputs, discover, launchSpec, parseGpuModes,
  parseKvmCheck, planAttempts, rankCandidates, rankingFingerprint, readHostDevices,
  selectionStatus, validateAcceleration, verifyAttempt, RANKING_KEYS,
} from './performance-acceleration.mjs';

// Deterministic fakes only: no host device, emulator or guest is touched here.
const help = `
  Use -gpu <mode> to override the mode of GPU emulation indicated by the
  AVD's hardware-qemu.inifile.

     auto (default)       -> Auto-select the renderer, recommended.
     host                 -> Use the host system's GPU drivers.
     software             -> Use default software renderer.
     lavapipe             -> Use Lavapipe software renderer for Vulkan and
                             auto-select software backend for GLES.
     swiftshader          -> Use SwiftShader software renderer for GLES
                             and Vulkan.
     swangle              -> Use ANGLE with Swiftshader backend for GLES and
                             Swiftshader for Vulkan.
`;
const modes = parseGpuModes(help);
const kvm = parseKvmCheck('accel:\n0\nKVM (version 12) is installed and usable.\naccel\n', 0);
const intel = {address: '0000:00:02.0', pciClass: '0x030000', vendor: '0x8086', device: '0x7d55',
  driver: 'i915', renderNodes: [{name: 'renderD128', accessible: true}]};
const nvidiaAudio = {address: '0000:01:00.1', pciClass: '0x040300', vendor: '0x10de', device: '0x22bd',
  driver: 'snd_hda_intel', renderNodes: []};
const nvidia = {address: '0000:01:00.0', pciClass: '0x030200', vendor: '0x10de', device: '0x2860',
  driver: 'nvidia', renderNodes: [{name: 'renderD129', accessible: true}]};
const host = (devices, extra = {}) => discover({devices, modes, kvm, nvidiaGlx: true, ...extra});
const byId = (d, id) => d.candidates.find(c => c.candidateId === id);
const intelGles = 'GLES: Google (Intel), Android Emulator OpenGL ES Translator (Mesa Intel(R) Arc(tm) Graphics (MTL)), OpenGL ES 3.0';
const nvidiaGles = 'GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.0';
const swiftGles = 'GLES: Google (Google), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0 SwiftShader 4.0.0.1';
const resources = {requestedRamMiB: 2048, observedRamKiB: 2097152 * 1.2};

test('emulator help and accel-check parse to advertised modes and usable KVM', () => {
  assert.deepEqual(modes, ['auto', 'host', 'software', 'lavapipe', 'swiftshader', 'swangle']);
  assert.deepEqual(kvm, {usable: true, reason: null});
  assert.deepEqual(parseKvmCheck('accel:\n0\nKVM is not installed\naccel\n', 0), {usable: false, reason: 'kvm-unavailable'});
  assert.deepEqual(parseKvmCheck('', 1), {usable: false, reason: 'kvm-unavailable'});
  assert.deepEqual(parseGpuModes(''), []);
});

test('Intel only: Intel is a discovered host candidate and NVIDIA is not exposed', () => {
  const d = host([intel]);
  assert.equal(byId(d, 'host-intel-1').status, 'discovered');
  assert.deepEqual(byId(d, 'host-intel-1').selector, {});
  assert.equal(byId(d, 'host-nvidia-1').status, 'unavailable');
  assert.equal(byId(d, 'host-nvidia-1').reason, 'not-exposed');
  assert.deepEqual(d.software, ['swiftshader', 'software', 'lavapipe', 'swangle']);
});

test('NVIDIA audio-only exposure is unavailable, never an attempted incompatibility', () => {
  const d = host([intel, nvidiaAudio]);
  const n = byId(d, 'host-nvidia-1');
  assert.equal(n.status, 'unavailable');
  assert.equal(n.reason, 'audio-only');
  const plan = planAttempts(d, 'auto');
  assert.ok(!plan.attempts.some(a => a.candidateId.startsWith('host-nvidia')));
  validateAcceleration({requestedProfile: 'auto', kvm: d.kvm, candidates: d.candidates.map(c => ({
    candidateId: c.candidateId, kind: c.kind, vendor: c.vendor, status: c.status, reason: c.reason,
    deviceId: c.deviceId, driver: c.driver})), attempts: [], fallback: false, selection: null, calibration: []});
});

test('both GPUs exposed: independent routes with per-process selectors, Intel and NVIDIA checked separately', () => {
  const d = host([intel, nvidia]);
  assert.equal(byId(d, 'host-intel-1').status, 'discovered');
  assert.deepEqual(byId(d, 'host-intel-1').selector, {DRI_PRIME: 'pci-0000_00_02_0'});
  assert.equal(byId(d, 'host-nvidia-1').status, 'discovered');
  assert.deepEqual(byId(d, 'host-nvidia-1').selector, {
    __NV_PRIME_RENDER_OFFLOAD: '1', __GLX_VENDOR_LIBRARY_NAME: 'nvidia', __VK_LAYER_NV_optimus: 'NVIDIA_only'});
  const plan = planAttempts(d, 'host-opengl');
  assert.deepEqual(plan.attempts.map(a => a.candidateId), ['host-intel-1', 'host-nvidia-1',
    'software-swiftshader', 'software-software', 'software-lavapipe', 'software-swangle']);
  const spec = launchSpec(plan.attempts[1]);
  assert.deepEqual(spec.args, ['-gpu', 'host', '-feature', '-Vulkan', '-accel', 'on']);
  assert.deepEqual(spec.env, ['__GLX_VENDOR_LIBRARY_NAME=nvidia', '__NV_PRIME_RENDER_OFFLOAD=1', '__VK_LAYER_NV_optimus=NVIDIA_only']);
  // Without the vendor GLX library the offload selector is unverified: unavailable, not attempted.
  assert.equal(byId(host([intel, nvidia], {nvidiaGlx: false}), 'host-nvidia-1').reason, 'selector-unsupported');
});

test('inaccessible or missing render nodes and missing drivers are unavailable with reasons', () => {
  const locked = {...intel, renderNodes: [{name: 'renderD128', accessible: false}]};
  assert.equal(byId(host([locked]), 'host-intel-1').reason, 'render-node-inaccessible');
  assert.equal(byId(host([{...intel, renderNodes: []}]), 'host-intel-1').reason, 'no-render-node');
  assert.equal(byId(host([{...intel, driver: null}]), 'host-intel-1').reason, 'no-kernel-driver');
  const noHost = discover({devices: [intel], modes: modes.filter(m => m !== 'host'), kvm, nvidiaGlx: true});
  assert.equal(byId(noHost, 'host-intel-1').reason, 'host-mode-unsupported');
});

test('unusable KVM means no candidate meets the CPU profile: actionable exhaustion, no attempts', () => {
  const d = host([intel], {kvm: {usable: false, reason: 'kvm-unavailable'}});
  for (const profile of ['auto', 'host-opengl', 'software']) {
    const plan = planAttempts(d, profile);
    assert.deepEqual(plan.attempts, []);
    assert.equal(plan.error, 'kvm-unavailable');
  }
});

test('profiles order hardware then software fallback; software starts from supported software modes', () => {
  const d = host([intel]);
  assert.deepEqual(planAttempts(d, 'software').attempts.map(a => a.candidateId),
    ['software-swiftshader', 'software-software', 'software-lavapipe', 'software-swangle']);
  assert.deepEqual(launchSpec(planAttempts(d, 'software').attempts[0]).args, ['-gpu', 'swiftshader', '-accel', 'on']);
  // The legacy indirect request is reproduced only for the original baseline, never a fallback.
  const legacy = planAttempts(d, 'legacy');
  assert.deepEqual(legacy.attempts.map(a => a.candidateId), ['legacy-swiftshader-indirect']);
  assert.deepEqual(launchSpec(legacy.attempts[0]).args, ['-gpu', 'swiftshader_indirect']);
  assert.ok(!planAttempts(d, 'auto').attempts.some(a => a.candidateId.startsWith('legacy')));
  // A ranking preference reorders but never adds or drops candidates; a pin selects exactly one.
  assert.deepEqual(planAttempts(d, 'auto', {preferred: 'software-swiftshader'}).attempts.slice(0, 2)
    .map(a => a.candidateId), ['software-swiftshader', 'host-intel-1']);
  assert.deepEqual(planAttempts(d, 'auto', {preferred: 'software-swiftshader', pin: true}).attempts
    .map(a => a.candidateId), ['software-swiftshader']);
  assert.equal(planAttempts(d, 'auto', {preferred: 'host-nvidia-1', pin: true}).error, 'unknown-candidate');
  assert.equal(planAttempts(d, 'bogus').error, 'invalid-profile');
  // Software fallback exhaustion: nothing advertised means a nonzero actionable result.
  const none = discover({devices: [], modes: ['auto'], kvm, nvidiaGlx: false});
  assert.equal(planAttempts(none, 'software').error, 'no-candidates');
});

test('attempt states follow discovered -> claimed -> starting -> ready -> verified -> measured -> selected', () => {
  let a = planAttempts(host([intel]), 'auto').attempts[0];
  assert.equal(a.state, 'discovered');
  for (const next of ['claimed', 'starting', 'ready', 'verified', 'measured', 'selected']) { a = advance(a, next); }
  assert.equal(a.state, 'selected');
  let b = advance(advance(planAttempts(host([intel]), 'auto').attempts[0], 'claimed'), 'starting');
  b = advance(b, 'boot-failed', 'boot-timeout');
  assert.equal(b.reason, 'boot-timeout');
  assert.throws(() => advance(b, 'ready'), /invalid-attempt-transition/);
  assert.throws(() => advance(planAttempts(host([intel]), 'auto').attempts[0], 'verified'), /invalid-attempt-transition/);
  assert.throws(() => advance(advance(advance(advance(planAttempts(host([intel]), 'auto').attempts[0],
    'claimed'), 'starting'), 'ready'), 'verification-failed', 'raw emulator text'), /invalid-reason/);
  // A verified attempt may be selected provisionally before measurement.
  const p = ['claimed', 'starting', 'ready', 'verified', 'selected'].reduce((x, s) => advance(x, s),
    planAttempts(host([intel]), 'auto').attempts[0]);
  assert.equal(p.state, 'selected');
});

test('renderer verification requires KVM, matching GPU and owned render node; software is never verified hardware', () => {
  const d = host([intel, nvidia]);
  const [hostIntel, hostNvidia, swift] = planAttempts(d, 'auto').attempts;
  const base = {api: 31, expectedApi: 31, kvm: true, renderNodes: ['renderD128'], resources};
  assert.deepEqual(verifyAttempt(hostIntel, {...base, gles: intelGles}),
    {verified: true, reason: null, graphics: 'hardware', backend: 'host', vendor: 'intel', ramAgreement: false});
  assert.equal(verifyAttempt(hostIntel, {...base, gles: swiftGles}).reason, 'software-under-host');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: swiftGles}).verified, false);
  assert.equal(verifyAttempt(hostNvidia, {...base, gles: intelGles, renderNodes: ['renderD128']}).reason, 'wrong-gpu');
  assert.equal(verifyAttempt(hostNvidia, {...base, gles: nvidiaGles, renderNodes: ['renderD128']}).reason, 'render-node-mismatch');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: intelGles, renderNodes: ['renderD128', 'renderD129']}).reason, 'ambiguous-identity');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: 'GLES: Google, Translator (Unknown Device)'}).reason, 'ambiguous-identity');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: intelGles, kvm: false}).reason, 'kvm-not-observed');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: ''}).reason, 'renderer-unknown');
  assert.equal(verifyAttempt(hostIntel, {...base, gles: intelGles, api: 36}).reason, 'api-mismatch');
  assert.deepEqual(verifyAttempt(swift, {...base, renderNodes: [], gles: swiftGles}),
    {verified: true, reason: null, graphics: 'software', backend: 'swiftshader', vendor: null, ramAgreement: false});
  assert.equal(verifyAttempt(swift, {...base, gles: intelGles}).reason, 'unexpected-hardware');
});

test('requested and observed RAM disagreement is recorded, not a verification failure or a hidden match', () => {
  const [hostIntel] = planAttempts(host([intel]), 'auto').attempts;
  const base = {api: 31, expectedApi: 31, kvm: true, renderNodes: ['renderD128'], gles: intelGles};
  assert.equal(verifyAttempt(hostIntel, {...base, resources: {requestedRamMiB: 2048, observedRamKiB: 2531820}}).ramAgreement, false);
  assert.equal(verifyAttempt(hostIntel, {...base, resources: {requestedRamMiB: 2048, observedRamKiB: 2097152}}).ramAgreement, true);
  assert.equal(verifyAttempt(hostIntel, {...base, resources: {requestedRamMiB: 2048, observedRamKiB: 2531820}}).verified, true);
});

function samples(candidateId, h, others = 1000, status = 'passed', reps = [1, 2, 3]) {
  return Array.from({length: 8}, (_, i) => `H0${i + 1}`).flatMap(scenarioId => reps.map(repetition => ({
    sampleId: `s-c-${candidateId}-${scenarioId}-${repetition}`, scenarioId, repetition, status,
    elapsedMs: ['H03', 'H07', 'H08'].includes(scenarioId) ? h[scenarioId] + repetition : others,
  })));
}
const cal = (candidateId, kind, h, extra = {}) => ({candidateId, kind, complexity: kind === 'software' ? 2 : 6,
  verified: true, samples: samples(candidateId, h, extra.others, extra.status, extra.reps)});

test('ranking uses the H03/H07/H08 median subtotal, keeps all eight workloads and reports regressions', () => {
  const r = rankCandidates([
    cal('software-swiftshader', 'software', {H03: 9000, H07: 9000, H08: 9000}),
    cal('host-intel-1', 'hardware', {H03: 3000, H07: 3000, H08: 3000}, {others: 1200}),
  ]);
  assert.equal(r.status, 'ranked');
  assert.equal(r.selectedCandidateId, 'host-intel-1');
  assert.deepEqual(r.order.map(o => [o.candidateId, o.subtotalMs]), [['host-intel-1', 9006], ['software-swiftshader', 27006]]);
  assert.equal(r.tie, false);
  // The selected route is slower on the five non-rendering workloads: retained as tradeoffs.
  assert.deepEqual(r.tradeoffs.map(t => t.scenarioId), ['H01', 'H02', 'H04', 'H05', 'H06']);
  assert.ok(r.tradeoffs.every(t => t.fasterCandidateId === 'software-swiftshader'));
});

test('timing ties select the simpler stable configuration, not a preferred vendor', () => {
  const r = rankCandidates([
    cal('host-intel-1', 'hardware', {H03: 3000, H07: 3000, H08: 3000}),
    cal('software-swiftshader', 'software', {H03: 3010, H07: 3010, H08: 3010}),
  ]);
  assert.equal(r.tie, true);
  assert.equal(r.selectedCandidateId, 'software-swiftshader');
});

test('unstable or incomplete calibrations cannot win; nothing measured remains provisional', () => {
  const unstable = cal('host-intel-1', 'hardware', {H03: 1000, H07: 1000, H08: 1000});
  unstable.samples.find(s => s.scenarioId === 'H07' && s.repetition === 3).elapsedMs = 5000;
  const r = rankCandidates([unstable, cal('software-swiftshader', 'software', {H03: 2000, H07: 2000, H08: 2000})]);
  assert.equal(r.selectedCandidateId, 'software-swiftshader');
  assert.equal(r.order.find(o => o.candidateId === 'host-intel-1').stable, false);
  const failed = cal('host-intel-1', 'hardware', {H03: 1, H07: 1, H08: 1}, {status: 'failed'});
  const missing = cal('host-nvidia-1', 'hardware', {H03: 1, H07: 1, H08: 1}, {reps: [1, 2]});
  const p = rankCandidates([failed, missing]);
  assert.equal(p.status, 'provisional');
  assert.equal(p.selectedCandidateId, null);
  assert.deepEqual(p.order.map(o => o.status), ['measurement-failed', 'measurement-failed']);
});

const baseInputs = Object.fromEntries(RANKING_KEYS.map(key => [key, 'b'.repeat(64)]));

test('rankingFingerprint covers every declared input and rejects unknown or missing keys', () => {
  const f = rankingFingerprint(baseInputs);
  assert.match(f, /^[a-f0-9]{64}$/);
  assert.equal(rankingFingerprint({...baseInputs}), f);
  for (const key of RANKING_KEYS) {
    assert.notEqual(rankingFingerprint({...baseInputs, [key]: 'c'.repeat(64)}), f, key);
  }
  assert.throws(() => rankingFingerprint({...baseInputs, docs: 'x'}), /invalid-ranking-inputs/);
  const {app, ...partial} = baseInputs;
  assert.throws(() => rankingFingerprint(partial), /invalid-ranking-inputs/);
});

async function fixtureRepo(t) {
  const repo = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-ranking-test-'));
  t.after(() => rm(repo, {recursive: true, force: true}));
  const files = {
    'src/files/FastScroller.tsx': 'export const x = 1;\n',
    'App.tsx': 'app\n', 'package.json': '{}\n',
    'android/app/build.gradle': 'android {}\n',
    'validation/maestro/polish/03-fast-scroll.yaml': 'appId: x\n',
    'validation/maestro/subflows/show-scrollbar.yaml': '- swipe:\n    waitToSettleTimeoutMs: 50\n',
    'validation/performance/hotspots.json': '{}\n',
    'scripts/validation/device-fixtures.sh': '#!/bin/sh\n',
    'scripts/validation/hooks/pause-service.sh': '#!/bin/sh\n',
    'scripts/validation/performance-report.test.mjs': '// test\n',
    'docs/validation-performance.md': '# docs\n',
    'specs/008-e2e-performance/tasks.md': '# tasks\n',
    'validation/evidence/performance/run.json': '{}\n',
    'android/app/build/outputs/apk/debug/app-debug.apk': 'build output\n',
  };
  for (const [path, body] of Object.entries(files)) {
    await mkdir(join(repo, path, '..'), {recursive: true});
    await writeFile(join(repo, path), body);
  }
  const runtime = {api: 31, image: 'd'.repeat(64), tools: {emulator: '37.1.11', adb: '37.0.1', maestro: '2.10.0'},
    drivers: 'e'.repeat(64), candidates: [{candidateId: 'host-intel-1', status: 'discovered'}],
    hostPower: 'f'.repeat(64), hostResources: '1'.repeat(64), guestResources: {requestedRamMiB: 2048, avdConfig: '2'.repeat(64)},
    fixtures: '3'.repeat(64), animations: {window: 1, transition: 1, animator: 1}};
  return {repo, runtime};
}

test('app, helper, pacing and animation changes invalidate ranking; docs and evidence do not', async t => {
  const {repo, runtime} = await fixtureRepo(t);
  const original = rankingFingerprint(await collectRankingInputs(repo, runtime));
  assert.equal(rankingFingerprint(await collectRankingInputs(repo, runtime)), original, 'unchanged inputs reuse');
  await writeFile(join(repo, 'docs/validation-performance.md'), '# changed docs\n');
  await writeFile(join(repo, 'specs/008-e2e-performance/tasks.md'), '# changed\n');
  await writeFile(join(repo, 'validation/evidence/performance/run.json'), '{"x":1}\n');
  await writeFile(join(repo, 'scripts/validation/performance-report.test.mjs'), '// changed test\n');
  await writeFile(join(repo, 'android/app/build/outputs/apk/debug/app-debug.apk'), 'rebuilt\n');
  assert.equal(rankingFingerprint(await collectRankingInputs(repo, runtime)), original, 'unrelated changes ignored');
  const changes = [
    ['app', async () => writeFile(join(repo, 'src/files/FastScroller.tsx'), 'export const x = 2;\n')],
    ['helper', async () => writeFile(join(repo, 'scripts/validation/hooks/pause-service.sh'), '#!/bin/sh\n:\n')],
    ['pacing', async () => writeFile(join(repo, 'validation/maestro/subflows/show-scrollbar.yaml'), '- swipe:\n    waitToSettleTimeoutMs: 0\n')],
  ];
  let previous = original;
  for (const [label, change] of changes) {
    await change();
    const next = rankingFingerprint(await collectRankingInputs(repo, runtime));
    assert.notEqual(next, previous, label);
    previous = next;
  }
  const animated = rankingFingerprint(await collectRankingInputs(repo, {...runtime, animations: {window: 0, transition: 0, animator: 0}}));
  assert.notEqual(animated, previous, 'animation');
});

test('selection is current only for a matching ranking; stale evidence is provisional and fails the final gate', () => {
  const fingerprint = rankingFingerprint(baseInputs);
  const store = {schemaVersion: 1, apis: {31: {rankingFingerprint: fingerprint, selectedCandidateId: 'host-intel-1',
    status: 'ranked', invocationId: 'inv-abc'}}};
  const current = selectionStatus(store, 31, fingerprint, 'host-intel-1');
  assert.equal(current.status, 'current');
  assert.doesNotThrow(() => assertCurrentRanking(current, fingerprint));
  const changed = rankingFingerprint({...baseInputs, app: 'c'.repeat(64)});
  const stale = selectionStatus(store, 31, changed, 'host-intel-1');
  assert.equal(stale.status, 'stale');
  assert.throws(() => assertCurrentRanking(stale, changed), /stale-ranking-evidence/);
  // Evidence recorded as current earlier cannot pass against today's inputs either.
  assert.throws(() => assertCurrentRanking(current, changed), /stale-ranking-evidence/);
  // An unexpected fallback is a new cohort, not the ranked selection.
  assert.equal(selectionStatus(store, 31, fingerprint, 'software-swiftshader').status, 'provisional');
  assert.equal(selectionStatus(null, 31, fingerprint, 'host-intel-1').status, 'provisional');
  assert.throws(() => assertCurrentRanking(selectionStatus(null, 31, fingerprint, 'host-intel-1'), fingerprint), /stale-ranking-evidence/);
});

test('host device discovery reads only allowlisted sysfs/dev identities', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-sysfs-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const sys = join(root, 'sys'), dev = join(root, 'dev');
  const pci = join(sys, 'bus/pci/devices');
  const add = async (address, cls, vendor, device, driver, nodes = []) => {
    const d = join(pci, address);
    await mkdir(join(d, 'drm'), {recursive: true});
    await writeFile(join(d, 'class'), `${cls}\n`);
    await writeFile(join(d, 'vendor'), `${vendor}\n`);
    await writeFile(join(d, 'device'), `${device}\n`);
    if (driver) {
      await mkdir(join(sys, 'bus/pci/drivers', driver), {recursive: true});
      await symlink(join(sys, 'bus/pci/drivers', driver), join(d, 'driver'));
    }
    for (const node of nodes) { await mkdir(join(d, 'drm', node)); }
  };
  await add('0000:00:02.0', '0x030000', '0x8086', '0x7d55', 'i915', ['card1', 'renderD128']);
  await add('0000:01:00.1', '0x040300', '0x10de', '0x22bd', 'snd_hda_intel');
  await add('0000:00:1f.3', '0x040380', '0x8086', '0x7e28', 'snd_hda_intel');
  await mkdir(join(dev, 'dri'), {recursive: true});
  await writeFile(join(dev, 'dri/renderD128'), '');
  const devices = await readHostDevices({sysfsRoot: sys, devRoot: dev});
  assert.deepEqual(devices.map(d => [d.address, d.vendor, d.driver, d.renderNodes]), [
    ['0000:00:02.0', '0x8086', 'i915', [{name: 'renderD128', accessible: true}]],
    ['0000:01:00.1', '0x10de', 'snd_hda_intel', []],
  ]);
  const d = discover({devices, modes, kvm, nvidiaGlx: false});
  assert.equal(byId(d, 'host-intel-1').status, 'discovered');
  assert.equal(byId(d, 'host-nvidia-1').reason, 'audio-only');
});

test('acceleration records reject unknown fields, free text and malformed identities', () => {
  const good = {requestedProfile: 'auto', kvm: {usable: true, reason: null},
    candidates: [{candidateId: 'host-intel-1', kind: 'hardware', vendor: 'intel', status: 'discovered',
      reason: null, deviceId: '8086:7d55', driver: 'i915'}],
    attempts: [{candidateId: 'host-intel-1', request: 'host', state: 'selected', reason: null,
      backend: 'host', vulkan: 'disabled-requested'}],
    fallback: false, selection: {status: 'provisional', selectedCandidateId: 'host-intel-1',
      rankingFingerprint: null, order: [], tradeoffs: [], tie: false}, calibration: []};
  assert.doesNotThrow(() => validateAcceleration(good));
  const bad = [
    {...good, extra: 1},
    {...good, candidates: [{...good.candidates[0], reason: 'Failed: /home/user/.android'}]},
    {...good, attempts: [{...good.attempts[0], reason: 'emulator: ERROR raw text'}]},
    {...good, candidates: [{...good.candidates[0], deviceId: 'Intel Arc'}]},
    {...good, selection: {...good.selection, status: 'best'}},
    {...good, requestedProfile: 'nvidia'},
  ];
  for (const record of bad) { assert.throws(() => validateAcceleration(record)); }
});
