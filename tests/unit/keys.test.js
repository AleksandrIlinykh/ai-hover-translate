import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_KEYS,
  checkedKeys,
  currentPlatform,
  formatShortcut,
  readKeyName,
  shortcutFromEvent,
  shortcutProblem,
} from '../../extension/lib/keys.js';

const PLATFORMS = ['win', 'mac', 'linux', 'cros'];

// 'Ctrl+Shift+K' -> { ctrl: true, alt: false, shift: true, meta: false, code: 'KeyK' }; the last part is a letter,
// a digit or a key code.
function shortcut(text) {
  const parts = text.split('+');
  const last = parts.pop();
  const code = /^[A-Z]$/.test(last) ? `Key${last}` : /^\d$/.test(last) ? `Digit${last}` : last;
  return { ctrl: parts.includes('Ctrl'), alt: parts.includes('Alt'), shift: parts.includes('Shift'), meta: parts.includes('Meta'), code };
}

const problem = (text, platform = 'win') => shortcutProblem(shortcut(text), platform);

test('by default Alt reads and Alt+T writes, which every platform allows', () => {
  assert.deepEqual(DEFAULT_KEYS, { read: 'Alt', write: shortcut('Alt+T') });
  for (const platform of PLATFORMS) assert.equal(shortcutProblem(DEFAULT_KEYS.write, platform), null, platform);
});

test('a shortcut is taken from the physical key, whatever letter the layout puts on it', () => {
  const event = { code: 'KeyT', key: String.fromCharCode(0x435), altKey: true, ctrlKey: false, shiftKey: false, metaKey: false };
  assert.deepEqual(shortcutFromEvent(event), shortcut('Alt+T'));
});

test('a shortcut needs a letter or a digit', () => {
  for (const text of ['Alt+F5', 'Alt+Space', 'Alt+AltLeft', 'Ctrl+Shift+Enter', 'Alt+Minus']) {
    assert.equal(problem(text), 'Press Alt or Ctrl with a letter or a digit.', text);
  }
});

test('a letter alone or with Shift types text', () => {
  for (const text of ['K', 'Shift+K', '5']) assert.equal(problem(text), 'Add Alt or Ctrl: without them the key types text.', text);
});

test('the Windows, Command and Super keys belong to the system', () => {
  assert.equal(problem('Meta+Alt+K', 'win'), 'Shortcuts with the Windows key belong to Windows.');
  assert.equal(problem('Meta+Alt+K', 'mac'), 'Shortcuts with Command belong to the browser and macOS.');
  assert.equal(problem('Meta+Alt+K', 'linux'), 'Shortcuts with the Super key belong to the system.');
});

test('Ctrl with a letter or a digit belongs to the browser and to text editing', () => {
  for (const text of ['Ctrl+K', 'Ctrl+T', 'Ctrl+7']) {
    assert.equal(problem(text, 'win'), 'Ctrl with a letter or a digit belongs to the browser and to text editing.', text);
    assert.equal(problem(text, 'mac'), 'Control with a letter or a digit belongs to text editing and macOS.', text);
  }
});

test('Ctrl+Alt types characters on Windows and Linux, and is the VoiceOver key on a Mac', () => {
  assert.equal(problem('Ctrl+Alt+K', 'win'), 'Ctrl+Alt is AltGr: in many layouts it types characters such as @ or €.');
  assert.equal(problem('Ctrl+Alt+Shift+K', 'linux'), 'Ctrl+Alt is AltGr: in many layouts it types characters such as @ or €.');
  assert.equal(problem('Ctrl+Alt+K', 'mac'), 'Control+Option is the VoiceOver key.');
});

test('Alt+Shift switches the keyboard layout on Windows and Linux, not on a Mac', () => {
  assert.equal(problem('Alt+Shift+K', 'win'), 'Alt+Shift switches the keyboard layout.');
  assert.equal(problem('Alt+Shift+K', 'cros'), 'Alt+Shift switches the keyboard layout.');
  assert.equal(problem('Alt+Shift+K', 'mac'), null);
});

test("Chrome's own Ctrl+Shift shortcuts are refused with what they do, others are allowed", () => {
  assert.equal(problem('Ctrl+Shift+T'), 'Ctrl+Shift+T reopens a closed tab.');
  assert.equal(problem('Ctrl+Shift+N'), 'Ctrl+Shift+N opens an incognito window.');
  assert.equal(problem('Ctrl+Shift+I'), 'Ctrl+Shift+I opens the developer tools.');
  assert.equal(problem('Ctrl+Shift+Y'), 'Ctrl+Shift+Y opens the SpotSlate window at the toolbar.');
  assert.equal(problem('Ctrl+Shift+U', 'linux'), 'Ctrl+Shift+U starts typing a Unicode character.');
  assert.equal(problem('Ctrl+Shift+K'), null);
  assert.equal(problem('Ctrl+Shift+5'), null);
  assert.equal(problem('Ctrl+Shift+T', 'mac'), null); // Chrome on a Mac uses Command
});

test("Chrome's own Alt shortcuts are refused on Windows and Linux", () => {
  assert.equal(problem('Alt+F'), 'Alt+F opens the Chrome menu.');
  assert.equal(problem('Alt+E', 'linux'), 'Alt+E opens the Chrome menu.');
  assert.equal(problem('Alt+D'), 'Alt+D goes to the address bar.');
  assert.equal(problem('Alt+3', 'linux'), 'Alt+3 switches to a tab.');
  assert.equal(problem('Alt+3', 'win'), null);
  assert.equal(problem('Alt+F', 'mac'), null);
  assert.equal(problem('Alt+W'), null);
});

test('shortcuts are written the way each platform names its keys', () => {
  assert.equal(formatShortcut(shortcut('Alt+T'), 'win'), 'Alt+T');
  assert.equal(formatShortcut(shortcut('Ctrl+Shift+5'), 'linux'), 'Ctrl+Shift+5');
  assert.equal(formatShortcut(shortcut('Alt+T'), 'mac'), 'Option+T');
  assert.equal(formatShortcut(shortcut('Ctrl+Alt+Shift+Meta+K'), 'mac'), 'Control+Option+Shift+Command+K');
  assert.equal(formatShortcut(shortcut('Meta+K'), 'win'), 'Win+K');
  assert.equal(readKeyName('Alt', 'win'), 'Alt');
  assert.equal(readKeyName('Alt', 'mac'), 'Option');
  assert.equal(readKeyName('Control', 'linux'), 'Ctrl');
  assert.equal(readKeyName('Control', 'mac'), 'Control');
});

test('stored keys are kept when they are allowed, and replaced by the defaults when they are not', () => {
  const custom = { read: 'Control', write: shortcut('Ctrl+Shift+K') };
  assert.deepEqual(checkedKeys(custom, 'win'), custom);
  assert.deepEqual(checkedKeys(undefined, 'win'), DEFAULT_KEYS);
  assert.deepEqual(checkedKeys({ read: 'Shift', write: shortcut('Alt+W') }, 'win'), { read: 'Alt', write: shortcut('Alt+W') });
  assert.deepEqual(checkedKeys({ read: 'Alt', write: shortcut('Ctrl+T') }, 'win'), DEFAULT_KEYS);
  assert.deepEqual(checkedKeys({ read: 'Alt', write: shortcut('Alt+F') }, 'win'), DEFAULT_KEYS);
  assert.deepEqual(checkedKeys({ write: { ...shortcut('Alt+W'), alt: 'yes', extra: 1 } }, 'win'), DEFAULT_KEYS);
  assert.deepEqual(checkedKeys({ write: 'Alt+W' }, 'win'), DEFAULT_KEYS);
});

test('the platform comes from what the browser says about itself', () => {
  assert.equal(currentPlatform({ userAgentData: { platform: 'macOS' } }), 'mac');
  assert.equal(currentPlatform({ userAgentData: { platform: 'Windows' } }), 'win');
  assert.equal(currentPlatform({ userAgentData: { platform: 'Chrome OS' } }), 'cros');
  assert.equal(currentPlatform({ platform: 'MacIntel' }), 'mac');
  assert.equal(currentPlatform({ platform: 'Win32' }), 'win');
  assert.equal(currentPlatform({ platform: 'Linux x86_64' }), 'linux');
  assert.equal(currentPlatform({}), 'linux');
});
