// npm run erp:tst-perf -- [--queries 20]
// Parts 30.01-30.03: fills the main tables of the go-live consoles to the standard volume (100 000 rows each: reconciliation results of a run,
// page audits over 50 projects' worth of pages, inbox deliveries for the matrix) and times what the pages ask: the reconciliation exceptions
// list and its filters, the page audit list and its filters, the integration matrix. Prints the query plans of the list queries.
// Standard (05_GLOBAL_STANDARDS section 11): a list p95 <= 500 ms, one record <= 300 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { createFlagService } from '../src/server/modules/core/api.js';
import { createReconService } from '../src/server/modules/tst/recon.js';
import { createPageAuditService, registeredPages } from '../src/server/modules/tst/pageaudit.js';
import { createIntegrationService } from '../src/server/modules/tst/integration.js';

const args = process.argv.slice(2);
const queries = Number(args.includes('--queries') ? args[args.indexOf('--queries') + 1] : 20);
const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON;'); migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (const f of ['ff.qa.p3001', 'ff.qa.p3002', 'ff.qa.p3003']) db.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES (?, 1, 'perf', 0, 1)").run(f);
console.log('Filling...');
db.exec('BEGIN');
const run = Number(db.prepare("INSERT INTO tst_recon_runs (company_id, run_no, as_of, status, result_status, checks_count, failed_count, critical_count, trace_bp, trace_json, tolerance_json, requested_by, finished_at) VALUES (1, 'RCN-1', '2026-11-23', 'DONE', 'RED', 6, 3, 50000, 9990, ?, '{}', 'perf', '2026-11-23T00:00:00Z')").run(JSON.stringify({ total: 1, linked: 1, missing: 0, pct: 100, pctBp: 10000, groups: [] })).lastInsertRowid);
const checks = ['QTY_CHAIN', 'COST_CHAIN', 'SUBLEDGER_GL', 'STOCK_BALANCES', 'PAYROLL_GL', 'BANK_BOOK'];
const ins = db.prepare("INSERT INTO tst_recon_results (company_id, run_id, check_code, scope_key, label, expected_value, actual_value, difference_value, unit, status, severity, drill_route, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'money', ?, ?, '/x', 'perf', 'perf')");
for (let i = 0; i < 100_000; i += 1) { const fail = i % 2 === 0; ins.run(run, checks[i % 6], `P${i % 50}`, `Record ${i}`, 1000 + i, 1000 + i + (fail ? 500 : 0), fail ? 500 : 0, fail ? 'FAIL' : 'PASS', fail ? 'CRITICAL' : 'INFO'); }
const pages = registeredPages();
const pr = Number(db.prepare("INSERT INTO tst_page_audit_runs (company_id, run_no, run_kind, viewport, status, started_at, requested_by) VALUES (1, 'PGA-1', 'CRAWL', 'mobile', 'DONE', '2026-11-23T00:00:00Z', 'perf')").run().lastInsertRowid);
const pa = db.prepare("INSERT INTO tst_page_audit (company_id, page_code, route, audit_kind, viewport, role_tested, checklist_json, defects_json, status, tested_by, tested_at, run_id) VALUES (1, ?, ?, ?, ?, 'SYSADM', '[]', ?, ?, 'perf', ?, ?)");
for (let i = 0; i < 100_000; i += 1) { const p = pages[i % pages.length]; const fail = i % 17 === 0; pa.run(p.route.replace(/^\//, '').replace(/\//g, '.'), p.route, i % 3 === 0 ? 'STATIC' : 'CRAWL', i % 3 === 0 ? null : 'mobile', fail ? JSON.stringify([{ no: 1, title: 'x', status: 'OPEN' }]) : '[]', fail ? 'FAIL' : 'PASS', new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString(), pr); }
const ob = db.prepare("INSERT INTO core_outbox (event_type, aggregate_id, payload, published_at, created_at) VALUES (?, 'x', ?, ?, ?)");
const ib = db.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, company_id, status, attempts, next_attempt_at, processed_at, created_at) VALUES (?, ?, ?, ?, 1, 'PROCESSED', 1, ?, ?, ?)");
const now = Date.now();
for (let i = 0; i < 100_000; i += 1) { const t = new Date(now - i * 10_000).toISOString(); const done = new Date(now - i * 10_000 + 400 + (i % 900)).toISOString(); const id = Number(ob.run('bill.sub.approved', JSON.stringify({ eventId: `e${i}`, companyId: 1, data: {} }), t, t).lastInsertRowid); ib.run(['fin.posting', 'fin.ap_sub_bill', 'bill.ledger_sub'][i % 3], `e${i}`, id, 'bill.sub.approved', done, done, t); }
db.exec('COMMIT');
const context = { db, environment: 'test', flags: createFlagService({ db, environment: 'test' }) };
const recon = createReconService(context, {});
const audit = createPageAuditService(context);
const integration = createIntegrationService(context, { bus: runtimeOf(db).bus });
const actor = { companyId: 1, user: 'perf', userId: 1, roles: ['CFO', 'ITADM'] };
const time = (label, fn) => { const xs = []; for (let i = 0; i < queries; i += 1) { const t = process.hrtime.bigint(); fn(i); xs.push(Number(process.hrtime.bigint() - t) / 1e6); } xs.sort((a, b) => a - b); const p95 = xs[Math.min(xs.length - 1, Math.ceil(xs.length * 0.95) - 1)]; console.log(`${label.padEnd(58)} p95 ${p95.toFixed(1).padStart(8)} ms`); return p95; };
const results = [
  ['Reconciliation health, exceptions page 1 (100k results)', time('Reconciliation health, exceptions page 1 (100k results)', () => recon.health(actor, {}))],
  ['Reconciliation health, filter check + page 40', time('Reconciliation health, filter check + page 40', (i) => recon.health(actor, { check: checks[i % 6], page: 40 }))],
  ['Reconciliation health, search', time('Reconciliation health, search', () => recon.health(actor, { q: 'Record 99' }))],
  ['Page audit list (100k audits, every page)', time('Page audit list (100k audits, every page)', () => audit.pages(actor, {}))],
  ['Page audit list, filter FAIL + module', time('Page audit list, filter FAIL + module', () => audit.pages(actor, { status: 'FAIL', module: 'site' }))],
  ['Page audit, one page', time('Page audit, one page', () => audit.page(actor, pages[3].route.replace(/^\//, '').replace(/\//g, '.')))],
  ['Integration matrix, live (100k deliveries)', time('Integration matrix, live (100k deliveries)', () => integration.matrix(1))],
];
for (const sql of ["EXPLAIN QUERY PLAN SELECT * FROM tst_recon_results WHERE run_id = 1 AND status IN ('FAIL', 'ERROR') ORDER BY difference_value DESC LIMIT 25",
  "EXPLAIN QUERY PLAN SELECT a.* FROM tst_page_audit a JOIN (SELECT page_code, audit_kind, COALESCE(viewport, '') AS vp, MAX(id) AS id FROM tst_page_audit WHERE company_id = 1 AND deleted_at IS NULL GROUP BY page_code, audit_kind, COALESCE(viewport, '')) l ON l.id = a.id"]) {
  console.log(sql.replace('EXPLAIN QUERY PLAN ', '')); for (const r of db.prepare(sql).all()) console.log(`   ${r.detail}`);
}
const over = results.filter(([, p]) => p > 500);
console.log(over.length ? `OVER the 500 ms list target: ${over.map(([l]) => l).join('; ')}` : 'Every list within the 500 ms p95 target.');
process.exit(over.length ? 1 : 0);
