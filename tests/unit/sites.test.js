import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SITE_MODE, siteModeOf, withSiteMode } from '../../extension/lib/sites.js';

test('a site without a mode of its own is on, with an AI provider if one is chosen, and learns its context', () => {
  assert.deepEqual(DEFAULT_SITE_MODE, { off: false, local: false, noContext: false });
  assert.deepEqual(siteModeOf(undefined, 'a.example'), DEFAULT_SITE_MODE);
  assert.deepEqual(siteModeOf({ 'b.example': { off: true } }, 'a.example'), DEFAULT_SITE_MODE);
});

test('a stored mode is read with every value checked', () => {
  assert.deepEqual(siteModeOf({ 'a.example': { off: true } }, 'a.example'), { off: true, local: false, noContext: false });
  assert.deepEqual(siteModeOf({ 'a.example': { local: 'yes', noContext: true, extra: 1 } }, 'a.example'), {
    off: false,
    local: false,
    noContext: true,
  });
});

test('setting a mode keeps the other sites, and a site back to the default leaves the list', () => {
  let sites = withSiteMode({}, 'a.example', { off: true });
  sites = withSiteMode(sites, 'b.example', { local: true, noContext: 'no' });
  assert.deepEqual(sites, {
    'a.example': { off: true, local: false, noContext: false },
    'b.example': { off: false, local: true, noContext: false },
  });
  assert.deepEqual(withSiteMode(sites, 'a.example', DEFAULT_SITE_MODE), { 'b.example': { off: false, local: true, noContext: false } });
  assert.deepEqual(withSiteMode(undefined, 'c.example', { noContext: true }), { 'c.example': { off: false, local: false, noContext: true } });
});
