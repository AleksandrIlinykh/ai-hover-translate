import { PROVIDERS } from './providers.js';
import { checkedKeys, currentPlatform } from './keys.js';

export const DEFAULTS = Object.freeze({
  provider: 'chrome',
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

// The browser's own language: Chrome's interface language, the same in every part of the extension (pages may be
// given another navigator.language).
const browserLanguage = () => globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language;

// The language to translate into until the user picks one: the browser's own language when Paragloss offers it,
// else English.
export function defaultTargetLang(uiLanguage = browserLanguage()) {
  const code = typeof uiLanguage === 'string' ? uiLanguage.split('-')[0].toLowerCase() : '';
  return Object.hasOwn(LANGUAGES, code) ? code : 'en';
}

// Stored settings with every value checked: { provider, targetLang, providers: { [id]: { apiKey, model, baseUrl } },
// keys: { read, write } } (see keys.js; keys refused on `platform` become the defaults).
// Settings saved before providers existed kept apiKey, model and baseUrl at the top: they become the DeepSeek entry,
// and DeepSeek stays in use.
export function withDefaults(stored, platform = currentPlatform(), uiLanguage = browserLanguage()) {
  const old = !stored?.providers && PROVIDER_FIELDS.some((field) => trimmed(stored?.[field]));
  const provider = old ? 'deepseek' : trimmed(stored?.provider);
  const targetLang = trimmed(stored?.targetLang);
  const entries = old ? { deepseek: stored } : stored?.providers && typeof stored.providers === 'object' ? stored.providers : {};
  const providers = {};
  for (const [id, entry] of Object.entries(entries)) {
    if (Object.hasOwn(PROVIDERS, id)) providers[id] = providerEntry(id, entry);
  }
  return {
    provider: Object.hasOwn(PROVIDERS, provider) ? provider : DEFAULTS.provider,
    targetLang: Object.hasOwn(LANGUAGES, targetLang) ? targetLang : defaultTargetLang(uiLanguage),
    providers,
    keys: checkedKeys(stored?.keys, platform),
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
