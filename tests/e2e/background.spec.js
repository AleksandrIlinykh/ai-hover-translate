import { test, expect } from './fixtures.js';

function translateViaPort(page, text, mode) {
  return page.evaluate(
    ({ value, mode }) =>
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
        port.postMessage({ text: value, mode });
      }),
    { value: text, mode },
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

test('sends the key, model, prompt, stream flag and temperature, with thinking off', async ({ page, server, setSettings }) => {
  await setSettings({ targetLang: 'de', model: 'my-model' });
  await translateViaPort(page, 'Hello');
  expect(server.requests).toHaveLength(1);
  const [{ authorization, body }] = server.requests;
  expect(authorization).toBe('Bearer test-key');
  expect(body).toMatchObject({ model: 'my-model', stream: true, temperature: 1.3, thinking: { type: 'disabled' } });
  expect(body.messages[0].content).toContain("Translate the user's text into German.");
  expect(body.messages[1]).toEqual({ role: 'user', content: 'Hello' });
});

test('sends a retired model name as deepseek-flash', async ({ page, server, setSettings }) => {
  await setSettings({ model: 'deepseek-chat' });
  await translateViaPort(page, 'Hello');
  expect(server.requests[0].body.model).toBe('deepseek-flash');
});

const askTopics = (page, text) => page.evaluate((value) => chrome.runtime.sendMessage({ type: 'topics', text: value }), text);

test('the topic message returns the tags from a small request that is not streamed', async ({ page, server, setSettings }) => {
  await setSettings();
  expect(await askTopics(page, 'Some long text')).toEqual({ topics: ['git', 'continuous integration', 'devops'] });
  expect(server.requests).toHaveLength(0);
  const [{ body }] = server.topicRequests;
  expect(body).toMatchObject({ model: 'deepseek-flash', stream: false, temperature: 0, max_tokens: 40, thinking: { type: 'disabled' } });
  expect(body.messages[1]).toEqual({ role: 'user', content: 'Some long text' });
});

test('the topic message returns no tags without a key or on an API error', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: '' });
  expect(await askTopics(page, 'Some long text')).toEqual({ topics: [] });
  await setSettings({ apiKey: 'bad' });
  expect(await askTopics(page, 'Some long text')).toEqual({ topics: [] });
  expect(server.topicRequests).toHaveLength(1);
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

test('a dictionary request uses the dictionary prompt', async ({ page, server, setSettings }) => {
  await setSettings();
  await translateViaPort(page, 'bank', 'dictionary');
  expect(server.requests[0].body.messages[0].content).toContain('bilingual dictionary');
});

test('an unknown mode falls back to a plain translation', async ({ page, server, setSettings }) => {
  await setSettings();
  await translateViaPort(page, 'bank', 'weird');
  expect(server.requests[0].body.messages[0].content).toContain('professional translator');
});

test('a repeated translation comes from the session cache, even on another page', async ({ context, page, server, setSettings, extensionId }) => {
  await setSettings();
  expect(joined(await translateViaPort(page, 'Hello cache'))).toBe('[RU] Hello cache');
  const other = await context.newPage();
  await other.goto(`chrome-extension://${extensionId}/options.html`);
  expect(await translateViaPort(other, 'Hello cache')).toEqual([{ type: 'chunk', text: '[RU] Hello cache' }, { type: 'done' }]);
  expect(server.requests).toHaveLength(1);
});

test('the session cache is per target language and per mode', async ({ page, server, setSettings }) => {
  await setSettings();
  await translateViaPort(page, 'Hi');
  await translateViaPort(page, 'Hi', 'dictionary');
  await setSettings({ targetLang: 'de' });
  await translateViaPort(page, 'Hi');
  expect(server.requests).toHaveLength(3);
});

test('errors are not cached', async ({ page, server, setSettings }) => {
  await setSettings({ apiKey: 'flaky' });
  expect((await translateViaPort(page, 'Hi')).at(-1).code).toBe('server');
  expect(joined(await translateViaPort(page, 'Hi'))).toBe('[RU] Hi');
  expect(server.requests).toHaveLength(2);
});
