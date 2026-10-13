const MESSAGES = {
  no_key: ({ name }) => `${name} API key is not set.`,
  no_model: ({ name }) => `Choose a model for ${name} in the settings.`,
  no_url: ({ name }) => `Set the API URL for ${name} in the settings.`,
  auth: () => 'Invalid API key. Check it in the settings.',
  balance: ({ name }) => `Your ${name} balance has run out.`,
  rate_limit: () => 'Too many requests. Please wait a moment.',
  network: () => 'Cannot connect to the API.',
  timeout: () => 'The API did not respond within 30 seconds.',
  empty: () => 'The API returned an empty response.',
};

export function makeError(code, provider) {
  return { code, message: MESSAGES[code](provider) };
}

export function errorFromStatus(status, bodyText, provider) {
  const apiMessage = parseApiMessage(bodyText);
  const tail = apiMessage ? `: ${apiMessage}` : '';
  switch (status) {
    case 401:
      return makeError('auth', provider);
    case 402:
      return makeError('balance', provider);
    case 403:
      return { code: 'denied', message: `Access denied (403)${tail}` };
    case 404:
      return { code: 'not_found', message: `Not found (404). Check the model and the API URL${tail}` };
    case 429:
      return makeError('rate_limit', provider);
    case 400:
    case 422:
      return { code: 'bad_request', message: `Invalid API request${tail}` };
    case 500:
    case 502:
    case 503:
    case 504:
    case 529: // Anthropic is overloaded
      return { code: 'server', message: `The API server is unavailable (${status}). Try again later.` };
    default:
      return { code: 'http', message: `API error ${status}${tail}` };
  }
}

// The error text from a JSON body: { error: { message } } (OpenAI, Anthropic), [{ error: { message } }] (Gemini),
// { error: "..." } (Ollama) or { message } (others).
function parseApiMessage(bodyText) {
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return '';
  }
  if (Array.isArray(data)) data = data[0];
  const message = data?.error?.message ?? data?.error ?? data?.message;
  return typeof message === 'string' ? message.trim() : '';
}
