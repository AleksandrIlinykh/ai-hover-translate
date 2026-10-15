import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect } from '@playwright/test';
import { startMockServer } from '../mock-server.js';
import '../../extension/content/strings.js';

export const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');

// The extension keeps its shadow roots closed, so pages cannot read or press anything in them; tests reach inside
// through a copy whose content/config.js opens them. security.spec.js checks that the real one keeps them closed.
const TEST_EXTENSION_PATH = path.join(os.tmpdir(), `paragloss-e2e-${process.pid}`);
fs.rmSync(TEST_EXTENSION_PATH, { recursive: true, force: true });
fs.cpSync(EXTENSION_PATH, TEST_EXTENSION_PATH, { recursive: true });
const config = path.join(TEST_EXTENSION_PATH, 'content/config.js');
fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace("SHADOW_MODE: 'closed'", "SHADOW_MODE: 'open'"));

export const test = base.extend({
  extensionPath: [TEST_EXTENSION_PATH, { option: true }],
  server: async ({}, use) => {
    const server = await startMockServer();
    await use(server);
    await server.close();
  },
  // Hosts under .test lead to the mock server too: sites outside the extension's host permissions, as most real ones are.
  context: async ({ extensionPath }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        '--host-resolver-rules=MAP *.test 127.0.0.1',
      ],
    });
    // Installing opens the welcome page; tests start from a page of their own, so it is closed (and remembered).
    context.welcomed = await closeWelcome(context);
    await use(context);
    await context.close();
  },
  welcomed: async ({ context }, use) => {
    await use(context.welcomed);
  },
  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  // Saves settings with one provider (DeepSeek unless given) pointed at the mock; a blank model means its default.
  // The user has agreed to send texts to AI providers unless `consent` says 0.
  setSettings: async ({ serviceWorker, server }, use) => {
    await use(async (overrides = {}) => {
      const { provider = 'deepseek', targetLang = 'ru', apiKey = 'test-key', model = '', baseUrl = server.url, consent = 1 } = overrides;
      const settings = { provider, targetLang, providers: { [provider]: { apiKey, model, baseUrl } }, consent };
      await serviceWorker.evaluate((value) => chrome.storage.local.set({ settings: value }), settings);
    });
  },
});

export { expect };

// The welcome page Paragloss opens on install: closed, and its address returned (null if it did not open in 5 s).
async function closeWelcome(context) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const welcome = context.pages().find((page) => page.url().endsWith('/welcome.html'));
    if (welcome) {
      const url = welcome.url();
      await welcome.close();
      return url;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

// What Paragloss says in `lang`, from the texts the extension itself uses. The tests translate into Russian, so its
// hints, buttons and errors are in Russian; this keeps the test files in English.
export const say = (key, params = {}, lang = 'ru') => globalThis.paragloss.t(lang, key, params);
export const languageLabel = (code, lang = 'ru') => globalThis.paragloss.languageName(code, lang, { capitalized: true });

export const popupRoot = (page) => page.locator('#paragloss-root');
export const popupText = (page) => popupRoot(page).locator('.text');
export const popupBox = (page) => popupRoot(page).locator('.popup');

export async function moveTo(page, selector, offset = { x: 5, y: 5 }) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + offset.x, box.y + offset.y, { steps: 3 });
}

export async function altHover(page, selector) {
  await moveTo(page, selector);
  await page.keyboard.down('Alt');
}

// Runs `expression` in the extension's isolated world on `page`, where its content scripts live.
// Unlike page.evaluate(), this is not a user gesture.
export async function inContentScript(page, expression) {
  const client = await page.context().newCDPSession(page);
  const worlds = [];
  client.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await client.send('Runtime.enable');
  const world = worlds.find((context) => context.auxData?.type === 'isolated' && context.name === 'Paragloss');
  const { result } = await client.send('Runtime.evaluate', { expression, contextId: world.id, awaitPromise: true, returnByValue: true });
  await client.detach();
  return result.value;
}

// Stand-ins for Chrome's on-device LanguageDetector and Translator, which the test browser lacks. The detector
// says `language`, or `shortTextLanguage` for texts under 20 characters; the translator answers "[ru on device] <text>" and logs every translator it makes in
// globalThis.fakeAI.creates (with whether there was a user gesture). A pair that is not 'available' is downloaded
// on create(), with a progress event at 50% and a pause of `downloadMs`.
// Chrome takes no user gesture from Alt (checked), but Playwright's own actions count as one, so here only a click
// in the last 5 seconds does.
export function fakeBuiltInAI({ availability = 'available', language = 'en', shortTextLanguage = language, downloadMs = 0 } = {}) {
  return `(() => {
    const log = (globalThis.fakeAI = { creates: [], availability: ${JSON.stringify(availability)} });
    let clickedAt = -Infinity;
    addEventListener('click', () => (clickedAt = performance.now()), true);
    Object.defineProperty(navigator, 'userActivation', {
      configurable: true,
      get: () => ({ isActive: performance.now() - clickedAt < 5000 }),
    });
    globalThis.LanguageDetector = {
      availability: async () => 'available',
      create: async () => ({
        detect: async (text) => [
          { detectedLanguage: text.length < 20 ? ${JSON.stringify(shortTextLanguage)} : ${JSON.stringify(language)}, confidence: 0.95 },
        ],
      }),
    };
    globalThis.Translator = {
      availability: async () => log.availability,
      create: async ({ sourceLanguage, targetLanguage, monitor }) => {
        log.creates.push({ sourceLanguage, targetLanguage, activated: navigator.userActivation.isActive });
        if (log.availability !== 'available') {
          const progress = new EventTarget();
          monitor?.(progress);
          progress.dispatchEvent(Object.assign(new Event('downloadprogress'), { loaded: 0.5 }));
          await new Promise((resolve) => setTimeout(resolve, ${downloadMs}));
          log.availability = 'available';
        }
        return { translate: async (text) => '[' + targetLanguage + ' on device] ' + text };
      },
    };
  })()`;
}
