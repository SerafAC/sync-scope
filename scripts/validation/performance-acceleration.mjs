// Verified emulator acceleration: discovery, finite candidate plans, attempt
// states, runtime verification, calibration ranking and ranking freshness.
// Pure functions take injected observations; the small I/O helpers read only
// allowlisted sysfs/dev identities and the emulator's own capability probes.
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants} from 'node:fs';
import {access, readdir, readFile, readlink} from 'node:fs/promises';
import {basename, join} from 'node:path';

const sha256 = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) { return value.map(canonical); }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
function invalid(code) { throw new Error(code); }

export const PROFILES = ['legacy', 'auto', 'host-opengl', 'software'];
// Fixed documented software order: SwiftShader, the generic software selector,
// then other advertised software backends only if those are unavailable/fail.
export const SOFTWARE_ORDER = ['swiftshader', 'software', 'lavapipe', 'swangle'];
const VENDORS = {'0x8086': 'intel', '0x10de': 'nvidia'};
const DRIVERS = ['i915', 'xe', 'nvidia', 'nouveau', 'amdgpu', 'snd_hda_intel', 'other'];
const HARDWARE_ARGS = ['-gpu', 'host', '-feature', '-Vulkan', '-accel', 'on'];
export const STATES = ['discovered', 'claimed', 'starting', 'ready', 'verified', 'measured', 'selected',
  'unavailable', 'boot-failed', 'verification-failed', 'measurement-failed'];
const FAILURES = {unavailable: true, 'boot-failed': true, 'verification-failed': true, 'measurement-failed': true};
const TRANSITIONS = {
  discovered: ['claimed', 'unavailable'], claimed: ['starting', 'boot-failed'],
  starting: ['ready', 'boot-failed'], ready: ['verified', 'verification-failed'],
  verified: ['measured', 'selected', 'measurement-failed'], measured: ['selected'],
};
// Known sanitized reasons. Raw emulator/driver text never becomes a reason.
export const REASONS = ['not-exposed', 'audio-only', 'no-render-node', 'render-node-inaccessible',
  'no-kernel-driver', 'host-mode-unsupported', 'selector-unsupported', 'kvm-unavailable',
  'launch-failed', 'emulator-exited', 'boot-timeout', 'ownership-unproven', 'route-timeout',
  'watchdog-failed', 'kvm-not-observed', 'renderer-unknown', 'software-under-host', 'wrong-gpu',
  'render-node-mismatch', 'ambiguous-identity', 'unexpected-hardware', 'backend-mismatch',
  'api-mismatch', 'metadata-failed', 'measurement-failed', 'interrupted', 'excluded'];
const CANDIDATE_ID = /^(?:host-(?:intel|nvidia)-[1-9]|software-(?:swiftshader|software|lavapipe|swangle)|legacy-swiftshader-indirect)$/;
const SELECTOR_ENV = ['DRI_PRIME'];
// Vendors never offered as candidates (decision 2026-10-20: NVIDIA dropped).
// Their routes are recorded as unavailable/excluded from fixed values only, so
// the host's NVIDIA power or driver state can neither start an attempt nor
// change a ranking input, and nothing here powers or probes that device.
export const EXCLUDED_VENDORS = ['nvidia'];

export function parseGpuModes(text) {
  const modes = [];
  for (const line of String(text).split('\n')) {
    const match = line.match(/^\s+([a-z_]+)(?:\s+\(default\))?\s+->/);
    if (match && !modes.includes(match[1])) { modes.push(match[1]); }
  }
  return modes;
}
export function parseKvmCheck(text, status) {
  return status === 0 && /\bKVM\b[^\n]*\bis installed and usable\b/.test(String(text)) ?
    {usable: true, reason: null} : {usable: false, reason: 'kvm-unavailable'};
}

export async function readHostDevices({sysfsRoot = '/sys', devRoot = '/dev'} = {}) {
  const root = join(sysfsRoot, 'bus/pci/devices'), devices = [];
  for (const address of (await readdir(root).catch(() => [])).sort()) {
    if (!/^[0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-7]$/.test(address)) { continue; }
    const read = async name => (await readFile(join(root, address, name), 'utf8').catch(() => '')).trim();
    const pciClass = await read('class'), vendor = await read('vendor'), device = await read('device');
    if (!/^0x[0-9a-f]{6}$/.test(pciClass) || !/^0x[0-9a-f]{4}$/.test(vendor) || !/^0x[0-9a-f]{4}$/.test(device)) { continue; }
    // Display/3D controllers, plus NVIDIA's audio function so audio-only exposure is reported truthfully.
    if (!pciClass.startsWith('0x03') && !(pciClass.startsWith('0x0403') && vendor === '0x10de')) { continue; }
    const target = await readlink(join(root, address, 'driver')).catch(() => null);
    const renderNodes = [];
    for (const name of (await readdir(join(root, address, 'drm')).catch(() => [])).sort()) {
      if (!/^renderD\d+$/.test(name)) { continue; }
      const accessible = await access(join(devRoot, 'dri', name), constants.R_OK | constants.W_OK)
        .then(() => true, () => false);
      renderNodes.push({name, accessible});
    }
    devices.push({address, pciClass, vendor, device, driver: target ? basename(target) : null, renderNodes});
  }
  return devices;
}
export function discover({devices, modes, kvm}) {
  const display = devices.filter(d => d.pciClass.startsWith('0x03') && VENDORS[d.vendor]);
  const candidates = [];
  for (const vendor of ['intel', 'nvidia']) {
    if (EXCLUDED_VENDORS.includes(vendor)) {
      candidates.push({candidateId: `host-${vendor}-1`, kind: 'hardware', vendor, status: 'unavailable',
        reason: 'excluded', deviceId: null, driver: null, renderNode: null, selector: {}});
      continue;
    }
    const own = display.filter(d => VENDORS[d.vendor] === vendor);
    if (!own.length) {
      const audio = devices.some(d => VENDORS[d.vendor] === vendor && d.pciClass.startsWith('0x0403'));
      candidates.push({candidateId: `${'host'}-${vendor}-1`, kind: 'hardware', vendor, status: 'unavailable',
        reason: audio ? 'audio-only' : 'not-exposed', deviceId: null, driver: null, renderNode: null, selector: {}});
      continue;
    }
    own.slice(0, 9).forEach((d, i) => {
      const node = d.renderNodes[0] ?? null;
      const driver = d.driver ? (DRIVERS.includes(d.driver) ? d.driver : 'other') : null;
      let reason = null;
      if (!d.driver) { reason = 'no-kernel-driver'; }
      else if (!node) { reason = 'no-render-node'; }
      else if (!node.accessible) { reason = 'render-node-inaccessible'; }
      else if (!modes.includes('host')) { reason = 'host-mode-unsupported'; }
      candidates.push({candidateId: `host-${vendor}-${i + 1}`, kind: 'hardware', vendor,
        status: reason ? 'unavailable' : 'discovered', reason,
        deviceId: `${d.vendor.slice(2)}:${d.device.slice(2)}`, driver, renderNode: node?.name ?? null,
        address: d.address, selector: {}});
    });
  }
  // Per-process selectors only where the installed stack documents them:
  // Mesa's DRI_PRIME when more than one render device could be chosen.
  const usable = candidates.filter(c => c.status === 'discovered');
  for (const c of usable) {
    if (usable.length > 1) { c.selector = {DRI_PRIME: `pci-${c.address.replace(/[:.]/g, '_')}`}; }
    delete c.address;
  }
  for (const c of candidates) { delete c.address; }
  const software = SOFTWARE_ORDER.filter(mode => modes.includes(mode));
  for (const mode of software) {
    candidates.push({candidateId: `software-${mode}`, kind: 'software', vendor: null, status: 'discovered',
      reason: null, deviceId: null, driver: null, renderNode: null, selector: {}});
  }
  return {kvm: {usable: !!kvm?.usable, reason: kvm?.usable ? null : 'kvm-unavailable'}, modes: [...modes], candidates, software};
}

function attemptOf(candidate) {
  const request = candidate.kind === 'hardware' ? 'host' : candidate.candidateId.slice('software-'.length);
  return {candidateId: candidate.candidateId, kind: candidate.kind, request, vendor: candidate.vendor,
    renderNode: candidate.renderNode, selector: {...candidate.selector}, state: 'discovered', reason: null,
    complexity: launchSpec({kind: candidate.kind, request, selector: candidate.selector}).args.length +
      Object.keys(candidate.selector).length};
}
export function planAttempts(discovery, profile, {preferred = null, pin = false} = {}) {
  if (!PROFILES.includes(profile)) { return {attempts: [], error: 'invalid-profile'}; }
  if (profile === 'legacy') {
    // Reproduces only the original baseline request; it is never a fallback.
    return {attempts: [{candidateId: 'legacy-swiftshader-indirect', kind: 'software', request: 'swiftshader_indirect',
      vendor: null, renderNode: null, selector: {}, state: 'discovered', reason: null, complexity: 2}], error: null};
  }
  if (!discovery.kvm.usable) { return {attempts: [], error: 'kvm-unavailable'}; }
  const hardware = profile === 'software' ? [] :
    discovery.candidates.filter(c => c.kind === 'hardware' && c.status === 'discovered');
  const software = discovery.candidates.filter(c => c.kind === 'software' && c.status === 'discovered');
  let attempts = [...hardware, ...software].map(attemptOf);
  if (preferred !== null) {
    const chosen = attempts.find(a => a.candidateId === preferred);
    if (!chosen) {
      if (pin) { return {attempts: [], error: 'unknown-candidate'}; }
    } else {
      attempts = pin ? [chosen] : [chosen, ...attempts.filter(a => a !== chosen)];
    }
  }
  return attempts.length ? {attempts, error: null} : {attempts: [], error: 'no-candidates'};
}
export function launchSpec(attempt) {
  if (attempt.request === 'swiftshader_indirect') { return {args: ['-gpu', 'swiftshader_indirect'], env: []}; }
  if (attempt.kind === 'hardware') {
    const env = Object.entries(attempt.selector ?? {}).map(([k, v]) => {
      if (!SELECTOR_ENV.includes(k) || !/^[A-Za-z0-9_-]+$/.test(v)) { invalid('invalid-selector'); }
      return `${k}=${v}`;
    }).sort();
    return {args: [...HARDWARE_ARGS], env};
  }
  if (!SOFTWARE_ORDER.includes(attempt.request)) { invalid('invalid-request'); }
  return {args: ['-gpu', attempt.request, '-accel', 'on'], env: []};
}
export function advance(attempt, next, reason = null) {
  if (!(TRANSITIONS[attempt.state] ?? []).includes(next)) { invalid('invalid-attempt-transition'); }
  if (FAILURES[next] ? !REASONS.includes(reason) : reason !== null) { invalid('invalid-reason'); }
  return {...attempt, state: next, reason};
}

const SOFTWARE_RENDERER = /swiftshader|llvmpipe|lavapipe|softpipe/i;
export function verifyAttempt(attempt, observed) {
  const ramAgreement = observed.resources?.observedRamKiB === observed.resources?.requestedRamMiB * 1024;
  const result = (reason, extra = {}) => ({verified: reason === null, reason,
    graphics: extra.graphics ?? 'unknown', backend: extra.backend ?? null, vendor: extra.vendor ?? null, ramAgreement});
  if (Number(observed.api) !== Number(observed.expectedApi)) { return result('api-mismatch'); }
  if (!observed.kvm) { return result('kvm-not-observed'); }
  const gles = String(observed.gles ?? '');
  if (!gles.trim()) { return result('renderer-unknown'); }
  const nodes = observed.renderNodes ?? [];
  if (attempt.kind === 'hardware') {
    if (SOFTWARE_RENDERER.test(gles)) { return result('software-under-host', {graphics: 'software'}); }
    const intel = /\bintel\b/i.test(gles), nvidia = /nvidia|geforce|quadro/i.test(gles);
    if (intel === nvidia) { return result('ambiguous-identity', {graphics: 'hardware'}); }
    const vendor = intel ? 'intel' : 'nvidia';
    if (vendor !== attempt.vendor) { return result('wrong-gpu', {graphics: 'hardware'}); }
    if (!nodes.includes(attempt.renderNode)) { return result('render-node-mismatch', {graphics: 'hardware'}); }
    if (nodes.some(n => n !== attempt.renderNode)) { return result('ambiguous-identity', {graphics: 'hardware'}); }
    return result(null, {graphics: 'hardware', backend: 'host', vendor});
  }
  if (!SOFTWARE_RENDERER.test(gles)) { return result('unexpected-hardware', {graphics: 'hardware'}); }
  const backend = gles.match(SOFTWARE_RENDERER)[0].toLowerCase();
  if (attempt.request === 'swiftshader' && backend !== 'swiftshader') {
    return result('backend-mismatch', {graphics: 'software', backend});
  }
  return result(null, {graphics: 'software', backend});
}

const RANKED = ['H03', 'H07', 'H08'];
const ALL_SCENARIOS = Array.from({length: 8}, (_, i) => `H0${i + 1}`);
const median3 = values => [...values].sort((a, b) => a - b)[1];
export function rankCandidates(calibrations) {
  const rows = calibrations.map(c => {
    const complete = c.verified && ALL_SCENARIOS.every(s => [1, 2, 3].every(r =>
      c.samples.filter(x => x.scenarioId === s && x.repetition === r && x.status === 'passed').length === 1)) &&
      c.samples.every(x => x.status === 'passed');
    if (!complete) {
      return {candidateId: c.candidateId, complexity: c.complexity, status: 'measurement-failed', subtotalMs: null, stable: null, medians: null};
    }
    const medians = Object.fromEntries(ALL_SCENARIOS.map(s =>
      [s, median3(c.samples.filter(x => x.scenarioId === s).map(x => x.elapsedMs))]));
    const stable = RANKED.every(s => {
      const values = c.samples.filter(x => x.scenarioId === s).map(x => x.elapsedMs);
      return medians[s] > 0 && (Math.max(...values) - Math.min(...values)) / medians[s] <= 0.25;
    });
    return {candidateId: c.candidateId, complexity: c.complexity, status: 'measured',
      subtotalMs: RANKED.reduce((sum, s) => sum + medians[s], 0), stable, medians};
  });
  const measured = rows.filter(r => r.status === 'measured');
  const publish = r => ({candidateId: r.candidateId, status: r.status, subtotalMs: r.subtotalMs, stable: r.stable});
  if (!measured.length) {
    return {status: 'provisional', selectedCandidateId: null, order: rows.map(publish), tradeoffs: [], tie: false};
  }
  const pool = measured.some(r => r.stable) ? measured.filter(r => r.stable) : measured;
  const best = Math.min(...pool.map(r => r.subtotalMs));
  // A difference within 2% is a timing tie: prefer the simpler configuration.
  const tied = pool.filter(r => r.subtotalMs <= best * 1.02)
    .sort((a, b) => a.complexity - b.complexity || a.subtotalMs - b.subtotalMs || (a.candidateId < b.candidateId ? -1 : 1));
  const selected = tied[0];
  const rest = rows.filter(r => r !== selected).sort((a, b) =>
    (a.status === 'measured' ? 0 : 1) - (b.status === 'measured' ? 0 : 1) ||
    (a.stable ? 0 : 1) - (b.stable ? 0 : 1) || (a.subtotalMs ?? Infinity) - (b.subtotalMs ?? Infinity));
  const tradeoffs = [];
  for (const s of ALL_SCENARIOS) {
    for (const other of measured.filter(r => r !== selected)) {
      if (other.medians[s] < selected.medians[s] * 0.95) { tradeoffs.push({scenarioId: s, fasterCandidateId: other.candidateId}); }
    }
  }
  return {status: 'ranked', selectedCandidateId: selected.candidateId, order: [selected, ...rest].map(publish),
    tradeoffs, tie: tied.length > 1};
}

export const RANKING_KEYS = ['workload', 'flowClosure', 'helperClosure', 'app', 'fixtures', 'api', 'image',
  'tools', 'drivers', 'candidates', 'hostPower', 'hostResources', 'buildCache', 'guestResources', 'animations'];
export function rankingFingerprint(inputs) {
  if (!inputs || typeof inputs !== 'object' || Object.keys(inputs).length !== RANKING_KEYS.length ||
      RANKING_KEYS.some(key => inputs[key] === undefined)) { invalid('invalid-ranking-inputs'); }
  return sha256(JSON.stringify(canonical(inputs)));
}
const SKIPPED = new Set(['node_modules', 'build', '.gradle', '.cxx', '.idea', '.git', '.kotlin']);
async function files(root, relative) {
  const result = [];
  for (const entry of await readdir(join(root, relative), {withFileTypes: true}).catch(() => [])) {
    const path = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) { result.push(...await files(root, path)); }
    else if (entry.isFile() && entry.name !== 'local.properties') { result.push(path); }
  }
  return result;
}
async function closure(root, paths) {
  const h = createHash('sha256');
  for (const path of [...new Set(paths)].sort()) {
    h.update(path).update('\0').update(sha256(await readFile(join(root, path)).catch(() => Buffer.alloc(0)))).update('\0');
  }
  return h.digest('hex');
}
// Reporting-only modules and tests never change what a validation executes.
const REPORTING_ONLY = /(?:\.test\.mjs|\/performance-(?:report|acceleration|acceptance)\.mjs|\/acceleration-fault-check\.mjs)$/;
const APP_ROOT_FILES = ['App.tsx', 'index.js', 'package.json', 'pnpm-lock.yaml', 'babel.config.js',
  'metro.config.js', 'app.json', 'tsconfig.json'];
export async function collectRankingInputs(repository, runtime) {
  for (const key of ['api', 'image', 'tools', 'drivers', 'candidates', 'hostPower', 'hostResources',
    'guestResources', 'fixtures', 'animations']) {
    if (runtime?.[key] === undefined) { invalid('invalid-ranking-inputs'); }
  }
  const app = [...await files(repository, 'src'), ...await files(repository, 'android'),
    ...APP_ROOT_FILES];
  return {
    workload: await closure(repository, ['validation/performance/hotspots.json']),
    flowClosure: await closure(repository, await files(repository, 'validation/maestro')),
    helperClosure: await closure(repository, (await files(repository, 'scripts/validation'))
      .filter(path => !REPORTING_ONLY.test(path))),
    app: await closure(repository, app),
    fixtures: runtime.fixtures, api: Number(runtime.api), image: runtime.image, tools: runtime.tools,
    drivers: runtime.drivers,
    candidates: runtime.candidates.map(c => ({candidateId: c.candidateId, status: c.status})),
    hostPower: runtime.hostPower, hostResources: runtime.hostResources,
    buildCache: runtime.buildCache ?? 'no-daemon:assembleDebug', guestResources: runtime.guestResources,
    animations: runtime.animations,
  };
}

export function selectionStatus(store, api, fingerprint, actualCandidateId) {
  const entry = store?.apis?.[api] ?? null;
  let status = 'provisional';
  if (entry?.status === 'ranked') {
    if (entry.rankingFingerprint !== fingerprint) { status = 'stale'; }
    else if (entry.selectedCandidateId === actualCandidateId) { status = 'current'; }
  }
  return {status, selectedCandidateId: actualCandidateId, rankedCandidateId: entry?.selectedCandidateId ?? null,
    rankingFingerprint: fingerprint, order: [], tradeoffs: [], tie: false};
}
// Final best-working-renderer acceptance: only current ranking evidence for the
// final executed inputs passes. Stale or provisional selection never does.
export function assertCurrentRanking(selection, fingerprint) {
  if (!['current', 'ranked'].includes(selection?.status) || !/^[a-f0-9]{64}$/.test(fingerprint ?? '') ||
      selection.rankingFingerprint !== fingerprint) { invalid('stale-ranking-evidence'); }
}

function exact(value, keys, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid('invalid-acceleration'); }
  if (Object.keys(value).some(k => !keys.includes(k))) { invalid('unknown-metadata'); }
  if (keys.some(k => !optional.includes(k) && !Object.hasOwn(value, k))) { invalid('invalid-acceleration'); }
}
function one(value, values) { if (!values.includes(value)) { invalid('invalid-acceleration'); } }
const id = (value, nullable = false) => {
  if (!(nullable && value === null) && (typeof value !== 'string' || !CANDIDATE_ID.test(value))) { invalid('invalid-acceleration'); }
};
const reasonOf = value => { if (value !== null && !REASONS.includes(value)) { invalid('invalid-acceleration'); } };
const digestOf = value => { if (value !== null && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) { invalid('invalid-acceleration'); } };
const list = value => { if (!Array.isArray(value)) { invalid('invalid-acceleration'); } return value; };
export function validateAcceleration(record, {sample} = {}) {
  exact(record, ['requestedProfile', 'kvm', 'candidates', 'attempts', 'fallback', 'selection', 'calibration']);
  one(record.requestedProfile, PROFILES);
  exact(record.kvm, ['usable', 'reason']); one(record.kvm.usable, [true, false]); one(record.kvm.reason, [null, 'kvm-unavailable']);
  for (const c of list(record.candidates)) {
    exact(c, ['candidateId', 'kind', 'vendor', 'status', 'reason', 'deviceId', 'driver']);
    id(c.candidateId); one(c.kind, ['hardware', 'software']); one(c.vendor, ['intel', 'nvidia', null]);
    one(c.status, ['discovered', 'unavailable']); reasonOf(c.reason);
    if (c.deviceId !== null && (typeof c.deviceId !== 'string' || !/^[0-9a-f]{4}:[0-9a-f]{4}$/.test(c.deviceId))) { invalid('invalid-acceleration'); }
    one(c.driver, [...DRIVERS, null]);
  }
  for (const a of list(record.attempts)) {
    exact(a, ['candidateId', 'request', 'state', 'reason', 'backend', 'vulkan']);
    id(a.candidateId); one(a.request, ['host', ...SOFTWARE_ORDER, 'swiftshader_indirect']);
    one(a.state, STATES); reasonOf(a.reason);
    one(a.backend, ['host', 'swiftshader', 'llvmpipe', 'lavapipe', 'softpipe', null]);
    one(a.vulkan, ['disabled-requested', 'enabled', 'absent', 'unknown']);
  }
  one(record.fallback, [true, false]);
  if (record.selection !== null) {
    const s = record.selection;
    exact(s, ['status', 'selectedCandidateId', 'rankedCandidateId', 'rankingFingerprint', 'order', 'tradeoffs', 'tie'],
      ['rankedCandidateId']);
    one(s.status, ['legacy', 'provisional', 'current', 'stale', 'ranked']);
    id(s.selectedCandidateId, true); if (Object.hasOwn(s, 'rankedCandidateId')) { id(s.rankedCandidateId, true); }
    digestOf(s.rankingFingerprint); one(s.tie, [true, false]);
    for (const o of list(s.order)) {
      exact(o, ['candidateId', 'status', 'subtotalMs', 'stable']); id(o.candidateId);
      one(o.status, ['measured', 'measurement-failed', 'boot-failed']);
      if (o.subtotalMs !== null && (typeof o.subtotalMs !== 'number' || !Number.isFinite(o.subtotalMs) || o.subtotalMs < 0)) { invalid('invalid-acceleration'); }
      one(o.stable, [true, false, null]);
    }
    for (const t of list(s.tradeoffs)) {
      exact(t, ['scenarioId', 'fasterCandidateId']); one(t.scenarioId, ALL_SCENARIOS); id(t.fasterCandidateId);
    }
  }
  for (const c of list(record.calibration)) {
    exact(c, ['candidateId', 'status', 'reason', 'profileFingerprint', 'verified', 'samples']);
    id(c.candidateId); one(c.status, ['measured', 'measurement-failed', 'boot-failed']); reasonOf(c.reason);
    digestOf(c.profileFingerprint); one(c.verified, [true, false]);
    for (const x of list(c.samples)) { if (sample) { sample(x); } }
  }
  return record;
}

// Host capability probes: the emulator's own advertised modes and KVM check.
export async function discoverHost(sdk, {sysfsRoot, devRoot} = {}) {
  const emulator = join(sdk, 'emulator/emulator');
  const probe = args => spawnSync(emulator, args, {encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe']});
  const help = probe(['-help-gpu']), accel = probe(['-accel-check']);
  const dev = devRoot ?? '/dev';
  let kvm = parseKvmCheck(`${accel.stdout ?? ''}\n${accel.stderr ?? ''}`, accel.status);
  if (kvm.usable && !await access(join(dev, 'kvm'), constants.R_OK | constants.W_OK).then(() => true, () => false)) {
    kvm = {usable: false, reason: 'kvm-unavailable'};
  }
  return discover({devices: await readHostDevices({sysfsRoot, devRoot: dev}),
    modes: help.status === 0 ? parseGpuModes(help.stdout) : [], kvm});
}
