// Feature 009, Phase 3 (T021): the script contract of the staged hook
// assert-equal-halves.sh (research R10, FR-006,
// contracts/maestro-tree-preview.md › staged/11-toolbar-halves).
//
// The hook reads one `uiautomator dump` through adb and fails unless each of
// the buttons files-sort and files-view is 50 % ± 2 % of files-toolbar. The
// dumps under fixtures/equal-halves/ are served by a fake adb:
//   - pass.xml: recorded on the API 36 emulator with Files open after
//     staged/11-toolbar-halves-a (T020); each button is 479 px of 992 px;
//   - fail.xml: that dump with one button at 56 % of the row, the other 41 %;
//   - bug.xml: that dump with the 007 bug, the -control wrappers at half the
//     row and the buttons inside them shrunk to their content;
//   - missing.xml: that dump without the view drop-down.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmod, mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'node:test';

const SCRIPTS = new URL('./', import.meta.url).pathname;
const HOOK = join(SCRIPTS, 'hooks/assert-equal-halves.sh');
const DUMPS = join(SCRIPTS, 'fixtures/equal-halves');
const REMOTE = '/data/local/tmp/syncscope-equal-halves.xml';

async function executable(path, contents) {
  await mkdir(dirname(path), {recursive: true});
  await writeFile(path, `#!/bin/sh\nset -eu\n${contents}\n`, {mode: 0o700});
  await chmod(path, 0o700);
}

// A fake SDK whose adb records each call and serves `dump` for the cat of the
// remote file. The state root passes the hook's usual guard.
async function harness(t, dump) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-sync-checker-equal-halves-test-'));
  t.after(() => rm(root, {recursive: true, force: true}));
  const sdk = join(root, 'sdk');
  const log = join(root, 'adb.log');
  const served = dump === undefined ? '' : join(DUMPS, dump);
  await executable(join(sdk, 'platform-tools/adb'), `
printf '%s\\n' "$*" >>'${log}'
case "$*" in
  *"exec-out cat ${REMOTE}") [ -z '${served}' ] || cat '${served}' ;;
  *"uiautomator dump ${REMOTE}") printf 'UI hierchary dumped to: ${REMOTE}\\n' ;;
esac`);
  await executable(join(sdk, 'emulator/emulator'), 'exit 0');
  const env = {ANDROID_HOME: sdk, ANDROID_SERIAL: 'emulator-5554', SYNCSCOPE_STATE_ROOT: root};
  return {
    run: (extra = {}, args = []) => spawnSync('sh', [HOOK, ...args], {
      env: {...process.env, ...env, ...extra},
      encoding: 'utf8',
      timeout: 60000,
    }),
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean),
  };
}

test('passes when each button is half the toolbar row, reading one dump through adb (T021)', async t => {
  const h = await harness(t, 'pass.xml');
  const run = h.run();
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /files-sort is \d+ px, 4[89]\.\d % of files-toolbar/);
  assert.match(run.stdout, /files-view is \d+ px, 4[89]\.\d % of files-toolbar/);
  assert.deepEqual(await h.calls(), [
    `-s emulator-5554 shell uiautomator dump ${REMOTE}`,
    `-s emulator-5554 exec-out cat ${REMOTE}`,
    `-s emulator-5554 shell rm -f ${REMOTE}`,
  ]);
});

test('fails when a button is outside 50 % ± 2 % of the row (T021)', async t => {
  const h = await harness(t, 'fail.xml');
  const run = h.run();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /files-sort is 560 px, 56\.5 % of files-toolbar \(992 px\); expected 50 %/);
  assert.match(run.stderr, /files-view is 410 px, 41\.3 % of files-toolbar/);
});

test("fails on today's bug: the wrappers are half the row but the buttons are narrower (T021)", async t => {
  const dump = await readFile(join(DUMPS, 'bug.xml'), 'utf8');
  // The fixture reproduces the bug: the -control wrappers alone would pass.
  for (const [id, bounds] of [['files-sort-control', '[44,334][529,450]'], ['files-view-control', '[551,334][1036,450]']]) {
    const node = dump.split('<node ').find(part => part.includes(`resource-id="${id}"`));
    assert.ok(node?.includes(`bounds="${bounds}"`), `${id} spans half the row`);
  }
  const h = await harness(t, 'bug.xml');
  const run = h.run();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /files-sort is 374 px, 37\.7 % of files-toolbar/);
  assert.match(run.stderr, /files-view is 309 px, 31\.1 % of files-toolbar/);
});

test('fails when a control is missing from the dump, or the dump is empty (T021)', async t => {
  const missing = await harness(t, 'missing.xml');
  const run = missing.run();
  assert.equal(run.status, 1);
  assert.match(run.stderr, /Expected one visible files-view in the dump, found 0/);

  const empty = await harness(t);
  const none = empty.run();
  assert.equal(none.status, 1);
  assert.match(none.stderr, /Expected one visible files-toolbar in the dump, found 0/);
});

test('keeps the usual guards: an owned state root, a serial and no arguments (T021)', async t => {
  const h = await harness(t, 'pass.xml');
  assert.equal(h.run({SYNCSCOPE_STATE_ROOT: '/srv'}).status, 64, 'a foreign root is refused');
  assert.equal(h.run({SYNCSCOPE_STATE_ROOT: ''}).status, 64, 'an unset root is refused');
  assert.equal(h.run({ANDROID_SERIAL: ''}).status, 64, 'a serial is required');
  assert.equal(h.run({}, ['extra']).status, 64, 'no arguments');
  assert.deepEqual(await h.calls(), [], 'no adb call before the guards pass');
});

test('the hook is executable and listed on the staged/11 line (T021, T024)', async () => {
  const pairs = await readFile(new URL('../../validation/maestro/staged/pairs.txt', import.meta.url), 'utf8');
  assert.ok(pairs.split('\n').includes(
    'staged/11-toolbar-halves-a.yaml|assert-equal-halves.sh|staged/11-toolbar-halves-b.yaml',
  ));
  const run = spawnSync('test', ['-x', HOOK]);
  assert.equal(run.status, 0, 'assert-equal-halves.sh must be executable');
});
