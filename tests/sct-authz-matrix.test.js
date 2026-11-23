import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { startApi } from './helpers.js';
import { ROLE_TEMPLATES } from '../src/server/platform/authz/templates.js';
import { enforcePolicy, securityOf } from '../src/server/platform/security/index.js';
import { authzMatrix } from '../src/server/modules/tst/security.js';

// Part 30.05 FR-01 T-01: the generated authorisation tests. Every endpoint of the application × every role of the role catalogue × the
// way in (nobody, a role without the permission, a role with it), the expected answer worked out from the route policy and the role
// templates. 100 % of the live endpoints are covered:
//  - over HTTP, every route that is not public answers 401 to nobody, and every permission route 403 to a role holding none of its keys;
//    every permission GET lets a holder through the Authorise stage;
//  - in the process, the Authorise stage is asked for every route × every one of the 44 roles (about 225,000 cases).
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const DENIED = /Your role does not include/;
const fill = (p) => p.replace(/:[A-Za-z0-9_]+/g, '1');

test('T-01 FR-01 100 % of the live endpoints are in the generated matrix; every route × every role answers as the policy says', async () => {
  const api = await startApi(); opened.push(api);
  const sec = securityOf(api.db);
  const matrix = authzMatrix();
  const byKey = new Map(matrix.map((m) => [`${m.method} ${m.path}`, m]));
  const live = sec.registry.routes;
  const missing = live.filter((r) => !byKey.has(`${r.method} ${r.path}`)).map((r) => `${r.method} ${r.path}`);
  assert.deepEqual(missing, [], 'every live endpoint has its cases');
  assert.ok(live.length > 5000, `${live.length} live endpoints`);
  const coverage = (live.length - missing.length) / live.length;
  assert.equal(coverage, 1, '100 % of the endpoints');

  // in the process: the Authorise stage for every route × every role
  const stage = enforcePolicy({ policy: sec.policy, isFlagOn: () => true });
  const problems = []; let cases = 0;
  for (const m of matrix) {
    for (const role of ROLE_TEMPLATES) {
      cases += 1;
      let err = null; stage({ method: m.method, baseUrl: '', path: fill(m.path), actor: { user: `authz-${role.code}`, roles: [role.code], companyId: 1 } }, {}, (e) => { err = e ?? null; });
      const denied = err?.status === 403;
      const expectDenied = m.guard === 'permission' && m.denied.includes(role.code);
      if (denied !== expectDenied) problems.push(`${role.code} ${m.method} ${m.path}: ${denied ? 'refused' : 'let through'}`);
    }
  }
  assert.equal(cases, matrix.length * ROLE_TEMPLATES.length);
  assert.deepEqual(problems.slice(0, 20), [], `${problems.length} cases differ`);

  // over HTTP: nobody, a role without the permission, a holder (GET only: a holder's write would act)
  sec.limiter.suspend(true);
  try {
    const call = async (method, path, who) => {
      const h = { 'content-type': 'application/json', ...(who ? { 'x-erp-user': who.user, 'x-erp-roles': who.role, 'x-erp-company': '1' } : {}) };
      const res = await fetch(api.base + fill(path), { method, headers: h, body: ['GET', 'HEAD'].includes(method) ? undefined : '{}' });
      const j = await res.json().catch(() => null);
      return { status: res.status, message: j?.error?.message ?? '' };
    };
    const http = [];
    let anon = 0; let deny = 0; let allow = 0;
    for (const m of matrix) {
      if (m.guard === 'public' || m.guard === 'infra') continue;
      const a = await call(m.method, m.path, null); anon += 1;
      if (a.status !== 401) http.push(`nobody ${m.method} ${m.path}: ${a.status}`);
      if (m.guard !== 'permission') continue;
      if (m.denied.length) {
        const d = await call(m.method, m.path, { user: 'authz-deny', role: m.denied[0] }); deny += 1;
        if (!(d.status === 403 && DENIED.test(d.message))) http.push(`${m.denied[0]} ${m.method} ${m.path}: ${d.status} ${d.message.slice(0, 80)}`);
      }
      if (m.method === 'GET' && m.holders.length) {
        const h = await call(m.method, m.path, { user: 'authz-hold', role: m.holders[0] }); allow += 1;
        if (h.status === 403 && DENIED.test(h.message)) http.push(`${m.holders[0]} holds the key of ${m.method} ${m.path} but is refused`);
        if (h.status >= 500) http.push(`${m.holders[0]} ${m.method} ${m.path}: server error ${h.status}`);
      }
    }
    assert.ok(anon > 4000 && deny > 3000 && allow > 1500, `${anon} unsigned, ${deny} refused, ${allow} holder cases`);
    assert.deepEqual(http.slice(0, 30), [], `${http.length} HTTP cases differ`);
  } finally { sec.limiter.suspend(false); }
});
