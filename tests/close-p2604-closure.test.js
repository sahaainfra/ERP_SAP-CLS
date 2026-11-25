import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { U, attachFile, fill, key, ready } from './qa-helpers.js';

// Part 26.04 (audit AUD-DEF-004): the closeout checklist read from the owning modules, the final account and the final P&L snapshot,
// benchmarks approved with the closeout, PM -> PD -> CFO -> DIR, lessons reviewed by the project controls manager, and Project Setup's
// move to CLOSED checking the approved closeout.
const opened = [];
after(async () => { for (const api of opened) { await api.close(); api.db.close(); } });
const C = '/api/v1/close';

test('26.04 closeout: checklist, final account, P&L, benchmarks, approvals, lessons, project closure check', async () => {
  const r = await ready(opened);
  const call = (who, method, path, body) => r.api.call(method, `${C}${path}`, { ...who, headers: key(), body });
  const okay = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json.data; };
  const as = (role, user) => { r.d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(user, user, JSON.stringify([role]), `${user}@example.com`); return { roles: role, user, company: '1' }; };
  const cfo = as('CFO', 'cfo1'); const pcm = as('PCMGR', 'pcm1'); const com = as('COMMGR', 'com1');

  assert.equal((await call(U.pm, 'GET', '/closures')).status, 404, 'off until the part flag is on');
  r.d.prepare("UPDATE core_feature_flags SET default_enabled = 1, enabled = 1 WHERE key = 'ff.close.p2604' AND company_id IS NULL").run();

  const c = okay(await call(U.pm, 'POST', '/closures', { projectId: r.A }), 201);
  assert.equal((await call(U.pm, 'POST', '/closures', { projectId: r.A })).status, 409, 'one closeout per project');
  assert.equal((await call(U.se, 'POST', '/closures', { projectId: r.B })).status, 403);
  const auto = (d) => Object.fromEntries(d.checklist.filter((i) => i.kind === 'AUTO').map((i) => [i.code, i.status]));
  assert.deepEqual(auto(c), { HANDOVER: 'OPEN', DLP: 'OPEN', WORK_ORDERS: 'DONE', SNAGS: 'DONE', FINAL_ACCOUNT: 'OPEN', PL_SNAPSHOT: 'OPEN', LESSONS: 'OPEN' });
  let req = await call(U.pm, 'POST', `/closures/${c.id}/request`); assert.equal(req.status, 422);

  // the owners' records satisfy the automatic checks
  const h = fill(r.d, 'ho_handovers', { company_id: 1, org_project_id: r.A, doc_no: 'HO/C/1', title: 'Whole project', scope_type: 'PROJECT', status: 'ISSUED', effective_on: '2025-06-30', dlp_months: 12 });
  fill(r.d, 'dlp_periods', { company_id: 1, org_project_id: r.A, handover_id: h, doc_no: 'DLP/C/1', starts_on: '2025-06-30', ends_on: '2026-06-30', status: 'COMPLETED' });
  // an issued handover whose period was never opened still owes one
  const h2 = fill(r.d, 'ho_handovers', { company_id: 1, org_project_id: r.A, doc_no: 'HO/C/2', title: 'Annexe', scope_type: 'AREA', area_label: 'Annexe', status: 'ISSUED', effective_on: '2025-07-31', dlp_months: 12 });
  assert.equal(auto(okay(await call(U.pm, 'GET', `/closures/${c.id}`))).DLP, 'OPEN', 'the annexe has no period');
  fill(r.d, 'dlp_periods', { company_id: 1, org_project_id: r.A, handover_id: h2, doc_no: 'DLP/C/2', starts_on: '2025-07-31', ends_on: '2026-07-31', status: 'COMPLETED' });
  const snap = fill(r.d, 'pl_snapshots', { company_id: 1, org_project_id: r.A, period: '2026-10', status: 'APPROVED', frozen_at: '2026-11-05T00:00:00.000Z', revenue_cum_paise: 100_000_000_00, operating_profit_cum_paise: 8_000_000_00 });
  const draft = fill(r.d, 'pl_snapshots', { company_id: 1, org_project_id: r.A, period: '2026-09', status: 'DRAFT' });

  // FR-02 and FR-03
  assert.equal((await call(U.pm, 'PATCH', `/closures/${c.id}`, { finalAccount: 98_50_00_000 })).status, 422, 'agreed date and signed copy needed');
  const file = attachFile(r, 'cls_closures', c.id, 'final-account.pdf');
  okay(await call(com, 'PATCH', `/closures/${c.id}`, { finalAccount: 985000000, agreedOn: '2026-11-10', fileId: file }));
  assert.equal((await call(U.pm, 'PATCH', `/closures/${c.id}`, { snapshotId: draft })).status, 422, 'only an approved, frozen snapshot');
  let d = okay(await call(U.pm, 'PATCH', `/closures/${c.id}`, { snapshotId: snap, summary: 'Delivered with a small delay' }));
  assert.equal(d.revenue, 100_000_000); assert.equal(d.cost, 92_000_000); assert.equal(d.marginPct, 8);
  assert.ok(d.suggestions.some((s) => s.metricCode === 'MARGIN_PCT' && s.value === 8));

  // FR-04 a lesson: the author submits, the project controls manager publishes
  const l = okay(await call(U.se, 'POST', '/lessons', { projectId: r.A, title: 'Order long-lead MEP early', category: 'PROCUREMENT', whatHappened: 'Chillers arrived eight weeks late and held commissioning.', recommendation: 'Place chiller orders at design freeze, not at the MEP tender.', tags: 'mep chiller lead time' }), 201);
  assert.equal(okay(await call(U.pm, 'GET', '/lessons')).some((x) => x.id === l.id), false, 'a draft is seen by its author only');
  assert.equal((await call(U.pm, 'POST', `/lessons/${l.id}/submit`)).status, 404);
  const sub = okay(await call(U.se, 'POST', `/lessons/${l.id}/submit`), 202);
  assert.equal((await r.act(pcm, sub.workflowInstanceId)).status, 200);
  const found = okay(await call(U.pm, 'GET', '/lessons?q=chiller'));
  assert.equal(found.length, 1); assert.equal(found[0].status, 'PUBLISHED');
  assert.equal(okay(await call(U.pm, 'GET', '/lessons?q=nothing-like-this')).length, 0);

  // manual items: mandatory ones need evidence; one is not mandatory
  d = okay(await call(U.pm, 'GET', `/closures/${c.id}`));
  assert.deepEqual(auto(d), { HANDOVER: 'DONE', DLP: 'DONE', WORK_ORDERS: 'DONE', SNAGS: 'DONE', FINAL_ACCOUNT: 'DONE', PL_SNAPSHOT: 'DONE', LESSONS: 'DONE' });
  const manual = d.checklist.filter((i) => i.kind === 'MANUAL');
  assert.equal((await call(U.pm, 'POST', `/closure-items/${manual[0].id}/record`, { status: 'NOT_APPLICABLE', note: 'not needed' })).status, 422);
  assert.equal((await call(U.pm, 'POST', `/closure-items/${manual[0].id}/record`, { status: 'DONE' })).status, 422);
  for (const i of manual.filter((x) => x.mandatory)) okay(await call(U.pm, 'POST', `/closure-items/${i.id}/record`, { status: 'DONE', note: 'Settled and filed with the closeout' }));
  okay(await call(U.pm, 'POST', `/closures/${c.id}/benchmarks`, { metricCode: 'MARGIN_PCT', label: 'Final operating margin', unit: '%', value: 8 }), 201);
  assert.equal((await call(U.pm, 'POST', `/closures/${c.id}/benchmarks`, { metricCode: 'MARGIN_PCT', label: 'Again', unit: '%', value: 9 })).status, 409);

  // Project Setup's move to CLOSED checks the approved closeout (10.01)
  const { readinessProviders } = await import('../src/server/modules/proj/project.js');
  const check = () => readinessProviders.flatMap((p) => p(r.d, { company_id: 1, project_id: r.A }, { to: 'CLOSED' })).find((x) => x.code === 'CLOSEOUT');
  assert.equal(check().ok, false);

  // FR-05 PM -> PD -> CFO -> DIR
  const s = okay(await call(U.pm, 'POST', `/closures/${c.id}/request`), 202);
  assert.equal(s.status, 'SUBMITTED');
  assert.equal((await call(U.pm, 'PATCH', `/closures/${c.id}`, { summary: 'changed' })).status, 409, 'frozen while in approval');
  for (const who of [U.pd, cfo, U.dir]) assert.equal((await r.act(who, s.workflowInstanceId)).status, 200);
  d = okay(await call(U.aud, 'GET', `/closures/${c.id}`));
  assert.equal(d.status, 'APPROVED'); assert.ok(d.closedAt); assert.equal(d.benchmarks[0].status, 'APPROVED');
  const ev = r.events('cls.project.closed'); assert.equal(ev.length, 1); assert.equal(ev[0].finalAccount, 985000000);
  assert.equal(check().ok, true);
  const bm = okay(await call({ roles: 'EST', user: 'est1', company: '1' }, 'GET', '/benchmarks'));
  assert.equal(bm[0].metricCode, 'MARGIN_PCT'); assert.equal(bm[0].median, 8);

  assert.equal((await r.api.call('GET', `${C}/closures/export`, { ...U.pm })).status, 200);
  assert.equal((await call({ roles: 'PM', user: 'pmx', company: '2' }, 'GET', `/closures/${c.id}`)).status, 404, 'another company');
  assert.equal((await call(U.sk, 'GET', '/lessons')).status, 403);
});
