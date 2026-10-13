import { buildMessages } from './lib/prompt.js';
import { buildTopicMessages, cleanTopics, parseTopics } from './lib/topics.js';
import { createSseParser, deltaFromPayload } from './lib/sse.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, loadSettings } from './lib/settings.js';

const IDLE_TIMEOUT_MS = 30_000;
const TOPIC_TIMEOUT_MS = 15_000;
const MAX_CONTEXT = 1000;
const MODES = new Set(['text', 'dictionary']);
const CACHE_PREFIX = 'cache:';
const TEMPERATURE = 1.3; // DeepSeek's recommended temperature for translation

// The settings hold API keys: only extension pages and this worker may read them, never content scripts.
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }).catch(() => {});

// Pages get the public part of the settings: the target language.
const pageSettings = (settings) => ({ targetLang: settings.targetLang });

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

function post(settings, body, signal) {
  return fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    // Thinking is on by default: slower, and the reasoning is billed.
    body: JSON.stringify({ model: settings.model, ...body, thinking: { type: 'disabled' } }),
    signal,
  });
}

// Tags for the page topic; none when anything goes wrong, since the topic is only a hint.
async function findTopics(text) {
  const settings = await loadSettings();
  if (!settings.apiKey || !text) return [];
  try {
    const response = await post(
      settings,
      { messages: buildTopicMessages(text), stream: false, temperature: 0, max_tokens: 40 },
      AbortSignal.timeout(TOPIC_TIMEOUT_MS),
    );
    if (!response.ok) return [];
    const data = await response.json();
    return parseTopics(data?.choices?.[0]?.message?.content);
  } catch {
    return [];
  }
}

async function translate(request, signal, send) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    send({ type: 'error', ...makeError('no_key') });
    return;
  }

  const key = await cacheKey(settings, request);
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
    const response = await post(
      settings,
      {
        messages: buildMessages(request.text, LANGUAGES[settings.targetLang], request),
        stream: true,
        temperature: TEMPERATURE,
      },
      AbortSignal.any([signal, idle.signal]),
    );
    if (!response.ok) {
      send({ type: 'error', ...errorFromStatus(response.status, await response.text()) });
      return;
    }
    let translation = '';
    await readStream(response.body, touch, (chunk) => {
      translation += chunk;
      send({ type: 'chunk', text: chunk });
    });
    if (!translation) {
      send({ type: 'error', ...makeError('empty') });
      return;
    }
    send({ type: 'done' });
    await remember(key, translation);
  } catch {
    if (signal.aborted) return; // the page closed the popup
    send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network') });
  } finally {
    clearTimeout(timer);
  }
}

// Translations are shared by all tabs for the browser session (chrome.storage.session).
async function cacheKey(settings, { mode, text, context, topics }) {
  const { baseUrl, model, targetLang } = settings;
  const data = new TextEncoder().encode(JSON.stringify([baseUrl, model, targetLang, mode, text, context, topics]));
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

async function readStream(body, touch, onText) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  for (;;) {
    touch();
    const { done, value } = await reader.read();
    const payloads = done ? parser.flush() : parser.push(decoder.decode(value, { stream: true }));
    for (const payload of payloads) {
      const delta = deltaFromPayload(payload);
      if (delta?.done) {
        await reader.cancel();
        return;
      }
      if (delta) onText(delta.text);
    }
    if (done) return;
  }
}
