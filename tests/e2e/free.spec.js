import { test, expect, altHover, moveTo, popupRoot, popupText, inContentScript, fakeBuiltInAI } from './fixtures.js';

const textOf = (page, selector) => page.locator(selector).evaluate((element) => element.textContent);
const button = (page, name) => popupRoot(page).locator(`.${name}`);
const fakeLog = (page) => inContentScript(page, 'globalThis.fakeAI');

test.beforeEach(async ({ setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '' });
});

test('the free translator translates on the page and sends nothing anywhere', async ({ page, server }) => {
  await page.goto(`${server.url}/topics.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altHover(page, '#long');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#long')}`);
  await page.waitForTimeout(300);
  expect(server.requests).toHaveLength(0);
  expect(server.topicRequests).toHaveLength(0);
  expect((await fakeLog(page)).creates).toEqual([{ sourceLanguage: 'en', targetLanguage: 'ru', activated: false }]);
});

test('a language pair to download asks for one click, shows the progress, then translates', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ availability: 'downloadable', downloadMs: 800 }));
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('Chrome needs to download its English to Russian model once.');
  expect((await fakeLog(page)).creates).toEqual([]);
  await page.keyboard.up('Alt');
  await button(page, 'download').click();
  await expect(popupText(page)).toHaveText('Downloading the translation model: 50%');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#p1')}`);
  expect((await fakeLog(page)).creates).toEqual([{ sourceLanguage: 'en', targetLanguage: 'ru', activated: true }]);
});

test('a pair Chrome cannot translate offers the settings', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ availability: 'unavailable' }));
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(
    'Chrome cannot translate English to Russian on this computer. Choose an AI provider in the settings.',
  );
  await expect(button(page, 'settings')).toBeVisible();
  await expect(button(page, 'download')).toBeHidden();
});

test('a browser without the built-in translator suggests an AI provider', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('This browser has no built-in translator. Choose an AI provider in the settings.');
  await expect(button(page, 'settings')).toBeVisible();
  expect(server.requests).toHaveLength(0);
});

test('switching to an AI provider takes effect on open pages', async ({ page, server, setSettings }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[ru on device]');
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await setSettings({ provider: 'deepseek' });
  await moveTo(page, '#p2');
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toHaveText(`[RU] ${await textOf(page, '#p2')}`);
  expect(server.requests).toHaveLength(1);
});
