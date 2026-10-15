// Chrome's on-device Translator, for the free provider. Used by the content scripts and by the settings page.
(() => {
  const MIN_CONFIDENCE = 0.3;
  const TRADITIONAL_CHINESE = /^zh-(hant|tw|hk|mo)\b/i;
  // 'en>ru' -> { ready: Promise of a translator, share: last download progress, listeners: progress callbacks }.
  // A download started ahead of time is shared with the translations that come while it runs.
  const pairs = new Map();

  // A language tag (from <html lang> or the detector) as a code the Translator accepts; null for none.
  function languageCode(tag) {
    if (typeof tag !== 'string' || tag === '' || tag.toLowerCase() === 'und') return null;
    return TRADITIONAL_CHINESE.test(tag) ? 'zh-Hant' : tag.split('-')[0].toLowerCase();
  }

  // The language to translate from: the detector's top guess, when it is confident enough.
  function sourceLanguage(results) {
    const top = results?.[0];
    return top && top.confidence >= MIN_CONFIDENCE ? languageCode(top.detectedLanguage) : null;
  }

  function startPair(key, options) {
    const pair = { share: undefined, listeners: new Set() };
    pair.ready = Translator.create({
      ...options,
      monitor(monitor) {
        monitor.addEventListener('downloadprogress', (event) => {
          pair.share = event.loaded;
          for (const listener of pair.listeners) listener(event.loaded);
        });
      },
    });
    pair.ready.catch(() => pairs.delete(key)); // a failed download can be started again
    pairs.set(key, pair);
    return pair;
  }

  // The pair's translator: one already made or being made, or a new one. Chrome downloads a model once for each
  // pair of languages, and only right after a click or a key press. Resolves to { translator } or { problem }.
  async function pairFor(source, target, onProgress) {
    const key = `${source}>${target}`;
    let pair = pairs.get(key);
    if (!pair) {
      const options = { sourceLanguage: source, targetLanguage: target };
      const availability = await Translator.availability(options);
      if (availability === 'unavailable') return { problem: 'unavailable' };
      if (availability !== 'available' && !navigator.userActivation?.isActive) return { problem: 'needs_download' };
      pair = pairs.get(key) ?? startPair(key, options);
    }
    if (onProgress) {
      if (pair.share !== undefined) onProgress(pair.share);
      pair.listeners.add(onProgress);
    }
    try {
      return { translator: await pair.ready };
    } finally {
      pair.listeners.delete(onProgress);
    }
  }

  // Translates on this computer. The source language is detected on `sample` (the text itself by default, the
  // paragraph around a selection) or else taken from `fallbackLang` (the page's). onProgress gets the share of a
  // model download, 0 to 1. Resolves to { text, source } or { problem, source?, detail? }, where problem is
  // 'unsupported', 'unknown_language', 'unavailable', 'needs_download' or 'failed'.
  async function translateInBrowser(text, targetLang, { sourceLang, sample = text, fallbackLang, onProgress } = {}) {
    if (!globalThis.Translator) return { problem: 'unsupported' };
    let source = sourceLang;
    if (!source) {
      const results = await globalThis.paragloss.detectLanguage?.(sample);
      if (!results && !fallbackLang) return { problem: 'unsupported' };
      source = sourceLanguage(results) ?? languageCode(fallbackLang);
      if (!source) return { problem: 'unknown_language' };
    }
    if (source === targetLang) return { text, source };
    try {
      const { translator, problem } = await pairFor(source, targetLang, onProgress);
      if (problem) return { problem, source };
      return { text: await translator.translate(text), source };
    } catch (error) {
      return { problem: 'failed', source, detail: error?.message ?? '' };
    }
  }

  // Gets a pair ready ahead of time, so that its first translation is instant. Resolves to null when it is ready
  // (or there is nothing to translate), else to the problem, as translateInBrowser names them.
  async function prepareInBrowser(source, targetLang, { onProgress } = {}) {
    if (!source || source === targetLang) return null;
    if (!globalThis.Translator) return 'unsupported';
    try {
      return (await pairFor(source, targetLang, onProgress)).problem ?? null;
    } catch {
      return 'failed';
    }
  }

  // What to tell the user about a problem, and which button helps: 'download', 'settings' or 'retry'.
  // What went wrong with Chrome's translator into `targetLang`, worded in `ui` (the language the user translates into on
  // pages, English on the settings page), and the button that helps.
  function describeProblem({ problem, source, detail }, targetLang, ui = targetLang) {
    const { t, languageName } = globalThis.paragloss;
    const pair = () => `${languageName(source, ui)} \u2192 ${languageName(targetLang, ui)}`;
    switch (problem) {
      case 'needs_download':
        return { message: t(ui, 'needsDownload', { pair: pair() }), action: 'download' };
      case 'unavailable':
        return { message: t(ui, 'unavailable', { pair: pair() }), action: 'settings' };
      case 'unsupported':
        return { message: t(ui, 'unsupported'), action: 'settings' };
      case 'unknown_language':
        return { message: t(ui, 'unknownLanguage'), action: 'retry' };
      default:
        return { message: detail ? t(ui, 'builtInFailedDetail', { detail }) : t(ui, 'builtInFailed'), action: 'retry' };
    }
  }


  function forgetTranslators() {
    pairs.clear();
  }

  Object.assign((globalThis.paragloss ??= {}), {
    languageCode,
    sourceLanguage,
    translateInBrowser,
    prepareInBrowser,
    describeProblem,
    forgetTranslators,
  });
})();
