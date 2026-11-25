import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { startApi } from './helpers.js';
import { ROLE_TEMPLATES } from '../src/server/platform/authz/templates.js';
import { keyEndpointsOf } from '../src/server/modules/tst/catalogue.js';

// Part 30.04 FR-02: the permission matrix. Every role of the role catalogue against the key endpoint of every module (its first guarded list):
// a role that holds one of the endpoint's permissions is let through the Authorise stage, a role that holds none is refused with 403, and
// nobody unsigned gets in (401). The 30.05 authorisation matrix goes further: every route against every role (tests/sct-authz-matrix.test.js).
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const DENIED = /Your role does not include/;

test('FR-02 every role × the key endpoint of every module: holders pass the Authorise stage, others get 403, nobody unsigned gets in', async () => {
  const api = await startApi(); opened.push(api);
  const endpoints = keyEndpointsOf();
  assert.ok(endpoints.length >= 25, `${endpoints.length} modules`);
  const problems = []; let cells = 0;
  for (const e of endpoints) {
    const keys = [e.k].flat();
    const none = await api.call('GET', e.p, { user: null, roles: '', company: null });
    if (none.status !== 401) problems.push(`${e.p} unsigned: ${none.status}`);
    for (const role of ROLE_TEMPLATES) {
      cells += 1;
      const holds = keys.some((k) => role.permissions.includes(k));
      const r = await api.call('GET', e.p, { user: `pm-${role.code.toLowerCase()}`, roles: role.code });
      const denied = r.status === 403 && DENIED.test(r.json?.error?.message ?? '');
      if (holds && denied) problems.push(`${role.code} holds ${keys.join('|')} but is refused ${e.p}`);
      if (!holds && r.status !== 403) problems.push(`${role.code} holds none of ${keys.join('|')} but ${e.p} answered ${r.status}`);
    }
  }
  assert.equal(cells, endpoints.length * ROLE_TEMPLATES.length);
  assert.deepEqual(problems, []);
});
