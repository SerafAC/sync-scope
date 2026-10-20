// Feature 008, T039/T040: the configuration probe stays outside the workspace
// and the runner, rejects other options before acquiring anything, restores
// the animation scales it changed, keeps cohorts separate and keeps failures.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { summarizeDirectory } from './configuration-probe.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const driver = join(repo, 'scripts/validation/configuration-probe.sh');
const CANARY = 'synthetic-canary-credential-5d1c';

test('the probe driver rejects other options before acquiring anything', () => {
  for (const args of [
    [],
    ['--out', '/tmp/elsewhere'],
    ['--out', 'validation/evidence/performance/configuration/../escape'],
    ['--out', 'validation/evidence/performance/configuration/x', '--api', '30'],
    ['--out', 'validation/evidence/performance/configuration/x', '--api', '36', '--api', '36'],
    ['--out', 'validation/evidence/performance/configuration/x', '--flow', 'scan/01-clean-scan-ftp.yaml'],
    ['--out', 'validation/evidence/performance/configuration/x', '--animations', '0'],
    ['--out', 'validation/evidence/performance/configuration/x', '--pacing', '500'],
  ]) {
    const result = spawnSync('sh', [driver, ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, ANDROID_HOME: '/nonexistent' },
    });
    assert.equal(result.status, 64, `${args.join(' ')}: ${result.stderr}`);
  }
});

test('the probe stays out of the workspace and the runner; it restores what it changed', async () => {
  const config = await readFile(join(repo, 'validation/maestro/config.yaml'), 'utf8');
  assert.doesNotMatch(config, /configuration-probe/);
  const runner = await readFile(join(repo, 'scripts/validation/android-flow.sh'), 'utf8');
  assert.doesNotMatch(runner, /configuration-probe|--animations|--pacing/);
  const source = await readFile(driver, 'utf8');
  // The scales found at boot are recorded before any change and restored in
  // cleanup (also on failure) and at the end of each API.
  assert.ok(source.indexOf('found_scales="$claims/animations-$api"') < source.indexOf('run_cohort A'));
  assert.match(source.slice(source.indexOf('cleanup() {'), source.indexOf('trap cleanup EXIT')), /restore_animations/);
  assert.match(source, /restore_animations "\$api"\n\s+if \[ "\$\(validation_read_receipt/);
  // The pacing change is made in a private tree copy only, and exactly once per flow.
  assert.match(source, /grep -c 'SCAN_DELAY_MS: "4000"'/);
  assert.match(source, /"\$out\/trees\/pace-1000\/scan\/01-clean-scan-\$protocol\.yaml"/);
  // adb inside a loop reading the saved scales must not consume that input.
  const restore = source.slice(source.indexOf('restore_animations() {'), source.indexOf('cleanup() {'));
  for (const line of restore.split('\n').filter(item => item.includes('shell settings'))) {
    assert.match(line, /<\/dev\/null/, line);
  }
  // The clock variables are not ones validation_save_pid assigns.
  assert.doesNotMatch(source, /^\s*(?:start|end)=\$\(clock\)/m);
});

test('the summary keeps failures, never pools cohorts and never copies credentials', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'configuration-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const rows = [
    ['31', 'A', '1/1/1', '4000', 'scan/01-clean-scan-ftp.yaml', '1', '0', '0', '90000000000', 'run-31-1'],
    ['31', 'B', '0/0/0', '4000', 'scan/01-clean-scan-ftp.yaml', '1', '0', '0', '60000000000', 'run-31-2'],
    ['31', 'D', '0/0/0', '1000', 'scan/01-clean-scan-ftp.yaml', '1', '1', '0', '30000000000', 'run-31-3'],
    ['31', 'A', '1/1/1', '4000', `../${CANARY}.yaml`, '1', '0', '0', '1000000000', 'run-31-4'],
  ];
  await writeFile(join(directory, 'runs.tsv'),
    `api\tcohort\tanimations\tpacingMs\tflow\trepetition\tstatus\tstartNs\tendNs\tartifact\n${rows.map(r => r.join('\t')).join('\n')}\n`);
  const result = await summarizeDirectory(directory, '0');
  assert.equal(result.runs.length, 4);
  const byCohort = Object.fromEntries(result.summary
    .filter(row => row.flow === 'scan/01-clean-scan-ftp.yaml').map(row => [row.cohort, row]));
  assert.equal(byCohort.A.medianWallMs, 90000);
  assert.equal(byCohort.B.medianWallMs, 60000);
  assert.deepEqual([byCohort.D.passed, byCohort.D.runs, byCohort.D.medianWallMs], [0, 1, null]);
  for (const name of ['results.json', 'summary.md']) {
    assert.doesNotMatch(await readFile(join(directory, name), 'utf8'), new RegExp(CANARY));
  }
});

test('fixture cost compares a forced reseed with a validation of the same trees (T043)', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'configuration-probe-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'runs.tsv'),
    'api\tcohort\tanimations\tpacingMs\tflow\trepetition\tstatus\tstartNs\tendNs\tartifact\n');
  await writeFile(join(directory, 'fixtures.tsv'),
    '31\treseed\t0\t300000000000\n31\tvalidate\t300000000000\t340000000000\n');
  const result = await summarizeDirectory(directory, '0');
  assert.deepEqual(result.fixtures, [
    { api: 31, pass: 'reseed', wallMs: 300000 },
    { api: 31, pass: 'validate', wallMs: 40000 },
  ]);
  assert.match(await readFile(join(directory, 'summary.md'), 'utf8'), /\| 31 \| validate \| 40\.0 \|/);
  const source = await readFile(driver, 'utf8');
  // Markers are removed before the reseed pass, which precedes the validation pass.
  assert.ok(source.indexOf('shell rm -rf /data/local/tmp/syncscope-fixtures') <
    source.indexOf('for fixture_pass in reseed validate'));
});

test('cleanup stops or audits FTP with its approved passive range', async () => {
  const source = await readFile(driver, 'utf8');
  const cleanup = source.slice(source.indexOf('cleanup() {'), source.indexOf('trap cleanup EXIT'));
  assert.match(cleanup, /ftp\) port=32120; passive='--passive-ports 32200-32209' ;;/);
  assert.match(cleanup, /--port "\$port" \$passive \|\|/);
});
