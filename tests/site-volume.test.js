import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';

// Section 14 of parts 14.06 and 14.07: the main tables hold 100,000 rows over 50 projects, and the queries of the pages use their indexes and answer within the 500 ms of the list target.
const opened = []; after(async () => { for (const a of opened) await a.close(); });
const timeIt = (db, sql, ...p) => { const t0 = performance.now(); const rows = db.prepare(sql).all(...p); return { ms: performance.now() - t0, rows }; };
const plan = (db, sql, ...p) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...p).map((r) => r.detail).join(' | ');

test('100,000 control facts, unallocated costs and productivity records: every page query uses an index and answers within 500 ms', async () => {
  const api = await startApi(); opened.push(api); await setupCompany(api); const db = api.db;
  for (let i = 1; i <= 50; i += 1) db.prepare("INSERT INTO org_projects (company_id, code, name, type, status) VALUES (1, ?, ?, 'BUILDING', 'ACTIVE')").run(`V${i}`, `Volume ${i}`);
  db.exec('PRAGMA foreign_keys = OFF'); // the volume rows reference cost codes that need not exist
  const first = db.prepare("SELECT MIN(id) AS n FROM org_projects WHERE code = 'V1'").get().n;
  db.exec('BEGIN');
  // 50 projects x 2,000 facts: 40 WBS-less/cost-code keys x 10 resource-period combinations, plus monthly rows
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99999)
    INSERT INTO ctl_facts (company_id, org_project_id, wbs_id, cost_code_id, resource_type, period_key, budget_cost, actual_cost, committed_cost, earned_cost, project_id, created_by, source_type)
    SELECT 1, ? + (i % 50), NULL, i / 50 + 1000000, CASE i % 6 WHEN 0 THEN 'MATERIAL' WHEN 1 THEN 'LABOUR' WHEN 2 THEN 'EQUIPMENT' WHEN 3 THEN 'TRANSPORT' WHEN 4 THEN 'SUBCONTRACT' ELSE 'OTHER' END, CASE WHEN i % 7 = 0 THEN '' ELSE '2026-' || printf('%02d', 1 + i % 12) END, i * 100, i * 50, i * 20, i * 30, ? + (i % 50), 'perf', 'perf' FROM n`).run(first, first);
  db.exec('COMMIT');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ctl_facts').get().n, 100000);
  const facts = "SELECT f.resource_type AS k, SUM(f.planned_cost) AS planned, SUM(f.budget_cost) AS budget, SUM(f.committed_cost) AS committed, SUM(f.actual_cost) AS actual, SUM(f.earned_cost) AS earned FROM ctl_facts f WHERE f.org_project_id = ? AND f.deleted_at IS NULL GROUP BY 1";
  const byCode = "SELECT f.cost_code_id AS k, SUM(f.actual_cost) AS actual FROM ctl_facts f WHERE f.org_project_id = ? AND f.deleted_at IS NULL AND (f.period_key = '' OR f.period_key = ?) GROUP BY 1";
  const timings = {};
  for (const [name, sql, args] of [['facts by resource', facts, [first + 7]], ['facts by cost code and month', byCode, [first + 7, '2026-05']]]) { const r = timeIt(db, sql, ...args); timings[name] = Math.round(r.ms); assert.ok(r.ms < 500, `${name}: ${r.ms} ms`); assert.match(plan(db, sql, ...args), /ix_ctl_facts|ux_ctl_facts/, `${name} uses an index: ${plan(db, sql, ...args)}`); }
  // the unallocated queue: 100,000 lines, the list filters by company and status and sorts by age
  db.exec('BEGIN');
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99999)
    INSERT INTO ctl_unallocated (company_id, org_project_id, src_type, src_id, src_line_id, doc_ref, resource_type, amount, actual_date, reason, status, project_id, created_by, source_type)
    SELECT 1, ? + (i % 50), 'EXPENSE', 'E' || i, '1', 'E' || i, 'OTHER', 1000 + i, date('2026-01-01', '+' || (i % 300) || ' days'), 'NO_WBS_NO_COST_CODE', CASE WHEN i % 10 = 0 THEN 'SUBMITTED' ELSE 'OPEN' END, ? + (i % 50), 'perf', 'perf' FROM n`).run(first, first);
  db.exec('COMMIT');
  const q = "SELECT x.*, p.code FROM ctl_unallocated x JOIN org_projects p ON p.id = x.org_project_id WHERE x.deleted_at IS NULL AND x.company_id = 1 AND x.org_project_id = ? AND x.status = 'OPEN' ORDER BY x.actual_date ASC, x.id LIMIT 50";
  { const r = timeIt(db, q, first + 3); timings['unallocated page'] = Math.round(r.ms); assert.ok(r.ms < 500, `unallocated: ${r.ms} ms`); assert.match(plan(db, q, first + 3), /ix_ctl_unallocated/, plan(db, q, first + 3)); assert.equal(r.rows.length, 50); }
  { const c = "SELECT COUNT(*) AS n, COALESCE(SUM(amount), 0) AS a FROM ctl_unallocated WHERE org_project_id = ? AND status IN ('OPEN', 'RETURNED', 'SUBMITTED') AND deleted_at IS NULL"; const r = timeIt(db, c, first + 3); timings['unallocated count'] = Math.round(r.ms); assert.ok(r.ms < 500); assert.match(plan(db, c, first + 3), /ix_ctl_unallocated/); }
  // the productivity records of 14.06
  const site = Number(db.prepare("INSERT INTO org_sites (company_id, org_project_id, code, name, status) VALUES (1, ?, 'VS1', 'Volume site', 'ACTIVE')").run(first).lastInsertRowid);
  db.prepare("INSERT INTO site_dprs (id, company_id, doc_no, org_project_id, dpr_site_id, dpr_date, supervisor, scope, status, requested_by, project_id, site_id, created_by) VALUES (1, 1, 'DPR/V/1', ?, ?, '2026-01-01', 'x', 'SITE', 'SUPERSEDED', 'x', ?, ?, 't')").run(first, site, first, site);
  db.exec('BEGIN');
  db.prepare(`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 99999)
    INSERT INTO prod_actuals (company_id, org_project_id, prod_site_id, work_date, activity_code, work_type, dpr_id, dpr_scope, qty, uom, man_days, alloc_basis, productivity, variance_pct, project_id, created_by, source_type)
    SELECT 1, ?, ?, date('2025-01-01', '+' || (i % 700) || ' days'), 'A' || (i % 200), 'UOM:m3', 1, 'SITE', 5000, 'm3', 5000, 'WA', 1000, (i % 40) * 100 - 2000, ?, 'perf', 'perf' FROM n`).run(first, site, first);
  db.exec('COMMIT');
  const pq = "SELECT x.activity_code AS k, SUM(x.qty) AS qty, SUM(x.man_days) AS md FROM prod_actuals x WHERE x.org_project_id = ? AND x.deleted_at IS NULL AND x.work_date >= ? AND x.work_date <= ? GROUP BY 1";
  { const r = timeIt(db, pq, first, '2025-06-01', '2025-08-31'); timings['productivity by activity'] = Math.round(r.ms); assert.ok(r.ms < 500, `productivity: ${r.ms} ms`); console.log('volume timings (ms) at 100,000 rows each:', JSON.stringify(timings), '| productivity plan:', plan(db, pq, first, '2025-06-01', '2025-08-31')); }
});
