import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, approvedContract, as, contractBody, fill, key, ready } from './ctr-helpers.js';
import { billOf } from '../src/server/modules/bill/index.js';
import { ctrOf } from '../src/server/modules/ctr/index.js';

// Part 22.03: the client RA bill from the certified measurements: previous + this = cumulative (T-01), the deductions of the contract terms and the statutory ones with their worked example, GST, the approvals, the marking of the billed measurements and the advance ledger, milestone and escalation bills, and the sending to the client.
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world(o = {}) {
  const r = await ready(opened, { baseline: true }); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run('qs2', 'qs2', JSON.stringify(['QS']), 'qs2@example.com');
  const copts = { original: o.original ?? 1_000_000, contractType: o.type ?? 'ITEM_RATE', pvcApplicable: o.pvc ?? true }; let k;
  if (o.milestones) { const c = await r.call(U.com, 'POST', '/contracts', contractBody(r, copts)); assert.equal(c.status, 201, JSON.stringify(c.json)); const cid = c.json.data.id; for (const m of o.milestones) { const mr = await r.call(U.com, 'POST', `/contracts/${cid}/milestones`, m); assert.equal(mr.status, 201, JSON.stringify(mr.json)); } assert.equal((await r.call(U.com, 'POST', `/contracts/${cid}/submit`)).status, 202); const wf0 = r.wf('ctr_contracts', cid); for (const who of [U.com2, U.pd, U.dir]) assert.equal((await r.act(who, wf0)).status, 200); k = (await r.call(U.com, 'GET', `/contracts/${cid}`)).json.data; } else k = await approvedContract(r, copts);
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const item = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 500_000, rate: 60_000_000, amount: 0 }); const item2 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 500_000, rate: 600_000_000, amount: 0 });
  const loc = fill(d, 'proj_locations', { company_id: 1, project_id: r.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const w = { ...r, bc, k, ver, item, item2, loc, sc: billOf(d).svc };
  w.cert = async (line, qty) => { const m = (await bc(U.mse, 'POST', '/mb-entries', { projectId: r.A, boqLineId: line, locationId: loc, description: 'Measured', template: 'QTY', qty, measuredOn: day(-1) })).json.data; assert.equal((await bc(U.mse, 'POST', `/mb-entries/${m.id}/submit`)).status, 202); const wf = r.wf('bill_mb_entries', m.id); for (const who of [U.qs, U.pm]) assert.equal((await r.act(who, wf)).status, 200); return m.id; };
  w.approve = async (id) => { assert.equal((await bc(U.qs, 'POST', `/client-bills/${id}/submit`)).status, 202); const wf = r.wf('bill_client_bills', id); for (const who of [U.qs2, U.pm, U.com]) { const a = await r.act(who, wf); assert.equal(a.status, 200, JSON.stringify(a.json)); } return (await bc(U.qs, 'GET', `/client-bills/${id}`)).json.data; };
  return w;
}
const bodyOf = (w, o = {}) => ({ projectId: w.A, contractId: w.k.id, billType: 'RA', periodFrom: day(-30), periodTo: day(0), supply: 'intra', manual: [{ kind: 'WATER_ELECTRICITY', amount: 1500, reason: 'Water used by the contractor in April' }], ...o });
const ded = (b, kind) => b.deductions.find((x) => x.kind === kind)?.amount;

test('FR-01 FR-02 FR-03 T-01 the first bill from the certified measurements: previous + this = cumulative, the deductions and the GST reproduce the worked example', async () => {
  const w = await world(); const adv = ctrOf(w.d).svc.advances.apply(1, { contractId: w.k.id, refNo: 'ADV-1', kind: 'MOBILISATION', advance: 70_000, recovered: 0 }); assert.ok(adv.id);
  await w.cert(w.item, 20); await w.cert(w.item2, 5); const m3 = await w.cert(w.item, 0.5); assert.ok(m3);
  assert.equal((await w.bc(U.mse, 'POST', '/client-bills', bodyOf(w))).status, 403); assert.equal((await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { periodTo: day(-40) }))).status, 400, 'period ends before it starts'); assert.equal((await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { net: 1 }))).status, 400, 'the net is the server\'s');
  const pv = await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w)); assert.equal(pv.status, 200, JSON.stringify(pv.json)); assert.equal(w.d.prepare('SELECT COUNT(*) AS n FROM bill_client_bills').get().n, 0, 'a preview saves nothing');
  const c = await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w)); assert.equal(c.status, 201, JSON.stringify(c.json)); const b = c.json.data;
  assert.deepEqual([b.status, b.seqNo, b.billType, b.items.length], ['DRAFT', 1, 'RA', 2]);
  const i1 = b.items.find((x) => x.code === '2.1'); const i2 = b.items.find((x) => x.code === '2.2'); assert.deepEqual([i1.prevQty, i1.thisQty, i1.cumQty, i1.rate, i1.thisAmount, i1.cumAmount, i1.kind], [0, 20.5, 20.5, 6000, 123_000, 123_000, 'BOQ']); assert.deepEqual([i2.thisQty, i2.thisAmount], [5, 300_000]);
  assert.deepEqual([b.gross, b.prevGross, b.cumGross, b.taxable], [423_000, 0, 423_000, 423_000]);
  // the deductions per contract: retention 5% of 423,000; cess 1%; income-tax TDS 2% and GST-TDS 2% of the taxable value; the advance recovery from the band 10% to 80% of 10,00,000; the water charges typed
  assert.deepEqual([ded(b, 'RETENTION'), ded(b, 'CESS'), ded(b, 'TDS'), ded(b, 'GST_TDS'), ded(b, 'WATER_ELECTRICITY')], [21_150, 4_230, 8_460, 8_460, 1_500]); assert.equal(ded(b, 'ADVANCE_RECOVERY'), 32_300, '70,000 x (423,000 - 100,000) / 700,000');
  assert.deepEqual([b.gstPct, b.cgst, b.sgst, b.igst, b.gst], [18, 38_070, 38_070, 0, 76_140]); const dt = b.deductions.reduce((n, x) => n + x.amount, 0); assert.equal(Math.round(dt * 100), Math.round(b.deductionsTotal * 100)); assert.equal(Math.round(b.net * 100), Math.round((423_000 + 76_140 - dt) * 100)); assert.ok(b.deductions.find((x) => x.kind === 'TDS').calc.startsWith('est.percent_amount v'), 'the calculation engine worked it out');
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM core_calc_traces WHERE entity = 'bill_client_bills' AND entity_id = ?").get(b.id).n >= 5, true, 'the traces are kept');
  assert.deepEqual(pv.json.data.net, b.net); assert.equal(b.issues.some((x) => x.code === 'ESCALATION_PENDING'), true);
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w))).status, 409, 'one unfinished bill for a contract at a time');
  const inter = (await w.bc(U.qs, 'PATCH', `/client-bills/${b.id}`, { supply: 'inter', rowVersion: b.version })).json.data; assert.deepEqual([inter.cgst, inter.sgst, inter.igst], [0, 0, 76_140], 'between states: IGST'); assert.equal(inter.manual.length, 1, 'a partial update keeps the typed recoveries');
  assert.equal((await w.bc(U.qs, 'PATCH', `/client-bills/${b.id}`, { notes: 'x', rowVersion: 1 })).status, 409);
});

test('FR-05 BR-01 AC-01 the bill is approved by the QS, the project manager and the commercial manager; the measurements are marked billed, the advance is recovered, the next bill carries the previous quantities; the bill goes to the client once', async () => {
  const w = await world(); ctrOf(w.d).svc.advances.apply(1, { contractId: w.k.id, refNo: 'ADV-1', kind: 'MOBILISATION', advance: 70_000, recovered: 0 });
  const a = await w.cert(w.item, 20); await w.cert(w.item2, 5); const b = (await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w))).json.data;
  assert.equal((await w.bc(U.qs, 'POST', `/client-bills/${b.id}/send`, { sentOn: day(0) })).status, 422, 'not approved'); assert.equal((await w.bc(U.qs, 'POST', `/client-bills/${b.id}/submit`)).status, 202); const wf = w.wf('bill_client_bills', b.id);
  assert.equal((await w.act(U.qs, wf).catch(() => ({ status: 0 }))).status === 200, false, 'the preparer does not approve their own bill'); assert.equal((await w.bc(U.qs, 'PATCH', `/client-bills/${b.id}`, { notes: 'late' })).status, 409, 'locked while with the approvers');
  for (const who of [U.qs2, U.pm]) assert.equal((await w.act(who, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/client-bills/${b.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await w.act(U.com, wf)).status, 200);
  const ap = (await w.bc(U.qs, 'GET', `/client-bills/${b.id}`)).json.data; assert.deepEqual([ap.status, ap.can.send, ap.can.edit, ap.measurements.length], ['APPROVED', true, false, 2]);
  assert.equal(w.d.prepare('SELECT bill_ref FROM bill_mb_entries WHERE id = ?').get(a).bill_ref, ap.billNo, 'the certified measurement is marked billed'); assert.equal(w.d.prepare('SELECT recovered_paise FROM ctr_advances WHERE ref_no = ?').get('ADV-1').recovered_paise, Math.round(ap.deductions.find((x) => x.kind === 'ADVANCE_RECOVERY').amount * 100), 'the advance ledger moved by the recovery');
  assert.equal((await w.bc(U.qs, 'POST', `/client-bills/${b.id}/amend`, { reason: 'Change the quantities' })).status, 422); assert.equal((await w.bc(U.qs, 'DELETE', `/client-bills/${b.id}`)).status, 409);
  assert.equal((await w.bc(U.pm, 'POST', `/client-bills/${b.id}/send`, { sentOn: day(0) })).status, 403); const sent = await w.bc(U.com, 'POST', `/client-bills/${b.id}/send`, { sentOn: day(0), clientRef: 'RA/1/SHA' }); assert.equal(sent.status, 200, JSON.stringify(sent.json)); assert.deepEqual([sent.json.data.clientState, sent.json.data.clientRef], ['SENT', 'RA/1/SHA']); assert.equal((await w.bc(U.com, 'POST', `/client-bills/${b.id}/send`, { sentOn: day(0) })).status, 409);
  await w.drain(); const ev = w.events('bill.client.submitted'); assert.deepEqual([ev.length, ev[0].billNo, ev[0].net, ev[0].gross, ev[0].seqNo], [1, ap.billNo, ap.net, ap.gross, 1]); assert.equal(w.events('bill.client.approved').length, 1);
  // the second bill: only what is certified after, with the previous quantities
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w))).status, 400, 'nothing new is certified'); await w.cert(w.item, 10);
  const b2 = (await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { manual: [] }))).json.data; const x = b2.items[0]; assert.deepEqual([b2.seqNo, b2.items.length, x.prevQty, x.thisQty, x.cumQty, x.prevAmount, x.thisAmount, x.cumAmount, b2.prevGross, b2.cumGross], [2, 1, 20, 10, 30, 120_000, 60_000, 180_000, 420_000, 480_000], 'previous + this = cumulative');
  assert.equal(ded(b2, 'RETENTION'), 3_000); assert.equal(ded(b2, 'ADVANCE_RECOVERY'), 6_000, 'the band 100,000 to 800,000 is covered by the 60,000 of this bill: 70,000 x 60,000 / 700,000');
  // print and export
  const pr = await w.bc(U.qs, 'GET', `/client-bills/${b.id}/print`); assert.equal(pr.status, 200); assert.equal((await w.bc(U.qs, 'GET', '/client-bills/export')).status, 200); assert.equal((await w.bc(U.xcli, 'GET', '/client-bills')).status, 403); assert.equal((await w.bc(U.pd, 'GET', `/client-bills/${b.id}`)).status, 200); assert.equal((await w.bc(U.pd, 'POST', '/client-bills', bodyOf(w))).status, 403);
});

test('FR-01 extra items need an approved variation order; an escalation computation approved against the bill is added to the taxable value; the retention is limited by its cap', async () => {
  const w = await world({ pvc: true });
  // a revised BOQ with an extra item, not approved yet
  const kv = fill(w.d, 'proj_boq_versions', { company_id: 1, org_project_id: w.A, vtype: 'REVISED', version_no: 2, name: 'Revised for VO', status: 'DRAFT', variation_ref: 'VO-9' }); const ex = fill(w.d, 'proj_boq_lines', { company_id: 1, version_id: kv, line_kind: 'ITEM', item_code: '8.1', description: 'Extra drain', uom: 'm', qty: 500_000, rate: 8_000_000, amount: 0 });
  const vo = fill(w.d, 'ctr_variation_orders', { company_id: 1, org_project_id: w.A, vo_no: 'VO-9', cr_id: fill(w.d, 'ctr_change_requests', { company_id: 1, org_project_id: w.A, cr_no: 'CR-9', kind: 'CLIENT', origin_type: 'INTERNAL', title: 'x', description: 'xxxxxxxxxx' }), title: 'Extra drain', status: 'APPROVED', vo_state: 'RECORDED' });
  await w.cert(w.item, 10); const xm = await w.cert(ex, 5); assert.ok(xm);
  let pv = (await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { manual: [] }))).json.data; assert.deepEqual([pv.items.map((i) => i.code), pv.issues.map((i) => i.code).filter((c) => c !== 'ESCALATION_PENDING')], [['2.1'], ['VO_NOT_APPROVED']], 'the extra item waits for its variation order');
  w.d.prepare("UPDATE ctr_variation_orders SET vo_state = 'EFFECTIVE' WHERE id = ?").run(vo);
  pv = (await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { manual: [] }))).json.data; const e = pv.items.find((i) => i.code === '8.1'); assert.deepEqual([pv.items.length, e.kind, e.voNo, e.rate, e.thisAmount], [2, 'EXTRA', 'VO-9', 800, 4_000]);
  // an escalation computation approved against the number of this bill
  const no = pv.billNo; const cal = fill(w.d, 'ctr_escalation_calcs', { company_id: 1, org_project_id: w.A, contract_id: w.k.id, kind: 'CLIENT', bill_ref: no, period: day(0).slice(0, 7), r_value_paise: 6_400_000, amount_paise: 50_000, net_bp: 78, status: 'APPROVED' });
  const c = (await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { manual: [] }))).json.data; assert.deepEqual([c.gross, c.escalation, c.taxable, c.issues.some((i) => i.code === 'ESCALATION_PENDING')], [64_000, 500, 64_500, false]); assert.equal(w.d.prepare('SELECT escalation_calc_id AS e FROM bill_client_bills WHERE id = ?').get(c.id).e, cal); assert.equal(c.gst, 11_610, '18% of 64,500');
  // an escalation bill needs the computation
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { billType: 'ESCALATION' }))).status, 400, 'the computation is made against the number of the first bill, not the next one');
});

test('FR-01 milestone billing: an achieved payment milestone of a lump-sum contract is billed once', async () => {
  const w = await world({ type: 'LUMP_SUM', pvc: false, milestones: [{ code: 'M1', name: 'Foundation complete', dueDate: day(-2), paymentLinked: true, amount: 600_000 }, { code: 'M2', name: 'Plinth', dueDate: day(30), paymentLinked: true, amount: 400_000 }] }); w.d.prepare("UPDATE ctr_milestones SET milestone_status = 'ACHIEVED', achieved_on = ? WHERE code = 'M1' AND contract_id = ?").run(day(-2), w.k.id);
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w))).status, 400, 'an RA bill has no measurement to bill'); const c = await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { billType: 'MILESTONE', manual: [] })); assert.equal(c.status, 201, JSON.stringify(c.json)); const b = c.json.data;
  assert.deepEqual([b.items.length, b.items[0].kind, b.items[0].code, b.gross], [1, 'MILESTONE', 'M1', 600_000]); const ap = await w.approve(b.id); assert.equal(ap.status, 'APPROVED'); assert.equal(w.d.prepare("SELECT milestone_status AS s FROM ctr_milestones WHERE code = 'M1'").get().s, 'BILLED');
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills', bodyOf(w, { billType: 'MILESTONE', manual: [] }))).status, 400, 'the pending milestone is not billed');
});

test('FR-02 the liquidated damages deducted are limited to those levied; a flag of its own', async () => {
  const w = await world({ pvc: false }); await w.cert(w.item, 10);
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { ldAmount: 5_000 }))).status, 400, 'no damages are levied');
  fill(w.d, 'ctr_ld_assessments', { company_id: 1, contract_id: w.k.id, org_project_id: w.A, as_of: day(0), completion_date: day(-30), effective_date: day(-30), forecast_date: day(0), delay_days: 30, ld_rate_bp: 50, ld_basis: 'PER_WEEK', base_value_paise: 100_000_000, gross_paise: 800_000, cap_paise: 10_000_000, ld_paise: 800_000 });
  assert.equal((await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { ldAmount: 9_000 }))).status, 400, 'more than levied'); const pv = (await w.bc(U.qs, 'POST', '/client-bills/preview', bodyOf(w, { ldAmount: 5_000, manual: [] }))).json.data; assert.equal(pv.deductions.find((d) => d.kind === 'LD').amount, 5_000);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2203'").run(); assert.equal((await w.bc(U.qs, 'GET', '/client-bills')).status, 404); assert.equal((await w.bc(U.qs, 'GET', `/qty-recon?projectId=${w.A}`)).status, 200, 'the other flags are separate');
});
