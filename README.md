# Hover Translate

A Chrome extension: hold **Alt** and hover over a paragraph to see its translation above it, from the AI model you choose.

## Install

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and pick the `extension/` folder.
3. Click the extension icon and choose the language to translate into.
4. Click "Save". Out of the box the extension uses Chrome's built-in translator: free, and nothing leaves your computer. The click lets Chrome download its model for English once.
5. For translations that fit the context (page topic, dictionary entries), pick an AI provider under "Translate with", paste its API key ("Get a key" links to the provider's page), click "Test", then "Save".

## Providers

| Provider | Default model | Key |
|---|---|---|
| Chrome built-in translator | Chrome's own, on your computer | none, free |
| DeepSeek | deepseek-flash | https://platform.deepseek.com/api_keys |
| OpenAI | gpt-6-luna | https://platform.openai.com/api-keys |
| Anthropic Claude | claude-haiku-5-5 | https://platform.claude.com/settings/keys |
| Google Gemini | gemini-3.5-flash-lite | https://aistudio.google.com/apikey |
| OpenRouter | you choose | https://openrouter.ai/settings/keys |
| Groq | openai/gpt-oss-120b | https://console.groq.com/keys |
| Mistral | mistral-small-latest | https://console.mistral.ai/api-keys |
| xAI Grok | grok-4.20-0309-non-reasoning | https://console.x.ai |
| Alibaba Qwen | qwen-flash | Alibaba Cloud Model Studio |
| Ollama, LM Studio | you choose | none: the model runs on your computer |
| Any OpenAI-compatible API | you choose | depends on the API |

- Each provider keeps its own key, model and URL, so you can switch back and forth.
- "Load models" fetches the provider's list of models. You can also type any model name.
- Reasoning ("thinking") is turned off where the API allows it: a translation does not need it, and it is slower and billed.
- Ollama works as installed: the extension's requests to `localhost` carry a local origin, so there is no need to set `OLLAMA_ORIGINS`. In LM Studio, start the server on the Developer tab.
- For an API outside the list, Chrome asks once for access to its host when you save or test it.

## Free built-in translator

Chrome 138 and later (and Edge) can translate on the computer itself. The extension uses that by default: free, offline, nothing sent anywhere. Chrome downloads a model once for each pair of languages, and only right after a click or a key press (holding Alt does not count), so the extension gets models ready ahead of time: the English one when you save the settings, and the one for a page's language on your first click on that page. Translations are then usually instant. If you hold Alt before ever clicking on a page in a new language, the popup asks you to click "Download". The language of a selected word is told from its whole paragraph, or else from the page. It is ordinary machine translation: no page topic and no dictionary entries, which need an AI provider.

## Where your text goes

With the built-in translator, nothing leaves your computer. With an AI provider, only the text you hold Alt over (or select) is sent, straight from your browser to the provider you chose, under your own key. For a dictionary entry, up to 8 words around the selection go with it, and the first long paragraph on a page is also sent once to name the page topic. The extension has no server and no analytics. Web pages cannot read your key: the settings are open only to the extension's own pages and its service worker.

## Usage

- Hold Alt: the paragraph under the mouse gets a dashed outline, so you can see what will be translated.
- Alt + hover over a paragraph: the translation appears above it (below it if there is little room above, to its right if the block is tall). The popup is about as wide as the paragraph, between 320 and 720 px.
- Keep Alt held and move across paragraphs: the one where the mouse stops gets translated.
- Select text first, then hold Alt over it: only the selection is translated. Select one to three words (a double click selects a word) to get a short dictionary entry; its first line is the meaning that fits the words around it (up to 8 on each side, from the same sentence).
- The first long paragraph you translate on a page also tells the extension what the page is about: the model names the topic in a few tags, and later translations on that page use them to pick the right meaning of ambiguous words. The tags show on the popup's title bar. If they are wrong, click the round "×" next to them: the text is translated again without them, and the page gets no new tags until you reload it.
- Paragraphs inside editors (for example Confluence in edit mode) are translated like any other text; form fields are not.
- A grey outline with a hint means there is nothing to send: a form field, too much text (select the part you need) or text already in your language.
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

## License

Copyright (C) 2026 Aleksandr Ilinykh

Hover Translate is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
