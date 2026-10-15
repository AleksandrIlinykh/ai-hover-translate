import { buildMessages } from './lib/prompt.js';
import { buildTopicMessages, cleanTopics, parseTopics } from './lib/topics.js';
import { buildComposeMessages, chooseComposeTarget, pickReferences, rememberPair } from './lib/compose.js';
import { readTextStream, sendChat } from './lib/chat.js';
import { answerText, setupProblem } from './lib/providers.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, activeProvider, loadSettings } from './lib/settings.js';
import { currentPlatform, readKeyName } from './lib/keys.js';

const IDLE_TIMEOUT_MS = 30_000;
const TOPIC_TIMEOUT_MS = 15_000;
const MAX_CONTEXT = 1000;
const MODES = new Set(['text', 'dictionary']);
const CACHE_PREFIX = 'cache:';
const LOCAL_ORIGIN_RULE = 1;
const MAX_DRAFT = 3000;
const MEMORY_PREFIX = 'memory:'; // + site: the passages the user read there, for the compose window
const DRAFT_KEY = 'compose:draft'; // the last draft, in chrome.storage.session
const COMPOSE_KEY = 'compose'; // { targets: { [site]: lang }, last: lang } in chrome.storage.local

// The settings hold API keys: only extension pages and this worker may read them, never content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

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

// Pages get the public part of the settings: the target language, which engine translates and the keys. With the
// free engine (Chrome's translator) the page translates by itself.
function pageSettings(settings) {
  const { read, write } = settings.keys;
  return {
    targetLang: settings.targetLang,
    engine: activeProvider(settings).api === 'browser' ? 'browser' : 'api',
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

// The site a message comes from: the tab's page for content scripts; extension pages (the toolbar popup)
// name the site of the active tab themselves.
function siteOf(sender, claimed) {
  if (sender.tab?.url) return hostOf(sender.tab.url);
  return sender.url?.startsWith(chrome.runtime.getURL('')) && typeof claimed === 'string' ? claimed : null;
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
    const { text, mode, context, topics, lang } = message;
    const request = {
      text,
      mode: MODES.has(mode) ? mode : 'text',
      context: typeof context === 'string' ? context.slice(0, MAX_CONTEXT) : '',
      topics: cleanTopics(topics),
    };
    const site = siteOf(port.sender);
    translate(request, controller.signal, send, (translation) => {
      if (site && request.mode === 'text') readOnSite(site, request.text, translation, lang);
    });
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
  if (message?.type === 'page-settings') {
    loadSettings().then((settings) => sendResponse(pageSettings(settings)));
    return true;
  }
  if (message?.type === 'topics') {
    findTopics(String(message.text ?? '')).then((topics) => sendResponse({ topics }));
    return true; // the answer comes later
  }
  if (message?.type === 'remember-pair') {
    // A passage the page translated by itself, with Chrome's translator.
    const site = siteOf(sender);
    if (site && typeof message.source === 'string' && typeof message.translation === 'string') {
      readOnSite(site, message.source, message.translation, message.lang);
    }
  }
  if (message?.type === 'compose-open') {
    composeState(siteOf(sender, message.site), message.pageLang).then(sendResponse);
    return true;
  }
  if (message?.type === 'compose-target') {
    saveComposeTarget(siteOf(sender, message.site), message.lang);
  }
  if (message?.type === 'compose-draft') {
    const draft = typeof message.draft === 'string' ? message.draft.slice(0, MAX_DRAFT) : '';
    if (draft) chrome.storage.session.set({ [DRAFT_KEY]: draft }).catch(() => {});
    else chrome.storage.session.remove(DRAFT_KEY).catch(() => {});
  }
});

// The passages the user read on a site, in this browser session: references for writing there.
async function memoryOf(site) {
  const key = MEMORY_PREFIX + site;
  return (await chrome.storage.session.get(key))[key] ?? [];
}

async function readOnSite(site, source, translation, lang) {
  const pair = { source, translation, lang: typeof lang === 'string' && lang ? lang : null };
  try {
    await chrome.storage.session.set({ [MEMORY_PREFIX + site]: rememberPair(await memoryOf(site), pair) });
  } catch {
    // the session storage is full; the memory is only a help
  }
}

// What the compose window needs to open: the languages, the engine, how much it knows about the site, the draft.
async function composeState(site, pageLang) {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  const memory = site ? await memoryOf(site) : [];
  const { [COMPOSE_KEY]: saved = {} } = await chrome.storage.local.get(COMPOSE_KEY);
  const { [DRAFT_KEY]: draft = '' } = await chrome.storage.session.get(DRAFT_KEY);
  const from = settings.targetLang;
  const to = chooseComposeTarget({
    from,
    saved: site ? saved.targets?.[site] : null,
    readLangs: memory.map((pair) => pair.lang),
    pageLang: typeof pageLang === 'string' ? pageLang : null,
    last: saved.last,
  });
  return {
    languages: LANGUAGES,
    from,
    to,
    engine: provider.api === 'browser' ? 'browser' : 'api',
    providerName: provider.name,
    memorySize: memory.length,
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
async function compose({ text, from, to, purpose, topics, useMemory }, site, signal, send) {
  const draft = typeof text === 'string' ? text.slice(0, MAX_DRAFT) : '';
  if (!draft || !Object.hasOwn(LANGUAGES, from) || !Object.hasOwn(LANGUAGES, to)) return;
  const provider = activeProvider(await loadSettings());
  if (provider.api === 'browser') {
    send({ type: 'error', code: 'engine_changed', message: 'The settings have changed. Try again.' });
    return;
  }
  const problem = setupProblem(provider);
  if (problem) {
    send({ type: 'error', ...makeError(problem, provider) });
    return;
  }
  let messages;
  if (purpose === 'check') {
    messages = buildMessages(draft, LANGUAGES[to]);
  } else {
    const references = useMemory && site ? pickReferences(await memoryOf(site), draft, { to }) : [];
    messages = buildComposeMessages(draft, LANGUAGES[from], LANGUAGES[to], { topics: cleanTopics(topics), references });
  }
  await stream(provider, messages, signal, send);
}

// Tags for the page topic; none when anything goes wrong, since the topic is only a hint.
async function findTopics(text) {
  const provider = activeProvider(await loadSettings());
  if (provider.api === 'browser' || setupProblem(provider) || !text) return [];
  try {
    const response = await sendChat(
      provider,
      { messages: buildTopicMessages(text), stream: false, purpose: 'topics' },
      AbortSignal.timeout(TOPIC_TIMEOUT_MS),
    );
    if (!response.ok) return [];
    return parseTopics(answerText(await response.json()));
  } catch {
    return [];
  }
}

async function translate(request, signal, send, onTranslated = () => {}) {
  const settings = await loadSettings();
  const provider = activeProvider(settings);
  if (provider.api === 'browser') {
    // The page did not hear about the switch to the free translator yet; the message is on its way.
    send({ type: 'error', code: 'engine_changed', message: 'The settings have changed. Try again.' });
    return;
  }
  const problem = setupProblem(provider);
  if (problem) {
    send({ type: 'error', ...makeError(problem, provider) });
    return;
  }

  const key = await cacheKey(provider, settings.targetLang, request);
  const cached = (await chrome.storage.session.get(key))[key];
  if (cached !== undefined) {
    send({ type: 'chunk', text: cached });
    send({ type: 'done' });
    onTranslated(cached);
    return;
  }

  const messages = buildMessages(request.text, LANGUAGES[settings.targetLang], request);
  const translation = await stream(provider, messages, signal, send);
  if (translation) {
    onTranslated(translation);
    await remember(key, translation);
  }
}

// Streams a chat answer to `send` as chunks, then done or an error. Resolves to the whole text, or '' when none came.
async function stream(provider, messages, signal, send) {
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
      send({ type: 'error', ...errorFromStatus(response.status, await response.text(), provider) });
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
      send({ type: 'error', ...makeError('empty', provider) });
      return '';
    }
    send({ type: 'done' });
    return translation;
  } catch {
    if (!signal.aborted) send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network', provider) });
    return ''; // aborted: the page closed the popup
  } finally {
    clearTimeout(timer);
  }
}

// Translations are shared by all tabs for the browser session (chrome.storage.session).
async function cacheKey({ id, baseUrl, model }, targetLang, { mode, text, context, topics }) {
  const data = new TextEncoder().encode(JSON.stringify([id, baseUrl, model, targetLang, mode, text, context, topics]));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return CACHE_PREFIX + Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function remember(key, translation) {
  try {
    await chrome.storage.session.set({ [key]: translation });
  } catch {
    await chrome.storage.session.clear(); // quota is full: start over
  }
}
