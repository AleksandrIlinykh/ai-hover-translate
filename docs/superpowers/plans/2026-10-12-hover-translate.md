# Hover Translate Implementation Plan

> The first implementation plan, kept as written. The project has been renamed Paragloss since, and much has changed; the current design is in `docs/superpowers/specs/2026-10-12-paragloss-design.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome MV3 extension: hold Alt and hover a paragraph → a popup above it shows a streamed DeepSeek translation into the chosen language.

**Architecture:** No build step. `extension/` is loaded into Chrome as-is: a module service worker (`background.js` + `lib/*`) talks to the OpenAI-compatible DeepSeek API and streams chunks over a `chrome.runtime` port to classic content scripts (`content/block.js`, `content/popup.js`, `content/main.js`) that detect the trigger, find the text block and render a Shadow-DOM popup. Tests live outside `extension/`: `node --test` unit tests for pure `lib/` modules and Playwright e2e tests that load the real extension into Chromium against a local mock API.

**Tech Stack:** Plain JavaScript (ES2023), Chrome Manifest V3, Node 24 (`node:test`), `@playwright/test` (dev only).

**Spec:** `docs/superpowers/specs/2026-10-12-hover-translate-design.md`

## Global Constraints

- Run every command from the repo root `hover-translate/` (Windows, Git Bash or PowerShell both fine).
- `extension/` has no runtime dependencies and no build; Chrome loads it directly. Never put `node_modules` or test files inside `extension/`.
- `extension/background.js`, `extension/options.js`, `extension/lib/*.js` are ES modules. `extension/content/*.js` are classic scripts: each is an IIFE that registers its exports on `globalThis.hoverTranslate`; no top-level `const`/`let` outside the IIFE.
- Content scripts: `matches: ["<all_urls>"]`, top frame only, `run_at: "document_end"`, order `content/block.js`, `content/popup.js`, `content/main.js`.
- Constants (exact): `TRIGGER_DELAY_MS = 200`, `LEAVE_GRACE_MS = 300`, `MAX_CHARS = 3000`, `CACHE_LIMIT = 100`, `IDLE_TIMEOUT_MS = 30_000`, `TEMPERATURE = 1.3`, popup `GAP = 6`, `MARGIN = 8`, `SHIFT_X = 32`, `MIN_SPACE_ABOVE = 120`, `MAX_WIDTH = 480`, `MIN_HEIGHT = 80`.
- Settings defaults (exact): `apiKey: ''`, `targetLang: 'ru'`, `model: 'deepseek-chat'`, `baseUrl: 'https://api.deepseek.com'`; stored in `chrome.storage.local` under key `settings`.
- Popup host: `<div id="hover-translate-root">` with an open shadow root; inside it `.popup` > `.text` + `button.settings`.
- All user-facing text is English and copied verbatim from the spec's error table.
- Git: the repo has a local identity configured already. Commit messages are short.

## Review Focus

1. A paragraph taller than the window, scrolled so its top is above the viewport → the popup must still be fully inside the window (Task 6, test "a paragraph taller than the window…").
2. A multi-byte UTF-8 character split between two network chunks → the translation must have no `�` characters (Task 5, test "keeps multi-byte characters…").
3. Moving the mouse from the paragraph into the popup to select/copy text (crossing the 6 px gap), even with Alt held → the popup stays open and no new request is sent (Task 7, test "moving from the paragraph into the popup…").
4. Switching to another paragraph while a translation is still streaming → only the new paragraph's text appears, the old request is aborted (Task 7, test "switching paragraphs mid-stream…").
5. Hostile page CSS (`div { display: none !important }`, global `font-size`/`color` with `!important`) → popup visible, 14 px, readable (Task 6, test "page styles do not hide…").

---

### Task 1: Project scaffold, settings and prompt

**Files:**
- Create: `package.json`
- Create: `extension/lib/settings.js`
- Create: `extension/lib/prompt.js`
- Test: `tests/unit/settings.test.js`
- Test: `tests/unit/prompt.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DEFAULTS: Readonly<{ apiKey: string, targetLang: string, model: string, baseUrl: string }>`
  - `LANGUAGES: Readonly<Record<string, string>>`: code to English name (used in the prompt and the options page). 13 entries: ru, en, de, fr, es, it, pt, pl, uk, tr, zh, ja, ko.
  - `withDefaults(stored: unknown): { apiKey, targetLang, model, baseUrl }`: pure.
  - `loadSettings(): Promise<same shape>`: reads `chrome.storage.local`, applies `withDefaults`.
  - `buildMessages(text: string, languageName: string): Array<{ role: 'system' | 'user', content: string }>`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "hover-translate",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test",
    "test:e2e": "playwright test"
  }
}
```

`node --test` without arguments discovers `**/*.test.js` outside `node_modules`, i.e. `tests/unit/*.test.js`. E2E files are named `*.spec.js` so it ignores them.

- [ ] **Step 2: Write the failing tests**

`tests/unit/settings.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, LANGUAGES, withDefaults } from '../../extension/lib/settings.js';

test('withDefaults returns the defaults when nothing is stored', () => {
  assert.deepEqual(withDefaults(undefined), { ...DEFAULTS });
});

test('withDefaults keeps stored values', () => {
  const stored = { apiKey: 'sk-1', targetLang: 'de', model: 'deepseek-reasoner', baseUrl: 'https://example.com/v1' };
  assert.deepEqual(withDefaults(stored), stored);
});

test('withDefaults trims values and replaces blanks with defaults', () => {
  assert.deepEqual(withDefaults({ apiKey: '  sk-1\n', model: '   ', baseUrl: '' }), { ...DEFAULTS, apiKey: 'sk-1' });
});

test('withDefaults falls back to the default language for unknown codes', () => {
  assert.equal(withDefaults({ targetLang: 'xx' }).targetLang, 'ru');
});

test('withDefaults ignores unknown keys and non-string values', () => {
  assert.deepEqual(withDefaults({ extra: 'x', apiKey: 42 }), { ...DEFAULTS });
});

test('every language has a two-letter code and an English name', () => {
  assert.equal(Object.keys(LANGUAGES).length, 13);
  for (const [code, name] of Object.entries(LANGUAGES)) {
    assert.match(code, /^[a-z]{2}$/);
    assert.match(name, /^[A-Z][A-Za-z ()]+$/, code);
  }
  assert.equal(LANGUAGES[DEFAULTS.targetLang], 'Russian');
});
```

`tests/unit/prompt.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMessages } from '../../extension/lib/prompt.js';

test('buildMessages puts the language into the system prompt and the text into the user message', () => {
  const messages = buildMessages('Hello,\nworld', 'German');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].role, 'system');
  assert.match(messages[0].content, /Translate the user's text into German\./);
  assert.match(messages[0].content, /If the text is already in German, return it unchanged\./);
  assert.deepEqual(messages[1], { role: 'user', content: 'Hello,\nworld' });
});

test('buildMessages asks for the translation only and keeps line breaks', () => {
  const [system] = buildMessages('x', 'Russian');
  assert.match(system.content, /Output only the translation/);
  assert.match(system.content, /line breaks/);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '…/extension/lib/settings.js'` and the same for `prompt.js`.

- [ ] **Step 4: Implement `extension/lib/settings.js`**

```js
export const DEFAULTS = Object.freeze({
  apiKey: '',
  targetLang: 'ru',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
});

export const LANGUAGES = Object.freeze({
  ru: 'Russian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  uk: 'Ukrainian',
  tr: 'Turkish',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
});

// Trimmed stored values over the defaults; blanks, non-strings and unknown languages fall back.
export function withDefaults(stored) {
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = stored?.[key];
    if (typeof value === 'string' && value.trim() !== '') settings[key] = value.trim();
  }
  if (!Object.hasOwn(LANGUAGES, settings.targetLang)) settings.targetLang = DEFAULTS.targetLang;
  return settings;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}
```

- [ ] **Step 5: Implement `extension/lib/prompt.js`**

```js
export function buildMessages(text, languageName) {
  return [
    {
      role: 'system',
      content:
        `You are a professional translator. Translate the user's text into ${languageName}. ` +
        'Output only the translation, with no explanations, notes, or quotes. ' +
        'Preserve the meaning, tone, and line breaks. ' +
        'Leave code, URLs, and names that are normally not translated as they are. ' +
        `If the text is already in ${languageName}, return it unchanged.`,
    },
    { role: 'user', content: text },
  ];
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 8 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add package.json extension/lib/settings.js extension/lib/prompt.js tests/unit/settings.test.js tests/unit/prompt.test.js
git commit -m "feat: add settings defaults and translation prompt"
```

---

### Task 2: SSE stream parser

**Files:**
- Create: `extension/lib/sse.js`
- Test: `tests/unit/sse.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `createSseParser(): { push(chunk: string): string[], flush(): string[] }`: returns the payloads of complete `data:` lines.
  - `deltaFromPayload(payload: string): { done: true } | { text: string } | null`

- [ ] **Step 1: Write the failing tests**

`tests/unit/sse.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSseParser, deltaFromPayload } from '../../extension/lib/sse.js';

test('push returns the data payloads of complete lines', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"a":1}\n\ndata: [DONE]\n\n'), ['{"a":1}', '[DONE]']);
});

test('a line split between chunks is returned once it is complete', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: {"a"'), []);
  assert.deepEqual(parser.push(':1}\n'), ['{"a":1}']);
});

test('CRLF line endings work, even with CR and LF in different chunks', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: one\r'), []);
  assert.deepEqual(parser.push('\ndata: two\r\n'), ['one', 'two']);
});

test('comments and other fields are ignored', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push(': keep-alive\nevent: message\nid: 1\ndata: x\n'), ['x']);
});

test('only one space after "data:" is removed', () => {
  assert.deepEqual(createSseParser().push('data:x\ndata:  y\n'), ['x', ' y']);
});

test('flush returns the last line when the stream ends without a newline', () => {
  const parser = createSseParser();
  assert.deepEqual(parser.push('data: [DONE]'), []);
  assert.deepEqual(parser.flush(), ['[DONE]']);
  assert.deepEqual(parser.flush(), []);
});

test('flush drops a trailing CR', () => {
  const parser = createSseParser();
  parser.push('data: [DONE]\r');
  assert.deepEqual(parser.flush(), ['[DONE]']);
});

test('deltaFromPayload recognises the end marker', () => {
  assert.deepEqual(deltaFromPayload('[DONE]'), { done: true });
});

test('deltaFromPayload extracts delta content', () => {
  assert.deepEqual(deltaFromPayload('{"choices":[{"index":0,"delta":{"content":"Hello"}}]}'), { text: 'Hello' });
});

test('deltaFromPayload returns null for payloads without text', () => {
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"role":"assistant"}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"content":""}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[{"delta":{"content":null}}]}'), null);
  assert.equal(deltaFromPayload('{"choices":[]}'), null);
  assert.equal(deltaFromPayload('{'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '…/extension/lib/sse.js'`.

- [ ] **Step 3: Implement `extension/lib/sse.js`**

```js
function dataPayload(line) {
  return line.startsWith('data:') ? line.slice(5).replace(/^ /, '') : null;
}

function payloadsOf(lines) {
  return lines.map(dataPayload).filter((payload) => payload !== null);
}

// Splits a server-sent-events text stream into the payloads of its `data:` lines.
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      return payloadsOf(lines);
    },
    flush() {
      const line = buffer.replace(/\r$/, '');
      buffer = '';
      return payloadsOf([line]);
    },
  };
}

export function deltaFromPayload(payload) {
  if (payload === '[DONE]') return { done: true };
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  const content = data?.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content !== '' ? { text: content } : null;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/sse.js tests/unit/sse.test.js
git commit -m "feat: add SSE parser for streamed completions"
```

---

### Task 3: Error messages

**Files:**
- Create: `extension/lib/errors.js`
- Test: `tests/unit/errors.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `makeError(code: 'no_key' | 'auth' | 'balance' | 'rate_limit' | 'network' | 'timeout' | 'empty'): { code, message }`
  - `errorFromStatus(status: number, bodyText: string): { code: string, message: string }`

- [ ] **Step 1: Write the failing tests**

`tests/unit/errors.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errorFromStatus, makeError } from '../../extension/lib/errors.js';

const STATUS_CASES = [
  [401, '{"error":{"message":"Authentication Fails"}}', 'auth', 'Invalid API key. Check it in the settings.'],
  [402, '', 'balance', 'Your DeepSeek balance has run out.'],
  [429, '', 'rate_limit', 'Too many requests. Please wait a moment.'],
  [400, '{"error":{"message":"Invalid model"}}', 'bad_request', 'Invalid API request: Invalid model'],
  [422, '{"error":{"message":"Bad params"}}', 'bad_request', 'Invalid API request: Bad params'],
  [400, '', 'bad_request', 'Invalid API request'],
  [500, '', 'server', 'The API server is unavailable (500). Try again later.'],
  [503, '<html>busy</html>', 'server', 'The API server is unavailable (503). Try again later.'],
  [404, '{"error":{"message":"Not Found"}}', 'http', 'API error 404: Not Found'],
  [418, 'not json', 'http', 'API error 418'],
  [404, '{"error":{"message":"   "}}', 'http', 'API error 404'],
];

for (const [status, body, code, message] of STATUS_CASES) {
  test(`errorFromStatus ${status} ${JSON.stringify(body)}`, () => {
    assert.deepEqual(errorFromStatus(status, body), { code, message });
  });
}

test('makeError returns the fixed texts', () => {
  assert.deepEqual(makeError('no_key'), { code: 'no_key', message: 'DeepSeek API key is not set.' });
  assert.deepEqual(makeError('network'), { code: 'network', message: 'Cannot connect to the API.' });
  assert.deepEqual(makeError('timeout'), { code: 'timeout', message: 'The API did not respond within 30 seconds.' });
  assert.deepEqual(makeError('empty'), { code: 'empty', message: 'The API returned an empty response.' });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `Cannot find module '…/extension/lib/errors.js'`.

- [ ] **Step 3: Implement `extension/lib/errors.js`**

```js
const MESSAGES = {
  no_key: 'DeepSeek API key is not set.',
  auth: 'Invalid API key. Check it in the settings.',
  balance: 'Your DeepSeek balance has run out.',
  rate_limit: 'Too many requests. Please wait a moment.',
  network: 'Cannot connect to the API.',
  timeout: 'The API did not respond within 30 seconds.',
  empty: 'The API returned an empty response.',
};

export function makeError(code) {
  return { code, message: MESSAGES[code] };
}

export function errorFromStatus(status, bodyText) {
  const apiMessage = parseApiMessage(bodyText);
  const tail = apiMessage ? `: ${apiMessage}` : '';
  switch (status) {
    case 401:
      return makeError('auth');
    case 402:
      return makeError('balance');
    case 429:
      return makeError('rate_limit');
    case 400:
    case 422:
      return { code: 'bad_request', message: `Invalid API request${tail}` };
    case 500:
    case 503:
      return { code: 'server', message: `The API server is unavailable (${status}). Try again later.` };
    default:
      return { code: 'http', message: `API error ${status}${tail}` };
  }
}

function parseApiMessage(bodyText) {
  try {
    const message = JSON.parse(bodyText)?.error?.message;
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    return '';
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all tests, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add extension/lib/errors.js tests/unit/errors.test.js
git commit -m "feat: map API failures to Russian error messages"
```

---

### Task 4: Manifest, options page and e2e harness

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js` (stub; replaced in Task 5)
- Create: `extension/options.html`
- Create: `extension/options.js`
- Create: `playwright.config.js`
- Create: `tests/mock-server.js`
- Create: `tests/e2e/fixtures.js`
- Test: `tests/e2e/options.spec.js`
- Modify: `package.json` (devDependency added by npm)

**Interfaces:**
- Consumes: `DEFAULTS`, `LANGUAGES`, `withDefaults`, `loadSettings` from `extension/lib/settings.js` (Task 1).
- Produces:
  - Options page at `chrome-extension://<id>/options.html` with fields `#apiKey`, `#targetLang`, `#model`, `#baseUrl`, submit button "Save", `#status`.
  - `startMockServer(): Promise<{ url: string, requests: Array<{ authorization?: string, body: object, aborted: boolean }>, close(): Promise<void> }>`: serves `GET /<name>.html` from `tests/fixtures/` and `POST /chat/completions`. API key picks behaviour: `bad` → 401, `broke` → 402, `empty` → stream without text, `slow` → one chunk per second, `split` → "Hello 👋 world" with the emoji cut between two writes, otherwise `[RU] <last message content>` in three chunks.
  - Playwright fixtures in `tests/e2e/fixtures.js`: `test` (with `server`, `context`, `serviceWorker`, `extensionId`, `setSettings(overrides?)`), `expect`, and helpers `popupRoot(page)`, `popupText(page)`, `popupBox(page)`, `moveTo(page, selector, offset?)`, `altHover(page, selector)`. `setSettings()` defaults to `{ apiKey: 'test-key', targetLang: 'ru', model: 'deepseek-chat', baseUrl: server.url }`.

- [ ] **Step 1: Install Playwright**

Run: `npm install --save-dev @playwright/test` then `npx playwright install chromium`
Expected: `package.json` gains `"devDependencies": { "@playwright/test": "<version>" }`, `package-lock.json` is created, Chromium downloads.

- [ ] **Step 2: Create `playwright.config.js`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  timeout: 30_000,
  reporter: 'list',
});
```

- [ ] **Step 3: Create `tests/mock-server.js`**

```js
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const FIXTURES = new URL('./fixtures/', import.meta.url);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sseData = (content) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content } }] })}\n\n`;

// Fake OpenAI-compatible API plus the fixture pages, on a random local port.
// The API key picks the behaviour: bad → 401, broke → 402, empty → no text,
// slow → one chunk per second, split → a four-byte emoji cut between writes,
// anything else → "[RU] <text>" in three chunks.
export async function startMockServer() {
  const requests = [];
  const server = http.createServer((req, res) => {
    handle(req, res, requests).catch((error) => {
      console.error(error);
      res.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  };
}

async function handle(req, res, requests) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
  } else if (req.method === 'GET' && /^\/[\w-]+\.html$/.test(req.url)) {
    const html = await readFile(new URL(req.url.slice(1), FIXTURES));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
  } else if (req.method === 'POST' && req.url === '/chat/completions') {
    await completions(req, res, requests);
  } else {
    res.writeHead(404).end();
  }
}

async function completions(req, res, requests) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const record = {
    authorization: req.headers.authorization,
    body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    aborted: false,
  };
  requests.push(record);

  let finished = false;
  res.on('close', () => {
    if (!finished) record.aborted = true;
  });
  const finish = (data) => {
    finished = true;
    res.end(data);
  };

  const key = record.authorization?.replace(/^Bearer /, '');
  if (key === 'bad' || key === 'broke') {
    const [status, message] = key === 'bad' ? [401, 'Authentication Fails'] : [402, 'Insufficient Balance'];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    finish(JSON.stringify({ error: { message, type: 'invalid_request_error' } }));
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.write(': keep-alive\n\n');

  if (key === 'empty') {
    finish('data: [DONE]\n\n');
    return;
  }

  if (key === 'split') {
    const bytes = Buffer.from(sseData('Hello 👋 world'));
    const cut = bytes.indexOf(Buffer.from('👋')) + 2;
    res.write(bytes.subarray(0, cut));
    await delay(50);
    res.write(bytes.subarray(cut));
    finish('data: [DONE]\n\n');
    return;
  }

  const translation = `[RU] ${record.body.messages.at(-1).content}`;
  const size = Math.ceil(translation.length / 3);
  const pause = key === 'slow' ? 1000 : 30;
  for (let i = 0; i < translation.length; i += size) {
    if (i > 0) await delay(pause);
    if (record.aborted) return;
    res.write(sseData(translation.slice(i, i + size)));
  }
  finish('data: [DONE]\n\n');
}
```

- [ ] **Step 4: Create `tests/e2e/fixtures.js`**

```js
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, chromium, expect } from '@playwright/test';
import { startMockServer } from '../mock-server.js';

const EXTENSION_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../extension');

export const test = base.extend({
  server: async ({}, use) => {
    const server = await startMockServer();
    await use(server);
    await server.close();
  },
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
    });
    await use(context);
    await context.close();
  },
  serviceWorker: async ({ context }, use) => {
    const [existing] = context.serviceWorkers();
    await use(existing ?? (await context.waitForEvent('serviceworker')));
  },
  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host);
  },
  setSettings: async ({ serviceWorker, server }, use) => {
    await use(async (overrides = {}) => {
      const settings = { apiKey: 'test-key', targetLang: 'ru', model: 'deepseek-chat', baseUrl: server.url, ...overrides };
      await serviceWorker.evaluate((value) => chrome.storage.local.set({ settings: value }), settings);
    });
  },
});

export { expect };

export const popupRoot = (page) => page.locator('#hover-translate-root');
export const popupText = (page) => popupRoot(page).locator('.text');
export const popupBox = (page) => popupRoot(page).locator('.popup');

export async function moveTo(page, selector, offset = { x: 5, y: 5 }) {
  const target = page.locator(selector);
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + offset.x, box.y + offset.y, { steps: 3 });
}

export async function altHover(page, selector) {
  await moveTo(page, selector);
  await page.keyboard.down('Alt');
}
```

- [ ] **Step 5: Write the failing options tests**

`tests/e2e/options.spec.js`:

```js
import { test, expect } from './fixtures.js';

const optionsUrl = (extensionId) => `chrome-extension://${extensionId}/options.html`;

test('shows the defaults when nothing is saved', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#apiKey')).toHaveValue('');
  await expect(page.locator('#targetLang')).toHaveValue('ru');
  await expect(page.locator('#model')).toHaveValue('deepseek-chat');
  await expect(page.locator('#baseUrl')).toHaveValue('https://api.deepseek.com');
  await expect(page.locator('#targetLang option')).toHaveCount(13);
});

test('saves trimmed values and restores blanks to defaults', async ({ page, extensionId, serviceWorker }) => {
  await page.goto(optionsUrl(extensionId));
  await page.locator('#apiKey').fill('  sk-test  ');
  await page.locator('#targetLang').selectOption('de');
  await page.locator('#model').fill('');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#status')).toHaveText('Saved');
  await expect(page.locator('#model')).toHaveValue('deepseek-chat');
  const { settings } = await serviceWorker.evaluate(() => chrome.storage.local.get('settings'));
  expect(settings).toEqual({ apiKey: 'sk-test', targetLang: 'de', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com' });
});

test('shows saved values when opened again', async ({ page, extensionId, server, setSettings }) => {
  await setSettings({ apiKey: 'sk-saved', targetLang: 'ja' });
  await page.goto(optionsUrl(extensionId));
  await expect(page.locator('#apiKey')).toHaveValue('sk-saved');
  await expect(page.locator('#targetLang')).toHaveValue('ja');
  await expect(page.locator('#baseUrl')).toHaveValue(server.url);
});

test('the saved status disappears when a field changes', async ({ page, extensionId }) => {
  await page.goto(optionsUrl(extensionId));
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#status')).toHaveText('Saved');
  await page.locator('#apiKey').fill('sk-other');
  await expect(page.locator('#status')).toHaveText('');
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/options.spec.js`
Expected: FAIL, Chromium cannot load the extension (`extension/manifest.json` missing), so the `serviceWorker` fixture times out.

- [ ] **Step 7: Create `extension/manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Hover Translate",
  "version": "0.1.0",
  "description": "Hold Alt and hover over a paragraph to see its DeepSeek translation above it.",
  "permissions": ["storage"],
  "host_permissions": ["https://api.deepseek.com/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "options_ui": { "page": "options.html", "open_in_tab": true },
  "action": { "default_title": "Hover Translate settings" }
}
```

- [ ] **Step 8: Create the `extension/background.js` stub**

```js
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
```

- [ ] **Step 9: Create `extension/options.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hover Translate settings</title>
  <style>
    :root { color-scheme: light dark; font: 15px/1.5 system-ui, sans-serif; }
    body { max-width: 520px; margin: 40px auto; padding: 0 16px; }
    label { display: block; margin: 16px 0 4px; font-weight: 600; }
    input, select { box-sizing: border-box; width: 100%; padding: 6px 8px; font: inherit; }
    .hint { margin: 4px 0 0; font-size: 13px; opacity: 0.7; }
    button { margin-top: 20px; padding: 6px 16px; font: inherit; }
    #status { margin-left: 12px; }
  </style>
</head>
<body>
  <h1>Hover Translate</h1>
  <p>Hold Alt and hover over a paragraph to see its translation above it.</p>
  <form id="form">
    <label for="apiKey">DeepSeek API key</label>
    <input id="apiKey" name="apiKey" type="password" autocomplete="off" spellcheck="false">
    <p class="hint">Get a key: <a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">platform.deepseek.com/api_keys</a></p>

    <label for="targetLang">Target language</label>
    <select id="targetLang" name="targetLang"></select>

    <label for="model">Model</label>
    <input id="model" name="model" spellcheck="false">

    <label for="baseUrl">API URL</label>
    <input id="baseUrl" name="baseUrl" spellcheck="false">
    <p class="hint">Any OpenAI-compatible API. Default: https://api.deepseek.com</p>

    <button type="submit">Save</button><span id="status" role="status"></span>
  </form>
  <script type="module" src="options.js"></script>
</body>
</html>
```

- [ ] **Step 10: Create `extension/options.js`**

```js
import { DEFAULTS, LANGUAGES, loadSettings, withDefaults } from './lib/settings.js';

const form = document.getElementById('form');
const status = document.getElementById('status');
const fields = Object.keys(DEFAULTS);

for (const [code, name] of Object.entries(LANGUAGES)) {
  form.elements.targetLang.add(new Option(name, code));
}

function fill(settings) {
  for (const field of fields) form.elements[field].value = settings[field];
}

fill(await loadSettings());

form.addEventListener('input', () => {
  status.textContent = '';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const settings = withDefaults(Object.fromEntries(fields.map((field) => [field, form.elements[field].value])));
  await chrome.storage.local.set({ settings });
  fill(settings);
  status.textContent = 'Saved';
});
```

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/options.spec.js` and `npm test`
Expected: PASS, 4 e2e tests; unit tests still green.

- [ ] **Step 12: Commit**

```bash
git add package.json package-lock.json playwright.config.js extension/manifest.json extension/background.js extension/options.html extension/options.js tests/mock-server.js tests/e2e/fixtures.js tests/e2e/options.spec.js
git commit -m "feat: add manifest, options page and e2e harness"
```

---

### Task 5: Background translation over a port

**Files:**
- Modify: `extension/background.js` (replace the stub entirely)
- Test: `tests/e2e/background.spec.js`

**Interfaces:**
- Consumes: `buildMessages` (Task 1), `LANGUAGES`, `loadSettings` (Task 1), `createSseParser`, `deltaFromPayload` (Task 2), `errorFromStatus`, `makeError` (Task 3); test fixtures (Task 4).
- Produces: port protocol used by `content/main.js`:
  - content → background: `chrome.runtime.connect({ name: 'translate' })`, then `port.postMessage({ text })`.
  - background → content: `{ type: 'chunk', text }`*, then exactly one of `{ type: 'done' }` or `{ type: 'error', code, message }`. Nothing is sent after the content side disconnects; disconnecting aborts the HTTP request.
  - `chrome.runtime.sendMessage({ type: 'open-options' })` opens the options page.

- [ ] **Step 1: Write the failing tests**

`tests/e2e/background.spec.js` (extension pages may open ports to the background, so the options page hosts the port):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/background.spec.js`
Expected: FAIL, every `translateViaPort` call times out (the stub has no `onConnect` listener).

- [ ] **Step 3: Replace `extension/background.js`**

```js
import { buildMessages } from './lib/prompt.js';
import { createSseParser, deltaFromPayload } from './lib/sse.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, loadSettings } from './lib/settings.js';

const IDLE_TIMEOUT_MS = 30_000;
const TEMPERATURE = 1.3; // DeepSeek's recommended temperature for translation

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  port.onMessage.addListener(({ text }) => {
    translate(text, controller.signal, (message) => {
      if (connected) port.postMessage(message);
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function translate(text, signal, send) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    send({ type: 'error', ...makeError('no_key') });
    return;
  }

  const idle = new AbortController();
  let timer = 0;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    touch();
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages: buildMessages(text, LANGUAGES[settings.targetLang]),
        stream: true,
        temperature: TEMPERATURE,
      }),
      signal: AbortSignal.any([signal, idle.signal]),
    });
    if (!response.ok) {
      send({ type: 'error', ...errorFromStatus(response.status, await response.text()) });
      return;
    }
    let gotText = false;
    await readStream(response.body, touch, (chunk) => {
      gotText = true;
      send({ type: 'chunk', text: chunk });
    });
    send(gotText ? { type: 'done' } : { type: 'error', ...makeError('empty') });
  } catch {
    if (signal.aborted) return; // the page closed the popup
    send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network') });
  } finally {
    clearTimeout(timer);
  }
}

async function readStream(body, touch, onText) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    touch();
    const { done, value } = await reader.read();
    const payloads = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
    for (const payload of payloads) {
      const delta = deltaFromPayload(payload);
      if (delta?.done) {
        await reader.cancel();
        return;
      }
      if (delta) onText(delta.text);
    }
    if (done) return;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/background.spec.js`
Expected: PASS, 9 tests.

If every API-calling test reports `network` instead (Chrome's Local Network Access blocking the extension's requests to `127.0.0.1`), confirm it in the service worker console, then add `'--disable-features=LocalNetworkAccessChecks'` to the `args` array in `tests/e2e/fixtures.js` and rerun. Do not change the extension to work around it.

- [ ] **Step 5: Commit**

```bash
git add extension/background.js tests/e2e/background.spec.js
git commit -m "feat: stream DeepSeek translations to content scripts over a port"
```

---

### Task 6: Content scripts: trigger, block detection, popup

**Files:**
- Create: `extension/content/block.js`
- Create: `extension/content/popup.js`
- Create: `extension/content/main.js` (first version; replaced in Task 7)
- Modify: `extension/manifest.json` (add `content_scripts`)
- Create: `tests/fixtures/page.html`
- Create: `tests/fixtures/hostile.html`
- Test: `tests/e2e/content.spec.js`

**Interfaces:**
- Consumes: port protocol (Task 5); test fixtures and mock server (Task 4).
- Produces (on `globalThis.hoverTranslate`, isolated world only):
  - `findBlock(element: Node | null): HTMLElement | null`
  - `blockText(block: HTMLElement): string`
  - `createPopup({ onOpenSettings: () => void })` returning
    `{ open(block: HTMLElement): void, setText(text: string): void, setError(message: string, options?: { withSettings?: boolean }): void, close(): void, isOpen(): boolean, getBlock(): HTMLElement | null, getRect(): DOMRect, isOwn(node: unknown): boolean }`.
  - DOM: `#hover-translate-root` (open shadow root) › `.popup` (classes `is-loading`, `is-error`, `has-settings`) › `.text`, `button.settings`.

- [ ] **Step 1: Create the fixture pages**

`tests/fixtures/page.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hover Translate fixture</title>
  <style>
    body { margin: 0; font: 16px/1.5 sans-serif; }
    main { width: 600px; margin: 0 auto; padding: 300px 0 2000px; }
    p, li, div { margin: 0 0 24px; }
    #tall { width: 200px; line-height: 3; }
  </style>
</head>
<body>
  <p id="top" style="position: absolute; top: 4px; left: 100px; margin: 0;">Paragraph at the very top</p>
  <main>
    <p id="p1">The quick brown fox jumps over the lazy dog. <a href="#">Read more</a></p>
    <p id="p2">Second paragraph with <span id="p2-span">an inline span</span> inside.</p>
    <ul><li id="li1">List item text</li></ul>
    <div id="card"><span id="card-text">Text in a div without paragraphs</span></div>
    <p id="digits">12345 67890</p>
    <input id="input" value="Input text">
    <div id="editable" contenteditable="true">Editable text</div>
    <div id="huge"></div>
    <p id="tall"></p>
  </main>
  <script>
    document.getElementById('huge').textContent = 'Lorem ipsum dolor sit amet. '.repeat(150);
    document.getElementById('tall').textContent = 'Tall paragraph text. '.repeat(120);
  </script>
</body>
</html>
```

`#huge` is 4200 characters (over `MAX_CHARS`); `#tall` is 2520 characters but ~4800 px high.

`tests/fixtures/hostile.html`:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Hostile styles</title>
  <style>
    body { margin: 0; padding: 300px 40px 0; }
    div { display: none !important; position: static !important; }
    * { font-size: 40px !important; color: transparent !important; }
  </style>
</head>
<body>
  <p id="p1">Hostile page paragraph.</p>
</body>
</html>
```

- [ ] **Step 2: Write the failing tests**

`tests/e2e/content.spec.js`:

```js
import { test, expect, moveTo, altHover, popupRoot, popupText, popupBox } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const P2 = 'Second paragraph with an inline span inside.';

test.beforeEach(async ({ page, server, setSettings }) => {
  await setSettings();
  await page.goto(`${server.url}/page.html`);
});

async function expectNothingAfterAWhile(page, server) {
  await page.waitForTimeout(500);
  await expect(popupRoot(page)).toHaveCount(0);
  expect(server.requests).toHaveLength(0);
}

test('Alt + hover shows the streamed translation of the paragraph', async ({ page, server }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0].body.messages[1].content).toBe(P1);
});

test('hovering without Alt does nothing', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await expectNothingAfterAWhile(page, server);
});

test('Alt combined with another key does not translate', async ({ page, server }) => {
  await moveTo(page, '#p1');
  await page.keyboard.down('Alt');
  await page.keyboard.press('x');
  await expectNothingAfterAWhile(page, server);
});

test('pressing Alt first and then moving onto a paragraph translates it', async ({ page }) => {
  await page.keyboard.down('Alt');
  await moveTo(page, '#p2');
  await expect(popupText(page)).toHaveText(`[RU] ${P2}`);
});

test('moving to another paragraph with Alt held switches the translation', async ({ page, server }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  await moveTo(page, '#p2');
  await expect(popupText(page)).toHaveText(`[RU] ${P2}`);
  await expect(popupRoot(page)).toHaveCount(1);
  expect(server.requests).toHaveLength(2);
});

for (const [selector, text] of [
  ['#p2-span', P2],
  ['#li1', 'List item text'],
  ['#card-text', 'Text in a div without paragraphs'],
]) {
  test(`hovering ${selector} translates its block`, async ({ page, server }) => {
    await altHover(page, selector);
    await expect(popupText(page)).toHaveText(`[RU] ${text}`);
    expect(server.requests[0].body.messages[1].content).toBe(text);
  });
}

for (const selector of ['#digits', '#input', '#editable', '#huge']) {
  test(`hovering ${selector} does not translate`, async ({ page, server }) => {
    await altHover(page, selector);
    await expectNothingAfterAWhile(page, server);
  });
}

test('the popup sits above the paragraph, shifted to the right', async ({ page }) => {
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
  const paragraph = await page.locator('#p1').boundingBox();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return { gap: Math.round(paragraph.y - (box.y + box.height)), shift: Math.round(box.x - paragraph.x) };
    })
    .toEqual({ gap: 6, shift: 32 });
});

test('a paragraph at the top of the window gets the popup below it', async ({ page }) => {
  await altHover(page, '#top');
  await expect(popupText(page)).toHaveText('[RU] Paragraph at the very top');
  const paragraph = await page.locator('#top').boundingBox();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return Math.round(box.y - (paragraph.y + paragraph.height));
    })
    .toBe(6);
});

test('a paragraph taller than the window still gets a popup inside the window', async ({ page }) => {
  await page.locator('#tall').evaluate((el) => window.scrollTo(0, el.offsetTop + 1000));
  const paragraph = await page.locator('#tall').boundingBox();
  expect(paragraph.y).toBeLessThan(0);
  await page.mouse.move(paragraph.x + 20, 360);
  await page.keyboard.down('Alt');
  await expect(popupText(page)).toContainText('[RU] Tall paragraph text.');
  const { height } = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await popupBox(page).boundingBox();
      return box.y >= 0 && box.y + box.height <= height;
    })
    .toBe(true);
});

test('page styles do not hide or restyle the popup', async ({ page, server }) => {
  await page.goto(`${server.url}/hostile.html`);
  await altHover(page, '#p1');
  await expect(popupText(page)).toHaveText('[RU] Hostile page paragraph.');
  await expect(popupBox(page)).toBeVisible();
  const style = await popupBox(page).evaluate((el) => {
    const computed = getComputedStyle(el);
    return { fontSize: computed.fontSize, color: computed.color };
  });
  expect(style.fontSize).toBe('14px');
  expect(style.color).not.toBe('rgba(0, 0, 0, 0)');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/content.spec.js`
Expected: FAIL, positive tests time out waiting for `#hover-translate-root .text`; the negative ones pass trivially (nothing is injected yet).

- [ ] **Step 4: Create `extension/content/block.js`**

```js
(() => {
  const BLOCK_DISPLAYS = new Set(['block', 'list-item', 'table-cell', 'table-caption', 'flex', 'grid', 'flow-root']);
  const MAX_CHARS = 3000;
  const LETTER = /\p{L}/u;

  // The element itself or its nearest block-level ancestor that holds readable text.
  function findBlock(start) {
    let node = start?.nodeType === Node.TEXT_NODE ? start.parentElement : start;
    if (!(node instanceof Element)) return null;
    if (node.closest('input, textarea, select') || node.isContentEditable) return null;
    for (; node && node !== document.body && node !== document.documentElement; node = node.parentElement) {
      if (!(node instanceof HTMLElement)) continue;
      if (!BLOCK_DISPLAYS.has(getComputedStyle(node).display)) continue;
      const text = node.innerText;
      if (!LETTER.test(text)) continue;
      return text.trim().length > MAX_CHARS ? null : node;
    }
    return null;
  }

  function blockText(block) {
    return block.innerText.trim().replace(/\n{3,}/g, '\n\n');
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { findBlock, blockText });
})();
```

- [ ] **Step 5: Create `extension/content/popup.js`**

```js
(() => {
  const ROOT_ID = 'hover-translate-root';
  const GAP = 6;
  const MARGIN = 8;
  const SHIFT_X = 32;
  const MIN_SPACE_ABOVE = 120;
  const MAX_WIDTH = 480;
  const MIN_HEIGHT = 80;

  // Inline !important beats any page rule, including `div { display: none !important }`.
  const HOST_STYLE = ['all: initial', 'position: absolute', 'top: 0', 'left: 0', 'display: block', 'z-index: 2147483647']
    .map((rule) => `${rule} !important`)
    .join('; ');

  const POPUP_CSS = `
    .popup {
      box-sizing: border-box;
      width: max-content;
      overflow-y: auto;
      padding: 10px 12px;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      background: #ffffff;
      color: #1f2328;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
      cursor: auto;
    }
    .popup.is-loading .text { animation: pulse 1s ease-in-out infinite; }
    .popup.is-error .text { color: #cf222e; }
    .settings {
      display: none;
      margin-top: 8px;
      padding: 4px 10px;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .popup.has-settings .settings { display: block; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-color-scheme: dark) {
      .popup { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .popup.is-error .text { color: #ff7b72; }
    }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function createPopup({ onOpenSettings }) {
    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = HOST_STYLE;
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(POPUP_CSS);
    shadow.adoptedStyleSheets = [sheet];

    const popupEl = document.createElement('div');
    popupEl.className = 'popup';
    const textEl = document.createElement('div');
    textEl.className = 'text';
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'settings';
    settingsButton.textContent = 'Open settings';
    settingsButton.addEventListener('click', () => onOpenSettings());
    popupEl.append(textEl, settingsButton);
    shadow.append(popupEl);

    let block = null;
    let side = 'above';
    let frame = 0;

    function render(text, { loading = false, error = false, withSettings = false } = {}) {
      textEl.textContent = text;
      popupEl.classList.toggle('is-loading', loading);
      popupEl.classList.toggle('is-error', error);
      popupEl.classList.toggle('has-settings', withSettings);
    }

    function chooseSide(rect) {
      if (rect.top >= MIN_SPACE_ABOVE) return 'above';
      return window.innerHeight - rect.bottom >= rect.top ? 'below' : 'above';
    }

    function position() {
      const rect = block.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const space = side === 'above' ? rect.top : viewportHeight - rect.bottom;
      popupEl.style.maxWidth = `${Math.min(MAX_WIDTH, viewportWidth - 2 * MARGIN)}px`;
      popupEl.style.maxHeight = `${Math.max(space - GAP - MARGIN, MIN_HEIGHT)}px`;
      const { width, height } = popupEl.getBoundingClientRect();
      const wantedTop = side === 'above' ? rect.top - GAP - height : rect.bottom + GAP;
      const top = clamp(wantedTop, MARGIN, viewportHeight - MARGIN - height);
      const left = clamp(rect.left + SHIFT_X, MARGIN, viewportWidth - MARGIN - width);
      host.style.setProperty('top', `${top + window.scrollY}px`, 'important');
      host.style.setProperty('left', `${left + window.scrollX}px`, 'important');
    }

    function schedulePosition() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (block) position();
      });
    }

    return {
      open(target) {
        block = target;
        side = chooseSide(block.getBoundingClientRect());
        render('…', { loading: true });
        document.documentElement.append(host);
        popupEl.scrollTop = 0;
        position();
      },
      setText(text) {
        render(text);
        schedulePosition();
      },
      setError(message, { withSettings = false } = {}) {
        render(message, { error: true, withSettings });
        schedulePosition();
      },
      close() {
        cancelAnimationFrame(frame);
        frame = 0;
        host.remove();
        block = null;
      },
      isOpen: () => block !== null,
      getBlock: () => block,
      getRect: () => popupEl.getBoundingClientRect(),
      // Events and elementFromPoint retarget anything inside the shadow root to the host.
      isOwn: (node) => node === host,
    };
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { createPopup });
})();
```

- [ ] **Step 6: Create `extension/content/main.js` (first version)**

```js
(() => {
  const { findBlock, blockText, createPopup } = globalThis.hoverTranslate;

  const TRIGGER_DELAY_MS = 200;

  const popup = createPopup({ onOpenSettings: () => {} });

  let mouseX = null;
  let mouseY = null;
  let altDown = false;
  let combo = false;
  let usedAlt = false;
  let triggerTimer = 0;
  let port = null;

  function trigger() {
    if (!altDown || combo || mouseX === null) return;
    const element = document.elementFromPoint(mouseX, mouseY);
    if (!element || popup.isOwn(element)) return;
    const block = findBlock(element);
    if (!block || block === popup.getBlock()) return;
    usedAlt = true;
    show(block);
  }

  function show(block) {
    closePopup();
    popup.open(block);
    translate(blockText(block));
  }

  function translate(text) {
    const current = chrome.runtime.connect({ name: 'translate' });
    port = current;
    let result = '';
    current.onMessage.addListener((message) => {
      if (port !== current) return;
      if (message.type === 'chunk') {
        result += message.text;
        popup.setText(result);
      } else if (message.type === 'done') {
        disconnect();
      } else if (message.type === 'error') {
        popup.setError(message.message);
        disconnect();
      }
    });
    current.postMessage({ text });
  }

  function disconnect() {
    const current = port;
    port = null;
    current?.disconnect();
  }

  function closePopup() {
    disconnect();
    popup.close();
  }

  function scheduleTrigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(trigger, TRIGGER_DELAY_MS);
  }

  function releaseAlt() {
    altDown = false;
    clearTimeout(triggerTimer);
  }

  addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (altDown && !event.altKey) releaseAlt(); // keyup happened outside the page
      if (altDown && !combo) scheduleTrigger();
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt') {
        if (event.repeat) return;
        altDown = true;
        combo = false;
        usedAlt = false;
        scheduleTrigger();
        return;
      }
      if (altDown) {
        combo = true; // Alt+Tab, Alt+←, … are not translation requests
        clearTimeout(triggerTimer);
      }
    },
    true,
  );

  addEventListener(
    'keyup',
    (event) => {
      if (event.key !== 'Alt') return;
      releaseAlt();
      if (usedAlt) {
        usedAlt = false;
        event.preventDefault(); // stop Chrome on Windows from focusing its "⋮" menu
      }
    },
    true,
  );

  addEventListener('blur', releaseAlt);
})();
```

- [ ] **Step 7: Register the content scripts in `extension/manifest.json`**

Add after the `"background"` line:

```json
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content/block.js", "content/popup.js", "content/main.js"],
      "run_at": "document_end"
    }
  ],
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/content.spec.js`
Expected: PASS, 16 tests.

- [ ] **Step 9: Run the whole suite**

Run: `npm test` and `npm run test:e2e`
Expected: PASS, all unit and e2e tests.

- [ ] **Step 10: Commit**

```bash
git add extension/content extension/manifest.json tests/fixtures tests/e2e/content.spec.js
git commit -m "feat: translate the hovered paragraph into a popup on Alt"
```

---

### Task 7: Popup lifecycle, cache and errors in the popup

**Files:**
- Modify: `extension/content/main.js` (replace entirely with the final version below)
- Test: `tests/e2e/popup-lifecycle.spec.js`

**Interfaces:**
- Consumes: `findBlock`, `blockText`, `createPopup` (Task 6); port protocol and `open-options` message (Task 5); fixtures (Task 4).
- Produces: final content behaviour: closing on Esc / outside mousedown / leaving block+popup for `LEAVE_GRACE_MS` / window resize / new translation; per-page cache (≤ `CACHE_LIMIT`, cleared on `chrome.storage.onChanged` for `settings`); error display with "Open settings" for `no_key`; content-side errors for an invalidated extension context and a dropped port.

- [ ] **Step 1: Write the failing tests**

`tests/e2e/popup-lifecycle.spec.js`:

```js
import { test, expect, moveTo, altHover, popupRoot, popupText, popupBox } from './fixtures.js';

const P1 = 'The quick brown fox jumps over the lazy dog. Read more';
const P2 = 'Second paragraph with an inline span inside.';

async function openOn(page, selector, text) {
  await altHover(page, selector);
  await expect(popupText(page)).toHaveText(`[RU] ${text}`);
}

test.describe('with a working key', () => {
  test.beforeEach(async ({ page, server, setSettings }) => {
    await setSettings();
    await page.goto(`${server.url}/page.html`);
  });

  test('Esc closes the popup', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('leaving the paragraph and the popup closes it', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    await page.mouse.move(5, 700);
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('moving from the paragraph into the popup keeps it open', async ({ page, server }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    const box = await popupBox(page).boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 5 });
    await page.keyboard.down('Alt');
    await page.waitForTimeout(600);
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    expect(server.requests).toHaveLength(1);
  });

  test('a mousedown outside the popup closes it', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.keyboard.up('Alt');
    await page.mouse.down();
    await page.mouse.up();
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('resizing the window closes the popup', async ({ page }) => {
    await openOn(page, '#p1', P1);
    await page.setViewportSize({ width: 1000, height: 700 });
    await expect(popupRoot(page)).toHaveCount(0);
  });

  test('translating the same paragraph again uses the page cache', async ({ page, server }) => {
    await openOn(page, '#p1', P1);
    await page.waitForTimeout(200); // let the 'done' message land before closing
    await page.keyboard.press('Escape');
    await page.keyboard.up('Alt');
    await page.keyboard.down('Alt');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    expect(server.requests).toHaveLength(1);
  });

  test('changing the settings clears the cache', async ({ page, server, setSettings }) => {
    await openOn(page, '#p1', P1);
    await page.waitForTimeout(200);
    await page.keyboard.press('Escape');
    await page.keyboard.up('Alt');
    await setSettings({ targetLang: 'de' });
    await page.keyboard.down('Alt');
    await expect(popupText(page)).toHaveText(`[RU] ${P1}`);
    await expect.poll(() => server.requests.length).toBe(2);
  });

  test('closing the popup cancels the request in flight', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'slow' });
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await page.keyboard.press('Escape');
    await expect(popupRoot(page)).toHaveCount(0);
    await expect.poll(() => server.requests[0].aborted).toBe(true);
  });

  test('switching paragraphs mid-stream shows only the new translation', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'slow' });
    await altHover(page, '#p1');
    await expect(popupText(page)).toContainText('[RU]');
    await moveTo(page, '#p2');
    await expect(popupText(page)).toHaveText(`[RU] ${P2}`, { timeout: 10_000 });
    expect(server.requests[0].aborted).toBe(true);
  });
});

test.describe('errors', () => {
  test('a wrong key shows the auth message without a settings button', async ({ page, server, setSettings }) => {
    await setSettings({ apiKey: 'bad' });
    await page.goto(`${server.url}/page.html`);
    await altHover(page, '#p1');
    await expect(popupText(page)).toHaveText('Invalid API key. Check it in the settings.');
    await expect(popupBox(page)).toHaveClass(/is-error/);
    await expect(popupRoot(page).locator('.settings')).toBeHidden();
  });

  test('a missing key offers to open the settings', async ({ page, server, setSettings, context, extensionId }) => {
    await setSettings({ apiKey: '' });
    await page.goto(`${server.url}/page.html`);
    await altHover(page, '#p1');
    await expect(popupText(page)).toHaveText('DeepSeek API key is not set.');
    await page.keyboard.up('Alt');
    const [optionsPage] = await Promise.all([
      context.waitForEvent('page'),
      popupRoot(page).locator('.settings').click(),
    ]);
    await expect(optionsPage).toHaveURL(`chrome-extension://${extensionId}/options.html`);
    expect(server.requests).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/e2e/popup-lifecycle.spec.js`
Expected: FAIL, Esc / leave / mousedown / resize tests time out waiting for the popup to disappear; the cache test sees 2 requests; the settings-button test times out waiting for a new page. ("moving into the popup", "wrong key", "mid-stream" may already pass.)

- [ ] **Step 3: Replace `extension/content/main.js`**

```js
(() => {
  const { findBlock, blockText, createPopup } = globalThis.hoverTranslate;

  const TRIGGER_DELAY_MS = 200;
  const LEAVE_GRACE_MS = 300;
  const CACHE_LIMIT = 100;

  const cache = new Map();
  const popup = createPopup({
    onOpenSettings: () => chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
  });

  let mouseX = null;
  let mouseY = null;
  let altDown = false;
  let combo = false;
  let usedAlt = false;
  let triggerTimer = 0;
  let leaveTimer = 0;
  let port = null;

  function trigger() {
    if (!altDown || combo || mouseX === null) return;
    const element = document.elementFromPoint(mouseX, mouseY);
    if (!element || popup.isOwn(element)) return;
    const block = findBlock(element);
    if (!block || block === popup.getBlock()) return;
    usedAlt = true;
    show(block);
  }

  function show(block) {
    closePopup();
    const text = blockText(block);
    popup.open(block);
    const cached = cache.get(text);
    if (cached === undefined) translate(text);
    else popup.setText(cached);
  }

  function translate(text) {
    let current;
    try {
      current = chrome.runtime.connect({ name: 'translate' });
    } catch {
      popup.setError('The extension was updated. Reload the page.');
      return;
    }
    port = current;
    let result = '';
    current.onMessage.addListener((message) => {
      if (port !== current) return;
      if (message.type === 'chunk') {
        result += message.text;
        popup.setText(result);
      } else if (message.type === 'done') {
        remember(text, result);
        disconnect();
      } else if (message.type === 'error') {
        popup.setError(message.message, { withSettings: message.code === 'no_key' });
        disconnect();
      }
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return; // we disconnected on purpose
      port = null;
      popup.setError('The translation was interrupted. Try again.');
    });
    current.postMessage({ text });
  }

  function disconnect() {
    const current = port;
    port = null;
    current?.disconnect();
  }

  function remember(text, translation) {
    cache.delete(text);
    cache.set(text, translation);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  function closePopup() {
    disconnect();
    clearTimeout(leaveTimer);
    leaveTimer = 0;
    popup.close();
  }

  function isInside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function checkLeave() {
    if (!popup.isOpen()) return;
    const inside =
      isInside(popup.getBlock().getBoundingClientRect(), mouseX, mouseY) || isInside(popup.getRect(), mouseX, mouseY);
    if (inside) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    } else if (!leaveTimer) {
      leaveTimer = setTimeout(closePopup, LEAVE_GRACE_MS);
    }
  }

  function scheduleTrigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(trigger, TRIGGER_DELAY_MS);
  }

  function releaseAlt() {
    altDown = false;
    clearTimeout(triggerTimer);
  }

  addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (altDown && !event.altKey) releaseAlt(); // keyup happened outside the page
      if (altDown && !combo) scheduleTrigger();
      checkLeave();
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt') {
        if (event.repeat) return;
        altDown = true;
        combo = false;
        usedAlt = false;
        scheduleTrigger();
        return;
      }
      if (altDown) {
        combo = true; // Alt+Tab, Alt+←, … are not translation requests
        clearTimeout(triggerTimer);
      }
      if (event.key === 'Escape' && popup.isOpen()) closePopup();
    },
    true,
  );

  addEventListener(
    'keyup',
    (event) => {
      if (event.key !== 'Alt') return;
      releaseAlt();
      if (usedAlt) {
        usedAlt = false;
        event.preventDefault(); // stop Chrome on Windows from focusing its "⋮" menu
      }
    },
    true,
  );

  addEventListener('blur', releaseAlt);

  addEventListener('resize', () => {
    if (popup.isOpen()) closePopup();
  });

  addEventListener(
    'mousedown',
    (event) => {
      if (popup.isOpen() && !popup.isOwn(event.target)) closePopup();
    },
    true,
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) cache.clear();
  });
})();
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx playwright test tests/e2e/popup-lifecycle.spec.js`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test` and `npm run test:e2e`
Expected: PASS, all unit and e2e tests.

- [ ] **Step 6: Commit**

```bash
git add extension/content/main.js tests/e2e/popup-lifecycle.spec.js
git commit -m "feat: close rules, page cache and error display for the popup"
```

---

### Task 8: README and final verification

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: install/usage instructions for the user.

- [ ] **Step 1: Create `README.md`**

```markdown
# Hover Translate

A Chrome extension: hold **Alt** and hover over a paragraph to see its DeepSeek translation above it.

## Install

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and pick the `extension/` folder.
3. Click the extension icon and paste your DeepSeek API key (https://platform.deepseek.com/api_keys).
4. Choose the target language and click "Save".

## Usage

- Alt + hover over a paragraph: the translation appears above it (below it if there is little room above).
- Keep Alt held and move across paragraphs: the one where the mouse stops gets translated.
- Close with Esc, a click outside the popup, or by moving the mouse away from the paragraph and the popup.
- Translating the same paragraph again on the page comes from the cache: instant and free.

After changing the extension files, click "Reload" on its card in `chrome://extensions` and reload open tabs.

## Development

    npm install
    npx playwright install chromium
    npm test           # unit tests
    npm run test:e2e   # e2e: real Chromium with the extension and a mock API

Design: `docs/superpowers/specs/2026-10-12-hover-translate-design.md`.
```

- [ ] **Step 2: Run the full suite**

Run: `npm test` and `npm run test:e2e`
Expected: PASS, 0 failures in both. Paste the summary lines into the hand-off message.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add install and usage instructions"
```

- [ ] **Step 4: Hand off the manual check to the user**

These need a real key and the real browser UI, which e2e cannot see:

1. Load `extension/` unpacked, set the DeepSeek key, open an English Wikipedia article, Alt + hover a paragraph → popup above it, text streams in.
2. Release Alt after a translation → the Chrome "⋮" menu must not get focus (press Space afterwards: nothing should open).
3. Alt+Tab away and back while the mouse is over text → no translation.
4. Check a dark-theme OS setting → popup is dark.
