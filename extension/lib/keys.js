// The keys: one held to read (Alt or Ctrl) and a shortcut to write. A shortcut is { ctrl, alt, shift, meta, code }:
// the modifiers and the physical key (KeyA..KeyZ, Digit0..Digit9), so it works in any keyboard layout. Shortcuts that
// type text, or that the browser or the system needs, are refused with the reason; stored ones fall back to the
// defaults.

export const READ_KEYS = Object.freeze(['Alt', 'Control']);

export const DEFAULT_KEYS = Object.freeze({
  read: 'Alt',
  write: Object.freeze({ ctrl: false, alt: true, shift: false, meta: false, code: 'KeyT' }),
});

const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'];
const KEY_CODE = /^(Key[A-Z]|Digit[0-9])$/;

// Chrome's shortcuts on Windows, Linux and ChromeOS that a page shortcut would take over.
const CHROME_CTRL_SHIFT = {
  A: 'searches the open tabs',
  B: 'shows the bookmarks bar',
  C: 'opens the developer tools',
  D: 'bookmarks all tabs',
  G: 'finds the previous match',
  I: 'opens the developer tools',
  J: 'opens the developer tools',
  M: 'switches the profile',
  N: 'opens an incognito window',
  O: 'opens the bookmarks',
  Q: 'quits Chrome',
  R: 'reloads without the cache',
  T: 'reopens a closed tab',
  V: 'pastes plain text',
  W: 'closes the window',
  Y: 'opens the Paragloss window at the toolbar',
  Z: 'redoes',
};
const CHROME_ALT = { F: 'opens the Chrome menu', E: 'opens the Chrome menu', D: 'goes to the address bar' };

const NAMES = {
  mac: { ctrl: 'Control', alt: 'Option', shift: 'Shift', meta: 'Command' },
  win: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' },
  other: { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Super' },
};
const namesOf = (platform) => NAMES[platform] ?? NAMES.other;

// 'mac', 'win', 'cros' or 'linux', from the navigator.
export function currentPlatform(navigator = globalThis.navigator) {
  const name = String(navigator?.userAgentData?.platform || navigator?.platform || '').toLowerCase();
  if (name.startsWith('mac')) return 'mac';
  if (name.startsWith('win')) return 'win';
  if (name.includes('chrome os') || name.includes('cros')) return 'cros';
  return 'linux';
}

export function shortcutFromEvent(event) {
  return { ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey, code: event.code };
}

const keyLabel = (code) => code.replace(/^(Key|Digit)/, '');

export function formatShortcut(shortcut, platform) {
  const names = namesOf(platform);
  return [...MODIFIERS.filter((modifier) => shortcut[modifier]).map((modifier) => names[modifier]), keyLabel(shortcut.code)].join('+');
}

export function readKeyName(read, platform) {
  return namesOf(platform)[read === 'Control' ? 'ctrl' : 'alt'];
}

// Why the shortcut cannot write, or null when it can.
export function shortcutProblem(shortcut, platform) {
  const { ctrl, alt, shift, meta, code } = shortcut;
  const mac = platform === 'mac';
  if (!KEY_CODE.test(code)) return 'Press Alt or Ctrl with a letter or a digit.';
  if (meta) {
    if (mac) return 'Shortcuts with Command belong to the browser and macOS.';
    if (platform === 'win') return 'Shortcuts with the Windows key belong to Windows.';
    return 'Shortcuts with the Super key belong to the system.';
  }
  if (!ctrl && !alt) return 'Add Alt or Ctrl: without them the key types text.';
  if (ctrl && alt) return mac ? 'Control+Option is the VoiceOver key.' : 'Ctrl+Alt is AltGr: in many layouts it types characters such as @ or €.';
  if (ctrl && !shift) {
    return mac
      ? 'Control with a letter or a digit belongs to text editing and macOS.'
      : 'Ctrl with a letter or a digit belongs to the browser and to text editing.';
  }
  if (mac) return null; // Chrome on a Mac uses Command; Option and Control+Shift are free
  if (alt && shift) return 'Alt+Shift switches the keyboard layout.';
  const name = formatShortcut(shortcut, platform);
  const key = keyLabel(code);
  if (ctrl) {
    if (key === 'U' && platform !== 'win') return `${name} starts typing a Unicode character.`;
    return Object.hasOwn(CHROME_CTRL_SHIFT, key) ? `${name} ${CHROME_CTRL_SHIFT[key]}.` : null;
  }
  if (Object.hasOwn(CHROME_ALT, key)) return `${name} ${CHROME_ALT[key]}.`;
  if (/^\d$/.test(key) && platform !== 'win') return `${name} switches to a tab.`;
  return null;
}

// Stored keys, each replaced by its default when it is unknown, malformed or refused on this platform.
export function checkedKeys(stored, platform) {
  const read = READ_KEYS.includes(stored?.read) ? stored.read : DEFAULT_KEYS.read;
  const write = stored?.write;
  const wellFormed =
    write !== null &&
    typeof write === 'object' &&
    MODIFIERS.every((modifier) => typeof write[modifier] === 'boolean') &&
    typeof write.code === 'string';
  if (!wellFormed) return { read, write: DEFAULT_KEYS.write };
  const shortcut = Object.fromEntries([...MODIFIERS, 'code'].map((field) => [field, write[field]]));
  return { read, write: shortcutProblem(shortcut, platform) ? DEFAULT_KEYS.write : shortcut };
}
