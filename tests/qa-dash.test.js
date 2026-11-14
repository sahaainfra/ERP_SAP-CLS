import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { qaOf } from '../src/server/modules/qa/index.js';
import { controlLimits } from '../src/server/modules/qa/dash.js';
import { project360Providers } from '../src/server/modules/proj/p360.js';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, fill, partnerOf } from './qa-helpers.js';

// Part 18.07: the quality dashboard from live data, the control chart limits (T-01), ratings, scope and the Project 360 slot.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

test('T-01 the X-bar and R limits: A2, D3, D4 and d2 of the subgroup size give the control limits, the points beyond them and a long run', () => {
  const l = controlLimits([[30, 31, 32], [33, 32, 34], [29, 30, 31], [31, 33, 32]]); assert.deepEqual([l.n, l.k, l.grandMean, l.rBar], [3, 4, 31.5, 2]); assert.deepEqual([l.ucl, l.lcl, l.uclR, l.lclR, l.sigmaHat], [33.55, 29.45, 5.15, 0, 1.18], '31.5 +/- 1.023 x 2; D4 2.574 x 2; sigma = R-bar / 1.693'); assert.deepEqual([l.outX, l.outR, l.longRun, l.provisional], [[], [], false, true]);
  const out = controlLimits([[30, 31, 32], [31, 32, 31], [30, 32, 31], [31, 31, 32], [30, 31, 31], [31, 30, 32], [45, 46, 47]]); assert.ok(out.outX.includes(6), 'a subgroup far above the chart is out of control');
  const wide = controlLimits([[30, 31, 32], [30, 31, 32], [30, 31, 32], [30, 31, 32], [30, 40, 32]]); assert.ok(wide.outR.includes(4), 'a wide range is out of control on the R chart');
  const run = controlLimits([...Array(8).fill([31, 32, 33]), ...Array(8).fill([27, 28, 29])]); assert.equal(run.longRun, true, 'eight in a row on one side of the centre line');
  const two = controlLimits([[10, 12], [11, 14], [10, 11]]); assert.deepEqual([two.n, two.grandMean, two.rBar, two.ucl, two.uclR], [2, 11.33, 2, 15.09, 6.53], 'n = 2 uses its own factors (A2 1.880, D4 3.267)'); assert.equal(controlLimits([[1, 2, 3], [1, 2]]), null, 'unequal subgroups are not charted'); assert.equal(controlLimits([[1, 2, 3]]), null, 'one subgroup has no limits');
});

async function world(r) {
  const d = r.d; const subA = partnerOf(r, 'Alpha Finishers'); const subB = partnerOf(r, 'Beta Builders'); const supX = partnerOf(r, 'Xcel Ready-Mix'); const supY = partnerOf(r, 'Yash Concrete');
  const ir = (status, result, o = {}) => fill(d, 'qa_inspection_requests', { company_id: 1, org_project_id: r.A, org_site_id: r.site, activity_id: r.a1, description: 'IR', requested_for: plus(-3), requested_at: `${plus(-5)}T05:00:00Z`, status, result, ...o });
  ir('APPROVED', 'APPROVED'); ir('APPROVED', 'APPROVED_WITH_COMMENTS'); ir('REJECTED', 'REJECTED'); ir('SUBMITTED', null);
  const ncr = (o) => fill(d, 'qa_ncrs', { company_id: 1, org_project_id: r.A, org_site_id: r.site, description: 'NCR', status: 'OPEN', ncr_type: 'WORKMANSHIP', severity: 'MAJOR', responsible_type: 'SUBCONTRACTOR', responsible_id: subA, rectification_cost: 500000, ...o });
  ncr({ severity: 'CRITICAL' }); ncr({ responsible_id: subB, severity: 'MAJOR' }); ncr({ responsible_id: subB, severity: 'MAJOR' }); const closed = ncr({ status: 'CLOSED', severity: 'MINOR', responsible_id: subA, closed_at: `${plus(-1)}T10:00:00Z`, created_at: `${plus(-11)}T10:00:00Z` }); void closed;
  ncr({ responsible_type: 'SUPPLIER', responsible_id: supY, severity: 'MAJOR', ncr_type: 'MATERIAL' });
  const sn = (o) => fill(d, 'qa_snags', { company_id: 1, org_project_id: r.A, org_site_id: r.site, category: 'FINISHING', description: 'Snag', responsible_type: 'SUBCONTRACTOR', responsible_id: subB, raised_by: 'x', status: 'OPEN', ...o });
  sn({ status: 'CLOSED', punch_class: 'A' }); sn({ punch_class: 'A', due_date: plus(-2) }); sn({ punch_class: 'C' });
  const card = fill(d, 'qa_pour_cards', { company_id: 1, org_project_id: r.A, org_site_id: r.site, element: 'Footing', grade: 'M25', fck_mpa: 25, status: 'APPROVED' });
  const tk = (v) => fill(d, 'qa_pour_tickets', { company_id: 1, pour_card_id: card, ticket_no: `T-${Math.random().toString(36).slice(2, 8)}`, vendor_id: v, qty: 5000, delivered_at: nowIso() });
  const nowIso = () => new Date().toISOString(); const tx = tk(supX); const ty = tk(supY);
  const data = [[28, 29, 30, tx], [29, 30, 31, tx], [30, 31, 32, tx], [27, 28, 29, ty], [28, 29, 30, ty], [19, 20, 21, ty]];
  data.forEach(([a, b, c, t], i) => { const sample = fill(d, 'qa_cube_samples', { company_id: 1, doc_no: `CUBE/${i}`, pour_card_id: card, ticket_id: t, cubes_count: 3, cast_date: plus(-40 + i), due_7: plus(-33 + i), due_28: plus(-12 + i), qr_code: `ERP:CUBE:${i}` }); const m = (a + b + c) / 3; fill(d, 'qa_cube_results', { company_id: 1, sample_id: sample, age_days: 28, strengths_json: JSON.stringify([a, b, c]), mean_e3: Math.round(m * 1000), min_e3: Math.min(a, b, c) * 1000, tested_on: plus(-10 + i), acceptance: m >= 22 ? 'PASS' : 'FAIL' }); });
  return { subA, subB, supX, supY, data };
}

test('FR-01 BR-01 AC-01 the dashboard reads live QA data: first-time approval, open items by age, closure time, cube failures, snag closure, cost; colours follow the targets; exceptions drill to the records', async () => {
  const r = await ready(opened); await world(r); const nope = await r.call(U.se, 'GET', '/dashboard'); assert.equal(nope.status, 403, 'the site engineer has no dashboard');
  const res = await r.call(U.pm, 'GET', '/dashboard'); assert.equal(res.status, 200, JSON.stringify(res.json)); const k = Object.fromEntries(res.json.data.kpis.map((x) => [x.key, x]));
  assert.deepEqual([k.firstTimeIr.value, k.firstTimeIr.n, k.firstTimeIr.target, k.firstTimeIr.status], [66.7, 3, 85, 'red'], '2 of 3 first inspections approved against the target of 85');
  assert.deepEqual([k.openIr.value, k.openNcr.value, k.openNcr.status], [1, 4, 'red'], 'a critical NCR is open'); assert.deepEqual([k.ncrClosure.value, k.ncrClosure.n], [10, 1], 'the closed NCR took ten days'); assert.deepEqual([k.cubeFail.value, k.cubeFail.n, k.cubeFail.status], [16.7, 6, 'red']); assert.deepEqual([k.snagClosure.value, k.snagClosure.n], [33.3, 3]); assert.equal(k.rectCost.value, 25000, '5 x Rs 5,000');
  const ex = res.json.data.exceptions.map((e) => e.key); assert.ok(['criticalNcr', 'overdueIr', 'classA'].every((x) => ex.includes(x))); assert.match(res.json.data.exceptions.find((e) => e.key === 'criticalNcr').drill, /severity\]=CRITICAL/); assert.deepEqual(res.json.data.ageing.ncr.map((b) => b.count).reduce((a, b) => a + b, 0), 4);
  const pj = await r.call(U.pm, 'GET', `/dashboard?projectId=${r.B}`); assert.deepEqual([pj.json.data.kpis.find((x) => x.key === 'openNcr').value, pj.json.data.kpis.find((x) => x.key === 'firstTimeIr').value], [0, null], 'another project has none'); assert.equal((await r.call(U.other, 'GET', '/dashboard')).json.data.kpis.find((x) => x.key === 'openNcr').value, 0, 'another company sees nothing');
  const csv = await r.api.raw('GET', '/api/v1/qa/dashboard/export', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /First-time IR approval/); const pdf = await r.api.raw('GET', '/api/v1/qa/dashboard/pdf', { ...U.dir }); assert.equal(pdf.status, 200); assert.equal((await r.api.raw('GET', '/api/v1/qa/dashboard/export', { ...U.pd })).status, 403, 'the project director views and does not export');
  const w = qaOf(r.d).dsh.widget({ user: 'pm1', userId: 1, companyId: 1, roles: ['PM'] }, 'qa.first_time_ir'); assert.ok(w.value >= 0);
  const slot = project360Providers.get('quality'); const out = slot({ db: r.d, actor: { ...U.pm, user: 'pm1', companyId: 1, roles: ['PM'] }, project: { project_id: r.A } }); assert.ok(Array.isArray(out.figures)); assert.ok(out.note === undefined || typeof out.note === 'string');
});

test('FR-02 FR-03 the control chart matches the limits of the subgroups; grade and supplier filter it; ratings by subcontractor, supplier and site; the supplier scores for the scorecard', async () => {
  const r = await ready(opened); const w = await world(r); const ch = (await r.call(U.qcm, 'GET', '/control-charts?grade=M25')).json.data; const exp = controlLimits(w.data.map(([a, b, c]) => [a, b, c]));
  assert.deepEqual([ch.grade, ch.n, ch.points.length, ch.fck], ['M25', 3, 6, 25]); assert.deepEqual([ch.limits.grandMean, ch.limits.ucl, ch.limits.lcl, ch.limits.uclR, ch.limits.sigmaHat], [exp.grandMean, exp.ucl, exp.lcl, exp.uclR, exp.sigmaHat]); assert.deepEqual(ch.points.map((p) => p.xbar), exp.xbars); assert.deepEqual(ch.grades, ['M25']); assert.equal(ch.suppliers.length, 2);
  assert.equal(ch.points[5].outX, exp.outX.includes(5), 'the failing sample is flagged when it is beyond the limit'); assert.equal(ch.sdTrend.length, 6); assert.equal(ch.sdTrend[3], null, 'the standard deviation needs five points'); assert.equal(typeof ch.sdTrend[5], 'number');
  const sup = (await r.call(U.qcm, 'GET', `/control-charts?grade=M25&supplierId=${w.supY}`)).json.data; assert.deepEqual([sup.points.length, sup.supplierId], [3, w.supY]); assert.equal((await r.call(U.pm, 'GET', '/control-charts?grade=M99')).json.data.points.length, 0); assert.equal((await r.call(U.se, 'GET', '/control-charts')).status, 403);
  const sub = (await r.call(U.qcm, 'GET', '/ratings?by=subcontractor')).json.data; assert.equal(sub.by, 'subcontractor'); const a = sub.rows.find((x) => x.name === 'Alpha Finishers'); const b = sub.rows.find((x) => x.name === 'Beta Builders'); assert.deepEqual([a.score, a.band, a.points.ncr], [88, 'B', 12], 'a critical (10) and a minor (2) NCR'); assert.deepEqual([b.score, b.points.ncr, b.points.snagOverdue], [89, 10, 1], 'two major NCRs (5 each) and an overdue snag (1)'); assert.deepEqual(sub.rows.map((x) => x.score), [...sub.rows.map((x) => x.score)].sort((x, y) => x - y), 'worst first');
  const supR = (await r.call(U.qcm, 'GET', '/ratings?by=supplier')).json.data; const y = supR.rows.find((x) => x.name === 'Yash Concrete'); const x = supR.rows.find((q) => q.name === 'Xcel Ready-Mix'); assert.deepEqual([x.score, x.counts.cubeFails, y.counts.cubeFails, y.counts.ncrs], [100, 0, 1, 1]); assert.equal(y.points.cubeFails, 8); assert.equal(y.score, 100 - 8 - 5, 'a failed cube (8) and a major NCR (5)');
  const site = (await r.call(U.pm, 'GET', '/ratings?by=site')).json.data.rows; assert.equal(site.length, 1); assert.ok(site[0].score >= 0 && site[0].score <= 100); assert.equal((await r.call(U.pm, 'GET', '/ratings?by=bogus')).status, 400);
  const sc = qaOf(r.d).dsh.supplierScores(1).rows; assert.equal(sc.find((q) => q.name === 'Yash Concrete').score, 87, 'the nightly job publishes these to the vendor scorecard'); const csv = await r.api.raw('GET', '/api/v1/qa/dashboard/export?kind=chart&grade=M25', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /CUBE\/0/);
});
