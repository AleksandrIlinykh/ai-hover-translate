import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/correction.js';

const { parseCorrection, diffWords } = globalThis.spotslate;

// The user writes German here; the project's files keep to the Latin script.

test('parseCorrection reads the corrected text and one note a line', () => {
  const answer =
    '<corrected>\nGestern bin ich nach Hause gegangen.\n</corrected>\n' +
    '<notes>\n- bin ich: the verb comes second\n- bin: sein with verbs of motion\n</notes>';
  assert.deepEqual(parseCorrection(answer), {
    corrected: 'Gestern bin ich nach Hause gegangen.',
    notes: ['bin ich: the verb comes second', 'bin: sein with verbs of motion'],
  });
});

test('parseCorrection keeps the line breaks of the text, and empty notes are none', () => {
  const answer = '<corrected>\nHallo Team,\n\nder Build ist rot.\n</corrected>\n<notes>\n</notes>';
  assert.deepEqual(parseCorrection(answer), { corrected: 'Hallo Team,\n\nder Build ist rot.', notes: [] });
});

test('parseCorrection takes an answer without the tags as the corrected text, with no notes', () => {
  assert.deepEqual(parseCorrection('  Der Build ist rot.\n'), { corrected: 'Der Build ist rot.', notes: [] });
});

test('parseCorrection copes with the closing tags missing', () => {
  assert.deepEqual(parseCorrection('<corrected>\nDer Build ist rot.\n<notes>\n* ist: one\n'), {
    corrected: 'Der Build ist rot.',
    notes: ['ist: one'],
  });
});

test('diffWords marks the words removed and added, and keeps the rest as the corrected text has it', () => {
  assert.deepEqual(diffWords('Gestern ich habe nach Hause gegangen.', 'Gestern bin ich nach Hause gegangen.'), [
    { type: 'same', text: 'Gestern ' },
    { type: 'added', text: 'bin ' },
    { type: 'same', text: 'ich ' },
    { type: 'removed', text: 'habe ' },
    { type: 'same', text: 'nach Hause gegangen.' },
  ]);
});

test('diffWords puts what was removed before what took its place', () => {
  assert.deepEqual(diffWords('teh cat sat', 'the cat sat'), [
    { type: 'removed', text: 'teh ' },
    { type: 'added', text: 'the ' },
    { type: 'same', text: 'cat sat' },
  ]);
});

test('diffWords sees no change in the spaces alone, and none in the same text', () => {
  assert.deepEqual(diffWords('Hallo  Team,\nder Build', 'Hallo Team,\nder Build'), [{ type: 'same', text: 'Hallo Team,\nder Build' }]);
  assert.deepEqual(diffWords('', 'Hallo'), [{ type: 'added', text: 'Hallo' }]);
});

test('diffWords copes with the longest drafts', () => {
  const before = Array.from({ length: 600 }, (_, i) => `w${i}`).join(' ');
  const after = before.replace('w300', 'x300');
  const parts = diffWords(before, after);
  assert.deepEqual(
    parts.filter(({ type }) => type !== 'same'),
    [
      { type: 'removed', text: 'w300 ' },
      { type: 'added', text: 'x300 ' },
    ],
  );
  assert.equal(parts.filter(({ type }) => type !== 'removed').map(({ text }) => text).join(''), after);
});
