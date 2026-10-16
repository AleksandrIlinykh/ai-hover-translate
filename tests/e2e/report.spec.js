import { test, expect, altHover, popupRoot, popupText, say } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';

test.beforeEach(async ({ setSettings }) => {
  await setSettings();
});

// The tabs background opens are recorded instead, so nothing goes to GitHub.
async function recordTabs(serviceWorker) {
  await serviceWorker.evaluate(() => {
    globalThis.openedTabs = [];
    chrome.tabs.create = async ({ url }) => globalThis.openedTabs.push(url);
  });
  return () => serviceWorker.evaluate(() => globalThis.openedTabs);
}

test('Report opens a GitHub issue with the setup only, and copies the text for the user to paste if they can share it', async ({ page, server, context, serviceWorker }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: server.url });
  const opened = await recordTabs(serviceWorker);
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await expect(popupRoot(page).locator('.report')).toHaveText(say('report'));
  await popupRoot(page).locator('.report').click();
  await expect.poll(async () => (await opened()).length).toBe(1);
  const [address] = await opened();
  const url = new URL(address);
  expect(url.origin + url.pathname).toBe('https://github.com/AleksandrIlinykh/spotslate/issues/new');
  expect(url.searchParams.get('template')).toBe('translation.yml');
  const setup = url.searchParams.get('setup');
  expect(setup).toContain('SpotSlate 0.1.0');
  expect(setup).toContain('DeepSeek, deepseek-flash');
  expect(setup).toContain('into Russian, a paragraph');
  expect(address).not.toContain('quick');
  expect(address).not.toContain(new URL(server.url).host);
  await expect(popupRoot(page).locator('.report')).toHaveText(say('reportCopied'));
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard.replace(/\s*\r?\n\s*/g, '\n')).toBe(`${P1}\n[RU] ${P1}`); // the line breaks as the system keeps them
});

test('Report waits for a translation', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'late' });
  await page.goto(`${server.url}/page.html`);
  await altHover(page, '#p1');
  await expect(popupRoot(page).locator('.popup')).toHaveClass(/is-loading/);
  await expect(popupRoot(page).locator('.report')).toBeHidden();
});
