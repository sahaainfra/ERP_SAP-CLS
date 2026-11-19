import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { ready as qaReady, as, fill, key, U as QU } from './qa-helpers.js';
import { bridgeOf, etcOf } from '../src/server/modules/fin/costforecast.js';

// Part 23.11: the cost forecast.
//  T-01 each ETC method reproduces its formula; the EAC bridge adds up to the change of the EAC.
//  and: a forecast from the facts of 14.07 with the risk allowance; methods per line; approval PCMGR → PM → PD (the CFO when loss-making); BR-01 one approved
//  a project and month, approved forecasts not changed (a new version supersedes); the EAC taken by revenue recognition (23.10); reports; rights.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const U = { ...QU, pcm: as('PCMGR', 'pcm1'), qs: as('QS', 'qs1'), pm: as('PM', 'pm1'), pd: as('PD', 'pd1'), cfo: as('CFO', 'cfo1'), acc: as('ACCMGR', 'acc1'), se: as('SE', 'se9') };
const F = '/api/v1/fin';

async function world() {
  const r = await qaReady(opened, { users: Object.values(U) }); const d = r.d;
  const call = (who, method, path, body, k = key()) => r.api.call(method, `${F}${path}`, { ...who, headers: k, body });
  assert.equal((await call(U.acc, 'GET', '/journals/options')).status, 200);
  const wbs = (project, code) => fill(d, 'proj_wbs', { company_id: 1, project_id: project, code, name: `Work ${code}` });
  const cc = (code) => fill(d, 'fin_cost_codes', { company_id: 1, code, name: `Cost ${code}` });
  const fact = (project, w, c, v) => fill(d, 'ctl_facts', { company_id: 1, org_project_id: project, wbs_id: w, cost_code_id: c, period_key: v.period ?? '', budget_cost: v.budget ?? 0, budget_qty: v.bqty ?? 0, committed_cost: v.committed ?? 0, actual_cost: v.actual ?? 0, actual_qty: v.aqty ?? 0, earned_cost: v.earned ?? 0, planned_qty: 0, planned_cost: 0, certified_value: 0, billed_value: 0 });
  const contract = (project, value) => fill(d, 'ctr_contracts', { company_id: 1, org_project_id: project, contract_no: `K-${project}`, title: 'Main works', contract_type: 'ITEM_RATE', original_paise: value * 100, revised_paise: value * 100, status: 'APPROVED', contract_state: 'ACTIVE' });
  return { ...r, call, wbs, cc, fact, contract };
}

test('T-01 each ETC method reproduces its formula; the bridge adds up to the change', () => {
  const l = { budget: 100000000, actual: 40000000, accrued: 0, committed: 20000000, earned: 30000000, budgetQty: 1000000, actualQty: 300000, remainingQty: null, rate: null, manual: null };
  assert.equal(etcOf({ ...l, method: 'REMAINING_BUDGET' }).etc, 60000000, 'budget − actual − accrued');
  assert.equal(etcOf({ ...l, method: 'CPI' }).etc, Math.round((100000000 - 30000000) / (30000000 / 40000000)), '(BAC − EV) ÷ CPI, CPI = EV ÷ AC');
  assert.equal(etcOf({ ...l, method: 'BOTTOM_UP' }).etc, Math.round((700000 * Math.round((40000000 * 1000) / 300000)) / 1000), '700 remaining × the rate paid to date');
  assert.equal(etcOf({ ...l, method: 'BOTTOM_UP', remainingQty: 500000, rate: 150000 }).etc, 75000000, '500 × ₹1,500 entered');
  assert.equal(etcOf({ ...l, method: 'COMMITTED_PLUS' }).etc, 20000000 + 40000000, 'committed + (budget − actual − committed)');
  assert.equal(etcOf({ ...l, method: 'MANUAL', manual: 12345600 }).etc, 12345600);
  assert.equal(etcOf({ ...l, method: 'CPI', earned: 0 }).etc, 60000000, 'no earned value: the remaining budget');
  assert.equal(etcOf({ ...l, method: 'REMAINING_BUDGET', actual: 120000000 }).etc, 0, 'never below nothing');
  const prev = { eacTotal: 160000000, risk: 5000000, pendingVar: 0, lines: [{ key: '1:1', label: 'A', eac: 100000000, etc: 60000000, actual: 40000000, method: 'REMAINING_BUDGET' }, { key: '2:2', label: 'B', eac: 50000000, etc: 40000000, actual: 10000000, method: 'REMAINING_BUDGET' }, { key: '3:3', label: 'C', eac: 5000000, etc: 0, actual: 5000000, method: 'REMAINING_BUDGET' }] };
  const cur = { eacTotal: 190000000, risk: 8000000, pendingVar: 2000000, pendingVarNote: 'VO-7 rock excavation', lines: [{ key: '1:1', label: 'A', eac: 130000000, etc: 80000000, actual: 50000000, method: 'CPI' }, { key: '2:2', label: 'B', eac: 50000000, etc: 40000000, actual: 10000000, method: 'REMAINING_BUDGET' }] };
  const b = bridgeOf(prev, cur); assert.equal(b.items.reduce((a, x) => a + x.change, 0), cur.eacTotal - prev.eacTotal, 'the bridge adds up to the change of the EAC'); assert.equal(b.items[0].label, 'A'); assert.match(b.items[0].why, /method REMAINING_BUDGET → CPI/);
  assert.ok(b.items.some((x) => x.kind === 'RISK' && x.change === 3000000) && b.items.some((x) => x.kind === 'VARIATION' && x.change === 2000000) && b.items.some((x) => x.label === 'C' && x.change === -5000000));
});

test('AC-01 a monthly forecast with methods per line, the bridge and the approval; BR-01; the EAC feeds revenue recognition; rights', async () => {
  const w = await world(); const d = w.d;
  const w1 = w.wbs(w.A, '1.1'); const w2 = w.wbs(w.A, '1.2'); const c1 = w.cc('C-CONC'); const c2 = w.cc('C-STEEL');
  w.fact(w.A, w1, c1, { budget: 100000000, bqty: 1000000, committed: 20000000, earned: 30000000 }); w.fact(w.A, w1, c1, { period: '2026-10', actual: 40000000, aqty: 300000 });
  w.fact(w.A, w2, c2, { budget: 50000000, bqty: 500000 }); w.fact(w.A, w2, c2, { period: '2026-10', actual: 10000000, aqty: 100000 });
  fill(d, 'proj_risks', { company_id: 1, org_project_id: w.A, rtype: 'RISK', status: 'OPEN', emv: 5000000, probability: 3, impact_cost: 3, exposure_cost_min: 0, exposure_cost_ml: 0, exposure_cost_max: 0, exposure_time_min: 0, exposure_time_ml: 0, exposure_time_max: 0 });
  w.contract(w.A, 3000000);
  assert.equal((await w.call(U.se, 'POST', '/cost-forecasts', { projectId: w.A, period: '2026-10' })).status, 403);
  assert.equal((await w.call(U.pcm, 'POST', '/cost-forecasts', { projectId: w.B, period: '2026-10' })).status, 422, 'no facts for project B');
  const c = await w.call(U.qs, 'POST', '/cost-forecasts', { projectId: w.A, period: '2026-10' }); assert.equal(c.status, 201, JSON.stringify(c.json)); let f = c.json.data;
  assert.equal(f.lines.length, 2); assert.deepEqual([f.budget, f.actual, f.etc, f.riskAllowance, f.eac, f.vac, f.lossMaking], [1500000, 500000, 1000000, 50000, 1550000, -50000, false]);
  const l1 = f.lines.find((l) => l.label.includes('C-CONC')); const l2 = f.lines.find((l) => l.label.includes('C-STEEL'));
  // methods per line: CPI on concrete, bottom-up at an entered rate on steel; a manual estimate needs its justification
  let u = await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}/lines/${l1.id}`, { method: 'CPI' }); assert.equal(u.status, 200, JSON.stringify(u.json)); assert.equal(u.json.data.lines.find((l) => l.id === l1.id).etc, 933333.33);
  assert.equal((await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}/lines/${l2.id}`, { method: 'MANUAL', manual: 500000 })).status, 400, 'manual without justification');
  u = await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}/lines/${l2.id}`, { method: 'BOTTOM_UP', rate: 1200 }); assert.equal(u.json.data.lines.find((l) => l.id === l2.id).etc, 480000, '400 remaining × ₹1,200');
  u = await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}`, { pendingVarCost: 100000 }); assert.equal(u.status, 400, 'pending variations need their note');
  u = await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}`, { pendingVarCost: 100000, pendingVarNote: 'VO-3 extra dewatering', confidence: 'MEDIUM', commentary: 'Concrete running over: CPI 0.75', version: f.version }); assert.equal(u.status, 200, JSON.stringify(u.json)); f = u.json.data;
  assert.equal(f.eac, Math.round((400000 + 933333.33 + 100000 + 480000 + 50000 + 100000) * 100) / 100); assert.equal(f.bridge.items.reduce((a, x) => Math.round((a + x.change) * 100) / 100, 0), f.eac, 'the first forecast: the bridge from nothing');
  // approval: the QS prepared it, so the project controls manager, the PM, the project director; not loss-making: no CFO
  assert.equal((await w.call(U.qs, 'POST', `/cost-forecasts/${f.id}/submit`)).status, 202); const inst = w.wf('fc_forecasts', f.id);
  for (const who of [U.pcm, U.pm]) { assert.equal((await w.act(who, inst)).status, 200); assert.equal((await w.call(U.pd, 'GET', `/cost-forecasts/${f.id}`)).json.data.status, 'SUBMITTED'); }
  assert.equal((await w.act(U.pd, inst)).status, 200); f = (await w.call(U.pd, 'GET', `/cost-forecasts/${f.id}`)).json.data; assert.equal(f.status, 'APPROVED');
  assert.equal(w.events('fin.eac_version.approved').at(-1).eac, f.eac);
  assert.equal((await w.call(U.qs, 'PATCH', `/cost-forecasts/${f.id}`, { confidence: 'LOW' })).status, 409, 'BR-01: an approved forecast is not changed');
  assert.equal((await w.call(U.qs, 'POST', '/cost-forecasts', { projectId: w.A, period: '2026-10' })).status, 201, 'a new version of the month can be prepared');
  const v2 = (await w.call(U.qs, 'GET', '/cost-forecasts?filter[status]=DRAFT')).json.data[0]; assert.equal(v2.versionNo, 2);
  // the next version: more cost on steel; the bridge adds up to the change and names the line
  w.fact(w.A, w2, c2, { period: '2026-11', actual: 5000000, aqty: 50000 });
  const r2 = (await w.call(U.qs, 'POST', `/cost-forecasts/${v2.id}/refresh`)).json.data; assert.equal(r2.lines.find((l) => l.label.includes('C-STEEL')).method, 'BOTTOM_UP', 'methods carried over');
  assert.equal(Math.round(r2.bridge.items.reduce((a, x) => a + x.change, 0) * 100) / 100, Math.round((r2.eac - f.eac) * 100) / 100); assert.equal(r2.bridge.from, f.eac);
  assert.equal((await w.call(U.qs, 'POST', `/cost-forecasts/${v2.id}/submit`)).status, 202); const i2 = w.wf('fc_forecasts', v2.id); for (const who of [U.pcm, U.pm, U.pd]) assert.equal((await w.act(who, i2)).status, 200);
  assert.equal((await w.call(U.pd, 'GET', `/cost-forecasts/${f.id}`)).json.data.status, 'SUPERSEDED', 'BR-01: one approved forecast a month');
  // revenue recognition (23.10) takes the approved EAC
  const rr = await w.call(U.acc, 'POST', '/revenue-recognition/preview', { projectId: w.A, period: '2026-11' }); assert.equal(rr.status, 200, JSON.stringify(rr.json)); assert.equal(rr.json.data.eacSource, 'FORECAST'); assert.equal(rr.json.data.eac, r2.eac);
  // reports, print, rights
  const tr = (await w.call(U.pd, 'GET', `/forecast-reports/trend?projectId=${w.A}`)).json.data; assert.equal(tr.rows.length, 1); assert.equal(tr.rows[0].versionNo, 2);
  const va = (await w.call(U.cfo, 'GET', '/forecast-reports/variance?period=2026-11')).json.data; assert.equal(va.rows.length, 1);
  assert.equal((await w.call(U.pd, 'GET', `/cost-forecasts/${v2.id}/print`)).status, 200); assert.equal((await w.call(U.se, 'GET', '/cost-forecasts')).status, 403);
  assert.equal((await w.call(as('PCMGR', 'pcm9', '2'), 'GET', `/cost-forecasts/${v2.id}`)).status, 404);
});

test('a loss-making forecast goes to the CFO after the project director; the maker never approves', async () => {
  const w = await world();
  const w1 = w.wbs(w.B, '2.1'); const c1 = w.cc('C-EARTH'); w.fact(w.B, w1, c1, { budget: 100000000 }); w.fact(w.B, w1, c1, { period: '2026-10', actual: 90000000 }); w.contract(w.B, 800000);
  const c = await w.call(U.pcm, 'POST', '/cost-forecasts', { projectId: w.B, period: '2026-10' }); assert.equal(c.status, 201); const f = c.json.data; assert.equal(f.lossMaking, true);
  assert.equal((await w.call(U.pcm, 'PATCH', `/cost-forecasts/${f.id}`, { confidence: 'LOW' })).status, 200);
  assert.equal((await w.call(U.pcm, 'POST', `/cost-forecasts/${f.id}/submit`)).status, 400, 'low confidence needs its commentary');
  assert.equal((await w.call(U.pcm, 'PATCH', `/cost-forecasts/${f.id}`, { commentary: 'Rock strata found at chainage 4+200' })).status, 200);
  assert.equal((await w.call(U.pcm, 'POST', `/cost-forecasts/${f.id}/submit`)).status, 202); const inst = w.wf('fc_forecasts', f.id);
  assert.equal((await w.tasksOf(U.pcm)).filter((t) => t.instance.id === inst).length, 0, 'the maker has no task');
  for (const who of [U.pm, U.pd]) assert.equal((await w.act(who, inst)).status, 200);
  assert.equal((await w.call(U.cfo, 'GET', `/cost-forecasts/${f.id}`)).json.data.status, 'SUBMITTED', 'loss-making: the CFO still to approve');
  assert.equal((await w.act(U.cfo, inst)).status, 200); assert.equal((await w.call(U.cfo, 'GET', `/cost-forecasts/${f.id}`)).json.data.status, 'APPROVED');
});
