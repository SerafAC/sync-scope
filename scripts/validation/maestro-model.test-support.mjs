// Test support only (feature 008, T029-T031): a deliberately small model of
// the pinned Maestro 2.10.0 command language, so helper contracts can be
// executed against injected synthetic devices instead of a real emulator.
//
// It parses the repository's block-style flow YAML (no flow style, anchors or
// block scalars) and interprets a closed set of commands. Anything else fails
// explicitly: an unknown command, option or key must never be skipped
// silently, because a skipped step could turn a contract test into a no-op.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class UnsupportedFlow extends Error {}
export class FlowFailure extends Error {}

function stripComment(raw) {
  let quote = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote === '"' && char === '\\') {
      i++;
    } else if (char === quote) {
      quote = null;
    } else if (!quote && (char === '"' || char === "'")) {
      quote = char;
    } else if (!quote && char === '#' && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

function tokenize(text) {
  return text.split(/\r?\n/).flatMap((raw, index) => {
    if (/^\s*\t/.test(raw)) {
      throw new UnsupportedFlow(`tab indentation on line ${index + 1}`);
    }
    const content = stripComment(raw).trimEnd();
    if (!content.trim()) {
      return [];
    }
    const indent = content.length - content.trimStart().length;
    return [{ indent, text: content.trim(), line: index + 1 }];
  });
}

const ENTRY = /^([A-Za-z_][\w.-]*):(?:\s+(.*))?$/;
const isItem = text => text === '-' || text.startsWith('- ');

function scalar(text, line) {
  if (/^[|>]/.test(text) || /^[[{&*!]/.test(text)) {
    throw new UnsupportedFlow(`unsupported YAML value on line ${line}`);
  }
  if (text.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(text)) {
      throw new UnsupportedFlow(`unterminated string on line ${line}`);
    }
    const escapes = { n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\', '/': '/', '0': '\0', ' ': ' ' };
    return text.slice(1, -1).replace(/\\(.)/gs, (all, char) => {
      if (!Object.hasOwn(escapes, char)) {
        throw new UnsupportedFlow(`unsupported escape \\${char} on line ${line}`);
      }
      return escapes[char];
    });
  }
  if (text.startsWith("'")) {
    if (!/^'(?:[^']|'')*'$/.test(text)) {
      throw new UnsupportedFlow(`unterminated string on line ${line}`);
    }
    return text.slice(1, -1).replace(/''/g, "'");
  }
  if (text === 'true' || text === 'false') {
    return text === 'true';
  }
  if (text === 'null' || text === '~') {
    return null;
  }
  if (/^-?\d+$/.test(text)) {
    return Number(text);
  }
  return text;
}

function parseNode(tokens, position, indent) {
  return isItem(tokens[position].text)
    ? parseSequence(tokens, position, indent)
    : parseMapping(tokens, position, indent);
}

function parseSequence(tokens, position, indent) {
  const items = [];
  while (
    position < tokens.length &&
    tokens[position].indent === indent &&
    isItem(tokens[position].text)
  ) {
    const token = tokens[position];
    const rest = token.text === '-' ? '' : token.text.slice(2).trim();
    if (!rest) {
      const next = tokens[position + 1];
      if (!next || next.indent <= indent) {
        items.push(null);
        position++;
        continue;
      }
      const [value, end] = parseNode(tokens, position + 1, next.indent);
      items.push(value);
      position = end;
    } else if (ENTRY.test(rest)) {
      tokens[position] = { indent: indent + 2, text: rest, line: token.line };
      const [value, end] = parseMapping(tokens, position, indent + 2);
      items.push(value);
      position = end;
    } else {
      items.push(scalar(rest, token.line));
      position++;
    }
  }
  if (position < tokens.length && tokens[position].indent > indent) {
    throw new UnsupportedFlow(`unexpected indentation on line ${tokens[position].line}`);
  }
  return [items, position];
}

function parseMapping(tokens, position, indent) {
  const mapping = {};
  while (
    position < tokens.length &&
    tokens[position].indent === indent &&
    !isItem(tokens[position].text)
  ) {
    const token = tokens[position];
    const match = token.text.match(ENTRY);
    if (!match) {
      throw new UnsupportedFlow(`unsupported mapping entry on line ${token.line}`);
    }
    const [, key, rest] = match;
    if (Object.hasOwn(mapping, key)) {
      throw new UnsupportedFlow(`duplicate key ${key} on line ${token.line}`);
    }
    position++;
    if (rest === undefined || rest === '') {
      const next = tokens[position];
      if (
        next &&
        (next.indent > indent || (next.indent === indent && isItem(next.text)))
      ) {
        const [value, end] = parseNode(tokens, position, next.indent);
        mapping[key] = value;
        position = end;
      } else {
        mapping[key] = null;
      }
    } else {
      mapping[key] = scalar(rest, token.line);
    }
  }
  if (position < tokens.length && tokens[position].indent > indent) {
    throw new UnsupportedFlow(`unexpected indentation on line ${tokens[position].line}`);
  }
  return [mapping, position];
}

/** Parses a flow file into its header mapping and its command list. */
export function parseFlow(text) {
  const tokens = tokenize(text);
  const separator = tokens.findIndex(token => token.text === '---' && token.indent === 0);
  if (separator < 0) {
    throw new UnsupportedFlow('missing command document');
  }
  const head = tokens.slice(0, separator);
  const body = tokens.slice(separator + 1);
  const header = head.length ? parseNode(head, 0, 0)[0] : {};
  const [commands, end] = body.length ? parseNode(body, 0, body[0].indent) : [[], 0];
  if (!Array.isArray(commands) || end !== body.length) {
    throw new UnsupportedFlow('the command document must be one command list');
  }
  return { header, commands };
}

export function loadFlow(path) {
  return parseFlow(readFileSync(path, 'utf8'));
}

/** Splits one command node into its name and raw (unresolved) argument. */
export function commandParts(command) {
  if (typeof command === 'string') {
    return [command, undefined];
  }
  if (command === null || typeof command !== 'object' || Array.isArray(command)) {
    throw new UnsupportedFlow('a command must be a name or a one-key mapping');
  }
  const keys = Object.keys(command);
  if (keys.length !== 1) {
    throw new UnsupportedFlow(`a command must have exactly one name, got ${keys.join(', ')}`);
  }
  return [keys[0], command[keys[0]]];
}

// ${...} expressions: brace matching that ignores braces inside JS strings.
function expressions(text) {
  const parts = [];
  let index = 0;
  while (index < text.length) {
    const start = text.indexOf('${', index);
    if (start < 0) {
      parts.push({ literal: text.slice(index) });
      break;
    }
    parts.push({ literal: text.slice(index, start) });
    let depth = 1;
    let quote = null;
    let i = start + 2;
    for (; i < text.length && depth; i++) {
      const char = text[i];
      if (quote) {
        if (char === '\\') {
          i++;
        } else if (char === quote) {
          quote = null;
        }
      } else if (char === '"' || char === "'" || char === '`') {
        quote = char;
      } else if (char === '{') {
        depth++;
      } else if (char === '}') {
        depth--;
      }
    }
    if (depth) {
      throw new UnsupportedFlow(`unterminated expression in ${text}`);
    }
    const expression = text.slice(start + 2, i - 1);
    // The pinned Maestro 2.10.0 only interpolates `(?<!\\)\$\{([^$]*)}`:
    // an expression containing "$" is never evaluated on a device.
    if (expression.includes('$')) {
      throw new UnsupportedFlow(`"$" inside an expression is not interpolated by Maestro 2.10.0: ${text}`);
    }
    parts.push({ expression });
    index = i;
  }
  return parts.filter(part => part.expression !== undefined || part.literal);
}

const ALLOWED_KEYS = new Set([
  'Enter', 'Backspace', 'Back', 'Home', 'Lock', 'Tab', 'Power',
  'Volume Up', 'Volume Down',
]);
const SELECTOR_KEYS = new Set([
  'id', 'text', 'index', 'below', 'above', 'leftOf', 'rightOf', 'childOf',
  'checked', 'enabled', 'focused', 'selected',
]);
const TAP_OPTIONS = new Set(['waitToSettleTimeoutMs', 'retryTapIfNoChange', 'optional', 'label', 'point']);

/** Maestro text matching: equal, or a full regular-expression match. */
export function textMatches(pattern, value) {
  if (value === null || value === undefined) {
    return false;
  }
  if (pattern === value) {
    return true;
  }
  try {
    return new RegExp(`^(?:${pattern})$`, 's').test(value);
  } catch {
    return false;
  }
}

/**
 * Runs a command list against an injected device. The device implements:
 * find(selector) -> element|null, tap(element, selector), longPress(element),
 * eraseText(n), inputText(text), hideKeyboard(), pressKey(key),
 * copyText(element) -> string, advance(ms) and, optionally, scroll(selector).
 * Returns the transcript of executed commands with resolved arguments.
 */
export function execute(commands, { device, env = {}, file = null, pollMs = 250 }) {
  const context = { output: {}, maestro: { copiedText: '' } };
  const transcript = [];
  const scopes = [env];

  function scope() {
    return Object.assign({}, ...scopes, context);
  }
  function evaluate(expression) {
    // Flow JavaScript runs in a sloppy-mode sandbox over the env variables.
    // eslint-disable-next-line no-new-func
    return new Function('scope', `with (scope) { return (${expression}); }`)(scope());
  }
  function resolveText(value) {
    if (typeof value !== 'string' || !value.includes('${')) {
      return value;
    }
    const parts = expressions(value);
    if (parts.length === 1 && parts[0].expression !== undefined) {
      return evaluate(parts[0].expression);
    }
    return parts
      .map(part => (part.expression !== undefined ? String(evaluate(part.expression)) : part.literal))
      .join('');
  }
  function resolveDeep(value) {
    if (Array.isArray(value)) {
      return value.map(resolveDeep);
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveDeep(v)]));
    }
    return resolveText(value);
  }
  function selector(raw, extra = new Set()) {
    const value = resolveDeep(raw);
    const result = typeof value === 'string' ? { text: value } : value;
    if (!result || typeof result !== 'object') {
      throw new UnsupportedFlow('invalid selector');
    }
    for (const key of Object.keys(result)) {
      if (!SELECTOR_KEYS.has(key) && !extra.has(key)) {
        throw new UnsupportedFlow(`unsupported selector option ${key}`);
      }
    }
    return result;
  }
  function selectorOnly(value) {
    return Object.fromEntries(Object.entries(value).filter(([key]) => SELECTOR_KEYS.has(key)));
  }
  function waitFor(target, present, timeout) {
    for (let waited = 0; ; waited += pollMs) {
      if (Boolean(device.find(target)) === present) {
        return true;
      }
      if (waited >= timeout) {
        return false;
      }
      device.advance(pollMs);
    }
  }
  function condition(when) {
    for (const key of Object.keys(when)) {
      if (!['visible', 'notVisible', 'true', 'platform'].includes(key)) {
        throw new UnsupportedFlow(`unsupported condition ${key}`);
      }
    }
    if (when.platform !== undefined && when.platform !== 'Android') {
      return false;
    }
    if (when.true !== undefined) {
      const value = resolveText(when.true);
      if (!(value === true || value === 'true')) {
        return false;
      }
    }
    if (when.visible !== undefined && !device.find(selector(when.visible))) {
      return false;
    }
    if (when.notVisible !== undefined && device.find(selector(when.notVisible))) {
      return false;
    }
    return true;
  }

  function run(list, currentFile) {
    if (!Array.isArray(list)) {
      throw new UnsupportedFlow('commands must be a list');
    }
    for (const command of list) {
      step(command, currentFile);
    }
  }

  function step(command, currentFile) {
    const [name, raw] = commandParts(command);
    const record = { command: name };
    transcript.push(record);
    switch (name) {
      case 'evalScript': {
        record.args = String(raw);
        resolveText(raw);
        return;
      }
      case 'assertTrue': {
        const value = resolveText(typeof raw === 'object' && raw ? raw.condition : raw);
        record.result = value === true || value === 'true';
        if (!record.result) {
          throw new FlowFailure(`assertTrue failed: ${String(raw)}`);
        }
        return;
      }
      case 'assertVisible':
      case 'assertNotVisible': {
        const target = selector(raw);
        record.args = target;
        const found = Boolean(device.find(target));
        if (found !== (name === 'assertVisible')) {
          throw new FlowFailure(`${name} failed: ${JSON.stringify(target)}`);
        }
        return;
      }
      case 'extendedWaitUntil': {
        const value = resolveDeep(raw);
        const keys = Object.keys(value);
        for (const key of keys) {
          if (!['visible', 'notVisible', 'timeout', 'optional'].includes(key)) {
            throw new UnsupportedFlow(`unsupported extendedWaitUntil option ${key}`);
          }
        }
        const present = value.visible !== undefined;
        if (present === (value.notVisible !== undefined)) {
          throw new UnsupportedFlow('extendedWaitUntil needs exactly one of visible/notVisible');
        }
        const target = selector(present ? raw.visible : raw.notVisible);
        record.args = { present, target, timeout: value.timeout, optional: value.optional === true };
        if (!waitFor(target, present, Number(value.timeout ?? 10000))) {
          if (value.optional === true) {
            record.warned = true;
            return;
          }
          throw new FlowFailure(`extendedWaitUntil timed out: ${JSON.stringify(target)}`);
        }
        return;
      }
      case 'scrollUntilVisible': {
        const value = resolveDeep(raw);
        for (const key of Object.keys(value)) {
          if (!['element', 'direction', 'timeout', 'speed', 'visibilityPercentage', 'centerElement', 'optional'].includes(key)) {
            throw new UnsupportedFlow(`unsupported scrollUntilVisible option ${key}`);
          }
        }
        const target = selector(raw.element);
        record.args = target;
        const timeout = Number(value.timeout ?? 20000);
        for (let waited = 0; !device.find(target); waited += pollMs) {
          if (waited >= timeout) {
            if (value.optional === true) {
              record.warned = true;
              return;
            }
            throw new FlowFailure(`scrollUntilVisible failed: ${JSON.stringify(target)}`);
          }
          device.scroll?.(target, value.direction);
          device.advance(pollMs);
        }
        return;
      }
      case 'tapOn':
      case 'longPressOn': {
        const target = selector(raw, TAP_OPTIONS);
        record.args = target;
        const element = waitFor(selectorOnly(target), true, 5000) && device.find(selectorOnly(target));
        if (!element) {
          if (target.optional === true) {
            record.warned = true;
            return;
          }
          throw new FlowFailure(`${name}: element not found: ${JSON.stringify(selectorOnly(target))}`);
        }
        record.element = element.id ?? element.text;
        if (name === 'tapOn') {
          device.tap(element, target);
        } else {
          device.longPress(element, target);
        }
        return;
      }
      case 'eraseText': {
        const count = raw === undefined || raw === null ? 50 : resolveText(raw);
        if (!Number.isInteger(Number(count)) || typeof count === 'object' || typeof count === 'boolean') {
          throw new UnsupportedFlow('eraseText takes only a character count (no "all")');
        }
        record.args = Number(count);
        device.eraseText(Number(count));
        return;
      }
      case 'inputText': {
        if (raw !== null && typeof raw === 'object') {
          throw new UnsupportedFlow('inputText takes only text (no replace flag)');
        }
        const value = String(resolveText(raw));
        record.args = value;
        device.inputText(value);
        return;
      }
      case 'hideKeyboard': {
        device.hideKeyboard();
        return;
      }
      case 'pressKey': {
        const key = String(resolveText(raw));
        record.args = key;
        if (!ALLOWED_KEYS.has(key)) {
          throw new UnsupportedFlow(`pressKey ${key} is not a pinned Maestro key`);
        }
        device.pressKey(key);
        return;
      }
      case 'copyTextFrom': {
        const target = selector(raw);
        record.args = target;
        const element = waitFor(target, true, 5000) && device.find(target);
        if (!element) {
          throw new FlowFailure(`copyTextFrom: element not found: ${JSON.stringify(target)}`);
        }
        context.maestro.copiedText = device.copyText(element);
        record.copied = context.maestro.copiedText;
        return;
      }
      case 'runFlow': {
        const spec = typeof raw === 'string' ? { file: raw } : raw;
        for (const key of Object.keys(spec ?? {})) {
          if (!['file', 'env', 'when', 'commands', 'label'].includes(key)) {
            throw new UnsupportedFlow(`unsupported runFlow option ${key}`);
          }
        }
        if (spec.when && !condition(spec.when)) {
          record.skipped = true;
          return;
        }
        const childEnv = spec.env ? resolveDeep(spec.env) : null;
        if (childEnv) {
          scopes.push(childEnv);
        }
        try {
          if (spec.file) {
            if (!currentFile) {
              throw new UnsupportedFlow('runFlow file needs a flow path');
            }
            const path = resolve(dirname(currentFile), spec.file);
            record.file = path;
            run(loadFlow(path).commands, path);
          } else {
            run(spec.commands, currentFile);
          }
        } finally {
          if (childEnv) {
            scopes.pop();
          }
        }
        return;
      }
      case 'repeat': {
        // Pinned 2.10.0: `times` is a (script-evaluated) string and `while`
        // a condition re-evaluated before every iteration; both may be set,
        // and at least one bounds the loop here.
        for (const key of Object.keys(raw ?? {})) {
          if (!['times', 'while', 'commands', 'label'].includes(key)) {
            throw new UnsupportedFlow(`unsupported repeat option ${key}`);
          }
        }
        if (raw.times === undefined && raw.while === undefined) {
          throw new UnsupportedFlow('repeat needs times or while');
        }
        const times = raw.times === undefined ? Number.POSITIVE_INFINITY : Number(resolveText(raw.times));
        if (!(Number.isInteger(times) || times === Number.POSITIVE_INFINITY) || times < 0) {
          throw new UnsupportedFlow(`repeat times must be a whole number, got ${raw.times}`);
        }
        let runs = 0;
        while (runs < times && (raw.while === undefined || condition(raw.while))) {
          if (runs >= 1000) {
            throw new FlowFailure('repeat did not terminate');
          }
          run(raw.commands, currentFile);
          runs++;
        }
        record.runs = runs;
        return;
      }
      default:
        if (typeof device[name] === 'function') {
          record.args = resolveDeep(raw);
          device[name](record.args);
          return;
        }
        throw new UnsupportedFlow(`unsupported command ${name}`);
    }
  }

  run(commands, file);
  return { transcript, output: context.output, copiedText: context.maestro.copiedText };
}

/** Executes one flow file with env; see execute(). */
export function executeFile(path, options) {
  return execute(loadFlow(path).commands, { ...options, file: path });
}

/**
 * Walks a flow and every runFlow file it references (once per call site),
 * yielding {command, value, file, depth, conditional} in source order.
 */
export function* walkFlow(path, depth = 0, conditional = false) {
  const { commands } = loadFlow(path);
  yield* walkCommands(commands, path, depth, conditional);
}

function* walkCommands(commands, file, depth, conditional) {
  for (const command of commands) {
    const [name, value] = commandParts(command);
    yield { command: name, value, file, depth, conditional };
    if (name === 'runFlow') {
      const spec = typeof value === 'string' ? { file: value } : value;
      const nested = conditional || Boolean(spec.when);
      if (spec.file) {
        yield* walkFlow(resolve(dirname(file), spec.file), depth + 1, nested);
      } else if (spec.commands) {
        yield* walkCommands(spec.commands, file, depth + 1, nested);
      }
    } else if (name === 'repeat' || name === 'retry') {
      yield* walkCommands(value.commands ?? [], file, depth + 1, conditional || name === 'repeat');
    }
  }
}
