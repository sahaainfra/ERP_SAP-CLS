import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 11.04: EPC engineering deliverables and vendor document review. T-01 the weighted progress roll-up is right for a sample of deliverables and only recorded or approved milestones count (BR-01). Also: the S-curve, the register, the IFC release chain
// (discipline lead, engineering manager, project manager; the sender never signs), the client comment resolution sheet, holds, vendor document requirements with their review cycles, roles, isolation and the flag.
const E = '/api/v1/engg';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `ep-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan = as('PLAN', 'eplan1'); const des1 = as('DESIGN', 'edes1'); const des2 = as('DESIGN', 'edes2'); const pm = as('PM', 'epm1'); const cm = as('CM', 'ecm1'); const qs = as('QS', 'eqs1'); const bd = as('BD', 'ebd1'); const se = as('SE', 'ese1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi(); opened.push(api); await setupCompany(api);
  for (const [n, r] of [['eplan1', ['PLAN']], ['edes1', ['DESIGN']], ['edes2', ['DESIGN']], ['epm1', ['PM']], ['ecm1', ['CM']], ['eqs1', ['QS']], ['ebd1', ['BD']], ['ese1', ['SE']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'INDUSTRIAL').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'epm1', 'test')").run(id); return id; };
  const a = mk('EPA', 'Alpha plant'); const b = mk('EPB', 'Beta plant');
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a, b };
}
const del = (t, over = {}) => ({ projectId: t.a, deliverableNo: 'EPA-STR-001', title: 'Foundation layout', discipline: 'STRUCTURAL', type: 'DRAWING', packageName: 'P1', weight: 100, ...over });
const make = async (t, over = {}, who = plan) => { const r = await t.call(who, 'POST', '/deliverables', del(t, over)); assert.equal(r.status, 201, JSON.stringify(r.json)); return r.json.data; };
const rec = async (t, id, milestone, who = plan) => { const r = await t.call(who, 'POST', `/deliverables/${id}/milestones`, { milestone }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };

test('T-01 the weighted roll-up: only recorded milestones count, an IFC release counts when approved; by discipline, package and project', async () => {
  const t = await setup();
  const A = await make(t, { deliverableNo: 'EPA-STR-001', weight: 100, packageName: 'P1' }); const B = await make(t, { deliverableNo: 'EPA-STR-002', weight: 100, packageName: 'P1' });
  const C = await make(t, { deliverableNo: 'EPA-CIV-001', discipline: 'CIVIL', weight: 200, packageName: 'P2' }); await make(t, { deliverableNo: 'EPA-CIV-002', discipline: 'CIVIL', weight: 100, packageName: 'P2' });
  assert.equal((await t.call(plan, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data.overall.progress, '0.00');
  await rec(t, A.id, 'IFR'); await rec(t, A.id, 'IFA'); await rec(t, B.id, 'IFR'); await rec(t, B.id, 'IFA'); await rec(t, C.id, 'IFR');
  let p = (await t.call(plan, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data;
  assert.deepEqual([p.overall.progress, p.overall.deliverables, p.overall.weight], ['48.00', 4, 500], 'A 70 %, B 70 %, C 50 %, D 0: (100x70 + 100x70 + 200x50) / 500 = 48 %');
  // the release is sent: it does not count until it is approved
  const s = await t.call(plan, 'POST', `/deliverables/${A.id}/submit`, {}); assert.equal(s.status, 202, JSON.stringify(s.json)); const wf = s.json.data.workflowInstanceId; assert.equal(s.json.data.releaseStatus, 'PENDING');
  assert.equal((await t.call(plan, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data.overall.progress, '48.00', 'pending: not counted');
  assert.equal(await t.hasTask(plan, wf), false, 'the sender does not sign'); assert.equal(await t.hasTask(des1, wf), true); assert.equal(await t.hasTask(des2, wf), true); assert.equal(await t.hasTask(pm, wf), false);
  await t.act(des1, wf); const again = (await t.api.call('GET', `${W}/tasks?mine=assigned`, des1)).json.data.rows.find((x) => x.instance.id === wf); if (again) assert.notEqual((await t.api.call('POST', `${W}/tasks/${again.id}/act`, { ...des1, headers: key(), body: { action: 'approve', comment: 'again' } })).status, 200, 'the same person does not sign twice'); assert.equal(await t.hasTask(des2, wf), true); assert.equal(await t.hasTask(pm, wf), false, 'the project manager signs last'); await t.act(des2, wf); assert.equal(await t.hasTask(pm, wf), true); await t.act(pm, wf);
  p = (await t.call(plan, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data;
  assert.equal(p.overall.progress, '54.00', 'A is released: (100x100 + 100x70 + 200x50) / 500 = 54 %');
  const byD = Object.fromEntries(p.byDiscipline.map((x) => [x.key, x.progress])); assert.deepEqual([byD.STRUCTURAL, byD.CIVIL], ['85.00', '33.33']); const byP = Object.fromEntries(p.byPackage.map((x) => [x.key, x.progress])); assert.deepEqual([byP.P1, byP.P2], ['85.00', '33.33']);
  const a = (await t.call(plan, 'GET', `/deliverables/${A.id}`)).json.data; assert.deepEqual([a.milestone, a.progress, a.releaseStatus, a.milestones.find((m) => m.code === 'IFC').actual], ['IFC', '100.00', 'NONE', plus(0)]);
  for (const e of ['engg.progress.updated', 'engg.deliverable.released']) assert.ok(t.api.db.prepare('SELECT 1 FROM core_outbox WHERE event_type = ?').get(e), `${e} went out`);
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.progress.updated' ORDER BY id DESC").get(); assert.equal(JSON.parse(ev.payload).data.projectProgressBp, 5400, '14.05 reads the project figure');
  // the company changes the weights: IFR 40 %, IFA 60 %
  t.api.db.prepare("INSERT INTO core_parameters (company_id, key, value, data_type, scope_type, scope_id, effective_from, created_by, source_type) VALUES (1, 'engg.progress_weights', ?, 'json', 'company', 1, '2020-01-01', 't', 'test')").run(JSON.stringify({ IFR: 4000, IFA: 6000, IFC: 10000, ASBUILT: 10000 }));
  await rec(t, B.id, 'IFR').catch(() => null);
  const C2 = await make(t, { deliverableNo: 'EPA-CIV-003', discipline: 'CIVIL', weight: 100, packageName: 'P3' }); await rec(t, C2.id, 'IFR'); assert.equal((await t.call(plan, 'GET', `/deliverables/${C2.id}`)).json.data.progress, '40.00', 'the company weights apply');
  // reopen: an approved release is taken back and the progress falls to IFA
  assert.equal((await t.call(cm, 'POST', `/deliverables/${A.id}/amend`, { reason: 'The design changed after the release' })).status, 403, 'a construction manager does not reopen');
  const re = await t.call(des1, 'POST', `/deliverables/${A.id}/amend`, { reason: 'The design changed after the release' }); assert.deepEqual([re.json.data.milestone, re.json.data.progress], ['IFA', '60.00']);
});

test('FR-02 the S-curve against plan and the overdue deliverables', async () => {
  const t = await setup();
  await make(t, { deliverableNo: 'EPA-X', weight: 100, planIfr: '2026-01-10', planIfa: '2026-02-10', planIfc: '2026-03-10' }); await make(t, { deliverableNo: 'EPA-Y', weight: 100, planIfr: '2026-02-10', planIfa: '2026-03-10', planIfc: '2026-04-10' });
  const p = (await t.call(des1, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data;
  assert.deepEqual(p.sCurve.map((x) => [x.date, x.planned]), [['2026-01-31', '25.00'], ['2026-02-28', '60.00'], ['2026-03-31', '85.00'], ['2026-04-10', '100.00']]); assert.ok(p.sCurve.every((x) => x.actual === '0.00'), 'nothing recorded yet');
  assert.equal(p.overdue.length, 2); assert.deepEqual([p.overdue[0].milestone, p.overdue[0].daysLate > 100], ['IFR', true]); assert.equal(p.overall.planned, '100.00'); assert.equal(p.tiles.find((x) => x.key === 'overdue').value, 2);
  assert.equal((await t.call(des1, 'GET', `/deliverables?filter[overdue]=1&filter[projectId]=${t.a}`)).json.data.length, 2);
  await t.call(plan, 'POST', '/deliverables/1/milestones', { milestone: 'IFR', date: '2026-01-09' });
  const q = (await t.call(des1, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data; assert.equal(q.sCurve[0].actual, '25.00', 'IFR on 9 January counts at the end of January'); assert.equal(q.overdue.length, 2);
});

test('FR-01 FR-03 FR-05 the register, validation, the comment resolution sheet and holds; rights, isolation and the flag', async () => {
  const t = await setup();
  assert.equal((await t.call(bd, 'POST', '/deliverables', del(t))).status, 403); assert.equal((await t.call(se, 'POST', '/deliverables', del(t))).status, 403); assert.equal((await t.call(pm, 'POST', '/deliverables', del(t))).status, 403, 'the project manager views');
  for (const bad of [{ discipline: 'PLUMBING' }, { type: 'LETTER' }, { weight: 0 }, { deliverableNo: 'x' }, { planIfr: '2026-03-01', planIfa: '2026-02-01' }, { drawingId: 99999 }, { documentId: 99999 }, { ownerUser: 'ghost' }, { extra: 1 }]) assert.equal((await t.call(plan, 'POST', '/deliverables', del(t, bad))).status, 400, JSON.stringify(bad));
  const d = await make(t, { planIfr: '2026-12-01', planIfa: '2026-12-15', planIfc: '2027-01-15', ownerUser: 'edes1' }); assert.deepEqual([d.milestone, d.progress, d.overdue, d.weight], ['NOT_STARTED', '0.00', false, 100]);
  assert.equal((await t.call(plan, 'POST', '/deliverables', del(t))).status, 409, 'the number is in the register');
  assert.equal((await t.call(plan, 'PATCH', `/deliverables/${d.id}`, { weight: 150 })).json.data.weight, 150); assert.equal((await t.call(plan, 'PATCH', `/deliverables/${d.id}`, { weight: 160, rowVersion: 1 })).status, 409, 'stale');
  // milestone rules
  assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/milestones`, { milestone: 'IFA' })).status, 422, 'IFR first'); assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/milestones`, { milestone: 'IFR', date: plus(2) })).status, 400, 'no future date');
  assert.equal((await t.call(se, 'POST', `/deliverables/${d.id}/milestones`, { milestone: 'IFR' })).status, 403); await rec(t, d.id, 'IFR'); assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/milestones`, { milestone: 'IFR' })).status, 409);
  assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/submit`, {})).status, 422, 'IFA before the release'); assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/milestones`, { milestone: 'ASBUILT' })).status, 422, 'after the release only');
  await rec(t, d.id, 'IFA'); const wf = (await t.call(plan, 'POST', `/deliverables/${d.id}/submit`, {})).json.data.workflowInstanceId; assert.equal((await t.call(des1, 'POST', `/deliverables/${d.id}/withdraw`, { reason: 'Not the sender' })).status, 403);
  assert.equal((await t.call(plan, 'PATCH', `/deliverables/${d.id}`, { title: 'Foundation layout (rev)' })).status, 409, 'a release is waiting'); assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/withdraw`, { reason: 'More comments to close first' })).json.data.releaseStatus, 'NONE');
  void wf; const rej = await t.call(plan, 'POST', `/deliverables/${d.id}/submit`, {}); await t.act(des1, rej.json.data.workflowInstanceId, 'reject'); assert.deepEqual([(await t.call(plan, 'GET', `/deliverables/${d.id}`)).json.data.releaseStatus, (await t.call(plan, 'GET', `/deliverables/${d.id}`)).json.data.milestone], ['NONE', 'IFA'], 'a rejected release changes nothing');
  // the comment resolution sheet
  assert.equal((await t.call(plan, 'POST', `/deliverables/${d.id}/comments`, { revision: 'B', comment: 'x' })).status, 400); const c1 = (await t.call(plan, 'POST', `/deliverables/${d.id}/comments`, { revision: 'B', comment: 'Show the anchor bolt projection' })).json.data;
  await t.call(plan, 'POST', `/deliverables/${d.id}/comments`, { revision: 'B', comment: 'Revise the pedestal reinforcement' }); const g = (await t.call(plan, 'GET', `/deliverables/${d.id}`)).json.data; assert.deepEqual([g.comments.map((x) => x.no), g.openComments], [[1, 2], 2]);
  const cid = g.comments[0].id; assert.equal((await t.call(plan, 'POST', `/comments/${cid}/close`)).status, 422, 'a response comes first'); assert.equal((await t.call(se, 'POST', `/comments/${cid}/respond`, { response: 'Done' })).status, 403);
  const rsp = (await t.call(plan, 'POST', `/comments/${cid}/respond`, { response: 'Projection added, see revision C' })).json.data; assert.equal(rsp.comments[0].status, 'RESPONDED'); const cl = (await t.call(plan, 'POST', `/comments/${cid}/close`)).json.data; assert.deepEqual([cl.comments[0].status, cl.openComments], ['CLOSED', 1]);
  assert.equal((await t.call(plan, 'POST', `/comments/${cid}/reopen`, { reason: 'The client disagrees' })).json.data.comments[0].status, 'OPEN'); void c1;
  // holds
  assert.equal((await t.call(se, 'POST', '/holds', { deliverableId: d.id, description: 'Waiting for the soil report' })).status, 403); assert.equal((await t.call(plan, 'POST', '/holds', { deliverableId: d.id, description: 'x' })).status, 400);
  const h = await t.call(plan, 'POST', '/holds', { deliverableId: d.id, description: 'Waiting for the final soil investigation report', impactProcurement: true, impactConstruction: true, poRef: 'PO-1001', activityRef: 'A1010' }); assert.equal(h.status, 201, JSON.stringify(h.json)); assert.equal(h.json.data.holdNo, 'HLD-00001');
  const pr = (await t.call(des1, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data; assert.deepEqual([pr.holds.length, pr.tiles.find((x) => x.key === 'holds').value, pr.holds[0].deliverableNo], [1, 1, 'EPA-STR-001']); assert.equal((await t.call(plan, 'GET', `/deliverables/${d.id}`)).json.data.openHolds, 1);
  assert.equal(JSON.parse(t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.hold.raised'").get().payload).data.poRef, 'PO-1001', 'procurement expediting reads the hold');
  assert.equal((await t.call(plan, 'POST', `/holds/${h.json.data.id}/clear`, { note: 'x' })).status, 400); assert.equal((await t.call(plan, 'POST', `/holds/${h.json.data.id}/clear`, { note: 'Soil report received and reflected' })).json.data.status, 'CLEARED'); assert.equal((await t.call(plan, 'POST', `/holds/${h.json.data.id}/clear`, { note: 'Again please' })).status, 422);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.hold.cleared'").get());
  // delete / cancel / import / print / export
  assert.equal((await t.call(plan, 'DELETE', `/deliverables/${d.id}`)).status, 422, 'it has a milestone'); const d2 = await make(t, { deliverableNo: 'EPA-TMP' }); assert.equal((await t.call(plan, 'DELETE', `/deliverables/${d2.id}`)).json.data.deleted, true);
  const d3 = await make(t, { deliverableNo: 'EPA-TMP2' }); assert.equal((await t.call(plan, 'POST', `/deliverables/${d3.id}/cancel`, { reason: 'x' })).status, 400); assert.equal((await t.call(plan, 'POST', `/deliverables/${d3.id}/cancel`, { reason: 'Dropped from the scope of supply' })).json.data.registerStatus, 'CANCELLED');
  const imp = await t.call(plan, 'POST', '/deliverables/import', { projectId: t.a, rows: [{ deliverableNo: 'IMP-1', title: 'Imported one', discipline: 'PIPING', type: 'MTO', weight: 50 }, { deliverableNo: 'IMP-1', title: 'Imported dup', discipline: 'PIPING', type: 'MTO', weight: 50 }] }); assert.deepEqual([imp.json.data.created, imp.json.data.errors[0].row], [1, 2]);
  assert.match((await t.api.raw('GET', `${E}/deliverables/${d.id}/print`, cm)).buffer.toString(), /EPA-STR-001/); assert.match((await t.api.raw('GET', `${E}/deliverables/export?format=csv`, pm)).buffer.toString(), /Imported one/); assert.equal((await t.api.raw('GET', `${E}/deliverables/export?format=csv`, cm)).status, 403);
  assert.equal((await t.call(qs, 'GET', '/deliverables')).status, 200); assert.equal((await t.call(bd, 'GET', '/deliverables')).status, 403);
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTH', 'Other Pvt Ltd', 'Other', 't', 'test')").run(); assert.equal((await t.api.call('GET', `${E}/deliverables/${d.id}`, as('DESIGN', 'edes1', '2'))).status, 404);
  assert.equal((await t.call(plan, 'GET', `/engineering-progress?projectId=${t.b}`)).json.data.overall.deliverables, 0, 'another project has its own');
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.engg.p1104'").run(); assert.equal((await t.call(plan, 'GET', '/deliverables')).status, 404, 'flag off'); assert.equal((await t.call(plan, 'GET', '/drawings')).status, 200); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.engg.p1104'").run();
});

test('FR-04 vendor document requirements: the tracker by PO and vendor, the receipt, the review code approved by the engineering manager, cycles', async () => {
  const t = await setup();
  const vd = (over = {}) => ({ projectId: t.a, poRef: 'PO-2001', vendor: 'Kirloskar Pumps', docType: 'GA_DRAWING', title: 'GA drawing of the cooling water pump', dueDate: plus(10), ...over });
  assert.equal((await t.call(bd, 'POST', '/vdr-items', vd())).status, 403); assert.equal((await t.call(se, 'POST', '/vdr-items', vd())).status, 403); for (const bad of [{ docType: 'LETTER' }, { dueDate: 'soon' }, { poRef: '' }, { vendor: 'x' }, { extra: 1 }]) assert.equal((await t.call(plan, 'POST', '/vdr-items', vd(bad))).status, 400, JSON.stringify(bad));
  const a = (await t.call(plan, 'POST', '/vdr-items', vd())).json.data; const b = (await t.call(plan, 'POST', '/vdr-items', vd({ docType: 'DATA_SHEET', title: 'Data sheet of the pump', dueDate: plus(-3) }))).json.data; await t.call(plan, 'POST', '/vdr-items', vd({ poRef: 'PO-2002', vendor: 'Thermax', docType: 'MANUAL', title: 'Operation manual' }));
  assert.deepEqual([a.vdrNo, a.status, a.cycle, b.overdue], ['VDR-00001', 'REQUIRED', 1, true]);
  assert.equal((await t.call(plan, 'POST', `/vdr-items/${a.id}/submit`, { code: 'A' })).status, 422, 'received first');
  assert.equal((await t.call(se, 'POST', `/vdr-items/${a.id}/receive`, {})).status, 403); const rc = await t.call(plan, 'POST', `/vdr-items/${a.id}/receive`, {}); assert.deepEqual([rc.json.data.status, rc.json.data.submittedOn], ['RECEIVED', plus(0)]);
  assert.equal((await t.call(plan, 'POST', `/vdr-items/${a.id}/submit`, { code: 'C' })).status, 400, 'a comment goes with C');
  const s = await t.call(plan, 'POST', `/vdr-items/${a.id}/submit`, { code: 'C', text: 'Nozzle orientation does not match the P&ID' }); assert.equal(s.status, 202, JSON.stringify(s.json)); const wf = s.json.data.workflowInstanceId; assert.equal(s.json.data.status, 'IN_REVIEW');
  assert.equal(await t.hasTask(plan, wf), false); assert.equal(await t.hasTask(des1, wf), true); await t.act(des1, wf);
  const c = (await t.call(plan, 'GET', `/vdr-items/${a.id}`)).json.data; assert.deepEqual([c.status, c.reviewCode, c.cycle, c.reviewedOn], ['RESUBMIT', 'C', 2, plus(0)], 'C sends the document back for a second cycle');
  assert.equal((await t.call(plan, 'POST', `/vdr-items/${a.id}/receive`, {})).json.data.status, 'RECEIVED'); const s2 = await t.call(plan, 'POST', `/vdr-items/${a.id}/submit`, { code: 'A' }); await t.act(des2, s2.json.data.workflowInstanceId);
  assert.deepEqual([(await t.call(plan, 'GET', `/vdr-items/${a.id}`)).json.data.status, (await t.call(plan, 'GET', `/vdr-items/${a.id}`)).json.data.reviewCode], ['ACCEPTED', 'A']); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.vdr.reviewed'").get());
  // withdraw / return leaves it received
  await t.call(plan, 'POST', `/vdr-items/${b.id}/receive`, {}); const s3 = await t.call(plan, 'POST', `/vdr-items/${b.id}/submit`, { code: 'D', text: 'Wrong pump curve' }); assert.equal((await t.call(des1, 'POST', `/vdr-items/${b.id}/withdraw`, { reason: 'Not the sender' })).status, 403); await t.act(des1, s3.json.data.workflowInstanceId, 'return');
  assert.equal((await t.call(plan, 'GET', `/vdr-items/${b.id}`)).json.data.status, 'RECEIVED');
  // the tracker by PO and vendor
  const tr = (await t.call(pm, 'GET', `/vdr-items/tracker?projectId=${t.a}`)).json.data; const g1 = tr.groups.find((x) => x.poRef === 'PO-2001'); assert.deepEqual([g1.total, g1.accepted, g1.received, g1.acceptedPct], [2, 1, 1, 50]); assert.equal(tr.groups.length, 2); assert.equal(tr.totals.total, 3);
  assert.equal((await t.call(plan, 'GET', `/vdr-items?filter[projectId]=${t.a}&filter[poRef]=PO-2001`)).json.data.length, 2); assert.equal((await t.call(plan, 'GET', '/vdr-items?q=thermax')).json.data.length, 1);
  const od = (await t.call(des1, 'GET', `/engineering-progress?projectId=${t.a}`)).json.data.tiles.find((x) => x.key === 'vdr').value; assert.equal(od, 0, 'the overdue one is received');
  // amend / cancel / delete / import / print / export
  assert.equal((await t.call(des1, 'POST', `/vdr-items/${a.id}/amend`, { reason: 'The vendor revised the design' })).json.data.status, 'RESUBMIT');
  const d1 = (await t.call(plan, 'POST', '/vdr-items', vd({ title: 'To be deleted' }))).json.data; assert.equal((await t.call(plan, 'DELETE', `/vdr-items/${d1.id}`)).json.data.deleted, true); const d2 = (await t.call(plan, 'POST', '/vdr-items', vd({ title: 'To be cancelled' }))).json.data; assert.equal((await t.call(plan, 'POST', `/vdr-items/${d2.id}/cancel`, { reason: 'Not in the purchase order after all' })).json.data.status, 'CANCELLED');
  const imp = await t.call(plan, 'POST', '/vdr-items/import', { projectId: t.a, rows: [{ poRef: 'PO-3001', vendor: 'ABB India', docType: 'CERTIFICATE', title: 'Type test certificate', dueDate: plus(30) }, { poRef: '', vendor: 'ABB India', docType: 'CERTIFICATE', title: 'Bad row', dueDate: plus(30) }] }); assert.equal(imp.status, 400, 'a bad row refuses the batch');
  assert.match((await t.api.raw('GET', `${E}/vdr-items/${a.id}/print`, pm)).buffer.toString(), /VDR-00001/); assert.match((await t.api.raw('GET', `${E}/vdr-items/export?format=csv`, pm)).buffer.toString(), /Kirloskar/); assert.equal((await t.api.raw('GET', `${E}/vdr-items/export?format=csv`, cm)).status, 403);
  assert.equal((await t.call(qs, 'GET', '/vdr-items')).status, 403, 'quantity surveyors do not see vendor documents'); assert.equal((await t.call(cm, 'GET', '/vdr-items')).status, 200);
});
