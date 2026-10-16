import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/strings.js';
import { LANGUAGES } from '../../extension/lib/settings.js';

const { STRINGS, t, languageName } = globalThis.spotslate;
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

test('every language SpotSlate translates into has every text, with the same placeholders as English', () => {
  assert.deepEqual(Object.keys(STRINGS).sort(), Object.keys(LANGUAGES).sort());
  for (const [lang, table] of Object.entries(STRINGS)) {
    assert.deepEqual(Object.keys(table).sort(), Object.keys(STRINGS.en).sort(), lang);
    for (const [key, text] of Object.entries(table)) {
      assert.deepEqual(placeholders(text), placeholders(STRINGS.en[key]), `${lang}.${key}`);
      assert.ok(text.trim() !== '', `${lang}.${key}`);
    }
  }
});

test('t fills the placeholders and falls back to English', () => {
  assert.equal(t('en', 'noKey', { name: 'DeepSeek' }), 'DeepSeek API key is not set.');
  assert.equal(t('de', 'copy'), 'Kopieren');
  assert.equal(t('xx', 'copy'), 'Copy');
  assert.equal(t('en', 'http', { status: 418, tail: '' }), 'API error 418');
  assert.equal(t('en', 'downloading', {}), 'Downloading the translation model: {percent}%');
});

test('language names come in the language of the interface, capitalized for labels', () => {
  assert.equal(languageName('de', 'en'), 'German');
  assert.equal(languageName('en', 'de'), 'Englisch');
  assert.equal(languageName('en', 'fr'), 'anglais');
  assert.equal(languageName('en', 'fr', { capitalized: true }), 'Anglais');
  assert.equal(languageName('zh', 'en'), 'Simplified Chinese');
});
