import { buildMessages } from './lib/prompt.js';
import { createSseParser, deltaFromPayload } from './lib/sse.js';
import { errorFromStatus, makeError } from './lib/errors.js';
import { LANGUAGES, loadSettings } from './lib/settings.js';

const IDLE_TIMEOUT_MS = 30_000;
const TEMPERATURE = 1.3; // DeepSeek's recommended temperature for translation

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'translate') return;
  const controller = new AbortController();
  let connected = true;
  port.onDisconnect.addListener(() => {
    connected = false;
    controller.abort();
  });
  port.onMessage.addListener(({ text }) => {
    translate(text, controller.signal, (message) => {
      if (connected) port.postMessage(message);
    });
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'open-options') chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function translate(text, signal, send) {
  const settings = await loadSettings();
  if (!settings.apiKey) {
    send({ type: 'error', ...makeError('no_key') });
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
        messages: buildMessages(text, LANGUAGES[settings.targetLang]),
        stream: true,
        temperature: TEMPERATURE,
      }),
      signal: AbortSignal.any([signal, idle.signal]),
    });
    if (!response.ok) {
      send({ type: 'error', ...errorFromStatus(response.status, await response.text()) });
      return;
    }
    let gotText = false;
    await readStream(response.body, touch, (chunk) => {
      gotText = true;
      send({ type: 'chunk', text: chunk });
    });
    send(gotText ? { type: 'done' } : { type: 'error', ...makeError('empty') });
  } catch {
    if (signal.aborted) return; // the page closed the popup
    send({ type: 'error', ...makeError(idle.signal.aborted ? 'timeout' : 'network') });
  } finally {
    clearTimeout(timer);
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
