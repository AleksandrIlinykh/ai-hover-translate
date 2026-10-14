import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect } from '@playwright/test';
import { startMockServer } from '../mock-server.js';

const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');

export const test = base.extend({
  server: async ({}, use) => {
    const server = await startMockServer();
    await use(server);
    await server.close();
  },
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  // Saves settings with one provider (DeepSeek unless given) pointed at the mock; a blank model means its default.
  setSettings: async ({ serviceWorker, server }, use) => {
    await use(async (overrides = {}) => {
      const { provider = 'deepseek', targetLang = 'ru', apiKey = 'test-key', model = '', baseUrl = server.url } = overrides;
      const settings = { provider, targetLang, providers: { [provider]: { apiKey, model, baseUrl } } };
      await serviceWorker.evaluate((value) => chrome.storage.local.set({ settings: value }), settings);
    });
  },
});

export { expect };

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
