(() => {
  const {
    elementAt,
    inspectBlock,
    isOverText,
    writableField,
    selectionAt,
    isShortPhrase,
    contextOf,
    blockTextOf,
    alreadyInLanguage,
    detectLanguage,
    detectedBefore,
    languageCode,
    sourceLanguage,
    translateInBrowser,
    prepareInBrowser,
    describeProblem,
    createPopup,
    createHighlight,
    createComposeWindow,
    createHero,
    heroes,
  } = globalThis.paragloss;

  const TRIGGER_DELAY_MS = 200;
  const LEAVE_GRACE_MS = 300;
  const CACHE_LIMIT = 100;
  const DETECT_TIMEOUT_MS = 300;
  const PAGE_SAMPLE_CHARS = 1000;
  const DEFAULT_LANG = 'ru'; // DEFAULTS.targetLang in lib/settings.js
  const SETUP_CODES = new Set(['no_key', 'no_model', 'no_url']); // setupProblem() in lib/providers.js: fixed in the settings
  const HINTS = {
    editable: 'Input fields are not translated.',
    'too-long': 'Too much text. Select the part you need.',
    'too-long-selection': 'Too much text. Select a shorter part.',
  };
  const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

  const cache = new Map(); // [mode, text, context] -> translation, for this page
  const sameLanguage = new Map(); // text -> whether it is already in the target language
  const popup = createPopup({
    onOpenSettings: () => chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
    onRetry: () => retry(),
    onDownload: () => retry(), // the click lets Chrome download the model
    onClose: () => closePopup(),
  });
  const highlight = createHighlight();
  const composeWindow = createComposeWindow();
  const hero = createHero(heroes.pup, heroSpot);

  let mouseX = null;
  let mouseY = null;
  let readDown = false;
  let combo = false;
  let usedReadKey = false;
  let triggerTimer = 0;
  let leaveTimer = 0;
  let previewFrame = 0;
  let triggerTicket = 0;
  let port = null;
  let shown = null; // { text, mode, context } of the open popup: what was sent to background
  let sample = ''; // text to tell the language of the open popup's text by, for Chrome's translator
  let targetLang = DEFAULT_LANG;
  let engine = 'api'; // 'api' (background calls an AI provider) or 'browser' (Chrome's translator, on this page)
  let localTicket = 0; // the on-page translation in progress; a new translation or a close makes it stale
  let modelAsked = false; // whether this page has asked Chrome to get its translation model ready
  // The key held to read ('Alt' or 'Control') with its name on this platform, and the shortcut to write
  // (see lib/keys.js); background sends the ones in the settings.
  let keys = { read: 'Alt', readName: 'Alt', write: { ctrl: false, alt: true, shift: false, meta: false, code: 'KeyT' } };

  // The settings hold API keys, so pages get only the target language, the engine and the keys, from background.
  chrome.runtime
    .sendMessage({ type: 'page-settings' })
    .then((answer) => {
      targetLang = answer?.targetLang || DEFAULT_LANG;
      engine = answer?.engine || 'api';
      keys = answer?.keys ?? keys;
      popup.setContext(engine === 'api', answer?.providerName);
    })
    .catch(() => {});

  // What the read key would act on under the mouse: undefined over our own popup, null over nothing to read,
  // otherwise { target, text } or { target, reason } (target is a block element or a selection Range).
  function pickUnderMouse() {
    const element = elementAt(mouseX, mouseY);
    if (element && (popup.isOwn(element) || composeWindow.isOwn(element))) return undefined;
    const picked = selectionAt(mouseX, mouseY) ?? (element ? inspectBlock(element) : null);
    // Over a huge block's padding or margins rather than its text there is nothing to point at.
    if (picked?.reason === 'too-long' && !picked.selection && !isOverText(mouseX, mouseY)) return null;
    return picked;
  }

  // Where the companion is: by the mouse while the read key is held, then on the popup's edge until it closes. It dances
  // until there is a translation to look at.
  function heroSpot() {
    const mood = popup.isOpen() && !popup.isLoading() ? 'idle' : 'dance';
    if (readDown && !combo && mouseX !== null) return { mouse: { x: mouseX, y: mouseY }, mood };
    if (popup.isOpen()) return { perch: popup.getRect(), mood };
    return null;
  }

  function hintFor(picked) {
    if (picked.reason === 'too-long') return HINTS[picked.selection ? 'too-long-selection' : 'too-long'];
    if (picked.reason === 'editable' && writableField(picked.target)) return `${keys.readName}+click: write in ${languageNames.of(targetLang)}.`;
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
    if (!readDown || combo || mouseX === null) return;
    const picked = pickUnderMouse();
    if (!picked || picked.reason || sameTarget(picked.target, popup.getBlock())) return;
    usedReadKey = true;
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
    if (!readDown || combo || mouseX === null) {
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
    const mode = picked.selection && isShortPhrase(picked.text) ? 'dictionary' : 'text';
    shown = { text: picked.text, mode, context: mode === 'dictionary' ? contextOf(picked.target) : '' };
    // Chrome's translator needs the source language: a few selected words tell too little, their paragraph more.
    sample = (picked.selection && blockTextOf(picked.target)) || picked.text;
    popup.open(picked.target);
    hero.wake();
    load();
  }

  // Shows the translation of the open popup's text: cached or from the API.
  function load() {
    const cached = cache.get(cacheKey(shown));
    if (cached === undefined) translate(shown);
    else popup.setText(cached);
  }

  function retry() {
    if (!shown || !popup.isOpen()) return;
    popup.setLoading();
    translate(shown);
  }

  function cacheKey({ mode, text, context }) {
    return JSON.stringify([mode, text, context]);
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
    const { text, mode, context } = request;
    // The passage's language, if the detector has looked at it, for the memory of what was read on the site.
    const lang = sourceLanguage(detectedBefore(text));
    current.postMessage({ text, mode, context, lang });
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
    // Only the language is counted, for the compose window; Chrome's translator builds no site context.
    if (request.mode === 'text') chrome.runtime.sendMessage({ type: 'read-lang', lang: result.source }).catch(() => {});
  }

  // The compose window at a field or by the mouse (`anchor`, see createComposeWindow): what to write is translated into
  // the page's language, to copy.
  async function openCompose(anchor) {
    let state = null;
    try {
      state = await chrome.runtime.sendMessage({ type: 'compose-open', pageLang: languageCode(document.documentElement.lang) });
    } catch {
      return; // the extension was updated; the page needs a reload
    }
    if (!state) return;
    composeWindow.open(anchor, {
      ...state,
      onTargetChange: (lang) => chrome.runtime.sendMessage({ type: 'compose-target', lang }).catch(() => {}),
      onDraftChange: (draft) => chrome.runtime.sendMessage({ type: 'compose-draft', draft }).catch(() => {}),
      onOpenSettings: () => chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
    });
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

  // The shortcut to write, Alt+T unless the settings say otherwise. Its key is the physical one, so it works in any
  // keyboard layout.
  function isWriteKey(event) {
    const { write } = keys;
    return (
      event.isTrusted &&
      event.code === write.code &&
      event.ctrlKey === write.ctrl &&
      event.altKey === write.alt &&
      event.shiftKey === write.shift &&
      event.metaKey === write.meta
    );
  }

  // Whether the key held to read is down during `event`, and whether another modifier is.
  const readHeld = (event) => (keys.read === 'Control' ? event.ctrlKey : event.altKey);
  const otherModifiers = (event) => event.shiftKey || event.metaKey || (keys.read === 'Control' ? event.altKey : event.ctrlKey);

  function focusedElement() {
    let element = document.activeElement;
    while (element?.shadowRoot?.activeElement) element = element.shadowRoot.activeElement;
    return element;
  }

  // The compose window at the field being typed in, else at the field under the mouse, else by the mouse;
  // or, when it is open, closed.
  function toggleCompose() {
    if (composeWindow.isOpen()) {
      composeWindow.dismiss();
      return;
    }
    const focused = focusedElement();
    const field = writableField(focused) ?? (mouseX === null ? null : writableField(elementAt(mouseX, mouseY)));
    highlight.hide();
    closePopup();
    if (field) openCompose({ field });
    else openCompose({ point: mouseX === null ? null : { x: mouseX, y: mouseY }, returnTo: focused });
  }

  function releaseReadKey() {
    readDown = false;
    clearTimeout(triggerTimer);
    highlight.hide();
  }

  addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (readDown && !readHeld(event)) releaseReadKey(); // keyup happened outside the page
      if (readDown && !combo) {
        scheduleTrigger();
        schedulePreview();
        hero.wake();
      }
      if (event.buttons === 0) checkLeave(); // a drag, e.g. selecting popup text, never closes it
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === keys.read) {
        if (event.repeat) return;
        readDown = true;
        // Another modifier already held (Ctrl+Alt+…, the Alt+Shift layout switch) is not a translation request.
        combo = otherModifiers(event);
        usedReadKey = false;
        if (!combo) {
          scheduleTrigger();
          updatePreview();
          hero.wake();
        }
        return;
      }
      if (readDown) {
        combo = true; // Alt+Tab, Alt+←, … are not translation requests
        clearTimeout(triggerTimer);
        highlight.hide();
      }
      if (isWriteKey(event)) {
        event.preventDefault(); // the page hears neither the T nor the letter it types
        event.stopImmediatePropagation();
        usedReadKey = true;
        if (!event.repeat) toggleCompose();
        return;
      }
      if (event.key === 'Escape' && popup.isOpen()) closePopup();
    },
    true,
  );

  addEventListener(
    'keyup',
    (event) => {
      if (event.key !== keys.read) return;
      releaseReadKey();
      if (usedReadKey) {
        usedReadKey = false;
        event.preventDefault(); // stop Chrome on Windows from focusing its "⋮" menu
      }
    },
    true,
  );

  addEventListener('blur', releaseReadKey);

  addEventListener(
    'scroll',
    () => {
      if (popup.isOpen()) popup.follow();
      if (readDown && !combo) schedulePreview();
    },
    { capture: true, passive: true },
  );

  addEventListener('resize', () => {
    if (!popup.isOpen()) return;
    if (popup.isDetached()) popup.keepInView();
    else closePopup();
  });

  // A click with the read key held (Alt+click) on a field where one writes opens the compose window there.
  addEventListener(
    'click',
    (event) => {
      if (!readHeld(event) || otherModifiers(event) || !event.isTrusted) return;
      const target = event.composedPath()[0];
      if (popup.isOwn(target) || composeWindow.isOwn(target)) return;
      const field = writableField(target);
      if (!field) return;
      usedReadKey = true; // releasing Alt must not focus Chrome's menu
      highlight.hide();
      closePopup();
      openCompose({ field });
    },
    true,
  );

  addEventListener('pointerdown', prepareModel, true);
  addEventListener('keydown', prepareModel, true);

  addEventListener(
    'mousedown',
    (event) => {
      if (popup.isOpen() && !popup.isPinned() && !popup.isOwn(event.target)) closePopup();
    },
    true,
  );

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'compose-context') {
      // The toolbar popup asks for the page's declared language.
      sendResponse({ pageLang: languageCode(document.documentElement.lang) });
      return;
    }
    if (message?.type !== 'settings-changed') return;
    cache.clear();
    sameLanguage.clear();
    targetLang = message.targetLang || DEFAULT_LANG;
    engine = message.engine || 'api';
    keys = message.keys ?? keys;
    popup.setContext(engine === 'api', message.providerName);
    modelAsked = false;
  });
})();
