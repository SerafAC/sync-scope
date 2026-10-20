// Feature 008, T039/T040: summarizes one configuration probe directory written
// by configuration-probe.sh into results.json and summary.md.
//
//   node scripts/validation/configuration-probe.mjs summarize <dir> <exit status>
//
// Every recorded run is kept, failed ones included. Cohorts are never pooled:
// medians are per API, cohort and flow, over passing runs only, and the pass
// count is always shown beside them. Only flow paths, statuses, cohort labels,
// observed animation scales and durations are written.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FLOW = /^[a-z0-9-]+\/[0-9]{2}-[a-z0-9-]+\.yaml$/;

export function parseRuns(tsv) {
  const [header, ...lines] = tsv.trim().split('\n');
  const keys = header.split('\t');
  return lines.filter(Boolean).map(line => {
    const values = line.split('\t');
    const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    return {
      api: Number(row.api),
      cohort: /^[A-D]$/.test(row.cohort) ? row.cohort : 'unknown',
      animations: /^[0-9.null/]+$/.test(row.animations ?? '') ? row.animations : 'unknown',
      pacingMs: Number(row.pacingMs),
      flow: FLOW.test(row.flow) ? row.flow : 'unknown-flow',
      repetition: Number(row.repetition),
      passed: row.status === '0',
      exitStatus: Number(row.status),
      wallMs: Number(BigInt(row.endNs) - BigInt(row.startNs)) / 1e6,
      artifact: row.artifact,
    };
  });
}

const median = values => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function summarize(runs) {
  const groups = {};
  for (const run of runs) {
    const key = `${run.api}|${run.cohort}|${run.flow}`;
    groups[key] ??= { api: run.api, cohort: run.cohort, pacingMs: run.pacingMs, flow: run.flow,
      animations: new Set(), runs: 0, passed: 0, wallMs: [] };
    const group = groups[key];
    group.runs++;
    group.animations.add(run.animations);
    if (run.passed) {
      group.passed++;
      group.wallMs.push(run.wallMs);
    }
  }
  return Object.values(groups).map(group => ({
    api: group.api,
    cohort: group.cohort,
    flow: group.flow,
    pacingMs: group.pacingMs,
    animations: [...group.animations].join(', '),
    runs: group.runs,
    passed: group.passed,
    medianWallMs: median(group.wallMs),
  }));
}

// fixtures.tsv: api, pass (reseed|validate), startNs, endNs (T043: device
// fixture validation cost against regeneration on the same emulator).
export function parseFixtures(tsv) {
  return tsv.trim().split('\n').filter(Boolean).map(line => {
    const [api, pass, startNs, endNs] = line.split('\t');
    return {
      api: Number(api),
      pass: pass === 'reseed' || pass === 'validate' ? pass : 'unknown',
      wallMs: Number(BigInt(endNs) - BigInt(startNs)) / 1e6,
    };
  });
}

const seconds = ms => (ms === null ? 'n/a' : (ms / 1000).toFixed(1));

function markdown(result) {
  return [
    '# Configuration probe (T039/T040)',
    '',
    `Probe exit status: ${result.exitStatus}. APK sha256: ${result.apkSha256 ?? 'unknown'}.`,
    'Failed runs are listed as they happened; nothing was retried, replaced or pooled across cohorts.',
    '',
    '## Runs',
    '',
    '| API | Cohort | Animations | Pacing ms | Flow | Rep | Result | Wall s |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...result.runs.map(run => `| ${run.api} | ${run.cohort} | ${run.animations} | ${run.pacingMs} | ` +
      `${run.flow} | ${run.repetition} | ${run.passed ? 'pass' : `fail (${run.exitStatus})`} | ${seconds(run.wallMs)} |`),
    '',
    '## Medians over passing runs',
    '',
    '| API | Cohort | Flow | Animations | Pacing ms | Passed/runs | Median wall s |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...result.summary.map(row => `| ${row.api} | ${row.cohort} | ${row.flow} | ${row.animations} | ` +
      `${row.pacingMs} | ${row.passed}/${row.runs} | ${seconds(row.medianWallMs)} |`),
    '',
    '## Device fixtures (T043)',
    '',
    '| API | Pass | Wall s |',
    '| --- | --- | --- |',
    ...result.fixtures.map(row => `| ${row.api} | ${row.pass} | ${seconds(row.wallMs)} |`),
    '',
  ].join('\n');
}

export async function summarizeDirectory(directory, exitStatus) {
  const runs = parseRuns(await readFile(join(directory, 'runs.tsv'), 'utf8'));
  let apkSha256 = null;
  try {
    apkSha256 = (await readFile(join(directory, 'apk.sha256'), 'utf8')).trim() || null;
  } catch {}
  let fixtures = [];
  try {
    fixtures = parseFixtures(await readFile(join(directory, 'fixtures.tsv'), 'utf8'));
  } catch {}
  const result = { schemaVersion: 1, task: 'T039/T040', exitStatus: Number(exitStatus), apkSha256,
    runs, summary: summarize(runs), fixtures };
  await writeFile(join(directory, 'results.json'), `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  await writeFile(join(directory, 'summary.md'), markdown(result), { mode: 0o600 });
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [command, directory, status] = process.argv.slice(2);
  if (command !== 'summarize' || !directory || !/^\d+$/.test(status ?? '')) {
    process.exit(64);
  }
  await summarizeDirectory(directory, status);
}
