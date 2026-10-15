import { test, expect, altHover, moveTo, popupText, inContentScript, fakeBuiltInAI } from './fixtures.js';

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
  await expect(part(page, 'pair')).toHaveText('Russian →');
  await expect(part(page, 'target')).toHaveValue('en');
  await expect(part(page, 'draft')).toHaveAttribute('placeholder', 'Write in Russian');
  await expect(part(page, 'engine')).toHaveText('DeepSeek');
  await expect(part(page, 'context')).toBeHidden();
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
  await expect(part(page, 'back')).toHaveText(`Back in Russian: [RU] [RU] ${DRAFT}`);
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

test('the passages the user read on the site guide the terms, until the context is dropped', async ({ page, server }) => {
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toContainText('[RU] The quick brown fox');
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await altClick(page, '#comment');
  await expect(part(page, 'context')).toContainText('1 passage read here');
  await write(page, 'the quick fox jumps');
  await expect.poll(() => server.requests.length).toBe(2);
  expect(systemOf(server.requests[1])).toContain('English: "The quick brown fox jumps over the lazy dog. Read more"');
  await part(page, 'drop-context').click();
  await expect(part(page, 'context')).toBeHidden();
  await expect.poll(() => server.requests.length).toBe(3);
  expect(systemOf(server.requests[2])).not.toContain('Earlier on this site');
});

test('the page topic goes with the draft', async ({ page, server }) => {
  await page.goto(`${server.url}/topics.html`);
  await altHover(page, '#long');
  await expect(popupText(page)).toContainText('[RU] Our team');
  await expect.poll(() => server.topicRequests.length).toBe(1);
  await page.keyboard.up('Alt');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const field = document.createElement('textarea');
    field.id = 'reply';
    document.querySelector('main').prepend(field);
  });
  await altClick(page, '#reply');
  await expect(part(page, 'context')).toContainText('git, continuous integration, devops');
  await write(page, DRAFT);
  await expect.poll(() => server.requests.length).toBe(2);
  expect(systemOf(server.requests[1])).toContain('Topic of the page the user is writing on: git, continuous integration, devops.');
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
  await expect(part(page, 'translation')).toHaveText('DeepSeek API key is not set.');
  await expect(part(page, 'action')).toHaveText('Open settings');
  expect(server.requests).toHaveLength(0);
});

test('with the free translator the draft is translated on the page and nothing is sent', async ({ page, server, setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '' });
  await page.goto(`${server.url}/page.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altClick(page, '#comment');
  await expect(part(page, 'engine')).toHaveText('Chrome, on this computer');
  await write(page, DRAFT);
  await expect(part(page, 'translation')).toHaveText(`[en on device] ${DRAFT}`);
  await part(page, 'check').click();
  await expect(part(page, 'back')).toHaveText(`Back in Russian: [ru on device] [en on device] ${DRAFT}`);
  const { creates } = await inContentScript(page, 'globalThis.fakeAI');
  // en>ru may come first: the Alt+click is also the first click on the page, which gets the reading model ready.
  const pairs = creates.map(({ sourceLanguage, targetLanguage }) => `${sourceLanguage}>${targetLanguage}`);
  expect(pairs.toSorted()).toEqual(['en>ru', 'ru>en']);
  expect(server.requests).toHaveLength(0);
});

test.describe('the toolbar popup', () => {
  test('opens the same window with a settings button and translates the draft', async ({ page, extensionId, server, context }) => {
    await page.goto(`chrome-extension://${extensionId}/compose.html`);
    await expect(page.locator('.pair')).toHaveText('Russian →');
    await expect(page.locator('.target')).toHaveValue('en');
    await expect(page.locator('.draft')).toBeFocused();
    await page.locator('.draft').pressSequentially(DRAFT, { delay: 20 });
    await expect(page.locator('.translation')).toHaveText(`[RU] ${DRAFT}`);
    expect(systemOf(server.requests[0])).toContain('from Russian into English');
    const [options] = await Promise.all([context.waitForEvent('page'), page.locator('.settings').click()]);
    await expect(options).toHaveURL(`chrome-extension://${extensionId}/options.html`);
  });
});
