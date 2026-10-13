import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/selection.js';

const { wordsAround } = globalThis.hoverTranslate;

// The words around the first occurrence of `phrase` in `text`.
const around = (text, phrase) => {
  const start = text.indexOf(phrase);
  return wordsAround(text, start, start + phrase.length);
};

const SENTENCE =
  'After the long weekend merge of the shared build pipeline failed on the main branch and nobody noticed it for a week.';

test('wordsAround keeps at most 8 words on each side of the phrase', () => {
  assert.equal(
    around(SENTENCE, 'pipeline'),
    'the long weekend merge of the shared build pipeline failed on the main branch and nobody noticed',
  );
});

test('wordsAround stays inside the sentence of the phrase', () => {
  assert.equal(around('We shipped it. The build pipeline failed again. Then we fixed it.', 'pipeline'), 'The build pipeline failed again');
});

test('wordsAround returns nothing when there are no other words', () => {
  assert.equal(around('Pipeline', 'Pipeline'), '');
  assert.equal(around('Done. Pipeline. Done.', 'Pipeline'), '');
});

test('wordsAround collapses whitespace and line breaks', () => {
  assert.equal(around('the  build\n  pipeline   failed', 'pipeline'), 'the build pipeline failed');
});

test('wordsAround works for non-Latin scripts', () => {
  assert.equal(
    around('Καθίσαμε στην όχθη του ποταμού και κοιτάξαμε το νερό.', 'όχθη'),
    'Καθίσαμε στην όχθη του ποταμού και κοιτάξαμε το νερό',
  );
});
