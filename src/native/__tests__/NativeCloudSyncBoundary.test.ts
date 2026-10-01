import * as fs from 'fs';
import * as path from 'path';

const SRC_ROOT = path.join(__dirname, '..', '..');
const NATIVE_ROOT = path.join(__dirname, '..');
const SPECS_DIR = path.join(NATIVE_ROOT, 'specs');

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) {
    return [];
  }
  return fs
    .readdirSync(dir, {withFileTypes: true})
    .flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return listTsFiles(full);
      }
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
}

describe('typed native boundary', () => {
  it('has exactly one codegen TurboModule spec', () => {
    const specs = listTsFiles(SPECS_DIR).filter(file =>
      /Native[A-Z].*\.tsx?$/.test(path.basename(file)),
    );
    expect(specs.map(file => path.basename(file))).toEqual([
      'NativeCloudSync.ts',
    ]);
  });

  it('spec carries a versioned, discriminated result contract', () => {
    const source = fs.readFileSync(
      path.join(SPECS_DIR, 'NativeCloudSync.ts'),
      'utf8',
    );
    expect(source).toContain('extends TurboModule');
    expect(source).toContain('contractVersion');
    expect(source).toContain("getEnforcing<Spec>('CloudSync')");
  });

  it('spec exposes no secret, remote-mutation, body-download, or raw-path operation', () => {
    const source = fs
      .readFileSync(path.join(SPECS_DIR, 'NativeCloudSync.ts'), 'utf8')
      .toLowerCase();
    const forbidden = [
      'getpassword',
      'readpassword',
      'downloadfile',
      'getfilecontent',
      'readremote',
      'upload',
      'putfile',
      'deleteremote',
      'remotedelete',
      'renameremote',
      'moveremote',
      'mkdir',
      'writefile',
      'rawpath',
      'localpath',
    ];
    for (const token of forbidden) {
      expect(source).not.toContain(token);
    }
  });

  it('launchSourcePicker takes an optional re-grant source ID (contract v2)', () => {
    const source = fs.readFileSync(
      path.join(SPECS_DIR, 'NativeCloudSync.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /launchSourcePicker\(\s*regrantSourceId\?: string \| null,?\s*\): Promise<OperationResultDto>;/,
    );
    expect(source).not.toContain('launchSourcePicker(): ');
  });

  it('startScan takes an optional scan mode (contract v3)', () => {
    const source = fs.readFileSync(
      path.join(SPECS_DIR, 'NativeCloudSync.ts'),
      'utf8',
    );
    expect(source).toMatch(
      /startScan\(\s*mode\?: string \| null,?\s*\): Promise<OperationResultDto>;/,
    );
    expect(source).not.toContain('startScan(): ');
  });

  it('spec pages are bounded by the shared page contract', () => {
    const source = fs.readFileSync(
      path.join(SPECS_DIR, 'NativeCloudSync.ts'),
      'utf8',
    );
    // The spec must accept caller page tokens so pages stay snapshot-bound.
    expect(source).toContain('pageToken');
    expect(source).toContain('pageSize');
  });

  it('no ad hoc native module access outside the single typed boundary', () => {
    const offenders: string[] = [];
    for (const file of listTsFiles(SRC_ROOT)) {
      if (file.includes('__tests__')) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      if (/\bNativeModules\b/.test(source)) {
        offenders.push(file);
      }
      const usesRegistry = /\bTurboModuleRegistry\b/.test(source);
      const isBoundary =
        file.endsWith('CloudSync.ts') ||
        file.endsWith(path.join('specs', 'NativeCloudSync.ts'));
      if (usesRegistry && !isBoundary) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
