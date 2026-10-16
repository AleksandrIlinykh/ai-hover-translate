// The site context panel under the translation popup and the compose window: what SpotSlate knows about the site,
// built from the texts translated there. It reads like a card under a film: the text cannot be selected or edited,
// only cleared. It asks background for the notes when opened and follows their changes while it exists.
(() => {
  const NOTES_CSS = `
    .notes {
      box-sizing: border-box;
      padding: 8px 10px 10px;
      border: 1px solid #d0d7de;
      border-radius: 8px;
      background: #ffffff;
      color: #1f2328;
      box-shadow: 0 8px 24px rgba(31, 35, 40, 0.18);
      font: 13px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      text-align: left;
      cursor: default;
    }
    .notes[hidden] { display: none; }
    .notes-head { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
    .notes-title { min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; font-weight: 600; }
    .notes-updating { flex: none; opacity: 0.6; }
    .notes-updating[hidden] { display: none; }
    .notes-clear {
      flex: none; margin-left: auto; padding: 1px 8px; border: 1px solid #d0d7de; border-radius: 6px;
      background: transparent; color: inherit; font: 12px/18px system-ui, sans-serif; cursor: pointer;
    }
    .notes-clear:disabled { opacity: 0.4; cursor: default; }
    /* The film: a laminated card with an inner rim and a soft diagonal sheen over muted text. */
    .notes-film {
      position: relative;
      overflow: hidden;
      padding: 8px 10px;
      border-radius: 6px;
      background: linear-gradient(180deg, #f6f8fa, #eceff3);
      box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.9), inset 0 1px 3px rgba(31, 35, 40, 0.14);
      color: #57606a;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      user-select: none;
      -webkit-user-select: none;
    }
    .notes-film::after {
      content: '';
      position: absolute;
      inset: 0;
      pointer-events: none;
      background: linear-gradient(115deg, transparent 30%, rgba(255, 255, 255, 0.6) 46%, transparent 62%);
    }
    .notes-film.is-empty { font-style: italic; }
    .notes-note { margin: 6px 0 0; font-size: 12px; opacity: 0.7; }
    @media (prefers-color-scheme: dark) {
      .notes { border-color: #30363d; background: #161b22; color: #e6edf3; box-shadow: 0 8px 24px rgba(1, 4, 9, 0.6); }
      .notes-clear { border-color: #30363d; }
      .notes-film {
        background: linear-gradient(180deg, #1c2128, #161b22);
        box-shadow: inset 0 0 0 1px rgba(240, 246, 252, 0.08), inset 0 1px 3px rgba(1, 4, 9, 0.6);
        color: #8b949e;
      }
      .notes-film::after { background: linear-gradient(115deg, transparent 30%, rgba(240, 246, 252, 0.07) 46%, transparent 62%); }
    }
  `;

  function element(tag, className, text = '') {
    const node = document.createElement(tag);
    node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  // `site` is for extension pages, which are not on the site (the toolbar popup); content scripts leave it out and
  // background uses their tab's. `providerName` goes into the note; `lang` is the language it speaks, the one the user
  // translates into. The panel starts closed.
  function createNotesPanel({ site: claimedSite = null, providerName = '', lang: startLang = 'en' } = {}) {
    const { t } = globalThis.spotslate;
    const panel = element('div', 'notes');
    panel.hidden = true;
    const title = element('span', 'notes-title');
    const updating = element('span', 'notes-updating');
    updating.hidden = true;
    const clear = element('button', 'notes-clear');
    clear.type = 'button';
    clear.disabled = true;
    const film = element('div', 'notes-film');
    film.setAttribute('role', 'note');
    const note = element('p', 'notes-note');
    const head = element('div', 'notes-head');
    head.append(title, updating, clear);
    panel.append(head, film, note);

    let site = null; // as background names it
    let provider = providerName;
    let lang = startLang;
    let shown = { text: '', updating: false };

    function show({ site: named, text, updating: busy }) {
      site = named ?? site;
      shown = { text, updating: busy };
      title.textContent = t(lang, 'notesTitle', { site: site ?? t(lang, 'thisSite') });
      updating.textContent = t(lang, 'updating');
      updating.hidden = !busy;
      film.textContent = text || t(lang, 'notesEmpty');
      film.classList.toggle('is-empty', !text);
      clear.textContent = t(lang, 'clear');
      clear.disabled = !text;
      note.textContent = t(lang, 'notesNote', { provider });
    }
    show(shown);

    async function load() {
      try {
        show(await chrome.runtime.sendMessage({ type: 'notes', site: claimedSite }));
      } catch {
        // the extension was updated; the page needs a reload
      }
    }

    const listener = (message) => {
      if (message?.type === 'notes-changed' && site && message.site === site) show(message);
    };
    chrome.runtime.onMessage.addListener(listener);

    clear.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'clear-notes', site: claimedSite }).catch(() => {});
      show({ text: '', updating: false });
    });

    return {
      element: panel,
      isOpen: () => !panel.hidden,
      setOpen(open) {
        panel.hidden = !open;
        if (open) load();
      },
      setLanguage(next) {
        lang = next;
        show(shown);
      },
      setProvider(name) {
        provider = name;
        show(shown);
      },
      destroy() {
        chrome.runtime.onMessage.removeListener(listener);
        panel.remove();
      },
    };
  }

  Object.assign((globalThis.spotslate ??= {}), { createNotesPanel, NOTES_CSS });
})();
