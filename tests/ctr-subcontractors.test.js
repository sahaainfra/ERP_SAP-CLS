import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, ready, approvedContract } from './ctr-helpers.js';
import { missingOf, weightsOf } from '../src/server/modules/ctr/subcontractors.js';
import { ctrOf } from '../src/server/modules/ctr/index.js';

// Part 21.04: the monthly compliance of a subcontractor (compiled by the coordinator, verified by a second person), the payment hold that follows from a missing mandatory item past its due date (T-01) and its waiver by approval, the labour strength against the committed manpower, ratings and the workspace.
const U = { ...BASE, sub: as('SUBCO', 'sub1'), hr: as('HRMGR', 'hr1') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const periodOf = (monthsBack) => { const d = new Date(Date.now() + 5.5 * 3600_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - monthsBack); return d.toISOString().slice(0, 7); };
async function world() {
  const r = await ready(opened); const d = r.d; const k = await approvedContract(r);
  const sub = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'SUB1', 'Shree Earthworks', 'Shree', 'PARTNERSHIP', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid); fill(d, 'mdm_partner_roles', { company_id: 1, partner_id: sub, partner_role: 'SUBCONTRACTOR' });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED' }); const bl = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '1.1', description: 'Earthwork', uom: 'cum', qty: 1_000_000, rate: 10_000_000, amount: 0 });
  const wo = await r.call(U.com, 'POST', '/work-orders', { projectId: r.A, woNo: 'WO-S1', woType: 'ITEM_RATE', contractId: k.id, subcontractorId: sub, selectionKind: 'NEGOTIATED', justification: 'Only local party with the plant', title: 'Earthwork', startDate: day(-120), endDate: day(180), retentionPct: 5, sdPct: 0, advancePct: 10, advanceRecoveryPct: 20, gstMode: 'FORWARD', gstPct: 18, paymentDays: 30, ldPct: 0, ldCapPct: 0, safetyPenalty: 0, terms: {}, freeIssue: [], items: [{ itemKind: 'BOQ', boqLineId: bl, clientBoqLineId: bl, description: 'Earthwork', uom: 'cum', qty: 1000, rate: 800 }] });
  assert.equal(wo.status, 201, JSON.stringify(wo.json)); assert.equal((await r.call(U.com, 'POST', `/work-orders/${wo.json.data.id}/submit`)).status, 202); assert.equal((await r.act(U.com2, r.wf('ctr_work_orders', wo.json.data.id))).status, 200);
  return { ...r, k, sub, wo: wo.json.data, bl, svc: ctrOf(d).svc.subcontractors };
}
const ok = (code, ref = 'REF-1') => ({ code, status: 'OK', ref, validUntil: null, note: null });
const allOk = () => ['CLRA', 'PF', 'ESI', 'WAGE_REG', 'WC_INSURANCE', 'BOCW'].map((c) => ok(c)).concat([{ code: 'GST_RETURN', status: 'NA', ref: null, validUntil: null, note: null }]).map((i) => (['CLRA', 'WC_INSURANCE', 'BOCW'].includes(i.code) ? { ...i, validUntil: day(400) } : i));

test('the weights of the rating and the mandatory items that are not in order', () => {
  assert.deepEqual(weightsOf('40,25,20,15'), [40, 25, 20, 15]); assert.deepEqual(weightsOf('50,50'), [40, 25, 20, 15]); assert.deepEqual(weightsOf('60,20,20,10'), [40, 25, 20, 15], 'not 100');
  assert.deepEqual(missingOf([{ code: 'PF', status: 'MISSING' }, { code: 'ESI', status: 'OK' }, { code: 'GST_RETURN', status: 'MISSING' }, { code: 'BOCW', status: 'NA' }], ['PF', 'ESI', 'BOCW']), ['PF']);
});

test('FR-01 FR-02 BR-01 T-01 the month is opened, compiled and verified by a second person; a missing PF challan past the due date holds payment; verified and complete lifts it', async () => {
  const w = await world(); const old = periodOf(2); const sw = w.svc;
  assert.equal((await w.call(U.pm, 'POST', '/sub-compliance/open', { period: old })).status, 403);
  const op = await w.call(U.sub, 'POST', '/sub-compliance/open', { period: old }); assert.equal(op.status, 201, JSON.stringify(op.json)); assert.equal(op.json.data.opened, 1); assert.equal((await w.call(U.sub, 'POST', '/sub-compliance/open', { period: old })).json.data.opened, 0, 'opened once');
  const id = op.json.data.ids[0]; const c0 = (await w.call(U.sub, 'GET', `/sub-compliance/${id}`)).json.data; assert.deepEqual([c0.state, c0.missing, c0.items.length, c0.overdue], ['OPEN', 6, 7, true]); assert.equal(c0.dueDate.slice(0, 7) <= periodOf(1), true);
  // the licence of the labour compliance register covers the month
  const w2 = await world(); fill(w2.d, 'lab_contractor_compliance', { company_id: 1, contractor_id: w2.sub, clra_licence_no: 'CLRA/77', licence_valid_until: day(300) }); const id2 = (await w2.call(U.sub, 'POST', '/sub-compliance/open', { period: periodOf(1) })).json.data.ids[0]; const c2 = (await w2.call(U.sub, 'GET', `/sub-compliance/${id2}`)).json.data; assert.deepEqual([c2.items.find((i) => i.code === 'CLRA').status, c2.items.find((i) => i.code === 'CLRA').ref, c2.missing], ['OK', 'CLRA/77', 5], 'the CLRA licence comes from the register');
  // T-01: PF missing past the due date -> hold
  const items = allOk().filter((i) => i.code !== 'PF').concat([{ code: 'PF', status: 'MISSING', ref: null, validUntil: null, note: 'Challan not paid' }]);
  assert.equal((await w.call(U.pm, 'PUT', `/sub-compliance/${id}/items`, { items })).status, 403); assert.equal((await w.call(U.sub, 'PUT', `/sub-compliance/${id}/items`, { items: [{ code: 'PF', status: 'OK', ref: null }] })).status, 400, 'in order needs its reference');
  const saved = await w.call(U.sub, 'PUT', `/sub-compliance/${id}/items`, { items }); assert.equal(saved.status, 200, JSON.stringify(saved.json)); assert.deepEqual([saved.json.data.missing, saved.json.data.scorePct], [1, 83.33]);
  const gate = (await w.call(U.acc, 'GET', `/sub-payment-check?subcontractorId=${w.sub}&projectId=${w.A}`)).json.data; assert.equal(gate.blocked, true); assert.match(gate.reasons[0], /PF challan and ECR missing/); await w.drain(); const ev = w.events('ctr.sub.hold_changed'); assert.deepEqual([ev.length, ev[0].hold, ev[0].subcontractor], [1, true, 'Shree Earthworks']);
  assert.equal((await w.call(U.sub, 'GET', `/subcontractors/workspace?subcontractorId=${w.sub}&projectId=${w.A}`)).json.data.hold.active, true);
  // submit and verify: not by the compiler; return needs a note
  assert.equal((await w.call(U.sub, 'POST', `/sub-compliance/${id}/submit`)).status, 202); assert.equal((await w.call(U.sub, 'POST', `/sub-compliance/${id}/verify`, { approve: true })).status, 403, 'the coordinator has no verify right');
  assert.equal((await w.call(U.hr, 'POST', `/sub-compliance/${id}/verify`, { approve: false })).status, 400); const ret = await w.call(U.hr, 'POST', `/sub-compliance/${id}/verify`, { approve: false, note: 'PF challan of the month is missing' }); assert.equal(ret.json.data.state, 'RETURNED');
  const fixed = allOk(); assert.equal((await w.call(U.sub, 'PUT', `/sub-compliance/${id}/items`, { items: fixed })).json.data.missing, 0); assert.equal((await w.call(U.sub, 'POST', `/sub-compliance/${id}/submit`)).status, 202);
  const same = await w.call(U.hr, 'POST', `/sub-compliance/${id}/verify`, { approve: true }); assert.equal(same.status, 200, JSON.stringify(same.json)); assert.deepEqual([same.json.data.state, same.json.data.verifiedBy], ['VERIFIED', 'hr1']);
  assert.equal(sw.paymentGate(1, { subcontractorId: w.sub, projectId: w.A }).blocked, false, 'verified and complete: the hold is lifted'); await w.drain(); assert.deepEqual(w.events('ctr.sub.hold_changed').map((e) => e.hold), [true, false]); assert.equal(w.events('ctr.sub.compliance_verified').length, 1);
  // configurable: the hold can be turned off
  w.setParam('ctr.sub.hold_enabled', 'false', 'boolean'); await w.call(U.sub, 'POST', '/sub-compliance/open', { period: periodOf(3) });
});

test('FR-02 a waiver (commercial manager, then project director) lifts the hold until it ends; the daily job opens the month, sets holds and rates', async () => {
  const w = await world(); const sw = w.svc; const old = periodOf(2); const id = (await w.call(U.sub, 'POST', '/sub-compliance/open', { period: old })).json.data.ids[0];
  await w.call(U.sub, 'PUT', `/sub-compliance/${id}/items`, { items: allOk().filter((i) => i.code !== 'PF').concat([{ code: 'PF', status: 'MISSING', ref: null, validUntil: null, note: null }]) }); assert.equal(sw.paymentGate(1, { subcontractorId: w.sub, projectId: w.A }).blocked, true);
  assert.equal((await w.call(U.sub, 'POST', '/sub-waivers', { complianceId: id, items: ['ESI'], reason: 'ESI portal was down', validUntil: day(20) })).status, 400, 'ESI is not missing'); assert.equal((await w.call(U.pm, 'POST', '/sub-waivers', { complianceId: id, items: ['PF'], reason: 'PF challan being paid', validUntil: day(20) })).status, 403);
  const wv = await w.call(U.sub, 'POST', '/sub-waivers', { complianceId: id, items: ['PF'], reason: 'PF challan being paid this week', validUntil: day(20) }); assert.equal(wv.status, 201, JSON.stringify(wv.json)); assert.equal((await w.call(U.sub, 'POST', `/sub-waivers/${wv.json.data.id}/submit`)).status, 202);
  const wf = w.wf('ctr_sub_waivers', wv.json.data.id); await w.act(U.com, wf); assert.equal(sw.paymentGate(1, { subcontractorId: w.sub, projectId: w.A }).blocked, true, 'not before the project director'); await w.act(U.pd, wf);
  assert.equal(sw.paymentGate(1, { subcontractorId: w.sub, projectId: w.A }).blocked, false, 'the waiver lifts the hold'); await w.drain(); assert.equal(w.events('ctr.sub.waiver_approved').length, 1);
  // after the waiver ends the hold returns
  w.d.prepare('UPDATE ctr_sub_waivers SET valid_until = ?').run(day(-1)); assert.equal(sw.recomputeHold(1, w.sub, w.A).hold, true);
  // the sweep: opens last month for the live work order, rates it
  const r = sw.sweep(1); assert.ok(r.opened >= 1); assert.ok(r.rated >= 1); assert.equal(sw.sweep(1).opened, 0, 'idempotent');
});

test('FR-03 the daily labour strength against the committed manpower; shortfall alerts once; ratings; the workspace and its financial summary', async () => {
  const w = await world(); const sw = w.svc;
  assert.equal((await w.call(U.pm, 'PUT', '/sub-manpower', { subcontractorId: w.sub, projectId: w.A, tradeCode: 'MASON', committed: 20, fromDate: day(-30) })).status, 403);
  assert.equal((await w.call(U.sub, 'PUT', '/sub-manpower', { subcontractorId: w.sub, projectId: w.A, tradeCode: 'MASON', committed: 20, fromDate: day(-30) })).status, 200); await w.call(U.sub, 'PUT', '/sub-manpower', { subcontractorId: w.sub, projectId: w.A, tradeCode: 'HELPER', committed: 30, fromDate: day(-30) });
  const dpr = (n, mason, helper, status = 'APPROVED') => { const id = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_date: day(n), status }); fill(w.d, 'site_dpr_labour', { company_id: 1, dpr_id: id, category: 'CONTRACT', contractor_id: w.sub, trade_code: 'MASON', headcount: mason }); fill(w.d, 'site_dpr_labour', { company_id: 1, dpr_id: id, category: 'CONTRACT', contractor_id: w.sub, trade_code: 'HELPER', headcount: helper }); };
  dpr(-1, 10, 20); dpr(-2, 20, 30); dpr(-3, 18, 28, 'DRAFT');
  const st = (await w.call(U.pm, 'GET', `/sub-strength?projectId=${w.A}&from=${day(-3)}&to=${day(-1)}`)).json.data; const s0 = st.subcontractors[0]; assert.deepEqual([s0.days, s0.reportedDays, s0.flaggedDays, s0.notReported], [3, 2, 1, 1], 'a draft report does not count');
  const y = s0.rows.find((x) => x.date === day(-1)); assert.deepEqual([y.committed, y.actual, y.shortfall, y.shortfallPct, y.flagged], [50, 30, 20, 40, true]); assert.equal(s0.rows.find((x) => x.date === day(-2)).flagged, false);
  assert.equal(sw.strengthSweep(1).told, 1); assert.equal(sw.strengthSweep(1).told, 1, 'the notification is once for the day'); await w.drain(); assert.equal(w.events('ctr.sub.shortfall')[0].shortfallPct, 40);
  // progress, ratings
  sw; const ctr = ctrOf(w.d).svc; ctr.workOrders.progress(1, { woId: w.wo.id, lines: [{ lineNo: 1, executed: 400, billed: 300 }] });
  const nr = await w.call(U.com, 'POST', '/sub-ratings/run', { period: periodOf(1) }); assert.equal(nr.status, 201, JSON.stringify(nr.json)); const row = nr.json.data.rows[0]; assert.deepEqual([row.weights, row.compliance, row.safety, row.band >= 'A'], [[40, 25, 20, 15], 0, 100, true]); assert.equal(row.total, Math.round((row.progress * 40 + row.quality * 25 + row.safety * 20 + 0) / 100));
  fill(w.d, 'hse_contractor_scores', { company_id: 1, partner_id: w.sub, period: periodOf(1), score: 60, band: 'C' }); fill(w.d, 'qa_ncrs', { company_id: 1, org_project_id: w.A, severity: 'MAJOR', responsible_type: 'SUBCONTRACTOR', responsible_id: w.sub, status: 'OPEN' });
  const r2 = (await w.call(U.com, 'POST', '/sub-ratings/run', { period: periodOf(1) })).json.data.rows[0]; assert.deepEqual([r2.safety, r2.quality], [60, 85], 'the hse score and an open major NCR'); assert.equal((await w.call(U.pm, 'POST', '/sub-ratings/run', { period: periodOf(1) })).status, 403); await w.drain(); assert.equal(w.events('ctr.sub.rated').length, 2);
  const ws = (await w.call(U.pm, 'GET', `/subcontractors/workspace?subcontractorId=${w.sub}&projectId=${w.A}`)).json.data; assert.deepEqual([ws.financial.value, ws.financial.certified, ws.financial.billed, ws.financial.retentionHeld, ws.financial.advanceGiven, ws.financial.advanceRecovered, ws.financial.advanceOutstanding, ws.financial.paid], [800000, 320000, 240000, 12000, 80000, 48000, 32000, null]); assert.equal(ws.performance.latest.total, r2.total); assert.equal(ws.performance.safety.score, 60); assert.deepEqual(ws.performance.openNcrs, { MAJOR: 1 });
  const lst = (await w.call(U.pm, 'GET', '/subcontractors')).json.data; assert.deepEqual([lst.length, lst[0].workOrders, lst[0].value, lst[0].hold], [1, 1, 800000, false]);
  for (const [who, path, want] of [[U.com, '/subcontractors', 200], [U.sub, '/sub-compliance', 200], [U.hr, '/sub-compliance', 200], [U.pm, '/sub-ratings', 200], [U.se, '/subcontractors', 403], [U.cm, '/sub-compliance', 403], [U.xcli, '/subcontractors', 403]]) assert.equal((await w.call(who, 'GET', path)).status, want, `${who.roles} ${path}`);
  assert.equal((await w.call(U.comX, 'GET', `/subcontractors/workspace?subcontractorId=${w.sub}&projectId=${w.A}`)).status, 404, 'another company');
  const csv = await w.api.raw('GET', '/api/v1/ctr/sub-compliance/export', { ...U.com }); assert.match(csv.buffer.toString('utf8'), /Record,Month/);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.ctr.p2104'").run(); assert.equal((await w.call(U.com, 'GET', '/subcontractors')).status, 404); assert.equal((await w.call(U.com, 'GET', '/work-orders')).status, 200, 'work orders stay on part 21.03');
});
