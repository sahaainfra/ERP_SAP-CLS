import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { todayIST } from '../src/shared/dates.js';
import { U, ready, fill, attachFile, partnerOf } from './qa-helpers.js';

// Part 18.06: snags on a plan with a pin, the walk, rectification with an after-photograph, verification by another person, reopening, status by area and party, the unit report.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const TODAY = todayIST(); const plus = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
async function world(r) {
  const flat = fill(r.d, 'proj_locations', { company_id: 1, project_id: r.A, code: 'F402', name: 'Flat 402', loc_type: 'ZONE', loc_status: 'ACTIVE' }); const room = fill(r.d, 'proj_locations', { company_id: 1, project_id: r.A, code: 'F402-BR1', name: 'Bedroom 1', loc_type: 'ROOM', loc_status: 'ACTIVE', parent_id: flat });
  const drawing = fill(r.d, 'engg_drawings', { company_id: 1, org_project_id: r.A, drawing_no: 'A-402', title: 'Flat 402 plan' }); return { flat, room, drawing, sub: partnerOf(r, 'Finish Co') };
}
const raise = (r, who, w, o = {}) => r.call(who, 'POST', '/snags', { projectId: r.A, locationId: w.room, drawingId: w.drawing, pin: { x: 0.25, y: 0.6 }, category: 'FINISHING', punchClass: 'A', priority: 'HIGH', description: 'Paint patchy on the east wall', responsibleType: 'SUBCONTRACTOR', responsibleId: w.sub, dueDate: plus(5), ...o });

test('T-01 FR-01 the pin is stored on the plan and shown back; a snag needs a named party, a real plan and a future date', async () => {
  const r = await ready(opened); const w = await world(r); const c = await raise(r, U.qce, w); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = c.json.data; assert.deepEqual([s.pin, s.status, s.punchClass, s.raisedKind, s.responsible], [{ x: 0.25, y: 0.6 }, 'OPEN', 'A', 'INTERNAL', 'Finish Co']); assert.equal(r.d.prepare('SELECT pin_x, pin_y FROM qa_snags WHERE id = ?').get(s.id).pin_x, 2500);
  assert.deepEqual((await r.call(U.pm, 'GET', `/snags/${s.id}`)).json.data.pin, { x: 0.25, y: 0.6 }); assert.equal((await r.call(U.pm, 'GET', `/snags/plans?projectId=${r.A}`)).json.data[0].drawingNo, 'A-402');
  assert.equal((await raise(r, U.qce, w, { pin: { x: 1.5, y: 0.2 } })).status, 400, 'a pin is on the plan'); assert.equal((await raise(r, U.qce, w, { responsibleId: null })).status, 400, 'a party is named'); assert.equal((await raise(r, U.qce, w, { dueDate: plus(-1) })).status, 400); assert.equal((await raise(r, U.qce, w, { drawingId: 999999 })).status, 400);
  assert.equal((await r.call(U.pm, 'POST', '/snags', { projectId: r.A, category: 'CIVIL', description: 'Not mine' })).status, 403);
  assert.equal((await r.call(U.other, 'GET', `/snags/${s.id}`)).status, 404); await r.drain(); assert.equal(r.events('qa.snag.raised').length, 1);
});

test('BR-01 FR-03 rectify needs an after-photograph; the verifier is not the rectifier; a rectification that does not hold reopens the snag; the back-charge follows the close', async () => {
  const r = await ready(opened); const w = await world(r); const id = (await raise(r, U.qce, w)).json.data.id; const bad = await r.call(U.se, 'POST', `/snags/${id}/rectify`, { note: 'Repainted' }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /after-photograph/);
  assert.equal((await r.call(U.se, 'POST', `/snags/${id}/rectify`, { note: 'x', fileId: 999999 })).status, 422, 'a file not attached to the snag'); assert.equal((await r.call(U.pm, 'POST', `/snags/${id}/rectify`, { note: 'x' })).status, 403);
  const before = attachFile(r, 'qa_snags', id, 'before.jpg'); assert.equal((await r.call(U.qce, 'POST', `/snags/${id}/photos`, { fileId: before, kind: 'BEFORE' })).json.data.beforePhotos.length, 1);
  assert.equal((await r.call(U.qce, 'PATCH', `/snags/${id}`, { backcharge: 1500 })).json.data.backcharge, 1500); assert.equal((await r.call(U.se, 'GET', `/snags/${id}`)).json.data.backcharge, null, 'costs are for those who verify');
  const after = attachFile(r, 'qa_snags', id, 'after.jpg'); const rec = await r.call(U.se, 'POST', `/snags/${id}/rectify`, { note: 'Repainted two coats', fileId: after }); assert.equal(rec.status, 200, JSON.stringify(rec.json)); assert.deepEqual([rec.json.data.status, rec.json.data.afterPhotos.length, rec.json.data.rectifiedBy], ['RECTIFIED', 1, 'se1']);
  r.d.prepare("UPDATE qa_snags SET rectified_by = 'qce1' WHERE id = ?").run(id); const same = await r.call(U.qce, 'POST', `/snags/${id}/close`, {}); assert.equal(same.status, 403, 'the rectifier cannot verify'); assert.match(JSON.stringify(same.json), /rectified/); r.d.prepare("UPDATE qa_snags SET rectified_by = 'se1' WHERE id = ?").run(id);
  const rop = await r.call(U.qcm, 'POST', `/snags/${id}/reopen`, { reason: 'Still patchy near the window' }); assert.equal(rop.status, 200); assert.deepEqual([rop.json.data.status, rop.json.data.reopenCount, rop.json.data.afterPhotos.length], ['OPEN', 1, 0], 'the after-photograph is asked for again');
  assert.equal((await r.call(U.qce, 'POST', `/snags/${id}/close`, {})).status, 422, 'an open snag is not closed'); const after2 = attachFile(r, 'qa_snags', id, 'after2.jpg'); await r.call(U.cm, 'POST', `/snags/${id}/rectify`, { fileId: after2, note: 'Redone' });
  r.d.prepare("UPDATE qa_snags SET after_photos_json = '[]' WHERE id = ?").run(id); const nophoto = await r.call(U.qce, 'POST', `/snags/${id}/close`, {}); assert.equal(nophoto.status, 422, 'no after-photograph, no closure'); r.d.prepare('UPDATE qa_snags SET after_photos_json = ? WHERE id = ?').run(JSON.stringify([after2]), id);
  const done = await r.call(U.qce, 'POST', `/snags/${id}/close`, { note: 'Verified on site' }); assert.equal(done.status, 200, JSON.stringify(done.json)); assert.deepEqual([done.json.data.status, done.json.data.closedBy], ['CLOSED', 'qce1']); await r.drain();
  assert.equal(r.events('qa.snag.closed').length, 1); const bc = r.events('qa.snag.backcharge_raised'); assert.deepEqual([bc.length, bc[0].amount, bc[0].partnerId], [1, 1500, w.sub]); assert.equal(r.events('qa.snag.reopened').length, 1);
  assert.equal((await r.call(U.qce, 'DELETE', `/snags/${id}`)).status, 409, 'a closed snag stays'); assert.equal((await r.call(U.qce, 'POST', `/snags/${id}/cancel`, { reason: 'Raised by mistake' })).status, 422);
});

test('FR-02 FR-04 FR-05 a walk records many snags at once; status by area and party with the share closed; class A blocks handover; the unit report and its PDF', async () => {
  const r = await ready(opened); const w = await world(r); const walk = await r.call(U.qce, 'POST', '/snags/bulk', { projectId: r.A, common: { locationId: w.room, unitRef: 'Flat 402 / Bedroom 1', responsibleType: 'SUBCONTRACTOR', responsibleId: w.sub, dueDate: plus(7), category: 'FINISHING' }, items: [{ description: 'Skirting gap at the door' }, { description: 'Socket cover missing', category: 'MEP', punchClass: 'A' }, { description: 'Paint touch-up behind the door', punchClass: 'C', priority: 'LOW' }] }); assert.equal(walk.status, 201, JSON.stringify(walk.json)); assert.equal(walk.json.data.created.length, 3); assert.deepEqual(walk.json.data.created.map((s) => s.punchClass), ['B', 'A', 'C']); assert.equal(walk.json.data.created[1].category, 'MEP');
  assert.equal((await r.call(U.qce, 'POST', '/snags/bulk', { projectId: r.A, common: {}, items: [{ description: 'ok description' }, { description: 'x' }] })).status, 400, 'one bad item refuses the walk');
  const ids = walk.json.data.created.map((s) => s.id); const photo = attachFile(r, 'qa_snags', ids[0], 'a.jpg'); await r.call(U.se, 'POST', `/snags/${ids[0]}/rectify`, { fileId: photo }); assert.equal((await r.call(U.qce, 'POST', `/snags/${ids[0]}/close`, {})).status, 200);
  const st = (await r.call(U.pm, 'GET', `/snag-status?projectId=${r.A}`)).json.data; assert.deepEqual([st.total, st.open, st.closed, st.closedPct, st.handoverBlocked, st.openByClass.A], [3, 2, 1, 33.3, true, 1]); assert.deepEqual([st.byArea[0].label, st.byArea[0].total, st.byParty[0].label], ['Flat 402 / Bedroom 1', 3, 'Finish Co']);
  const cf = (await r.call(U.pm, 'GET', `/snag-status?projectId=${r.A}&punchClass=C`)).json.data; assert.equal(cf.total, 1);
  r.d.prepare("UPDATE qa_snags SET due_date = ? WHERE id = ?").run(plus(-2), ids[2]); assert.equal((await r.call(U.pm, 'GET', `/snag-status?projectId=${r.A}`)).json.data.overdue, 1); const { qaOf } = await import('../src/server/modules/qa/index.js'); assert.equal(qaOf(r.d).sgv.sweep(1).told, 1);
  const rep = (await r.call(U.pm, 'GET', `/snag-report?locationId=${w.flat}`)).json.data; assert.deepEqual([rep.total, rep.open, rep.closed], [3, 2, 1], 'the unit holds the snags of its rooms'); const pdf = await r.api.raw('GET', `/api/v1/qa/snag-report/pdf?locationId=${w.flat}`, { ...U.pm }); assert.equal(pdf.status, 200); assert.match(String(pdf.headers.get?.('content-type') ?? pdf.headers['content-type']), /pdf/);
  const csv = await r.api.raw('GET', '/api/v1/qa/snags/export', { ...U.qcm }); assert.equal(csv.status, 200); assert.match(csv.buffer.toString('utf8'), /SNG/); assert.equal((await r.call(U.qce, 'GET', '/snags?filter[punch]=A')).json.data.length, 1);
});
