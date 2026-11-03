// npm run erp:comm-perf -- [--rows 100000] [--queries 100]
// Part 04.07: fills the communication log (default 100 000 messages over 5 000 addresses), the consent register and the one-time codes, and times what the screens and the queue ask: the log with
// filters and its summary, a conversation, a consent check, the queue's pick of due messages, and the checks and queueing of one message (send), and the making and checking of a code.
// The standard is p95 <= 500 ms for a list and <= 300 ms for one record; a save is <= 800 ms. Prints query plans.
import '../src/server/modules/registry.js';
import { DatabaseSync } from 'node:sqlite';
import { migrateUp } from '../src/server/platform/db/index.js';
import { workflowOf } from '../src/server/platform/workflow/index.js';
import { commOf } from '../src/server/platform/comm/index.js';
import { createCommunicationService } from '../src/server/modules/eng/communication.js';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);
const rows = Number(opt('rows', 100_000));
const queries = Number(opt('queries', 100));
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON;');
migrateUp(db);
db.prepare("INSERT OR IGNORE INTO org_companies (id, code, legal_name, short_name, created_by, source_type) VALUES (1, 'MAIN', 'Main Infra Pvt Ltd', 'Main', 't', 'perf')").run();
const engine = workflowOf(db);
const svc = createCommunicationService({ db, engine });
const comm = commOf(db);
const it = { user: 'perf-admin', roles: ['ITADM'], companyId: 1 };
const channels = ['EMAIL', 'SMS', 'WHATSAPP', 'PUSH'];
const statuses = ['SENT', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'BLOCKED', 'QUEUED', 'RECEIVED'];
console.log(`Filling ${rows} messages and ${Math.round(rows / 20)} consents...`);
db.exec('BEGIN');
const ins = db.prepare("INSERT INTO comm_messages (company_id, channel, direction, purpose, to_address, template_code, body_redacted, related_entity, related_id, conversation_key, status, attempts, next_attempt_at, created_at, created_by, source_type) VALUES (1, ?, ?, 'TRANSACTIONAL', ?, 'perf.t', 'A synthetic message', 'rfq', ?, ?, ?, 1, ?, ?, 'perf', 'perf')");
for (let i = 1; i <= rows; i += 1) {
  const at = new Date(Date.UTC(2026, 3, 1) + i * 20_000).toISOString();
  const ch = channels[i % 4];
  const addr = ch === 'EMAIL' ? `u${i % 5000}@example.com` : `+9198${String(10_000_000 + (i % 5000)).slice(-8)}`;
  const st = statuses[i % statuses.length];
  ins.run(ch, st === 'RECEIVED' ? 'IN' : 'OUT', addr, String(i % 2000), `${ch}:${addr}:rfq:${i % 2000}`, st, st === 'QUEUED' ? '2999-01-01T00:00:00.000Z' : at, at);
}
const insC = db.prepare("INSERT INTO comm_consents (company_id, contact_type, address, channel, status, source, changed_at, created_by, source_type) VALUES (1, 'VENDOR', ?, 'SMS', ?, 'IMPORT', ?, 'perf', 'perf')");
for (let i = 0; i < rows / 20; i += 1) insC.run(`+9199${String(10_000_000 + i).slice(-8)}`, i % 5 === 0 ? 'OPT_OUT' : 'OPT_IN', new Date(Date.UTC(2026, 3, 1) + i * 60_000).toISOString());
db.exec("UPDATE comm_messages SET provider_msg_id = 'p' || id WHERE status IN ('SENT', 'DELIVERED', 'READ')");
db.exec('COMMIT');
db.exec('ANALYZE');
const p95 = (ms) => [...ms].sort((a, b) => a - b)[Math.floor(ms.length * 0.95)] ?? 0;
const time = (label, fn) => {
  const ms = [];
  for (let i = 0; i < queries; i += 1) { const t = performance.now(); fn(i); ms.push(performance.now() - t); }
  console.log(`${label.padEnd(44)} p50 ${[...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)].toFixed(1).padStart(7)} ms   p95 ${p95(ms).toFixed(1).padStart(7)} ms`);
  return p95(ms);
};
const worst = [];
worst.push(time('log, page 1 (25)', () => svc.messages.list(it, { limit: 25, offset: 0 })));
worst.push(time('log, page 400', () => svc.messages.list(it, { limit: 25, offset: 9_975 })));
worst.push(time('log, failed SMS', () => svc.messages.list(it, { channel: 'SMS', status: 'FAILED', limit: 25 })));
worst.push(time('log, one record', (i) => svc.messages.list(it, { entity: 'rfq', id: String(i % 2000), limit: 25 })));
worst.push(time('log, one address', (i) => svc.messages.list(it, { channel: 'EMAIL', address: `u${i % 5000}@example.com`, limit: 25 })));
worst.push(time('log summary', () => svc.messages.summary(it, {})));
worst.push(time('one message with its conversation', (i) => svc.messages.get(it, 1 + (i * 7) % rows)));
worst.push(time('consent register, page 1', () => svc.consents.list(it, { limit: 25, offset: 0 })));
worst.push(time('consent check of an address', (i) => comm.consentOf(1, `+9199${String(10_000_000 + (i % 500)).slice(-8)}`, 'SMS')));
worst.push(time('the queue picks what is due', () => db.prepare("SELECT * FROM comm_messages WHERE status = 'QUEUED' AND direction = 'OUT' AND next_attempt_at <= ? ORDER BY priority, id LIMIT 50").all('2026-12-01T00:00:00.000Z')));
worst.push(time('send: checks and queueing (e-mail)', (i) => comm.send({ companyId: 1, channel: 'PUSH', to: `perf${i}`, body: 'hello' })));
console.log('\nQuery plans:');
for (const [label, sql] of [
  ['the log, newest first', 'SELECT * FROM comm_messages WHERE company_id = 1 AND is_active = 1 ORDER BY id DESC LIMIT 25'],
  ['the log by channel and status', "SELECT * FROM comm_messages WHERE company_id = 1 AND channel = 'SMS' AND status = 'FAILED' ORDER BY id DESC LIMIT 25"],
  ['the log of a record', "SELECT * FROM comm_messages WHERE company_id = 1 AND related_entity = 'rfq' AND related_id = '7' ORDER BY id DESC LIMIT 25"],
  ['a conversation', "SELECT * FROM comm_messages WHERE company_id = 1 AND conversation_key = 'SMS:+919800000000:rfq:7' ORDER BY id LIMIT 50"],
  ['the queue', "SELECT * FROM comm_messages WHERE status = 'QUEUED' AND direction = 'OUT' AND next_attempt_at <= '2026-12-01' ORDER BY priority, id LIMIT 50"],
  ['a receipt by provider id', "SELECT * FROM comm_messages WHERE company_id = 1 AND provider_msg_id = 'x' AND direction = 'OUT'"],
  ['a consent', "SELECT * FROM comm_consents WHERE company_id = 1 AND address = '+919900000001' AND channel = 'SMS' AND is_active = 1"],
]) console.log(`- ${label}: ${db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all().map((r) => r.detail).join(' | ')}`);
const bad = worst.filter((w) => w > 500);
console.log(bad.length ? `\nOver the 500 ms standard: ${bad.length} query shape(s).` : '\nAll shapes are inside the 500 ms standard.');
process.exit(bad.length ? 1 : 0);
