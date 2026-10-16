import { test, expect, altHover, moveTo, popupText, inContentScript, fakeBuiltInAI, say, languageLabel, chooseLanguage } from './fixtures.js';

const DRAFT = 'privet mir'; // the user's own language, in the Latin script the project's files keep to
const compose = (page) => page.locator('#spotslate-compose');
const part = (page, name) => compose(page).locator(`.${name}`);
const systemOf = (request) => request.body.messages[0].content;
// The reference turn before the draft (see lib/prompt.js), where the site context goes; '' without one.
const referenceOf = (request) =>
  request.body.messages.find(({ content }) => content.startsWith('Reference for the next text'))?.content ?? '';
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

// Presses `keys` one right after another, as fast typing does: none waits for what the one before set off.
async function rapidKeys(page, keys) {
  const codes = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 };
  const client = await page.context().newCDPSession(page);
  const sent = keys.flatMap((key) => {
    const event = { key, code: key, windowsVirtualKeyCode: codes[key], nativeVirtualKeyCode: codes[key] };
    return [
      client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...event }),
      client.send('Input.dispatchKeyEvent', { type: 'keyUp', ...event }),
    ];
  });
  await Promise.all(sent);
  await client.detach();
}

async function write(page, text) {
  await part(page, 'draft').pressSequentially(text, { delay: 20 });
}

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('Alt+click on a text field opens the compose window from the user language into the page language', async ({ page, server }) => {
  await openOnComment(page, server);
  await expect(part(page, 'source')).toHaveAttribute('data-value', 'ru');
  await expect(part(page, 'source').locator('.picker-button')).toHaveText('RU');
  await expect(part(page, 'source').locator('.picker-button')).toHaveAttribute('title', languageLabel('ru'));
  await expect(part(page, 'target')).toHaveAttribute('data-value', 'en');
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
    const translation = document.querySelector('#spotslate-compose').shadowRoot.querySelector('.translation');
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
  await chooseLanguage(compose(page), 'target', 'de');
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
  await chooseLanguage(compose(page), 'target', 'de');
  await expect.poll(() => server.requests.length).toBe(2);
  expect(systemOf(server.requests[1])).toContain('from Russian into German');
  await part(page, 'close').click();
  await page.reload();
  await altClick(page, '#comment');
  await expect(part(page, 'target')).toHaveAttribute('data-value', 'de');
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
  expect(referenceOf(server.requests.at(-1))).toContain('<notes>\nNotes: Our team moved the whole build to a shared continuous integr\n</notes>');
  expect(systemOf(server.requests.at(-1))).not.toContain('<notes>');
  await part(page, 'check').click();
  await expect(part(page, 'back')).toHaveText(say('back', { text: `[RU] [RU] ${DRAFT}` }));
  expect(referenceOf(server.requests.at(-1))).toBe('');
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

test.describe('the same language on both sides', () => {
  const MISTAKE = 'teh cat sat'; // the mock corrects "teh" into "the"

  async function writeIn(page, server, lang) {
    await openOnComment(page, server);
    await chooseLanguage(compose(page), 'source', lang);
    await part(page, 'draft').focus();
  }

  test('checks the draft: the corrections in place, a note on each in the user language, Copy takes the corrected text', async ({ page, server, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
    await writeIn(page, server, 'en');
    await expect(part(page, 'draft')).toHaveAttribute('placeholder', say('writeCheckPlaceholder'));
    await expect(part(page, 'translation')).toHaveAttribute('data-placeholder', say('correctionPlaceholder'));
    await expect(part(page, 'copy')).toHaveAttribute('title', say('copyCorrectedTitle'));
    await write(page, MISTAKE);
    await expect(part(page, 'added')).toHaveText('the');
    await expect(part(page, 'removed')).toHaveText('teh');
    await expect(part(page, 'translation')).toHaveText('teh the cat sat');
    await expect(part(page, 'fixes')).toHaveText('teh \u2192 the: spelling');
    expect(server.requests).toHaveLength(1);
    const [request] = server.requests;
    expect(systemOf(request)).toContain('The user is learning English and wrote the text in it.');
    expect(systemOf(request)).toContain('one short line in Russian for each correction');
    expect(userOf(request)).toBe(MISTAKE);
    await page.keyboard.press('Control+Enter');
    await expect(compose(page)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('the cat sat');
  });

  test('says when there are no mistakes, and Check translates the text back into the user language', async ({ page, server }) => {
    await writeIn(page, server, 'en');
    await write(page, 'the cat sat');
    await expect(part(page, 'fixes')).toHaveText(say('noMistakes'));
    await expect(part(page, 'translation')).toHaveText('the cat sat');
    await expect(part(page, 'added')).toHaveCount(0);
    await part(page, 'check').click();
    await expect(part(page, 'back')).toHaveText(say('back', { text: '[RU] the cat sat' }));
    expect(systemOf(server.requests.at(-1))).toContain("Translate the user's text into Russian.");
  });

  test('a different pair translates again, and the language on the left is remembered for the site only', async ({ page, server }) => {
    await writeIn(page, server, 'en');
    await write(page, MISTAKE);
    await expect(part(page, 'added')).toHaveText('the');
    await chooseLanguage(compose(page), 'source', 'de');
    await expect(part(page, 'draft')).toHaveAttribute('placeholder', say('writeOtherPlaceholder'));
    await expect(part(page, 'translation')).toHaveText(`[RU] ${MISTAKE}`);
    await expect(part(page, 'fixes')).toBeEmpty();
    expect(systemOf(server.requests.at(-1))).toContain('from German into English');
    await part(page, 'close').click();
    await page.reload();
    await altClick(page, '#comment');
    await expect(part(page, 'source')).toHaveAttribute('data-value', 'de');
    await page.keyboard.press('Escape');
    await page.goto(`http://other.test:${new URL(server.url).port}/page.html`);
    await altClick(page, '#comment');
    await expect(part(page, 'source')).toHaveAttribute('data-value', 'ru');
    await expect(part(page, 'draft')).toHaveAttribute('placeholder', say('writePlaceholder'));
  });

  test("with Chrome's translator only says that AI checks mistakes, and Copy takes the draft as it is", async ({ page, server, context, setSettings }) => {
    await setSettings({ provider: 'chrome', apiKey: '' });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
    await page.goto(`${server.url}/page.html`);
    await inContentScript(page, fakeBuiltInAI());
    await altClick(page, '#comment');
    await chooseLanguage(compose(page), 'source', 'en');
    await part(page, 'draft').focus();
    await write(page, MISTAKE);
    await expect(part(page, 'translation')).toHaveText(say('checkNeedsAi'));
    await part(page, 'copy').click();
    await expect(compose(page)).toHaveCount(0);
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(MISTAKE);
    expect(server.requests).toHaveLength(0);
  });

  test('works in the toolbar popup too, which shares the choice with the site', async ({ page, server, context, serviceWorker, extensionId }) => {
    await page.goto(`${server.url}/page.html`);
    const tabId = await serviceWorker.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, page.url());
    const toolbar = await context.newPage();
    await toolbar.goto(`chrome-extension://${extensionId}/compose.html?tab=${tabId}`);
    await chooseLanguage(toolbar, 'source', 'en');
    await toolbar.locator('.draft').pressSequentially(MISTAKE, { delay: 20 });
    await expect(toolbar.locator('.added')).toHaveText('the');
    await expect(toolbar.locator('.fixes')).toHaveText('teh \u2192 the: spelling');
    await toolbar.close();
    await page.bringToFront();
    await altClick(page, '#comment');
    await expect(part(page, 'source')).toHaveAttribute('data-value', 'en');
  });
});

test.describe('the toolbar popup', () => {
  test('opens the same window with a settings button and translates the draft', async ({ page, extensionId, server, context }) => {
    await page.goto(`chrome-extension://${extensionId}/compose.html`);
    await expect(page.locator('.source')).toHaveAttribute('data-value', 'ru');
    await expect(page.locator('.target')).toHaveAttribute('data-value', 'en');
    await expect(page.locator('.draft')).toBeFocused();
    await page.locator('.draft').pressSequentially(DRAFT, { delay: 20 });
    await expect(page.locator('.translation')).toHaveText(`[RU] ${DRAFT}`);
    expect(systemOf(server.requests[0])).toContain('from Russian into English');
    const [options] = await Promise.all([context.waitForEvent('page'), page.locator('.settings').click()]);
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  });
});

test.describe('Alt+T', () => {
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
    await expect(page.locator('#spotslate-root')).toHaveCount(0);
    await expect(page.locator('#spotslate-hero')).toHaveCount(0);
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

test.describe('a click elsewhere', () => {
  test('puts the window away with the draft kept, and the focus stays where the click went', async ({ page, server, context }) => {
    await openOnComment(page, server);
    await write(page, DRAFT);
    const other = await context.newPage(); // going to another tab and back leaves the window open
    await other.close();
    await page.bringToFront();
    await expect(compose(page)).toHaveCount(1);
    await page.locator('#comment').click();
    await expect(compose(page)).toHaveCount(0);
    await expect(page.locator('#comment')).toBeFocused();
    await altClick(page, '#comment');
    await expect(part(page, 'draft')).toHaveValue(DRAFT);
  });

});

test.describe('one window at a time', () => {
  test('a translation popup puts the compose window away, the draft kept', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    const p2 = await page.locator('#p2').boundingBox();
    await page.mouse.move(p2.x + 40, p2.y + 10);
    await altT(page);
    await expect(part(page, 'draft')).toBeFocused();
    await write(page, DRAFT);
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await page.keyboard.up('Alt');
    await expect(compose(page)).toHaveCount(0);
    await altClick(page, '#comment');
    await expect(part(page, 'draft')).toHaveValue(DRAFT);
    await expect(popupText(page)).toHaveCount(0);
  });

  test('the compose window puts the translation popup away', async ({ page, server }) => {
    await page.goto(`${server.url}/page.html`);
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await page.keyboard.up('Alt');
    await altT(page);
    await expect(part(page, 'draft')).toBeFocused();
    await expect(popupText(page)).toHaveCount(0);
  });
});

test.describe('the window frame', () => {
  test('a dim grip in the top left corner moves the window on the page', async ({ page, server }) => {
    await openOnComment(page, server);
    const grip = part(page, 'grip');
    const [box, handle] = await Promise.all([compose(page).boundingBox(), grip.boundingBox()]);
    expect(handle.x - box.x).toBeLessThan(16);
    expect(handle.y - box.y).toBeLessThan(16);
    expect(Number(await grip.evaluate((element) => getComputedStyle(element).opacity))).toBeLessThan(0.6);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 - 90, { steps: 5 });
    await page.mouse.up();
    const after = await compose(page).boundingBox();
    expect({ dx: Math.round(after.x - box.x), dy: Math.round(after.y - box.y) }).toEqual({ dx: 60, dy: -90 });
    await expect(part(page, 'draft')).toBeVisible();
  });

  test('the toolbar popup, which cannot be moved, has no grip', async ({ page, extensionId }) => {
    await page.goto(`chrome-extension://${extensionId}/compose.html`);
    await expect(page.locator('.draft')).toBeFocused();
    await expect(page.locator('.grip')).toHaveCount(0);
  });

  for (const scheme of ['dark', 'light']) {
    test(`the language lists open in the ${scheme} theme, the text readable on them`, async ({ page, server }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await openOnComment(page, server);
      await part(page, 'source').locator('.picker-button').click();
      const list = part(page, 'source').locator('.picker-list');
      await expect(list).toBeVisible();
      const look = await list.evaluate((element) => ({
        color: getComputedStyle(element.querySelector('.picker-option')).color,
        background: getComputedStyle(element).backgroundColor,
      }));
      expect(look).toEqual(
        scheme === 'dark'
          ? { color: 'rgb(230, 237, 243)', background: 'rgb(22, 27, 34)' }
          : { color: 'rgb(31, 35, 40)', background: 'rgb(255, 255, 255)' },
      );
    });
  }

  test('the title row is as in every window: the grip, the languages by code, settings and close', async ({ page, server, context, extensionId }) => {
    await openOnComment(page, server);
    for (const name of ['grip', 'settings', 'close']) await expect(part(page, name)).toBeVisible();
    await expect(part(page, 'source').locator('.picker-button')).toHaveText('RU');
    await expect(part(page, 'target').locator('.picker-button')).toHaveText('EN');
    await expect(part(page, 'target').locator('.picker-button')).toHaveAttribute('title', languageLabel('en'));
    const [options] = await Promise.all([context.waitForEvent('page'), part(page, 'settings').click()]);
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  });

  test('a language list shows every language by its code and its own name, the current one ticked', async ({ page, server }) => {
    await openOnComment(page, server);
    await part(page, 'target').locator('.picker-button').click();
    await expect(part(page, 'target').locator('.picker-option')).toHaveCount(13);
    await expect(part(page, 'target').locator('.picker-option[data-code="de"]')).toHaveText(/^DE\s*Deutsch/);
    await expect(part(page, 'target').locator('.picker-option[data-code="uk"]')).toContainText('\u0423\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430');
    await expect(part(page, 'target').locator('.picker-option[aria-selected="true"]')).toHaveAttribute('data-code', 'en');
  });

  test('a language list scrolls and stays open, and follows its button when the page scrolls', async ({ page, server }) => {
    await openOnComment(page, server);
    const button = part(page, 'target').locator('.picker-button');
    const list = part(page, 'target').locator('.picker-list');
    await button.click();
    await expect(list).toBeVisible();
    const box = await list.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    await list.evaluate((element) => element.scrollBy(0, 1000)); // as the scroll bar would
    const pageScroll = await page.evaluate(() => scrollY);
    await page.mouse.wheel(0, 300); // at its end: the page must not scroll instead
    await page.waitForTimeout(300);
    await expect(list).toBeVisible();
    expect(await page.evaluate(() => scrollY)).toBe(pageScroll);
    const offset = async () => (await list.boundingBox()).y - (await button.boundingBox()).y;
    const before = await offset();
    await page.evaluate(() => scrollBy(0, -40));
    await expect.poll(offset).toBeCloseTo(before, 0);
    await expect(list).toBeVisible();
  });

  test('a language list works from the keyboard, and Esc closes the list only', async ({ page, server }) => {
    await openOnComment(page, server);
    await write(page, DRAFT);
    await expect(part(page, 'translation')).toHaveText(`[RU] ${DRAFT}`);
    const list = part(page, 'target').locator('.picker-list');
    await part(page, 'target').locator('.picker-button').focus();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    await expect(part(page, 'target').locator('.picker-option[data-code="en"]')).toBeFocused();
    await page.keyboard.press('f');
    await expect(part(page, 'target').locator('.picker-option[data-code="fr"]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(list).toBeHidden();
    await expect(compose(page)).toHaveCount(1);
    await expect(part(page, 'target').locator('.picker-button')).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(list).toBeVisible();
    // Closed and opened again, down from English to German and chosen, faster than the list's own events come.
    await rapidKeys(page, ['Escape', 'ArrowDown', 'ArrowDown', 'Enter']);
    await expect(list).toBeHidden();
    await expect(compose(page)).toHaveCount(1);
    await expect(part(page, 'target')).toHaveAttribute('data-value', 'de');
    await expect.poll(() => server.requests.length).toBe(2);
    expect(systemOf(server.requests[1])).toContain('from Russian into German');
  });
});
