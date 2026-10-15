# Paragloss privacy policy

Effective date: October 15, 2026

Paragloss is an open-source browser extension that translates the paragraph you hold Alt over. This policy explains what it does with your data. The code is public, so every statement here can be checked in this repository.

**In short:** Paragloss has no server, no account and no analytics. With Chrome's built-in translator, which it uses by default, nothing you translate leaves your computer. With an AI provider you choose, only the text you ask to translate goes straight from your browser to that provider. The author of Paragloss never receives any of your data.

## What Paragloss handles

- **The text you ask to translate**: the paragraph under the mouse when you hold Alt, or the text you selected, up to 3,000 characters.
- **With an AI provider, also:**
  - for a dictionary entry of one to three selected words, up to 8 words around them from the same sentence;
  - once per page, the first 1,500 characters of the first long paragraph you translate, so the provider can name the page topic in a few tags; those tags then go with later translations on that page.
- **Text you write in Paragloss's compose window** (opened with Alt+click on a text field, Alt+T, the toolbar icon or Ctrl+Shift+Y): your draft, and the translation when you click "Check". With an AI provider, the page topic tags and up to 3 passages you translated on the same site, with their translations, go with the draft so the same terms come back. Paragloss never reads the text around the field, and never puts text into the page or sends anything there.
- **With the built-in translator, also:** on your first click on a page, the start of the page text (up to 1,000 characters) or its declared language is read on your computer to tell the page's language and get the translation model ready. This never leaves your computer.
- **Your settings**: the language to translate into, the provider you chose and, for each provider you filled in, its API key, model and API URL.
- **Translations**: kept so that the same text is not translated twice (see "Storage").

Paragloss does not read or send anything until you hold Alt, write in its compose window, click "Test" or "Load models" in its settings, or, with the built-in translator, click on a page as described above.

## Where your data goes

- **Chrome's built-in translator** (the default): the translation runs on your computer. Chrome downloads its translation models from Google once per pair of languages; that download contains none of your text.
- **An AI provider you choose** (for example DeepSeek, OpenAI, Anthropic, Google Gemini, OpenRouter, Groq, Mistral, xAI or Alibaba Qwen): the text goes in an HTTPS request from your browser directly to the provider's API, with your own API key. The provider's privacy policy and terms then apply to it; please read them before choosing a provider. The settings page says, under the provider you pick, where the text goes.
- **A local server** (Ollama, LM Studio, or another API URL on `localhost`): the text goes to that server on your computer.
- **An API URL you enter yourself**: the text goes to that address, and Chrome asks you first whether Paragloss may reach it.

Paragloss sends nothing anywhere else: no analytics, telemetry, crash reports or ads, and it loads no code from the internet. Requests to OpenRouter carry two headers that name the extension (`HTTP-Referer` with this repository's address and `X-Title: Paragloss`); they contain no data about you.

## Storage

- Settings, including API keys, are kept in the browser's extension storage (`chrome.storage.local`) on your computer. Only the extension's own pages and its background script can read them; web pages, and the extension's own scripts running on them, cannot. They are not synced to other devices.
- Translations made with an AI provider are cached in the browser's session storage (`chrome.storage.session`) until the browser closes, so the same text is not sent twice. Each open page also keeps its recent translations in memory until it is closed.
- For the compose window, the browser's session storage also keeps, until the browser closes, the last 30 passages you translated on each site with their translations, and your last draft. The language you chose to write in on a site is kept in the extension storage, with the site's name.
- Paragloss sets no cookies.
- To delete everything, remove the extension, or clear its fields in the settings and save.

## Permissions

- **Storage**: to keep your settings and the translation cache.
- **Active tab**: when you open the compose window from the toolbar, to know which site you are on, so the window can use what you read there. It gives no access to the page otherwise.
- **Access to the APIs of the preset providers, `localhost` and `127.0.0.1`**: to send the text you ask to translate to the provider you chose. Access to any other API address is asked for only when you enter one.
- **Modifying requests to `localhost` (declarativeNetRequest)**: requests that Paragloss itself sends to a local server carry a local `Origin` header, so that Ollama accepts them without extra setup. No other requests are touched.
- **Running on all sites**: to show the outline and the translation where you hold Alt. Until you do, it only follows the mouse and listens for the Alt key, and with the built-in translator, for your first click as described above. What it sees stays on the page.

## Chrome Web Store user data policy

Paragloss's use of information complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. The data it handles is used only to translate the text you ask for. It is never sold, never transferred to anyone except the translation provider you choose in order to translate it, never used for advertising, creditworthiness or lending, and never read by people.

## Changes

Changes to this policy are listed in the repository history and the release notes, and the effective date above is updated. If a change alters what Paragloss sends or where, the extension will tell you before it sends anything in the new way.

## Contact

Questions and reports: https://github.com/AleksandrIlinykh/paragloss/issues
