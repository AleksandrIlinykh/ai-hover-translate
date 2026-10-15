// What can translate: Chrome's own on-device translator (api 'browser', run by the page itself, see
// content/translator.js) and the APIs the extension talks to. All APIs but Anthropic speak OpenAI's chat completions.
// `extras` turn reasoning off: it slows the answer down and is billed, and a translation does not need it.
// Some models reject these parameters; background then sends the request again without them (see chat.js).
export const PROVIDERS = Object.freeze({
  chrome: {
    name: 'Chrome built-in translator',
    group: 'free',
    api: 'browser',
    baseUrl: '',
    model: '',
    models: [],
    keyRequired: false,
    extras: {},
    hint:
      'Free and private: Chrome translates on this computer, nothing is sent anywhere. It downloads a model ' +
      'once for each pair of languages; Test gets the one from English. The site context and dictionary entries ' +
      'need an AI provider.',
  },
  deepseek: {
    name: 'DeepSeek',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    keyRequired: true,
    keyUrl: 'https://platform.deepseek.com/api_keys',
    extras: { thinking: { type: 'disabled' } },
    temperature: { translate: 1.3, notes: 0 }, // 1.3 is DeepSeek's advice for translation
  },
  openai: {
    name: 'OpenAI',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-6-luna',
    models: ['gpt-6-luna', 'gpt-5.6-luna', 'gpt-5.4-mini'],
    keyRequired: true,
    keyUrl: 'https://platform.openai.com/api-keys',
    extras: { reasoning_effort: 'none' },
    maxTokensField: 'max_completion_tokens',
  },
  anthropic: {
    name: 'Anthropic Claude',
    group: 'cloud',
    api: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-haiku-5-5',
    models: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-haiku-4-5'],
    keyRequired: true,
    keyUrl: 'https://platform.claude.com/settings/keys',
    extras: { thinking: { type: 'disabled' } },
  },
  gemini: {
    name: 'Google Gemini',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-3.5-flash-lite',
    models: ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'],
    keyRequired: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    extras: { reasoning_effort: 'minimal' }, // Gemini 3 cannot stop reasoning, only keep it short
  },
  openrouter: {
    name: 'OpenRouter',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: '',
    models: [],
    keyRequired: true,
    keyUrl: 'https://openrouter.ai/settings/keys',
    extras: { reasoning: { effort: 'none' } },
    headers: { 'HTTP-Referer': 'https://github.com/AleksandrIlinykh/paragloss', 'X-Title': 'Paragloss' },
    hint: 'Hundreds of models from many vendors under one key. Load the list and pick one.',
  },
  groq: {
    name: 'Groq',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'openai/gpt-oss-120b',
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.1-8b-instant'],
    keyRequired: true,
    keyUrl: 'https://console.groq.com/keys',
    extras: { reasoning_effort: 'low' }, // the lowest that gpt-oss accepts
  },
  mistral: {
    name: 'Mistral',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-small-latest',
    models: ['mistral-small-latest', 'mistral-large-latest'],
    keyRequired: true,
    keyUrl: 'https://console.mistral.ai/api-keys',
    extras: { reasoning_effort: 'none' },
  },
  xai: {
    name: 'xAI Grok',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://api.x.ai/v1',
    model: 'grok-4.20-0309-non-reasoning',
    models: ['grok-4.20-0309-non-reasoning', 'grok-4.3'],
    keyRequired: true,
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    extras: {},
  },
  qwen: {
    name: 'Alibaba Qwen',
    group: 'cloud',
    api: 'openai',
    baseUrl: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    models: ['qwen-flash', 'qwen3.8-flash'],
    keyRequired: true,
    keyUrl: 'https://modelstudio.console.alibabacloud.com/model/settings/api-key',
    extras: { enable_thinking: false },
    hint: 'A key works only in its own region. For Singapore, use the API URL of your workspace in Model Studio.',
  },
  ollama: {
    name: 'Ollama',
    group: 'local',
    api: 'openai',
    baseUrl: 'http://localhost:11434/v1',
    model: '',
    models: [],
    keyRequired: false,
    extras: { reasoning_effort: 'none' },
    hint: 'Runs models on this computer. Start Ollama, then load the list of models you have pulled.',
  },
  lmstudio: {
    name: 'LM Studio',
    group: 'local',
    api: 'openai',
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    models: [],
    keyRequired: false,
    extras: {},
    hint: 'Runs models on this computer. Start the server on the Developer tab of LM Studio.',
  },
  custom: {
    name: 'Other OpenAI-compatible API',
    group: 'other',
    api: 'openai',
    baseUrl: '',
    model: '',
    models: [],
    keyRequired: false,
    extras: {},
    hint: 'Any API that speaks OpenAI chat completions: give its URL up to /v1 and a model.',
  },
});

const NOTES_MAX_TOKENS = 400;
const ANSWER_MAX_TOKENS = 8192; // Anthropic needs a limit; this one never cuts a translation short
const ANTHROPIC_VERSION = '2023-06-01';
const NOT_CHAT_MODEL = /embed|whisper|tts|speech|transcri|audio|realtime|image|dall-e|moderation|rerank/i;

function keyHeaders(provider) {
  if (provider.api === 'anthropic') {
    return {
      'x-api-key': provider.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Anthropic refuses requests from a browser origin without this header.
      'anthropic-dangerous-direct-browser-access': 'true',
    };
  }
  return { ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}), ...provider.headers };
}

// The fetch() arguments for a chat request; `purpose` is 'translate' or 'notes' (a short answer: the site notes).
export function chatRequest(provider, { messages, stream, purpose = 'translate' }, { extras = true } = {}) {
  const options = {
    ...(provider.temperature ? { temperature: provider.temperature[purpose] } : {}),
    ...(extras ? provider.extras : {}),
  };
  const headers = { 'Content-Type': 'application/json', ...keyHeaders(provider) };
  if (provider.api === 'anthropic') {
    const [system, ...rest] = messages;
    const body = {
      model: provider.model,
      system: system.content,
      messages: rest,
      max_tokens: purpose === 'notes' ? NOTES_MAX_TOKENS : ANSWER_MAX_TOKENS,
      stream,
      ...options,
    };
    return { url: `${provider.baseUrl}/messages`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
  }
  const limit = purpose === 'notes' ? { [provider.maxTokensField ?? 'max_tokens']: NOTES_MAX_TOKENS } : {};
  const body = { model: provider.model, messages, stream, ...limit, ...options };
  return { url: `${provider.baseUrl}/chat/completions`, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

export function modelsRequest(provider) {
  return { url: `${provider.baseUrl}/models`, init: { method: 'GET', headers: keyHeaders(provider) } };
}

// Model ids from a /models answer: chat models only, without Gemini's "models/" prefix, sorted.
export function parseModels(data) {
  if (!Array.isArray(data?.data)) return [];
  const ids = data.data
    .map((model) => model?.id)
    .filter((id) => typeof id === 'string' && id !== '')
    .map((id) => id.replace(/^models\//, ''))
    .filter((id) => !NOT_CHAT_MODEL.test(id));
  return [...new Set(ids)].sort();
}

// The text of an answer that was not streamed, from either API.
export function answerText(data) {
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');
}

// What has to be filled in before anything can be sent: 'no_url', 'no_key', 'no_model', or null.
export function setupProblem(provider) {
  if (provider.api === 'browser') return null;
  if (!hostPattern(provider.baseUrl)) return 'no_url';
  if (provider.keyRequired && !provider.apiKey) return 'no_key';
  if (!provider.model) return 'no_model';
  return null;
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// One line for the settings page: where the text goes with this provider.
export function dataNote(provider) {
  if (provider.api === 'browser') {
    return 'Nothing you translate leaves this computer. Chrome downloads its translation models once, without your text.';
  }
  if (!hostPattern(provider.baseUrl)) return 'The text you hold Alt over or write in Paragloss will go to the API URL you enter.';
  const { host, hostname } = new URL(provider.baseUrl);
  if (LOCAL_HOSTS.has(hostname)) {
    return `The text you hold Alt over or write in Paragloss goes to ${provider.name} on this computer (${host}). Nothing else leaves your browser.`;
  }
  return (
    'The text you hold Alt over or write in Paragloss, with a few words around a selection and the context Paragloss keeps for the site, ' +
    `is sent to ${provider.name} at ${host} with your key; their privacy policy applies. Nothing else leaves your browser.`
  );
}

// The host permission an API URL needs, such as https://api.example.com/*; null for anything but http(s).
export function hostPattern(baseUrl) {
  try {
    const { protocol, host } = new URL(baseUrl);
    return protocol === 'https:' || protocol === 'http:' ? `${protocol}//${host}/*` : null;
  } catch {
    return null;
  }
}
