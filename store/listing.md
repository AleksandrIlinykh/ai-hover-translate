# Chrome Web Store listing

What to fill in when submitting SpotSlate. The package is `dist/spotslate-<version>.zip` (`npm run pack`); the images are in `store/images/` (`npm run store` takes them again).

## Store listing

**Name:** SpotSlate

**Summary** (the manifest description, 129 of 132 characters):

> Translate on the spot: hold Alt over a paragraph to see its translation right above it, free in Chrome or with the AI you choose.

**Category:** Productivity, Tools.

**Language:** English.

**Description:**

> SpotSlate translates just the part you are stuck on, right where you are reading. Hold Alt over a paragraph and its translation appears above it; let go and keep reading. The page stays as it was.
>
> Made for people who read and write at work in a second language: tickets, wikis, pull requests, chats.
>
> READ
> - Hold Alt over a paragraph: the translation appears right above it, as wide as the paragraph.
> - Select a word or two first: a short dictionary entry that fits the sentence around it.
> - Copy the translation, pin the popup, drag it aside to read a long text in parallel.
>
> WRITE
> - Alt+click a text field, or press Alt+T while typing: write in your own language and get the text in the page's language, to copy.
> - "Check" translates it back, so you can see whether the meaning held.
>
> STAY CONSISTENT
> - With an AI provider, SpotSlate keeps a short note about each site's subject, its terms and names, built from what you translated there. Terms come out the same way every time. You can see the note and clear it.
>
> FREE AND PRIVATE BY DEFAULT
> - Out of the box SpotSlate uses Chrome's built-in translator: free, and nothing you translate leaves your computer.
> - Or pick an AI provider with your own key: DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, xAI, Alibaba Qwen, a local Ollama or LM Studio, or any OpenAI-compatible API. Texts go straight from your browser to that provider, only after you agree in the settings.
> - No account, no server, no analytics. Web pages cannot read your key or look into SpotSlate's windows.
>
> AND
> - Spot, a little pixel shiba, dances next to the mouse while you hold Alt and sits on the translation when it is ready.
> - SpotSlate speaks your language: its hints and buttons follow the language you translate into (13 languages).
> - Keys can be changed in the settings; shortcuts that would type text or that Chrome needs are refused.
>
> Open source (GPL-3.0): https://github.com/AleksandrIlinykh/spotslate

**Images** (`store/images/`):

| File | Size | Use |
|---|---|---|
| `1-read.png` | 1280x800 | screenshot: reading |
| `2-dictionary.png` | 1280x800 | screenshot: a dictionary entry |
| `3-context.png` | 1280x800 | screenshot: the site context |
| `4-write.png` | 1280x800 | screenshot: writing a reply |
| `5-private.png` | 1280x800 | screenshot: the welcome page, what leaves the computer |
| `promo-440x280.png` | 440x280 | small promo tile (required) |
| `marquee-1400x560.png` | 1400x560 | marquee promo tile (optional) |

The icon comes from the package (`icons/icon-128.png`).

**Website:** https://github.com/AleksandrIlinykh/spotslate

**Support:** https://github.com/AleksandrIlinykh/spotslate/issues

## Privacy practices

**Single purpose:** translating text on web pages for reading, and translating what the user writes into the page's language, at the user's request.

**Permission justifications:**

- `storage`: keeps the settings (language, provider, the user's API keys, keys) on the computer, and in the browser session the translation cache, the context of each site and the last draft.
- `activeTab`: when the user opens the compose window from the toolbar, it tells which site the active tab is on, so the window can use that site's context.
- `declarativeNetRequestWithHostAccess`: sets a local `Origin` header on SpotSlate's own requests to `localhost` and `127.0.0.1`, so that local AI servers such as Ollama accept them. No other requests are touched.
- Host permissions (the APIs of DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, xAI and Alibaba Qwen, and `localhost`): to send the text the user asks to translate to the provider the user chose, with the user's key.
- Optional host permissions (`https://*/*`, `http://*/*`): asked for at runtime only for an API URL the user types in, and only that host.
- Content scripts on all sites: the script has to be on the page before the user holds Alt, to outline the paragraph under the mouse and show the translation there. Until Alt is held it only follows the mouse and listens for the key. With Chrome's translator, on the first click it also reads the page's declared language, or the start of its text, on the computer, to get the right translation model ready; nothing of it leaves the computer.

**Remote code:** No. All code is in the package.

**Data usage** (tick):

- Website content: the text the user chooses to translate (the paragraph under the mouse or the selection), and with an AI provider the short context SpotSlate keeps for the site.
- Personal communications: what the user writes in the compose window.
- Authentication information: the user's API keys, kept only in the browser's storage and sent only to the provider they belong to.

None of it is sold, used for advertising, credit or lending, or read by people; it is used only to translate. Certify the three disclosures (not sold, not used for unrelated purposes, not used for creditworthiness).

**Privacy policy URL:** https://github.com/AleksandrIlinykh/spotslate/blob/main/PRIVACY.md

## Notes for the reviewer

> SpotSlate works without any account or key: by default it uses Chrome's built-in Translator API (Chrome 138 or later, on desktop).
>
> To test: open any page in a language other than your Chrome's (for example https://de.wikipedia.org), click once on the page so Chrome can download its translation model, then hold Alt over a paragraph. The translation appears above it. Alt+T opens the compose window. The welcome page that opens on install has a paragraph and a field to try the same.
>
> AI providers are optional and need the user's own key. Requests to Anthropic carry the header "anthropic-dangerous-direct-browser-access", Anthropic's documented opt-in for calls from a browser with the user's own key.
