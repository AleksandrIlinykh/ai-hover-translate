import { buildMessages } from './lib/prompt.js';
import { buildTopicMessages, cleanTopics, parseTopics } from './lib/topics.js';
import { readTextStream, sendChat } from './lib/chat.js';
import { answerText, setupProblem } from './lib/providers.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, activeProvider, loadSettings } from './lib/settings.js';

const IDLE_TIMEOUT_MS = 30_000;
const TOPIC_TIMEOUT_MS = 15_000;
const MAX_CONTEXT = 1000;
const MODES = new Set(['text', 'dictionary']);
const CACHE_PREFIX = 'cache:';
const LOCAL_ORIGIN_RULE = 1;

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

// Pages get the public part of the settings: the target language and which engine translates. With the free
// one (Chrome's translator) the page translates by itself.
function pageSettings(settings) {
  return { targetLang: settings.targetLang, engine: activeProvider(settings).api === 'browser' ? 'browser' : 'api' };
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || !changes.settings) return;
  const message = { type: 'settings-changed', ...pageSettings(await loadSettings()) };
  for (const tab of await chrome.tabs.query({})) {
    chrome.tabs.sendMessage(tab.id, message).catch(() => {}); // tabs without our content script
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  port.onMessage.addListener(({ text, mode, context, topics }) => {
    const request = {
      text,
      mode: MODES.has(mode) ? mode : 'text',
      context: typeof context === 'string' ? context.slice(0, MAX_CONTEXT) : '',
      topics: cleanTopics(topics),
    };
    translate(request, controller.signal, (message) => {
      if (connected) port.postMessage(message);
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
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

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

async function translate(request, signal, send) {
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
    return;
  }

  const idle = new AbortController();
  let timer = 0;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => idle.abort(), IDLE_TIMEOUT_MS);
  };

  try {
    touch();
    const response = await sendChat(
      provider,
      { messages: buildMessages(request.text, LANGUAGES[settings.targetLang], request), stream: true },
      AbortSignal.any([signal, idle.signal]),
    );
    if (!response.ok) {
      send({ type: 'error', ...errorFromStatus(response.status, await response.text(), provider) });
      return;
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
      return;
    }
    send({ type: 'done' });
    await remember(key, translation);
  } catch {
    if (signal.aborted) return; // the page closed the popup
    send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network', provider) });
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
