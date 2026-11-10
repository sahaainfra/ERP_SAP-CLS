import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { classOf } from '../src/server/modules/plan/delays.js';

// Part 13.05: the delay register and the time-impact records. T-01 a time-impact analysis of a sample fragnet gives the expected completion shift, on a copy: the schedule is not written (BR-01).
// Also: a delay with its cause, responsibility, activities and evidence; the classification approved by the project manager and then the commercial manager (the one who prepared it never decides);
// the lock and the revision; drafts from the RFIs answered with a time impact; the summary by cause and responsibility with excusable and compensable totals and what the claims read; roles, isolation,
// 409, idempotent replay and the flag.
const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `pd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'dplan1'); const pm = as('PM', 'dpm1'); const com = as('COMMGR', 'dcom1'); const pcm = as('PCMGR', 'dpcm1'); const se = as('SE', 'dse1'); const aud = as('AUD', 'daud1'); const both = as('PLAN,PM', 'dboth1'); const other = as('PLAN', 'dplan9', '2');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['dplan1', ['PLAN']], ['dpm1', ['PM']], ['dpm2', ['PM']], ['dcom1', ['COMMGR']], ['dpcm1', ['PCMGR']], ['dse1', ['SE']], ['daud1', ['AUD']], ['dboth1', ['PLAN', 'PM']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'DLY', 'Delay Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'DL2', 'Second Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const w = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Substructure', 1, 't')").run(pid).lastInsertRowid);
  const drawing = Number(d.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id) VALUES (1, ?, 'STR-101', 'Footing layout', 'STRUCTURAL', ?)").run(pid, w).lastInsertRowid);
  const rfi = Number(d.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, wbs_id, drawing_id, activity_ref, required_by, status) VALUES (1, 'RFI/00009', ?, 'Footing level', 'What is the footing level?', 'STRUCTURAL', ?, ?, 'A20', '2026-04-08', 'RESPONDED')").run(pid, w, drawing).lastInsertRowid);
  const letter = Number(d.prepare("INSERT INTO engg_letters (company_id, org_project_id, direction, letter_no, letter_date, party, subject, category) VALUES (1, ?, 'IN', 'CL/014', '2026-04-09', 'Consultant', 'Revised footing levels', 'INSTRUCTION')").run(pid).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const cal = await call(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await call(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const s = await call(plan1, 'POST', '/schedules', { projectId: pid, name: 'Delay Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); assert.equal(s.status, 201, JSON.stringify(s.json)); const sid = s.json.data.id;
  assert.equal((await call(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'PCC bed', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Footing concrete', duration: 2, predecessors: 'A20' }] })).status, 201);
  assert.equal((await call(plan1, 'POST', `/schedules/${sid}/calculate`)).json.data.finishDate, '2026-04-16');
  const a = Object.fromEntries((await call(plan1, 'GET', `/schedules/${sid}/activities?pageSize=1000`)).json.data.rows.map((x) => [x.code, x]));
  return { api, d, call, act, hasTask, pid, pid2, sid, a, rfi, letter, drawing };
}
const FRAGNET = { activities: [{ code: 'F10', name: 'Redesign of the footings', duration: 4 }], links: [{ pred: 'A10', succ: 'F10', type: 'FS', lag: 0 }, { pred: 'F10', succ: 'A20', type: 'FS', lag: 0 }] };
const delayBody = (t, extra = {}) => ({ projectId: t.pid, title: 'Footing levels changed by the consultant', cause: 'LATE_DRAWINGS', responsibility: 'EMPLOYER', startDate: '2026-04-11', endDate: '2026-04-15', activityIds: [t.a.A20.id], mitigation: 'Crew moved to the boundary wall', ...extra });

test('T-01 BR-01 a time-impact analysis of a sample fragnet gives the expected completion shift on a copy; the schedule is not written', async () => {
  const t = await boot(); const made = await t.call(plan1, 'POST', '/delays', delayBody(t)); assert.equal(made.status, 201, JSON.stringify(made.json)); const dl = made.json.data;
  assert.deepEqual([dl.status, dl.delayDays, dl.excusable, dl.compensable, dl.affected.map((x) => x.code), dl.scheduleId], ['DRAFT', 5, true, true, ['A20'], t.sid]);
  const before = t.d.prepare('SELECT version, finish_date, activities_count, needs_calc FROM plan_schedules WHERE id = ?').get(t.sid); const acts0 = t.d.prepare('SELECT id, es, ef, version FROM plan_activities WHERE schedule_id = ? ORDER BY id').all(t.sid); const links0 = t.d.prepare('SELECT COUNT(*) AS n FROM plan_dependencies WHERE schedule_id = ?').get(t.sid).n;
  // the preview: A10 06-10 April; the fragnet 11, 13, 14, 15 April (Sunday off); A20 16-18; A30 20-21: the completion moves from the 16th to the 21st, 5 days, 4 working days
  const pv = await t.call(plan1, 'POST', `/delays/${dl.id}/tia/preview`, { dataDate: '2026-04-06', fragnet: FRAGNET }); assert.equal(pv.status, 200, JSON.stringify(pv.json)); const x = pv.json.data;
  assert.deepEqual([x.completionBefore, x.completionAfter, x.impactDays, x.impactWorkingDays], ['2026-04-16', '2026-04-21', 5, 4]); assert.deepEqual(x.fragnet.map((f) => [f.code, f.es, f.ef, f.critical]), [['F10', '2026-04-11', '2026-04-15', true]]);
  assert.deepEqual(x.moved.map((m) => [m.code, m.efBefore, m.efAfter, m.shift]), [['A30', '2026-04-16', '2026-04-21', 5], ['A20', '2026-04-14', '2026-04-18', 4]]); assert.deepEqual(x.affectedCritical, ['A20']);
  assert.equal((await t.call(plan1, 'GET', `/delays/${dl.id}`)).json.data.impactDays, null, 'a preview keeps nothing');
  // a fragnet in parallel with float does not move the completion
  const par = (await t.call(plan1, 'POST', `/delays/${dl.id}/tia/preview`, { dataDate: '2026-04-06', fragnet: { activities: [{ code: 'F20', name: 'Extra survey', duration: 1 }], links: [{ pred: 'A10', succ: 'F20' }] } })).json.data; assert.deepEqual([par.impactDays, par.completionAfter], [0, '2026-04-16']);
  // as at a later date: the progress after that date is taken out, the progress before it counts
  t.d.prepare("UPDATE plan_activities SET actual_start = '2026-04-06', actual_finish = '2026-04-13', pct_complete = 10000, remaining_days = 0 WHERE id = ?").run(t.a.A10.id);
  const late = (await t.call(plan1, 'POST', `/delays/${dl.id}/tia/preview`, { dataDate: '2026-04-14', fragnet: { activities: [{ code: 'F30', name: 'Hold for the levels', duration: 2 }], links: [{ pred: 'F30', succ: 'A20' }] } })).json.data;
  assert.deepEqual([late.completionBefore, late.completionAfter, late.impactDays], ['2026-04-18', '2026-04-21', 3], 'A10 finished late on the 13th; the 2-day hold starts at the data date and pushes A30 over a Sunday');
  const asAtStart = (await t.call(plan1, 'POST', `/delays/${dl.id}/tia/preview`, { dataDate: '2026-04-06', fragnet: FRAGNET })).json.data; assert.equal(asAtStart.completionBefore, '2026-04-16', 'the finish of the 13th is after the data date: it is taken out');
  t.d.prepare('UPDATE plan_activities SET actual_start = NULL, actual_finish = NULL, pct_complete = 0, remaining_days = NULL WHERE id = ?').run(t.a.A10.id);
  // what is refused: a code of the schedule, a link to nowhere, a loose activity, a loop
  const bad = async (fragnet, re, status = 400) => { const r = await t.call(plan1, 'POST', `/delays/${dl.id}/tia/preview`, { dataDate: '2026-04-06', fragnet }); assert.equal(r.status, status, JSON.stringify(r.json)); assert.match(JSON.stringify(r.json.error), re); };
  await bad({ activities: [{ code: 'A10', name: 'Clash', duration: 1 }], links: [{ pred: 'A10', succ: 'A20' }] }, /own codes/);
  await bad({ activities: [{ code: 'F1', name: 'Nowhere', duration: 1 }], links: [{ pred: 'Z99', succ: 'F1' }] }, /neither in the fragnet nor in the schedule/);
  await bad({ activities: [{ code: 'F1', name: 'Linked', duration: 1 }, { code: 'F2', name: 'Loose', duration: 1 }], links: [{ pred: 'A10', succ: 'F1' }] }, /F2 is not linked/);
  await bad({ activities: [{ code: 'F1', name: 'Loop', duration: 1 }], links: [{ pred: 'A30', succ: 'F1' }, { pred: 'F1', succ: 'A10' }] }, /loop: F1 → A10|loop: A10|Loop/, 422);
  await bad({ activities: [], links: [] }, /at least one activity/);
  // the analysis kept: the impact of the delay; the schedule, its activities and links untouched
  const sv = await t.call(plan1, 'POST', `/delays/${dl.id}/tia`, { dataDate: '2026-04-06', fragnet: FRAGNET, note: 'Fragnet agreed with the consultant' }); assert.equal(sv.status, 201, JSON.stringify(sv.json)); const d1 = sv.json.data;
  assert.deepEqual([d1.impactDays, d1.tias.length, d1.tias[0].completionAfter, d1.tias[0].impactWorkingDays, d1.tiaId], [5, 1, '2026-04-21', 4, d1.tias[0].id]); assert.match(d1.tias[0].scheduleRef, /^SCH\/\d+ v1 \(draft, calculated /);
  assert.deepEqual(t.d.prepare('SELECT version, finish_date, activities_count, needs_calc FROM plan_schedules WHERE id = ?').get(t.sid), before, 'BR-01: the schedule is not written');
  assert.deepEqual(t.d.prepare('SELECT id, es, ef, version FROM plan_activities WHERE schedule_id = ? ORDER BY id').all(t.sid), acts0); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_dependencies WHERE schedule_id = ?').get(t.sid).n, links0);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM plan_activities WHERE code = 'F10'").get().n, 0); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM plan_baselines').get().n, 0);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'plan_delays' AND action = 'tia'").get().n === 1);
  assert.equal((await t.call(pm, 'POST', `/delays/${dl.id}/tia`, { dataDate: '2026-04-06', fragnet: FRAGNET })).status, 403, 'the project manager does not analyse'); assert.equal((await t.call(other, 'POST', `/delays/${dl.id}/tia/preview`, { fragnet: FRAGNET })).status, 404);
  // the pure rule of the classification
  assert.deepEqual([classOf('EMPLOYER'), classOf('NEUTRAL'), classOf('CONTRACTOR')], [{ excusable: true, compensable: true }, { excusable: true, compensable: false }, { excusable: false, compensable: false }]);
});

test('FR-01 FR-04 the delay with its evidence; the classification approved by the project manager and then the commercial manager; locked, revised; returned and rejected', async () => {
  const t = await boot(); const body = delayBody(t);
  assert.equal((await t.call(plan1, 'POST', '/delays', { ...body, endDate: '2026-04-01' })).json.error.details[0].field, 'endDate'); assert.equal((await t.call(plan1, 'POST', '/delays', { ...body, cause: 'BAD_LUCK' })).status, 400);
  assert.equal((await t.call(plan1, 'POST', '/delays', { ...body, activityIds: [999999] })).status, 400); for (const who of [se, pm, com, aud]) assert.equal((await t.call(who, 'POST', '/delays', body)).status, 403, who.roles); assert.equal((await t.call(other, 'POST', '/delays', body)).status, 404);
  assert.equal((await t.api.call('POST', `${P}/delays`, { ...plan1, headers: { 'content-type': 'application/json' }, body })).status, 400, 'an Idempotency-Key is required');
  const k = key(); const made = await t.call(plan1, 'POST', '/delays', body, k); assert.equal(made.status, 201); const dl = made.json.data; assert.match(dl.docNo, /^DL\//); assert.equal((await t.call(plan1, 'POST', '/delays', body, k)).json.data.id, dl.id, 'idempotent replay');
  // the draft is corrected under its row version; the delay days are worked out by the server
  const up = await t.call(plan1, 'PATCH', `/delays/${dl.id}`, { endDate: '2026-04-17', concurrency: 'The contractor was short of masons on the 16th', rowVersion: dl.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json)); assert.equal(up.json.data.delayDays, 7);
  assert.equal((await t.call(plan1, 'PATCH', `/delays/${dl.id}`, { title: 'Stale', rowVersion: dl.rowVersion })).status, 409);
  // not sent without evidence; the evidence of the same project only
  const noEv = await t.call(plan1, 'POST', `/delays/${dl.id}/submit`); assert.equal(noEv.status, 400); assert.equal(noEv.json.error.details[0].field, 'evidence');
  assert.deepEqual((await t.call(plan1, 'GET', `/delays/${dl.id}/evidence/candidates?entity=engg_rfi&q=RFI`)).json.data.rows.map((x) => x.id), [t.rfi]);
  for (const [entity, id] of [['engg_rfi', t.rfi], ['engg_letter', t.letter], ['engg_drawing', t.drawing]]) assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/evidence`, { entity, entityId: id, note: 'see' })).status, 201, entity);
  assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/evidence`, { entity: 'engg_rfi', entityId: t.rfi })).status, 409, 'linked once'); assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/evidence`, { entity: 'core_file', entityId: 1 })).status, 400, 'a file must be attached to the delay');
  const otherRfi = Number(t.d.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, required_by, status) VALUES (1, 'RFI/00010', ?, 'Other', 'Other?', 'CIVIL', '2026-04-08', 'ISSUED')").run(t.pid2).lastInsertRowid);
  assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/evidence`, { entity: 'engg_rfi', entityId: otherRfi })).status, 400, 'not of another project');
  const got = (await t.call(se, 'GET', `/delays/${dl.id}`)).json.data; assert.deepEqual(got.evidence.map((e) => [e.entity, e.label]), [['engg_rfi', 'RFI/00009: Footing level'], ['engg_letter', 'CL/014: Revised footing levels'], ['engg_drawing', 'STR-101: Footing layout']]); assert.equal(got.can.edit, false);
  assert.equal((await t.call(plan1, 'DELETE', `/delays/${dl.id}/evidence/${got.evidence[2].id}`)).status, 200);
  await t.call(plan1, 'POST', `/delays/${dl.id}/tia`, { dataDate: '2026-04-06', fragnet: FRAGNET });
  // the chain: the project manager, then the commercial manager; the planner holds no task
  const sub = await t.call(plan1, 'POST', `/delays/${dl.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId;
  assert.equal((await t.call(plan1, 'PATCH', `/delays/${dl.id}`, { responsibility: 'CONTRACTOR' })).status, 409); assert.equal(await t.hasTask(plan1, inst), false); assert.equal(await t.hasTask(com, inst), false);
  await t.act(pm, inst); assert.equal((await t.call(plan1, 'GET', `/delays/${dl.id}`)).json.data.status, 'SUBMITTED'); await t.act(com, inst);
  const ap = (await t.call(plan1, 'GET', `/delays/${dl.id}`)).json.data; assert.deepEqual([ap.status, ap.approvedBy, ap.can.edit, ap.can.analyse, ap.can.amend], ['APPROVED', 'dcom1', false, false, true]);
  const ev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plan.delay.approved'").get().payload).data; assert.deepEqual([ev.delayId, ev.responsibility, ev.excusable, ev.compensable, ev.impactDays, ev.delayDays, ev.activities], [dl.id, 'EMPLOYER', true, true, 5, 7, ['A20']]);
  // locked: no edit, no analysis, no evidence removed; changed by a revision only
  assert.equal((await t.call(plan1, 'PATCH', `/delays/${dl.id}`, { title: 'After approval' })).status, 409); assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/tia`, { fragnet: FRAGNET })).status, 409); assert.equal((await t.call(plan1, 'DELETE', `/delays/${dl.id}/evidence/${got.evidence[0].id}`)).status, 409);
  assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/cancel`, { reason: 'Not any more' })).status, 422); assert.equal((await t.call(plan1, 'DELETE', `/delays/${dl.id}`)).status, 422);
  const pr = await t.api.raw('GET', `${P}/delays/${dl.id}/print`, pm); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /2026-04-16 → 2026-04-21 \(5 days, 4 working days\)/); assert.doesNotMatch(pr.buffer.toString(), /NOT AN APPROVED/); assert.equal((await t.api.raw('GET', `${P}/delays/${dl.id}/print`, se)).status, 403);
  const rv = await t.call(plan1, 'POST', `/delays/${dl.id}/amend`, { reason: 'The consultant now says the contractor shares the delay' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); const d2 = rv.json.data;
  assert.deepEqual([d2.revisionNo, d2.parentDelayId, d2.evidence.length, d2.status, d2.previous.responsibility], [2, dl.id, 2, 'DRAFT', 'EMPLOYER']); assert.equal((await t.call(plan1, 'POST', `/delays/${dl.id}/amend`, { reason: 'Twice at once' })).status, 409);
  assert.equal((await t.call(plan1, 'PATCH', `/delays/${d2.id}`, { responsibility: 'NEUTRAL' })).status, 200);
  const i2 = (await t.call(plan1, 'POST', `/delays/${d2.id}/submit`)).json.data.workflowInstanceId; await t.act(pm, i2, 'return'); assert.equal((await t.call(plan1, 'GET', `/delays/${d2.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.call(plan1, 'POST', `/delays/${d2.id}/submit`)).status, 202); await t.act(pm, i2); await t.act(com, i2);
  assert.equal((await t.call(plan1, 'GET', `/delays/${dl.id}`)).json.data.status, 'SUPERSEDED'); const n2 = (await t.call(plan1, 'GET', `/delays/${d2.id}`)).json.data; assert.deepEqual([n2.status, n2.excusable, n2.compensable], ['APPROVED', true, false]);
  // a rejection; a withdrawal; a cancellation; a deletion
  const d3 = (await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'Masons short', cause: 'CONTRACTOR_RESOURCES', responsibility: 'EMPLOYER' }))).json.data; await t.call(plan1, 'POST', `/delays/${d3.id}/evidence`, { entity: 'engg_letter', entityId: t.letter });
  const i3 = (await t.call(plan1, 'POST', `/delays/${d3.id}/submit`)).json.data.workflowInstanceId; assert.equal((await t.call(se, 'POST', `/delays/${d3.id}/withdraw`, { reason: 'Not mine to take back' })).status, 403);
  const wd = await t.call(plan1, 'POST', `/delays/${d3.id}/withdraw`, { reason: 'Sent too early' }); assert.deepEqual([wd.json.data.status, wd.json.data.workflowInstanceId], ['DRAFT', null]);
  const i4 = (await t.call(plan1, 'POST', `/delays/${d3.id}/submit`)).json.data.workflowInstanceId; assert.notEqual(i4, i3); await t.act(pm, i4); await t.act(com, i4, 'reject'); assert.equal((await t.call(plan1, 'GET', `/delays/${d3.id}`)).json.data.status, 'REJECTED');
  const d4 = (await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'To be cancelled' }))).json.data; assert.equal((await t.call(plan1, 'POST', `/delays/${d4.id}/cancel`, { reason: 'Raised by mistake' })).json.data.status, 'CANCELLED');
  const d5 = (await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'To be deleted' }))).json.data; assert.equal((await t.call(plan1, 'DELETE', `/delays/${d5.id}`)).status, 200); assert.equal((await t.call(plan1, 'GET', `/delays/${d5.id}`)).status, 404);
  const h = (await t.call(se, 'GET', `/delays/${d2.id}/history`)).json.data; assert.ok(h.approvals.length >= 4); assert.ok(h.audit.map((x) => x.action).includes('amend'));
});

test('FR-02 FR-05 drafts from the RFIs answered with a time impact; the summary by cause and responsibility and what the claims read; roles, isolation and the flag', async () => {
  const t = await boot(); const rt = runtimeOf(t.d); const drain = () => { for (let i = 0; i < 4; i += 1) rt.bus.drain(); };
  // FR-02: the answer of an RFI with a time impact drafts a delay with its evidence; the same event again drafts nothing more
  const ev = { type: 'engg.rfi.responded', entity: 'engg_rfi', entityId: t.rfi, actorId: 'consultant', companyId: 1, projectId: t.pid, data: { projectId: t.pid, rfiId: t.rfi, rfiNo: 'RFI/00009', timeImpactDays: 6, activityRef: 'A20' } };
  publishEvent(t.d, ev); drain(); publishEvent(t.d, ev); drain();
  const drafts = (await t.call(plan1, 'GET', '/delays?filter[source]=engg_rfi')).json.data; assert.equal(drafts.length, 1); const dr = (await t.call(plan1, 'GET', `/delays/${drafts[0].id}`)).json.data;
  assert.deepEqual([dr.status, dr.cause, dr.responsibility, dr.startDate, dr.endDate, dr.delayDays, dr.affected.map((x) => x.code), dr.source.entity, dr.requestedBy], ['DRAFT', 'LATE_DRAWINGS', 'EMPLOYER', '2026-04-08', '2026-04-13', 6, ['A20'], 'engg_rfi', null]);
  assert.deepEqual(dr.evidence.map((e) => e.entity), ['engg_rfi', 'engg_drawing']); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.delay.drafted'").get().n, 1);
  publishEvent(t.d, { ...ev, data: { ...ev.data, timeImpactDays: 0 } }); drain(); assert.equal((await t.call(plan1, 'GET', '/delays')).json.data.length, 1, 'an answer without a time impact drafts nothing');
  publishEvent(t.d, { ...ev, data: { ...ev.data, timeImpactDays: 9 } }); drain(); assert.equal((await t.call(plan1, 'GET', `/delays/${dr.id}`)).json.data.delayDays, 9, 'answered again: the draft follows');
  // the drafted delay is taken on by the planner and approved; a contractor delay and a neutral one beside it
  const approve = async (id) => { await t.call(plan1, 'POST', `/delays/${id}/tia`, { dataDate: '2026-04-06', fragnet: FRAGNET }); const s = await t.call(plan1, 'POST', `/delays/${id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); await t.act(pm, s.json.data.workflowInstanceId); await t.act(com, s.json.data.workflowInstanceId); };
  await approve(dr.id);
  const c = (await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'Masons short', cause: 'CONTRACTOR_RESOURCES', responsibility: 'CONTRACTOR', startDate: '2026-04-20', endDate: '2026-04-21' }))).json.data; await t.call(plan1, 'POST', `/delays/${c.id}/evidence`, { entity: 'engg_letter', entityId: t.letter }); await approve(c.id);
  const n = (await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'Cyclone warning', cause: 'WEATHER', responsibility: 'NEUTRAL', startDate: '2026-05-02', endDate: '2026-05-03' }))).json.data; await t.call(plan1, 'POST', `/delays/${n.id}/evidence`, { entity: 'engg_letter', entityId: t.letter }); await approve(n.id);
  await t.call(plan1, 'POST', '/delays', delayBody(t, { title: 'A draft not counted' }));
  // FR-05: the summary of the approved delays
  const sm = (await t.call(pm, 'GET', `/delays/summary?projectId=${t.pid}`)).json.data; assert.deepEqual([sm.totals.count, sm.totals.delayDays, sm.totals.impactDays, sm.totals.excusable, sm.totals.compensable, sm.totals.nonExcusable], [3, 13, 15, 10, 5, 5]);
  assert.deepEqual(sm.byResponsibility.map((x) => [x.code, x.count, x.impactDays]), [['EMPLOYER', 1, 5], ['CONTRACTOR', 1, 5], ['NEUTRAL', 1, 5]]); assert.equal(sm.cells.length, 3); assert.equal(sm.drill, null);
  const drill = (await t.call(pm, 'GET', `/delays/summary?projectId=${t.pid}&responsibility=CONTRACTOR`)).json.data.drill; assert.deepEqual(drill.map((x) => x.title), ['Masons short']);
  assert.equal((await t.call(pm, 'GET', `/delays/summary?projectId=${t.pid}&status=all`)).json.data.totals.count, 4); assert.equal((await t.call(pm, 'GET', `/delays/summary?projectId=${t.pid}&from=2026-05-01`)).json.data.totals.count, 1);
  for (const f of ['xlsx', 'pdf', 'csv']) { const x = await t.api.raw('GET', `${P}/delays/summary/export?projectId=${t.pid}&format=${f}`, com); assert.equal(x.status, 200, f); if (f === 'csv') { const s = x.buffer.toString(); assert.match(s, /Masons short/); assert.match(s, /excusable 10, compensable 5, not excusable 5/); } }
  assert.equal((await t.api.raw('GET', `${P}/delays/summary/export?projectId=${t.pid}`, se)).status, 403);
  // what the claims read
  const cl = (await t.call(com, 'GET', `/delays/claims?projectId=${t.pid}`)).json.data; assert.deepEqual([cl.rows.length, cl.totals.excusableDays, cl.totals.compensableDays, cl.totals.nonExcusableDays], [3, 10, 5, 5]); assert.deepEqual(cl.rows[0].tia, { dataDate: '2026-04-06', completionBefore: '2026-04-16', completionAfter: '2026-04-21' });
  // the list, its export, scope; the one who prepares never approves
  assert.equal((await t.call(se, 'GET', '/delays?filter[status]=APPROVED')).json.data.length, 3); assert.equal((await t.call(other, 'GET', '/delays')).json.data.length, 0); assert.equal((await t.call(other, 'GET', `/delays/${c.id}`)).status, 404);
  for (const path of [`/delays/summary?projectId=${t.pid}`, `/delays/claims?projectId=${t.pid}`, `/delays/options?projectId=${t.pid}`]) assert.equal((await t.call(other, 'GET', path)).status, 404, path);
  assert.equal((await t.api.raw('GET', `${P}/delays/export?format=csv`, aud)).status, 200); assert.equal((await t.api.raw('GET', `${P}/delays/export?format=csv`, se)).status, 403);
  const own = (await t.call(both, 'POST', '/delays', delayBody(t, { title: 'Prepared by a planner who is a manager' }))).json.data; await t.call(both, 'POST', `/delays/${own.id}/evidence`, { entity: 'engg_letter', entityId: t.letter });
  const io = (await t.call(both, 'POST', `/delays/${own.id}/submit`)).json.data.workflowInstanceId; assert.equal(await t.hasTask(both, io), false, 'the maker is a project manager and gets no task'); assert.equal(await t.hasTask(pm, io), true);
  const op = (await t.call(plan1, 'GET', `/delays/options?projectId=${t.pid}`)).json.data; assert.deepEqual([op.schedule.id, op.activities.length, op.causes.length, op.responsibilities.length], [t.sid, 3, 8, 3]);
  // the flag
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plan.p1305'").run(); assert.equal((await t.call(plan1, 'GET', '/delays')).status, 404); publishEvent(t.d, { ...ev, entityId: 999, data: { ...ev.data, rfiId: 999 } }); drain();
  assert.equal((await t.call(plan1, 'GET', `/schedules/${t.sid}`)).status, 200); t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.plan.p1305'").run();
});
