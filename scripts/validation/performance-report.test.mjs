import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  compareRuns, elapsedMilliseconds, ingestCommands, validateRun, writeReport,
} from './performance-report.mjs';

const digest = 'a'.repeat(64);
const ids = Array.from({length: 8}, (_, i) => `H0${i + 1}`);
const reporter = new URL('./performance-report.mjs', import.meta.url).pathname;

async function metadataHarness(t) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-metadata-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const sdk = join(root, 'sdk');
  await mkdir(join(sdk, 'platform-tools'), {recursive: true});
  const adb = join(sdk, 'platform-tools/adb');
  const javaHome = join(root, 'java');
  await mkdir(join(javaHome, 'bin'), {recursive: true});
  await writeFile(join(javaHome, 'bin/javac'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
  await mkdir(join(sdk, 'build-tools/37.0.0'), {recursive: true});
  await writeFile(join(sdk, 'build-tools/37.0.0/d8'), '#!/bin/sh\nexit 0\n', {mode: 0o700});
  const cli = (...args) => spawnSync(process.execPath, [reporter, ...args],
    {encoding: 'utf8', env: {...process.env, JAVA_HOME: javaHome, ANDROID_AVD_HOME: join(root, 'avds')}});
  return {root, sdk, adb, cli};
}

test('fixture metadata batches stat instead of spawning once per file; failed observations reject', async t => {
  const h = await metadataHarness(t);
  const fixtures = join(h.root, 'fixtures');
  await mkdir(fixtures);
  await writeFile(join(fixtures, 'synthetic'), '12345');
  await writeFile(join(h.root, 'record.private.json'), JSON.stringify(syntheticRun()));
  await writeFile(h.adb, `#!/bin/sh
case "$*" in
  *'-exec stat -c %s {} +') printf '7\\n11\\n';;
  *) exit 124;;
esac
`, {mode: 0o700});
  let result = h.cli('fixtures', h.root, fixtures, h.sdk, 'emulator-5554');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(join(h.root, 'record.private.json'))).fixtureSet.logicalBytes, 23);
  for (const body of ["exit 1", "printf 'unexpected\\n'", "exit 0"]) {
    await writeFile(h.adb, `#!/bin/sh\n${body}\n`, {mode: 0o700});
    result = h.cli('fixtures', h.root, fixtures, h.sdk, 'emulator-5554');
    assert.notEqual(result.status, 0, body);
    assert.match(result.stderr, /invalid or incomplete evidence/);
  }
});

test('unset animation settings use observed WindowManager scales, never assumed defaults', async t => {
  const h = await metadataHarness(t);
  const image = join(h.sdk, 'system-images/synthetic');
  await mkdir(image, {recursive: true});
  await writeFile(join(image, 'source.properties'), 'Pkg.Revision=12\n');
  await mkdir(join(h.root, 'avds/synthetic.avd'), {recursive: true});
  await writeFile(join(h.root, 'avds/synthetic.avd/config.ini'), `image.sysdir.1 = ${image}/\n`);
  await writeFile(h.adb, `#!/bin/sh
case "$*" in
  *'shell settings get global window_animation_scale') printf '0.5\\n';;
  *'shell settings get global transition_animation_scale') printf '1\\n';;
  *'shell settings get global animator_duration_scale') printf 'null\\n';;
  *'app_process / SyncScopeAnimationScales') printf '0.5\\n1\\n1.25\\n';;
  *'shell rm -f /data/local/tmp/syncscope-animation-'*) printf 'removed\\n' >>"${h.root}/cleanup";;
esac
`, {mode: 0o700});
  const destination = join(h.root, 'metadata.private.json');
  let result = h.cli('capture-device', destination, h.sdk, 'emulator-5554', '31', 'synthetic');
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(await readFile(destination));
  assert.deepEqual(observed.animations, {window: 0.5, transition: 1, animator: 1.25});
  assert.match(observed.image ?? '', /^[a-f0-9]{64}$/);
  assert.equal(await readFile(join(h.root, 'cleanup'), 'utf8'), 'removed\n');
  await writeFile(h.adb, `#!/bin/sh
case "$*" in
  *'settings get global '*) printf 'null\\n';;
  *'app_process '*) printf 'null\\n';;
  *'shell rm -f /data/local/tmp/syncscope-animation-'*) printf 'removed\\n' >>"${h.root}/cleanup";;
esac
`, {mode: 0o700});
  result = h.cli('capture-device', join(h.root, 'missing.private.json'), h.sdk, 'emulator-5554', '31', 'synthetic');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /invalid or incomplete evidence/);
  assert.equal(await readFile(join(h.root, 'cleanup'), 'utf8'), 'removed\nremoved\n');
});

test('original software sampling rejects unknown image, resources or animation metadata before scenarios', async t => {
  const h = await metadataHarness(t);
  for (const mutate of [
    a => { a.image = null; },
    a => { a.resources.observedRamKiB = null; },
    a => { a.animations.animator = null; },
  ]) {
    const run = syntheticRun(); mutate(run.apiRuns[0]);
    await writeFile(join(h.root, 'record.private.json'), JSON.stringify(run));
    assert.notEqual(h.cli('require-original-software', h.root, '31').status, 0);
  }
});

export function syntheticRun(duration = 100) {
  return {
    schemaVersion: 1, invocationId: 'inv-0123456789abcdef', mode: 'measure',
    status: 'passed', failureCode: null,
    source: {revision: 'b'.repeat(40), inputFingerprint: digest},
    host: {id: digest, os: 'linux', kernel: '6.18.52', cpu: digest,
      tools: {node: '24.11.1', maestro: '2.10.0', emulator: '37.1.11', adb: '37.0.1',
        docker: '29.8.1', compose: '5.5.1', java: '26.0.2', pnpm: '11.3.0'}, power: digest},
    workloadFingerprint: digest,
    build: {apkDigest: digest, abi: 'x86_64', cachePolicy: 'no-daemon',
      cacheState: 'warm', tasks: 'executed'},
    fixtureSet: {fingerprint: digest, counts: {bulkFiles: 20000,
      galleryBulkFiles: 2000, scrollFiles: 5000}, logicalBytes: 42,
      restoration: 'passed'},
    sharedPhases: [], elapsedMs: 4800,
    apiRuns: [31, 36].map(api => ({
      runId: `api-${api}`, invocationId: 'inv-0123456789abcdef', api,
      image: digest, status: 'passed',
      profile: {fingerprint: digest, requested: 'software', cpu: 'kvm',
        graphics: 'software', backend: digest, renderer: digest, driver: digest,
        verified: true, fallback: false},
      resources: {requestedRamMiB: 2048, observedRamKiB: 3000000,
        cpus: 4, width: 1080, height: 2340, density: 440},
      animations: {window: 1, transition: 1, animator: 1},
      phases: [], acceptance: [],
      samples: ids.flatMap(scenarioId => [1, 2, 3].map(repetition => ({
        sampleId: `s-${api}-${scenarioId}-${repetition}`, scenarioId, repetition,
        status: 'passed', failureCode: null, elapsedMs: duration,
        inputFingerprint: digest, artifactId: `raw-${api}-${scenarioId}-${repetition}`,
        commands: [], assertions: {executed: 1, failed: 0, missing: 0},
      }))),
    })),
  };
}

test('version 1 only, strict metadata and finite nonnegative elapsed milliseconds', () => {
  assert.deepEqual(validateRun(syntheticRun()), syntheticRun());
  for (const mutate of [
    run => { run.schemaVersion = 2; },
    run => { run.hostname = 'credential-canary'; },
    run => { run.host.tools.secret = 'content-canary'; },
    run => { run.apiRuns[0].samples[0].elapsedMs = -1; },
    run => { run.apiRuns[0].samples[0].elapsedMs = Infinity; },
    run => { run.apiRuns[0].samples[0].repetition = 4; },
    run => { run.status = 'complete'; },
    run => { run.apiRuns[0].samples[0].status = 'running'; },
    run => { run.source.inputFingerprint = '/home/user/secret'; },
  ]) {
    const run = syntheticRun();
    mutate(run);
    assert.throws(() => validateRun(run), /invalid|unsupported|unknown/);
  }
  assert.equal(elapsedMilliseconds('1000000', '3500000'), 2.5);
  assert.throws(() => elapsedMilliseconds('2', '1'), /duration/);
  assert.throws(() => elapsedMilliseconds('NaN', '1'), /duration/);
});

test('protocol restart records are optional, allowlisted and never fail a passed run by themselves', () => {
  const run = syntheticRun();
  run.serviceRestarts = [
    {protocol: 'ftp', restarts: 1, events: [{action: 'die', unixMs: 1792000000123},
      {action: 'start', unixMs: 1792000000456}]},
    {protocol: 'sftp', restarts: 0, events: []},
  ];
  assert.deepEqual(validateRun(run), run);
  for (const mutate of [
    r => { r.serviceRestarts[0].protocol = 'smb'; },
    r => { r.serviceRestarts[0].restarts = -1; },
    r => { r.serviceRestarts[0].restarts = 0.5; },
    r => { r.serviceRestarts[0].events[0].action = 'oom'; },
    r => { r.serviceRestarts[0].events[0].unixMs = 'yesterday'; },
    r => { r.serviceRestarts[0].events[0].message = 'segfault at /home/user'; },
    r => { r.serviceRestarts[0].host = 'credential-canary'; },
    r => { r.serviceRestarts.push({...r.serviceRestarts[1]}); },
    r => { r.serviceRestarts = {}; },
  ]) {
    const copy = structuredClone(run);
    mutate(copy);
    assert.throws(() => validateRun(copy), /invalid|unknown/);
  }
});

test('all eight subjects and both APIs remain visible; three original successful samples required', () => {
  const before = syntheticRun();
  const after = syntheticRun(80);
  after.apiRuns[0].samples[0].elapsedMs = 900;
  let result = compareRuns([before], [after]);
  assert.equal(result.rows.length, 16);
  assert.equal(result.complete, true);
  assert.equal(result.rows[0].afterMedianMs, 80);
  assert.equal(result.rows[0].elapsedChangeMs, -20);
  assert.equal(result.rows[0].improvementPercent, 20);
  after.apiRuns[0].samples[0].status = 'failed';
  after.apiRuns[0].samples[0].failureCode = 'validation';
  after.status = 'failed';
  after.failureCode = 'validation';
  after.apiRuns[0].status = 'failed';
  result = compareRuns([before], [after]);
  assert.equal(result.complete, false);
  assert.equal(result.rows[0].status, 'incomplete');
  assert.equal(result.rows[0].afterSampleIds.length, 3);
  after.apiRuns[0].samples.push({...after.apiRuns[0].samples[1], sampleId: 's-diagnostic-rerun'});
  assert.throws(() => compareRuns([before], [after]), /duplicate|repetition/);
  assert.equal(compareRuns([], []).rows.length, 16);
  assert.equal(compareRuns([], []).rows[0].status, 'missing');
});

test('actual renderer/cache/resources and unknown critical metadata cannot be pooled', () => {
  for (const mutate of [
    run => { run.apiRuns[0].profile.renderer = 'c'.repeat(64); },
    run => { run.apiRuns[0].profile.verified = false; },
    run => { run.apiRuns[0].animations.window = 0; },
    run => { run.build.cacheState = 'unknown'; },
    run => { run.apiRuns[0].resources.observedRamKiB = null; },
    run => { run.host.tools = {}; },
    run => { run.build.apkDigest = null; },
  ]) {
    const after = syntheticRun();
    mutate(after);
    const result = compareRuns([syntheticRun()], [after]);
    assert.equal(result.rows[0].status, 'incompatible');
    assert.ok(result.rows[0].reasons.length);
  }
  const after = syntheticRun(120);
  after.source.inputFingerprint = 'c'.repeat(64);
  after.build.apkDigest = 'd'.repeat(64);
  assert.equal(compareRuns([syntheticRun()], [after]).rows[0].improvementPercent, -20);
  const zero = compareRuns([syntheticRun(0)], [syntheticRun()]);
  assert.equal(zero.rows[0].improvementPercent, null);
  assert.ok(zero.rows[0].reasons.includes('zero-baseline'));
});

test('flat executed metadata is allowlisted; definitions, secrets and UI are never published', async t => {
  const commands = [
    {command: {runFlowCommand: {commands: [{inputTextCommand: {text: 'SECRET_CANARY'}}]}},
      metadata: {status: 'COMPLETED', timestamp: 1000, duration: 30, sequenceNumber: 0, depth: 0}},
    {command: {inputTextCommand: {text: 'SECRET_CANARY'}},
      metadata: {status: 'COMPLETED', timestamp: 1001, duration: 10, sequenceNumber: 1, depth: 1,
        evaluatedCommand: {text: 'CONTENT_CANARY'}, arbitrary: 'SECRET_CANARY'}},
    {command: {assertConditionCommand: {condition: {visible: {textRegex: 'CONTENT_CANARY'}}}},
      metadata: {status: 'COMPLETED', timestamp: 1012, duration: 8, sequenceNumber: 2, depth: 1}},
  ];
  const result = ingestCommands(commands);
  assert.equal(result.assertions.executed, 1);
  assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 18);
  assert.equal(result.commands.reduce((sum, c) => sum + c.count, 0), 2);
  assert.doesNotMatch(JSON.stringify(result), /CANARY|textRegex|evaluatedCommand/);
  assert.throws(() => ingestCommands({commands}), /artifact/);
  assert.throws(() => ingestCommands([{command: {}, metadata: {}}]), /artifact/);
  const directory = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-report-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const run = syntheticRun();
  run.apiRuns[0].samples[0].commands = result.commands;
  await writeReport(directory, run);
  assert.doesNotMatch(await readFile(join(directory, 'report.md'), 'utf8'), /CANARY/);
  await assert.rejects(writeReport(directory, run), /EEXIST/);
  await writeFile(join(directory, 'raw-canary'), 'SECRET_CANARY', {mode: 0o600});
});

test('pinned 2.10.0 getter names, sourceInfo and optional WARNED do not invent assertion proof', () => {
  const input = [
    {command: {defineVariablesCommand: {env: {PASSWORD: 'SECRET_CANARY'}}, sourceInfo: {file: '/private/CANARY'}},
      metadata: {status: 'COMPLETED', timestamp: 1, duration: 1, sequenceNumber: 0, depth: 0}},
    {command: {tapOnElement: {selector: {textRegex: 'CONTENT_CANARY'}}, sourceInfo: {line: 9}},
      metadata: {status: 'COMPLETED', timestamp: 2, duration: 1, sequenceNumber: 1, depth: 0}},
    {command: {assertConditionCommand: {optional: true, timeout: '1000'}},
      metadata: {status: 'WARNED', timestamp: 3, duration: 1, sequenceNumber: 2, depth: 0,
        error: {message: 'CONTENT_CANARY'}}},
    {command: {assertConditionCommand: {optional: false}},
      metadata: {status: 'COMPLETED', timestamp: 4, duration: 1, sequenceNumber: 3, depth: 0}},
  ];
  const result = ingestCommands(input);
  assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 0});
  assert.doesNotMatch(JSON.stringify(result), /CANARY|selector|sourceInfo/);
});

const record = (sequenceNumber, timestamp, duration, type = 'assertConditionCommand', payload = {}, status = 'COMPLETED') =>
  ({command: {[type]: payload}, metadata: {sequenceNumber, timestamp, duration, depth: 0, status}});

test('millisecond quantization clips only shared boundary milliseconds, never real conflicts', () => {
  const result = ingestCommands([
    record(0, 1000, 10, 'inputTextCommand'), record(1, 1009, 8),
    record(2, 1016, 5, 'tapOnElement'),
  ]);
  assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 21);
  // General ≤1 ms rule (2026-10-15): a 1 ms leaf inside another shares 1 ms, charged once.
  const inside = ingestCommands([record(0, 1000, 10), record(1, 1000, 1)]);
  assert.equal(inside.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 10);
  for (const records of [
    [record(0, 1000, 10), record(1, 1008, 8)],
    [record(0, 1000, 10), record(1, 1000, 2)],
    [record(0, 1000, 10), record(1, 1009, 0.5)],
  ]) {
    assert.throws(() => ingestCommands(records), /overlap/);
  }
});

const initializationPair = (timestamp = 1000) => {
  const variables = record(60, timestamp, 1, 'defineVariablesCommand', {env: {PASSWORD: 'SECRET_CANARY'}});
  const configuration = record(61, timestamp, 1, 'applyConfigurationCommand', {config: 'CONTENT_CANARY'});
  configuration.metadata.depth = 1;
  return [variables, configuration];
};

test('pinned sequential initialization records sharing one millisecond charge that interval once', () => {
  for (const timestamp of [1000, '2026-10-11T23:40:00.001Z']) {
    const records = [...initializationPair(timestamp), record(62,
      typeof timestamp === 'string' ? Date.parse(timestamp) + 1 : timestamp + 1, 7)];
    const result = ingestCommands(records);
    assert.deepEqual(result.commands, [
      {category: 'script', count: 1, elapsedMs: 1, status: 'passed'},
      {category: 'other', count: 1, elapsedMs: 0, status: 'passed'},
      {category: 'assertion', count: 1, elapsedMs: 7, status: 'passed'},
    ]);
    assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 0});
    assert.doesNotMatch(JSON.stringify(result), /CANARY|timestamp|sequence|depth|config|PASSWORD/);
    assert.deepEqual(records.slice(0, 2), initializationPair(timestamp), 'raw records remain immutable');
  }
});

test('identical initialization interval correction rejects conflicting order, depth, status and timing', () => {
  // Under the general 1 ms rule (decisions f4b9c03 and its depth amendment),
  // the command types are irrelevant, same depth is allowed, and a later
  // command ending after the shared millisecond is still a 1 ms overlap.
  for (const mutate of [
    pair => { pair[0].command = {tapOnElement: {}}; },
    pair => { pair[1].command = {assertConditionCommand: {}}; },
    pair => { [pair[0].command, pair[1].command] = [pair[1].command, pair[0].command]; },
    pair => { pair[1].metadata.depth = 0; },
    pair => { pair[1].metadata.duration = 2; },
    // Widened rule (2026-10-15): one level shallower is also a rounding
    // overlap, so the swapped pair (depth 1, then depth 0) is accepted.
    pair => { pair[1].metadata.sequenceNumber = 59; },
    // General ≤1 ms rule (2026-10-15): depth, adjacency and records between the
    // leaves no longer matter while every shared interval is at most 1 ms.
    pair => { pair[1].metadata.sequenceNumber = 62; },
    pair => { pair[1].metadata.sequenceNumber = 59; pair[1].metadata.depth = 2; },
    pair => { pair[1].metadata.depth = 2; },
    pair => { pair[0].metadata.duration = 2; },
    pair => { pair.unshift(record(59, 999, 2, 'tapOnElement')); },
    pair => { pair.push(record(62, 1000, 1, 'applyConfigurationCommand')); },
    pair => { pair.splice(1, 0, record(59, 1000, 1, 'inputTextCommand')); },
  ]) {
    const pair = initializationPair(); mutate(pair);
    assert.doesNotThrow(() => ingestCommands(pair));
  }
  const mutations = [
    pair => { pair[0].metadata.status = 'FAILED'; },
    pair => { pair[1].metadata.status = 'WARNED'; },
    pair => { pair[1].metadata.status = 'RUNNING'; },
    pair => { pair[0].metadata.duration = 2; pair[1].metadata.duration = 2; },
    pair => { pair[0].metadata.duration = 0.5; pair[1].metadata.duration = 0.5; },
    pair => { pair[0].metadata.timestamp = 1000.5; pair[1].metadata.timestamp = 1000.5; },
    pair => { pair[1].metadata.duration = 2; pair.unshift(record(59, 999, 3, 'tapOnElement')); },
    pair => { pair[0].metadata.duration = 2; pair.push(record(62, 1000, 2, 'applyConfigurationCommand')); },
  ];
  for (const mutate of mutations) {
    const pair = initializationPair();
    mutate(pair);
    assert.throws(() => ingestCommands(pair), /overlap/);
  }
  // Initialization correction never makes mandatory failures, missing proof or
  // malformed metadata successful, even when the initialization pair is valid.
  const failed = ingestCommands([...initializationPair(), record(62, 1001, 1,
    'assertConditionCommand', {}, 'FAILED')]);
  assert.deepEqual(failed.assertions, {executed: 0, failed: 1, missing: 0});
  const missing = ingestCommands([...initializationPair(), record(62, 1001, 1,
    'assertConditionCommand', {}, 'SKIPPED')]);
  assert.deepEqual(missing.assertions, {executed: 0, failed: 0, missing: 1});
  for (const mutate of [
    pair => { pair[1].metadata.status = 'UNKNOWN'; },
    pair => { pair[1].metadata.duration = -1; },
    pair => { pair[1].metadata.sequenceNumber = 60; },
    pair => { pair[1].metadata.depth = -1; },
    pair => { pair[1].command.unknownCommand = {}; },
  ]) {
    const pair = initializationPair(); mutate(pair);
    assert.throws(() => ingestCommands(pair), /artifact/);
  }
});

const sameStartPair = (timestamp = 1100) => {
  // Pinned raw-36-20 shape: a sub-millisecond leaf reported as one quantized
  // millisecond, followed by the next sequential sibling in that same millisecond.
  const configuration = record(60, timestamp, 1, 'applyConfigurationCommand', {config: 'CONTENT_CANARY'});
  const script = record(61, timestamp, 4, 'evalScriptCommand', {scriptString: 'SECRET_CANARY'});
  configuration.metadata.depth = 1; script.metadata.depth = 1;
  return [configuration, script];
};

test('a quantized one-millisecond leaf sharing its start with the next sequential sibling charges that interval once', () => {
  for (const timestamp of [1100, '2026-10-12T18:37:31.100Z']) {
    const next = typeof timestamp === 'string' ? Date.parse(timestamp) + 5 : timestamp + 5;
    const records = [...sameStartPair(timestamp), record(62, next, 4, 'evalScriptCommand'), record(63, next + 5, 2)];
    const result = ingestCommands(records);
    assert.deepEqual(result.commands, [
      {category: 'other', count: 1, elapsedMs: 1, status: 'passed'},
      {category: 'script', count: 2, elapsedMs: 7, status: 'passed'},
      {category: 'assertion', count: 1, elapsedMs: 2, status: 'passed'},
    ]);
    assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 0});
    assert.doesNotMatch(JSON.stringify(result), /CANARY|timestamp|sequence|depth|config/);
    assert.deepEqual(records.slice(0, 2), sameStartPair(timestamp), 'raw records remain immutable');
  }
});

test('same-start quantization correction rejects real conflicts, order, depth, status and timing', () => {
  // An identical 1 ms interval at the same depth is a 1 ms overlap under the general rule.
  const identical = sameStartPair(); identical[1].metadata.duration = 1;
  assert.doesNotThrow(() => ingestCommands(identical));
  // One level deeper is allowed by the depth amendment; two levels deeper is not.
  const deeper = sameStartPair(); deeper[1].metadata.depth = 2;
  assert.doesNotThrow(() => ingestCommands(deeper));
  // The widened rule (2026-10-15) also allows one level shallower.
  const shallower = sameStartPair(); shallower[1].metadata.depth = 0;
  assert.doesNotThrow(() => ingestCommands(shallower));
  // The general ≤1 ms rule (2026-10-15) ignores order, depth, adjacency and
  // records between the leaves while every shared interval is at most 1 ms.
  for (const mutate of [
    pair => { pair[1].metadata.sequenceNumber = 62; },
    pair => { pair[1].metadata.sequenceNumber = 59; },
    pair => { pair[1].metadata.depth = 3; },
    pair => { pair[0].metadata.depth = 2; pair[1].metadata.depth = 0; },
    pair => { pair.splice(1, 0, record(59, 1100, 1, 'inputTextCommand')); },
  ]) {
    const pair = sameStartPair(); mutate(pair);
    assert.doesNotThrow(() => ingestCommands(pair));
  }
  const mutations = [
    pair => { pair[0].metadata.duration = 2; },
    pair => { pair[0].metadata.duration = 0.5; },
    pair => { pair[1].metadata.duration = 1.5; },
    pair => { pair[0].metadata.timestamp = 1100.5; pair[1].metadata.timestamp = 1100.5; },
    pair => { pair[0].metadata.status = 'FAILED'; },
    pair => { pair[1].metadata.status = 'WARNED'; },
    pair => { pair[1].metadata.status = 'RUNNING'; },
    pair => { pair.splice(1, 0, record(59, 1100, 2, 'inputTextCommand')); },
    pair => { pair.push(record(62, 1100, 6, 'tapOnElement')); },
  ];
  for (const mutate of mutations) {
    const pair = sameStartPair();
    mutate(pair);
    assert.throws(() => ingestCommands(pair), /overlap/);
  }
  // The correction never turns failed or missing mandatory proof into success.
  const failed = ingestCommands([...sameStartPair(), record(62, 1104, 1, 'assertConditionCommand', {}, 'FAILED')]);
  assert.deepEqual(failed.assertions, {executed: 0, failed: 1, missing: 0});
  const missing = ingestCommands([...sameStartPair(), record(62, 1104, 1, 'assertConditionCommand', {}, 'SKIPPED')]);
  assert.deepEqual(missing.assertions, {executed: 0, failed: 0, missing: 1});
});

const roundingPair = (first, second, base = 2000) => {
  // [type, depth, startOffset, duration] for two consecutive-sequence leaves.
  const a = record(25, base + first[2], first[3], first[0]);
  const b = record(26, base + second[2], second[3], second[0]);
  a.metadata.depth = first[1]; b.metadata.depth = second[1];
  return [a, b];
};

test('general 1 ms rounding rule: retained raw-31-11 shape (variables then deeper configuration) charges once', () => {
  // raw-31-11: defineVariablesCommand depth 2 spans 10 ms; the next sequence,
  // applyConfigurationCommand one level deeper, starts in its last millisecond.
  const records = [...roundingPair(['defineVariablesCommand', 2, 0, 10], ['applyConfigurationCommand', 3, 9, 1]),
    record(27, 2010, 5)];
  const result = ingestCommands(records);
  assert.deepEqual(result.commands, [
    {category: 'script', count: 1, elapsedMs: 10, status: 'passed'},
    {category: 'other', count: 1, elapsedMs: 0, status: 'passed'},
    {category: 'assertion', count: 1, elapsedMs: 5, status: 'passed'},
  ]);
  assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 0});
});

test('general 1 ms rounding rule accepts any completed adjacent pair within one depth level either way', () => {
  for (const [first, second, total] of [
    [['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 4, 3], 7],
    [['tapOnElement', 1, 0, 5], ['inputTextCommand', 2, 4, 3], 7],
    [['tapOnElement', 1, 0, 5], ['inputTextCommand', 0, 4, 3], 7],
    [['scrollUntilVisible', 3, 0, 10], ['assertConditionCommand', 2, 9, 4], 13],
    [['applyConfigurationCommand', 1, 0, 1], ['applyConfigurationCommand', 1, 0, 1], 1],
    [['defineVariablesCommand', 0, 0, 1], ['applyConfigurationCommand', 0, 0, 1], 1],
    [['defineVariablesCommand', 0, 0, 1], ['applyConfigurationCommand', 1, 0, 2], 2],
    [['tapOnElement', 0, 0, 10], ['inputTextCommand', 1, 9, 1], 10],
  ]) {
    const result = ingestCommands([...roundingPair(first, second), record(27, 2100, 1)]);
    assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), total + 1, JSON.stringify([first, second]));
  }
});

test('general 1 ms rounding rule rejects >1 ms, incomplete and fractional overlaps but not depth or gaps', () => {
  // General ≤1 ms rule (2026-10-15): a 1 ms overlap is rounding at any depth
  // change and across a missing sequence number.
  for (const records of [
    roundingPair(['tapOnElement', 0, 0, 10], ['inputTextCommand', 0, 0, 1]),
    roundingPair(['tapOnElement', 2, 0, 5], ['inputTextCommand', 0, 4, 3]),
    roundingPair(['tapOnElement', 1, 0, 5], ['inputTextCommand', 3, 4, 3]),
    roundingPair(['defineVariablesCommand', 2, 0, 10], ['applyConfigurationCommand', 4, 9, 1]),
  ]) {
    assert.doesNotThrow(() => ingestCommands(records), JSON.stringify(records.map(r => r.metadata)));
  }
  for (const records of [
    roundingPair(['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 3, 3]),
    roundingPair(['defineVariablesCommand', 2, 0, 10], ['applyConfigurationCommand', 3, 8, 2]),
    roundingPair(['tapOnElement', 0, 0, 10], ['inputTextCommand', 0, 0, 2]),
    roundingPair(['scrollUntilVisible', 3, 0, 10], ['assertConditionCommand', 2, 8, 4]),
    roundingPair(['tapOnElement', 2, 0, 5], ['inputTextCommand', 0, 3, 3]),
    roundingPair(['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 4.5, 3]),
    roundingPair(['tapOnElement', 0, 0, 5.5], ['inputTextCommand', 0, 5, 3]),
  ]) {
    assert.throws(() => ingestCommands(records), /overlap/, JSON.stringify(records.map(r => r.metadata)));
  }
  const gap = roundingPair(['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 4, 3]);
  gap[1].metadata.sequenceNumber = 27;
  assert.doesNotThrow(() => ingestCommands(gap));
  const wideGap = roundingPair(['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 3, 3]);
  wideGap[1].metadata.sequenceNumber = 27;
  assert.throws(() => ingestCommands(wideGap), /overlap/);
  for (const status of ['FAILED', 'WARNED', 'RUNNING']) {
    for (const index of [0, 1]) {
      const pair = roundingPair(['tapOnElement', 0, 0, 5], ['inputTextCommand', 0, 4, 3]);
      pair[index].metadata.status = status;
      assert.throws(() => ingestCommands(pair), /overlap/, `${status} ${index}`);
    }
  }
  const failed = ingestCommands([...roundingPair(['defineVariablesCommand', 2, 0, 10],
    ['applyConfigurationCommand', 3, 9, 1]), record(27, 2010, 1, 'assertConditionCommand', {}, 'FAILED')]);
  assert.deepEqual(failed.assertions, {executed: 0, failed: 1, missing: 0});
  const missing = ingestCommands([...roundingPair(['defineVariablesCommand', 2, 0, 10],
    ['applyConfigurationCommand', 3, 9, 1]), record(27, 2010, 1, 'assertConditionCommand', {}, 'SKIPPED')]);
  assert.deepEqual(missing.assertions, {executed: 0, failed: 0, missing: 1});
});

const at = (sequence, timestamp, duration, type, depth, status = 'COMPLETED') => {
  const r = record(sequence, timestamp, duration, type, {}, status); r.metadata.depth = depth; return r;
};

test('1 ms rule accepts retained cohort-18b8b392 scan/05-background-discards shape (seq 48 depth 3 to seq 49 depth 2)', () => {
  // Real metadata: scrollUntilVisible ends 1792061171371; the next sequence, one
  // level shallower, starts in that last millisecond (1792061171370).
  const base = 1792061168673;
  const records = [
    at(47, base, 96, 'assertConditionCommand', 3),
    at(48, 1792061168770, 2601, 'scrollUntilVisible', 3),
    at(49, 1792061171370, 132, 'assertConditionCommand', 2),
    at(50, 1792061171502, 2, 'evalScriptCommand', 2),
  ];
  const result = ingestCommands(records);
  assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 96 + 2601 + 131 + 2);
  assert.deepEqual(result.assertions, {executed: 2, failed: 0, missing: 0});
});

test('1 ms rule accepts retained e2e31-rerun-04631f30 polish/01-sort shape (seq 211 depth 1 to seq 213 depth 0 across a wrapper)', () => {
  // Real metadata: the subflow's last assertion (seq 211) ends 1792079257581; the
  // next runFlowCommand wrapper (seq 212, depth 0) and its first leaf (seq 213,
  // depth 0) start 1792079257580.
  const records = [
    at(210, 1792079257317, 261, 'copyTextCommand', 1),
    at(211, 1792079257579, 2, 'assertConditionCommand', 1),
    at(212, 1792079257580, 7237, 'runFlowCommand', 0),
    at(213, 1792079257580, 1, 'defineVariablesCommand', 0),
    at(214, 1792079257581, 0, 'applyConfigurationCommand', 1),
    at(215, 1792079257581, 1, 'evalScriptCommand', 1),
  ];
  const result = ingestCommands(records);
  assert.deepEqual(result.commands, [
    {category: 'other', count: 2, elapsedMs: 261, status: 'passed'},
    {category: 'assertion', count: 1, elapsedMs: 2, status: 'passed'},
    {category: 'script', count: 2, elapsedMs: 1, status: 'passed'},
  ]);
  assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 0});
});

test('1 ms rule across records accepts any records between leaves but still rejects real conflicts', () => {
  const shape = () => [
    at(211, 1000, 2, 'assertConditionCommand', 1),
    at(212, 1001, 50, 'runFlowCommand', 0),
    at(213, 1001, 1, 'defineVariablesCommand', 0),
  ];
  assert.doesNotThrow(() => ingestCommands(shape()));
  // General ≤1 ms rule (2026-10-15): a skipped leaf (not a wrapper) or a
  // missing sequence number between them no longer matters.
  const skipped = shape(); skipped[1] = at(212, 1001, 0, 'tapOnElement', 0, 'SKIPPED');
  assert.doesNotThrow(() => ingestCommands(skipped));
  const gap = shape(); gap[2].metadata.sequenceNumber = 214;
  assert.doesNotThrow(() => ingestCommands(gap));
  // Two wrappers between them are still only wrappers.
  const nested = [at(211, 1000, 2, 'assertConditionCommand', 2), at(212, 1001, 50, 'runFlowCommand', 1),
    at(213, 1001, 50, 'repeatCommand', 1), at(214, 1001, 1, 'defineVariablesCommand', 1)];
  assert.doesNotThrow(() => ingestCommands(nested));
  // Two levels shallower is still a 1 ms rounding overlap.
  const deep = shape(); deep[0].metadata.depth = 2;
  assert.doesNotThrow(() => ingestCommands(deep));
  // More than 1 ms, failed or incomplete leaves still fail.
  const wide = shape(); wide[2].metadata.timestamp = 1000; wide[2].metadata.duration = 3;
  assert.throws(() => ingestCommands(wide), /overlap/);
  for (const status of ['FAILED', 'WARNED', 'RUNNING']) {
    for (const index of [0, 2]) {
      const bad = shape(); bad[index].metadata.status = status;
      assert.throws(() => ingestCommands(bad), /overlap/, `${status} ${index}`);
    }
  }
});

test('general ≤1 ms rule accepts retained widened-rounding-f7cfa395 mvp/02-setup-errors shape (seq 98 vs 100 past zero-duration 99)', () => {
  // Real metadata: defineVariablesCommand seq 98 (depth 0) ends 1792091494047; the
  // zero-duration applyConfigurationCommand seq 99 and evalScriptCommand seq 100
  // (both depth 1) start 1792091494046, so leaf 100 overlaps non-adjacent leaf 98 by 1 ms.
  const records = [
    at(95, 1792091493139, 128, 'assertConditionCommand', 0),
    at(96, 1792091493267, 772, 'assertConditionCommand', 0),
    at(97, 1792091494040, 143431, 'runFlowCommand', 0),
    at(98, 1792091494041, 6, 'defineVariablesCommand', 0),
    at(99, 1792091494046, 0, 'applyConfigurationCommand', 1),
    at(100, 1792091494046, 1, 'evalScriptCommand', 1),
    at(101, 1792091494047, 1, 'evalScriptCommand', 1),
    at(102, 1792091494048, 1, 'evalScriptCommand', 1),
    at(103, 1792091494049, 1, 'evalScriptCommand', 1),
  ];
  const result = ingestCommands(records);
  assert.deepEqual(result.commands, [
    {category: 'assertion', count: 2, elapsedMs: 900, status: 'passed'},
    {category: 'script', count: 5, elapsedMs: 9, status: 'passed'},
    {category: 'other', count: 1, elapsedMs: 0, status: 'passed'},
  ]);
  assert.deepEqual(result.assertions, {executed: 2, failed: 0, missing: 0});
});

test('general ≤1 ms rule ignores depth, adjacency and records between completed leaves', () => {
  for (const records of [
    // Two levels shallower and two levels deeper.
    [at(1, 1000, 5, 'tapOnElement', 2), at(2, 1004, 3, 'inputTextCommand', 0)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1004, 3, 'inputTextCommand', 3)],
    // A missing sequence number, a skipped leaf, or another completed leaf between them.
    [at(1, 1000, 5, 'tapOnElement', 0), at(3, 1004, 3, 'inputTextCommand', 0)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1004, 0, 'tapOnElement', 0, 'SKIPPED'),
      at(3, 1004, 3, 'inputTextCommand', 0)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1004, 0, 'tapOnElement', 1),
      at(3, 1004, 3, 'inputTextCommand', 1)],
  ]) {
    const result = ingestCommands(records);
    assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 7, JSON.stringify(records.map(r => r.metadata)));
  }
});

test('general ≤1 ms rule charges a millisecond shared by several earlier leaves only once', () => {
  // A [0,5], B [4,5] and C [4,6] all share millisecond [4,5]; the union is [0,6].
  const result = ingestCommands([at(1, 2000, 5, 'tapOnElement', 0), at(2, 2004, 1, 'tapOnElement', 1),
    at(3, 2004, 2, 'tapOnElement', 0)]);
  assert.deepEqual(result.commands, [{category: 'action', count: 3, elapsedMs: 6, status: 'passed'}]);
});

test('general ≤1 ms rule still rejects >1 ms, fractional and failed, warned or running overlaps anywhere', () => {
  for (const records of [
    [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1003, 3, 'inputTextCommand', 0)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(3, 1003, 3, 'inputTextCommand', 2)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1004, 0, 'tapOnElement', 1), at(3, 1002, 3, 'inputTextCommand', 1)],
    [at(1, 1000, 5, 'tapOnElement', 0), at(3, 1004.5, 3, 'inputTextCommand', 2)],
    [at(1, 1000, 4.5, 'tapOnElement', 0), at(3, 1004, 3, 'inputTextCommand', 2)],
  ]) {
    assert.throws(() => ingestCommands(records), /overlap/, JSON.stringify(records.map(r => r.metadata)));
  }
  for (const status of ['FAILED', 'WARNED', 'RUNNING']) {
    for (const index of [0, 2]) {
      const records = [at(1, 1000, 5, 'tapOnElement', 0), at(2, 1004, 0, 'tapOnElement', 1),
        at(3, 1004, 3, 'inputTextCommand', 2)];
      records[index].metadata.status = status;
      assert.throws(() => ingestCommands(records), /overlap/, `${status} ${index}`);
    }
  }
});

// Pinned Maestro 2.10.0 records one executedSteps entry per attempt: a fired
// retry's failed first attempt stays in commands.json with its own sequence.
const retryAttempts = ({failAt = 'read', retryStatus = 'COMPLETED', secondRead = 'COMPLETED'} = {}) => {
  const at = (sequence, timestamp, duration, type, payload, depth, status = 'COMPLETED') => {
    const r = record(sequence, timestamp, duration, type, payload, status); r.metadata.depth = depth; return r;
  };
  const thumb = {selector: {idRegex: 'files.scroller.thumb', optional: false}, optional: false};
  const visible = {condition: {visible: {idRegex: 'files.scroller.thumb', optional: false}}, timeout: '15000', optional: false};
  const swipe = {startRelative: '50%, 80%', endRelative: '50%, 20%', waitToSettleTimeoutMs: 50, optional: false};
  const first = failAt === 'show'
    ? [at(12, 5002, 300, 'swipeCommand', swipe, 3), at(13, 5303, 90, 'assertConditionCommand', visible, 3, 'FAILED')]
    : [at(12, 5002, 300, 'swipeCommand', swipe, 3), at(13, 5303, 90, 'assertConditionCommand', visible, 3),
      at(14, 5402, 1000, 'copyTextCommand', thumb, 2, 'FAILED')];
  return [
    at(10, 5000, 3000, 'retryCommand', {maxRetries: '2', commands: []}, 1, retryStatus),
    at(11, 5001, 400, 'runFlowCommand', {commands: []}, 2, failAt === 'show' ? 'FAILED' : 'COMPLETED'),
    ...first,
    at(15, 6403, 400, 'runFlowCommand', {commands: []}, 2),
    at(16, 6404, 300, 'swipeCommand', swipe, 3),
    at(17, 6705, 90, 'assertConditionCommand', visible, 3),
    at(18, 6800, 20, 'copyTextCommand', thumb, 2, secondRead),
    at(19, 8001, 5, 'assertConditionCommand', visible, 1),
  ];
};

test('a failed leaf inside a completed retry whose later attempt completed is recovered, its time still charged', () => {
  const read = ingestCommands(retryAttempts());
  assert.deepEqual(read.commands, [
    {category: 'action', count: 2, elapsedMs: 600, status: 'passed'},
    {category: 'assertion', count: 3, elapsedMs: 185, status: 'passed'},
    {category: 'other', count: 2, elapsedMs: 1020, status: 'passed'},
  ]);
  assert.deepEqual(read.assertions, {executed: 3, failed: 0, missing: 0});
  const show = ingestCommands(retryAttempts({failAt: 'show'}));
  assert.deepEqual(show.commands, [
    {category: 'action', count: 2, elapsedMs: 600, status: 'passed'},
    {category: 'assertion', count: 3, elapsedMs: 185, status: 'passed'},
    {category: 'other', count: 1, elapsedMs: 20, status: 'passed'},
  ]);
  assert.deepEqual(show.assertions, {executed: 2, failed: 0, missing: 0});
});

test('recovered-retry rule never hides failures outside a retry, failed retries or unrecovered attempts', () => {
  const failedIn = (records, category) => ingestCommands(records).commands
    .some(c => c.category === category && c.status !== 'passed');
  // Retry that ends FAILED: every attempt failure stays a failure.
  const exhausted = retryAttempts({retryStatus: 'FAILED', secondRead: 'FAILED'});
  assert.ok(failedIn(exhausted, 'other'));
  const exhaustedShow = retryAttempts({failAt: 'show', retryStatus: 'FAILED'});
  assert.deepEqual(ingestCommands(exhaustedShow).assertions, {executed: 2, failed: 1, missing: 0});
  // Completed retry but no later completed attempt of the same command.
  assert.ok(failedIn(retryAttempts({secondRead: 'FAILED'}), 'other'));
  const different = retryAttempts();
  different[8].command = {copyTextCommand: {selector: {idRegex: 'files.other', optional: false}, optional: false}};
  assert.ok(failedIn(different, 'other'));
  // Failure outside the retry's time span or sequence range.
  const after = retryAttempts();
  after[9].metadata.status = 'FAILED';
  assert.deepEqual(ingestCommands(after).assertions, {executed: 2, failed: 1, missing: 0});
  const late = retryAttempts();
  late[4].metadata.timestamp = 7995; late[4].metadata.duration = 6;
  assert.ok(failedIn(late, 'other'));
  const before = retryAttempts();
  before[0].metadata.sequenceNumber = 14; before[4].metadata.sequenceNumber = 10;
  assert.ok(failedIn(before, 'other'));
  const sibling = retryAttempts();
  // A same-depth sibling closes the retry's sequence range before the failure.
  sibling.push(record(14, 4000, 1, 'tapOnElement'));
  sibling.at(-1).metadata.depth = 1; sibling[4].metadata.sequenceNumber = 20;
  assert.ok(failedIn(sibling, 'other'));
  // A later completed attempt outside the retry does not recover it.
  const outside = retryAttempts();
  outside[8].metadata.timestamp = 8010; outside[8].metadata.sequenceNumber = 20; outside[8].metadata.depth = 1;
  assert.ok(failedIn(outside, 'other'));
  // Only non-optional FAILED leaves can be recovered; WARNED/RUNNING stay failures.
  for (const status of ['WARNED', 'RUNNING']) {
    const records = retryAttempts(); records[4].metadata.status = status;
    if (status === 'RUNNING') { delete records[4].metadata.duration; }
    assert.ok(ingestCommands(records).commands.some(c => c.category === 'other' && c.status !== 'passed'), status);
  }
  const optional = retryAttempts();
  optional[4].command.copyTextCommand.optional = true; optional[8].command.copyTextCommand.optional = true;
  assert.ok(failedIn(optional, 'other'));
  // Missing mandatory assertions inside a completed retry stay missing.
  const missing = retryAttempts();
  missing.push(record(21, 5500, 1, 'assertConditionCommand', {optional: false}, 'SKIPPED'));
  assert.equal(ingestCommands(missing).assertions.missing, 1);
});

test('optional completed assertions never count as mandatory evidence; skipped required ones stay missing', () => {
  const result = ingestCommands([
    record(0, 1, 1, 'assertConditionCommand', {optional: true}),
    record(1, 2, 1, 'assertConditionCommand', {optional: false}, 'SKIPPED'),
    record(2, 3, 1),
  ]);
  assert.deepEqual(result.assertions, {executed: 1, failed: 0, missing: 1});
});

test('passed records require executed assertions and successful restoration', () => {
  for (const mutate of [
    run => { run.apiRuns[0].samples[0].assertions.executed = 0; },
    run => { run.fixtureSet.restoration = 'failed'; },
    run => { run.apiRuns[0].samples[0].commands = [{category: 'input', count: 1, elapsedMs: 1, status: 'failed'}]; },
  ]) {
    const run = syntheticRun(); mutate(run);
    assert.throws(() => validateRun(run), /invalid-success/);
  }
});

test('failed invocation, API, audit, restoration and phase evidence cannot yield matched comparisons', () => {
  for (const mutate of [
    run => { run.status = 'failed'; run.failureCode = 'audit'; },
    run => { run.status = 'interrupted'; run.failureCode = 'interrupted'; },
    run => { run.status = 'running'; },
    run => { run.status = 'failed'; run.apiRuns[0].status = 'failed'; },
    run => { run.status = 'failed'; run.fixtureSet.restoration = 'failed'; },
    run => { run.status = 'failed'; run.fixtureSet.restoration = 'unknown'; },
    run => { run.status = 'failed'; run.sharedPhases = [{segmentId: 'seg-audit', phase: 'cleanup',
      startNs: '0', endNs: '1000000', elapsedMs: 1, status: 'failed'}]; },
  ]) {
    const after = syntheticRun(); mutate(after);
    const comparison = compareRuns([syntheticRun()], [after]);
    assert.equal(comparison.complete, false);
    assert.equal(comparison.rows[0].status, 'incomplete');
    assert.ok(comparison.rows[0].reasons.includes('failed-or-incomplete-lifecycle'));
  }
});

test('workspace proof is required separately in every expected artifact, not pooled', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-artifact-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const raw = join(directory, 'raw/raw-workspace/output');
  await mkdir(raw, {recursive: true});
  const run = syntheticRun(); run.status = 'running';
  const cli = () => spawnSync(process.execPath,
    [new URL('./performance-report.mjs', import.meta.url).pathname, 'artifact',
      directory, '31', 'raw-workspace', 'none', '0', '0', '1000000', '0', '2'],
    {encoding: 'utf8'});
  for (const second of [
    [record(0, 1, 1, 'tapOnElement')],
    [record(0, 1, 1, 'assertConditionCommand', {optional: true})],
    [record(0, 1, 1, 'assertConditionCommand', {}, 'SKIPPED')],
  ]) {
    await writeFile(join(directory, 'record.private.json'), JSON.stringify(run));
    await writeFile(join(raw, 'commands-a.json'), JSON.stringify([record(0, 1, 1), record(1, 2, 1)]));
    await writeFile(join(raw, 'commands-b.json'), JSON.stringify(second));
    assert.equal(cli().status, 1);
    const result = JSON.parse(await readFile(join(directory, 'record.private.json')));
    assert.equal(result.apiRuns[0].acceptance.at(-1).status, 'failed');
  }
  await writeFile(join(directory, 'record.private.json'), JSON.stringify(run));
  await writeFile(join(raw, 'commands-b.json'), JSON.stringify([record(0, 1, 1)]));
  assert.equal(cli().status, 0);
});

test('audit-failed evidence emits an incomplete CLI comparison and exits nonzero', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-comparison-test-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  for (const side of ['before', 'after']) { await mkdir(join(directory, side)); }
  const after = syntheticRun(80); after.status = 'failed'; after.failureCode = 'audit';
  await writeFile(join(directory, 'before/run.json'), JSON.stringify(syntheticRun()));
  await writeFile(join(directory, 'after/run.json'), JSON.stringify(after));
  const output = join(directory, 'comparison.json');
  const result = spawnSync(process.execPath,
    [new URL('./performance-report.mjs', import.meta.url).pathname, '--before', join(directory, 'before'),
      '--after', join(directory, 'after'), '--output', output], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  const comparison = JSON.parse(await readFile(output, 'utf8'));
  assert.equal(comparison.complete, false);
  assert.ok(comparison.rows.every(r => r.status === 'incomplete' && r.afterMedianMs === null));
});

test('reports validate acceleration records; incomplete calibration is provisional and never stored as ranked', async t => {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-rank-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const run = syntheticRun();
  const a = run.apiRuns[0];
  const calibrated = (candidateId, count) => ({candidateId, status: count === 24 ? 'measured' : 'measurement-failed',
    reason: count === 24 ? null : 'measurement-failed', profileFingerprint: digest, verified: true,
    samples: a.samples.slice(0, count).map(s => ({...s, sampleId: `${s.sampleId}-${candidateId}`}))});
  a.acceleration = {requestedProfile: 'auto', kvm: {usable: true, reason: null},
    candidates: [{candidateId: 'host-intel-1', kind: 'hardware', vendor: 'intel', status: 'discovered',
      reason: null, deviceId: '8086:7d55', driver: 'i915'}],
    attempts: [{candidateId: 'software-swiftshader', request: 'swiftshader', state: 'selected', reason: null,
      backend: 'swiftshader', vulkan: 'enabled'}],
    fallback: false, selection: null,
    calibration: [calibrated('software-swiftshader', 24), calibrated('host-intel-1', 23)]};
  assert.doesNotThrow(() => validateRun(run));
  assert.throws(() => validateRun({...run, apiRuns: [{...a, acceleration: {...a.acceleration, extra: true}}, run.apiRuns[1]]}), /unknown-metadata/);
  assert.throws(() => validateRun({...run, apiRuns: [{...a, acceleration: {...a.acceleration,
    attempts: [{...a.acceleration.attempts[0], reason: 'emulator: /home/user/raw'}]}}, run.apiRuns[1]]}), /invalid-acceleration/);
  const snapshot = {kind: 'software', complexity: 4, profile: a.profile, image: a.image, resources: a.resources,
    animations: a.animations, acceleration: {requestedProfile: 'auto', kvm: a.acceleration.kvm,
      candidates: a.acceleration.candidates, attempts: a.acceleration.attempts}};
  // One candidate per invocation; both share the per-API round in the store.
  const planned = ['software-swiftshader', 'host-intel-1'];
  const invoke = async (name, entry, kind, continueRound) => {
    const directory = join(root, 'reports', name);
    await mkdir(directory, {recursive: true});
    const record = structuredClone(run);
    record.apiRuns[0].acceleration.calibration = [entry];
    // rank runs before finish, while the invocation is still running.
    record.status = 'running'; record.apiRuns[0].status = 'running';
    await writeFile(join(directory, 'record.private.json'), JSON.stringify(record));
    await writeFile(join(directory, 'calibration.private.json'), JSON.stringify({active: null,
      plans: {31: {planned, preBootInputs: {}, continueRound}},
      candidates: {[`31:${entry.candidateId}`]: {...snapshot, kind, complexity: kind === 'hardware' ? 6 : 4}}}));
    const result = spawnSync(process.execPath, [reporter, 'rank', directory, '31', root], {encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(await readFile(join(directory, 'record.private.json'), 'utf8')).apiRuns[0];
  };
  let own = await invoke('first', calibrated('host-intel-1', 23), 'hardware', false);
  assert.equal(own.acceleration.selection.status, 'provisional');
  assert.equal(own.acceleration.selection.rankedCandidateId, null);
  assert.equal(own.samples.length, 23);
  own = await invoke('second', calibrated('software-swiftshader', 24), 'software', true);
  const ranked = own.acceleration.selection;
  assert.equal(ranked.status, 'provisional');
  assert.equal(ranked.selectedCandidateId, 'software-swiftshader');
  assert.equal(ranked.rankedCandidateId, null);
  assert.deepEqual(ranked.order.map(o => [o.candidateId, o.status]),
    [['software-swiftshader', 'measured'], ['host-intel-1', 'measurement-failed']]);
  const store = JSON.parse(await readFile(join(root, 'reports', 'acceleration-ranking.json'), 'utf8'));
  assert.deepEqual(store.apis, {});
  assert.deepEqual(store.calibrations['31'].results.map(r => [r.candidateId, r.status]),
    [['host-intel-1', 'measurement-failed'], ['software-swiftshader', 'measured']]);
  // A calibrating invocation must hold exactly one planned candidate.
  const directory = join(root, 'reports', 'third');
  await mkdir(directory, {recursive: true});
  await writeFile(join(directory, 'record.private.json'), JSON.stringify(run));
  await writeFile(join(directory, 'calibration.private.json'), JSON.stringify({active: null,
    plans: {31: {planned, preBootInputs: {}, continueRound: false}}, candidates: {}}));
  const rejected = spawnSync(process.execPath, [reporter, 'rank', directory, '31', root], {encoding: 'utf8'});
  assert.notEqual(rejected.status, 0);
});
