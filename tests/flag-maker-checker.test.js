import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi, testConfig } from './helpers.js';
import { flagArea } from '../src/server/modules/core/feature-flags/service.js';

// Audit AUD-DEF-009 / D-002: in staging and production a feature-flag change is a configuration change, maker-checker by the approval
// reference (07, part 29.01: SYSADM -> ITADM; financial and security areas -> CFO or DIR too) and the role catalogue (06, SYSADM).
const F = '/api/v1/core/feature-flags';
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const as = (roles, user) => ({ roles, user, company: '1' });
const sys = as('SYSADM', 'sys1'); const it = as('ITADM', 'it1'); const it2 = as('ITADM', 'it2'); const cfo = as('CFO', 'cfo1');
let n = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `mc-${Date.now()}-${(n += 1)}-key` });

async function production() {
  const api = await startApi({}, { config: { ...testConfig(), environment: 'production' } }); opened.push(api); await setupCompany(api);
  for (const [u, r] of [['sys1', 'SYSADM'], ['it1', 'ITADM'], ['it2', 'ITADM'], ['cfo1', 'CFO']]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([r]), `${u}@example.com`);
  const value = (k) => api.db.prepare('SELECT enabled FROM core_feature_flags WHERE key = ? AND company_id = 1 AND project_id IS NULL').get(k)?.enabled ?? null;
  const change = (who, k, enabled) => api.call('PATCH', `${F}/${k}`, { ...who, headers: key(), body: { scope: { level: 'company', companyId: 1 }, enabled, reason: 'Switch on for the pilot company' } });
  const decide = (who, id, decision = 'APPROVE', note) => api.call('POST', `${F}/changes/${id}/decide`, { ...who, headers: key(), body: { decision, ...(note ? { note } : {}) } });
  return { api, value, change, decide };
}

test('BR-AUD-009 the area of a flag follows its module', () => {
  assert.equal(flagArea('ff.fin.p2301'), 'FINANCIAL'); assert.equal(flagArea('ff.iam.p0206'), 'SECURITY'); assert.equal(flagArea('ff.ui.p0301'), 'GENERAL');
});

test('BR-AUD-009 in production a flag change waits for an IT administrator: the maker cannot approve it, the checker applies it', async () => {
  const t = await production(); const k = 'ff.ui.p0302'; const before = t.value(k);
  const r = await t.change(sys, k, true);
  assert.equal(r.status, 202, JSON.stringify(r.json)); assert.equal(r.json.data.pending, true);
  const req = r.json.data.request; assert.match(req.docNo, /^FLG\//); assert.equal(req.status, 'PENDING'); assert.equal(req.area, 'GENERAL');
  assert.equal(t.value(k), before, 'nothing changes until it is approved');
  assert.equal((await t.change(sys, k, true)).status, 422, 'one open request per flag and scope');
  assert.equal((await t.decide(sys, req.id)).status, 403, 'the maker does not approve their own change (SYSADM has no core.flag.approve either)');
  const listed = await t.api.call('GET', `${F}/changes?status=PENDING`, it); assert.equal(listed.status, 200); assert.ok(listed.json.data.some((x) => x.docNo === req.docNo));
  assert.equal((await t.decide(it, req.id)).status, 200);
  assert.equal((await t.decide(it2, req.id)).status, 422, 'decided once');
  assert.equal(t.value(k), 1, 'applied on approval');
  const row = t.api.db.prepare('SELECT status, requested_by, decided_by FROM core_flag_changes WHERE id = ?').get(req.id);
  assert.deepEqual({ ...row }, { status: 'APPLIED', requested_by: 'sys1', decided_by: 'it1' });
  const remarks = t.api.db.prepare('SELECT remarks FROM core_feature_flags WHERE key = ? AND company_id = 1 AND project_id IS NULL').get(k).remarks;
  assert.match(remarks, /requested by sys1, approved by it1/);
});

test('BR-AUD-009 a financial flag needs the CFO or a director after the IT administrator', async () => {
  const t = await production(); const k = 'ff.fin.p2301'; const before = t.value(k);
  const r = await t.change(sys, k, true); assert.equal(r.status, 202); const req = r.json.data.request; assert.equal(req.area, 'FINANCIAL');
  assert.equal((await t.decide(it2, req.id)).status, 200);
  assert.equal(t.value(k), before, 'not yet: the CFO or a director still decides');
  assert.equal((await t.decide(it2, req.id)).status, 403, 'the second approval is a different person');
  assert.equal((await t.decide(cfo, req.id)).status, 200);
  assert.equal(t.value(k), 1);
  const row = t.api.db.prepare('SELECT status, first_approved_by, decided_by FROM core_flag_changes WHERE id = ?').get(req.id);
  assert.deepEqual({ ...row }, { status: 'APPLIED', first_approved_by: 'it2', decided_by: 'cfo1' });
});

test('BR-AUD-009 a rejected change needs a reason and changes nothing; the requester may cancel their own request', async () => {
  const t = await production(); const k = 'ff.ui.p0303'; const before = t.value(k);
  const a = (await t.change(sys, k, true)).json.data.request;
  assert.equal((await t.decide(it, a.id, 'REJECT')).status, 400, 'a reason is required');
  assert.equal((await t.decide(it, a.id, 'REJECT', 'Not before the pilot sign-off')).json.data.status, 'REJECTED');
  assert.equal(t.value(k), before);
  const b = (await t.change(sys, k, true)).json.data.request;
  assert.equal((await t.api.call('POST', `${F}/changes/${b.id}/cancel`, { ...sys, headers: key(), body: { reason: 'Raised by mistake' } })).json.data.status, 'CANCELLED');
});

test('BR-AUD-009 in development and test a flag still changes at once (audited), so the suites can set their flags', async () => {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  const r = await api.call('PATCH', `${F}/ff.ui.p0302`, { ...sys, headers: key(), body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'Switch on for the pilot company' } });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.data.enabled, true);
});
