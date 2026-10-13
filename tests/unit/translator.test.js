import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import '../../extension/content/translator.js';

const { languageCode, sourceLanguage, translateInBrowser, prepareInBrowser, describeProblem, forgetTranslators } =
  globalThis.hoverTranslate;

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

// A Translator whose download finishes only when `finish()` is called; `progress(share)` reports on the way.
function slowTranslator() {
  const log = { creates: 0 };
  let finish;
  let events;
  globalThis.Translator = {
    availability: async () => 'downloadable',
    create: ({ targetLanguage, monitor }) => {
      log.creates++;
      events = new EventTarget();
      monitor?.(events);
      return new Promise((resolve) => {
        finish = () => resolve({ translate: async (text) => `[${targetLanguage}] ${text}` });
      });
    },
  };
  log.progress = (share) => events.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: share }));
  log.finish = () => finish();
  return log;
}

// The detector: German for long texts, unknown for short ones.
function fakeDetector() {
  globalThis.hoverTranslate.detectLanguage = async (text) => [
    { detectedLanguage: text.length > 20 ? 'de' : 'und', confidence: 0.9 },
  ];
}

beforeEach(() => {
  delete globalThis.Translator;
  delete globalThis.hoverTranslate.detectLanguage;
  forgetTranslators();
  setActivation(false);
});

test('languageCode turns a language tag into a code the Translator accepts', () => {
  assert.equal(languageCode('en-US'), 'en');
  assert.equal(languageCode('EN'), 'en');
  assert.equal(languageCode('zh-TW'), 'zh-Hant');
  assert.equal(languageCode('zh-Hant-HK'), 'zh-Hant');
  assert.equal(languageCode('zh-CN'), 'zh');
  assert.equal(languageCode('und'), null);
  assert.equal(languageCode(''), null);
  assert.equal(languageCode(undefined), null);
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

test('the language is detected on the sample, such as the paragraph around a selected word', async () => {
  fakeTranslator('available');
  fakeDetector();
  const result = await translateInBrowser('Haus', 'ru', { sample: 'Das Haus steht am Ende der Strasse.' });
  assert.deepEqual(result, { text: '[ru] Haus', source: 'de' });
});

test('when the detector cannot tell, the language of the page is used', async () => {
  fakeTranslator('available');
  fakeDetector();
  assert.deepEqual(await translateInBrowser('Haus', 'ru', { fallbackLang: 'de' }), { text: '[ru] Haus', source: 'de' });
  assert.deepEqual(await translateInBrowser('Haus', 'ru'), { problem: 'unknown_language' });
});

test('prepareInBrowser makes a ready pair at once and downloads only after a gesture', async () => {
  const log = fakeTranslator('downloadable');
  assert.equal(await prepareInBrowser('en', 'ru'), 'needs_download');
  assert.deepEqual(log.creates, []);
  setActivation(true);
  assert.equal(await prepareInBrowser('en', 'ru'), null);
  setActivation(false);
  assert.deepEqual(await translateInBrowser('Hello', 'ru', { sourceLang: 'en' }), { text: '[ru] Hello', source: 'en' });
  assert.deepEqual(log.creates, ['en>ru']);
  assert.equal(await prepareInBrowser('ru', 'ru'), null);
  delete globalThis.Translator;
  assert.equal(await prepareInBrowser('de', 'ru'), 'unsupported');
});

test('a translation during a download started earlier waits for it and hears its progress, last share first', async () => {
  const log = slowTranslator();
  setActivation(true);
  const prepared = prepareInBrowser('en', 'ru');
  await new Promise((resolve) => setTimeout(resolve, 0));
  log.progress(0.25);
  setActivation(false);
  const progress = [];
  const translated = translateInBrowser('Hello', 'ru', { sourceLang: 'en', onProgress: (share) => progress.push(share) });
  await new Promise((resolve) => setTimeout(resolve, 0));
  log.progress(0.75);
  log.finish();
  assert.deepEqual(await translated, { text: '[ru] Hello', source: 'en' });
  assert.equal(await prepared, null);
  assert.deepEqual(progress, [0.25, 0.75]);
  assert.equal(log.creates, 1);
});

test('a download that fails can be started again', async () => {
  let attempts = 0;
  globalThis.Translator = {
    availability: async () => 'downloadable',
    create: async () => {
      attempts++;
      if (attempts === 1) throw new Error('Network');
      return { translate: async (text) => text };
    },
  };
  setActivation(true);
  assert.equal(await prepareInBrowser('en', 'ru'), 'failed');
  assert.equal(await prepareInBrowser('en', 'ru'), null);
  assert.equal(attempts, 2);
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
