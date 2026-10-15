import { test, expect, altHover, moveTo, popupText, inContentScript, fakeBuiltInAI, say, languageLabel } from './fixtures.js';

const DRAFT = 'privet mir'; // the user's own language, in the Latin script the project's files keep to
const compose = (page) => page.locator('#paragloss-compose');
const part = (page, name) => compose(page).locator(`.${name}`);
const systemOf = (request) => request.body.messages[0].content;
const userOf = (request) => request.body.messages.at(-1).content;

// Holds Alt and clicks the middle of `selector`.
async function altClick(page, selector) {
  await moveTo(page, selector, { x: 20, y: 10 });
  await page.keyboard.down('Alt');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
}

async function openOnComment(page, server) {
  await page.goto(`${server.url}/page.html`);
  await altClick(page, '#comment');
  await expect(part(page, 'draft')).toBeFocused();
}

async function write(page, text) {
  await part(page, 'draft').pressSequentially(text, { delay: 20 });
}

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('Alt+click on a text field opens the compose window from the user language into the page language', async ({ page, server }) => {
  await openOnComment(page, server);
  await expect(part(page, 'pair')).toHaveText(`${languageLabel('ru')} \u2192`);
  await expect(part(page, 'target')).toHaveValue('en');
  await expect(part(page, 'draft')).toHaveAttribute('placeholder', say('writePlaceholder'));
  await expect(part(page, 'engine')).toHaveText('DeepSeek');
  await expect(part(page, 'context-toggle')).toBeVisible();
  await expect(part(page, 'notes')).toBeHidden();
});

test('the draft is translated after a pause in typing, with one request and the compose prompt', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  expect(server.requests).toHaveLength(1);
  const [request] = server.requests;
  expect(systemOf(request)).toContain("Translate the user's text from Russian into English");
  expect(userOf(request)).toBe(DRAFT);
  expect(request.body).toMatchObject({ stream: true, thinking: { type: 'disabled' } });
});

test('the draft waits a second after the typing stops before it is sent', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await page.waitForTimeout(700);
  expect(server.requests).toHaveLength(0);
  await expect.poll(() => server.requests.length).toBe(1);
});

test('an ellipsis shows from the first key until the whole translation is there, never a part of it', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'slow' }); // one chunk a second
  await openOnComment(page, server);
  // Every text the translation shows, from now on.
  await page.evaluate(() => {
    const translation = document.querySelector('#paragloss-compose').shadowRoot.querySelector('.translation');
    window.shownTexts = [];
    new MutationObserver(() => window.shownTexts.push(translation.textContent)).observe(translation, {
      childList: true,
      characterData: true,
      subtree: true,
    });
  });
  await part(page, 'draft').press('p');
  await expect(part(page, 'translation')).toHaveText('…');
  await write(page, 'rivet mir');
  await expect.poll(() => server.requests.length).toBe(1);
  await expect(part(page, 'copy')).toBeDisabled();
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`, { timeout: 5000 });
  await expect(part(page, 'copy')).toBeEnabled();
  const shown = new Set(await page.evaluate(() => window.shownTexts));
  expect([...shown].toSorted()).toEqual(['[RU] privet mir', '…']);
});

test('typing more keeps the translation so far, the ellipsis after it, and only the ellipsis pulses', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  await write(page, ' i vsem');
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT} …`);
  await expect(part(page, 'copy')).toBeDisabled();
  expect(await part(page, 'translation').evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  expect(await part(page, 'pending').evaluate((element) => getComputedStyle(element).animationName)).toBe('pulse');
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT} i vsem`);
  await expect(part(page, 'pending')).toHaveCount(0);
});

test('another language does not keep the translation in the one before', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'slow' });
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`, { timeout: 6000 });
  await part(page, 'target').selectOption('de');
  await expect(part(page, 'translation')).toHaveText('…');
});

test('Ctrl+Enter copies the translation, closes the window and gives the focus back to the field', async ({ page, server, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  await page.keyboard.press('Control+Enter');
  await expect(compose(page)).toHaveCount(0);
  await expect(page.locator('#comment')).toBeFocused();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[RU] ${DRAFT}`);
});

test('Ctrl+Enter right after typing waits for the translation and copies it', async ({ page, server, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  await openOnComment(page, server);
  await write(page, DRAFT);
  await page.keyboard.press('Control+Enter');
  await expect(compose(page)).toHaveCount(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`[RU] ${DRAFT}`);
});

test('Check translates the translation back into the user language', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  await part(page, 'check').click();
  await expect(part(page, 'back')).toHaveText(say('back', { text: `[RU] [RU] ${DRAFT}` }));
  const check = server.requests.at(-1);
  expect(systemOf(check)).toContain("Translate the user's text into Russian.");
  expect(userOf(check)).toBe(`[RU] ${DRAFT}`);
});

test('Esc closes the window and the draft comes back next time', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  await page.keyboard.press('Escape');
  await expect(compose(page)).toHaveCount(0);
  await page.waitForTimeout(500);
  await altClick(page, '#comment');
  await expect(part(page, 'draft')).toHaveValue(DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
});

test('a draft stays with its site', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.goto(`http://other.test:${new URL(server.url).port}/page.html`);
  await altClick(page, '#comment');
  await expect(part(page, 'draft')).toBeFocused();
  await expect(part(page, 'draft')).toHaveValue('');
  await page.keyboard.press('Escape');
  await page.goto(`${server.url}/page.html`);
  await altClick(page, '#comment');
  await expect(part(page, 'draft')).toHaveValue(DRAFT);
});

test('typing in the window does not reach the page', async ({ page, server }) => {
  await openOnComment(page, server);
  const before = await page.evaluate(() => window.pageKeys);
  await write(page, DRAFT);
  expect(await page.evaluate(() => window.pageKeys)).toBe(before);
});

test('another target language is used at once and remembered for the site', async ({ page, server }) => {
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  await part(page, 'target').selectOption('de');
  await expect.poll(() => server.requests.length).toBe(2);
  expect(systemOf(server.requests[1])).toContain('from Russian into German');
  await part(page, 'close').click();
  await page.reload();
  await altClick(page, '#comment');
  await expect(part(page, 'target')).toHaveValue('de');
});

test('the site context shows in the window and goes with the draft, and Check goes without it', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await altHover(page, '#long');
  await expect(popupText(page)).toContainText('[RU] Our team');
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await page.evaluate(() => {
    const field = document.createElement('textarea');
    field.id = 'reply';
    document.querySelector('main').prepend(field);
  });
  await altClick(page, '#reply');
  await part(page, 'context-toggle').click();
  await expect(part(page, 'notes-film')).toHaveText('Notes: Our team moved the whole build to a shared continuous integr');
  await part(page, 'draft').focus();
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
  expect(systemOf(server.requests.at(-1))).toContain('<notes>\nNotes: Our team moved the whole build to a shared continuous integr\n</notes>');
  await part(page, 'check').click();
  await expect(part(page, 'back')).toHaveText(say('back', { text: `[RU] [RU] ${DRAFT}` }));
  expect(systemOf(server.requests.at(-1))).not.toContain('<notes>');
});

test('a password field gets neither the hint nor the window', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altClick(page, '#password');
  await page.waitForTimeout(300);
  await expect(compose(page)).toHaveCount(0);
});

test('Alt+click in a rich text editor opens the window there', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altClick(page, '#editor-p1');
  await expect(part(page, 'draft')).toBeFocused();
});

test('a missing key is reported in the window with a way to the settings', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: '' });
  await openOnComment(page, server);
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(say('noKey', { name: 'DeepSeek' }));
  await expect(part(page, 'action')).toHaveText(say('openSettings'));
  expect(server.requests).toHaveLength(0);
});

test('with the free translator the draft is translated on the page and nothing is sent', async ({ page, server, setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '' });
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altClick(page, '#comment');
  await expect(part(page, 'engine')).toHaveText(say('onDevice'));
  await expect(part(page, 'context-toggle')).toBeHidden();
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[en on device] ${DRAFT}`);
  await part(page, 'check').click();
  await expect(part(page, 'back')).toHaveText(say('back', { text: `[ru on device] [en on device] ${DRAFT}` }));
  const { creates } = await inContentScript(page, 'globalThis.fakeAI');
  // en>ru may come first: the Alt+click is also the first click on the page, which gets the reading model ready.
  const pairs = creates.map(({ sourceLanguage, targetLanguage }) => `${sourceLanguage}>${targetLanguage}`);
  expect(pairs.toSorted()).toEqual(['en>ru', 'ru>en']);
  expect(server.requests).toHaveLength(0);
});

test.describe('the toolbar popup', () => {
  test('opens the same window with a settings button and translates the draft', async ({ page, extensionId, server, context }) => {
    await page.goto(`chrome-extension://${extensionId}/compose.html`);
    await expect(page.locator('.pair')).toHaveText(`${languageLabel('ru')} \u2192`);
    await expect(page.locator('.target')).toHaveValue('en');
    await expect(page.locator('.draft')).toBeFocused();
    await page.locator('.draft').pressSequentially(DRAFT, { delay: 20 });
    await expect(page.locator('.translation')).toHaveText(`[RU] ${DRAFT}`);
    expect(systemOf(server.requests[0])).toContain('from Russian into English');
    const [options] = await Promise.all([context.waitForEvent('page'), page.locator('.settings').click()]);
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  });
});

test.describe('Alt+T', () => {
  // Alt+T as the keyboard sends it: the T is the physical key, whatever letter the layout puts on it.
  async function altT(page, key = 't') {
    const client = await page.context().newCDPSession(page);
    const send = (type, event) => client.send('Input.dispatchKeyEvent', { type, ...event });
    await send('rawKeyDown', { modifiers: 1, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
    await send('rawKeyDown', { modifiers: 1, key, code: 'KeyT', windowsVirtualKeyCode: 84 });
    await send('keyUp', { modifiers: 1, key, code: 'KeyT', windowsVirtualKeyCode: 84 });
    await send('keyUp', { modifiers: 0, key: 'Alt', code: 'AltLeft', windowsVirtualKeyCode: 18 });
    await client.detach();
  }

  test('opens the window at the field being typed in, and Esc gives the focus back to it', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    await page.locator('#comment').click();
    await page.mouse.move(60, 150);
    await altT(page);
    await expect(part(page, 'draft')).toBeFocused();
    const [field, box] = await Promise.all([page.locator('#comment').boundingBox(), compose(page).boundingBox()]);
    expect(Math.round(box.x)).toBe(Math.round(field.x));
    const below = Math.abs(box.y - (field.y + field.height + 6)) < 1;
    const above = Math.abs(box.y + box.height - (field.y - 6)) < 1;
    expect(below || above).toBe(true);
    await page.keyboard.press('Escape');
    await expect(compose(page)).toHaveCount(0);
    await expect(page.locator('#comment')).toBeFocused();
  });

  test('away from fields opens the window by the mouse, and the paragraph under it is not translated', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    const p1 = await page.locator('#p1').boundingBox();
    const mouse = { x: Math.round(p1.x + 40), y: Math.round(p1.y + 10) };
    await page.mouse.move(mouse.x, mouse.y);
    await altT(page);
    await expect(part(page, 'draft')).toBeFocused();
    const box = await compose(page).boundingBox();
    expect([Math.round(box.x), Math.round(box.y)]).toEqual([mouse.x, mouse.y + 22]);
    await page.waitForTimeout(500);
    await expect(page.locator('#paragloss-root')).toHaveCount(0);
    await expect(page.locator('#paragloss-hero')).toHaveCount(0);
    expect(server.requests).toHaveLength(0);
  });

  test('Alt+T again closes the window', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    await page.mouse.move(60, 150);
    await altT(page);
    await expect(part(page, 'draft')).toBeFocused();
    await altT(page);
    await expect(compose(page)).toHaveCount(0);
  });

  test('works in another keyboard layout, and the page does not hear the T', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    await page.mouse.move(60, 150);
    const before = await page.evaluate(() => window.pageKeys);
    await altT(page, String.fromCharCode(0x435)); // the Cyrillic letter on the T key
    await expect(part(page, 'draft')).toBeFocused();
    expect(await page.evaluate(() => window.pageKeys)).toBe(before + 1); // only the Alt
  });
});
