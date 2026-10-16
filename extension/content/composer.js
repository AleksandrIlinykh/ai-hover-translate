// The compose window: the user writes in their own language and gets a translation into another one to copy.
// Shared by the window at a text field on a page (content/compose-window.js) and the toolbar popup (compose.html).
(() => {
  const TRANSLATE_DELAY_MS = 1000; // after the typing stops
  const SAVE_DELAY_MS = 300;
  const SETUP_CODES = new Set(['no_key', 'no_model', 'no_url', 'no_consent']); // fixed in the settings
  const ACTION_KEYS = { settings: 'openSettings', retry: 'retry', download: 'download' };

  const COMPOSER_CSS = `
    .composer {
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      padding: 10px 12px 12px;
      background: #ffffff;
      color: #1f2328;
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
    }
    .head { display: flex; align-items: center; gap: 6px; min-height: 26px; user-select: none; }
    .pair { font-weight: 600; white-space: nowrap; }
    .target { font: inherit; font-weight: 600; color: inherit; background: transparent; border: 1px solid #d0d7de; border-radius: 6px; padding: 1px 4px; }
    .spacer { flex: 1; }
    .tool {
      flex: none; height: 22px; padding: 0 6px; border: 1px solid transparent; border-radius: 4px;
      background: transparent; color: inherit; font: 15px/20px system-ui, sans-serif; opacity: 0.7; cursor: pointer;
    }
    .tool:hover { opacity: 1; border-color: currentColor; }
    .draft {
      box-sizing: border-box; width: 100%; min-height: 72px; max-height: 40vh; resize: vertical;
      padding: 6px 8px; border: 1px solid #d0d7de; border-radius: 6px;
      background: transparent; color: inherit; font: inherit;
    }
    .draft:focus { outline: 2px solid #1f6feb; outline-offset: -1px; }
    .result { min-height: 48px; max-height: 40vh; overflow-y: auto; padding: 6px 8px; border-radius: 6px; background: #f6f8fa; }
    .translation { white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; }
    .translation:empty::before { content: attr(data-placeholder); opacity: 0.5; }
    .pending { animation: pulse 1s ease-in-out infinite; }
    .composer.is-error .translation { color: #cf222e; }
    .back { margin-top: 6px; font-size: 13px; opacity: 0.75; white-space: pre-wrap; overflow-wrap: anywhere; }
    .back:empty { display: none; }
    .foot { display: flex; align-items: center; gap: 8px; }
    .engine { margin-right: auto; font-size: 12px; opacity: 0.7; }
    .button {
      padding: 3px 10px; border: 1px solid #d0d7de; border-radius: 6px;
      background: transparent; color: inherit; font: inherit; cursor: pointer;
    }
    .button:disabled { opacity: 0.4; cursor: default; }
    .copy { border-color: #1f6feb; background: #1f6feb; color: #ffffff; }
    .action[hidden], .context-toggle[hidden] { display: none; }
    .context-toggle[aria-expanded="true"] { border-color: #1f6feb; }
    .notes { margin-top: 4px; }
    .hint-keys { opacity: 0.7; font-size: 12px; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-color-scheme: dark) {
      .composer { background: #161b22; color: #e6edf3; }
      .target, .draft, .button { border-color: #30363d; }
      .result { background: #0d1117; }
      .composer.is-error .translation { color: #ff7b72; }
    }
  `;

  function element(tag, className, text = '') {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // Through background, which calls the AI provider, as a stream.
  // Resolves to { text }, { error: { message, action, code } }, or { aborted: true }.
  // Messages are worded in `from`, the user's language.
  function translateByApi({ text, from, to, purpose, site, onChunk, signal, ui }) {
    const { t } = globalThis.spotslate;
    return new Promise((resolve) => {
      let port;
      try {
        port = chrome.runtime.connect({ name: 'compose' });
      } catch {
        resolve({ error: { message: t(ui, 'extensionUpdated'), action: null } });
        return;
      }
      let result = '';
      const finish = (value) => {
        port.disconnect();
        resolve(value);
      };
      signal.addEventListener('abort', () => finish({ aborted: true }), { once: true });
      port.onMessage.addListener((message) => {
        if (message.type === 'chunk') {
          result += message.text;
          onChunk(result);
        } else if (message.type === 'done') {
          finish({ text: result });
        } else if (message.type === 'error') {
          const action = SETUP_CODES.has(message.code) ? 'settings' : 'retry';
          finish({ error: { message: message.message, action, code: message.code } });
        }
      });
      port.onDisconnect.addListener(() => {
        resolve({ error: { message: t(ui, 'interrupted'), action: 'retry' } });
      });
      port.postMessage({ text, from, to, purpose, site });
    });
  }

  // With Chrome's translator, right where the window is.
  async function translateInPlace({ text, from, to, onProgress, ui }) {
    const { translateInBrowser, describeProblem } = globalThis.spotslate;
    const result = await translateInBrowser(text, to, { sourceLang: from, onProgress });
    return result.text === undefined ? { error: describeProblem(result, to, ui) } : { text: result.text };
  }

  // Builds the window into `container` (its styles go to `styleRoot`, a shadow root or the document), and the site
  // context panel after it, into `notesContainer`. `from` is the user's own language and `to` the one to write in;
  // `engine` is 'browser' or 'api'. `site` is for the toolbar popup, which is not on the site.
  function createComposer({
    container,
    styleRoot,
    languages,
    from,
    to,
    engine,
    providerName,
    draft = '',
    site = null,
    notesContainer = container,
    showSettings = false,
    showClose = false,
    onTargetChange = () => {},
    onDraftChange = () => {},
    onCopied = () => {},
    onClose = () => {},
    onOpenSettings = () => {},
  }) {
    const { createNotesPanel, NOTES_CSS, t, languageName } = globalThis.spotslate;
    const ui = from; // the window speaks the user's own language
    const say = (key, params) => t(ui, key, params);
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(COMPOSER_CSS);
    const notesSheet = new CSSStyleSheet();
    notesSheet.replaceSync(NOTES_CSS);
    styleRoot.adoptedStyleSheets = [...styleRoot.adoptedStyleSheets, notesSheet, sheet];
    const nameOf = (code) => languageName(code, ui, { capitalized: true });

    const root = element('div', 'composer');
    const head = element('div', 'head');
    const pair = element('span', 'pair', `${nameOf(from)} →`);
    const target = element('select', 'target');
    target.setAttribute('aria-label', say('languageToWrite'));
    for (const code of Object.keys(languages)) {
      if (code !== from) target.add(new Option(nameOf(code), code));
    }
    target.value = to;
    head.append(pair, target, element('span', 'spacer'));
    if (showSettings) {
      const settings = element('button', 'tool settings', '⚙');
      settings.type = 'button';
      settings.title = say('settings');
      settings.setAttribute('aria-label', say('settings'));
      settings.addEventListener('click', () => onOpenSettings());
      head.append(settings);
    }
    if (showClose) {
      const close = element('button', 'tool close', '×');
      close.type = 'button';
      close.setAttribute('aria-label', say('close'));
      close.addEventListener('click', () => closeWindow());
      head.append(close);
    }

    const draftEl = element('textarea', 'draft');
    draftEl.placeholder = say('writePlaceholder');
    draftEl.value = draft;
    draftEl.spellcheck = true;
    const result = element('div', 'result');
    result.setAttribute('aria-live', 'polite');
    const translationEl = element('div', 'translation');
    const backEl = element('div', 'back');
    result.append(translationEl, backEl);

    const foot = element('div', 'foot');
    const contextButton = element('button', 'button context-toggle', say('context'));
    contextButton.type = 'button';
    contextButton.title = say('contextTitle');
    contextButton.setAttribute('aria-expanded', 'false');
    const notesPanel = createNotesPanel({ site, providerName, lang: ui });
    const engineEl = element('span', 'engine');
    const actionButton = element('button', 'button action');
    actionButton.type = 'button';
    actionButton.hidden = true;
    const checkButton = element('button', 'button check', say('check'));
    checkButton.type = 'button';
    checkButton.title = say('checkTitle');
    const copyButton = element('button', 'button copy', say('copy'));
    copyButton.type = 'button';
    copyButton.title = say('copyTitle');
    foot.append(contextButton, engineEl, actionButton, checkButton, copyButton);
    root.append(head, draftEl, result, foot);
    container.append(root);
    notesContainer.append(notesPanel.element);

    let translation = ''; // the finished translation of the current draft
    let shown = ''; // the last finished translation, kept on screen while the next one is on its way
    let pending = null; // the translation in progress: { controller, done: Promise }
    let translateTimer = 0;
    let saveTimer = 0;
    let composing = false; // an IME composition is in progress
    let action = null;

    function showEngine() {
      engineEl.textContent = engine === 'browser' ? say('onDevice') : providerName;
    }

    // The site context belongs to AI providers only.
    function showContext() {
      contextButton.hidden = engine === 'browser';
      if (engine === 'browser') setContextOpen(false);
    }

    function setContextOpen(open) {
      contextButton.setAttribute('aria-expanded', String(open));
      notesPanel.setOpen(open);
    }

    // A translation on its way (`loading`) shows as `text`, the one before, with a pulsing ellipsis after it.
    function showResult(text, { loading = false, error = null } = {}) {
      if (loading) translationEl.replaceChildren(...(text ? [`${text} `] : []), element('span', 'pending', '\u2026'));
      else translationEl.textContent = text;
      root.classList.toggle('is-loading', loading);
      root.classList.toggle('is-error', Boolean(error));
      action = error?.action ?? null;
      actionButton.hidden = !action;
      actionButton.textContent = action ? say(ACTION_KEYS[action]) : '';
      const ready = !loading && !error && Boolean(translation);
      copyButton.disabled = !ready;
      checkButton.disabled = !ready;
    }

    function cancel() {
      clearTimeout(translateTimer);
      translateTimer = 0;
      pending?.controller.abort();
      pending = null;
    }

    function run({ text, from: source, to: destination, purpose, onChunk, signal }) {
      if (engine === 'browser') {
        return translateInPlace({
          text,
          from: source,
          to: destination,
          onProgress: (share) => onChunk(say('downloading', { percent: Math.round(share * 100) }), true),
          ui,
        });
      }
      return translateByApi({
        text,
        from: source,
        to: destination,
        purpose,
        site,
        onChunk,
        signal,
        ui,
      });
    }

    // The draft changed: the translation so far stays with an ellipsis after it until the new one is there, whole.
    function markChanged() {
      cancel();
      backEl.textContent = '';
      translation = '';
      if (draftEl.value.trim()) {
        showResult(shown, { loading: true });
      } else {
        shown = '';
        showResult('');
      }
    }

    // Translates the draft now; resolves when this translation is over (or replaced by a newer one).
    function translateNow() {
      markChanged();
      const text = draftEl.value.trim();
      if (!text) return Promise.resolve();
      const controller = new AbortController();
      const done = run({
        text,
        from,
        to: target.value,
        purpose: 'write',
        signal: controller.signal,
        // Only a download's progress shows; the translation itself shows when it is complete.
        onChunk: (partial, isProgress = false) => {
          if (isProgress && !controller.signal.aborted) showResult(partial, { loading: true });
        },
      }).then((outcome) => {
        if (controller.signal.aborted || outcome.aborted) return;
        pending = null;
        if (outcome.error?.code === 'engine_changed') {
          // The settings switched to Chrome's translator while the window was open.
          engine = 'browser';
          showEngine();
          showContext();
          return translateNow();
        }
        if (outcome.error) {
          showResult(outcome.error.message, { error: outcome.error });
          return;
        }
        translation = outcome.text.trim();
        shown = translation;
        showResult(translation);
      });
      pending = { controller, done };
      return done;
    }

    function scheduleTranslation() {
      clearTimeout(translateTimer);
      translateTimer = setTimeout(translateNow, TRANSLATE_DELAY_MS);
    }

    function saveDraft() {
      clearTimeout(saveTimer);
      saveTimer = 0;
      onDraftChange(draftEl.value);
    }

    function scheduleSave() {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveDraft, SAVE_DELAY_MS);
    }

    async function writeClipboard(text) {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // The async clipboard needs a secure, focused page; the old command works everywhere else.
        const area = document.createElement('textarea');
        area.value = text;
        container.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
    }

    // Copies the translation of the draft as it is now, waiting for it if it is still on its way.
    async function copy() {
      if (translateTimer) translateNow();
      if (pending) await pending.done;
      if (!translation) return;
      await writeClipboard(translation);
      draftEl.value = '';
      saveDraft();
      destroy();
      onCopied(translation);
    }

    async function check() {
      if (!translation) return;
      const original = translation;
      backEl.textContent = say('checking');
      const outcome = await run({
        text: original,
        from: target.value,
        to: from,
        purpose: 'check',
        signal: new AbortController().signal,
        onChunk: () => {},
      });
      if (translation !== original) return; // the draft changed meanwhile
      backEl.textContent = outcome.error ? outcome.error.message : say('back', { text: outcome.text.trim() });
    }

    function closeWindow() {
      saveDraft();
      destroy();
      onClose();
    }

    function destroy() {
      cancel();
      clearTimeout(saveTimer);
      notesPanel.destroy();
    }

    draftEl.addEventListener('input', () => {
      scheduleSave();
      markChanged();
      if (!composing) scheduleTranslation();
    });
    draftEl.addEventListener('compositionstart', () => {
      composing = true;
      clearTimeout(translateTimer);
    });
    draftEl.addEventListener('compositionend', () => {
      composing = false;
      scheduleTranslation();
    });
    root.addEventListener('keydown', (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        copy();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeWindow();
      }
    });
    target.addEventListener('change', () => {
      onTargetChange(target.value);
      shown = ''; // it is in the language before
      translateNow();
    });
    contextButton.addEventListener('click', () => setContextOpen(!notesPanel.isOpen()));
    actionButton.addEventListener('click', () => {
      if (action === 'settings') onOpenSettings();
      else translateNow(); // a retry; for a download, this click lets Chrome fetch the model
    });
    checkButton.addEventListener('click', () => check());
    copyButton.addEventListener('click', () => copy());

    showEngine();
    showContext();
    translationEl.dataset.placeholder = say('translationPlaceholder');
    showResult('');
    if (draftEl.value.trim()) translateNow();

    return {
      element: root,
      focus() {
        draftEl.focus();
        draftEl.setSelectionRange(draftEl.value.length, draftEl.value.length);
      },
      close: closeWindow,
      destroy,
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createComposer });
})();
