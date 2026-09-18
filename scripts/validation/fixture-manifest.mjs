import {createHash} from 'node:crypto';
import {opendir, lstat, readFile, readlink} from 'node:fs/promises';
import {join, relative} from 'node:path';
import process from 'node:process';

const root = process.argv[2];
if (!root) {
  process.stderr.write('Fixture root is required.\n');
  process.exit(64);
}

const entries = [];

async function visit(directory) {
  const children = [];
  const stream = await opendir(directory);
  for await (const entry of stream) {
    if (entry.name === '.syncscope-manifests') {
      continue;
    }
    children.push(entry.name);
  }
  children.sort((left, right) =>
    Buffer.from(left).compare(Buffer.from(right)),
  );

  for (const name of children) {
    const absolute = join(directory, name);
    const metadata = await lstat(absolute, {bigint: true});
    const path = relative(root, absolute);
    let kind = 'other';
    let digest = '-';
    if (metadata.isDirectory()) {
      kind = 'directory';
    } else if (metadata.isFile()) {
      kind = 'regular';
      digest = createHash('sha256')
        .update(await readFile(absolute))
        .digest('hex');
    } else if (metadata.isSymbolicLink()) {
      kind = 'symlink';
      digest = createHash('sha256')
        .update(await readlink(absolute))
        .digest('hex');
    } else if (metadata.isFIFO()) {
      kind = 'fifo';
    }
    entries.push({
      path,
      kind,
      mode: Number(metadata.mode & 0o777n)
        .toString(8)
        .padStart(3, '0'),
      size:
        metadata.isFile() || metadata.isSymbolicLink()
          ? metadata.size.toString()
          : '-',
      modifiedNanoseconds: metadata.mtimeNs.toString(),
      sha256: digest,
    });
    if (metadata.isDirectory()) {
      await visit(absolute);
    }
  }
}

await visit(root);
for (const entry of entries) {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}
