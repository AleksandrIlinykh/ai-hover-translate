(() => {
  const ROOT_ID = 'hover-translate-root';
  const GAP = 6;
  const MARGIN = 8;
  const SHIFT_X = 32;
  const MIN_SPACE_ABOVE = 120;
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 720;
  const MIN_HEIGHT = 80;
  const TALL_BLOCK = 240;
  const COPIED_MS = 1200;

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
    .popup.is-pinned { border-color: #1f6feb; }
    .popup.is-loading .text { animation: pulse 1s ease-in-out infinite; }
    .popup.is-error .text { color: #cf222e; }
    .tools { float: right; display: flex; gap: 2px; margin: -6px -8px 2px 8px; }
    .tool {
      visibility: hidden;
      padding: 2px 6px;
      border: 1px solid transparent;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      opacity: 0.7;
      cursor: pointer;
    }
    .tool:hover { opacity: 1; border-color: currentColor; }
    .popup.has-text:hover .copy, .popup.is-pinned .close { visibility: visible; }
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
    .popup.has-settings .settings, .popup.has-retry .retry { display: block; }
    @keyframes pulse { 50% { opacity: 0.3; } }
    @media (prefers-color-scheme: dark) {
      .popup { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .popup.is-error .text { color: #ff7b72; }
    }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  // Translation popup. Clicking it pins it: it then stays until Esc, its close button or the next translation.
  function createPopup({ onOpenSettings, onRetry, onClose }) {
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
    const button = (className, label, onClick) => {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = className;
      element.textContent = label;
      element.addEventListener('click', onClick);
      return element;
    };
    const copyButton = button('tool copy', 'Copy', () => copy());
    const closeButton = button('tool close', '\u00d7', () => onClose());
    closeButton.setAttribute('aria-label', 'Close');
    const tools = document.createElement('div');
    tools.className = 'tools';
    tools.append(copyButton, closeButton);
    popupEl.append(
      tools,
      textEl,
      button('action settings', 'Open settings', () => onOpenSettings()),
      button('action retry', 'Retry', () => onRetry()),
    );
    popupEl.addEventListener('mousedown', () => popupEl.classList.add('is-pinned'));
    shadow.append(popupEl);

    let block = null;
    let side = 'above';
    let frame = 0;
    let offset = { x: 0, y: 0 }; // popup position relative to the block, in viewport pixels

    // action: 'settings' or 'retry' adds that button under an error.
    function render(text, { loading = false, error = false, action = null } = {}) {
      textEl.textContent = text;
      popupEl.classList.toggle('is-loading', loading);
      popupEl.classList.toggle('is-error', error);
      popupEl.classList.toggle('has-text', !loading && !error);
      popupEl.classList.toggle('has-settings', action === 'settings');
      popupEl.classList.toggle('has-retry', action === 'retry');
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
      copyButton.textContent = 'Copied';
      setTimeout(() => {
        copyButton.textContent = 'Copy';
      }, COPIED_MS);
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
      // As wide as the block, within readable line lengths.
      const readableWidth = clamp(rect.width, MIN_WIDTH, MAX_WIDTH);
      if (side === 'right') {
        popupEl.style.maxWidth = `${Math.min(readableWidth, viewportWidth - rect.right - GAP - MARGIN)}px`;
        popupEl.style.maxHeight = `${viewportHeight - 2 * MARGIN}px`;
      } else {
        const room = (side === 'above' ? rect.top : viewportHeight - rect.bottom) - GAP - MARGIN;
        popupEl.style.maxWidth = `${Math.min(readableWidth, viewportWidth - 2 * MARGIN)}px`;
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
        popupEl.classList.remove('is-pinned');
        render('…', { loading: true });
        document.documentElement.append(host);
        popupEl.scrollTop = 0;
        position();
      },
      setLoading() {
        render('…', { loading: true });
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
      isPinned: () => popupEl.classList.contains('is-pinned'),
      getBlock: () => block,
      getRect: () => popupEl.getBoundingClientRect(),
      isOwn: (node) => node === host || node?.getRootNode?.() === shadow,
    };
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { createPopup });
})();
