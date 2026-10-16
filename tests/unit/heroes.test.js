import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/pup.js';

const { heroes } = globalThis.spotslate;

test('the pup has a dance and a rest, each a loop of frames', () => {
  const { animations } = heroes.pup;
  assert.deepEqual(Object.keys(animations).sort(), ['dance', 'idle']);
  for (const { fps, frames } of Object.values(animations)) {
    assert.ok(fps > 0);
    assert.ok(frames.length >= 2);
  }
});

test('every frame of every hero fills its size with transparent cells and colors of its palette', () => {
  for (const [name, hero] of Object.entries(heroes)) {
    for (const [animation, { frames }] of Object.entries(hero.animations)) {
      frames.forEach((rows, index) => {
        const where = `${name} ${animation} frame ${index}`;
        assert.equal(rows.length, hero.height, where);
        for (const row of rows) {
          assert.equal(row.length, hero.width, where);
          for (const cell of row) assert.ok(cell === '.' || cell in hero.palette, `${where}: ${cell}`);
        }
      });
    }
  }
});

test('the dance moves', () => {
  const frames = heroes.pup.animations.dance.frames.map((rows) => rows.join('\n'));
  assert.ok(new Set(frames).size >= 3);
});
