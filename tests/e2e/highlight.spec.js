import { test, expect, moveTo, altHover, popupRoot, popupText, say, inContentScript, fakeBuiltInAI, chooseLanguage } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';

const outline = (page) => page.locator('#spotslate-highlight');
const link = (page) => page.locator('#spotslate-link');

// The segment between the closest points of two boxes: straight across where they overlap, corner to corner otherwise.
function closest(a, b) {
  const axis = (aStart, aEnd, bStart, bEnd) => {
    if (Math.max(aStart, bStart) < Math.min(aEnd, bEnd)) {
      const middle = (Math.max(aStart, bStart) + Math.min(aEnd, bEnd)) / 2;
      return [middle, middle];
    }
    return bStart >= aEnd ? [aEnd, bStart] : [aStart, bEnd];
  };
  const [x1, x2] = axis(a.x, a.x + a.width, b.x, b.x + b.width);
  const [y1, y2] = axis(a.y, a.y + a.height, b.y, b.y + b.height);
  return { left: Math.min(x1, x2), right: Math.max(x1, x2), top: Math.min(y1, y2), bottom: Math.max(y1, y2) };
}

// How far the drawn line is from joining the outline and the popup, at its worst end, in pixels.
async function linkMiss(page) {
  const [line, box, panel] = await Promise.all([link(page).boundingBox(), outline(page).boundingBox(), popupRoot(page).locator('.popup').boundingBox()]);
  const want = closest(box, panel);
  return Math.max(
    Math.abs(line.x - want.left),
    Math.abs(line.x + line.width - want.right),
    Math.abs(line.y - want.top),
    Math.abs(line.y + line.height - want.bottom),
  );
}
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

test("releasing Alt keeps the outline on the popup's paragraph, joined to the popup by a dashed line", async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await page.keyboard.up('Alt');
  await expect(popupRoot(page)).toHaveCount(1);
  await expect(outline(page)).toHaveCount(1);
  expect(await outlineOffset(page, '#p1')).toEqual({ left: 3, top: 3, right: 3, bottom: 3 });
  expect(await outline(page).getAttribute('data-muted')).toBe('false');
  await expect(link(page)).toBeVisible();
  expect(await link(page).evaluate((line) => getComputedStyle(line).borderTopStyle)).toBe('dashed');
  await expect.poll(() => linkMiss(page)).toBeLessThan(2.5);
});

test('the line follows the popup dragged away, and the page scrolling', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await page.keyboard.up('Alt');
  const bar = await popupRoot(page).locator('.bar').boundingBox();
  await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2); // clear of the picker and the buttons
  await page.mouse.down();
  await page.mouse.move(bar.x + bar.width / 2 + 300, bar.y + 260, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => linkMiss(page)).toBeLessThan(2.5);
  const { width, height } = await link(page).boundingBox();
  expect(Math.max(width, height)).toBeGreaterThan(100);
  await page.evaluate(() => scrollBy(0, 40));
  await expect.poll(() => linkMiss(page)).toBeLessThan(2.5);
});

test('closing the popup takes the outline and the line away', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await page.keyboard.up('Alt');
  await expect(link(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(popupRoot(page)).toHaveCount(0);
  await expect(outline(page)).toHaveCount(0);
  await expect(link(page)).toHaveCount(0);
});

test('Alt over another paragraph outlines it with no line, until the popup moves there', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await moveTo(page, '#p2');
  await expect.poll(() => outlineOffset(page, '#p2')).toEqual({ left: 3, top: 3, right: 3, bottom: 3 });
  await expect(popupText(page)).toContainText('[RU] Second paragraph');
  await expect(link(page)).toBeVisible();
  await expect.poll(() => linkMiss(page)).toBeLessThan(2.5);
});

test('releasing Alt before anything is translated leaves no outline', async ({ page }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await page.keyboard.up('Alt');
  await page.waitForTimeout(300);
  await expect(outline(page)).toHaveCount(0);
  await expect(popupRoot(page)).toHaveCount(0);
});

for (const [selector, hint] of [
  ['#huge', say('hintTooLong')],
  ['#input', say('hintWrite', { key: 'Alt' })],
  ['#password', say('hintEditable')],
]) {
  test(`${selector} gets a grey outline with a hint and no request`, async ({ page, server }) => {
    await altHover(page, selector);
    await expect(outline(page).locator('.hint')).toHaveText(hint);
    expect(await outline(page).getAttribute('data-muted')).toBe('true');
    await page.waitForTimeout(300);
    await expect(popupRoot(page)).toHaveCount(0);
    expect(server.requests).toHaveLength(0);
  });
}

test('empty space between paragraphs shows no outline', async ({ page }) => {
  const paragraph = await page.locator('#p1').boundingBox();
  await page.mouse.move(paragraph.x + 300, paragraph.y + paragraph.height + 12);
  await page.keyboard.down('Alt');
  await nextFrames(page);
  await page.waitForTimeout(300);
  await expect(outline(page)).toHaveCount(0);
});

test('text already in the target language opens the popup saying so, with no request', async ({ page, server, setSettings }) => {
  await setSettings({ targetLang: 'en' });
  await inContentScript(page, fakeBuiltInAI({ language: 'en' })); // Chrome's detector, which says English
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(say('hintAlready', {}, 'en'));
  await expect(outline(page).locator('.hint')).toHaveCount(0);
  await expect(popupRoot(page).locator('.copy')).toBeHidden();
  await page.waitForTimeout(300);
  expect(server.requests).toHaveLength(0);
});

test('another language picked in that popup translates the text into it', async ({ page, server, setSettings, serviceWorker }) => {
  await setSettings({ targetLang: 'en' });
  await inContentScript(page, fakeBuiltInAI({ language: 'en' }));
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(say('hintAlready', {}, 'en'));
  await page.keyboard.up('Alt');
  await chooseLanguage(popupRoot(page), 'lang', 'ru');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  expect(server.requests[0].body.messages[0].content).toContain('into Russian');
  expect(await serviceWorker.evaluate(async () => (await chrome.storage.local.get('settings')).settings.targetLang)).toBe('ru');
});

test('a popup on text in the language picked again says so again', async ({ page, server, setSettings }) => {
  await setSettings({ targetLang: 'ru' });
  await inContentScript(page, fakeBuiltInAI({ language: 'en' }));
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await page.keyboard.up('Alt');
  await chooseLanguage(popupRoot(page), 'lang', 'en');
  await expect(popupText(page)).toHaveText(say('hintAlready', {}, 'en'));
  expect(server.requests).toHaveLength(1);
});

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
