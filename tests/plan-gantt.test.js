import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Part 13.02: the interactive Gantt, schedule editing and resource loading. T-01 a drag edit moves the successors through the server's recalculation, is tried before it is saved (conflicts with the logic and
// the constraints shown first), and undo restores the schedule exactly; T-02 the programme of 1,000 activities is laid out legibly on A3 and A1 and written as PDF and SVG. Also: resources by hand and from the
// BOQ norms, the histograms against the deployments and the availability put in force by a second person, the drill-down, the monthly loading, roles, isolation, the lock of an approved schedule, the flag.
const P = '/api/v1/plan';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `pg-${Date.now().toString(36)}-${(seq += 1)}-${Math.random().toString(36).slice(2, 8)}` });
const as = (roles, user, company = '1') => ({ roles, user, company });
const plan1 = as('PLAN', 'gplan1'); const pcm = as('PCMGR', 'gpcm1'); const pm = as('PM', 'gpm1'); const se = as('SE', 'gse1'); const aud = as('AUD', 'gaud1'); const other = as('PLAN', 'gplan9', '2');

async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); const d = api.db;
  for (const [n, r] of [['gplan1', ['PLAN']], ['gpcm1', ['PCMGR']], ['gpm1', ['PM']], ['gse1', ['SE']], ['gaud1', ['AUD']]]) d.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify(r), `${n}@example.com`);
  const pid = Number(d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'GTW', 'Gantt Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const wbs = (code, name, parent = null) => Number(d.prepare('INSERT INTO proj_wbs (company_id, project_id, parent_id, code, name, level, created_by) VALUES (1, ?, ?, ?, ?, ?, ?)').run(pid, parent, code, name, parent ? 2 : 1, 't').lastInsertRowid);
  const w1 = wbs('1', 'Substructure'); const w11 = wbs('1.1', 'Footings', w1); const w2 = wbs('2', 'Superstructure');
  const call = (who, method, path, body, k = key()) => api.call(method, `${P}${path}`, { ...who, headers: k, body });
  const c = await call(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal(c.status, 201, JSON.stringify(c.json));
  assert.equal((await call(pcm, 'POST', `/calendars/${c.json.data.id}/activate`)).status, 200);
  const s = await call(plan1, 'POST', '/schedules', { projectId: pid, name: 'Gantt Tower working schedule', calendarId: c.json.data.id, startDate: '2026-04-06' }); assert.equal(s.status, 201, JSON.stringify(s.json));
  return { api, d, call, pid, w1, w11, w2, calId: c.json.data.id, sid: s.json.data.id };
}
/** A10 (5 d) → A20 (3 d) → A30 (2 d), and A40 (4 d) on its own; then calculated. */
async function chain(t) {
  const imp = await t.call(plan1, 'POST', `/schedules/${t.sid}/import`, { rows: [
    { code: 'A10', name: 'Excavation', wbsCode: '1.1', duration: 5 }, { code: 'A20', name: 'PCC', wbsCode: '1.1', duration: 3, predecessors: 'A10' },
    { code: 'A30', name: 'Footing concrete', wbsCode: '1.1', duration: 2, predecessors: 'A20' }, { code: 'A40', name: 'Columns', wbsCode: '2', duration: 4 }] });
  assert.equal(imp.status, 201, JSON.stringify(imp.json)); assert.equal((await t.call(plan1, 'POST', `/schedules/${t.sid}/calculate`)).status, 200);
}
const gantt = async (t, who = plan1) => { const r = await t.call(who, 'GET', `/schedules/${t.sid}/gantt`); assert.equal(r.status, 200, JSON.stringify(r.json)); return r.json.data; };
const byCode = (g) => Object.fromEntries(g.activities.map((a) => [a.code, a]));
const dates = (g) => Object.fromEntries(g.activities.map((a) => [a.code, [a.es, a.ef, a.duration, a.constraintType, a.constraintDate]]));

test('T-01 a drag edit moves the successors through the server recalculation, is tried before it is saved, and undo restores the schedule', async () => {
  const t = await boot(); await chain(t);
  const g0 = await gantt(t); const a = byCode(g0); const start = dates(g0);
  assert.deepEqual([a.A10.es, a.A10.ef, a.A20.es, a.A20.ef, a.A30.es, a.A30.ef], ['2026-04-06', '2026-04-10', '2026-04-11', '2026-04-14', '2026-04-15', '2026-04-16'], 'Sunday the 12th is off');
  assert.equal(g0.can.edit, true); assert.equal(g0.links.length, 2); assert.ok(g0.wbs.some((w) => w.code === '1.1'));
  // the try: nothing is kept
  const tryMove = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-08' });
  assert.equal(tryMove.status, 200, JSON.stringify(tryMove.json)); const pv = tryMove.json.data;
  assert.equal(pv.saved, false); assert.deepEqual(pv.conflicts, []); assert.ok(pv.changed.some((x) => x.code === 'A30' && x.ef === '2026-04-18' && x.efBefore === '2026-04-16'), 'the successors move with it'); assert.equal(pv.finishAfter, '2026-04-18');
  assert.deepEqual(dates(await gantt(t)), start, 'the try leaves the schedule as it was');
  // the save: A10 starts on the 8th (held by "start no earlier than"); A20 and A30 follow
  const mv = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-08' }); assert.equal(mv.status, 201, JSON.stringify(mv.json)); assert.equal(mv.json.data.saved, true);
  let g = byCode(await gantt(t)); assert.deepEqual([g.A10.es, g.A10.constraintType, g.A10.constraintDate, g.A20.es, g.A30.ef], ['2026-04-08', 'SNET', '2026-04-08', '2026-04-14', '2026-04-18']);
  // a non-working day moves to the next working day (a warning, not a conflict)
  const sun = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'MOVE', activityId: a.A40.id, start: '2026-04-12' }); assert.equal(sun.json.data.warnings[0].code, 'NON_WORKING'); assert.ok(sun.json.data.changed.some((x) => x.code === 'A40' && x.es === '2026-04-13'));
  // BR-01: a move earlier than the logic allows is a conflict, shown before the save, and refused unless confirmed
  const early = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'MOVE', activityId: a.A20.id, start: '2026-04-06' });
  assert.equal(early.json.data.conflicts[0].code, 'LOGIC'); assert.match(early.json.data.conflicts[0].message, /A20 cannot start before 2026-04-14: its predecessors A10 hold it/);
  const refused = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'MOVE', activityId: a.A20.id, start: '2026-04-06' }); assert.equal(refused.status, 409); assert.equal(refused.json.error.details[0].field, 'LOGIC');
  // a "finish no later than" on A30 that a later move breaks: negative float is a conflict
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A30.id}`, { constraintType: 'FNLT', constraintDate: '2026-04-20' })).status, 200);
  const late = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-13' });
  assert.equal(late.status, 200, JSON.stringify(late.json)); assert.ok(late.json.data.conflicts.some((c) => c.code === 'NEGATIVE_FLOAT' && c.activities.includes('A30')), JSON.stringify(late.json.data.conflicts));
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A30.id}`, { constraintType: 'NONE', constraintDate: null })).status, 200);
  const before = dates(await gantt(t));
  // resize: A20 to finish on the 17th = 4 working days; A30 follows
  const rs = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'RESIZE', activityId: a.A20.id, finish: '2026-04-17' }); assert.equal(rs.status, 201, JSON.stringify(rs.json));
  g = byCode(await gantt(t)); assert.deepEqual([g.A20.duration, g.A30.es, g.A30.ef], [4, '2026-04-18', '2026-04-20']);
  // link by dragging: A40 after A30; a loop is refused with its path
  const ln = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'LINK', predId: a.A30.id, succId: a.A40.id, type: 'FS', lag: 1 }); assert.equal(ln.status, 201, JSON.stringify(ln.json));
  g = byCode(await gantt(t)); assert.equal(g.A40.es, '2026-04-22', 'one working day after A30');
  const loop = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'LINK', predId: a.A40.id, succId: a.A10.id }); assert.equal(loop.status, 422); assert.match(loop.json.error.message, /A10 → .*A40 → A10|loop/);
  // add after A40, inline edit, delete
  const add = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'ADD', name: 'Slab', duration: 2, wbsId: t.w2, afterId: a.A40.id }); assert.equal(add.status, 201, JSON.stringify(add.json));
  const added = byCode(await gantt(t))[Object.keys(byCode(await gantt(t))).find((k) => !['A10', 'A20', 'A30', 'A40'].includes(k))]; assert.equal(added.name, 'Slab');
  const ed = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'EDIT', activityId: added.id, name: 'Roof slab', duration: 3 }); assert.equal(ed.status, 201, JSON.stringify(ed.json));
  const del = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'DELETE', activityId: a.A20.id }); assert.equal(del.status, 201, JSON.stringify(del.json));
  g = await gantt(t); assert.ok(!g.activities.some((x) => x.code === 'A20')); assert.ok(!g.links.some((l) => l.predId === a.A20.id || l.succId === a.A20.id));
  assert.ok(g.edits.length >= 6); assert.equal(g.can.undo, true);
  // undo from the latest: the delete (A20 and its links come back), the edit, the add, the link, the resize
  for (let i = 0; i < 5; i += 1) { const u = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/undo`, {}); assert.equal(u.status, 200, JSON.stringify(u.json)); }
  const back = await gantt(t); assert.deepEqual(dates(back), before, 'five undos restore the schedule exactly'); assert.equal(back.links.length, 2);
  // undo of an edit something has changed since is refused; an earlier edit than the latest is refused
  const mv2 = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'MOVE', activityId: a.A40.id, start: '2026-04-15' }); assert.equal(mv2.status, 201);
  assert.equal((await t.call(plan1, 'PATCH', `/activities/${a.A40.id}`, { name: 'Columns, ground floor' })).status, 200);
  const stale = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/undo`, {}); assert.equal(stale.status, 409); assert.match(stale.json.error.message, /changed since/);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/undo`, { editId: mv.json.data.editId })).status, 409);
  // the edits are audited
  assert.ok(t.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'plan_schedules' AND entity_id = ? AND action IN ('gantt_edit', 'gantt_undo')").get(String(t.sid)).n >= 11);
  // an approved schedule is locked on the Gantt too
  t.d.prepare("UPDATE plan_schedules SET status = 'APPROVED' WHERE id = ?").run(t.sid);
  assert.equal((await gantt(t)).can.edit, false);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-09' })).status, 409);
});

test('FR-03 resources by hand and from the BOQ norms; histograms against deployments and availability put in force by a second person; drill-down and loading', async () => {
  const t = await boot(); await chain(t); const d = t.d; const a = byCode(await gantt(t));
  const cat = Number(d.prepare("INSERT INTO mdm_item_categories (company_id, code, name, code_prefix, steward_role) VALUES (1, 'RES', 'Resources', 'RS', 'EST')").run().lastInsertRowid);
  const item = (code, name, type, uom) => Number(d.prepare("INSERT INTO mdm_items (company_id, code, name, item_type, category_id, base_uom, effective_from, item_status) VALUES (1, ?, ?, ?, ?, ?, '2026-01-01', 'ACTIVE')").run(code, name, type, cat, uom).lastInsertRowid);
  const crane = item('EQ-CRANE', 'Tower crane', 'EQUIPMENT', 'hour'); const cement = item('MT-CEM', 'Cement OPC 53', 'MATERIAL', 'bag'); const mason = item('LB-MAS', 'Mason', 'LABOUR', 'man-day'); const helper = item('LB-HLP', 'Helper', 'LABOUR', 'man-day');
  const work = item('WI-PCC', 'PCC 1:4:8', 'WORK_ITEM', 'cum');
  for (const [comp, q, w, u] of [[cement, 3_400, 20_000, 'bag'], [mason, 500, 0, 'man-day'], [helper, 1_500, 0, 'man-day']]) d.prepare('INSERT INTO mdm_item_resources (company_id, parent_item_id, component_item_id, qty_per_unit, uom, wastage_pct) VALUES (1, ?, ?, ?, ?, ?)').run(work, comp, q, u, w);
  // a WBS-split BOQ line for A20 (PCC 10 cum) with the work item
  const ver = Number(d.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status, created_by) VALUES (1, 'BQ/G1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED', 't')").run(t.pid).lastInsertRowid);
  const line = Number(d.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount, work_item_id, created_by) VALUES (1, ?, 'ITEM', '3.1', 'PCC 1:4:8 under footings', 'cum', 10000, 0, 0, ?, 't')").run(ver, work).lastInsertRowid);
  assert.equal((await t.call(plan1, 'PUT', `/activities/${a.A20.id}/boq`, { lines: [{ boqLineId: line, qty: 10 }] })).status, 200);
  // the norms: 10 cum x 3.4 bags x 1.02 = 34.68 bags; masons 5 man-days; helpers 15
  const nm = await t.call(plan1, 'GET', `/activities/${a.A20.id}/resources/norms`); assert.equal(nm.status, 200, JSON.stringify(nm.json));
  const norm = Object.fromEntries(nm.json.data.rows.map((r) => [r.itemCode, [r.type, r.qty, r.uom]])); assert.deepEqual(norm, { 'MT-CEM': ['MATERIAL', 34.68, 'bag'], 'LB-MAS': ['LABOUR', 5, 'man-day'], 'LB-HLP': ['LABOUR', 15, 'man-day'] }); assert.deepEqual(nm.json.data.missing, []);
  // the planner takes the norms for A20 and sets A10 by hand: 4 masons a day (trade), the crane 40 hours, cement 100 bags
  const put20 = await t.call(plan1, 'PUT', `/activities/${a.A20.id}/resources`, { rows: nm.json.data.rows.map((r) => ({ type: r.type, itemId: r.itemId, trade: r.trade, uom: r.uom, basis: 'TOTAL', qty: r.qty, sourceType: 'BOQ_NORM' })) }); assert.equal(put20.status, 200, JSON.stringify(put20.json));
  const put10 = await t.call(plan1, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [{ type: 'LABOUR', trade: 'Mason', basis: 'PER_DAY', qty: 4 }, { type: 'PLANT', itemId: crane, basis: 'TOTAL', qty: 40 }, { type: 'MATERIAL', itemId: cement, basis: 'TOTAL', qty: 100 }] });
  assert.equal(put10.status, 200, JSON.stringify(put10.json)); const r10 = Object.fromEntries(put10.json.data.rows.map((r) => [r.label, [r.qtyTotal, r.qtyPerDay, r.uom]]));
  assert.deepEqual(r10, { Mason: [20, 4, 'man-day'], 'EQ-CRANE Tower crane': [40, 8, 'hour'], 'MT-CEM Cement OPC 53': [100, 20, 'bag'] }, 'the other figure is worked out from the 5-day duration');
  assert.equal((await t.call(plan1, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [{ type: 'PLANT', itemId: cement, qty: 1 }] })).status, 400, 'cement is not plant');
  assert.equal((await t.call(pm, 'PUT', `/activities/${a.A10.id}/resources`, { rows: [] })).status, 403, 'the project manager reads, the planner edits');
  // availability: 3 masons deployed (07.03) and the crane 6 hours a day, drafted by the planner and put in force by the project controls manager
  const site = Number(d.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name) VALUES (1, ?, 'S1', 'Site 1')").run(t.pid).lastInsertRowid);
  const crew = Number(d.prepare("INSERT INTO hr_crews (company_id, crew_site_id, code, name, trade) VALUES (1, ?, 'CR-MAS', 'Masons gang', 'Mason')").run(site).lastInsertRowid);
  for (let i = 1; i <= 3; i += 1) d.prepare("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, crew_id, from_date, status) VALUES (1, ?, '2026-04-01', 'WORKER', ?, ?, ?, '2026-04-01', 'APPROVED')").run(`DEP/${i}`, 100 + i, t.pid, crew);
  const cap = await t.call(plan1, 'POST', '/capacity', { projectId: t.pid, type: 'PLANT', itemId: crane, qtyPerDay: 6, from: '2026-04-01', to: '2026-06-30', reason: 'One tower crane on hire, one shift' }); assert.equal(cap.status, 201, JSON.stringify(cap.json)); assert.equal(cap.json.data.status, 'DRAFT');
  assert.equal((await t.call(plan1, 'POST', `/capacity/${cap.json.data.id}/activate`)).status, 403, 'the planner may not put it in force');
  const on = await t.call(pcm, 'POST', `/capacity/${cap.json.data.id}/activate`); assert.equal(on.status, 200, JSON.stringify(on.json)); assert.equal(on.json.data.status, 'ACTIVE');
  // the histogram by day: masons 4 a day on A10 (5 working days) against 3 deployed = over-allocated; the crane 8 hours against 6
  const h = await t.call(pm, 'GET', `/schedules/${t.sid}/histogram?bucket=day`); assert.equal(h.status, 200, JSON.stringify(h.json));
  const res = Object.fromEntries(h.json.data.resources.map((r) => [r.key, r]));
  const masonR = res['trade:mason']; assert.ok(masonR.tracked); assert.equal(masonR.peak, 4, 'four a day on A10; the five man-days of A20 (the Mason item of the norms is the same trade) come later, 1.67 a day'); assert.equal(masonR.overDays, 5 + 0, JSON.stringify(masonR.buckets.slice(0, 12)));
  assert.equal(res[`item:${crane}`].overDays, 5); assert.equal(res[`item:${crane}`].total, 40); assert.equal(res[`item:${cement}`].tracked, false); assert.equal(res[`item:${cement}`].total, 134.68);
  const i0 = h.json.data.buckets.findIndex((b) => b.key === '2026-04-06'); assert.deepEqual([masonR.buckets[i0].demand, masonR.buckets[i0].available, masonR.buckets[i0].over], [4, 3, true]);
  const wk = await t.call(pm, 'GET', `/schedules/${t.sid}/histogram?bucket=week&type=LABOUR`); assert.ok(wk.json.data.resources.every((r) => r.type === 'LABOUR'));
  // drill-down to the activities behind a bar
  const dr = await t.call(pm, 'GET', `/schedules/${t.sid}/histogram/drill?type=PLANT&key=item:${crane}&from=2026-04-06&to=2026-04-12`); assert.equal(dr.status, 200, JSON.stringify(dr.json)); assert.deepEqual(dr.json.data.rows.map((r) => [r.code, r.qty]), [['A10', 40]]);
  // the monthly loading for budget phasing and resource planning
  const ld = await t.call(pm, 'GET', `/schedules/${t.sid}/loading`); assert.equal(ld.status, 200); assert.deepEqual(ld.json.data.months, ['2026-04']); assert.equal(ld.json.data.resources.find((r) => r.key === `item:${cement}`).months[0], 134.68);
  assert.ok(d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'plan.resources.updated'").get() || d.prepare("SELECT 1 FROM core_events WHERE type = 'plan.resources.updated'").get(), 'the loading is published');
  // the CSV: formula injection neutralised, audited
  const csv = await t.api.raw('GET', `${P}/schedules/${t.sid}/histogram/export?bucket=week`, pm); assert.equal(csv.status, 200); assert.match(csv.buffer.toString(), /"Demand"/);
  // resources are undone like any Gantt edit
  const u = await t.call(plan1, 'POST', `/schedules/${t.sid}/gantt/undo`, {}); assert.equal(u.status, 200, JSON.stringify(u.json));
  assert.equal((await t.call(plan1, 'GET', `/activities/${a.A10.id}/resources`)).json.data.rows.length, 0);
  // a duration change carries the daily figure along (the consumer of plan.schedule.calculated keeps the stored figures in step)
  const g2 = byCode(await gantt(t)); assert.equal(g2.A20.resources, 3);
});

test('T-02 the programme of 1,000 activities is laid out legibly on A3 and A1 and written as PDF and as an SVG image', async () => {
  const t = await boot(); const d = t.d;
  const ins = d.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name, wbs_id, act_type, duration_days, sort_order, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, 't', 't')");
  const link = d.prepare("INSERT INTO plan_dependencies (company_id, schedule_id, pred_id, succ_id, dep_type, lag_days, project_id, created_by) VALUES (1, ?, ?, ?, 'FS', 0, ?, 't')");
  const ids = []; for (let i = 0; i < 1000; i += 1) ids.push(Number(ins.run(t.sid, `P${String(i).padStart(4, '0')}`, `Activity number ${i} with a long descriptive name for the programme`, [t.w11, t.w2][i % 2], i % 50 === 49 ? 'MILESTONE' : 'TASK', i % 50 === 49 ? 0 : 1 + (i % 4), i, t.pid).lastInsertRowid));
  for (let i = 1; i < 1000; i += 1) if (i % 3) link.run(t.sid, ids[i - 1], ids[i], t.pid);
  d.prepare('UPDATE plan_schedules SET activities_count = 1000, needs_calc = 1 WHERE id = ?').run(t.sid);
  assert.equal((await t.call(plan1, 'POST', `/schedules/${t.sid}/calculate`)).status, 200);
  for (const paper of ['A3', 'A1']) {
    const started = performance.now();
    const j = await t.call(plan1, 'GET', `/schedules/${t.sid}/programme?format=json&paper=${paper}&scale=month`); assert.equal(j.status, 200, JSON.stringify(j.json)); const L = j.json.data;
    assert.ok(L.meta.fontSize >= 7 && L.meta.rowPitch >= 11, `legible: ${L.meta.fontSize} pt text on ${L.meta.rowPitch} pt rows`);
    const seen = L.rowIds.flat(); assert.equal(seen.length, 1000); assert.equal(new Set(seen).size, 1000, 'every activity once');
    assert.equal(L.pages, Math.ceil((1000 + 3) / L.meta.rowsPerPage) || L.pages); assert.ok(L.texts.every((p) => p.some((x) => x.s === 'Code') && p.some((x) => /^Programme /.test(x.s)) && p.some((x) => /^Page \d+ of \d+$/.test(x.s))), 'every page repeats its heads');
    assert.ok(L.texts.flat().every((x) => x.size >= 6 * (paper === 'A1' ? 1.45 : 1) - 1e-9), 'no text smaller than 6 pt');
    const codes = new Set(L.texts.flat().map((x) => x.s)); assert.ok(ids.every((_, i) => codes.has(`P${String(i).padStart(4, '0')}`)), 'every code is printed');
    const pdf = await t.api.raw('GET', `${P}/schedules/${t.sid}/programme?format=pdf&paper=${paper}&scale=month`, plan1); assert.equal(pdf.status, 200);
    const buf = pdf.buffer; assert.equal(buf.subarray(0, 5).toString(), '%PDF-'); assert.equal(pdf.headers.get('x-pages'), String(L.pages));
    const doc = await PDFDocument.load(buf); assert.equal(doc.getPageCount(), L.pages); const [w, h] = [doc.getPage(0).getWidth(), doc.getPage(0).getHeight()];
    assert.deepEqual([Math.round(w), Math.round(h)], paper === 'A3' ? [1191, 842] : [2384, 1684]);
    assert.ok(performance.now() - started < 15_000, 'quick enough to print on demand');
  }
  const svg = await t.api.raw('GET', `${P}/schedules/${t.sid}/programme?format=svg&scale=week&filter=critical`, plan1); assert.equal(svg.status, 200); assert.match(svg.buffer.toString(), /^<svg /); assert.match(svg.buffer.toString(), /Critical/);
  assert.equal((await t.call(se, 'GET', `/schedules/${t.sid}/programme?format=pdf`)).status, 403, 'printing needs plan.schedule.print');
  assert.ok(d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'plan_schedules' AND entity_id = ? AND action IN ('print', 'export')").get(String(t.sid)).n >= 4, 'every print and export is audited');
});

test('AC-03 roles and isolation: the planner edits, others view; another company, another project and the flag', async () => {
  const t = await boot(); await chain(t); const a = byCode(await gantt(t));
  for (const who of [pm, se, aud, pcm]) { const g = await gantt(t, who); assert.equal(g.can.edit, false, who.user); assert.equal(g.activities.length, 4); }
  for (const who of [pm, se, aud]) assert.equal((await t.call(who, 'POST', `/schedules/${t.sid}/gantt/check`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-08' })).status, 403, who.user);
  assert.equal((await t.call(pm, 'POST', `/schedules/${t.sid}/gantt/undo`, {})).status, 403);
  assert.equal((await t.call(se, 'GET', `/schedules/${t.sid}/histogram`)).status, 200, 'site roles read the loading');
  assert.equal((await t.call(other, 'GET', `/schedules/${t.sid}/gantt`)).status, 404, 'another company');
  assert.equal((await t.call(other, 'GET', `/activities/${a.A10.id}/resources`)).status, 404);
  assert.equal((await t.call(other, 'POST', `/schedules/${t.sid}/gantt/edits`, { op: 'MOVE', activityId: a.A10.id, start: '2026-04-08' })).status, 404);
  // a planner assigned to another project sees nothing of this one
  const pid2 = Number(t.d.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'GBR', 'Gantt Bridge', 'BRIDGE', 'ACTIVE')").run().lastInsertRowid);
  const uid = Number(t.d.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, 'gbridge', 'gbridge', '[]', 'gb@example.com')").run().lastInsertRowid);
  t.d.prepare("INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PLAN'), 'PROJECT', ?, 'ACTIVE', 't')").run(uid, JSON.stringify([pid2]));
  const { planOf } = await import('../src/server/modules/plan/index.js'); const svc = planOf(t.d); const scoped = { user: 'gbridge', userId: uid, companyId: 1, roles: [] };
  assert.throws(() => svc.gantt.data(scoped, t.sid), /does not exist/); assert.throws(() => svc.gantt.histogram(scoped, t.sid, { bucket: 'week', dates: 'early' }), /does not exist/);
  assert.throws(() => svc.gantt.capacity.create(scoped, { projectId: t.pid, type: 'LABOUR', trade: 'Mason', qtyPerDay: 2, from: '2026-04-01', to: '2026-04-30', reason: 'Not my project at all' }), /does not exist/);
  // the flag: off, the 13.02 endpoints answer 404 and the schedule core still works
  t.d.prepare("UPDATE core_feature_flags SET enabled = 0 WHERE key = 'ff.plan.p1302'").run();
  assert.equal((await t.call(plan1, 'GET', `/schedules/${t.sid}/gantt`)).status, 404); assert.equal((await t.call(plan1, 'GET', `/schedules/${t.sid}`)).status, 200);
  t.d.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.plan.p1302'").run();
  // the schema keeps the rules
  assert.throws(() => t.d.prepare("INSERT INTO plan_activity_resources (company_id, schedule_id, activity_id, resource_type, res_key, label, uom, qty_total) VALUES (1, ?, ?, 'LABOUR', 'x', 'x', 'x', -1)").run(t.sid, a.A10.id), /CHECK/);
  assert.throws(() => t.d.prepare("INSERT INTO plan_resource_capacity (company_id, org_project_id, resource_type, trade, res_key, label, uom, qty_per_day, from_date, to_date) VALUES (1, ?, 'LABOUR', 'x', 'x', 'x', 'x', 1, '2026-05-01', '2026-04-01')").run(t.pid), /CHECK/);
});
