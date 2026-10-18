import assert from 'node:assert/strict';
import {spawn, spawnSync} from 'node:child_process';
import {chmod, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';

import {createOverlay, parseArgs, runFaultCheck, sanitizeAttempts}
  from './acceleration-fault-check.mjs';

const script = new URL('./acceleration-fault-check.mjs', import.meta.url).pathname;
async function executable(path, contents) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `#!/bin/sh\n${contents}\n`, {mode: 0o700});
  await chmod(path, 0o700);
}
async function exists(path) { return lstat(path).then(() => true, () => false); }

// A fake installed SDK: the "real" emulator records how it was reached and
// exits with FAKE_EMULATOR_STATUS; nothing here is the user's SDK.
async function fakeSdk(t) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-fault-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const sdk = join(root, 'sdk'), calls = join(root, 'calls');
  await writeFile(calls, '');
  await executable(join(sdk, 'emulator/emulator'), `printf 'real %s home=%s token=%s\\n' "$*" "$ANDROID_HOME" "\${SYNCSCOPE_FAULT_TOKEN:-none}" >>"${calls}"
exit "\${FAKE_EMULATOR_STATUS:-0}"`);
  await writeFile(join(sdk, 'emulator/source.properties'), 'Pkg.Revision=37.1.11\n');
  await executable(join(sdk, 'platform-tools/adb'), 'exit 0');
  await mkdir(join(sdk, 'system-images/android-31'), {recursive: true});
  return {root, sdk, calls};
}
function run(command, args, env = {}) {
  return spawnSync(command, args, {encoding: 'utf8', env: {...process.env, ...env}});
}

test('parses only the planned interface', () => {
  assert.deepEqual(parseArgs(['--api', '31', '--api', '36', '--case', 'hardware-fallback', '--report-dir', '/x']),
    {apis: [31, 36], caseName: 'hardware-fallback', reportDir: '/x'});
  assert.deepEqual(parseArgs(['--case', 'all-options-fail', '--api', '36', '--report-dir', 'r']),
    {apis: [36], caseName: 'all-options-fail', reportDir: 'r'});
  for (const argv of [
    [], ['--api', '31', '--case', 'hardware-fallback'], ['--api', '30', '--case', 'hardware-fallback', '--report-dir', 'r'],
    ['--api', '31', '--api', '31', '--case', 'hardware-fallback', '--report-dir', 'r'],
    ['--api', '31', '--case', 'other', '--report-dir', 'r'], ['--case', 'hardware-fallback', '--report-dir', 'r'],
    ['--api', '31', '--case', 'hardware-fallback', '--report-dir', 'r', '--force'],
    ['--api', '31', '--case', 'hardware-fallback', '--case', 'all-options-fail', '--report-dir', 'r'],
  ]) { assert.throws(() => parseArgs(argv), /usage/, argv.join(' ')); }
});

test('overlay passes probes through and injects only token-scoped owned candidate launches', async t => {
  const {root, sdk, calls} = await fakeSdk(t);
  const token = 'a'.repeat(32);
  const overlay = await createOverlay({realSdk: sdk, root: join(root, 'overlay'), token,
    avd: 'dependency_api31', caseName: 'hardware-fallback'});
  // Unchanged real tools and images are reachable; only the emulator entry is generated.
  assert.equal((await lstat(join(overlay.sdk, 'platform-tools'))).isSymbolicLink(), true);
  assert.equal((await lstat(join(overlay.sdk, 'system-images'))).isSymbolicLink(), true);
  assert.equal((await lstat(join(overlay.sdk, 'emulator/source.properties'))).isSymbolicLink(), true);
  assert.equal((await lstat(join(overlay.sdk, 'emulator/emulator'))).isSymbolicLink(), false);
  const wrapper = join(overlay.sdk, 'emulator/emulator');
  const tokenEnv = {SYNCSCOPE_FAULT_TOKEN: token, ANDROID_HOME: overlay.sdk};

  for (const probe of [['-help-gpu'], ['-accel-check'], ['-version']]) {
    assert.equal(run(wrapper, probe, tokenEnv).status, 0);
  }
  let real = (await readFile(calls, 'utf8')).trim().split('\n');
  assert.deepEqual(real, ['-help-gpu', '-accel-check', '-version'].map(p => `real ${p} home=${sdk} token=none`));

  const host = ['-avd', 'dependency_api31', '-no-window', '-gpu', 'host', '-feature', '-Vulkan', '-accel', 'on'];
  const software = ['-avd', 'dependency_api31', '-gpu', 'swiftshader', '-accel', 'on'];
  const injected = run(wrapper, host, tokenEnv);
  assert.equal(injected.status, 70);
  assert.match(injected.stderr, /injected launch failure/);
  assert.equal(run(wrapper, software, tokenEnv).status, 0);
  // No token, a different token or a different AVD is never injected.
  assert.equal(run(wrapper, host, {ANDROID_HOME: overlay.sdk}).status, 0);
  assert.equal(run(wrapper, host, {...tokenEnv, SYNCSCOPE_FAULT_TOKEN: 'b'.repeat(32)}).status, 0);
  assert.equal(run(wrapper, ['-avd', 'dependency_api36', '-gpu', 'host'], tokenEnv).status, 0);
  real = (await readFile(calls, 'utf8')).trim().split('\n').slice(3);
  assert.equal(real.length, 4);
  assert.ok(real.every(line => line.endsWith(`home=${sdk} token=none`)));
  assert.deepEqual((await readFile(overlay.injections, 'utf8')).trim().split('\n'), ['host']);

  const all = await createOverlay({realSdk: sdk, root: join(root, 'overlay-all'), token,
    avd: 'dependency_api31', caseName: 'all-options-fail'});
  const allWrapper = join(all.sdk, 'emulator/emulator');
  assert.equal(run(allWrapper, host, {...tokenEnv, ANDROID_HOME: all.sdk}).status, 70);
  assert.equal(run(allWrapper, software, {...tokenEnv, ANDROID_HOME: all.sdk}).status, 70);
  assert.equal(run(allWrapper, ['-version'], {...tokenEnv, ANDROID_HOME: all.sdk}).status, 0);
  assert.deepEqual((await readFile(all.injections, 'utf8')).trim().split('\n'), ['host', 'swiftshader']);
  assert.deepEqual(await readdir(join(sdk, 'emulator')), ['emulator', 'source.properties']);
  await assert.rejects(createOverlay({realSdk: sdk, root: join(root, "bad'quote"), token,
    avd: 'dependency_api31', caseName: 'hardware-fallback'}), /unsafe-path/);
});

test('attempt evidence is allowlisted, sanitized and limited to attempted candidates', () => {
  const attempts = sanitizeAttempts([
    {candidateId: 'host-intel-1', state: 'boot-failed', reason: 'emulator-exited', renderNode: 'renderD128',
      selector: {DRI_PRIME: 'x'}, verification: {verified: false, raw: 'GL_RENDERER Mesa /home/user'}},
    {candidateId: 'software-swiftshader', state: 'selected', reason: null,
      verification: {verified: true, backend: 'swiftshader', vulkan: 'enabled', vendor: null, log: 'secret'}},
    {candidateId: 'software-software', state: 'discovered', reason: null},
    {candidateId: '/home/user/evil', state: 'weird', reason: 'raw stderr text'},
  ]);
  assert.deepEqual(attempts, [
    {candidateId: 'host-intel-1', state: 'boot-failed', reason: 'emulator-exited', backend: null, vulkan: null},
    {candidateId: 'software-swiftshader', state: 'selected', reason: null, backend: 'swiftshader', vulkan: 'enabled'},
    {candidateId: 'unknown', state: 'unknown', reason: 'unknown', backend: null, vulkan: null},
  ]);
});

// A fake validator that, like the real one, launches each planned candidate
// through ANDROID_HOME/emulator/emulator in order and selects the first one
// whose launch succeeds. It records its lifecycle in a private state directory.
function fakeValidator(world) {
  return async (action, api, env) => {
    world.calls.push({action, api, home: env.ANDROID_HOME, token: env.SYNCSCOPE_FAULT_TOKEN ?? null,
      claim: env.SYNCSCOPE_INVOCATION_TOKEN ?? null, profile: env.SYNCSCOPE_GRAPHICS_PROFILE});
    const state = join(world.state, `api${api}`), receipt = env.SYNCSCOPE_RESOURCE_RECEIPT;
    if (action === 'start') {
      if (world.startThrows) { throw new Error('boom'); }
      await mkdir(state);
      const attempts = [];
      for (const candidate of world.plan) {
        const gpu = candidate.startsWith('host-') ? 'host' : candidate.slice('software-'.length);
        const launched = run(join(env.ANDROID_HOME, 'emulator/emulator'),
          ['-avd', `dependency_api${api}`, '-gpu', gpu, '-accel', 'on'], env);
        if (launched.status === 0 && !world.verifyFails) {
          // The real verification record carries no graphics kind; the
          // runtime metadata does. Unattempted candidates stay "discovered".
          attempts.push({candidateId: candidate, state: 'verified', reason: null, renderNode: 'renderD128',
            graphics: gpu === 'host' ? 'hardware' : 'software',
            verification: {verified: true, reason: null, backend: gpu === 'host' ? 'host' : gpu, vulkan: 'enabled',
              ramAgreement: false, raw: '/home/user/.android'}});
          for (const rest of world.plan.slice(world.plan.indexOf(candidate) + 1)) {
            attempts.push({candidateId: rest, state: 'discovered', reason: null});
          }
          break;
        }
        attempts.push({candidateId: candidate, state: 'boot-failed', reason: 'emulator-exited',
          stderr: launched.stderr});
      }
      const selected = attempts.find(a => a.state === 'verified');
      const record = {schemaVersion: 1, api, requestedProfile: env.SYNCSCOPE_GRAPHICS_PROFILE,
        discovery: {kvm: {usable: true}, candidates: world.plan.map(c => ({candidateId: c, status: 'discovered'}))},
        attempts: selected ? attempts.map(a => a === selected ? {...a, state: 'selected'} : a) : attempts};
      await writeFile(join(state, 'acceleration.private.json'), JSON.stringify(record));
      await writeFile(join(state, 'metadata.private.json'), JSON.stringify({cpu: 'kvm',
        graphics: selected?.graphics ?? 'unknown', backend: 'a'.repeat(64),
        renderer: 'abc', log: 'raw emulator log'}));
      const retain = async () => {
        const dest = join(env.SYNCSCOPE_PERFORMANCE_DIR, 'raw', `validator-${api}`);
        await mkdir(dest, {recursive: true});
        for (const f of ['acceleration.private.json', 'metadata.private.json']) {
          await writeFile(join(dest, f), await readFile(join(state, f)));
        }
      };
      if (!selected) {
        await retain(); await rm(state, {recursive: true}); await writeFile(receipt, 'released\n'); return 1;
      }
      world.running.add(api);
      await writeFile(receipt, 'acquired\n'); return 0;
    }
    if (action === 'healthcheck') { return world.running.has(api) && !world.unhealthy ? 0 : 1; }
    if (action === 'stop') {
      world.stopped.push(api);
      if (world.leakOnStop) { return 0; }
      const dest = join(env.SYNCSCOPE_PERFORMANCE_DIR, 'raw', `validator-${api}`);
      await mkdir(dest, {recursive: true});
      for (const f of ['acceleration.private.json', 'metadata.private.json']) {
        await writeFile(join(dest, f), await readFile(join(state, f)));
      }
      world.running.delete(api);
      await rm(state, {recursive: true}); await writeFile(receipt, 'released\n'); return 0;
    }
    return 64;
  };
}
async function world(t, overrides = {}) {
  const fake = await fakeSdk(t);
  const state = join(fake.root, 'state');
  await mkdir(state);
  const w = {...fake, emulatorCalls: fake.calls, state, calls: [], stopped: [], running: new Set(), foreign: [{pid: 4242, api: 31}],
    plan: ['host-intel-1', 'host-nvidia-1', 'software-swiftshader', 'software-software'], ...overrides};
  const avdHome = join(fake.root, 'avd');
  for (const api of [31, 36]) {
    await mkdir(join(avdHome, `dependency_api${api}.avd`), {recursive: true});
    await writeFile(join(avdHome, `dependency_api${api}.ini`), `path=x${api}\n`);
    await writeFile(join(avdHome, `dependency_api${api}.avd/config.ini`), `hw.ramSize=2048\n`);
  }
  w.deps = {validator: fakeValidator(w), realSdk: fake.sdk, avdHome, stateDir: name => join(state, name),
    tempRoot: fake.root,
    processes: async () => [...w.foreign, ...[...w.running].map(api => ({pid: 9000 + api, api}))]};
  return w;
}
async function report(dir) { return JSON.parse(await readFile(join(dir, 'fault-check.json'), 'utf8')); }
async function tempEntries(root) {
  return (await readdir(root)).filter(name => name.startsWith('cloud-sync-checker-fault-'));
}

test('hardware-fallback requires every host launch to be injected and a real verified software boot', async t => {
  const w = await world(t);
  const reportDir = join(w.root, 'report');
  const status = await runFaultCheck({apis: [31, 36], caseName: 'hardware-fallback', reportDir}, w.deps);
  assert.equal(status, 0);
  const r = await report(reportDir);
  assert.equal(r.case, 'hardware-fallback');
  assert.equal(r.result, 'passed');
  assert.equal(r.rankingUse, false);
  assert.equal(r.timingSamples, 0);
  for (const [i, api] of [31, 36].entries()) {
    const a = r.apis[i];
    assert.equal(a.api, api);
    assert.equal(a.expected, 'software-fallback');
    assert.equal(a.validatorExit, 0);
    assert.equal(a.result, 'passed');
    assert.deepEqual(a.injected, ['host', 'host']);
    assert.deepEqual(a.attempts.map(x => [x.candidateId, x.state, x.reason]), [
      ['host-intel-1', 'boot-failed', 'emulator-exited'], ['host-nvidia-1', 'boot-failed', 'emulator-exited'],
      ['software-swiftshader', 'selected', null]]);
    assert.deepEqual(a.actual, {cpu: 'kvm', graphics: 'software', backend: 'swiftshader', vulkan: 'enabled'});
    assert.equal(a.healthy, true);
    assert.deepEqual(a.cleanup, {stateRemoved: true, receipt: 'released', survivors: 0, foreignPreserved: true,
      overlayRemoved: true});
    assert.deepEqual(a.unchanged, {sdk: true, avd: true});
  }
  // The child alone saw the overlay and the injection token; the claim token
  // is shared by every validator call of this run.
  assert.ok(w.calls.every(c => c.home !== w.sdk && c.token && c.profile === 'auto'));
  assert.equal(new Set(w.calls.map(c => c.claim)).size, 1);
  assert.equal(process.env.SYNCSCOPE_FAULT_TOKEN, undefined);
  assert.deepEqual(w.stopped, [31, 36]);
  assert.deepEqual(await tempEntries(w.root), []);
  // Injected samples never feed a ranking store or timing cohort.
  assert.equal(await exists(join(reportDir, 'acceleration-ranking.json')), false);
  assert.equal(await exists(join(dirname(reportDir), 'acceleration-ranking.json')), false);
  const text = await readFile(join(reportDir, 'fault-check.json'), 'utf8');
  for (const leaked of [w.sdk, w.root, 'raw emulator log', '/home/user', 'injected launch failure', 'renderD128']) {
    assert.equal(text.includes(leaked), false, leaked);
  }
  assert.equal((await stat(join(reportDir, 'fault-check.json'))).mode & 0o777, 0o600);
});

test('hardware-fallback without an exposed host candidate or software continuation is incomplete', async t => {
  const noHost = await world(t, {plan: ['software-swiftshader']});
  let dir = join(noHost.root, 'report');
  assert.notEqual(await runFaultCheck({apis: [31], caseName: 'hardware-fallback', reportDir: dir}, noHost.deps), 0);
  assert.equal((await report(dir)).result, 'incomplete');
  assert.equal((await report(dir)).apis[0].result, 'incomplete');
  assert.deepEqual(noHost.stopped, [31]);

  const noSoftware = await world(t, {plan: ['host-intel-1']});
  dir = join(noSoftware.root, 'report');
  assert.notEqual(await runFaultCheck({apis: [31], caseName: 'hardware-fallback', reportDir: dir}, noSoftware.deps), 0);
  const r = await report(dir);
  assert.equal(r.result, 'incomplete');
  assert.equal(r.apis[0].validatorExit, 1);
  assert.equal(r.apis[0].cleanup.stateRemoved, true);
});

test('all-options-fail inverts the expected nonzero validator exhaustion', async t => {
  const w = await world(t);
  const reportDir = join(w.root, 'report');
  assert.equal(await runFaultCheck({apis: [31, 36], caseName: 'all-options-fail', reportDir}, w.deps), 0);
  const r = await report(reportDir);
  assert.equal(r.result, 'passed');
  for (const a of r.apis) {
    assert.equal(a.expected, 'exhaustion');
    assert.equal(a.validatorExit, 1);
    assert.deepEqual(a.injected, ['host', 'host', 'swiftshader', 'software']);
    assert.ok(a.attempts.length === 4 && a.attempts.every(x => x.state === 'boot-failed'));
    assert.equal(a.actual, null);
    assert.equal(a.healthy, null);
    assert.equal(a.cleanup.survivors, 0);
    assert.equal(a.cleanup.receipt, 'released');
  }
  assert.deepEqual(w.stopped, []);
  assert.deepEqual(await tempEntries(w.root), []);
});

test('an unexpected validator success or failure fails the harness and releases only its own emulator', async t => {
  // all-options-fail where a launch still reaches the real emulator: the
  // harness must fail and stop exactly the emulator its claim acquired.
  const leaked = await world(t);
  const reportDir = join(leaked.root, 'report');
  leaked.deps.validator = (inner => async (action, api, env) =>
    inner(action, api, {...env, SYNCSCOPE_FAULT_TOKEN: action === 'start' ? 'f'.repeat(32) : env.SYNCSCOPE_FAULT_TOKEN}))(leaked.deps.validator);
  assert.notEqual(await runFaultCheck({apis: [31], caseName: 'all-options-fail', reportDir}, leaked.deps), 0);
  assert.equal((await report(reportDir)).result, 'failed');
  assert.deepEqual(leaked.stopped, [31]);
  assert.deepEqual(leaked.foreign, [{pid: 4242, api: 31}]);

  const unhealthy = await world(t, {unhealthy: true});
  const dir2 = join(unhealthy.root, 'report');
  assert.notEqual(await runFaultCheck({apis: [36], caseName: 'hardware-fallback', reportDir: dir2}, unhealthy.deps), 0);
  assert.equal((await report(dir2)).apis[0].healthy, false);
  assert.deepEqual(unhealthy.stopped, [36]);

  const surviving = await world(t, {leakOnStop: true});
  const dir3 = join(surviving.root, 'report');
  assert.notEqual(await runFaultCheck({apis: [31], caseName: 'hardware-fallback', reportDir: dir3}, surviving.deps), 0);
  assert.equal((await report(dir3)).apis[0].cleanup.survivors, 1);
});

test('a thrown error still cleans up and later APIs are not attempted', async t => {
  const w = await world(t, {startThrows: true});
  const reportDir = join(w.root, 'report');
  assert.notEqual(await runFaultCheck({apis: [31, 36], caseName: 'hardware-fallback', reportDir}, w.deps), 0);
  const r = await report(reportDir);
  assert.equal(r.result, 'failed');
  assert.deepEqual(r.apis.map(a => a.api), [31]);
  assert.deepEqual(await tempEntries(w.root), []);
});

test('changed SDK or AVD definitions fail the run', async t => {
  const w = await world(t);
  const reportDir = join(w.root, 'report');
  const inner = w.deps.validator;
  w.deps.validator = async (action, api, env) => {
    const status = await inner(action, api, env);
    if (action === 'stop') { await writeFile(join(w.deps.avdHome, `dependency_api${api}.avd/config.ini`), 'hw.ramSize=1\n'); }
    return status;
  };
  assert.notEqual(await runFaultCheck({apis: [31], caseName: 'hardware-fallback', reportDir}, w.deps), 0);
  assert.deepEqual((await report(reportDir)).apis[0].unchanged, {sdk: true, avd: false});
});

test('refuses existing evidence and a held full-invocation claim before any launch', async t => {
  const w = await world(t);
  const reportDir = join(w.root, 'report');
  await mkdir(reportDir);
  await writeFile(join(reportDir, 'fault-check.json'), '{}');
  await assert.rejects(runFaultCheck({apis: [31], caseName: 'hardware-fallback', reportDir}, w.deps), /evidence-exists/);
  assert.deepEqual(w.calls, []);

  const lock = join(w.state, 'invocation.lock');
  await writeFile(lock, '');
  const holder = spawn('flock', ['-n', lock, 'sleep', '30'], {stdio: 'ignore'});
  t.after(() => holder.kill('SIGKILL'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const cli = run(process.execPath, [script, '--api', '31', '--case', 'hardware-fallback',
    '--report-dir', join(w.root, 'cli-report')], {SYNCSCOPE_VALIDATION_STATE_DIR: w.state, ANDROID_HOME: w.sdk});
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Another validation invocation is active/);
  assert.equal(await exists(join(w.root, 'cli-report', 'fault-check.json')), false);
  assert.deepEqual(w.calls, []);
  assert.equal(await readFile(w.emulatorCalls, 'utf8'), '');
  const usage = run(process.execPath, [script, '--api', '31'], {});
  assert.equal(usage.status, 64);
});
