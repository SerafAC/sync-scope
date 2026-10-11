import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmod, cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';

const repository = new URL('../../', import.meta.url).pathname;
async function executable(path, contents) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `#!/bin/sh\nset -eu\n${contents}\n`, {mode: 0o700});
  await chmod(path, 0o700);
}

// A disposable copy, not path-rewriting production sources. Every external tool,
// state directory, SDK, home, clock and fixture generator is isolated here.
async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-performance-test-'));
  const cleanups = [];
  t.after(async () => {
    for (const cleanup of cleanups.reverse()) { await cleanup(); }
    await rm(root, {recursive: true, force: true});
  });
  const repo = join(root, 'repo');
  await mkdir(join(repo, 'scripts'), {recursive: true});
  await cp(join(repository, 'scripts/validation'), join(repo, 'scripts/validation'), {recursive: true});
  await cp(join(repository, 'validation/maestro'), join(repo, 'validation/maestro'), {recursive: true});
  await cp(join(repository, 'validation/performance'), join(repo, 'validation/performance'), {recursive: true});
  await cp(join(repository, 'validation/services'), join(repo, 'validation/services'), {recursive: true});
  await cp(join(repository, 'package.json'), join(repo, 'package.json'));
  const bin = join(root, 'bin'), state = join(root, 'state');
  await mkdir(bin);
  await mkdir(state);
  const calls = join(root, 'calls');
  await writeFile(calls, '');
  await writeFile(join(root, 'meminfo'), 'MemAvailable: 24000000 kB\nMemTotal: 32000000 kB\n');
  const env = {...process.env, HOME: root, ANDROID_HOME: join(root, 'sdk'),
    PATH: `${bin}:${process.env.PATH}`, SYNCSCOPE_VALIDATION_STATE_DIR: state,
    SYNCSCOPE_MAESTRO_BIN: join(bin, 'maestro'), SYNCSCOPE_CLOCK_BIN: join(bin, 'clock'),
    SYNCSCOPE_TEST_CALLS: calls, SYNCSCOPE_TEST_ROOT: root,
    SYNCSCOPE_MEMINFO_FILE: join(root, 'meminfo'),
    SYNCSCOPE_VALIDATION_REPORT_DIR: join(root, 'reports')};
  await executable(join(bin, 'clock'), `
n=0; [ ! -f "$SYNCSCOPE_TEST_ROOT/tick" ] || n=$(cat "$SYNCSCOPE_TEST_ROOT/tick")
n=$((n + 1000000)); printf '%s\\n' "$n" >"$SYNCSCOPE_TEST_ROOT/tick"; printf '%s\\n' "$n"`);
  await executable(join(bin, 'pnpm'), '[ "${1:-}" != --version ] || { printf "11.3.0\\n"; exit 0; }\nprintf "pnpm\\n" >>"$SYNCSCOPE_TEST_CALLS"');
  await executable(join(bin, 'docker'), 'printf "29.8.1\\n"');
  await executable(join(bin, 'java'), 'printf "26.0.2\\n"');
  await executable(join(bin, 'timeout'), `
while [ "$#" -gt 0 ]; do case "$1" in --*) shift ;; [0-9]*) shift; break ;; *) break ;; esac; done
exec "$@"`);
  await executable(join(bin, 'maestro'), `
[ "\${1:-}" != --version ] || { printf '2.10.0\\n'; exit 0; }
printf 'maestro\\n' >>"$SYNCSCOPE_TEST_CALLS"
output=; flow=
while [ "$#" -gt 0 ]; do
  case "$1" in --test-output-dir) output=$2; shift 2 ;; --debug-output|-e) shift 2 ;;
    *) flow=$1; shift ;; esac
done
printf '%s\\n' "$flow" >>"$SYNCSCOPE_TEST_CALLS"
[ -n "$output" ] || exit 73
[ "\${FAKE_MISSING_ARTIFACT:-0}" != 1 ] || exit 0
mkdir -p "$output"
count=1
[ "$flow" != "$SYNCSCOPE_TEST_ROOT/repo/validation/maestro" ] || count=39
i=1
while [ "$i" -le "$count" ]; do
  printf '%s\\n' '[{"command":{"assertConditionCommand":{}},"metadata":{"status":"COMPLETED","timestamp":1,"duration":1,"sequenceNumber":0,"depth":0}}]' >"$output/commands-$i.json"
  i=$((i + 1))
done
exit "\${FAKE_MAESTRO_STATUS:-0}"`);
  await executable(join(env.ANDROID_HOME, 'platform-tools/adb'), `
[ "\${1:-}" != version ] || { printf '37.0.1\\n'; exit 0; }
printf 'adb %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in *"getprop ro.build.version.sdk") printf '31\\n' ;; esac`);
  await executable(join(env.ANDROID_HOME, 'emulator/emulator'), '[ "${1:-}" != -version ] || { printf "37.1.11\\n"; exit 0; }\nprintf "emulator\\n" >>"$SYNCSCOPE_TEST_CALLS"');
  await executable(join(repo, 'android/gradlew'), `
printf 'gradle %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
mkdir -p "$SYNCSCOPE_TEST_ROOT/repo/android/app/build/outputs/apk/debug"
printf 'synthetic-apk\\n' >"$SYNCSCOPE_TEST_ROOT/repo/android/app/build/outputs/apk/debug/app-debug.apk"
exit "\${FAKE_GRADLE_STATUS:-0}"`);
  await executable(join(repo, 'scripts/validation/protocol-service.sh'), `
printf 'protocol %s %s\\n' "$1" "$2" >>"$SYNCSCOPE_TEST_CALLS"
if [ "$1" = start ]; then
  state="$SYNCSCOPE_VALIDATION_STATE_DIR/syncscope-$2"; mkdir -p "$state/fixtures"
  printf 'username=synthetic\\npassword=CANARY\\n' >"$state/credentials"
  printf '%s\\n' "\${FAKE_SERVICE_OWNERSHIP:-acquired}" >"$SYNCSCOPE_RESOURCE_RECEIPT"
else
  exit "\${FAKE_CLEANUP_STATUS:-0}"
fi`);
  await executable(join(repo, 'scripts/validation/metro-service.sh'), `
printf 'metro %s\\n' "$1" >>"$SYNCSCOPE_TEST_CALLS"
[ "$1" != start ] || printf '%s\\n' "\${FAKE_SERVICE_OWNERSHIP:-acquired}" >"$SYNCSCOPE_RESOURCE_RECEIPT"`);
  const identity = 'a'.repeat(64);
  await writeFile(join(root, 'device-metadata'), JSON.stringify({
    image: identity, cpu: 'kvm', graphics: 'software', backend: identity,
    renderer: identity, driver: identity, verified: true,
    resources: {requestedRamMiB: 2048, observedRamKiB: 3000000, cpus: 4,
      width: 1080, height: 2340, density: 440},
    animations: {window: 1, transition: 1, animator: 1},
  }));
  await executable(join(repo, 'scripts/validation/android-validator.sh'), `
printf 'validator %s\\n' "$1" >>"$SYNCSCOPE_TEST_CALLS"
state=
while [ "$#" -gt 0 ]; do case "$1" in --state) state=$2; shift 2 ;; *) shift ;; esac; done
if [ -n "$state" ] && [ "\${FAKE_BOOT_STATUS:-0}" = 0 ]; then
  mkdir -p "$state"; printf 'emulator-5554\\n' >"$state/serial"
  cp "$SYNCSCOPE_TEST_ROOT/device-metadata" "$state/metadata.private.json"
  [ -z "\${SYNCSCOPE_RESOURCE_RECEIPT:-}" ] || printf 'acquired\\n' >"$SYNCSCOPE_RESOURCE_RECEIPT"
fi
exit "\${FAKE_BOOT_STATUS:-0}"`);
  await executable(join(repo, 'scripts/validation/device-fixtures.sh'), 'printf "fixtures\\n" >>"$SYNCSCOPE_TEST_CALLS"');
  for (const hook of ['remove-recheck-file', 'restore-recheck-file', 'change-device-files', 'pause-service', 'resume-service']) {
    await executable(join(repo, `scripts/validation/hooks/${hook}.sh`), `
printf 'hook ${hook}\\n' >>"$SYNCSCOPE_TEST_CALLS"
exit "\${FAKE_HOOK_STATUS:-0}"`);
  }
  const run = (args, extra = {}) => spawnSync('sh',
    [join(repo, 'scripts/validation/android-flow.sh'), ...args],
    {cwd: repo, env: {...env, ...extra}, encoding: 'utf8', timeout: 90000});
  return {root, repo, env, calls, run, log: () => readFile(calls, 'utf8'), bin, state, cleanups};
}

test('legacy direct default API and invalid arguments reject before external setup', async t => {
  const h = await harness(t);
  for (const args of [['unknown'], ['measure', '--flow', 'x'], ['measure', '--api', '32'],
    ['measure', '--graphics', 'nvidia'], ['measure', '--report-dir'],
    ['measure', '--repetitions', '1'], ['measure', '--fixture-size', '1']]) {
    assert.equal(h.run(args).status, 64, args.join(' '));
  }
  assert.equal(await h.log(), '');
  const run = h.run(['connected']);
  assert.equal(run.status, 0, run.stderr);
  assert.match(await h.log(), /connectedDebugAndroidTest/);
  assert.doesNotMatch(await h.log(), /maestro|metro start/);
});

test('full invocation lock rejects before services and never cleans a foreign resource', async t => {
  const h = await harness(t);
  const lock = join(h.state, 'invocation.lock');
  const child = spawn('setsid', ['flock', lock, 'sleep', '20']);
  t.after(() => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 100));
  const run = h.run(['e2e']);
  assert.notEqual(run.status, 0);
  assert.equal(await h.log(), '');
});

test('failed startup is not acquisition; original failures survive failed cleanup', async t => {
  const h = await harness(t);
  const run = h.run(['connected'], {FAKE_BOOT_STATUS: '27', FAKE_CLEANUP_STATUS: '19'});
  assert.equal(run.status, 27, run.stderr);
  assert.doesNotMatch(await h.log(), /validator stop/);
  assert.match(await h.log(), /protocol stop/);
});

test('borrowed protocols and Metro are audited, never stopped', async t => {
  const h = await harness(t);
  const run = h.run(['e2e'], {FAKE_SERVICE_OWNERSHIP: 'borrowed'});
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  assert.doesNotMatch(log, /protocol stop|metro stop/);
  assert.match(log, /protocol audit/);
});

test('workspace precedes all seven staged continuations and hooks; private artifacts', async t => {
  const h = await harness(t);
  const run = h.run(['e2e']);
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  const ordered = ['validation/maestro\n', '06-recheck-removed-a.yaml', 'hook remove-recheck-file',
    '06-recheck-removed-b.yaml', '07-delete-offline-a.yaml', 'hook pause-service', '07-delete-offline-b.yaml',
    'hook resume-service', '07-delete-offline-c.yaml', '08-changed-a.yaml',
    'hook change-device-files', '08-changed-b.yaml'];
  let position = -1;
  for (const item of ordered) {
    position = log.indexOf(item, position + 1);
    assert.notEqual(position, -1, item);
  }
});

test('fixed measure schedules H01-H08 exactly three times; failures are retained', async t => {
  const h = await productionHarness(t);
  // Fake only read-only device observations: an isolated SDK process has no
  // real KVM FD. Acquisition, serial/socket/process proof and all teardown
  // still execute production code rather than a fake validator/service.
  await executable(join(h.bin, 'node'), `
if [ "\${2:-}" = capture-device ]; then
  cp "$SYNCSCOPE_TEST_ROOT/device-metadata" "$3"; exit 0
fi
exec "${process.execPath}" "$@"`);
  const run = h.run(['measure', '--api', '31', '--api', '36'], {FAKE_MAESTRO_STATUS: '124'});
  assert.notEqual(run.status, 0);
  const log = await h.log();
  assert.equal(log.split('\n').filter(line => line === 'maestro').length, 48);
  assert.equal(log.split('\n').filter(line => line === 'fixtures').length, 50);
  const [invocation] = await readdir(join(h.root, 'reports'));
  const report = JSON.parse(await readFile(join(h.root, 'reports', invocation, 'run.json')));
  assert.deepEqual(report.apiRuns.map(a => a.api), [31, 36]);
  for (const apiRun of report.apiRuns) {
    assert.equal(apiRun.samples.length, 24);
    assert.deepEqual(apiRun.samples.map(s => [s.scenarioId, s.repetition]),
      Array.from({length: 8}, (_, i) => [1, 2, 3].map(r => [`H0${i + 1}`, r])).flat());
    assert.ok(apiRun.samples.every(s => s.status === 'failed' && s.failureCode === 'timeout'));
  }
  assert.equal(report.status, 'failed');
  assert.doesNotMatch(JSON.stringify(report), /CANARY|password|emulator-5554|cloud-sync-checker-performance-test/);
});

test('missing Maestro artifacts fail rather than becoming successful samples', async t => {
  const h = await harness(t);
  const run = h.run(['e2e'], {FAKE_MISSING_ARTIFACT: '1'});
  assert.notEqual(run.status, 0);
});

test('recording SDK rejects a foreign serial before boot without terminating it', async t => {
  const h = await harness(t);
  await cp(join(repository, 'scripts/validation/android-validator.sh'),
    join(h.repo, 'scripts/validation/android-validator.sh'));
  await executable(join(h.env.ANDROID_HOME, 'platform-tools/adb'), `
printf 'adb %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
printf 'List of devices attached\\nemulator-5554 device\\n'`);
  const run = spawnSync('sh', [join(h.repo, 'scripts/validation/android-validator.sh'),
    'start', '--api', '31', '--avd', 'dependency_api31',
    '--state', join(h.state, 'api31'), '--exclusive-lock', join(h.state, 'validator.lock')],
    {env: h.env, encoding: 'utf8', timeout: 10000});
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /Another connected|foreign|occupied/);
  assert.doesNotMatch(await h.log(), /emu kill|^emulator$/m);
});

test('recording Docker borrows prestarted connected services and does not bring them down', async t => {
  const h = await harness(t);
  await cp(join(repository, 'scripts/validation/protocol-service.sh'),
    join(h.repo, 'scripts/validation/protocol-service.sh'));
  const serviceState = join(h.state, 'syncscope-sftp');
  await mkdir(serviceState);
  await mkdir(join(serviceState, 'fixtures'));
  await writeFile(join(serviceState, 'owner'), 'syncscope-sftp:sftp\n');
  await executable(join(h.bin, 'docker'), `
printf 'docker %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in
  "version --format"*) printf '29.8.1 29.8.1\\n' ;;
  "compose version --short") printf '5.5.1\\n' ;;
  *"ps --status running --services") printf 'sftp\\n' ;;
esac`);
  await executable(join(h.bin, 'ss'), 'printf "LISTEN\\n"');
  const receipt = join(h.root, 'receipt');
  const run = spawnSync('sh', [join(h.repo, 'scripts/validation/protocol-service.sh'),
    'start', 'sftp', '--compose', join(h.repo, 'validation/services/compose.yaml'),
    '--project', 'syncscope-sftp', '--host', '127.0.0.1', '--port', '32122'],
    {env: {...h.env, SYNCSCOPE_RESOURCE_RECEIPT: receipt}, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr);
  assert.equal(await readFile(receipt, 'utf8'), 'borrowed\n');
  assert.doesNotMatch(await h.log(), /down|up -d/);
});

test('signal during staged pause resumes and restores; interruption keeps exit 130', async t => {
  const h = await harness(t);
  await executable(join(h.repo, 'scripts/validation/hooks/pause-service.sh'), `
printf 'hook pause-service\\n' >>"$SYNCSCOPE_TEST_CALLS"
kill -TERM "$PPID"`);
  const run = h.run(['e2e']);
  assert.equal(run.status, 130, run.stderr);
  assert.match(await h.log(), /hook pause-service[\s\S]*hook resume-service[\s\S]*hook restore-recheck-file/);
});

test('standalone service failure and handoff signals clean authoritative acquired receipts, not borrowed resources', async t => {
  for (const interruption of ['failure', 'HUP', 'INT', 'TERM']) {
    await t.test(interruption, async t2 => {
      const h = await harness(t2);
      await executable(join(h.repo, 'scripts/validation/protocol-service.sh'), `
printf 'protocol %s %s\\n' "$1" "$2" >>"$SYNCSCOPE_TEST_CALLS"
resource="$SYNCSCOPE_TEST_ROOT/resource-$2"
if [ "$1" = start ]; then
  if [ "$2" = sftp ]; then
    printf 'borrowed\\n' >"$resource"
    printf 'borrowed\\n' >"$SYNCSCOPE_RESOURCE_RECEIPT"
  else
    printf 'acquired\\n' >"$resource"
    printf 'acquired\\n' >"$SYNCSCOPE_RESOURCE_RECEIPT"
    if [ "$FAKE_INTERRUPTION" = failure ]; then exit 27; fi
    # The receipt is complete, but the parent has not returned from run yet.
    kill -"$FAKE_INTERRUPTION" "$PPID"
  fi
else
  rm -f "$resource"
  exit 19
fi`);
      const run = spawnSync('sh', [join(h.repo, 'scripts/validation/protocol-services.sh'), 'start'],
        {cwd: h.repo, env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: '',
          FAKE_INTERRUPTION: interruption}, encoding: 'utf8', timeout: 10000});
      assert.equal(run.status, interruption === 'failure' ? 27 : 130, run.stderr);
      assert.match(await h.log(), /protocol stop webdav/);
      assert.doesNotMatch(await h.log(), /protocol stop sftp|protocol (start|stop) ftp/);
      await assert.rejects(lstat(join(h.root, 'resource-webdav')), /ENOENT/);
      assert.equal(await readFile(join(h.root, 'resource-sftp'), 'utf8'), 'borrowed\n');
    });
  }
});

test('original per-API connected builds, API order, monotonic reconciliation and exclusive reports', async t => {
  const h = await harness(t);
  const directory = join(h.root, 'explicit-reports');
  const run = h.run(['connected', '--api', '31', '--api', '36', '--report-dir', directory]);
  assert.equal(run.status, 0, run.stderr);
  const [id] = await readdir(directory);
  const report = JSON.parse(await readFile(join(directory, id, 'run.json')));
  assert.deepEqual(report.apiRuns.map(a => a.api), [31, 36]);
  assert.equal((await h.log()).split('\n').filter(line => line.startsWith('gradle ')).length, 2);
  assert.ok(report.apiRuns.every(a => a.build.cachePolicy === 'no-daemon'));
  const segments = [...report.sharedPhases, ...report.apiRuns.flatMap(a => a.phases)];
  assert.equal(segments.reduce((sum, p) => sum + p.elapsedMs, 0), report.elapsedMs);
  assert.equal((await lstat(join(directory, id))).mode & 0o777, 0o700);
  assert.equal((await lstat(join(directory, id, 'run.json'))).mode & 0o777, 0o600);
  assert.equal(h.run(['connected', '--report-dir', directory]).status, 0);
  assert.equal((await readdir(directory)).length, 2);
});

test('measure rejects environment dataset overrides and unverified software before sampling', async t => {
  const h = await harness(t);
  assert.equal(h.run(['measure'], {BULK_FILES: '1'}).status, 64);
  assert.equal(h.run(['measure', '--graphics', 'host-opengl']).status, 69);
  assert.equal(h.run(['measure', '--graphics', 'auto']).status, 69);
  assert.equal(await h.log(), '');
  const metadata = JSON.parse(await readFile(join(h.root, 'device-metadata')));
  metadata.verified = false;
  await writeFile(join(h.root, 'device-metadata'), JSON.stringify(metadata));
  const run = h.run(['measure', '--graphics', 'software']);
  assert.notEqual(run.status, 0);
  assert.doesNotMatch(await h.log(), /^maestro$/m);
});

test('partial protocol seed acquisition preserves failure and does not remove foreign containers', async t => {
  const h = await harness(t);
  await cp(join(repository, 'scripts/validation/protocol-service.sh'),
    join(h.repo, 'scripts/validation/protocol-service.sh'));
  await executable(join(h.bin, 'docker'), `
printf 'docker %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in "version --format"*) printf '29.8.1 29.8.1\\n' ;;
  "compose version --short") printf '5.5.1\\n' ;; esac`);
  await executable(join(h.bin, 'ss'), 'exit 0');
  await executable(join(h.repo, 'scripts/validation/fixture-seed.sh'), 'exit 17');
  const receipt = join(h.root, 'receipt');
  const run = spawnSync('sh', [join(h.repo, 'scripts/validation/protocol-service.sh'),
    'start', 'sftp', '--compose', join(h.repo, 'validation/services/compose.yaml'),
    '--project', 'syncscope-sftp', '--host', '127.0.0.1', '--port', '32122'],
  {env: {...h.env, SYNCSCOPE_RESOURCE_RECEIPT: receipt}, encoding: 'utf8', timeout: 10000});
  assert.equal(run.status, 17, run.stderr);
  assert.equal(await readFile(receipt, 'utf8'), 'released\n');
  await assert.rejects(lstat(join(h.state, 'syncscope-sftp')), /ENOENT/);
  assert.doesNotMatch(await h.log(), /docker rm|down|prune/);
});

test('release-smoke preserves unsigned rejection, signed build/install/update and no Metro', async t => {
  const h = await harness(t);
  const javaHome = join(h.root, 'java');
  await executable(join(javaHome, 'bin/keytool'), 'exit 0');
  await executable(join(h.bin, 'pnpm'), `
[ "$1" != --version ] || { printf '11.3.0\\n'; exit 0; }
printf 'release build\\n' >>"$SYNCSCOPE_TEST_CALLS"
[ -n "\${ORG_GRADLE_PROJECT_SYNCSCOPE_RELEASE_STORE_FILE:-}" ] ||
  { printf 'Release signing is not configured\\n'; exit 1; }
mkdir -p "$SYNCSCOPE_TEST_ROOT/repo/android/app/build/outputs/apk/release"
printf 'release-apk\\n' >"$SYNCSCOPE_TEST_ROOT/repo/android/app/build/outputs/apk/release/app-release.apk"`);
  await executable(join(h.env.ANDROID_HOME, 'build-tools/37/aapt2'), `
case "$*" in *"dump badging"*)
  printf "package: name='com.syncscope' versionCode='1' versionName='0.0.1'\\n"
  printf "application: label='SyncScope' icon='res/test.xml'\\n" ;;
  *) printf 'E: adaptive-icon\\nE: foreground\\nE: monochrome\\n' ;; esac`);
  await executable(join(h.env.ANDROID_HOME, 'platform-tools/adb'), `
[ "$1" != version ] || { printf '37.0.1\\n'; exit 0; }
printf 'adb %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in *"syncscope-debug://configure-repository"*)
  printf 'Error: Activity not started, unable to resolve Intent\\n' ;; esac`);
  const run = h.run(['release-smoke'], {JAVA_HOME: javaHome});
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  assert.equal(log.split('\n').filter(line => line === 'release build').length, 2);
  assert.match(log, /uninstall com.syncscope[\s\S]*install[\s\S]*90-release-smoke[\s\S]*install -r[\s\S]*91-release-update/);
  assert.doesNotMatch(log, /metro start|assembleDebug|reactNativeArchitectures/);
});

// Exercise the actual Bash acquisition, identity, audit and cleanup code.
// Only external SDK/Docker/Metro/Maestro tools and fixture data generation are
// fake; process sessions, /proc identities, flock and timeout are real.
async function productionHarness(t) {
  const h = await harness(t);
  for (const file of ['android-validator.sh', 'metro-service.sh', 'protocol-service.sh']) {
    await cp(join(repository, 'scripts/validation', file), join(h.repo, 'scripts/validation', file));
  }
  for (const hook of ['remove-recheck-file', 'restore-recheck-file', 'pause-service', 'resume-service']) {
    await cp(join(repository, `scripts/validation/hooks/${hook}.sh`),
      join(h.repo, `scripts/validation/hooks/${hook}.sh`));
  }
  // Deterministic tiny generated data; actual manifest and audit code remains.
  await executable(join(h.repo, 'scripts/validation/fixture-seed.sh'), `
root=$2; mkdir -p "$root/gallery" "$root/recheck"
printf 'synthetic\\n' >"$root/gallery/beach.png"
cp -p "$root/gallery/beach.png" "$root/recheck/beach.png"
touch -d '@1704067200' "$root/recheck"`);
  await executable(join(h.bin, 'sleep'), 'exec /usr/bin/sleep 0.02');
  await executable(join(h.bin, 'timeout'), `
case "$*" in *"/maestro test"*)
  [ "\${FAKE_TIMEOUT:-0}" != 1 ] || { shift 3; exec /usr/bin/timeout --signal=TERM --kill-after=0.2 0.2 "$@"; } ;;
esac
exec /usr/bin/timeout "$@"`);
  await executable(join(h.bin, 'pnpm'), `
[ "$1" != --version ] || { printf '11.3.0\\n'; exit 0; }
exec "${process.execPath}" "$SYNCSCOPE_TEST_ROOT/metro.mjs"`);
  await writeFile(join(h.root, 'metro.mjs'), `
import fs from 'node:fs';
const root = process.env.SYNCSCOPE_TEST_ROOT;
fs.writeFileSync(root + '/metro-ready', String(process.pid));
fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'metro acquired-process\\n');
process.on('SIGTERM', () => {
  fs.rmSync(root + '/metro-ready', {force:true});
  fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'metro terminated\\n');
  process.exit(0);
});
setInterval(() => {}, 1000);
`);
  await executable(join(h.bin, 'ss'), `
case "$*" in *":8081"*) [ ! -f "$SYNCSCOPE_TEST_ROOT/metro-ready" ] || printf 'LISTEN\\n' ;;
  *":5554"*) exit 0 ;;
  *":32122"*) [ ! -f "$SYNCSCOPE_TEST_ROOT/container-aaaaaaaaaaaa" ] || printf 'LISTEN\\n' ;;
  *":32180"*) [ ! -f "$SYNCSCOPE_TEST_ROOT/container-bbbbbbbbbbbb" ] || printf 'LISTEN\\n' ;;
  *) [ ! -f "$SYNCSCOPE_TEST_ROOT/container-cccccccccccc" ] || printf 'LISTEN\\n' ;;
esac`);
  await executable(join(h.bin, 'docker'), `
printf 'docker %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in
  "version --format"*) printf '29.8.1 29.8.1\\n'; exit 0 ;;
  "compose version --short") printf '5.5.1\\n'; exit 0 ;;
  "inspect --format"*)
    cat "$SYNCSCOPE_STATE_ROOT/claim"; exit 0 ;;
  "rm -f"*)
    rm -f "$SYNCSCOPE_TEST_ROOT/container-\${2}"; exit 0 ;;
esac
project=; verb=; service=
while [ "$#" -gt 0 ]; do
  case "$1" in
    compose) shift ;; -p) project=$2; shift 2 ;; -f) shift 2 ;;
    *) verb=$1; shift; break ;;
  esac
done
case "$project" in syncscope-sftp) id=aaaaaaaaaaaa ;; syncscope-webdav) id=bbbbbbbbbbbb ;; syncscope-ftp) id=cccccccccccc ;; *) exit 64 ;; esac
case "$verb" in
  up) printf '%s\\n' "$project" >"$SYNCSCOPE_TEST_ROOT/container-$id" ;;
  ps) if [ -f "$SYNCSCOPE_TEST_ROOT/container-$id" ]; then
    case "$*" in *"--services"*) printf '%s\\n' "\${project#syncscope-}" ;; *) printf '%s\\n' "$id" ;; esac
    fi ;;
  port) printf '127.0.0.1:%s\\n' "$2" ;;
  logs) [ "\${FAKE_AUDIT_FAIL:-0}" != 1 ] || printf 'GET /synthetic\\nremove name synthetic\\nFTP command: RETR synthetic\\n' ;;
  pause) printf 'paused\\n' >"$SYNCSCOPE_TEST_ROOT/paused"
    [ "\${FAKE_PAUSE_SIGNAL:-0}" != 1 ] || {
      target=$(cat "$SYNCSCOPE_TEST_ROOT/runner-pid"); kill -TERM "$target";
    } ;;
  unpause) rm -f "$SYNCSCOPE_TEST_ROOT/paused" ;;
  *) exit 64 ;;
esac`);
  await writeFile(join(h.root, 'emulator.mjs'), `
import fs from 'node:fs';
import net from 'node:net';
const root = process.env.SYNCSCOPE_TEST_ROOT;
const args = process.argv.slice(2);
if (args[0] === '-version') { console.log('37.1.11'); process.exit(0); }
let parent = process.ppid;
while (parent > 1) {
  const argv = fs.readFileSync('/proc/' + parent + '/cmdline', 'utf8').split('\\0');
  if (argv.includes(root + '/repo/scripts/validation/android-flow.sh')) {
    fs.writeFileSync(root + '/runner-pid', String(parent)); break;
  }
  parent = Number(fs.readFileSync('/proc/' + parent + '/stat', 'utf8').replace(/^.*\\) /, '').split(' ')[1]);
}
const avd = args[args.indexOf('-avd') + 1];
const ready = root + '/emulator-ready';
const server = net.createServer();
server.on('error', () => process.exit(71));
server.listen(5554, '127.0.0.1', () => {
  fs.writeFileSync(ready, avd + '\\n');
  fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'emulator acquired-process ' + avd + '\\n');
});
process.on('SIGTERM', () => {
  fs.rmSync(ready, {force:true});
  fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'emulator terminated ' + avd + '\\n');
  server.close(() => process.exit(0));
});
`);
  await executable(join(h.env.ANDROID_HOME, 'emulator/emulator'),
    `exec "${process.execPath}" "$SYNCSCOPE_TEST_ROOT/emulator.mjs" "$@"`);
  await executable(join(h.env.ANDROID_HOME, 'platform-tools/adb'), `
[ "$1" != version ] || { printf '37.0.1\\n'; exit 0; }
printf 'adb %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in
  devices) printf 'List of devices attached\\n'; [ ! -f "$SYNCSCOPE_TEST_ROOT/emulator-ready" ] || printf 'emulator-5554 device\\n' ;;
  *"get-state") [ -f "$SYNCSCOPE_TEST_ROOT/emulator-ready" ] && printf 'device\\n' ;;
  *"emu avd name") cat "$SYNCSCOPE_TEST_ROOT/emulator-ready"; printf 'OK\\n' ;;
  *"emu kill") printf 'emulator kill-verified\\n' >>"$SYNCSCOPE_TEST_CALLS" ;;
  *"shell getprop sys.boot_completed") printf '1\\n' ;;
  *"shell ip route") printf '10.0.2.0/24\\n' ;;
  *" root") printf '0\\n' >"$SYNCSCOPE_TEST_ROOT/uid" ;;
  *" unroot") printf '2000\\n' >"$SYNCSCOPE_TEST_ROOT/uid" ;;
  *"shell id -u") cat "$SYNCSCOPE_TEST_ROOT/uid" ;;
  *"shell getprop ro.build.version.sdk") case "$(cat "$SYNCSCOPE_TEST_ROOT/emulator-ready")" in *31) printf '31\\n' ;; *) printf '36\\n' ;; esac ;;
  *"shell dumpsys SurfaceFlinger") printf 'GLES: SwiftShader synthetic\\n' ;;
esac`);
  await writeFile(join(h.root, 'uid'), '2000\n');
  // Handoff interruption occurs in an external receipt read after production
  // startup returns, before the runner can update any in-memory acquisition flag.
  await writeFile(join(h.root, 'cat.mjs'), `
import fs from 'node:fs';
const path = process.argv[2], root = process.env.SYNCSCOPE_TEST_ROOT;
if (!path) { process.stdin.pipe(process.stdout); }
else {
  const value = fs.readFileSync(path);
  if (process.env.FAKE_HANDOFF && path.includes('/cloud-sync-checker-claims-') &&
      path.split('/').at(-1).startsWith(process.env.FAKE_HANDOFF) &&
      value.toString() === 'acquired\\n' && !fs.existsSync(root + '/handoff-fired')) {
    let parent = process.ppid, runner = 0;
    while (parent > 1) {
      const argv = fs.readFileSync('/proc/' + parent + '/cmdline', 'utf8').split('\\0');
      if (argv.includes(root + '/repo/scripts/validation/android-flow.sh')) {
        runner = parent;
      }
      parent = Number(fs.readFileSync('/proc/' + parent + '/stat', 'utf8').replace(/^.*\\) /, '').split(' ')[1]);
    }
    if (runner) {
      fs.writeFileSync(root + '/handoff-fired', '1');
      process.kill(runner, 'SIGTERM');
    }
  }
  process.stdout.write(value);
}
`);
  await executable(join(h.bin, 'cat'),
    `case "\${1:-}" in */cloud-sync-checker-claims-*/*) exec "${process.execPath}" "$SYNCSCOPE_TEST_ROOT/cat.mjs" "$@" ;; *) exec /usr/bin/cat "$@" ;; esac`);
  h.cleanups.push(async () => {
    // Only a fake process PID written under this test's private root.
    for (const marker of ['metro-ready', 'emulator-ready']) {
      if (marker === 'metro-ready') {
        const pid = Number(await readFile(join(h.root, marker), 'utf8').catch(() => '0'));
        const argv = await readFile(`/proc/${pid}/cmdline`, 'utf8').catch(() => '');
        if (pid > 1 && argv.split('\0').includes(join(h.root, 'metro.mjs'))) {
          try { process.kill(pid, 'SIGTERM'); } catch {}
        }
      }
    }
    const states = await readdir(h.state).catch(() => []);
    for (const name of states.filter(s => /^api(31|36)$/.test(s))) {
      const pid = Number(await readFile(join(h.state, name, 'pid'), 'utf8').catch(() => '0'));
      const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
      const identity = (await readFile(join(h.state, name, 'process-identity'), 'utf8').catch(() => '')).trim();
      if (pid > 1 && identity && stat.replace(/^.*\) /, '').split(' ')[19] === identity) {
        try { process.kill(-pid, 'SIGTERM'); } catch {}
      }
    }
  });
  return h;
}

test('production validator and Metro acquire, prove identity and release on both APIs', async t => {
  const h = await productionHarness(t);
  const run = h.run(['e2e', '--api', '31', '--api', '36']);
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  for (const api of [31, 36]) {
    assert.match(log, new RegExp(`emulator acquired-process dependency_api${api}`));
    assert.match(log, new RegExp(`emulator terminated dependency_api${api}`));
  }
  assert.equal(log.split('\n').filter(s => s === 'emulator kill-verified').length, 2);
  assert.match(log, /metro acquired-process[\s\S]*metro terminated/);
  for (const name of ['api31', 'api36', 'metro', 'syncscope-sftp', 'syncscope-webdav', 'syncscope-ftp']) {
    await assert.rejects(lstat(join(h.state, name)), /ENOENT/);
  }
});

test('production acquisition handoff signals consult acquired receipts directly', async t => {
  for (const resource of ['sftp', 'metro', 'emulator']) {
    await t.test(resource, async t2 => {
      const h = await productionHarness(t2);
      const run = h.run(['e2e'], {FAKE_HANDOFF: resource});
      assert.equal(run.status, 130, run.stderr);
      assert.equal(await readFile(join(h.root, 'handoff-fired'), 'utf8'), '1');
      if (resource === 'emulator') {
        assert.match(await h.log(), /emulator kill-verified[\s\S]*emulator terminated/);
      }
      if (resource !== 'sftp') { assert.match(await h.log(), /metro terminated/); }
      await assert.rejects(lstat(join(h.state, 'syncscope-sftp')), /ENOENT/);
      await assert.rejects(lstat(join(h.state, 'metro')), /ENOENT/);
      await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
    });
  }
});

test('real timeout terminates Maestro descendants and production acquired resources', async t => {
  const h = await productionHarness(t);
  await executable(join(h.bin, 'maestro'), `
[ "$1" != --version ] || { printf '2.10.0\\n'; exit 0; }
exec "${process.execPath}" "$SYNCSCOPE_TEST_ROOT/hanging-maestro.mjs"`);
  await writeFile(join(h.root, 'hanging-maestro.mjs'), `
import fs from 'node:fs';
import {spawn} from 'node:child_process';
const child = spawn('/usr/bin/sleep', ['60']);
fs.writeFileSync(process.env.SYNCSCOPE_TEST_ROOT + '/maestro-pids', process.pid + ' ' + child.pid);
process.on('SIGTERM', () => {
  fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'maestro timed-out\\n');
  process.exit(0);
});
setInterval(() => {}, 1000);
`);
  const run = h.run(['e2e'], {FAKE_TIMEOUT: '1'});
  assert.equal(run.status, 124, run.stderr);
  const pids = (await readFile(join(h.root, 'maestro-pids'), 'utf8')).split(' ');
  for (const pid of pids) {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => '');
    assert.ok(!stat || stat.replace(/^.*\) /, '').startsWith('Z '));
  }
  assert.match(await h.log(), /maestro timed-out[\s\S]*metro terminated/);
  assert.match(await h.log(), /emulator terminated/);
  const [id] = await readdir(join(h.root, 'reports'));
  const report = JSON.parse(await readFile(join(h.root, 'reports', id, 'run.json')));
  assert.equal(report.status, 'failed');
  assert.equal(report.apiRuns[0].acceptance[0].failureCode, 'timeout');
});

test('production services and Metro borrow prestarted resources, audit, and leave them alive', async t => {
  const h = await productionHarness(t);
  const tool = (file, args, extra = {}) => spawnSync('sh', [join(h.repo, 'scripts/validation', file), ...args],
    {env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: '', ...extra}, cwd: h.repo, encoding: 'utf8', timeout: 10000});
  assert.equal(tool('protocol-services.sh', ['start']).status, 0);
  const metroArgs = ['--host', '127.0.0.1', '--port', '8081', '--state', join(h.state, 'metro')];
  assert.equal(tool('metro-service.sh', ['start', ...metroArgs]).status, 0);
  const run = h.run(['e2e']);
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(await h.log(), /docker rm -f|metro terminated/);
  assert.match(await h.log(), /logs --no-color --since/);
  assert.equal(tool('metro-service.sh', ['healthcheck', ...metroArgs]).status, 0);
  assert.equal(tool('protocol-services.sh', ['healthcheck']).status, 0);
  assert.equal(tool('metro-service.sh', ['stop', ...metroArgs]).status, 0);
  assert.equal(tool('protocol-services.sh', ['stop']).status, 0);
});

test('production staged signal resumes SFTP and restores fixtures before scoped audits', async t => {
  const h = await productionHarness(t);
  const run = h.run(['e2e'], {FAKE_PAUSE_SIGNAL: '1'});
  assert.equal(run.status, 130, run.stderr);
  assert.match(await h.log(), /pause sftp[\s\S]*unpause sftp[\s\S]*logs --no-color --since/);
  await assert.rejects(lstat(join(h.root, 'paused')), /ENOENT/);
  await assert.rejects(lstat(join(h.state, 'syncscope-sftp')), /ENOENT/);
  const [id] = await readdir(join(h.root, 'reports'));
  const report = JSON.parse(await readFile(join(h.root, 'reports', id, 'run.json')));
  assert.equal(report.status, 'interrupted');
  assert.equal(report.fixtureSet.restoration, 'passed');
});

test('production validator refuses foreign invocation identity and cleans only its saved session', async t => {
  const h = await productionHarness(t);
  const receipt = join(h.root, 'validator-receipt');
  const args = ['--api', '31', '--avd', 'dependency_api31', '--state', join(h.state, 'api31'),
    '--exclusive-lock', join(h.state, 'validator.lock')];
  const validator = (action, token) => spawnSync('sh',
    [join(h.repo, 'scripts/validation/android-validator.sh'), action, ...args],
    {env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: token, SYNCSCOPE_RESOURCE_RECEIPT: receipt},
      encoding: 'utf8', timeout: 10000});
  assert.equal(validator('start', 'synthetic-owner').status, 0);
  assert.equal(await readFile(receipt, 'utf8'), 'acquired\n');
  assert.equal(validator('start', 'synthetic-owner').status, 0);
  assert.equal(await readFile(receipt, 'utf8'), 'borrowed\n');
  assert.equal(validator('stop', 'foreign-owner').status, 1);
  assert.doesNotMatch(await h.log(), /emulator kill-verified|emulator terminated/);
  assert.equal(validator('healthcheck', 'synthetic-owner').status, 0);
  assert.equal(validator('stop', 'synthetic-owner').status, 0);
  assert.equal(await readFile(receipt, 'utf8'), 'released\n');
  assert.match(await h.log(), /emulator kill-verified[\s\S]*emulator terminated/);
});

test('receipt reads reject malformed, multiline and symlink acquisition evidence', async t => {
  const h = await harness(t);
  const receipt = join(h.root, 'receipt');
  const read = () => spawnSync('sh', ['-c',
    '. "$1"; validation_read_receipt "$2"', 'receipt-test',
    join(h.repo, 'scripts/validation/validation-lifecycle.sh'), receipt],
  {env: h.env, encoding: 'utf8'});
  for (const value of ['acquired', 'acquired\n\n', 'acquired\nborrowed\n', 'attempted\n', 'acquiredX']) {
    await writeFile(receipt, value);
    assert.notEqual(read().status, 0);
  }
  for (const value of ['acquired', 'borrowed', 'released']) {
    await writeFile(receipt, `${value}\n`);
    assert.equal(read().stdout, `${value}\n`);
  }
  await rm(receipt);
  await writeFile(join(h.root, 'foreign-receipt'), 'acquired\n');
  await symlink(join(h.root, 'foreign-receipt'), receipt);
  assert.notEqual(read().status, 0);
});
