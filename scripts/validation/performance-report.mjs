import {createHash, randomBytes} from 'node:crypto';
import {chmod, lstat, mkdir, readdir, readFile, writeFile} from 'node:fs/promises';
import {cpus, platform, release} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

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

export function validateRun(run) {
  object(run, ['schemaVersion', 'invocationId', 'mode', 'status', 'failureCode', 'source', 'host',
    'workloadFingerprint', 'build', 'fixtureSet', 'sharedPhases', 'elapsedMs', 'apiRuns']);
  if (run.schemaVersion !== 1) { invalid('unsupported-schema-version'); }
  opaque(run.invocationId); choice(run.mode, ['connected', 'e2e', 'release-smoke', 'measure']);
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
      'animations', 'phases', 'samples', 'acceptance', 'build'], ['build']);
    if (a.build) { validateBuild(a.build); }
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

function cohort(run, a) {
  const build = a.build ?? run.build;
  const fixtures = {fingerprint: run.fixtureSet.fingerprint, counts: run.fixtureSet.counts,
    logicalBytes: run.fixtureSet.logicalBytes};
  return {host: run.host, workload: run.workloadFingerprint, fixtures,
    api: a.api, image: a.image, profile: {...a.profile, requested: undefined, fallback: undefined},
    resources: a.resources, animations: a.animations,
    build: {abi: build.abi, cachePolicy: build.cachePolicy, cacheState: build.cacheState}};
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
        elapsedChangePercent: null, improvementPercent: null};
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
  const sequences = new Set();
  for (const record of records) {
    const command = record?.command, m = record?.metadata;
    if (!command || !m) { invalid('unsupported-artifact'); }
    const keys = Object.keys(command).filter(key => key !== 'sourceInfo');
    if (keys.length !== 1) { invalid('unsupported-artifact'); }
    const type = keys[0], category = types[type];
    if (!category || !['COMPLETED', 'FAILED', 'WARNED', 'SKIPPED', 'RUNNING', 'PENDING'].includes(m.status) ||
        !Number.isInteger(m.sequenceNumber) || m.sequenceNumber < 0 ||
        !Number.isInteger(m.depth) || m.depth < 0 || sequences.has(m.sequenceNumber)) { invalid('unsupported-artifact'); }
    sequences.add(m.sequenceNumber);
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
    if (category === 'assertion' && command[type]?.optional !== true) {
      assertions[status === 'passed' ? 'executed' : 'failed']++;
    }
    executed.push({category, start, end: start + duration, depth: m.depth,
      elapsedMs: duration, status, sequence: m.sequenceNumber, completed: m.status === 'COMPLETED'});
  }
  const commands = [];
  const leaves = executed.filter(item => item.category !== 'wrapper').sort((a, b) => a.sequence - b.sequence);
  for (const [index, item] of leaves.entries()) {
    // Wrappers/embedded definitions are not another executed list.
    for (const [previousIndex, previous] of leaves.slice(0, index).entries()) {
      if (previous.start >= item.end || item.start >= previous.end) { continue; }
      // Pinned Maestro timestamps/durations are independently quantized to
      // milliseconds. Only adjacent completed leaves may share one boundary
      // millisecond, with strictly advancing starts AND ends. Charge it once.
      const overlap = previous.end - item.start;
      if (previousIndex !== index - 1 || !previous.completed || !item.completed ||
          ![previous.start, previous.end, item.start, item.end].every(Number.isInteger) ||
          item.start <= previous.start || item.end <= previous.end || overlap !== 1) {
        invalid('unsupported-artifact-overlap');
      }
      item.elapsedMs -= overlap;
    }
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
    build: {apkDigest: null, abi: mode === 'release-smoke' ? 'release-default' : mode === 'connected' ? 'instrumented' : 'debug-default',
      cachePolicy: mode === 'release-smoke' ? 'default' : 'no-daemon', cacheState: 'unknown', tasks: 'unknown'},
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
    if (!a?.profile.verified || a.profile.cpu !== 'kvm' || a.profile.graphics !== 'software') {
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
      `"/storage/$volume/SyncScopeE2E" -type f -exec stat -c %s {} \\;`],
    {encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024});
    const values = p.stdout?.trim().split(/\s+/) ?? [];
    if (p.status === 0 && values.length && values.every(v => /^\d+$/.test(v))) {
      run.fixtureSet.logicalBytes = await logicalBytes(root) + values.reduce((sum, v) => sum + Number(v), 0);
    }
    await save(directory, run); return;
  }
  if (command === 'device') {
    const [directory, api, metadataFile] = rest;
    const run = await state(directory), a = run.apiRuns.find(r => r.api === Number(api));
    const m = JSON.parse(await readFile(metadataFile, 'utf8'));
    object(m, ['image', 'cpu', 'graphics', 'backend', 'renderer', 'driver', 'resources', 'animations', 'verified']);
    a.image = m.image; Object.assign(a.profile, {cpu: m.cpu, graphics: m.graphics,
      backend: m.backend, renderer: m.renderer, driver: m.driver, verified: m.verified});
    a.profile.fingerprint = hash(JSON.stringify({image: a.image, cpu: m.cpu,
      graphics: m.graphics, backend: m.backend, renderer: m.renderer, driver: m.driver}));
    a.resources = m.resources; a.animations = m.animations;
    await save(directory, run); return;
  }
  if (command === 'capture-device') {
    const [destination, sdk, serial, api, avd] = rest;
    const adb = (...a) => spawnSync(join(sdk, 'platform-tools/adb'), ['-s', serial, ...a],
      {encoding: 'utf8', timeout: 10000}).stdout?.trim() ?? '';
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
        if (target === '/dev/kvm' || /kvm-(vm|vcpu)/.test(target)) { kvm = true; }
        if (/\/dev\/dri\/renderD\d+$/.test(target)) { nodes.add(target); }
      }
    }
    const physical = adb('shell', 'wm size').match(/Physical size: (\d+)x(\d+)/);
    const density = adb('shell', 'wm density').match(/Physical density: (\d+)/);
    const ram = mem.match(/^MemTotal:\s+(\d+)/m);
    const cpu = adb('shell', 'getconf _NPROCESSORS_ONLN');
    const config = await bytes(join(process.env.ANDROID_AVD_HOME || join(process.env.HOME, '.android/avd'), `${avd}.avd/config.ini`));
    const imagePath = config.toString().match(/^image\.sysdir\.1=(.+)$/m)?.[1];
    const imageProperties = imagePath ? await bytes(join(sdk, imagePath, 'source.properties')) : Buffer.alloc(0);
    const animations = {};
    for (const [key, setting] of [['window', 'window_animation_scale'],
      ['transition', 'transition_animation_scale'], ['animator', 'animator_duration_scale']]) {
      const value = adb('shell', 'settings', 'get', 'global', setting);
      animations[key] = /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : null;
    }
    const m = {image: imageProperties.length ? hash(imageProperties) : null,
      cpu: kvm ? 'kvm' : 'unknown', graphics, backend: gles ? hash(gles) : null,
      renderer: gles ? hash(gles) : null,
      driver: hash(`${release()}:${[...nodes].sort().join(',')}:${(await bytes('/sys/module/i915/version')).toString()}`),
      verified: kvm && graphics === 'software' && Number(adb('shell', 'getprop ro.build.version.sdk')) === Number(api),
      resources: {requestedRamMiB: 2048, observedRamKiB: ram ? Number(ram[1]) : null,
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
    if (scenarioId !== 'none') {
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
        `${r.elapsedChangeMs ?? 'n/a'} | ${r.improvementPercent ?? 'n/a'} | ${r.reasons.join(', ')} |`).join('\n') + '\n',
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
