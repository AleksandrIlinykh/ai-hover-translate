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

export function deltaFromPayload(payload) {
  if (payload === '[DONE]') return { done: true };
  let data;
  try {
    data = JSON.parse(payload);
  } catch {
    return null;
  }
  const content = data?.choices?.[0]?.delta?.content;
  return typeof content === 'string' && content !== '' ? { text: content } : null;
}
