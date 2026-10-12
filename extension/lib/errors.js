const MESSAGES = {
  no_key: 'DeepSeek API key is not set.',
  auth: 'Invalid API key. Check it in the settings.',
  balance: 'Your DeepSeek balance has run out.',
  rate_limit: 'Too many requests. Please wait a moment.',
  network: 'Cannot connect to the API.',
  timeout: 'The API did not respond within 30 seconds.',
  empty: 'The API returned an empty response.',
};

export function makeError(code) {
  return { code, message: MESSAGES[code] };
}

export function errorFromStatus(status, bodyText) {
  const apiMessage = parseApiMessage(bodyText);
  const tail = apiMessage ? `: ${apiMessage}` : '';
  switch (status) {
    case 401:
      return makeError('auth');
    case 402:
      return makeError('balance');
    case 429:
      return makeError('rate_limit');
    case 400:
    case 422:
      return { code: 'bad_request', message: `Invalid API request${tail}` };
    case 500:
    case 503:
      return { code: 'server', message: `The API server is unavailable (${status}). Try again later.` };
    default:
      return { code: 'http', message: `API error ${status}${tail}` };
  }
}

function parseApiMessage(bodyText) {
  try {
    const message = JSON.parse(bodyText)?.error?.message;
    return typeof message === 'string' ? message.trim() : '';
  } catch {
    return '';
  }
}
