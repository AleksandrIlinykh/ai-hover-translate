(() => {
  const { elementAt, findBlock, blockText, createPopup } = globalThis.hoverTranslate;

  const TRIGGER_DELAY_MS = 200;
  const LEAVE_GRACE_MS = 300;
  const CACHE_LIMIT = 100;

  const cache = new Map();
  const popup = createPopup({
    onOpenSettings: () => chrome.runtime.sendMessage({ type: 'open-options' }).catch(() => {}),
  });

  let mouseX = null;
  let mouseY = null;
  let altDown = false;
  let combo = false;
  let usedAlt = false;
  let triggerTimer = 0;
  let leaveTimer = 0;
  let port = null;

  function trigger() {
    if (!altDown || combo || mouseX === null) return;
    const element = elementAt(mouseX, mouseY);
    if (!element || popup.isOwn(element)) return;
    const block = findBlock(element);
    if (!block || block === popup.getBlock()) return;
    usedAlt = true;
    show(block);
  }

  function show(block) {
    closePopup();
    const text = blockText(block);
    popup.open(block);
    const cached = cache.get(text);
    if (cached === undefined) translate(text);
    else popup.setText(cached);
  }

  function translate(text) {
    let current;
    try {
      current = chrome.runtime.connect({ name: 'translate' });
    } catch {
      popup.setError('The extension was updated. Reload the page.');
      return;
    }
    port = current;
    let result = '';
    current.onMessage.addListener((message) => {
      if (port !== current) return;
      if (message.type === 'chunk') {
        result += message.text;
        popup.setText(result);
      } else if (message.type === 'done') {
        remember(text, result);
        disconnect();
      } else if (message.type === 'error') {
        popup.setError(message.message, { withSettings: message.code === 'no_key' });
        disconnect();
      }
    });
    current.onDisconnect.addListener(() => {
      if (port !== current) return; // we disconnected on purpose
      port = null;
      popup.setError('The translation was interrupted. Try again.');
    });
    current.postMessage({ text });
  }

  function disconnect() {
    const current = port;
    port = null;
    current?.disconnect();
  }

  function remember(text, translation) {
    cache.delete(text);
    cache.set(text, translation);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  }

  function closePopup() {
    disconnect();
    clearTimeout(leaveTimer);
    leaveTimer = 0;
    popup.close();
  }

  function isInside(rect, x, y) {
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function checkLeave() {
    if (!popup.isOpen()) return;
    const inside =
      isInside(popup.getBlock().getBoundingClientRect(), mouseX, mouseY) || isInside(popup.getRect(), mouseX, mouseY);
    if (inside) {
      clearTimeout(leaveTimer);
      leaveTimer = 0;
    } else if (!leaveTimer) {
      leaveTimer = setTimeout(closePopup, LEAVE_GRACE_MS);
    }
  }

  function scheduleTrigger() {
    clearTimeout(triggerTimer);
    triggerTimer = setTimeout(trigger, TRIGGER_DELAY_MS);
  }

  function releaseAlt() {
    altDown = false;
    clearTimeout(triggerTimer);
  }

  addEventListener(
    'mousemove',
    (event) => {
      mouseX = event.clientX;
      mouseY = event.clientY;
      if (altDown && !event.altKey) releaseAlt(); // keyup happened outside the page
      if (altDown && !combo) scheduleTrigger();
      if (event.buttons === 0) checkLeave(); // a drag, e.g. selecting popup text, never closes it
    },
    { capture: true, passive: true },
  );

  addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Alt') {
        if (event.repeat) return;
        altDown = true;
        // Ctrl/Shift/Meta already held (Ctrl+Alt+…, the Alt+Shift layout switch) is not a translation request.
        combo = event.ctrlKey || event.shiftKey || event.metaKey;
        usedAlt = false;
        if (!combo) scheduleTrigger();
        return;
      }
      if (altDown) {
        combo = true; // Alt+Tab, Alt+←, … are not translation requests
        clearTimeout(triggerTimer);
      }
      if (event.key === 'Escape' && popup.isOpen()) closePopup();
    },
    true,
  );

  addEventListener(
    'keyup',
    (event) => {
      if (event.key !== 'Alt') return;
      releaseAlt();
      if (usedAlt) {
        usedAlt = false;
        event.preventDefault(); // stop Chrome on Windows from focusing its "⋮" menu
      }
    },
    true,
  );

  addEventListener('blur', releaseAlt);

  addEventListener(
    'scroll',
    () => {
      if (popup.isOpen()) popup.follow();
    },
    { capture: true, passive: true },
  );

  addEventListener('resize', () => {
    if (popup.isOpen()) closePopup();
  });

  addEventListener(
    'mousedown',
    (event) => {
      if (popup.isOpen() && !popup.isOwn(event.target)) closePopup();
    },
    true,
  );

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) cache.clear();
  });
})();
