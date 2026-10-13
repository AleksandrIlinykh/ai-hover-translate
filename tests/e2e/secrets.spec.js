import { test, expect, inContentScript } from './fixtures.js';

test('content scripts cannot read the stored settings with the API key', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'sk-secret' });
  await page.goto(`${server.url}/page.html`);
  const outcome = await inContentScript(
    page,
    `chrome.storage.local.get(null).then((items) => JSON.stringify(items), (error) => 'denied: ' + error.message)`,
  );
  expect(outcome).toMatch(/^denied: /);
  expect(outcome).not.toContain('sk-secret');
});
