// npm run erp:tsk-perf -- [--rows 100000] [--queries 100]
// Part 04.08: fills the tasks (default 100 000 over 400 people and 60 projects, with assignees and checklist items), and times what the screens ask: My Tasks (list, board and calendar ranges), a
// team's tasks, the team dashboard, one task with everything on it, the count tiles, the sweep's pick of late tasks, and the making of a task. Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record; a save is <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { tasksOf } from '../src/server/platform/tasks/index.js';
import { createTaskService } from '../src/server/modules/eng/tasks.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (let p = 1; p <= 60; p += 1) db.prepare("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, ?, ?, 'ROAD', 'ACTIVE', 't', 'perf')").run(`P${p}`, `Project ${p}`);
for (let u = 0; u < 400; u += 1) db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json) VALUES (1, ?, ?, '[\"PM\"]')").run(`user${u}`, `User ${u}`);
const engine = workflowOf(db);
const svc = createTaskService({ db, engine });
const core = tasksOf(db);
const pm = { user: 'user7', roles: ['SYSADM'], companyId: 1 };
const statuses = ['OPEN', 'ACCEPTED', 'IN_PROGRESS', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CLOSED', 'CLOSED', 'CLOSED', 'CANCELLED'];
console.log(`Filling ${rows} tasks...`);
db.exec('BEGIN');
const insT = db.prepare("INSERT INTO tsk_tasks (company_id, task_no, title, entity, entity_id, project_id, department_id, priority, due_date, status, origin, assigner, closed_at, created_at, created_by, source_type) VALUES (1, ?, ?, 'sample_doc', ?, ?, NULL, ?, ?, ?, 'manual', ?, ?, ?, 'perf', 'perf')");
const insA = db.prepare("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (1, ?, ?, ?, 'perf', 'perf')");
const insC = db.prepare("INSERT INTO tsk_checklist_items (company_id, task_id, position, text, created_by, source_type) VALUES (1, ?, ?, 'Check', 'perf', 'perf')");
const pr = ['LOW', 'MEDIUM', 'MEDIUM', 'HIGH', 'URGENT'];
const base = Date.parse('2026-11-03');
for (let i = 1; i <= rows; i += 1) {
  const st = statuses[i % statuses.length];
  const due = new Date(base + ((i % 120) - 60) * 86_400_000).toISOString().slice(0, 10);
  const at = new Date(base - (i % 400) * 3_600_000 * 6).toISOString();
  const id = Number(insT.run(`TSK-${String(i).padStart(6, '0')}`, `Task number ${i}`, String(i % 5000), 1 + (i % 60), pr[i % pr.length], due, st, `user${(i + 3) % 400}`, st === 'CLOSED' ? at : null, at).lastInsertRowid);
  insA.run(id, `user${i % 400}`, 'ASSIGNEE');
  if (i % 3 === 0) insA.run(id, `user${(i + 1) % 400}`, 'WATCHER');
  if (i % 4 === 0) { insC.run(id, 0); insC.run(id, 1); }
}
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const me = (i) => ({ user: `user${i % 400}`, roles: ['EMP'], companyId: 1 });
const worst = [];
worst.push(time('my tasks, page 1 (25)', (i) => svc.tasks.list(me(i), { view: 'assigned', status: 'open', sort: 'due', limit: 25, offset: 0 })));
worst.push(time('my tasks, board (200)', (i) => svc.tasks.list(me(i), { view: 'assigned', limit: 200, offset: 0, sort: 'due' })));
worst.push(time('my tasks, calendar month', (i) => svc.tasks.list(me(i), { view: 'assigned', from: '2026-11-01', to: '2026-11-30', limit: 200, offset: 0, sort: 'due' })));
worst.push(time('the tasks I watch', (i) => svc.tasks.list(me(i), { view: 'watching', limit: 25, offset: 0, sort: 'due' })));
worst.push(time('the tasks I gave', (i) => svc.tasks.list(me(i), { view: 'created', limit: 25, offset: 0, sort: 'due' })));
worst.push(time('team tasks, page 1', () => svc.tasks.list(pm, { view: 'team', status: 'open', limit: 25, offset: 0, sort: 'due' })));
worst.push(time('team tasks, page 400', () => svc.tasks.list(pm, { view: 'team', limit: 25, offset: 9_975, sort: 'due' })));
worst.push(time('team tasks, overdue only', () => svc.tasks.list(pm, { view: 'team', overdue: true, limit: 25, offset: 0, sort: 'due' })));
worst.push(time('tasks of a record', (i) => svc.tasks.list(pm, { view: 'all', entity: 'sample_doc', entityId: String(i % 5000), limit: 25, offset: 0, sort: 'due' })));
worst.push(time('count tiles of a person', (i) => svc.tasks.counts(me(i))));
worst.push(time('team dashboard', () => svc.dashboard(pm, {})));
worst.push(time('one task with everything', (i) => svc.tasks.get(pm, 1 + ((i * 97) % rows))));
worst.push(time('make a task', (i) => core.create({ companyId: 1, title: `Perf ${i}`, assignees: [`user${i % 400}`], assigner: 'user1', actor: 'user1', dueDate: '2026-12-01', notify: false })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['my open tasks', "SELECT t.* FROM tsk_tasks t WHERE t.company_id = 1 AND t.is_active = 1 AND EXISTS (SELECT 1 FROM tsk_assignees a WHERE a.task_id = t.id AND a.user_ref = 'user7' AND a.role = 'ASSIGNEE' AND a.is_active = 1) AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') ORDER BY t.due_date IS NULL, t.due_date, t.id LIMIT 25"],
  ['the team, newest', 'SELECT t.* FROM tsk_tasks t WHERE t.company_id = 1 AND t.is_active = 1 AND t.project_id IN (1, 2, 3) ORDER BY t.id DESC LIMIT 25'],
  ['tasks of a record', "SELECT t.* FROM tsk_tasks t WHERE t.company_id = 1 AND t.entity = 'sample_doc' AND t.entity_id = '7'"],
  ['late tasks for the sweep', "SELECT t.* FROM tsk_tasks t WHERE t.is_active = 1 AND t.status NOT IN ('DONE', 'VERIFIED', 'CLOSED', 'CANCELLED') AND t.due_date IS NOT NULL AND t.due_date < '2026-11-03'"],
  ['dependencies of a task', 'SELECT * FROM tsk_dependencies WHERE task_id = 7 AND is_active = 1'],
  ['what waits for a task', 'SELECT * FROM tsk_dependencies WHERE depends_on_task_id = 7 AND is_active = 1'],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll shapes are inside the standard.');
process.exit(bad.length ? 1 : 0);
