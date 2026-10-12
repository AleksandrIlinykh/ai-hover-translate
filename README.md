# Hover Translate

A Chrome extension: hold **Alt** and hover over a paragraph to see its DeepSeek translation above it.

## Install

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and pick the `extension/` folder.
3. Click the extension icon and paste your DeepSeek API key (https://platform.deepseek.com/api_keys).
4. Choose the target language and click "Save".

## Usage

- Hold Alt: the paragraph under the mouse gets a dashed outline, so you can see what will be translated.
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
