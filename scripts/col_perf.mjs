// npm run erp:col-perf -- [--rows 100000] [--queries 100]
// Part 04.14: fills 100 000 comments (500 records, 60 projects), as many mentions and reactions and 100 000 trace links (chains of five records), then times what the tabs and the feed ask: the discussion of a record,
// its timeline, the project feed, the trace to depth 3 and 8, the mentions inbox; prints query plans. Standard: p95 <= 500 ms for a list, <= 300 ms for one record.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { objectTypes } from '../src/server/platform/objects/index.js';
import { createCollabService } from '../src/server/modules/eng/collab.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
for (let u = 0; u < 50; u += 1) db.prepare("INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, '[\"PD\"]', ?)").run(`user${u}`, `User ${u}`, `u${u}@example.com`);
const RECORDS = 500;
objectTypes.register({
  type: 'perf_rec', label: 'Perf record', permission: 'eng.sample.use',
  access: (_d, actor, id) => (Number(id) >= 1 && Number(id) <= RECORDS ? { companyId: actor.companyId, projectId: 1 + (Number(id) % 60), siteId: null, status: 'OPEN' } : null),
  auditEntities: () => [], summary: (_d, _a, id) => ({ label: `Record ${id}`, status: 'OPEN', amount: '1000.00' }),
  projectRecords: (_d, _c, projectId) => Array.from({ length: RECORDS }, (_, i) => i + 1).filter((i) => 1 + (i % 60) === projectId),
});
const svc = createCollabService({ db });
console.log(`Filling ${rows} comments, mentions, reactions and trace links...`);
db.exec('BEGIN');
const c = db.prepare("INSERT INTO col_comments (company_id, entity, entity_id, entity_label, parent_id, body, project_id, created_by, created_at, source_type) VALUES (1, 'perf_rec', ?, ?, ?, ?, ?, ?, ?, 'perf')");
const m = db.prepare("INSERT INTO col_mentions (company_id, comment_id, mentioned_user, project_id, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'perf')");
const r = db.prepare("INSERT INTO col_reactions (company_id, comment_id, reaction, reacted_by, created_by, source_type) VALUES (1, ?, ?, ?, ?, 'perf')");
const t = db.prepare("INSERT INTO col_trace_links (company_id, from_entity, from_id, to_entity, to_id, relation, link_kind, created_by, source_type) VALUES (1, 'perf_rec', ?, 'perf_rec', ?, 'DERIVED', 'SERVICE', 'perf', 'perf')");
const reactions = ['like', 'ack', 'eyes', 'thanks'];
for (let i = 1; i <= rows; i += 1) {
  const rec = 1 + (i % RECORDS);
  const id = Number(c.run(String(rec), `Record ${rec}`, i > RECORDS && i % 4 === 0 ? i - RECORDS : null, `Comment ${i} about the work on this record @user${i % 50}`, 1 + (rec % 60), `user${i % 50}`, new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString()).lastInsertRowid);
  m.run(id, `user${(i + 7) % 50}`, 1 + (rec % 60), `user${i % 50}`);
  r.run(id, reactions[i % 4], `user${(i + 3) % 50}`, `user${(i + 3) % 50}`);
  // chains of five: 1 -> 2 -> 3 -> 4 -> 5, then the next chain (distinct ids)
  if (i % 5 !== 0) t.run(String(i), String(i + 1));
}
db.exec('COMMIT');
// trace nodes beyond the 500 registered records are shown as restricted, so also give the chain of the first records real ones
db.exec('BEGIN');
for (let i = 1; i < RECORDS; i += 1) if (i % 5 !== 0 || i < 5) db.prepare("INSERT OR IGNORE INTO col_trace_links (company_id, from_entity, from_id, to_entity, to_id, relation, link_kind, created_by, source_type) VALUES (1, 'perf_rec', ?, 'perf_rec', ?, 'REFERS', 'SERVICE', 'perf', 'perf')").run(String(i), String(i + 1));
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn, n = queries) => {
  const ms = [];
  for (let i = 0; i < n; i += 1) { const s = performance.now(); fn(i); ms.push(performance.now() - s); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(8)} ms   p95 ${p95(ms).toFixed(1).padStart(8)} ms`);
  return p95(ms);
};
const pm = { user: 'user1', roles: ['SYSADM', 'PD', 'PM'], companyId: 1 };
const worst = [];
worst.push(time('discussion of a record (200 comments)', (i) => svc.comments.list(pm, { entity: 'perf_rec', id: String(1 + (i % RECORDS)) })));
worst.push(time('timeline of a record', (i) => svc.timeline.record(pm, { entity: 'perf_rec', id: String(1 + (i % RECORDS)), limit: 50, offset: 0 })));
worst.push(time('timeline, filtered to comments and text', (i) => svc.timeline.record(pm, { entity: 'perf_rec', id: String(1 + (i % RECORDS)), kinds: ['comment'], q: 'work', limit: 50, offset: 0 })));
worst.push(time('project feed', (i) => svc.timeline.project(pm, { projectId: 1 + (i % 60), limit: 50, offset: 0 }), 30));
worst.push(time('trace, depth 3', (i) => svc.trace.graph(pm, { entity: 'perf_rec', id: String(1 + (i % RECORDS)), depth: 3 })));
worst.push(time('trace, depth 8', (i) => svc.trace.graph(pm, { entity: 'perf_rec', id: String(1 + (i % RECORDS)), depth: 8 })));
worst.push(time('mentions inbox', (i) => svc.mentions.list({ user: `user${i % 50}`, roles: ['PD'], companyId: 1 }, { limit: 30, offset: 0 }), 30));
worst.push(time('unread mentions count', (i) => svc.mentions.unreadCount({ user: `user${i % 50}`, roles: ['PD'], companyId: 1 }), 30));
for (const [label, sql] of [
  ['comments of a record', "SELECT id FROM col_comments WHERE company_id = 1 AND entity = 'perf_rec' AND entity_id = '77' AND is_active = 1 ORDER BY id"],
  ['comments of a project (feed)', "SELECT id FROM col_comments WHERE company_id = 1 AND project_id = 5 AND is_active = 1 AND status = 'ACTIVE' ORDER BY id DESC LIMIT 600"],
  ['mentions of a person', "SELECT id FROM col_mentions WHERE company_id = 1 AND mentioned_user = 'user7' AND is_active = 1 AND read_at IS NULL ORDER BY id DESC LIMIT 500"],
  ['trace upstream', "SELECT id FROM col_trace_links WHERE company_id = 1 AND to_entity = 'perf_rec' AND to_id = '77' AND is_active = 1"],
  ['trace downstream', "SELECT id FROM col_trace_links WHERE company_id = 1 AND from_entity = 'perf_rec' AND from_id = '77' AND is_active = 1"],
]) console.log(`\nPlan: ${label}\n${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((x) => `  ${x.detail}`).join('\n')}`);
const bad = worst.filter((x) => x > 500).length;
console.log(`\n${bad === 0 ? 'All within the standard (p95 <= 500 ms).' : `${bad} measure(s) above 500 ms.`}`);
process.exit(bad === 0 ? 0 : 1);
