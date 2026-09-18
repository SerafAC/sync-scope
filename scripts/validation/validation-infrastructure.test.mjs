import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
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

test('protocol launcher completes pinned version checks before preflight', async t => {
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
    printf '%s\\n' '29.7.2 29.7.2'
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

  const launch = spawnSync(
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

  assert.equal(launch.status, 1);
  assert.match(launch.stderr, /Approved service port is occupied/);
  assert.doesNotMatch(
    launch.stderr,
    /Docker 29\.7\.2 is required|Compose 5\.5\.1 is required|unexpected/,
  );
});
