import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, key, ready } from './ctr-helpers.js';
import { billOf } from '../src/server/modules/bill/index.js';

// Part 22.02: the quantity chain of every BOQ item and location read from the owners of each figure (T-01), the forecast, the items approaching their limit, deviation statements (prepared, recomputed on submit, approved, sent to the client, accepted into a change request) and the register of extra and substituted items.
const U = { ...BASE, mse: as('SE', 'mse1'), qs2: as('QS', 'qs2') };
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
const recon = async (w, who = U.qs, q = '') => (await w.bc(who, 'GET', `/qty-recon?projectId=${w.A}${q}`)).json.data;
const row = (rep, code, loc) => rep.rows.find((r) => r.code === code && (loc === undefined || r.location === loc));
const forecast = (w, who, line, qty, basis = 'Quantities of the revised drawings') => w.bc(who, 'PUT', '/qty-forecasts', { projectId: w.A, boqLineId: line, forecastQty: qty, basis });

test('FR-01 T-01 BR-01 the chain of quantities equals the sums of the source modules, per item and per location; nothing is typed but the forecast', async () => {
  const w = await world();
  const dpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: w.site, dpr_date: day(-2), status: 'APPROVED' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 18_000, uom: 'cum' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 12_000, uom: 'cum' });
  const draftDpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: fill(w.d, 'org_sites', { company_id: 1, org_project_id: w.A, code: 'S9', name: 'Site 9' }), dpr_date: day(-1), status: 'DRAFT' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: draftDpr, wa_id: w.wa, activity_id: w.a1, qty: 99_000 });
  const a = await mk(w, { qty: 22 }); await certify(w, a.id); const b = await mk(w, { qty: 8 }); await submit(w, b.id); await mk(w, { qty: 5 });
  let rep = await recon(w); let r = row(rep, '2.1');
  assert.deepEqual([r.contract, r.revised, r.executed, r.measured, r.certified, r.billed, r.paid, r.balance, r.forecast, r.projected, r.deviationPct, r.level, r.forecastSource], [100, 100, 30, 30, 22, 0, 0, 78, null, 100, 0, 'OK', 'PROJECTED'], 'a report not approved and a draft measurement are not in the chain');
  assert.deepEqual([row(rep, '2.2').contract, row(rep, '2.2').measured, row(rep, '2.2').level], [50, 0, 'OK']);
  // T-01: the totals equal the sums of the owners
  const sql = (q) => w.d.prepare(q).get(1, w.A).s; const sumMeasured = sql("SELECT COALESCE(SUM(CASE WHEN status = 'APPROVED' THEN certified_qty_th ELSE qty_th END), 0) AS s FROM bill_mb_entries WHERE company_id = ? AND org_project_id = ? AND status IN ('SUBMITTED', 'APPROVED')") / 1000; const sumCert = sql("SELECT COALESCE(SUM(certified_qty_th), 0) AS s FROM bill_mb_entries WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED'") / 1000; const sumDpr = sql("SELECT COALESCE(SUM(w.qty), 0) AS s FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id WHERE w.company_id = ? AND d.org_project_id = ? AND d.status = 'APPROVED'") / 1000;
  const tot = (u) => rep.totals.find((t) => t.uom === u); assert.deepEqual([tot('cum').measured, tot('cum').certified, tot('cum').executed], [sumMeasured, sumCert, sumDpr]); assert.deepEqual([rep.counts.items, rep.totals.length], [3, 3]);
  // billed follows the bill that took the certified entry
  w.sc.mb.markBilled(1, { mbIds: [a.id], billRef: 'RA-1' }); r = row(await recon(w), '2.1'); assert.deepEqual([r.billed, r.certified, r.paid], [22, 22, 0]);
  // per location, with the drill-down to the records
  const byLoc = await recon(w, U.qs, '&by=location'); const l = row(byLoc, '2.1', 'Block 1'); assert.deepEqual([l.executed, l.measured, l.certified, l.contract], [30, 30, 22, null]);
  const det = (await w.bc(U.qs, 'GET', `/qty-recon/detail?projectId=${w.A}&code=2.1`)).json.data; assert.deepEqual([det.entries.length, det.dpr.length, det.locations.length, det.item.certified], [3, 2, 1, 22]); assert.equal(det.entries.find((e) => e.id === a.id).billRef, 'RA-1');
  assert.equal((await w.bc(U.qs, 'GET', `/qty-recon/detail?projectId=${w.A}&code=9.9`)).status, 422);
  // the approved variation raises the revised quantity; the contract quantity stays
  const kv = fill(w.d, 'proj_boq_versions', { company_id: 1, org_project_id: w.A, vtype: 'REVISED', version_no: 2, name: 'Revised for VO', status: 'DRAFT', variation_ref: 'VO-5' }); fill(w.d, 'proj_boq_lines', { company_id: 1, version_id: kv, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 120_000, rate: 60_000_000, amount: 0 });
  assert.equal(row(await recon(w), '2.1').revised, 100, 'not approved yet'); fill(w.d, 'ctr_variation_orders', { company_id: 1, org_project_id: w.A, vo_no: 'VO-5', cr_id: fill(w.d, 'ctr_change_requests', { company_id: 1, org_project_id: w.A, cr_no: 'CR-5', kind: 'CLIENT', origin_type: 'INTERNAL', title: 'x', description: 'xxxxxxxxxx' }), title: 'More footings', status: 'APPROVED', vo_state: 'EFFECTIVE' });
  r = row(await recon(w), '2.1'); assert.deepEqual([r.contract, r.revised, r.balance], [100, 120, 98]);
  // export
  const ex = await w.bc(U.qs, 'GET', `/qty-recon/export?projectId=${w.A}`); assert.equal(ex.status, 200); assert.equal((await w.bc(U.mse, 'GET', `/qty-recon/export?projectId=${w.A}`)).status, 403);
});

test('FR-01 BR-01 the forecast is the only typed quantity: it needs a basis, a right and is kept for the estimate at completion', async () => {
  const w = await world();
  assert.equal((await forecast(w, U.mse, w.item, 140)).status, 403); assert.equal((await forecast(w, U.qs, w.item, 140, 'x')).status, 400); assert.equal((await w.bc(U.qs, 'PUT', '/qty-forecasts', { projectId: w.A, boqLineId: w.item, forecastQty: 140, basis: 'Revised drawings', measured: 1 })).status, 400, 'no other quantity is accepted');
  const f = await forecast(w, U.qs, w.item, 140); assert.equal(f.status, 200, JSON.stringify(f.json)); assert.deepEqual([f.json.data.forecast, f.json.data.deviationPct, f.json.data.level, f.json.data.forecastSource, f.json.data.forecastBasis], [140, 40, 'FORECAST_OVER', 'FORECAST', 'Quantities of the revised drawings']);
  assert.equal((await forecast(w, U.pm, w.item, 135, 'Re-measured at the site')).json.data.forecast, 135, 'a new forecast replaces the old'); assert.equal(w.d.prepare('SELECT COUNT(*) AS n FROM bill_qty_forecasts WHERE deleted_at IS NULL').get().n, 1);
  assert.equal((await forecast(w, U.qs, w.item2, 20)).json.data.deviationPct, -60); await w.drain(); const ev = w.events('bill.qty.forecast'); assert.deepEqual([ev.length, ev[1].forecastQty, ev[1].previous, ev[1].boqCode], [3, 135, 140, '2.1']);
  assert.deepEqual(w.sc.recon.forecastsOf(1, w.A).find((x) => x.boqCode === '2.1'), { boqCode: '2.1', boqLineId: w.item, uom: 'cum', revisedQty: 100, forecastQty: 135, source: 'FORECAST', rate: 6000 });
  assert.equal((await w.bc(U.qs, 'DELETE', `/qty-forecasts?projectId=${w.A}&code=2.1`)).status, 200); assert.equal(row(await recon(w), '2.1').forecast, null); assert.equal((await w.bc(U.qs, 'DELETE', `/qty-forecasts?projectId=${w.A}&code=2.1`)).status, 409);
});

test('FR-04 the items approaching or beyond their quantity are listed and told once to the QS and the project manager', async () => {
  const w = await world();
  const m = await mk(w, { qty: 92 }); await submit(w, m.id); const lim = (await w.bc(U.pm, 'GET', `/qty-limits?projectId=${w.A}`)).json.data;
  assert.deepEqual([lim.counts.approaching, lim.counts.over, lim.rows.length, lim.rows[0].code, lim.rows[0].usedPct, lim.alertPct], [1, 0, 1, '2.1', 92, 90]);
  await forecast(w, U.qs, w.item2, 60); const lim2 = (await w.bc(U.pm, 'GET', `/qty-limits?projectId=${w.A}`)).json.data; assert.deepEqual(lim2.rows.map((r) => [r.code, r.level]), [['2.1', 'APPROACHING'], ['2.2', 'FORECAST_OVER']]);
  const before = w.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE company_id = 1").get().n; assert.equal(w.sc.recon.sweep(1).told, 2); const after1 = w.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE company_id = 1").get().n; assert.ok(after1 > before, 'the alerts are in the inboxes'); w.sc.recon.sweep(1); assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE company_id = 1").get().n, after1, 'told once for each level');
  assert.equal((await w.bc(U.xcli, 'GET', `/qty-limits?projectId=${w.A}`)).status, 403);
});

test('FR-02 AC-01 a deviation statement lists the items beyond the allowed percentage with reasons, is recomputed on submit, approved by the commercial manager and the project manager, sent to the client and, on acceptance, raises the change request of 21.05', async () => {
  const w = await world(); await forecast(w, U.qs, w.item, 140); await forecast(w, U.qs, w.item2, 20); await forecast(w, U.qs, w.item3, 220);
  const cand = (await w.bc(U.qs, 'GET', `/deviation-statements/candidates?projectId=${w.A}`)).json.data; assert.deepEqual([cand.thresholdPct, cand.rows.map((r) => [r.code, r.deviationPct, r.direction])], [25, [['2.1', 40, 'OVER'], ['2.2', -60, 'UNDER']]], '2.3 is 10% over: within the allowance');
  const body = (o = {}) => ({ projectId: w.A, period: '2026-12', items: [{ boqLineId: w.item, reason: 'Extra footings for the revised drawings' }, { boqLineId: w.item2, reason: 'Steel supplied by the client' }], ...o });
  assert.equal((await w.bc(U.mse, 'POST', '/deviation-statements', body())).status, 403); assert.equal((await w.bc(U.qs, 'POST', '/deviation-statements', body({ netEffect: 1 }))).status, 400, 'totals are the server\'s'); assert.equal((await w.bc(U.qs, 'POST', '/deviation-statements', body({ items: [{ boqLineId: w.item3, reason: 'Within the allowance' }] }))).status, 400); assert.equal((await w.bc(U.qs, 'POST', '/deviation-statements', body({ items: [{ boqLineId: w.item, reason: 'x' }] }))).status, 400);
  const c = await w.bc(U.qs, 'POST', '/deviation-statements', body()); assert.equal(c.status, 201, JSON.stringify(c.json)); const ds = c.json.data; assert.deepEqual([ds.status, ds.itemCount, ds.overCount, ds.underCount, ds.netEffect, ds.thresholdPct, ds.clientState], ['DRAFT', 2, 1, 1, -1_560_000, 25, 'NOT_SENT'], '+40 cum at 6000 and -30 MT at 60000');
  assert.deepEqual(ds.can.send, false); const up = await w.bc(U.qs, 'PATCH', `/deviation-statements/${ds.id}`, { notes: 'For the January meeting', rowVersion: ds.version }); assert.deepEqual([up.json.data.notes, up.json.data.period, up.json.data.itemCount], ['For the January meeting', '2026-12', 2], 'a partial update keeps the rest');
  await forecast(w, U.qs, w.item, 150); const sb = await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/submit`); assert.equal(sb.status, 202, JSON.stringify(sb.json)); const sub = (await w.bc(U.qs, 'GET', `/deviation-statements/${ds.id}`)).json.data; assert.deepEqual([sub.items[0].projected, sub.items[0].deviationPct, sub.netEffect], [150, 50, -1_500_000], 'recomputed from the chain on submit');
  const wf = w.wf('bill_deviation_statements', ds.id); assert.equal((await w.bc(U.qs, 'PATCH', `/deviation-statements/${ds.id}`, { notes: 'late' })).status, 409); assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/send`, { sentOn: day(0) })).status, 422, 'not approved yet');
  assert.equal((await w.act(U.com, wf)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/deviation-statements/${ds.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await w.act(U.pm, wf)).status, 200);
  const ap = (await w.bc(U.qs, 'GET', `/deviation-statements/${ds.id}`)).json.data; assert.deepEqual([ap.status, ap.can.send, ap.can.edit, ap.can.amend], ['APPROVED', true, false, false]); assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/amend`, { reason: 'Change the reasons' })).status, 422); assert.equal((await w.bc(U.qs, 'DELETE', `/deviation-statements/${ds.id}`)).status, 409);
  assert.equal((await w.bc(U.pm, 'POST', `/deviation-statements/${ds.id}/send`, { sentOn: day(0) })).status, 403, 'the project manager approves, the QS sends'); const sent = await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/send`, { sentOn: day(0), clientRef: 'CLT/DS/1' }); assert.deepEqual([sent.json.data.clientState, sent.json.data.clientRef], ['SENT', 'CLT/DS/1']); assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/send`, { sentOn: day(0) })).status, 409);
  assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/respond`, { decision: 'ACCEPTED', respondedOn: day(1) })).status, 400, 'an accepted deviation says what it leads to');
  const rs = await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/respond`, { decision: 'ACCEPTED', respondedOn: day(1), outcome: 'VARIATION', clientRef: 'CLT/L/9' }); assert.equal(rs.status, 200, JSON.stringify(rs.json)); const done = rs.json.data; assert.deepEqual([done.clientState, done.outcome, Boolean(done.crId), Boolean(done.crNo)], ['ACCEPTED', 'VARIATION', true, true]);
  const cr = w.d.prepare('SELECT * FROM ctr_change_requests WHERE id = ?').get(done.crId); assert.deepEqual([cr.origin_type, cr.origin_ref, cr.kind, cr.status, cr.source_type, cr.org_project_id], ['QTY_DEVIATION', ds.dsNo, 'CLIENT', 'DRAFT', 'bill_deviation_statement', w.A]); assert.match(cr.description, /2\.1 RCC M25 in footings: contract 100 cum, projected 150 \(\+50%\)/);
  assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${ds.id}/respond`, { decision: 'REJECTED', respondedOn: day(1) })).status, 422, 'answered once'); await w.drain(); const ev = w.events('bill.deviation.responded'); assert.deepEqual([ev.length, ev[0].decision, ev[0].changeRequestId, ev[0].items.length, ev[0].items[0].boqCode], [1, 'ACCEPTED', done.crId, 2, '2.1']); assert.equal(w.events('bill.deviation.approved').length, 1);
  const cs = (await w.bc(U.ctrQs ?? U.qs, 'GET', `/qty-recon/detail?projectId=${w.A}&code=2.1`)).json.data; assert.equal(cs.statements.length, 1, 'the item shows its statement'); assert.equal((await w.bc(U.qs, 'GET', `/deviation-statements/${ds.id}/print`)).status, 200); assert.equal((await w.bc(U.qs, 'GET', '/deviation-statements/export')).status, 200);
  // the client rejects another statement: no change request
  const d2 = (await w.bc(U.qs, 'POST', '/deviation-statements', body({ period: '2027-01', items: [{ boqLineId: w.item2, reason: 'Steel is supplied by the client' }] }))).json.data; await submit2(w, d2.id); await w.bc(U.qs, 'POST', `/deviation-statements/${d2.id}/send`, { sentOn: day(0) }); const rj = (await w.bc(U.qs, 'POST', `/deviation-statements/${d2.id}/respond`, { decision: 'REJECTED', respondedOn: day(2) })).json.data; assert.deepEqual([rj.clientState, rj.outcome, rj.crId], ['REJECTED', 'NONE', null]);
  // the list and the flag
  assert.equal((await w.bc(U.qs, 'GET', '/deviation-statements')).json.data.length, 2); assert.equal((await w.bc(U.xcli, 'GET', '/deviation-statements')).status, 403);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2202'").run(); assert.equal((await w.bc(U.qs, 'GET', '/deviation-statements')).status, 404); assert.equal((await w.bc(U.qs, 'GET', `/qty-recon?projectId=${w.A}`)).status, 404); assert.equal((await w.bc(U.qs, 'GET', '/mb-entries')).status, 200, 'the measurement book is a flag of its own');
});
async function submit2(w, id) { assert.equal((await w.bc(U.qs, 'POST', `/deviation-statements/${id}/submit`)).status, 202); const wf = w.wf('bill_deviation_statements', id); for (const who of [U.com, U.pm]) assert.equal((await w.act(who, wf)).status, 200); }

test('FR-03 an extra or substituted item waits with its provisional quantity until the client decides; the decision is not made by the person who entered it; an approved one raises a change request', async () => {
  const w = await world();
  const xb = (o = {}) => ({ projectId: w.A, kind: 'EXTRA', description: 'Retaining wall at the culvert', uom: 'cum', qty: 50, rate: 800, reason: 'Client instruction after the soil report', instructionRef: 'CLT/INS/12', ...o });
  assert.equal((await w.bc(U.mse, 'POST', '/extra-items', xb())).status, 403); assert.equal((await w.bc(U.qs, 'POST', '/extra-items', xb({ kind: 'SUBSTITUTE' }))).status, 400, 'a substituted item names the item it replaces'); assert.equal((await w.bc(U.qs, 'POST', '/extra-items', xb({ substitutesBoqLineId: w.item }))).status, 400); assert.equal((await w.bc(U.qs, 'POST', '/extra-items', xb({ qty: 0 }))).status, 400);
  const c = await w.bc(U.qs, 'POST', '/extra-items', xb()); assert.equal(c.status, 201, JSON.stringify(c.json)); const e = c.json.data; assert.deepEqual([e.state, e.qty, e.rate, e.value, e.kindLabel, e.can.decide, e.can.edit], ['PENDING', 50, 800, 40_000, 'Extra item', false, true]);
  const s = (await w.bc(U.qs, 'POST', '/extra-items', xb({ kind: 'SUBSTITUTE', substitutesBoqLineId: w.item2, description: 'TMT Fe 550D in place of Fe 500', uom: 'MT', qty: 10 }))).json.data; assert.equal(s.substitutes, '2.2 Reinforcement steel');
  const up = await w.bc(U.qs, 'PATCH', `/extra-items/${e.id}`, { qty: 60, rowVersion: e.version }); assert.deepEqual([up.json.data.qty, up.json.data.rate, up.json.data.value], [60, 800, 48_000], 'a partial update keeps the rate'); assert.equal((await w.bc(U.qs, 'PATCH', `/extra-items/${e.id}`, { qty: 61, rowVersion: e.version })).status, 409);
  assert.equal((await w.bc(U.qs, 'POST', `/extra-items/${e.id}/decide`, { decision: 'APPROVED', decidedOn: day(0) })).status, 403, 'the QS who entered it cannot decide'); const dec = await w.bc(U.pm, 'POST', `/extra-items/${e.id}/decide`, { decision: 'APPROVED', decidedOn: day(0), decisionRef: 'CLT/APP/3' }); assert.equal(dec.status, 200, JSON.stringify(dec.json)); const x = dec.json.data; assert.deepEqual([x.state, x.decidedBy, x.decisionRef, Boolean(x.crId)], ['APPROVED', 'pm1', 'CLT/APP/3', true]);
  const cr = w.d.prepare('SELECT * FROM ctr_change_requests WHERE id = ?').get(x.crId); assert.deepEqual([cr.origin_type, cr.origin_ref, cr.source_type], ['QTY_DEVIATION', e.docNo, 'bill_extra_item']);
  assert.equal((await w.bc(U.com, 'POST', `/extra-items/${e.id}/decide`, { decision: 'REJECTED', decidedOn: day(0) })).status, 409); assert.equal((await w.bc(U.qs, 'PATCH', `/extra-items/${e.id}`, { qty: 5 })).status, 409); assert.equal((await w.bc(U.qs, 'DELETE', `/extra-items/${e.id}`)).status, 409);
  const rj = (await w.bc(U.com, 'POST', `/extra-items/${s.id}/decide`, { decision: 'REJECTED', decidedOn: day(0), note: 'Not accepted by the engineer' })).json.data; assert.deepEqual([rj.state, rj.crId], ['REJECTED', null]);
  const t = (await w.bc(U.qs, 'POST', '/extra-items', xb({ description: 'Gabion wall' }))).json.data; assert.equal((await w.bc(U.qs, 'POST', `/extra-items/${t.id}/withdraw`, { reason: 'Instruction cancelled' })).json.data.state, 'WITHDRAWN'); const gone = (await w.bc(U.qs, 'POST', '/extra-items', xb({ description: 'Mistaken' }))).json.data; assert.equal((await w.bc(U.qs, 'DELETE', `/extra-items/${gone.id}`)).status, 200);
  const lx = await w.bc(U.qs, 'GET', '/extra-items'); assert.equal(lx.status, 200, JSON.stringify(lx.json)); assert.deepEqual([lx.json.data.length, (await w.bc(U.pm, 'GET', `/extra-items/${e.id}`)).status, (await w.bc(U.qs, 'GET', '/extra-items/export')).status, (await w.bc(U.xcli, 'GET', '/extra-items')).status], [3, 200, 200, 403]); await w.drain(); assert.equal(w.events('bill.extra_item.decided').length, 2);
});
