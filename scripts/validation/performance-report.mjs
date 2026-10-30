import {createHash, randomBytes} from 'node:crypto';
import {chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile} from 'node:fs/promises';
import {cpus, platform, release} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  advance, collectRankingInputs, discoverHost, launchSpec, planAttempts, rankCandidates,
  rankingFingerprint, selectionStatus, validateAcceleration, verifyAttempt,
} from './performance-acceleration.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) { return value.map(canonical); }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  }
  return value;
}
const scenarios = Array.from({length: 8}, (_, i) => `H0${i + 1}`);
const failures = [null, 'startup', 'validation', 'timeout', 'interrupted', 'audit',
  'restoration', 'missing-artifact', 'unsupported-artifact', 'unknown-metadata', 'build', 'fixture'];
const phases = ['build', 'services', 'boot', 'install', 'remote-fixtures', 'device-fixtures',
  'workspace', 'measurement', 'staged', 'cleanup', 'other'];
const categories = ['action', 'input', 'assertion', 'wait', 'navigation', 'script', 'other'];
function invalid(code = 'invalid-record') { throw new Error(code); }
function object(value, keys, optional = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { invalid(); }
  if (Object.keys(value).some(key => !keys.includes(key))) { invalid('unknown-metadata'); }
  if (keys.some(key => !optional.includes(key) && !Object.hasOwn(value, key))) { invalid('invalid-missing-metadata'); }
}
function choice(value, values) { if (!values.includes(value)) { invalid(); } }
function number(value, nullable = false) {
  if (nullable && value === null) { return; }
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) { invalid('invalid-duration-or-number'); }
}
function digest(value, nullable = false) {
  if (nullable && value === null) { return; }
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) { invalid('invalid-identity'); }
}
function opaque(value) {
  if (typeof value !== 'string' || !/^(inv|api|s|raw|seg|flow)-[A-Za-z0-9-]{1,80}$/.test(value)) { invalid('invalid-opaque-id'); }
}
function version(value) {
  if (value !== null && (typeof value !== 'string' || !/^\d+(?:\.\d+){0,4}(?:-\d+)?$/.test(value))) { invalid('invalid-version'); }
}
function boolean(value) { if (typeof value !== 'boolean') { invalid(); } }
function array(value) { if (!Array.isArray(value)) { invalid(); } }
function validatePhase(p) {
  object(p, ['segmentId', 'phase', 'startNs', 'endNs', 'elapsedMs', 'status']);
  opaque(p.segmentId); choice(p.phase, phases);
  choice(p.status, ['passed', 'failed', 'interrupted']);
  if (elapsedMilliseconds(p.startNs, p.endNs) !== p.elapsedMs) { invalid('invalid-phase-duration'); }
}
function validateCommands(commands) {
  array(commands);
  for (const c of commands) {
    object(c, ['category', 'count', 'elapsedMs', 'status']);
    choice(c.category, categories); number(c.count); number(c.elapsedMs);
    choice(c.status, ['passed', 'failed', 'interrupted']);
  }
}
function validateAssertions(a) {
  object(a, ['executed', 'failed', 'missing']);
  for (const n of Object.values(a)) { number(n); if (!Number.isInteger(n)) { invalid(); } }
}
function validateSample(s) {
  object(s, ['sampleId', 'scenarioId', 'repetition', 'status', 'failureCode', 'elapsedMs',
    'inputFingerprint', 'artifactId', 'commands', 'assertions']);
  opaque(s.sampleId); choice(s.scenarioId, scenarios); choice(s.repetition, [1, 2, 3]);
  choice(s.status, ['passed', 'failed', 'interrupted']); choice(s.failureCode, failures);
  number(s.elapsedMs); digest(s.inputFingerprint); opaque(s.artifactId);
  validateCommands(s.commands); validateAssertions(s.assertions);
  if (s.status === 'passed' && (s.failureCode || !s.assertions.executed ||
      s.assertions.failed || s.assertions.missing ||
      s.commands.some(c => c.status !== 'passed'))) { invalid('invalid-success'); }
}
function validateBuild(build) {
  object(build, ['apkDigest', 'abi', 'cachePolicy', 'cacheState', 'tasks']);
  digest(build.apkDigest, true); choice(build.abi, ['x86_64', 'debug-default', 'release-default', 'instrumented']);
  choice(build.cachePolicy, ['no-daemon', 'default']);
  choice(build.cacheState, ['cold', 'warm', 'mixed', 'unknown']);
  choice(build.tasks, ['executed', 'cached', 'mixed', 'unknown']);
}
export function elapsedMilliseconds(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string' ||
      !/^\d+$/.test(start) || !/^\d+$/.test(end)) { invalid('invalid-duration'); }
  const ns = BigInt(end) - BigInt(start);
  if (ns < 0n) { invalid('invalid-duration'); }
  const result = Number(ns) / 1e6;
  number(result);
  return result;
}

const protocols = ['ftp', 'sftp', 'webdav'];
function integer(value) { number(value); if (!Number.isInteger(value)) { invalid('invalid-duration-or-number'); } }
// Container restarts inside each protocol scope: counts and die/start times only.
function validateServiceRestarts(records) {
  array(records);
  const seen = new Set();
  for (const r of records) {
    object(r, ['protocol', 'restarts', 'events']);
    choice(r.protocol, protocols); if (seen.has(r.protocol)) { invalid('invalid-duplicate-service'); } seen.add(r.protocol);
    integer(r.restarts); array(r.events);
    for (const e of r.events) { object(e, ['action', 'unixMs']); choice(e.action, ['die', 'start']); integer(e.unixMs); }
  }
}
// Parses protocol-service.sh's `<protocol>.restarts` lifecycle records, if any.
export function parseServiceRestarts(protocol, text) {
  const lines = text.split('\n');
  if (lines.pop() !== '') { invalid('invalid-restart-record'); }
  const [before, after, ...rest] = lines;
  const count = (line, label) => {
    const m = new RegExp(`^${label} (\\d{1,9})$`).exec(line ?? '');
    if (!m) { invalid('invalid-restart-record'); }
    return Number(m[1]);
  };
  const restarts = count(after, 'after') - count(before, 'before');
  if (restarts < 0) { invalid('invalid-restart-record'); }
  const events = rest.map(line => {
    const m = /^(\d{1,20}) (die|start)$/.exec(line);
    if (!m) { invalid('invalid-restart-record'); }
    return {action: m[2], unixMs: Number(BigInt(m[1]) / 1000000n)};
  });
  const record = {protocol, restarts, events};
  validateServiceRestarts([record]);
  return record;
}

export function validateRun(run) {
  object(run, ['schemaVersion', 'invocationId', 'mode', 'status', 'failureCode', 'source', 'host',
    'workloadFingerprint', 'build', 'fixtureSet', 'sharedPhases', 'elapsedMs', 'apiRuns',
    'serviceRestarts'], ['serviceRestarts']);
  if (Object.hasOwn(run, 'serviceRestarts')) { validateServiceRestarts(run.serviceRestarts); }
  if (run.schemaVersion !== 1) { invalid('unsupported-schema-version'); }
  opaque(run.invocationId); choice(run.mode, ['connected', 'e2e', 'measure']);
  choice(run.status, ['running', 'passed', 'failed', 'interrupted']); choice(run.failureCode, failures);
  object(run.source, ['revision', 'inputFingerprint']);
  if (run.source.revision !== null && !/^[a-f0-9]{40}$/.test(run.source.revision)) { invalid('invalid-revision'); }
  digest(run.source.inputFingerprint); digest(run.workloadFingerprint);
  object(run.host, ['id', 'os', 'kernel', 'cpu', 'tools', 'power']);
  digest(run.host.id); choice(run.host.os, ['linux']); version(run.host.kernel);
  digest(run.host.cpu); digest(run.host.power, true);
  if (!run.host.tools || Object.keys(run.host.tools).some(k => !['node', 'maestro', 'emulator',
    'adb', 'docker', 'compose', 'java', 'pnpm'].includes(k))) { invalid('unknown-tool-metadata'); }
  for (const v of Object.values(run.host.tools)) { version(v); }
  validateBuild(run.build);
  object(run.fixtureSet, ['fingerprint', 'counts', 'logicalBytes', 'restoration']);
  digest(run.fixtureSet.fingerprint);
  object(run.fixtureSet.counts, ['bulkFiles', 'galleryBulkFiles', 'scrollFiles']);
  for (const v of Object.values(run.fixtureSet.counts)) { number(v); }
  number(run.fixtureSet.logicalBytes, true);
  choice(run.fixtureSet.restoration, ['unknown', 'passed', 'failed']);
  number(run.elapsedMs); array(run.sharedPhases); run.sharedPhases.forEach(validatePhase);
  array(run.apiRuns);
  const seenApis = new Set(), sampleIds = new Set();
  for (const a of run.apiRuns) {
    object(a, ['runId', 'invocationId', 'api', 'image', 'status', 'profile', 'resources',
      'animations', 'phases', 'samples', 'acceptance', 'build', 'acceleration'], ['build', 'acceleration']);
    if (a.build) { validateBuild(a.build); }
    if (Object.hasOwn(a, 'acceleration')) {
      try { validateAcceleration(a.acceleration, {sample: validateSample}); }
      catch (error) { invalid(error.message === 'unknown-metadata' ? error.message : 'invalid-acceleration'); }
    }
    opaque(a.runId);
    if (a.invocationId !== run.invocationId) { invalid('invalid-invocation-reference'); }
    choice(a.api, [31, 36]); if (seenApis.has(a.api)) { invalid('duplicate-api'); } seenApis.add(a.api);
    digest(a.image, true); choice(a.status, ['running', 'passed', 'failed', 'interrupted']);
    object(a.profile, ['fingerprint', 'requested', 'cpu', 'graphics', 'backend', 'renderer',
      'driver', 'verified', 'fallback']);
    digest(a.profile.fingerprint, true); choice(a.profile.requested, ['auto', 'host-opengl', 'software']);
    choice(a.profile.cpu, ['kvm', 'software', 'unknown']);
    choice(a.profile.graphics, ['hardware', 'software', 'unknown']);
    for (const key of ['backend', 'renderer', 'driver']) { digest(a.profile[key], true); }
    boolean(a.profile.verified); boolean(a.profile.fallback);
    object(a.resources, ['requestedRamMiB', 'observedRamKiB', 'cpus', 'width', 'height', 'density']);
    for (const v of Object.values(a.resources)) { number(v, true); }
    object(a.animations, ['window', 'transition', 'animator']);
    for (const v of Object.values(a.animations)) { number(v, true); }
    array(a.phases); a.phases.forEach(validatePhase);
    array(a.samples);
    const repetitions = new Set();
    for (const sample of a.samples) {
      validateSample(sample);
      const key = `${sample.scenarioId}:${sample.repetition}`;
      if (repetitions.has(key) || sampleIds.has(sample.sampleId)) { invalid('duplicate-sample-repetition'); }
      repetitions.add(key); sampleIds.add(sample.sampleId);
    }
    array(a.acceptance);
    for (const claim of a.acceptance) {
      object(claim, ['flowId', 'status', 'artifactId', 'assertions', 'commands', 'failureCode']);
      opaque(claim.flowId); opaque(claim.artifactId);
      choice(claim.status, ['executed', 'failed', 'missing', 'pre-existing documented deviation']);
      choice(claim.failureCode, failures); validateAssertions(claim.assertions); validateCommands(claim.commands);
      if (claim.status === 'executed' && (claim.failureCode || !claim.assertions.executed ||
          claim.assertions.failed || claim.assertions.missing ||
          claim.commands.some(c => c.status !== 'passed'))) { invalid('invalid-success'); }
    }
  }
  if (run.status === 'passed' && (run.failureCode || run.fixtureSet.restoration !== 'passed' ||
      run.sharedPhases.some(p => p.status !== 'passed') || !run.apiRuns.length ||
      run.apiRuns.some(a => a.status !== 'passed' || a.samples.some(s => s.status !== 'passed') ||
        a.phases.some(p => p.status !== 'passed') ||
        a.acceptance.some(c => ['failed', 'missing'].includes(c.status)) ||
        (run.mode === 'measure' && a.samples.length !== 24)))) { invalid('invalid-success'); }
  return structuredClone(run);
}

// Equality key for matched cohorts (decision 2026-10-21): fixtures match on dataset identity
// (parameters, counts, logical bytes), not on the fixture-script fingerprint; the debug build ABI
// change (debug-default -> x86_64, T041) is a declared optimization input; resources match on the
// configured values, never on boot-to-boot observed RAM jitter. Each relaxed field is reported as a
// row note, and unknown values still make the row incompatible.
const debugAbis = ['debug-default', 'x86_64'];
function cohort(run, a) {
  const build = a.build ?? run.build;
  const fixtures = {counts: run.fixtureSet.counts, logicalBytes: run.fixtureSet.logicalBytes};
  const {observedRamKiB, ...resources} = a.resources;
  return {host: run.host, workload: run.workloadFingerprint, fixtures,
    api: a.api, image: a.image, profile: {...a.profile, requested: undefined, fallback: undefined},
    resources, animations: a.animations,
    build: {abi: debugAbis.includes(build.abi) ? 'debug' : build.abi,
      cachePolicy: build.cachePolicy, cacheState: build.cacheState}};
}
function cohortNotes(entries) {
  const differs = value => new Set(entries.map(e => JSON.stringify(value(e)))).size > 1;
  const notes = [];
  if (differs(e => e.run.fixtureSet.fingerprint)) { notes.push('fixture-script-fingerprint-changed'); }
  if (differs(e => (e.a.build ?? e.run.build).abi)) { notes.push('build-abi-changed'); }
  if (differs(e => e.a.resources.observedRamKiB)) { notes.push('observed-ram-differs'); }
  return notes;
}
function known(value) {
  if (value === null || value === 'unknown' || value === false) { return false; }
  if (typeof value === 'object') { return Object.values(value).every(known); }
  return true;
}
const median = values => [...values].sort((a, b) => a - b)[1];
export function compareRuns(before, after) {
  before = before.map(validateRun); after = after.map(validateRun);
  const rows = [];
  for (const api of [31, 36]) {
    for (const scenarioId of scenarios) {
      const entries = side => side.flatMap(run => run.apiRuns.filter(a => a.api === api)
        .map(a => ({run, a, samples: a.samples.filter(s => s.scenarioId === scenarioId)})))
        .filter(e => e.samples.length);
      const b = entries(before), a = entries(after);
      const row = {api, scenarioId, status: 'missing', reasons: [],
        beforeSampleIds: b.flatMap(e => e.samples.map(s => s.sampleId)),
        afterSampleIds: a.flatMap(e => e.samples.map(s => s.sampleId)),
        beforeMedianMs: null, afterMedianMs: null, elapsedChangeMs: null,
        elapsedChangePercent: null, improvementPercent: null, notes: []};
      if (!b.length || !a.length) { row.reasons.push('missing-samples'); }
      else {
        const all = [...b, ...a], reference = cohort(b[0].run, b[0].a);
        const lifecycleFailed = all.some(e => e.run.status !== 'passed' || e.run.failureCode ||
          e.a.status !== 'passed' || e.run.fixtureSet.restoration !== 'passed' ||
          [...e.run.sharedPhases, ...e.a.phases].some(p => p.status !== 'passed') ||
          e.a.acceptance.some(c => ['failed', 'missing'].includes(c.status)));
        // Source/APK legitimately change; actual renderer/settings do not.
        if (lifecycleFailed) {
          row.status = 'incomplete'; row.reasons.push('failed-or-incomplete-lifecycle');
        } else if (all.some(e => !known(cohort(e.run, e.a)) || !e.a.profile.verified ||
            !known(e.a.resources.observedRamKiB) || !known(e.run.fixtureSet.fingerprint) ||
            !(e.a.build ?? e.run.build).apkDigest ||
            ['node', 'maestro', 'emulator', 'adb', 'docker', 'compose', 'java', 'pnpm']
              .some(tool => !e.run.host.tools[tool]) ||
            JSON.stringify(canonical(cohort(e.run, e.a))) !== JSON.stringify(canonical(reference)))) {
          row.status = 'incompatible'; row.reasons.push('cohort-mismatch-or-unknown-metadata');
        } else {
          const bs = b.flatMap(e => e.samples), as = a.flatMap(e => e.samples);
          const complete = list => list.length === 3 && [1, 2, 3].every(r =>
            list.filter(s => s.repetition === r && s.status === 'passed').length === 1);
          if (!complete(bs) || !complete(as)) {
            row.status = 'incomplete'; row.reasons.push('three-original-successful-samples-required');
          } else {
            row.status = 'matched';
            row.notes = cohortNotes(all);
            row.beforeMedianMs = median(bs.map(s => s.elapsedMs));
            row.afterMedianMs = median(as.map(s => s.elapsedMs));
            row.elapsedChangeMs = row.afterMedianMs - row.beforeMedianMs;
            if (row.beforeMedianMs === 0) { row.reasons.push('zero-baseline'); }
            else {
              row.elapsedChangePercent = row.elapsedChangeMs / row.beforeMedianMs * 100;
              row.improvementPercent = -row.elapsedChangePercent;
            }
          }
        }
      }
      rows.push(row);
    }
  }
  return {schemaVersion: 1, complete: rows.every(r => r.status === 'matched'), rows};
}

const types = {
  // Getter/JSON names verified against the installed pinned 2.10.0 models.
  tapOnElement: 'action', tapOnPoint: 'action', tapOnPointV2Command: 'action',
  swipeCommand: 'action', scrollCommand: 'action', scrollUntilVisible: 'action',
  inputTextCommand: 'input', inputRandomTextCommand: 'input', eraseTextCommand: 'input', hideKeyboardCommand: 'input',
  assertConditionCommand: 'assertion', assertCommand: 'assertion', assertScreenshotCommand: 'assertion',
  assertDarkModeCommand: 'assertion', assertLightModeCommand: 'assertion',
  waitForAnimationToEndCommand: 'wait',
  launchAppCommand: 'navigation', stopAppCommand: 'navigation', clearStateCommand: 'navigation',
  killAppCommand: 'navigation', clearKeychainCommand: 'navigation', setPermissionsCommand: 'navigation',
  openLinkCommand: 'navigation', pressKeyCommand: 'navigation', backPressCommand: 'navigation',
  runScriptCommand: 'script', evalScriptCommand: 'script', takeScreenshotCommand: 'other',
  defineVariablesCommand: 'script', applyConfigurationCommand: 'other',
  runFlowCommand: 'wrapper', repeatCommand: 'wrapper', retryCommand: 'wrapper',
  setLocationCommand: 'other', copyTextCommand: 'other', pasteTextCommand: 'input',
  setClipboardCommand: 'other', setOrientationCommand: 'other', travelCommand: 'other',
  startRecordingCommand: 'other', stopRecordingCommand: 'other', addMediaCommand: 'other',
  setAirplaneModeCommand: 'other', toggleAirplaneModeCommand: 'other',
  setDarkModeCommand: 'other', toggleDarkModeCommand: 'other',
};
export function ingestCommands(records) {
  if (!Array.isArray(records) || !records.length) { invalid('unsupported-artifact'); }
  const executed = [], assertions = {executed: 0, failed: 0, missing: 0};
  const sequences = new Set(), started = [];
  for (const record of records) {
    const command = record?.command, m = record?.metadata;
    if (!command || !m) { invalid('unsupported-artifact'); }
    const keys = Object.keys(command).filter(key => key !== 'sourceInfo');
    if (keys.length !== 1) { invalid('unsupported-artifact'); }
    const type = keys[0], category = types[type];
    if (!category || !['COMPLETED', 'FAILED', 'WARNED', 'SKIPPED', 'RUNNING', 'PENDING'].includes(m.status) ||
        !Number.isInteger(m.sequenceNumber) || m.sequenceNumber < 0 ||
        !Number.isInteger(m.depth) || m.depth < 0 || sequences.has(m.sequenceNumber)) { invalid('unsupported-artifact'); }
    sequences.add(m.sequenceNumber); started.push({sequence: m.sequenceNumber, depth: m.depth});
    if (['SKIPPED', 'PENDING'].includes(m.status)) {
      if (category === 'assertion' && command[type]?.optional !== true) { assertions.missing++; }
      continue;
    }
    const start = typeof m.timestamp === 'string' ? Date.parse(m.timestamp) : m.timestamp;
    const duration = m.status === 'RUNNING' && m.duration == null ? 0 : m.duration;
    if (!Number.isFinite(start) || !Number.isFinite(duration) || duration < 0) { invalid('unsupported-artifact'); }
    const optionalWarning = m.status === 'WARNED' && command[type]?.optional === true;
    const status = m.status === 'COMPLETED' || optionalWarning ? 'passed' :
      ['FAILED', 'WARNED'].includes(m.status) ? 'failed' : 'interrupted';
    executed.push({type, category, start, end: start + duration, depth: m.depth,
      elapsedMs: duration, status, sequence: m.sequenceNumber, completed: m.status === 'COMPLETED',
      identity: JSON.stringify(command), mandatory: command[type]?.optional !== true, failedRaw: m.status === 'FAILED'});
  }
  // Pinned 2.10.0 records every retry attempt. A non-optional FAILED leaf is
  // recovered only inside a COMPLETED retryCommand (by sequence range and time
  // span) when a later attempt of the identical command completed in it. Its
  // time is still charged; anything else keeps failing.
  const retries = executed.filter(item => item.type === 'retryCommand' && item.completed).map(retry => ({...retry,
    limit: Math.min(Infinity, ...started.filter(s => s.sequence > retry.sequence && s.depth <= retry.depth)
      .map(s => s.sequence))}));
  const within = (retry, item) => item.sequence > retry.sequence && item.sequence < retry.limit &&
    item.start >= retry.start && item.end <= retry.end;
  for (const item of executed) {
    if (item.category !== 'wrapper' && item.failedRaw && item.mandatory && retries.some(retry => within(retry, item) &&
        executed.some(later => later.sequence > item.sequence && later.completed &&
          later.identity === item.identity && within(retry, later)))) {
      item.status = 'passed'; item.recovered = true;
    }
    if (item.category === 'assertion' && item.mandatory && !item.recovered) {
      assertions[item.status === 'passed' ? 'executed' : 'failed']++;
    }
  }
  const commands = [];
  const leaves = executed.filter(item => item.category !== 'wrapper').sort((a, b) => a.sequence - b.sequence);
  for (const [index, item] of leaves.entries()) {
    // Wrappers/embedded definitions are not another executed list.
    // Pinned Maestro timestamps/durations are independently quantized to
    // milliseconds. One general rounding rule: any two completed leaves may
    // overlap by at most 1 ms, whatever their depth, adjacency or the records
    // between them. Time already charged to earlier leaves is charged once
    // (the union of the shared intervals is removed). Any overlap above 1 ms,
    // fractional timing, or an overlap involving a failed, warned or running
    // leaf is a real conflict and fails the artifact.
    const shared = [];
    for (const previous of leaves.slice(0, index)) {
      if (previous.start >= item.end || item.start >= previous.end) { continue; }
      const from = Math.max(previous.start, item.start), to = Math.min(previous.end, item.end);
      if (!previous.completed || !item.completed ||
          ![previous.start, previous.end, item.start, item.end].every(Number.isInteger) || to - from > 1) {
        invalid('unsupported-artifact-overlap');
      }
      shared.push([from, to]);
    }
    let covered = 0, reach = -Infinity;
    for (const [from, to] of shared.sort((a, b) => a[0] - b[0])) {
      if (to > reach) { covered += to - Math.max(from, reach); reach = to; }
    }
    item.elapsedMs -= covered;
    let total = commands.find(c => c.category === item.category && c.status === item.status);
    if (!total) { total = {category: item.category, count: 0, elapsedMs: 0, status: item.status}; commands.push(total); }
    total.count++; total.elapsedMs += item.elapsedMs;
  }
  return {commands, assertions};
}

function markdown(run) {
  const phaseRows = [
    ...run.sharedPhases.map(p => ({scope: 'shared', ...p})),
    ...run.apiRuns.flatMap(a => a.phases.map(p => ({scope: a.api, ...p}))),
  ];
  return `# Validation performance\n\nInvocation: ${run.invocationId}\nMode: ${run.mode}\n` +
    `Status: ${run.status}\nElapsed: ${run.elapsedMs} ms\n\n` +
    `Source input: ${run.source.inputFingerprint}\nHost: ${run.host.id}\n` +
    `Workload: ${run.workloadFingerprint}\nAPK: ${run.build.apkDigest ?? 'unknown'}\n\n` +
    '| API | Requested graphics | Actual CPU / graphics | Verified | RAM requested MiB / observed KiB |\n| --- | --- | --- | --- | --- |\n' +
    run.apiRuns.map(a => `| ${a.api} | ${a.profile.requested} | ${a.profile.cpu} / ${a.profile.graphics} | ${a.profile.verified} | ` +
      `${a.resources.requestedRamMiB ?? 'unknown'} / ${a.resources.observedRamKiB ?? 'unknown'} |`).join('\n') +
    '\n\n| Scope | Phase | Status | Elapsed ms |\n| --- | --- | --- | --- |\n' +
    phaseRows.map(p => `| ${p.scope} | ${p.phase} | ${p.status} | ${p.elapsedMs} |`).join('\n') + '\n\n' +
    '| API | Subject | Repetition | Status | Elapsed ms |\n| --- | --- | --- | --- | --- |\n' +
    run.apiRuns.flatMap(a => a.samples.map(s =>
      `| ${a.api} | ${s.scenarioId} | ${s.repetition} | ${s.status} | ${s.elapsedMs} |`)).join('\n') +
    (run.serviceRestarts ? '\n\n| Service | Container restarts | Restart events |\n| --- | --- | --- |\n' +
      run.serviceRestarts.map(r => `| ${r.protocol} | ${r.restarts} | ` +
        `${r.events.map(e => `${e.action} ${new Date(e.unixMs).toISOString()}`).join(', ') || 'none'} |`).join('\n') : '') +
    '\n\nPhase durations are disjoint; samples are nonadditive phase diagnostics. ' +
    'Command costs exclude inclusive wrappers; they are not app profiles. ' +
    'Unknown metadata prevents a matched comparison. Renderer ranking is not implemented in this foundation.\n';
}
export async function writeReport(directory, run) {
  run = validateRun(run);
  await mkdir(directory, {recursive: true, mode: 0o700});
  await writeFile(join(directory, 'run.json'), `${JSON.stringify(run, null, 2)}\n`, {flag: 'wx', mode: 0o600});
  await writeFile(join(directory, 'report.md'), markdown(run), {flag: 'wx', mode: 0o600});
}

async function bytes(path) { try { return await readFile(path); } catch { return Buffer.alloc(0); } }
async function fingerprint(repository) {
  const git = spawnSync('git', ['-C', repository, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], {encoding: 'utf8'});
  const paths = git.status === 0 ? [...new Set(git.stdout.split('\0'))].filter(p =>
    /^(src\/|android\/|validation\/(?:maestro|services)\/|scripts\/validation\/|App\.tsx$|index\.js$|package\.json$|pnpm-lock\.yaml$|babel\.config\.js$|metro\.config\.js$)/.test(p)) :
    ['package.json', ...(await walk(join(repository, 'validation/maestro'))).map(p => p.slice(repository.length + 1))];
  const h = createHash('sha256');
  for (const path of paths.sort()) { h.update(path).update('\0').update(createHash('sha256').update(await bytes(join(repository, path))).digest()); }
  return h.digest('hex');
}
async function walk(directory) {
  const result = [];
  for (const entry of await readdir(directory, {withFileTypes: true}).catch(() => [])) {
    if (entry.isSymbolicLink()) { invalid('unsupported-artifact-symlink'); }
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { result.push(...await walk(path)); } else { result.push(path); }
  }
  return result.sort();
}
async function logicalBytes(directory) {
  let total = 0;
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { total += await logicalBytes(path); }
    else if (entry.isFile()) { total += (await lstat(path)).size; }
  }
  return total;
}

async function effectiveAnimationScales(directory, sdk, serial) {
  const scratch = await mkdtemp(join(directory, 'animation-probe-'));
  const guest = `/data/local/tmp/syncscope-animation-${randomBytes(12).toString('hex')}.jar`;
  const adb = join(sdk, 'platform-tools/adb');
  const execute = (command, args) => {
    const p = spawnSync(command, args, {encoding: 'utf8', timeout: 30000});
    if (p.status !== 0) { invalid('unknown-animation-metadata'); }
    return p.stdout.trim();
  };
  try {
    const source = fileURLToPath(new URL('./SyncScopeAnimationScales.java', import.meta.url));
    execute(process.env.JAVA_HOME ? join(process.env.JAVA_HOME, 'bin/javac') : 'javac',
      ['--release', '8', '-d', scratch, source]);
    const jar = join(scratch, 'probe.jar');
    execute(join(sdk, 'build-tools/37.0.0/d8'),
      ['--min-api', '31', '--output', jar, join(scratch, 'SyncScopeAnimationScales.class')]);
    execute(adb, ['-s', serial, 'push', jar, guest]);
    const values = execute(adb, ['-s', serial, 'shell',
      `trap 'rm -f ${guest}' EXIT HUP INT TERM; CLASSPATH=${guest} app_process / SyncScopeAnimationScales`]).split(/\s+/);
    if (values.length !== 3 || values.some(v =>
      !/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v) || !Number.isFinite(Number(v)))) {
      invalid('unknown-animation-metadata');
    }
    return Object.fromEntries(['window', 'transition', 'animator'].map((key, i) => [key, Number(values[i])]));
  } finally {
    // Only this uniquely named observational artifact is ever removed.
    const cleanup = spawnSync(adb, ['-s', serial, 'shell', 'rm', '-f', guest], {encoding: 'utf8', timeout: 10000});
    await rm(scratch, {recursive: true, force: true});
    if (cleanup.status !== 0) { invalid('unknown-animation-metadata'); }
  }
}
async function clock() {
  if (process.env.SYNCSCOPE_CLOCK_BIN) {
    const value = spawnSync(process.env.SYNCSCOPE_CLOCK_BIN, [], {encoding: 'utf8'});
    if (value.status !== 0 || !/^\d+\s*$/.test(value.stdout)) { invalid('invalid-clock'); }
    return value.stdout.trim();
  }
  return process.hrtime.bigint().toString();
}
function parsedVersion(output) {
  return output.match(/\b(\d+\.\d+(?:\.\d+){0,2}(?:-\d+)?)\b/)?.[1] ?? null;
}
function toolVersion(command, args) {
  const p = spawnSync(command, args, {encoding: 'utf8', timeout: 5000});
  return parsedVersion(`${p.stdout ?? ''}\n${p.stderr ?? ''}`);
}
async function initialRun(repository, mode, apis, requested) {
  const manifest = JSON.parse(await readFile(join(repository, 'validation/performance/hotspots.json'), 'utf8'));
  const revision = spawnSync('git', ['-C', repository, 'rev-parse', 'HEAD'], {encoding: 'utf8'}).stdout?.trim() ?? '';
  const hostId = await bytes('/etc/machine-id');
  const power = await bytes('/sys/devices/system/cpu/cpu0/cpufreq/scaling_governor');
  const driver = await bytes('/sys/module/i915/version');
  const invocationId = `inv-${randomBytes(12).toString('hex')}`;
  const tools = {node: process.versions.node,
    maestro: toolVersion(process.env.SYNCSCOPE_MAESTRO_BIN || join(process.env.HOME, '.cache/cloud-sync-checker-toolchain/maestro-2.10.0/maestro/bin/maestro'), ['--version']),
    emulator: toolVersion(join(process.env.ANDROID_HOME, 'emulator/emulator'), ['-version']),
    adb: toolVersion(join(process.env.ANDROID_HOME, 'platform-tools/adb'), ['version']),
    docker: toolVersion('docker', ['version', '--format', '{{.Server.Version}}']),
    compose: toolVersion('docker', ['compose', 'version', '--short']),
    java: toolVersion('java', ['-version']), pnpm: toolVersion('pnpm', ['--version'])};
  // Device/render strings never enter publication verbatim: identities are digests.
  const run = {schemaVersion: 1, invocationId, mode, status: 'running', failureCode: null,
    source: {revision: /^[a-f0-9]{40}$/.test(revision) ? revision : null, inputFingerprint: await fingerprint(repository)},
    host: {id: hash(hostId.length ? hostId : `${platform()}:${cpus()[0]?.model}`),
      os: 'linux', kernel: parsedVersion(release()), cpu: hash(JSON.stringify(cpus().map(c => c.model))),
      tools, power: power.length ? hash(power) : null},
    workloadFingerprint: manifest.definitionFingerprint,
    // e2e/measure build one emulator-only x86_64 debug APK (T041); connected
    // builds keep their default ABIs.
    build: {apkDigest: null, abi: mode === 'connected' ? 'instrumented' : 'x86_64',
      cachePolicy: 'no-daemon', cacheState: 'unknown', tasks: 'unknown'},
    fixtureSet: {fingerprint: hash(JSON.stringify(manifest.fixtureParameters) +
      (await Promise.all(manifest.fixtureAuthorities.map(p => bytes(join(repository, p))))).map(b => hash(b)).join('')),
      counts: {bulkFiles: manifest.fixtureParameters.bulkFiles, galleryBulkFiles: manifest.fixtureParameters.galleryBulkFiles,
        scrollFiles: manifest.fixtureParameters.scrollFiles}, logicalBytes: null, restoration: 'unknown'},
    sharedPhases: [], elapsedMs: 0,
    apiRuns: apis.map(api => ({runId: `api-${api}`, invocationId, api, image: null, status: 'running',
      profile: {fingerprint: null, requested, cpu: 'unknown', graphics: 'unknown', backend: null,
        renderer: null, driver: driver.length ? hash(driver) : hash(release()), verified: false, fallback: false},
      resources: {requestedRamMiB: 2048, observedRamKiB: null, cpus: null, width: null, height: null, density: null},
      animations: {window: null, transition: null, animator: null}, phases: [], samples: [], acceptance: []}))};
  return validateRun(run);
}
async function state(directory) { return JSON.parse(await readFile(join(directory, 'record.private.json'), 'utf8')); }
async function save(directory, run) {
  validateRun(run);
  await writeFile(join(directory, 'record.private.json'), JSON.stringify(run), {mode: 0o600});
}
async function artifact(directory, minimum = 1) {
  const files = (await walk(directory)).filter(path => /^commands(?:-.*)?\.json$/.test(basename(path)));
  if (!Number.isInteger(minimum) || minimum < 1 || files.length < minimum) { invalid('missing-artifact'); }
  const result = {commands: [], assertions: {executed: 0, failed: 0, missing: 0}};
  for (const path of files) {
    let records;
    try { records = JSON.parse(await readFile(path, 'utf8')); } catch { invalid('unsupported-artifact'); }
    const ingested = ingestCommands(records);
    // Each expected flow needs its own mandatory proof. Assertions from a
    // different workspace artifact cannot fill an assertion-free flow.
    if (!ingested.assertions.executed && !ingested.assertions.failed) { invalid('missing-artifact'); }
    result.commands.push(...ingested.commands);
    for (const key of Object.keys(result.assertions)) { result.assertions[key] += ingested.assertions[key]; }
  }
  if (!result.assertions.executed && !result.assertions.failed) { invalid('missing-artifact'); }
  return result;
}


// ---- Feature 008 US2: verified acceleration attempts, calibration and ranking.
// Validator state keeps full private attempt records; publication copies only
// allowlisted ids, states, known reasons and backend names.
function hostRoot() {
  const root = process.env.SYNCSCOPE_HOST_ROOT;
  if (!root) { return null; }
  if (!/^\/tmp\/cloud-sync-checker-[A-Za-z0-9._-]+\/host$/.test(root)) { invalid('invalid-host-root'); }
  return root;
}
async function acceleratorState(stateDir) {
  return JSON.parse(await readFile(join(stateDir, 'acceleration.private.json'), 'utf8'));
}
async function saveAccelerator(stateDir, record) {
  await writeFile(join(stateDir, 'acceleration.private.json'), JSON.stringify(record), {mode: 0o600});
}
function publishedCandidates(record) {
  return record.discovery.candidates.map(c => ({candidateId: c.candidateId, kind: c.kind, vendor: c.vendor,
    status: c.status, reason: c.reason, deviceId: c.deviceId, driver: c.driver}));
}
function publishedAttempts(record) {
  return record.attempts.filter(a => a.state !== 'discovered').map(a => ({candidateId: a.candidateId,
    request: a.request, state: a.state, reason: a.reason, backend: a.verification?.backend ?? null,
    vulkan: a.verification?.vulkan ?? 'unknown'}));
}
const legacySelection = {status: 'legacy', selectedCandidateId: 'legacy-swiftshader-indirect',
  rankingFingerprint: null, order: [], tradeoffs: [], tie: false};
function rankingStorePath(directory) { return join(dirname(resolve(directory)), 'acceleration-ranking.json'); }
async function rankingStore(directory) {
  try {
    const store = JSON.parse(await readFile(rankingStorePath(directory), 'utf8'));
    return store?.schemaVersion === 1 && store.apis && typeof store.apis === 'object' ? store : null;
  } catch { return null; }
}
// Candidate-independent identities only: the selected route's own render node
// is cohort identity, not a ranking input.
function rankingRuntime(run, a, candidates) {
  return {api: a.api, image: a.image,
    tools: {emulator: run.host.tools.emulator ?? null, adb: run.host.tools.adb ?? null, maestro: run.host.tools.maestro ?? null},
    drivers: hash(JSON.stringify([run.host.kernel, candidates.map(c => [c.candidateId, c.status, c.driver, c.deviceId])])),
    candidates, hostPower: run.host.power, hostResources: run.host.cpu,
    guestResources: {requestedRamMiB: a.resources.requestedRamMiB, cpus: a.resources.cpus,
      width: a.resources.width, height: a.resources.height, density: a.resources.density},
    fixtures: run.fixtureSet.fingerprint, animations: a.animations};
}
// Image, guest resources and animation scales are observed only after boot.
const POST_BOOT_INPUTS = ['image', 'guestResources', 'animations'];
async function calibrationState(directory) {
  try { return JSON.parse(await readFile(join(directory, 'calibration.private.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') { return {active: null, candidates: {}}; } throw error; }
}
async function saveCalibration(directory, value) {
  await writeFile(join(directory, 'calibration.private.json'), JSON.stringify(value), {mode: 0o600});
}
function ensureAcceleration(a) {
  a.acceleration ??= {requestedProfile: 'auto', kvm: {usable: false, reason: 'kvm-unavailable'}, candidates: [],
    attempts: [], fallback: false, selection: null, calibration: []};
  return a.acceleration;
}
async function latestRetained(directory, api) {
  const names = (await readdir(join(directory, 'raw')).catch(() => []))
    .map(name => name.match(new RegExp(`^validator-${api}(?:-(\\d+))?$`))).filter(Boolean)
    .sort((x, y) => Number(x[1] ?? 1) - Number(y[1] ?? 1));
  return names.length ? join(directory, 'raw', names.at(-1)[0]) : null;
}

async function main(args) {
  const [command, ...rest] = args;
  if (command === 'clock') { console.log(await clock()); return; }
  if (command === 'init') {
    const [repository, base, mode, requested, ...apiArgs] = rest;
    const run = await initialRun(repository, mode, apiArgs.map(Number), requested);
    const directory = join(resolve(base), run.invocationId);
    await mkdir(directory, {mode: 0o700, recursive: true});
    await chmod(directory, 0o700); await mkdir(join(directory, 'raw'), {mode: 0o700});
    await save(directory, run);
    await writeFile(join(directory, 'start.private'), await clock(), {flag: 'wx', mode: 0o600});
    console.log(directory); return;
  }
  if (command === 'schedule') {
    const [repository] = rest;
    const m = JSON.parse(await readFile(join(repository, 'validation/performance/hotspots.json'), 'utf8'));
    const {definitionFingerprint, ...definition} = m;
    if (hash(JSON.stringify(canonical(definition))) !== definitionFingerprint) { invalid('invalid-frozen-workload'); }
    if (m.schemaVersion !== 1 || m.repetitions !== 3 || JSON.stringify(m.apis) !== '[31,36]' ||
        m.scenarios.length !== 8 || m.scenarios.some((s, i) => s.scenarioId !== scenarios[i] ||
          !/^validation\/maestro\/[a-z0-9/-]+\.yaml$/.test(s.flow))) { invalid('invalid-frozen-workload'); }
    for (const s of m.scenarios) {
      for (const r of [1, 2, 3]) { console.log(`${s.scenarioId}|${r}|${s.flow.slice('validation/maestro/'.length)}`); }
    }
    return;
  }
  if (command === 'workspace-count') {
    const config = await readFile(join(rest[0], 'validation/maestro/config.yaml'), 'utf8');
    const count = [...config.matchAll(/^    - [a-z0-9/-]+$/gm)].length;
    if (count < 39) { invalid('invalid-workspace-inventory'); }
    console.log(count); return;
  }
  if (command === 'require-original-software') {
    const run = await state(rest[0]), a = run.apiRuns.find(r => r.api === Number(rest[1]));
    if (!a?.profile.verified || a.profile.cpu !== 'kvm' || a.profile.graphics !== 'software' ||
        !a.image || Object.values(a.resources).some(v => v === null) ||
        Object.values(a.animations).some(v => v === null)) {
      invalid('unknown-original-software-mode');
    }
    return;
  }
  if (command === 'segment') {
    const [directory, api, phase, startNs, endNs, exit] = rest;
    const run = await state(directory);
    const p = {segmentId: `seg-${randomBytes(8).toString('hex')}`, phase, startNs, endNs,
      elapsedMs: elapsedMilliseconds(startNs, endNs), status: exit === '0' ? 'passed' : exit === '130' ? 'interrupted' : 'failed'};
    validatePhase(p);
    const target = api === 'shared' ? run.sharedPhases : run.apiRuns.find(a => a.api === Number(api))?.phases;
    if (!target) { invalid(); } target.push(p); await save(directory, run); return;
  }
  if (command === 'build') {
    const [directory, apk, log, api = 'shared'] = rest;
    const run = await state(directory), data = await bytes(apk), output = (await bytes(log)).toString();
    run.build.apkDigest = data.length ? hash(data) : null;
    const tasks = output.split('\n').filter(line => /^> Task :/.test(line));
    if (tasks.length) {
      const cached = tasks.filter(line => /UP-TO-DATE|FROM-CACHE/.test(line)).length;
      run.build.tasks = cached === 0 ? 'executed' : cached === tasks.length ? 'cached' : 'mixed';
      run.build.cacheState = cached === 0 ? 'cold' : cached === tasks.length ? 'warm' : 'mixed';
    }
    if (api === 'shared') { for (const a of run.apiRuns) { a.build = structuredClone(run.build); } }
    else {
      const a = run.apiRuns.find(r => r.api === Number(api));
      if (!a) { invalid(); } a.build = structuredClone(run.build);
    }
    await save(directory, run); return;
  }
  if (command === 'fixtures') {
    const [directory, root, sdk, serial] = rest;
    const run = await state(directory);
    const p = spawnSync(join(sdk, 'platform-tools/adb'), ['-s', serial, 'shell',
      `volume=$(sm list-volumes public | awk '$2 == "mounted" {print $3; exit}'); ` +
      `[ -n "$volume" ] || exit 1; find /sdcard/SyncScopeE2E /sdcard/DCIM/Big ` +
      `"/storage/$volume/SyncScopeE2E" -type f -exec stat -c %s {} +`],
    {encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024});
    const values = p.stdout?.trim().split(/\s+/) ?? [];
    if (p.status !== 0 || !values.length || !values.every(v => /^\d+$/.test(v) && Number.isSafeInteger(Number(v)))) {
      invalid('unknown-fixture-metadata');
    }
    run.fixtureSet.logicalBytes = await logicalBytes(root) + values.reduce((sum, v) => sum + Number(v), 0);
    if (!Number.isSafeInteger(run.fixtureSet.logicalBytes)) { invalid('unknown-fixture-metadata'); }
    await save(directory, run); return;
  }
  if (command === 'device') {
    const [directory, api, metadataFile, accelerationFile] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    const m = JSON.parse(await readFile(metadataFile, 'utf8'));
    if (accelerationFile) {
      const record = JSON.parse(await readFile(accelerationFile, 'utf8'));
      const attempts = publishedAttempts(record);
      const chosen = attempts.findIndex(x => x.state === 'selected');
      const previous = a.acceleration;
      a.acceleration = {requestedProfile: record.requestedProfile, kvm: record.discovery.kvm,
        candidates: publishedCandidates(record), attempts, fallback: chosen > 0,
        selection: record.requestedProfile === 'legacy' ? {...legacySelection} : previous?.selection ?? null,
        calibration: previous?.calibration ?? []};
      a.profile.fallback = chosen > 0;
    }
    object(m, ['image', 'cpu', 'graphics', 'backend', 'renderer', 'driver', 'resources', 'animations', 'verified']);
    a.image = m.image; Object.assign(a.profile, {cpu: m.cpu, graphics: m.graphics,
      backend: m.backend, renderer: m.renderer, driver: m.driver, verified: m.verified});
    a.profile.fingerprint = hash(JSON.stringify({image: a.image, cpu: m.cpu,
      graphics: m.graphics, backend: m.backend, renderer: m.renderer, driver: m.driver}));
    a.resources = m.resources; a.animations = m.animations;
    await save(directory, run); return;
  }
  if (command === 'acceleration-plan') {
    const [stateDir, sdk, api, profile, preferred, pin] = rest;
    const root = hostRoot();
    const discovery = await discoverHost(sdk, root ? {sysfsRoot: join(root, 'sys'), devRoot: join(root, 'dev')} : {});
    const plan = planAttempts(discovery, profile, {preferred: preferred === '-' ? null : preferred, pin: pin === '1'});
    await saveAccelerator(stateDir, {schemaVersion: 1, api: Number(api), requestedProfile: profile,
      discovery: {kvm: discovery.kvm, candidates: discovery.candidates}, attempts: plan.attempts, error: plan.error});
    if (plan.error) {
      const messages = {
        'kvm-unavailable': `KVM is not usable for API ${api}; no candidate meets the x86_64 KVM CPU profile. ` +
          'Make /dev/kvm usable for this user; the validator never changes host security, power or driver settings.',
        'no-candidates': `No supported emulator graphics mode is advertised for API ${api}.`,
        'unknown-candidate': `The requested graphics candidate is not discovered for API ${api}.`,
        'invalid-profile': 'Unsupported graphics profile.'};
      console.error(messages[plan.error]);
      process.exitCode = plan.error === 'kvm-unavailable' || plan.error === 'no-candidates' ? 1 : 64;
      return;
    }
    console.log(plan.attempts.map(a => a.candidateId).join('\n')); return;
  }
  if (command === 'acceleration-launch') {
    const [stateDir, candidateId] = rest;
    const record = await acceleratorState(stateDir);
    const i = record.attempts.findIndex(a => a.candidateId === candidateId);
    if (i < 0) { invalid('unknown-candidate'); }
    record.attempts[i] = advance(record.attempts[i], 'claimed');
    await saveAccelerator(stateDir, record);
    const spec = launchSpec(record.attempts[i]);
    console.log([spec.args.join(' '), ...spec.env].join('\n')); return;
  }
  if (command === 'acceleration-attempt') {
    const [stateDir, candidateId, action, reason] = rest;
    const record = await acceleratorState(stateDir);
    const i = record.attempts.findIndex(a => a.candidateId === candidateId);
    if (i < 0) { invalid('unknown-candidate'); }
    let attempt = record.attempts[i];
    if (action === 'starting' || action === 'ready') { attempt = advance(attempt, action); }
    else if (action === 'fail') {
      attempt = advance(attempt, attempt.state === 'ready' ? 'verification-failed' : 'boot-failed', reason);
    } else if (action === 'verify') {
      const v = attempt.verification;
      attempt = v?.verified ? advance(attempt, 'verified') :
        advance(attempt, 'verification-failed', v?.reason ?? 'renderer-unknown');
      // The original legacy request records its outcome but keeps its original
      // non-gating behavior; measurement mode applies the actual-mode gate.
      if (!v?.verified && record.requestedProfile !== 'legacy') { process.exitCode = 1; }
    } else if (action === 'select') {
      if (attempt.state === 'verified') { attempt = advance(attempt, 'selected'); }
      else if (record.requestedProfile !== 'legacy') { invalid('invalid-attempt-transition'); }
    } else { invalid('invalid-cli'); }
    record.attempts[i] = attempt;
    await saveAccelerator(stateDir, record); return;
  }
  if (command === 'acceleration-exhausted') {
    const [stateDir, api] = rest;
    const record = await acceleratorState(stateDir);
    const tried = record.attempts.filter(a => a.state !== 'discovered').map(a => `${a.candidateId}: ${a.reason ?? a.state}`);
    console.error(`No graphics candidate worked for API ${api} (${tried.join('; ') || 'none attempted'}). ` +
      'Sanitized attempt records are retained with the validator diagnostics.');
    return;
  }
  if (command === 'selection') {
    const [directory, api, repository] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    if (!a?.acceleration || a.acceleration.requestedProfile === 'legacy') { return; }
    const selected = a.acceleration.attempts.find(x => x.state === 'selected')?.candidateId ?? null;
    const fingerprint = rankingFingerprint(await collectRankingInputs(repository,
      rankingRuntime(run, a, a.acceleration.candidates)));
    a.acceleration.selection = selectionStatus(await rankingStore(directory), a.api, fingerprint, selected);
    await save(directory, run); return;
  }
  if (command === 'ranking-preference') {
    const [directory, api] = rest;
    const id = (await rankingStore(directory))?.apis?.[api]?.selectedCandidateId;
    console.log(typeof id === 'string' && /^(?:host-(?:intel|nvidia)-[1-9]|software-[a-z]+)$/.test(id) ? id : '-'); return;
  }
  if (command === 'calibration-plan') {
    // Prints the candidates to calibrate, or nothing when a ranking for the
    // current pre-boot inputs exists (post-boot inputs are rechecked later).
    const [directory, repository, api, sdk] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    const root = hostRoot();
    const discovery = await discoverHost(sdk, root ? {sysfsRoot: join(root, 'sys'), devRoot: join(root, 'dev')} : {});
    if (!discovery.kvm.usable) { return; }
    const candidates = discovery.candidates.map(c => ({candidateId: c.candidateId, kind: c.kind, vendor: c.vendor,
      status: c.status, reason: c.reason, deviceId: c.deviceId, driver: c.driver}));
    const current = await collectRankingInputs(repository, rankingRuntime(run, a, candidates));
    const entry = (await rankingStore(directory))?.apis?.[api];
    const matches = entry?.status === 'ranked' && entry.inputs && Object.keys(current)
      .filter(k => !POST_BOOT_INPUTS.includes(k))
      .every(k => JSON.stringify(entry.inputs[k]) === JSON.stringify(current[k]));
    if (matches) { return; }
    const planned = [...discovery.candidates.filter(c => c.kind === 'hardware' && c.status === 'discovered'),
      ...discovery.candidates.filter(c => c.kind === 'software').slice(0, 1)].map(c => c.candidateId);
    if (!planned.length) { return; }
    // One candidate per invocation (decision 2026-10-16): continue the stored
    // calibration round for unchanged pre-boot inputs and candidate set with
    // its first planned candidate that has no result yet; otherwise (changed
    // inputs, or a finished round that did not rank) start a new round.
    const preBoot = Object.fromEntries(Object.entries(current).filter(([k]) => !POST_BOOT_INPUTS.includes(k)));
    const round = (await rankingStore(directory))?.calibrations?.[api];
    const sameRound = !!round && JSON.stringify(round.planned) === JSON.stringify(planned) &&
      JSON.stringify(round.preBootInputs) === JSON.stringify(preBoot);
    const done = new Set(sameRound ? round.results.map(r => r.candidateId) : []);
    const pending = planned.find(id => !done.has(id));
    const c = await calibrationState(directory);
    c.plans = {...c.plans, [api]: {planned, preBootInputs: preBoot, continueRound: sameRound && !!pending}};
    await saveCalibration(directory, c);
    console.log(pending ?? planned[0]); return;
  }
  if (command === 'calibration-begin') {
    const [directory, api, candidateId] = rest;
    const c = await calibrationState(directory);
    c.active = {api: Number(api), candidateId};
    await saveCalibration(directory, c); return;
  }
  if (command === 'calibration-end') {
    const [directory, api, candidateId, outcome, stateDir] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    const c = await calibrationState(directory), acc = ensureAcceleration(a);
    let entry = acc.calibration.find(e => e.candidateId === candidateId);
    if (!entry) {
      entry = {candidateId, status: 'measurement-failed', reason: null, profileFingerprint: null, verified: false, samples: []};
      acc.calibration.push(entry);
    }
    if (outcome === 'boot-failed') {
      const retained = await latestRetained(directory, api);
      const record = retained ? JSON.parse(await readFile(join(retained, 'acceleration.private.json'), 'utf8').catch(() => 'null')) : null;
      const attempt = record?.attempts?.find(x => x.candidateId === candidateId);
      // A preflight/lock failure is not a candidate result: stop calibrating.
      if (!attempt || !['boot-failed', 'verification-failed'].includes(attempt.state)) { invalid('calibration-startup'); }
      Object.assign(entry, {status: 'boot-failed', reason: attempt.reason});
    } else {
      const record = await acceleratorState(stateDir);
      const attempt = record.attempts.find(x => x.candidateId === candidateId);
      const complete = entry.samples.length === 24 && entry.samples.every(x => x.status === 'passed');
      Object.assign(entry, {status: complete ? 'measured' : 'measurement-failed',
        reason: complete ? null : 'measurement-failed', profileFingerprint: a.profile.fingerprint, verified: a.profile.verified});
      c.candidates[`${api}:${candidateId}`] = {kind: attempt.kind, complexity: attempt.complexity,
        profile: a.profile, image: a.image, resources: a.resources, animations: a.animations,
        acceleration: {requestedProfile: acc.requestedProfile, kvm: acc.kvm, candidates: acc.candidates, attempts: acc.attempts}};
    }
    c.active = null;
    await saveCalibration(directory, c); await save(directory, run); return;
  }
  if (command === 'rank') {
    // Ranks a calibration round across invocations. This invocation measured
    // exactly one candidate: its samples are this renderer's cohort, its
    // result joins the per-API round in the shared ranking store, and the API
    // is ranked only once every planned candidate of the round has a result.
    const [directory, api, repository] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    const c = await calibrationState(directory), acc = ensureAcceleration(a);
    const plan = c.plans?.[api];
    if (!plan || acc.calibration.length !== 1 || !plan.planned.includes(acc.calibration[0].candidateId)) {
      invalid('calibration-candidate-count');
    }
    const own = acc.calibration[0];
    const snapshot = c.candidates?.[`${api}:${own.candidateId}`] ?? null;
    let inputs = null, fingerprint = null;
    if (snapshot) {
      Object.assign(a, {profile: {...snapshot.profile, fallback: false}, image: snapshot.image,
        resources: snapshot.resources, animations: snapshot.animations});
      Object.assign(acc, snapshot.acceleration, {fallback: false});
      a.samples = structuredClone(own.samples);
      inputs = await collectRankingInputs(repository, rankingRuntime(run, a, acc.candidates));
      fingerprint = rankingFingerprint(inputs);
    } else {
      a.samples = [];
    }
    const store = (await rankingStore(directory)) ?? {schemaVersion: 1, apis: {}};
    store.calibrations ??= {}; store.calibrationHistory ??= {};
    let round = plan.continueRound ? store.calibrations[api] ?? null : null;
    // Post-boot inputs must match too: a different fingerprint is a new round.
    if (round && fingerprint && round.rankingFingerprint && round.rankingFingerprint !== fingerprint) { round = null; }
    if (!round) {
      // A superseded round is retained beside the new one, never merged.
      if (store.calibrations[api]) { (store.calibrationHistory[api] ??= []).push(store.calibrations[api]); }
      round = {planned: plan.planned, preBootInputs: plan.preBootInputs, rankingFingerprint: null, inputs: null, results: []};
      store.calibrations[api] = round;
    }
    round.rankingFingerprint ??= fingerprint; round.inputs ??= inputs;
    round.results.push({candidateId: own.candidateId, invocationId: run.invocationId, status: own.status,
      reason: own.reason, verified: own.verified, profileFingerprint: own.profileFingerprint,
      kind: snapshot?.kind ?? acc.candidates.find(x => x.candidateId === own.candidateId)?.kind ?? 'software',
      complexity: snapshot?.complexity ?? 0,
      samples: own.samples.map(x => ({sampleId: x.sampleId, scenarioId: x.scenarioId, repetition: x.repetition,
        status: x.status, elapsedMs: x.elapsedMs}))});
    const complete = round.planned.every(id => round.results.some(r => r.candidateId === id));
    const result = rankCandidates(round.results.map(e => ({candidateId: e.candidateId, kind: e.kind,
      complexity: e.complexity, verified: e.status !== 'boot-failed' && e.verified, samples: e.samples})));
    for (const o of result.order) {
      if (round.results.find(e => e.candidateId === o.candidateId)?.status === 'boot-failed') { o.status = 'boot-failed'; }
    }
    // A viable candidate whose measurement failed could be the best one: the
    // calibration is then incomplete and its choice only provisional.
    const incomplete = round.results.some(e => e.status === 'measurement-failed');
    const chosen = complete ? result.selectedCandidateId : null;
    const ranked = complete && !!chosen && !incomplete && result.status === 'ranked';
    if (ranked) {
      store.apis[api] = {status: 'ranked', rankingFingerprint: round.rankingFingerprint, selectedCandidateId: chosen,
        invocationId: run.invocationId, calibrationInvocations: round.results.map(r => r.invocationId), inputs: round.inputs};
    }
    acc.selection = {status: ranked && chosen === own.candidateId ? 'ranked' : 'provisional',
      selectedCandidateId: snapshot ? own.candidateId : null, rankedCandidateId: ranked ? chosen : null,
      rankingFingerprint: fingerprint, order: result.order, tradeoffs: complete ? result.tradeoffs : [],
      tie: complete ? result.tie : false};
    await save(directory, run);
    await writeFile(rankingStorePath(directory), `${JSON.stringify(store, null, 2)}\n`, {mode: 0o600});
    if (complete && !result.selectedCandidateId) {
      console.error(`No graphics candidate completed calibration for API ${api}.`);
      process.exitCode = 1;
    } else if (!snapshot) {
      // The result is recorded, but this invocation measured no baseline.
      console.error(`Graphics candidate ${own.candidateId} did not boot for API ${api}; its calibration result is recorded.`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === 'require-verified') {
    const run = await state(rest[0]), a = run.apiRuns.find(r => r.api === Number(rest[1]));
    if (!a?.profile.verified || a.profile.cpu !== 'kvm' || !['hardware', 'software'].includes(a.profile.graphics) ||
        !a.image || Object.values(a.resources).some(v => v === null) ||
        Object.values(a.animations).some(v => v === null)) {
      invalid('unknown-verified-mode');
    }
    return;
  }
  if (command === 'capture-device') {
    const [destination, sdk, serial, api, avd, stateDir, candidateId] = rest;
    const devRoot = hostRoot() ? join(hostRoot(), 'dev') : '/dev';
    const adb = (...a) => {
      const result = spawnSync(join(sdk, 'platform-tools/adb'), ['-s', serial, ...a],
        {encoding: 'utf8', timeout: 10000});
      return result.status === 0 ? result.stdout?.trim() ?? '' : '';
    };
    const mem = adb('shell', 'cat /proc/meminfo');
    const renderer = adb('shell', 'dumpsys SurfaceFlinger');
    const gles = renderer.split('\n').find(line => /\bGLES:/.test(line)) ?? '';
    const graphics = /swiftshader|llvmpipe|lavapipe/i.test(gles) ? 'software' :
      gles ? 'hardware' : 'unknown';
    const processes = (await bytes(join(dirname(destination), 'processes.private'))).toString().split(/\s+/).filter(Boolean);
    let kvm = false;
    const nodes = new Set();
    for (const pid of processes) {
      if (!/^\d+$/.test(pid)) { continue; }
      for (const file of await readdir(`/proc/${pid}/fd`).catch(() => [])) {
        const {readlink} = await import('node:fs/promises');
        const target = await readlink(`/proc/${pid}/fd/${file}`).catch(() => '');
        if (target === join(devRoot, 'kvm') || /kvm-(vm|vcpu)/.test(target)) { kvm = true; }
        if (target.startsWith(join(devRoot, 'dri') + '/') && /\/renderD\d+$/.test(target)) { nodes.add(target); }
      }
    }
    const physical = adb('shell', 'wm size').match(/Physical size: (\d+)x(\d+)/);
    const density = adb('shell', 'wm density').match(/Physical density: (\d+)/);
    const ram = mem.match(/^MemTotal:\s+(\d+)/m);
    const cpu = adb('shell', 'getconf _NPROCESSORS_ONLN');
    const config = await bytes(join(process.env.ANDROID_AVD_HOME || join(process.env.HOME, '.android/avd'), `${avd}.avd/config.ini`));
    const imagePath = config.toString().match(/^image\.sysdir\.1\s*=\s*(.+)$/m)?.[1]?.trim();
    const imageProperties = imagePath ? await bytes(join(resolve(sdk, imagePath), 'source.properties')) : Buffer.alloc(0);
    const animations = {};
    let effectiveScales;
    for (const [key, setting] of [['window', 'window_animation_scale'],
      ['transition', 'transition_animation_scale'], ['animator', 'animator_duration_scale']]) {
      const value = adb('shell', 'settings', 'get', 'global', setting);
      let observed = value;
      if (value === 'null') {
        // API 31 does not expose these effective values in dumpsys window.
        // Query the runtime getter, not a guessed default or a settings write.
        effectiveScales ??= await effectiveAnimationScales(dirname(destination), sdk, serial);
        observed = String(effectiveScales[key]);
      }
      if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(observed) || !Number.isFinite(Number(observed))) {
        invalid('unknown-animation-metadata');
      }
      animations[key] = Number(observed);
    }
    const guestApi = Number(adb('shell', 'getprop ro.build.version.sdk'));
    const ramKiB = ram ? Number(ram[1]) : null;
    let verified = kvm && graphics === 'software' && guestApi === Number(api);
    if (stateDir && candidateId) {
      // Verification needs the raw renderer string; only its outcome, known
      // reason and backend name are stored, never the string itself.
      const record = await acceleratorState(stateDir);
      const attempt = record.attempts.find(x => x.candidateId === candidateId);
      if (!attempt) { invalid('unknown-candidate'); }
      const v = verifyAttempt(attempt, {api: guestApi, expectedApi: Number(api), kvm, gles,
        renderNodes: [...nodes].map(n => basename(n)).sort(), resources: {requestedRamMiB: 2048, observedRamKiB: ramKiB}});
      const vulkanRead = spawnSync(join(sdk, 'platform-tools/adb'), ['-s', serial, 'shell', 'getprop ro.hardware.vulkan'],
        {encoding: 'utf8', timeout: 10000});
      const vulkan = vulkanRead.status !== 0 ? 'unknown' : vulkanRead.stdout.trim() ? 'enabled' : 'absent';
      attempt.verification = {verified: v.verified, reason: v.reason, backend: v.backend,
        vulkan: attempt.kind === 'hardware' && vulkan === 'absent' ? 'absent' : vulkan, ramAgreement: v.ramAgreement};
      verified = v.verified;
      await saveAccelerator(stateDir, record);
    }
    const m = {image: imageProperties.length ? hash(imageProperties) : null,
      cpu: kvm ? 'kvm' : 'unknown', graphics, backend: gles ? hash(gles) : null,
      renderer: gles ? hash(gles) : null,
      driver: hash(`${release()}:${[...nodes].map(n => basename(n)).sort().join(',')}:${(await bytes('/sys/module/i915/version')).toString()}`),
      verified,
      resources: {requestedRamMiB: 2048, observedRamKiB: ramKiB,
        cpus: /^\d+$/.test(cpu) ? Number(cpu) : null, width: physical ? Number(physical[1]) : null,
        height: physical ? Number(physical[2]) : null, density: density ? Number(density[1]) : null},
      animations};
    await writeFile(destination, JSON.stringify(m), {flag: 'wx', mode: 0o600}); return;
  }
  if (command === 'artifact') {
    const [directory, api, artifactId, scenarioId, repetition, start, end, exit, minimum = '1'] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    let status = exit === '0' ? 'passed' : exit === '130' ? 'interrupted' : 'failed';
    let failureCode = exit === '0' ? null : exit === '124' ? 'timeout' : exit === '130' ? 'interrupted' : 'validation';
    let ingested = {commands: [], assertions: {executed: 0, failed: 0, missing: 1}};
    try { ingested = await artifact(join(directory, 'raw', artifactId), Number(minimum)); }
    catch (error) {
      status = status === 'interrupted' ? status : 'failed';
      failureCode = failureCode ?? (error.message === 'missing-artifact' ? 'missing-artifact' : 'unsupported-artifact');
    }
    if (ingested.assertions.failed || ingested.assertions.missing ||
        ingested.commands.some(c => c.status !== 'passed')) {
      status = status === 'interrupted' ? status : 'failed'; failureCode ??= 'validation';
    }
    const calibrating = (await calibrationState(directory)).active;
    if (scenarioId !== 'none' && calibrating?.api === Number(api)) {
      // Calibration samples belong to their candidate, never to the run's cohort
      // samples until ranking selects that candidate.
      const acc = ensureAcceleration(a);
      let entry = acc.calibration.find(e => e.candidateId === calibrating.candidateId);
      if (!entry) {
        entry = {candidateId: calibrating.candidateId, status: 'measurement-failed', reason: null,
          profileFingerprint: null, verified: false, samples: []};
        acc.calibration.push(entry);
      }
      entry.samples.push({sampleId: `s-${run.invocationId.slice(4)}-${api}-${calibrating.candidateId}-${scenarioId}-${repetition}`,
        scenarioId, repetition: Number(repetition), status, failureCode, elapsedMs: elapsedMilliseconds(start, end),
        inputFingerprint: run.source.inputFingerprint, artifactId, ...ingested});
    } else if (scenarioId !== 'none') {
      a.samples.push({sampleId: `s-${run.invocationId.slice(4)}-${api}-${scenarioId}-${repetition}`, scenarioId,
        repetition: Number(repetition), status, failureCode, elapsedMs: elapsedMilliseconds(start, end),
        inputFingerprint: run.source.inputFingerprint, artifactId, ...ingested});
    } else {
      a.acceptance.push({flowId: `flow-${artifactId.slice(4)}`, status: status === 'passed' ? 'executed' : 'failed',
        artifactId, failureCode, ...ingested});
    }
    await save(directory, run);
    if (status !== 'passed') { process.exitCode = 1; }
    return;
  }
  if (command === 'finish') {
    const [directory, exit, end, failureCode = 'validation', restoration = 'unknown'] = rest;
    const run = await state(directory);
    run.elapsedMs = elapsedMilliseconds((await readFile(join(directory, 'start.private'), 'utf8')).trim(), end);
    run.status = exit === '0' ? 'passed' : exit === '130' ? 'interrupted' : 'failed';
    choice(failureCode, failures); choice(restoration, ['passed', 'failed', 'unknown']);
    run.failureCode = exit === '0' ? null : exit === '130' ? 'interrupted' :
      exit === '124' ? 'timeout' : failureCode;
    run.fixtureSet.restoration = restoration;
    const restarts = [];
    for (const protocol of protocols) {
      let text;
      try { text = await readFile(join(directory, 'raw', 'lifecycle', `${protocol}.restarts`), 'utf8'); }
      catch (error) { if (error.code === 'ENOENT') { continue; } throw error; }
      restarts.push(parseServiceRestarts(protocol, text));
    }
    if (restarts.length) { run.serviceRestarts = restarts; }
    for (const a of run.apiRuns) {
      a.status = run.status;
      if (run.mode === 'measure' && a.samples.length !== 24 && run.status === 'passed') { invalid('invalid-incomplete-success'); }
    }
    // Segments are recorded at sibling scope, never inclusive parent + child.
    const segments = [...run.sharedPhases, ...run.apiRuns.flatMap(a => a.phases)].sort((a, b) =>
      BigInt(a.startNs) < BigInt(b.startNs) ? -1 : 1);
    let cursor = BigInt((await readFile(join(directory, 'start.private'), 'utf8')).trim());
    for (const p of segments) {
      const start = BigInt(p.startNs), finish = BigInt(p.endNs);
      if (start < cursor) { invalid('invalid-overlapping-phases'); }
      if (start > cursor) {
        run.sharedPhases.push({segmentId: `seg-${randomBytes(8).toString('hex')}`, phase: 'other',
          startNs: cursor.toString(), endNs: start.toString(), elapsedMs: elapsedMilliseconds(cursor.toString(), start.toString()), status: 'passed'});
      }
      cursor = finish;
    }
    if (BigInt(end) < cursor) { invalid('invalid-duration'); }
    if (BigInt(end) > cursor) {
      run.sharedPhases.push({segmentId: `seg-${randomBytes(8).toString('hex')}`, phase: 'other',
        startNs: cursor.toString(), endNs: end, elapsedMs: elapsedMilliseconds(cursor.toString(), end), status: 'passed'});
    }
    await writeReport(directory, run); return;
  }
  if (command === '--before') {
    const [before, afterFlag, after, outputFlag, output] = rest;
    if (afterFlag !== '--after' || outputFlag !== '--output' || !output) { invalid('invalid-cli'); }
    const load = async directory => {
      const files = (await walk(resolve(directory))).filter(p => basename(p) === 'run.json');
      return Promise.all(files.map(async p => JSON.parse(await readFile(p, 'utf8'))));
    };
    const comparison = compareRuns(await load(before), await load(after));
    await mkdir(dirname(resolve(output)), {recursive: true, mode: 0o700});
    await writeFile(output, `${JSON.stringify(comparison, null, 2)}\n`, {flag: 'wx', mode: 0o600});
    await writeFile(output.replace(/\.json$/, '') + '.md',
      '# Whole-flow comparison\n\n' +
      '| Subject | API | Status | Before median ms | After median ms | After − before ms | Improvement % | Diagnostics |\n' +
      '| --- | --- | --- | --- | --- | --- | --- | --- |\n' + comparison.rows.map(r =>
        `| ${r.scenarioId} | ${r.api} | ${r.status} | ${r.beforeMedianMs ?? 'n/a'} | ${r.afterMedianMs ?? 'n/a'} | ` +
        `${r.elapsedChangeMs ?? 'n/a'} | ${r.improvementPercent ?? 'n/a'} | ${[...r.reasons, ...r.notes].join(', ')} |`).join('\n') + '\n',
      {flag: 'wx', mode: 0o600});
    process.exitCode = comparison.complete ? 0 : 1; return;
  }
  invalid('invalid-cli');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => {
    // Do not expose filenames, exception text, artifact payloads or credentials.
    console.error('performance-report: invalid or incomplete evidence');
    process.exitCode = 1;
  });
}
