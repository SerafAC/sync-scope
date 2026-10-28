// Feature 009, Phase 1 (T005): script contracts for the `tree` fixtures and
// the hooks the tree flows and staged lines use
// (specs/009-tree-view-image-preview/contracts/maestro-tree-preview.md).
//
//   - T001: fixture-images.sh --check lists the 2 s H.264 MP4 without ffmpeg.
//   - T002: device-fixtures.sh seeds the tree set in SyncScopeE2E/ScanTree as
//     an immutable set with a fixed mtime (kept while valid, reseeded once
//     changed).
//   - T003: fixture-seed.sh writes the same set, new.jpg included, under
//     scan/tree, and the before-manifest holds it.
//   - T004: the recheck hooks and change-device-files.sh take an optional,
//     validated path; with no argument they keep the feature 006 targets.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, relative} from 'node:path';
import test from 'node:test';

const SCRIPTS = new URL('./', import.meta.url).pathname;
const HOOKS = join(SCRIPTS, 'hooks');
const IMAGES = join(SCRIPTS, 'fixture-images.sh');
const VOLUME = '1A2B-3C4D';
const TREE_MTIME = 1704067200;
const CHANGED_MTIME = 1704153600;

// The tree set, as contracts/maestro-tree-preview.md › Fixtures lists it.
const TREE_FILES = [
  'Album/2024/a1.jpg',
  'Album/2024/a2.jpg',
  'Album/2024/a3.jpg',
  'Album/2024/a4.jpg',
  'Album/2024/a5.jpg',
  'Album/2025/b1.jpg',
  'Album/2025/clip.mp4',
  'Album/2025/new.jpg',
  'Album/Docs/doc.pdf',
  'Loose.jpg',
];
const TREE_DIRECTORIES = ['Album', 'Album/2024', 'Album/2025', 'Album/Docs', 'Empty'];

async function executable(path, contents) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `#!/bin/sh\nset -eu\n${contents}\n`, {mode: 0o700});
  await chmod(path, 0o700);
}

async function scratch(t, prefix = 'cloud-sync-checker-tree-test-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    // fixture-seed.sh closes two directories to the container accounts.
    for (const restricted of ['scan/partial/restricted', 'gallery-partial/restricted']) {
      await chmod(join(root, 'fixtures', restricted), 0o755).catch(() => {});
    }
    await rm(root, {recursive: true, force: true});
  });
  return root;
}

/** Every directory and file under `directory`, relative, sorted. */
async function walk(directory) {
  const result = {directories: [], files: []};
  async function visit(current) {
    for (const entry of await readdir(current, {withFileTypes: true})) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        result.directories.push(relative(directory, path));
        await visit(path);
      } else {
        result.files.push(relative(directory, path));
      }
    }
  }
  await visit(directory);
  result.directories.sort();
  result.files.sort();
  return result;
}

function sh(args, env = {}) {
  return spawnSync('sh', args, {encoding: 'utf8', env: {...process.env, ...env}});
}

function seedRemote(state) {
  const seed = sh([join(SCRIPTS, 'fixture-seed.sh'), '--root', join(state, 'fixtures')]);
  assert.equal(seed.status, 0, seed.stderr);
}

function manifest(fixtures) {
  const run = spawnSync(process.execPath, [join(SCRIPTS, 'fixture-manifest.mjs'), fixtures], {
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout;
}

// --- T001: fixture-images.sh --check -----------------------------------------

test('fixture-images.sh --check lists the 2 s H.264 MP4 without running ffmpeg (T001)', async t => {
  const root = await scratch(t);
  const bin = join(root, 'bin');
  const marker = join(root, 'ffmpeg-called');
  await executable(join(bin, 'ffmpeg'), `: >'${marker}'\nexit 99`);
  await executable(join(bin, 'ffprobe'), `: >'${marker}'\nexit 99`);
  const run = sh([IMAGES, '--check'], {PATH: `${bin}:${process.env.PATH}`});
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /^MP4_CLIP video\/mp4 \d+ bytes sha256 [0-9a-f]{64} h264 2\.000 s$/m);
  for (const name of ['PNG_SUNSET', 'PNG_BEACH', 'PNG_FOREST', 'PNG_HARBOR', 'PNG_TWIN']) {
    assert.match(run.stdout, new RegExp(`^${name} image/png `, 'm'), name);
  }
  assert.match(run.stdout, /^JPG_TREE image\/jpeg /m);
  assert.match(run.stdout, /^PDF_DOC application\/pdf /m);
  await assert.rejects(lstat(marker), 'only --regenerate may need ffmpeg');
  assert.ok((await lstat(IMAGES)).mode & 0o111, 'fixture-images.sh --check runs as a command');
});

test('fixture-images.sh --check fails for an MP4 that is not 2 s of H.264 (T001)', async t => {
  const root = await scratch(t);
  const copy = join(root, 'fixture-images.sh');
  const source = await readFile(IMAGES, 'utf8');
  const png = source.match(/^PNG_SUNSET='([^']+)'$/m)[1];
  await writeFile(copy, source.replace(/^MP4_CLIP='[^']+'$/m, `MP4_CLIP='${png}'`));
  const run = sh([copy, '--check']);
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /MP4_CLIP: not an MP4/);

  // The real clip with its movie-header duration halved (mvhd timescale x2).
  const clip = Buffer.from(source.match(/^MP4_CLIP='([^']+)'$/m)[1], 'base64');
  const at = clip.indexOf('mvhd');
  assert.ok(at > 0 && clip[at + 4] === 0, 'the clip has a version 0 movie header');
  clip.writeUInt32BE(clip.readUInt32BE(at + 16) * 2, at + 16);
  await writeFile(copy, source.replace(/^MP4_CLIP='[^']+'$/m, `MP4_CLIP='${clip.toString('base64')}'`));
  const halved = sh([copy, '--check']);
  assert.notEqual(halved.status, 0);
  assert.match(halved.stderr, /MP4_CLIP: duration is 1000 ms, not 2000 ms/);
});

test('fixture-images.sh is inert when sourced and refuses unknown modes (T001)', () => {
  const sourced = sh(['-c', `. '${IMAGES}' --check && printf 'sourced\\n'`]);
  assert.equal(sourced.status, 0, sourced.stderr);
  assert.equal(sourced.stdout, 'sourced\n', 'sourcing defines the fixtures and runs nothing');
  const usage = sh([IMAGES]);
  assert.equal(usage.status, 64);
  assert.match(usage.stderr, /Usage: fixture-images\.sh --check \| --regenerate/);
});

// --- T002/T003: the tree set's names and counts --------------------------------

test('the tree set has the contract names and counts, defined once (T002, T003)', () => {
  const run = sh(['-c', `. '${IMAGES}' && tree_fixture_files && printf 'empty %s\\nmtime %s\\nfixture %s\\ndevice %s\\n' "$TREE_EMPTY_DIRS" "$TREE_MTIME" "$TREE_FIXTURE_PATH" "$TREE_DEVICE_DIR"`]);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  const files = lines.filter(line => !/^(empty|mtime|fixture|device) /.test(line));
  assert.deepEqual(files.map(line => line.split(' ')[0]).sort(), TREE_FILES);
  assert.equal(files.length, 10);
  const kinds = Object.fromEntries(files.map(line => line.split(' ')));
  assert.equal(kinds['Album/2025/clip.mp4'], 'MP4_CLIP');
  assert.equal(kinds['Album/Docs/doc.pdf'], 'PDF_DOC');
  assert.equal(TREE_FILES.filter(path => kinds[path] === 'JPG_TREE').length, 8);
  assert.ok(lines.includes('empty Empty'));
  assert.ok(lines.includes(`mtime ${TREE_MTIME}`));
  assert.ok(lines.includes('fixture scan/tree'));
  assert.ok(lines.includes('device /sdcard/SyncScopeE2E/ScanTree'));
});

test('fixture-seed.sh writes the tree set, new.jpg included, under scan/tree and into the before-manifest (T003)', async t => {
  const state = await scratch(t);
  seedRemote(state);
  const tree = join(state, 'fixtures/scan/tree');
  const listed = await walk(tree);
  assert.deepEqual(listed.files, TREE_FILES);
  assert.deepEqual(listed.directories, TREE_DIRECTORIES);
  for (const path of TREE_FILES) {
    const info = await stat(join(tree, path));
    assert.equal(Math.trunc(info.mtimeMs / 1000), TREE_MTIME, `${path} has the set's mtime`);
    assert.equal(info.mode & 0o777, 0o644, path);
  }
  const clip = await readFile(join(tree, 'Album/2025/clip.mp4'));
  assert.equal(clip.subarray(4, 8).toString('latin1'), 'ftyp');

  const before = sh([join(SCRIPTS, 'fixture-manifest.sh'), '--protocol', 'sftp', '--phase', 'before', '--state', state]);
  assert.equal(before.status, 0, before.stderr);
  const recorded = (await readFile(join(state, 'manifests/sftp.before.sha256'), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  const newJpg = recorded.find(entry => entry.path === 'scan/tree/Album/2025/new.jpg');
  assert.ok(newJpg, 'the before-manifest holds Album/2025/new.jpg');
  assert.equal(newJpg.kind, 'regular');
  assert.equal(newJpg.modifiedNanoseconds, `${TREE_MTIME}000000000`);
  for (const path of [...TREE_FILES, ...TREE_DIRECTORIES]) {
    assert.ok(recorded.some(entry => entry.path === `scan/tree/${path}`), path);
  }
});

// --- T002: device-fixtures.sh -------------------------------------------------

/**
 * A disposable copy of the scripts with scaled-down sets and a recording fake
 * adb that runs every shell command against a private tree (the approach of
 * performance-fixtures.test.mjs).
 */
async function deviceHarness(t) {
  const root = await scratch(t, 'cloud-sync-checker-tree-device-test-');
  const scripts = join(root, 'repo/scripts/validation');
  await cp(SCRIPTS, scripts, {recursive: true});
  const replace = async (file, from, to) => {
    const path = join(scripts, file);
    const source = await readFile(path, 'utf8');
    assert.ok(source.includes(from), `${file} no longer contains ${from}`);
    await writeFile(path, source.replace(from, to));
  };
  await replace('scroll-manifest.sh', 'SCROLL_COUNT=5000', 'SCROLL_COUNT=3');
  await replace('scroll-manifest.sh', 'NARROW_COUNT=200', 'NARROW_COUNT=2');
  await replace('device-fixtures.sh', 'big_files=10000', 'big_files=3');
  const device = join(root, 'device');
  await mkdir(join(device, 'sdcard'), {recursive: true});
  await mkdir(join(device, 'storage', VOLUME), {recursive: true});
  await mkdir(join(device, 'data/local/tmp'), {recursive: true});
  const bin = join(root, 'bin');
  await executable(join(bin, 'device-bin/sm'), `printf 'public:179,1 mounted ${VOLUME}\\n'`);
  const map = `sed -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/sdcard#\\\\1$FAKE_DEVICE/sdcard#g" \
    -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/storage/#\\\\1$FAKE_DEVICE/storage/#g" \
    -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/data/local/tmp#\\\\1$FAKE_DEVICE/data/local/tmp#g"`;
  const sdk = join(root, 'sdk');
  const calls = join(root, 'calls');
  await writeFile(calls, '');
  await executable(join(sdk, 'platform-tools/adb'), `
[ "$1" = -s ] || exit 64
shift 2
action=$1; shift
printf '%s %s\\n' "$action" "$*" >>"$SYNCSCOPE_TEST_CALLS"
case "$action" in
  shell)
    command=$(printf '%s' "$*" | ${map})
    PATH="$FAKE_BIN/device-bin:$PATH" sh -c "$command" ;;
  push)
    target=$(printf '%s' "$2" | ${map})
    mkdir -p "$(dirname "$target")"
    case "$target" in
      *.sh) ${map} <"$1" >"$target" ;;
      *) cp "$1" "$target" ;;
    esac ;;
  *) exit 64 ;;
esac`);
  await executable(join(sdk, 'emulator/emulator'), 'exit 0');
  const env = {
    ANDROID_HOME: sdk,
    ANDROID_SERIAL: 'emulator-5554',
    BULK_FILES: '3',
    GALLERY_BULK_FILES: '2',
    FAKE_DEVICE: device,
    FAKE_BIN: bin,
    SYNCSCOPE_TEST_CALLS: calls,
  };
  return {
    tree: join(device, 'sdcard/SyncScopeE2E/ScanTree'),
    seed: () => spawnSync('sh', [join(scripts, 'device-fixtures.sh')], {
      env: {...process.env, ...env},
      encoding: 'utf8',
      timeout: 120000,
    }),
    calls: () => readFile(calls, 'utf8'),
    resetCalls: () => writeFile(calls, ''),
  };
}

test('device-fixtures.sh seeds the tree set in ScanTree, byte-identical to the server set (T002)', async t => {
  const h = await deviceHarness(t);
  const first = h.seed();
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /Seeding \/sdcard\/SyncScopeE2E\/ScanTree \(Tree\)\./);
  const listed = await walk(h.tree);
  assert.deepEqual(listed.files, TREE_FILES);
  assert.deepEqual(listed.directories, TREE_DIRECTORIES);

  const state = await scratch(t);
  seedRemote(state);
  for (const path of TREE_FILES) {
    const local = join(h.tree, path);
    assert.equal(Math.trunc((await stat(local)).mtimeMs / 1000), TREE_MTIME, `${path} has the set's mtime`);
    assert.deepEqual(
      await readFile(local),
      await readFile(join(state, 'fixtures/scan/tree', path)),
      `${path} matches the server copy byte for byte`,
    );
  }
  // Not inside SyncScopeE2E/Scan: shared storage is case-insensitive, and the
  // Scan source's counts must not change.
  await assert.rejects(lstat(join(dirname(h.tree), 'Scan/tree')));
});

test('device-fixtures.sh keeps a valid tree set and reseeds a changed one (T002)', async t => {
  const h = await deviceHarness(t);
  assert.equal(h.seed().status, 0);
  await h.resetCalls();
  const kept = h.seed();
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.stdout, /Keeping \/sdcard\/SyncScopeE2E\/ScanTree \(validated Tree\)\./);
  assert.doesNotMatch(await h.calls(), /push \S+ \/sdcard\/SyncScopeE2E\/ScanTree\//);

  // tree/05 deletes a1-a3; staged/10 touches a4. Both are reseeded next time.
  for (const name of ['a1', 'a2', 'a3']) {
    await unlink(join(h.tree, `Album/2024/${name}.jpg`));
  }
  const reseeded = h.seed();
  assert.equal(reseeded.status, 0, reseeded.stderr);
  assert.match(reseeded.stdout, /Seeding \/sdcard\/SyncScopeE2E\/ScanTree \(Tree\)\./);
  assert.deepEqual((await walk(h.tree)).files, TREE_FILES);

  const a4 = join(h.tree, 'Album/2024/a4.jpg');
  await utimes(a4, CHANGED_MTIME, CHANGED_MTIME);
  const touched = h.seed();
  assert.equal(touched.status, 0, touched.stderr);
  assert.match(touched.stdout, /Seeding \/sdcard\/SyncScopeE2E\/ScanTree \(Tree\)\./, 'an mtime change is a change');
  assert.equal(Math.trunc((await stat(a4)).mtimeMs / 1000), TREE_MTIME);
});

// --- T004: remove-recheck-file.sh and restore-recheck-file.sh -------------------

const NEW_JPG = 'scan/tree/Album/2025/new.jpg';
const INVALID_PATHS = ['../outside.jpg', 'scan/tree/../../outside.jpg', '/etc/hostname', 'scan/..', ''];

function hook(name, args, env) {
  return sh([join(HOOKS, name), ...args], env);
}

test('the recheck hooks remove and restore a named fixture file to the seeded manifest (T004)', async t => {
  const state = await scratch(t);
  seedRemote(state);
  const fixtures = join(state, 'fixtures');
  const seeded = manifest(fixtures);
  const env = {SYNCSCOPE_STATE_ROOT: state};

  const removed = hook('remove-recheck-file.sh', [NEW_JPG], env);
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(lstat(join(fixtures, NEW_JPG)));
  await lstat(join(fixtures, 'recheck/beach.png'));
  await lstat(join(fixtures, 'scan/tree/Album/2025/b1.jpg'));
  assert.equal(hook('remove-recheck-file.sh', [NEW_JPG], env).status, 0, 'removing an absent file is a no-op');

  // No source: rewritten from the tree set's definition.
  const restored = hook('restore-recheck-file.sh', [NEW_JPG], env);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(manifest(fixtures), seeded, 'the restored tree matches the seeded manifest exactly');
  assert.equal(hook('restore-recheck-file.sh', [NEW_JPG], env).status, 0);
  assert.equal(manifest(fixtures), seeded, 'restore is a no-op when the file is present');

  // With a source copy.
  assert.equal(hook('remove-recheck-file.sh', [NEW_JPG], env).status, 0);
  const copied = hook('restore-recheck-file.sh', [NEW_JPG, 'scan/tree/Album/2025/b1.jpg'], env);
  assert.equal(copied.status, 0, copied.stderr);
  assert.equal(manifest(fixtures), seeded, 'a byte-identical source restores the same tree');

  // No source and not a file of the tree set: refused, nothing written.
  assert.equal(hook('remove-recheck-file.sh', ['gallery/beach.png'], env).status, 0);
  const unsourced = hook('restore-recheck-file.sh', ['gallery/beach.png'], env);
  assert.equal(unsourced.status, 64);
  await assert.rejects(lstat(join(fixtures, 'gallery/beach.png')));

  // A missing directory is a no-op, like the feature 006 recheck/ case.
  const absentDirectory = hook('restore-recheck-file.sh', ['scan/tree/Gone/new.jpg', 'scan/tree/Loose.jpg'], env);
  assert.equal(absentDirectory.status, 0, absentDirectory.stderr);
  await assert.rejects(lstat(join(fixtures, 'scan/tree/Gone')));
});

test('the recheck hooks validate their path arguments and keep the root guard (T004)', async t => {
  const state = await scratch(t);
  seedRemote(state);
  const fixtures = join(state, 'fixtures');
  // A file outside the fixture tree that a traversal would reach.
  await writeFile(join(state, 'outside.jpg'), 'outside');
  await hook('remove-recheck-file.sh', [NEW_JPG], {SYNCSCOPE_STATE_ROOT: state});
  const seeded = manifest(fixtures);
  const env = {SYNCSCOPE_STATE_ROOT: state};
  for (const path of INVALID_PATHS) {
    for (const name of ['remove-recheck-file.sh', 'restore-recheck-file.sh']) {
      const run = hook(name, [path], env);
      assert.equal(run.status, 64, `${name} '${path}' must exit 64`);
    }
    const badSource = hook('restore-recheck-file.sh', [NEW_JPG, path], env);
    assert.equal(badSource.status, 64, `restore-recheck-file.sh source '${path}' must exit 64`);
  }
  assert.equal(await readFile(join(state, 'outside.jpg'), 'utf8'), 'outside');
  assert.equal(manifest(fixtures), seeded, 'a rejected path changes nothing');
  for (const name of ['remove-recheck-file.sh', 'restore-recheck-file.sh']) {
    const foreign = hook(name, [NEW_JPG], {SYNCSCOPE_STATE_ROOT: '/srv'});
    assert.equal(foreign.status, 64, `${name} must refuse a foreign root`);
    const extra = hook(name, [NEW_JPG, 'scan/tree/Loose.jpg', 'extra'], env);
    assert.equal(extra.status, 64, `${name} takes at most its documented arguments`);
  }
});

test('with no argument the recheck hooks still target recheck/beach.png (T004)', async t => {
  const state = await scratch(t);
  seedRemote(state);
  const fixtures = join(state, 'fixtures');
  const seeded = manifest(fixtures);
  const env = {SYNCSCOPE_STATE_ROOT: state};
  const removed = hook('remove-recheck-file.sh', [], env);
  assert.equal(removed.status, 0, removed.stderr);
  await assert.rejects(lstat(join(fixtures, 'recheck/beach.png')));
  await lstat(join(fixtures, NEW_JPG));
  await lstat(join(fixtures, 'gallery/beach.png'));
  const restored = hook('restore-recheck-file.sh', [], env);
  assert.equal(restored.status, 0, restored.stderr);
  assert.equal(manifest(fixtures), seeded);
  assert.equal(
    await readFile(join(fixtures, 'recheck/beach.png'), 'base64'),
    await readFile(join(fixtures, 'gallery/beach.png'), 'base64'),
    'restored from gallery/beach.png',
  );
});

// --- T004: change-device-files.sh ---------------------------------------------

async function recordingAdb(t) {
  const root = await scratch(t, 'cloud-sync-checker-tree-adb-test-');
  const sdk = join(root, 'sdk');
  const log = join(root, 'adb.log');
  await executable(join(sdk, 'platform-tools/adb'), `printf '%s\\n' "$*" >>'${log}'`);
  await executable(join(sdk, 'emulator/emulator'), 'exit 0');
  return {
    env: {ANDROID_HOME: sdk, ANDROID_SERIAL: 'emulator-5556'},
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean),
  };
}

test('change-device-files.sh touches one tree-set file named by its scan/ path (T004)', async t => {
  const adb = await recordingAdb(t);
  const run = hook('change-device-files.sh', ['scan/tree/Album/2024/a4.jpg'], adb.env);
  assert.equal(run.status, 0, run.stderr);
  const calls = await adb.calls();
  assert.equal(calls.length, 1, 'one adb shell call');
  assert.equal(
    calls[0],
    `-s emulator-5556 shell [ -f '/sdcard/SyncScopeE2E/ScanTree/Album/2024/a4.jpg' ] && touch -d @${CHANGED_MTIME} '/sdcard/SyncScopeE2E/ScanTree/Album/2024/a4.jpg'`,
  );
  assert.doesNotMatch(calls.join('\n'), /Changed/, 'the staged/08 files are left alone');
});

test('change-device-files.sh rejects paths outside a device set before calling adb (T004)', async t => {
  const adb = await recordingAdb(t);
  for (const path of [...INVALID_PATHS, 'Album/2024/a4.jpg', 'scan/clean/exact.txt', 'scan/tree/', "scan/tree/it's.jpg"]) {
    const run = hook('change-device-files.sh', [path], adb.env);
    assert.equal(run.status, 64, `'${path}' must exit 64`);
  }
  assert.equal(hook('change-device-files.sh', ['scan/tree/Loose.jpg', 'extra'], adb.env).status, 64);
  assert.deepEqual(await adb.calls(), [], 'no adb call for a rejected path');
});

test('with no argument change-device-files.sh still changes the staged/08 files (T004)', async t => {
  const adb = await recordingAdb(t);
  const run = hook('change-device-files.sh', [], adb.env);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(await adb.calls(), [
    '-s emulator-5556 shell rm /sdcard/SyncScopeE2E/Changed/beach.png',
    `-s emulator-5556 shell touch -d @${CHANGED_MTIME} /sdcard/SyncScopeE2E/Changed/sunset.png`,
  ]);
});
