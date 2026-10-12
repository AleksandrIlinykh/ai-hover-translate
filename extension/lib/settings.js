export const DEFAULTS = Object.freeze({
  apiKey: '',
  targetLang: 'ru',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com',
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

// Trimmed stored values over the defaults; blanks, non-strings and unknown languages fall back.
export function withDefaults(stored) {
  const settings = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const value = stored?.[key];
    if (typeof value === 'string' && value.trim() !== '') settings[key] = value.trim();
  }
  if (!Object.hasOwn(LANGUAGES, settings.targetLang)) settings.targetLang = DEFAULTS.targetLang;
  return settings;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return withDefaults(settings);
}
