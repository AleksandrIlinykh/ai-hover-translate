import { PROVIDERS } from './providers.js';

export const DEFAULTS = Object.freeze({
  provider: 'deepseek',
  targetLang: 'ru',
});

export const LANGUAGES = Object.freeze({
  ru: 'Russian',
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  pt: 'Portuguese',
  pl: 'Polish',
  uk: 'Ukrainian',
  tr: 'Turkish',
  zh: 'Chinese (Simplified)',
  ja: 'Japanese',
  ko: 'Korean',
});

// What is remembered for each provider; blank model and URL mean the provider's own defaults.
const PROVIDER_FIELDS = ['apiKey', 'model', 'baseUrl'];

// Names DeepSeek has retired; settings saved with them move to the default model.
const RETIRED_MODELS = new Set(['deepseek-chat', 'deepseek-reasoner']);

const trimmed = (value) => (typeof value === 'string' ? value.trim() : '');

function providerEntry(id, stored) {
  const entry = Object.fromEntries(PROVIDER_FIELDS.map((field) => [field, trimmed(stored?.[field])]));
  if (id === 'deepseek' && RETIRED_MODELS.has(entry.model)) entry.model = '';
  return entry;
}

// Stored settings with every value checked: { provider, targetLang, providers: { [id]: { apiKey, model, baseUrl } } }.
// Settings saved before providers existed kept apiKey, model and baseUrl at the top: they become the DeepSeek entry.
export function withDefaults(stored) {
  const provider = trimmed(stored?.provider);
  const targetLang = trimmed(stored?.targetLang);
  const entries =
    stored?.providers && typeof stored.providers === 'object'
      ? stored.providers
      : PROVIDER_FIELDS.some((field) => trimmed(stored?.[field]))
        ? { deepseek: stored }
        : {};
  const providers = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (Object.hasOwn(PROVIDERS, id)) providers[id] = providerEntry(id, entry);
  }
  return {
    provider: Object.hasOwn(PROVIDERS, provider) ? provider : DEFAULTS.provider,
    targetLang: Object.hasOwn(LANGUAGES, targetLang) ? targetLang : DEFAULTS.targetLang,
    providers,
  };
}

// The provider in use, with its key and the model and URL to call.
export function activeProvider(settings) {
  const id = settings.provider;
  const entry = settings.providers[id] ?? providerEntry(id);
  return {
    id,
    ...PROVIDERS[id],
    apiKey: entry.apiKey,
    model: entry.model || PROVIDERS[id].model,
    baseUrl: (entry.baseUrl || PROVIDERS[id].baseUrl).replace(/\/+$/, ''),
  };
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}
