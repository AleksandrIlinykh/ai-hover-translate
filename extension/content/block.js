(() => {
  const BLOCK_DISPLAYS = new Set(['block', 'list-item', 'table-cell', 'table-caption', 'flex', 'grid', 'flow-root']);
  const MAX_CHARS = 3000;
  const LETTER = /\p{L}/u;

  // Element under the point, looking inside open shadow roots (web components).
  function elementAt(x, y) {
    let element = document.elementFromPoint(x, y);
    while (element?.shadowRoot) {
      const inner = element.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === element) break;
      element = inner;
    }
    return element;
  }

  // Parent element, stepping out of a shadow root to its host.
  function parentOf(node) {
    return node.parentElement ?? (node.parentNode instanceof ShadowRoot ? node.parentNode.host : null);
  }

  // The element itself or its nearest block-level ancestor that holds readable text.
  function findBlock(start) {
    let node = start?.nodeType === Node.TEXT_NODE ? start.parentElement : start;
    if (!(node instanceof Element)) return null;
    if (node.closest('input, textarea, select') || node.isContentEditable) return null;
    for (; node && node !== document.body && node !== document.documentElement; node = parentOf(node)) {
      if (!(node instanceof HTMLElement)) continue;
      if (!BLOCK_DISPLAYS.has(getComputedStyle(node).display)) continue;
      const text = node.innerText;
      if (!LETTER.test(text)) continue;
      return text.trim().length > MAX_CHARS ? null : node;
    }
    return null;
  }

  function blockText(block) {
    return block.innerText.trim().replace(/\n{3,}/g, '\n\n');
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { elementAt, findBlock, blockText });
})();
