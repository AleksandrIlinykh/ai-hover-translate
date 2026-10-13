import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LANGUAGES, withDefaults } from '../../extension/lib/settings.js';

test('withDefaults returns the defaults when nothing is stored', () => {
  assert.deepEqual(withDefaults(undefined), { ...DEFAULTS });
});

test('withDefaults keeps stored values', () => {
  const stored = { apiKey: 'sk-1', targetLang: 'de', model: 'deepseek-v4-pro', baseUrl: 'https://example.com/v1' };
  assert.deepEqual(withDefaults(stored), stored);
});

test('withDefaults trims values and replaces blanks with defaults', () => {
  assert.deepEqual(withDefaults({ apiKey: '  sk-1\n', model: '   ', baseUrl: '' }), { ...DEFAULTS, apiKey: 'sk-1' });
});

test('withDefaults replaces retired model names with deepseek-flash', () => {
  assert.equal(DEFAULTS.model, 'deepseek-flash');
  assert.equal(withDefaults({ model: 'deepseek-chat' }).model, 'deepseek-flash');
  assert.equal(withDefaults({ model: ' deepseek-reasoner ' }).model, 'deepseek-flash');
});

test('withDefaults falls back to the default language for unknown codes', () => {
  assert.equal(withDefaults({ targetLang: 'xx' }).targetLang, 'ru');
});

test('withDefaults ignores unknown keys and non-string values', () => {
  assert.deepEqual(withDefaults({ extra: 'x', apiKey: 42 }), { ...DEFAULTS });
});

test('every language has a two-letter code and an English name', () => {
  assert.equal(Object.keys(LANGUAGES).length, 13);
  for (const [code, name] of Object.entries(LANGUAGES)) {
    assert.match(code, /^[a-z]{2}$/);
    assert.match(name, /^[A-Z][A-Za-z ()]+$/, code);
  }
  assert.equal(LANGUAGES[DEFAULTS.targetLang], 'Russian');
});
