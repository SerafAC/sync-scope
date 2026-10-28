// Feature 008, US1 (T033): device fixture validity for
// scripts/validation/device-fixtures.sh (research and data-model fixture
// states: unknown -> validating -> valid/reseed, seeding -> valid only after
// success).
//
// A recording fake adb maps the device paths into a private temporary tree
// and runs the shell commands there, so no real device storage is touched.
// Dataset sizes are scaled down in a disposable copy of the scripts only.
//
//   - Same count with corrupt content is invalid.
//   - A failed seed never leaves a valid marker.
//   - Stale generator or parameter fingerprints are invalid.
//   - Mutable trees are reset on every run; a missing removable volume fails.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

const repository = new URL('../../', import.meta.url).pathname;
const VOLUME = '1A2B-3C4D';

const IMMUTABLE = {
  Bulk: 'sdcard/SyncScopeE2E/Bulk',
  GalleryBulk: 'sdcard/SyncScopeE2E/GalleryBulk',
  Narrow: 'sdcard/SyncScopeE2E/Narrow',
  Scroll: 'sdcard/SyncScopeE2E/Scroll',
  Big: 'sdcard/DCIM/Big',
};
const REQUIRED_MTIME = new Set(['GalleryBulk', 'Narrow', 'Scroll']);
const COUNTS = { Bulk: 30, GalleryBulk: 5, Narrow: 4, Scroll: 12, Big: 20 };

async function executable(path, contents) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/bin/sh\nset -eu\n${contents}\n`, { mode: 0o700 });
  await chmod(path, 0o700);
}

async function replaceIn(path, from, to) {
  const source = await readFile(path, 'utf8');
  assert.ok(source.includes(from), `${relative(repository, path)} no longer contains ${from}`);
  await writeFile(path, source.replace(from, to));
}

async function harness(t) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-fixtures-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scripts = join(root, 'repo/scripts/validation');
  await cp(join(repository, 'scripts/validation'), scripts, { recursive: true });
  // Scaled-down datasets in the disposable copy; the generators are unchanged.
  await replaceIn(join(scripts, 'scroll-manifest.sh'), 'SCROLL_COUNT=5000', `SCROLL_COUNT=${COUNTS.Scroll}`);
  await replaceIn(join(scripts, 'scroll-manifest.sh'), 'NARROW_COUNT=200', `NARROW_COUNT=${COUNTS.Narrow}`);
  await replaceIn(join(scripts, 'device-fixtures.sh'), 'big_files=10000', `big_files=${COUNTS.Big}`);
  const device = join(root, 'device');
  await mkdir(join(device, 'sdcard'), { recursive: true });
  await mkdir(join(device, 'storage', VOLUME), { recursive: true });
  await mkdir(join(device, 'data/local/tmp'), { recursive: true });
  const bin = join(root, 'bin');
  const calls = join(root, 'calls');
  await writeFile(calls, '');
  // Fails the Nth truncate (FAKE_TRUNCATE_FAIL_AT) once it has extended the
  // files before it: a seed that dies after creating every file.
  await executable(join(bin, 'device-bin/truncate'), `
n=0; [ ! -f "$FAKE_STATE/truncates" ] || n=$(cat "$FAKE_STATE/truncates")
n=$((n + 1)); printf '%s\\n' "$n" >"$FAKE_STATE/truncates"
if [ -n "\${FAKE_TRUNCATE_FAIL_AT:-}" ] && [ "$n" -ge "$FAKE_TRUNCATE_FAIL_AT" ]; then exit 1; fi
exec /usr/bin/truncate "$@"`);
  await executable(join(bin, 'device-bin/sm'), `
[ "\${FAKE_NO_VOLUME:-0}" = 1 ] || printf 'public:179,1 mounted ${VOLUME}\\n'`);
  const map = `sed -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/sdcard#\\\\1$FAKE_DEVICE/sdcard#g" \
    -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/storage/#\\\\1$FAKE_DEVICE/storage/#g" \
    -e "s#\\\\(^\\\\|[ '\\"=;(]\\\\)/data/local/tmp#\\\\1$FAKE_DEVICE/data/local/tmp#g"`;
  const sdk = join(root, 'sdk');
  await executable(join(sdk, 'platform-tools/adb'), `
[ "\${1:-}" != version ] || { printf '37.0.1\\n'; exit 0; }
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
  const state = join(root, 'state');
  await mkdir(state);
  const env = {
    ...process.env,
    ANDROID_HOME: sdk,
    ANDROID_SERIAL: 'emulator-5554',
    BULK_FILES: String(COUNTS.Bulk),
    GALLERY_BULK_FILES: String(COUNTS.GalleryBulk),
    FAKE_DEVICE: device,
    FAKE_BIN: bin,
    FAKE_STATE: state,
    SYNCSCOPE_TEST_CALLS: calls,
  };
  const seed = (extra = {}) => {
    const result = spawnSync('sh', [join(scripts, 'device-fixtures.sh')], {
      env: { ...env, ...extra },
      encoding: 'utf8',
      timeout: 120000,
    });
    return result;
  };
  return {
    root,
    scripts,
    device,
    seed,
    path: relativePath => join(device, relativePath),
    calls: async () => readFile(calls, 'utf8'),
    resetCalls: () => writeFile(calls, ''),
  };
}

async function files(directory) {
  const result = [];
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        result.push(path);
      }
    }
  }
  await walk(directory);
  return result.sort();
}

/** Name, size, mtime and a content digest of every file in a set. */
async function snapshot(h, set) {
  const result = {};
  for (const path of await files(h.path(IMMUTABLE[set]))) {
    const info = await stat(path);
    const handle = await open(path, 'r');
    const head = Buffer.alloc(64);
    await handle.read(head, 0, 64, 0);
    await handle.close();
    result[relative(h.device, path)] = {
      size: info.size,
      // Only these sets have required mtimes; Bulk and Big take the seed time.
      mtime: REQUIRED_MTIME.has(set) ? Math.trunc(info.mtimeMs / 1000) : null,
      head: head.toString('hex'),
    };
  }
  return result;
}

async function overwriteFirstByte(path) {
  const handle = await open(path, 'r+');
  const byte = Buffer.alloc(1);
  await handle.read(byte, 0, 1, 0);
  byte[0] = byte[0] ^ 0xff;
  await handle.write(byte, 0, 1, 0);
  await handle.close();
}

async function first(h, set) {
  const [path] = await files(h.path(IMMUTABLE[set]));
  assert.ok(path, `${set} has files`);
  return path;
}

test('a fresh seed creates every set at full size; markers stay outside scanned trees', async t => {
  const h = await harness(t);
  const run = h.seed();
  assert.equal(run.status, 0, run.stderr);
  for (const [set, count] of Object.entries(COUNTS)) {
    assert.equal((await files(h.path(IMMUTABLE[set]))).length, count, `${set} holds exactly its files`);
  }
  const big = await files(h.path(IMMUTABLE.Big));
  assert.ok(big.every(path => /\/IMG_\d+\.jpg$/.test(path)));
  // A second, valid run must not add anything to a scanned tree either.
  const again = h.seed();
  assert.equal(again.status, 0, again.stderr);
  for (const [set, count] of Object.entries(COUNTS)) {
    assert.equal((await files(h.path(IMMUTABLE[set]))).length, count, `${set} after reuse`);
  }
  assert.equal((await files(h.path(`storage/${VOLUME}/SyncScopeE2E`))).length, 1);
});

test('same count with corrupt content is invalid and is reseeded', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const expected = {};
  for (const set of Object.keys(IMMUTABLE)) {
    expected[set] = await snapshot(h, set);
  }
  // Same name and size, different bytes (or bytes where none belong).
  for (const set of ['Bulk', 'GalleryBulk', 'Narrow', 'Scroll']) {
    await overwriteFirstByte(await first(h, set));
  }
  await writeFile(await first(h, 'Big'), 'x');
  const run = h.seed();
  assert.equal(run.status, 0, run.stderr);
  for (const set of Object.keys(IMMUTABLE)) {
    assert.deepEqual(await snapshot(h, set), expected[set], `${set} was reused while corrupt`);
  }
});

test('a changed size or required mtime is invalid, even with the same count', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const expected = await snapshot(h, 'Scroll');
  const [one, two] = await files(h.path(IMMUTABLE.Scroll));
  await utimes(one, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'));
  const handle = await open(two, 'r+');
  await handle.truncate(1);
  await handle.close();
  assert.equal(h.seed().status, 0);
  assert.deepEqual(await snapshot(h, 'Scroll'), expected);
});

test('a missing or renamed file is invalid', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const expected = { Scroll: await snapshot(h, 'Scroll'), Big: await snapshot(h, 'Big') };
  const scroll = await first(h, 'Scroll');
  await cp(scroll, `${scroll}.renamed`);
  await unlink(scroll);
  const big = await first(h, 'Big');
  await writeFile(join(dirname(big), 'unexpected.jpg'), '');
  await unlink(big);
  assert.equal(h.seed().status, 0);
  assert.deepEqual(await snapshot(h, 'Scroll'), expected.Scroll);
  assert.deepEqual(await snapshot(h, 'Big'), expected.Big);
});

test('a stale generator fingerprint is invalid, even when the files look complete', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const before = await snapshot(h, 'Scroll');
  // Same count, names, sizes and mtimes; a different generator base image.
  const images = join(h.scripts, 'fixture-images.sh');
  const source = await readFile(images, 'utf8');
  const sunset = source.match(/^PNG_SUNSET='([^']+)'$/m)[1];
  const beach = source.match(/^PNG_BEACH='([^']+)'$/m)[1];
  await replaceIn(images, `PNG_SUNSET='${sunset}'`, `PNG_SUNSET='${beach}'`);
  assert.equal(h.seed().status, 0);
  const after = await snapshot(h, 'Scroll');
  assert.deepEqual(Object.keys(after), Object.keys(before));
  const beachHead = Buffer.from(beach, 'base64').subarray(0, 64).toString('hex');
  for (const [path, file] of Object.entries(after)) {
    assert.equal(file.head.slice(0, beachHead.length), beachHead, `${path} kept the stale generator`);
  }
});

test('a stale parameter fingerprint is invalid', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  assert.equal(h.seed({ GALLERY_BULK_FILES: '7', BULK_FILES: '31' }).status, 0);
  assert.equal((await files(h.path(IMMUTABLE.GalleryBulk))).length, 7);
  assert.equal((await files(h.path(IMMUTABLE.Bulk))).length, 31);
});

test('a failed seed never leaves a valid marker: the next run reseeds', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const expected = await snapshot(h, 'Scroll');
  // Corrupt Scroll so it must be reseeded, then fail that reseed after every
  // file exists but before the last one has its size: same count, wrong data.
  await overwriteFirstByte(await first(h, 'Scroll'));
  await writeFile(join(h.root, 'state/truncates'), '0');
  const failed = h.seed({ FAKE_TRUNCATE_FAIL_AT: String(COUNTS.Scroll) });
  if (failed.status === 0) {
    // A run that kept the corrupt set never attempted the reseed at all.
    assert.notDeepEqual(await snapshot(h, 'Scroll'), expected, 'unexpected success');
    assert.fail('the corrupt Scroll set was reused instead of reseeded');
  }
  assert.equal((await files(h.path(IMMUTABLE.Scroll))).length, COUNTS.Scroll);
  const recovered = h.seed();
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(await snapshot(h, 'Scroll'), expected, 'a failed seed was taken as valid');
});

test('mutable gallery, deletion and TwoFolders trees are reset on every run', async t => {
  const h = await harness(t);
  assert.equal(h.seed().status, 0);
  const trees = ['Gallery', 'Delete', 'Recheck', 'Offline', 'Select', 'Changed', 'GalleryTwin', 'TwoFolders', 'Scan'];
  const expected = {};
  for (const tree of trees) {
    expected[tree] = (await files(h.path(`sdcard/SyncScopeE2E/${tree}`))).map(path => relative(h.device, path));
  }
  await unlink(h.path('sdcard/SyncScopeE2E/Delete/beach.png'));
  await utimes(h.path('sdcard/SyncScopeE2E/Changed/sunset.png'), new Date(), new Date());
  await writeFile(h.path('sdcard/SyncScopeE2E/TwoFolders/extra.txt'), 'left over');
  await unlink(h.path('sdcard/SyncScopeE2E/GalleryTwin/sunset.png'));
  assert.equal(h.seed().status, 0);
  for (const tree of trees) {
    const now = (await files(h.path(`sdcard/SyncScopeE2E/${tree}`))).map(path => relative(h.device, path));
    assert.deepEqual(now, expected[tree], tree);
  }
  const changed = await stat(h.path('sdcard/SyncScopeE2E/Changed/sunset.png'));
  assert.equal(Math.trunc(changed.mtimeMs / 1000), 1704067200);
});

test('a missing removable volume fails before seeding and leaves no marker', async t => {
  const h = await harness(t);
  const run = h.seed({ FAKE_NO_VOLUME: '1' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /No public removable volume/);
  assert.deepEqual(await files(h.device), []);
});
