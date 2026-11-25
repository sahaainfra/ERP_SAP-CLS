import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { publishEvent } from '../src/server/platform/events/index.js';
import { dlpOf } from '../src/server/modules/close/dlp.js';
import { U, attachFile, fill, key, partnerOf, ready } from './qa-helpers.js';

// Part 26.03 (audit AUD-DEF-004): the period opened from an issued handover, complaints with their response time, assignment, rectification,
// independent verification and recovery, warranty claims, escalation, and the completion certificate approved by COMMGR and CFO.
const opened = [];
after(async () => { for (const api of opened) { await api.close(); api.db.close(); } });
const D = '/api/v1/close/dlp';

test('26.03 defects liability: period, complaints, verification and recovery, warranty, completion', async () => {
  const r = await ready(opened);
  const call = (who, method, path, body) => r.api.call(method, `${D}${path}`, { ...who, headers: key(), body });
  const okay = (res, status = 200) => { assert.equal(res.status, status, JSON.stringify(res.json)); return res.json.data; };
  const comm = { roles: 'COMMGR', user: 'com1', company: '1' }; const cfo = { roles: 'CFO', user: 'cfo1', company: '1' };
  for (const [u, role] of [['com1', 'COMMGR'], ['cfo1', 'CFO']]) r.d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(u, u, JSON.stringify([role]), `${u}@example.com`);
  const handover = (effective, months = 12) => fill(r.d, 'ho_handovers', { company_id: 1, org_project_id: r.A, org_site_id: r.site, doc_no: `HO/T/${effective}`, title: `Tower handover ${effective}`, scope_type: 'PROJECT', status: 'ISSUED', effective_on: effective, dlp_months: months });
  const h1 = handover('2025-10-01');
  const asset = fill(r.d, 'ho_client_assets', { company_id: 1, handover_id: h1, org_project_id: r.A, tag_no: 'AHU-01', description: 'Air handling unit', category: 'EQUIPMENT', status: 'ACTIVE', warranty_until: '2027-09-30' });

  assert.equal((await call(U.pm, 'GET', '/periods')).status, 404, 'off until the part flag is on');
  r.d.prepare("UPDATE core_feature_flags SET default_enabled = 1, enabled = 1 WHERE key = 'ff.close.p2603' AND company_id IS NULL").run();

  // FR-01 the period of an issued handover: by hand, and from the event
  const p = okay(await call(U.pm, 'POST', '/periods', { handoverId: h1 }), 201);
  assert.equal(p.startsOn, '2025-10-01'); assert.equal(p.endsOn, '2026-10-01'); assert.equal(p.status, 'ACTIVE');
  assert.equal(okay(await call(U.pm, 'POST', '/periods', { handoverId: h1 }), 201).id, p.id, 'opening again returns the same period');
  const h2 = handover('2026-11-01', 24);
  publishEvent(r.d, { type: 'ho.handover.issued', entity: 'ho_handovers', entityId: String(h2), actorId: 'pm1', companyId: 1, data: { handoverId: h2 } }); await r.drain();
  const p2 = r.d.prepare('SELECT * FROM dlp_periods WHERE handover_id = ?').get(h2); assert.ok(p2, 'the event opened the period'); assert.equal(p2.ends_on, '2028-11-01');

  // FR-02 complaints: within the period; the severity sets the due time
  assert.equal((await call(U.pm, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-10-15', reportedBy: 'Client FM', description: 'Leak after the period' })).status, 422);
  assert.equal((await call(U.pm, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-05-10', reportedBy: 'Client FM', description: 'Wrong asset', assetId: 99999 })).status, 422);
  const c1 = okay(await call(U.pm, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-05-10', reportedBy: 'Client FM', location: 'Level 3 lobby', description: 'Water seepage on the ceiling', severity: 'CRITICAL', assetId: asset }), 201);
  assert.equal(Math.round((Date.parse(c1.dueAt) - Date.now()) / 3600_000), 24);
  const c2 = okay(await call(U.se, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-06-01', reportedBy: 'Site team', source: 'INTERNAL', description: 'Cracked skirting tile', severity: 'MINOR' }), 201);
  assert.equal((await call(U.sk, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-06-01', reportedBy: 'x', description: 'Not allowed here' })).status, 403);

  // FR-03 assignment to a subcontractor; FR-04 rectification with evidence and verification by someone else
  const sub = partnerOf(r, 'Waterproofing Co');
  assert.equal((await call(U.qce, 'POST', `/complaints/${c1.id}/assign`, { responsibleType: 'SUBCONTRACTOR' })).status, 422);
  okay(await call(U.qce, 'POST', `/complaints/${c1.id}/assign`, { responsibleType: 'SUBCONTRACTOR', partnerId: sub }));
  assert.equal((await call(U.se, 'POST', `/complaints/${c1.id}/rectify`, { note: 'Membrane redone', fileId: 99999 })).status, 422);
  okay(await call(U.se, 'POST', `/complaints/${c1.id}/rectify`, { note: 'Membrane redone at the slab joint', fileId: attachFile(r, 'dlp_complaints', c1.id, 'after.jpg') }));
  const se2 = { roles: 'QCE', user: 'se1', company: '1' };
  assert.equal((await call(se2, 'POST', `/complaints/${c1.id}/verify`, { accept: true })).status, 403, 'the rectifier does not verify');
  okay(await call(U.qce, 'POST', `/complaints/${c1.id}/verify`, { accept: false, note: 'Stain still visible near the duct' }));
  okay(await call(U.se, 'POST', `/complaints/${c1.id}/rectify`, { note: 'Ceiling board replaced', fileId: attachFile(r, 'dlp_complaints', c1.id, 'after2.jpg') }));
  const closed = okay(await call(U.qcm, 'POST', `/complaints/${c1.id}/verify`, { accept: true, recovery: 25000.5 }));
  assert.equal(closed.status, 'CLOSED'); assert.equal(closed.recovery, 25000.5);
  const bc = r.events('dlp.defect.backcharge_raised'); assert.equal(bc.length, 1); assert.equal(bc[0].partnerId, sub); assert.equal(bc[0].amount, 25000.5);

  // FR-06 a warranty claim on the asset
  const wc = okay(await call(U.pm, 'POST', `/periods/${p.id}/claims`, { assetId: asset, complaintId: c1.id, partnerId: sub, claimedOn: '2026-05-12', description: 'Fan motor bearing noise under warranty' }), 201);
  assert.equal((await call(U.pm, 'POST', `/claims/${wc.id}`, { status: 'RESOLVED' })).status, 409, 'accepted first');
  okay(await call(U.pm, 'POST', `/claims/${wc.id}`, { status: 'ACCEPTED' })); okay(await call(U.pm, 'POST', `/claims/${wc.id}`, { status: 'RESOLVED', note: 'Bearing replaced by the supplier' }));

  // escalation of an overdue complaint
  r.d.prepare("UPDATE dlp_complaints SET due_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(c2.id);
  assert.equal(dlpOf(r.d).sweep(1).escalated, 1);
  assert.equal(r.d.prepare('SELECT escalation_level FROM dlp_complaints WHERE id = ?').get(c2.id).escalation_level, 1);
  assert.equal(dlpOf(r.d).sweep(1).escalated, 0, 'once a day at most');
  assert.ok(okay(await call(U.pm, 'GET', '/complaints?overdue=1')).some((c) => c.id === c2.id));

  // BR-01 completion refused while a complaint is open; then COMMGR and CFO approve
  let done = await call(U.pm, 'POST', `/periods/${p.id}/complete`);
  assert.equal(done.status, 422); assert.match(done.json.error.message, /not closed/);
  okay(await call(U.qce, 'POST', `/complaints/${c2.id}/reject`, { reason: 'Damage caused by the client tenant fit-out' }));
  assert.equal((await call(U.pm, 'POST', `/periods/${p2.id}/complete`)).status, 422, 'a period that has not ended');
  done = okay(await call(U.pm, 'POST', `/periods/${p.id}/complete`), 202);
  assert.equal(done.status, 'COMPLETION_REVIEW');
  assert.equal((await call(U.pm, 'POST', `/periods/${p.id}/complaints`, { reportedOn: '2026-06-02', reportedBy: 'Client FM', description: 'Late complaint in review' })).status, 409);
  assert.equal((await r.act(comm, done.workflowInstanceId)).status, 200);
  assert.equal((await r.act(cfo, done.workflowInstanceId)).status, 200);
  const fin = okay(await call(U.pm, 'GET', `/periods/${p.id}`));
  assert.equal(fin.status, 'COMPLETED');
  const ev = r.events('dlp.period.completed'); assert.equal(ev.length, 1); assert.equal(ev[0].recoveries, 25000.5);

  // dashboard, export, access
  const dash = okay(await call(U.pd, 'GET', '/dashboard')); assert.equal(dash.totals.completed, 1); assert.equal(dash.totals.active, 1);
  assert.equal((await r.api.call('GET', `${D}/complaints/export`, { ...U.pm })).status, 200);
  assert.equal((await call(U.se, 'GET', '/complaints/export')).status, 403);
  assert.equal((await call(U.other, 'GET', `/periods/${p.id}`)).status, 404);
});
