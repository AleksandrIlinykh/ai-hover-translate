import { test, expect, altHover, popupRoot, popupText, popupBox, say } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const tool = (page, name) => popupRoot(page).locator(`.${name}`);

async function openOn(page, selector) {
  await altHover(page, selector);
  await expect(popupText(page)).not.toHaveText('…');
  await page.keyboard.up('Alt');
}

async function dragBar(page, dx, dy) {
  const bar = await popupRoot(page).locator('.bar').boundingBox();
  const start = { x: bar.x + 10, y: bar.y + bar.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
  await page.mouse.up();
}

async function dragHandle(page, edge, dx, dy) {
  const box = await popupRoot(page).locator(`.resize.${edge}`).boundingBox();
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 5 });
  await page.mouse.up();
}

const round = (value) => Math.round(value);

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

  test('the title bar picks the language to translate into, for every site: the text again, the popup in it', async ({ page, server, serviceWorker }) => {
    await expect(tool(page, 'lang').locator('.picker-button')).toHaveText('RU');
    await tool(page, 'lang').locator('.picker-button').click();
    await tool(page, 'lang').locator('.picker-option[data-code="de"]').click();
    const stored = () => serviceWorker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.targetLang);
    await expect.poll(stored).toBe('de');
    await expect.poll(() => server.requests.length).toBe(2);
    expect(server.requests[1].body.messages[0].content).toContain('German');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    await expect(tool(page, 'lang').locator('.picker-button')).toHaveText('DE');
    await expect(tool(page, 'copy')).toHaveText(say('copy', {}, 'de'));
  });

  test('the title bar has the settings button, as every window does', async ({ page, context, extensionId }) => {
    const [options] = await Promise.all([context.waitForEvent('page'), tool(page, 'gear').click()]);
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  });

  test('Esc with the language list open closes the list, not the popup', async ({ page }) => {
    await tool(page, 'lang').locator('.picker-button').click();
    await expect(tool(page, 'lang').locator('.picker-list')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tool(page, 'lang').locator('.picker-list')).toBeHidden();
    await expect(popupRoot(page)).toHaveCount(1);
  });

  test('clicking the popup pins it, so it stays when the mouse leaves', async ({ page }) => {
    await pin(page);
    await page.mouse.move(5, 700);
    await page.waitForTimeout(600);
    await expect(popupRoot(page)).toHaveCount(1);
  });

  test('a click outside closes the popup, a pinned one too', async ({ page }) => {
    await pin(page);
    await page.mouse.click(5, 700);
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('the close button closes the popup', async ({ page }) => {
    await tool(page, 'close').click();
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('the title bar always has a close button', async ({ page }) => {
    await expect(tool(page, 'close')).toBeVisible();
    await tool(page, 'close').click();
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('a dim grip at the left of the title bar moves the popup', async ({ page }) => {
    const grip = tool(page, 'grip');
    const [box, handle] = await Promise.all([popupBox(page).boundingBox(), grip.boundingBox()]);
    expect(handle.x - box.x).toBeLessThan(12);
    expect(Number(await grip.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(0.6);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2 + 80, { steps: 5 });
    await page.mouse.up();
    const after = await popupBox(page).boundingBox();
    expect({ dx: Math.round(after.x - box.x), dy: Math.round(after.y - box.y) }).toEqual({ dx: 120, dy: 80 });
  });

  test('dragging the title bar moves the popup and pins it', async ({ page }) => {
    const before = await popupBox(page).boundingBox();
    await dragBar(page, 200, 150);
    const after = await popupBox(page).boundingBox();
    expect({ dx: Math.round(after.x - before.x), dy: Math.round(after.y - before.y) }).toEqual({ dx: 200, dy: 150 });
    await expect(popupBox(page)).toHaveClass(/is-pinned/);
    await page.mouse.move(5, 700);
    await page.waitForTimeout(600);
    await expect(popupRoot(page)).toHaveCount(1);
  });

  test('a dragged popup stays in place on screen while the page scrolls', async ({ page }) => {
    await dragBar(page, 200, 150);
    const before = await popupBox(page).boundingBox();
    const paragraphBefore = await page.locator('#p1').boundingBox();
    await page.evaluate(() => window.scrollBy(0, 400));
    await expect.poll(async () => Math.round((await page.locator('#p1').boundingBox()).y)).toBe(Math.round(paragraphBefore.y - 400));
    const after = await popupBox(page).boundingBox();
    expect({ x: Math.round(after.x), y: Math.round(after.y) }).toEqual({ x: Math.round(before.x), y: Math.round(before.y) });
  });

  test('a dragged popup cannot leave the window', async ({ page }) => {
    await dragBar(page, -2000, -2000);
    const box = await popupBox(page).boundingBox();
    expect({ x: Math.round(box.x), y: Math.round(box.y) }).toEqual({ x: 8, y: 8 });
  });

  test('a dragged popup survives a window resize and stays visible', async ({ page }) => {
    await dragBar(page, 600, 300);
    await page.setViewportSize({ width: 900, height: 500 });
    await page.waitForTimeout(300);
    await expect(popupRoot(page)).toHaveCount(1);
    const box = await popupBox(page).boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(900 - 8 + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(500 - 8 + 1);
  });

  test('dragging the bottom-right corner resizes the popup and pins it', async ({ page }) => {
    await expect(popupRoot(page).locator('.resize.se')).toBeVisible();
    const before = await popupBox(page).boundingBox();
    await dragHandle(page, 'se', 120, 90);
    const after = await popupBox(page).boundingBox();
    expect({
      x: round(after.x - before.x),
      y: round(after.y - before.y),
      width: round(after.width - before.width),
      height: round(after.height - before.height),
    }).toEqual({ x: 0, y: 0, width: 120, height: 90 });
    await expect(popupBox(page)).toHaveClass(/is-pinned/);
  });

  test('dragging the left edge moves the left side and keeps the right side', async ({ page }) => {
    const before = await popupBox(page).boundingBox();
    await dragHandle(page, 'w', -100, 0);
    const after = await popupBox(page).boundingBox();
    expect({
      left: round(after.x - before.x),
      right: round(after.x + after.width - (before.x + before.width)),
    }).toEqual({ left: -100, right: 0 });
  });

  test('the popup cannot be resized below 240 x 120 or past the window', async ({ page }) => {
    await dragHandle(page, 'se', -2000, -2000);
    let box = await popupBox(page).boundingBox();
    expect({ width: round(box.width), height: round(box.height) }).toEqual({ width: 240, height: 120 });
    await dragHandle(page, 'se', 3000, 3000);
    box = await popupBox(page).boundingBox();
    const [viewportWidth, viewportHeight] = await page.evaluate(() => [document.documentElement.clientWidth, innerHeight]);
    expect({ right: round(box.x + box.width), bottom: round(box.y + box.height) }).toEqual({
      right: viewportWidth - 8,
      bottom: viewportHeight - 8,
    });
  });

  test('a resized popup stays in place on screen while the page scrolls', async ({ page }) => {
    await dragHandle(page, 'se', 100, 100);
    const before = await popupBox(page).boundingBox();
    const paragraphBefore = await page.locator('#p1').boundingBox();
    await page.evaluate(() => window.scrollBy(0, 300));
    await expect.poll(async () => round((await page.locator('#p1').boundingBox()).y)).toBe(round(paragraphBefore.y - 300));
    const after = await popupBox(page).boundingBox();
    expect({ x: round(after.x), y: round(after.y), height: round(after.height) }).toEqual({
      x: round(before.x),
      y: round(before.y),
      height: round(before.height),
    });
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
    await expect(tool(page, 'copy')).toHaveText(say('copied'));
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[RU] ${P1}`);
  });
});

test.describe('errors', () => {
  test('an API error offers a retry that translates on the second try', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'flaky' });
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await expect(popupText(page)).toHaveText(say('server', { status: 500 }));
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

  test('a provider without a chosen model offers the settings, not a retry', async ({ page, server, setSettings }) => {
    await setSettings({ provider: 'custom', model: '' });
    await page.goto(`${server.url}/page.html`);
    await openOn(page, '#p1');
    await expect(popupText(page)).toHaveText(say('noModel', { name: 'Other OpenAI-compatible API' }));
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
