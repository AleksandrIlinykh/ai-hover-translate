import { test, expect } from './fixtures.js';

function translateViaPort(page, text) {
  return page.evaluate(
    (value) =>
      new Promise((resolve) => {
        const messages = [];
        const port = chrome.runtime.connect({ name: 'translate' });
        port.onMessage.addListener((message) => {
          messages.push(message);
          if (message.type !== 'chunk') {
            port.disconnect();
            resolve(messages);
          }
        });
        port.postMessage({ text: value });
      }),
    text,
  );
}

const joined = (messages) => messages.filter((m) => m.type === 'chunk').map((m) => m.text).join('');

test.beforeEach(async ({ page, extensionId }) => {
  await page.goto(`chrome-extension://${extensionId}/options.html`);
});

test('streams the translation in chunks and finishes with done', async ({ page, setSettings }) => {
  await setSettings();
  const messages = await translateViaPort(page, 'Hello, world');
  expect(joined(messages)).toBe('[RU] Hello, world');
  expect(messages.filter((m) => m.type === 'chunk').length).toBeGreaterThan(1);
  expect(messages.at(-1)).toEqual({ type: 'done' });
});

test('sends the key, model, prompt, stream flag and temperature', async ({ page, server, setSettings }) => {
  await setSettings({ targetLang: 'de', model: 'my-model' });
  await translateViaPort(page, 'Hello');
  expect(server.requests).toHaveLength(1);
  const [{ authorization, body }] = server.requests;
  expect(authorization).toBe('Bearer test-key');
  expect(body).toMatchObject({ model: 'my-model', stream: true, temperature: 1.3 });
  expect(body.messages[0].content).toContain("Translate the user's text into German.");
  expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
});

test('accepts a base URL with a trailing slash', async ({ page, server, setSettings }) => {
  await setSettings({ baseUrl: `${server.url}/` });
  expect(joined(await translateViaPort(page, 'Hi'))).toBe('[RU] Hi');
});

test('reports a missing key without calling the API', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: '' });
  expect(await translateViaPort(page, 'Hi')).toEqual([
    { type: 'error', code: 'no_key', message: 'DeepSeek API key is not set.' },
  ]);
  expect(server.requests).toHaveLength(0);
});

test('maps 401 and 402 to Russian messages', async ({ page, setSettings }) => {
  await setSettings({ apiKey: 'bad' });
  expect((await translateViaPort(page, 'Hi')).at(-1)).toEqual({
    type: 'error',
    code: 'auth',
    message: 'Invalid API key. Check it in the settings.',
  });
  await setSettings({ apiKey: 'broke' });
  expect((await translateViaPort(page, 'Hi')).at(-1)).toEqual({
    type: 'error',
    code: 'balance',
    message: 'Your DeepSeek balance has run out.',
  });
});

test('reports a stream without text as an empty answer', async ({ page, setSettings }) => {
  await setSettings({ apiKey: 'empty' });
  expect(await translateViaPort(page, 'Hi')).toEqual([
    { type: 'error', code: 'empty', message: 'The API returned an empty response.' },
  ]);
});

test('reports a network failure', async ({ page, setSettings }) => {
  await setSettings({ baseUrl: 'http://127.0.0.1:1' });
  expect(await translateViaPort(page, 'Hi')).toEqual([
    { type: 'error', code: 'network', message: 'Cannot connect to the API.' },
  ]);
});

test('keeps multi-byte characters split between chunks intact', async ({ page, setSettings }) => {
  await setSettings({ apiKey: 'split' });
  const messages = await translateViaPort(page, 'Hi');
  expect(joined(messages)).toBe('Hello 👋 world');
  expect(messages.at(-1)).toEqual({ type: 'done' });
});

test('aborts the API request when the port disconnects', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'slow' });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const port = chrome.runtime.connect({ name: 'translate' });
        port.onMessage.addListener(() => {
          port.disconnect();
          resolve();
        });
        port.postMessage({ text: 'Hello there, slow world' });
      }),
  );
  await expect.poll(() => server.requests[0]?.aborted).toBe(true);
});
