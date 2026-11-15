import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, key, ready } from './ctr-helpers.js';

// Part 22.09: the monthly CVR is built from the owners (certifications, the quantity chain, variations, claims, the project control facts, subcontract bills), manual assessments need notes, the month is approved by the chain and locked, and the contract control tower shows the portfolio with the margin masked without the right.
import { billOf } from '../src/server/modules/bill/index.js';

// Part 22.02: the quantity chain of every BOQ item and location read from the owners of each figure (T-01), the forecast, the items approaching their limit, deviation statements (prepared, recomputed on submit, approved, sent to the client, accepted into a change request) and the register of extra and substituted items.
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2'), com3: as('COMMGR', 'com1') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world() {
  const r = await ready(opened, { baseline: false }); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const item = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 }); const item2 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 50_000, rate: 600_000_000, amount: 0 }); const item3 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.3', description: 'Shuttering', uom: 'sqm', qty: 200_000, rate: 3_000_000, amount: 0 });
  const loc = fill(d, 'proj_locations', { company_id: 1, project_id: r.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const wa = fill(d, 'site_work_authorisations', { company_id: 1, wa_no: 'WA/1', plan_date: day(-3), activity_id: r.a1, location_id: loc, planned_qty: 100_000, start_time: '08:00', end_time: '17:00', supervisor: 'sup1', status: 'APPROVED' });
  fill(d, 'plan_activity_boq', { company_id: 1, activity_id: r.a1, boq_line_id: item, qty: 100_000 });
  return { ...r, bc, ver, item, item2, item3, loc, wa, sc: billOf(d).svc };
}
const mbBody = (w, o = {}) => ({ projectId: w.A, boqLineId: w.item, locationId: w.loc, description: 'Footings', template: 'QTY', qty: 10, measuredOn: day(-1), ...o });
const submit = async (w, id) => { const s = await w.bc(U.mse, 'POST', `/mb-entries/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); };
async function certify(w, id) { await submit(w, id); const wf = w.wf('bill_mb_entries', id); for (const who of [U.qs, U.pm]) assert.equal((await w.act(who, wf)).status, 200); }
const mk = async (w, o = {}) => (await w.bc(U.mse, 'POST', '/mb-entries', mbBody(w, o))).json.data;
async function seedChain(w) {
  const dpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: w.site, dpr_date: day(-2), status: 'APPROVED' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 30_000, uom: 'cum' });
  const a = await mk(w, { qty: 22 }); await certify(w, a.id); const b = await mk(w, { qty: 8 }); await submit(w, b.id); await mk(w, { qty: 5 }); return { a, b };
}
const cvr = (w, who, method, path, body) => w.bc(who, method, `/reports${path}`, body);
const period = day(0).slice(0, 7);
async function seedCvr(w) {
  await seedChain(w); const d = w.d;
  fill(d, 'ctl_facts', { company_id: 1, org_project_id: w.A, actual_cost: 20_000_000, budget_cost: 50_000_000, committed_cost: 0, resource_type: 'MATERIAL', period_key: period });
  const k = fill(d, 'ctr_contracts', { company_id: 1, org_project_id: w.A, contract_no: 'C-CV', status: 'APPROVED', contract_state: 'ACTIVE', original_paise: 100_000_000, revised_paise: 100_000_000 });
  const bill = fill(d, 'bill_client_bills', { company_id: 1, org_project_id: w.A, contract_id: k, bill_no: 'RA-C1', seq_no: 1, period_from: day(-60), period_to: day(-40), net_paise: 9_000_000, gross_paise: 10_000_000, status: 'APPROVED', client_state: 'SENT', sent_on: day(-30) });
  fill(d, 'bill_certifications', { company_id: 1, org_project_id: w.A, contract_id: k, bill_id: bill, cert_no: 'CE-C1', cert_date: day(-10), submitted_gross_paise: 10_000_000, certified_gross_paise: 9_000_000, status: 'APPROVED' });
  const cl1 = fill(d, 'ctr_claims', { company_id: 1, org_project_id: w.A, claim_no: 'CL-A', contract_id: k, title: 'Delay', claim_state: 'SUBMITTED', amount_claimed_paise: 2_000_000, status: 'APPROVED' });
  fill(d, 'ctr_claims', { company_id: 1, org_project_id: w.A, claim_no: 'CL-B', contract_id: k, title: 'Rock', claim_state: 'DETERMINED', amount_claimed_paise: 1_500_000, amount_awarded_paise: 1_000_000, status: 'APPROVED' });
  fill(d, 'bill_sub_bills', { company_id: 1, org_project_id: w.A, bill_no: 'SB-C1', gross_paise: 6_000_000, net_paise: 5_500_000, status: 'APPROVED', payable_state: 'NOT_POSTED', period_to: day(-5) });
  return { k, cl1 };
}
const assess = (cl1) => ({ claims: [{ claimId: cl1, probabilityPct: 50, note: 'Counsel opinion: even chance' }], accruals: [{ label: 'Hire charges for the month', amount: 10000, note: 'Invoice awaited from the supplier' }], valueProvisions: [{ label: 'Retention on disputed work', amount: 5000, note: 'Client disputes the quantity' }], costProvisions: [{ kind: 'RECTIFICATION', amount: 8000, note: 'Cracks in the slab, as per NCR' }] });

test('FR-01 T-01 BR-01 the value and the cost are the sums of their lines, each from its owner; the typed assessments need a note', async () => {
  const w = await world(); const { cl1 } = await seedCvr(w);
  const pv = await cvr(w, U.qs, 'POST', '/preview', { projectId: w.A, period, assessments: assess(cl1) }); assert.equal(pv.status, 200, JSON.stringify(pv.json)); const p = pv.json.data;
  const val = Object.fromEntries(p.valueLines.map((l) => [l.key, l.amount])); const cost = Object.fromEntries(p.costLines.map((l) => [l.key, l.amount]));
  assert.deepEqual(val, { CERTIFIED: 90_000, WORK_NOT_CERTIFIED: 48_000, VARIATIONS: 0, CLAIMS_AWARDED: 10_000, CLAIMS_ASSESSED: 10_000, PROVISION: -5_000 }); assert.deepEqual(cost, { ACTUAL: 200_000, ACCRUAL: 10_000, SUB_LIABILITY: 55_000, PROVISION: 8_000 });
  assert.deepEqual([p.value, p.cost, p.margin], [153_000, 273_000, -120_000], 'value and cost reconcile to the lines; the lines to the source ledgers');
  assert.equal(p.cost, Object.values(cost).reduce((n, x) => n + x, 0)); assert.equal(p.value, Object.values(val).reduce((n, x) => n + x, 0));
  assert.equal(p.marginPct, -78.43); assert.equal(p.contractValue, 1_000_000); assert.equal(p.budgetMarginPct, 50, 'budget cost 5,00,000 against a contract of 10,00,000');
  // BR-01: a probability, an accrual or a provision without a note is refused
  const bad = await cvr(w, U.qs, 'POST', '/preview', { projectId: w.A, period, assessments: { claims: [{ claimId: cl1, probabilityPct: 50 }] } }); assert.equal(bad.status, 400); assert.equal((await cvr(w, U.qs, 'POST', '/preview', { projectId: w.A, period, assessments: { accruals: [{ label: 'x', amount: 5, note: 'no' }] } })).status, 400);
  assert.equal((await cvr(w, U.mse, 'POST', '/preview', { projectId: w.A, period })).status, 403);
});

test('FR-02 FR-03 the CVR is prepared, compared with the budget and the month before, approved by the chain (the director when the month shows a loss) and locked', async () => {
  const w = await world(); const { cl1 } = await seedCvr(w);
  w.d.prepare("INSERT INTO bill_cvr_reports (company_id, doc_no, org_project_id, period, as_of, value_paise, cost_paise, margin_paise, margin_bp, status, requested_by, created_by) VALUES (1, 'CVR/OLD/1', ?, ?, ?, 1000, 800, 200, 2000, 'APPROVED', 'x', 'x')").run(w.A, day(-45).slice(0, 7), day(-45));
  const c = await cvr(w, U.qs, 'POST', '', { projectId: w.A, siteId: null, period, commentaryQs: 'Hire accrual estimated', assessments: assess(cl1) }); assert.equal(c.status, 201, JSON.stringify(c.json)); const r = c.json.data;
  assert.deepEqual([r.status, r.value, r.cost, r.margin, r.prevMarginPct, r.vsBudgetPct], ['DRAFT', 153_000, 273_000, -120_000, 20, -128.43]); assert.equal(r.changePct, -98.43);
  assert.equal((await cvr(w, U.qs, 'POST', '', { projectId: w.A, siteId: null, period })).status, 409, 'one CVR for a month');
  assert.equal((await cvr(w, U.com, 'POST', '', { projectId: w.A, siteId: null, period: '2020-01' })).status, 403, 'the commercial manager approves, the surveyor prepares');
  assert.equal((await cvr(w, U.pm, 'PATCH', `/${r.id}`, { commentaryQs: 'x' })).status, 403);
  // submit: the figures are rebuilt from the owners
  fill(w.d, 'ctl_facts', { company_id: 1, org_project_id: w.A, actual_cost: 1_000_000, resource_type: 'LABOUR', period_key: period }); const s = await cvr(w, U.qs, 'POST', `/${r.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json));
  const sub = (await cvr(w, U.qs, 'GET', `/${r.id}`)).json.data; assert.equal(sub.cost, 283_000, 'rebuilt at submit'); assert.equal((await cvr(w, U.qs, 'PATCH', `/${r.id}`, { commentaryQs: 'late' })).status, 409);
  const wf = w.wf('bill_cvr_reports', r.id); assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM wf_tasks WHERE instance_id = (SELECT workflow_instance_id FROM bill_cvr_reports WHERE id = ?) AND assignee_user_id = 'qs1'").get(r.id)?.n ?? 0, 0, 'the maker holds no task');
  const cm = await cvr(w, U.pm, 'POST', `/${r.id}/comment`, { commentary: 'Rectification is the big item' }); assert.equal(cm.status, 200); assert.equal(cm.json.data.commentaryPm, 'Rectification is the big item');
  for (const who of [U.pm, U.com, U.pd]) assert.equal((await w.act(who, wf)).status, 200, 'PM, COMMGR and (a loss) PD');
  const a = (await cvr(w, U.qs, 'GET', `/${r.id}`)).json.data; assert.deepEqual([a.status, a.locked], ['APPROVED', true]); assert.equal((await cvr(w, U.qs, 'PATCH', `/${r.id}`, { commentaryQs: 'x' })).status, 409); assert.equal((await cvr(w, U.qs, 'POST', `/${r.id}/amend`, { reason: 'change' })).status, 422);
  await w.drain(); const ev = w.events('bill.cvr.approved'); assert.deepEqual([ev.length, ev[0].period, ev[0].margin, ev[0].projectId], [1, period, -130_000, w.A]);
  assert.equal((await cvr(w, U.qs, 'GET', `/${r.id}/print`)).status, 200); assert.equal((await cvr(w, U.qs, 'GET', '/export')).status, 200); assert.equal((await cvr(w, U.mse, 'GET', '/export')).status, 403);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2209'").run(); w.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.bill.p2209'").run();
});

test('FR-04 the contract control tower shows value, billed, collected, margin, variations, claims, securities and risks; the margin is hidden without the right', async () => {
  const w = await world(); const { cl1, k } = await seedCvr(w);
  fill(w.d, 'ctr_bank_guarantees', { company_id: 1, contract_id: k, org_project_id: w.A, bg_state: 'ACTIVE', bg_type: 'RETENTION', current_paise: 3_000_000 });
  fill(w.d, 'proj_risks', { company_id: 1, org_project_id: w.A, rtype: 'RISK', status: 'OPEN', level: 'HIGH', title: 'Monsoon' });
  const c = (await cvr(w, U.qs, 'POST', '', { projectId: w.A, siteId: null, period, assessments: assess(cl1) })).json.data; await cvr(w, U.qs, 'POST', `/${c.id}/submit`); const wf = w.wf('bill_cvr_reports', c.id); for (const who of [U.pm, U.com, U.pd]) await w.act(who, wf);
  const tw = async (who, q = '') => w.bc(who, 'GET', `/control-tower${q}`);
  let t = (await tw(U.dir)).json.data; const row = t.rows.find((r) => r.contractId === k); assert.deepEqual([row.value, row.billed, row.collected, row.outstanding, row.claims.count, row.claims.value, row.securities.guarantees, row.securities.guaranteeAmount, row.risks.high], [1_000_000, 100_000, 0, 100_000, 1, 20_000, 1, 30_000, 1]);
  assert.deepEqual([row.margin, row.marginPct, row.marginMasked, row.flags.includes('LOSS'), row.cvr.period], [-120_000, -78.43, false, true, period], 'the director holds the margin right');
  assert.ok(t.exceptions.some((e) => e.key === 'LOSS')); assert.equal(t.totals.contracts, t.rows.length);
  t = (await tw(U.qs)).json.data; const q = t.rows.find((r) => r.contractId === k); assert.deepEqual([q.margin, q.marginMasked, q.value], [null, true, 1_000_000], 'the surveyor does not see the margin');
  assert.equal((await tw(U.mse)).status, 403); assert.equal((await tw(U.qs, '?projectId=999999')).json.data.rows.length, 0); assert.equal((await w.bc(U.dir, 'GET', '/control-tower/export')).status, 200); assert.equal((await w.bc(U.qs, 'GET', '/control-tower/export')).status, 403);
});
