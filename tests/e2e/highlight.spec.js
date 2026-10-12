import { test, expect, moveTo, altHover, popupRoot, popupText } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';

const outline = (page) => page.locator('#hover-translate-highlight');
const nextFrames = (page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));

async function outlineOffset(page, selector) {
  const block = await page.locator(selector).boundingBox();
  const box = await outline(page).boundingBox();
  return {
    left: Math.round(block.x - box.x),
    top: Math.round(block.y - box.y),
    right: Math.round(box.x + box.width - (block.x + block.width)),
    bottom: Math.round(box.y + box.height - (block.y + block.height)),
  };
}

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/page.html`);
});

test('holding Alt outlines the paragraph before any request is sent', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await nextFrames(page);
  expect({ outlines: await outline(page).count(), requests: server.requests.length }).toEqual({ outlines: 1, requests: 0 });
  expect(await outlineOffset(page, '#p1')).toEqual({ left: 3, top: 3, right: 3, bottom: 3 });
  const style = await outline(page).evaluate((el) => {
    const computed = getComputedStyle(el);
    return { border: computed.borderTopStyle, pointerEvents: computed.pointerEvents };
  });
  expect(style).toEqual({ border: 'dashed', pointerEvents: 'none' });
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
});

test('the outline follows the mouse to another paragraph', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(outline(page)).toHaveCount(1);
  await moveTo(page, '#p2');
  await expect.poll(() => outlineOffset(page, '#p2')).toEqual({ left: 3, top: 3, right: 3, bottom: 3 });
});

test('releasing Alt removes the outline but keeps the popup', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await expect(outline(page)).toHaveCount(1);
  await page.keyboard.up('Alt');
  await expect(outline(page)).toHaveCount(0);
  await expect(popupRoot(page)).toHaveCount(1);
});

for (const selector of ['#huge', '#input']) {
  test(`nothing translatable under ${selector} means no outline`, async ({ page }) => {
    await altHover(page, selector);
    await nextFrames(page);
    await page.waitForTimeout(300);
    await expect(outline(page)).toHaveCount(0);
  });
}

test('Shift held before Alt shows no outline', async ({ page }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await nextFrames(page);
  await page.waitForTimeout(300);
  await expect(outline(page)).toHaveCount(0);
});

test('page styles do not hide the outline', async ({ page, server }) => {
  await page.goto(`${server.url}/hostile.html`);
  await altHover(page, '#p1');
  await expect(outline(page)).toBeVisible();
});
