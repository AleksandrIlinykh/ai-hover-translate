(() => {
  const ROOT_ID = 'spotslate-highlight';
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

  // Dashed outline over what Alt + hover is about to translate. Muted (grey, with a hint) when it can't be.
  function createHighlight() {
    const box = document.createElement('div');
    box.id = ROOT_ID;
    box.style.cssText = BOX_STYLE;
    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.style.cssText = HINT_STYLE;

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

    return {
      show(target, { muted = false, hint: text = '' } = {}) {
        const colors = muted ? COLORS.muted : COLORS.active;
        box.style.setProperty('border-color', colors.border, 'important');
        box.style.setProperty('background', colors.fill, 'important');
        box.dataset.muted = String(muted);
        hint.textContent = text;
        if (text) box.append(hint);
        else hint.remove();
        if (!box.isConnected) document.documentElement.append(box);
        place(target);
      },
      hide() {
        box.remove();
      },
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createHighlight });
})();
