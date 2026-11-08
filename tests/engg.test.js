import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import '../src/server/modules/registry.js';
import { drawingUseCheck, drawingsForTarget } from '../src/server/modules/engg/drawings.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 11.01: drawing register, revisions, transmittals and distribution.
// T-01 a superseding IFC revision restricts the old revision (its file is closed to site teams, the site view shows only the current IFC) and notifies every holder of a controlled copy; T-02 the response codes of a transmittal update the drawing.
// Also: the register fields and links, the IFC approval chain (document control, design coordinator, project manager; the sender never signs), the other status codes issue at once, the schedule and overdue report, the use check that work authorisation reads,
// incoming transmittals, the amendments, roles, the flag and the isolation between companies.
const E = '/api/v1/engg';
const W = '/api/v1/workflow';
const C = '/api/v1/core';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `eg-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const doc1 = as('DOC', 'edoc1'); const doc2 = as('DOC', 'edoc2'); const des = as('DESIGN', 'edes1'); const pm = as('PM', 'epm1'); const pm2 = as('PM', 'epm2'); const se1 = as('SE', 'ese1'); const se2 = as('SE', 'ese2'); const cm = as('CM', 'ecm1'); const bd = as('BD', 'ebd1'); const emp = as('EMP', 'eemp1');
const opened = []; const dirs = [];
after(async () => { for (const a of opened) await a.close(); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function setup() {
  const storage = mkdtempSync(join(tmpdir(), 'erp-engg-')); dirs.push(storage);
  const api = await startApi({}, { storagePath: storage });
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['edoc1', ['DOC']], ['edoc2', ['DOC']], ['edes1', ['DESIGN']], ['epm1', ['PM']], ['epm2', ['PM']], ['ese1', ['SE']], ['ese2', ['SE']], ['ecm1', ['CM']], ['ebd1', ['BD']], ['eemp1', ['EMP']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'epm1', 'test')").run(id); return id; };
  const a = mk('EGA', 'Alpha towers'); const b = mk('EGB', 'Beta bridge');
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const jobs = runtimeOf(api.db).jobs;
  const attach = async (who, revisionId, bytes = PNG, name = 'plan.png') => {
    const fd = new FormData(); fd.append('entity', 'engg_drawing_revision'); fd.append('entityId', String(revisionId)); fd.append('file', new Blob([bytes]), name);
    const r = await api.raw('POST', `${C}/files`, { ...who, body: fd }); assert.equal(r.status, 201, JSON.stringify(r.json)); await jobs.drain(); return r.json.data;
  };
  return { api, call, act, hasTask, attach, a, b };
}
const body = (t, over = {}) => ({ projectId: t.a, drawingNo: 'EGA-STR-001', title: 'Pier 4 reinforcement layout', discipline: 'STRUCTURAL', packageName: 'Substructure', scale: '1:50', sheetSize: 'A1', originatorType: 'CONSULTANT', originator: 'Mehta Associates', plannedReceipt: plus(-3), links: [{ type: 'ACTIVITY', ref: 'A1010 Pier 4 reinforcement' }],
  revision: { label: 'A', statusCode: 'IFC', issuePurpose: 'Issued for construction', changeNote: 'First issue', receivedOn: plus(-1) }, ...over });
/** The full path of an IFC revision: attach the file, send, document control (another one), design, project manager. */
async function issueIfc(t, rev, sender = doc1) {
  await t.attach(sender, rev.id);
  const s = await t.call(sender, 'POST', `/revisions/${rev.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal(s.json.data.status, 'SUBMITTED');
  const wf = s.json.data.workflowInstanceId;
  await t.act(doc2.user === sender.user ? doc1 : doc2, wf); await t.act(des, wf); await t.act(pm, wf);
  return (await t.call(sender, 'GET', `/revisions/${rev.id}`)).json.data;
}
const makeIfc = async (t, over = {}) => { const d = await t.call(doc1, 'POST', '/drawings', body(t, over)); assert.equal(d.status, 201, JSON.stringify(d.json)); return { drawing: d.json.data, rev: await issueIfc(t, d.json.data.revisions[0]) }; };

test('T-01 a superseding IFC revision restricts the old one on the site, tells every holder of a controlled copy and leaves only the current IFC on the site view', async () => {
  const t = await setup();
  const { drawing, rev: a } = await makeIfc(t);
  assert.equal(a.status, 'ISSUED'); const d1 = (await t.call(doc1, 'GET', `/drawings/${drawing.id}`)).json.data;
  assert.deepEqual([d1.currentRevision, d1.currentStatusCode, d1.usable, d1.actualReceipt != null], ['A', 'IFC', true, true]);
  // controlled copies of A for two site engineers
  assert.equal((await t.call(se1, 'POST', `/drawings/${drawing.id}/distribute`, { revisionId: a.id, holders: [{ user: 'ese1' }] })).status, 403, 'a site engineer does not distribute');
  const dist = await t.call(cm, 'POST', `/drawings/${drawing.id}/distribute`, { revisionId: a.id, holders: [{ user: 'ese1' }, { user: 'ese2' }] }); assert.equal(dist.status, 201, JSON.stringify(dist.json)); assert.equal(dist.json.data.copiesMade, 2);
  assert.equal((await t.call(cm, 'POST', `/drawings/${drawing.id}/distribute`, { revisionId: a.id, holders: [{ user: 'ghost' }] })).status, 400);
  const site1 = (await t.call(se1, 'GET', '/site-drawings')).json.data; assert.equal(site1.length, 1); assert.deepEqual([site1[0].revision, site1[0].copyStatus], ['A', 'ISSUED']);
  const copy = site1[0].copyId; assert.equal((await t.call(se2, 'POST', `/copies/${copy}/acknowledge`)).status, 403, 'only the holder acknowledges'); assert.equal((await t.call(se1, 'POST', `/copies/${copy}/acknowledge`)).json.data.status, 'ACKNOWLEDGED');
  // the file of A is readable by the site while A is current
  const fileA = (await t.call(se1, 'GET', `/revisions/${a.id}`)).json.data.file; assert.ok(fileA, 'the site sees the file of the current IFC');
  assert.equal((await t.api.call('GET', `${C}/files/${fileA.id}/url`, se1)).status, 200);
  // revision B (IFC): created by an amendment, sent, approved
  assert.equal((await t.call(doc1, 'POST', `/drawings/${drawing.id}/amend`, { label: 'A', statusCode: 'IFC', changeNote: 'Same label' })).status, 409, 'the label is taken');
  assert.equal((await t.call(se1, 'POST', `/drawings/${drawing.id}/amend`, { label: 'B', statusCode: 'IFC', changeNote: 'Added starter bars' })).status, 403);
  const am = await t.call(doc1, 'POST', `/drawings/${drawing.id}/amend`, { label: 'B', statusCode: 'IFC', changeNote: 'Added starter bars at P4', cloudSummary: 'Cloud 1: starter bars; cloud 2: lap length' }); assert.equal(am.status, 201, JSON.stringify(am.json));
  assert.equal((await t.call(doc1, 'POST', `/drawings/${drawing.id}/amend`, { label: 'C', statusCode: 'IFC', changeNote: 'Another one' })).status, 409, 'one revision is in preparation already');
  assert.equal((await t.call(doc1, 'POST', `/revisions/${am.json.data.id}/submit`)).status, 422, 'the file is attached first');
  const sub = await t.attach(doc1, am.json.data.id, Buffer.concat([PNG, Buffer.from('b')]), 'plan-b.png'); assert.ok(sub.id);
  const b = await issueIfc(t, { id: am.json.data.id }); assert.equal(b.status, 'ISSUED');
  // A is superseded
  const aNow = (await t.call(doc1, 'GET', `/revisions/${a.id}`)).json.data;
  assert.deepEqual([aNow.status, aNow.superseded, aNow.banner, aNow.supersededById], ['SUPERSEDED', true, 'SUPERSEDED, DO NOT USE', b.id]);
  const d2 = (await t.call(doc1, 'GET', `/drawings/${drawing.id}`)).json.data; assert.deepEqual([d2.currentRevision, d2.currentIfcRevisionId], ['B', b.id]);
  // the site: A's file is closed, the site view shows B only, the old copies are marked
  assert.equal((await t.call(se1, 'GET', `/revisions/${a.id}`)).json.data.file, null, 'the file of a superseded revision is hidden from the site');
  assert.ok([403, 404].includes((await t.api.call('GET', `${C}/files/${fileA.id}/url`, se1)).status), 'and cannot be downloaded by the site');
  assert.equal((await t.api.call('GET', `${C}/files/${fileA.id}/url`, doc1)).status, 200, 'document control still reads it');
  const site2 = (await t.call(se1, 'GET', '/site-drawings')).json.data; assert.deepEqual(site2.map((x) => [x.drawingNo, x.revision, x.copyStatus]), [['EGA-STR-001', 'B', 'ISSUED']], 'only the current IFC, with the replacement copy waiting to be acknowledged');
  const copies = d2.copies; assert.deepEqual([copies.filter((c) => c.status === 'SUPERSEDED').length, copies.filter((c) => c.status === 'ISSUED' && c.revision === 'B').length], [2, 2]);
  assert.ok(copies.filter((c) => c.status === 'SUPERSEDED').every((c) => c.banner === 'SUPERSEDED, DO NOT USE'));
  assert.equal((await t.call(cm, 'POST', `/drawings/${drawing.id}/distribute`, { revisionId: a.id, holders: [{ user: 'ese1' }] })).status, 422, 'a superseded revision is not distributed');
  assert.equal((await t.call(se1, 'POST', `/copies/${copy}/acknowledge`)).status, 422, 'the superseded copy is not acknowledged');
  // BR-02: both holders were told; the events went out
  for (const u of ['ese1', 'ese2']) assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.drawing.superseded' AND user_ref = ?").get(u).n, 1, `${u} is told`);
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.drawing.superseded' AND user_ref = 'ecm1'").get().n, 0, 'only the holders');
  for (const e of ['engg.drawing.issued', 'engg.drawing.superseded']) assert.ok(t.api.db.prepare('SELECT 1 FROM core_outbox WHERE event_type = ?').get(e), `${e} went out`);
  // compare: the data differences and both files (staff)
  const cmp = (await t.call(doc1, 'GET', `/drawings/compare?from=${a.id}&to=${b.id}`)).json.data; assert.ok(cmp.differences.some((x) => x.field === 'label' && x.from === 'A' && x.to === 'B')); assert.ok(cmp.from.file && cmp.to.file);
  assert.equal((await t.call(se1, 'GET', `/drawings/compare?from=${a.id}&to=${b.id}`)).json.data.from.file, null);
  // BR-01: the use check
  const chk = async (rev) => (await t.call(se1, 'GET', `/drawings/use-check?projectId=${t.a}&drawingNo=EGA-STR-001&revision=${rev}`)).json.data;
  assert.deepEqual([(await chk('B')).usable, (await chk('A')).usable, (await chk('A')).reason, (await chk('Z')).reason], [true, false, 'SUPERSEDED', 'UNKNOWN_REVISION']);
  assert.equal((await t.call(se1, 'GET', `/drawings/use-check?projectId=${t.a}&drawingNo=NOPE&revision=A`)).json.data.reason, 'NOT_IN_REGISTER');
  assert.deepEqual([drawingUseCheck(t.api.db, { companyId: 1, projectId: t.a, drawingNo: 'EGA-STR-001', revision: 'A' }).usable, drawingUseCheck(t.api.db, { companyId: 1, projectId: t.a, drawingNo: 'EGA-STR-001', revision: 'B' }).usable], [false, true]);
  // the history: the approvals of both revisions
  const h = (await t.call(doc1, 'GET', `/drawings/${drawing.id}/history`)).json.data; assert.ok(h.approvals.length >= 6); assert.ok(h.audit.some((x) => x.action === 'issue'));
});

test('FR-01 FR-05 the register: fields, links, duplicates, validation, import, print, export; rights and the other companies', async () => {
  const t = await setup();
  assert.equal((await t.call(se1, 'POST', '/drawings', body(t))).status, 403); assert.equal((await t.call(bd, 'GET', '/drawings')).status, 403);
  assert.equal((await t.call(doc1, 'POST', '/drawings', body(t, { projectId: 9999 }))).status, 404, 'a project that does not exist');
  for (const bad of [{ discipline: 'PLUMBING' }, { drawingNo: 'x' }, { revision: { label: '', statusCode: 'IFC' } }, { revision: { label: 'A', statusCode: 'XYZ' } }, { sheetSize: 'A9' }, { wbsId: 99999 }, { links: [{ type: 'WBS', targetId: 99999, ref: 'WBS 1' }] }, { documentId: 99999 }, { extra: 1 }]) assert.equal((await t.call(doc1, 'POST', '/drawings', body(t, bad))).status, 400, JSON.stringify(bad));
  const d = await t.call(doc1, 'POST', '/drawings', body(t)); assert.equal(d.status, 201, JSON.stringify(d.json)); const dr = d.json.data;
  assert.deepEqual([dr.drawingNo, dr.disciplineLabel, dr.originatorLabel, dr.revisions.length, dr.revisions[0].status, dr.links.length, dr.overdue, dr.usable], ['EGA-STR-001', 'Structural', 'Consultant', 1, 'DRAFT', 1, true, false]);
  assert.equal((await t.call(doc1, 'POST', '/drawings', body(t))).status, 409, 'the number is in the register');
  assert.equal((await t.call(doc1, 'POST', '/drawings', body(t, { projectId: t.b }))).status, 201, 'the same number in another project');
  const u = await t.call(doc1, 'PATCH', `/drawings/${dr.id}`, { title: 'Pier 4 reinforcement layout (rev)', packageName: 'Foundations', links: [{ type: 'ACTIVITY', ref: 'A1010' }, { type: 'ACTIVITY', ref: 'A1020' }] }); assert.equal(u.status, 200, JSON.stringify(u.json)); assert.deepEqual([u.json.data.packageName, u.json.data.links.length, u.json.data.scale], ['Foundations', 2, '1:50'], 'a field not sent is kept');
  assert.equal((await t.call(doc1, 'PATCH', `/drawings/${dr.id}`, { title: 'X', rowVersion: 1 })).status, 400); assert.equal((await t.call(doc1, 'PATCH', `/drawings/${dr.id}`, { rowVersion: 1, packageName: 'Old' })).status, 409, 'stale version');
  assert.equal((await t.call(se1, 'PATCH', `/drawings/${dr.id}`, { packageName: 'No' })).status, 403);
  // the revision draft is editable until sent
  const rv = dr.revisions[0]; const ru = await t.call(doc1, 'PATCH', `/revisions/${rv.id}`, { changeNote: 'Corrected' }); assert.equal(ru.json.data.changeNote, 'Corrected'); assert.equal(ru.json.data.label, 'A');
  // links for 14.01
  assert.deepEqual(drawingsForTarget(t.api.db, { projectId: t.a, type: 'ACTIVITY', ref: 'A1010' }).map((x) => [x.drawingNo, x.usable]), [['EGA-STR-001', false]]);
  // import: a bad row is reported and the others are made
  const imp = await t.call(doc1, 'POST', '/drawings/import', { projectId: t.a, rows: [body(t, { drawingNo: 'EGA-ARC-001', discipline: 'ARCHITECTURAL', title: 'Ground floor plan' }), body(t, { drawingNo: 'EGA-STR-001' }), body(t, { drawingNo: 'EGA-MEP-001', discipline: 'MEP', title: 'Fire fighting riser' })].map(({ projectId: _p, ...r }) => r) }); assert.equal(imp.status, 201, JSON.stringify(imp.json));
  assert.deepEqual([imp.json.data.created, imp.json.data.errors.length, imp.json.data.errors[0].row], [2, 1, 2]);
  // the list: filters and the overdue flag
  const all = (await t.call(doc1, 'GET', `/drawings?filter[projectId]=${t.a}`)).json; assert.equal(all.data.length, 3);
  assert.equal((await t.call(doc1, 'GET', '/drawings?filter[discipline]=MEP')).json.data.length, 1);
  assert.equal((await t.call(doc1, 'GET', '/drawings?q=riser')).json.data.length, 1);
  assert.equal((await t.call(doc1, 'GET', `/drawings?filter[overdue]=1&filter[projectId]=${t.a}`)).json.data.length, 3);
  // print and export
  const pr = await t.api.raw('GET', `${E}/drawings/${dr.id}/print`, doc1); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /EGA-STR-001/); assert.equal((await t.api.raw('GET', `${E}/drawings/${dr.id}/print`, se1)).status, 403);
  const ex = await t.api.raw('GET', `${E}/drawings/export?format=csv`, doc1); assert.equal(ex.status, 200); assert.match(ex.buffer.toString(), /EGA-MEP-001/); assert.equal((await t.api.raw('GET', `${E}/drawings/export?format=csv`, se1)).status, 403);
  // delete: a draft never sent goes; one on a transmittal does not
  const del = await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'EGA-TMP-001' })); assert.equal((await t.call(doc1, 'DELETE', `/drawings/${del.json.data.id}`)).json.data.deleted, true); assert.equal((await t.call(doc1, 'GET', `/drawings/${del.json.data.id}`)).status, 404);
  // another company sees nothing
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTH', 'Other Pvt Ltd', 'Other', 't', 'test')").run();
  assert.equal((await t.api.call('GET', `${E}/drawings/${dr.id}`, as('DOC', 'edoc1', '2'))).status, 404);
  // cancel
  assert.equal((await t.call(doc1, 'POST', `/drawings/${dr.id}/cancel`, { reason: 'x' })).status, 400); const cn = await t.call(doc1, 'POST', `/drawings/${dr.id}/cancel`, { reason: 'Dropped from the scope' }); assert.equal(cn.json.data.registerStatus, 'CANCELLED'); assert.equal((await t.call(doc1, 'PATCH', `/drawings/${dr.id}`, { packageName: 'Z' })).status, 409);
});

test('FR-02 the IFC approval chain: the sender never signs, every step is by someone else; a return is corrected and sent again; withdraw, reject, cancel; the other status codes issue at once', async () => {
  const t = await setup();
  const d = (await t.call(doc1, 'POST', '/drawings', body(t))).json.data; const rev = d.revisions[0]; await t.attach(doc1, rev.id);
  assert.equal((await t.call(se1, 'POST', `/revisions/${rev.id}/submit`)).status, 403);
  const s0 = await t.call(doc1, 'POST', `/revisions/${rev.id}/submit`); assert.equal(s0.json.data.status, 'SUBMITTED');
  assert.equal((await t.call(doc2, 'POST', `/revisions/${rev.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403);
  const w = await t.call(doc1, 'POST', `/revisions/${rev.id}/withdraw`, { reason: 'Sent too early, one more check' }); assert.equal(w.status, 200, JSON.stringify(w.json)); assert.equal(w.json.data.status, 'DRAFT');
  const s = await t.call(doc1, 'POST', `/revisions/${rev.id}/submit`); const wf = s.json.data.workflowInstanceId; assert.equal(s.json.data.status, 'SUBMITTED');
  assert.equal(await t.hasTask(doc1, wf), false, 'the sender does not check their own');
  assert.equal(await t.hasTask(doc2, wf), true); assert.equal(await t.hasTask(des, wf), false, 'design comes after the check');
  assert.equal((await t.call(doc1, 'PATCH', `/revisions/${rev.id}`, { changeNote: 'Late' })).status, 409, 'a revision waiting for approval is not edited');
  await t.act(doc2, wf); assert.equal(await t.hasTask(des, wf), true);
  const ret = await t.act(des, wf, 'return'); assert.ok(ret);
  assert.equal((await t.call(doc1, 'GET', `/revisions/${rev.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.call(doc1, 'PATCH', `/revisions/${rev.id}`, { changeNote: 'Corrected as asked', cloudSummary: 'Cloud 1' })).status, 200);
  const again = await t.call(doc1, 'POST', `/revisions/${rev.id}/submit`); assert.equal(again.json.data.status, 'SUBMITTED'); assert.equal(again.json.data.workflowInstanceId, wf, 'the same approval goes on');
  // the project manager rejects the next round (a return keeps the same approval going)
  const wf2 = wf;
  await t.act(doc2, wf2); await t.act(des, wf2); assert.equal(await t.hasTask(pm, wf2), true); assert.equal(await t.hasTask(pm2, wf2), false, 'the project manager of the project');
  await t.act(pm, wf2, 'reject'); assert.equal((await t.call(doc1, 'GET', `/revisions/${rev.id}`)).json.data.status, 'REJECTED');
  assert.equal((await t.call(doc1, 'GET', `/drawings/${d.id}`)).json.data.usable, false);
  // a rejected revision is replaced by a new one; a draft is cancelled
  const nb = await t.call(doc1, 'POST', `/drawings/${d.id}/amend`, { label: 'A1', statusCode: 'IFC', changeNote: 'Re-done after the rejection' }); assert.equal(nb.status, 201);
  assert.equal((await t.call(doc1, 'POST', `/revisions/${nb.json.data.id}/cancel`, { reason: 'x' })).status, 400); assert.equal((await t.call(doc1, 'POST', `/revisions/${nb.json.data.id}/cancel`, { reason: 'Superseded by a new plan' })).json.data.status, 'CANCELLED');
  // IFR and IFA are issued at once; IFC then replaces them
  const x = (await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'EGA-ARC-002', discipline: 'ARCHITECTURAL', revision: { label: 'P1', statusCode: 'IFR', changeNote: 'For review' } }))).json.data;
  await t.attach(doc1, x.revisions[0].id); const i1 = await t.call(doc1, 'POST', `/revisions/${x.revisions[0].id}/submit`); assert.equal(i1.status, 202); assert.equal(i1.json.data.status, 'ISSUED'); assert.equal(i1.json.data.workflowInstanceId, null);
  const am = await t.call(doc1, 'POST', `/drawings/${x.id}/amend`, { label: 'P2', statusCode: 'IFA', changeNote: 'For approval' }); await t.attach(doc1, am.json.data.id); await t.call(doc1, 'POST', `/revisions/${am.json.data.id}/submit`);
  assert.equal((await t.call(doc1, 'GET', `/revisions/${x.revisions[0].id}`)).json.data.status, 'SUPERSEDED', 'IFA replaces IFR');
  const dx = (await t.call(doc1, 'GET', `/drawings/${x.id}`)).json.data; assert.deepEqual([dx.currentRevision, dx.currentStatusCode, dx.usable], ['P2', 'IFA', false], 'an IFA revision is not for construction (BR-01)');
  assert.equal((await t.call(se1, 'GET', `/site-drawings`)).json.data.length, 0, 'the site sees IFC only');
  // delete of a draft revision
  const am2 = await t.call(doc1, 'POST', `/drawings/${x.id}/amend`, { label: 'C1', statusCode: 'IFC', changeNote: 'Next revision' }); assert.equal(am2.status, 201, JSON.stringify(am2.json)); assert.equal((await t.call(doc1, 'DELETE', `/revisions/${am2.json.data.id}`)).json.data.deleted, true);
});

test('FR-03 T-02 transmittals: an outgoing one for approval is checked, the response codes A to D update the drawing and close the transmittal; incoming ones register the receipt; BR-01 only IFC goes for construction', async () => {
  const t = await setup();
  const ifc = await makeIfc(t); const ifa = (await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'EGA-ARC-003', discipline: 'ARCHITECTURAL', title: 'Lobby details', plannedReceipt: plus(5), revision: { label: 'B', statusCode: 'IFA' } }))).json.data; await t.attach(doc1, ifa.revisions[0].id); await t.call(doc1, 'POST', `/revisions/${ifa.revisions[0].id}/submit`);
  const ifa2 = (await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'EGA-MEP-003', discipline: 'MEP', title: 'HVAC layout', revision: { label: 'B', statusCode: 'IFA' } }))).json.data; await t.attach(doc1, ifa2.revisions[0].id); await t.call(doc1, 'POST', `/revisions/${ifa2.revisions[0].id}/submit`);
  const item = (d, r) => ({ drawingId: d.id, revisionId: r, copies: 2 }); const r1 = ifa.revisions[0].id; const r2 = ifa2.revisions[0].id;
  const tx = { projectId: t.a, direction: 'OUT', party: 'Mehta Associates', contact: 'm.mehta@example.com', purpose: 'FOR_APPROVAL', coverNote: 'Please review and respond', dueOn: plus(-1), items: [item(ifa, r1), item(ifa2, r2)] };
  assert.equal((await t.call(se1, 'POST', '/transmittals', tx)).status, 403);
  assert.equal((await t.call(doc1, 'POST', '/transmittals', { ...tx, items: [] })).status, 400); assert.equal((await t.call(doc1, 'POST', '/transmittals', { ...tx, items: [item(ifa, ifa2.revisions[0].id)] })).status, 400, 'the revision is of another drawing');
  assert.equal((await t.call(doc1, 'POST', '/transmittals', { ...tx, purpose: 'FOR_CONSTRUCTION' })).status, 400, 'IFA is not sent for construction');
  assert.equal((await t.call(doc1, 'POST', '/transmittals', { ...tx, direction: 'IN', purpose: 'FOR_CONSTRUCTION' })).status, 400);
  const created = await t.call(doc1, 'POST', '/transmittals', tx); assert.equal(created.status, 201, JSON.stringify(created.json)); const T = created.json.data;
  assert.deepEqual([T.docNo, T.status, T.itemCount, T.needsApproval], ['TRN-00001', 'DRAFT', 2, true]);
  const up = await t.call(doc1, 'PATCH', `/transmittals/${T.id}`, { coverNote: 'Please review and respond by Friday' }); assert.equal(up.json.data.coverNote, 'Please review and respond by Friday'); assert.equal(up.json.data.itemCount, 2);
  const sub = await t.call(doc1, 'POST', `/transmittals/${T.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); assert.equal(sub.json.data.status, 'SUBMITTED'); const wf = sub.json.data.workflowInstanceId;
  assert.equal(await t.hasTask(doc2, wf), true); await t.act(doc2, wf); await t.act(des, wf);
  const out = (await t.call(doc1, 'GET', `/transmittals/${T.id}`)).json.data; assert.deepEqual([out.status, out.issuedOn != null, out.overdue], ['ISSUED', true, true]);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.transmittal.issued'").get());
  // the dashboard counts the pending responses
  const dash = (await t.call(des, 'GET', `/dashboard?projectId=${t.a}`)).json.data; assert.deepEqual([dash.pendingResponses, dash.responsesOverdue, dash.byCode.IFC, dash.byCode.IFA], [2, 2, 1, 2]);
  // T-02 responses: C and B need comments; A updates the drawing; when all are answered the transmittal closes
  const [i1, i2] = out.items;
  assert.equal((await t.call(se1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i1.id, code: 'A' }] })).status, 403);
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i1.id, code: 'C' }] })).status, 400, 'a comment is needed with C');
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: 99999, code: 'A' }] })).status, 400); assert.equal((await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i1.id, code: 'E' }] })).status, 400);
  const r = await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i1.id, code: 'A', date: plus(0) }] }); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.data.status, 'ISSUED'); assert.equal(r.json.data.unanswered, 1);
  assert.deepEqual([(await t.call(doc1, 'GET', `/drawings/${ifa.id}`)).json.data.responseCode, (await t.call(doc1, 'GET', `/drawings/${ifa.id}`)).json.data.responseLabel], ['A', 'A Approved']);
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${T.id}/cancel`, { reason: 'Cancel after a response' })).status, 409, 'an answered transmittal is not cancelled');
  const r2c = await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i2.id, code: 'C', comments: 'Duct size at grid 4 clashes with the beam' }] }); assert.equal(r2c.json.data.status, 'CLOSED');
  const dd = (await t.call(doc1, 'GET', `/drawings/${ifa2.id}`)).json.data; assert.deepEqual([dd.responseCode, dd.transmittals[0].docNo, dd.transmittals[0].responseCode], ['C', 'TRN-00001', 'C']);
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${T.id}/responses`, { responses: [{ itemId: i1.id, code: 'B', comments: 'Again' }] })).status, 422, 'a closed transmittal takes no more');
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.transmittal.response'").get());
  // for construction: the current IFC goes at once (no approval); information the same
  const fc = await t.call(doc1, 'POST', '/transmittals', { projectId: t.a, direction: 'OUT', party: 'Sri Constructions', purpose: 'FOR_CONSTRUCTION', items: [item(ifc.drawing, ifc.rev.id)] }); assert.equal(fc.status, 201);
  const fcs = await t.call(doc1, 'POST', `/transmittals/${fc.json.data.id}/submit`); assert.equal(fcs.status, 202); assert.equal(fcs.json.data.status, 'ISSUED'); assert.equal(fcs.json.data.workflowInstanceId, null);
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${fc.json.data.id}/responses`, { responses: [{ itemId: fcs.json.data.items[0].id, code: 'A' }] })).status, 200, 'any outgoing transmittal takes a response');
  // an incoming transmittal registers the receipt
  const inc = (await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'EGA-CIV-001', discipline: 'CIVIL', title: 'Drainage', plannedReceipt: plus(-2), revision: { label: 'R0', statusCode: 'IFR' } }))).json.data; await t.attach(doc1, inc.revisions[0].id); await t.call(doc1, 'POST', `/revisions/${inc.revisions[0].id}/submit`);
  assert.equal((await t.call(doc1, 'GET', `/drawings/${inc.id}`)).json.data.actualReceipt != null, true);
  // withdraw / reject / return / cancel / amend / delete on a transmittal
  const t2 = (await t.call(doc1, 'POST', '/transmittals', { ...tx, items: [item(ifa, r1)] })).json.data; const s2 = await t.call(doc1, 'POST', `/transmittals/${t2.id}/submit`);
  assert.equal((await t.call(doc2, 'POST', `/transmittals/${t2.id}/withdraw`, { reason: 'Not the sender' })).status, 403); assert.equal((await t.call(doc1, 'POST', `/transmittals/${t2.id}/withdraw`, { reason: 'Wrong recipient chosen' })).json.data.status, 'DRAFT');
  assert.equal((await t.call(doc1, 'DELETE', `/transmittals/${t2.id}`)).json.data.deleted, true, 'a draft goes'); void s2;
  const t3 = (await t.call(doc1, 'POST', '/transmittals', { ...tx, items: [item(ifa, r1)] })).json.data; const s3 = await t.call(doc1, 'POST', `/transmittals/${t3.id}/submit`); await t.act(doc2, s3.json.data.workflowInstanceId); await t.act(des, s3.json.data.workflowInstanceId, 'reject'); assert.equal((await t.call(doc1, 'GET', `/transmittals/${t3.id}`)).json.data.status, 'REJECTED');
  const am = await t.call(doc1, 'POST', `/transmittals/${t3.id}/amend`, { reason: 'Corrected the recipient' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.itemCount, am.json.data.coverNote.startsWith('Amends TRN-')], ['DRAFT', 1, true]);
  assert.equal((await t.call(doc1, 'POST', `/transmittals/${am.json.data.id}/cancel`, { reason: 'Not needed any more' })).json.data.status, 'CANCELLED');
  // list, filters, print, export, history
  assert.ok((await t.call(doc1, 'GET', '/transmittals')).json.data.length >= 4); assert.equal((await t.call(doc1, 'GET', '/transmittals?filter[status]=CLOSED')).json.data.length, 2); assert.equal((await t.call(bd, 'GET', '/transmittals')).status, 403);
  const pr = await t.api.raw('GET', `${E}/transmittals/${T.id}/print`, doc1); assert.match(pr.buffer.toString(), /TRN-00001/); assert.match((await t.api.raw('GET', `${E}/transmittals/export?format=csv`, doc1)).buffer.toString(), /Mehta Associates/);
  assert.ok((await t.call(doc1, 'GET', `/transmittals/${T.id}/history`)).json.data.approvals.length >= 2);
  // a superseded revision cannot go on a transmittal
  await t.call(doc1, 'POST', `/drawings/${ifc.drawing.id}/amend`, { label: 'B', statusCode: 'IFC', changeNote: 'Next revision' });
  const ib = (await t.call(doc1, 'GET', `/drawings/${ifc.drawing.id}`)).json.data.revisions.find((x) => x.label === 'B'); await issueIfc(t, ib);
  const bad = await t.call(doc1, 'POST', '/transmittals', { projectId: t.a, direction: 'OUT', party: 'Sri Constructions', purpose: 'FOR_INFORMATION', items: [item(ifc.drawing, ifc.rev.id)] }); assert.equal(bad.status, 400); assert.match(JSON.stringify(bad.json), /SUPERSEDED/);
});

test('FR-06 the drawing schedule and the overdue report; the dashboard; the flag; PM and DIR read; roles', async () => {
  const t = await setup();
  await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'S-1', plannedReceipt: plus(-10) }));
  await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'S-2', plannedReceipt: plus(10) }));
  const late = (await t.call(doc1, 'POST', '/drawings', body(t, { drawingNo: 'S-3', plannedReceipt: plus(-5), revision: { label: 'A', statusCode: 'IFR' } }))).json.data; await t.attach(doc1, late.revisions[0].id); await t.call(doc1, 'POST', `/revisions/${late.revisions[0].id}/submit`);
  const sc = (await t.call(pm, 'GET', `/schedule?projectId=${t.a}`)).json.data;
  assert.deepEqual([sc.counts.planned, sc.counts.received, sc.counts.overdue, sc.counts.late], [3, 1, 1, 1]); assert.deepEqual(sc.overdue.map((x) => x.drawingNo), ['S-1']); assert.equal(sc.rows.find((x) => x.drawingNo === 'S-3').state, 'LATE'); assert.equal(sc.rows.find((x) => x.drawingNo === 'S-2').state, 'PENDING');
  assert.ok(sc.rows.find((x) => x.drawingNo === 'S-1').varianceDays >= 10);
  const d = (await t.call(pm, 'GET', `/dashboard?projectId=${t.a}`)).json.data; assert.deepEqual([d.total, d.received, d.overdue], [3, 1, 1]); assert.ok(d.tiles.length >= 8);
  assert.equal((await t.call(se1, 'GET', '/schedule')).status, 200); assert.equal((await t.call(bd, 'GET', '/dashboard')).status, 403); assert.equal((await t.call(emp, 'GET', '/drawings')).status, 403);
  assert.equal((await t.call(pm, 'POST', '/drawings', body(t, { drawingNo: 'S-9' }))).status, 403, 'the project manager approves, document control registers');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.engg.p1101'").run(); assert.equal((await t.call(doc1, 'GET', '/drawings')).status, 404, 'flag off'); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.engg.p1101'").run();
});
