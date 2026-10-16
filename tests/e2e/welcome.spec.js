import { test, expect, moveTo, popupRoot, popupText, say } from './fixtures.js';

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

test.describe('agreement to send texts to an AI provider', () => {
  test('without it nothing is sent, and the popup leads to the settings', async ({ page, server, setSettings }) => {
    await setSettings({ consent: 0 });
    await page.goto(`${server.url}/page.html`);
    await moveTo(page, '#p1');
    await page.keyboard.down('Alt');
    await expect(popupText(page)).toHaveText(say('noConsent', { name: 'DeepSeek' }));
    await expect(popupRoot(page).locator('.settings')).toBeVisible();
    await page.waitForTimeout(500);
    expect(server.requests).toHaveLength(0);
    expect(server.notesRequests).toHaveLength(0);
  });

  test('the settings save an AI provider only with the box ticked, and keep the agreement', async ({ page, extensionId, serviceWorker }) => {
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(page.locator('#consentRow')).toBeHidden(); // nothing leaves the computer with Chrome's translator
    await page.locator('#provider').selectOption('deepseek');
    await page.locator('#apiKey').fill('sk-deep');
    await expect(page.locator('#consentRow')).toBeVisible();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#status')).toHaveText('Tick the box to agree that the texts go to DeepSeek, then save.');
    expect((await stored(serviceWorker))?.provider ?? 'chrome').toBe('chrome');
    await page.locator('#consent').check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#status')).toHaveText('Saved');
    expect(await stored(serviceWorker)).toMatchObject({ provider: 'deepseek', consent: 1 });
    await page.reload();
    await expect(page.locator('#consent')).toBeChecked();
  });
});
