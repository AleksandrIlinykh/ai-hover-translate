// Chrome's on-device Translator, for the free provider. Used by the content scripts and by the settings page.
(() => {
  const MIN_CONFIDENCE = 0.3;
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });
  const translators = new Map(); // 'en>ru' -> Translator, ready to use

  // The language to translate from: the detector's top guess, as a code the Translator accepts.
  function sourceLanguage(results) {
    const top = results?.[0];
    if (!top || top.detectedLanguage === 'und' || top.confidence < MIN_CONFIDENCE) return null;
    return top.detectedLanguage.startsWith('zh-Hant') ? 'zh-Hant' : top.detectedLanguage.split('-')[0];
  }

  // Translates on this computer. Resolves to { text, source } or { problem, source?, detail? }, where problem is
  // 'unsupported', 'unknown_language', 'unavailable', 'needs_download' or 'failed'. Chrome downloads a model for
  // each pair of languages once, and only right after a click or a key press; onProgress gets its share, 0 to 1.
  async function translateInBrowser(text, targetLang, { sourceLang, onProgress } = {}) {
    if (!globalThis.Translator) return { problem: 'unsupported' };
    let source = sourceLang;
    if (!source) {
      const results = await globalThis.hoverTranslate.detectLanguage?.(text);
      if (!results) return { problem: 'unsupported' };
      source = sourceLanguage(results);
      if (!source) return { problem: 'unknown_language' };
    }
    if (source === targetLang) return { text, source };
    try {
      const key = `${source}>${targetLang}`;
      let translator = translators.get(key);
      if (!translator) {
        const options = { sourceLanguage: source, targetLanguage: targetLang };
        const availability = await Translator.availability(options);
        if (availability === 'unavailable') return { problem: 'unavailable', source };
        if (availability !== 'available' && !navigator.userActivation?.isActive) return { problem: 'needs_download', source };
        translator = await Translator.create({
          ...options,
          monitor(monitor) {
            monitor.addEventListener('downloadprogress', (event) => onProgress?.(event.loaded));
          },
        });
        translators.set(key, translator);
      }
      return { text: await translator.translate(text), source };
    } catch (error) {
      return { problem: 'failed', source, detail: error?.message ?? '' };
    }
  }

  // What to tell the user about a problem, and which button helps: 'download', 'settings' or 'retry'.
  function describeProblem({ problem, source, detail }, targetLang) {
    const pair = () => `${languageNames.of(source)} to ${languageNames.of(targetLang)}`;
    switch (problem) {
      case 'needs_download':
        return { message: `Chrome needs to download its ${pair()} model once.`, action: 'download' };
      case 'unavailable':
        return {
          message: `Chrome cannot translate ${pair()} on this computer. Choose an AI provider in the settings.`,
          action: 'settings',
        };
      case 'unsupported':
        return { message: 'This browser has no built-in translator. Choose an AI provider in the settings.', action: 'settings' };
      case 'unknown_language':
        return { message: 'Could not tell which language this text is in.', action: 'retry' };
      default:
        return { message: `The built-in translator failed${detail ? `: ${detail}` : '.'}`, action: 'retry' };
    }
  }

  function forgetTranslators() {
    translators.clear();
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { sourceLanguage, translateInBrowser, describeProblem, forgetTranslators });
})();
