import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, ready, approvedContract } from './ctr-helpers.js';
import { amountOf, marginOf } from '../src/server/modules/ctr/workorders.js';
import { ctrOf } from '../src/server/modules/ctr/index.js';

// Part 21.03: subcontract work orders (item rate, labour rate, lump sum): creation with server-side totals, the back-to-back margin per item (T-01), approval bands and the negative-margin rule (BR-01), the budget quantity exception (BR-02), acceptance, amendments that move the commitment by the delta (T-01), progress, closure, roles and scope.
const U = { ...BASE, sub: as('SUBCO', 'sub1') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
async function world() {
  const r = await ready(opened); const k = await approvedContract(r); const d = r.d;
  const sub = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'SUB1', 'Shree Earthworks', 'Shree', 'PARTNERSHIP', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  fill(d, 'mdm_partner_roles', { company_id: 1, partner_id: sub, partner_role: 'SUBCONTRACTOR' });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED' });
  const line = (code, rate) => fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: code, description: `Item ${code}`, uom: 'cum', qty: 1_000_000, rate, amount: 0 });
  const cl1 = line('1.1', 10_000_000); const cl2 = line('1.2', 5_000_000); // Rs 1,000 and Rs 500 per cum (x10000)
  return { ...r, k, sub, ver, cl1, cl2, call: r.call };
}
const body = (w, o = {}) => ({ projectId: w.A, woNo: `WO-${Math.random().toString(36).slice(2, 7)}`, woType: 'ITEM_RATE', contractId: w.k.id, subcontractorId: w.sub, selectionKind: 'NEGOTIATED', justification: 'Only local party with the plant', title: 'Earthwork in embankment', startDate: day(0), endDate: day(180), retentionPct: 5, sdPct: 2.5, advancePct: 10, advanceRecoveryPct: 20, tdsSection: '194C', gstMode: 'FORWARD', gstPct: 18, paymentDays: 30, ldPct: 0.5, ldCapPct: 10, safetyPenalty: 5000,
  items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Earthwork in embankment', uom: 'cum', qty: 100, rate: 800 }], freeIssue: [], ...o });
async function approved(w, b, approvers) { const c = await w.call(U.com, 'POST', '/work-orders', b); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; const s = await w.call(U.com, 'POST', `/work-orders/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); const wf = w.wf('ctr_work_orders', id); for (const who of approvers) { const a = await w.act(who, wf); assert.equal(a.status, 200, JSON.stringify(a.json)); } return (await w.call(U.com, 'GET', `/work-orders/${id}`)).json.data; }

test('T-01 the margin of an item against the client BOQ and the amount of a line', () => {
  assert.equal(amountOf(100_000, 8_000_000), 8_000_000, '100 cum at Rs 800 = Rs 80,000 = 8,000,000 paise');
  assert.deepEqual(marginOf(100_000, 8_000_000, 10_000_000), { client: 10_000_000, own: 8_000_000, margin: 2_000_000, marginBp: 2000, negative: false });
  assert.equal(marginOf(100_000, 11_000_000, 10_000_000).negative, true); assert.equal(marginOf(100_000, 11_000_000, 10_000_000).margin, -1_000_000); assert.equal(marginOf(100_000, 8_000_000, 0).negative, false, 'an unmapped item has no margin');
});

test('FR-01 FR-02 FR-03 FR-04 a work order is made with server-side totals; selection, subcontractor, terms and mapping are checked; labour-rate and lump-sum rules', async () => {
  const w = await world();
  assert.equal((await w.call(U.pm, 'POST', '/work-orders', body(w))).status, 403);
  assert.equal((await w.call(U.com, 'POST', '/work-orders', body(w, { value: 1 }))).status, 400, 'the value is worked out by the server');
  const c = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-1' })); assert.equal(c.status, 201, JSON.stringify(c.json)); const x = c.json.data;
  assert.deepEqual([x.value, x.status, x.state, x.items[0].amount, x.items[0].clientRate, x.items[0].margin, x.items[0].marginPct, x.negativeMargin], [80000, 'DRAFT', 'PREPARING', 80000, 1000, 20000, 20, false]); assert.equal(x.marginTotals.margin, 20000); assert.equal(x.recoveries.advance, 8000); assert.equal(x.recoveries.retention, 4000);
  assert.equal((await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'wo-1' }))).status, 409);
  const notSub = fill(w.d, 'mdm_partners', { company_id: 1, code: 'V9', legal_name: 'Cement Seller', partner_status: 'ACTIVE' }); assert.equal((await w.call(U.com, 'POST', '/work-orders', body(w, { subcontractorId: notSub }))).status, 400, 'a vendor is not a subcontractor');
  assert.equal((await w.call(U.com, 'POST', '/work-orders', body(w, { items: [{ itemKind: 'BOQ', boqLineId: 99999, description: 'X', qty: 1, rate: 1 }] }))).status, 400);
  // selection: negotiated needs a justification, a CS must be approved
  const nj = await w.call(U.com, 'POST', '/work-orders', body(w, { justification: 'short' })); await w.call(U.com, 'POST', `/work-orders/${nj.json.data.id}/submit`).then((s) => { assert.equal(s.status, 400); assert.match(JSON.stringify(s.json), /justification/); });
  assert.equal((await w.call(U.com, 'POST', '/work-orders', body(w, { selectionKind: 'CS', csId: 99999 }))).status, 400);
  // labour rate: free issue lists materials; lump sum: milestones only
  const item = fill(w.d, 'mdm_items', { company_id: 1, code: 'CEM', name: 'Cement' });
  const lab = await w.call(U.com, 'POST', '/work-orders', body(w, { woType: 'LABOUR_RATE' })); const ls = await w.call(U.com, 'POST', `/work-orders/${lab.json.data.id}/submit`); assert.equal(ls.status, 400); assert.match(JSON.stringify(ls.json), /materials issued free/);
  const lab2 = await w.call(U.com, 'POST', '/work-orders', body(w, { woType: 'LABOUR_RATE', freeIssue: [{ itemId: item, uom: 'bag', norm: 6.5, wastagePct: 2, chargeableRate: 420 }] })); assert.equal(lab2.status, 201, JSON.stringify(lab2.json)); assert.deepEqual([lab2.json.data.freeIssue[0].norm, lab2.json.data.freeIssue[0].wastagePct, lab2.json.data.freeIssue[0].chargeableRate], [6.5, 2, 420]);
  const lump = await w.call(U.com, 'POST', '/work-orders', body(w, { woType: 'LUMP_SUM', items: [{ itemKind: 'MILESTONE', description: 'Foundation complete', qty: 1, rate: 400000, dueDate: day(60) }, { itemKind: 'MILESTONE', description: 'Superstructure', qty: 1, rate: 600000, dueDate: day(120) }] })); assert.equal(lump.status, 201, JSON.stringify(lump.json)); assert.equal(lump.json.data.value, 1_000_000);
  // update, delete
  const up = await w.call(U.com, 'PATCH', `/work-orders/${c.json.data.id}`, { items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Earthwork in embankment', uom: 'cum', qty: 120, rate: 800 }], rowVersion: x.version }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.value, 96000);
  assert.equal((await w.call(U.com, 'PATCH', `/work-orders/${c.json.data.id}`, { title: 'again', rowVersion: x.version })).status, 409, 'stale version');
  assert.equal((await w.call(U.com, 'DELETE', `/work-orders/${lump.json.data.id}`)).status, 200);
});

test('FR-05 BR-01 approval by band (Rs 10 lakh, Rs 50 lakh) and the director for a negative margin; acceptance by the subcontractor; the commitment', async () => {
  const w = await world(); const sc = ctrOf(w.d).svc;
  const small = await approved(w, body(w, { woNo: 'WO-S', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Small', uom: 'cum', qty: 100, rate: 800 }] }), [U.com2]); assert.deepEqual([small.status, small.state, small.value], ['APPROVED', 'ISSUED', 80000], 'under Rs 10 lakh: one approval');
  const mid = await approved(w, body(w, { woNo: 'WO-M', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Mid', uom: 'cum', qty: 2500, rate: 800 }] }), [U.com2, U.pd]); assert.equal(mid.status, 'APPROVED', 'Rs 20 lakh: commercial manager then PD');
  const big = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-B', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Big', uom: 'cum', qty: 7500, rate: 800 }] })); await w.call(U.com, 'POST', `/work-orders/${big.json.data.id}/submit`); const wfb = w.wf('ctr_work_orders', big.json.data.id);
  await w.act(U.com2, wfb); await w.act(U.pd, wfb); assert.equal((await w.call(U.com, 'GET', `/work-orders/${big.json.data.id}`)).json.data.status, 'SUBMITTED', 'Rs 60 lakh needs the director'); await w.act(U.dir, wfb); assert.equal((await w.call(U.com, 'GET', `/work-orders/${big.json.data.id}`)).json.data.status, 'APPROVED');
  // negative margin: our rate above the client rate
  const neg = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-N', items: [{ itemKind: 'BOQ', boqLineId: w.cl2, clientBoqLineId: w.cl2, description: 'Costly', uom: 'cum', qty: 100, rate: 650 }] })); assert.equal(neg.json.data.negativeMargin, true); assert.equal(neg.json.data.items[0].margin, -15000);
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${neg.json.data.id}/submit`)).status, 202); const wfn = w.wf('ctr_work_orders', neg.json.data.id); await w.act(U.com2, wfn); assert.equal((await w.call(U.com, 'GET', `/work-orders/${neg.json.data.id}`)).json.data.status, 'SUBMITTED', 'a small value but a negative margin: the director next'); await w.act(U.dir, wfn); assert.equal((await w.call(U.com, 'GET', `/work-orders/${neg.json.data.id}`)).json.data.status, 'APPROVED');
  assert.equal((await w.call(U.com, 'PATCH', `/work-orders/${small.id}`, { title: 'New title' })).status, 409, 'an approved work order is amended, not edited');
  await w.drain(); const ev = w.events('ctr.wo.approved'); assert.equal(ev.length, 4); assert.deepEqual([ev[0].woNo, ev[0].value, ev[0].subcontractor, ev[0].retentionPct, ev[0].items.length], ['WO-S', 80000, 'Shree Earthworks', 5, 1]);
  // commitment in the budget ledger (12.03)
  const com = w.d.prepare("SELECT COALESCE(SUM(amount), 0) AS a, COUNT(*) AS n FROM bud_commitments WHERE src_type = 'ctr_work_order' AND src_id = ? AND stage = 'WO'").get(String(small.id)); assert.deepEqual([com.n, com.a], [1, 8_000_000], 'the commitment is posted at approval');
  // acceptance
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${small.id}/accept`, { acceptedBy: 'Mr Patel', reference: 'SIGNED/1' })).status, 200, 'the commercial manager records it'); assert.equal((await w.call(U.sub, 'POST', `/work-orders/${mid.id}/accept`, { acceptedBy: 'Mr Shah' })).status, 200, 'so does the subcontractor coordinator');
  const acc = (await w.call(U.com, 'GET', `/work-orders/${small.id}`)).json.data; assert.deepEqual([acc.state, acc.acceptedBy], ['ACCEPTED', 'Mr Patel']); assert.equal((await w.call(U.com, 'POST', `/work-orders/${small.id}/accept`, { acceptedBy: 'again' })).status, 422); await w.drain(); assert.equal(w.events('ctr.wo.accepted').length, 2);
  assert.equal(sc.workOrders.get.length >= 1, true);
});

test('BR-02 a quantity beyond the budget quantity needs an approved exception', async () => {
  const w = await world(); const bud = fill(w.d, 'bud_budgets', { company_id: 1, org_project_id: w.A, version_no: 1, status: 'APPROVED' }); fill(w.d, 'bud_lines', { company_id: 1, budget_id: bud, line_kind: 'DIRECT', boq_line_id: w.cl1, qty: 150_000, rate: 0, amount: 0 });
  const ok1 = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-OK', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'In budget', uom: 'cum', qty: 100, rate: 800 }] })); assert.equal(ok1.json.data.overBudget, false); assert.equal((await w.call(U.com, 'POST', `/work-orders/${ok1.json.data.id}/submit`)).status, 202); await w.act(U.com2, w.wf('ctr_work_orders', ok1.json.data.id));
  const over = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-OV', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Beyond', uom: 'cum', qty: 100, rate: 800 }] })); assert.equal(over.json.data.overBudget, true, '100 + 100 held is beyond the budget 150');
  const s = await w.call(U.com, 'POST', `/work-orders/${over.json.data.id}/submit`); assert.equal(s.status >= 400, true, JSON.stringify(s.json)); assert.match(JSON.stringify(s.json), /exception|budget quantity/i); assert.equal((await w.call(U.com, 'GET', `/work-orders/${over.json.data.id}`)).json.data.status, 'DRAFT', 'nothing was sent');
});

test('FR-06 FR-07 T-01 an amendment re-approves by the band of the change and moves the commitment by the delta; progress; closure releases the rest', async () => {
  const w = await world(); const sc = ctrOf(w.d).svc; const wo = await approved(w, body(w, { woNo: 'WO-A', items: [{ itemKind: 'BOQ', boqLineId: w.cl1, clientBoqLineId: w.cl1, description: 'Earthwork', uom: 'cum', qty: 100, rate: 800 }, { itemKind: 'BOQ', boqLineId: w.cl2, clientBoqLineId: w.cl2, description: 'Backfill', uom: 'cum', qty: 200, rate: 400 }] }), [U.com2]);
  assert.equal(wo.value, 160000); const cm = () => w.d.prepare("SELECT COALESCE(SUM(amount), 0) AS a FROM bud_commitments WHERE src_type = 'ctr_work_order' AND src_id = ?").get(String(wo.id)).a; assert.equal(cm(), 16_000_000);
  assert.equal((await w.call(U.pm, 'POST', `/work-orders/${wo.id}/amend`, { description: 'More earthwork', changes: [{ lineNo: 1, qty: 150 }] })).status, 403);
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'Nothing changes', changes: [] })).status, 400);
  const am = await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'More earthwork and a new item', newEndDate: day(240), changes: [{ lineNo: 1, qty: 150 }, { add: { itemKind: 'CUSTOM', description: 'Dewatering', uom: 'day', qty: 30, rate: 2500 } }] }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.equal(am.json.data.delta, 40000 + 75000); assert.equal(am.json.data.compare.length, 3); assert.equal(am.json.data.compare[2].added, true);
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'Second at once', changes: [{ lineNo: 1, qty: 151 }] })).status, 409, 'one open amendment at a time');
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${wo.id}/close`, { finalBillRef: 'FB-1' })).status, 409, 'not while an amendment is open');
  assert.equal((await w.call(U.com, 'POST', `/wo-amendments/${am.json.data.id}/submit`)).status, 202); const wfa = w.wf('ctr_wo_amendments', am.json.data.id);
  await w.act(U.com2, wfa); assert.equal((await w.call(U.com, 'GET', `/wo-amendments/${am.json.data.id}`)).json.data.status, 'APPROVED', 'a change of Rs 1.15 lakh needs the commercial manager only');
  const a2 = (await w.call(U.com, 'GET', `/work-orders/${wo.id}`)).json.data; assert.deepEqual([a2.value, a2.amendmentNo, a2.endDate, a2.items.length, a2.items[0].qty], [160000 + 115000, 1, day(240), 3, 150]); assert.equal(cm(), 16_000_000 + 11_500_000, 'the commitment moved by the delta');
  await w.drain(); const ev = w.events('ctr.wo.amended'); assert.deepEqual([ev.length, ev[0].before, ev[0].after, ev[0].delta, ev[0].amendmentNo], [1, 160000, 275000, 115000, 1]);
  // a reduction
  const r1 = await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'Backfill reduced', changes: [{ lineNo: 2, qty: 100 }] }); assert.equal(r1.json.data.delta, -40000); await w.call(U.com, 'POST', `/wo-amendments/${r1.json.data.id}/submit`); await w.act(U.com2, w.wf('ctr_wo_amendments', r1.json.data.id)); assert.equal(cm(), 27_500_000 - 4_000_000);
  // progress adapter (22.05)
  assert.deepEqual(sc.workOrders.progress(1, { woId: wo.id, lines: [{ lineNo: 1, executed: 60, billed: 40 }] }), { woId: wo.id, lines: 1 }); assert.throws(() => sc.workOrders.progress(1, { woId: wo.id, lines: [{ lineNo: 1, executed: 50, billed: 40 }] }), /only go up/); assert.throws(() => sc.workOrders.progress(1, { woId: wo.id, lines: [{ lineNo: 1, executed: 200, billed: 40 }] }), /beyond the ordered/); assert.throws(() => sc.workOrders.progress(1, { woId: wo.id, lines: [{ lineNo: 1, executed: 70, billed: 80 }] }), /more is billed/);
  const bad = await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'Below executed', changes: [{ lineNo: 1, qty: 30 }] }); assert.equal(bad.status, 400, JSON.stringify(bad.json)); assert.match(JSON.stringify(bad.json), /executed already/);
  // closure
  assert.equal((await w.call(U.pm, 'POST', `/work-orders/${wo.id}/close`, { finalBillRef: 'FB-1' })).status, 403); const cl = await w.call(U.com, 'POST', `/work-orders/${wo.id}/close`, { finalBillRef: 'FB/2026/9', note: 'Work complete' }); assert.equal(cl.status, 200, JSON.stringify(cl.json)); assert.deepEqual([cl.json.data.state, cl.json.data.finalBillRef], ['CLOSED', 'FB/2026/9']); assert.equal(w.d.prepare("SELECT status FROM bud_commitments WHERE src_type = 'ctr_work_order' AND src_id = ? LIMIT 1").get(String(wo.id)).status, 'CLOSED'); await w.drain(); assert.equal(w.events('ctr.wo.closed').length, 1);
  assert.equal((await w.call(U.com, 'POST', `/work-orders/${wo.id}/amend`, { description: 'After closure', changes: [{ lineNo: 1, qty: 200 }] })).status, 422);
  assert.throws(() => sc.workOrders.progress(1, { woId: wo.id, lines: [{ lineNo: 1, executed: 70, billed: 40 }] }), /live work order/);
});

test('FR-04 the margin report, roles, scope, masks, export and the flag', async () => {
  const w = await world(); const a = await approved(w, body(w, { woNo: 'WO-R1' }), [U.com2]); const n = await w.call(U.com, 'POST', '/work-orders', body(w, { woNo: 'WO-R2', items: [{ itemKind: 'BOQ', boqLineId: w.cl2, clientBoqLineId: w.cl2, description: 'Costly', uom: 'cum', qty: 100, rate: 650 }, { itemKind: 'CUSTOM', description: 'Unmapped extra', uom: 'nos', qty: 1, rate: 1000 }] })); await w.call(U.com, 'POST', `/work-orders/${n.json.data.id}/submit`); const wfn = w.wf('ctr_work_orders', n.json.data.id); await w.act(U.com2, wfn); await w.act(U.dir, wfn);
  const rep = (await w.call(U.com, 'GET', '/wo-margin')).json.data; assert.equal(rep.rows.length, 3); assert.deepEqual([rep.totals.negativeCount, rep.totals.unmapped], [1, 1]); assert.equal(rep.totals.margin, 20000 - 15000); assert.equal((await w.call(U.com, 'GET', '/wo-margin?negativeOnly=true')).json.data.rows.length, 1);
  for (const [who, path, want] of [[U.com, '/work-orders', 200], [U.qs, '/work-orders', 200], [U.pd, '/work-orders', 200], [U.pm, '/work-orders', 200], [U.sub, '/work-orders', 200], [U.aud, '/wo-margin', 200], [U.se, '/work-orders', 403], [U.cm, '/work-orders', 403], [U.xcli, '/work-orders', 403]]) assert.equal((await w.call(who, 'GET', path)).status, want, `${who.roles} ${path}`);
  const masked = (await w.call(U.sub, 'GET', `/work-orders/${a.id}`)).json.data; assert.equal(masked.items[0].clientRate, undefined, 'the subcontractor coordinator does not see the client rate'); assert.equal(masked.negativeMargin, null); assert.equal(masked.marginTotals, null); assert.equal(masked.value, 80000, 'but the value of the order');
  assert.equal((await w.call(U.sub, 'GET', '/wo-margin')).json.data.rows.length, 0, 'no margin rows without the margin right');
  assert.equal((await w.call(U.comX, 'GET', `/work-orders/${a.id}`)).status, 404, 'another company'); assert.equal((await w.call(U.sub, 'POST', '/work-orders', body(w))).status, 403);
  const csv = await w.api.raw('GET', '/api/v1/ctr/work-orders/export', { ...U.com }); assert.match(csv.buffer.toString('utf8'), /Record,Work order/); assert.equal((await w.api.raw('GET', `/api/v1/ctr/work-orders/${a.id}/print`, { ...U.com })).status, 200);
  const hist = await w.call(U.com, 'GET', `/work-orders/${a.id}/history`); assert.ok(hist.json.data.approvals.length >= 1);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.ctr.p2103'").run(); assert.equal((await w.call(U.com, 'GET', '/work-orders')).status, 404); assert.equal((await w.call(U.com, 'GET', '/contracts')).status, 200, 'contracts stay on part 21.01');
});
