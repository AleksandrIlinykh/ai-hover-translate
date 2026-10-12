(() => {
  const ROOT_ID = 'hover-translate-highlight';
  const PAD = 3;

  // Inline !important beats any page rule; pointer-events: none keeps elementFromPoint looking through it.
  const BOX_STYLE = [
    'all: initial',
    'position: absolute',
    'display: block',
    'box-sizing: border-box',
    'pointer-events: none',
    'z-index: 2147483646',
    'border: 2px dashed #1f6feb',
    'border-radius: 4px',
    'background: rgba(31, 111, 235, 0.1)',
  ]
    .map((rule) => `${rule} !important`)
    .join('; ');

  // Dashed outline over the block that Alt + hover is about to translate.
  function createHighlight() {
    const box = document.createElement('div');
    box.id = ROOT_ID;
    box.style.cssText = BOX_STYLE;

    function place(block) {
      const rect = block.getBoundingClientRect();
      const geometry = {
        top: rect.top + window.scrollY - PAD,
        left: rect.left + window.scrollX - PAD,
        width: rect.width + 2 * PAD,
        height: rect.height + 2 * PAD,
      };
      for (const [name, value] of Object.entries(geometry)) box.style.setProperty(name, `${value}px`, 'important');
    }

    return {
      show(block) {
        if (!box.isConnected) document.documentElement.append(box);
        place(block);
      },
      hide() {
        box.remove();
      },
    };
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { createHighlight });
})();
