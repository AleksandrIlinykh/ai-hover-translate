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

  // What Alt + hover over an element would translate: the element itself or its nearest block-level
  // ancestor with readable text, as { target, text }. Paragraphs of rich text editors (contenteditable,
  // e.g. Confluence in edit mode) count too. When the block can't be translated the result is
  // { target, reason } with reason 'editable' (a form field) or 'too-long'; null means there is nothing to read.
  function inspectBlock(start) {
    let node = start?.nodeType === Node.TEXT_NODE ? start.parentElement : start;
    if (!(node instanceof Element)) return null;
    const field = node.closest('input, textarea, select');
    if (field) return { target: field, reason: 'editable' };
    for (; node && node !== document.body && node !== document.documentElement; node = parentOf(node)) {
      if (!(node instanceof HTMLElement)) continue;
      if (!BLOCK_DISPLAYS.has(getComputedStyle(node).display)) continue;
      const text = blockText(node);
      if (!LETTER.test(text)) continue;
      return text.length > MAX_CHARS ? { target: node, reason: 'too-long' } : { target: node, text };
    }
    return null;
  }

  // Whether the point is over a line of text rather than a container's padding or margin.
  function isOverText(x, y) {
    const node = document.caretRangeFromPoint?.(x, y)?.startContainer;
    if (node?.nodeType !== Node.TEXT_NODE) return false;
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()].some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom);
  }

  function blockText(block) {
    return block.innerText.trim().replace(/\n{3,}/g, '\n\n');
  }

  Object.assign((globalThis.paragloss ??= {}), { elementAt, inspectBlock, isOverText });
})();
