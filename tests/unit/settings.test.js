import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LANGUAGES, activeProvider, withDefaults } from '../../extension/lib/settings.js';
import { PROVIDERS } from '../../extension/lib/providers.js';
import { DEFAULT_KEYS } from '../../extension/lib/keys.js';

test('withDefaults returns the free built-in translator, Russian, no provider entries and the default keys when nothing is stored', () => {
  assert.deepEqual(withDefaults(undefined), { provider: 'chrome', targetLang: 'ru', providers: {}, keys: DEFAULT_KEYS });
  assert.deepEqual(DEFAULTS, { provider: 'chrome', targetLang: 'ru' });
});

test('withDefaults keeps the chosen provider and every provider entry, trimmed', () => {
  const stored = {
    provider: 'openai',
    targetLang: 'de',
    providers: {
      openai: { apiKey: ' sk-o\n', model: ' gpt-x ', baseUrl: '' },
      deepseek: { apiKey: 'sk-d', model: '', baseUrl: 'https://example.com/v1' },
    },
  };
  assert.deepEqual(withDefaults(stored), {
    provider: 'openai',
    targetLang: 'de',
    providers: {
      openai: { apiKey: 'sk-o', model: 'gpt-x', baseUrl: '' },
      deepseek: { apiKey: 'sk-d', model: '', baseUrl: 'https://example.com/v1' },
    },
    keys: DEFAULT_KEYS,
  });
});

test('withDefaults drops unknown providers, unknown fields and non-string values', () => {
  const stored = { provider: 'nope', providers: { nope: { apiKey: 'x' }, openai: { apiKey: 42, extra: 'y' } } };
  assert.deepEqual(withDefaults(stored), {
    provider: 'chrome',
    targetLang: 'ru',
    providers: { openai: { apiKey: '', model: '', baseUrl: '' } },
    keys: DEFAULT_KEYS,
  });
});

test('withDefaults falls back to the default language for unknown codes', () => {
  assert.equal(withDefaults({ targetLang: 'xx' }).targetLang, 'ru');
});

test('settings saved before providers existed become the DeepSeek entry', () => {
  const old = { apiKey: ' sk-1 ', targetLang: 'de', model: 'deepseek-v4-pro', baseUrl: 'https://example.com' };
  assert.deepEqual(withDefaults(old), {
    provider: 'deepseek',
    targetLang: 'de',
    providers: { deepseek: { apiKey: 'sk-1', model: 'deepseek-v4-pro', baseUrl: 'https://example.com' } },
    keys: DEFAULT_KEYS,
  });
});

test('withDefaults keeps keys allowed on the platform and replaces the rest with the defaults', () => {
  const write = { ctrl: true, alt: false, shift: true, meta: false, code: 'KeyK' };
  assert.deepEqual(withDefaults({ keys: { read: 'Control', write } }, 'win').keys, { read: 'Control', write });
  const refused = { ctrl: false, alt: true, shift: false, meta: false, code: 'KeyF' };
  assert.deepEqual(withDefaults({ keys: { read: 'Control', write: refused } }, 'win').keys, { read: 'Control', write: DEFAULT_KEYS.write });
  assert.deepEqual(withDefaults({ keys: { read: 'Control', write: refused } }, 'mac').keys, { read: 'Control', write: refused });
});

test('retired DeepSeek model names fall back to the default model', () => {
  assert.equal(withDefaults({ apiKey: 'sk', model: 'deepseek-chat' }).providers.deepseek.model, '');
  const stored = { providers: { deepseek: { model: ' deepseek-reasoner ' } } };
  assert.equal(withDefaults(stored).providers.deepseek.model, '');
});

test('activeProvider gives the free translator without a key, model or URL', () => {
  const active = activeProvider(withDefaults(undefined));
  assert.equal(active.id, 'chrome');
  assert.equal(active.api, 'browser');
  assert.equal(active.baseUrl, '');
});

test('activeProvider fills a blank model and URL with the provider defaults', () => {
  const active = activeProvider(withDefaults({ provider: 'deepseek', providers: { deepseek: { apiKey: 'sk' } } }));
  assert.equal(active.id, 'deepseek');
  assert.equal(active.name, 'DeepSeek');
  assert.equal(active.apiKey, 'sk');
  assert.equal(active.model, PROVIDERS.deepseek.model);
  assert.equal(active.baseUrl, PROVIDERS.deepseek.baseUrl);
});

test('activeProvider keeps a chosen model and URL, without trailing slashes', () => {
  const stored = { provider: 'openai', providers: { openai: { model: 'gpt-x', baseUrl: 'https://proxy.example/v1//' } } };
  const active = activeProvider(withDefaults(stored));
  assert.equal(active.model, 'gpt-x');
  assert.equal(active.baseUrl, 'https://proxy.example/v1');
  assert.equal(active.apiKey, '');
});

test('every language has a two-letter code and an English name', () => {
  assert.equal(Object.keys(LANGUAGES).length, 13);
  for (const [code, name] of Object.entries(LANGUAGES)) {
    assert.match(code, /^[a-z]{2}$/);
    assert.match(name, /^[A-Z][A-Za-z ()]+$/, code);
  }
  assert.equal(LANGUAGES[DEFAULTS.targetLang], 'Russian');
});
