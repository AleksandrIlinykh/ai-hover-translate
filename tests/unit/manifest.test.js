import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXTENSION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');
const manifest = JSON.parse(fs.readFileSync(path.join(EXTENSION, 'manifest.json'), 'utf8'));

// Width and height from a PNG's header.
function pngSize(file) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.toString('ascii', 1, 4), 'PNG', file);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

test('the extension and its toolbar button have icons of every declared size, 128 px for the store', () => {
  assert.deepEqual(Object.keys(manifest.icons).sort(), ['128', '16', '32', '48']);
  for (const icons of [manifest.icons, manifest.action.default_icon]) {
    for (const [size, file] of Object.entries(icons)) {
      assert.deepEqual(pngSize(path.join(EXTENSION, file)), [Number(size), Number(size)], file);
    }
  }
});

test('every content script the manifest lists exists', () => {
  for (const file of manifest.content_scripts.flatMap((entry) => entry.js)) {
    assert.ok(fs.existsSync(path.join(EXTENSION, file)), file);
  }
});

test('the welcome page loads the content scripts in the manifest order, so the gestures work on it', () => {
  const html = fs.readFileSync(path.join(EXTENSION, 'welcome.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(([, file]) => file);
  assert.deepEqual(scripts, manifest.content_scripts[0].js);
});
