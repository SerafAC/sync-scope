import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('validation/performance/hotspots.json', root), 'utf8'),
);

const expectedFlows = [
  'mvp/02-setup-errors.yaml',
  'mvp/01-setup-sftp.yaml',
  'sources/01-add-internal.yaml',
  'scan/04-reopen-refresh.yaml',
  'scan/01-clean-scan-ftp.yaml',
  'scan/05-background-discards.yaml',
  'browse/01-gallery-thousands.yaml',
  'polish/03-fast-scroll.yaml',
].map(path => `validation/maestro/${path}`);

function canonical(value) {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map(key => [key, canonical(value[key])]),
    );
  }
  return value;
}

test('hotspot definition freezes all eight whole flows and the complete schedule', async () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(manifest.apis, [31, 36]);
  assert.equal(manifest.repetitions, 3);
  assert.deepEqual(manifest.constraints, [
    'repetition count fixed at **3**, APIs fixed at **31 and 36**',
    'All eight scenarios and both APIs must appear.',
  ]);
  assert.deepEqual(
    manifest.scenarios.map(scenario => scenario.scenarioId),
    ['H01', 'H02', 'H03', 'H04', 'H05', 'H06', 'H07', 'H08'],
  );
  assert.deepEqual(
    manifest.scenarios.map(scenario => scenario.flow),
    expectedFlows,
  );
  assert.equal(manifest.scenarios.length * manifest.apis.length * 3 * 2, 96);
  for (const scenario of manifest.scenarios) {
    const flow = await readFile(new URL(scenario.flow, root), 'utf8');
    assert.match(flow, /launchApp:\s*\n\s*clearState: true/);
    assert.equal(scenario.measurementBoundary.kind, 'whole-flow-wall');
    assert.equal(
      scenario.orderedPrerequisites[0].action,
      'restore-independent-fixture-inputs',
    );
    assert.equal(
      scenario.orderedPrerequisites[1].action,
      'supply-workspace-arguments',
    );
    assert.match(scenario.resetPolicy.staged, /never.*between staged/);
  }
  assert.match(manifest.comparisonPolicy.failedSamples, /never replaces/);
});

test('frozen fixtures retain the original generator defaults', async () => {
  const device = await readFile(
    new URL('scripts/validation/device-fixtures.sh', root),
    'utf8',
  );
  const scroll = await readFile(
    new URL('scripts/validation/scroll-manifest.sh', root),
    'utf8',
  );
  assert.equal(
    manifest.fixtureParameters.bulkFiles,
    Number(device.match(/BULK_FILES:-(\d+)/)[1]),
  );
  assert.equal(
    manifest.fixtureParameters.galleryBulkFiles,
    Number(device.match(/GALLERY_BULK_FILES:-(\d+)/)[1]),
  );
  assert.equal(
    manifest.fixtureParameters.bigFiles,
    Number(device.match(/big_files=(\d+)/)[1]),
  );
  assert.equal(
    manifest.fixtureParameters.scrollFiles,
    Number(scroll.match(/SCROLL_COUNT=(\d+)/)[1]),
  );
  assert.equal(
    manifest.fixtureParameters.narrowFiles,
    Number(scroll.match(/NARROW_COUNT=(\d+)/)[1]),
  );
  assert.equal(manifest.scenarios[6].scrollGestures, 15);
});

test('H08 diagnostics cannot replace or inflate the mixed-view sample', () => {
  const scenario = manifest.scenarios[7];
  assert.deepEqual(
    scenario.diagnostics.map(diagnostic => diagnostic.view),
    ['gallery', 'list'],
  );
  assert.ok(
    scenario.diagnostics.every(
      diagnostic => diagnostic.additiveToWholeFlow === false,
    ),
  );
  assert.equal(scenario.measurementBoundary.kind, 'whole-flow-wall');
  assert.equal(manifest.comparisonPolicy.wholeFlowOnly, true);
});

test('definition fingerprint binds prerequisites, fixtures, boundaries and original inputs', async () => {
  const { definitionFingerprint, ...definition } = manifest;
  assert.equal(
    definitionFingerprint,
    createHash('sha256')
      .update(JSON.stringify(canonical(definition)))
      .digest('hex'),
  );
  assert.match(manifest.originalInputs.inputFingerprint, /^[a-f0-9]{64}$/);
  const closure = manifest.originalInputs.closure;
  assert.equal(new Set(closure.map(input => input.path)).size, closure.length);
  for (const input of closure) {
    assert.match(input.sha256, /^[a-f0-9]{64}$/);
    assert.ok(!input.path.startsWith('/') && !input.path.includes('..'));
    await readFile(new URL(input.path, root));
  }
  assert.ok(
    expectedFlows.every(path => closure.some(input => input.path === path)),
  );
  // Frozen digests describe the original code, not an assertion that optimized
  // helper bytes must remain unchanged forever.
});

test('H08 scrollbar reveal does not outwait the 1.5 s thumb fade', async () => {
  // Decision 2026-10-12: under API 31 software rendering the default settle
  // wait after this swipe took 3.32 s, longer than the app's 1.5 s scrollbar
  // fade. Only the swipe's settle wait changes; the assertion stays as is.
  const subflow = await readFile(
    new URL('validation/maestro/subflows/show-scrollbar.yaml', root),
    'utf8',
  );
  const steps = subflow.slice(subflow.indexOf('\n---\n') + 5);
  assert.equal(
    steps,
    [
      '- swipe:',
      '    start: "50%, 60%"',
      '    end: "50%, 58%"',
      '    duration: 800',
      '    waitToSettleTimeoutMs: 50',
      '- assertVisible:',
      '    id: "files.scroller.thumb"',
      '',
    ].join('\n'),
  );
});

test('H08 re-shows the scrollbar when it fades between show and thumb read', async () => {
  // Decision 2026-10-13: in rounding-recovery raw-36-24 the thumb was asserted
  // visible and 2 ms later the next read no longer found it (1.5 s fade).
  // Each show-scrollbar plus its following thumb read retries as one pair, so
  // a fade re-shows the thumb; labels, assertions and timeouts stay as is.
  const flow = await readFile(
    new URL('validation/maestro/polish/03-fast-scroll.yaml', root),
    'utf8',
  );
  const pair = new RegExp(
    [
      '^- retry:',
      '    maxRetries: 2',
      '    commands:',
      '      - runFlow: \\.\\./subflows/show-scrollbar\\.yaml',
      '      - (assertVisible|copyTextFrom):',
      '          id: "files\\.scroller\\.thumb"',
      '(?:          text: (.+)\\n)?(?=- |\\n|$)',
    ].join('\\n'),
    'gm',
  );
  const pairs = [...flow.matchAll(pair)];
  const reveals = flow.match(/show-scrollbar\.yaml/g) ?? [];
  assert.equal(reveals.length, 8);
  assert.equal(pairs.length, reveals.length);
  assert.deepEqual(
    pairs.map(match => [match[1], match[2] ?? null]),
    [
      ['assertVisible', `"\${'Scrollbar, ' + BAND_MONTH_LABEL}"`],
      ['assertVisible', '"Scrollbar, M"'],
      ...Array.from({ length: 6 }, () => ['copyTextFrom', null]),
    ],
  );
  // Besides these eight pairs, only the two bare scroll-then-thumb reads
  // (decision 2026-10-13, retry-recovery raw-31-22) are retried.
  assert.equal((flow.match(/^- retry:/gm) ?? []).length, 10);
  assert.equal((flow.match(/maxRetries/g) ?? []).length, 10);
});

function topLevelSteps(text) {
  const body = text.slice(text.indexOf('\n---\n') + 5);
  const steps = [];
  for (const line of body.split('\n')) {
    if (line.startsWith('- ')) {
      steps.push([line]);
    } else if (steps.length > 0 && line.startsWith(' ')) {
      steps[steps.length - 1].push(line);
    }
  }
  return steps.map(lines => lines.join('\n'));
}

test('H08 reads the scrollbar thumb only inside a retry that redoes its scroll', async () => {
  // Decision 2026-10-13 (retry-recovery raw-31-22): a bare swipe plus thumb
  // read lost the thumb to the 1.5 s fade. Every positive thumb read in the
  // H08 flow, including the read inside show-scrollbar.yaml, sits in a retry
  // with maxRetries 2 whose commands first redo the scroll that shows the
  // thumb, and those swipes do not wait for the screen to settle. The
  // absence check of the short result (assertNotVisible) is not a read.
  const flow = await readFile(
    new URL('validation/maestro/polish/03-fast-scroll.yaml', root),
    'utf8',
  );
  const readsThumb = step =>
    /show-scrollbar\.yaml/.test(step) ||
    (/files\.scroller\.thumb/.test(step) && !/^- assertNotVisible:/.test(step));
  const reads = topLevelSteps(flow).filter(readsThumb);
  assert.equal(reads.length, 10);
  for (const step of reads) {
    assert.match(step, /^- retry:\n    maxRetries: 2\n    commands:\n/, step);
    const commands = step
      .split('\n')
      .slice(3)
      .filter(line => line.startsWith('      - '));
    assert.equal(commands.length, 2, step);
    assert.match(commands[0], /^      - (swipe:|runFlow: \.\.\/subflows\/show-scrollbar\.yaml)$/, step);
    assert.match(commands[1], /^      - (assertVisible|copyTextFrom):$/, step);
    assert.match(step, /\n          id: "files\.scroller\.thumb"/, step);
    const swipes = step.split('      - swipe:').length - 1;
    const settles = (step.match(/\n          waitToSettleTimeoutMs: 50(\n|$)/g) ?? []).length;
    assert.equal(settles, swipes, step);
  }
  // Every other thumb mention is the one absence check.
  const others = topLevelSteps(flow).filter(
    step => /files\.scroller\.thumb/.test(step) && !readsThumb(step),
  );
  assert.deepEqual(others, ['- assertNotVisible:\n    id: "files.scroller.thumb"']);
});
