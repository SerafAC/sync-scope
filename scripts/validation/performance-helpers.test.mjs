// Feature 008, US1 (T029): the field replacement contract of
// validation/maestro/subflows/fill-field.yaml, executed against an injected
// Android EditText model rather than a device (research R11,
// contracts/acceptance.md › Helper and progress proof additions).
//
// The model follows the documented platform behaviour the helper relies on:
//   - a tap focuses the field, collapses any selection and puts the cursor
//     where the tap lands (a fixed x position, so a shorter text puts the
//     cursor at its end);
//   - each erased character is one DEL key: it deletes the selection if there
//     is one, otherwise the character before the cursor;
//   - typing replaces the selection, otherwise inserts at the cursor;
//   - a long press on text selects the word under it (on a password field it
//     selects all, Editor.selectCurrentWord) and a long press past the end of
//     the text starts insertion mode at the end; the floating toolbar offers
//     "Select all" only when the device has it, the field is not a password
//     field (TextView.canSelectAllText) and not everything is selected;
//   - the reported text of an empty field may be its hint, and a password
//     field reports only a masked value;
//   - a long press on a field that already has focus but whose keyboard was
//     hidden selects without raising the keyboard again, and hideKeyboard
//     with no keyboard open acts as Back and leaves the form (T035 probe
//     probe-16750254b967e123f2e77584: the candidate's read-back then found
//     no field). A tap always raises the keyboard;
//   - the form resizes above a raised keyboard and does not scroll the
//     focused field into view, so a field the keyboard just covered is not
//     found until the helper scrolls to it again (T035 probe
//     probe-0051ff5aac4d3e4e9ea84a2d: a long press right after the tap
//     found no empty remote root);
//   - a single-line field shows about VISIBLE characters around its cursor,
//     so a tap at its right edge (`point` x >= 90%) puts the cursor at most
//     VISIBLE characters past the start of what is shown; "Select all" is
//     not always offered (probe-ebf4848760deff256c576c69, API 36: three long
//     presses on a long root offered none and erasing from the middle left
//     the tail).
// Device profiles stand for the per-API runtime behaviour that T035 probes.
// A secure value is never read back: it is proven by synthetic
// authentication against the model, never by printing it.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  executeFile,
  FlowFailure,
  parseFlow,
  UnsupportedFlow,
  execute,
} from './maestro-model.test-support.mjs';

// SYNCSCOPE_FILL_FIELD_HELPER runs the same contract against a candidate
// helper (the T035 probe's candidate-fill-field.yaml) before T036 adopts it.
const helperPath = process.env.SYNCSCOPE_FILL_FIELD_HELPER || fileURLToPath(
  new URL('../../validation/maestro/subflows/fill-field.yaml', import.meta.url),
);
const helperSource = readFileSync(helperPath, 'utf8');

const WORD = /[\p{L}\p{N}_]/u;
const VISIBLE = 32;
const MASK = '•';

/** One Repository-form field and the device behaviour around it. */
export class FieldDevice {
  constructor({ field, profile }) {
    this.profile = {
      selectAll: true,
      emptyText: 'empty', // or 'hint'
      secureText: 'masked', // or 'empty'
      ...profile,
    };
    this.field = {
      id: 'repository.host',
      value: '',
      secure: false,
      numeric: false,
      placeholder: '',
      landing: 'middle', // start | middle | end | past-end
      selection: null, // [start, end] when the field starts partially selected
      focused: false, // true: focused, cursor at the touch, keyboard hidden
      ...field,
    };
    const length = this.field.value.length;
    // Where a touch lands, as a character offset; fixed for the whole run.
    this.touch = {
      start: 0,
      middle: Math.floor(length / 2),
      end: length,
      'past-end': Number.POSITIVE_INFINITY,
    }[this.field.landing];
    this.focused = Boolean(this.field.selection || this.field.focused);
    const cursor = Math.min(this.touch, length);
    this.selection = this.field.selection
      ? [...this.field.selection]
      : this.field.focused ? [cursor, cursor] : [length, length];
    this.keyboard = Boolean(this.field.selection);
    this.onForm = true;
    this.covered = false;
    this.toolbar = new Set();
    this.counts = { focus: 0, longPress: 0, selectAll: 0, input: 0, erase: 0, hide: 0 };
    this.clock = 0;
  }

  get value() {
    return this.field.value;
  }

  authenticate(candidate) {
    return this.field.secure && this.field.value === candidate;
  }

  reported() {
    const { value, secure, placeholder } = this.field;
    if (!value) {
      return this.profile.emptyText === 'hint' ? placeholder : '';
    }
    if (secure) {
      return this.profile.secureText === 'masked' ? MASK.repeat(value.length) : '';
    }
    return value;
  }

  find(selector) {
    if (!this.onForm) {
      return null;
    }
    if (selector.id !== undefined) {
      if (selector.id !== this.field.id || this.covered) {
        return null;
      }
      if (selector.text !== undefined && !matches(selector.text, this.reported())) {
        return null;
      }
      return { id: this.field.id, kind: 'field' };
    }
    if (selector.text !== undefined) {
      for (const item of this.toolbar) {
        if (matches(selector.text, item)) {
          return { text: item, kind: 'toolbar' };
        }
      }
    }
    return null;
  }

  focus() {
    if (!this.focused) {
      this.counts.focus++;
    }
    this.focused = true;
    this.keyboard = true;
  }

  tap(element, selector = {}) {
    if (element.kind === 'toolbar') {
      if (element.text !== 'Select all') {
        throw new FlowFailure(`unexpected toolbar tap ${element.text}`);
      }
      this.counts.selectAll++;
      this.selection = [0, this.value.length];
      this.toolbar = new Set();
      return;
    }
    this.counts.focus++;
    this.focused = true;
    const shownFrom = this.keyboard ? Math.max(0, this.selection[0] - VISIBLE) : 0;
    this.raiseKeyboard();
    const x = Number.parseFloat(String(selector.point ?? '').split(',')[0]);
    const cursor = x >= 90
      ? Math.min(this.value.length, shownFrom + VISIBLE)
      : Math.min(this.touch, this.value.length);
    this.selection = [cursor, cursor];
    this.toolbar = new Set();
  }

  longPress(element) {
    if (element.kind !== 'field') {
      throw new FlowFailure('long press outside the field');
    }
    this.counts.longPress++;
    if (!this.focused) {
      this.counts.focus++;
    }
    // Focusing an unfocused field raises the keyboard; a field that kept
    // focus after hideKeyboard did not get it back from a long press, except
    // a password field (probe-f3af5beb934f2f5a4f008fbe): not to be relied on.
    if (!this.focused || this.field.secure) {
      this.raiseKeyboard();
    }
    this.focused = true;
    const { value } = this;
    const length = value.length;
    this.toolbar = new Set(['Paste']);
    if (!length || this.touch >= length) {
      this.selection = [length, length];
    } else if (this.field.secure) {
      this.selection = [0, length];
    } else {
      let start = this.touch;
      let end = this.touch + 1;
      if (WORD.test(value[this.touch])) {
        while (start > 0 && WORD.test(value[start - 1])) {
          start--;
        }
        while (end < length && WORD.test(value[end])) {
          end++;
        }
      }
      this.selection = [start, end];
    }
    const all = this.selection[0] === 0 && this.selection[1] === length;
    if (this.profile.selectAll && !this.field.secure && length && !all) {
      this.toolbar.add('Select all');
    }
  }

  requireFocus(command) {
    if (!this.focused) {
      throw new FlowFailure(`${command} without a focused field`);
    }
  }

  eraseText(count) {
    this.requireFocus('eraseText');
    this.counts.erase++;
    this.toolbar = new Set();
    for (let i = 0; i < count; i++) {
      const [start, end] = this.selection;
      if (start !== end) {
        this.field.value = this.value.slice(0, start) + this.value.slice(end);
        this.selection = [start, start];
      } else if (start > 0) {
        this.field.value = this.value.slice(0, start - 1) + this.value.slice(start);
        this.selection = [start - 1, start - 1];
      }
    }
  }

  inputText(text) {
    this.requireFocus('inputText');
    this.counts.input++;
    this.toolbar = new Set();
    const typed = this.field.numeric ? text.replace(/\D/g, '') : text;
    const [start, end] = this.selection;
    this.field.value = this.value.slice(0, start) + typed + this.value.slice(end);
    this.selection = [start + typed.length, start + typed.length];
  }

  raiseKeyboard() {
    if (!this.keyboard) {
      this.covered = true; // The worst case: the keyboard now hides the field.
    }
    this.keyboard = true;
  }

  scroll() {
    this.covered = false;
  }

  hideKeyboard() {
    this.counts.hide++;
    if (!this.keyboard) {
      this.onForm = false; // Back: the Repository form is gone.
    }
    this.keyboard = false;
    this.covered = false;
    this.toolbar = new Set();
  }

  pressKey(key) {
    throw new UnsupportedFlow(`the field model has no ${key} key`);
  }

  copyText() {
    return this.reported();
  }

  advance(ms) {
    this.clock += ms;
  }
}

function matches(pattern, value) {
  if (pattern === value) {
    return true;
  }
  try {
    return new RegExp(`^(?:${pattern})$`, 's').test(value);
  } catch {
    return false;
  }
}

const LONG_ROOT = `/srv/fixtures/${'deep-folder/'.repeat(12)}photos`; // > 128
const OLD_LONG_ROOT = `/srv/old/${'previous-archive/'.repeat(9)}x`; // > 128
assert.ok(LONG_ROOT.length > 128 && OLD_LONG_ROOT.length > 128);
const SECRET = 'synthetic-credential-7f3a';

const host = { id: 'repository.host', placeholder: 'nas.local or https://nas.local/dav' };
const port = { id: 'repository.port', numeric: true, placeholder: '21' };
const user = { id: 'repository.username' };
const password = { id: 'repository.password', secure: true };
const root = { id: 'repository.remoteRoots.0', placeholder: '/photos' };

// The real-form matrix (spec edge cases, SC-004): empty, prefilled, secure,
// numeric, cursor start/middle/end, a partial selection and roots longer than
// the old helper's 128-character erase.
const landings = ['start', 'middle', 'end', 'past-end'];
const matrix = [
  { name: 'empty host', field: { ...host }, text: '10.0.2.2' },
  { name: 'empty root, long text', field: { ...root }, text: LONG_ROOT },
  ...landings.map(landing => ({
    name: `prefilled host, cursor ${landing}`,
    field: { ...host, value: 'old.example.com', landing },
    text: '10.0.2.2',
  })),
  ...landings.map(landing => ({
    name: `prefilled numeric port, cursor ${landing}`,
    field: { ...port, value: '2121', landing },
    text: '32120',
  })),
  ...landings.map(landing => ({
    name: `prefilled multi-word root, cursor ${landing}`,
    field: { ...root, value: '/srv/fixtures/scan/clean', landing },
    text: '/srv/fixtures/gallery',
  })),
  ...landings.map(landing => ({
    name: `root longer than 128 characters, cursor ${landing}`,
    field: { ...root, value: OLD_LONG_ROOT, landing },
    text: '/srv/fixtures/gallery',
  })),
  ...landings.map(landing => ({
    name: `long root replaced by a long root, cursor ${landing}`,
    field: { ...root, value: OLD_LONG_ROOT, landing },
    text: LONG_ROOT,
  })),
  {
    name: 'partially selected user name',
    field: { ...user, value: 'previous-user', selection: [2, 6], landing: 'middle' },
    text: 'synthetic',
  },
  { name: 'empty password', field: { ...password }, text: SECRET },
  ...['start', 'middle'].map(landing => ({
    name: `prefilled password, touch on the text (${landing})`,
    field: { ...password, value: 'old-password', landing },
    text: SECRET,
  })),
];

// Profiles every ordinary path must handle: an empty field reporting nothing
// or its hint. Both have the contextual Select all action.
const profiles = [
  { name: 'empty field reports nothing', profile: {} },
  { name: 'empty field reports its hint', profile: { emptyText: 'hint' } },
];

function fill(entry, profile) {
  const device = new FieldDevice({ field: structuredClone(entry.field), profile });
  let error = null;
  let result = null;
  try {
    result = executeFile(helperPath, {
      device,
      env: { FIELD: entry.field.id, TEXT: entry.text },
    });
  } catch (caught) {
    if (caught instanceof UnsupportedFlow) {
      throw caught;
    }
    error = caught;
  }
  return { device, error, result };
}

function proven(entry, device) {
  return entry.field.secure ? device.authenticate(entry.text) : device.value === entry.text;
}

test('the field model follows the platform editing rules it stands for', () => {
  const device = new FieldDevice({
    field: { ...root, value: '/srv/fixtures/scan/clean', landing: 'middle' },
  });
  device.longPress({ kind: 'field' });
  assert.deepEqual(device.selection, [5, 13]); // the word "fixtures"
  assert.ok(device.find({ text: 'Select all' }));
  device.tap(device.find({ text: 'Select all' }));
  device.inputText('/x');
  assert.equal(device.value, '/x');

  const secure = new FieldDevice({ field: { ...password, value: 'abc def', landing: 'start' } });
  secure.longPress({ kind: 'field' });
  assert.deepEqual(secure.selection, [0, 7]); // a password long press selects all
  assert.equal(secure.find({ text: 'Select all' }), null); // canSelectAllText is false
  assert.equal(secure.copyText(), MASK.repeat(7));

  const erase = new FieldDevice({ field: { ...host, value: 'abcdef', landing: 'middle' } });
  erase.tap({ kind: 'field' });
  erase.eraseText(128);
  assert.equal(erase.value, 'def'); // DEL only deletes before the cursor
  assert.equal(new FieldDevice({ field: host, profile: { emptyText: 'hint' } }).copyText(), host.placeholder);
});

test('the model refuses commands the pinned driver does not have', () => {
  const device = new FieldDevice({ field: { ...host, value: 'old' } });
  for (const commands of [
    [{ eraseText: { all: true } }],
    [{ inputText: { text: 'x', replace: true } }],
    [{ pressKey: 'Ctrl+A' }],
    [{ pressKey: 'End' }],
    [{ pressKey: 'Move End' }],
  ]) {
    assert.throws(() => execute(commands, { device }), UnsupportedFlow);
  }
});

test('the helper uses only pinned Maestro commands and never optional steps', () => {
  parseFlow(helperSource); // parses with the strict subset
  assert.doesNotMatch(helperSource, /^\s*(?:-\s+)?optional:\s*true/m);
  assert.doesNotMatch(helperSource, /eraseText:\s*\n\s+all:/);
  assert.doesNotMatch(helperSource, /pressKey:\s*["']?(?:Ctrl|End|Move|Select)/i);
  assert.doesNotMatch(helperSource, /replace:\s*true/);
  // probe-1a19a3b5b6168451703cd741: the pinned driver ran a `repeat` with a
  // script `while` only once, so residue passes are conditional runFlows.
  for (const source of [helperSource, readFileSync(new URL('../../validation/maestro/subflows/fill-field-pass.yaml', import.meta.url), 'utf8')]) {
    assert.doesNotMatch(source, /^\s*while:/m);
  }
});

for (const { name: profileName, profile } of profiles) {
  for (const entry of matrix) {
    test(`replaces the value exactly: ${entry.name} (${profileName})`, () => {
      const { device, error } = fill(entry, profile);
      assert.equal(error, null, `the helper failed: ${error?.message}`);
      if (entry.field.secure) {
        assert.ok(device.authenticate(entry.text), 'synthetic authentication must succeed');
      } else {
        assert.equal(device.value, entry.text);
      }
      assert.equal(device.keyboard, false, 'callers expect the keyboard hidden');
    });
  }
}

test('a field left focused with its keyboard hidden is replaced without leaving the form', () => {
  // The callers' state before most real-form calls (a tap, then hideKeyboard,
  // or a previous helper call on the same field): probe-16750254b967e123f2e77584
  // failed here because a long press did not raise the keyboard and the
  // helper's hideKeyboard went Back.
  for (const { profile } of profiles) {
    for (const entry of matrix.filter(item => !item.field.selection)) {
      const focused = { ...entry, field: { ...entry.field, focused: true } };
      const { device, error } = fill(focused, profile);
      assert.equal(error, null, `${entry.name} ${JSON.stringify(profile)}: ${error?.message}`);
      assert.ok(device.onForm, `${entry.name}: the helper left the form`);
      assert.ok(proven(entry, device), `${entry.name}: wrong value`);
      assert.equal(device.keyboard, false, `${entry.name}: keyboard left open`);
    }
  }
});

test('without Select all an ordinary value is still replaced exactly', () => {
  // probe-ebf4848760deff256c576c69 (API 36): no Select all after the retries;
  // erasing the measured length from a cursor in the middle left the tail.
  for (const { profile } of profiles) {
    for (const entry of matrix.filter(item => !item.field.secure)) {
      for (const focused of [false, true]) {
        const field = { ...entry.field, ...(entry.field.selection ? {} : { focused }) };
        const { device, error } = fill({ ...entry, field }, { ...profile, selectAll: false });
        assert.equal(error, null, `${entry.name} focused=${focused} ${JSON.stringify(profile)}: ${error?.message}`);
        assert.equal(device.value, entry.text, entry.name);
        assert.equal(device.keyboard, false, entry.name);
      }
    }
  }
});

test('a wrong value is never reported as success, even without Select all', () => {
  // A device without the contextual action, and a password touched past its
  // end (insertion mode, no select-all), must yield the exact value or fail.
  const cases = [
    ...matrix.map(entry => ({ entry, profile: { selectAll: false } })),
    ...matrix.map(entry => ({ entry, profile: { emptyText: 'hint' } })),
    {
      entry: {
        name: 'prefilled password touched past its end',
        field: { ...password, value: 'old-password', landing: 'past-end' },
        text: SECRET,
      },
      profile: {},
    },
  ];
  for (const { entry, profile } of cases) {
    const { device, error } = fill(entry, profile);
    if (!error) {
      assert.ok(proven(entry, device), `${entry.name}: silent wrong value ${JSON.stringify(profile)}`);
    }
  }
});

test('the resulting ordinary value is asserted, unconditionally, by the helper', () => {
  // Sabotage the device so typing drops the last character: the helper's own
  // mandatory value assertion has to catch it.
  for (const entry of matrix.filter(item => !item.field.secure)) {
    const device = new FieldDevice({ field: structuredClone(entry.field) });
    const input = device.inputText.bind(device);
    device.inputText = text => input(text.slice(0, -1));
    assert.throws(
      () => executeFile(helperPath, { device, env: { FIELD: entry.field.id, TEXT: entry.text } }),
      FlowFailure,
      entry.name,
    );
  }
});

test('a secure value is proven by authentication, never read back or asserted in clear', () => {
  for (const entry of matrix.filter(item => item.field.secure)) {
    const { device, error, result } = fill(entry, {});
    assert.equal(error, null, entry.name);
    assert.ok(device.authenticate(entry.text));
    for (const record of result.transcript) {
      if (record.command === 'inputText') {
        continue; // Typing it is the point; the runner keeps credentials out of logs.
      }
      assert.doesNotMatch(JSON.stringify(record), new RegExp(SECRET), record.command);
    }
  }
});

// T036 adopts the one-focus/single-hide path only where the device supports
// it. The T035 probes (field-selection.md) found it unsupported on the real
// emulators (no reliable Select all, keyboard state after a long press not
// fixed), so the helper is the original's tap/erase order made correct, with
// no speed claim. What stays required: one typed replacement, the keyboard
// hidden only after a tap raised it (never Back), hidden at the end, and a
// bounded number of touches.
test('one typed replacement; the keyboard is hidden only after a tap raised it', () => {
  for (const entry of matrix) {
    for (const { profile } of [...profiles, { profile: { selectAll: false } }]) {
      const { device, error } = fill(entry, profile);
      assert.equal(error, null, entry.name);
      assert.equal(device.counts.input, 1, `${entry.name}: typed replacements`);
      assert.ok(device.onForm, `${entry.name}: a hide acted as Back`);
      assert.equal(device.keyboard, false, `${entry.name}: keyboard left up`);
      assert.ok(device.counts.hide <= 9 && device.counts.focus <= 9, `${entry.name}: unbounded touches`);
      assert.equal(device.counts.longPress, 0, `${entry.name}: no long press without a usable Select all`);
    }
  }
});
