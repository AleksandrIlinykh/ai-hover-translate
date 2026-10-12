(() => {
  const TOLERANCE = 2;
  const MAX_CHARS = 3000;
  const SHORT_CHARS = 40;
  const SHORT_WORDS = 3;
  const LETTER = /\p{L}/u;

  const inside = (rect, x, y) =>
    x >= rect.left - TOLERANCE && x <= rect.right + TOLERANCE && y >= rect.top - TOLERANCE && y <= rect.bottom + TOLERANCE;

  // The user's text selection when the point is over it, as { target: Range, text, selection: true }.
  function selectionAt(x, y) {
    const selection = getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container.nodeType === Node.TEXT_NODE ? container.parentElement : container;
    if (element?.isContentEditable) return null;
    const text = selection.toString().trim().replace(/\n{3,}/g, '\n\n');
    if (!LETTER.test(text)) return null;
    if (![...range.getClientRects()].some((rect) => inside(rect, x, y))) return null;
    const picked = { target: range.cloneRange(), text, selection: true };
    return text.length > MAX_CHARS ? { ...picked, reason: 'too-long' } : picked;
  }

  // A word or a few: worth a dictionary entry rather than a plain translation.
  function isShortPhrase(text) {
    return text.length <= SHORT_CHARS && text.split(/\s+/).length <= SHORT_WORDS;
  }

  Object.assign((globalThis.hoverTranslate ??= {}), { selectionAt, isShortPhrase });
})();
