import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { U as BASE, as, fill, key, ready } from './ctr-helpers.js';
import { mbQty } from '../src/server/modules/bill/mb.js';
import { billOf } from '../src/server/modules/bill/index.js';

// Part 22.01: the quantity of a measurement by its formula template, the eligibility checks (the hold-point inspections, the item in the contract or an approved variation, the cumulative quantity against the limit: T-01), the check measurement, certification with the page of the book, locking, the abstract of the bill period and the book in print.
const U = { ...BASE, mse: as('SE', 'mse1'), xcon: as('X-CON', 'xcon1'), qs2: as('QS', 'qs2') };
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const day = (n) => new Date(Date.now() + 5.5 * 3600_000 + n * 86_400_000).toISOString().slice(0, 10);
const B = '/api/v1/bill';
async function world(o = {}) {
  const r = await ready(opened, { baseline: false }); const d = r.d; const bc = (who, method, path, body) => r.api.call(method, `${B}${path}`, { ...who, headers: key(), body });
  const ver = fill(d, 'proj_boq_versions', { company_id: 1, org_project_id: r.A, vtype: 'CONTRACT', version_no: 1, name: 'Contract BOQ', status: 'APPROVED', frozen_at: '2026-03-30' });
  const item = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.1', description: 'RCC M25 in footings', uom: 'cum', qty: 100_000, rate: 60_000_000, amount: 0 }); const item2 = fill(d, 'proj_boq_lines', { company_id: 1, version_id: ver, line_kind: 'ITEM', item_code: '2.2', description: 'Reinforcement steel', uom: 'MT', qty: 50_000, rate: 600_000_000, amount: 0 });
  const loc = fill(d, 'proj_locations', { company_id: 1, project_id: r.A, loc_type: 'BLOCK', code: 'B1', name: 'Block 1' });
  const wa = o.noWa ? null : fill(d, 'site_work_authorisations', { company_id: 1, wa_no: 'WA/1', plan_date: day(-3), activity_id: r.a1, location_id: loc, planned_qty: 100_000, start_time: '08:00', end_time: '17:00', supervisor: 'sup1', status: 'APPROVED' });
  return { ...r, bc, ver, item, item2, loc, wa, sc: billOf(d).svc };
}
const body = (w, o = {}) => ({ projectId: w.A, boqLineId: w.item, locationId: w.loc, description: 'Footing F1 to F6', template: 'VOLUME', nos: 6, length: 2.5, breadth: 2.5, depth: 0.6, deduction: 0.5, measuredOn: day(-1), ...o });
async function certify(w, id, approvers = [U.qs, U.pm]) { const sb = await w.bc(U.mse, 'POST', `/mb-entries/${id}/submit`); assert.equal(sb.status, 202, JSON.stringify(sb.json)); const wf = w.wf('bill_mb_entries', id); for (const who of approvers) assert.equal((await w.act(who, wf)).status, 200); return (await w.bc(U.qs, 'GET', `/mb-entries/${id}`)).json.data; }

test('FR-01 the quantity by formula template, less the deduction', () => {
  const q = (o) => mbQty({ template: 'VOLUME', nosTh: 6000, lengthTh: 2500, breadthTh: 2500, depthTh: 600, deductionTh: 0, ...o });
  assert.deepEqual([q({}).grossTh, q({}).netTh], [22_500, 22_500], '6 x 2.5 x 2.5 x 0.6 = 22.5 cum'); assert.equal(q({ deductionTh: 500 }).netTh, 22_000); assert.equal(mbQty({ template: 'AREA', nosTh: 4000, lengthTh: 3000, breadthTh: 2000 }).netTh, 24_000, '4 x 3 x 2 = 24 sqm'); assert.equal(mbQty({ template: 'LENGTH', nosTh: 12000, lengthTh: 5500 }).netTh, 66_000); assert.equal(mbQty({ template: 'NOS', nosTh: 35000 }).netTh, 35_000); assert.equal(mbQty({ template: 'QTY', qtyTh: 12_345 }).netTh, 12_345);
  assert.equal(q({ deductionTh: 30_000 }).negative, true); assert.throws(() => mbQty({ template: 'VOLUME', nosTh: 1000, lengthTh: 1000 }), /Give the breadth/); assert.throws(() => mbQty({ template: 'QTY' }), /Give the quantity/);
});

test('FR-01 FR-02 an entry is made with the quantity worked out by the server; suggestions come from the approved daily reports and are never certified by themselves', async () => {
  const w = await world();
  assert.equal((await w.bc(U.xcon, 'POST', '/mb-entries', body(w))).status, 403); assert.equal((await w.bc(U.pm, 'POST', '/mb-entries', body(w))).status, 403); assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { value: 1 }))).status, 400, 'a client-supplied quantity is refused'); assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { breadth: null }))).status, 422, 'the template needs its factors'); assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 99 }))).status, 400, 'a deduction beyond the quantity');
  const c = await w.bc(U.mse, 'POST', '/mb-entries', body(w)); assert.equal(c.status, 201, JSON.stringify(c.json)); const e = c.json.data; assert.deepEqual([e.qty, e.status, e.checkStatus, e.uom, e.measuredBy, e.deduction], [22, 'DRAFT', 'NOT_CHECKED', 'cum', 'mse1', 0.5]);
  const up = await w.bc(U.mse, 'PATCH', `/mb-entries/${e.id}`, { depth: 0.8, rowVersion: e.version }); assert.equal(up.json.data.qty, 29.5, '6 x 2.5 x 2.5 x 0.8 less 0.5'); assert.equal((await w.bc(U.mse, 'PATCH', `/mb-entries/${e.id}`, { depth: 0.6, rowVersion: e.version })).status, 409, 'stale version');
  // suggestions from the approved daily reports
  const dpr = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: w.site, dpr_date: day(-2), status: 'APPROVED' }); const dw = fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dpr, wa_id: w.wa, activity_id: w.a1, location_id: w.loc, qty: 18_000, uom: 'cum' });
  const sg = (await w.bc(U.mse, 'GET', `/mb-entries/suggestions?projectId=${w.A}`)).json.data; assert.deepEqual([sg.length, sg[0].qty, sg[0].waNo, sg[0].location], [1, 18, 'WA/1', 'Block 1']);
  const m = await w.bc(U.mse, 'POST', '/mb-entries', { projectId: w.A, boqLineId: w.item, locationId: w.loc, waId: w.wa, activityId: w.a1, dprWorkId: dw, description: 'From the daily report', template: 'QTY', qty: 18, measuredOn: day(-2) }); assert.equal(m.status, 201, JSON.stringify(m.json)); assert.equal(m.json.data.status, 'DRAFT', 'a suggestion makes a draft, never a certified entry'); assert.equal((await w.bc(U.mse, 'GET', `/mb-entries/suggestions?projectId=${w.A}`)).json.data.length, 0, 'taken');
  const dprDraft = fill(w.d, 'site_dprs', { company_id: 1, org_project_id: w.A, dpr_site_id: fill(w.d, 'org_sites', { company_id: 1, org_project_id: w.A, code: 'S7', name: 'Site 7' }), dpr_date: day(-1), status: 'DRAFT' }); fill(w.d, 'site_dpr_work', { company_id: 1, dpr_id: dprDraft, wa_id: w.wa, activity_id: w.a1, qty: 5000 }); assert.equal((await w.bc(U.mse, 'GET', `/mb-entries/suggestions?projectId=${w.A}`)).json.data.length, 0, 'a report not approved suggests nothing');
});

test('FR-03 T-01 an unapproved inspection blocks the entry; an item outside the contract blocks it; the cumulative quantity over the limit is a warning and needs an approved deviation', async () => {
  const w = await world(); const ir = fill(w.d, 'qa_inspection_requests', { company_id: 1, org_project_id: w.A, doc_no: 'IR/1', wa_id: w.wa, location_id: w.loc, activity_id: w.a1, point_type: 'HOLD', description: 'Check formwork and cover', requested_for: day(-3), status: 'SUBMITTED' });
  const pv = await w.bc(U.mse, 'POST', '/mb-entries/preview', body(w, { waId: w.wa })); assert.equal(pv.status, 200); assert.deepEqual([pv.json.data.qty, pv.json.data.issues.map((i) => i.code)], [22, ['IR_NOT_APPROVED']]); assert.match(pv.json.data.issues[0].message, /IR\/1/);
  const c = (await w.bc(U.mse, 'POST', '/mb-entries', body(w, { waId: w.wa }))).json.data; const s1 = await w.bc(U.mse, 'POST', `/mb-entries/${c.id}/submit`); assert.equal(s1.status, 400); assert.match(JSON.stringify(s1.json), /not measured until it is/);
  w.d.prepare("UPDATE qa_inspection_requests SET result = 'APPROVED', status = 'APPROVED' WHERE id = ?").run(ir); const s2x = await w.bc(U.mse, 'POST', `/mb-entries/${c.id}/submit`); assert.equal(s2x.status, 202, JSON.stringify(s2x.json)); assert.deepEqual(JSON.parse(w.d.prepare('SELECT eligibility_json FROM bill_mb_entries WHERE id = ?').get(c.id).eligibility_json), []);
  // an item that is not in the contract
  const draftVer = fill(w.d, 'proj_boq_versions', { company_id: 1, org_project_id: w.A, vtype: 'TENDER', version_no: 7, name: 'Tender draft', status: 'DRAFT' }); const stray = fill(w.d, 'proj_boq_lines', { company_id: 1, version_id: draftVer, line_kind: 'ITEM', item_code: '9.9', description: 'Not in the contract', uom: 'nos', qty: 100_000, rate: 1, amount: 0 });
  const bad = await w.bc(U.mse, 'POST', '/mb-entries/preview', body(w, { boqLineId: stray })); assert.deepEqual(bad.json.data.issues.map((i) => i.code), ['ITEM_NOT_IN_CONTRACT']);
  // the item of an approved variation (the revised BOQ draft)
  const kv = fill(w.d, 'proj_boq_versions', { company_id: 1, org_project_id: w.A, vtype: 'REVISED', version_no: 8, name: 'Revised for VO', status: 'DRAFT', variation_ref: 'VO-77' }); const vl = fill(w.d, 'proj_boq_lines', { company_id: 1, version_id: kv, line_kind: 'ITEM', item_code: '8.1', description: 'Extra drain', uom: 'm', qty: 500_000, rate: 1, amount: 0 });
  assert.deepEqual((await w.bc(U.mse, 'POST', '/mb-entries/preview', body(w, { boqLineId: vl }))).json.data.issues.map((i) => i.code), ['ITEM_NOT_IN_CONTRACT']); fill(w.d, 'ctr_variation_orders', { company_id: 1, org_project_id: w.A, vo_no: 'VO-77', cr_id: fill(w.d, 'ctr_change_requests', { company_id: 1, org_project_id: w.A, cr_no: 'CR-77', kind: 'CLIENT', origin_type: 'INTERNAL', title: 'x', description: 'xxxxxxxxxx' }), title: 'Extra drain', status: 'APPROVED', vo_state: 'EFFECTIVE' });
  assert.deepEqual((await w.bc(U.mse, 'POST', '/mb-entries/preview', body(w, { boqLineId: vl }))).json.data.issues.map((i) => [i.code, i.severity]), [['BY_VARIATION', 'INFO']]);
  // cumulative: the BOQ quantity is 100; 90 are certified, then 20 more
  const first = (await w.bc(U.mse, 'POST', '/mb-entries', { projectId: w.A, boqLineId: w.item, description: 'Bulk', template: 'QTY', qty: 68, measuredOn: day(-1) })).json.data; await certify(w, first.id);
  const over = await w.bc(U.mse, 'POST', '/mb-entries/preview', { projectId: w.A, boqLineId: w.item, description: 'More', template: 'QTY', qty: 20, measuredOn: day(0) }); assert.deepEqual(over.json.data.issues.map((i) => i.code), ['OVER_LIMIT']); assert.deepEqual([over.json.data.cumulative.limit, over.json.data.cumulative.others, over.json.data.cumulative.total], [100, 90, 110]);
  const m2 = (await w.bc(U.mse, 'POST', '/mb-entries', { projectId: w.A, boqLineId: w.item, description: 'More', template: 'QTY', qty: 20, measuredOn: day(0) })).json.data; const s2 = await w.bc(U.mse, 'POST', `/mb-entries/${m2.id}/submit`); assert.equal(s2.status >= 400, true, JSON.stringify(s2.json)); assert.match(JSON.stringify(s2.json), /exception|beyond/i); assert.equal((await w.bc(U.qs, 'GET', `/mb-entries/${m2.id}`)).json.data.status, 'DRAFT');
});

test('FR-04 FR-05 BR-01 the check measurement, the certification by the project manager, the page of the book, the lock; the abstract and the book in print', async () => {
  const w = await world(); const mk = async (o = {}) => (await w.bc(U.mse, 'POST', '/mb-entries', body(w, o))).json.data;
  // a plain entry: QS checks, PM certifies
  const a = await mk(); assert.equal((await w.bc(U.mse, 'POST', `/mb-entries/${a.id}/submit`)).status, 202); const wfa = w.wf('bill_mb_entries', a.id); assert.equal((await w.act(U.mse, wfa).catch(() => ({ status: 0 }))).status === 200, false, 'the measurer does not approve their own');
  assert.equal((await w.act(U.qs, wfa)).status, 200); assert.equal((await w.bc(U.qs, 'GET', `/mb-entries/${a.id}`)).json.data.status, 'SUBMITTED'); assert.equal((await w.act(U.pm, wfa)).status, 200);
  const done = (await w.bc(U.qs, 'GET', `/mb-entries/${a.id}`)).json.data; assert.deepEqual([done.status, done.certifiedQty, done.book, done.page, done.line, done.period], ['APPROVED', 22, 1, 1, 1, day(0).slice(0, 7)]); await w.drain(); const ev = w.events('bill.mb.certified'); assert.deepEqual([ev.length, ev[0].certifiedQty, ev[0].boqCode, ev[0].page], [1, 22, '2.1', 1]);
  assert.equal((await w.bc(U.mse, 'PATCH', `/mb-entries/${a.id}`, { description: 'Changed' })).status, 409, 'a certified entry is locked'); assert.equal((await w.bc(U.qs, 'POST', `/mb-entries/${a.id}/amend`, { reason: 'Wrong dimension' })).status, 422); assert.equal((await w.bc(U.mse, 'DELETE', `/mb-entries/${a.id}`)).status, 409);
  // an entry that needs the client's check
  const b = await mk({ clientCheckRequired: true, description: 'Footings F7 to F9', nos: 3 }); assert.equal(b.clientCheckRequired, true); assert.equal((await w.bc(U.mse, 'POST', `/mb-entries/${b.id}/submit`)).status, 202); const wfb = w.wf('bill_mb_entries', b.id);
  assert.equal((await w.bc(U.qs2, 'POST', `/mb-entries/${b.id}/check`, { checkedQty: 10, checkerName: 'Mr Rao', checkedOn: day(0) })).status, 200, 'the QS lead records the consultant\'s check with the signature'); const ck = (await w.bc(U.qs, 'GET', `/mb-entries/${b.id}`)).json.data; assert.deepEqual([ck.checkStatus, ck.checkedQty, ck.checkDiff, ck.checkerName, ck.checkPct], ['DIFFERENCE', 10, 0.75, 'Mr Rao', 100]); assert.equal((await w.bc(U.mse, 'POST', `/mb-entries/${b.id}/check`, { checkedQty: 11, checkerName: 'x y', checkedOn: day(0) })).status, 403);
  assert.equal((await w.act(U.qs, wfb)).status, 200); assert.equal((await w.act(U.pm, wfb)).status, 200); const cb = (await w.bc(U.qs, 'GET', `/mb-entries/${b.id}`)).json.data; assert.deepEqual([cb.status, cb.qty, cb.certifiedQty, cb.page, cb.line], ['APPROVED', 10.75, 10, 1, 2], 'the certified quantity follows the check measurement');
  // without the check the project manager cannot certify
  const c = await mk({ clientCheckRequired: true, description: 'Footings F10' }); await w.bc(U.mse, 'POST', `/mb-entries/${c.id}/submit`); const wfc = w.wf('bill_mb_entries', c.id); await w.act(U.qs, wfc); const bad = await w.act(U.pm, wfc); assert.equal(bad.status >= 400, true, JSON.stringify(bad.json)); assert.match(JSON.stringify(bad.json), /check measurement/); assert.equal((await w.bc(U.qs, 'GET', `/mb-entries/${c.id}`)).json.data.status, 'SUBMITTED');
  await w.bc(U.qs2, 'POST', `/mb-entries/${c.id}/check`, { checkedQty: 15, checkPct: 50, checkerName: 'Mr Rao', checkerOrg: 'Consultant', checkedOn: day(0), signatureRef: 'SIG/9' }); assert.equal((await w.act(U.pm, wfc)).status, 200); assert.deepEqual((({ status, certifiedQty, line }) => ({ status, certifiedQty, line }))((await w.bc(U.qs, 'GET', `/mb-entries/${c.id}`)).json.data), { status: 'APPROVED', certifiedQty: 15, line: 3 });
  // the page changes after the lines per page
  w.d.prepare("DELETE FROM core_parameters WHERE key = 'bill.mb.lines_per_page'").run(); w.d.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'bill.mb.lines_per_page', '2', 'integer', 'company', 1, '2020-01-01', 'test', 'test')").run(); const d4 = await mk({ description: 'Footings F11' }); await certify(w, d4.id); assert.deepEqual((({ page, line }) => ({ page, line }))((await w.bc(U.qs, 'GET', `/mb-entries/${d4.id}`)).json.data), { page: 2, line: 4 }, 'two lines to a page: line 4 is on page 2');
  // the abstract and the book
  const ab = (await w.bc(U.pm, 'GET', `/mb-abstract?projectId=${w.A}`)).json.data; assert.deepEqual([ab.rows.length, ab.rows[0].code, ab.rows[0].current, ab.rows[0].cumulative, ab.rows[0].previous, ab.rows[0].entries, ab.totals.entries], [1, '2.1', 22 + 10 + 15 + 22, 69, 0, 4, 4], 'Rs: the certified quantities of the period by item'); assert.equal(ab.rows[0].boqQty, 100);
  const pdf = await w.api.raw('GET', `${B}/mb-book/pdf?projectId=${w.A}`, { ...U.pm }); assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /pdf/); assert.equal((await w.api.raw('GET', `${B}/mb-entries/${a.id}/print`, { ...U.pm })).status, 200); assert.equal((await w.api.raw('GET', `${B}/mb-book/pdf?projectId=${w.A}`, { ...U.cm })).status, 403);
  // the adapters for billing
  assert.equal(w.sc.mb.certifiedQtyOf(1, { projectId: w.A, boqLineId: w.item }), 69); assert.deepEqual(w.sc.mb.markBilled(1, { mbIds: [a.id, b.id], billRef: 'RA-01' }), { marked: 2 }); assert.deepEqual(w.sc.mb.markBilled(1, { mbIds: [a.id], billRef: 'RA-01' }), { marked: 0 }, 'again changes nothing'); assert.throws(() => w.sc.mb.markBilled(1, { mbIds: [a.id], billRef: 'RA-02' }), /in bill RA-01 already/); assert.throws(() => w.sc.mb.markBilled(1, { mbIds: [c.id + 99], billRef: 'RA-03' }), /does not exist/);
});

test('roles, scope, import, export and the flag', async () => {
  const w = await world(); for (const [who, path, want] of [[U.mse, '/mb-entries', 200], [U.qs, '/mb-entries', 200], [U.xcon, '/mb-entries', 403], [U.pm, '/mb-abstract?projectId=' + w.A, 200], [U.aud, '/mb-entries', 200], [U.cm, '/mb-entries', 403], [U.xcli, '/mb-entries', 403]]) assert.equal((await w.bc(who, 'GET', path)).status, want, `${who.roles} ${path}`);
  const c = (await w.bc(U.mse, 'POST', '/mb-entries', body(w))).json.data; assert.equal((await w.bc(U.comX, 'GET', `/mb-entries/${c.id}`)).status, 404, 'another company'); assert.equal((await w.bc(U.pm, 'POST', '/mb-entries', body(w))).status, 403, 'the project manager certifies, not measures');
  const imp = await w.bc(U.mse, 'POST', '/mb-entries/import', { rows: [{ projectCode: 'QA1', boqItemCode: '2.2', location: 'B1', description: 'Imported bars', template: 'NOS', nos: 12, measuredOn: day(-1) }, { projectCode: 'NOPE', boqItemCode: '2.2', description: 'x', template: 'NOS', nos: 1 }]}); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual([imp.json.data.created, imp.json.data.rows[1].error], [1, 'Project code not found']);
  const csv = await w.api.raw('GET', `${B}/mb-entries/export`, { ...U.qs }); assert.match(csv.buffer.toString('utf8'), /Entry,Project/); assert.ok((await w.bc(U.qs, 'GET', `/mb-entries/${c.id}/history`)).json.data.audit.length >= 1);
  const l = (await w.bc(U.qs, 'GET', '/mb-entries')).json; assert.ok(l.data.length >= 2);
  w.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.bill.p2201'").run(); assert.equal((await w.bc(U.qs, 'GET', '/mb-entries')).status, 404);
});

test('PACK-18 a measurement on a phone: deduction lines measured like the entry, the position where it was measured; flag, validation, scope, stale version and replay', async () => {
  const w = await world();
  const lines = [{ description: 'Pedestal opening P1', nos: 2, length: 0.5, breadth: 0.5, depth: 0.6 }, { description: 'Sump', length: 1, breadth: 1, depth: 0.2 }];
  const geo = { lat: 17.385044, lng: 78.486671, accuracyM: 8 };
  const off = await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 0, deductions: lines, geo })); assert.equal(off.status, 400, 'flag off: refused'); assert.match(JSON.stringify(off.json), /not turned on/);
  w.d.prepare("INSERT OR IGNORE INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bill.pack18', 1, 'test', 0, 1)").run();
  // preview: 22.5 less (2 x 0.5 x 0.5 x 0.6 = 0.3) and (1 x 1 x 1 x 0.2 = 0.2)
  const pv = await w.bc(U.mse, 'POST', '/mb-entries/preview', body(w, { deduction: 0, deductions: lines })); assert.equal(pv.status, 200, JSON.stringify(pv.json)); assert.deepEqual([pv.json.data.qty, pv.json.data.deduction, pv.json.data.deductions.map((l) => l.qty)], [22, 0.5, [0.3, 0.2]]);
  // validation: a missing dimension, a deduction that is not the sum of the lines, a position off the globe
  assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 0, deductions: [{ description: 'Opening', length: 1, breadth: 1 }] }))).status, 400);
  const mis = await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 0.4, deductions: lines })); assert.equal(mis.status, 400); assert.match(JSON.stringify(mis.json), /sum of its lines: 0.5/);
  assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 0, geo: { lat: 95, lng: 78 } }))).status, 400);
  assert.equal((await w.bc(U.mse, 'POST', '/mb-entries', body(w, { deduction: 0, deductions: [{ description: 'x', length: 1, breadth: 1, depth: 1 }] }))).status, 400, 'a line needs a description');
  // success, with an idempotent replay
  const k = key(); const c1 = await w.api.call('POST', `${B}/mb-entries`, { ...U.mse, headers: k, body: body(w, { deduction: 0, deductions: lines, geo }) }); assert.equal(c1.status, 201, JSON.stringify(c1.json));
  const c2 = await w.api.call('POST', `${B}/mb-entries`, { ...U.mse, headers: k, body: body(w, { deduction: 0, deductions: lines, geo }) }); assert.equal(c2.json.data.id, c1.json.data.id, 'the same key gives the same entry');
  assert.equal(w.d.prepare('SELECT COUNT(*) AS n FROM bill_mb_entries').get().n, 1);
  const e = c1.json.data; assert.deepEqual([e.qty, e.deduction, e.deductions.length, e.deductions[1].nos, e.geo], [22, 0.5, 2, 1, geo]);
  // 403: a role that may not measure; 404: another company
  assert.equal((await w.bc(U.xcon, 'POST', '/mb-entries', body(w, { deduction: 0, deductions: lines }))).status, 403);
  assert.equal((await w.bc({ ...U.mse, company: '2' }, 'PATCH', `/mb-entries/${e.id}`, { deductions: [] })).status, 404);
  // edit: a changed depth recomputes the stored lines; a stale version is 409
  const u = await w.bc(U.mse, 'PATCH', `/mb-entries/${e.id}`, { depth: 0.5, rowVersion: e.version }); assert.equal(u.status, 200, JSON.stringify(u.json)); assert.equal(u.json.data.qty, 18.75 - 0.5, 'the lines keep their own depths; 6 x 2.5 x 2.5 x 0.5 = 18.75');
  assert.equal((await w.bc(U.mse, 'PATCH', `/mb-entries/${e.id}`, { depth: 0.4, rowVersion: e.version })).status, 409);
  const cleared = await w.bc(U.mse, 'PATCH', `/mb-entries/${e.id}`, { deductions: null, deduction: 0.25, geo: null }); assert.equal(cleared.status, 200, JSON.stringify(cleared.json)); assert.deepEqual([cleared.json.data.deductions, cleared.json.data.deduction, cleared.json.data.geo, cleared.json.data.qty], [[], 0.25, null, 18.5]);
});
