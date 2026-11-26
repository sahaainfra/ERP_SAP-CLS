import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { toCsv } from '../src/server/platform/security/index.js';
import { ready } from './qa-helpers.js';

// Fixes from the platform code review (2026-11-26).
const opened = [];
after(async () => { for (const api of opened) { await api.close(); api.db.close(); } });

test('CSV exports keep negative numbers as numbers; text that starts like a formula is still neutralised', () => {
  assert.equal(toCsv(['Amount', 'Note'], [[-1500, '-5'], [2.5, '=SUM(A1)']]), "Amount,Note\r\n-1500,'-5\r\n2.5,'=SUM(A1)\r\n");
});

test('a malformed escape in a page address is not a server error', async () => {
  const r = await ready(opened);
  const res = await r.api.call('GET', '/anything/%zz', {});
  assert.notEqual(res.status, 500);
});
