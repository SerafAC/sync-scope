import fs from 'fs';
import path from 'path';

/**
 * SC-003 / research R5: no text in the app may send the user to a "Connect screen",
 * because the app has no such screen. Every message names a real place instead
 * (Settings › Repository). This scans the shipped sources: every `.ts`/`.tsx` file
 * under `src/` and every `.kt` file under `android/app/src/main/`. Tests are not
 * shipped, so `__tests__` folders are skipped (they may assert the phrase is absent).
 */

const ROOT = path.resolve(__dirname, '..', '..');
// Built from parts so this file never matches itself.
const FORBIDDEN = ['Connect', 'screen'].join(' ');

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

describe('no "Connect screen" text (SC-003)', () => {
  const sources = [
    ...filesUnder(path.join(ROOT, 'src'), ['.ts', '.tsx']),
    ...filesUnder(path.join(ROOT, 'android', 'app', 'src', 'main'), ['.kt']),
  ];

  it('scans the JS and Kotlin sources', () => {
    expect(sources.some(file => file.endsWith('.tsx'))).toBe(true);
    expect(sources.some(file => file.endsWith('.kt'))).toBe(true);
  });

  it('finds the phrase in no source file', () => {
    const offenders = sources
      .filter(file => fs.readFileSync(file, 'utf8').includes(FORBIDDEN))
      .map(file => path.relative(ROOT, file));
    expect(offenders).toEqual([]);
  });
});
