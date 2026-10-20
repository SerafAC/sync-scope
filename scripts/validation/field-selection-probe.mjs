// Feature 008, T035: summarizes one field-selection probe directory written by
// field-selection-probe.sh into results.json and summary.md.
//
//   node scripts/validation/field-selection-probe.mjs summarize <dir> <exit status>
//
// Every recorded run is kept, failed ones included. Helper costs come from the
// pinned Maestro commands.json artifacts: each runFlow whose first command
// defines FIELD is one helper call. Only the field's testID, the duration and
// the status are kept; typed values and credentials (which those artifacts
// contain) never reach the summary.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FIELD_ID = /^repository\.(?:host|port|username|password|remoteRoots\.\d)$/;

async function walk(directory) {
  let entries = [];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  }));
  return nested.flat();
}

/** Helper calls of one artifact: [{field, ms, status}] in sequence order. */
export function helperCalls(records) {
  const calls = [];
  for (const record of records) {
    const run = record?.command?.runFlowCommand;
    const env = run?.commands?.[0]?.defineVariablesCommand?.env;
    if (!env || typeof env.FIELD !== 'string') {
      continue;
    }
    const field = FIELD_ID.test(env.FIELD) ? env.FIELD : 'unknown-field';
    const ms = record.metadata?.duration;
    calls.push({
      sequence: record.metadata?.sequenceNumber ?? null,
      field,
      ms: Number.isFinite(ms) && ms >= 0 ? ms : null,
      status: String(record.metadata?.status ?? 'UNKNOWN'),
    });
  }
  return calls
    .sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))
    .map(({ field, ms, status }) => ({ field, ms, status }));
}

const median = values => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export function parseRuns(tsv) {
  const [header, ...lines] = tsv.trim().split('\n');
  const keys = header.split('\t');
  return lines.filter(Boolean).map(line => {
    const values = line.split('\t');
    const row = Object.fromEntries(keys.map((key, index) => [key, values[index]]));
    const start = BigInt(row.startNs);
    const end = BigInt(row.endNs);
    return {
      api: Number(row.api),
      kind: row.kind,
      flow: row.flow,
      tree: row.tree,
      repetition: Number(row.repetition),
      passed: row.status === '0',
      exitStatus: Number(row.status),
      wallMs: Number(end - start) / 1e6,
      artifact: row.artifact,
    };
  });
}

export function summarize(runs) {
  const regression = {};
  for (const run of runs.filter(item => item.kind === 'regression')) {
    const key = `${run.api}:${run.tree}`;
    regression[key] ??= { api: run.api, tree: run.tree, runs: 0, passed: 0, wallMs: [], helperMs: [] };
    const entry = regression[key];
    entry.runs++;
    if (run.passed) {
      entry.passed++;
      entry.wallMs.push(run.wallMs);
      if (run.helperTotalMs !== null) {
        entry.helperMs.push(run.helperTotalMs);
      }
    }
  }
  return Object.values(regression).map(entry => ({
    api: entry.api,
    tree: entry.tree,
    runs: entry.runs,
    passed: entry.passed,
    medianWallMs: median(entry.wallMs),
    medianHelperMs: median(entry.helperMs),
  }));
}

function markdown(result) {
  const lines = [
    '# Field-selection probe (T035)',
    '',
    `Probe exit status: ${result.exitStatus}. APK sha256: ${result.apkSha256 ?? 'unknown'}.`,
    'Failed runs are listed as they happened; nothing was retried or replaced.',
    '',
    '## Diagnostics (pass = yes)',
    '',
    '| API | Flow | Result | Wall s |',
    '| --- | --- | --- | --- |',
    ...result.runs.filter(run => run.kind === 'diagnostic').map(run =>
      `| ${run.api} | ${run.flow} | ${run.passed ? 'pass' : `fail (${run.exitStatus})`} | ${(run.wallMs / 1000).toFixed(1)} |`),
    '',
    '## Real-form regression (performance/01-field-replacement.yaml)',
    '',
    '| API | Helper | Rep | Result | Wall s | Helper calls | Helper total s |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...result.runs.filter(run => run.kind === 'regression').map(run =>
      `| ${run.api} | ${run.tree} | ${run.repetition} | ${run.passed ? 'pass' : `fail (${run.exitStatus})`} | ` +
      `${(run.wallMs / 1000).toFixed(1)} | ${run.helpers.length} | ` +
      `${run.helperTotalMs === null ? 'n/a' : (run.helperTotalMs / 1000).toFixed(1)} |`),
    '',
    '## Medians over passing runs',
    '',
    '| API | Helper | Passed/runs | Median wall s | Median helper total s |',
    '| --- | --- | --- | --- | --- |',
    ...result.summary.map(row =>
      `| ${row.api} | ${row.tree} | ${row.passed}/${row.runs} | ` +
      `${row.medianWallMs === null ? 'n/a' : (row.medianWallMs / 1000).toFixed(1)} | ` +
      `${row.medianHelperMs === null ? 'n/a' : (row.medianHelperMs / 1000).toFixed(1)} |`),
    '',
  ];
  return lines.join('\n');
}

export async function summarizeDirectory(directory, exitStatus) {
  const runs = parseRuns(await readFile(join(directory, 'runs.tsv'), 'utf8'));
  for (const run of runs) {
    run.helpers = [];
    run.helperTotalMs = null;
    if (run.kind !== 'regression') {
      continue;
    }
    const files = (await walk(join(directory, 'raw', run.artifact, 'output')))
      .filter(path => /commands(?:-[^/]*)?\.json$/.test(path));
    for (const file of files) {
      run.helpers.push(...helperCalls(JSON.parse(await readFile(file, 'utf8'))));
    }
    if (run.helpers.length && run.helpers.every(call => call.ms !== null)) {
      run.helperTotalMs = run.helpers.reduce((sum, call) => sum + call.ms, 0);
    }
  }
  let apkSha256 = null;
  try {
    apkSha256 = (await readFile(join(directory, 'apk.sha256'), 'utf8')).trim() || null;
  } catch {}
  const result = {
    schemaVersion: 1,
    task: 'T035',
    exitStatus: Number(exitStatus),
    apkSha256,
    runs,
    summary: summarize(runs),
  };
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
