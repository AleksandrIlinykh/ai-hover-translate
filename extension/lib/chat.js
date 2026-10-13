import { chatRequest } from './providers.js';
import { createSseParser, deltaFromPayload } from './sse.js';

const INVALID = new Set([400, 422]);

// Sends a chat request. Some models reject the parameters that turn reasoning off, so a request that carries
// them and comes back as invalid is sent once more without them.
export async function sendChat(provider, payload, signal) {
  const first = chatRequest(provider, payload);
  const response = await fetch(first.url, { ...first.init, signal });
  if (!INVALID.has(response.status) || Object.keys(provider.extras ?? {}).length === 0) return response;
  await response.body?.cancel();
  const second = chatRequest(provider, payload, { extras: false });
  return fetch(second.url, { ...second.init, signal });
}

// Reads a streamed answer and hands each piece of text to onText; touch() runs before every read.
export async function readTextStream(body, onText, touch = () => {}) {
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
