import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/translator.js';

const { sourceLanguage, translateInBrowser, describeProblem, forgetTranslators } = globalThis.hoverTranslate;

// A stand-in for Chrome's Translator: `availability` for every pair, and a log of what was created.
function fakeTranslator(availability) {
  const log = { creates: [] };
  globalThis.Translator = {
    availability: async () => availability,
    create: async ({ sourceLanguage: from, targetLanguage: to, monitor }) => {
      log.creates.push(`${from}>${to}`);
      const events = new EventTarget();
      monitor?.(events);
      events.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 1 }));
      return { translate: async (text) => `[${to}] ${text}` };
    },
  };
  return log;
}

function setActivation(isActive) {
  Object.defineProperty(globalThis.navigator, 'userActivation', { value: { isActive }, configurable: true });
}

beforeEach(() => {
  delete globalThis.Translator;
  forgetTranslators();
  setActivation(false);
});

test('sourceLanguage takes the confident top guess as a code the Translator accepts', () => {
  assert.equal(sourceLanguage([{ detectedLanguage: 'en', confidence: 0.9 }]), 'en');
  assert.equal(sourceLanguage([{ detectedLanguage: 'pt-BR', confidence: 0.7 }]), 'pt');
  assert.equal(sourceLanguage([{ detectedLanguage: 'zh-Hant', confidence: 0.8 }]), 'zh-Hant');
  assert.equal(sourceLanguage([{ detectedLanguage: 'und', confidence: 0.9 }]), null);
  assert.equal(sourceLanguage([{ detectedLanguage: 'en', confidence: 0.1 }]), null);
  assert.equal(sourceLanguage([]), null);
});

test('without the Translator API the browser cannot translate', async () => {
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), { problem: 'unsupported' });
});

test('a ready pair translates, and its translator is made once', async () => {
  const log = fakeTranslator('available');
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), { text: '[ru] Hello', source: 'en' });
  assert.deepEqual(await translateInBrowser('Bye', 'ru', { sourceLang: 'en' }), { text: '[ru] Bye', source: 'en' });
  assert.deepEqual(log.creates, ['en>ru']);
});

test('text already in the target language comes back as it is', async () => {
  const log = fakeTranslator('available');
  assert.deepEqual(await translateInBrowser('Hallo', 'de', { sourceLang: 'de' }), { text: 'Hallo', source: 'de' });
  assert.deepEqual(log.creates, []);
});

test('a pair to download waits for a click, then reports the download progress', async () => {
  const log = fakeTranslator('downloadable');
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), { problem: 'needs_download', source: 'en' });
  assert.deepEqual(log.creates, []);
  setActivation(true);
  const progress = [];
  const result = await translateInBrowser('Hello', 'ru', { sourceLang: 'en', onProgress: (share) => progress.push(share) });
  assert.deepEqual(result, { text: '[ru] Hello', source: 'en' });
  assert.deepEqual(progress, [1]);
});

test('a pair the device cannot translate is reported', async () => {
  fakeTranslator('unavailable');
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), { problem: 'unavailable', source: 'en' });
});

test('a failing translator is reported with its message', async () => {
  globalThis.Translator = {
    availability: async () => 'available',
    create: async () => ({
      translate: async () => {
        throw new Error('Out of memory');
      },
    }),
  };
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), {
    problem: 'failed',
    source: 'en',
    detail: 'Out of memory',
  });
});

test('without a language detector the source language cannot be found', async () => {
  fakeTranslator('available');
  assert.deepEqual(await translateInBrowser('Hello', 'ru'), { problem: 'unsupported' });
});

test('describeProblem explains each problem and offers the matching button', () => {
  assert.deepEqual(describeProblem({ problem: 'needs_download', source: 'en' }, 'ru'), {
    message: 'Chrome needs to download its English to Russian model once.',
    action: 'download',
  });
  assert.deepEqual(describeProblem({ problem: 'unavailable', source: 'en' }, 'ko'), {
    message: 'Chrome cannot translate English to Korean on this computer. Choose an AI provider in the settings.',
    action: 'settings',
  });
  assert.deepEqual(describeProblem({ problem: 'unsupported' }, 'ru'), {
    message: 'This browser has no built-in translator. Choose an AI provider in the settings.',
    action: 'settings',
  });
  assert.deepEqual(describeProblem({ problem: 'unknown_language' }, 'ru'), {
    message: 'Could not tell which language this text is in.',
    action: 'retry',
  });
  assert.deepEqual(describeProblem({ problem: 'failed', source: 'en', detail: 'Out of memory' }, 'ru'), {
    message: 'The built-in translator failed: Out of memory',
    action: 'retry',
  });
});
