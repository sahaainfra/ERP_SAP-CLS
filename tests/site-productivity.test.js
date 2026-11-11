import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 14.06: productivity tracking and analysis.
// T-01 productivity is computed correctly for a crew with shared activities: the crew's man-days are shared by the planned man-days of each work authorisation.
//   Worked example: the masons reported 10 man-days; WA 1 (12 m3) plans 6 man-days, WA 2 (4 m3) plans 4: 6 and 4 man-days; 2 m3 and 1 m3 per man-day; against the norms of 1.5 and 1.25 m3 per man-day: +33.33 % and -20 %.
const S = '/api/v1/site/productivity'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `prd-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'hplan1'); const pcm = as('PCMGR', 'hpcm1'); const pm = as('PM', 'hpm1'); const cm = as('CM', 'hcm1'); const se = as('SE', 'hse1'); const se2 = as('SE', 'hse2'); const qs = as('QS', 'hqs1'); const sk = as('SK', 'hsk1'); const aud = as('AUD', 'haud1'); const other = as('PCMGR', 'hpcm9', '2'); const otherSe = as('SE', 'hse9', '2');
const day = (n) => isoOf(ordOf(todayIST()) - n); const TODAY = todayIST();

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['hplan1', ['PLAN']], ['hpcm1', ['PCMGR']], ['hpm1', ['PM']], ['hcm1', ['CM']], ['hse1', ['SE']], ['hse2', ['SE']], ['hqs1', ['QS']], ['hsk1', ['SK']], ['haud1', ['AUD']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const mkProject = (code) => { const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(code, `${code} Tower`).lastInsertRowid); const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, 'Site', 'ACTIVE')").run(pid, `${code}-S1`).lastInsertRowid); return { pid, site }; };
  const P1 = mkProject('PRO1'); const P2 = mkProject('PRO2');
  const crew = Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'PRO-M1', 'Masons one', 'Mason')").run(P1.site).lastInsertRowid);
  const contractor = Number(d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, name_key, constitution, partner_status, steward_role, created_by, source_type) VALUES (1, 'ACE', 'Ace Labour', 'ace labour', 'PRIVATE_LIMITED', 'ACTIVE', 'COMMGR', 't', 'test')").run().lastInsertRowid);
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const act = {}; const wbsOf = {};
  for (const P of [P1, P2]) {
    const sch = await pcall(plan1, 'POST', '/schedules', { projectId: P.pid, name: 'Schedule', calendarId: cal.json.data.id, startDate: '2026-04-06' }); const sid = sch.json.data.id;
    assert.equal((await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Brickwork', duration: 10 }, { code: 'A20', name: 'Plaster', duration: 10 }] })).status, 201);
    d.prepare("UPDATE plan_activities SET qty = 100000, uom = 'm3' WHERE schedule_id = ?").run(sid); d.prepare("UPDATE plan_schedules SET status = 'APPROVED' WHERE id = ?").run(sid);
    act[P.pid] = Object.fromEntries(d.prepare('SELECT id, code FROM plan_activities WHERE schedule_id = ?').all(sid).map((x) => [x.code, x.id])); wbsOf[P.pid] = sid;
  }
  let n = 0; let dprSeq = 0; const was = {};
  /** An approved work authorisation with its crews and plant (the stub rows the DPR consumer reads). */
  const wa = (P, code, planned, { crewMd = 0, plant = null } = {}) => { n += 1; const id = Number(d.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, planned_qty, start_time, end_time, supervisor, status, created_by) VALUES (1, ?, ?, ?, ?, ?, ?, '08:00', '17:00', 'x', 'APPROVED', 't')").run(`WA/${n}`, P.pid, P.site, TODAY, act[P.pid][code], planned * 1000).lastInsertRowid);
    if (crewMd) d.prepare("INSERT INTO site_wa_resources (company_id, wa_id, resource_type, trade, crew_id, res_key, label, uom, headcount, planned_qty) VALUES (1, ?, 'LABOUR', 'Mason', ?, 'trade:mason', 'Masons', 'man-day', ?, ?)").run(id, crew, crewMd, crewMd * 1000);
    if (plant) d.prepare("INSERT INTO site_wa_resources (company_id, wa_id, resource_type, trade, res_key, label, uom, planned_qty) VALUES (1, ?, 'PLANT', 'Mixer', ?, 'Mixer', 'hour', 8000)").run(id, `plant:${plant}`); was[`${P.pid}:${n}`] = id; return id; };
  const drain = () => runtimeOf(api.db).bus.drain();
  /** The event of an approved DPR; a stub report row stands behind it (the foreign key). */
  const dpr = (P, { date = TODAY, work, labour = [{ category: 'CONTRACT', contractorId: contractor, trade: 'Mason', headcount: 10, manDays: 10 }], equipment = [], scope = 'SITE', supersedes = null, dprId = null, weather = null }) => {
    const id = dprId ?? (800000 + (dprSeq += 1)); if (!d.prepare('SELECT 1 FROM site_dprs WHERE id = ?').get(id)) d.prepare("INSERT INTO site_dprs (id, company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (?, 1, ?, ?, ?, ?, 'x', ?, 'SUPERSEDED', 'x', ?, ?, 't')").run(id, `DPR/${id}`, P.pid, P.site, date, scope, P.pid, P.site);
    publishEvent(d, { type: 'site.dpr.approved', entity: 'site_dpr', entityId: id, actorId: 'cm', companyId: 1, projectId: P.pid, siteId: P.site, data: { dprId: id, docNo: `DPR/${id}`, projectId: P.pid, siteId: P.site, date, scope, supersedes, weather, work: work.map(([waId, code, qty]) => ({ waId, activityId: act[P.pid][code], qty, uom: 'm3' })), labour, equipment } }); drain(); return id; };
  const call = (who, method, path, body, k = key()) => api.call(method, `${S}${path}`, { ...who, headers: k, body });
  const taskOf = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId);
  const act2 = async (who, instanceId, action = 'approve') => { const task = await taskOf(who, instanceId); assert.ok(task, `${who.user} has the task`); return api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); };
  /** A norm entered, sent and approved (maker plan1, checker pm). */
  const norm = async (P, code, out, { resource = 'LABOUR', from = day(30) } = {}) => { const c = await call(plan1, 'POST', '/norms', { projectId: P.pid, activityCode: code, resourceType: resource, outputPerUnit: out, effectiveFrom: from }); assert.equal(c.status, 201, JSON.stringify(c.json)); const s = await call(plan1, 'POST', `/norms/${c.json.data.id}/submit`); assert.equal(s.status, 202, JSON.stringify(s.json)); assert.equal((await act2(pm, s.json.data.workflowInstanceId)).status, 200); return c.json.data.id; };
  return { api, d, call, drain, dpr, wa, norm, taskOf, act: act2, P1, P2, crew, contractor, actId: act, sid: wbsOf };
}

test('T-01 FR-02 BR-01 the crew\'s man-days are shared by the planned man-days of each work authorisation; the quantity over them is the productivity, against the norm', async () => {
  const t = await boot(); await t.norm(t.P1, 'A10', 1.5); await t.norm(t.P1, 'A20', 1.25);
  const w1 = t.wa(t.P1, 'A10', 12, { crewMd: 6 }); const w2 = t.wa(t.P1, 'A20', 4, { crewMd: 4 });
  const id = t.dpr(t.P1, { work: [[w1, 'A10', 12], [w2, 'A20', 4]] });
  const rows = t.d.prepare('SELECT * FROM prod_actuals WHERE dpr_id = ? ORDER BY activity_code').all(id); assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.activity_code, r.qty, r.man_days, r.alloc_basis, r.productivity, r.norm_labour, r.variance_pct, r.crew_id, r.contractor_id, r.outlier]), [['A10', 12000, 6000, 'WA', 2000, 1500, 3333, t.crew, t.contractor, 0], ['A20', 4000, 4000, 'WA', 1000, 1250, -2000, t.crew, t.contractor, 0]]);
  assert.equal(rows.reduce((n, r) => n + r.man_days, 0), 10000, 'the man-days reported are all allocated, none twice'); assert.deepEqual(rows.map((r) => r.shortfall_md), [0, 800], 'A20 needed 3.2 man-days and used 4: 0.8 lost');
  // without work authorisations' crews the norm asks for the man-days; with no norm either, the quantity does
  const w3 = t.wa(t.P1, 'A10', 6); const w4 = t.wa(t.P1, 'A20', 2); const id2 = t.dpr(t.P1, { date: day(1), work: [[w3, 'A10', 6], [w4, 'A20', 2]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 3, manDays: 3 }] });
  const r2 = t.d.prepare('SELECT activity_code, man_days, alloc_basis, contractor_id FROM prod_actuals WHERE dpr_id = ? ORDER BY activity_code').all(id2); assert.deepEqual(r2.map((r) => [r.activity_code, r.alloc_basis, r.contractor_id]), [['A10', 'NORM', null], ['A20', 'NORM', null]]); assert.equal(r2.reduce((n, r) => n + r.man_days, 0), 3000);
  const r2b = r2.map((r) => r.man_days); assert.ok(Math.abs(r2b[0] / r2b[1] - (6 / 1.5) / (2 / 1.25)) < 0.01, 'shared by the man-days the norms ask for (4 : 1.6)');
  const w5 = t.wa(t.P2, 'A10', 10); const id3 = t.dpr(t.P2, { work: [[w5, 'A10', 10]], labour: [{ category: 'STAFF', trade: 'x', headcount: 5, manDays: 5 }] }); assert.deepEqual({ ...t.d.prepare('SELECT alloc_basis, norm_labour, variance_pct, productivity FROM prod_actuals WHERE dpr_id = ?').get(id3) }, { alloc_basis: 'QTY', norm_labour: null, variance_pct: null, productivity: 2000 }, 'no norm: productivity, no variance');
  // the machine-hours go to the work authorisations that name the plant
  const w6 = t.wa(t.P1, 'A10', 5, { crewMd: 2, plant: 'mixer' }); const w7 = t.wa(t.P1, 'A20', 5, { crewMd: 2 }); const id4 = t.dpr(t.P1, { date: day(2), work: [[w6, 'A10', 5], [w7, 'A20', 5]], equipment: [{ key: 'plant:mixer', label: 'Mixer', hoursWorked: 6 }] });
  assert.deepEqual(t.d.prepare('SELECT activity_code, machine_hours, productivity_machine FROM prod_actuals WHERE dpr_id = ? ORDER BY activity_code').all(id4).map((r) => [r.activity_code, r.machine_hours, r.productivity_machine]), [['A10', 6000, 833], ['A20', 0, null]]);
  // a replay changes nothing; an amendment replaces the rows of the report it amends; a site report replaces the supervisors' reports of its day
  t.dpr(t.P1, { work: [[w1, 'A10', 12], [w2, 'A20', 4]], dprId: id }); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM prod_actuals WHERE dpr_id = ? AND deleted_at IS NULL').get(id).n, 2);
  const am = t.dpr(t.P1, { work: [[w1, 'A10', 14], [w2, 'A20', 4]], supersedes: id }); assert.deepEqual([t.d.prepare('SELECT COUNT(*) AS n FROM prod_actuals WHERE dpr_id = ? AND deleted_at IS NULL').get(id).n, t.d.prepare('SELECT qty FROM prod_actuals WHERE dpr_id = ? AND activity_code = ?').get(am, 'A10').qty], [0, 14000]);
  const sup = t.dpr(t.P1, { date: day(3), work: [[w1, 'A10', 5]], scope: 'SUPERVISOR' }); t.dpr(t.P1, { date: day(3), work: [[w1, 'A10', 8]], scope: 'SITE' }); assert.equal(t.d.prepare('SELECT COUNT(*) AS n FROM prod_actuals WHERE dpr_id = ? AND deleted_at IS NULL').get(sup).n, 0); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM prod_actuals WHERE work_date = ? AND deleted_at IS NULL").get(day(3)).n, 1);
  t.drain(); assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'site.productivity.updated'").get());
});

test('BR-01 an output more than three times its norm is flagged for a data check and left out of the figures', async () => {
  const t = await boot(); await t.norm(t.P1, 'A10', 1.5); const w = t.wa(t.P1, 'A10', 60, { crewMd: 4 });
  const bad = t.dpr(t.P1, { work: [[w, 'A10', 60]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 4, manDays: 4 }] }); const r = t.d.prepare('SELECT * FROM prod_actuals WHERE dpr_id = ?').get(bad); assert.deepEqual([r.productivity, r.outlier, r.shortfall_md], [15000, 1, 0]);
  const ok = t.dpr(t.P1, { date: day(1), work: [[w, 'A10', 6]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 4, manDays: 4 }] }); assert.equal(t.d.prepare('SELECT outlier FROM prod_actuals WHERE dpr_id = ?').get(ok).outlier, 0);
  const dash = (await t.call(cm, 'GET', `/dashboard?projectId=${t.P1.pid}&from=${day(10)}&to=${TODAY}`)).json.data; assert.deepEqual([dash.records, dash.outlierCount, dash.efficiency, dash.outliers.length], [1, 1, 100, 1], 'the flagged one is counted apart and out of the efficiency');
  const o = (await t.call(cm, 'GET', `/dashboard?projectId=${t.P1.pid}`)).json.data.outliers[0]; assert.deepEqual([o.activityCode, o.timesNorm, o.dprNo], ['A10', 10, `DPR/${bad}`]);
});

test('FR-01 the norms: from the BOQ resource norms, or entered and approved by another person; an approved norm scores the records again', async () => {
  const t = await boot(); const d = t.d;
  // a BOQ line linked to A10 with a labour norm of 0.8 man-day a unit and an equipment norm of 0.5 hour a unit
  const bv = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BOQ/1', ?, 'CONTRACT', 1, 'BOQ', 'APPROVED', 't')").run(t.P1.pid).lastInsertRowid);
  const bl = Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, qty, uom, created_by) VALUES (1, ?, 'ITEM', '1.1', 'Brickwork', 100000, 'm3', 't')").run(bv).lastInsertRowid);
  d.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, norm_type, description, uom, qty_per_unit, created_by) VALUES (1, ?, 'LABOUR', 'Mason', 'man-day', 800, 't')").run(bl); d.prepare("INSERT INTO proj_boq_line_norms (company_id, line_id, norm_type, description, uom, qty_per_unit, created_by) VALUES (1, ?, 'EQUIPMENT', 'Mixer', 'hour', 500, 't')").run(bl);
  d.prepare("INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty, created_by) VALUES (1, ?, ?, 100000, 't')").run(t.actId[t.P1.pid].A10, bl);
  const w = t.wa(t.P1, 'A10', 10, { crewMd: 5 }); const rec = t.dpr(t.P1, { work: [[w, 'A10', 10]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 5, manDays: 5 }] }); assert.equal(t.d.prepare('SELECT norm_labour FROM prod_actuals WHERE dpr_id = ?').get(rec).norm_labour, null, 'no norm yet');
  assert.equal((await t.call(se, 'POST', '/norms/refresh-boq', { projectId: t.P1.pid })).status, 403); const ref = await t.call(pcm, 'POST', '/norms/refresh-boq', { projectId: t.P1.pid }); assert.equal(ref.status, 200, JSON.stringify(ref.json)); assert.deepEqual([ref.json.data.found, ref.json.data.made], [2, 2]);
  assert.deepEqual(d.prepare("SELECT resource_type, output_per_unit, source, status FROM prod_norms WHERE org_project_id = ? ORDER BY resource_type").all(t.P1.pid).map((x) => [x.resource_type, x.output_per_unit, x.source, x.status]), [['EQUIPMENT', 2000, 'BOQ', 'APPROVED'], ['LABOUR', 1250, 'BOQ', 'APPROVED']], 'output per man-day is the reciprocal of 0.8; per machine-hour of 0.5');
  assert.deepEqual({ ...d.prepare('SELECT norm_labour, productivity, variance_pct FROM prod_actuals WHERE dpr_id = ?').get(rec) }, { norm_labour: 1250, productivity: 2000, variance_pct: 6000 }, 'the record is scored again'); assert.equal((await t.call(pcm, 'POST', '/norms/refresh-boq', { projectId: t.P1.pid })).json.data.made, 0, 'nothing changed, nothing made');
  // an entered norm: maker-checker; the maker never approves; an approved one is locked; the entered norm comes before the BOQ one
  const k = key(); const c = await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A10', resourceType: 'LABOUR', outputPerUnit: 1, effectiveFrom: day(5), note: 'Site trial' }, k); assert.equal(c.status, 201, JSON.stringify(c.json)); assert.equal((await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A10', resourceType: 'LABOUR', outputPerUnit: 1, effectiveFrom: day(5), note: 'Site trial' }, k)).json.data.id, c.json.data.id, 'idempotent replay');
  assert.equal((await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A10', resourceType: 'LABOUR', outputPerUnit: 2, effectiveFrom: day(5) })).status, 409); assert.equal((await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'ZZ', resourceType: 'LABOUR', outputPerUnit: 2, effectiveFrom: day(5) })).status, 400); assert.equal((await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A10', resourceType: 'LABOUR', outputPerUnit: 0, effectiveFrom: day(4) })).status, 400);
  assert.equal((await t.call(plan1, 'PATCH', `/norms/${c.json.data.id}`, { outputPerUnit: 1.1, rowVersion: 99 })).status, 409); const sent = await t.call(plan1, 'POST', `/norms/${c.json.data.id}/submit`); assert.equal(sent.status, 202); const inst = sent.json.data.workflowInstanceId; assert.equal(await t.taskOf(plan1, inst), undefined, 'the maker never decides'); assert.equal((await t.call(plan1, 'PATCH', `/norms/${c.json.data.id}`, { outputPerUnit: 3 })).status, 409);
  assert.equal((await t.act(pm, inst, 'return')).status, 200); assert.equal((await t.call(plan1, 'PATCH', `/norms/${c.json.data.id}`, { outputPerUnit: 1.1 })).json.data.outputPerUnit, 1.1); assert.equal((await t.call(plan1, 'POST', `/norms/${c.json.data.id}/submit`)).status, 202); assert.equal((await t.act(pm, inst)).status, 200);
  assert.deepEqual({ ...d.prepare('SELECT norm_labour, variance_pct FROM prod_actuals WHERE dpr_id = ?').get(rec) }, { norm_labour: 1100, variance_pct: 8182 }, 'the entered norm replaces the BOQ one from its date'); const nv = (await t.call(pm, 'GET', `/norms/${c.json.data.id}`)).json.data; assert.deepEqual([nv.status, nv.approvedBy, nv.can.edit], ['APPROVED', 'hpm1', false]); assert.equal((await t.call(plan1, 'PATCH', `/norms/${c.json.data.id}`, { outputPerUnit: 5 })).status, 409);
  assert.ok((await t.call(plan1, 'GET', `/norms/${c.json.data.id}/history`)).json.data.audit.some((x) => x.action === 'approve')); assert.deepEqual((await t.call(plan1, 'GET', '/norms?filter[source]=MANUAL')).json.data.map((x) => x.status), ['APPROVED']);
  // a rejected one changes nothing
  const r = await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A20', resourceType: 'LABOUR', outputPerUnit: 9, effectiveFrom: day(3) }); const rs = (await t.call(plan1, 'POST', `/norms/${r.json.data.id}/submit`)).json.data; assert.equal((await t.act(pm, rs.workflowInstanceId, 'reject')).status, 200); assert.equal((await t.call(plan1, 'GET', `/norms/${r.json.data.id}`)).json.data.status, 'REJECTED');
});

test('FR-03 FR-04 FR-05 loss reasons (recorded and read from the day), the benchmarks, the trend and the alert after N days below the threshold', async () => {
  const t = await boot(); await t.norm(t.P1, 'A10', 2); await t.norm(t.P2, 'A10', 2);
  const w = t.wa(t.P1, 'A10', 8, { crewMd: 5 }); const lab = [{ category: 'STAFF', trade: 'Mason', headcount: 5, manDays: 5 }];
  // day -4 below the norm (8 m3 over 5 man-days = 1.6 against 2): 1 man-day lost; no reason at all; day -3 with breakdown hours; day -2 with a weather shutdown; day -1 a loss recorded by the site
  t.dpr(t.P1, { date: day(4), work: [[w, 'A10', 8]], labour: lab });
  t.dpr(t.P1, { date: day(3), work: [[w, 'A10', 8]], labour: lab, equipment: [{ key: 'plant:mixer', label: 'Mixer', hoursWorked: 4, hoursBreakdown: 3 }] });
    t.d.prepare("INSERT INTO site_weather (company_id, org_project_id, wx_site_id, wx_date, rainfall_mm, hours_lost, shutdown, shutdown_reason, source, created_by) VALUES (1, ?, ?, ?, 80000, 8000, 1, 'Flooded', 'MANUAL', 't')").run(t.P1.pid, t.P1.site, day(2)); t.dpr(t.P1, { date: day(2), work: [[w, 'A10', 8]], labour: lab });
  t.dpr(t.P1, { date: day(1), work: [[w, 'A10', 8]], labour: lab });
  const reasonOf = (date) => t.d.prepare('SELECT COALESCE(loss_reason, derived_reason) AS r, shortfall_md FROM prod_actuals WHERE work_date = ? AND deleted_at IS NULL').get(date);
  assert.deepEqual([{ ...reasonOf(day(4)) }, reasonOf(day(3)).r, reasonOf(day(2)).r, reasonOf(day(1)).r], [{ r: null, shortfall_md: 1000 }, 'BREAKDOWN', 'WEATHER', null]);
  // the site records a loss for day -1 (rework on the activity) and one for the site that day: the activity's comes first; recorded reasons come before the ones read from the day
  assert.equal((await t.call(sk, 'POST', '/losses', { siteId: t.P1.site, date: day(1), reasonCode: 'REWORK', hoursLost: 4 })).status, 403); assert.equal((await t.call(se, 'POST', '/losses', { siteId: t.P1.site, date: day(1), reasonCode: 'NOPE', hoursLost: 4 })).status, 400); assert.equal((await t.call(se, 'POST', '/losses', { siteId: t.P1.site, date: day(1), activityCode: 'ZZ', reasonCode: 'REWORK', hoursLost: 4 })).status, 400); assert.equal((await t.call(se, 'POST', '/losses', { siteId: t.P1.site, date: isoOf(ordOf(TODAY) + 2), reasonCode: 'REWORK', hoursLost: 4 })).status, 400);
  const l1 = await t.call(se, 'POST', '/losses', { siteId: t.P1.site, date: day(1), reasonCode: 'MATERIAL_SHORTAGE', hoursLost: 6, note: 'No bricks until noon' }); assert.equal(l1.status, 201, JSON.stringify(l1.json)); const l2 = await t.call(se, 'POST', '/losses', { siteId: t.P1.site, date: day(1), activityCode: 'A10', reasonCode: 'REWORK', hoursLost: 2 });
  assert.equal(reasonOf(day(1)).r, 'REWORK'); assert.equal((await t.call(se, 'DELETE', `/losses/${l2.json.data.id}`)).status, 200); assert.equal(reasonOf(day(1)).r, 'MATERIAL_SHORTAGE'); assert.equal((await t.call(se2, 'POST', '/losses', { siteId: t.P2.site, date: day(1), reasonCode: 'IDLE', hoursLost: 1 })).status, 201, 'every site engineer here holds company scope'); assert.equal(reasonOf(day(2)).r, 'WEATHER');
  // the report: the man-days lost by reason (the shortfall of each record: 1 man-day on each of four days), the groups, the export
  const rep = (await t.call(cm, 'GET', `/report?projectId=${t.P1.pid}&from=${day(10)}&to=${TODAY}`)).json.data; assert.deepEqual(rep.reasons.map((x) => [x.reason, x.lostManDays, x.sharePct]).sort(), [['BREAKDOWN', 1, 25], ['MATERIAL_SHORTAGE', 1, 25], ['UNEXPLAINED', 1, 25], ['WEATHER', 1, 25]]);
  assert.equal(rep.reasons.length, 4); assert.equal(rep.reasons.reduce((n, x) => n + x.lostManDays, 0), 4); assert.deepEqual([rep.efficiency, rep.lostManDays, rep.records], [80, 4, 4]); assert.equal(rep.groups[0].label, 'A10'); assert.deepEqual([rep.groups[0].outputPerMd, rep.groups[0].efficiency], [1.6, 80]);
  assert.deepEqual((await t.call(cm, 'GET', `/report?projectId=${t.P1.pid}&groupBy=CREW&from=${day(10)}`)).json.data.groups.map((x) => x.label), ['Masons one']); assert.ok((await t.call(cm, 'GET', `/report?projectId=${t.P1.pid}&groupBy=WEEK&from=${day(10)}`)).json.data.groups.length >= 1);
  for (const f of ['csv', 'xlsx', 'pdf']) assert.equal((await t.api.raw('GET', `${S}/report/export?projectId=${t.P1.pid}&from=${day(10)}&format=${f}`, cm)).status, 200); assert.equal((await t.api.raw('GET', `${S}/report/export?projectId=${t.P1.pid}&format=csv`, se)).status, 403);
  // benchmarks: the same work type on both projects
  const w2 = t.wa(t.P2, 'A10', 12, { crewMd: 5 }); t.dpr(t.P2, { date: day(1), work: [[w2, 'A10', 12]], labour: lab });
  const bm = (await t.call(plan1, 'GET', `/benchmarks?from=${day(10)}&to=${TODAY}`)).json.data; assert.equal(bm.length, 1); assert.equal(bm[0].workType, 'UOM:m3'); assert.deepEqual(bm[0].sites.map((x) => [x.project, x.outputPerMd]).sort(), [['PRO1', 1.6], ['PRO2', 2.4]]); assert.equal(bm[0].best.project, 'PRO2'); assert.equal(bm[0].averageOutputPerMd, 1.76, 'weighted: 44 m3 over 25 man-days');
  // FR-05: below 80 % of the norm on each of the last 3 days raises one alert, with the event and the notification; a day at the norm clears it
  const alerts = (await t.call(cm, 'GET', `/alerts?projectId=${t.P1.pid}`)).json.data; assert.equal(alerts.length, 0, 'the days are not all below 80 %: 80 % is not below it');
  await t.norm(t.P1, 'A20', 2); const w3 = t.wa(t.P1, 'A20', 5, { crewMd: 5 }); for (const n of [2, 1, 0]) t.dpr(t.P1, { date: day(n), work: [[w3, 'A20', 5]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 5, manDays: 5 }], dprId: 810000 + n }); const al = (await t.call(cm, 'GET', `/alerts?projectId=${t.P1.pid}`)).json.data; assert.deepEqual(al.map((x) => [x.activityCode, x.days, x.avgPctOfNorm]), [['A20', 3, 50]]);
  t.dpr(t.P1, { date: day(0), work: [[w3, 'A20', 12]], labour: [{ category: 'STAFF', trade: 'Mason', headcount: 5, manDays: 5 }], dprId: 810000 }); assert.equal((await t.call(cm, 'GET', `/alerts?projectId=${t.P1.pid}`)).json.data.length, 0, 'back above the threshold: cleared'); t.drain();
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'site.productivity.low'").get().n, 1); assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'prod_alerts' AND action = 'raise'").get());
  const rows = (await t.call(cm, 'GET', `/rows?filter[reason]=WEATHER`)).json; assert.ok(rows.data.length >= 1 && rows.data.every((x) => x.reason === 'Weather') && rows.data.some((x) => x.activity === 'A10' && x.date === day(2)), 'the days of the weather shutdown');
});

test('AC-03 AC-04 roles and isolation: who sees and does what; another company gets nothing; the flag gates the routes; configuration is maker-checker and audited', async () => {
  const t = await boot(); await t.norm(t.P1, 'A10', 1.5); const w = t.wa(t.P1, 'A10', 8, { crewMd: 5 }); t.dpr(t.P1, { work: [[w, 'A10', 8]] });
  for (const [who, view, configure, record] of [[cm, 200, 403, 201], [pm, 200, 403, 201], [pcm, 200, 201, 403], [plan1, 200, 201, 403], [se, 200, 403, 201], [qs, 200, 403, 403], [aud, 200, 403, 403], [sk, 403, 403, 403]]) {
    assert.equal((await t.call(who, 'GET', '/dashboard')).status, view, `${who.roles} dashboard`); assert.equal((await t.call(who, 'GET', '/norms')).status, view, `${who.roles} norms`);
    assert.equal((await t.call(who, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A20', resourceType: 'LABOUR', outputPerUnit: 1, effectiveFrom: day(2 + Math.floor(Math.random() * 200)) })).status === 201, configure === 201, `${who.roles} configures`);
    assert.equal((await t.call(who, 'POST', '/losses', { siteId: t.P1.site, date: day(1), reasonCode: 'IDLE', hoursLost: 1 })).status === 201, record === 201, `${who.roles} records a loss`);
  }
  assert.equal((await t.call(plan1, 'POST', '/norms', { projectId: t.P1.pid, activityCode: 'A10', resourceType: 'EQUIPMENT', outputPerUnit: 2, effectiveFrom: day(1) })).status, 201); const nid = (await t.call(plan1, 'GET', '/norms?filter[resource]=EQUIPMENT')).json.data[0].id;
  assert.equal((await t.call(pm, 'POST', `/norms/${nid}/submit`)).status, 403, 'the checker does not send'); assert.equal((await t.call(plan1, 'PATCH', `/norms/${nid}`, { status: 'APPROVED' })).status, 400, 'the status is set by the workflow only'); assert.equal((await t.call(pm, 'PATCH', `/norms/${nid}`, { outputPerUnit: 9 })).status, 403);
  assert.equal((await t.call(other, 'GET', `/norms/${nid}`)).status, 404); assert.equal((await t.call(other, 'GET', '/norms')).json.data.length, 0); assert.equal((await t.call(other, 'GET', '/rows')).json.data.length, 0); const od = await t.call(other, 'GET', `/dashboard?projectId=${t.P1.pid}`); assert.equal(od.status, 404, JSON.stringify(od.json)); assert.equal((await t.call(otherSe, 'POST', '/losses', { siteId: t.P1.site, date: day(1), reasonCode: 'IDLE', hoursLost: 1 })).status, 404);
  assert.equal((await t.call(plan1, 'GET', `/dashboard?projectId=${t.P1.pid}&from=${TODAY}&to=${day(5)}`)).status, 400); assert.deepEqual((await t.call(plan1, 'GET', '/projects')).json.data.map((x) => x.code), ['PRO1', 'PRO2']);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.site.p1406'").run(); assert.equal((await t.call(plan1, 'GET', '/dashboard')).status, 404); assert.equal((await t.call(plan1, 'GET', '/norms')).status, 404); assert.notEqual((await t.api.call('GET', '/api/v1/site/weather', { ...cm })).status, 404);
});
