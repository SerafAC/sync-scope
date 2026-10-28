import { createHash } from 'node:crypto';
import { link, lstat, readFile, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve, sep } from 'node:path';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// This intentionally supports the repository's block-style Maestro command
// lists, not general YAML. Unsupported command/option forms fail explicitly.
// Never scan arbitrary mapping keys or string payloads for command names.
function sourceLines(text) {
  let blockIndent = null;
  return text.split(/\r?\n/).flatMap((raw, index) => {
    if (/^\s*\t/.test(raw)) {
      throw new Error('unsupported-command-indentation');
    }
    const indent = raw.length - raw.trimStart().length;
    if (blockIndent !== null && (!raw.trim() || indent > blockIndent)) {
      return [];
    }
    blockIndent = null;
    let quote = null;
    let end = raw.length;
    for (let i = indent; i < raw.length; i++) {
      const char = raw[i];
      if (quote === '"' && char === '\\') {
        i++;
      } else if (char === quote) {
        quote = null;
      } else if (!quote && (char === '"' || char === "'")) {
        quote = char;
      } else if (!quote && char === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
        end = i;
        break;
      }
    }
    const content = raw.slice(indent, end).trimEnd();
    if (!content) {
      return [];
    }
    if (/:\s*[|>][+-]?\d?\s*$/.test(content)) {
      blockIndent = indent;
    }
    return [{ indent, content, line: index + 1 }];
  });
}

// These are source definitions, never executed device evidence. Null launch
// options mean unspecified driver defaults; false must not be lost or inferred.
export function captureLifecycle(text) {
  const lines = sourceLines(text);
  const separator = lines.findIndex(line => line.content === '---');
  if (separator < 0) {
    throw new Error('missing-command-document');
  }
  const commands = lines.slice(separator + 1);
  const result = [];

  function walk(list, nodePrefix) {
    if (!list.length) {
      return;
    }
    const indent = list[0].indent;
    let index = 0;
    for (let i = 0; i < list.length; ) {
      const line = list[i];
      const match = line.content.match(/^-\s+([A-Za-z]\w*)(?:\s*:\s*(.*))?$/);
      if (line.indent !== indent || !match) {
        throw new Error('unsupported-command-node');
      }
      const [, command, value] = match;
      let end = i + 1;
      while (end < list.length && list[end].indent > indent) {
        end++;
      }
      const children = list.slice(i + 1, end);
      if (value === undefined && children.length) {
        throw new Error('invalid-scalar-command-children');
      }
      const childIndent = children.length
        ? Math.min(...children.map(child => child.indent))
        : null;
      const direct = children.filter(child => child.indent === childIndent);
      const node = `${nodePrefix}[${index++}]`;
      const record = {
        command,
        line: line.line,
        node,
        form: value === undefined ? 'scalar' : 'mapping',
      };
      if (['launchApp', 'stopApp', 'clearState'].includes(command)) {
        if (command === 'launchApp') {
          if (value !== undefined && value !== '') {
            throw new Error('unsupported-launch-options');
          }
          for (const option of ['clearState', 'stopApp']) {
            const matches = direct.filter(child =>
              child.content.startsWith(`${option}:`),
            );
            if (matches.length > 1) {
              throw new Error('duplicate-launch-option');
            }
            const boolean = matches[0]?.content.match(/:\s*(true|false)$/);
            if (matches.length && !boolean) {
              throw new Error('unsupported-launch-option-value');
            }
            record[option] = boolean ? boolean[1] === 'true' : null;
          }
        }
        result.push(record);
      } else if (
        command === 'pressKey' &&
        /^(Home|"Home"|'Home')$/.test(value)
      ) {
        result.push({ ...record, key: 'Home' });
      }
      if (['runFlow', 'repeat', 'retry'].includes(command)) {
        for (const child of direct) {
          if (/^commands:/.test(child.content)) {
            if (child.content !== 'commands:') {
              throw new Error('unsupported-inline-command-list');
            }
            const start = children.indexOf(child) + 1;
            let stop = start;
            // YAML also permits indentless sequences immediately under a key.
            while (
              stop < children.length &&
              (children[stop].indent > child.indent ||
                (children[stop].indent === child.indent &&
                  children[stop].content.startsWith('- ')))
            ) {
              stop++;
            }
            walk(children.slice(start, stop), `${node}.${command}.commands`);
          }
        }
      }
      i = end;
    }
  }

  walk(commands, 'commands');
  return result;
}

// Metadata-only correction: keep source/fixture/workload identities, assertions,
// status and hooks untouched. Validate every frozen flow before creating records.
export async function correctLifecycleInventory(inventory, readFlow) {
  const corrected = structuredClone(inventory);
  const entries = [
    ...corrected.workspace,
    ...corrected.stagedSequences.flatMap(sequence =>
      sequence.steps.filter(step => step.kind === 'flow'),
    ),
  ];
  for (const entry of entries) {
    const bytes = await readFlow(entry.flow);
    if (digest(bytes) !== entry.flowSha256) {
      throw new Error('frozen-flow-identity-mismatch');
    }
    entry.lifecycle = captureLifecycle(bytes.toString('utf8'));
  }
  return corrected;
}

// Versioned records are created exclusively. The old record is retained
// byte-for-byte before the canonical reference is advanced; nothing is replaced
// or deleted without another immutable local reference.
export async function retainLifecycleCorrection(inventoryPath, repository) {
  const file = await lstat(inventoryPath);
  const directory = await lstat(dirname(inventoryPath));
  if (
    !file.isFile() ||
    !directory.isDirectory() ||
    file.uid !== process.getuid() ||
    directory.uid !== process.getuid() ||
    file.mode % 0o100 ||
    directory.mode % 0o100
  ) {
    throw new Error('evidence-not-owner-private');
  }
  const original = await readFile(inventoryPath);
  const inventory = JSON.parse(original);
  if (inventory.lifecycleCorrection) {
    throw new Error('lifecycle-already-corrected');
  }
  const corrected = await correctLifecycleInventory(inventory, async path => {
    const absolute = resolve(repository, path);
    if (!absolute.startsWith(`${resolve(repository)}${sep}`)) {
      throw new Error('invalid-frozen-flow-path');
    }
    return readFile(absolute);
  });
  const prior = 'acceptance-before.lifecycle-v1.json';
  const current = 'acceptance-before.lifecycle-v2.json';
  corrected.lifecycleCorrection = {
    schemaVersion: 1,
    reason: 'command-node-lifecycle-capture',
    correctedAt: new Date().toISOString(),
    prior: { file: prior, sha256: digest(original) },
    current,
    canonical: basename(inventoryPath),
    extractor: {
      path: 'scripts/validation/performance-acceptance.mjs',
      sha256: digest(await readFile(new URL(import.meta.url))),
    },
    evidence:
      'Source definitions only; no runtime claims executed or upgraded.',
  };
  await link(inventoryPath, join(dirname(inventoryPath), prior));
  await writeFile(
    join(dirname(inventoryPath), current),
    `${JSON.stringify(corrected, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 },
  );
  await unlink(inventoryPath);
  await link(join(dirname(inventoryPath), current), inventoryPath);
  return corrected;
}
