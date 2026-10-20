// Feature 008, T035: the field-selection probe stays outside the workspace,
// rejects anything but its fixed options before acquiring a resource, and
// summarizes helper costs without typed values or credentials.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { helperCalls, summarizeDirectory } from './field-selection-probe.mjs';
import { loadFlow, walkFlow } from './maestro-model.test-support.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const probes = join(repo, 'validation/probes/field-selection');
const driver = join(repo, 'scripts/validation/field-selection-probe.sh');
const CANARY = 'synthetic-canary-credential-91f2';

function record(sequence, command, duration = 10, status = 'COMPLETED', depth = 0) {
  return { command, metadata: { status, timestamp: sequence, duration, sequenceNumber: sequence, depth } };
}
const helper = (sequence, field, duration, status) => record(sequence, {
  runFlowCommand: {
    commands: [{ defineVariablesCommand: { env: { FIELD: field, TEXT: CANARY } } }],
  },
}, duration, status, 1);

test('helper calls keep the field, duration and status only', () => {
  const calls = helperCalls([
    record(0, { defineVariablesCommand: { env: { SFTP_PASSWORD: CANARY } } }),
    helper(3, 'repository.password', 1200, 'COMPLETED'),
    record(4, { runFlowCommand: { commands: [{ tapOnElement: {} }] } }),
    helper(1, 'repository.host', 900, 'COMPLETED'),
    helper(5, '../../etc', 5, 'FAILED'),
  ]);
  assert.deepEqual(calls, [
    { field: 'repository.host', ms: 900, status: 'COMPLETED' },
    { field: 'repository.password', ms: 1200, status: 'COMPLETED' },
    { field: 'unknown-field', ms: 5, status: 'FAILED' },
  ]);
  assert.doesNotMatch(JSON.stringify(calls), new RegExp(CANARY));
});

test('the summary keeps failed runs and never copies typed values', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'field-selection-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rows = [
    ['31', 'diagnostic', 'd03-select-all-short.yaml', '-', '1', '0', '0', '2000000000', 'run-31-1'],
    ['31', 'regression', '01-field-replacement.yaml', 'original', '1', '1', '0', '9000000000', 'run-31-2'],
    ['31', 'regression', '01-field-replacement.yaml', 'candidate', '1', '0', '0', '4000000000', 'run-31-3'],
  ];
  await writeFile(join(directory, 'runs.tsv'),
    `api\tkind\tflow\ttree\trepetition\tstatus\tstartNs\tendNs\tartifact\n${rows.map(r => r.join('\t')).join('\n')}\n`);
  for (const [artifact, duration] of [['run-31-2', 25000], ['run-31-3', 3000]]) {
    const output = join(directory, 'raw', artifact, 'output', 'stamp', 'performance_01');
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'commands.json'), JSON.stringify([
      record(0, { defineVariablesCommand: { env: { SFTP_PASSWORD: CANARY } } }),
      helper(1, 'repository.host', duration, 'COMPLETED'),
      helper(2, 'repository.port', duration, 'COMPLETED'),
    ]));
  }
  const result = await summarizeDirectory(directory, '0');
  assert.equal(result.runs.length, 3);
  assert.equal(result.runs[1].passed, false, 'the failed run is kept as failed');
  assert.equal(result.runs[2].helperTotalMs, 6000);
  const candidate = result.summary.find(row => row.tree === 'candidate');
  assert.deepEqual(candidate, { api: 31, tree: 'candidate', runs: 1, passed: 1, medianWallMs: 4000, medianHelperMs: 6000 });
  const original = result.summary.find(row => row.tree === 'original');
  assert.equal(original.passed, 0);
  assert.equal(original.medianWallMs, null);
  for (const name of ['results.json', 'summary.md']) {
    assert.doesNotMatch(await readFile(join(directory, name), 'utf8'), new RegExp(CANARY));
  }
});

test('probe flows parse with the pinned subset and stay outside the workspace', async () => {
  const flows = (await readdir(probes)).filter(name => name.endsWith('.yaml'));
  assert.ok(flows.filter(name => /^d\d\d-/.test(name)).length >= 10);
  for (const name of flows) {
    loadFlow(join(probes, name));
    [...walkFlow(join(probes, name))];
  }
  const config = await readFile(join(repo, 'validation/maestro/config.yaml'), 'utf8');
  assert.doesNotMatch(config, /probes|field-selection|original-fill-field/);
  const runner = await readFile(join(repo, 'scripts/validation/android-flow.sh'), 'utf8');
  assert.doesNotMatch(runner, /field-selection|--flow/, 'the runner gets no probe option');
});

const REGEX_LITERAL_IN_SCRIPT = /\$\{(?:[^}\n]*?[\s(!=&|,?:])?\/[^/\s*]/;

test('the regular-expression literal check catches the first probe\'s scripts', () => {
  for (const script of ['"${/^•{9}$/.test(maestro.copiedText)}"', '"${a || (/^•+$/.test(b))}"']) {
    assert.match(script, REGEX_LITERAL_IN_SCRIPT, script);
  }
  assert.doesNotMatch('"${Math.ceil(output.fillLength / 32)}"', REGEX_LITERAL_IN_SCRIPT);
});

test('probe scripts use no regular-expression literal (the pinned engine rejects a leading one)', async () => {
  for (const name of (await readdir(probes)).filter(item => item.endsWith('.yaml'))) {
    const source = await readFile(join(probes, name), 'utf8');
    assert.doesNotMatch(source, REGEX_LITERAL_IN_SCRIPT, name);
  }
});

test('the retained original helper is the pre-T036 helper and still fails the T029 matrix', () => {
  // The probe compares the workspace helper with this retained original.
  const original = join(probes, 'original-fill-field.yaml');
  const source = spawnSync('git', ['show', 'fcdb8ca87ea43b0e52ab1f0c0ac40fe94f959191:validation/maestro/subflows/fill-field.yaml'],
    { cwd: repo, encoding: 'utf8' });
  if (source.status === 0) {
    assert.equal(readFileSync(original, 'utf8'), source.stdout);
  }
  const result = spawnSync(process.execPath, ['--test', join(repo, 'scripts/validation/performance-helpers.test.mjs')], {
    cwd: repo,
    encoding: 'utf8',
    // A nested runner reports to this one (exit 0) unless its context is cleared.
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
      SYNCSCOPE_FILL_FIELD_HELPER: original },
  });
  assert.notEqual(result.status, 0, 'the original helper leaves part of a long root');
});

test('each probe run times itself with variables the lifecycle helpers never assign', async () => {
  // validation_save_pid (validation-lifecycle.sh) sets the global `start` to
  // the process start time in clock ticks; the first probe's wall times were
  // computed from it (probe-0d4fb092b2d1015674004889).
  const lifecycle = await readFile(join(repo, 'scripts/validation/validation-lifecycle.sh'), 'utf8');
  const assigned = new Set([...lifecycle.matchAll(/^\s*([a-z_][a-z0-9_]*)=/gm)].map(match => match[1]));
  const source = await readFile(driver, 'utf8');
  const clocked = [...source.matchAll(/^\s*([a-z_][a-z0-9_]*)=\$\(clock\)/gm)].map(match => match[1]);
  assert.ok(clocked.length >= 2, 'the probe reads the clock before and after each run');
  for (const name of clocked) {
    assert.ok(!assigned.has(name), `${name} is also assigned by validation-lifecycle.sh`);
  }
});

test('the probe driver rejects other options before acquiring anything', () => {
  for (const args of [
    [],
    ['--out', '/tmp/elsewhere'],
    ['--out', 'validation/evidence/performance/field-selection/../escape'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--api', '30'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--api', '31', '--api', '31'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--flow', 'mvp/01-setup-sftp.yaml'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--repetitions', '1'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--candidate-only', '--candidate-only'],
    ['--out', 'validation/evidence/performance/field-selection/x', '--candidate-only=1'],
  ]) {
    const result = spawnSync('sh', [driver, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ANDROID_HOME: '/nonexistent', PATH: process.env.PATH },
    });
    assert.equal(result.status, 64, `${args.join(' ')}: ${result.stderr}`);
  }
});
