import { test, expect, moveTo, altHover, popupRoot, popupText, popupBox, say } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const P2 = 'Second paragraph with an inline span inside.';

async function openOn(page, selector, text) {
  await altHover(page, selector);
  await expect(popupText(page)).toHaveText(`[RU] ${text}`);
}

test.describe('with a working key', () => {
  test.beforeEach(async ({ page, server, setSettings }) => {
    await setSettings();
    await page.goto(`${server.url}/page.html`);
  });

  test('Esc closes the popup', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('leaving the paragraph and the popup closes it', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    await page.mouse.move(5, 700);
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('moving from the paragraph into the popup keeps it open', async ({ page, server }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    const box = await popupBox(page).boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 5 });
    await page.keyboard.down('Alt');
    await page.waitForTimeout(600);
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    expect(server.requests).toHaveLength(1);
  });

  test('selecting popup text past its edge does not close it', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    const box = await popupBox(page).boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 5 });
    await page.mouse.down();
    await page.mouse.move(box.x + box.width + 60, box.y - 40, { steps: 5 });
    await page.waitForTimeout(600);
    await expect(popupRoot(page)).toHaveCount(1);
    await page.mouse.up();
  });

  test('a mousedown outside the popup closes it', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('resizing the window closes the popup', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('translating the same paragraph again uses the page cache', async ({ page, server }) => {
    await openOn(page, '#p1', P1);
    await page.waitForTimeout(200); // let the 'done' message land before closing
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
    await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    expect(server.requests).toHaveLength(1);
  });

  test('changing the settings clears the cache', async ({ page, server, setSettings }) => {
    await openOn(page, '#p1', P1);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
    await page.keyboard.up('Alt');
    await setSettings({ targetLang: 'de' });
    await page.keyboard.down('Alt');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    await expect.poll(() => server.requests.length).toBe(2);
  });

  test('closing the popup cancels the request in flight', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'slow' });
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
    await expect.poll(() => server.requests[0].aborted).toBe(true);
  });

  test('switching paragraphs mid-stream shows only the new translation', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'slow' });
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await moveTo(page, '#p2');
    await expect(popupText(page)).toHaveText(`[RU] ${P2}`, { timeout: 10_000 });
    expect(server.requests[0].aborted).toBe(true);
  });
});

test.describe('errors', () => {
  test('a wrong key shows the auth message without a settings button', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'bad' });
    await page.goto(`${server.url}/page.html`);
    await altHover(page, '#p1');
    await expect(popupText(page)).toHaveText(say('auth'));
    await expect(popupBox(page)).toHaveClass(/is-error/);
    await expect(popupRoot(page).locator('.settings')).toBeHidden();
  });

  test('a missing key offers to open the settings', async ({ page, server, setSettings, context, extensionId }) => {
    await setSettings({ apiKey: '' });
    await page.goto(`${server.url}/page.html`);
    await altHover(page, '#p1');
    await expect(popupText(page)).toHaveText(say('noKey', { name: 'DeepSeek' }));
    await page.keyboard.up('Alt');
    const [optionsPage] = await Promise.all([
      context.waitForEvent('page'),
      popupRoot(page).locator('.settings').click(),
    ]);
    await expect(optionsPage).toHaveURL(`chrome-extension://${extensionId}/options.html`);
    expect(server.requests).toHaveLength(0);
  });
});
