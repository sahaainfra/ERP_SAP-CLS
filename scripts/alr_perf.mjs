// npm run erp:alr-perf -- [--rows 100000] [--queries 100]
// Part 04.09: fills the alerts (default 100 000 over 400 people and 60 projects), the run log and 20 000 open tasks, and times what the screens ask and what the engine does: the Alert Centre
// (mine, project, filtered), the counts, the dry-run and the run of a rule over 20 000 records, the throttle check, and the run of a rule that finds nothing new. Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record; a save is <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { alertsOf } from '../src/server/platform/alerts/index.js';
import { createAlertService } from '../src/server/modules/eng/alerts.js';

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
const svc = createAlertService({ db, engine });
const core = alertsOf(db);
const sys = { user: 'perf-admin', roles: ['SYSADM'], companyId: 1 };
console.log(`Filling ${rows} alerts and 20000 tasks...`);
db.exec('BEGIN');
const ins = db.prepare("INSERT INTO alr_alerts (company_id, rule_code, rule_version, entity, entity_id, entity_label, severity, message, status, owner_user_ref, recipients_json, occurrences, first_seen_at, last_seen_at, last_notified_at, project_id, created_by, source_type) VALUES (1, ?, 1, 'task', ?, 'Task', ?, 'A synthetic alert', ?, ?, ?, 1, ?, ?, ?, ?, 'perf', 'perf')");
const sev = ['INFO', 'WARNING', 'WARNING', 'CRITICAL'];
const st = ['OPEN', 'OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'RESOLVED', 'RESOLVED'];
for (let i = 1; i <= rows; i += 1) {
  const at = new Date(Date.UTC(2026, 3, 1) + i * 25_000).toISOString();
  ins.run(`rule${i % 18}`, String(i), sev[i % 4], st[i % 6], `user${i % 400}`, JSON.stringify([`user${i % 400}`, `user${(i + 1) % 400}`]), at, at, at, 1 + (i % 60));
}
const insT = db.prepare("INSERT INTO tsk_tasks (company_id, task_no, title, priority, due_date, status, origin, assigner, project_id, created_by, source_type) VALUES (1, ?, ?, 'MEDIUM', ?, 'OPEN', 'manual', 'user1', ?, 'perf', 'perf')");
const insA = db.prepare("INSERT INTO tsk_assignees (company_id, task_id, user_ref, role, created_by, source_type) VALUES (1, ?, ?, 'ASSIGNEE', 'perf', 'perf')");
for (let i = 1; i <= 20_000; i += 1) {
  const id = Number(insT.run(`TSK-${String(i).padStart(6, '0')}`, `Task ${i}`, new Date(Date.UTC(2026, 10, 3) + ((i % 60) - 30) * 86_400_000).toISOString().slice(0, 10), 1 + (i % 60)).lastInsertRowid);
  insA.run(id, `user${i % 400}`);
}
db.exec("INSERT INTO alr_rules (company_id, code, name, trigger_type, schedule, dataset, condition_json, actions_json, message_template, throttle_minutes, severity, owner_module, owner_role, enabled, rule_version, status, created_by, source_type) VALUES (1, 'task.overdue', 'Task overdue', 'SCHEDULE', 'DAILY@07', 'tsk.task', '{\"all\":[{\"field\":\"daysLate\",\"op\":\"gte\",\"value\":1}]}', '[{\"type\":\"notify\",\"to\":[\"owner\"]}]', '{{taskNo}} is {{daysLate}} day(s) late', 1440, 'WARNING', 'tasks', 'PM', 1, 1, 'ACTIVE', 'perf', 'perf')");
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn, n = queries) => {
  const ms = [];
  for (let i = 0; i < n; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p95(ms).toFixed(1).padStart(8)} ms`);
  return p95(ms);
};
const me = (i) => ({ user: `user${i % 400}`, roles: ['EMP'], companyId: 1 });
const worst = [];
worst.push(time('alert centre, my alerts page 1', (i) => svc.alerts.list(me(i), { view: 'mine', status: 'open', limit: 25, offset: 0 })));
worst.push(time('alert centre, project alerts page 1', () => svc.alerts.list(sys, { view: 'project', status: 'open', limit: 25, offset: 0 })));
worst.push(time('alert centre, page 400', () => svc.alerts.list(sys, { view: 'all', limit: 25, offset: 9_975 })));
worst.push(time('alert centre, critical of one rule', () => svc.alerts.list(sys, { view: 'all', severity: 'CRITICAL', rule: 'rule3', limit: 25, offset: 0 })));
worst.push(time('alerts of one record', (i) => svc.alerts.list(sys, { view: 'all', entity: 'task', entityId: String(i + 1), limit: 25, offset: 0 })));
worst.push(time('summary tiles of a person', (i) => svc.alerts.summary(me(i))));
worst.push(time('one alert', (i) => svc.alerts.get(sys, 1 + ((i * 97) % rows))));
worst.push(time('rules list', () => svc.rules.list(sys), 20));
const rule = core.ruleOf(db.prepare("SELECT * FROM alr_rules WHERE company_id = 1 AND code = 'task.overdue'").get());
time('dry-run over 20 000 tasks (reads the whole dataset)', () => core.dryRun(rule), 5);
let first = null;
time('run over 20 000 tasks (new alerts, a background job)', () => { first ??= core.run(rule, 'schedule'); }, 1);
console.log(`  the first run made ${first.created} alert(s) and did ${first.actions} action(s)`);
time('run again (all held back, a background job)', () => core.run(rule, 'schedule'), 3);
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['my open alerts', "SELECT a.* FROM alr_alerts a WHERE a.company_id = 1 AND a.is_active = 1 AND a.owner_user_ref = 'user7' AND a.status != 'RESOLVED' ORDER BY a.severity, a.first_seen_at LIMIT 25"],
  ['the last alert of a record', "SELECT * FROM alr_alerts WHERE company_id = 1 AND rule_code = 'rule3' AND entity = 'task' AND entity_id = '5' ORDER BY id DESC LIMIT 1"],
  ['the alerts of a project', "SELECT * FROM alr_alerts WHERE company_id = 1 AND project_id = 5 AND status = 'OPEN' LIMIT 25"],
  ['the runs of a rule', "SELECT * FROM alr_rule_runs WHERE company_id = 1 AND rule_code = 'task.overdue' ORDER BY id DESC LIMIT 20"],
  ['the event rules of a type', "SELECT * FROM alr_rules WHERE trigger_type = 'EVENT' AND event_type = 'x.y.z' AND status = 'ACTIVE' AND enabled = 1"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the standard: ${bad.length} shape(s).` : '\nAll shapes are inside the standard.');
process.exit(bad.length ? 1 : 0);
