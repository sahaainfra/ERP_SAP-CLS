import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { rfiConstraintsOf } from '../src/server/modules/engg/rfis.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { setupCompany, startApi } from './helpers.js';

// Part 11.02: RFI management. T-01 ball in court and ageing are right and a time-impact answer makes a delay-register draft (BR-02). Also: the issue approval (the design coordinator, never the sender), the answer and its rules (a design change names its
// drawing revision or instruction), the closure that waits for the verification of the raiser's lead (BR-01), escalation once, the constraints a hold gives the look-ahead, the dashboard, roles, isolation and the flag.
const E = '/api/v1/engg';
const W = '/api/v1/workflow';
const json = { 'content-type': 'application/json' };
let seq = 0;
const key = () => ({ ...json, 'idempotency-key': `rf-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const se1 = as('SE', 'rse1'); const se2 = as('SE', 'rse2'); const des = as('DESIGN', 'rdes1'); const cm = as('CM', 'rcm1'); const pm = as('PM', 'rpm1'); const qs = as('QS', 'rqs1'); const bd = as('BD', 'rbd1'); const doc = as('DOC', 'rdoc1');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const plus = (n) => new Date(Date.now() + 5.5 * 3_600_000 + n * 86_400_000).toISOString().slice(0, 10);

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  for (const [n, r] of [['rse1', ['SE']], ['rse2', ['SE']], ['rdes1', ['DESIGN']], ['rdes2', ['DESIGN']], ['rcm1', ['CM']], ['rpm1', ['PM']], ['rqs1', ['QS']], ['rbd1', ['BD']], ['rdoc1', ['DOC']]]) api.db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mk = (code, name) => { const id = Number(api.db.prepare('INSERT INTO org_projects (company_id, code, name, type) VALUES (1, ?, ?, ?)').run(code, name, 'BUILDING').lastInsertRowid); api.db.prepare("INSERT INTO proj_projects (company_id, project_id, pm_user, created_by) VALUES (1, ?, 'rpm1', 'test')").run(id); return id; };
  const a = mk('RFA', 'Alpha towers'); const b = mk('RFB', 'Beta bridge');
  const call = (who, method, path, body, k = key()) => api.call(method, `${E}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  return { api, call, act, hasTask, a, b };
}
const rfi = (t, over = {}) => ({ projectId: t.a, subject: 'Beam B12 reinforcement conflicts with the sleeve', question: 'The 150 mm sleeve at grid C-4 cuts the bottom bars of beam B12. Please confirm how the bars are to be arranged.', discipline: 'STRUCTURAL', activityRef: 'A1010 Beam B12 reinforcement', activityCritical: true, holdActivity: true,
  specRef: 'Spec 03 30 00 clause 3.4', proposedSolution: 'Shift the sleeve 300 mm to the right', priority: 'HIGH', requiredBy: plus(10), costImpactFlag: true, timeImpactFlag: true, consultant: 'Mehta Associates', ...over });
const issue = async (t, over = {}) => {
  const c = await t.call(se1, 'POST', '/rfis', rfi(t, over)); assert.equal(c.status, 201, JSON.stringify(c.json));
  const s = await t.call(se1, 'POST', `/rfis/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json));
  await t.act(des, s.json.data.issueWorkflowId);
  return (await t.call(se1, 'GET', `/rfis/${c.json.data.id}`)).json.data;
};

test('FR-04 the daily RFI sweep respects the company flag and escalates an overdue RFI only once', async () => {
  const t = await setup();
  const { db } = t.api;
  const { jobs, scheduler } = runtimeOf(db);
  const draft = await issue(t);
  db.prepare('UPDATE engg_rfis SET issued_on = ? WHERE id = ?').run(plus(-6), draft.id);
  const designerRole = db.prepare("SELECT id FROM iam_roles WHERE code = 'DESIGN' AND company_id IS NULL").get().id;
  for (const [username, projectId] of [['rdes-project', t.a], ['rdes-other', t.b]]) {
    const userId = db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, ?, ?, '[]')")
      .run(username, username).lastInsertRowid;
    db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status)
      VALUES (1, ?, ?, 'PROJECT', ?, 'ACTIVE')`).run(userId, designerRole, JSON.stringify([projectId]));
  }
  const schedule = scheduler.list().find((entry) => entry.code === 'engg.rfi_sweep_morning');
  assert.equal(schedule?.cron, '0 8 * * *');
  const disable = db.prepare(`INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled)
    VALUES ('ff.engg.p1102', 1, 'Disabled in the test company', 0, 0)`).run().lastInsertRowid;

  const runSchedule = async (millis) => {
    const due = new Date(Date.now() - millis).toISOString();
    db.prepare('UPDATE core_schedules SET next_run_at = ? WHERE id = ?').run(due, schedule.id);
    scheduler.tick();
    const { id } = db.prepare('SELECT id FROM core_jobs WHERE schedule_code = ? AND scheduled_for = ?').get(schedule.code, due);
    await jobs.drain();
    const job = jobs.get(id);
    assert.equal(job.status, 'SUCCEEDED');
    return job.result;
  };
  assert.deepEqual(await runSchedule(60_000), { escalated: 0 });
  db.prepare('UPDATE core_feature_flags SET enabled = 1 WHERE id = ?').run(disable);
  assert.deepEqual(await runSchedule(120_000), { escalated: 1 });
  assert.deepEqual(await runSchedule(180_000), { escalated: 0 });
  const record = (await t.call(des, 'GET', `/rfis/${draft.id}`)).json.data;
  assert.equal(record.routing.filter((entry) => entry.event === 'ESCALATED').length, 1);
  const notices = db.prepare(`SELECT user_ref, project_id FROM ntf_notifications
    WHERE template_code = 'engg.rfi.overdue' ORDER BY user_ref`).all();
  assert.deepEqual(notices.map((n) => [n.user_ref, n.project_id]), [['rdes-project', t.a], ['rdes1', t.a], ['rdes2', t.a], ['rse1', t.a]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'engg.rfi.escalated'").get().n, 1);
});

test('T-01 ball in court, ageing and the SLA are right; the answer with a time impact makes a delay draft; escalation once', async () => {
  const t = await setup();
  assert.equal((await t.call(bd, 'POST', '/rfis', rfi(t))).status, 403); assert.equal((await t.call(pm, 'POST', '/rfis', rfi(t))).status, 403, 'the project manager views and does not raise');
  for (const bad of [{ subject: 'x' }, { question: 'short' }, { requiredBy: plus(-1) }, { discipline: 'PLUMBING' }, { priority: 'URGENT' }, { drawingId: 99999 }, { locationId: 99999 }, { wbsId: 99999 }, { siteId: 99999 }, { extra: 1 }]) assert.equal((await t.call(se1, 'POST', '/rfis', rfi(t, bad))).status, 400, JSON.stringify(bad));
  assert.equal((await t.call(se1, 'POST', '/rfis', rfi(t, { projectId: 9999 }))).status, 404);
  const c = await t.call(se1, 'POST', '/rfis', rfi(t)); const r0 = c.json.data;
  assert.deepEqual([r0.rfiNo, r0.status, r0.ballInCourt, r0.ageDays, r0.hold, r0.slaDays], ['RFI-00001', 'DRAFT', 'RAISER', 0, false, 5]);
  assert.equal((await t.call(se1, 'PATCH', `/rfis/${r0.id}`, { priority: 'CRITICAL' })).json.data.priority, 'CRITICAL'); assert.equal((await t.call(se1, 'PATCH', `/rfis/${r0.id}`, { priority: 'HIGH', rowVersion: 1 })).status, 409, 'stale version'); assert.equal((await t.call(se2, 'PATCH', `/rfis/${r0.id}`, { priority: 'HIGH' })).status, 200, 'any site engineer with the right edits a draft');
  const s = await t.call(se1, 'POST', `/rfis/${r0.id}/submit`); const wf = s.json.data.issueWorkflowId; assert.deepEqual([s.json.data.status, s.json.data.ballInCourt], ['SUBMITTED', 'DESIGN']);
  assert.equal(await t.hasTask(se1, wf), false, 'the sender does not sign'); assert.equal(await t.hasTask(des, wf), true);
  assert.equal((await t.call(se1, 'PATCH', `/rfis/${r0.id}`, { priority: 'LOW' })).status, 409, 'a sent RFI is not edited');
  await t.act(des, wf);
  const r1 = (await t.call(se1, 'GET', `/rfis/${r0.id}`)).json.data; assert.deepEqual([r1.status, r1.ballInCourt, r1.ballLabel, r1.issuedOn, r1.hold, r1.criticalOpen, r1.slaDue], ['ISSUED', 'CONSULTANT', 'Consultant', plus(0), true, true, plus(5)]);
  assert.deepEqual(r1.routing.map((x) => x.event), ['RAISED', 'SENT', 'ISSUED']);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.rfi.issued'").get());
  // ageing: the RFI was issued 6 days ago; the SLA of a high-priority RFI is 5 days
  t.api.db.prepare('UPDATE engg_rfis SET issued_on = ? WHERE id = ?').run(plus(-6), r0.id);
  const aged = (await t.call(se1, 'GET', `/rfis/${r0.id}`)).json.data; assert.deepEqual([aged.ageDays, aged.slaBreached, aged.overdue], [6, true, false]);
  const lst = (await t.call(des, 'GET', `/rfis?filter[projectId]=${t.a}`)).json.data[0]; assert.deepEqual([lst.ageDays, lst.ball, lst.critical, lst.hold], [6, 'CONSULTANT', 1, 1]);
  // the dashboard
  const d = (await t.call(des, 'GET', `/rfi-dashboard?projectId=${t.a}`)).json.data; assert.deepEqual([d.open, d.slaBreached, d.criticalOpen, d.holds, d.ball.CONSULTANT, d.ageing.d0_7, d.overdue], [1, 1, 1, 1, 1, 1, 0]); assert.equal(d.critical[0].rfiNo, 'RFI-00001');
  // escalation: once, to the design coordinators and the raiser
  assert.equal((await t.call(se1, 'POST', '/rfis/escalate')).status, 403); const e1 = (await t.call(des, 'POST', '/rfis/escalate')).json.data; assert.deepEqual([e1.escalated, e1.rows[0].critical], [1, true]);
  assert.equal((await t.call(des, 'POST', '/rfis/escalate')).json.data.escalated, 0, 'once'); for (const u of ['rdes1', 'rdes2', 'rse1']) assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.rfi.overdue' AND user_ref = ?").get(u).n, 1, `${u} is told`);
  assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.rfi.escalated'").get());
  // the hold is a constraint for the look-ahead
  const con = (await t.call(pm, 'GET', `/rfis/constraints?projectId=${t.a}`)).json.data; assert.deepEqual(con.map((x) => [x.rfiNo, x.activityRef, x.critical]), [['RFI-00001', 'A1010 Beam B12 reinforcement', true]]); assert.equal(rfiConstraintsOf(t.api.db, 1, t.a).length, 1);
  // the answer: roles and rules
  const ans = { responseType: 'CLARIFICATION', text: 'Shift the sleeve 300 mm to the right of grid C-4 and add two trimmer bars.', costImpact: '25000.50', timeImpactDays: 4, variationRef: 'VO-draft-7' };
  assert.equal((await t.call(se1, 'POST', `/rfis/${r0.id}/respond`, ans)).status, 403);
  assert.equal((await t.call(des, 'POST', `/rfis/${r0.id}/respond`, { ...ans, responseType: 'DESIGN_CHANGE' })).status, 400, 'a design change names its revision or instruction (BR-01)');
  assert.equal((await t.call(des, 'POST', `/rfis/${r0.id}/respond`, { ...ans, responseType: 'INSTRUCTION' })).status, 400, 'an instruction names its reference');
  assert.equal((await t.call(des, 'POST', `/rfis/${r0.id}/respond`, { ...ans, costImpact: '-5' })).status, 400); assert.equal((await t.call(des, 'POST', `/rfis/${r0.id}/respond`, { ...ans, drawingRevisionId: 99999 })).status, 400);
  const ok = await t.call(des, 'POST', `/rfis/${r0.id}/respond`, { ...ans, responseType: 'DESIGN_CHANGE', instructionRef: 'CI-014' }); assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const r2 = ok.json.data; assert.deepEqual([r2.status, r2.ballInCourt, r2.responseType, r2.costImpact, r2.timeImpactDays, r2.respondedBy, r2.delayDraft.days, r2.delayDraft.status], ['RESPONDED', 'VERIFIER', 'DESIGN_CHANGE', '25000.50', 4, 'rdes1', 4, 'DRAFT']);
  assert.equal(t.api.db.prepare('SELECT COUNT(*) AS n FROM engg_rfi_delay_drafts WHERE rfi_id = ?').get(r0.id).n, 1, 'BR-02 a delay draft');
  assert.equal(t.api.db.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE template_code = 'engg.rfi.responded' AND user_ref = 'rse1'").get().n, 1, 'the raiser is told');
  const ev = t.api.db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'engg.rfi.responded'").get(); const p = JSON.parse(ev.payload).data; assert.deepEqual([p.timeImpactDays, p.costImpact, p.instructionRef, p.hold], [4, '25000.50', 'CI-014', true]);
  assert.equal((await t.call(des, 'POST', `/rfis/${r0.id}/respond`, ans)).status, 422, 'answered already');
});

test('BR-01 closure waits for the design coordinator and the raiser\'s lead; a rejected closure goes back; rework; hold released at close', async () => {
  const t = await setup();
  const r = await issue(t); const ans = { responseType: 'CLARIFICATION', text: 'Provide the sleeve through the web, 450 mm from the support.', costImpact: '0', timeImpactDays: 0 };
  assert.equal((await t.call(se1, 'POST', `/rfis/${r.id}/close`, {})).status, 422, 'no answer yet'); assert.equal((await t.call(des, 'POST', `/rfis/${r.id}/respond`, ans)).json.data.delayDraft, null, 'no time impact, no delay draft');
  // the answer is not enough: back to the consultant, then answered again
  assert.equal((await t.call(se1, 'POST', `/rfis/${r.id}/rework`, { reason: 'The answer does not give the distance' })).status, 403);
  const rw = await t.call(des, 'POST', `/rfis/${r.id}/rework`, { reason: 'The answer does not give the distance from the support' }); assert.deepEqual([rw.json.data.status, rw.json.data.ballInCourt, rw.json.data.responseText], ['ISSUED', 'CONSULTANT', null]);
  await t.call(des, 'POST', `/rfis/${r.id}/respond`, ans);
  // closure: design coordinator, then the lead (the project manager of the project); the raiser cannot be the lead
  const cl = await t.call(se1, 'POST', `/rfis/${r.id}/close`, { note: 'Answer is clear' }); assert.equal(cl.status, 202, JSON.stringify(cl.json)); assert.deepEqual([cl.json.data.status, cl.json.data.ballInCourt], ['CLOSE_REQUESTED', 'VERIFIER']); const wf = cl.json.data.closeWorkflowId;
  assert.equal(await t.hasTask(se1, wf), false); assert.equal(await t.hasTask(pm, wf), false, 'the lead comes after the design coordinator'); assert.equal(await t.hasTask(des, wf), true);
  assert.equal((await t.call(des, 'POST', `/rfis/${r.id}/cancel`, { reason: 'Trying to cancel during closure' })).status, 422);
  await t.act(des, wf); assert.equal(await t.hasTask(pm, wf), true); await t.act(pm, wf, 'return');
  const back = (await t.call(se1, 'GET', `/rfis/${r.id}`)).json.data; assert.deepEqual([back.status, back.closeWorkflowId, back.hold], ['RESPONDED', null, true], 'a returned closure leaves the RFI answered, still holding');
  const cl2 = await t.call(se1, 'POST', `/rfis/${r.id}/close`, {}); const wf2 = cl2.json.data.closeWorkflowId; assert.equal((await t.call(se2, 'POST', `/rfis/${r.id}/withdraw`, { reason: 'Not the sender here' })).status, 403);
  await t.act(des, wf2); await t.act(pm, wf2);
  const done = (await t.call(se1, 'GET', `/rfis/${r.id}`)).json.data; assert.deepEqual([done.status, done.ballInCourt, done.verifiedBy, done.verifiedOn, done.hold, done.closedAt != null], ['CLOSED', 'NONE', 'rpm1', plus(0), false, true]);
  assert.deepEqual((await t.call(pm, 'GET', `/rfis/constraints?projectId=${t.a}`)).json.data, [], 'the activity is free again'); assert.ok(t.api.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'engg.rfi.closed'").get());
  const h = (await t.call(des, 'GET', `/rfis/${r.id}/history`)).json.data; assert.ok(h.approvals.length >= 5); assert.ok(h.routing.some((x) => x.event === 'CLOSED'));
  // amend: a closed RFI is taken up again as a new draft
  const am = await t.call(des, 'POST', `/rfis/${r.id}/amend`, { reason: 'The same sleeve problem on the next floor' }); assert.equal(am.status, 201, JSON.stringify(am.json)); assert.deepEqual([am.json.data.status, am.json.data.rfiNo, am.json.data.question.includes('Amends RFI-00001')], ['DRAFT', 'RFI-00002', true]);
});

test('FR-01 FR-03 FR-05 links to drawings and revisions; the drawing page lists its RFIs; withdraw, reject, cancel, delete; import, print, export; roles, isolation and the flag', async () => {
  const t = await setup();
  const dwg = await t.call(doc, 'POST', '/drawings', { projectId: t.a, drawingNo: 'RFA-STR-001', title: 'Beam layout', discipline: 'STRUCTURAL', links: [], revision: { label: 'A', statusCode: 'IFR', changeNote: 'First' } }); assert.equal(dwg.status, 201, JSON.stringify(dwg.json));
  const other = await t.call(doc, 'POST', '/drawings', { projectId: t.a, drawingNo: 'RFA-STR-002', title: 'Column layout', discipline: 'STRUCTURAL', links: [], revision: { label: 'A', statusCode: 'IFR', changeNote: 'First' } });
  const rev = dwg.json.data.revisions[0].id;
  assert.equal((await t.call(se1, 'POST', '/rfis', rfi(t, { drawingId: dwg.json.data.id, drawingRevisionId: other.json.data.revisions[0].id }))).status, 400, 'the revision belongs to another drawing');
  const c = await t.call(se1, 'POST', '/rfis', rfi(t, { drawingId: dwg.json.data.id, drawingRevisionId: rev })); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.deepEqual([c.json.data.drawingNo, c.json.data.drawingRevision], ['RFA-STR-001', 'A']);
  const g = (await t.call(doc, 'GET', `/drawings/${dwg.json.data.id}`)).json.data; assert.deepEqual(g.rfis.map((x) => [x.rfiNo, x.status]), [['RFI-00001', 'DRAFT']]);
  assert.equal((await t.call(bd, 'GET', '/rfis')).status, 403); assert.equal((await t.call(qs, 'GET', '/rfis')).status, 200); assert.equal((await t.call(qs, 'POST', '/rfis', rfi(t))).status, 403);
  // withdraw by the sender, reject, return and resubmit
  const s = await t.call(se1, 'POST', `/rfis/${c.json.data.id}/submit`); assert.equal((await t.call(se1, 'POST', `/rfis/${c.json.data.id}/withdraw`, { reason: 'One more photo to add' })).json.data.status, 'DRAFT');
  const s2 = await t.call(se1, 'POST', `/rfis/${c.json.data.id}/submit`); void s; await t.act(des, s2.json.data.issueWorkflowId, 'return'); assert.deepEqual([(await t.call(se1, 'GET', `/rfis/${c.json.data.id}`)).json.data.status, (await t.call(se1, 'GET', `/rfis/${c.json.data.id}`)).json.data.ballInCourt], ['RETURNED', 'RAISER']);
  assert.equal((await t.call(se1, 'PATCH', `/rfis/${c.json.data.id}`, { question: 'The 150 mm sleeve at grid C-4 cuts the bottom bars of beam B12; the revision A drawing shows no trimmer bars.' })).status, 200);
  const s3 = await t.call(se1, 'POST', `/rfis/${c.json.data.id}/submit`); assert.equal(s3.json.data.issueWorkflowId, s2.json.data.issueWorkflowId, 'the same approval goes on'); await t.act(des, s3.json.data.issueWorkflowId, 'reject'); assert.equal((await t.call(se1, 'GET', `/rfis/${c.json.data.id}`)).json.data.status, 'REJECTED');
  // delete / cancel
  const d1 = await t.call(se1, 'POST', '/rfis', rfi(t, { subject: 'To be deleted' })); assert.equal((await t.call(se1, 'DELETE', `/rfis/${d1.json.data.id}`)).json.data.deleted, true); assert.equal((await t.call(se1, 'GET', `/rfis/${d1.json.data.id}`)).status, 404);
  const i1 = await issue(t, { subject: 'Issued then cancelled' }); assert.equal((await t.call(se1, 'POST', `/rfis/${i1.id}/cancel`, { reason: 'x' })).status, 400); const cn = await t.call(cm, 'POST', `/rfis/${i1.id}/cancel`, { reason: 'Resolved on site with the consultant' }); assert.deepEqual([cn.json.data.status, cn.json.data.hold], ['CANCELLED', false]);
  // import, print, export
  const imp = await t.call(se1, 'POST', '/rfis/import', { projectId: t.a, rows: [{ ...rfi(t), projectId: undefined, subject: 'Imported one' }, { ...rfi(t), projectId: undefined, subject: 'Imported two', requiredBy: plus(-3) }].map(({ projectId: _p, ...x }) => x) }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual([imp.json.data.created, imp.json.data.errors.length, imp.json.data.errors[0].row], [1, 1, 2]);
  assert.match((await t.api.raw('GET', `${E}/rfis/${i1.id}/print`, pm)).buffer.toString(), /Issued then cancelled/); assert.equal((await t.api.raw('GET', `${E}/rfis/${i1.id}/print`, se2)).status, 200, 'a site engineer prints');
  assert.match((await t.api.raw('GET', `${E}/rfis/export?format=csv`, pm)).buffer.toString(), /Imported one/); assert.equal((await t.api.raw('GET', `${E}/rfis/export?format=csv`, se1)).status, 403);
  assert.ok((await t.call(des, 'GET', '/rfis?filter[status]=CANCELLED')).json.data.length === 1); assert.ok((await t.call(des, 'GET', '/rfis?q=imported')).json.data.length === 1);
  // another company sees nothing; another project is separate
  t.api.db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (2, 'OTH', 'Other Pvt Ltd', 'Other', 't', 'test')").run(); assert.equal((await t.api.call('GET', `${E}/rfis/${i1.id}`, as('DESIGN', 'rdes1', '2'))).status, 404);
  assert.equal((await t.call(se1, 'GET', `/rfi-dashboard?projectId=${t.b}`)).json.data.total, 0);
  // the flag
  t.api.db.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.engg.p1102'").run(); assert.equal((await t.call(des, 'GET', '/rfis')).status, 404, 'flag off'); assert.equal((await t.call(des, 'GET', '/drawings')).status, 200, 'drawings are another flag'); t.api.db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.engg.p1102'").run();
});
