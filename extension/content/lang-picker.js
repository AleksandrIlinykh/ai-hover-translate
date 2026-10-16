// The language picker of every SpotSlate window's title row: a small button with the language's code ("DE"), and on
// click a list of the languages, each by its code and its own name ("DE Deutsch"), the current one ticked. The list is
// a popover, in the browser's top layer, so no window clips it; it has its own colors in either theme.
(() => {
  const GAP = 4;
  const MARGIN = 8;
  const MAX_HEIGHT = 300;

  const PICKER_CSS = `
    .picker { display: inline-flex; flex: none; }
    .picker-button {
      display: inline-flex; align-items: center; gap: 3px; height: 22px; margin: 0; padding: 0 6px;
      border: 1px solid #d0d7de; border-radius: 6px; background: transparent; color: inherit;
      font: 600 12px/20px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; letter-spacing: 0.03em; cursor: pointer;
    }
    .picker-button::after { content: "\\25BE"; font-size: 10px; opacity: 0.6; }
    .picker-button:hover, .picker-button[aria-expanded="true"] { border-color: #1f6feb; }
    .picker-button:focus-visible { outline: 2px solid #1f6feb; outline-offset: 1px; }
    .picker-list {
      position: fixed; inset: auto; margin: 0; box-sizing: border-box; min-width: 190px; max-height: ${MAX_HEIGHT}px;
      overflow-y: auto; overscroll-behavior: contain; padding: 4px; border: 1px solid #d0d7de; border-radius: 8px;
      background: #ffffff; color: #1f2328; box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
      font: 13px/1.4 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; text-align: left;
    }
    .picker-option { display: flex; align-items: center; gap: 10px; padding: 4px 8px; border-radius: 4px; cursor: pointer; outline: none; white-space: nowrap; }
    .picker-option:hover, .picker-option:focus { background: #eef1f4; }
    .picker-code { width: 22px; font-size: 11px; font-weight: 600; letter-spacing: 0.03em; opacity: 0.65; }
    .picker-name { flex: 1; }
    .picker-tick { visibility: hidden; color: #1f6feb; }
    .picker-option[aria-selected="true"] .picker-tick { visibility: visible; }
    @media (prefers-color-scheme: dark) {
      .picker-button { border-color: #30363d; }
      .picker-list { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .picker-option:hover, .picker-option:focus { background: #21262d; }
      .picker-tick { color: #58a6ff; }
    }
  `;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  // A language's name in the language itself, as Chrome knows it.
  function ownName(code) {
    try {
      const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code;
      return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
    } catch {
      return code;
    }
  }

  function part(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // `codes` are the languages in order, `value` the chosen one. `label()` names the picker and `titleOf(code)` the
  // language in the window's own language, for assistive technology and the tooltip. `onChange(code)` follows a
  // choice of another language, `onOpen()` the list opening.
  function createLanguagePicker({ className, codes, value, label, titleOf, onChange = () => {}, onOpen = () => {} }) {
    const element = part('span', `picker ${className}`);
    const button = part('button', 'picker-button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    const list = part('div', 'picker-list');
    list.setAttribute('role', 'listbox');
    list.popover = 'auto';
    button.popoverTargetElement = list; // the button opens and closes it; a click elsewhere or Esc closes it too
    element.append(button, list);
    // A press in the picker is not the start of a drag of the window around it.
    element.addEventListener('pointerdown', (event) => event.stopPropagation());
    let current = value;

    function build(languages) {
      list.replaceChildren(
        ...languages.map((code) => {
          const option = part('div', 'picker-option');
          option.setAttribute('role', 'option');
          option.tabIndex = -1;
          option.dataset.code = code;
          option.append(part('span', 'picker-code', code.toUpperCase()), part('span', 'picker-name', ownName(code)), part('span', 'picker-tick', '✓'));
          return option;
        }),
      );
    }

    function show() {
      element.dataset.value = current;
      button.textContent = current.toUpperCase();
      button.title = titleOf(current);
      button.setAttribute('aria-label', `${label()}: ${titleOf(current)}`);
      list.setAttribute('aria-label', label());
      for (const option of list.children) option.setAttribute('aria-selected', String(option.dataset.code === current));
    }

    const isOpen = () => list.matches(':popover-open');
    const options = () => [...list.children];

    // Under the button, or above it when there is more room there.
    function place() {
      const rect = button.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom - GAP - MARGIN;
      const above = rect.top - GAP - MARGIN;
      const down = below >= Math.min(MAX_HEIGHT, list.scrollHeight) || below >= above;
      list.style.maxHeight = `${Math.max(80, Math.min(MAX_HEIGHT, down ? below : above))}px`;
      const { width, height } = list.getBoundingClientRect();
      list.style.left = `${clamp(rect.left, MARGIN, document.documentElement.clientWidth - MARGIN - width)}px`;
      list.style.top = `${down ? rect.bottom + GAP : rect.top - GAP - height}px`;
    }

    function open() {
      if (isOpen()) return;
      list.showPopover();
      ready(); // at once, so the next key already works the list
    }

    let readied = false;
    function ready() {
      if (readied) return;
      readied = true;
      place();
      (options().find((option) => option.dataset.code === current) ?? options()[0])?.focus();
      addEventListener('scroll', follow, true);
      addEventListener('resize', follow);
      onOpen();
    }

    function close(focusButton) {
      if (isOpen()) list.hidePopover();
      if (focusButton) button.focus();
    }

    function choose(code) {
      close(true);
      if (!code || code === current) return;
      current = code;
      show();
      onChange(code);
    }

    // The page scrolled or the window changed size: the list stays by its button, and closes once the button is out of
    // sight. Its own scrolling reaches here too, and leaves the button where it was.
    function follow() {
      const { top, bottom } = button.getBoundingClientRect();
      if (bottom < 0 || top > window.innerHeight) close(false);
      else place();
    }
    list.addEventListener('toggle', (event) => {
      const opened = event.newState === 'open';
      button.setAttribute('aria-expanded', String(opened));
      if (opened) {
        ready(); // opened by the button
        return;
      }
      readied = false;
      removeEventListener('scroll', follow, true);
      removeEventListener('resize', follow);
    });

    button.addEventListener('keydown', (event) => {
      if (!event.isTrusted || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
      event.preventDefault();
      event.stopPropagation();
      open();
    });

    // The next option after `from` whose code or name starts with `letter`, round the list.
    function jump(letter, from) {
      const all = options();
      const wanted = letter.toLocaleLowerCase();
      for (let step = 1; step <= all.length; step++) {
        const option = all[(from + step) % all.length];
        const name = option.querySelector('.picker-name').textContent.toLocaleLowerCase();
        if (option.dataset.code.startsWith(wanted) || name.startsWith(wanted)) {
          option.focus();
          return;
        }
      }
    }

    list.addEventListener('keydown', (event) => {
      if (!event.isTrusted) return;
      const all = options();
      const index = all.indexOf(event.target.closest?.('.picker-option'));
      const focusAt = (at) => all[clamp(at, 0, all.length - 1)]?.focus();
      if (event.key === 'ArrowDown') focusAt(index + 1);
      else if (event.key === 'ArrowUp') focusAt(index - 1);
      else if (event.key === 'Home') focusAt(0);
      else if (event.key === 'End') focusAt(all.length - 1);
      else if (event.key === 'Enter' || event.key === ' ') choose(all[index]?.dataset.code);
      else if (event.key === 'Escape') close(true);
      else if (event.key === 'Tab') {
        close(false);
        return;
      } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) jump(event.key, index);
      else return;
      // The window around the picker and the page hear none of the keys that work the list.
      event.preventDefault();
      event.stopPropagation();
    });

    list.addEventListener('click', (event) => {
      if (event.isTrusted) choose(event.target.closest('.picker-option')?.dataset.code);
    });

    build(codes);
    show();
    return {
      element,
      get value() {
        return current;
      },
      // Another chosen language, or other languages to offer, without a change event.
      setValue(code, languages = null) {
        if (languages) build(languages);
        current = code;
        show();
      },
      // The names and tooltips again, when the window speaks another language.
      refresh: show,
      isOpen,
      close: () => close(false),
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createLanguagePicker, PICKER_CSS });
})();
