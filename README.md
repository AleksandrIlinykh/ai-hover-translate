# SpotSlate

[![Tests](https://github.com/AleksandrIlinykh/spotslate/actions/workflows/test.yml/badge.svg)](https://github.com/AleksandrIlinykh/spotslate/actions/workflows/test.yml)

Translate on the spot. Hold **Alt** and hover over a paragraph to see its translation above it: free with Chrome's built-in translator, or from the AI model you choose.

SpotSlate is for deliberate, in-context translation of just the part you need: right where you are reading, without leaving the page or breaking its flow. The page stays as it was.

## Install

1. Open `chrome://extensions` and turn on "Developer mode".
2. Click "Load unpacked" and pick the `extension/` folder.
3. A welcome page opens: check the language to translate into (it starts as your browser's), and try the gestures right there. Out of the box the extension uses Chrome's built-in translator: free, and nothing leaves your computer. Tabs that were open before need a reload.
4. For translations that fit the subject of a site (the site context, dictionary entries), open the settings (right-click the extension icon, then "Options"), pick an AI provider under "Translate with", paste its API key ("Get a key" links to the provider's page), click "Test", then "Save". From then on the texts you translate go to that provider.

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

SpotSlate needs Chrome 140 or later, the first that keeps the API keys away from scripts on pages. Chrome (and Edge) can translate on the computer itself. The extension uses that by default: free, offline, nothing sent anywhere. Chrome downloads a model once for each pair of languages, and only right after a click or a key press (holding Alt does not count), so the extension gets models ready ahead of time: the English one when you save the settings, and the one for a page's language on your first click on that page. Translations are then usually instant. If you hold Alt before ever clicking on a page in a new language, the popup asks you to click "Download". The language of a selected word is told from its whole paragraph, or else from the page. It is ordinary machine translation: no site context and no dictionary entries, which need an AI provider.

## Where your text goes

The full [privacy policy](PRIVACY.md) explains it in detail. With the built-in translator, nothing leaves your computer. With an AI provider, only the text you hold Alt over (or select) is sent, straight from your browser to the provider you chose, under your own key. For a dictionary entry, up to 8 words around the selection go with it, and every translation on a site carries the short site context SpotSlate built from what you translated there (see below). The extension has no server and no analytics. Web pages cannot read your key: the settings are open only to the extension's own pages and its service worker.

## Usage

- Hold Alt: the paragraph under the mouse gets a dashed outline, so you can see what will be translated.
- Alt + hover over a paragraph: the translation appears above it (below it if there is little room above, to its right if the block is tall). The popup is as wide as the paragraph, between 320 and 720 px, from the moment it opens.
- Keep Alt held and move across paragraphs: the one where the mouse stops gets translated.
- Select text first, then hold Alt over it: only the selection is translated. Select one to three words (a double click selects a word) to get a short dictionary entry; its first line is the meaning that fits the words around it (up to 8 on each side, from the same sentence).
- With an AI provider, SpotSlate learns what each site is about: after each text you translate there, the model rewrites a short context of one or two paragraphs (the subject, what its terms and abbreviations mean and how to render them, which names to keep), and every later translation on the site carries it. Terms come out the same way every time, and ambiguous words take the meaning they have on that site.
- "Context" under the translation shows what SpotSlate knows about the site. It is built automatically and cannot be edited; "Clear" starts it over. It is kept until the browser closes; each new popup opens with it folded away.
- Paragraphs inside editors (for example Confluence in edit mode) are translated like any other text; form fields are not.
- A grey outline with a hint means there is nothing to send: a form field, too much text (select the part you need) or text already in your language.
- Click the popup to pin it: it stays while you move the mouse away. Close it with Esc or the "×" on its title bar.
- Drag the popup by its title bar to put it where you like, and resize it by any edge or corner: it then stays at that place on screen while you scroll, handy for reading a long paragraph.
- "Copy" on the title bar copies the translation. After an error, "Retry" sends the text again.
- "Report" opens a GitHub issue about a bad translation with the setup filled in, and copies the text for you: paste it there only if it is not confidential.
- Close an unpinned popup with Esc, a click outside it, or by moving the mouse away from the paragraph and the popup.
- A text translated once is reused in every tab until the browser closes: instant and free.
- SpotSlate speaks the language you translate into: its hints, buttons, errors and windows follow the "Translate into" setting.
- Spot, a little pixel shiba, keeps you company: it dances next to the mouse while you hold Alt, sits down when the translation is ready, and hops onto the popup when you let Alt go. It never gets in the way of the mouse, and stands still if your system asks for reduced motion.

## On a site of your own

The toolbar window starts with a switch for the site you are on: turn SpotSlate off there (where Alt means something else, as in Figma), or keep the site on this computer (only Chrome's translator, nothing sent) or without a context, for confidential wikis. It takes effect at once; the settings list such sites, with a Reset button each.

## Writing in another language

- Hold Alt over a text field and click (Alt+click): a window opens under it. Write in your own language at the top; the translation into the page's language appears below a second after you stop typing. While it is on its way, the one before stays, with an ellipsis after it. Click "Copy" (or press Ctrl+Enter) and paste it into the field.
- Or press Alt+T: the same window opens at the field you are typing in, or next to the mouse. Alt+T again closes it. It works in any keyboard layout.
- To write for anywhere else, click the SpotSlate icon or press Ctrl+Shift+Y (change it at `chrome://extensions/shortcuts`): the same window opens from the toolbar.
- "Check" translates the result back into your language, to see whether the meaning held.
- The language to write in follows the site (what you read there, or the page's language); pick another one in the title row and the site keeps it.
- With an AI provider, the site context goes with your draft, so it uses the site's terms; "Context" in the window shows it. "Check" translates back without it. SpotSlate never reads the text around the field, and never types or sends anything on the page itself.
- Settings are behind the gear in the toolbar window, or "Options" in the icon's right-click menu.

After changing the extension files, click "Reload" on its card in `chrome://extensions` and reload open tabs.

## Keys

- Alt to read and Alt+T to write are the defaults. In the settings, under "Keys", you can hold Ctrl to read instead, and record another shortcut to write: click the field and press it.
- Shortcuts that would type text, or that Chrome or your system needs (such as Ctrl+T, Alt+F, Ctrl+Alt, which is AltGr, or Alt+Shift, which switches the layout), are refused with the reason. "Reset keys" brings the defaults back.
- The toolbar window's shortcut (Ctrl+Shift+Y) is set in Chrome, at `chrome://extensions/shortcuts`; the settings link there.

## Development

    npm install
    npx playwright install chromium
    npm test           # unit tests
    npm run test:e2e   # e2e: real Chromium with the extension and a mock API

GitHub Actions runs both on every push and pull request (`.github/workflows/test.yml`).

For the Chrome Web Store:

    npm run pack       # dist/spotslate-<version>.zip, the package to upload
    npm run store      # store/images/: the screenshots, the promo tile and the marquee
    npm run icons      # extension/icons/, drawn from the dog

What to fill in on the store's pages, with the permission justifications and the privacy answers, is in `store/listing.md`; how to run the closed beta before the launch is in `store/beta.md`.

Design: `docs/superpowers/specs/2026-10-12-spotslate-design.md`.

## License

Copyright (C) 2026 Aleksandr Ilinykh

SpotSlate is free software: you can redistribute it and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version. It is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See [LICENSE](LICENSE) for the full text.
