import { test, expect, altHover, popupRoot, popupText, popupBox } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const tool = (page, name) => popupRoot(page).locator(`.${name}`);

async function openOn(page, selector) {
  await altHover(page, selector);
  await expect(popupText(page)).not.toHaveText('…');
  await page.keyboard.up('Alt');
}

async function pin(page) {
  const box = await popupBox(page).boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height - 8);
  await expect(popupBox(page)).toHaveClass(/is-pinned/);
}

test.describe('with a working key', () => {
  test.beforeEach(async ({ page, server, setSettings }) => {
    await setSettings();
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  });

  test('clicking the popup pins it, so it stays when the mouse leaves', async ({ page }) => {
    await expect(tool(page, 'close')).toBeHidden();
    await pin(page);
    await expect(tool(page, 'close')).toBeVisible();
    await page.mouse.move(5, 700);
    await page.waitForTimeout(600);
    await expect(popupRoot(page)).toHaveCount(1);
  });

  test('a pinned popup ignores clicks outside and closes with its close button', async ({ page }) => {
    await pin(page);
    await page.mouse.click(5, 700);
    await page.waitForTimeout(400);
    await expect(popupRoot(page)).toHaveCount(1);
    await tool(page, 'close').click();
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('Esc closes a pinned popup', async ({ page }) => {
    await pin(page);
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('the copy button copies the translation', async ({ page, context, server }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
    await popupBox(page).hover();
    await tool(page, 'copy').click();
    await expect(tool(page, 'copy')).toHaveText('Copied');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[RU] ${P1}`);
  });
});

test.describe('errors', () => {
  test('an API error offers a retry that translates on the second try', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'flaky' });
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await expect(popupText(page)).toHaveText('The API server is unavailable (500). Try again later.');
    await expect(tool(page, 'settings')).toBeHidden();
    await tool(page, 'retry').click();
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    expect(server.requests).toHaveLength(2);
  });

  test('a missing key offers the settings, not a retry', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: '' });
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await expect(tool(page, 'settings')).toBeVisible();
    await expect(tool(page, 'retry')).toBeHidden();
  });

  test('copy is not offered for an error', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'bad' });
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await popupBox(page).hover();
    await expect(tool(page, 'copy')).toBeHidden();
  });
});
