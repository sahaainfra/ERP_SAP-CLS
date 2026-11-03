// npm run erp:ntf-perf -- [--rows 100000] [--queries 100]
// Part 04.06: fills the notifications (default 100 000 over 400 people), their deliveries and the real-time log, and times what the screens ask: the centre and the bell of a person, the
// unread counts, the delivery log with filters and its summary, a replay after a reconnect, and the writing of a notification (notify). Prints query plans.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record; a save is <= 800 ms.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { notificationsOf } from '../src/server/platform/notify/index.js';
import { realtimeOf } from '../src/server/platform/realtime/index.js';
import { createNotificationService } from '../src/server/modules/eng/notifications.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const engine = workflowOf(db);
const svc = createNotificationService({ db, engine });
const n = notificationsOf(db);
const hub = realtimeOf(db);
const sys = { user: 'perf-admin', roles: ['ITADM'], companyId: 1 };
const cats = ['approvals', 'approvals', 'tasks', 'alerts', 'system', 'mentions', 'security'];
const channels = ['EMAIL', 'SMS', 'PUSH', 'WHATSAPP'];
const statuses = ['SENT', 'SENT', 'SENT', 'DELIVERED', 'DEFERRED', 'FAILED', 'SKIPPED', 'PENDING'];
console.log(`Filling ${rows} notifications, ${rows} deliveries and ${Math.round(rows / 4)} real-time events...`);
db.exec('BEGIN');
const insN = db.prepare("INSERT INTO ntf_notifications (company_id, user_ref, template_code, title, body, link, category, priority, in_app, read_at, archived_at, event_key, created_at, created_by, source_type) VALUES (1, ?, 'workflow.task.assigned', ?, 'A synthetic notification for timing the screens', '/approvals', ?, 'NORMAL', 1, ?, ?, ?, ?, 'perf', 'perf')");
const insD = db.prepare("INSERT INTO ntf_deliveries (company_id, notification_id, user_ref, channel, address, subject, body, status, attempts, last_error, created_at, created_by, source_type) VALUES (1, ?, ?, ?, 'x@example.com', 's', 'b', ?, ?, ?, ?, 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const at = new Date(Date.UTC(2026, 3, 1) + i * 30_000).toISOString();
  const id = Number(insN.run(`user${i % 400}`, `Approval needed ${i}`, cats[i % cats.length], i % 3 === 0 ? null : at, i % 11 === 0 ? at : null, `perf-${i}`, at).lastInsertRowid);
  const st = statuses[i % statuses.length];
  insD.run(id, `user${i % 400}`, channels[i % channels.length], st, st === 'FAILED' ? 5 : 1, st === 'FAILED' ? 'Connection refused' : null, at);
}
const insE = db.prepare("INSERT INTO ntf_realtime_events (company_id, room, event_type, entity, entity_id, data_json, occurred_at, created_by, source_type) VALUES (1, ?, 'workflow.task.created', 'workflow_instance', ?, '{}', ?, 'perf', 'perf')");
for (let i = 1; i <= rows / 4; i += 1) insE.run(`record:workflow_instance:${i % 2000}`, String(i % 2000), new Date(Date.UTC(2026, 3, 1) + i * 30_000).toISOString());
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const me = (i) => ({ user: `user${i % 400}`, roles: ['PM'], companyId: 1 });
const worst = [];
worst.push(time('the centre, page 1 (25)', (i) => svc.centre.list(me(i), { limit: 25, offset: 0 })));
worst.push(time('the centre, unread only', (i) => svc.centre.list(me(i), { state: 'unread', limit: 25 })));
worst.push(time('the centre, one kind and a word', (i) => svc.centre.list(me(i), { category: 'approvals', q: 'needed 1', limit: 25 })));
worst.push(time('the bell count', (i) => n.unread(1, `user${i % 400}`)));
worst.push(time('mark one read', (i) => svc.centre.mark(me(i), Number(db.prepare('SELECT id FROM ntf_notifications WHERE user_ref = ? AND read_at IS NULL LIMIT 1').get(`user${i % 400}`)?.id ?? 0) || 1, true)));
worst.push(time('delivery log, page 1', () => svc.deliveries.list(sys, { limit: 25, offset: 0 })));
worst.push(time('delivery log, page 400', () => svc.deliveries.list(sys, { limit: 25, offset: 9_975 })));
worst.push(time('delivery log, failed e-mail', () => svc.deliveries.list(sys, { channel: 'EMAIL', status: 'FAILED', limit: 25 })));
worst.push(time('delivery log, one person', (i) => svc.deliveries.list(sys, { user: `user${i % 400}`, limit: 25 })));
worst.push(time('delivery summary', () => svc.deliveries.summary(sys, {})));
worst.push(time('replay of a room (500 events)', (i) => hub.replay({ user: 'x', roles: ['SYSADM'], companyId: 1 }, `record:workflow_instance:${i % 2000}`, 0)));
worst.push(time('notify one person (all channels)', (i) => n.notify({ companyId: 1, templateCode: 'workflow.step.notified', recipients: [`user:user${i % 400}`], data: { docLabel: 'PO', docRef: `P${i}`, docTitle: 'x', step: 'S' }, eventKey: `perf-notify-${i}-${Math.random()}`, priority: 'NORMAL' })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['the centre of a person', "SELECT * FROM ntf_notifications WHERE company_id = 1 AND user_ref = 'user7' AND in_app = 1 AND archived_at IS NULL ORDER BY id DESC LIMIT 25"],
  ['unread count of a person', "SELECT COUNT(*) FROM ntf_notifications WHERE company_id = 1 AND user_ref = 'user7' AND in_app = 1 AND read_at IS NULL AND archived_at IS NULL"],
  ['deliveries by status and channel', "SELECT * FROM ntf_deliveries WHERE company_id = 1 AND status = 'FAILED' AND channel = 'EMAIL' ORDER BY id DESC LIMIT 25"],
  ['deliveries due to be sent', "SELECT * FROM ntf_deliveries WHERE status = 'PENDING' AND next_attempt_at <= '2026-12-01'"],
  ['deliveries held for a digest', "SELECT * FROM ntf_deliveries WHERE status = 'DEFERRED' AND deliver_after <= '2026-12-01'"],
  ['events of a room after a number', "SELECT * FROM ntf_realtime_events WHERE company_id = 1 AND room = 'record:workflow_instance:5' AND id > 100 ORDER BY id LIMIT 500"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll list shapes are inside the 500 ms standard.');
process.exit(bad.length ? 1 : 0);
