import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { executionOf } from '../src/server/modules/bi/execution.js';
import { authzOf } from '../src/server/platform/authz/index.js';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { todayIST } from '../src/shared/dates.js';
import { setupCompany, startApi } from './helpers.js';

// Part 27.06: daily execution intelligence. T-01 the work-done value of the test day equals Σ approved DPR quantity × contract rate; BR-01 a
// DPR that is not approved adds nothing; FR-01 the budget-cost view is masked without bi.execution.cost; FR-02 WIP (executed not certified),
// the billed gap and the balance from the 22.02 chain; FR-03 snapshots kept per day and site, recomputed when a DPR is approved; FR-04 labour,
// plant, hindrances; roles and site scope; export; volume.
const B = '/api/v1/bi';
let seq = 0;
const key = () => ({ 'content-type': 'application/json', 'idempotency-key': `ex-${Date.now().toString(36)}-${(seq += 1)}` });
const as = (roles, user) => ({ roles, user, company: '1' });
const dir = as('DIR', 'ex-dir'); const qs = as('QS', 'ex-qs'); const se = as('SE', 'ex-se');
const opened = [];
after(async () => { for (const a of opened) await a.close(); });

async function setup() {
  const api = await startApi();
  opened.push(api);
  await setupCompany(api);
  const { db } = api;
  for (const [n, r] of [['ex-dir', 'DIR'], ['ex-qs', 'QS'], ['ex-pm', 'PM'], ['ex-se', 'SE']]) db.prepare('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)').run(n, n, JSON.stringify([r]), `${n}@example.com`);
  const flag = db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'Execution fixture', 0, 1)");
  for (const code of ['ff.bi.p2701', 'ff.bi.p2702', 'ff.bi.p2703']) flag.run(code);
  db.exec(`INSERT INTO hr_gates (company_id, code, name, status, catalogue_version, passed_at) VALUES (1,'G1','Platform','PASSED','test',CURRENT_TIMESTAMP),(1,'G2','Workforce','PASSED','test',CURRENT_TIMESTAMP)`);
  const today = todayIST();
  const project = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, 'EX-P', 'Elevated corridor', 'ROAD', 'ACTIVE')").run().lastInsertRowid);
  const site = (code) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(project, code, `${code} site`).lastInsertRowid);
  const s1 = site('EX-S1'); const s2 = site('EX-S2');
  // BOQ: concrete ₹6,500.0000/m³ (rate ×10⁴), steel ₹72.5000/kg
  const version = Number(db.prepare("INSERT INTO proj_boq_versions (company_id, doc_no, org_project_id, vtype, version_no, name, status) VALUES (1, 'BOQ-1', ?, 'CONTRACT', 1, 'Contract BOQ', 'APPROVED')").run(project).lastInsertRowid);
  const line = (code, desc, uom, qty, rate) => Number(db.prepare("INSERT INTO proj_boq_lines (company_id, version_id, line_kind, item_code, description, uom, qty, rate, amount) VALUES (1, ?, 'ITEM', ?, ?, ?, ?, ?, 0)").run(version, code, desc, uom, qty, rate).lastInsertRowid);
  const concrete = line('3.1', 'M35 concrete in piers', 'm3', 1_000_000, 65_000_000); // 1,000 m³
  const steel = line('5.2', 'Reinforcement steel', 'kg', 100_000_000, 725_000); // 100,000 kg
  const calendar = Number(db.prepare("INSERT INTO plan_calendars (company_id, code, name) VALUES (1, 'EX-CAL', 'Six-day week')").run().lastInsertRowid);
  const schedule = Number(db.prepare("INSERT INTO plan_schedules (company_id, doc_no, doc_date, org_project_id, name, calendar_id, start_date) VALUES (1, 'SCH-1', ?, ?, 'Master', ?, ?)").run(today, project, calendar, today).lastInsertRowid);
  const activity = (code) => Number(db.prepare("INSERT INTO plan_activities (company_id, schedule_id, code, name) VALUES (1, ?, ?, ?)").run(schedule, code, `${code} activity`).lastInsertRowid);
  const pier = activity('PIER-1'); const rebar = activity('REBAR-1');
  db.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty) VALUES (1, ?, ?, ?)').run(pier, concrete, 1_000_000);
  db.prepare('INSERT INTO plan_activity_boq (company_id, activity_id, boq_line_id, qty) VALUES (1, ?, ?, ?)').run(rebar, steel, 100_000_000);
  const wa = (no, siteId, act) => Number(db.prepare("INSERT INTO site_work_authorisations (company_id, wa_no, org_project_id, wa_site_id, plan_date, activity_id, planned_qty, start_time, end_time, supervisor, status) VALUES (1, ?, ?, ?, ?, ?, 1000, '08:00', '18:00', 'sup', 'APPROVED')").run(no, project, siteId, today, act).lastInsertRowid);
  const dpr = (no, siteId, status) => Number(db.prepare("INSERT INTO site_dprs (company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, status) VALUES (1, ?, ?, ?, ?, 'sup', ?)").run(no, project, siteId, today, status).lastInsertRowid);
  const work = (dprId, waId, act, qty, planned) => db.prepare('INSERT INTO site_dpr_work (company_id, dpr_id, wa_id, activity_id, qty, planned_qty) VALUES (1, ?, ?, ?, ?, ?)').run(dprId, waId, act, qty, planned);
  const d1 = dpr('DPR-S1', s1, 'APPROVED');
  work(d1, wa('WA-1', s1, pier), pier, 42_500, 50_000); // 42.5 m³ (plan 50)
  work(d1, wa('WA-2', s1, rebar), rebar, 3_200_000, 3_000_000); // 3,200 kg (plan 3,000)
  db.prepare("INSERT INTO site_dpr_labour (company_id, dpr_id, category, trade_code, headcount, man_days) VALUES (1, ?, 'CONTRACT', 'MASON', 18, 18000)").run(d1);
  db.prepare("INSERT INTO site_dpr_equipment (company_id, dpr_id, equipment_key, label, hours_worked, hours_idle, hours_breakdown) VALUES (1, ?, 'TM-01', 'Transit mixer', 7500, 1500, 0)").run(d1);
  const d2 = dpr('DPR-S2', s2, 'APPROVED');
  work(d2, wa('WA-3', s2, pier), pier, 10_000, 20_000); // 10 m³ (plan 20)
  const s3 = site('EX-S3');
  const draft = dpr('DPR-S3', s3, 'SUBMITTED');
  work(draft, wa('WA-4', s3, pier), pier, 5_000, 0); // 5 m³, not yet approved
  // approved budget: concrete costs ₹5,200/m³ on the BOQ line (₹52,00,000 for 1,000 m³); steel has no budget line
  const budget = Number(db.prepare("INSERT INTO bud_budgets (company_id, doc_no, doc_date, org_project_id, name, status) VALUES (1, 'BUD-1', ?, ?, 'Original budget', 'APPROVED')").run(today, project).lastInsertRowid);
  db.prepare("INSERT INTO bud_lines (company_id, budget_id, line_kind, boq_line_id, resource_name, qty, rate, amount) VALUES (1, ?, 'DIRECT', ?, 'Concrete', 1000000, 0, 520000000)").run(budget, concrete);
  // a certified measurement of 30 m³ of concrete
  db.prepare("INSERT INTO bill_mb_entries (company_id, doc_no, org_project_id, boq_line_id, description, qty_th, certified_qty_th, measured_by, measured_on, status) VALUES (1, 'MB-1', ?, ?, 'Pier P1', 30000, 30000, 'qs', ?, 'APPROVED')").run(project, concrete, today);
  db.prepare("INSERT INTO site_hindrances (company_id, doc_no, org_project_id, hin_site_id, title, hin_type, start_date, responsible_party, status) VALUES (1, 'HIN-1', ?, ?, 'Utility line on pier P4', 'UTILITY_SHIFTING', ?, 'AUTHORITY', 'APPROVED')").run(project, s2, today);
  const get = (who, path) => api.call('GET', B + path, who);
  const post = (who, path, body, k = key()) => api.call('POST', B + path, { ...who, body, headers: k });
  return { api, db, project, s1, s2, today, get, post, dprDraft: draft };
}

test('27.06 work done = Σ approved DPR quantity × contract rate; cost view masked; WIP, gap, balance; labour, plant, hindrances; scope; export', async () => {
  const t = await setup();
  const { db } = t;
  assert.equal((await t.get(dir, '/execution')).status, 404, 'behind ff.bi.p2706');
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2706', 1, 'Execution fixture', 0, 1)").run();
  assert.equal((await t.get(se, '/execution')).status, 403, 'a site engineer has no execution intelligence');
  assert.equal((await t.post(qs, '/execution/captures', { date: t.today })).status, 403, 'a QS does not recompute');
  const queued = await t.post(dir, '/execution/captures', { date: t.today });
  assert.equal(queued.status, 202, JSON.stringify(queued.json));
  const { jobs } = runtimeOf(db);
  for (let i = 0; i < 10 && jobs.get(queued.json.data.id).status === 'QUEUED'; i += 1) await jobs.runNext();
  assert.equal(jobs.get(queued.json.data.id).status, 'SUCCEEDED', JSON.stringify(jobs.get(queued.json.data.id)));

  // T-01: 42.5 m³ × ₹6,500 + 3,200 kg × ₹72.50 at site 1 = ₹2,76,250 + ₹2,32,000; 10 m³ × ₹6,500 at site 2 = ₹65,000; the submitted DPR adds nothing (BR-01)
  const expected = 42.5 * 6500 + 3200 * 72.5 + 10 * 6500;
  const res = await t.get(dir, `/execution?date=${t.today}`);
  assert.equal(res.status, 200, JSON.stringify(res.json));
  const d = res.json.data;
  assert.equal(d.tiles.executed, expected);
  assert.equal(d.tiles.planned, 50 * 6500 + 3000 * 72.5 + 20 * 6500);
  const sites = Object.fromEntries(d.sites.map((s) => [s.siteId, s]));
  assert.equal(sites[t.s1].executed, 276250 + 232000);
  assert.equal(sites[t.s2].executed, 65000);
  assert.equal(sites[t.s2].achievedPct, 50);
  // FR-01 internal view: only concrete has a budget line, so the site-1 cost (steel unknown) and the day's total cost are unknown; site 2 is 10 × ₹5,200
  assert.equal(sites[t.s2].cost, 52000);
  assert.equal(d.tiles.cost, null);
  // FR-02: executed 52.5 m³ concrete and 3,200 kg steel; certified 30 m³ → WIP = 22.5 × 6,500 + 3,200 × 72.5; nothing billed
  assert.equal(d.tiles.wip, 22.5 * 6500 + 3200 * 72.5);
  assert.equal(d.tiles.billedGap, expected);
  assert.equal(d.tiles.cumulative, expected);
  assert.equal(d.tiles.balance, (1000 - 52.5) * 6500 + (100000 - 3200) * 72.5);
  // FR-04
  assert.deepEqual([d.tiles.labour, d.tiles.plantHours, d.tiles.idleHours, d.tiles.hindrances], [18, 7.5, 1.5, 1]);
  assert.deepEqual(d.exceptions.map((e) => e.kind).sort(), ['BEHIND_PLAN', 'HINDRANCE']);

  // the valuation report of site 1: item by item, with DPR drill
  const v = (await t.get(dir, `/execution/valuation?projectId=${t.project}&siteId=${t.s1}&date=${t.today}`)).json.data;
  assert.deepEqual(v.items.map((i) => [i.code, i.qty, i.rate, i.value, i.cost]), [['3.1', 42.5, 6500, 276250, 221000], ['5.2', 3200, 72.5, 232000, null]]);
  assert.equal(v.items[0].margin, 55250);
  assert.match(v.items[0].dprs[0].route, /^\/site\/dprs\?id=\d+$/);
  // a QS sees the values but not the budget cost or margin
  const vq = (await t.get(qs, `/execution/valuation?projectId=${t.project}&siteId=${t.s1}&date=${t.today}`)).json.data;
  assert.deepEqual([vq.items[0].cost, vq.items[0].margin, vq.totals.cost, vq.costVisible], [null, null, null, false]);
  assert.equal((await t.get(qs, `/execution?date=${t.today}`)).json.data.tiles.margin, null);
  const csv = await t.api.raw('GET', `${B}/execution/valuation/export?projectId=${t.project}&date=${t.today}&format=csv`, qs);
  assert.equal(csv.status, 200);
  assert.doesNotMatch(csv.buffer.toString('utf8'), /Budget cost/);
  assert.ok(db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'bi.execution_valuation'").get());
  assert.equal((await t.get(dir, '/execution/valuation?date=2026-01-01')).status, 400, 'a project is required');

  // site scope: a PM assigned to site 2 only sees site 2
  authzOf(db).seed();
  const userId = db.prepare("SELECT id FROM iam_users WHERE username = 'ex-pm'").get().id;
  db.prepare(`INSERT INTO iam_assignments (company_id, user_id, role_id, scope_type, scope_ids_json, status, created_by)
    VALUES (1, ?, (SELECT id FROM iam_roles WHERE code = 'PM' AND company_id IS NULL), 'SITE', ?, 'ACTIVE', 'test')`).run(userId, JSON.stringify([t.s2]));
  authzOf(db).invalidate();
  const scoped = authzOf(db).enrich({ companyId: 1, userId, user: 'ex-pm', roles: [] });
  const sv = executionOf(db).overview(scoped, { date: t.today });
  assert.deepEqual(sv.sites.map((s) => s.siteId), [t.s2]);
  assert.equal(sv.tiles.executed, 65000);
  assert.equal(sv.tiles.wip, 0, 'project-level WIP needs a project grant');
  assert.throws(() => executionOf(db).valuation(scoped, { projectId: t.project, siteId: t.s1, date: t.today }), { status: 404 });

  // FR-03: approving the waiting DPR recomputes the day through the event; snapshots are kept per day and site
  db.prepare("UPDATE site_dprs SET status = 'APPROVED' WHERE id = ?").run(t.dprDraft);
  publishEvent(db, { type: 'site.dpr.approved', entity: 'site_dprs', entityId: t.dprDraft, actorId: 'ex-pm', companyId: 1, projectId: t.project, data: { dprId: t.dprDraft } });
  const rt = runtimeOf(db); for (let i = 0; i < 5; i += 1) { rt.bus.relayOnce(500); rt.bus.deliverOnce(500); }
  const after2 = (await t.get(dir, `/execution?date=${t.today}`)).json.data;
  assert.equal(after2.tiles.executed, expected + 5 * 6500);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM dei_daily WHERE snap_date = ? AND deleted_at IS NULL').get(t.today).n, 4, 'three site rows and the project row');
  assert.ok(db.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'bi.execution.snapshot_captured'").get());
  assert.equal(executionOf(db).series(1, t.project, t.today, t.today)[0].executed, expected + 5 * 6500, 'the series MIS and forecasting read');
  // the dashboard widget
  const widget = await t.api.call('GET', '/api/v1/ui/widgets/bi.work_done_today/data', dir);
  assert.equal(widget.status, 200, JSON.stringify(widget.json));
  assert.equal(widget.json.data.data.value, expected + 5 * 6500);
});

test('27.06 volume: 100,000 daily snapshots keep the overview within target and use indexes', async () => {
  const t = await setup();
  const { db } = t;
  db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bi.p2706', 1, 'Execution fixture', 0, 1)").run();
  const projects = [];
  for (let p = 0; p < 50; p += 1) {
    const id = Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'ROAD', 'ACTIVE')").run(`V-${p}`, `Volume ${p}`).lastInsertRowid);
    const sites = [0, 1].map((k) => Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, ?, ?, 'ACTIVE')").run(id, `V-${p}-${k}`, 'Volume site').lastInsertRowid));
    projects.push({ id, sites });
  }
  const insert = db.prepare(`INSERT INTO dei_daily (company_id, project_id, site_id, site_key, snap_date, planned_value, executed_value, snapshot_json, captured_at, created_by)
    VALUES (1, ?, ?, ?, ?, 100000, 90000, '{"items":[],"dprs":[]}', ?, 'fixture')`);
  db.exec('BEGIN');
  let n = 0;
  for (let day = 0; n < 100_000; day += 1) {
    const date = new Date(Date.parse(`${t.today}T00:00:00Z`) - day * 86_400_000).toISOString().slice(0, 10);
    for (const p of projects) for (const s of [...p.sites, null]) { insert.run(p.id, s, s ?? 0, date, `${date}T18:00:00Z`); n += 1; }
  }
  db.exec('COMMIT');
  let worst = 0;
  for (let i = 0; i < 5; i += 1) { const s = performance.now(); const r = await t.get(dir, `/execution?date=${t.today}&days=90`); worst = Math.max(worst, performance.now() - s); assert.equal(r.status, 200, JSON.stringify(r.json)); }
  assert.ok(worst < 500, `overview ${Math.round(worst)} ms`);
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM dei_daily x WHERE x.company_id = 1 AND x.snap_date = '2026-01-01' AND x.site_id IS NOT NULL AND x.deleted_at IS NULL`).all().map((r) => r.detail).join(' | ');
  assert.match(plan, /USING INDEX (ix_dei_daily_date|sqlite_autoindex_dei_daily_1)/);
});
