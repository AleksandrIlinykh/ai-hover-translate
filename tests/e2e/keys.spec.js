import { test, expect, moveTo, popupRoot, popupText } from './fixtures.js';

const compose = (page) => page.locator('#paragloss-compose');

async function openOptions(context, extensionId) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.locator('#fields')).toBeEnabled();
  return options;
}

const storedKeys = (serviceWorker) => serviceWorker.evaluate(async () => (await chrome.storage.local.get('settings')).settings?.keys);

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('the settings show Alt to read and Alt+T to write', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await expect(options.locator('#readKey')).toHaveValue('Alt');
  await expect(options.locator('#writeKey')).toHaveValue('Alt+T');
  await expect(options.locator('#intro')).toHaveText('Hold Alt and hover over a paragraph to see its translation above it.');
});

test('new keys work at once on a page that is already open', async ({ page, context, extensionId, server }) => {
  await page.goto(`${server.url}/page.html`);
  const options = await openOptions(context, extensionId);
  await options.locator('#readKey').selectOption('Control');
  await options.locator('#writeKey').click();
  await options.keyboard.press('Alt+KeyW');
  await expect(options.locator('#writeKey')).toHaveValue('Alt+W');
  await options.locator('button[type=submit]').click();
  await expect(options.locator('#status')).toHaveText('Saved');
  await expect(options.locator('#intro')).toHaveText('Hold Ctrl and hover over a paragraph to see its translation above it.');

  await page.bringToFront();
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await page.waitForTimeout(500);
  await expect(popupRoot(page)).toHaveCount(0);
  await page.keyboard.up('Alt');
  await page.keyboard.down('Control');
  await expect(popupText(page)).toContainText('[RU] The quick brown fox');
  await page.keyboard.up('Control');
  await page.keyboard.press('Escape');

  await page.keyboard.press('Alt+KeyT');
  await page.waitForTimeout(300);
  await expect(compose(page)).toHaveCount(0);
  await page.keyboard.press('Alt+KeyW');
  await expect(compose(page).locator('.draft')).toBeFocused();
});

test('the hint over a field names the key held to read', async ({ page, context, extensionId, server }) => {
  const options = await openOptions(context, extensionId);
  await options.locator('#readKey').selectOption('Control');
  await options.locator('button[type=submit]').click();
  await expect(options.locator('#status')).toHaveText('Saved');
  await page.goto(`${server.url}/page.html`);
  await moveTo(page, '#comment');
  await page.keyboard.down('Control');
  await expect(page.locator('#paragloss-highlight')).toContainText('Ctrl+click: write in Russian.');
});

test('a shortcut that types or that Chrome needs is refused with the reason and never saved', async ({ context, extensionId, serviceWorker }) => {
  const options = await openOptions(context, extensionId);
  const field = options.locator('#writeKey');
  await field.click();
  await options.keyboard.press('KeyK');
  await expect(options.locator('#keysProblem')).toHaveText('Add Alt or Ctrl: without them the key types text.');
  await options.keyboard.press('Control+KeyK');
  await expect(options.locator('#keysProblem')).toHaveText('Ctrl with a letter or a digit belongs to the browser and to text editing.');
  await options.keyboard.press('Alt+KeyF');
  await expect(options.locator('#keysProblem')).toHaveText('Alt+F opens the Chrome menu.');
  await expect(field).toHaveValue('Alt+T');
  await options.keyboard.press('Alt+KeyW');
  await expect(options.locator('#keysProblem')).toHaveText('');
  await options.locator('button[type=submit]').click();
  await expect(options.locator('#status')).toHaveText('Saved');
  expect((await storedKeys(serviceWorker)).write.code).toBe('KeyW');
});

test('Tab leaves the shortcut field instead of being recorded', async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await options.locator('#writeKey').click();
  await options.keyboard.press('Tab');
  await expect(options.locator('#writeKey')).not.toBeFocused();
  await expect(options.locator('#writeKey')).toHaveValue('Alt+T');
  await expect(options.locator('#keysProblem')).toHaveText('');
});

test('Reset keys brings back Alt and Alt+T', async ({ context, extensionId, serviceWorker }) => {
  const options = await openOptions(context, extensionId);
  await options.locator('#readKey').selectOption('Control');
  await options.locator('#writeKey').click();
  await options.keyboard.press('Alt+KeyW');
  await options.locator('button[type=submit]').click();
  await expect(options.locator('#status')).toHaveText('Saved');
  await options.locator('#resetKeys').click();
  await expect(options.locator('#readKey')).toHaveValue('Alt');
  await expect(options.locator('#writeKey')).toHaveValue('Alt+T');
  await options.locator('button[type=submit]').click();
  await expect.poll(() => storedKeys(serviceWorker)).toMatchObject({ read: 'Alt', write: { alt: true, code: 'KeyT' } });
});

test('keys that are refused here are replaced by the defaults when read from storage', async ({ context, extensionId, serviceWorker }) => {
  await serviceWorker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    const write = { ctrl: true, alt: false, shift: false, meta: false, code: 'KeyT' };
    await chrome.storage.local.set({ settings: { ...settings, keys: { read: 'Shift', write } } });
  });
  const options = await openOptions(context, extensionId);
  await expect(options.locator('#readKey')).toHaveValue('Alt');
  await expect(options.locator('#writeKey')).toHaveValue('Alt+T');
});

test("the settings show the toolbar window's shortcut and lead to Chrome's page for it", async ({ context, extensionId }) => {
  const options = await openOptions(context, extensionId);
  await expect(options.locator('#toolbarKey')).toHaveText('Ctrl+Shift+Y');
  const [shortcuts] = await Promise.all([context.waitForEvent('page'), options.locator('#chromeShortcuts').click()]);
  await expect(shortcuts).toHaveURL('chrome://extensions/shortcuts');
});
