(() => {
  const MIN_CONFIDENCE = 0.8;
  const REMEMBERED = 100;
  let detector = null;
  const detections = new Map(); // text -> the detector's guesses, for the last texts it looked at

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
    if (detections.has(text)) return detections.get(text);
    try {
      const active = await getDetector();
      if (!active) return null;
      const results = await active.detect(text);
      detections.set(text, results);
      if (detections.size > REMEMBERED) detections.delete(detections.keys().next().value);
      return results;
    } catch {
      return null;
    }
  }

  // What the detector already said about the text, without asking again; null if it has not looked at it.
  function detectedBefore(text) {
    return detections.get(text) ?? null;
  }

  async function alreadyInLanguage(text, targetLang) {
    return isAlreadyIn(await detectLanguage(text), targetLang);
  }

  Object.assign((globalThis.spotslate ??= {}), { isAlreadyIn, detectLanguage, detectedBefore, alreadyInLanguage });
})();
