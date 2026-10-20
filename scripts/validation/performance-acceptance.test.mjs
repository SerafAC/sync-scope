import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  captureLifecycle,
  correctLifecycleInventory,
  retainLifecycleCorrection,
} from './performance-acceptance.mjs';

const root = new URL('../../', import.meta.url);

test('scalar stop/relaunch command nodes retain the restart boundary', () => {
  const result = captureLifecycle(`appId: synthetic
---
- launchApp:
    clearState: true
- stopApp
- launchApp
`);
  assert.deepEqual(
    result.map(record => record.command),
    ['launchApp', 'stopApp', 'launchApp'],
  );
  assert.equal(result[0].clearState, true);
  assert.equal(result[1].form, 'scalar');
  assert.equal(result[2].stopApp, null); // Unspecified, not false.
  assert.deepEqual(
    result.map(record => record.line),
    [3, 5, 6],
  );
  assert.deepEqual(
    result.map(record => record.node),
    ['commands[0]', 'commands[1]', 'commands[2]'],
  );
});

test('Home and stopApp:false describe background/foreground, not force stop', () => {
  const result = captureLifecycle(`appId: synthetic
---
- pressKey: Home
- launchApp:
    stopApp: false
    clearState: false
`);
  assert.deepEqual(
    result.map(record => record.command),
    ['pressKey', 'launchApp'],
  );
  assert.equal(result[0].key, 'Home');
  assert.equal(result[1].stopApp, false);
  assert.equal(result[1].clearState, false);
});

test('only command nodes count, not nested options, environment or block text', () => {
  const result = captureLifecycle(`appId: synthetic
env:
  stopApp: true
---
- launchApp:
    clearState: false
    stopApp: true
    arguments:
      clearState: true
- runFlow:
    env:
      commands:
        - stopApp
      stopApp: false
    commands:
      - evalScript: |
          - stopApp
          - launchApp:
              clearState: true
      - launchApp:
          stopApp: false
- pressKey: Back
- clearState: synthetic
`);
  assert.deepEqual(
    result.map(record => record.command),
    ['launchApp', 'launchApp', 'clearState'],
  );
  assert.equal(result[0].clearState, false);
  assert.equal(result[0].stopApp, true);
  assert.equal(result[1].stopApp, false);
  assert.equal(result[1].node, 'commands[1].runFlow.commands[1]');
});

test('original real flows retain restart and background definitions without editing them', async () => {
  const capture = async path =>
    captureLifecycle(
      await readFile(new URL(`validation/maestro/${path}.yaml`, root), 'utf8'),
    );
  // Feature 008 (T037, research R12): a caller coming back from the
  // configure-repository seam now launches MainActivity itself, because
  // open-sources is navigation only. That explicit launch comes before the
  // original restart/background definitions, which stay exactly as they were.
  const seamReturn = records => {
    const [first, ...rest] = records;
    assert.equal(first.command, 'launchApp');
    assert.equal(first.clearState, true);
    assert.equal(rest.length, 3, 'one seam return before the original definitions');
    assert.equal(rest[0].command, 'launchApp');
    assert.equal(rest[0].clearState, null, 'the seam return keeps app state');
    return [first, ...rest.slice(1)];
  };
  const reopen = seamReturn(await capture('scan/04-reopen-refresh'));
  assert.deepEqual(
    reopen.map(record => record.command),
    ['launchApp', 'stopApp', 'launchApp'],
  );
  const sort = await capture('polish/02-sort-persists');
  assert.deepEqual(
    sort.map(record => record.command),
    ['launchApp', 'stopApp', 'launchApp'],
  );
  const background = seamReturn(await capture('scan/05-background-discards'));
  assert.deepEqual(
    background.map(record => record.command),
    ['launchApp', 'pressKey', 'launchApp'],
  );
  assert.equal(background.at(-1).stopApp, false);
  assert.equal(background.at(-2).key, 'Home');
  const continuation = await capture('staged/08-changed-b');
  assert.deepEqual(continuation, []);
});

test('repeat/retry commands retain ordered definition nodes, including comments and CRLF', () => {
  const result = captureLifecycle(
    `appId: synthetic
---
- repeat:
    times: 2
    commands:
      - retry:
          maxRetries: 1
          commands:
          - stopApp # a command, not a launch option
          - launchApp:
              stopApp: true # explicit restart
- pressKey: "Home"
`.replaceAll('\n', '\r\n'),
  );
  assert.deepEqual(
    result.map(record => record.command),
    ['stopApp', 'launchApp', 'pressKey'],
  );
  assert.equal(result[1].stopApp, true);
  assert.equal(
    result[0].node,
    'commands[0].repeat.commands[0].retry.commands[0]',
  );
  assert.equal(
    result[1].node,
    'commands[0].repeat.commands[0].retry.commands[1]',
  );
});

test('unsupported or ambiguous forms fail instead of silently losing boundaries', () => {
  for (const body of [
    '- launchApp: {stopApp: false}',
    '- launchApp:\n    stopApp: "${SYNTHETIC}"',
    '- launchApp:\n    stopApp: true\n    stopApp: false',
    '- runFlow:\n    commands: [stopApp, launchApp]',
    '- launchApp\n    stopApp: false',
  ]) {
    assert.throws(() => captureLifecycle(`appId: synthetic\n---\n${body}\n`));
  }
  assert.throws(
    () => captureLifecycle('- stopApp'),
    /missing-command-document/,
  );
});

const flow = Buffer.from(
  'appId: synthetic\n---\n- stopApp\n- launchApp:\n    stopApp: false\n',
);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function syntheticInventory() {
  const entry = {
    flow: 'flow.yaml',
    flowSha256: sha256(flow),
    lifecycle: [{ command: 'stopApp', line: 5 }],
    apis: [31, 36],
    assertions: [
      {
        assertionId: 'synthetic',
        statusByApi: { 31: 'missing', 36: 'missing' },
      },
    ],
    evidence: null,
  };
  return {
    schemaVersion: 1,
    source: { originalInputFingerprint: 'frozen-source' },
    authority: [{ path: 'synthetic-registry', sha256: 'frozen-registry' }],
    workspace: [{ ...entry, claimId: 'W01' }],
    stagedSequences: [
      {
        steps: [
          { kind: 'hook', hook: 'synthetic-mutation' },
          { ...entry, kind: 'flow', claimId: 'P01' },
        ],
      },
    ],
    documentedDeviations: ['pre-existing documented deviation'],
  };
}

function withoutLifecycle(inventory) {
  const result = structuredClone(inventory);
  delete result.lifecycleCorrection;
  for (const entry of [
    ...result.workspace,
    ...result.stagedSequences.flatMap(sequence =>
      sequence.steps.filter(step => step.kind === 'flow'),
    ),
  ]) {
    delete entry.lifecycle;
  }
  return result;
}

test('metadata correction preserves all non-lifecycle claims and frozen identities', async () => {
  const inventory = syntheticInventory();
  const before = structuredClone(inventory);
  const result = await correctLifecycleInventory(inventory, async () => flow);
  assert.deepEqual(inventory, before);
  assert.deepEqual(withoutLifecycle(result), withoutLifecycle(before));
  assert.deepEqual(
    result.workspace[0].lifecycle.map(record => record.command),
    ['stopApp', 'launchApp'],
  );
  assert.equal(result.stagedSequences[0].steps[1].lifecycle[1].stopApp, false);
  await assert.rejects(
    correctLifecycleInventory(inventory, async () =>
      Buffer.from('changed-source'),
    ),
    /frozen-flow-identity-mismatch/,
  );
});

test('current and retained snapshot correction preserve immutable private lineage', async t => {
  // No devices, SDK, services, ignored repository evidence or host tool calls.
  for (const identity of ['current', 'snapshot']) {
    const directory = await mkdtemp(join(tmpdir(), `acceptance-${identity}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await writeFile(join(directory, 'flow.yaml'), flow, {
      flag: 'wx',
      mode: 0o600,
    });
    const path = join(directory, 'acceptance-before.json');
    const original = `${JSON.stringify(syntheticInventory(), null, 2)}\n`;
    await writeFile(path, original, { flag: 'wx', mode: 0o600 });
    const result = await retainLifecycleCorrection(path, directory);
    assert.equal(
      await readFile(
        join(directory, result.lifecycleCorrection.prior.file),
        'utf8',
      ),
      original,
    );
    assert.equal(result.lifecycleCorrection.prior.sha256, sha256(original));
    const canonical = await readFile(path);
    assert.deepEqual(
      canonical,
      await readFile(join(directory, result.lifecycleCorrection.current)),
    );
    assert.deepEqual(
      withoutLifecycle(result),
      withoutLifecycle(JSON.parse(original)),
    );
    assert.equal((await lstat(path)).mode % 0o1000, 0o600);
    await assert.rejects(
      retainLifecycleCorrection(path, directory),
      /lifecycle-already-corrected/,
    );
    assert.deepEqual(await readFile(path), canonical);
  }
});

test('existing correction records and mismatched source never get overwritten', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'acceptance-collision-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'acceptance-before.json');
  const original = JSON.stringify(syntheticInventory());
  await writeFile(path, original, { flag: 'wx', mode: 0o600 });
  await writeFile(join(directory, 'flow.yaml'), 'changed-source', {
    flag: 'wx',
    mode: 0o600,
  });
  await assert.rejects(
    retainLifecycleCorrection(path, directory),
    /frozen-flow-identity-mismatch/,
  );
  assert.equal(await readFile(path, 'utf8'), original);
  await writeFile(join(directory, 'flow.yaml'), flow);
  const prior = join(directory, 'acceptance-before.lifecycle-v1.json');
  await writeFile(prior, 'prior-result', { flag: 'wx', mode: 0o600 });
  await assert.rejects(retainLifecycleCorrection(path, directory), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(path, 'utf8'), original);
  assert.equal(await readFile(prior, 'utf8'), 'prior-result');
});
