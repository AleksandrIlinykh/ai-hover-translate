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
  setSettings: async ({ serviceWorker, server }, use) => {
    await use(async (overrides = {}) => {
      const settings = { apiKey: 'test-key', targetLang: 'ru', model: 'deepseek-flash', baseUrl: server.url, ...overrides };
      await serviceWorker.evaluate((value) => chrome.storage.local.set({ settings: value }), settings);
    });
  },
});

export { expect };

export const popupRoot = (page) => page.locator('#hover-translate-root');
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
