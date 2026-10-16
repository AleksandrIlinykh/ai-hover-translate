import { test, expect, moveTo, popupText, say } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const outline = (page) => page.locator('#spotslate-highlight');

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
  expect(server.requests[0].body.messages.at(-1).content).toBe('paragraph');
});

// Types `text` into the comment field and selects characters [start, end) of it.
async function selectInField(page, text, start, end) {
  await page.locator('#comment').fill(text);
  await page.locator('#comment').evaluate((field, [from, to]) => field.setSelectionRange(from, to), [start, end]);
}

async function altClickAt(page, rect) {
  await page.mouse.move(rect.x + Math.min(20, rect.width / 2), rect.y + Math.min(10, rect.height / 2), { steps: 3 });
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

test('a selection inside a form field is translated, and nothing around it is sent', async ({ page, server }) => {
  await selectInField(page, 'Please review the build logs today', 7, 17);
  await altOver(page, await page.locator('#comment').boundingBox());
  await expect(popupText(page)).toHaveText('[RU] review the');
  const [{ body }] = server.requests;
  expect(body.messages.at(-1).content).toBe('review the');
  expect(JSON.stringify(body)).not.toContain('build logs');
  expect(JSON.stringify(body)).not.toContain('Please');
});

test('a longer selection in a text input is translated as text', async ({ page, server }) => {
  await page.locator('#input').fill('The build failed again on the main branch tonight');
  await page.locator('#input').evaluate((field) => field.setSelectionRange(4, 41));
  await altOver(page, await page.locator('#input').boundingBox());
  await expect(popupText(page)).toHaveText('[RU] build failed again on the main branch');
  expect(server.requests[0].body.messages[0].content).toContain('professional translator');
});

test('Alt+click on a selection in a field translates it, keeps it selected and opens no compose window', async ({ page }) => {
  await selectInField(page, 'Please review the build logs today', 7, 17);
  await altClickAt(page, await page.locator('#comment').boundingBox());
  await expect(popupText(page)).toHaveText('[RU] review the');
  await expect(page.locator('#spotslate-compose')).toHaveCount(0);
  expect(await page.locator('#comment').evaluate((field) => [field.selectionStart, field.selectionEnd])).toEqual([7, 17]);
});

test('Alt+click on a selection in an editor translates it and opens no compose window', async ({ page }) => {
  await page.locator('#editor-p1').scrollIntoViewIfNeeded();
  await altClickAt(page, await select(page, '#editor-p1', 6, 15));
  await expect(popupText(page)).toHaveText('[RU] paragraph');
  await expect(page.locator('#spotslate-compose')).toHaveCount(0);
});

test('without a selection, Alt+click on a field still opens the compose window', async ({ page }) => {
  await page.locator('#comment').fill('Please review');
  await altClickAt(page, await page.locator('#comment').boundingBox());
  await expect(page.locator('#spotslate-compose')).toHaveCount(1);
  await expect(popupText(page)).toHaveCount(0);
});

test('a selection in a password field is never translated', async ({ page, server }) => {
  await page.locator('#password').selectText();
  await altOver(page, await page.locator('#password').boundingBox());
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
