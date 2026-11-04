import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redirectFor } from '../src/client/platform/migration/redirect.js';

// Part 03.10, FR-04: an old address leads to its page and keeps the query and the part after #.
test('an old address is redirected to the page that replaced it, keeping its query string and fragment', () => {
  const list = [{ from: '/admin/people', to: '/admin/users' }, { from: '/old/report', to: '/admin/audit' }];
  assert.equal(redirectFor(list, { path: '/admin/people', search: '?q=sharma&page=2', hash: '#row-4' }), '/admin/users?q=sharma&page=2#row-4');
  assert.equal(redirectFor(list, { path: '/old/report', search: '', hash: '' }), '/admin/audit');
  assert.equal(redirectFor(list, { path: '/admin/nowhere', search: '', hash: '' }), null, 'an address nobody registered stays unknown');
  assert.equal(redirectFor([], { path: '/admin/people', search: '', hash: '' }), null);
});
