import { test, expect, moveTo, popupText } from './fixtures.js';

const welcomeUrl = (extensionId) => `chrome-extension://${extensionId}/welcome.html`;
const stored = async (serviceWorker) => (await serviceWorker.evaluate(() => chrome.storage.local.get('settings'))).settings;

test('installing SpotSlate opens the welcome page', async ({ extensionId, welcomed }) => {
  expect(welcomed).toBe(welcomeUrl(extensionId));
});

test('the welcome page saves the language to translate into', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(welcomeUrl(extensionId));
  await expect(page.locator('#targetLang option')).toHaveCount(13);
  await page.locator('#targetLang').selectOption('de');
  await expect(page.locator('#saved')).toBeVisible();
  expect((await stored(serviceWorker)).targetLang).toBe('de');
  expect((await stored(serviceWorker)).provider).toBe('chrome');
});

test('the welcome page says what leaves the computer and links to the privacy policy', async ({ page, extensionId }) => {
  await page.goto(welcomeUrl(extensionId));
  await expect(page.locator('#data')).toContainText('nothing you translate leaves this computer');
  await expect(page.getByRole('link', { name: 'privacy policy' })).toHaveAttribute(
    'href',
    'https://github.com/AleksandrIlinykh/spotslate/blob/main/PRIVACY.md',
  );
});

test('Alt over the practice paragraph on the welcome page translates it', async ({ page, extensionId, setSettings }) => {
  await setSettings();
  await page.goto(welcomeUrl(extensionId));
  await moveTo(page, '#practice');
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toContainText('[RU]');
});

test('an AI provider is saved like any other setting, and settings saved with the old agreement field still translate', async ({ page, server, setSettings, extensionId, serviceWorker }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.locator('#provider').selectOption('deepseek');
  await page.locator('#apiKey').fill('sk-deep');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#status')).toHaveText('Saved');
  expect(await stored(serviceWorker)).not.toHaveProperty('consent');
  await setSettings();
  await serviceWorker.evaluate(async () => {
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.set({ settings: { ...settings, consent: 0 } });
  });
  await page.goto(`${server.url}/page.html`);
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toContainText('[RU] The quick brown fox');
});
