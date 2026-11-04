// npm run erp:pcs-perf -- [--rows 100000] [--queries 100]
// Part 04.04: fills the exceptions and the check log with synthetic rows (default 100 000 of each, over 50 projects and 20 control points) and times what the screens ask:
// the register page, with filters and the count, the dashboard, the control points with their observation figures, and one exception; and the check itself. Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { protocolOf } from '../src/server/platform/protocol/index.js';
import { createProtocolService } from '../src/server/modules/eng/protocol.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const engine = workflowOf(db);
const service = createProtocolService({ db, engine });
const actor = { user: 'perf-admin', roles: ['SYSADM'], companyId: 1 };
service.controls.list(actor); // the control points of the company
const projects = [];
for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 'perf', 'perf')").run(`P${String(p).padStart(2, '0')}`, `Project ${p}`).lastInsertRowid));
for (let c = 4; c <= 20; c += 1) db.prepare("INSERT INTO pcs_control_points (company_id, code, module, stage, description, rule_ref, enforcement, mode, owner_role, observe_since, created_by, source_type) VALUES (1, ?, 'proc', 'VERIFY', 'A synthetic control for the timing', 'expr:{}', 'EXCEPTION', 'OBSERVE', 'PROCMGR', '2026-01-01', 'perf', 'perf')").run(`CP-PROC-${String(c).padStart(2, '0')}`);
const controls = db.prepare('SELECT id, code FROM pcs_control_points WHERE company_id = 1').all();
const states = ['DRAFT', 'PENDING', 'APPROVED', 'USED', 'USED', 'USED', 'REJECTED', 'CANCELLED'];
const results = ['PASS', 'WOULD_BLOCK', 'WOULD_REQUIRE_EXCEPTION', 'WARN', 'BLOCK', 'EXCEPTION_REQUIRED', 'EXCEPTED'];
console.log(`Filling ${rows} exceptions and ${rows} check results...`);
db.exec('BEGIN');
const insE = db.prepare("INSERT INTO pcs_exceptions (company_id, exception_no, control_id, control_code, entity, entity_id, reason_code, justification, value_at_risk, level, status, raised_by, project_id, created_at, created_by, source_type) VALUES (1, ?, ?, ?, 'po', ?, 'ONE_TIME', 'A synthetic exception for timing the screens', ?, ?, ?, ?, ?, ?, 'perf', 'perf')");
const insR = db.prepare("INSERT INTO pcs_check_results (company_id, control_id, control_code, entity, entity_id, result, mode, details_json, user_id, value_at_risk, at, project_id, created_by, source_type) VALUES (1, ?, ?, 'po', ?, ?, 'OBSERVE', '{}', ?, ?, ?, ?, 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const c = controls[i % controls.length];
  const at = new Date(Date.UTC(2026, 3, 1) + i * 60_000).toISOString();
  const project = projects[i % projects.length];
  insE.run(`EXC-${String(i).padStart(6, '0')}`, c.id, c.code, String(i), (i % 900) * 10_000 + 100, 1 + (i % 3), states[i % states.length], `user${i % 300}`, project, at);
  insR.run(c.id, c.code, String(i), results[i % results.length], `user${i % 300}`, (i % 900) * 10_000, at, project);
}
db.exec('COMMIT');
db.exec('ANALYZE');
db.prepare("UPDATE core_feature_flags SET enabled = 1 WHERE key = 'ff.eng.p0404'").run();

const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const worst = [];
worst.push(time('register, page 1 (25)', () => service.exceptions.list(actor, { limit: 25, offset: 0 })));
worst.push(time('register, page 400', () => service.exceptions.list(actor, { limit: 25, offset: 9_975 })));
worst.push(time('register, open, one control', (i) => service.exceptions.list(actor, { status: 'OPEN', control: controls[i % controls.length].code, limit: 25 })));
worst.push(time('register, one project, value at least', (i) => service.exceptions.list(actor, { projectId: projects[i % projects.length], minValue: 5000, limit: 25 })));
worst.push(time('register, a word', (i) => service.exceptions.list(actor, { q: `EXC-${String(1000 + i).padStart(6, '0')}`, limit: 25 })));
worst.push(time('dashboard', () => service.dashboard(actor, {})));
worst.push(time('control points with observation figures', () => service.controls.list(actor, {})));
worst.push(time('one exception', (i) => service.exceptions.get(actor, 1 + i * 37)));
const protocol = protocolOf(db);
db.prepare("UPDATE pcs_control_points SET mode = 'ENFORCE' WHERE code = 'CP-ENG-01'").run();
worst.push(time('check (control in ENFORCE, a failing request)', (i) => protocol.check({ ...actor, companyId: 1 }, 'CP-ENG-01', { entity: 'sample_doc', entityId: String(900000 + i), amount: 900000, companyId: 1, requestedBy: 'u' })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['register by status', "SELECT * FROM pcs_exceptions WHERE company_id = 1 AND is_active = 1 AND status = 'PENDING' ORDER BY id DESC LIMIT 25"],
  ['register of a person', "SELECT * FROM pcs_exceptions WHERE company_id = 1 AND raised_by = 'user7' ORDER BY id DESC LIMIT 25"],
  ['the exception that lets an action through', "SELECT * FROM pcs_exceptions WHERE company_id = 1 AND control_code = 'CP-PROC-05' AND entity = 'po' AND entity_id = '5' AND status IN ('APPROVED')"],
  ['results of a control', 'SELECT result, COUNT(*) FROM pcs_check_results WHERE control_id = 3 AND at >= \'2026-04-01\' GROUP BY result'],
  ['results of an object', "SELECT * FROM pcs_check_results WHERE company_id = 1 AND entity = 'po' AND entity_id = '77'"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll list shapes are inside the 500 ms standard.');
process.exit(bad.length ? 1 : 0);
