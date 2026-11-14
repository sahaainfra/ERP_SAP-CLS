import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, receiveForInspection, stockOf } from './qa-helpers.js';

// Part 18.03: the test catalogue, results judged against limits, equipment calibration, the stock release or rejection through the receipt inspection of 16.03, concession, and test frequency compliance.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const strength = (o = {}) => ({ code: o.code ?? 'CEM-STR', name: 'Cement compressive strength (28 days)', standard: 'IS 269', parameters: [{ code: 'STR28', name: 'Compressive strength', unit: 'MPa', min: 53, max: null }], freqBasis: 'NONE', freqQty: 0, labType: 'SITE', ...o });
async function setup(r, o = {}) {
  const stock = await receiveForInspection(r, o.qty ?? 100); const c = await r.call(U.qcm, 'POST', '/test-catalogue', strength({ materialItemId: stock.itemId, ...o.cat })); assert.equal(c.status, 201, JSON.stringify(c.json));
  const eq = await r.call(U.qce, 'POST', '/lab-equipment', { code: `UTM-${Math.random().toString(36).slice(2, 6)}`, name: 'Compression machine', projectId: r.A, lastCalibrated: plus(-30), intervalDays: 365 }); assert.equal(eq.status, 201, JSON.stringify(eq.json));
  return { ...stock, cat: c.json.data, eq: eq.json.data };
}
const request = (r, s, o = {}) => r.call(U.qce, 'POST', '/test-requests', { grnLineId: s.lineId, catalogueId: s.cat.id, sampleRef: 'S-1', ...o });
const enter = (r, id, value, s, o = {}) => r.call(U.qce, 'PATCH', `/test-requests/${id}`, { visualOk: true, documentsOk: true, results: [{ parameter: 'STR28', value, equipmentId: s.eq.id }], ...o });

test('T-01 BR-01 FR-03 FR-04 a failed result keeps the stock in inspection and goes to rejection; the verifier is another engineer; a passed result releases the stock', async () => {
  const r = await ready(opened); const s = await setup(r); assert.deepEqual(stockOf(r, s.itemId), { onHand: 100_000, inspection: 100_000 });
  const w = await r.call(U.sk, 'GET', '/receiving'); assert.equal(w.status, 200); assert.deepEqual([w.json.data.length, w.json.data[0].openQty, w.json.data[0].openRequests], [1, 100, 0]);
  const c = await request(r, s); assert.equal(c.status, 201, JSON.stringify(c.json)); const id = c.json.data.id; assert.equal(c.json.data.lotQty, 100);
  const up = await enter(r, id, 45, s); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.deepEqual([up.json.data.result, up.json.data.results[0].passed, up.json.data.results[0].min], ['FAIL', false, 53], 'outside the limit: it fails by itself');
  assert.equal((await r.call(U.qce, 'POST', `/test-requests/${id}/submit`)).status, 202); const w1 = r.wf('qa_test_requests', id); assert.equal((await r.tasksOf(U.qce)).some((t) => t.instance.id === w1), false, 'the maker does not verify');
  assert.deepEqual(stockOf(r, s.itemId), { onHand: 100_000, inspection: 100_000 }, 'still held while it waits'); assert.equal((await r.act(U.qce2, w1)).status, 200);
  const done = (await r.call(U.sk, 'GET', `/test-requests/${id}`)).json.data; assert.deepEqual([done.status, done.outcome], ['APPROVED', 'REJECTED']); const line = r.d.prepare('SELECT inspection_status, qc_rejected_qty, released_qty FROM inv_grn_lines WHERE id = ?').get(s.lineId); assert.deepEqual([line.inspection_status, line.qc_rejected_qty, line.released_qty], ['FAILED', 100_000, 0]);
  assert.deepEqual(stockOf(r, s.itemId), { onHand: 100_000, inspection: 100_000 }, 'a failed lot stays in the inspection stock until it goes back to the vendor'); await r.drain(); const ev = r.events('qa.material.rejected'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].itemId, ev[0].qty, ev[0].vendorId, ev[0].outcome], [s.itemId, 100, s.vendorId, 'REJECTED']); assert.equal(r.events('qa.material.accepted').length, 0);
  // a second lot that passes
  const s2 = await receiveForInspection(r, 60); const c2 = await r.call(U.qce, 'POST', '/test-requests', { grnLineId: s2.lineId, catalogueId: s.cat.id, sampleRef: 'S-2' }); const id2 = c2.json.data.id; const e2 = await r.call(U.qce, 'PATCH', `/test-requests/${id2}`, { visualOk: true, documentsOk: true, results: [{ parameter: 'STR28', value: 55.5, equipmentId: s.eq.id }] }); assert.equal(e2.json.data.result, 'PASS');
  await r.call(U.qce, 'POST', `/test-requests/${id2}/submit`); assert.equal((await r.act(U.qce2, r.wf('qa_test_requests', id2))).status, 200); assert.deepEqual(stockOf(r, s2.itemId), { onHand: 60_000, inspection: 0 }, 'released into free stock'); assert.equal(r.d.prepare('SELECT inspection_status FROM inv_grn_lines WHERE id = ?').get(s2.lineId).inspection_status, 'PASSED');
  await r.drain(); assert.equal(r.events('qa.material.accepted').length, 1); assert.equal((await r.call(U.sk, 'POST', '/test-requests', { grnLineId: s.lineId, catalogueId: s.cat.id })).status, 403, 'the storekeeper only reads');
});

test('BR-01 override only by concession: a failed result accepted with a concession reference needs the quality control manager too; a concession on a pass is refused', async () => {
  const r = await ready(opened); const s = await setup(r); const id = (await request(r, s, { lotQty: 40 })).json.data.id;
  assert.equal((await enter(r, id, 50, s, { concessionRef: 'NCR/0001' })).json.data.concessionRef, 'NCR/0001'); const nr = await r.call(U.qce, 'POST', `/test-requests/${id}/submit`); assert.equal(nr.status, 400, 'say why the concession is asked for'); assert.match(JSON.stringify(nr.json), /concession/);
  assert.equal((await enter(r, id, 50, s, { concessionRef: 'NCR/0001', concessionReason: 'Strength within 6% of the limit; structural engineer agrees' })).status, 200); assert.equal((await r.call(U.qce, 'POST', `/test-requests/${id}/submit`)).status, 202); const w = r.wf('qa_test_requests', id);
  assert.equal((await r.act(U.qce2, w)).status, 200); assert.equal((await r.call(U.qce, 'GET', `/test-requests/${id}`)).json.data.status, 'SUBMITTED', 'then the quality control manager'); const fin = await r.act(U.qcm, w); assert.equal(fin.status, 200, JSON.stringify(fin.json));
  const d = (await r.call(U.qce, 'GET', `/test-requests/${id}`)).json.data; assert.deepEqual([d.status, d.outcome], ['APPROVED', 'ACCEPTED_CONCESSION']); assert.deepEqual(stockOf(r, s.itemId), { onHand: 100_000, inspection: 60_000 }, '40 released with the concession, 60 still waiting');
  await r.drain(); const ev = r.events('qa.material.accepted'); assert.equal(ev.length, 1); assert.deepEqual([ev[0].concessionRef, ev[0].qty], ['NCR/0001', 40]);
  const id2 = (await request(r, s, { lotQty: 10 })).json.data.id; const bad = await enter(r, id2, 60, s, { concessionRef: 'NCR/9' }); assert.equal(bad.status, 400, 'a concession is for a failed result'); assert.equal((await request(r, s, { lotQty: 70 })).status, 400, 'more than is still under inspection');
});

test('FR-06 equipment out of calibration blocks tests; a calibration with its certificate lifts it; third-party tests need the laboratory certificate; the sweep tells the team', async () => {
  const r = await ready(opened); const s = await setup(r); const old = await r.call(U.qce, 'POST', '/lab-equipment', { code: 'OLD-1', name: 'Old balance', projectId: r.A, lastCalibrated: plus(-400), intervalDays: 365 }); assert.equal(old.json.data.calibration, 'OVERDUE');
  const id = (await request(r, s)).json.data.id; const bad = await r.call(U.qce, 'PATCH', `/test-requests/${id}`, { results: [{ parameter: 'STR28', value: 60, equipmentId: old.json.data.id }] }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /calibrat/);
  const cal = await r.call(U.qce, 'POST', `/lab-equipment/${old.json.data.id}/calibrate`, { calibratedOn: TODAY }); assert.equal(cal.status, 200, JSON.stringify(cal.json)); assert.deepEqual([cal.json.data.calibration, cal.json.data.calibrationDue], ['OK', plus(365)]); assert.equal((await r.call(U.qce, 'PATCH', `/test-requests/${id}`, { visualOk: true, documentsOk: true, results: [{ parameter: 'STR28', value: 60, equipmentId: old.json.data.id }] })).status, 200);
  assert.equal((await r.call(U.qce, 'POST', `/lab-equipment/${old.json.data.id}/calibrate`, { calibratedOn: plus(3) })).status, 400, 'not in the future'); assert.equal((await r.call(U.sk, 'POST', '/lab-equipment', { code: 'X', name: 'No right' })).status, 403);
  const tp = (await request(r, s, { labType: 'THIRD_PARTY', labName: 'NABL Lab', lotQty: 10 })).json.data.id; await enter(r, tp, 60, s); const nc = await r.call(U.qce, 'POST', `/test-requests/${tp}/submit`); assert.equal(nc.status, 400); assert.match(JSON.stringify(nc.json), /certificate/);
  r.d.prepare("UPDATE qa_lab_equipment SET calibration_due = ? WHERE id = ?").run(plus(5), s.eq.id); const { qaOf } = await import('../src/server/modules/qa/index.js'); const sw = qaOf(r.d).tsv.sweep(1); assert.ok(sw.told >= 1, 'equipment due within 14 days is told'); const oldList = (await r.call(U.qcm, 'GET', '/lab-equipment')).json.data; assert.ok(oldList.some((e) => e.calibration === 'DUE_SOON'));
});

test('FR-05 test frequency compliance: one cement test per 50 bags; the shortfall is overdue and clears when the tests are requested', async () => {
  const r = await ready(opened); const s = await setup(r, { cat: { freqBasis: 'QTY', freqQty: 50, freqUom: 'bag' } });
  const c0 = (await r.call(U.qce, 'GET', `/test-compliance?projectId=${r.A}`)).json.data; assert.deepEqual([c0.rows.length, c0.rows[0].received, c0.rows[0].required, c0.rows[0].done, c0.rows[0].status], [1, 100, 2, 0, 'OVERDUE']); assert.equal(c0.overdue, 1);
  for (const n of [1, 2]) { const id = (await request(r, s, { lotQty: 50, samplingDecision: 'CERTIFICATE_ONLY', sampleRef: `S-${n}` })).json.data.id; const u = await r.call(U.qce, 'PATCH', `/test-requests/${id}`, { visualOk: true, documentsOk: true }); assert.equal(u.json.data.result, 'PASS'); assert.equal((await r.call(U.qce, 'POST', `/test-requests/${id}/submit`)).status, 202); }
  const c1 = (await r.call(U.qce, 'GET', `/test-compliance?projectId=${r.A}`)).json.data; assert.deepEqual([c1.rows[0].done, c1.rows[0].shortfall, c1.rows[0].status], [2, 0, 'OK']); const csv = await r.api.raw('GET', '/api/v1/qa/test-compliance/export', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /CEM-STR/);
  assert.equal((await r.call(U.other, 'GET', '/test-requests')).json.data.length, 0, 'another company sees nothing'); assert.equal((await r.call(U.qce, 'POST', '/test-catalogue', strength({ code: 'X' }))).status, 403, 'only the manager keeps the catalogue');
  const dup = await r.call(U.qcm, 'POST', '/test-catalogue', strength({ code: 'CEM-STR' })); assert.equal(dup.status, 400, 'the code is used'); assert.equal((await r.call(U.qcm, 'POST', '/test-catalogue', strength({ code: 'BAD', parameters: [{ code: 'P', name: 'p', min: null, max: null }] }))).status, 400, 'a limit is needed');
});
