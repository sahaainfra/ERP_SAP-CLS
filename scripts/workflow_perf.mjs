// npm run erp:workflow-perf -- [--rows 100000] [--queries 200]
// Part 04.01: fills the workflow tables with synthetic approvals (default 100 000 instances, two tasks each, over 50 projects) and times the shapes of
// query the screens make: my tasks, the instance list with filters, the monitor and one instance. Prints the query plan of the index lookups.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 200));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const engine = workflowOf(db);
engine.activeDefinition(1, 'ENG_SAMPLE_DOC');
const def = db.prepare('SELECT * FROM wf_definitions WHERE company_id = 1 LIMIT 1').get();
const projects = [];
for (let p = 1; p <= 50; p += 1) {
  const r = db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 'perf', 'perf')").run(`P${String(p).padStart(2, '0')}`, `Project ${p}`);
  projects.push(Number(r.lastInsertRowid));
}
const states = ['RUNNING', 'RUNNING', 'APPROVED', 'APPROVED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'];
console.log(`Filling ${rows} instances...`);
db.exec('BEGIN');
const insI = db.prepare("INSERT INTO wf_instances (company_id, doc_type, doc_id, doc_ref, title, definition_id, definition_version, steps_json, status, current_step, context_json, submitted_by, submitted_at, completed_at, project_id, created_by, source_type) VALUES (1, 'ENG_SAMPLE_DOC', ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?, ?, 'perf', 'perf')");
const insT = db.prepare("INSERT INTO wf_tasks (company_id, instance_id, step_code, step_no, assignee_user_id, assignee_role, status, due_at, action, acted_at, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const status = states[i % states.length];
  const done = status !== 'RUNNING';
  const at = new Date(Date.UTC(2026, 3, 1) + i * 60_000).toISOString();
  const end = done ? new Date(Date.UTC(2026, 3, 1) + i * 60_000 + 7_200_000).toISOString() : null;
  const project = projects[i % projects.length];
  const id = Number(insI.run(String(i), `WSD-${String(i).padStart(6, '0')}`, `Sample request ${i}`, def.id, def.version, def.steps_json, status, done ? null : 'MANAGER', `user${i % 400}`, at, end, project).lastInsertRowid);
  insT.run(id, 'MANAGER', 1, null, 'PM', done ? 'DONE' : 'OPEN', at, done ? 'approve' : null, end, project);
  insT.run(id, 'FINANCE', 2, i % 7 === 0 ? `approver${i % 50}` : null, i % 7 === 0 ? null : 'ACCMGR', done ? 'DONE' : 'OPEN', at, done ? 'approve' : null, end, project);
}
db.exec('COMMIT');
db.exec('ANALYZE');

const actor = { user: 'perf-admin', roles: ['SYSADM'], companyId: 1 };
const approver = { user: 'user7', roles: ['PM'], companyId: 1 };
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const worst = [];
worst.push(time('list, running, page 1 (25)', () => engine.listInstances(actor, { status: 'RUNNING', limit: 25, offset: 0 })));
worst.push(time('list, running, page 400', () => engine.listInstances(actor, { status: 'RUNNING', limit: 25, offset: 9_975 })));
worst.push(time('list, a word of the title', (i) => engine.listInstances(actor, { q: `request ${1000 + i}`, limit: 25 })));
worst.push(time('list, one document type and status', () => engine.listInstances(actor, { docType: 'ENG_SAMPLE_DOC', status: 'APPROVED', limit: 25 })));
worst.push(time('my tasks (role PM, 100 per call)', () => engine.listTasks(approver, { mine: 'assigned', limit: 25 })));
worst.push(time('monitor', () => engine.monitor(actor, {})));
worst.push(time('one instance with tasks and history', (i) => engine.get(actor, 1 + i * 37)));
// part 04.02: resolving the matrix of a document, with 50 projects each having a matrix of its own for 30 document types and four versions
const matrixSvc = (await import('../src/server/modules/eng/matrix.js')).createMatrixService({ db, engine, limits: (await import('../src/server/modules/eng/controls.js')).createLimitService({ db, engine }), paths: (await import('../src/server/modules/eng/controls.js')).createPathService({ db, engine }) });
matrixSvc.ensureDefaults(1);
db.exec('BEGIN');
const base = db.prepare("SELECT * FROM wf_matrix WHERE company_id = 1 AND doc_type = 'PO'").get();
const baseRules = db.prepare('SELECT * FROM wf_matrix_rules WHERE matrix_id = ?').all(base.id);
for (const project of projects) for (let v = 1; v <= 4; v += 1) {
  const m = Number(db.prepare("INSERT INTO wf_matrix (company_id, doc_type, scope_type, scope_id, matrix_version, name, status, effective_from, created_by, source_type) VALUES (1, 'PO', 'PROJECT', ?, ?, 'perf', 'ACTIVE', ?, 'perf', 'perf')").run(project, v, `2026-0${v}-01`).lastInsertRowid);
  for (const r of baseRules) db.prepare('INSERT INTO wf_matrix_rules (company_id, matrix_id, priority, name, condition_json, steps_json, created_by, source_type) VALUES (1, ?, ?, ?, ?, ?, ?, ?)').run(m, r.priority, r.name, r.condition_json, r.steps_json, 'perf', 'perf');
}
db.exec('COMMIT');
worst.push(time('resolve the matrix of a document', (i) => matrixSvc.resolve({ companyId: 1, docType: 'PO', context: { amount: 100_000 + i * 50_000 }, projectId: projects[i % projects.length], date: '2026-11-02' })));
worst.push(time('list the matrix versions (page 1)', () => matrixSvc.list(actor, { limit: 25, offset: 0 })));
worst.push(time('simulate', (i) => matrixSvc.simulate(actor, { docType: 'PO', context: { amount: 100_000 + i * 50_000 }, projectId: projects[i % projects.length] })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['instances by status', "SELECT * FROM wf_instances WHERE company_id = 1 AND status = 'RUNNING' AND is_active = 1 ORDER BY id DESC LIMIT 25"],
  ['open tasks of a person', "SELECT * FROM wf_tasks WHERE company_id = 1 AND assignee_user_id = 'approver7' AND status = 'OPEN'"],
  ['open tasks of a role', "SELECT * FROM wf_tasks WHERE company_id = 1 AND assignee_role = 'PM' AND status = 'OPEN'"],
  ['tasks of an instance', 'SELECT * FROM wf_tasks WHERE instance_id = 500 ORDER BY id'],
  ['overdue tasks', "SELECT * FROM wf_tasks WHERE status = 'OPEN' AND due_at <= '2026-04-02'"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll list shapes are inside the 500 ms standard.');
process.exit(bad.length ? 1 : 0);
