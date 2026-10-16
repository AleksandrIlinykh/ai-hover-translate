(() => {
  const ROOT_ID = 'spotslate-highlight';
  const LINK_ID = 'spotslate-link';
  const PAD = 3;
  const HINT_ROOM = 28; // space needed above the box to put the hint outside it

  const important = (rules) => rules.map((rule) => `${rule} !important`).join('; ');

  // Inline !important beats any page rule; pointer-events: none keeps elementFromPoint looking through it.
  const BOX_STYLE = important([
    'all: initial',
    'position: absolute',
    'display: block',
    'box-sizing: border-box',
    'pointer-events: none',
    'z-index: 2147483646',
    'border-width: 2px',
    'border-style: dashed',
    'border-radius: 4px',
  ]);
  const COLORS = {
    active: { border: '#1f6feb', fill: 'rgba(31, 111, 235, 0.1)' },
    muted: { border: '#8c959f', fill: 'rgba(140, 149, 159, 0.12)' },
  };
  // The line from the outline to the popup: a dashed border turned along it, in the screen's coordinates.
  const LINK_STYLE = important([
    'all: initial',
    'position: fixed',
    'display: block',
    'top: 0',
    'left: 0',
    'height: 0',
    'pointer-events: none',
    'z-index: 2147483646',
    'border-top: 2px dashed #1f6feb',
    'transform-origin: 0 0',
  ]);
  const HINT_STYLE = important([
    'all: initial',
    'position: absolute',
    'display: block',
    'pointer-events: none',
    'left: -2px',
    'padding: 2px 6px',
    'border-radius: 4px',
    'background: #57606a',
    'color: #ffffff',
    'font: 12px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    'white-space: nowrap',
  ]);

  // The two ends of the shortest line between boxes `a` and `b`: straight across where they overlap, from corner to
  // corner where they do not.
  function joining(a, b) {
    const axis = (aStart, aEnd, bStart, bEnd) => {
      const start = Math.max(aStart, bStart);
      const end = Math.min(aEnd, bEnd);
      if (start < end) return [(start + end) / 2, (start + end) / 2];
      return bStart >= aEnd ? [aEnd, bStart] : [aStart, bEnd];
    };
    const [x1, x2] = axis(a.left, a.right, b.left, b.right);
    const [y1, y2] = axis(a.top, a.bottom, b.top, b.bottom);
    return { x1, y1, x2, y2 };
  }

  // Dashed outline over what Alt + hover is about to translate (muted, with a hint, when it can't be), and, while a
  // translation popup is open, over its text, with a dashed line to the popup: the eye keeps its place on the page.
  function createHighlight() {
    const box = document.createElement('div');
    box.id = ROOT_ID;
    box.style.cssText = BOX_STYLE;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.cssText = HINT_STYLE;
    const link = document.createElement('div');
    link.id = LINK_ID;
    link.style.cssText = LINK_STYLE;
    let anchor = null; // the open popup's text and where the popup is: { target, popupRect() }
    let preview = null; // what Alt + hover shows meanwhile: { linked } when it is the popup's text too
    let frame = 0;
    let drawn = '';

    function place(target) {
      const rect = target.getBoundingClientRect();
      const geometry = {
        top: rect.top + window.scrollY - PAD,
        left: rect.left + window.scrollX - PAD,
        width: rect.width + 2 * PAD,
        height: rect.height + 2 * PAD,
      };
      for (const [name, value] of Object.entries(geometry)) box.style.setProperty(name, `${value}px`, 'important');
      // Above the box when there is room, otherwise inside its top-left corner.
      const outside = rect.top >= HINT_ROOM;
      hint.style.setProperty('top', outside ? 'auto' : '2px', 'important');
      hint.style.setProperty('bottom', outside ? 'calc(100% + 4px)' : 'auto', 'important');
    }

    function paint(target, { muted = false, text = '' } = {}) {
      const colors = muted ? COLORS.muted : COLORS.active;
      box.style.setProperty('border-color', colors.border, 'important');
      box.style.setProperty('background', colors.fill, 'important');
      box.dataset.muted = String(muted);
      hint.textContent = text;
      if (text) box.append(hint);
      else hint.remove();
      if (!box.isConnected) document.documentElement.append(box);
      place(target);
    }

    // The line from the outline to the popup as they are now; written only when it moved.
    function drawLink() {
      const { x1, y1, x2, y2 } = joining(box.getBoundingClientRect(), anchor.popupRect());
      const length = Math.hypot(x2 - x1, y2 - y1);
      const angle = Math.atan2(y2 - y1, x2 - x1);
      const geometry = `${x1.toFixed(1)} ${y1.toFixed(1)} ${length.toFixed(1)} ${angle.toFixed(4)}`;
      if (geometry !== drawn) {
        drawn = geometry;
        link.style.setProperty('width', `${length}px`, 'important');
        link.style.setProperty('transform', `translate(${x1}px, ${y1}px) rotate(${angle}rad) translateY(-1px)`, 'important');
      }
      if (!link.isConnected) document.documentElement.append(link);
    }

    function hideLink() {
      link.remove();
      drawn = '';
    }

    // While the popup is open, every frame: the outline on its text (unless Alt points elsewhere) and the line.
    function follow() {
      frame = 0;
      if (!anchor) return;
      if (!preview) place(anchor.target);
      if (!preview || preview.linked) drawLink();
      else hideLink();
      frame = requestAnimationFrame(follow);
    }

    return {
      // What Alt + hover would translate; `linked` when that is the open popup's text.
      show(target, { muted = false, hint: text = '', linked = false } = {}) {
        preview = { linked };
        paint(target, { muted, text });
      },
      // The read key is up: back to the open popup's text, or nothing.
      hide() {
        preview = null;
        if (anchor) paint(anchor.target);
        else box.remove();
      },
      // A translation popup opened on `target`; `popupRect()` says where it is.
      anchor(target, popupRect) {
        anchor = { target, popupRect };
        if (!preview) paint(target);
        if (!frame) frame = requestAnimationFrame(follow);
      },
      // The popup closed.
      release() {
        anchor = null;
        cancelAnimationFrame(frame);
        frame = 0;
        hideLink();
        if (!preview) box.remove();
      },
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createHighlight });
})();
