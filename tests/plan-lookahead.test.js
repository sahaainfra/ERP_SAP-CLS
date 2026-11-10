import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 13.04: look-ahead planning, constraints and weekly work plans. T-01 an open RFI on a linked drawing raises a constraint on the activities it touches by itself, and closing the RFI clears it;
// T-02 PPC = completed commitments / commitments. Also: the board by week with make-ready, a drawing without an IFC revision, a late predecessor, labour no crew covers, constraints logged by hand,
// a plan that is not sent with a commitment on an activity that is not ready, the approval by the construction manager and then the project manager (the one who prepared it never decides),
// the lock and the revision, the record of what was done, the variance codes, the daily breakdown for work authorisation, the PPC report, roles, isolation, 409, idempotent replay and the flag.
const P = '/api/v1/plan'; const W = '/api/v1/workflow';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `pl-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'lplan1'); const cm1 = as('CM', 'lcm1'); const cm2 = as('CM', 'lcm2'); const pm = as('PM', 'lpm1'); const se = as('SE', 'lse1'); const aud = as('AUD', 'laud1'); const pcm = as('PCMGR', 'lpcm1'); const other = as('PLAN', 'lplan9', '2');
const today = todayIST(); const monday = isoOf(ordOf(today) - ((ordOf(today) + 3) % 7)); const nextMonday = isoOf(ordOf(monday) + 7);

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['lplan1', ['PLAN']], ['lcm1', ['CM']], ['lcm2', ['CM']], ['lpm1', ['PM']], ['lse1', ['SE']], ['laud1', ['AUD']], ['lpcm1', ['PCMGR']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'LKT', 'Look-ahead Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const wbs = (c, n, parent = null) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, ?, ?)').run(pid, parent, c, n, parent ? 2 : 1, 't').lastInsertRowid);
  const w1 = wbs('1', 'Substructure'); const w11 = wbs('1.1', 'Footings', w1); const w2 = wbs('2', 'Superstructure');
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'LKT-S1', 'Site 1')").run(pid).lastInsertRowid);
  const crew = (code, name) => Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, ?, ?, 'Mason')").run(site, code, name).lastInsertRowid);
  const c1 = crew('LKT-M1', 'Masons gang 1'); const c2 = crew('LKT-M2', 'Masons gang 2');
  d.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (1, 'LKT-DEP/1', '2026-01-01', 'WORKER', 9001, ?, ?, '2026-01-01', 'APPROVED')").run(pid, c1);
  const drawing = (no, w) => Number(d.prepare("INSERT INTO engg_drawings (company_id, org_project_id, drawing_no, title, discipline, wbs_id, planned_receipt) VALUES (1, ?, ?, ?, 'STRUCTURAL', ?, ?)").run(pid, no, `Drawing ${no}`, w, nextMonday).lastInsertRowid);
  const d1 = drawing('STR-101', w11); const d2 = drawing('STR-201', w2);
  const rfi = Number(d.prepare("INSERT INTO engg_rfis (company_id, rfi_no, org_project_id, subject, question, discipline, wbs_id, drawing_id, required_by, status) VALUES (1, 'RFI/00001', ?, 'Footing level', 'What is the footing level?', 'STRUCTURAL', ?, ?, ?, 'ISSUED')").run(pid, w11, d1, nextMonday).lastInsertRowid);
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const act = async (who, instanceId, action = 'approve') => {
    const task = (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.find((x) => x.instance.id === instanceId); assert.ok(task, `${who.user} has the task of instance ${instanceId}`);
    const r = await api.call('POST', `${W}/tasks/${task.id}/act`, { ...who, headers: key(), body: { action, comment: 'checked' } }); assert.equal(r.status, 200, JSON.stringify(r.json)); return r;
  };
  const hasTask = async (who, instanceId) => (await api.call('GET', `${W}/tasks?mine=assigned`, who)).json.data.rows.some((x) => x.instance.id === instanceId);
  const cal = await call(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal(cal.status, 201, JSON.stringify(cal.json));
  assert.equal((await call(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const s = await call(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower working schedule', calendarId: cal.json.data.id, startDate: monday }); assert.equal(s.status, 201, JSON.stringify(s.json)); const sid = s.json.data.id;
  const imp = await call(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC bed', wbsCode: '1.1', duration: 3, predecessors: 'A10' }, { code: 'A30', name: 'Columns', wbsCode: '2', duration: 4 }] }); assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.deepEqual(imp.json.data.errors, []);
  const a = Object.fromEntries((await call(plan1, 'GET', `/schedules/${sid}/activities?pageSize=1000`)).json.data.rows.map((x) => [x.code, x]));
  assert.equal((await call(plan1, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Mason', qty: 20, basis: 'TOTAL' }] })).status, 200);
  assert.equal((await call(plan1, 'PUT', `/activities/${a.A30.id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Carpenter', qty: 16, basis: 'TOTAL' }] })).status, 200);
  assert.equal((await call(plan1, 'POST', `/schedules/${sid}/calculate`)).status, 200);
  return { api, d, call, act, hasTask, pid, sid, site, c1, c2, w11, w2, d1, d2, rfi, a };
}
const board = async (t, who = se, q = '') => { const r = await t.call(who, 'GET', `/schedules/${t.sid}/lookahead${q}`); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
const cons = async (t, q = '') => (await t.call(se, 'GET', `/constraints${q}`)).json.data;
const byAct = (rows) => { const m = {}; for (const r of rows) (m[r.activity] ??= []).push(r); return m; };
const drain = (t) => { const rt = runtimeOf(t.d); for (let i = 0; i < 4; i += 1) rt.bus.drain(); };

test('T-01 an open RFI on a linked drawing raises a constraint by itself and closing the RFI clears it; drawings, a late predecessor and labour are found too', async () => {
  const t = await boot();
  // nothing is found until the schedule is looked at: the board reads, the detection writes
  assert.equal((await cons(t)).length, 0); const b0 = await board(t); assert.equal(b0.activities.length, 3); assert.ok(b0.activities.every((x) => x.ready));
  const det = await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); assert.equal(det.status, 200, JSON.stringify(det.json)); assert.equal(det.json.data.cleared, 0);
  let m = byAct(await cons(t)); const types = (k) => m[k].map((x) => x.type).sort();
  assert.deepEqual(types('A10'), ['DRAWING', 'RFI']); assert.deepEqual(types('A20'), ['DRAWING', 'RFI']); assert.deepEqual(types('A30'), ['DRAWING', 'LABOUR'], 'Mason has an approved crew, Carpenter has none');
  const rfi = m.A10.find((x) => x.type === 'RFI'); assert.match(rfi.description, /Open RFI RFI\/00001 on drawing STR-101: Footing level/); assert.deepEqual([rfi.origin, rfi.dueDate, rfi.source.entity, rfi.status], ['AUTO', nextMonday, 'engg_rfi', 'OPEN']);
  assert.equal(det.json.data.raised, 6); assert.equal((await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`)).json.data.raised, 0, 'detecting again adds nothing');
  // make-ready: an activity is ready only when all its constraints are cleared
  const b1 = await board(t); const c = Object.fromEntries(b1.activities.map((x) => [x.code, x])); assert.deepEqual([c.A10.ready, c.A30.ready, c.A10.constraints.length], [false, false, 2]); assert.deepEqual([b1.summary.ready, b1.summary.blocked, b1.summary.constraints], [0, 3, 6]);
  assert.equal(b1.columns.length, 6); assert.equal(b1.columns[0].weekStart, monday); assert.ok(b1.columns[0].blocked >= 2);
  assert.equal((await board(t, se, '?onlyBlocked=true')).activities.length, 3); assert.deepEqual((await board(t, se, '?q=columns')).activities.map((x) => x.code), ['A30']); assert.equal((await t.call(se, 'GET', `/schedules/${t.sid}/lookahead?weeks=13`)).status, 400);
  // T-01: the RFI is closed in engineering; its event clears the constraint by itself, with the audit and the event for the dashboards
  t.d.prepare("UPDATE engg_rfis SET status = 'CLOSED' WHERE id = ?").run(t.rfi); publishEvent(t.d, { type: 'engg.rfi.closed', entity: 'engg_rfi', entityId: t.rfi, actorId: 'sys', companyId: 1, projectId: t.pid, data: { projectId: t.pid, rfiId: t.rfi } }); drain(t);
  m = byAct(await cons(t, '?filter[status]=OPEN')); assert.deepEqual(types('A10'), ['DRAWING']); const gone = (await cons(t, '?filter[status]=CLEARED')); assert.deepEqual(gone.map((x) => [x.activity, x.type, x.clearedBy]).sort(), [['A10', 'RFI', 'system'], ['A20', 'RFI', 'system']]); assert.equal(gone[0].clearNote, 'The source is resolved');
  assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.constraint.cleared'").get().n, 2); assert.equal(t.d.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'plan.constraint.raised'").get().n, 6);
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'plan_constraints' AND action = 'clear' AND actor = 'system'").get().n >= 2);
  // a drawing that is cancelled or issued is no longer a constraint: the same way
  t.d.prepare("UPDATE engg_drawings SET register_status = 'CANCELLED' WHERE id = ?").run(t.d2); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); m = byAct(await cons(t, '?filter[status]=OPEN')); assert.deepEqual(types('A30'), ['LABOUR']);
  // a predecessor that should be finished and is not; finished, it clears
  const a10 = t.a.A10.id; t.d.prepare('UPDATE plan_activities SET ef = ? WHERE id = ?').run(isoOf(ordOf(today) - 1), a10); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`);
  m = byAct(await cons(t, '?filter[status]=OPEN')); assert.ok(types('A20').includes('PREDECESSOR')); assert.match(m.A20.find((x) => x.type === 'PREDECESSOR').description, /Predecessor A10 Excavation is not finished/);
  t.d.prepare('UPDATE plan_activities SET actual_start = ?, actual_finish = ?, pct_complete = 10000 WHERE id = ?').run(monday, today, a10); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); m = byAct(await cons(t, '?filter[status]=OPEN')); assert.equal((m.A20 ?? []).some((x) => x.type === 'PREDECESSOR'), false);
  assert.equal((await board(t)).activities.some((x) => x.code === 'A10'), false, 'a finished activity leaves the look-ahead');
  // labour is covered when a crew of the trade is deployed
  t.d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'LKT-C1', 'Carpenters', 'Carpenter')").run(t.site); const cc = Number(t.d.prepare("SELECT id FROM hr_crews WHERE code = 'LKT-C1'").get().id);
  t.d.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (1, 'LKT-DEP/2', '2026-01-01', 'WORKER', 9002, ?, ?, '2026-01-01', 'APPROVED')").run(t.pid, cc); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); m = byAct(await cons(t, '?filter[status]=OPEN')); assert.equal((m.A30 ?? []).length, 0);
  assert.ok((await board(t)).activities.find((x) => x.code === 'A30').ready);
});

test('FR-02 constraints logged by hand: owner, due date, clear; an automatic one is waived with a reason, not cleared; rights, isolation and the list', async () => {
  const t = await boot(); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); const open = await cons(t, '?filter[status]=OPEN'); const auto = open.find((x) => x.activity === 'A30' && x.type === 'LABOUR');
  const body = { activityId: t.a.A20.id, type: 'PERMIT', description: 'Hot work permit for the cutting', owner: 'lse1', dueDate: nextMonday };
  assert.equal((await t.call(se, 'POST', '/constraints', { ...body, owner: 'nobody' })).status, 400); assert.equal((await t.call(se, 'POST', '/constraints', { ...body, type: 'WEATHER' })).status, 400); assert.equal((await t.call(aud, 'POST', '/constraints', body)).status, 403); assert.equal((await t.call(other, 'POST', '/constraints', body)).status, 404);
  assert.equal((await t.api.call('POST', `${P}/constraints`, { ...se, headers: { 'content-type': 'application/json' }, body })).status, 400, 'an Idempotency-Key is required');
  const k = key(); const made = await t.call(se, 'POST', '/constraints', body, k); assert.equal(made.status, 201, JSON.stringify(made.json)); const x = made.json.data; assert.deepEqual([x.origin, x.status, x.owner, x.overdue, x.can.clear], ['MANUAL', 'OPEN', 'lse1', false, true]);
  assert.equal((await t.call(se, 'POST', '/constraints', body, k)).json.data.id, x.id, 'the same key gives the same constraint');
  const up = await t.call(se, 'PATCH', `/constraints/${x.id}`, { dueDate: isoOf(ordOf(today) - 2), rowVersion: x.rowVersion }); assert.equal(up.status, 200); assert.equal(up.json.data.overdue, true); assert.equal((await t.call(se, 'PATCH', `/constraints/${x.id}`, { owner: 'lcm1', rowVersion: x.rowVersion })).status, 409, 'a stale row version');
  assert.equal((await t.call(pm, 'PATCH', `/constraints/${x.id}`, { owner: 'lcm1' })).status, 200, 'the project manager manages constraints'); assert.equal((await t.call(aud, 'PATCH', `/constraints/${x.id}`, { owner: 'lcm1' })).status, 403);
  assert.equal((await board(t)).summary.overdue, (await cons(t, '?filter[status]=OPEN')).filter((c) => c.overdue).length, 'the board counts the overdue constraints of the log'); assert.ok((await board(t)).summary.overdue >= 1);
  // an automatic one keeps its source: only owner and date; it is waived with a reason; a manual one is cleared
  assert.equal((await t.call(se, 'PATCH', `/constraints/${auto.id}`, { description: 'Rewritten' })).status, 422); assert.equal((await t.call(se, 'PATCH', `/constraints/${auto.id}`, { owner: 'lcm1', dueDate: nextMonday })).status, 200);
  assert.equal((await t.call(se, 'POST', `/constraints/${auto.id}/clear`, { note: 'try' })).status, 422); assert.equal((await t.call(se, 'POST', `/constraints/${auto.id}/waive`, { reason: 'ok' })).status, 400);
  const w = await t.call(se, 'POST', `/constraints/${auto.id}/waive`, { reason: 'The carpenters come from the other site' }); assert.equal(w.status, 200); assert.deepEqual([w.json.data.status, w.json.data.clearedBy, w.json.data.clearNote], ['WAIVED', 'lse1', 'The carpenters come from the other site']);
  assert.equal((await t.call(se, 'POST', `/constraints/${auto.id}/waive`, { reason: 'Again please' })).status, 409);
  const cl = await t.call(se, 'POST', `/constraints/${x.id}/clear`, { note: 'Permit received' }); assert.equal(cl.status, 200); assert.deepEqual([cl.json.data.status, cl.json.data.clearedOn], ['CLEARED', today]); assert.equal((await t.call(se, 'PATCH', `/constraints/${x.id}`, { owner: 'lse1' })).status, 409);
  assert.equal((await t.call(se, 'GET', `/activities/${t.a.A20.id}/constraints`)).json.data.rows.length, 3, 'RFI, drawing and the permit');
  // the list: filter, search, export; scope
  assert.equal((await t.call(se, 'GET', '/constraints?filter[ctype]=PERMIT')).json.data.length, 1); assert.equal((await t.call(se, 'GET', '/constraints?q=hot%20work')).json.data.length, 1); assert.equal((await t.call(other, 'GET', '/constraints')).json.data.length, 0);
  const ex = await t.api.raw('GET', `${P}/constraints/export?format=csv`, se); assert.equal(ex.status, 200); assert.match(ex.buffer.toString(), /Hot work permit/); assert.equal((await t.call(other, 'GET', `/constraints/${x.id}`)).status, 404);
  assert.equal((await t.call(other, 'POST', `/schedules/${t.sid}/constraints/detect`)).status, 404); assert.equal((await t.call(aud, 'POST', `/schedules/${t.sid}/constraints/detect`)).status, 403);
});

test('FR-01 FR-04 FR-05 T-02 BR-01 the weekly plan: not sent with a commitment that is not ready; approved by the construction manager then the project manager; recorded, closed; PPC, daily breakdown, report', async () => {
  const t = await boot(); const W1 = (extra = {}) => ({ scheduleId: t.sid, weekStart: monday, note: 'The week of the footings', items: [{ activityId: t.a.A10.id, crewId: t.c1, committedQty: 50, uom: 'cum' }, { activityId: t.a.A10.id, crewId: t.c2, committedQty: 30, uom: 'cum' }, { activityId: t.a.A30.id, committedQty: 20, uom: 'cum' }], ...extra });
  // validation, rights and scope of the draft
  assert.equal((await t.call(cm1, 'POST', '/weekly-plans', W1({ weekStart: isoOf(ordOf(monday) + 1) }))).json.error.details[0].field, 'weekStart'); const out = await t.call(cm1, 'POST', '/weekly-plans', W1({ weekStart: nextMonday })); assert.equal(out.status, 400); assert.match(out.json.error.details[0].message, /outside the week/);
  assert.equal((await t.call(cm1, 'POST', '/weekly-plans', W1({ items: [{ activityId: t.a.A10.id, committedQty: 0 }] }))).status, 400); assert.equal((await t.call(cm1, 'POST', '/weekly-plans', W1({ items: [{ activityId: t.a.A10.id, crewId: 999999, committedQty: 5 }] }))).status, 400);
  assert.equal((await t.call(cm1, 'POST', '/weekly-plans', W1({ items: [{ activityId: t.a.A10.id, committedQty: 5 }, { activityId: t.a.A10.id, committedQty: 6 }] }))).status, 400, 'twice for the same crew');
  for (const who of [se, pm, aud]) assert.equal((await t.call(who, 'POST', '/weekly-plans', W1())).status, 403, who.roles); assert.equal((await t.call(other, 'POST', '/weekly-plans', W1())).status, 404);
  const k = key(); const made = await t.call(cm1, 'POST', '/weekly-plans', W1(), k); assert.equal(made.status, 201, JSON.stringify(made.json)); const p = made.json.data; assert.deepEqual([p.status, p.items, p.revisionNo, p.weekStart, p.weekEnd], ['DRAFT', 3, 1, monday, isoOf(ordOf(monday) + 6)]); assert.match(p.docNo, /^WP\//);
  assert.equal((await t.call(cm1, 'POST', '/weekly-plans', W1(), k)).json.data.id, p.id, 'idempotent replay'); assert.equal((await t.call(plan1, 'POST', '/weekly-plans', W1())).status, 409, 'one plan for a week and a site');
  // the daily breakdown (FR-05): the commitment over the working days between the dates of the activity; Sunday is off on the six-day calendar
  const dl = (await t.call(se, 'GET', `/weekly-plans/${p.id}/daily`)).json.data; const sum = (day) => dl.days.find((x) => x.date === day).total; const a10 = dl.lines.find((x) => x.activity === 'A10' && x.crewId === t.c1);
  assert.deepEqual([sum(monday), a10.byDay[monday], a10.byDay[isoOf(ordOf(monday) + 4)], a10.byDay[isoOf(ordOf(monday) + 5)], dl.days[6].working, sum(isoOf(ordOf(monday) + 6))], [21, 10, 10, 0, false, 0]); assert.equal(dl.lines.reduce((n, l) => n + l.total, 0), 100);
  assert.deepEqual(dl.lines.find((x) => x.activity === 'A30').byDay[isoOf(ordOf(monday) + 3)], 5);
  // FR-03: not sent while an activity has an open constraint
  await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); assert.equal((await t.call(se, 'GET', `/weekly-plans/${p.id}`)).json.data.lines.find((x) => x.activity === 'A10').ready, false);
  const no = await t.call(cm1, 'POST', `/weekly-plans/${p.id}/submit`); assert.equal(no.status, 422); assert.match(no.json.error.message, /Not ready: A10, A10, A30|Not ready: A10/);
  assert.equal((await t.call(se, 'PATCH', `/weekly-plans/${p.id}`, { items: [{ activityId: t.a.A10.id, committedQty: 5 }] , rowVersion: p.rowVersion + 9})).status, 409, 'a stale row version');
  for (const c of await cons(t, '?filter[status]=OPEN')) assert.equal((await t.call(se, 'POST', `/constraints/${c.id}/waive`, { reason: 'Cleared on site by the engineer' })).status, 200);
  assert.equal((await t.call(se, 'PATCH', `/weekly-plans/${p.id}`, { note: 'The site engineer commits the quantities' })).status, 200, 'the site engineer commits in a draft');
  const sub = await t.call(cm1, 'POST', `/weekly-plans/${p.id}/submit`); assert.equal(sub.status, 202, JSON.stringify(sub.json)); const inst = sub.json.data.workflowInstanceId; assert.equal(sub.json.data.status, 'SUBMITTED');
  assert.equal((await t.call(cm1, 'PATCH', `/weekly-plans/${p.id}`, { note: 'While it waits' })).status, 409);
  // the chain: the other construction manager, then the project manager; the maker is a construction manager and gets no task
  assert.equal(await t.hasTask(cm1, inst), false); assert.equal(await t.hasTask(pm, inst), false); assert.equal(await t.hasTask(cm2, inst), true); await t.act(cm2, inst); assert.equal((await t.call(cm1, 'GET', `/weekly-plans/${p.id}`)).json.data.status, 'SUBMITTED');
  assert.equal(await t.hasTask(pm, inst), true); await t.act(pm, inst); const ap = (await t.call(cm1, 'GET', `/weekly-plans/${p.id}`)).json.data; assert.deepEqual([ap.status, ap.approvedBy, ap.can.edit, ap.can.record, ap.can.amend], ['APPROVED', 'lpm1', false, false, true]);
  const ev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plan.weekly_plan.approved'").get().payload).data; assert.deepEqual([ev.planId, ev.items, ev.daily.length, ev.daily.reduce((n, x) => n + x.qty, 0)], [p.id, 3, 14, 100]);
  assert.equal((await t.call(cm1, 'PATCH', `/weekly-plans/${p.id}`, { note: 'After approval' })).status, 409); assert.equal((await t.call(cm1, 'DELETE', `/weekly-plans/${p.id}`)).status, 422); assert.equal((await t.call(se, 'GET', `/daily-plan?projectId=${t.pid}&date=${monday}`)).json.data.rows.length, 3);
  // FR-04: what was done, recorded by the site engineer on the approved plan; T-02 PPC
  const lines = (await t.call(se, 'GET', `/weekly-plans/${p.id}`)).json.data.lines; const L = (c, n) => lines.find((x) => x.activity === c && (n == null || x.crewId === n));
  assert.equal((await t.call(cm1, 'POST', `/weekly-plans/${p.id}/record`, { items: [{ itemId: L('A10', t.c1).id, completedQty: 50 }] })).status, 403, 'preparing is not recording'); assert.equal((await t.call(se, 'POST', `/weekly-plans/${p.id}/record`, { items: [{ itemId: 999999, completedQty: 1 }] })).status, 400);
  const rec = await t.call(se, 'POST', `/weekly-plans/${p.id}/record`, { items: [{ itemId: L('A10', t.c1).id, completedQty: 50 }, { itemId: L('A10', t.c2).id, completedQty: 31 }, { itemId: L('A30').id, completedQty: 5, varianceCode: null }] }); assert.equal(rec.status, 200, JSON.stringify(rec.json));
  assert.deepEqual([rec.json.data.completedCount, rec.json.data.ppc, rec.json.data.ppcFinal], [2, 66.67, false], 'a quantity at or above the commitment completes it; PPC is shown live and not yet final');
  const nov = await t.call(se, 'POST', `/weekly-plans/${p.id}/close`); assert.equal(nov.status, 422); assert.match(nov.json.error.message, /Give the reason for what was not completed: A30/);
  assert.equal((await t.call(se, 'POST', `/weekly-plans/${p.id}/record`, { items: [{ itemId: L('A30').id, completedQty: 5, varianceCode: 'LABOUR' }] })).status, 200);
  assert.equal((await t.api.call('POST', `${P}/weekly-plans/${p.id}/close`, { ...se, headers: { 'content-type': 'application/json' }, body: {} })).status, 400, 'an Idempotency-Key is required'); const cl = await t.call(se, 'POST', `/weekly-plans/${p.id}/close`); assert.equal(cl.status, 200, JSON.stringify(cl.json));
  assert.deepEqual([cl.json.data.status, cl.json.data.ppc, cl.json.data.ppcFinal, cl.json.data.items, cl.json.data.completedCount, cl.json.data.variance], ['CLOSED', 66.67, true, 3, 2, [{ code: 'LABOUR', label: 'Labour', n: 1 }]]); assert.equal(t.d.prepare('SELECT ppc FROM plan_weekly_plans WHERE id = ?').get(p.id).ppc, 6667);
  assert.equal((await t.call(se, 'POST', `/weekly-plans/${p.id}/record`, { items: [{ itemId: L('A30').id, completedQty: 20 }] })).status, 409, 'a closed week is not changed'); assert.equal((await t.call(cm1, 'POST', `/weekly-plans/${p.id}/amend`, { reason: 'Revise the closed week' })).status, 422);
  const cev = JSON.parse(t.d.prepare("SELECT payload FROM core_outbox WHERE event_type = 'plan.weekly_plan.closed'").get().payload).data; assert.deepEqual([cev.ppc, cev.items, cev.completed, cev.variance], [66.67, 3, 2, [{ code: 'LABOUR', n: 1 }]]);
  // the report: PPC trend and variance reasons, with the export
  const rp = (await t.call(se, 'GET', `/ppc?projectId=${t.pid}`)).json.data; assert.deepEqual([rp.weeks.length, rp.weeks[0].weekStart, rp.weeks[0].ppc, rp.totals.ppc, rp.totals.missed, rp.variance[0].code, rp.variance[0].pct, rp.variance[0].cumulativePct], [1, monday, 66.67, 66.67, 1, 'LABOUR', 100, 100]); assert.equal(rp.can.export, false);
  assert.equal((await t.call(pm, 'GET', `/ppc?projectId=${t.pid}&from=${nextMonday}`)).json.data.weeks.length, 0); assert.equal((await t.call(other, 'GET', `/ppc?projectId=${t.pid}`)).status, 404);
  for (const f of ['xlsx', 'pdf', 'csv']) { const x = await t.api.raw('GET', `${P}/ppc/export?projectId=${t.pid}&format=${f}`, pm); assert.equal(x.status, 200, f); if (f === 'csv') { assert.match(x.buffer.toString(), /66\.67/); assert.match(x.buffer.toString(), /Labour/); } }
  assert.equal((await t.api.raw('GET', `${P}/ppc/export?projectId=${t.pid}`, se)).status, 403);
  // a second plan, for the site: revision after approval replaces it; returned, corrected and sent again; a rejection; print
  const mk = async (extra) => (await t.call(cm1, 'POST', '/weekly-plans', { scheduleId: t.sid, siteId: t.site, weekStart: monday, items: [{ activityId: t.a.A20.id, committedQty: 12, uom: 'cum' }], ...extra })).json.data;
  const p2 = await mk(); assert.equal(p2.items, 1); await t.call(se, 'POST', `/schedules/${t.sid}/constraints/detect`); for (const c of await cons(t, '?filter[status]=OPEN')) await t.call(se, 'POST', `/constraints/${c.id}/waive`, { reason: 'Cleared on site by the engineer' });
  const i2 = (await t.call(cm1, 'POST', `/weekly-plans/${p2.id}/submit`)).json.data.workflowInstanceId; await t.act(cm2, i2, 'return'); assert.equal((await t.call(cm1, 'GET', `/weekly-plans/${p2.id}`)).json.data.status, 'RETURNED');
  assert.equal((await t.call(cm1, 'PATCH', `/weekly-plans/${p2.id}`, { items: [{ activityId: t.a.A20.id, committedQty: 15, uom: 'cum' }] })).status, 200); assert.equal((await t.call(cm1, 'POST', `/weekly-plans/${p2.id}/submit`)).status, 202); await t.act(cm2, i2); await t.act(pm, i2);
  assert.equal((await t.api.raw('GET', `${P}/weekly-plans/${p2.id}/print`, se)).status, 403, 'a site engineer does not print'); const pr = await t.api.raw('GET', `${P}/weekly-plans/${p2.id}/print`, cm1); assert.equal(pr.status, 200); assert.match(pr.buffer.toString(), /Weekly work plan WP\//); assert.doesNotMatch(pr.buffer.toString(), /NOT AN APPROVED PLAN/);
  const rv = await t.call(cm1, 'POST', `/weekly-plans/${p2.id}/amend`, { reason: 'The pour moved a day' }); assert.equal(rv.status, 201, JSON.stringify(rv.json)); assert.deepEqual([rv.json.data.revisionNo, rv.json.data.status, rv.json.data.parentPlanId, rv.json.data.items], [2, 'DRAFT', p2.id, 1]); assert.equal((await t.call(cm1, 'POST', `/weekly-plans/${p2.id}/amend`, { reason: 'A second revision at once' })).status, 409);
  const i3 = (await t.call(cm1, 'POST', `/weekly-plans/${rv.json.data.id}/submit`)).json.data.workflowInstanceId; await t.act(cm2, i3); await t.act(pm, i3); assert.equal((await t.call(cm1, 'GET', `/weekly-plans/${p2.id}`)).json.data.status, 'SUPERSEDED'); assert.equal((await t.call(cm1, 'GET', `/weekly-plans/${rv.json.data.id}`)).json.data.status, 'APPROVED');
  const h = (await t.call(se, 'GET', `/weekly-plans/${p2.id}/history`)).json.data; assert.ok(h.approvals.length >= 4); assert.ok(h.audit.map((x) => x.action).includes('submit'));
  // roles and isolation
  for (const who of [se, aud, pm, pcm, cm1]) assert.equal((await t.call(who, 'GET', `/weekly-plans/${p.id}`)).status, 200, who.roles); for (const path of [`/weekly-plans/${p.id}`, `/weekly-plans/${p.id}/daily`, `/weekly-plans/${p.id}/history`, `/schedules/${t.sid}/lookahead`, `/lookahead/options?projectId=${t.pid}`, `/daily-plan?projectId=${t.pid}&date=${monday}`]) assert.equal((await t.call(other, 'GET', path)).status, 404, path);
  assert.equal((await t.call(other, 'GET', '/weekly-plans')).json.data.length, 0); assert.equal((await t.call(se, 'GET', '/weekly-plans?filter[status]=CLOSED')).json.data.length, 1); assert.equal((await t.api.raw('GET', `${P}/weekly-plans/export?format=csv`, aud)).status, 200); assert.equal((await t.api.raw('GET', `${P}/weekly-plans/export?format=csv`, se)).status, 403);
  // the saved look-ahead and the options
  const sv = await t.call(cm1, 'POST', `/schedules/${t.sid}/lookaheads`, { weeks: 4, siteId: t.site }); assert.equal(sv.status, 201, JSON.stringify(sv.json)); assert.deepEqual([sv.json.data.weeks, sv.json.data.from, sv.json.data.siteId], [4, monday, t.site]); assert.equal((await t.call(se, 'POST', `/schedules/${t.sid}/lookaheads`, { weeks: 4 })).status, 403);
  assert.equal((await t.call(se, 'GET', `/schedules/${t.sid}/lookaheads`)).json.data.rows.length, 1); const op = (await t.call(se, 'GET', `/lookahead/options?projectId=${t.pid}`)).json.data; assert.deepEqual([op.scheduleId, op.sites.length, op.crews.length >= 2], [t.sid, 1, true]);
  // the flag
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plan.p1304'").run(); for (const path of ['/weekly-plans', '/constraints', `/schedules/${t.sid}/lookahead`, '/ppc?projectId=1']) assert.equal((await t.call(cm1, 'GET', path)).status, 404, path);
  assert.equal((await t.call(cm1, 'GET', `/schedules/${t.sid}`)).status, 200); t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.plan.p1304'").run();
});
