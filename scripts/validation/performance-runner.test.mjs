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
# One artifact per flow the workspace config orders (39 originals plus any
# appended regression), as the runner's workspace-count expects.
[ "$flow" != "$SYNCSCOPE_TEST_ROOT/repo/validation/maestro" ] ||
  count=$(grep -c '^    - [a-z0-9/-]*$' "$flow/config.yaml")
i=1
while [ "$i" -le "$count" ]; do
  printf '%s\\n' '[{"command":{"assertConditionCommand":{}},"metadata":{"status":"COMPLETED","timestamp":1,"duration":1,"sequenceNumber":0,"depth":0}}]' >"$output/commands-$i.json"
  i=$((i + 1))
done
exit "\${FAKE_MAESTRO_STATUS:-0}"`);
  await executable(join(env.ANDROID_HOME, 'platform-tools/adb'), `
[ "\${1:-}" != version ] || { printf '37.0.1\\n'; exit 0; }
printf 'adb %s\\n' "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$*" in
  *"getprop ro.build.version.sdk") printf '31\\n' ;;
  *"-exec stat -c %s {} +") printf '7\\n' ;;
esac`);
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
  await executable(join(repo, 'scripts/validation/device-fixtures.sh'), `
printf "fixtures\\n" >>"$SYNCSCOPE_TEST_CALLS"
# Real adb shell forwards stdin; a fixture child must not consume the schedule.
if [ "\${FAKE_FIXTURE_CONSUMES_STDIN:-0}" = 1 ]; then cat >/dev/null; fi`);
  for (const hook of ['remove-recheck-file', 'restore-recheck-file', 'change-device-files', 'pause-service', 'resume-service']) {
    await executable(join(repo, `scripts/validation/hooks/${hook}.sh`), `
printf 'hook ${hook}\\n' >>"$SYNCSCOPE_TEST_CALLS"
exit "\${FAKE_HOOK_STATUS:-0}"`);
  }
  const run = (args, extra = {}) => spawnSync('sh',
    [join(repo, 'scripts/validation/android-flow.sh'), ...args],
    {cwd: repo, env: {...env, ...extra}, encoding: 'utf8', timeout: 300000});
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
  const run = h.run(['measure', '--api', '31', '--api', '36'],
    {FAKE_MAESTRO_STATUS: '124', FAKE_FIXTURE_CONSUMES_STDIN: '1'});
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

test('repeated signals during cleanup cannot abandon acquired emulator or protocol services', async t => {
  const h = await harness(t);
  await executable(join(h.repo, 'scripts/validation/hooks/pause-service.sh'), `
printf 'hook pause-service\\n' >>"$SYNCSCOPE_TEST_CALLS"
kill -TERM "$PPID"`);
  // A supervisor that re-sends signals while cleanup is releasing resources.
  await executable(join(h.repo, 'scripts/validation/metro-service.sh'), `
printf 'metro %s\\n' "$1" >>"$SYNCSCOPE_TEST_CALLS"
[ "$1" != start ] || printf '%s\\n' "\${FAKE_SERVICE_OWNERSHIP:-acquired}" >"$SYNCSCOPE_RESOURCE_RECEIPT"
if [ "$1" = stop ]; then
  for signal in TERM HUP INT TERM; do kill -"$signal" "$PPID"; done
  # Children launched by cleanup keep default dispositions.
  disposition=$(awk '/^SigIgn:/ { print $2 }' /proc/self/status)
  printf 'metro-stop-ignored %s\\n' "$disposition" >>"$SYNCSCOPE_TEST_CALLS"
fi`);
  const run = h.run(['e2e']);
  assert.equal(run.status, 130, run.stderr);
  const log = await h.log();
  assert.match(log, /metro stop[\s\S]*validator stop[\s\S]*protocol stop ftp[\s\S]*protocol stop webdav[\s\S]*protocol stop sftp/);
  const ignored = BigInt(`0x${log.match(/metro-stop-ignored ([0-9a-f]+)/)[1]}`);
  for (const signal of [1, 2, 15]) { assert.equal(ignored & (1n << BigInt(signal - 1)), 0n); }
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
  assert.equal(h.run(['measure', '--graphics', 'host-opengl'], {SCROLL_COUNT: '1'}).status, 64);
  assert.equal(await h.log(), '');
  const metadata = JSON.parse(await readFile(join(h.root, 'device-metadata')));
  metadata.verified = false;
  await writeFile(join(h.root, 'device-metadata'), JSON.stringify(metadata));
  // Legacy original-mode and explicit verified-profile gates both refuse sampling.
  for (const args of [['measure'], ['measure', '--graphics', 'software'], ['measure', '--graphics', 'host-opengl']]) {
    const run = h.run(args);
    assert.notEqual(run.status, 0, args.join(' '));
    assert.doesNotMatch(await h.log(), /^maestro$/m);
  }
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
case "$*" in
  *"syncscope-debug://configure-repository"*) printf 'Error: Activity not started, unable to resolve Intent\\n' ;;
  *"-exec stat -c %s {} +") printf '7\\n' ;;
esac`);
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
case "$*" in *"/emulator/emulator -avd "*)
  printf 'emulator lifetime %s\\n' "$3" >>"$SYNCSCOPE_TEST_CALLS" ;;
esac
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
  *"{{.RestartCount}}"*)
    # FAKE_FTP_RESTART: the FTP container restarts once after its scope begins.
    count="$SYNCSCOPE_TEST_ROOT/restart-count-$4"
    if [ -f "$count" ]; then cat "$count"; else printf '0\\n'; fi
    [ "\${FAKE_FTP_RESTART:-0}" != 1 ] || [ "$4" != cccccccccccc ] || printf '1\\n' >"$count"
    exit 0 ;;
  events*)
    [ "\${SYNCSCOPE_TEST_EVENTS_FAULT:-0}" != 1 ] || { printf 'not-a-time die\\n'; exit 0; }
    case "$*" in *"--since "*"--until "*"container=cccccccccccc"*"event=die"*"event=start"*)
      [ "\${FAKE_FTP_RESTART:-0}" != 1 ] ||
        printf '%s\\n' '1792000000123456789 die' '1792000000456789012 start' ;;
    esac
    exit 0 ;;
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
// Capability probes pass through without starting a guest.
if (args[0] === '-help-gpu') {
  console.log('     auto (default)       -> Auto.\\n     host                 -> Host.\\n' +
    '     software             -> Software.\\n     lavapipe             -> Lavapipe.\\n' +
    '     swiftshader          -> SwiftShader.\\n     swangle              -> ANGLE.');
  process.exit(0);
}
if (args[0] === '-accel-check') {
  if (process.env.FAKE_KVM === '0') { console.log('accel:\\n9\\nKVM is not installed\\naccel'); process.exit(1); }
  console.log('accel:\\n0\\nKVM (version 12) is installed and usable.\\naccel'); process.exit(0);
}
const gpu = args.includes('-gpu') ? args[args.indexOf('-gpu') + 1] : 'none';
const accel = args.includes('-accel') ? 'accel-' + args[args.indexOf('-accel') + 1] : 'accel-default';
fs.appendFileSync(process.env.SYNCSCOPE_TEST_CALLS, 'emulator gpu ' + gpu + ' ' + accel +
  (args.includes('-feature') ? ' feature' + args[args.indexOf('-feature') + 1] : '') +
  (process.env.DRI_PRIME ? ' DRI_PRIME' : '') +
  (args.some(a => /wipe/.test(a)) ? ' WIPE' : '') + '\\n');
const failing = (process.env.FAKE_GPU_FAIL || '').split(',');
if (failing.includes('all') || failing.includes(gpu)) { process.exit(1); }
fs.writeFileSync(root + '/emulator-gpu', gpu + '\\n');
const held = [];
if (accel === 'accel-on') { held.push(fs.openSync(root + '/host/dev/kvm', 'r')); }
if (gpu === 'host') { held.push(fs.openSync(root + '/host/dev/dri/renderD128', 'r')); }
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
  if (process.env.FAKE_INTERRUPT_GPU === gpu) {
    const runner = Number(fs.readFileSync(root + '/runner-pid', 'utf8'));
    if (runner > 1) { process.kill(runner, 'SIGTERM'); }
  }
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
  *" root") [ "\${FAKE_WATCHDOG_FAULT:-}" != root ] || exit 27
    printf '0\\n' >"$SYNCSCOPE_TEST_ROOT/uid"
    # adbd restarts as root, but the client loses the channel and exits nonzero.
    [ "\${FAKE_WATCHDOG_FAULT:-}" != root-exit ] || exit 1 ;;
  *" unroot") [ "\${FAKE_WATCHDOG_FAULT:-}" != unroot ] || exit 27
    printf '2000\\n' >"$SYNCSCOPE_TEST_ROOT/uid"
    [ "\${FAKE_WATCHDOG_FAULT:-}" != unroot-exit ] || exit 1 ;;
  *"shell setprop ctl.stop llkd-"*)
    case "$*" in *"llkd-0"*) [ "\${FAKE_WATCHDOG_FAULT:-}" != stop0 ] || exit 27 ;; esac
    case "$*" in *"llkd-1"*) [ "\${FAKE_WATCHDOG_FAULT:-}" != stop1 ] || exit 27 ;; esac
    printf 'requested\\n' >"$SYNCSCOPE_TEST_ROOT/watchdog-requested" ;;
  *"shell getprop init.svc.llkd-"*)
    case "$*" in *llkd-0) service=0 ;; *) service=1 ;; esac
    case "\${FAKE_WATCHDOG_FAULT:-}:$service" in
      absent0:0) exit 0 ;; read0:0) exit 27 ;;
      read:1) exit 27 ;; empty:1) exit 0 ;; malformed:1) printf 'unexpected\\n'; exit 0 ;;
      running:1) printf 'running\\n'; exit 0 ;;
    esac
    marker="$SYNCSCOPE_TEST_ROOT/watchdog-polls-$service"
    n=0; [ ! -f "$marker" ] || n=$(cat "$marker")
    n=$((n + 1)); printf '%s\\n' "$n" >"$marker"
    if [ "\${FAKE_WATCHDOG_DELAY:-}" = "$service" ] && [ "$n" -lt 3 ]; then
      printf 'running\\n'
    else printf 'stopped\\n'; fi ;;
  *"shell id -u") cat "$SYNCSCOPE_TEST_ROOT/uid" ;;
  *"shell getprop ro.build.version.sdk") case "$(cat "$SYNCSCOPE_TEST_ROOT/emulator-ready")" in *31) printf '31\\n' ;; *) printf '36\\n' ;; esac ;;
  *"shell dumpsys SurfaceFlinger")
    if [ "$(cat "$SYNCSCOPE_TEST_ROOT/emulator-gpu" 2>/dev/null)" = host ]; then
      printf '%s\\n' "\${FAKE_HOST_GLES:-GLES: Google (Intel), Android Emulator OpenGL ES Translator (Mesa Intel(R) Arc(tm) Graphics), OpenGL ES 3.0}"
    else printf 'GLES: Google (Google), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0 SwiftShader\\n'; fi ;;
  *"shell getprop ro.hardware.vulkan") printf '\\n' ;;
  *"shell settings get global "*) printf '1\\n' ;;
  *"shell cat /proc/meminfo") printf 'MemTotal:        2000000 kB\\n' ;;
  *"shell wm size") printf 'Physical size: 1080x2340\\n' ;;
  *"shell wm density") printf 'Physical density: 440\\n' ;;
  *"shell getconf _NPROCESSORS_ONLN") printf '4\\n' ;;
  *"-exec stat -c %s {} +") printf '7\\n' ;;
esac`);
  for (const api of [31, 36]) {
    const image = `system-images/android-${api}/google_apis/x86_64`;
    await mkdir(join(h.env.ANDROID_HOME, image), {recursive: true});
    await writeFile(join(h.env.ANDROID_HOME, image, 'source.properties'), `Pkg.Revision=${api}\n`);
    await mkdir(join(h.root, `.android/avd/dependency_api${api}.avd`), {recursive: true});
    await writeFile(join(h.root, `.android/avd/dependency_api${api}.avd/config.ini`), `image.sysdir.1 = ${image}/\n`);
  }
  await writeFile(join(h.root, 'uid'), '2000\n');
  // A private host image: Intel display with an accessible render node and
  // NVIDIA's audio function only. Probes read it; nothing on the real host.
  const pci = join(h.root, 'host/sys/bus/pci');
  for (const [address, cls, vendor, device, driver, node] of [
    ['0000:00:02.0', '0x030000', '0x8086', '0x7d55', 'i915', 'renderD128'],
    ['0000:01:00.1', '0x040300', '0x10de', '0x22bd', 'snd_hda_intel', null]]) {
    const d = join(pci, 'devices', address);
    await mkdir(join(d, 'drm'), {recursive: true});
    await writeFile(join(d, 'class'), `${cls}\n`);
    await writeFile(join(d, 'vendor'), `${vendor}\n`);
    await writeFile(join(d, 'device'), `${device}\n`);
    await mkdir(join(pci, 'drivers', driver), {recursive: true});
    await symlink(join(pci, 'drivers', driver), join(d, 'driver'));
    if (node) { await mkdir(join(d, 'drm', node)); }
  }
  await mkdir(join(h.root, 'host/dev/dri'), {recursive: true});
  await writeFile(join(h.root, 'host/dev/dri/renderD128'), '');
  await writeFile(join(h.root, 'host/dev/kvm'), '');
  h.env.SYNCSCOPE_HOST_ROOT = join(h.root, 'host');
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

test('watchdog shutdown waits for both asynchronous init services before unrooting on both APIs', async t => {
  for (const api of [31, 36]) {
    for (const service of ['0', '1']) {
      await t.test(`API ${api}, delayed llkd-${service}`, async t2 => {
        const h = await productionHarness(t2);
        const result = h.run(['e2e', '--api', String(api)], {FAKE_WATCHDOG_DELAY: service});
        assert.equal(result.status, 0, result.stderr);
        assert.equal(await readFile(join(h.root, `watchdog-polls-${service}`), 'utf8'), '3\n');
        const log = await h.log();
        assert.match(log, /shell getprop init.svc.llkd-0/);
        assert.match(log, /shell getprop init.svc.llkd-1/);
        assert.ok(log.lastIndexOf('shell getprop init.svc.llkd-1') < log.indexOf(' unroot\n'));
        assert.match(log, / unroot[\s\S]*shell id -u[\s\S]*shell getprop sys.boot_completed[\s\S]*shell ip route/);
      });
    }
  }
});

// Feature 008 (T041): the one debug build runs before any emulator starts, so
// a failed startup is followed by no build, install or Maestro run.
function assertNothingAfterBoot(log) {
  const lines = log.split('\n');
  const boot = lines.findIndex(line => line.startsWith('emulator '));
  assert.ok(boot >= 0, 'the emulator was started');
  assert.ok(!lines.slice(boot).some(line => /^(gradle |maestro$|adb -s \S+ install )/.test(line)),
    'nothing is built, installed or run after the failed startup');
}

test('watchdog failures and unknown observations never become readiness; rooted failures still unroot and release', async t => {
  for (const fault of ['root', 'unroot', 'stop0', 'stop1', 'read0', 'read', 'empty', 'malformed', 'running']) {
    await t.test(fault, async t2 => {
      const h = await productionHarness(t2);
      const result = h.run(['e2e'], {FAKE_WATCHDOG_FAULT: fault});
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Could not stop llkd/);
      const log = await h.log();
      // The shared debug build precedes boot (T041); nothing is built,
      // installed or run after the failed startup.
      assertNothingAfterBoot(log);
      if (fault !== 'root') assert.match(log, / unroot\n/);
      assert.match(log, /emulator terminated dependency_api31/);
      await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
      const [id] = await readdir(join(h.root, 'reports'));
      assert.equal(await readFile(join(h.root, 'reports', id, 'raw/lifecycle/emulator-31'), 'utf8'), 'released\n');
      const diagnostic = await readFile(join(h.root, 'reports', id, 'raw/validator-31/watchdog.private'), 'utf8');
      assert.match(diagnostic, /failed/);
      assert.doesNotMatch(diagnostic, /CANARY|password|synthetic|emulator-5554/);
    });
  }
});

test('a nonzero adb root/unroot exit is recorded but the shell uid proves the switch on both APIs', async t => {
  for (const api of [31, 36]) {
    for (const fault of ['root-exit', 'unroot-exit']) {
      await t.test(`API ${api}, ${fault}`, async t2 => {
        const h = await productionHarness(t2);
        const result = h.run(['e2e', '--api', String(api)], {FAKE_WATCHDOG_FAULT: fault});
        assert.equal(result.status, 0, result.stderr);
        const log = await h.log();
        assert.match(log, / root\n[\s\S]*shell id -u[\s\S]*ctl\.stop llkd-0[\s\S]* unroot\n[\s\S]*shell id -u[\s\S]*shell getprop sys.boot_completed/);
        const [id] = await readdir(join(h.root, 'reports'));
        const diagnostic = await readFile(join(h.root, 'reports', id, `raw/validator-${api}/watchdog.private`), 'utf8');
        const step = fault.replace('-exit', '');
        assert.match(diagnostic, new RegExp(`^${step}:nonzero$`, 'm'));
        assert.match(diagnostic, new RegExp(`^${step}-uid:verified$`, 'm'));
        assert.match(diagnostic, /shutdown:passed\n$/);
        assert.doesNotMatch(diagnostic, /failed/);
      });
    }
  }
});

test('images with absent llkd-0 still require affirmative llkd-1 shutdown', async t => {
  const h = await productionHarness(t);
  const run = h.run(['e2e'], {FAKE_WATCHDOG_FAULT: 'absent0'});
  assert.equal(run.status, 0, run.stderr);
  const [id] = await readdir(join(h.root, 'reports'));
  const diagnostic = await readFile(join(h.root, 'reports', id, 'raw/validator-31/watchdog.private'), 'utf8');
  assert.match(diagnostic, /service-0:absent[\s\S]*service-1:stopped[\s\S]*shutdown:passed/);
});

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

test('measurement-owned emulator gets a finite four-hour cap, with retained policy evidence', async t => {
  const h = await productionHarness(t);
  // This fake has no real KVM metadata, so the original-mode gate may reject it
  // after boot. The production acquisition/timeout/cleanup path still executes.
  const result = h.run(['measure']);
  assert.notEqual(result.status, null, result.stderr);
  assert.match(await h.log(), /emulator lifetime 14400\n/);
  assert.doesNotMatch(await h.log(), /emulator lifetime 9000\n/);
  const [id] = await readdir(join(h.root, 'reports'));
  assert.equal(await readFile(join(h.root, 'reports', id, 'raw/validator-31/emulator-lifetime-seconds'), 'utf8'),
    '14400\n');
  assert.match(await h.log(), /emulator terminated dependency_api31/);
});

test('nonmeasurement invocations ignore lifetime environment overrides and retain 9000 seconds', async t => {
  for (const mode of ['e2e', 'connected']) {
    await t.test(mode, async t2 => {
      const h = await productionHarness(t2);
      const result = h.run([mode], {SYNCSCOPE_EMULATOR_LIFETIME: '999999',
        SYNCSCOPE_INVOCATION_MODE: 'measure'});
      assert.equal(result.status, 0, result.stderr);
      assert.match(await h.log(), /emulator lifetime 9000\n/);
      assert.doesNotMatch(await h.log(), /emulator lifetime 14400\n/);
    });
  }
});

test('standalone and borrowed validators cannot extend lifetime using an unauthenticated mode record', async t => {
  const h = await productionHarness(t);
  const receipt = join(h.root, 'validator-receipt');
  const args = ['--api', '31', '--avd', 'dependency_api31', '--state', join(h.state, 'api31'),
    '--exclusive-lock', join(h.state, 'validator.lock')];
  const validator = (action, extra = {}) => spawnSync('sh',
    [join(h.repo, 'scripts/validation/android-validator.sh'), action, ...args],
    {env: {...h.env, SYNCSCOPE_RESOURCE_RECEIPT: receipt, ...extra}, encoding: 'utf8', timeout: 10000});
  const spoof = join(h.root, 'invocation-mode');
  await writeFile(spoof, 'synthetic-owner:measure\n', {mode: 0o600});
  assert.equal(validator('start', {SYNCSCOPE_INVOCATION_TOKEN: 'synthetic-owner',
    SYNCSCOPE_INVOCATION_MODE_FILE: spoof}).status, 1);
  assert.doesNotMatch(await h.log(), /emulator acquired-process/);
  assert.equal(validator('start').status, 0);
  assert.match(await h.log(), /emulator lifetime 9000\n/);
  const originalPolicy = await readFile(join(h.state, 'api31/emulator-lifetime-seconds'), 'utf8');
  assert.equal(validator('start', {SYNCSCOPE_INVOCATION_MODE_FILE: spoof}).status, 0);
  assert.equal(await readFile(receipt, 'utf8'), 'borrowed\n');
  assert.equal(await readFile(join(h.state, 'api31/emulator-lifetime-seconds'), 'utf8'), originalPolicy);
  assert.equal(validator('stop').status, 0);
});

test('measurement authority rejects missing inherited lock, token mismatch, symlinks and extra mode lines', async t => {
  const h = await productionHarness(t);
  const authority = await mkdtemp('/tmp/cloud-sync-checker-claims-');
  await chmod(authority, 0o700);
  t.after(() => rm(authority, {recursive: true, force: true}));
  const modeFile = join(authority, 'invocation-mode');
  const receipt = join(authority, 'emulator-31');
  const lock = join(h.state, 'invocation.lock');
  await writeFile(lock, '', {mode: 0o600});
  await writeFile(modeFile, 'owner:measure\n', {mode: 0o600});
  const args = ['start', '--api', '31', '--avd', 'dependency_api31', '--state', join(h.state, 'api31'),
    '--exclusive-lock', join(h.state, 'validator.lock')];
  const run = (locked, extra = {}) => spawnSync('sh', locked
    ? ['-c', 'exec 6>>"$1"; flock -n 6 || exit 1; shift; exec sh "$@"', 'authority', lock,
      join(h.repo, 'scripts/validation/android-validator.sh'), ...args]
    : [join(h.repo, 'scripts/validation/android-validator.sh'), ...args],
  {env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: 'owner', SYNCSCOPE_RESOURCE_RECEIPT: receipt,
    SYNCSCOPE_INVOCATION_MODE_FILE: modeFile, ...extra}, encoding: 'utf8', timeout: 10000});
  assert.equal(run(false).status, 1);
  assert.equal(run(true, {SYNCSCOPE_INVOCATION_TOKEN: 'foreign'}).status, 1);
  await writeFile(modeFile, 'owner:measure\n\n', {mode: 0o600});
  assert.equal(run(true).status, 1);
  await writeFile(modeFile, 'owner:unknown\n', {mode: 0o600});
  assert.equal(run(true).status, 1);
  await rm(modeFile);
  await writeFile(join(authority, 'target'), 'owner:measure\n', {mode: 0o600});
  await symlink(join(authority, 'target'), modeFile);
  assert.equal(run(true).status, 1);
  assert.doesNotMatch(await h.log(), /emulator acquired-process/);
  await rm(modeFile);
  await writeFile(modeFile, 'owner:release-smoke\n', {mode: 0o600});
  const release = run(true);
  assert.equal(release.status, 0, release.stderr);
  assert.match(await h.log(), /emulator lifetime 9000\n/);
  const stop = spawnSync('sh', [join(h.repo, 'scripts/validation/android-validator.sh'),
    'stop', ...args.slice(1)], {env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: 'owner',
    SYNCSCOPE_RESOURCE_RECEIPT: receipt}, encoding: 'utf8', timeout: 10000});
  assert.equal(stop.status, 0, stop.stderr);
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

test('protocol container restarts are recorded per service and surfaced in the run report', async t => {
  const h = await productionHarness(t);
  const run = h.run(['e2e'], {FAKE_FTP_RESTART: '1'});
  assert.equal(run.status, 0, run.stderr);
  const [id] = await readdir(join(h.root, 'reports'));
  const directory = join(h.root, 'reports', id);
  assert.equal(await readFile(join(directory, 'raw/lifecycle/ftp.restarts'), 'utf8'),
    'before 0\nafter 1\n1792000000123456789 die\n1792000000456789012 start\n');
  assert.equal(await readFile(join(directory, 'raw/lifecycle/sftp.restarts'), 'utf8'), 'before 0\nafter 0\n');
  const report = JSON.parse(await readFile(join(directory, 'run.json')));
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.serviceRestarts, [
    {protocol: 'ftp', restarts: 1, events: [
      {action: 'die', unixMs: 1792000000123}, {action: 'start', unixMs: 1792000000456}]},
    {protocol: 'sftp', restarts: 0, events: []},
    {protocol: 'webdav', restarts: 0, events: []},
  ]);
  const markdown = await readFile(join(directory, 'report.md'), 'utf8');
  assert.match(markdown, /\| Service \| Container restarts \| Restart events \|/);
  assert.match(markdown, /\| ftp \| 1 \| die 2026-10-14T[0-9:.]+Z, start 2026-10-14T[0-9:.]+Z \|/);
  assert.match(markdown, /\| sftp \| 0 \| none \|/);
});

test('a malformed restart event record fails the scoped protocol audit', async t => {
  const h = await productionHarness(t);
  const run = h.run(['e2e'], {FAKE_FTP_RESTART: '1', SYNCSCOPE_TEST_EVENTS_FAULT: '1'});
  assert.notEqual(run.status, 0, run.stderr);
  const [id] = await readdir(join(h.root, 'reports'));
  const report = JSON.parse(await readFile(join(h.root, 'reports', id, 'run.json')));
  assert.equal(report.status, 'failed');
  assert.equal(report.failureCode, 'audit');
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

async function expiredMetroHarness(t) {
  const h = await productionHarness(t);
  const exited = spawn('/usr/bin/true');
  await new Promise((resolve, reject) => {
    exited.once('error', reject);
    exited.once('exit', resolve);
  });
  const state = join(h.state, 'metro');
  const receipt = join(h.root, 'metro-receipt');
  const evidence = join(h.root, 'metro-evidence');
  await mkdir(state, {mode: 0o700});
  await mkdir(join(evidence, 'raw'), {recursive: true, mode: 0o700});
  for (const [name, value] of Object.entries({
    owner: 'metro', claim: 'expired-owner', pid: String(exited.pid),
    'process-identity': '12345', 'metro.log': 'synthetic retained deadline diagnostic',
  })) {
    await writeFile(join(state, name), `${value}\n`, {mode: 0o600});
  }
  await writeFile(receipt, 'acquired\n', {mode: 0o600});
  h.stopExpired = (extra = {}) => spawnSync('sh', [
    join(h.repo, 'scripts/validation/metro-service.sh'), 'stop',
    '--host', '127.0.0.1', '--port', '8081', '--state', state,
  ], {cwd: h.repo, env: {...h.env, SYNCSCOPE_INVOCATION_TOKEN: 'expired-owner',
    SYNCSCOPE_RESOURCE_RECEIPT: receipt, SYNCSCOPE_PERFORMANCE_DIR: evidence, ...extra},
  encoding: 'utf8', timeout: 10000});
  return {...h, metroState: state, receipt, evidence, expiredPid: exited.pid};
}

test('expired owned Metro releases only absent acquired identity and retains its diagnostic', async t => {
  const h = await expiredMetroHarness(t);
  const stopped = h.stopExpired();
  assert.equal(stopped.status, 0, stopped.stderr);
  await assert.rejects(lstat(h.metroState), /ENOENT/);
  assert.equal(await readFile(h.receipt, 'utf8'), 'released\n');
  assert.equal(await readFile(join(h.evidence, 'raw/metro.log'), 'utf8'),
    'synthetic retained deadline diagnostic\n');
  assert.doesNotMatch(await h.log(), /metro terminated/);
});

test('expired Metro refuses ambiguous, borrowed, foreign and still-active resources', async t => {
  for (const problem of ['borrowed', 'missing-receipt', 'foreign-claim', 'missing-token',
    'reused-pid', 'occupied-port', 'surviving-group', 'socket-check-failed',
    'group-check-failed', 'symlink-pid', 'invalid-pid', 'missing-identity',
    'diagnostic-copy-failed']) {
    await t.test(problem, async t2 => {
      const h = await expiredMetroHarness(t2);
      let extra = {};
      if (problem === 'borrowed') await writeFile(h.receipt, 'borrowed\n');
      if (problem === 'missing-receipt') await rm(h.receipt);
      if (problem === 'foreign-claim') extra.SYNCSCOPE_INVOCATION_TOKEN = 'foreign-owner';
      if (problem === 'missing-token') extra.SYNCSCOPE_INVOCATION_TOKEN = '';
      if (problem === 'reused-pid') await writeFile(join(h.metroState, 'pid'), `${process.pid}\n`);
      if (problem === 'occupied-port') await writeFile(join(h.root, 'metro-ready'), 'foreign\n');
      if (problem === 'surviving-group') await executable(join(h.bin, 'ps'), `printf '${h.expiredPid}\\n'`);
      if (problem === 'socket-check-failed') await executable(join(h.bin, 'ss'), 'exit 2');
      if (problem === 'group-check-failed') await executable(join(h.bin, 'ps'), 'exit 2');
      if (problem === 'symlink-pid') {
        await rm(join(h.metroState, 'pid'));
        await writeFile(join(h.root, 'foreign-pid'), `${h.expiredPid}\n`);
        await symlink(join(h.root, 'foreign-pid'), join(h.metroState, 'pid'));
      }
      if (problem === 'invalid-pid') await writeFile(join(h.metroState, 'pid'), '0\n');
      if (problem === 'missing-identity') await rm(join(h.metroState, 'process-identity'));
      if (problem === 'diagnostic-copy-failed') await executable(join(h.bin, 'cp'), 'exit 17');
      const stopped = h.stopExpired(extra);
      assert.notEqual(stopped.status, 0);
      assert.ok((await lstat(h.metroState)).isDirectory());
      assert.equal(await readFile(join(h.metroState, 'metro.log'), 'utf8'),
        'synthetic retained deadline diagnostic\n');
      if (problem !== 'missing-receipt') {
        assert.equal(await readFile(h.receipt, 'utf8'), problem === 'borrowed' ? 'borrowed\n' : 'acquired\n');
      }
      assert.doesNotMatch(await h.log(), /metro terminated/);
    });
  }
});

// Feature 008 US2: candidate-owned graphics attempts, verified fallback and
// owned-resource safety. Probes read only the private host image above.
async function acceleration(h, api = 31) {
  const [id] = await readdir(join(h.root, 'reports'));
  const run = JSON.parse(await readFile(join(h.root, 'reports', id, 'run.json'), 'utf8'));
  return {id, run, apiRun: run.apiRuns.find(a => a.api === api)};
}
const between = (log, first, marker, second) => {
  const a = log.indexOf(first), b = log.indexOf(marker, a), c = log.indexOf(second, a);
  return a !== -1 && b > a && c > b;
};

test('auto falls back after stopping only the failed owned host candidate, then verifies software', async t => {
  for (const [label, extra, reason] of [
    ['host launch failure', {FAKE_GPU_FAIL: 'host'}, 'emulator-exited'],
    ['software renderer under a host request', {FAKE_HOST_GLES: 'GLES: Google, Translator (Google SwiftShader)'}, 'software-under-host'],
    ['wrong GPU despite the requested route', {FAKE_HOST_GLES: 'GLES: Google (NVIDIA Corporation), Translator (NVIDIA GeForce RTX)'}, 'wrong-gpu'],
  ]) {
    await t.test(label, async t2 => {
      const h = await productionHarness(t2);
      const foreign = spawn('/usr/bin/sleep', ['30']);
      t2.after(() => { try { foreign.kill('SIGTERM'); } catch {} });
      const result = h.run(['e2e', '--graphics', 'auto'], extra);
      assert.equal(result.status, 0, result.stderr);
      const log = await h.log();
      assert.match(log, /emulator gpu host accel-on feature-Vulkan\n[\s\S]*emulator gpu swiftshader accel-on\n/);
      assert.doesNotMatch(log, /WIPE|emulator gpu swiftshader_indirect/);
      if (reason !== 'emulator-exited') {
        // The rejected candidate's own process is released before the next launch.
        assert.ok(between(log, 'emulator gpu host', 'emulator terminated dependency_api31', 'emulator gpu swiftshader'), log);
      }
      assert.equal(foreign.exitCode, null, 'a foreign process is never terminated');
      const {id, apiRun} = await acceleration(h);
      const a = apiRun.acceleration;
      assert.equal(a.requestedProfile, 'auto');
      assert.deepEqual(a.attempts.map(x => [x.candidateId, x.state, x.reason]),
        [['host-intel-1', reason === 'emulator-exited' ? 'boot-failed' : 'verification-failed', reason],
          ['software-swiftshader', 'selected', null]]);
      assert.equal(a.fallback, true);
      assert.equal(apiRun.profile.fallback, true);
      assert.equal(apiRun.profile.graphics, 'software');
      assert.equal(apiRun.profile.verified, true);
      // NVIDIA is excluded (decision 2026-10-20) whatever the host exposes.
      assert.equal(a.candidates.find(c => c.candidateId === 'host-nvidia-1').reason, 'excluded');
      assert.equal(a.selection.status, 'provisional');
      const retained = await readFile(join(h.root, 'reports', id, 'raw/validator-31/acceleration.private.json'), 'utf8');
      assert.doesNotMatch(retained, /CANARY|password|SwiftShader\)|Translator|\/tmp\//);
      await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
    });
  }
});

test('hardware verification passes only with KVM, Intel renderer and the owned render node', async t => {
  const h = await productionHarness(t);
  const result = h.run(['e2e', '--api', '31', '--api', '36', '--graphics', 'host-opengl']);
  assert.equal(result.status, 0, result.stderr);
  for (const api of [31, 36]) {
    const {apiRun} = await acceleration(h, api);
    assert.deepEqual(apiRun.acceleration.attempts.map(x => [x.candidateId, x.state, x.backend, x.vulkan]),
      [['host-intel-1', 'selected', 'host', 'absent']]);
    assert.equal(apiRun.profile.graphics, 'hardware');
    assert.equal(apiRun.profile.cpu, 'kvm');
    assert.equal(apiRun.profile.verified, true);
    assert.equal(apiRun.profile.fallback, false);
  }
  assert.equal((await h.log()).split('\n').filter(l => l.startsWith('emulator gpu ')).length, 2);
});

test('all candidates fail: actionable nonzero exhaustion and no surviving acquired resources', async t => {
  const h = await productionHarness(t);
  const result = h.run(['e2e', '--graphics', 'auto'], {FAKE_GPU_FAIL: 'all'});
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /No graphics candidate worked for API 31/);
  const log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')).map(l => l.split(' ')[2]),
    ['host', 'swiftshader', 'software', 'lavapipe', 'swangle']);
  assertNothingAfterBoot(log);
  await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
  const {id} = await acceleration(h);
  assert.equal(await readFile(join(h.root, 'reports', id, 'raw/lifecycle/emulator-31'), 'utf8'), 'released\n');
  const retained = JSON.parse(await readFile(join(h.root, 'reports', id, 'raw/validator-31/acceleration.private.json'), 'utf8'));
  assert.deepEqual(retained.attempts.map(x => x.state), Array(5).fill('boot-failed'));
  for (const name of ['syncscope-sftp', 'syncscope-webdav', 'syncscope-ftp']) {
    await assert.rejects(lstat(join(h.state, name)), /ENOENT/);
  }
});

test('unusable KVM fails before any candidate launch instead of silent software CPU emulation', async t => {
  for (const profile of ['auto', 'host-opengl', 'software']) {
    await t.test(profile, async t2 => {
      const h = await productionHarness(t2);
      const result = h.run(['e2e', '--graphics', profile], {FAKE_KVM: '0'});
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /KVM/);
      assert.doesNotMatch(await h.log(), /emulator gpu |emulator acquired-process/);
      await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
    });
  }
});

test('a held emulator lock or foreign online emulator rejects before any candidate claim or mutation', async t => {
  const h = await productionHarness(t);
  const lock = join(h.state, 'validator.lock');
  await writeFile(lock, '');
  const holder = spawn('setsid', ['flock', lock, 'sleep', '20']);
  t.after(() => { try { process.kill(-holder.pid, 'SIGTERM'); } catch {} });
  await new Promise(resolve => setTimeout(resolve, 100));
  const result = h.run(['e2e', '--graphics', 'auto']);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Another validator owns the emulator lock/);
  assert.doesNotMatch(await h.log(), /emulator gpu |emulator acquired-process|emulator terminated/);
  assert.equal(holder.exitCode, null, 'the lock holder is not terminated');
  assert.equal((await lstat(lock)).isFile(), true);
  await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
});

test('interruption during candidate startup releases only that candidate and retains its diagnostics', async t => {
  const h = await productionHarness(t);
  const result = h.run(['e2e', '--graphics', 'auto'], {FAKE_INTERRUPT_GPU: 'host'});
  assert.equal(result.status, 130, result.stderr);
  const log = await h.log();
  assert.match(log, /emulator gpu host[\s\S]*emulator terminated dependency_api31/);
  assert.doesNotMatch(log, /emulator gpu swiftshader/);
  await assert.rejects(lstat(join(h.state, 'api31')), /ENOENT/);
  const {id, run} = await acceleration(h);
  assert.equal(run.status, 'interrupted');
  assert.equal(await readFile(join(h.root, 'reports', id, 'raw/lifecycle/emulator-31'), 'utf8'), 'released\n');
  const retained = JSON.parse(await readFile(join(h.root, 'reports', id, 'raw/validator-31/acceleration.private.json'), 'utf8'));
  assert.equal(retained.attempts[0].candidateId, 'host-intel-1');
});

test('default, connected and release CLI keep the original single legacy request without fallback', async t => {
  for (const mode of ['e2e', 'connected']) {
    await t.test(mode, async t2 => {
      const h = await productionHarness(t2);
      const result = h.run([mode]);
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual((await h.log()).split('\n').filter(l => l.startsWith('emulator gpu ')),
        ['emulator gpu swiftshader_indirect accel-default']);
      const {apiRun} = await acceleration(h);
      assert.equal(apiRun.acceleration.requestedProfile, 'legacy');
      assert.equal(apiRun.acceleration.selection.status, 'legacy');
    });
  }
  const h = await harness(t);
  for (const args of [['release-smoke', '--graphics', 'gpu'], ['connected', '--graphics'],
    ['e2e', '--graphics', 'legacy']]) {
    assert.equal(h.run(args).status, 64, args.join(' '));
  }
  assert.equal(await h.log(), '');
});

test('acceleration never wipes AVDs or changes host security, power or drivers', async () => {
  for (const file of ['android-validator.sh', 'android-flow.sh', 'performance-acceleration.mjs', 'performance-report.mjs']) {
    const source = await readFile(join(repository, 'scripts/validation', file), 'utf8');
    assert.doesNotMatch(source, /-wipe-data|\bmodprobe\b|\bsysctl\b|\bcpupower\b|\bsetfacl\b|\bnvidia-smi\b|\bpowerprofilesctl\b|\btee\s+\/sys|>\s*\/sys\/|chmod[^\n]*\/dev\/|\bpkill\b|\bkillall\b/, file);
  }
});

async function newestRun(h, before) {
  const names = (await readdir(join(h.root, 'reports'))).filter(n => n.startsWith('inv-') && !before.includes(n));
  assert.equal(names.length, 1);
  const run = JSON.parse(await readFile(join(h.root, 'reports', names[0], 'run.json'), 'utf8'));
  return {id: names[0], run, apiRun: run.apiRuns[0]};
}

async function freshInvocation(h) {
  await writeFile(h.calls, '');
  // The recording Docker keeps released containers' port markers; a new
  // invocation must find its approved ports free again.
  for (const name of await readdir(h.root)) {
    if (name.startsWith('container-')) { await rm(join(h.root, name), {force: true}); }
  }
}
const seenRuns = async h => (await readdir(join(h.root, 'reports'))).filter(n => n.startsWith('inv-'));
async function rankingStoreOf(h) {
  return JSON.parse(await readFile(join(h.root, 'reports/acceleration-ranking.json'), 'utf8'));
}

test('measure auto calibrates exactly one candidate per invocation and ranks only once every planned candidate has a result', async t => {
  const h = await productionHarness(t);
  // First invocation: only the first planned candidate, with its own Metro.
  const first = h.run(['measure', '--graphics', 'auto']);
  assert.equal(first.status, 0, first.stderr);
  let log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')).map(l => l.split(' ')[2]), ['host']);
  assert.equal(log.split('\n').filter(l => l === 'metro acquired-process').length, 1);
  assert.equal(log.split('\n').filter(l => l === 'maestro').length, 24);
  const one = await newestRun(h, []);
  let acc = one.apiRun.acceleration;
  assert.deepEqual(acc.calibration.map(c => [c.candidateId, c.status, c.samples.length, c.verified]),
    [['host-intel-1', 'measured', 24, true]]);
  // Its own samples are this renderer's cohort; nothing is ranked yet.
  assert.equal(one.apiRun.samples.length, 24);
  assert.ok(one.apiRun.samples.every(s => s.sampleId.includes('-host-intel-1-')));
  assert.equal(one.apiRun.profile.graphics, 'hardware');
  assert.equal(acc.selection.status, 'provisional');
  assert.equal(acc.selection.selectedCandidateId, 'host-intel-1');
  assert.equal(acc.selection.rankedCandidateId, null);
  let store = await rankingStoreOf(h);
  assert.equal(store.apis['31'], undefined, 'an incomplete calibration is never stored as ranked');
  assert.deepEqual(store.calibrations['31'].planned, ['host-intel-1', 'software-swiftshader']);
  assert.deepEqual(store.calibrations['31'].results.map(r => [r.candidateId, r.status, r.invocationId]),
    [['host-intel-1', 'measured', one.id]]);

  // Second invocation: the next planned candidate only, then the ranking.
  await freshInvocation(h);
  const second = h.run(['measure', '--graphics', 'auto']);
  assert.equal(second.status, 0, second.stderr);
  log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')).map(l => l.split(' ')[2]), ['swiftshader']);
  assert.equal(log.split('\n').filter(l => l === 'maestro').length, 24);
  const two = await newestRun(h, [one.id]);
  acc = two.apiRun.acceleration;
  assert.deepEqual(acc.calibration.map(c => [c.candidateId, c.status, c.samples.length]),
    [['software-swiftshader', 'measured', 24]]);
  assert.ok(two.apiRun.samples.every(s => s.sampleId.includes('-software-swiftshader-')));
  assert.equal(two.apiRun.profile.graphics, 'software');
  // Equal synthetic timings are a tie: the simpler stable configuration wins.
  assert.equal(acc.selection.status, 'ranked');
  assert.equal(acc.selection.tie, true);
  assert.equal(acc.selection.selectedCandidateId, 'software-swiftshader');
  assert.equal(acc.selection.rankedCandidateId, 'software-swiftshader');
  assert.deepEqual(acc.selection.order.map(o => o.candidateId), ['software-swiftshader', 'host-intel-1']);
  store = await rankingStoreOf(h);
  assert.equal(store.apis['31'].selectedCandidateId, 'software-swiftshader');
  assert.equal(store.apis['31'].rankingFingerprint, acc.selection.rankingFingerprint);
  assert.deepEqual(store.apis['31'].calibrationInvocations, [one.id, two.id]);
  // The first invocation's retained record is never rewritten by the ranking.
  assert.deepEqual(JSON.parse(await readFile(join(h.root, 'reports', one.id, 'run.json'), 'utf8')), one.run);

  // Current ranking: a further measure auto does not calibrate again.
  await freshInvocation(h);
  const reuse = h.run(['measure', '--graphics', 'auto']);
  assert.equal(reuse.status, 0, reuse.stderr);
  log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')), ['emulator gpu swiftshader accel-on']);
  const three = await newestRun(h, [one.id, two.id]);
  assert.equal(three.apiRun.acceleration.selection.status, 'current');
  assert.deepEqual(three.apiRun.acceleration.calibration, []);

  const auto = async () => {
    const before = await seenRuns(h);
    await freshInvocation(h);
    const result = h.run(['e2e', '--graphics', 'auto']);
    assert.equal(result.status, 0, result.stderr);
    return newestRun(h, before);
  };
  // Unchanged inputs reuse the ranked choice first and report it current.
  let next = await auto();
  log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')), ['emulator gpu swiftshader accel-on']);
  assert.equal(next.apiRun.acceleration.selection.status, 'current');
  // Unrelated documentation and evidence never invalidate the ranking.
  await mkdir(join(h.repo, 'docs'), {recursive: true});
  await writeFile(join(h.repo, 'docs/validation-performance.md'), '# changed\n');
  next = await auto();
  assert.equal(next.apiRun.acceleration.selection.status, 'current');
  // Changed helper pacing invalidates it: explicitly stale, never best-performing.
  const helper = join(h.repo, 'validation/maestro/subflows/show-scrollbar.yaml');
  await writeFile(helper, `${await readFile(helper, 'utf8')}# pacing change\n`);
  next = await auto();
  assert.equal(next.apiRun.acceleration.selection.status, 'stale');
  assert.notEqual(next.apiRun.acceleration.selection.rankingFingerprint, store.apis['31'].rankingFingerprint);
  // A new calibration round then starts from the first planned candidate; the
  // retained earlier round is kept, not merged.
  await freshInvocation(h);
  const recalibrate = h.run(['measure', '--graphics', 'auto']);
  assert.equal(recalibrate.status, 0, recalibrate.stderr);
  log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')).map(l => l.split(' ')[2]), ['host']);
  store = await rankingStoreOf(h);
  assert.equal(store.calibrations['31'].results.length, 1);
  assert.equal(store.calibrationHistory['31'].length, 1);
  assert.deepEqual(store.calibrationHistory['31'][0].results.map(r => r.candidateId), ['host-intel-1', 'software-swiftshader']);
});

test('a calibration candidate that fails to boot is retained as incompatible, not ranked or fatal', async t => {
  const h = await productionHarness(t);
  const result = h.run(['measure', '--graphics', 'auto'], {FAKE_GPU_FAIL: 'host'});
  // The incompatible candidate is recorded; this invocation measured no baseline.
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /host-intel-1 did not boot for API 31/);
  const one = await newestRun(h, []);
  assert.equal(one.run.status, 'failed');
  let acc = one.apiRun.acceleration;
  assert.deepEqual(acc.calibration.map(c => [c.candidateId, c.status, c.reason, c.samples.length]),
    [['host-intel-1', 'boot-failed', 'emulator-exited', 0]]);
  assert.equal(one.apiRun.samples.length, 0);
  assert.equal(acc.selection.status, 'provisional');
  assert.equal(acc.selection.rankedCandidateId, null);
  let log = await h.log();
  assert.equal(log.split('\n').filter(l => l === 'maestro').length, 0, 'a failed candidate is not retried in its own run');
  await freshInvocation(h);
  const second = h.run(['measure', '--graphics', 'auto'], {FAKE_GPU_FAIL: 'host'});
  assert.equal(second.status, 0, second.stderr);
  log = await h.log();
  assert.deepEqual(log.split('\n').filter(l => l.startsWith('emulator gpu ')).map(l => l.split(' ')[2]), ['swiftshader']);
  const two = await newestRun(h, [one.id]);
  acc = two.apiRun.acceleration;
  assert.deepEqual(acc.calibration.map(c => [c.candidateId, c.status, c.reason, c.samples.length]),
    [['software-swiftshader', 'measured', null, 24]]);
  assert.equal(acc.selection.status, 'ranked');
  assert.equal(acc.selection.selectedCandidateId, 'software-swiftshader');
  assert.equal(acc.selection.order.find(o => o.candidateId === 'host-intel-1').status, 'boot-failed');
  assert.equal(two.apiRun.samples.length, 24);
  const store = await rankingStoreOf(h);
  assert.equal(store.apis['31'].selectedCandidateId, 'software-swiftshader');
});

// Feature 008, US1 (T032): build and staged lifecycle contracts for T041/T042.
const debugBuilds = log => log.split('\n').filter(line => /^gradle .*:app:assembleDebug/.test(line));
const debugInstalls = log => log.split('\n').filter(line => /^adb -s \S+ install /.test(line));

async function onlyReport(h) {
  const [id] = await readdir(join(h.root, 'reports'));
  return JSON.parse(await readFile(join(h.root, 'reports', id, 'run.json')));
}

test('e2e assembles one emulator-only x86_64 debug APK before boot and installs it on both APIs', async t => {
  const h = await harness(t);
  const run = h.run(['e2e', '--api', '31', '--api', '36']);
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  const builds = debugBuilds(log);
  assert.equal(builds.length, 1, 'one debug assembly for the whole invocation');
  assert.match(builds[0], /(?:^| )-PreactNativeArchitectures=x86_64(?: |$)/);
  assert.match(builds[0], /--no-daemon|--daemon/, 'the Gradle daemon policy is explicit');
  assert.ok(log.indexOf(builds[0]) < log.indexOf('validator start'), 'built before the API loop');
  const installs = debugInstalls(log);
  assert.equal(installs.length, 2, 'one install per API');
  assert.equal(new Set(installs.map(line => line.split(' ').at(-1))).size, 1, 'the same APK file');
  const report = await onlyReport(h);
  assert.equal(report.build.abi, 'x86_64');
  assert.ok(['no-daemon', 'default'].includes(report.build.cachePolicy));
  assert.ok(report.build.apkDigest);
  for (const apiRun of report.apiRuns) {
    assert.deepEqual(apiRun.build, report.build, `API ${apiRun.api} records the shared build`);
    assert.ok(!apiRun.phases.some(phase => phase.phase === 'build'), 'no per-API build phase');
  }
  assert.equal(report.sharedPhases.filter(phase => phase.phase === 'build').length, 1);
});

test('measure shares the same single x86_64 debug build across APIs', async t => {
  const h = await harness(t);
  h.run(['measure', '--api', '31', '--api', '36'], {FAKE_BOOT_STATUS: '1'});
  const builds = debugBuilds(await h.log());
  assert.equal(builds.length, 1);
  assert.match(builds[0], /-PreactNativeArchitectures=x86_64/);
});

test('connected and release builds keep their original ABI, signing and update paths', async t => {
  const h = await harness(t);
  const run = h.run(['connected', '--api', '31', '--api', '36']);
  assert.equal(run.status, 0, run.stderr);
  const log = await h.log();
  const gradle = log.split('\n').filter(line => line.startsWith('gradle '));
  assert.equal(gradle.length, 2, 'connected instrumentation still builds per API');
  assert.ok(gradle.every(line => /connectedDebugAndroidTest/.test(line)));
  assert.doesNotMatch(log, /reactNativeArchitectures/);
  const report = await onlyReport(h);
  assert.equal(report.build.abi, 'instrumented');
  const flow = await readFile(join(h.repo, 'scripts/validation/android-flow.sh'), 'utf8');
  const release = flow.split('\n').filter(line => /assemble:release|assembleRelease/.test(line));
  assert.ok(release.length > 0);
  assert.ok(release.every(line => !/reactNativeArchitectures/.test(line)), 'release keeps every ABI');
});

test('a failed debug build boots, installs and runs nothing, and releases what it acquired', async t => {
  const h = await harness(t);
  const run = h.run(['e2e', '--api', '31', '--api', '36'], {FAKE_GRADLE_STATUS: '1'});
  assert.notEqual(run.status, 0);
  const log = await h.log();
  assert.equal(debugBuilds(log).length, 1);
  assert.doesNotMatch(log, /^validator start$/m, 'no emulator for an APK that does not exist');
  assert.equal(debugInstalls(log).length, 0);
  assert.doesNotMatch(log, /^maestro$/m);
  for (const service of ['sftp', 'webdav', 'ftp']) {
    if (log.includes(`protocol start ${service}`)) {
      assert.match(log, new RegExp(`^protocol stop ${service}$`, 'm'), `${service} released`);
    }
  }
  if (log.includes('metro start')) {
    assert.match(log, /^metro stop$/m);
  }
});

test('fixtures reset before each API, never between staged parts; restoration still runs', async t => {
  const h = await harness(t);
  const run = h.run(['e2e', '--api', '31', '--api', '36']);
  assert.equal(run.status, 0, run.stderr);
  const lines = (await h.log()).split('\n');
  const starts = lines.flatMap((line, index) => (line === 'validator start' ? [index] : []));
  assert.equal(starts.length, 2);
  for (const [n, start] of starts.entries()) {
    const end = starts[n + 1] ?? lines.length;
    const part = lines.slice(start, end);
    const fixtures = part.flatMap((line, index) => (line === 'fixtures' ? [index] : []));
    assert.equal(fixtures.length, 1, `API run ${n + 1} resets its fixtures once`);
    const workspace = part.findIndex(line => line.endsWith('/validation/maestro'));
    assert.ok(fixtures[0] < workspace, 'fixtures are reset before the workspace');
    const firstStaged = part.findIndex(line => /staged\/06-recheck-removed-a\.yaml$/.test(line));
    const lastStaged = part.findIndex(line => /staged\/08-changed-b\.yaml$/.test(line));
    const staged = part.slice(firstStaged, lastStaged + 1);
    assert.ok(firstStaged > workspace && lastStaged > firstStaged);
    assert.ok(!staged.some(line => /^(fixtures|gradle |adb -s \S+ install )/.test(line)),
      'staged continuation state is never reseeded, rebuilt or reinstalled');
  }
  assert.ok(lines.filter(line => line === 'hook restore-recheck-file').length >= 2);
});

test('a failing staged part still restores the recheck fixture and keeps the failure', async t => {
  const h = await harness(t);
  await executable(join(h.bin, 'maestro'), `
[ "\${1:-}" != --version ] || { printf '2.10.0\\n'; exit 0; }
printf 'maestro\\n' >>"$SYNCSCOPE_TEST_CALLS"
output=; flow=
while [ "$#" -gt 0 ]; do
  case "$1" in --test-output-dir) output=$2; shift 2 ;; --debug-output|-e) shift 2 ;;
    *) flow=$1; shift ;; esac
done
printf '%s\\n' "$flow" >>"$SYNCSCOPE_TEST_CALLS"
mkdir -p "$output"
count=1
[ "$flow" != "$SYNCSCOPE_TEST_ROOT/repo/validation/maestro" ] ||
  count=$(grep -c '^    - [a-z0-9/-]*$' "$flow/config.yaml")
i=1
while [ "$i" -le "$count" ]; do
  printf '%s\\n' '[{"command":{"assertConditionCommand":{}},"metadata":{"status":"COMPLETED","timestamp":1,"duration":1,"sequenceNumber":0,"depth":0}}]' >"$output/commands-$i.json"
  i=$((i + 1))
done
case "$flow" in *06-recheck-removed-b.yaml) exit 1 ;; esac
exit 0`);
  const run = h.run(['e2e', '--api', '31']);
  assert.notEqual(run.status, 0);
  const log = await h.log();
  assert.match(log, /06-recheck-removed-b\.yaml\n[\s\S]*hook restore-recheck-file/);
  assert.doesNotMatch(log, /07-delete-offline-a\.yaml/, 'the run stops at the failed part');
});
