import { test, expect } from './fixtures.js';

const optionsUrl = (extensionId) => `chrome-extension://${extensionId}/options.html`;

test('shows the defaults when nothing is saved', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#apiKey')).toHaveValue('');
  await expect(page.locator('#targetLang')).toHaveValue('ru');
  await expect(page.locator('#model')).toHaveValue('deepseek-flash');
  await expect(page.locator('#baseUrl')).toHaveValue('https://api.deepseek.com');
  await expect(page.locator('#targetLang option')).toHaveCount(13);
});

test('saves trimmed values and restores blanks to defaults', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#apiKey').fill('  sk-test  ');
  await page.locator('#targetLang').selectOption('de');
  await page.locator('#model').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#status')).toHaveText('Saved');
  await expect(page.locator('#model')).toHaveValue('deepseek-flash');
  const { settings } = await serviceWorker.evaluate(() => chrome.storage.local.get('settings'));
  expect(settings).toEqual({ apiKey: 'sk-test', targetLang: 'de', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com' });
});

test('shows saved values when opened again', async ({ page, extensionId, server, setSettings }) => {
  await setSettings({ apiKey: 'sk-saved', targetLang: 'ja' });
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#apiKey')).toHaveValue('sk-saved');
  await expect(page.locator('#targetLang')).toHaveValue('ja');
  await expect(page.locator('#baseUrl')).toHaveValue(server.url);
});

test('the saved status disappears when a field changes', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#status')).toHaveText('Saved');
  await page.locator('#apiKey').fill('sk-other');
  await expect(page.locator('#status')).toHaveText('');
});
