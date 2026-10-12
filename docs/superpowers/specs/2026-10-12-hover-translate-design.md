# Hover Translate: design

Date: 2026-10-12

## Goal

A Chrome extension for reading sites in a foreign language: hold Alt, hover over a paragraph, and a natural translation into the chosen language pops up above it. DeepSeek does the translation. For personal use: installed as an unpacked extension with your own API key.

## Success criteria

- Alt + hover over a paragraph → a popup where the translation streams in (the first words show as soon as DeepSeek starts answering).
- Without Alt nothing happens and no requests are sent.
- Translating the same paragraph again on the same page is instant, with no request.
- Errors are clear and shown right in the popup.
- On regular sites (articles, documentation, Wikipedia, GitHub) the popup does not break the site layout and is not broken by it.

## Out of scope

- Publishing to the Chrome Web Store, syncing settings across devices.
- Translating inside iframes, input fields, contenteditable.
- Word breakdowns, dictionary, transcription.
- Translating the whole page or a text selection.
- A configurable hotkey (Alt only).
- A cache shared across pages and tabs.
- Firefox, Safari.

## Approach

A plain Manifest V3 extension with no build step: regular JS files that Chrome loads as they are. `package.json` and Playwright are only needed for tests.

## Structure

```
hover-translate/
  extension/            ← this folder is loaded into Chrome
    manifest.json
    background.js       ES module: 'translate' port, API request, opening the settings
    lib/
      prompt.js         buildMessages(text, languageName)
      sse.js            createSseParser(), deltaFromPayload(payload)
      errors.js         errorFromStatus(status, bodyText), makeError(code)
      settings.js       DEFAULTS, LANGUAGES, withDefaults(stored), loadSettings()
    content/            classic scripts (not modules) sharing globalThis.hoverTranslate
      block.js          elementAt(x, y), findBlock(element), blockText(block)
      popup.js          createPopup({ onOpenSettings })
      highlight.js      createHighlight()
      main.js           trigger, talking to background, closing, page cache
    options.html
    options.js
  tests/
    unit/               node --test
    e2e/                Playwright
    mock-server.js      mock OpenAI-compatible API + test pages
    fixtures/           page.html, hostile.html, shadow.html, scroller.html
  package.json          dev only: test / test:e2e scripts, devDependency @playwright/test
  playwright.config.js
  README.md
```

The extension code lives apart from `node_modules` so Chrome does not pick up dev dependencies. No icons: Chrome shows its default one.

## Manifest

- `manifest_version: 3`, `name: "Hover Translate"`, `version: "0.1.0"`.
- `permissions: ["storage"]`, `host_permissions: ["https://api.deepseek.com/*"]`.
- `background: { service_worker: "background.js", type: "module" }`.
- `content_scripts: [{ matches: ["<all_urls>"], js: ["content/block.js", "content/popup.js", "content/highlight.js", "content/main.js"], run_at: "document_end" }]`, top frame only. `document_end` rather than `document_idle`: the script is guaranteed to be in place by the `load` event (the e2e tests need this), and it only registers event listeners, so it does not slow page loading.
- `options_ui: { page: "options.html", open_in_tab: true }`.
- `action: { default_title: "Hover Translate settings" }`; clicking the icon opens the settings.

## Settings

Stored in `chrome.storage.local` under the `settings` key:

| Field | Default | Purpose |
|---|---|---|
| `apiKey` | `""` | DeepSeek key |
| `targetLang` | `"ru"` | target language code |
| `model` | `"deepseek-chat"` | model |
| `baseUrl` | `"https://api.deepseek.com"` | OpenAI-compatible API URL |

Values are trimmed (keys are often pasted with a space or a line break); an empty value falls back to the default; an unknown language code falls back to `ru`.

`baseUrl` exists for tests (local mock) and for switching providers. A provider outside `host_permissions` only works if its API sends CORS headers; otherwise its domain has to be added to `host_permissions`.

`LANGUAGES` maps a code to its English name, used both in the prompt and in the settings page: ru, en, de, fr, es, it, pt, pl, uk, tr, zh (Chinese (Simplified)), ja, ko.

Settings page: key field (`type=password`), language picker, model, API URL, a "Save" button with a "Saved" confirmation, a link to https://platform.deepseek.com/api_keys.

## Trigger (content/main.js)

State: last mouse coordinates, whether Alt is held, whether another key was pressed while Alt was held (a "combo"), whether a translation was shown during this Alt press, a single trigger timer.

- `mousemove` (capture, passive): remember the coordinates. If Alt is held and this is not a combo, restart the trigger timer.
- `keydown` Alt (not auto-repeat): Alt is held, the timer starts. If Ctrl, Shift or Meta is already held at that moment (Ctrl+Alt+…, the Alt+Shift layout switch), it is a combo right away.
- `keydown` of any other key while Alt is held: a combo (Alt+Tab, Alt+Left, …). Cancel the timer and translate nothing until Alt is released.
- `keyup` Alt: Alt is released, the timer is cancelled. If a translation was shown during this press, call `preventDefault()` so Chrome on Windows does not focus its "⋮" menu.
- Window `blur`: Alt counts as released, the timer is cancelled.
- The timer (`TRIGGER_DELAY_MS = 200`) fires: take the element at the last mouse point and look for a block. If a block is found and it is not the block already shown, translate it.

So when the mouse crosses several paragraphs with Alt held, the one where it stops gets translated.

## Highlight

While Alt is held (and it is not a combo), the block that would be translated is outlined right away, without waiting for `TRIGGER_DELAY_MS`, so a wrong pick (another paragraph, a whole column) is visible before any request is sent.

- Look: a 2 px dashed `#1f6feb` border, 3 px outside the block, 4 px radius, `rgba(31, 111, 235, 0.1)` fill; readable on light and dark pages.
- It is a separate `<div id="hover-translate-highlight">` overlay in `document.documentElement`, not a style change on the block. Inline `!important` styles (like the popup host) and `pointer-events: none`, so it never catches the mouse or hides the element under it from `elementFromPoint`.
- Updated on Alt keydown and on every `mousemove`/`scroll` while Alt is held (once per animation frame). Over our own popup the current outline stays. Nothing translatable under the mouse (input, block over `MAX_CHARS`, empty space) means no outline.
- Removed when Alt is released, on a combo, and on window `blur`. The popup stays open; the outline does not.

## Finding the block

`findBlock(element)`:

1. No element: `null`. `main.js` filters out our own popup before calling `findBlock`.
2. The element is inside `input`, `textarea`, `select` or an editable area (`isContentEditable`): `null`.
3. Walk up from the element (stopping before `body`/`html`). The first element whose `display` is one of `block`, `list-item`, `table-cell`, `table-caption`, `flex`, `grid`, `flow-root` and whose `innerText` has at least one letter (`\p{L}`) is the candidate.
4. If the candidate's text is longer than `MAX_CHARS = 3000`: `null` (it is a page wrapper, not a paragraph). Otherwise the candidate.

The element under the cursor is looked up inside open Shadow DOM trees (web components), and the walk up steps out of a shadow root to its host.

Text to translate: `innerText`, trimmed, with three or more consecutive line breaks collapsed to two.

## Popup

- Host: `<div id="hover-translate-root">` in `document.documentElement` with an open Shadow DOM inside. Host styles are inline with `!important` (`all: initial`, `position: absolute`, `display: block`, `z-index: 2147483647`) so site rules like `div { display: none !important }` do not touch it. Content styles go through `adoptedStyleSheets` (site CSP does not block them); the popup DOM is built with `createElement`, no `innerHTML`.
- Coordinates are document coordinates (block rectangle + scroll), so the popup scrolls with the page. When an inner container (`overflow: auto`) scrolls, the popup moves with its paragraph (a capture-phase `scroll` listener).
- Width follows the content, at most as wide as the block within readable limits: `clamp(block width, 320, 720)` px, and no wider than the window minus 16 px. So a wide paragraph gets a 720 px popup (lines stay readable), a regular paragraph gets a popup of its own width (lines run in parallel with the source), and a narrow column gets 320 px (the translation ends up shorter than the source, not a tall ribbon).
- **Horizontal:** left edge = paragraph's left edge + 32 px, adjusted so the popup does not leave the window (8 px from the edges).
- **Beside a tall block:** if the block is taller than 240 px (about 10 lines) and the window has at least 320 px free to its right, the popup goes to the right of the block with a 6 px gap, aligned to the block's top (clamped into the window), up to the window height. This reads like parallel text: the translation sits at the same height as the source. Without that room the rules below apply.
- **Vertical:** the side (right, above or below) is chosen once, on open:
  - above the paragraph if there are at least 120 px above it in the window;
  - otherwise below the paragraph if there is at least as much room below as above;
  - otherwise above anyway.
  - The gap between paragraph and popup is 6 px. `max-height` = room on the chosen side minus the gap and the margin; if that is under 80 px (paragraph taller than the window), the popup overlaps the paragraph and may take the whole window minus margins. If the text does not fit, the popup scrolls inside.
  - The popup always stays inside the window: its vertical position is clamped to [8 px; window height - 8 px - popup height]. This covers paragraphs taller than the screen (top scrolled past the edge): the popup then overlaps part of the paragraph but stays visible.
  - Above the paragraph, the popup's bottom edge sticks to the paragraph: while the text streams in, the position is recalculated (via `requestAnimationFrame`) and the popup grows upward.
- States: loading (animated "…"), text (`white-space: pre-wrap`, selectable and copyable), error. The "no key" error shows an "Open settings" button.
- Look: system font 14px/1.5, 10×12 px padding, 8 px radius, shadow; light and dark theme via `prefers-color-scheme`.
- Only one popup is open at a time.

Closing:

- `Esc`;
- `mousedown` outside the popup;
- the mouse outside both the paragraph and the popup rectangles for longer than `LEAVE_GRACE_MS = 300` (slack to move the mouse onto the popup across the gap); this rule is off while a mouse button is held (selecting popup text);
- window resize;
- translating another paragraph.

On close, the port to background is disconnected and any unfinished API request is cancelled.

## Cache

In `content/main.js`: a `Map` from text to translation, at most 100 entries (the oldest is evicted). Only successfully finished translations are stored. The cache is cleared when the settings change (`chrome.storage.onChanged`).

## Talking to background

Content opens `chrome.runtime.connect({ name: 'translate' })` and sends `{ text }`. Background replies with:

- `{ type: 'chunk', text }`: the next piece of the translation;
- `{ type: 'done' }`: the translation is finished;
- `{ type: 'error', code, message }`: an error with a readable `message`.

A separate `chrome.runtime.sendMessage({ type: 'open-options' })` message makes background open the settings.

## DeepSeek request (background.js)

- No key → `no_key` error, nothing is sent.
- `POST {baseUrl without trailing /}/chat/completions`, headers `Content-Type: application/json`, `Authorization: Bearer {apiKey}`.
- Body: `{ model, messages: buildMessages(text, languageName), stream: true, temperature: 1.3 }` (1.3 is DeepSeek's recommendation for translation).
- Response not `ok` → read the body, `errorFromStatus(status, bodyText)` → error.
- The stream is read through `response.body.getReader()` and `TextDecoder` and parsed by `createSseParser()`; each `data:` line → `deltaFromPayload()` → `chunk` or end.
- End of stream: if no text chunk arrived, an `empty` error; otherwise `done`.
- Idle timeout of 30 s (no bytes from the server) → cancel, `timeout` error.
- Port disconnected → cancel via `AbortController`, send nothing.
- Network error (`TypeError` from `fetch`) → `network` error.

Prompt (`buildMessages`):

- system: `You are a professional translator. Translate the user's text into {languageName}. Output only the translation, with no explanations, notes, or quotes. Preserve the meaning, tone, and line breaks. Leave code, URLs, and names that are normally not translated as they are. If the text is already in {languageName}, return it unchanged.`
- user: the text itself.

Stream parsing (`sse.js`):

- `createSseParser().push(chunk)` buffers input, splits on `\n` / `\r\n`, keeps an unfinished line until the next chunk and returns the payloads of `data:` lines. Comment lines (`: keep-alive`) and other fields are ignored.
- `deltaFromPayload(payload)`: `[DONE]` → `{ done: true }`; JSON with `choices[0].delta.content` → `{ text }`; empty `content`, missing `content` or invalid JSON → `null`.

Errors (`errors.js`); `apiMessage` is `error.message` from the JSON body when present:

| Code | When | Text |
|---|---|---|
| `no_key` | key not set | DeepSeek API key is not set. |
| `auth` | 401 | Invalid API key. Check it in the settings. |
| `balance` | 402 | Your DeepSeek balance has run out. |
| `rate_limit` | 429 | Too many requests. Please wait a moment. |
| `bad_request` | 400, 422 | Invalid API request: {apiMessage} |
| `server` | 500, 503 | The API server is unavailable ({status}). Try again later. |
| `http` | other statuses | API error {status}: {apiMessage} |
| `network` | `fetch` failed | Cannot connect to the API. |
| `timeout` | 30 s without data | The API did not respond within 30 seconds. |
| `empty` | stream without text | The API returned an empty response. |

Without an `apiMessage` the text has no colon and no tail.

Page-side (content) errors:

- `chrome.runtime.connect` threw (the extension was updated but the page was not reloaded) → "The extension was updated. Reload the page."
- background dropped the port without sending `done`/`error` (the service worker was unloaded) → "The translation was interrupted. Try again."

## Testing

Unit tests (`node --test`, no dependencies):

- `sse.js`: a line split between chunks; several events in one chunk; `\r\n`; keep-alive comments; `[DONE]`; invalid JSON.
- `prompt.js`: the language goes into system, the text into user unchanged.
- `errors.js`: every status in the table; a JSON body with `error.message`; a non-JSON body.
- `settings.js`: `withDefaults` fills missing fields and keeps the given ones.

E2E (Playwright, real Chromium with the extension loaded, `channel: 'chromium'`):

- `mock-server.js` on a random port serves the test pages and `POST /chat/completions` (CORS headers, `OPTIONS` handling). The API key selects the behavior: `bad` → 401, `broke` → 402, `empty` → stream without text, `slow` → one chunk per second, `split` → "Hello 👋 world" with the emoji cut between chunks; any other key → `[RU] {text}` in three chunks with pauses. Every request is recorded (header, body, whether the client aborted it).
- Settings are set through the extension's service worker (`chrome.storage.local.set`), with `baseUrl` pointing at the mock.
- Scenarios:
  1. Alt + hover → popup with `[RU] …` from the mock.
  2. Hover without Alt → no popup after 500 ms, 0 requests.
  3. Alt + another key within 200 ms → no popup.
  4. `Esc` closes the popup.
  5. The mouse leaves the paragraph and the popup → the popup closes.
  6. With Alt held the mouse moves to another paragraph → the popup translates the second paragraph.
  7. Translating the same paragraph again → still 1 request.
  8. Key `bad` → "Invalid API key" in the popup.
  9. No key → "DeepSeek API key is not set" in the popup and an "Open settings" button.
  10. Position: popup above the paragraph, left edge to the right of the paragraph's left edge; for a paragraph at the top of the window, below it.
  11. Paragraph taller than the window (top scrolled past the edge) → popup fully inside the window.
  12. Page with hostile CSS (`div { display: none !important }`, global `font-size`) → popup visible, 14 px font.
  13. The mouse moves from the paragraph onto the popup → the popup stays open, no new requests.
  14. Switching to another paragraph mid-stream → the popup shows only the new paragraph's translation, the old request is cancelled.
  15. A multi-byte character split between response chunks → text without broken characters.
  16. The "Open settings" button opens the settings page.
  17. Shift held before Alt → no translation.
  18. Text inside an open Shadow DOM is translated.
  19. An inner container scrolls → the popup stays 6 px above the paragraph.
  20. Paragraph taller than the window → popup taller than half the window, not 80 px.
  21. Selecting popup text with the mouse going past its edge → the popup stays open.
  22. Holding Alt over a paragraph → a dashed outline 3 px around it appears before any request is sent.
  23. With Alt held the mouse moves to another paragraph → the outline moves with it.
  24. Releasing Alt → the outline disappears, the popup stays.
  25. Nothing translatable under the mouse (`#huge`, an input) → no outline.
  26. Shift held before Alt → no outline.
  27. Page with hostile CSS → the outline is visible.
  28. A 1000 px wide paragraph → a 720 px wide popup.
  29. A 600 px wide paragraph → a popup as wide as the paragraph.
  30. A 200 px narrow column → a 320 px wide popup, above it.
  31. A tall narrow block with room on its right → the popup is 6 px to its right, aligned to its top.
  32. A tall block spanning the window → the popup stays above or below it.

Manual check (by you, with your own key): load the unpacked extension, set the key, try it on real sites; make sure releasing Alt after a translation does not focus the Chrome menu. That is browser UI behavior and the e2e tests cannot see it.
