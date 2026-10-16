import { test, expect, altHover, moveTo, popupRoot, popupText, inContentScript, fakeBuiltInAI, say } from './fixtures.js';

const site = (server) => new URL(server.url).host;

// The toolbar window for the tab of `page`, opened as a page of its own (the real one is a popup on the active tab).
async function toolbarFor(page, context, serviceWorker, extensionId) {
  const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, page.url());
  const toolbar = await context.newPage();
  await toolbar.goto(`chrome-extension://${extensionId}/compose.html?tab=${tabId}`);
  await expect(toolbar.locator('.site-switch')).toBeVisible();
  return toolbar;
}

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('the toolbar window starts with a switch for the site, on, naming it', async ({ page, context, serviceWorker, extensionId, server }) => {
  await page.goto(`${server.url}/page.html`);
  const toolbar = await toolbarFor(page, context, serviceWorker, extensionId);
  await expect(toolbar.locator('body > :first-child')).toHaveClass(/site/);
  await expect(toolbar.locator('.site-switch')).toBeChecked();
  await expect(toolbar.locator('.site-name')).toHaveText(say('siteSwitch', { site: site(server) }));
  await expect(toolbar.locator('.site-ai')).toBeChecked();
  await expect(toolbar.locator('.ai-label')).toHaveText(say('siteAi', { provider: 'DeepSeek' }));
  await expect(toolbar.locator('.site-context')).toBeChecked();
});

test('switched off, the site gets nothing from SpotSlate at once, and switched on again it does', async ({ page, context, serviceWorker, extensionId, server }) => {
  await page.goto(`${server.url}/page.html`);
  const toolbar = await toolbarFor(page, context, serviceWorker, extensionId);
  await toolbar.locator('.site-switch').uncheck();
  await expect(toolbar.locator('.site-switch')).not.toBeChecked();
  await expect(toolbar.locator('.site-off')).toHaveText(say('siteOff'));
  await expect(toolbar.locator('.site-ai')).toBeHidden();
  await page.bringToFront();
  await page.evaluate(() => {
    window.pageAltT = 0;
    addEventListener('keydown', (event) => event.code === 'KeyT' && event.altKey && window.pageAltT++);
  });
  await altHover(page, '#p1');
  await page.waitForTimeout(600);
  await expect(popupRoot(page)).toHaveCount(0);
  await expect(page.locator('#spotslate-hero')).toHaveCount(0);
  await expect(page.locator('#spotslate-highlight')).toBeHidden();
  await page.keyboard.press('KeyT'); // Alt+T, still held: the page gets it
  await page.keyboard.up('Alt');
  expect(await page.evaluate(() => window.pageAltT)).toBe(1);
  await expect(page.locator('#spotslate-compose')).toHaveCount(0);
  expect(server.requests).toHaveLength(0);

  await toolbar.bringToFront();
  await toolbar.locator('.site-switch').check();
  await page.bringToFront();
  await altHover(page, '#p2');
  await expect(popupText(page)).toContainText('[RU] Second paragraph');
});

test('without the AI on a site, it is translated by Chrome and nothing is sent', async ({ page, context, serviceWorker, extensionId, server }) => {
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI());
  const toolbar = await toolbarFor(page, context, serviceWorker, extensionId);
  await toolbar.locator('.site-ai').uncheck();
  await expect(toolbar.locator('.site-context')).toBeHidden(); // no AI here, so no context to learn
  await page.bringToFront();
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[ru on device] The quick brown fox');
  await expect(popupRoot(page).locator('.foot')).toBeHidden(); // no site context without an AI
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await moveTo(page, '#comment', { x: 20, y: 10 });
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await expect(page.locator('#spotslate-compose .engine')).toHaveText(say('onDevice'));
  expect(server.requests).toHaveLength(0);
  expect(server.notesRequests).toHaveLength(0);
});

test('not learning a site context clears it, sends none and hides the button', async ({ page, context, serviceWorker, extensionId, server }) => {
  await page.goto(`${server.url}/long.html`);
  await altHover(page, '#long');
  await expect(popupText(page)).toContainText('[RU]');
  await expect.poll(() => server.notesRequests.length).toBe(1);
  await page.waitForTimeout(800);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  const toolbar = await toolbarFor(page, context, serviceWorker, extensionId);
  await toolbar.locator('.site-context').uncheck();
  expect(await serviceWorker.evaluate((key) => chrome.storage.session.get(key), `notes:${site(server)}`)).toEqual({});
  await page.bringToFront();
  await altHover(page, '#long2');
  await expect(popupText(page)).toContainText('[RU]');
  await expect(popupRoot(page).locator('.foot')).toBeHidden();
  await page.waitForTimeout(1000);
  expect(server.notesRequests).toHaveLength(1);
  expect(server.requests.at(-1).body.messages).toHaveLength(2); // no reference turn
});

test('the settings list the sites with a mode of their own, and Reset brings a site back', async ({ page, context, serviceWorker, extensionId, server }) => {
  await page.goto(`${server.url}/page.html`);
  const toolbar = await toolbarFor(page, context, serviceWorker, extensionId);
  await toolbar.locator('.site-switch').uncheck();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  const row = options.locator('#sites li', { hasText: site(server) });
  await expect(row).toContainText('Off');
  await row.getByRole('button', { name: 'Reset' }).click();
  await expect(options.locator('#sites li')).toHaveCount(0);
  await expect(options.locator('#sitesEmpty')).toBeVisible();
  await page.bringToFront();
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[RU] The quick brown fox');
});
