// Feature 008, US1 (T031): the scan start/terminal contract of
// validation/maestro/subflows/start-scan.yaml (contracts/acceptance.md ›
// Helper and progress proof additions, US1.4, FR-006), executed against
// synthetic Scan-tab observations instead of a device.
//
// For running-state callers: progress visible -> expected terminal outcome ->
// progress absent. For genuinely fast scans: a new run (its generation) and
// its terminal outcome. "Scan progress" disappearing, or never appearing, is
// not evidence that a run started; required progress never becomes optional.
//
// The synthetic tab mirrors ScanScreen.tsx: the progress card is labelled
// "Scan progress" while a run is in progress, and the Last scan block shows
// "Generation <n>" and "Completed <time>" / "Ended <time>"; failed runs add
// "Scan failed", cancelled ones "Cancelled" or "Cancelled (app left)".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  executeFile,
  FlowFailure,
  textMatches,
  UnsupportedFlow,
  walkFlow,
} from './maestro-model.test-support.mjs';

const maestro = new URL('../../validation/maestro/', import.meta.url);
const helperPath = fileURLToPath(new URL('subflows/start-scan.yaml', maestro));
const DESCRIPTION = 'Checks every file in your folders against the backup.';

/**
 * A Scan tab on a virtual clock. `run` describes what tapping the button
 * does: null (the run never starts), or {startMs, durationMs, terminal}, where
 * terminal is COMPLETED, FAILED, CANCELLED or BACKGROUNDED.
 */
export class ScanDevice {
  constructor({ previous = null, run = null } = {}) {
    this.clock = 0;
    this.generation = previous ? previous.generation : 0;
    this.last = previous; // {generation, terminal}
    this.plan = run;
    this.active = null;
    this.progressSeen = false;
  }

  update() {
    const active = this.active;
    if (!active) {
      return;
    }
    if (!active.started && this.clock >= active.startAt) {
      active.started = true;
      this.generation += 1;
      active.generation = this.generation;
      this.last = { generation: this.generation, terminal: null };
    }
    if (active.started && this.clock >= active.startAt + active.durationMs) {
      this.last = { generation: active.generation, terminal: active.terminal };
      this.active = null;
    }
  }

  running() {
    return Boolean(this.active?.started);
  }

  texts() {
    this.update();
    const texts = ['Scan', 'Rescan from scratch', DESCRIPTION, 'Files', 'Settings'];
    if (this.running()) {
      texts.push('Scan progress', 'Cancel scan');
    }
    if (this.last) {
      texts.push(`Generation ${this.last.generation}`);
      const terminal = this.last.terminal;
      if (terminal === null) {
        texts.push('In progress');
      } else {
        texts.push(`${terminal === 'COMPLETED' ? 'Completed' : 'Ended'} 1 Jan 2024, 10:00`);
      }
      if (terminal === 'FAILED') {
        texts.push('Scan failed');
      } else if (terminal === 'CANCELLED') {
        texts.push('Cancelled');
      } else if (terminal === 'BACKGROUNDED') {
        texts.push('Cancelled (app left)');
      }
    }
    return texts;
  }

  find(selector) {
    if (selector.id !== undefined) {
      return null;
    }
    const text = this.texts().find(item => textMatches(selector.text, item));
    if (text === 'Scan progress') {
      this.progressSeen = true;
    }
    return text === undefined ? null : { text };
  }

  tap(element) {
    if (element.text === 'Scan' || element.text === 'Rescan from scratch') {
      if (this.plan && !this.active) {
        this.active = {
          startAt: this.clock + (this.plan.startMs ?? 0),
          durationMs: this.plan.durationMs ?? 0,
          terminal: this.plan.terminal ?? 'COMPLETED',
          started: false,
        };
        this.plan = null;
        this.update();
      }
      return;
    }
    throw new FlowFailure(`unexpected tap on ${element.text}`);
  }

  copyText(element) {
    return element.text;
  }

  advance(ms) {
    this.clock += ms;
    this.update();
  }

  longPress() {
    throw new UnsupportedFlow('no long press on the Scan tab');
  }

  eraseText() {
    throw new UnsupportedFlow('no text field on the Scan tab');
  }

  inputText() {
    throw new UnsupportedFlow('no text field on the Scan tab');
  }

  hideKeyboard() {}

  pressKey(key) {
    throw new UnsupportedFlow(`pressKey ${key} is the caller's business`);
  }
}

function startScan(device, env = {}) {
  try {
    const result = executeFile(helperPath, { device, env });
    return { error: null, result };
  } catch (error) {
    if (error instanceof UnsupportedFlow) {
      throw error;
    }
    return { error, result: null };
  }
}

const completedBefore = { generation: 3, terminal: 'COMPLETED' };
const quick = terminal => ({ startMs: 0, durationMs: 0, terminal });
const slow = terminal => ({ startMs: 300, durationMs: 30000, terminal });

test('the synthetic Scan tab follows ScanScreen.tsx', () => {
  const device = new ScanDevice({ previous: completedBefore, run: slow('CANCELLED') });
  assert.ok(device.find({ text: 'Generation 3' }));
  device.tap({ text: 'Scan' });
  device.advance(500);
  assert.ok(device.find({ text: 'Scan progress' }));
  assert.ok(device.find({ text: 'Generation 4' }));
  device.advance(30000);
  assert.equal(device.find({ text: 'Scan progress' }), null);
  assert.ok(device.find({ text: 'Cancelled' }));
  assert.ok(device.find({ text: 'Ended .+' }));
});

for (const [name, previous] of [
  ['first scan', null],
  ['after an earlier completed scan', completedBefore],
]) {
  test(`a scan that never starts fails, not passes (${name})`, () => {
    for (const env of [{}, { PROGRESS: 'required' }, { BUTTON: 'Rescan from scratch' }]) {
      const device = new ScanDevice({ previous, run: null });
      const { error } = startScan(device, env);
      assert.ok(error instanceof FlowFailure, `${JSON.stringify(env)}: never-started scan passed`);
    }
  });

  for (const terminal of ['COMPLETED', 'FAILED', 'CANCELLED', 'BACKGROUNDED']) {
    test(`a fast ${terminal.toLowerCase()} scan is established by its new generation (${name})`, () => {
      const device = new ScanDevice({ previous, run: quick(terminal) });
      const before = device.generation;
      const { error } = startScan(device);
      assert.equal(error, null, error?.message);
      assert.equal(device.generation, before + 1);
      assert.equal(device.last.terminal, terminal, 'the helper returns once the run has ended');
    });

    test(`a slow ${terminal.toLowerCase()} scan shows progress, then ends (${name})`, () => {
      for (const env of [{}, { PROGRESS: 'required' }]) {
        const device = new ScanDevice({ previous, run: slow(terminal) });
        const { error } = startScan(device, env);
        assert.equal(error, null, `${JSON.stringify(env)}: ${error?.message}`);
        if (env.PROGRESS === 'required') {
          assert.ok(device.progressSeen, 'the running state was observed');
        }
        assert.equal(device.running(), false, 'progress is absent when the helper returns');
        assert.equal(device.last.terminal, terminal);
      }
    });
  }

  test(`required progress cannot be satisfied by a run that was never seen running (${name})`, () => {
    for (const terminal of ['COMPLETED', 'FAILED']) {
      const device = new ScanDevice({ previous, run: quick(terminal) });
      const { error } = startScan(device, { PROGRESS: 'required' });
      assert.ok(error instanceof FlowFailure, `${terminal}: required progress became optional`);
    }
  });
}

test('disappearance of a stale progress card cannot establish a new run', () => {
  // A previous run is still finishing when the button is tapped and the tap
  // starts nothing: the card disappearing proves nothing about a new run.
  const device = new ScanDevice({ previous: completedBefore, run: null });
  device.active = { startAt: 0, durationMs: 2000, terminal: 'COMPLETED', started: false };
  device.update();
  const { error } = startScan(device);
  assert.ok(error instanceof FlowFailure, 'a stale run ending was taken for the requested scan');
});

test('the required-progress wait in start-scan.yaml is never optional', () => {
  const required = [...walkFlow(helperPath)].filter(
    record =>
      record.command === 'extendedWaitUntil' &&
      record.conditional &&
      JSON.stringify(record.value).includes('Scan progress') &&
      record.value.visible !== undefined,
  );
  assert.ok(required.length > 0);
  // Every visible-progress wait reachable when PROGRESS=required is mandatory.
  const device = new ScanDevice({ previous: null, run: slow('COMPLETED') });
  const { result, error } = startScan(device, { PROGRESS: 'required' });
  assert.equal(error, null);
  const waits = result.transcript.filter(
    record => record.command === 'extendedWaitUntil' && record.args?.present &&
      record.args.target.text === 'Scan progress',
  );
  assert.ok(waits.length > 0);
  assert.ok(waits.every(record => !record.args.optional));
});

test('running-state callers keep requiring visible progress', () => {
  const callers = [
    'scan/01-clean-scan-ftp.yaml',
    'scan/01-clean-scan-sftp.yaml',
    'scan/01-clean-scan-webdav.yaml',
    'scan/05-background-discards.yaml',
  ];
  for (const caller of callers) {
    const path = fileURLToPath(new URL(caller, maestro));
    const source = readFileSync(path, 'utf8');
    const records = [...walkFlow(path)];
    const starts = records.filter(
      record => record.command === 'runFlow' && JSON.stringify(record.value).includes('start-scan.yaml'),
    );
    assert.ok(starts.length > 0, caller);
    const inlineProgress = records.some(
      record =>
        record.command === 'extendedWaitUntil' &&
        record.file === path &&
        !record.conditional &&
        record.value.visible === 'Scan progress' &&
        record.value.optional !== true,
    );
    assert.ok(
      starts.some(record => record.value?.env?.PROGRESS === 'required') || inlineProgress,
      `${caller} must require visible progress`,
    );
    for (const record of records) {
      if (
        record.command === 'extendedWaitUntil' &&
        record.file === path &&
        String(record.value.visible ?? '').includes('Scan progress')
      ) {
        assert.notEqual(record.value.optional, true, `${caller}: optional progress wait`);
      }
    }
    assert.doesNotMatch(source, /sleep|waitForAnimationToEnd:\s*\n\s+timeout:\s*[1-9]\d{4,}/);
  }
});
