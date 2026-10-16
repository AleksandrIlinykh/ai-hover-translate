// The errors SpotSlate shows, worded in `lang`: the language the user translates into on pages, English on the settings
// page. The texts are in content/strings.js.
import '../content/strings.js';

const KEYS = {
  no_key: 'noKey',
  no_model: 'noModel',
  no_url: 'noUrl',
  insecure_url: 'insecureUrl',
  auth: 'auth',
  balance: 'balance',
  rate_limit: 'rateLimit',
  network: 'network',
  timeout: 'timeout',
  empty: 'empty',
};

const say = (lang, key, params) => globalThis.spotslate.t(lang, key, params);

export function makeError(code, provider, lang = 'en') {
  return { code, message: say(lang, KEYS[code], { name: provider.name }) };
}

// The settings changed to Chrome's translator while a request was on its way to background.
export function settingsChanged(lang = 'en') {
  return { code: 'engine_changed', message: say(lang, 'settingsChanged') };
}

export function errorFromStatus(status, bodyText, provider, lang = 'en') {
  const apiMessage = parseApiMessage(bodyText);
  const tail = apiMessage ? `: ${apiMessage}` : '';
  const error = (code, key) => ({ code, message: say(lang, key, { status, tail }) });
  switch (status) {
    case 401:
      return makeError('auth', provider, lang);
    case 402:
      return makeError('balance', provider, lang);
    case 403:
      return error('denied', 'denied');
    case 404:
      return error('not_found', 'notFound');
    case 429:
      return makeError('rate_limit', provider, lang);
    case 400:
    case 422:
      return error('bad_request', 'badRequest');
    case 500:
    case 502:
    case 503:
    case 504:
    case 529: // Anthropic is overloaded
      return error('server', 'server');
    default:
      return error('http', 'http');
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
