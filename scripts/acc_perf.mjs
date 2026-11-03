// npm run erp:acc-perf -- [--rows 100000] [--queries 100]
// Part 04.05: fills the action ledger with synthetic entries (default 100 000, over 50 projects and 400 people) and the RACI with every standard process for every project, and times
// what the screens ask: the ledger page with filters, the scores by person, role and project, My Accountability, the gap check and the resolution of an accountable person.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { accountabilityOf } from '../src/server/platform/accountability/index.js';
import { createAccountabilityService } from '../src/server/modules/eng/accountability.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const engine = workflowOf(db);
const svc = createAccountabilityService({ db, engine });
const actor = { user: 'perf-admin', roles: ['SYSADM'], companyId: 1 };
const projects = [];
for (let p = 1; p <= 50; p += 1) projects.push(Number(db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 'perf', 'perf')").run(`P${String(p).padStart(2, '0')}`, `Project ${p}`).lastInsertRowid));
const procs = svc.templates(actor);
console.log(`Filling ${rows} ledger entries and ${projects.length * procs.length * 3} RACI rows...`);
db.exec('BEGIN');
const insA = db.prepare("INSERT INTO acc_raci_assignments (company_id, scope_type, scope_id, process_code, user_id, role_code, raci, status, effective_from, batch_id, project_id, created_by, source_type) VALUES (1, 'PROJECT', ?, ?, ?, ?, ?, 'ACTIVE', '2026-01-01', ?, ?, 'perf', 'perf')");
let batch = 1;
for (const p of projects) for (const t of procs) { insA.run(p, t.code, `user${p % 400}`, null, 'A', batch, p); insA.run(p, t.code, null, 'SE', 'R', batch, p); insA.run(p, t.code, `user${(p + 7) % 400}`, null, 'C', batch, p); batch += 1; }
const insL = db.prepare("INSERT INTO acc_action_ledger (company_id, occurred_at, actor_id, role_code, action, entity, entity_id, entity_ref, process_code, outcome, due_at, on_time, affected_user, project_id, created_by, source_type, source_id) VALUES (1, ?, ?, ?, ?, 'PO', ?, ?, ?, ?, ?, ?, ?, ?, 'perf', 'perf', ?)");
const actions = ['created', 'submitted', 'verified', 'approved', 'approved', 'rejected', 'modified', 'closed'];
const roles = ['PM', 'PD', 'SE', 'QS', 'ACCMGR'];
for (let i = 1; i <= rows; i += 1) {
  const at = new Date(Date.UTC(2026, 3, 1) + i * 60_000).toISOString();
  const a = actions[i % actions.length];
  const timed = a === 'approved' || a === 'verified';
  insL.run(at, `user${i % 400}`, roles[i % roles.length], a, String(i), `PO-${i}`, procs[i % procs.length].code, a === 'rejected' ? (i % 2 ? 'RETURNED' : 'REJECTED') : 'OK', timed ? at : null, timed ? (i % 5 ? 1 : 0) : null, a === 'rejected' ? `user${(i + 3) % 400}` : null, projects[i % projects.length], String(i));
}
db.exec('COMMIT');
db.exec('ANALYZE');
db.prepare("INSERT INTO acc_ledger_cursors (source_type, last_id) VALUES ('event', 999999999), ('audit', 999999999)").run();
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const worst = [];
worst.push(time('ledger, page 1 (25)', () => svc.ledger.list(actor, { limit: 25, offset: 0 })));
worst.push(time('ledger, page 400', () => svc.ledger.list(actor, { limit: 25, offset: 9_975 })));
worst.push(time('ledger, one person', (i) => svc.ledger.list(actor, { user: `user${i % 400}`, limit: 25 })));
worst.push(time('ledger, one project and action', (i) => svc.ledger.list(actor, { project: projects[i % projects.length], action: 'approved', limit: 25 })));
worst.push(time('scores by person (400 people)', () => svc.scores.list(actor, { by: 'person', from: '2026-01-01' })));
worst.push(time('scores by role', () => svc.scores.list(actor, { by: 'role', from: '2026-01-01' })));
worst.push(time('scores by project', () => svc.scores.list(actor, { by: 'project', from: '2026-01-01' })));
worst.push(time('My Accountability', (i) => svc.me({ user: `user${i % 400}`, roles: ['SE'], companyId: 1 }, { from: '2026-01-01' })));
worst.push(time('gap check (50 projects)', () => svc.raci.gaps(actor, {})));
worst.push(time('RACI grid of a project', (i) => svc.raci.get(actor, { scopeType: 'PROJECT', scopeId: projects[i % projects.length] })));
worst.push(time('who is accountable', (i) => accountabilityOf(db).resolve({ companyId: 1, processCode: procs[i % procs.length].code, projectId: projects[i % projects.length] })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['ledger of a person', "SELECT * FROM acc_action_ledger WHERE company_id = 1 AND actor_id = 'user7' ORDER BY occurred_at DESC LIMIT 25"],
  ['ledger of a project', 'SELECT * FROM acc_action_ledger WHERE company_id = 1 AND project_id = 5 ORDER BY occurred_at DESC LIMIT 25'],
  ['ledger of an object', "SELECT * FROM acc_action_ledger WHERE company_id = 1 AND entity = 'PO' AND entity_id = '77'"],
  ['returns received by a person', "SELECT * FROM acc_action_ledger WHERE company_id = 1 AND affected_user = 'user7' AND outcome = 'RETURNED'"],
  ['who is accountable here', "SELECT * FROM acc_raci_assignments WHERE company_id = 1 AND scope_type = 'PROJECT' AND scope_id = 5 AND process_code = 'PO_ISSUE' AND status = 'ACTIVE'"],
  ['what a person answers for', "SELECT * FROM acc_raci_assignments WHERE company_id = 1 AND user_id = 'user7' AND status = 'ACTIVE'"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll list shapes are inside the 500 ms standard.');
process.exit(bad.length ? 1 : 0);
