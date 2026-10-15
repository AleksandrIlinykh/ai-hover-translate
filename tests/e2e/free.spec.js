import { test, expect, altHover, moveTo, popupRoot, popupText, inContentScript, fakeBuiltInAI } from './fixtures.js';

const textOf = (page, selector) => page.locator(selector).evaluate((element) => element.textContent);
const button = (page, name) => popupRoot(page).locator(`.${name}`);
const fakeLog = (page) => inContentScript(page, 'globalThis.fakeAI');

// Selects the first `phrase` in `selector`, then holds Alt over it.
async function altOverPhrase(page, selector, phrase) {
  const rect = await page.locator(selector).evaluate((element, wanted) => {
    const node = element.firstChild;
    const start = node.textContent.indexOf(wanted);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, start + wanted.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const { x, y, width, height } = range.getBoundingClientRect();
    return { x, y, width, height };
  }, phrase);
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 3 });
  await page.keyboard.down('Alt');
}

// A click on the page away from any text.
const clickAside = (page) => page.mouse.click(5, 5);

test.beforeEach(async ({ setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '' });
});

test('the free translator translates on the page and sends nothing anywhere', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altHover(page, '#long');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#long')}`);
  await page.waitForTimeout(300);
  expect(server.requests).toHaveLength(0);
  expect(server.notesRequests).toHaveLength(0);
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
  // Whether the test browser has these APIs depends on its build; here it must not.
  await inContentScript(page, 'delete globalThis.Translator; delete globalThis.LanguageDetector');
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

test('a click on a page in another language prepares its model, so Alt translates at once', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ availability: 'downloadable' }));
  await clickAside(page);
  await expect.poll(async () => (await fakeLog(page)).creates).toEqual([
    { sourceLanguage: 'en', targetLanguage: 'ru', activated: true },
  ]);
  await expect(popupRoot(page)).toHaveCount(0);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#p1')}`);
  expect((await fakeLog(page)).creates).toHaveLength(1);
});

test('Alt during a download started by a click shows its progress and then the translation', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ availability: 'downloadable', downloadMs: 1500 }));
  await clickAside(page);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('Downloading the translation model: 50%');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#p1')}`);
  expect((await fakeLog(page)).creates).toHaveLength(1);
});

test('a page in the target language prepares nothing', async ({ page, server, setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '', targetLang: 'en' });
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ availability: 'downloadable' }));
  await clickAside(page);
  await page.waitForTimeout(300);
  expect((await fakeLog(page)).creates).toEqual([]);
});

test('a selected word is translated from the language of its paragraph', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ language: 'de', shortTextLanguage: 'und' }));
  await altOverPhrase(page, '#p1', 'fox');
  await expect(popupText(page)).toHaveText('[ru on device] fox');
  expect((await fakeLog(page)).creates).toEqual([{ sourceLanguage: 'de', targetLanguage: 'ru', activated: false }]);
});

test('text whose language cannot be told is translated from the language of the page', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI({ language: 'und' }));
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[ru on device] ${await textOf(page, '#p1')}`);
  expect((await fakeLog(page)).creates[0].sourceLanguage).toBe('en');
});
