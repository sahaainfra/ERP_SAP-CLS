import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { todayIST } from '../src/shared/dates.js';

// Part 14.01: work fronts, daily work plans and work authorisations ("no plan, no work").
// T-01 a WA on a superseded drawing is blocked in ENFORCE mode (and only warned in the default WARN mode). T-02 a material issue without a WA raises an exception; with a WA, within what it
// authorises, it passes. Also: the daily plan from the weekly plan and copied from the day before, issued into WAs; the chain (CM, then PM when outside the plan; the raiser never decides);
// the emergency WA and its regularisation; closure with the reconciliation and BR-03; BR-02; the board, the fronts and the mobile lists; roles, isolation, 409, idempotent replay and the flag.
const S = '/api/v1/site'; const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `wa-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const se = as('SE', 'wse1'); const se2 = as('SE', 'wse2'); const cm = as('CM', 'wcm1'); const cm2 = as('CM', 'wcm2'); const pm = as('PM', 'wpm1'); const sk = as('SK', 'wsk1'); const wsup = as('WSUP', 'wsup1'); const qce = as('QCE', 'wqce1'); const aud = as('AUD', 'waud1');
const plan1 = as('PLAN', 'wplan1'); const pcm = as('PCMGR', 'wpcm1'); const other = as('SE', 'wse9', '2');
const DAY = '2026-04-07'; // a Tuesday of the week of 6 April

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['wse1', ['SE']], ['wse2', ['SE']], ['wcm1', ['CM']], ['wcm2', ['CM']], ['wpm1', ['PM']], ['wsk1', ['SK']], ['wsup1', ['WSUP']], ['wqce1', ['QCE']], ['waud1', ['AUD']], ['wplan1', ['PLAN']], ['wpcm1', ['PCMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'WAT', 'Authorised Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const pid2 = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'WA2', 'Other Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'WAT-S1', 'Tower site', 'ACTIVE')").run(pid).lastInsertRowid);
  const site2 = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'WA2-S1', 'Other site', 'ACTIVE')").run(pid2).lastInsertRowid);
  const w = Number(d.prepare("INSERT INTO proj_wbs (company_id, project_id, code, name, level, created_by) VALUES (1, ?, '1', 'Substructure', 1, 't')").run(pid).lastInsertRowid);
  const loc = (code, name) => Number(d.prepare("INSERT INTO proj_locations (company_id, project_id, loc_type, code, name, created_by) VALUES (1, ?, 'ZONE', ?, ?, 't')").run(pid, code, name).lastInsertRowid);
  const zoneA = loc('ZA', 'Zone A'); const zoneB = loc('ZB', 'Zone B');
  const crew = Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'WAT-M1', 'Masons one', 'Mason')").run(site).lastInsertRowid);
  for (const p of [1, 2, 3]) d.prepare("INSERT INTO hr_crew_members (company_id, crew_id, person_type, person_id, from_date) VALUES (1, ?, 'WORKER', ?, '2026-01-01')").run(crew, p);
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, item_types_json, attribute_template_json, steward_role, category_status) VALUES (1, 'WA', 'WA test', 'WAT', '[]', '[]', 'EST', 'ACTIVE')").run().lastInsertRowid);
  const cement = Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, 'MAT-CEM', 'Cement', 'MATERIAL', ?, 'BAG', '2026-01-01', 'ACTIVE')").run(cat).lastInsertRowid);
  // drawing STR-201 with revision A (superseded) and B (for construction)
  const drawing = Number(d.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id) VALUES (1, ?, 'STR-201', 'Raft reinforcement', 'STRUCTURAL', ?)").run(pid, w).lastInsertRowid);
  const revA = Number(d.prepare("INSERT INTO engg_drawing_revisions (company_id, drawing_id, org_project_id, rev_seq, rev_label, status_code, rev_status) VALUES (1, ?, ?, 1, 'A', 'IFC', 'SUPERSEDED')").run(drawing, pid).lastInsertRowid);
  const revB = Number(d.prepare("INSERT INTO engg_drawing_revisions (company_id, drawing_id, org_project_id, rev_seq, rev_label, status_code, rev_status, supersedes_id) VALUES (1, ?, ?, 2, 'B', 'IFC', 'ISSUED', ?)").run(drawing, pid, revA).lastInsertRowid);
  d.prepare("UPDATE engg_drawings SET current_ifc_revision_id = ?, current_revision_id = ?, current_revision = 'B' WHERE id = ?").run(revB, revB, drawing);
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${path}`, { ...who, headers: k, body });
  const pcall = (who, method, path, body) => api.call(method, `${P}${path}`, { ...who, headers: key(), body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`); const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); return r; };
  // the schedule: A10 excavation (100 m3, zone A, 6-10 April), A20 raft (50 m3, zone B), A30
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); assert.equal(sch.status, 201, JSON.stringify(sch.json)); const sid = sch.json.data.id;
  assert.equal((await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 5 }, { code: 'A20', name: 'Raft concrete', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Columns', duration: 2, predecessors: 'A20' }] })).status, 201);
  await pcall(plan1, 'POST', `/schedules/${sid}/calculate`);
  const a = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sid).map((x) => [x.code, x.id]));
  d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3', location_id = ?, wbs_id = ? WHERE id = ?").run(zoneA, w, a.A10); d.prepare("UPDATE plan_activities SET qty = 50000, uom = 'm3', location_id = ?, wbs_id = ? WHERE id = ?").run(zoneB, w, a.A20);
  // the norm of A10: 200 bags of cement for the 100 m3 (2 a cubic metre)
  d.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, item_id, res_key, label, uom, basis, qty_total, qty_per_day) VALUES (1, ?, ?, 'MATERIAL', ?, ?, 'Cement', 'BAG', 'TOTAL', 200000, 40000)").run(sid, a.A10, cement, `item:${cement}`);
  // an approved weekly plan for the week of 6 April: A10 50 m3 with the masons (10 a day over its five working days)
  const wp = Number(d.prepare("INSERT INTO plan_weekly_plans (company_id, doc_no, doc_date, org_project_id, schedule_id, wp_site_id, week_start, status, items_count) VALUES (1, 'WP/T1', '2026-04-01', ?, ?, ?, '2026-04-06', 'APPROVED', 1)").run(pid, sid, site).lastInsertRowid);
  d.prepare("INSERT INTO plan_weekly_items (company_id, plan_id, activity_id, crew_id, committed_qty, uom) VALUES (1, ?, ?, ?, 50000, 'm3')").run(wp, a.A10, crew);
  return { api, d, call, act, taskOf, pid, pid2, site, site2, zoneA, zoneB, crew, cement, drawing, a, sid };
}
const waBody = (t, extra = {}) => ({ siteId: t.site, planDate: DAY, activityId: t.a.A10, plannedQty: 10, startTime: '08:00', endTime: '17:00', crews: [{ crewId: t.crew }], drawingId: t.drawing, ...extra });
const setMode = (t, code, mode) => { t.d.prepare('UPDATE pcs_control_points SET mode = ? WHERE company_id = 1 AND code = ?').run(mode, code); };

test('T-01 BR-01 a WA on a superseded drawing revision is blocked in ENFORCE mode; warned in WARN mode; the current IFC revision passes', async () => {
  const t = await boot();
  const ok = await t.call(se, 'POST', '/work-authorisations', waBody(t)); assert.equal(ok.status, 201, JSON.stringify(ok.json)); const w1 = ok.json.data;
  assert.deepEqual([w1.status, w1.drawingRevision, w1.inPlan, w1.plannedQty, w1.uom], ['DRAFT', 'B', true, 10, 'm3'], 'the current IFC revision by default; A10 is in the weekly plan of the day');
  assert.equal(w1.checks.find((c) => c.code === 'DRAWING').result, 'PASS'); assert.deepEqual(w1.resources.map((r) => [r.type, r.label, r.headcount, r.plannedQty, r.source]), [['LABOUR', 'WAT-M1 Masons one (Mason)', 3, 3, 'MANUAL'], ['MATERIAL', 'Cement', null, 20, 'NORM']]);
  const old = await t.call(se, 'POST', '/work-authorisations', waBody(t, { drawingRevision: 'A', plannedQty: 5 })); assert.equal(old.status, 201); const w2 = old.json.data;
  const chk = w2.checks.find((c) => c.code === 'DRAWING'); assert.equal(chk.result, 'FAIL'); assert.match(chk.message, /revision A is superseded; the current IFC revision is B/);
  // WARN (the default): it goes through with the warning written down
  const warned = await t.call(se, 'POST', `/work-authorisations/${w2.id}/submit`); assert.equal(warned.status, 202, JSON.stringify(warned.json)); assert.equal(warned.json.data.status, 'SUBMITTED');
  assert.equal(t.d.prepare("SELECT mode FROM pcs_control_points WHERE company_id = 1 AND code = 'CP-SITE-01'").get().mode, 'WARN');
  assert.equal(t.d.prepare("SELECT result FROM pcs_check_results WHERE control_code = 'CP-SITE-01' AND entity_id = ? ORDER BY id DESC").get(String(w2.id))?.result, 'WARN');
  // ENFORCE: a WA on the superseded revision is not sent, and one that was sent is not approved
  setMode(t, 'CP-SITE-01', 'ENFORCE');
  const w3 = (await t.call(se, 'POST', '/work-authorisations', waBody(t, { drawingRevision: 'A', plannedQty: 5 }))).json.data; const blocked = await t.call(se, 'POST', `/work-authorisations/${w3.id}/submit`);
  assert.equal(blocked.status, 422); assert.equal(blocked.json.error.code, 'CONTROL_BLOCKED'); assert.match(blocked.json.error.message, /revision A is superseded/); assert.equal((await t.call(se, 'GET', `/work-authorisations/${w3.id}`)).json.data.status, 'DRAFT');
  const no = await t.act(cm, warned.json.data.workflowInstanceId); assert.equal(no.status, 422, JSON.stringify(no.json)); assert.equal(no.json.error.code, 'CONTROL_BLOCKED'); assert.equal((await t.call(se, 'GET', `/work-authorisations/${w2.id}`)).json.data.status, 'SUBMITTED', 'the decision is undone');
  // corrected to the current revision: sent and approved
  assert.equal((await t.call(se, 'PATCH', `/work-authorisations/${w3.id}`, { drawingRevision: 'B' })).json.data.checks.find((c) => c.code === 'DRAWING').result, 'PASS');
  const sent = await t.call(se, 'POST', `/work-authorisations/${w3.id}/submit`); assert.equal(sent.status, 202); assert.equal((await t.act(cm, sent.json.data.workflowInstanceId)).status, 200);
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${w3.id}`)).json.data.status, 'APPROVED');
  // the permit: needed and not named is a failure of the same control
  const w4 = (await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 2, permitRequired: true }))).json.data; assert.equal(w4.checks.find((c) => c.code === 'PERMIT').result, 'FAIL');
  assert.equal((await t.call(se, 'POST', `/work-authorisations/${w4.id}/submit`)).status, 422); assert.equal((await t.call(se, 'PATCH', `/work-authorisations/${w4.id}`, { permitRef: 'PTW-HOT-11' })).json.data.checks.find((c) => c.code === 'PERMIT').result, 'PASS');
});

test('T-02 FR-07 a material issue without a WA raises an exception; with a WA within what it authorises it passes; beyond it, again an exception', async () => {
  const t = await boot();
  const w = (await t.call(se, 'POST', '/work-authorisations', waBody(t))).json.data; const sent = await t.call(se, 'POST', `/work-authorisations/${w.id}/submit`); await t.act(cm, sent.json.data.workflowInstanceId);
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${w.id}`)).json.data.status, 'APPROVED');
  const issue = (extra) => ({ projectId: t.pid, kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', itemId: t.cement, qty: 12, uom: 'BAG', date: DAY, ...extra });
  const none = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-001' })); assert.equal(none.status, 422, JSON.stringify(none.json)); assert.equal(none.json.error.code, 'EXCEPTION_REQUIRED'); assert.match(none.json.error.message, /names no work authorisation\. \(control CP-SITE-02\)/);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM site_wa_uses").get().n, 0, 'nothing kept');
  const ok = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-002', waId: w.id })); assert.equal(ok.status, 201, JSON.stringify(ok.json)); assert.deepEqual([ok.json.data.result, ok.json.data.qty, ok.json.data.replay], ['PASS', 12, false]);
  assert.equal((await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-002', waId: w.id }))).json.data.replay, true, 'the same issue is booked once');
  const after1 = (await t.call(se, 'GET', `/work-authorisations/${w.id}`)).json.data; assert.equal(after1.resources.find((r) => r.type === 'MATERIAL').actualQty, 12); assert.equal(after1.uses.length, 1);
  // 12 + 10 = 22 bags is beyond the 20 authorised with 5 % tolerance (21)
  const over = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-003', waId: w.id, qty: 10 })); assert.equal(over.status, 422); assert.match(over.json.error.message, /22 BAG of Cement is beyond the 20 authorised/);
  // an approved exception lets that very issue through and is used up
  const ctl = t.d.prepare("SELECT id FROM pcs_control_points WHERE company_id = 1 AND code = 'CP-SITE-02'").get().id;
  t.d.prepare("INSERT INTO pcs_exceptions (company_id, exception_no, control_id, control_code, entity, entity_id, reason_code, justification, status, decided_at, raised_by, created_by) VALUES (1, 'EX/T1', ?, 'CP-SITE-02', 'site_wa_use', ?, 'OTHER', 'Wastage in the pour', 'APPROVED', ?, 'wsk1', 'wsk1')").run(ctl, `MATERIAL_ISSUE:inv_issue:MI-003:item:${t.cement}`, new Date().toISOString());
  const ex = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-003', waId: w.id, qty: 10 })); assert.equal(ex.status, 201, JSON.stringify(ex.json)); assert.deepEqual([ex.json.data.result, ex.json.data.exceptionNo], ['EXCEPTED', 'EX/T1']);
  // in WARN mode the deviation is recorded and goes through
  setMode(t, 'CP-SITE-02', 'WARN'); const wn = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-004' })); assert.equal(wn.status, 201); assert.equal(wn.json.data.result, 'WARN');
  setMode(t, 'CP-SITE-02', 'ENFORCE');
  // attendance by trade and the DPR against the WA; another project's WA is refused; a WA not live is a deviation
  assert.equal((await t.call(se, 'POST', '/wa-uses', { projectId: t.pid, waId: w.id, kind: 'ATTENDANCE', srcEntity: 'att_punch', srcId: 'P-1', trade: 'Mason', qty: 3, date: DAY })).json.data.result, 'PASS');
  assert.equal((await t.call(se, 'POST', '/wa-uses', { projectId: t.pid, waId: w.id, kind: 'DPR', srcEntity: 'site_dpr', srcId: 'DPR-1', qty: 9.5, date: DAY })).json.data.result, 'PASS');
  assert.equal((await t.call(se, 'POST', '/wa-uses', { projectId: t.pid2, waId: w.id, kind: 'DPR', srcEntity: 'site_dpr', srcId: 'DPR-X', qty: 1 })).status, 400);
  const draft = (await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 1 }))).json.data; const nl = await t.call(sk, 'POST', '/wa-uses', issue({ srcId: 'MI-005', waId: draft.id, qty: 1 })); assert.equal(nl.status, 422); assert.match(nl.json.error.message, /is draft: work is booked only against an approved WA/);
  for (const who of [wsup, qce, aud]) assert.equal((await t.call(who, 'POST', '/wa-uses', issue({ srcId: 'MI-9', waId: w.id }))).status, 403, who.roles); assert.equal((await t.call(other, 'POST', '/wa-uses', issue({ srcId: 'MI-9', waId: w.id }))).status, 404);
  // the WAs live on the site for the day, for attendance, stores and plant
  const live = (await t.call(sk, 'GET', `/work-authorisations/active?siteId=${t.site}&date=${DAY}`)).json.data; assert.deepEqual(live.map((x) => x.waNo), [w.waNo]); assert.equal(live[0].resources.length, 2);
  const ev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.wa.approved'").get().payload).data; assert.deepEqual([ev.waId, ev.plannedQty, ev.resources.map((r) => r.type)], [w.id, 10, ['LABOUR', 'MATERIAL']]);
});

test('FR-02 FR-04 the daily plan from the weekly plan and from the day before, issued into WAs; the chain; closure with the reconciliation (BR-03); BR-02', async () => {
  const t = await boot();
  // the work fronts of the site: zone A open, zone B; a code once per site
  assert.equal((await t.call(cm, 'POST', '/work-fronts', { siteId: t.site, code: 'FA', name: 'Zone A pit', locationId: t.zoneA })).status, 201); const fb = (await t.call(cm, 'POST', '/work-fronts', { siteId: t.site, code: 'FB', name: 'Zone B raft', locationId: t.zoneB })).json.data;
  assert.equal((await t.call(cm, 'POST', '/work-fronts', { siteId: t.site, code: 'FA', name: 'Again' })).status, 400); assert.equal((await t.call(wsup, 'POST', '/work-fronts', { siteId: t.site, code: 'FC', name: 'Zone C' })).status, 403);
  const fl = (await t.call(wsup, 'GET', `/work-fronts?siteId=${t.site}`)).json.data; assert.deepEqual(fl.fronts.map((f) => [f.code, f.status, f.activities.map((x) => x.code)]), [['FA', 'OPEN', ['A10']], ['FB', 'OPEN', ['A20']]]);
  t.d.prepare("INSERT INTO plan_constraints (company_id, org_project_id, schedule_id, activity_id, ctype, description, origin, status) VALUES (1, ?, ?, ?, 'MATERIAL', 'Rebar not received', 'MANUAL', 'OPEN')").run(t.pid, t.sid, t.a.A20);
  assert.deepEqual((await t.call(se, 'GET', `/work-fronts?siteId=${t.site}`)).json.data.fronts.find((f) => f.code === 'FB').constraintsSummary, '1 open: MATERIAL 1');
  // the daily plan from the approved weekly plan: A10 10 m3 with the masons on the front of zone A
  assert.equal((await t.call(wsup, 'POST', '/daily-plans', { siteId: t.site, planDate: DAY })).status, 403);
  const k = key(); const dp = await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: DAY, from: 'WEEKLY' }, k); assert.equal(dp.status, 201, JSON.stringify(dp.json)); const p = dp.json.data;
  assert.deepEqual(p.lines.map((l) => [l.activity, l.plannedQty, l.crewId, l.workFront, l.fromWeekly]), [['A10 Excavation', 10, t.crew, 'FA Zone A pit', true]]); assert.equal((await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: DAY, from: 'WEEKLY' }, k)).json.data.id, p.id, 'idempotent replay');
  assert.equal((await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: DAY, from: 'EMPTY' })).status, 409, 'one plan a day for a supervisor');
  assert.equal((await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: '2026-04-20', from: 'WEEKLY' })).status, 422, 'no weekly plan that day');
  // the supervisor adds A20 by hand; BR-02 holds at issue: 60 of A20 is more than the 50 that remain (+5 %)
  const up = await t.call(se, 'PATCH', `/daily-plans/${p.id}`, { lines: [{ activityId: t.a.A10, crewId: t.crew, plannedQty: 10 }, { activityId: t.a.A20, plannedQty: 60 }], rowVersion: p.rowVersion }); assert.equal(up.status, 200, JSON.stringify(up.json));
  assert.equal((await t.call(se, 'PATCH', `/daily-plans/${p.id}`, { note: 'stale', rowVersion: p.rowVersion })).status, 409);
  const big = await t.call(se, 'POST', `/daily-plans/${p.id}/issue`, { startTime: '08:00', endTime: '17:00' }); assert.equal(big.status, 400); assert.equal(big.json.error.details[0].field, 'lines.1.plannedQty'); assert.match(big.json.error.details[0].message, /At most 52.5 m3/);
  assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM site_work_authorisations').get().n, 0, 'nothing raised');
  await t.call(se, 'PATCH', `/daily-plans/${p.id}`, { lines: [{ activityId: t.a.A10, crewId: t.crew, plannedQty: 10 }, { activityId: t.a.A20, crewId: t.crew, plannedQty: 5 }] });
  const iss = await t.call(se, 'POST', `/daily-plans/${p.id}/issue`, { startTime: '07:30', endTime: '16:00' }); assert.equal(iss.status, 200, JSON.stringify(iss.json)); assert.equal(iss.json.data.status, 'ISSUED');
  const [l1, l2] = iss.json.data.lines; assert.ok(l1.waNo && l2.waNo); const wa1 = (await t.call(se, 'GET', `/work-authorisations/${l1.waId}`)).json.data; const wa2 = (await t.call(se, 'GET', `/work-authorisations/${l2.waId}`)).json.data;
  assert.deepEqual([wa1.inPlan, wa1.startTime, wa1.workFront, wa1.dailyPlanId], [true, '07:30', 'FA Zone A pit', p.id]); assert.deepEqual([wa2.inPlan, wa2.workFront], [false, 'FB Zone B raft'], 'A20 is not in the weekly plan of the day');
  assert.equal((await t.call(se, 'PATCH', `/daily-plans/${p.id}`, { note: 'after' })).status, 409);
  // the chain: in the plan, the construction manager; outside it, then the project manager. The raiser never decides; another CM does.
  assert.equal((await t.call(se2, 'POST', `/work-authorisations/${wa1.id}/submit`)).status, 403, 'only the one who raised it sends it');
  const s1r = await t.call(se, 'POST', `/work-authorisations/${wa1.id}/submit`); assert.equal(s1r.status, 202, JSON.stringify(s1r.json)); const s1 = s1r.json.data; const s2 = (await t.call(se, 'POST', `/work-authorisations/${wa2.id}/submit`)).json.data;
  assert.equal(await t.taskOf(se, s1.workflowInstanceId), undefined); assert.equal((await t.act(cm2, s1.workflowInstanceId)).status, 200);
  // a CM who raises a WA never approves it: another CM does
  const own = (await t.call(cm, 'POST', '/work-authorisations', waBody(t, { plannedQty: 1 }))).json.data; const so = (await t.call(cm, 'POST', `/work-authorisations/${own.id}/submit`)).json.data;
  assert.equal(await t.taskOf(cm, so.workflowInstanceId), undefined, 'the CM who sent it holds no task'); assert.equal((await t.act(cm2, so.workflowInstanceId)).status, 200); assert.equal((await t.call(cm, 'GET', `/work-authorisations/${own.id}`)).json.data.status, 'APPROVED');
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${wa1.id}`)).json.data.status, 'APPROVED', 'in the plan: the CM alone');
  assert.equal((await t.act(cm, s2.workflowInstanceId)).status, 200); assert.equal((await t.call(se, 'GET', `/work-authorisations/${wa2.id}`)).json.data.status, 'SUBMITTED'); assert.ok(await t.taskOf(pm, s2.workflowInstanceId), 'outside the plan: then the PM');
  // the mobile lists: what waits for the PM, what the SE can close
  const mob = (await t.call(pm, 'GET', `/wa-mobile?date=${DAY}`)).json.data; assert.deepEqual(mob.toApprove.map((x) => x.waNo), [wa2.waNo]); assert.ok(mob.toApprove[0].taskId);
  assert.equal((await t.act(pm, s2.workflowInstanceId, 'reject')).status, 200); assert.equal((await t.call(se, 'GET', `/work-authorisations/${wa2.id}`)).json.data.status, 'REJECTED');
  assert.deepEqual((await t.call(se, 'GET', `/wa-mobile?date=${DAY}`)).json.data.toClose.map((x) => x.waNo), [wa1.waNo, own.waNo]);
  // approved: locked; closed with the DPR quantity; cement used beyond 10 % needs the reason (BR-03)
  assert.equal((await t.call(se, 'PATCH', `/work-authorisations/${wa1.id}`, { plannedQty: 8 })).status, 409);
  await t.call(se, 'POST', '/wa-uses', { projectId: t.pid, waId: wa1.id, kind: 'DPR', srcEntity: 'site_dpr', srcId: 'DPR-7', qty: 9, date: DAY });
  const cem = wa1.resources.find((r) => r.type === 'MATERIAL'); assert.equal(cem.plannedQty, 20);
  assert.equal((await t.call(wsup, 'POST', `/work-authorisations/${wa1.id}/close`, {})).status, 403);
  const nr = await t.call(se, 'POST', `/work-authorisations/${wa1.id}/close`, { resources: [{ id: cem.id, actualQty: 24 }] }); assert.equal(nr.status, 400); assert.equal(nr.json.error.details[0].field, 'varianceReason');
  const cl = await t.call(se, 'POST', `/work-authorisations/${wa1.id}/close`, { resources: [{ id: cem.id, actualQty: 24 }], varianceReason: 'Over-excavation filled with PCC', closureNotes: 'Pit ready' }); assert.equal(cl.status, 200, JSON.stringify(cl.json));
  const c = cl.json.data; assert.deepEqual([c.status, c.actualQty, c.resources.find((r) => r.type === 'MATERIAL').variancePct, c.resources.find((r) => r.type === 'MATERIAL').beyond], ['CLOSED', 9, 20, true]);
  const ce = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'site.wa.closed'").get().payload).data; assert.deepEqual([ce.plannedQty, ce.actualQty, ce.resources.find((r) => r.type === 'MATERIAL').actual], [10, 9, 24]);
  // BR-02 after the closure: 100 − 9 done − 1 open (the CM's WA) = 90 remain on A10, 94.5 with the tolerance
  const br2 = await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 95 })); assert.equal(br2.status, 400); assert.match(br2.json.error.details[0].message, /At most 94.5 m3 .* 90 remains of A10/); assert.equal((await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 94 }))).status, 201);
  // the next day: the plan copied from the day before (A10 still open; A20's line came too)
  const cp = await t.call(se, 'POST', '/daily-plans', { siteId: t.site, planDate: '2026-04-08', from: 'YESTERDAY' }); assert.equal(cp.status, 201, JSON.stringify(cp.json)); assert.deepEqual([cp.json.data.copiedFromId, cp.json.data.lines.length], [p.id, 2]);
  // the board of the day: lanes by front, a draft moves to another front of the site (and back)
  const bd = (await t.call(wsup, 'GET', `/board?siteId=${t.site}&date=${DAY}`)).json.data; assert.deepEqual(bd.lanes.map((l) => [l.code, l.was.length]), [['FA', 3], ['FB', 1]], 'a WA goes to the front of its activity\'s location by default'); assert.equal(bd.unassigned.length, 0); assert.equal(bd.totals.closed, 1);
  const dr = bd.lanes[0].was.find((x) => x.status === 'DRAFT'); assert.equal((await t.call(se, 'POST', `/work-authorisations/${dr.id}/move`, { workFrontId: fb.id })).json.data.workFrontId, fb.id);
  assert.equal((await t.call(se, 'POST', `/work-authorisations/${wa1.id}/move`, { workFrontId: fb.id })).status, 409, 'a closed WA does not move'); assert.equal((await t.call(wsup, 'POST', `/work-authorisations/${dr.id}/move`, { workFrontId: null })).status, 403);
});

test('FR-05 the emergency WA is usable at once and regularised through the CM and the PM; roles, isolation, 409, the flag, list, export and print', async () => {
  const t = await boot(); const today = todayIST();
  assert.equal((await t.call(se, 'POST', '/work-authorisations', waBody(t, { planDate: today, emergency: true }))).status, 400, 'a reason is needed');
  assert.equal((await t.call(se, 'POST', '/work-authorisations', waBody(t, { planDate: '2026-04-08', emergency: true, emergencyReason: 'Pump failure flooded the pit' }))).status, 400, 'for today only');
  const em = await t.call(se, 'POST', '/work-authorisations', waBody(t, { planDate: today, emergency: true, emergencyReason: 'Pump failure flooded the pit', plannedQty: 2 })); assert.equal(em.status, 201, JSON.stringify(em.json)); const e = em.json.data;
  assert.deepEqual([e.status, e.emergency, e.overdue, Boolean(e.regulariseBy)], ['EMERGENCY', true, false, true]); assert.ok(Date.parse(e.regulariseBy) - Date.now() > 23 * 3600_000);
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'site.wa.approved'").get().n, 1, 'usable at once: the consumers hear of it');
  assert.equal((await t.call(sk, 'POST', '/wa-uses', { projectId: t.pid, waId: e.id, kind: 'MATERIAL_ISSUE', srcEntity: 'inv_issue', srcId: 'EM-1', itemId: t.cement, qty: 2, date: today })).json.data.result, 'PASS');
  const rg = await t.call(se, 'POST', `/work-authorisations/${e.id}/submit`); assert.equal(rg.status, 202, JSON.stringify(rg.json)); assert.equal(rg.json.data.status, 'EMERGENCY', 'still usable while it is regularised');
  await t.act(cm, rg.json.data.workflowInstanceId); assert.ok(await t.taskOf(pm, rg.json.data.workflowInstanceId)); await t.act(pm, rg.json.data.workflowInstanceId);
  const done = (await t.call(se, 'GET', `/work-authorisations/${e.id}`)).json.data; assert.deepEqual([done.status, Boolean(done.regularisedAt)], ['APPROVED', true]); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'site.wa.approved'").get().n, 1, 'not announced twice');
  t.d.prepare('UPDATE site_work_authorisations SET regularise_by = ? WHERE id = ?').run('2026-01-01T00:00:00.000Z', e.id);
  // roles: the work supervisor and quality see, do not raise; the PM approves, does not raise; another company sees nothing
  for (const who of [wsup, qce, pm, sk, aud]) assert.equal((await t.call(who, 'POST', '/work-authorisations', waBody(t))).status, 403, who.roles);
  assert.equal((await t.call(other, 'POST', '/work-authorisations', waBody(t))).status, 404); assert.equal((await t.call(other, 'GET', `/work-authorisations/${e.id}`)).status, 404);
  assert.equal((await t.call(qce, 'GET', `/work-authorisations/${e.id}`)).json.data.checks.length, 5, 'quality sees the checks');
  assert.equal((await t.call(se, 'POST', '/work-authorisations', waBody(t, { siteId: t.site2 }))).status, 400, 'an activity of another project');
  assert.equal((await t.api.call('POST', `${S}/work-authorisations`, { ...se, headers: { 'content-type': 'application/json' }, body: waBody(t) })).status, 400, 'an Idempotency-Key is required');
  // the draft: a stale version is refused; withdraw by the sender only; cancel; delete a draft
  const w = (await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 3 }))).json.data; assert.equal((await t.call(se, 'PATCH', `/work-authorisations/${w.id}`, { plannedQty: 4, rowVersion: w.rowVersion + 5 })).status, 409);
  const sb = (await t.call(se, 'POST', `/work-authorisations/${w.id}/submit`)).json.data; assert.equal((await t.call(se2, 'POST', `/work-authorisations/${w.id}/withdraw`, { reason: 'Not mine to withdraw' })).status, 403);
  assert.deepEqual([(await t.call(se, 'POST', `/work-authorisations/${w.id}/withdraw`, { reason: 'Sent too early' })).json.data.status], ['DRAFT']); assert.notEqual(sb.workflowInstanceId, null);
  assert.equal((await t.call(se, 'POST', `/work-authorisations/${w.id}/cancel`, { reason: 'Raised twice' })).json.data.status, 'CANCELLED');
  const w5 = (await t.call(se, 'POST', '/work-authorisations', waBody(t, { plannedQty: 1 }))).json.data; assert.equal((await t.call(se, 'DELETE', `/work-authorisations/${w5.id}`)).status, 200);
  // a revision of an approved WA replaces it when approved
  const rv = await t.call(se, 'POST', `/work-authorisations/${e.id}/amend`, { reason: 'Two more hours of pumping' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); const r2 = rv.json.data; assert.deepEqual([r2.revisionNo, r2.parentWaId, r2.status], [2, e.id, 'DRAFT']);
  await t.call(se, 'PATCH', `/work-authorisations/${r2.id}`, { endTime: '19:00' }); const i2 = (await t.call(se, 'POST', `/work-authorisations/${r2.id}/submit`)).json.data.workflowInstanceId; await t.act(cm, i2); if (await t.taskOf(pm, i2)) await t.act(pm, i2);
  assert.equal((await t.call(se, 'GET', `/work-authorisations/${e.id}`)).json.data.status, 'SUPERSEDED'); assert.equal((await t.call(se, 'GET', `/work-authorisations/${r2.id}`)).json.data.uses.length, 1, 'the uses follow the revision');
  // the list, export and print; history
  const ls = await t.api.call('GET', `${S}/work-authorisations?pageSize=50`, se); assert.equal(ls.status, 200); assert.ok(ls.json.data.length >= 3); assert.equal((await t.api.call('GET', `${S}/work-authorisations`, other)).json.data.length, 0);
  assert.equal((await t.api.raw('GET', `${S}/work-authorisations/export?format=csv`, se)).status, 200); assert.equal((await t.api.raw('GET', `${S}/work-authorisations/export?format=csv`, wsup)).status, 403);
  const pr = await t.api.raw('GET', `${S}/work-authorisations/${r2.id}/print`, se); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /Work authorisation WA/); assert.equal((await t.api.raw('GET', `${S}/work-authorisations/${r2.id}/print`, wsup)).status, 403);
  assert.ok((await t.call(se, 'GET', `/work-authorisations/${r2.id}/history`)).json.data.approvals.length >= 2);
  // the flag off: the API is not there
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1401'").run(); assert.equal((await t.call(se, 'GET', `/board?siteId=${t.site}`)).status, 404);
});
