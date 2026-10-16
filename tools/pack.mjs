// Packs extension/ into dist/spotslate-<version>.zip, the file to upload to the Chrome Web Store or to hand to beta
// testers. Run `npm run pack`. No dependencies: a small ZIP writer with deflate from node:zlib.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'extension');
const { version } = JSON.parse(fs.readFileSync(path.join(SOURCE, 'manifest.json'), 'utf8'));
const OUT = path.join(ROOT, 'dist', `spotslate-${version}.zip`);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// Every file under `dir`, as paths relative to it with forward slashes, sorted so the archive is the same every time.
function filesIn(dir, prefix = '') {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const name = prefix + entry.name;
      return entry.isDirectory() ? filesIn(path.join(dir, entry.name), `${name}/`) : [name];
    })
    .sort();
}

const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // a fixed date, 2026-01-01, for reproducible archives
const local = [];
const central = [];
let offset = 0;
for (const name of filesIn(SOURCE)) {
  const data = fs.readFileSync(path.join(SOURCE, name));
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const nameBytes = Buffer.from(name, 'utf8');
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0x0800, 6); // UTF-8 names
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(0, 10); // time
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBytes.length, 26);
  local.push(header, nameBytes, packed);
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x0800, 8);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(0, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(packed.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, nameBytes);
  offset += header.length + nameBytes.length + packed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.concat([...local, directory, end]));
console.log(`${path.relative(ROOT, OUT)}: ${central.length / 2} files, ${fs.statSync(OUT).size} bytes`);
