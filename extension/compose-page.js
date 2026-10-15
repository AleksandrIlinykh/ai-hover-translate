// The toolbar popup (and its keyboard shortcut): the compose window on its own, for writing that goes anywhere.
// What it knows about the site comes from the active tab: what was read there, and its topic and language.

function siteOf(url) {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? host : null;
  } catch {
    return null;
  }
}

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const site = siteOf(tab?.url);
let page = null;
if (site) {
  try {
    page = await chrome.tabs.sendMessage(tab.id, { type: 'compose-context' });
  } catch {
    // no content script there (a page opened before the extension was loaded): no topic then
  }
}
const state = await chrome.runtime.sendMessage({ type: 'compose-open', site, pageLang: page?.pageLang ?? null });
const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});

globalThis.paragloss
  .createComposer({
    ...state,
    container: document.body,
    styleRoot: document,
    topics: page?.topics ?? [],
    site,
    showSettings: true,
    onOpenSettings: () => chrome.runtime.openOptionsPage(),
    onTargetChange: (lang) => send({ type: 'compose-target', site, lang }),
    onDraftChange: (draft) => send({ type: 'compose-draft', draft }),
    onCopied: () => window.close(),
    onClose: () => window.close(),
  })
  .focus();
