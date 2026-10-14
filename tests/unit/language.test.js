import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/language.js';

const { isAlreadyIn, alreadyInLanguage } = globalThis.paragloss;

test('isAlreadyIn trusts a confident match of the primary language', () => {
  assert.equal(isAlreadyIn([{ detectedLanguage: 'en', confidence: 0.95 }], 'en'), true);
  assert.equal(isAlreadyIn([{ detectedLanguage: 'zh-Hant', confidence: 0.9 }], 'zh'), true);
});

test('isAlreadyIn ignores weak, different or missing guesses', () => {
  assert.equal(isAlreadyIn([{ detectedLanguage: 'en', confidence: 0.5 }], 'en'), false);
  assert.equal(isAlreadyIn([{ detectedLanguage: 'de', confidence: 0.99 }], 'en'), false);
  assert.equal(isAlreadyIn([], 'en'), false);
  assert.equal(isAlreadyIn(undefined, 'en'), false);
});

test('alreadyInLanguage is false when the browser has no language detector', async () => {
  assert.equal(await alreadyInLanguage('Hello there', 'en'), false);
});
