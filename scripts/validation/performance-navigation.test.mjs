// Feature 008, US1 (T030): launch and navigation are separate contracts
// (contracts/acceptance.md › Helper and progress proof additions, US1.3).
//
// Navigation-only helpers must never launch, stop or reset the app. Every
// caller that needs MainActivity back (after stopApp, after a debug seam
// Activity, after the grant-release seam, after Home) launches it explicitly
// before navigating, and a caller whose app is already open does not launch a
// second time. Staged continuation parts never launch: their state lives only
// in the running process.
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { commandParts, parseFlow, walkFlow } from './maestro-model.test-support.mjs';

const maestro = fileURLToPath(new URL('../../validation/maestro/', import.meta.url));
const NAVIGATION = ['open-sources.yaml', 'open-scan.yaml', 'open-files.yaml'];
const LIFECYCLE = new Set(['launchApp', 'stopApp', 'clearState']);
const flowDirectories = ['sources', 'scan', 'browse', 'mvp', 'polish', 'staged', 'performance'];

function flows() {
  return flowDirectories.flatMap(directory => {
    let names = [];
    try {
      names = readdirSync(join(maestro, directory));
    } catch {
      return [];
    }
    return names.filter(name => name.endsWith('.yaml')).map(name => join(maestro, directory, name));
  });
}

const name = path => relative(maestro, path);

function launchOptions(value) {
  return value && typeof value === 'object' ? value : {};
}

/** The lifecycle and navigation events of one flow, subflows inlined. */
export function events(path) {
  const result = [];
  for (const record of walkFlow(path)) {
    const { command, value } = record;
    if (command === 'launchApp') {
      const options = launchOptions(value);
      result.push({
        kind: options.stopApp === false ? 'foreground' : 'launch',
        clearState: options.clearState === true,
        record,
      });
    } else if (command === 'stopApp') {
      result.push({ kind: 'stop', record });
    } else if (command === 'clearState') {
      result.push({ kind: 'clear', record });
    } else if (command === 'openLink' && /^syncscope-debug:\/\//.test(String(value))) {
      result.push({ kind: 'seam', record });
    } else if (command === 'pressKey' && value === 'Home') {
      result.push({ kind: 'home', record });
    } else if (command === 'runFlow') {
      const file = typeof value === 'string' ? value : value.file;
      if (file && NAVIGATION.includes(basename(file))) {
        result.push({ kind: 'navigate', helper: basename(file), record });
      }
    }
  }
  return result;
}

/**
 * Replays the events from an open, ready MainActivity (the workspace and
 * staged parts continue from the previous flow) and returns the violations.
 */
export function violations(sequence) {
  const found = [];
  let state = 'ready';
  // Only navigation since the previous launch: a second launch is redundant.
  let launchedSinceLifecycle = false;
  for (const event of sequence) {
    const where = `${name(event.record.file)} (${event.kind}${event.helper ? ` ${event.helper}` : ''})`;
    if (event.kind !== 'navigate' && event.kind !== 'launch') {
      launchedSinceLifecycle = false;
    }
    switch (event.kind) {
      case 'launch':
        if (launchedSinceLifecycle) {
          found.push(`duplicate launch of an already-open app: ${where}`);
        }
        launchedSinceLifecycle = true;
        state = 'ready';
        break;
      case 'foreground':
        if (state !== 'background') {
          found.push(`foreground launch without a backgrounded app: ${where}`);
        }
        state = 'ready';
        break;
      case 'stop':
        state = 'stopped';
        break;
      case 'clear':
        state = 'stopped';
        break;
      case 'seam':
        state = 'seam';
        break;
      case 'home':
        state = 'background';
        break;
      case 'navigate':
        if (state !== 'ready') {
          found.push(`navigation while the app is ${state}, without an explicit launch: ${where}`);
        }
        break;
      default:
        throw new Error(event.kind);
    }
  }
  return found;
}

const synthetic = text => {
  const commands = parseFlow(`appId: synthetic\n---\n${text}`).commands;
  return commands.map(command => {
    const [command_, value] = commandParts(command);
    const record = { command: command_, value, file: join(maestro, 'synthetic.yaml') };
    if (command_ === 'runFlow') {
      return { kind: 'navigate', helper: basename(value), record };
    }
    if (command_ === 'launchApp') {
      const options = launchOptions(value);
      return {
        kind: options.stopApp === false ? 'foreground' : 'launch',
        clearState: options.clearState === true,
        record,
      };
    }
    return {
      kind: { stopApp: 'stop', openLink: 'seam', pressKey: 'home' }[command_],
      record,
    };
  });
};

test('the replay model accepts explicit launches and rejects implicit ones', () => {
  assert.deepEqual(violations(synthetic('- runFlow: open-sources.yaml\n')), []);
  assert.deepEqual(
    violations(synthetic('- launchApp:\n    clearState: true\n- runFlow: open-sources.yaml\n')),
    [],
  );
  assert.deepEqual(
    violations(synthetic('- stopApp\n- launchApp\n- runFlow: open-sources.yaml\n')),
    [],
  );
  assert.equal(violations(synthetic('- stopApp\n- runFlow: open-sources.yaml\n')).length, 1);
  assert.equal(
    violations(synthetic('- openLink: "syncscope-debug://release-grants"\n- runFlow: open-sources.yaml\n')).length,
    1,
  );
  assert.deepEqual(violations(synthetic('- launchApp\n- runFlow: open-files.yaml\n')), []);
  assert.equal(
    violations(synthetic('- launchApp:\n    clearState: true\n- runFlow: open-sources.yaml\n- launchApp\n')).length,
    1,
  );
  assert.deepEqual(
    violations(synthetic('- pressKey: Home\n- launchApp:\n    stopApp: false\n- runFlow: open-scan.yaml\n')),
    [],
  );
});

test('navigation-only helpers never launch, stop or reset the app', () => {
  for (const helper of NAVIGATION) {
    const lifecycle = [...walkFlow(join(maestro, 'subflows', helper))]
      .filter(record => LIFECYCLE.has(record.command))
      .map(record => `${name(record.file)}: ${record.command}`);
    assert.deepEqual(lifecycle, [], `${helper} must be navigation-only`);
  }
});

test('every flow launches MainActivity explicitly before navigating, and never twice', () => {
  const problems = flows().flatMap(path =>
    violations(events(path)).map(problem => `${name(path)}: ${problem}`));
  assert.deepEqual(problems, []);
});

test('restart and grant-release callers keep their real stop before the explicit launch', () => {
  for (const flow of ['sources/04-restart-persists.yaml', 'sources/05-revoked-unavailable.yaml']) {
    const sequence = events(join(maestro, flow)).map(event => event.kind);
    const stop = sequence.indexOf('stop');
    const navigate = sequence.indexOf('navigate');
    assert.ok(stop >= 0, `${flow} must still stop the app`);
    assert.ok(navigate > stop, `${flow} navigates after the stop`);
    assert.ok(
      sequence.slice(stop, navigate).includes('launch'),
      `${flow} relaunches MainActivity itself, not through a navigation helper`,
    );
  }
  const revoked = events(join(maestro, 'sources/05-revoked-unavailable.yaml')).map(e => e.kind);
  const seam = revoked.indexOf('seam');
  assert.ok(seam >= 0 && seam < revoked.indexOf('navigate'), 'the grant-release seam still runs');
});

test('repository-seam callers return to MainActivity before any navigation', () => {
  const seamCallers = flows().filter(path => events(path).some(event => event.kind === 'seam'));
  assert.ok(seamCallers.length > 0);
  for (const path of seamCallers) {
    const sequence = events(path);
    sequence.forEach((event, index) => {
      if (event.kind !== 'seam') {
        return;
      }
      const next = sequence.slice(index + 1).find(item => item.kind !== 'seam');
      if (next?.kind === 'navigate') {
        assert.fail(`${name(path)} navigates over the seam Activity (${next.helper})`);
      }
    });
  }
});

test('staged continuation parts never reset state, and 08-changed-b never launches', () => {
  const continuations = flows().filter(path => /staged\/\d+-[^/]+-[b-z]\.yaml$/.test(path));
  assert.ok(continuations.length >= 4);
  for (const path of continuations) {
    const resets = [...walkFlow(path)]
      .filter(record => record.command === 'clearState' ||
        (record.command === 'launchApp' && launchOptions(record.value).clearState === true))
      .map(record => `${name(record.file)}: ${record.command}`);
    assert.deepEqual(resets, [], `${name(path)} continues a staged line`);
  }
  // Its confirmation dialog and deletion plan live only in the running process.
  const changed = [...walkFlow(join(maestro, 'staged/08-changed-b.yaml'))]
    .filter(record => LIFECYCLE.has(record.command))
    .map(record => `${name(record.file)}: ${record.command}`);
  assert.deepEqual(changed, [], 'staged/08-changed-b must not launch, stop or reset');
});

test('open-sources proves Settings opened before trusting its loading waits', async () => {
  // T045 (us1-regressions, API 36, polish/08): a swallowed tab tap left the
  // app on Files, where "Loading repository"/"Loading folders" are trivially
  // absent. The selected Settings tab must be required (never optional) after the
  // tap and before those notVisible waits.
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(join(maestro, 'subflows/open-sources.yaml'), 'utf8');
  // Settings keeps its scroll position, so the selected tab is the marker.
  const required = source.indexOf('- extendedWaitUntil:\n    visible:\n      text: "Settings"\n      selected: true');
  assert.ok(required > source.indexOf('- tapOn: "Settings"'), 'Settings marker wait follows the tap');
  assert.ok(required < source.indexOf('notVisible: "Loading repository"'), 'marker precedes the loading waits');
  const top = parseFlow(source).commands.map(c => Object.keys(c)[0] ?? c);
  assert.ok(top.includes('extendedWaitUntil'));
});
