import { test, expect } from './fixtures.js';

// Runs `expression` in the extension's isolated world on `page`, where its content scripts live.
async function inContentScript(page, expression) {
  const client = await page.context().newCDPSession(page);
  const worlds = [];
  client.on('Runtime.executionContextCreated', ({ context }) => worlds.push(context));
  await client.send('Runtime.enable');
  const world = worlds.find((context) => context.auxData?.type === 'isolated' && context.name === 'Hover Translate');
  const { result } = await client.send('Runtime.evaluate', { expression, contextId: world.id, awaitPromise: true });
  await client.detach();
  return result.value;
}

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
