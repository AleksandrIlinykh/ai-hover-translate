// The toolbar popup (and its keyboard shortcut): first the switch for the active tab's site, then the compose window
// on its own, for writing that goes anywhere. The site's context and the language read there come from background,
// its declared language from the tab. Tests open it as a page with ?tab= naming the tab it is for.

function siteOf(url) {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? host : null;
  } catch {
    return null;
  }
}

async function tabOf() {
  const asked = Number(new URLSearchParams(location.search).get('tab'));
  if (asked) return chrome.tabs.get(asked).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

const tab = await tabOf();
const site = siteOf(tab?.url);
let page = null;
if (site) {
  try {
    page = await chrome.tabs.sendMessage(tab.id, { type: 'compose-context' });
  } catch {
    // no content script there (a page opened before the extension was loaded): no declared language then
  }
}
const state = await chrome.runtime.sendMessage({ type: 'compose-open', site, pageLang: page?.pageLang ?? null });
const send = (message) => chrome.runtime.sendMessage(message).catch(() => {});
const { t } = globalThis.spotslate;

// The site's switch, the first thing in the window: SpotSlate on or off there; under it, with an AI provider, two small
// switches, on unless the user turns them off there: translate with the AI (off: Chrome's translator, nothing sent),
// and, while the AI works there, learn the site's context. Pages where SpotSlate cannot run have no site, no switch.
function siteRow() {
  const say = (key, params) => t(state.from, key, params);
  const row = document.createElement('div');
  row.className = 'site';
  row.innerHTML = `
    <label class="site-main"><input type="checkbox" class="switch site-switch" role="switch"><span class="site-name"></span></label>
    <p class="site-off"></p>
    <label class="site-option"><input type="checkbox" class="switch small site-ai" role="switch"><span class="ai-label"></span></label>
    <label class="site-option"><input type="checkbox" class="switch small site-context" role="switch"><span class="context-label"></span></label>`;
  const part = (name) => row.querySelector(`.${name}`);
  part('site-name').textContent = say('siteSwitch', { site });
  part('site-off').textContent = say('siteOff');
  part('ai-label').textContent = say('siteAi', { provider: state.providerName });
  part('context-label').textContent = say('siteContext');
  const show = (mode) => {
    part('site-switch').checked = !mode.off;
    part('site-ai').checked = !mode.local;
    part('site-context').checked = !mode.noContext;
    part('site-off').hidden = !mode.off;
    // The switches under it matter only with an AI provider, and the context only while the AI works on the site.
    part('site-ai').closest('label').hidden = mode.off || !state.aiProvider;
    part('site-context').closest('label').hidden = mode.off || !state.aiProvider || mode.local;
  };
  const save = async () => {
    const mode = {
      off: !part('site-switch').checked,
      local: !part('site-ai').checked,
      noContext: !part('site-context').checked,
    };
    show(await chrome.runtime.sendMessage({ type: 'set-site-mode', site, mode }));
  };
  for (const input of row.querySelectorAll('input')) input.addEventListener('change', save);
  show(state.siteMode);
  return row;
}

if (site) document.body.prepend(siteRow());

globalThis.spotslate
  .createComposer({
    ...state,
    container: document.body,
    styleRoot: document,
    site,
    showSettings: true,
    onOpenSettings: () => chrome.runtime.openOptionsPage(),
    onSourceChange: (lang) => send({ type: 'compose-source', site, lang }),
    onTargetChange: (lang) => send({ type: 'compose-target', site, lang }),
    onDraftChange: (draft) => send({ type: 'compose-draft', draft }),
    onCopied: () => window.close(),
    onClose: () => window.close(),
  })
  .focus();
