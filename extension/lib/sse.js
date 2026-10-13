function dataPayload(line) {
  return line.startsWith('data:') ? line.slice(5).replace(/^ /, '') : null;
}

function payloadsOf(lines) {
  return lines.map(dataPayload).filter((payload) => payload !== null);
}

// Splits a server-sent-events text stream into the payloads of its `data:` lines.
export function createSseParser() {
  let buffer = '';
  return {
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop();
      return payloadsOf(lines);
    },
    flush() {
      const line = buffer.replace(/\r$/, '');
      buffer = '';
      return payloadsOf([line]);
    },
  };
}

// The text of one streamed event, OpenAI style (choices[0].delta.content, a string or a list of parts)
// or Anthropic style (text_delta events, then message_stop). Reasoning deltas carry no text.
export function deltaFromPayload(payload) {
  if (payload === '[DONE]') return { done: true };
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  if (data?.type === 'message_stop') return { done: true };
  const content =
    data?.type === 'content_block_delta' ? data.delta?.type === 'text_delta' && data.delta.text : data?.choices?.[0]?.delta?.content;
  const text = Array.isArray(content)
    ? content
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
    : content;
  return typeof text === 'string' && text !== '' ? { text } : null;
}
