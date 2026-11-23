import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { todayIST } from '../src/shared/dates.js';
import { isoOf, ordOf } from '../src/server/modules/plan/cpm.js';

// Part 27.11: scenario and what-if simulation.
// T-01 steel +10 % changes the EAC by remaining steel quantity × 10 % × rate; BR-01 a scenario never modifies live records (forecast, schedule,
// cash forecast unchanged); FR-02 completion date by recalculating a copy of the schedule, margin, 13-week cash; FR-03 compare, share, turn into a
// task or a forecast assumption; roles and scope; validation; 409; flag off.
const S = '/api/v1/bi/scenarios';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `scn-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const cfo = as('CFO', 'sc-cfo'); const dir = as('DIR', 'sc-dir'); const pcm = as('PCMGR', 'sc-pcm'); const plan1 = as('PLAN', 'sc-plan'); const se = as('SE', 'sc-se');
const TODAY = todayIST(); const day = (n) => isoOf(ordOf(TODAY) - n);
const monday = (() => { const d = new Date(`${TODAY}T00:00:00Z`); const k = (d.getUTCDay() + 6) % 7; return isoOf(ordOf(TODAY) - k); })();

async function setup({ flag = true } = {}) {
  const api = await startApi(); opened.push(api); await setupCompany(api); const { db } = api;
  for (const [n, r] of [['sc-cfo', 'CFO'], ['sc-dir', 'DIR'], ['sc-pcm', 'PCMGR'], ['sc-plan', 'PLAN'], ['sc-se', 'SE'], ['sc-pd', 'PD']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  const fl = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Scenario fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703', ...(flag ? ['ff.bi.p2711'] : [])]) fl.run(code);
  db.exec("INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)");
  const pid = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'SC-P', 'Scenario Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  const other = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'SC-Q', 'Other Tower', 'BUILDING', 'ACTIVE')").run().lastInsertRowid);
  // the schedule through the planning API: A10 (20 days) → A20 (10 days) → M1
  const pcall = (who, method, path, body) => api.call(method, `/api/v1/plan${path}`, { ...who, headers: key(), body });
  const cal = await pcall(plan1, 'POST', '/calendars', { code: 'SIX', name: 'Six-day week', workWeek: '1111110', reason: 'The site works Monday to Saturday' }); assert.equal((await pcall(pcm, 'POST', `/calendars/${cal.json.data.id}/activate`)).status, 200);
  const sch = await pcall(plan1, 'POST', '/schedules', { projectId: pid, name: 'Tower schedule', calendarId: cal.json.data.id, startDate: day(10) }); const sid = sch.json.data.id;
  const imp = await pcall(plan1, 'POST', `/schedules/${sid}/import`, { rows: [{ code: 'A10', name: 'Excavation', duration: 20 }, { code: 'A20', name: 'Raft concrete', duration: 10, predecessors: 'A10' }, { code: 'M1', name: 'Raft complete', duration: 0, predecessors: 'A20' }] });
  assert.equal(imp.status, 201, JSON.stringify(imp.json)); await pcall(plan1, 'POST', `/schedules/${sid}/calculate`);
  // the approved cost forecast: steel (40 t to go at ₹ 60,000 a tonne), labour, concrete
  const heads = { STL: 'Steel', LAB: 'Labour', CON: 'Concrete' }; const codes = {};
  for (const [c, n] of Object.entries(heads)) { const h = Number(db.prepare('INSERT INTO fin_cost_heads (company_id, code, name) VALUES (1, ?, ?)').run(`H-${c}`, n).lastInsertRowid); codes[c] = Number(db.prepare('INSERT INTO fin_cost_codes (company_id, code, name, cost_head_id) VALUES (1, ?, ?, ?)').run(`${c}-01`, n, h).lastInsertRowid); }
  const fc = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, eac_total_paise, contract_revenue_paise, status) VALUES (1, 'FC-SC', ?, ?, 1, 100000000, 120000000, 'APPROVED')").run(pid, TODAY.slice(0, 7)).lastInsertRowid);
  const line = db.prepare('INSERT INTO fc_forecast_lines (company_id, forecast_id, cost_code_id, line_label, budget_paise, budget_qty_milli, actual_paise, actual_qty_milli, etc_method, remaining_qty_milli, rate_x100, etc_paise, eac_paise) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  line.run(fc, codes.STL, 'TMT steel', 60000000, 100000, 36000000, 60000, 'BOTTOM_UP', 40000, 6000000, 24000000, 60000000);
  line.run(fc, codes.LAB, 'Labour gangs', 30000000, 0, 15000000, 0, 'REMAINING_BUDGET', null, null, 15000000, 30000000);
  line.run(fc, codes.CON, 'Ready-mix concrete', 10000000, 0, 5000000, 0, 'REMAINING_BUDGET', null, null, 5000000, 10000000);
  // the approved 13-week cash forecast: ₹ 10 lakh opening, a collection of ₹ 30 lakh in week 3 for the project, payments of ₹ 5 lakh a week
  const cf = Number(db.prepare("INSERT INTO cf_forecasts (company_id, doc_no, version_no, week_start, weeks, opening_paise, status) VALUES (1, 'CF-SC', 1, ?, 13, 100000000, 'APPROVED')").run(monday).lastInsertRowid);
  const cl = db.prepare('INSERT INTO cf_lines (company_id, forecast_id, org_project_id, category, week_start, inflow_paise, outflow_paise) VALUES (1, ?, ?, ?, ?, ?, ?)');
  cl.run(cf, pid, 'AR_OPEN', isoOf(ordOf(monday) + 14), 300000000, 0);
  for (let k = 0; k < 13; k += 1) cl.run(cf, pid, 'AP_DUE', isoOf(ordOf(monday) + 7 * k), 0, 50000000);
  const fingerprint = () => createHash('sha256').update(JSON.stringify([db.prepare('SELECT * FROM fc_forecasts ORDER BY id').all(), db.prepare('SELECT * FROM fc_forecast_lines ORDER BY id').all(),
    db.prepare('SELECT * FROM plan_activities ORDER BY id').all(), db.prepare('SELECT * FROM plan_schedules ORDER BY id').all(), db.prepare('SELECT * FROM cf_lines ORDER BY id').all(), db.prepare('SELECT * FROM cf_forecasts ORDER BY id').all()])).digest('hex');
  const call = (who, method, path, body) => api.call(method, path, { ...who, headers: key(), body });
  return { api, db, pid, other, fingerprint, call };
}

test('T-01 BR-01 FR-02 steel +10 % changes the EAC by remaining qty × 10 % × rate; delay moves the completion; collections moved; live records unchanged', async () => {
  const t = await setup();
  const before = t.fingerprint();
  const steel = await t.call(cfo, 'POST', `${S}/preview`, { projectId: t.pid, drivers: [{ type: 'MATERIAL_PRICE', match: 'steel', pct: 10 }] });
  assert.equal(steel.status, 200, JSON.stringify(steel.json));
  assert.equal(steel.json.data.cost.eacDelta, 40 * 60000 * 0.1, 'remaining 40 t × ₹60,000 × 10 % = ₹2,40,000');
  assert.equal(steel.json.data.cost.eac, 1_000_000 + 240_000); assert.equal(steel.json.data.cost.marginDelta, -240_000);
  // a full scenario: steel +10 %, wages +8 %, A20 late 5 days at ₹20,000 a day of overhead, collections 2 weeks late, floor ₹0
  const body = { name: 'Monsoon squeeze', projectId: t.pid, overheadPerDay: 20000, save: true, drivers: [{ type: 'MATERIAL_PRICE', match: 'steel', pct: 10 }, { type: 'WAGE_RATE', pct: 8 },
    { type: 'SCHEDULE_DELAY', activity: 'A20', days: 5 }, { type: 'CLIENT_PAYMENT_DELAY', weeks: 2 }, { type: 'CASH_CONSTRAINT', minBalance: 0 }] };
  const made = await t.call(cfo, 'POST', S, body); assert.equal(made.status, 201, JSON.stringify(made.json));
  const r = made.json.data.results;
  assert.equal(r.cost.lines.find((l) => l.label === 'Labour gangs').delta, 150_000 * 0.08, 'labour to complete ₹1,50,000 × 8 %');
  assert.ok(r.schedule.shiftDays > 0 && r.schedule.finish > r.schedule.baseFinish, JSON.stringify(r.schedule));
  assert.equal(r.cost.eacDelta, 240_000 + 12_000 + r.schedule.shiftWorkingDays * 20_000, 'steel + labour + overhead of the working days lost');
  assert.equal(r.cash.collectionsShiftedWeeks, 2); assert.ok(r.cash.lowest < r.cash.baseLowest); assert.ok(r.cash.weeksBelowFloor.length > 0);
  assert.equal(r.cash.series.length, 13);
  assert.equal(t.fingerprint(), before, 'BR-01: the forecast, the schedule and the cash forecast are unchanged');
  // validation, version conflict
  assert.equal((await t.call(cfo, 'POST', S, { ...body, drivers: [{ type: 'MATERIAL_PRICE', match: 'steel', pct: 900 }] })).status, 400);
  assert.equal((await t.call(cfo, 'POST', S, { ...body, drivers: [{ type: 'TELEPORT' }] })).status, 400);
  const id = made.json.data.id;
  assert.equal((await t.call(cfo, 'PATCH', `${S}/${id}`, { drivers: [{ type: 'WAGE_RATE', pct: 5 }], rowVersion: 99 })).status, 409);
  const upd = await t.call(cfo, 'PATCH', `${S}/${id}`, { drivers: [{ type: 'WAGE_RATE', pct: 5 }], rowVersion: made.json.data.rowVersion });
  assert.equal(upd.status, 200); assert.equal(upd.json.data.summary.eacDelta, 7500);
  assert.equal(t.fingerprint(), before);
});

test('FR-03 compare, share, convert into a task or a forecast assumption; roles and scope; flag off', async () => {
  const t = await setup();
  const mk = async (who, name, drivers) => (await t.call(who, 'POST', S, { name, projectId: t.pid, drivers, save: true })).json.data;
  const a = await mk(cfo, 'Steel up', [{ type: 'MATERIAL_PRICE', match: 'steel', pct: 10 }]);
  const b = await mk(cfo, 'Steel and delay', [{ type: 'MATERIAL_PRICE', match: 'steel', pct: 10 }, { type: 'SCHEDULE_DELAY', days: 10 }]);
  const cmp = await t.call(cfo, 'GET', `${S}/compare?ids=${a.id},${b.id}`); assert.equal(cmp.status, 200);
  assert.deepEqual(cmp.json.data.scenarios.map((s) => s.docNo), [a.docNo, b.docNo]); assert.equal(cmp.json.data.base.eac, 1_000_000);
  assert.ok(cmp.json.data.scenarios[1].schedule.shiftDays > 0 && cmp.json.data.scenarios[0].schedule.shiftDays === 0);
  const x = await t.api.raw('GET', `${S}/compare/export?ids=${a.id},${b.id}&format=csv`, cfo); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /Steel and delay/);
  // another CFO-level role does not see a draft of someone else; sharing gives it
  const d = (await t.call(cfo, 'POST', S, { name: 'Private draft', projectId: t.pid, drivers: [{ type: 'WAGE_RATE', pct: 3 }] })).json.data;
  assert.equal((await t.call(dir, 'GET', `${S}/${d.id}`)).status, 404);
  assert.equal((await t.call(cfo, 'PUT', `${S}/${d.id}/share`, { users: ['sc-dir', 'ghost'] })).status, 400);
  assert.equal((await t.call(cfo, 'PUT', `${S}/${d.id}/share`, { users: ['sc-dir'] })).status, 200);
  assert.equal((await t.call(dir, 'GET', `${S}/${d.id}`)).status, 200);
  assert.equal((await t.call(dir, 'PATCH', `${S}/${d.id}`, { name: 'Mine now', rowVersion: 2 })).status, 403, 'only the author changes it');
  // turn into actions
  const task = await t.call(cfo, 'POST', `${S}/${b.id}/actions`, { kind: 'TASK', assignee: 'sc-pcm', note: 'Lock steel rates with the rate contract before the monsoon' });
  assert.equal(task.status, 201, JSON.stringify(task.json)); assert.ok(task.json.data.actions[0].taskId);
  assert.ok(t.db.prepare("SELECT 1 FROM tsk_tasks WHERE entity = 'scn_scenario' AND entity_id = ?").get(String(b.id)) || t.db.prepare("SELECT 1 FROM tsk_tasks WHERE entity = 'scn_scenario'").get());
  const asm = await t.call(cfo, 'POST', `${S}/${b.id}/actions`, { kind: 'ASSUMPTION', assignee: 'sc-pcm', note: 'Carry steel +10 % in the next forecast' });
  assert.equal(asm.status, 201);
  assert.ok(t.db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bi.scenario.assumption_proposed'").get());
  assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM fc_forecasts").get().n, 1, 'the forecast is not touched by the assumption');
  // roles
  assert.equal((await t.call(se, 'GET', S)).status, 403);
  assert.equal((await t.call(se, 'POST', `${S}/preview`, { projectId: t.pid, drivers: [{ type: 'WAGE_RATE', pct: 5 }] })).status, 403);
  assert.equal((await t.call(pcm, 'GET', `${S}/${a.id}`)).status, 200, 'a saved scenario is visible to the roles that share scenarios');
  // scope: a PD assigned to the other project cannot model this one
  authzOf(t.db).seed();
  const uid = t.db.prepare("SELECT id FROM iam_users WHERE username = 'sc-pd'").get().id;
  t.db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by) VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PD' AND company_id IS NULL), 'PROJECT', ?, 'ACTIVE', 'test')`).run(uid, JSON.stringify([t.other]));
  authzOf(t.db).invalidate();
  const { createScenarios } = await import('../src/server/modules/bi/scenarios.js');
  const { createFlagService } = await import('../src/server/modules/core/api.js');
  const svc = createScenarios({ db: t.db, flags: createFlagService({ db: t.db, environment: 'test' }) });
  const scoped = authzOf(t.db).enrich({ companyId: 1, userId: uid, user: 'sc-pd', roles: [] });
  assert.throws(() => svc.preview(scoped, { projectId: t.pid, drivers: [{ type: 'WAGE_RATE', pct: 5 }] }), { status: 404 });
  assert.equal(svc.list(scoped, {}).rows.length, 0);
  const off = await setup({ flag: false });
  assert.equal((await off.call(cfo, 'GET', S)).status, 404);
});

test('volume: 100,000 scenarios, the list stays fast and filters use an index', async () => {
  const t = await setup();
  const ins = t.db.prepare("INSERT INTO scn_scenarios (company_id, doc_no, name, project_id, drivers_json, status, created_by) VALUES (1, ?, 'Bulk', ?, '[]', 'SAVED', ?)");
  t.db.exec('BEGIN'); for (let i = 0; i < 100_000; i += 1) ins.run(`BLK-${i}`, i % 2 ? t.pid : t.other, i % 3 ? 'sc-cfo' : 'sc-dir'); t.db.exec('COMMIT');
  const times = [];
  for (let i = 0; i < 5; i += 1) { const s = performance.now(); const r = await t.call(cfo, 'GET', `${S}?projectId=${t.pid}`); times.push(performance.now() - s); assert.equal(r.status, 200); }
  times.sort((a, b) => a - b); assert.ok(times[4] < 1500, `p100 ${times[4]} ms`);
  const plan = t.db.prepare("EXPLAIN QUERY PLAN SELECT * FROM scn_scenarios WHERE company_id = 1 AND status = 'SAVED'").all().map((x) => x.detail).join(' ');
  assert.match(plan, /USING INDEX/);
});
