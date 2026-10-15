import { test, expect, moveTo, popupText, say } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const outline = (page) => page.locator('#paragloss-highlight');

// Selects characters [start, end) of the first text node of `selector` and returns the selection's rect.
function select(page, selector, start, end) {
  return page.locator(selector).evaluate(
    (element, [from, to]) => {
      const range = document.createRange();
      range.setStart(element.firstChild, from);
      range.setEnd(element.firstChild, to);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      const { x, y, width, height } = range.getBoundingClientRect();
      return { x, y, width, height };
    },
    [start, end],
  );
}

async function altOver(page, rect) {
  await page.mouse.move(rect.x + Math.min(5, rect.width / 2), rect.y + rect.height / 2, { steps: 3 });
  await page.keyboard.down('Alt');
}

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/page.html`);
});

test('Alt over a selection translates only the selected text', async ({ page, server }) => {
  await altOver(page, await select(page, '#p1', 4, 25));
  await expect(popupText(page)).toHaveText('[RU] quick brown fox jumps');
  const [{ body }] = server.requests;
  expect(body.messages[1].content).toBe('quick brown fox jumps');
  expect(body.messages[0].content).toContain('professional translator');
});

test('a selection of one to three words gets a dictionary entry', async ({ page, server }) => {
  await altOver(page, await select(page, '#p1', 4, 9));
  await expect(popupText(page)).toHaveText('[RU] quick');
  expect(server.requests[0].body.messages[0].content).toContain('bilingual dictionary');
});

test('a selection inside an editor is translated', async ({ page, server }) => {
  await page.locator('#editor-p1').scrollIntoViewIfNeeded();
  await altOver(page, await select(page, '#editor-p1', 6, 15));
  await expect(popupText(page)).toHaveText('[RU] paragraph');
  expect(server.requests[0].body.messages[1].content).toBe('paragraph');
});

test('a selection inside a form field is not translated', async ({ page, server }) => {
  await page.locator('#input').selectText();
  await altOver(page, await page.locator('#input').boundingBox());
  await page.waitForTimeout(500);
  await expect(popupText(page)).toHaveCount(0);
  expect(server.requests).toHaveLength(0);
});

test('the outline traces the selection, not the paragraph', async ({ page }) => {
  const rect = await select(page, '#p1', 4, 25);
  await altOver(page, rect);
  await expect
    .poll(async () => {
      const box = await outline(page).boundingBox();
      return { left: Math.round(rect.x - box.x), width: Math.round(box.width - rect.width) };
    })
    .toEqual({ left: 3, width: 6 });
});

test('with a selection elsewhere, Alt over a paragraph translates the paragraph', async ({ page }) => {
  await select(page, '#p2', 0, 6);
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
});

test('an overlong selection gets a grey outline with a hint and no request', async ({ page, server }) => {
  const rect = await page.locator('#huge').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const { x, y, width, height } = range.getClientRects()[0];
    return { x, y, width, height };
  });
  await altOver(page, rect);
  await expect(outline(page).locator('.hint')).toHaveText(say('hintTooLongSelection'));
  await page.waitForTimeout(300);
  expect(server.requests).toHaveLength(0);
});
