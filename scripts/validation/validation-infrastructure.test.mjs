import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
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

const SCAN_FIXTURES = new Map([
  ['scan/clean/exact.txt', 'exact metadata fixture\n'],
  ['scan/clean/a/reusable.jpg', 'reusable duplicate payload\n'],
  ['scan/clean/b/reusable.jpg', 'reusable duplicate payload\n'],
  ['scan/clean/é-decomposed.txt', 'decomposed unicode metadata\n'],
  ['scan/clean/size-mismatch.txt', 'intentionally different size\n'],
  ['scan/partial/readable/exact.txt', 'exact metadata fixture\n'],
  ['scan/partial/restricted/only-here.txt', 'only in restricted\n'],
]);

async function directoryModes(directory, prefix = '') {
  const modes = new Map();
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    if (!entry.isDirectory()) {
      continue;
    }
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);
    modes.set(relative, (await lstat(absolute)).mode & 0o777);
    for (const [child, mode] of await directoryModes(absolute, relative)) {
      modes.set(child, mode);
    }
  }
  return modes;
}

test('seeds the scan fixtures with NFD names, fixed mtimes and one restricted directory', async t => {
  const state = await mkdtemp(
    join(tmpdir(), 'cloud-sync-checker-fixture-test-'),
  );
  t.after(async () => {
    for (const restricted of [
      'scan/partial/restricted',
      'gallery-partial/restricted',
    ]) {
      await chmod(join(state, 'fixtures', restricted), 0o755).catch(() => {});
    }
    await rm(state, {recursive: true, force: true});
  });
  const fixtures = join(state, 'fixtures');

  const seed = spawnSync(
    'sh',
    [new URL('fixture-seed.sh', import.meta.url).pathname, '--root', fixtures],
    {encoding: 'utf8'},
  );
  assert.equal(seed.status, 0, seed.stderr);

  for (const [relative, contents] of SCAN_FIXTURES) {
    const absolute = join(fixtures, relative);
    const metadata = await lstat(absolute, {bigint: true});
    assert.ok(metadata.isFile(), `${relative} must be a regular file`);
    assert.equal(await readFile(absolute, 'utf8'), contents, relative);
    assert.equal(
      metadata.mtimeNs,
      1704067200000000000n,
      `${relative} must have the fixed mtime`,
    );
  }

  const clean = await readdir(join(fixtures, 'scan/clean'), {
    encoding: 'buffer',
  });
  const decomposed = clean.find(name =>
    name.toString('utf8').endsWith('-decomposed.txt'),
  );
  assert.ok(decomposed, 'the decomposed fixture must exist');
  assert.deepEqual(
    [...decomposed.subarray(0, 3)],
    [0x65, 0xcc, 0x81],
    'the decomposed name must be stored in NFD',
  );

  const modes = await directoryModes(fixtures);
  assert.equal(
    modes.get('scan/partial/restricted'),
    0o700,
    'scan/partial/restricted must be 0700',
  );
  for (const [relative, mode] of modes) {
    // gallery-partial/restricted is covered by the gallery fixture test.
    if (
      relative !== 'scan/partial/restricted' &&
      relative !== 'gallery-partial/restricted'
    ) {
      assert.equal(mode, 0o755, `${relative} must be 0755`);
    }
  }
  assert.equal((await lstat(fixtures)).mode & 0o777, 0o755);

  const manifest = spawnSync(
    process.execPath,
    [new URL('fixture-manifest.mjs', import.meta.url).pathname, fixtures],
    {encoding: 'utf8'},
  );
  assert.equal(manifest.status, 0, manifest.stderr);
  const listed = new Set(
    manifest.stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line).path),
  );
  for (const relative of [
    'flat/exact.txt',
    'non-regular/escape-link',
    'scan',
    'scan/clean',
    'scan/partial',
    'scan/partial/restricted',
    ...SCAN_FIXTURES.keys(),
  ]) {
    assert.ok(listed.has(relative), `the manifest must list ${relative}`);
  }
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GALLERY_IMAGES = ['sunset.png', 'beach.png', 'album/forest.png'];

function assertPng(bytes, label) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    PNG_SIGNATURE,
    `${label} must be a PNG`,
  );
}

async function seedRemoteFixtures(t) {
  const state = await mkdtemp(
    join(tmpdir(), 'cloud-sync-checker-fixture-test-'),
  );
  const fixtures = join(state, 'fixtures');
  t.after(async () => {
    for (const restricted of [
      'scan/partial/restricted',
      'gallery-partial/restricted',
    ]) {
      await chmod(join(fixtures, restricted), 0o755).catch(() => {});
    }
    await rm(state, {recursive: true, force: true});
  });
  const seed = spawnSync(
    'sh',
    [new URL('fixture-seed.sh', import.meta.url).pathname, '--root', fixtures],
    {encoding: 'utf8'},
  );
  assert.equal(seed.status, 0, seed.stderr);
  return fixtures;
}

test('seeds the gallery fixtures as distinct PNGs with fixed mtimes and one restricted directory', async t => {
  const fixtures = await seedRemoteFixtures(t);

  const gallery = new Map();
  for (const relative of GALLERY_IMAGES) {
    const bytes = await readFile(join(fixtures, 'gallery', relative));
    assertPng(bytes, `gallery/${relative}`);
    gallery.set(relative, bytes);
  }
  const distinct = new Set([...gallery.values()].map(b => b.toString('hex')));
  assert.equal(distinct.size, 3, 'the gallery PNGs must differ pairwise');

  for (const [relative, bytes] of gallery) {
    assert.ok(
      (await readFile(join(fixtures, 'gallery-partial', relative))).equals(
        bytes,
      ),
      `gallery-partial/${relative} must be byte-identical to gallery/`,
    );
  }
  const hidden = await readFile(
    join(fixtures, 'gallery-partial/restricted/hidden.png'),
  );
  assertPng(hidden, 'gallery-partial/restricted/hidden.png');

  for (const relative of [
    ...GALLERY_IMAGES.map(name => `gallery/${name}`),
    ...GALLERY_IMAGES.map(name => `gallery-partial/${name}`),
    'gallery-partial/restricted/hidden.png',
  ]) {
    const metadata = await lstat(join(fixtures, relative), {bigint: true});
    assert.ok(metadata.isFile(), `${relative} must be a regular file`);
    assert.equal(
      metadata.mtimeNs,
      1704067200000000000n,
      `${relative} must have the fixed mtime`,
    );
  }

  const modes = await directoryModes(fixtures);
  const restricted = new Set([
    'scan/partial/restricted',
    'gallery-partial/restricted',
  ]);
  for (const relative of [
    'gallery',
    'gallery/album',
    'gallery-partial',
    'gallery-partial/album',
    'gallery-partial/restricted',
  ]) {
    assert.ok(modes.has(relative), `${relative} must be a directory`);
  }
  for (const [relative, mode] of modes) {
    assert.equal(
      mode,
      restricted.has(relative) ? 0o700 : 0o755,
      `${relative} has the wrong mode`,
    );
  }

  const manifest = spawnSync(
    process.execPath,
    [new URL('fixture-manifest.mjs', import.meta.url).pathname, fixtures],
    {encoding: 'utf8'},
  );
  assert.equal(manifest.status, 0, manifest.stderr);
  const listed = new Set(
    manifest.stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line).path),
  );
  for (const relative of [
    'flat/exact.txt',
    'scan/partial/restricted',
    'gallery',
    'gallery/album',
    'gallery-partial/restricted',
    'gallery-partial/restricted/hidden.png',
    ...GALLERY_IMAGES.map(name => `gallery/${name}`),
    ...GALLERY_IMAGES.map(name => `gallery-partial/${name}`),
  ]) {
    assert.ok(listed.has(relative), `the manifest must list ${relative}`);
  }
});

function decodedFixtureImages() {
  const images = spawnSync(
    'sh',
    [
      '-c',
      '. "$1"; for name in SUNSET BEACH FOREST HARBOR TWIN; do eval "printf \'%s %s\\n\' $name \\"\\$PNG_$name\\""; done',
      'sh',
      new URL('fixture-images.sh', import.meta.url).pathname,
    ],
    {encoding: 'utf8'},
  );
  assert.equal(images.status, 0, images.stderr);
  return new Map(
    images.stdout
      .trim()
      .split('\n')
      .map(line => {
        const [name, value] = line.split(' ');
        return [name, Buffer.from(value, 'base64')];
      }),
  );
}

test('embedded fixture PNGs are distinct and the twin differs in size', async () => {
  const images = decodedFixtureImages();
  assert.equal(images.size, 5);
  for (const [name, bytes] of images) {
    assertPng(bytes, `PNG_${name}`);
  }
  assert.equal(
    new Set([...images.values()].map(b => b.toString('hex'))).size,
    5,
    'the embedded PNGs must differ pairwise',
  );
  assert.notEqual(
    images.get('TWIN').length,
    images.get('SUNSET').length,
    'PNG_TWIN must differ in size from PNG_SUNSET, or the twin comes out SYNCED',
  );
  for (const script of ['fixture-seed.sh', 'device-fixtures.sh']) {
    const source = await readFile(new URL(script, import.meta.url), 'utf8');
    assert.doesNotMatch(
      source,
      /iVBORw0KGgo/,
      `${script} must source fixture-images.sh instead of copying PNGs`,
    );
  }
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

test('validator stops llkd after boot and gives the shell back to the normal user', async () => {
  const source = await text('scripts/validation/android-validator.sh');
  const start = source.slice(source.indexOf('  start)'), source.indexOf('  healthcheck)'));

  // llkd kills adbd once Maestro's driver shell has been a zombie for 600 s,
  // so any maestro run over ten minutes lost the device mid-flow.
  assert.match(source, /setprop ctl\.stop llkd-0; setprop ctl\.stop llkd-1/);
  assert.match(source, /root >\/dev\/null[\s\S]*await_shell_uid 0[\s\S]*unroot >\/dev\/null[\s\S]*await_shell_uid 2000/);
  assert.match(source, /getprop init\.svc\.llkd-1/);
  assert.ok(start.includes('stop_llkd ||'), 'start must stop llkd once the emulator is ready');
  assert.ok(
    start.indexOf('stop_llkd ||') > start.indexOf('until serial_ready'),
    'llkd is stopped only after the emulator route is ready',
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
  const pushed = join(home, 'pushed');
  await writeFile(
    join(sdk, 'platform-tools/adb'),
    `#!/bin/sh
printf '%s\\n' "$*" >> '${log}'
case "$*" in
  *"sm list-volumes public"*)
    printf '%b' '${publicVolumes}'
    ;;
esac
if [ "$3" = push ]; then
  mkdir -p '${pushed}'
  cp "$4" "${pushed}/$(printf '%s' "$5" | tr / _)"
fi
exit 0
`,
  );
  return {home, sdk, log, pushed};
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
    calls.every(call => /^-s emulator-5554 (shell|push) /.test(call)),
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

const DEVICE_SCAN = '/sdcard/SyncScopeE2E/Scan';
const DEVICE_SCAN_FILES = new Map([
  ['exact.txt', 'exact metadata fixture'],
  ['a/reusable.jpg', 'reusable duplicate payload'],
  ['b/reusable.jpg', 'reusable duplicate payload'],
  ['é-decomposed.txt', 'decomposed unicode metadata'],
  ['size-mismatch.txt', 'local size differs'],
  ['local-only.txt', 'only on the device'],
  ['only-here.txt', 'only in restricted'],
]);

async function seededDeviceCommands(t, extraEnv = {}) {
  const {sdk, log, pushed} = await fakeAdbSdk(
    t,
    'public:179,1 mounted 1A2B-3C4D\\n',
  );
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SERIAL: 'emulator-5554',
    ...extraEnv,
  };
  if (!('BULK_FILES' in extraEnv)) {
    delete env.BULK_FILES;
  }
  if (!('GALLERY_BULK_FILES' in extraEnv)) {
    delete env.GALLERY_BULK_FILES;
  }
  const seeded = runDeviceFixtures(env);
  const calls = (await readFile(log, 'utf8').catch(() => ''))
    .trim()
    .split('\n');
  return {seeded, calls, pushed};
}

test('device fixture script seeds the scan source with NFC names and fixed mtimes', async t => {
  const {seeded, calls} = await seededDeviceCommands(t);
  assert.equal(seeded.status, 0, seeded.stderr);
  const commands = calls.join('\n');

  for (const dir of [DEVICE_SCAN, `${DEVICE_SCAN}/a`, `${DEVICE_SCAN}/b`]) {
    assert.ok(commands.includes(`mkdir -p ${dir}`), `${dir} must be created`);
  }
  for (const [relative, contents] of DEVICE_SCAN_FILES) {
    const path = `${DEVICE_SCAN}/${relative}`;
    assert.ok(
      commands.includes(`printf '${contents}\\n' > ${path}`),
      `${path} must be overwritten with its fixture contents`,
    );
    assert.ok(
      commands.includes(`touch -d @1704067200 ${path}`),
      `${path} must get the fixed mtime`,
    );
  }
  assert.ok(
    Buffer.from(commands).includes(Buffer.from([0xc3, 0xa9, 0x2d])),
    'the device copy of the decomposed fixture must use the NFC name',
  );
  assert.ok(
    !commands.includes('é'),
    'the device fixtures must not contain an NFD name',
  );
  assert.doesNotMatch(commands, />>/);
});

test('device fixture script generates the bulk source in one adb shell loop', async t => {
  const {seeded, calls} = await seededDeviceCommands(t);
  assert.equal(seeded.status, 0, seeded.stderr);

  const bulk = calls.filter(call => call.includes('SyncScopeE2E/Bulk'));
  assert.equal(bulk.length, 1, 'the bulk tree is generated in one adb call');
  assert.match(bulk[0], /while /);
  assert.match(bulk[0], /\b20000\b/, 'BULK_FILES defaults to 20000');
  assert.match(bulk[0], /% 200\b/, 'files are spread over 200 directories');
  assert.match(bulk[0], /\/sdcard\/SyncScopeE2E\/Bulk\/d/);
  assert.match(bulk[0], /\/f/);
  assert.match(bulk[0], /\.txt/);

  const custom = await seededDeviceCommands(t, {BULK_FILES: '37'});
  assert.equal(custom.seeded.status, 0, custom.seeded.stderr);
  const customBulk = custom.calls.filter(call =>
    call.includes('SyncScopeE2E/Bulk'),
  );
  assert.equal(customBulk.length, 1);
  assert.match(customBulk[0], /\b37\b/);
  assert.doesNotMatch(customBulk[0], /\b20000\b/);

  for (const invalid of ['abc', '0', '-5', '100000']) {
    const rejected = await seededDeviceCommands(t, {BULK_FILES: invalid});
    assert.notEqual(rejected.seeded.status, 0, invalid);
    assert.match(rejected.seeded.stderr, /BULK_FILES/, invalid);
  }
});

const DEVICE_GALLERY = '/sdcard/SyncScopeE2E/Gallery';
const DEVICE_GALLERY_TWIN = '/sdcard/SyncScopeE2E/GalleryTwin';
const DEVICE_GALLERY_BULK = '/sdcard/SyncScopeE2E/GalleryBulk';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

test('device fixture script seeds the gallery sources from the shared PNGs', async t => {
  const remote = await seedRemoteFixtures(t);
  const images = decodedFixtureImages();
  const source = await readFile(
    new URL('device-fixtures.sh', import.meta.url),
    'utf8',
  );
  assert.match(source, /fixture-images\.sh/, 'must source fixture-images.sh');

  const {seeded, calls, pushed} = await seededDeviceCommands(t);
  assert.equal(seeded.status, 0, seeded.stderr);
  const commands = calls.join('\n');

  for (const dir of [
    DEVICE_GALLERY,
    `${DEVICE_GALLERY}/album`,
    `${DEVICE_GALLERY}/drafts`,
    DEVICE_GALLERY_TWIN,
  ]) {
    assert.ok(commands.includes(`mkdir -p ${dir}`), `${dir} must be created`);
  }

  const pushes = calls.filter(call => / push /.test(call));
  const pushedBytes = async path =>
    readFile(join(pushed, path.replace(/\//g, '_')));
  // Synced: byte-identical to the remote gallery/ copies.
  for (const relative of GALLERY_IMAGES) {
    const path = `${DEVICE_GALLERY}/${relative}`;
    assert.ok(
      (await pushedBytes(path)).equals(
        await readFile(join(remote, 'gallery', relative)),
      ),
      `${path} must match the remote gallery/${relative} byte for byte`,
    );
  }
  assert.ok(
    (await pushedBytes(`${DEVICE_GALLERY}/harbor.png`)).equals(
      images.get('HARBOR'),
    ),
    'harbor.png must be PNG_HARBOR',
  );
  const twin = await pushedBytes(`${DEVICE_GALLERY_TWIN}/sunset.png`);
  assert.ok(twin.equals(images.get('TWIN')), 'the twin must be PNG_TWIN');
  assert.notEqual(
    twin.length,
    (await readFile(join(remote, 'gallery/sunset.png'))).length,
    'the twin must differ in size from the remote sunset.png',
  );
  assert.equal(pushes.length, 5, 'each image is pushed once');

  assert.ok(
    commands.includes(
      `cp ${DEVICE_GALLERY}/harbor.png ${DEVICE_GALLERY}/drafts/draft.png`,
    ),
    'drafts/draft.png must be a copy of harbor.png',
  );
  assert.ok(
    commands.includes(
      `printf 'gallery notes\\n' > ${DEVICE_GALLERY}/album/notes.txt`,
    ),
    'album/notes.txt must be overwritten with its fixture contents',
  );

  for (const path of [
    ...GALLERY_IMAGES.map(name => `${DEVICE_GALLERY}/${name}`),
    `${DEVICE_GALLERY}/harbor.png`,
    `${DEVICE_GALLERY}/album/notes.txt`,
    `${DEVICE_GALLERY}/drafts/draft.png`,
    `${DEVICE_GALLERY_TWIN}/sunset.png`,
  ]) {
    assert.match(
      commands,
      new RegExp(`touch -d @1704067200 [^\\n]*${escapeRegExp(path)}(\\s|$)`),
      `${path} must get the fixed mtime`,
    );
  }
  assert.doesNotMatch(commands, />>/);
});

test('device fixture script generates the gallery bulk source in one adb shell loop', async t => {
  const {seeded, calls} = await seededDeviceCommands(t);
  assert.equal(seeded.status, 0, seeded.stderr);

  const bulk = calls.filter(
    call => call.includes(DEVICE_GALLERY_BULK) && / shell /.test(call),
  );
  assert.equal(bulk.length, 1, 'GalleryBulk is generated in one adb call');
  assert.match(bulk[0], new RegExp(`rm -rf ${DEVICE_GALLERY_BULK}\\b`));
  assert.match(bulk[0], /while /);
  assert.match(bulk[0], /\b2000\b/, 'GALLERY_BULK_FILES defaults to 2000');
  assert.match(bulk[0], /\bcp /, 'each file is a copy of one pushed PNG');
  assert.match(bulk[0], /\/g\$\{[^}]+\}\.png/, 'files are named gNNNN.png');
  assert.match(bulk[0], /touch -d @1704067200/);
  assert.equal(
    calls.filter(call => / push /.test(call) && call.includes('GalleryBulk'))
      .length,
    0,
    'GalleryBulk copies an already pushed PNG',
  );

  const custom = await seededDeviceCommands(t, {GALLERY_BULK_FILES: '37'});
  assert.equal(custom.seeded.status, 0, custom.seeded.stderr);
  const customBulk = custom.calls.filter(
    call => call.includes(DEVICE_GALLERY_BULK) && / shell /.test(call),
  );
  assert.equal(customBulk.length, 1);
  assert.match(customBulk[0], /\b37\b/);
  assert.doesNotMatch(customBulk[0], /\b2000\b/);

  for (const invalid of ['abc', '0', '-5', '10000']) {
    const rejected = await seededDeviceCommands(t, {
      GALLERY_BULK_FILES: invalid,
    });
    assert.notEqual(rejected.seeded.status, 0, invalid);
    assert.match(rejected.seeded.stderr, /GALLERY_BULK_FILES/, invalid);
  }
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
  const maestro = source.indexOf('"$repo/validation/maestro"');

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

test('e2e mode passes the per-run container credentials to Maestro without logging them', async () => {
  const source = await text('scripts/validation/android-flow.sh');
  const maestro = source.indexOf('"$repo/validation/maestro"');
  const e2e = source.lastIndexOf('if [ "$mode" = e2e ]; then', maestro);
  assert.ok(e2e !== -1 && maestro !== -1);
  const block = source.slice(e2e, maestro);

  for (const [prefix, variable, port, remoteRoot] of [
    ['FTP', 'SYNCSCOPE_FTP_CREDENTIAL_FILE', '32120', '/'],
    ['SFTP', 'SYNCSCOPE_SFTP_CREDENTIAL_FILE', '32122', '/srv/fixtures'],
    ['WEBDAV', 'SYNCSCOPE_WEBDAV_CREDENTIAL_FILE', '32180', '/webdav'],
  ]) {
    assert.match(
      block,
      new RegExp(
        `prefix=${prefix}; port=${port}; remote_root=${remoteRoot.replace(
          /\//g,
          '\\/',
        )}; credential_file=\\$${variable}\\b`,
      ),
      `${prefix} must read ${variable} with port ${port} and root ${remoteRoot}`,
    );
  }
  for (const key of ['HOST', 'PORT', 'USER', 'PASSWORD', 'ROOT']) {
    assert.ok(
      block.includes(`-e "\${prefix}_${key}=`),
      `${key} must be passed to maestro with -e`,
    );
  }
  assert.match(block, /_HOST=10\.0\.2\.2"/);
  assert.match(block, /sed -n 's\/\^username=\/\/p'/);
  assert.match(block, /sed -n 's\/\^password=\/\/p'/);
  assert.match(source, /maestro\/bin\/maestro \\\n\s+test "\$@" "\$repo\/validation\/maestro"/);

  assert.doesNotMatch(source, /set -[a-z]*x/, 'tracing would log the password');
  for (const line of source.split('\n')) {
    if (/\b(?:printf|echo)\b/.test(line)) {
      assert.doesNotMatch(line, /\$\{?password\b|_PASSWORD/, line.trim());
    }
  }
});
