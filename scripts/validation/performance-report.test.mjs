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

test('millisecond quantization clips only adjacent sequential leaf boundaries, never real conflicts', () => {
  const result = ingestCommands([
    record(0, 1000, 10, 'inputTextCommand'), record(1, 1009, 8),
    record(2, 1016, 5, 'tapOnElement'),
  ]);
  assert.equal(result.commands.reduce((sum, c) => sum + c.elapsedMs, 0), 21);
  for (const records of [
    [record(0, 1000, 10), record(1, 1008, 8)],
    [record(0, 1000, 10), record(1, 1000, 1)],
    [record(0, 1000, 10), record(1, 1009, 0.5)],
  ]) {
    assert.throws(() => ingestCommands(records), /overlap/);
  }
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
