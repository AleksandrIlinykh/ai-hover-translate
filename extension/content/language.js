(() => {
  const MIN_CONFIDENCE = 0.8;
  let detector = null;

  // True when the detector is confident the text is already in the target language.
  function isAlreadyIn(results, targetLang) {
    const top = results?.[0];
    return Boolean(top) && top.confidence >= MIN_CONFIDENCE && top.detectedLanguage.split('-')[0] === targetLang;
  }

  // Chrome's on-device language detector, or null while the browser can't run it.
  async function getDetector() {
    if (detector) return detector;
    try {
      if (!globalThis.LanguageDetector || (await LanguageDetector.availability()) === 'unavailable') return null;
      detector = await LanguageDetector.create();
    } catch {
      return null; // e.g. the model is still downloading; try again next time
    }
    return detector;
  }

  // The detector's guesses for the text, best first; null when the browser can't detect languages.
  async function detectLanguage(text) {
    try {
      const active = await getDetector();
      return active ? await active.detect(text) : null;
    } catch {
      return null;
    }
  }

  async function alreadyInLanguage(text, targetLang) {
    return isAlreadyIn(await detectLanguage(text), targetLang);
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { isAlreadyIn, detectLanguage, alreadyInLanguage });
})();
