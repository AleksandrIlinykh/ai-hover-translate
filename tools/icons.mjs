// Draws the extension's icons from the pup's resting frame (content/pup.js) into extension/icons/:
// 16, 32 and 48 px with the pixels scaled 1, 2 and 3 times, and 128 px with them scaled 6 times inside the
// 16 px transparent margin the Chrome Web Store asks for. Run `node tools/icons.mjs` after changing the pup.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import '../extension/content/pup.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'extension', 'icons');
const SIZES = [
  { size: 16, scale: 1 },
  { size: 32, scale: 2 },
  { size: 48, scale: 3 },
  { size: 128, scale: 6 },
];

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

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

// An RGBA image as a PNG file.
function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const pup = globalThis.paragloss.heroes.pup;
const [frame] = pup.animations.idle.frames;
const rgb = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

fs.mkdirSync(OUT, { recursive: true });
for (const { size, scale } of SIZES) {
  const rgba = Buffer.alloc(size * size * 4); // transparent
  const offsetX = Math.floor((size - pup.width * scale) / 2);
  const offsetY = Math.floor((size - pup.height * scale) / 2);
  frame.forEach((row, cellY) =>
    [...row].forEach((cell, cellX) => {
      if (cell === '.') return;
      const [r, g, b] = rgb(pup.palette[cell]);
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const at = ((offsetY + cellY * scale + dy) * size + offsetX + cellX * scale + dx) * 4;
          rgba[at] = r;
          rgba[at + 1] = g;
          rgba[at + 2] = b;
          rgba[at + 3] = 255;
        }
      }
    }),
  );
  fs.writeFileSync(path.join(OUT, `icon-${size}.png`), png(size, size, rgba));
}
console.log(`icons written to ${path.relative(ROOT, OUT)}`);
