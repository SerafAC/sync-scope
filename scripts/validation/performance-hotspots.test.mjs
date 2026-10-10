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
