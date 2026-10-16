(() => {
  const ROOT_ID = 'spotslate-root';
  const GAP = 6;
  const MARGIN = 8;
  const SHIFT_X = 32;
  const MIN_SPACE_ABOVE = 120;
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 720;
  const MIN_HEIGHT = 80;
  const TALL_BLOCK = 240;
  const COPIED_MS = 1200;
  const MIN_RESIZE_WIDTH = 240;
  const MIN_RESIZE_HEIGHT = 120;
  const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

  // Inline !important beats any page rule, including `div { display: none !important }`.
  const HOST_STYLE = ['all: initial', 'position: absolute', 'top: 0', 'left: 0', 'display: block', 'z-index: 2147483647']
    .map((rule) => `${rule} !important`)
    .join('; ');

  const POPUP_CSS = `
    .popup {
      position: relative;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      background: #ffffff;
      color: #1f2328;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      cursor: auto;
    }
    .popup.is-pinned { border-color: #1f6feb; }
    .bar, .foot {
      flex: none;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 2px;
      height: 24px;
      padding: 0 10px 0 6px;
      border-bottom: 1px solid #d8dee4;
      background: #f6f8fa;
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    .popup.is-dragging .bar { cursor: grabbing; }
    .foot { justify-content: flex-start; border-top: 1px solid #d8dee4; border-bottom: none; cursor: auto; }
    .foot[hidden] { display: none; }
    .context-toggle[aria-expanded="true"] { opacity: 1; }
    .notes-slot { position: absolute; top: calc(100% + 4px); left: 0; right: 0; }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 12px 10px;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
    }
    .popup.is-loading .text { animation: pulse 1s ease-in-out infinite; }
    .popup.is-error .text { color: #cf222e; }
    .tool {
      height: 20px;
      padding: 0 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: 12px/18px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      opacity: 0.7;
      cursor: pointer;
    }
    .tool:hover { opacity: 1; border-color: currentColor; }
    .close { font-size: 15px; }
    .copy { visibility: hidden; }
    .popup.has-text .copy { visibility: visible; }
    .action {
      display: none;
      margin-top: 8px;
      padding: 4px 10px;
      border: 1px solid currentColor;
      border-radius: 6px;
      background: transparent;
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .popup.has-settings .settings, .popup.has-retry .retry, .popup.has-download .download { display: block; }
    .resize { position: absolute; z-index: 1; touch-action: none; }
    .resize.n, .resize.s { left: 10px; right: 10px; height: 5px; cursor: ns-resize; }
    .resize.e, .resize.w { top: 10px; bottom: 10px; width: 5px; cursor: ew-resize; }
    .resize.n { top: 0; }
    .resize.s { bottom: 0; }
    .resize.e { right: 0; }
    .resize.w { left: 0; }
    .resize.ne, .resize.nw, .resize.sw { width: 10px; height: 10px; }
    .resize.ne { top: 0; right: 0; cursor: nesw-resize; }
    .resize.sw { bottom: 0; left: 0; cursor: nesw-resize; }
    .resize.nw { top: 0; left: 0; cursor: nwse-resize; }
    .resize.se {
      right: 0;
      bottom: 0;
      width: 14px;
      height: 14px;
      cursor: nwse-resize;
      opacity: 0.4;
      background: linear-gradient(135deg, transparent 0 50%, currentColor 50% 58%, transparent 58% 68%, currentColor 68% 76%, transparent 76%);
    }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-color-scheme: dark) {
      .popup { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .bar, .foot { border-color: #30363d; background: #0d1117; }
      .popup.is-error .text { color: #ff7b72; }
    }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  // Translation popup with a small title bar. Clicking it pins it; dragging the bar or resizing it by
  // an edge or corner pins it and detaches it from the block, so it stays put on screen while the page scrolls.
  // With an AI provider a footer row has the Context button, which opens the site context panel under the popup.
  function createPopup({ onOpenSettings, onRetry, onDownload, onClose }) {
    const { createNotesPanel, NOTES_CSS } = globalThis.spotslate;
    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = HOST_STYLE;
    const shadow = host.attachShadow({ mode: globalThis.spotslate.SHADOW_MODE });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(POPUP_CSS);
    const notesSheet = new CSSStyleSheet();
    notesSheet.replaceSync(NOTES_CSS);
    shadow.adoptedStyleSheets = [sheet, notesSheet];

    const button = (className, label, onClick) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = label;
      element.addEventListener('click', onClick);
      return element;
    };
    const popupEl = document.createElement('div');
    popupEl.className = 'popup';
    const bar = document.createElement('div');
    bar.className = 'bar';
    const copyButton = button('tool copy', '', () => copy());
    const closeButton = button('tool close', '×', () => onClose());
    bar.append(copyButton, closeButton);
    const bodyEl = document.createElement('div');
    bodyEl.className = 'body';
    const textEl = document.createElement('div');
    textEl.className = 'text';
    const actions = {
      openSettings: button('action settings', '', () => onOpenSettings()),
      retry: button('action retry', '', () => onRetry()),
      download: button('action download', '', () => onDownload()),
    };
    bodyEl.append(textEl, ...Object.values(actions));
    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.hidden = true;
    const contextButton = button('tool context-toggle', '', () => setContextOpen(!notesPanel.isOpen()));
    contextButton.setAttribute('aria-expanded', 'false');
    foot.append(contextButton);
    popupEl.append(bar, bodyEl, foot);
    const notesSlot = document.createElement('div');
    notesSlot.className = 'notes-slot';
    const notesPanel = createNotesPanel();
    notesSlot.append(notesPanel.element);
    for (const edge of EDGES) {
      const handle = document.createElement('div');
      handle.className = `resize ${edge}`;
      handle.addEventListener('pointerdown', (event) => startResize(event, edge));
      popupEl.append(handle);
    }
    popupEl.addEventListener('mousedown', () => popupEl.classList.add('is-pinned'));
    bar.addEventListener('pointerdown', startDrag);
    shadow.append(popupEl, notesSlot);

    let block = null;
    let lang = 'en'; // what the popup speaks: the language the user translates into
    let side = 'above';
    let frame = 0;
    let offset = { x: 0, y: 0 }; // popup position relative to the block, in viewport pixels
    let detached = false; // dragged or resized: fixed on screen instead of attached to the block
    let sized = false; // resized: explicit width and height instead of fitting the text

    // The buttons in `lang`.
    function label() {
      const { t } = globalThis.spotslate;
      copyButton.textContent = t(lang, 'copy');
      closeButton.setAttribute('aria-label', t(lang, 'close'));
      for (const [key, element] of Object.entries(actions)) element.textContent = t(lang, key);
      contextButton.textContent = t(lang, 'context');
      contextButton.title = t(lang, 'contextTitle');
      notesPanel.setLanguage(lang);
    }

    function setContextOpen(open) {
      contextButton.setAttribute('aria-expanded', String(open));
      notesPanel.setOpen(open && !foot.hidden);
    }

    // action: 'settings', 'retry' or 'download' adds that button under an error.
    function render(text, { loading = false, error = false, action = null } = {}) {
      textEl.textContent = text;
      popupEl.classList.toggle('is-loading', loading);
      popupEl.classList.toggle('is-error', error);
      popupEl.classList.toggle('has-text', !loading && !error);
      popupEl.classList.toggle('has-settings', action === 'settings');
      popupEl.classList.toggle('has-retry', action === 'retry');
      popupEl.classList.toggle('has-download', action === 'download');
    }

    async function copy() {
      const text = textEl.textContent;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // The async clipboard needs a secure page; the old command works everywhere else.
        const area = document.createElement('textarea');
        area.value = text;
        shadow.append(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      copyButton.textContent = globalThis.spotslate.t(lang, 'copied');
      setTimeout(label, COPIED_MS);
    }

    function chooseSide(rect) {
      // A tall block reads best with its translation alongside it, like parallel text.
      const roomRight = document.documentElement.clientWidth - rect.right - GAP - MARGIN;
      if (rect.height > TALL_BLOCK && roomRight >= MIN_WIDTH) return 'right';
      if (rect.top >= MIN_SPACE_ABOVE) return 'above';
      return window.innerHeight - rect.bottom >= rect.top ? 'below' : 'above';
    }

    function place(viewportLeft, viewportTop) {
      host.style.setProperty('top', `${viewportTop + window.scrollY}px`, 'important');
      host.style.setProperty('left', `${viewportLeft + window.scrollX}px`, 'important');
    }

    function position() {
      const rect = block.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      // As wide as the block, within readable line lengths, from the first frame: the width comes from the block,
      // not from the text, so the popup does not grow while the translation comes in, nor does the panel under it.
      const readableWidth = clamp(rect.width, MIN_WIDTH, MAX_WIDTH);
      if (side === 'right') {
        popupEl.style.width = `${Math.min(readableWidth, viewportWidth - rect.right - GAP - MARGIN)}px`;
        popupEl.style.maxHeight = `${viewportHeight - 2 * MARGIN}px`;
      } else {
        const room = (side === 'above' ? rect.top : viewportHeight - rect.bottom) - GAP - MARGIN;
        popupEl.style.width = `${Math.min(readableWidth, viewportWidth - 2 * MARGIN)}px`;
        // No room beside a paragraph taller than the window: overlap it and use the whole window.
        popupEl.style.maxHeight = `${room >= MIN_HEIGHT ? room : viewportHeight - 2 * MARGIN}px`;
      }
      const { width, height } = popupEl.getBoundingClientRect();
      const wanted = {
        above: { left: rect.left + SHIFT_X, top: rect.top - GAP - height },
        below: { left: rect.left + SHIFT_X, top: rect.bottom + GAP },
        right: { left: rect.right + GAP, top: rect.top },
      }[side];
      const top = clamp(wanted.top, MARGIN, viewportHeight - MARGIN - height);
      const left = clamp(wanted.left, MARGIN, viewportWidth - MARGIN - width);
      place(left, top);
      offset = { x: left - rect.left, y: top - rect.top };
    }

    // Detached popups use viewport coordinates (position: fixed) and never leave the window.
    function placeFixed(left, top) {
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      popupEl.style.maxWidth = `${viewportWidth - 2 * MARGIN}px`;
      popupEl.style.maxHeight = `${viewportHeight - 2 * MARGIN}px`;
      const { width, height } = popupEl.getBoundingClientRect();
      host.style.setProperty('left', `${clamp(left, MARGIN, viewportWidth - MARGIN - width)}px`, 'important');
      host.style.setProperty('top', `${clamp(top, MARGIN, viewportHeight - MARGIN - height)}px`, 'important');
    }

    function keepInView() {
      const rect = popupEl.getBoundingClientRect();
      placeFixed(rect.left, rect.top);
    }

    function detach() {
      if (detached) return;
      const rect = popupEl.getBoundingClientRect();
      detached = true;
      host.style.setProperty('position', 'fixed', 'important');
      placeFixed(rect.left, rect.top);
    }

    // Follows the pointer from pointerdown to pointerup on `target`, calling onMove with the distance moved.
    function track(event, target, onMove) {
      const origin = { x: event.clientX, y: event.clientY };
      target.setPointerCapture(event.pointerId);
      const move = (moveEvent) => onMove(moveEvent.clientX - origin.x, moveEvent.clientY - origin.y);
      const stop = () => {
        popupEl.classList.remove('is-dragging');
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', stop);
        target.removeEventListener('pointercancel', stop);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', stop);
      target.addEventListener('pointercancel', stop);
    }

    function startDrag(event) {
      if (event.button !== 0 || event.target.closest('button')) return;
      event.preventDefault(); // no text selection, no mousedown: pin explicitly
      popupEl.classList.add('is-pinned', 'is-dragging');
      detach();
      const start = popupEl.getBoundingClientRect();
      track(event, bar, (dx, dy) => placeFixed(start.left + dx, start.top + dy));
    }

    // Moves the dragged edges (n, s, e, w or a corner) within the window, keeping the minimum size.
    function startResize(event, edge) {
      if (event.button !== 0) return;
      event.preventDefault();
      popupEl.classList.add('is-pinned');
      detach();
      const start = popupEl.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      track(event, event.currentTarget, (dx, dy) => {
        let { left, top, right, bottom } = start;
        if (edge.includes('e')) right = clamp(start.right + dx, start.left + MIN_RESIZE_WIDTH, viewportWidth - MARGIN);
        if (edge.includes('w')) left = clamp(start.left + dx, MARGIN, start.right - MIN_RESIZE_WIDTH);
        if (edge.includes('s')) bottom = clamp(start.bottom + dy, start.top + MIN_RESIZE_HEIGHT, viewportHeight - MARGIN);
        if (edge.includes('n')) top = clamp(start.top + dy, MARGIN, start.bottom - MIN_RESIZE_HEIGHT);
        sized = true;
        popupEl.style.width = `${right - left}px`;
        popupEl.style.height = `${bottom - top}px`;
        placeFixed(left, top);
      });
    }

    function schedulePosition() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (!block) return;
        if (detached) keepInView();
        else position();
      });
    }

    label();

    return {
      open(target) {
        block = target;
        detached = false;
        sized = false;
        popupEl.style.width = '';
        popupEl.style.height = '';
        host.style.setProperty('position', 'absolute', 'important');
        side = chooseSide(block.getBoundingClientRect());
        popupEl.classList.remove('is-pinned', 'is-dragging');
        render('…', { loading: true });
        popupEl.style.maxWidth = '';
        setContextOpen(false); // the context is there to look at, not to keep open
        document.documentElement.append(host);
        bodyEl.scrollTop = 0;
        position();
      },
      // `text` says what is going on, such as a download; the default is an ellipsis.
      setLoading(text = '…') {
        render(text, { loading: true });
        schedulePosition();
      },
      setText(text) {
        render(text);
        schedulePosition();
      },
      setError(message, { action = null } = {}) {
        render(message, { error: true, action });
        schedulePosition();
      },
      // Everything the popup says is in `next`, the language the user translates into.
      setLanguage(next) {
        lang = next;
        label();
      },
      // With an AI provider the footer offers the site context; `providerName` goes into the panel's note.
      setContext(available, providerName = '') {
        foot.hidden = !available;
        notesPanel.setProvider(providerName);
        if (!available) setContextOpen(false);
        schedulePosition();
      },
      // Keep the popup glued to its block when something scrolls (the window or an inner container).
      follow() {
        if (!block || detached) return;
        const rect = block.getBoundingClientRect();
        place(rect.left + offset.x, rect.top + offset.y);
      },
      keepInView,
      close() {
        cancelAnimationFrame(frame);
        frame = 0;
        host.remove();
        block = null;
      },
      isOpen: () => block !== null,
      isPinned: () => popupEl.classList.contains('is-pinned'),
      isLoading: () => popupEl.classList.contains('is-loading'),
      isDetached: () => detached,
      getBlock: () => block,
      // The popup with the context panel under it, when that is open.
      getRect() {
        const rect = popupEl.getBoundingClientRect();
        if (!notesPanel.isOpen()) return rect;
        const panel = notesPanel.element.getBoundingClientRect();
        const left = Math.min(rect.left, panel.left);
        const top = Math.min(rect.top, panel.top);
        return new DOMRect(left, top, Math.max(rect.right, panel.right) - left, Math.max(rect.bottom, panel.bottom) - top);
      },
      isOwn: (node) => node === host || node?.getRootNode?.() === shadow,
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createPopup });
})();
