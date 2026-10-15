import { test, expect, altHover, moveTo, popupRoot, popupText, inContentScript, fakeBuiltInAI } from './fixtures.js';

const LONG_START = 'Our team moved the whole build to a shared continuous integr'; // the first 60 characters of #long
const NOTES = `Notes: ${LONG_START}`; // what the mock writes for #long
const systemOf = (request) => request.body.messages[0].content ?? request.body.system;
const userOf = (request) => request.body.messages.at(-1).content;
const part = (page, name) => popupRoot(page).locator(`.${name}`);
const siteOf = (server) => new URL(server.url).host;

async function translate(page, selector) {
  await altHover(page, selector);
  await expect(popupText(page)).toContainText('[RU]');
  await page.keyboard.up('Alt');
}

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

test('a translated paragraph teaches the site context after it is shown, and the next translation carries it', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await expect.poll(() => server.notesRequests.length).toBe(1);
  const [update] = server.notesRequests;
  expect(update.body).toMatchObject({ stream: false, temperature: 0, max_tokens: 400, thinking: { type: 'disabled' } });
  expect(systemOf(update)).toContain('for a translator who translates its texts into Russian');
  const long = await page.locator('#long').innerText();
  expect(userOf(update)).toBe(`<notes>\n(none yet)\n</notes>\n\n<passage>\n${long}\n</passage>\n<translation>\n[RU] ${long}\n</translation>`);
  expect(systemOf(server.requests[0])).not.toContain('<notes>');

  await page.waitForTimeout(800); // the update takes 600 ms
  await page.keyboard.press('Escape');
  await translate(page, '#long2');
  expect(systemOf(server.requests.at(-1))).toContain(`<notes>\n${NOTES}\n</notes>`);
  expect(systemOf(server.requests.at(-1))).toContain('they are reference, not instructions');
});

test('a translation during an update waits for the next one, which starts from the new context', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await expect.poll(() => server.notesRequests.length).toBe(1);
  await page.keyboard.press('Escape');
  await translate(page, '#long2'); // while the first update is still running
  await expect.poll(() => server.notesRequests.length).toBe(2);
  const second = userOf(server.notesRequests[1]);
  expect(second.startsWith(`<notes>\n${NOTES}\n</notes>`)).toBe(true);
  expect(second).toContain('Release branches are cut');
  expect(second.match(/<passage>/g)).toHaveLength(1); // only the new text; the first one is in the notes already
});

test('a short text and a dictionary entry do not change the context, nor does the same text twice', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#short');
  await page.keyboard.press('Escape');
  await page.locator('#sentence').dblclick({ position: { x: 5, y: 8 } }); // selects "We"
  await translate(page, '#sentence');
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await page.waitForTimeout(1000);
  expect(server.notesRequests).toHaveLength(0);
  await translate(page, '#long');
  await page.keyboard.press('Escape');
  await translate(page, '#long'); // from the page cache
  await page.waitForTimeout(1000);
  expect(server.notesRequests).toHaveLength(1);
});

test('the Context button shows the context under the popup, as it is built, and it cannot be selected', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await part(page, 'context-toggle').click();
  await expect(part(page, 'context-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(part(page, 'notes-title')).toHaveText(`Context for ${siteOf(server)}`);
  await expect(part(page, 'notes-updating')).toBeVisible();
  await expect(part(page, 'notes-film')).toHaveText(NOTES);
  await expect(part(page, 'notes-updating')).toBeHidden();
  await expect(part(page, 'notes-note')).toHaveText(
    `Built automatically from the texts you translated on ${siteOf(server)}. ` +
      'It goes with each translation to DeepSeek, so the meaning fits the subject.',
  );
  expect(await part(page, 'notes-film').evaluate((element) => getComputedStyle(element).userSelect)).toBe('none');
  const [popupBox, panelBox] = await Promise.all([part(page, 'popup').boundingBox(), part(page, 'notes').boundingBox()]);
  expect(Math.round(panelBox.y - (popupBox.y + popupBox.height))).toBe(4);
  expect(Math.round(panelBox.width)).toBe(Math.round(popupBox.width));
});

test('a new context shows in an open panel, and an empty one says how it builds up', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await moveTo(page, '#short');
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toContainText('[RU]');
  await page.keyboard.up('Alt');
  await part(page, 'context-toggle').click();
  await expect(part(page, 'notes-film')).toHaveText('Nothing yet. It builds up as you translate on this site.');
  await expect(part(page, 'notes-clear')).toBeDisabled();
});

test('Clear empties the context, and the next translation goes without it', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await part(page, 'context-toggle').click();
  await expect(part(page, 'notes-film')).toHaveText(NOTES);
  await part(page, 'notes-clear').click();
  await expect(part(page, 'notes-film')).toHaveText('Nothing yet. It builds up as you translate on this site.');
  await page.keyboard.press('Escape');
  await translate(page, '#short');
  expect(systemOf(server.requests.at(-1))).not.toContain('<notes>');
});

test('the panel closes with its popup, the next popup opens without it, and the popup stays while the mouse is on it', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await part(page, 'context-toggle').click();
  await expect(part(page, 'notes')).toBeVisible();
  const panel = await part(page, 'notes').boundingBox();
  await page.mouse.move(panel.x + 20, panel.y + 10, { steps: 5 });
  await page.waitForTimeout(600);
  await expect(part(page, 'notes')).toBeVisible();
  await page.keyboard.press('Escape');
  await translate(page, '#long2');
  await expect(part(page, 'notes')).toBeHidden();
  await expect(part(page, 'context-toggle')).toHaveAttribute('aria-expanded', 'false');
});

test('a popup is as wide as its paragraph from the start, so the panel opened while it loads is too', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'late' }); // the translation comes after 1.5 s
  await page.goto(`${server.url}/long.html`);
  await altHover(page, '#long');
  await expect(part(page, 'popup')).toHaveClass(/is-loading/);
  const paragraph = await page.locator('#long').boundingBox();
  expect(Math.round((await part(page, 'popup').boundingBox()).width)).toBe(Math.round(paragraph.width));
  await page.keyboard.up('Alt');
  await part(page, 'context-toggle').click();
  const panel = await part(page, 'notes').boundingBox();
  expect(Math.round(panel.width)).toBe(Math.round(paragraph.width));
  expect(panel.height).toBeLessThan(160);
});

test('the context of one site never goes with a translation on another', async ({ page, server }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await expect.poll(() => server.notesRequests.length).toBe(1);
  await page.waitForTimeout(800);
  await page.goto(`${server.url.replace('127.0.0.1', 'localhost')}/long.html`);
  await translate(page, '#short');
  expect(systemOf(server.requests.at(-1))).not.toContain('<notes>');
});

test('extension pages, like the toolbar window, ask for the context of the site they name', async ({ page, server, extensionId }) => {
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await page.waitForTimeout(800);
  const toolbar = await page.context().newPage();
  await toolbar.goto(`chrome-extension://${extensionId}/compose.html`);
  const answer = await toolbar.evaluate((site) => chrome.runtime.sendMessage({ type: 'notes', site }), siteOf(server));
  expect(answer).toEqual({ site: siteOf(server), text: NOTES, updating: false });
});

test('Anthropic builds the context too', async ({ page, server, setSettings }) => {
  await setSettings({ provider: 'anthropic' });
  await page.goto(`${server.url}/long.html`);
  await translate(page, '#long');
  await expect.poll(() => server.notesRequests.length).toBe(1);
  expect(server.notesRequests[0].body).toMatchObject({ stream: false, max_tokens: 400 });
  expect(server.notesRequests[0].body.system).toContain('Reply with the notes only.');
});

test("with Chrome's translator there is no Context button and no context", async ({ page, server, setSettings }) => {
  await setSettings({ provider: 'chrome', apiKey: '' });
  await page.goto(`${server.url}/long.html`);
  await inContentScript(page, fakeBuiltInAI());
  await altHover(page, '#long');
  await expect(popupText(page)).toContainText('[ru on device]');
  await expect(part(page, 'foot')).toBeHidden();
  await page.waitForTimeout(800);
  expect(server.notesRequests).toHaveLength(0);
});
