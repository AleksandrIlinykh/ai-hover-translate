import { buildMessages } from './lib/prompt.js';
import { MIN_PASSAGE, buildNotesMessages, cleanNotes, passageOf, takePassages } from './lib/notes.js';
import { buildComposeMessages, chooseComposeTarget, countLanguage } from './lib/compose.js';
import { readTextStream, sendChat } from './lib/chat.js';
import { answerText, setupProblem } from './lib/providers.js';
import { errorFromStatus, makeError, settingsChanged } from './lib/errors.js';
import { CONSENT_VERSION, LANGUAGES, activeProvider, loadSettings } from './lib/settings.js';
import { currentPlatform, readKeyName } from './lib/keys.js';
import { DEFAULT_SITE_MODE, siteModeOf, withSiteMode } from './lib/sites.js';

const REPOSITORY = 'https://github.com/AleksandrIlinykh/spotslate';
const IDLE_TIMEOUT_MS = 30_000;
const NOTES_TIMEOUT_MS = 15_000;
const LEARNED_LIMIT = 50; // sources remembered per site, so a text shown again does not teach the notes twice
const MAX_CONTEXT = 1000;
const MAX_TEXT = 3000; // what a page may ask to translate at once (MAX_CHARS in content/block.js)
const MODES = new Set(['text', 'dictionary']);
const CACHE_PREFIX = 'cache:';
const LOCAL_ORIGIN_RULE = 1;
const MAX_DRAFT = 3000;
const NOTES_PREFIX = 'notes:'; // + site: the site context, in chrome.storage.session
const LANGS_PREFIX = 'langs:'; // + site: { [lang]: count } of the texts read there, for the compose window
const DRAFT_PREFIX = 'draft:'; // + site ('' off any site): the last draft written there, in chrome.storage.session
const SITES_KEY = 'sites'; // { [site]: mode } in chrome.storage.local, see lib/sites.js
const COMPOSE_KEY = 'compose'; // { targets: { [site]: lang }, last: lang } in chrome.storage.local

// The settings hold API keys: only extension pages and this worker may read them, never content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

// Someone who removes SpotSlate lands on a short form on GitHub about why; only the version goes with it.
chrome.runtime
  .setUninstallURL(`${REPOSITORY}/issues/new?template=uninstall.yml&version=${chrome.runtime.getManifest().version}`)
  .catch(() => {});

// A new user starts on the welcome page: the language, the gestures to try, and what leaves the computer.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
});

// Local servers such as Ollama turn away requests from an extension's origin. The extension's own requests to
// localhost carry a local Origin instead; pages and other extensions are not affected.
chrome.declarativeNetRequest
  .updateDynamicRules({
    removeRuleIds: [LOCAL_ORIGIN_RULE],
    addRules: [
      {
        id: LOCAL_ORIGIN_RULE,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'origin', operation: 'set', value: 'http://127.0.0.1' }],
        },
        condition: {
          requestDomains: ['localhost', '127.0.0.1'],
          initiatorDomains: [chrome.runtime.id],
          resourceTypes: ['xmlhttprequest', 'other'],
        },
      },
    ],
  })
  .catch(() => {});

// Pages get the public part of the settings: the target language, which engine translates and its name, and the keys.
// With the free engine (Chrome's translator) the page translates by itself.
function pageSettings(settings) {
  const { read, write } = settings.keys;
  return {
    targetLang: settings.targetLang,
    engine: activeProvider(settings).api === 'browser' ? 'browser' : 'api',
    providerName: activeProvider(settings).name,
    keys: { read, readName: readKeyName(read, currentPlatform()), write },
  };
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const message = { type: 'settings-changed', ...pageSettings(await loadSettings()) };
  for (const tab of await chrome.tabs.query({})) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {}); // tabs without our content script
  }
});

// The site a message comes from: the tab's page for content scripts; extension pages (the toolbar popup, also
// when it is opened in a tab) name the site of the active tab themselves.
function siteOf(sender, claimed) {
  if (sender.url?.startsWith(chrome.runtime.getURL(''))) return typeof claimed === 'string' && claimed ? claimed : null;
  return sender.tab?.url ? hostOf(sender.tab.url) : null;
}

function hostOf(url) {
  try {
    const { protocol, host } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? host : null;
  } catch {
    return null;
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate' && port.name !== 'compose') return;
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  const send = (message) => {
    if (connected) port.postMessage(message);
  };
  port.onMessage.addListener((message) => {
    if (port.name === 'compose') {
      compose(message, siteOf(port.sender, message.site), controller.signal, send);
      return;
    }
    const { text, mode, context, lang } = message;
    if (typeof text !== 'string' || !text.trim()) return;
    const request = {
      text: text.slice(0, MAX_TEXT),
      mode: MODES.has(mode) ? mode : 'text',
      context: typeof context === 'string' ? context.slice(0, MAX_CONTEXT) : '',
    };
    const site = siteOf(port.sender);
    watch(site, port.sender);
    translate(request, site, controller.signal, send, (translation, siteMode) => {
      if (!site || request.mode !== 'text') return;
      countRead(site, lang);
      if (!siteMode.noContext) learn(site, request.text, translation);
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
  if (message?.type === 'page-settings') {
    const site = siteOf(sender);
    watch(site, sender);
    Promise.all([loadSettings(), modeOf(site)]).then(([settings, siteMode]) => sendResponse({ ...pageSettings(settings), siteMode }));
    return true;
  }
  if (message?.type === 'site-mode') {
    modeOf(siteOf(sender, message.site)).then(sendResponse);
    return true;
  }
  if (message?.type === 'set-site-mode') {
    // Only SpotSlate's own pages (the toolbar window, the settings) change a site's mode.
    const site = sender.url?.startsWith(chrome.runtime.getURL('')) ? siteOf(sender, message.site) : null;
    if (site) setSiteMode(site, message.mode).then(sendResponse);
    return Boolean(site);
  }
  if (message?.type === 'notes') {
    const site = siteOf(sender, message.site);
    watch(site, sender);
    modeOf(site)
      .then((siteMode) => (siteMode.noContext ? '' : notesOf(site))).then((text) => sendResponse({ site, text, updating: Boolean(site && stateOf(site).controller) }));
    return true; // the answer comes later
  }
  if (message?.type === 'clear-notes') {
    const site = siteOf(sender, message.site);
    if (site) clearNotes(site);
  }
  if (message?.type === 'report') openReport(message.mode === 'dictionary' ? 'a dictionary entry' : 'a paragraph');
  if (message?.type === 'read-lang') {
    // A text the page translated by itself, with Chrome's translator: only its language is counted.
    const site = siteOf(sender);
    if (site) countRead(site, message.lang);
  }
  if (message?.type === 'compose-open') {
    composeState(siteOf(sender, message.site), message.pageLang).then(sendResponse);
    return true;
  }
  if (message?.type === 'compose-target') {
    saveComposeTarget(siteOf(sender, message.site), message.lang);
  }
  if (message?.type === 'compose-draft') {
    // Each site keeps its own draft, so what was written for one site never shows up on another.
    const key = DRAFT_PREFIX + (siteOf(sender, message.site) ?? '');
    const draft = typeof message.draft === 'string' ? message.draft.slice(0, MAX_DRAFT) : '';
    if (draft) chrome.storage.session.set({ [key]: draft }).catch(() => {});
    else chrome.storage.session.remove(key).catch(() => {});
  }
});

// A new GitHub issue about a bad translation, with the setup filled in: never the text, which may be confidential
// (the page copies it for the user to paste), the page or the API URL, which may name an internal server.
async function openReport(what) {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  const engine = provider.api === 'browser' ? "Chrome's built-in translator" : `${provider.name}, ${provider.model}`;
  const setup = [
    `SpotSlate ${chrome.runtime.getManifest().version}`,
    engine,
    `into ${LANGUAGES[settings.targetLang]}, ${what}`,
    navigator.userAgent,
  ].join('\n');
  const url = new URL(`${REPOSITORY}/issues/new`);
  url.searchParams.set('template', 'translation.yml');
  url.searchParams.set('setup', setup);
  chrome.tabs.create({ url: url.href });
}

// The site context (notes). Each site has one update at a time; texts translated meanwhile wait in its queue
// for the next one. `learned` keeps the latest sources so the same text does not teach the notes twice.
const notesState = new Map(); // site -> { queue, learned, controller }
// The tabs that translated on a site or opened its context, to tell about changes: without the `tabs` permission
// Chrome does not say which site a tab is on, but a message from a tab does.
const siteTabs = new Map(); // site -> Set of tab ids

function watch(site, sender) {
  const tabId = sender.tab?.id;
  if (!site || tabId === undefined) return;
  if (!siteTabs.has(site)) siteTabs.set(site, new Set());
  siteTabs.get(site).add(tabId);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const tabs of siteTabs.values()) tabs.delete(tabId);
});

function stateOf(site) {
  if (!notesState.has(site)) notesState.set(site, { queue: [], learned: [], controller: null });
  return notesState.get(site);
}

async function notesOf(site) {
  if (!site) return '';
  const key = NOTES_PREFIX + site;
  return (await chrome.storage.session.get(key))[key] ?? '';
}

// Tells the site's tabs and the toolbar popup what the notes are now. A tab that has moved on to another site
// ignores it.
function announce(site, text, updating) {
  const message = { type: 'notes-changed', site, text, updating };
  chrome.runtime.sendMessage(message).catch(() => {}); // no extension page is open
  for (const tabId of siteTabs.get(site) ?? []) {
    chrome.tabs.sendMessage(tabId, message).catch(() => siteTabs.get(site)?.delete(tabId));
  }
}

// A text the user translated on the site, with its translation: the notes learn from it after it is shown.
function learn(site, source, translation) {
  if (source.trim().length < MIN_PASSAGE) return;
  const state = stateOf(site);
  if (state.learned.includes(source)) return;
  state.learned = [...state.learned, source].slice(-LEARNED_LIMIT);
  state.queue.push(passageOf(source, translation));
  if (!state.controller) updateNotes(site);
}

// Rewrites the site's notes with the queued texts. Any failure leaves the notes as they were, without a word.
async function updateNotes(site) {
  const state = stateOf(site);
  const passages = takePassages(state.queue);
  state.queue = [];
  if (passages.length === 0) return;
  const controller = new AbortController();
  state.controller = controller;
  announce(site, await notesOf(site), true);
  try {
    const settings = await loadSettings();
    const provider = activeProvider(settings);
    const siteMode = await modeOf(site);
    const allowed = !siteMode.off && !siteMode.local && !siteMode.noContext;
    if (provider.api !== 'browser' && !setupProblem(provider) && settings.consent >= CONSENT_VERSION && allowed) {
      const messages = buildNotesMessages(await notesOf(site), passages, LANGUAGES[settings.targetLang]);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(NOTES_TIMEOUT_MS)]);
      const response = await sendChat(provider, { messages, stream: false, purpose: 'notes' }, signal);
      const notes = response.ok ? cleanNotes(answerText(await response.json())) : '';
      if (notes && !controller.signal.aborted) await chrome.storage.session.set({ [NOTES_PREFIX + site]: notes });
    }
  } catch {
    // a timeout, a network error or a full session storage: the notes are only a help
  }
  if (state.controller !== controller) return; // cleared meanwhile
  state.controller = null;
  if (state.queue.length > 0) updateNotes(site);
  else announce(site, await notesOf(site), false);
}

async function clearNotes(site) {
  const state = stateOf(site);
  state.controller?.abort();
  state.controller = null;
  state.queue = [];
  state.learned = [];
  await chrome.storage.session.remove(NOTES_PREFIX + site);
  announce(site, '', false);
}

// What the user chose for a site (see lib/sites.js); the default for no site.
async function modeOf(site) {
  if (!site) return { ...DEFAULT_SITE_MODE };
  const { [SITES_KEY]: sites } = await chrome.storage.local.get(SITES_KEY);
  return siteModeOf(sites, site);
}

// Saves a site's mode and tells the site's tabs and SpotSlate's pages at once. A site that stops learning its context
// forgets what it learned.
async function setSiteMode(site, mode) {
  const { [SITES_KEY]: sites } = await chrome.storage.local.get(SITES_KEY);
  const next = withSiteMode(sites, site, mode);
  await chrome.storage.local.set({ [SITES_KEY]: next });
  const siteMode = siteModeOf(next, site);
  if (siteMode.noContext || siteMode.local || siteMode.off) await clearNotes(site);
  const message = { type: 'site-mode-changed', site, siteMode };
  chrome.runtime.sendMessage(message).catch(() => {});
  for (const tabId of siteTabs.get(site) ?? []) chrome.tabs.sendMessage(tabId, message).catch(() => siteTabs.get(site)?.delete(tabId));
  return siteMode;
}

// The languages of the texts read on a site, counted; no text is kept.
async function countRead(site, lang) {
  const key = LANGS_PREFIX + site;
  try {
    const counts = (await chrome.storage.session.get(key))[key] ?? {};
    const next = countLanguage(counts, lang);
    if (next !== counts) await chrome.storage.session.set({ [key]: next });
  } catch {
    // the session storage is full; the counts are only a help
  }
}

// What the compose window needs to open: the languages, the engine, the site and its notes, the draft.
async function composeState(site, pageLang) {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  const siteMode = await modeOf(site);
  const { [LANGS_PREFIX + site]: readCounts = {} } = site ? await chrome.storage.session.get(LANGS_PREFIX + site) : {};
  const { [COMPOSE_KEY]: saved = {} } = await chrome.storage.local.get(COMPOSE_KEY);
  const draftKey = DRAFT_PREFIX + (site ?? '');
  const { [draftKey]: draft = '' } = await chrome.storage.session.get(draftKey);
  const from = settings.targetLang;
  const to = chooseComposeTarget({
    from,
    saved: site ? saved.targets?.[site] : null,
    readCounts,
    pageLang: typeof pageLang === 'string' ? pageLang : null,
    last: saved.last,
  });
  return {
    languages: LANGUAGES,
    from,
    to,
    engine: provider.api === 'browser' || siteMode.local ? 'browser' : 'api',
    aiProvider: provider.api !== 'browser',
    providerName: provider.name,
    site,
    siteMode,
    notes: siteMode.noContext ? '' : await notesOf(site),
    draft,
  };
}

async function saveComposeTarget(site, lang) {
  if (!Object.hasOwn(LANGUAGES, lang)) return;
  const { [COMPOSE_KEY]: saved = {} } = await chrome.storage.local.get(COMPOSE_KEY);
  const targets = { ...saved.targets, ...(site ? { [site]: lang } : {}) };
  await chrome.storage.local.set({ [COMPOSE_KEY]: { targets, last: lang } });
}

// A draft into the page's language ('write'), or a translation back into the user's own ('check').
async function compose({ text, from, to, purpose }, site, signal, send) {
  const draft = typeof text === 'string' ? text.slice(0, MAX_DRAFT) : '';
  if (!draft || !Object.hasOwn(LANGUAGES, from) || !Object.hasOwn(LANGUAGES, to)) return;
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  if (provider.api === 'browser') {
    send({ type: 'error', ...settingsChanged(settings.targetLang) });
    return;
  }
  const problem = setupProblem(provider);
  if (problem) {
    send({ type: 'error', ...makeError(problem, provider, settings.targetLang) });
    return;
  }
  if (settings.consent < CONSENT_VERSION) {
    send({ type: 'error', ...makeError('no_consent', provider, settings.targetLang) });
    return;
  }
  const siteMode = await modeOf(site);
  if (siteMode.off || siteMode.local) {
    // The page did not hear yet that this site is off or kept on this computer.
    send({ type: 'error', ...settingsChanged(settings.targetLang) });
    return;
  }
  // The check translates back without the notes, to show what the text says by itself.
  const messages =
    purpose === 'check'
      ? buildMessages(draft, LANGUAGES[to])
      : buildComposeMessages(draft, LANGUAGES[from], LANGUAGES[to], { notes: siteMode.noContext ? '' : await notesOf(site) });
  await stream(provider, messages, signal, send, settings.targetLang);
}

async function translate(request, site, signal, send, onTranslated = () => {}) {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  if (provider.api === 'browser') {
    // The page did not hear about the switch to the free translator yet; the message is on its way.
    send({ type: 'error', ...settingsChanged(settings.targetLang) });
    return;
  }
  const problem = setupProblem(provider);
  if (problem) {
    send({ type: 'error', ...makeError(problem, provider, settings.targetLang) });
    return;
  }
  if (settings.consent < CONSENT_VERSION) {
    send({ type: 'error', ...makeError('no_consent', provider, settings.targetLang) });
    return;
  }
  const siteMode = await modeOf(site);
  if (siteMode.off || siteMode.local) {
    // The page did not hear yet that this site is off or kept on this computer.
    send({ type: 'error', ...settingsChanged(settings.targetLang) });
    return;
  }

  const key = await cacheKey(provider, settings.targetLang, request);
  const cached = (await chrome.storage.session.get(key))[key];
  if (cached !== undefined) {
    send({ type: 'chunk', text: cached });
    send({ type: 'done' });
    onTranslated(cached, siteMode);
    return;
  }

  const notes = siteMode.noContext ? '' : await notesOf(site);
  const messages = buildMessages(request.text, LANGUAGES[settings.targetLang], { ...request, notes });
  const translation = await stream(provider, messages, signal, send, settings.targetLang);
  if (translation) {
    onTranslated(translation, siteMode);
    await remember(key, translation);
  }
}

// Streams a chat answer to `send` as chunks, then done or an error (worded in `lang`). Resolves to the whole text, or ''
// when none came.
async function stream(provider, messages, signal, send, lang) {
  const idle = new AbortController();
  let timer = 0;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    touch();
    const response = await sendChat(provider, { messages, stream: true }, AbortSignal.any([signal, idle.signal]));
    if (!response.ok) {
      send({ type: 'error', ...errorFromStatus(response.status, await response.text(), provider, lang) });
      return '';
    }
    let translation = '';
    await readTextStream(
      response.body,
      (chunk) => {
        translation += chunk;
        send({ type: 'chunk', text: chunk });
      },
      touch,
    );
    if (!translation) {
      send({ type: 'error', ...makeError('empty', provider, lang) });
      return '';
    }
    send({ type: 'done' });
    return translation;
  } catch {
    if (!signal.aborted) send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network', provider, lang) });
    return ''; // aborted: the page closed the popup
  } finally {
    clearTimeout(timer);
  }
}

// Translations are shared by all tabs for the browser session (chrome.storage.session). The notes are left out:
// a text translated once is reused while they grow.
async function cacheKey({ id, baseUrl, model }, targetLang, { mode, text, context }) {
  const data = new TextEncoder().encode(JSON.stringify([id, baseUrl, model, targetLang, mode, text, context]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return CACHE_PREFIX + Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

// When the session storage is full the cache starts over; the site contexts, the language counts and the drafts stay.
async function remember(key, translation) {
  try {
    await chrome.storage.session.set({ [key]: translation });
  } catch {
    const cached = Object.keys(await chrome.storage.session.get(null)).filter((name) => name.startsWith(CACHE_PREFIX));
    await chrome.storage.session.remove(cached);
  }
}
