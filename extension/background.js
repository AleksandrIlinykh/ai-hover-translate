import { buildMessages } from './lib/prompt.js';
import { createSseParser, deltaFromPayload } from './lib/sse.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, loadSettings } from './lib/settings.js';

const IDLE_TIMEOUT_MS = 30_000;
const MODES = new Set(['text', 'dictionary']);
const CACHE_PREFIX = 'cache:';
const TEMPERATURE = 1.3; // DeepSeek's recommended temperature for translation

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  port.onMessage.addListener(({ text, mode }) => {
    translate(text, MODES.has(mode) ? mode : 'text', controller.signal, (message) => {
      if (connected) port.postMessage(message);
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function translate(text, mode, signal, send) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    send({ type: 'error', ...makeError('no_key') });
    return;
  }

  const key = await cacheKey(settings, mode, text);
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
    const response = await fetch(`${settings.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        messages: buildMessages(text, LANGUAGES[settings.targetLang], mode),
        stream: true,
        temperature: TEMPERATURE,
        thinking: { type: 'disabled' }, // on by default: slower, and the reasoning is billed
      }),
      signal: AbortSignal.any([signal, idle.signal]),
    });
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
async function cacheKey(settings, mode, text) {
  const data = new TextEncoder().encode(JSON.stringify([settings.baseUrl, settings.model, settings.targetLang, mode, text]));
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
