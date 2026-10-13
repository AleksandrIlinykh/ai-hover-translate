# Hover Translate

A Chrome extension: hold **Alt** and hover over a paragraph to see its DeepSeek translation above it.

## Install

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and pick the `extension/` folder.
3. Click the extension icon and paste your DeepSeek API key (https://platform.deepseek.com/api_keys).
4. Choose the target language and click "Save".

## Usage

- Hold Alt: the paragraph under the mouse gets a dashed outline, so you can see what will be translated.
- Alt + hover over a paragraph: the translation appears above it (below it if there is little room above, to its right if the block is tall). The popup is about as wide as the paragraph, between 320 and 720 px.
- Keep Alt held and move across paragraphs: the one where the mouse stops gets translated.
- Select text first, then hold Alt over it: only the selection is translated. Select one to three words (a double click selects a word) to get a short dictionary entry; its first line is the meaning that fits the words around it (up to 8 on each side, from the same sentence).
- The first long paragraph you translate on a page also tells the extension what the page is about: DeepSeek names the topic in a few tags, and later translations on that page use them to pick the right meaning of ambiguous words. The tags show on the popup's title bar. If they are wrong, click the round "×" next to them: the text is translated again without them, and the page gets no new tags until you reload it.
- A grey outline with a hint means there is nothing to send: an input field, too much text (select the part you need) or text already in your language.
- Click the popup to pin it: it stays while you move the mouse away. Close it with Esc or the "×" on its title bar.
- Drag the popup by its title bar to put it where you like, and resize it by any edge or corner: it then stays at that place on screen while you scroll, handy for reading a long paragraph.
- "Copy" on the title bar copies the translation. After an error, "Retry" sends the text again.
- Close an unpinned popup with Esc, a click outside it, or by moving the mouse away from the paragraph and the popup.
- A text translated once is reused in every tab until the browser closes: instant and free.

After changing the extension files, click "Reload" on its card in `chrome://extensions` and reload open tabs.

## Development

    npm install
    npx playwright install chromium
    npm test           # unit tests
    npm run test:e2e   # e2e: real Chromium with the extension and a mock API

Design: `docs/superpowers/specs/2026-10-12-hover-translate-design.md`.
