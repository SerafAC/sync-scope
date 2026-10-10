import fs from 'fs';
import path from 'path';

/**
 * FR-016 / research R16: the Settings section for local folders is "Device
 * folders", and every text that points to it says "Settings › Device folders".
 * With server folders now in the repository, a bare "Folders" is ambiguous.
 * This scans the shipped sources: every `.ts`/`.tsx` file under `src/` and the
 * Kotlin contract (`CloudSyncContracts.kt`), which holds the native action
 * texts. Tests are not shipped, so `__tests__` folders are skipped (they may
 * assert the old wording is absent). JS names such as `FoldersItem` are not
 * user-visible and are not matched.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const KOTLIN_CONTRACT = path.join(
  ROOT,
  'android',
  'app',
  'src',
  'main',
  'java',
  'com',
  'syncscope',
  'bridge',
  'CloudSyncContracts.kt',
);

// Built from parts so this file never matches itself.
const OLD = 'Fold' + 'ers';
const settings = {
  name: `Settings › ${OLD}`,
  pattern: new RegExp(`Settings › ${OLD}\\b`),
};
const header = {
  name: `a section header "${OLD}"`,
  pattern: new RegExp(
    `accessibilityRole="header"[^>]*>\\s*(\\{\\s*['"])?${OLD}(['"]\\s*\\})?\\s*<`,
  ),
};
const section = {
  name: `the "${OLD}" section`,
  pattern: new RegExp(`(?<!Device )\\b"?${OLD}"? section\\b`),
};
const FORBIDDEN = [settings, header, section];

function filesUnder(dir: string, extensions: readonly string[]): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') {
        found.push(...filesUnder(full, extensions));
      }
    } else if (extensions.some(extension => entry.name.endsWith(extension))) {
      found.push(full);
    }
  }
  return found;
}

describe('"Device folders" wording (FR-016)', () => {
  const sources = [
    ...filesUnder(path.join(ROOT, 'src'), ['.ts', '.tsx']),
    KOTLIN_CONTRACT,
  ];

  it('scans the JS sources and the Kotlin contract', () => {
    expect(sources.some(file => file.endsWith('.tsx'))).toBe(true);
    expect(fs.existsSync(KOTLIN_CONTRACT)).toBe(true);
  });

  it.each(FORBIDDEN)('finds $name in no source file', ({pattern}) => {
    const offenders = sources
      .filter(file => pattern.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });

  it('recognises the old wording', () => {
    expect(settings.pattern.test(`Open Settings › ${OLD}.`)).toBe(true);
    expect(settings.pattern.test('Open Settings › Device folders.')).toBe(
      false,
    );
    expect(
      header.pattern.test(
        `<Text accessibilityRole="header" variant="titleLarge">\n  ${OLD}\n</Text>`,
      ),
    ).toBe(true);
    expect(
      header.pattern.test(
        '<Text accessibilityRole="header" variant="titleLarge">\n  Device folders\n</Text>',
      ),
    ).toBe(false);
    expect(section.pattern.test(` * above the "${OLD}" section`)).toBe(true);
    expect(section.pattern.test(' * above the "Device folders" section')).toBe(
      false,
    );
  });
});
