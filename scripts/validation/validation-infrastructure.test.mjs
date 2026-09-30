import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';

const root = new URL('../../', import.meta.url);

async function text(path) {
  return readFile(new URL(path, root), 'utf8');
}

test('pins loopback-only read-only protocol services', async () => {
  const compose = await text('validation/services/compose.yaml');
  const entrypoint = await text(
    'validation/services/runtime-entrypoint.sh',
  );

  for (const digest of [
    'cloud-sync-checker/sftp-validation@sha256:04907991d1417618fbe8dadc349e5db305cc19a7af66cb4c7198c7be769e31ac',
    'cloud-sync-checker/ftp-validation@sha256:2da5459eb4585bfae30c1bd38a139b21fe3fa09c065368a0654456fac91ca4d0',
    'cloud-sync-checker/webdav-validation@sha256:cb1f1889e8ad8bdcce860c6c368c5ff7a627805bbc02e2c25fdb192d28838ee5',
  ]) {
    assert.ok(compose.includes(digest), `${digest} must be pinned`);
  }

  for (const publication of [
    '127.0.0.1:32122:22',
    '127.0.0.1:32180:80',
    '127.0.0.1:32120:21',
    '127.0.0.1:32200-32209:32200-32209',
  ]) {
    assert.ok(compose.includes(publication), `${publication} must be bound`);
  }

  assert.match(compose, /fixture_credentials/);
  assert.match(entrypoint, /\/run\/secrets\/fixture_credentials/);
  assert.match(compose, /fixtures:ro/);
  assert.doesNotMatch(compose, /validation-only|password\s*:/i);
});

test('generates deterministic representative fixture metadata', async t => {
  const state = await mkdtemp(
    join(tmpdir(), 'cloud-sync-checker-fixture-test-'),
  );
  const secondState = await mkdtemp(
    join(tmpdir(), 'cloud-sync-checker-fixture-test-'),
  );
  t.after(() => rm(state, {recursive: true, force: true}));
  t.after(() => rm(secondState, {recursive: true, force: true}));

  const seed = spawnSync(
    'sh',
    [
      new URL('fixture-seed.sh', import.meta.url).pathname,
      '--root',
      join(state, 'fixtures'),
    ],
    {encoding: 'utf8'},
  );
  assert.equal(seed.status, 0, seed.stderr);

  const expected = [
    'flat/exact.txt',
    'nested/alpha/nested.txt',
    'duplicates/a/reusable.jpg',
    'duplicates/b/reusable.jpg',
    'unicode/Grüße_日本_é.txt',
    'unicode/é-decomposed.txt',
    'mismatch/size-mismatch.txt',
    'timestamps/bucket-start.bin',
    'timestamps/bucket-end.bin',
    'non-regular/escape-link',
  ];
  for (const relative of expected) {
    await lstat(join(state, 'fixtures', relative));
  }

  const first = spawnSync(
    'sh',
    [
      new URL('fixture-manifest.sh', import.meta.url).pathname,
      '--protocol',
      'sftp',
      '--phase',
      'before',
      '--state',
      state,
    ],
    {encoding: 'utf8'},
  );
  assert.equal(first.status, 0, first.stderr);
  const secondSeed = spawnSync(
    'sh',
    [
      new URL('fixture-seed.sh', import.meta.url).pathname,
      '--root',
      join(secondState, 'fixtures'),
    ],
    {encoding: 'utf8'},
  );
  assert.equal(secondSeed.status, 0, secondSeed.stderr);
  const independent = spawnSync(
    'sh',
    [
      new URL('fixture-manifest.sh', import.meta.url).pathname,
      '--protocol',
      'sftp',
      '--phase',
      'before',
      '--state',
      secondState,
    ],
    {encoding: 'utf8'},
  );
  assert.equal(independent.status, 0, independent.stderr);
  assert.equal(
    await readFile(join(state, 'manifests/sftp.before.sha256'), 'utf8'),
    await readFile(
      join(secondState, 'manifests/sftp.before.sha256'),
      'utf8',
    ),
  );
  const second = spawnSync(
    'sh',
    [
      new URL('fixture-manifest.sh', import.meta.url).pathname,
      '--protocol',
      'sftp',
      '--phase',
      'after',
      '--state',
      state,
    ],
    {encoding: 'utf8'},
  );
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stdout, /zero unexpected remote changes/);
});

test('exposes bounded owned service and serial validator entry points', async () => {
  const packageJson = JSON.parse(await text('package.json'));
  const helpers = await Promise.all(
    [
      'scripts/validation/protocol-service.sh',
      'scripts/validation/metro-service.sh',
      'scripts/validation/android-validator.sh',
      'scripts/validation/android-flow.sh',
    ].map(text),
  );
  const source = helpers.join('\n');

  for (const script of [
    'validation:fixtures',
    'validation:manifest',
    'validation:services:health',
    'test:android:connected',
    'e2e:android',
  ]) {
    assert.equal(typeof packageJson.scripts[script], 'string', script);
  }

  assert.match(source, /cloud-sync-checker-validator\.lock/);
  assert.match(source, /flock/);
  assert.match(source, /timeout/);
  assert.match(source, /MemAvailable/);
  assert.match(source, /10\.0\.2\.0\/24/);
  assert.doesNotMatch(
    source,
    /\bpkill\b|\bkillall\b|docker\s+(?:system|container|network)\s+prune|adb\s+kill-server/,
  );
});

async function launchWithStubbedDocker(t, dockerVersion) {
  const bin = await mkdtemp(
    join(tmpdir(), 'cloud-sync-checker-launcher-test-'),
  );
  t.after(() => rm(bin, {recursive: true, force: true}));

  const docker = join(bin, 'docker');
  await writeFile(
    docker,
    `#!/bin/sh
case "$*" in
  "version --format {{.Client.Version}} {{.Server.Version}}")
    printf '%s\\n' '${dockerVersion}'
    ;;
  "compose version --short")
    printf '%s\\n' '5.5.1'
    ;;
  *)
    exit 70
    ;;
esac
`,
  );
  await chmod(docker, 0o755);

  const ss = join(bin, 'ss');
  await writeFile(
    ss,
    "#!/bin/sh\nprintf '%s\\n' 'LISTEN 0 1 127.0.0.1:32122'\n",
  );
  await chmod(ss, 0o755);

  return spawnSync(
    'sh',
    [
      new URL('protocol-service.sh', import.meta.url).pathname,
      'start',
      'sftp',
      '--compose',
      new URL('../../validation/services/compose.yaml', import.meta.url)
        .pathname,
      '--project',
      'syncscope-sftp',
      '--host',
      '127.0.0.1',
      '--port',
      '32122',
    ],
    {
      encoding: 'utf8',
      env: {...process.env, PATH: `${bin}:${process.env.PATH}`},
    },
  );
}

test('protocol launcher accepts any Docker 29 release before preflight', async t => {
  const launch = await launchWithStubbedDocker(t, '29.8.1 29.8.1');

  assert.equal(launch.status, 1);
  assert.match(launch.stderr, /Approved service port is occupied/);
  assert.doesNotMatch(
    launch.stderr,
    /Docker 29\.x is required|Compose 5\.5\.1 is required|unexpected/,
  );
});

test('protocol launcher rejects a Docker major other than 29', async t => {
  for (const version of ['30.0.0 30.0.0', '29.8.1 30.0.0', '28.5.2 29.8.1']) {
    const launch = await launchWithStubbedDocker(t, version);

    assert.equal(launch.status, 1, version);
    assert.match(launch.stderr, /Docker 29\.x is required/, version);
    assert.doesNotMatch(launch.stderr, /Approved service port/, version);
  }
});

async function fakeSdk(t) {
  const home = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-sdk-test-'));
  t.after(() => rm(home, {recursive: true, force: true}));

  const sdk = join(home, 'Android', 'Sdk');
  for (const component of ['platform-tools/adb', 'emulator/emulator']) {
    const binary = join(sdk, component);
    await mkdir(dirname(binary), {recursive: true});
    await writeFile(binary, '#!/bin/sh\nexit 0\n');
    await chmod(binary, 0o755);
  }

  return {home, sdk};
}

function resolveSdk(env) {
  const helper = new URL('android-sdk.sh', import.meta.url).pathname;

  return spawnSync(
    'sh',
    ['-c', `. "${helper}"; android_sdk_resolve; printf '%s\\n' "$ANDROID_HOME"`],
    {encoding: 'utf8', env},
  );
}

test('resolves the Android SDK without an exported ANDROID_HOME', async t => {
  const {home, sdk} = await fakeSdk(t);
  const env = {...process.env, HOME: home};
  delete env.ANDROID_HOME;
  delete env.ANDROID_SDK_ROOT;

  const resolved = resolveSdk(env);

  assert.equal(resolved.status, 0, resolved.stderr);
  assert.equal(resolved.stdout.trim(), sdk);
});

test('prefers an explicit ANDROID_HOME over ANDROID_SDK_ROOT and the default', async t => {
  const {home, sdk} = await fakeSdk(t);

  assert.equal(
    resolveSdk({
      ...process.env,
      HOME: '/nonexistent',
      ANDROID_HOME: sdk,
      ANDROID_SDK_ROOT: '/nonexistent/sdk',
    }).stdout.trim(),
    sdk,
  );
  assert.equal(
    resolveSdk({
      ...process.env,
      HOME: home,
      ANDROID_HOME: '',
      ANDROID_SDK_ROOT: sdk,
    }).stdout.trim(),
    sdk,
  );
});

test('names the missing Android SDK instead of aborting on an unbound variable', async () => {
  const env = {...process.env, HOME: '/nonexistent', ANDROID_HOME: '/nonexistent/sdk'};
  delete env.ANDROID_SDK_ROOT;

  const resolved = resolveSdk(env);

  assert.equal(resolved.status, 1);
  assert.match(resolved.stderr, /Android SDK not usable at '\/nonexistent\/sdk'/);
  assert.match(resolved.stderr, /Set ANDROID_HOME/);
  assert.doesNotMatch(resolved.stderr, /unbound variable/);
});

test('resolves the SDK before any script dereferences ANDROID_HOME', async () => {
  for (const script of [
    'scripts/validation/android-validator.sh',
    'scripts/validation/android-flow.sh',
  ]) {
    const source = await text(script);
    const resolved = source.indexOf('android_sdk_resolve');
    const used = source.indexOf('$ANDROID_HOME/');

    assert.ok(resolved !== -1, `${script} must resolve the SDK`);
    assert.ok(used === -1 || resolved < used, `${script} dereferences ANDROID_HOME too early`);
  }
});

async function fakeAdbSdk(t, publicVolumes) {
  const {home, sdk} = await fakeSdk(t);
  const log = join(home, 'adb.log');
  await writeFile(
    join(sdk, 'platform-tools/adb'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *"sm list-volumes public"*)
    printf '%b' '${publicVolumes}'
    ;;
esac
exit 0
`,
  );
  return {home, sdk, log};
}

function runDeviceFixtures(env) {
  return spawnSync(
    'sh',
    [new URL('device-fixtures.sh', import.meta.url).pathname],
    {encoding: 'utf8', env},
  );
}

test('device fixture script follows the validation script contract', async () => {
  const path = new URL('device-fixtures.sh', import.meta.url);
  const mode = (await lstat(path)).mode;
  const source = await readFile(path, 'utf8');

  assert.ok(mode & 0o111, 'device-fixtures.sh must be executable');
  assert.match(source, /^set -eu$/m);
  assert.match(source, /android_sdk_resolve/);
  assert.match(source, /ANDROID_SERIAL/);
  assert.match(source, /sm list-volumes public/);
  assert.match(source, /mkdir -p/);
});

test('device fixture script seeds primary and removable storage idempotently', async t => {
  const {sdk, log} = await fakeAdbSdk(
    t,
    'public:179,1 mounted 1A2B-3C4D\\n',
  );
  const env = {...process.env, ANDROID_HOME: sdk, ANDROID_SERIAL: 'emulator-5554'};

  for (let run = 0; run < 2; run += 1) {
    const seeded = runDeviceFixtures(env);
    assert.equal(seeded.status, 0, seeded.stderr);
  }

  const calls = (await readFile(log, 'utf8')).trim().split('\n');
  assert.ok(
    calls.every(call => call.startsWith('-s emulator-5554 shell ')),
    'every adb call must target ANDROID_SERIAL',
  );
  const commands = calls.join('\n');
  for (const dir of [
    '/sdcard/SyncScopeE2E/Camera',
    '/sdcard/SyncScopeE2E/Camera/Nested',
    '/storage/1A2B-3C4D/SyncScopeE2E/Camera',
  ]) {
    assert.ok(commands.includes(`mkdir -p ${dir}`), `${dir} must be created`);
    assert.match(
      commands,
      new RegExp(`> ${dir.replace(/[/.-]/g, '\\$&')}/[^/\\s]+\\.txt`),
      `${dir} must get a fixture file that is overwritten, not appended`,
    );
  }
  assert.doesNotMatch(commands, />>/);
});

test('device fixture script fails loudly without a public removable volume', async t => {
  const {sdk, log} = await fakeAdbSdk(t, '');
  const env = {...process.env, ANDROID_HOME: sdk, ANDROID_SERIAL: 'emulator-5554'};

  const seeded = runDeviceFixtures(env);

  assert.notEqual(seeded.status, 0);
  assert.match(seeded.stderr, /no public removable volume/i);
  assert.doesNotMatch(await readFile(log, 'utf8'), /\/storage\//);
});

test('device fixture script requires ANDROID_SERIAL', async t => {
  const {sdk} = await fakeAdbSdk(t, 'public:179,1 mounted 1A2B-3C4D\\n');
  const env = {...process.env, ANDROID_HOME: sdk};
  delete env.ANDROID_SERIAL;

  const seeded = runDeviceFixtures(env);

  assert.notEqual(seeded.status, 0);
  assert.match(seeded.stderr, /ANDROID_SERIAL/);
});

test('e2e mode seeds device fixtures after the APK install and before Maestro', async () => {
  const source = await text('scripts/validation/android-flow.sh');
  const install = source.indexOf('app-debug.apk');
  const fixtures = source.indexOf('scripts/validation/device-fixtures.sh');
  const maestro = source.indexOf('test "$repo/validation/maestro"');

  assert.ok(install !== -1, 'e2e mode must install the debug APK');
  assert.ok(fixtures !== -1, 'e2e mode must run device-fixtures.sh');
  assert.ok(maestro !== -1, 'e2e mode must run maestro test');
  assert.ok(install < fixtures, 'fixtures must be seeded after the APK install');
  assert.ok(fixtures < maestro, 'fixtures must be seeded before maestro test');
  assert.equal(
    source.indexOf('scripts/validation/device-fixtures.sh', fixtures + 1),
    -1,
    'fixtures are seeded in one place, inside the per-API loop',
  );
  assert.ok(
    source.lastIndexOf('for api in $apis', fixtures) !== -1,
    'fixtures must be seeded for each API level',
  );
});
