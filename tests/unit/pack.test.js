import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const EXTENSION = path.join(ROOT, 'extension');

// The files of a ZIP archive, by name, read through its central directory.
function unzip(file) {
  const zip = fs.readFileSync(file);
  const end = zip.length - 22;
  assert.equal(zip.readUInt32LE(end), 0x06054b50, 'end of central directory');
  const files = new Map();
  let at = zip.readUInt32LE(end + 16);
  for (let index = 0; index < zip.readUInt16LE(end + 10); index++) {
    assert.equal(zip.readUInt32LE(at), 0x02014b50, 'central directory entry');
    const nameLength = zip.readUInt16LE(at + 28);
    const name = zip.toString('utf8', at + 46, at + 46 + nameLength);
    const local = zip.readUInt32LE(at + 42);
    const size = zip.readUInt32LE(local + 18);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    files.set(name, zlib.inflateRawSync(zip.subarray(start, start + size)));
    at += 46 + nameLength + zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32);
  }
  return files;
}

const sourceFiles = (dir, prefix = '') =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sourceFiles(path.join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
  );

test('npm run pack puts every file of extension/ into the zip for the store, unchanged', () => {
  execFileSync(process.execPath, [path.join(ROOT, 'tools', 'pack.mjs')], { cwd: ROOT, stdio: 'pipe' });
  const { version } = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));
  const files = unzip(path.join(ROOT, 'dist', `spotslate-${version}.zip`));
  assert.deepEqual([...files.keys()].sort(), sourceFiles(EXTENSION).sort());
  for (const [name, data] of files) assert.ok(data.equals(fs.readFileSync(path.join(EXTENSION, name))), name);
  assert.ok(files.has('manifest.json'), 'the manifest is at the top of the archive');
});
