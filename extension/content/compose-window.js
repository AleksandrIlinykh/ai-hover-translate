// The compose window at a text field on the page: below the field (above when there is no room), moved by its
// title row, closed with its ×, Esc or Copy. Keys typed in it stay out of the page, so site shortcuts do not fire.
(() => {
  const ROOT_ID = 'paragloss-compose';
  const WIDTH = 440;
  const GAP = 6;
  const MARGIN = 8;

  // Inline !important beats any page rule, as for the translation popup.
  const HOST_STYLE = ['all: initial', 'position: absolute', 'top: 0', 'left: 0', 'display: block', 'z-index: 2147483647']
    .map((rule) => `${rule} !important`)
    .join('; ');
  const FRAME_CSS = `
    .frame {
      box-sizing: border-box;
      overflow: hidden;
      border: 1px solid #1f6feb;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
    }
    .head { cursor: grab; }
    .frame.is-dragging .head { cursor: grabbing; }
    @media (prefers-color-scheme: dark) { .frame { box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); } }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  function createComposeWindow() {
    let host = null;
    let composer = null;

    function place(left, top) {
      host.style.setProperty('left', `${left + window.scrollX}px`, 'important');
      host.style.setProperty('top', `${top + window.scrollY}px`, 'important');
    }

    function position(frame, field) {
      const rect = field.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      frame.style.width = `${Math.min(WIDTH, viewportWidth - 2 * MARGIN)}px`;
      const { width, height } = frame.getBoundingClientRect();
      const roomBelow = viewportHeight - rect.bottom - GAP - MARGIN;
      const roomAbove = rect.top - GAP - MARGIN;
      const top = roomBelow >= height || roomBelow >= roomAbove ? rect.bottom + GAP : rect.top - GAP - height;
      place(
        clamp(rect.left, MARGIN, viewportWidth - MARGIN - width),
        clamp(top, MARGIN, Math.max(MARGIN, viewportHeight - MARGIN - height)),
      );
    }

    function startDrag(event, frame) {
      if (event.button !== 0 || event.target.closest('button, select')) return;
      event.preventDefault();
      const origin = { x: event.clientX, y: event.clientY };
      const start = frame.getBoundingClientRect();
      const handle = event.currentTarget;
      handle.setPointerCapture(event.pointerId);
      frame.classList.add('is-dragging');
      const move = (moveEvent) => {
        const { width, height } = start;
        place(
          clamp(start.left + moveEvent.clientX - origin.x, MARGIN, document.documentElement.clientWidth - MARGIN - width),
          clamp(start.top + moveEvent.clientY - origin.y, MARGIN, window.innerHeight - MARGIN - height),
        );
      };
      const stop = () => {
        frame.classList.remove('is-dragging');
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', stop);
        handle.removeEventListener('pointercancel', stop);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', stop);
      handle.addEventListener('pointercancel', stop);
    }

    function close() {
      composer?.destroy();
      composer = null;
      host?.remove();
      host = null;
    }

    // Opens the window at `field`; `options` go to createComposer. Copy and close give the focus back to the field.
    function open(field, options) {
      close();
      host = document.createElement('div');
      host.id = ROOT_ID;
      host.style.cssText = HOST_STYLE;
      for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (event) => event.stopPropagation());
      const shadow = host.attachShadow({ mode: 'open' });
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(FRAME_CSS);
      shadow.adoptedStyleSheets = [sheet];
      const frame = document.createElement('div');
      frame.className = 'frame';
      shadow.append(frame);
      const giveFocusBack = () => {
        close();
        field.focus?.({ preventScroll: true });
      };
      composer = globalThis.paragloss.createComposer({
        ...options,
        container: frame,
        styleRoot: shadow,
        showClose: true,
        onCopied: giveFocusBack,
        onClose: giveFocusBack,
      });
      composer.element.querySelector('.head').addEventListener('pointerdown', (event) => startDrag(event, frame));
      document.documentElement.append(host);
      position(frame, field);
      composer.focus();
    }

    return {
      open,
      close,
      isOpen: () => host !== null,
      isOwn: (node) => host !== null && (node === host || node?.getRootNode?.() === host.shadowRoot),
    };
  }

  Object.assign((globalThis.paragloss ??= {}), { createComposeWindow });
})();
