(() => {
  const ROOT_ID = 'hover-translate-root';
  const GAP = 6;
  const MARGIN = 8;
  const SHIFT_X = 32;
  const MIN_SPACE_ABOVE = 120;
  const MAX_WIDTH = 480;
  const MIN_HEIGHT = 80;

  // Inline !important beats any page rule, including `div { display: none !important }`.
  const HOST_STYLE = ['all: initial', 'position: absolute', 'top: 0', 'left: 0', 'display: block', 'z-index: 2147483647']
    .map((rule) => `${rule} !important`)
    .join('; ');

  const POPUP_CSS = `
    .popup {
      box-sizing: border-box;
      width: max-content;
      overflow-y: auto;
      padding: 10px 12px;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      background: #ffffff;
      color: #1f2328;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
      font: 14px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: text;
      cursor: auto;
    }
    .popup.is-loading .text { animation: pulse 1s ease-in-out infinite; }
    .popup.is-error .text { color: #cf222e; }
    .settings {
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
    .popup.has-settings .settings { display: block; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-color-scheme: dark) {
      .popup { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .popup.is-error .text { color: #ff7b72; }
    }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function createPopup({ onOpenSettings }) {
    const host = document.createElement('div');
    host.id = ROOT_ID;
    host.style.cssText = HOST_STYLE;
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(POPUP_CSS);
    shadow.adoptedStyleSheets = [sheet];

    const popupEl = document.createElement('div');
    popupEl.className = 'popup';
    const textEl = document.createElement('div');
    textEl.className = 'text';
    const settingsButton = document.createElement('button');
    settingsButton.type = 'button';
    settingsButton.className = 'settings';
    settingsButton.textContent = 'Open settings';
    settingsButton.addEventListener('click', () => onOpenSettings());
    popupEl.append(textEl, settingsButton);
    shadow.append(popupEl);

    let block = null;
    let side = 'above';
    let frame = 0;
    let offset = { x: 0, y: 0 }; // popup position relative to the block, in viewport pixels

    function render(text, { loading = false, error = false, withSettings = false } = {}) {
      textEl.textContent = text;
      popupEl.classList.toggle('is-loading', loading);
      popupEl.classList.toggle('is-error', error);
      popupEl.classList.toggle('has-settings', withSettings);
    }

    function chooseSide(rect) {
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
      const room = (side === 'above' ? rect.top : viewportHeight - rect.bottom) - GAP - MARGIN;
      popupEl.style.maxWidth = `${Math.min(MAX_WIDTH, viewportWidth - 2 * MARGIN)}px`;
      // No room beside a paragraph taller than the window: overlap it and use the whole window.
      popupEl.style.maxHeight = `${room >= MIN_HEIGHT ? room : viewportHeight - 2 * MARGIN}px`;
      const { width, height } = popupEl.getBoundingClientRect();
      const wantedTop = side === 'above' ? rect.top - GAP - height : rect.bottom + GAP;
      const top = clamp(wantedTop, MARGIN, viewportHeight - MARGIN - height);
      const left = clamp(rect.left + SHIFT_X, MARGIN, viewportWidth - MARGIN - width);
      place(left, top);
      offset = { x: left - rect.left, y: top - rect.top };
    }

    function schedulePosition() {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (block) position();
      });
    }

    return {
      open(target) {
        block = target;
        side = chooseSide(block.getBoundingClientRect());
        render('…', { loading: true });
        document.documentElement.append(host);
        popupEl.scrollTop = 0;
        position();
      },
      setText(text) {
        render(text);
        schedulePosition();
      },
      setError(message, { withSettings = false } = {}) {
        render(message, { error: true, withSettings });
        schedulePosition();
      },
      // Keep the popup glued to its block when something scrolls (the window or an inner container).
      follow() {
        if (!block) return;
        const rect = block.getBoundingClientRect();
        place(rect.left + offset.x, rect.top + offset.y);
      },
      close() {
        cancelAnimationFrame(frame);
        frame = 0;
        host.remove();
        block = null;
      },
      isOpen: () => block !== null,
      getBlock: () => block,
      getRect: () => popupEl.getBoundingClientRect(),
      isOwn: (node) => node === host || node?.getRootNode?.() === shadow,
    };
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { createPopup });
})();
