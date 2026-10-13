(() => {
  const {
    elementAt,
    inspectBlock,
    isOverText,
    selectionAt,
    isShortPhrase,
    contextOf,
    blockTextOf,
    alreadyInLanguage,
    detectLanguage,
    languageCode,
    sourceLanguage,
    translateInBrowser,
    prepareInBrowser,
    describeProblem,
    createPopup,
    createHighlight,
  } = globalThis.hoverTranslate;

  const TRIGGER_DELAY_MS = 200;
  const LEAVE_GRACE_MS = 300;
  const CACHE_LIMIT = 100;
  const DETECT_TIMEOUT_MS = 300;
  const TOPIC_MIN_CHARS = 400;
  const PAGE_SAMPLE_CHARS = 1000;
  const DEFAULT_LANG = 'ru'; // DEFAULTS.targetLang in lib/settings.js
  const SETUP_CODES = new Set(['no_key', 'no_model', 'no_url']); // setupProblem() in lib/providers.js: fixed in the settings
  const HINTS = {
    editable: 'Input fields are not translated.',
    'too-long': 'Too much text. Select the part you need.',
    'too-long-selection': 'Too much text. Select a shorter part.',
  };
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

  const cache = new Map(); // [mode, text, context, topics] -> translation, for this page
  const sameLanguage = new Map(); // text -> whether it is already in the target language
  const popup = createPopup({
    onOpenSettings: () => chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
    onRetry: () => retry(),
    onDownload: () => retry(), // the click lets Chrome download the model
    onClose: () => closePopup(),
    onDropTopics: () => dropTopics(),
  });
  const highlight = createHighlight();

  let mouseX = null;
  let mouseY = null;
  let altDown = false;
  let combo = false;
  let usedAlt = false;
  let triggerTimer = 0;
  let leaveTimer = 0;
  let previewFrame = 0;
  let triggerTicket = 0;
  let port = null;
  let shown = null; // { text, mode, context, topics } of the open popup: what was sent to background
  let sample = ''; // text to tell the language of the open popup's text by, for Chrome's translator
  let targetLang = DEFAULT_LANG;
  let engine = 'api'; // 'api' (background calls an AI provider) or 'browser' (Chrome's translator, on this page)
  let localTicket = 0; // the on-page translation in progress; a new translation or a close makes it stale
  let modelAsked = false; // whether this page has asked Chrome to get its translation model ready
  let topics = []; // tags of the page topic from DeepSeek, sent with every translation on this page
  let topicState = 'unknown'; // 'unknown', 'asking', 'known', or 'dropped' by the user
  let pageAddress = currentAddress();

  // The settings hold API keys, so pages get only the target language, from background.
  chrome.runtime
    .sendMessage({ type: 'page-settings' })
    .then((answer) => {
      targetLang = answer?.targetLang || DEFAULT_LANG;
      engine = answer?.engine || 'api';
    })
    .catch(() => {});

  // What Alt would act on under the mouse: undefined over our own popup, null over nothing to read,
  // otherwise { target, text } or { target, reason } (target is a block element or a selection Range).
  function pickUnderMouse() {
    const element = elementAt(mouseX, mouseY);
    if (element && popup.isOwn(element)) return undefined;
    const picked = selectionAt(mouseX, mouseY) ?? (element ? inspectBlock(element) : null);
    // Over a huge block's padding or margins rather than its text there is nothing to point at.
    if (picked?.reason === 'too-long' && !picked.selection && !isOverText(mouseX, mouseY)) return null;
    return picked;
  }

  function hintFor(picked) {
    if (picked.reason === 'too-long') return HINTS[picked.selection ? 'too-long-selection' : 'too-long'];
    if (picked.reason) return HINTS[picked.reason];
    if (sameLanguage.get(picked.text)) return `Already in ${languageNames.of(targetLang)}.`;
    return '';
  }

  // The same block, or the same selected range.
  function sameTarget(a, b) {
    if (a === b) return true;
    if (!(a instanceof Range) || !(b instanceof Range)) return false;
    try {
      return a.compareBoundaryPoints(Range.START_TO_START, b) === 0 && a.compareBoundaryPoints(Range.END_TO_END, b) === 0;
    } catch {
      return false;
    }
  }

  async function trigger() {
    if (!altDown || combo || mouseX === null) return;
    const picked = pickUnderMouse();
    if (!picked || picked.reason || sameTarget(picked.target, popup.getBlock())) return;
    usedAlt = true;
    const ticket = ++triggerTicket;
    const skip = await isAlreadyInTargetLanguage(picked.text);
    if (ticket !== triggerTicket) return; // the mouse has moved on to something else
    if (skip) updatePreview();
    else show(picked);
  }

  // Asks Chrome's on-device detector; a slow or missing detector never holds up a translation.
  async function isAlreadyInTargetLanguage(text) {
    if (sameLanguage.has(text)) return sameLanguage.get(text);
    const verdict = await Promise.race([
      alreadyInLanguage(text, targetLang),
      new Promise((resolve) => setTimeout(resolve, DETECT_TIMEOUT_MS)),
    ]);
    if (verdict === undefined) return false;
    remember(sameLanguage, text, verdict);
    return verdict;
  }

  // Outline what Alt + hover would translate, before the trigger delay runs out.
  function updatePreview() {
    if (!altDown || combo || mouseX === null) {
      highlight.hide();
      return;
    }
    const picked = pickUnderMouse();
    if (picked === undefined) return; // over the popup: keep the current outline
    if (!picked) {
      highlight.hide();
      return;
    }
    const hint = hintFor(picked);
    highlight.show(picked.target, { muted: Boolean(hint), hint });
  }

  function schedulePreview() {
    if (previewFrame) return;
    previewFrame = requestAnimationFrame(() => {
      previewFrame = 0;
      updatePreview();
    });
  }

  function show(picked) {
    closePopup();
    syncAddress();
    const mode = picked.selection && isShortPhrase(picked.text) ? 'dictionary' : 'text';
    shown = { text: picked.text, mode, context: mode === 'dictionary' ? contextOf(picked.target) : '' };
    // Chrome's translator needs the source language: a few selected words tell too little, their paragraph more.
    sample = (picked.selection && blockTextOf(picked.target)) || picked.text;
    popup.open(picked.target);
    load();
    if (mode === 'text') askForTopics(picked.text);
  }

  // Shows the translation of the open popup's text with the current page topic: cached or from the API.
  function load() {
    shown.topics = topics;
    popup.setTopics(topics);
    const cached = cache.get(cacheKey(shown));
    if (cached === undefined) translate(shown);
    else popup.setText(cached);
  }

  function retry() {
    if (!shown || !popup.isOpen()) return;
    popup.setLoading();
    translate(shown);
  }

  // Where the page is, without the hash: single-page apps change it without reloading.
  function currentAddress() {
    return location.origin + location.pathname + location.search;
  }

  function forgetTopics(state = 'unknown') {
    topics = [];
    topicState = state;
  }

  // Another page of a single-page app gets its own topic.
  function syncAddress() {
    const address = currentAddress();
    if (address === pageAddress) return;
    pageAddress = address;
    forgetTopics();
  }

  // Asks DeepSeek once per page for the topic of its first long text; the translations after it carry the topic.
  async function askForTopics(text) {
    if (engine !== 'api' || topicState !== 'unknown' || text.length < TOPIC_MIN_CHARS) return;
    topicState = 'asking';
    const address = pageAddress;
    let reply = null;
    try {
      reply = await chrome.runtime.sendMessage({ type: 'topics', text });
    } catch {
      // e.g. the extension was updated; the next long text asks again
    }
    if (address !== pageAddress || topicState !== 'asking') return;
    topics = Array.isArray(reply?.topics) ? reply.topics : [];
    topicState = topics.length > 0 ? 'known' : 'unknown';
  }

  // The user says the tags are wrong: translate again without them and ask for none until the page changes.
  function dropTopics() {
    forgetTopics('dropped');
    if (!shown || !popup.isOpen()) return;
    disconnect();
    popup.setLoading();
    load();
  }

  function cacheKey({ mode, text, context, topics: tags }) {
    return JSON.stringify([mode, text, context, tags]);
  }

  function translate(request) {
    if (engine === 'browser') {
      translateHere(request);
      return;
    }
    let current;
    try {
      current = chrome.runtime.connect({ name: 'translate' });
    } catch {
      popup.setError('The extension was updated. Reload the page.');
      return;
    }
    port = current;
    let result = '';
    current.onMessage.addListener((message) => {
      if (port !== current) return;
      if (message.type === 'chunk') {
        result += message.text;
        popup.setText(result);
      } else if (message.type === 'done') {
        remember(cache, cacheKey(request), result);
        disconnect();
      } else if (message.type === 'error') {
        if (message.code === 'engine_changed') engine = 'browser';
        popup.setError(message.message, { action: SETUP_CODES.has(message.code) ? 'settings' : 'retry' });
        disconnect();
      }
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return; // we disconnected on purpose
      port = null;
      popup.setError('The translation was interrupted. Try again.', { action: 'retry' });
    });
    const { text, mode, context, topics: tags } = request;
    current.postMessage({ text, mode, context, topics: tags });
  }

  // The free engine: Chrome's translator runs right here, and nothing leaves the page.
  async function translateHere(request) {
    const ticket = ++localTicket;
    const showProgress = (share) => {
      if (ticket === localTicket) popup.setLoading(`Downloading the translation model: ${Math.round(share * 100)}%`);
    };
    const result = await translateInBrowser(request.text, targetLang, {
      sample,
      fallbackLang: document.documentElement.lang,
      onProgress: showProgress,
    });
    if (ticket !== localTicket) return;
    localTicket++;
    if (result.text === undefined) {
      const { message, action } = describeProblem(result, targetLang);
      popup.setError(message, { action });
      return;
    }
    popup.setText(result.text);
    remember(cache, cacheKey(request), result.text);
  }

  // With the free translator, the first click or key press on a page in another language gets its model ready,
  // since Chrome downloads a model only right after one (Alt does not count). By the time Alt is held it usually is.
  function prepareModel(event) {
    if (modelAsked || engine !== 'browser' || !event.isTrusted) return;
    setTimeout(async () => {
      if (modelAsked || !navigator.userActivation?.isActive) return;
      modelAsked = true;
      try {
        await prepareInBrowser(await pageLanguage(), targetLang);
      } catch {
        // the popup reports problems when Alt is held
      }
    });
  }

  // The page's language: what its <html lang> says, or else what Chrome detects in the start of its text.
  async function pageLanguage() {
    const declared = languageCode(document.documentElement.lang);
    if (declared) return declared;
    return sourceLanguage(await detectLanguage(document.body?.innerText.slice(0, PAGE_SAMPLE_CHARS) ?? ''));
  }

  function disconnect() {
    localTicket++;
    const current = port;
    port = null;
    current?.disconnect();
  }

  function remember(map, key, value) {
    map.delete(key);
    map.set(key, value);
    if (map.size > CACHE_LIMIT) map.delete(map.keys().next().value);
  }

  function closePopup() {
    disconnect();
    clearTimeout(leaveTimer);
    leaveTimer = 0;
    popup.close();
  }

  function isInside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function checkLeave() {
    if (!popup.isOpen() || popup.isPinned()) return;
    const inside =
      isInside(popup.getBlock().getBoundingClientRect(), mouseX, mouseY) || isInside(popup.getRect(), mouseX, mouseY);
    if (inside) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    } else if (!leaveTimer) {
      leaveTimer = setTimeout(closePopup, LEAVE_GRACE_MS);
    }
  }

  function scheduleTrigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(trigger, TRIGGER_DELAY_MS);
  }

  function releaseAlt() {
    altDown = false;
    clearTimeout(triggerTimer);
    highlight.hide();
  }

  addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (altDown && !event.altKey) releaseAlt(); // keyup happened outside the page
      if (altDown && !combo) {
        scheduleTrigger();
        schedulePreview();
      }
      if (event.buttons === 0) checkLeave(); // a drag, e.g. selecting popup text, never closes it
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt') {
        if (event.repeat) return;
        altDown = true;
        // Ctrl/Shift/Meta already held (Ctrl+Alt+…, the Alt+Shift layout switch) is not a translation request.
        combo = event.ctrlKey || event.shiftKey || event.metaKey;
        usedAlt = false;
        if (!combo) {
          scheduleTrigger();
          updatePreview();
        }
        return;
      }
      if (altDown) {
        combo = true; // Alt+Tab, Alt+←, … are not translation requests
        clearTimeout(triggerTimer);
        highlight.hide();
      }
      if (event.key === 'Escape' && popup.isOpen()) closePopup();
    },
    true,
  );

  addEventListener(
    'keyup',
    (event) => {
      if (event.key !== 'Alt') return;
      releaseAlt();
      if (usedAlt) {
        usedAlt = false;
        event.preventDefault(); // stop Chrome on Windows from focusing its "⋮" menu
      }
    },
    true,
  );

  addEventListener('blur', releaseAlt);

  addEventListener(
    'scroll',
    () => {
      if (popup.isOpen()) popup.follow();
      if (altDown && !combo) schedulePreview();
    },
    { capture: true, passive: true },
  );

  addEventListener('resize', () => {
    if (!popup.isOpen()) return;
    if (popup.isDetached()) popup.keepInView();
    else closePopup();
  });

  addEventListener('pointerdown', prepareModel, true);
  addEventListener('keydown', prepareModel, true);

  addEventListener(
    'mousedown',
    (event) => {
      if (popup.isOpen() && !popup.isPinned() && !popup.isOwn(event.target)) closePopup();
    },
    true,
  );

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type !== 'settings-changed') return;
    cache.clear();
    sameLanguage.clear();
    forgetTopics();
    targetLang = message.targetLang || DEFAULT_LANG;
    engine = message.engine || 'api';
    modelAsked = false;
  });
})();
