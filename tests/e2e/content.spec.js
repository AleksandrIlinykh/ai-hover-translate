import { test, expect, moveTo, altHover, popupRoot, popupText, popupBox } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const P2 = 'Second paragraph with an inline span inside.';

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/page.html`);
});

async function expectNothingAfterAWhile(page, server) {
  await page.waitForTimeout(500);
  await expect(popupRoot(page)).toHaveCount(0);
  expect(server.requests).toHaveLength(0);
}

test('Alt + hover shows the streamed translation of the paragraph', async ({ page, server }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0].body.messages[1].content).toBe(P1);
});

test('hovering without Alt does nothing', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await expectNothingAfterAWhile(page, server);
});

test('Alt combined with another key does not translate', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await page.keyboard.press('x');
  await expectNothingAfterAWhile(page, server);
});

test('Shift held before Alt does not translate', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Shift');
  await page.keyboard.down('Alt');
  await expectNothingAfterAWhile(page, server);
});

test('pressing Alt first and then moving onto a paragraph translates it', async ({ page }) => {
  await page.keyboard.down('Alt');
  await moveTo(page, '#p2');
  await expect(popupText(page)).toHaveText(`[RU] ${P2}`);
});

test('moving to another paragraph with Alt held switches the translation', async ({ page, server }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await moveTo(page, '#p2');
  await expect(popupText(page)).toHaveText(`[RU] ${P2}`);
  await expect(popupRoot(page)).toHaveCount(1);
  expect(server.requests).toHaveLength(2);
});

for (const [selector, text] of [
  ['#p2-span', P2],
  ['#li1', 'List item text'],
  ['#card-text', 'Text in a div without paragraphs'],
]) {
  test(`hovering ${selector} translates its block`, async ({ page, server }) => {
    await altHover(page, selector);
    await expect(popupText(page)).toHaveText(`[RU] ${text}`);
    expect(server.requests[0].body.messages[1].content).toBe(text);
  });
}

for (const selector of ['#digits', '#input', '#editable', '#huge']) {
  test(`hovering ${selector} does not translate`, async ({ page, server }) => {
    await altHover(page, selector);
    await expectNothingAfterAWhile(page, server);
  });
}

test('the popup sits above the paragraph, shifted to the right', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  const paragraph = await page.locator('#p1').boundingBox();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return { gap: Math.round(paragraph.y - (box.y + box.height)), shift: Math.round(box.x - paragraph.x) };
    })
    .toEqual({ gap: 6, shift: 32 });
});

test('a paragraph at the top of the window gets the popup below it', async ({ page }) => {
  await altHover(page, '#top');
  await expect(popupText(page)).toHaveText('[RU] Paragraph at the very top');
  const paragraph = await page.locator('#top').boundingBox();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return Math.round(box.y - (paragraph.y + paragraph.height));
    })
    .toBe(6);
});

test('a paragraph taller than the window still gets a popup inside the window', async ({ page }) => {
  await page.locator('#tall').evaluate((el) => window.scrollTo(0, el.offsetTop + 1000));
  const paragraph = await page.locator('#tall').boundingBox();
  expect(paragraph.y).toBeLessThan(0);
  await page.mouse.move(paragraph.x + 20, 360);
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toContainText('[RU] Tall paragraph text.');
  const { height } = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return { inside: box.y >= 0 && box.y + box.height <= height, roomy: box.height > height / 2 };
    })
    .toEqual({ inside: true, roomy: true });
});

for (const selector of ['#inner', '#inner-span']) {
  test(`text inside an open shadow root is translated (${selector})`, async ({ page, server }) => {
    await page.goto(`${server.url}/shadow.html`);
    await altHover(page, selector);
    await expect(popupText(page)).toHaveText('[RU] Text inside a shadow root');
  });
}

test('the popup follows its paragraph when an inner container scrolls', async ({ page, server }) => {
  await page.goto(`${server.url}/scroller.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('[RU] Paragraph inside a scrolling container.');
  const before = (await page.locator('#p1').boundingBox()).y;
  await page.locator('#scroller').evaluate((el) => {
    el.scrollTop = 10;
  });
  await expect
    .poll(async () => {
      const paragraph = await page.locator('#p1').boundingBox();
      const box = await popupBox(page).boundingBox();
      return { moved: Math.round(before - paragraph.y), gap: Math.round(paragraph.y - (box.y + box.height)) };
    })
    .toEqual({ moved: 10, gap: 6 });
});

test('page styles do not hide or restyle the popup', async ({ page, server }) => {
  await page.goto(`${server.url}/hostile.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('[RU] Hostile page paragraph.');
  await expect(popupBox(page)).toBeVisible();
  const style = await popupBox(page).evaluate((el) => {
    const computed = getComputedStyle(el);
    return { fontSize: computed.fontSize, color: computed.color };
  });
  expect(style.fontSize).toBe('14px');
  expect(style.color).not.toBe('rgba(0, 0, 0, 0)');
});
