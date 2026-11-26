import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createEventBus, createEventTypeRegistry, EventSchemaError, eventTypes, maskPayload, publishEvent, syncEventTypes } from '../src/server/platform/events/index.js';
import { transaction, ROOT } from '../src/server/platform/db/index.js';
import { runtimeOf, startWorkers } from '../src/server/platform/runtime/index.js';
import '../src/server/modules/registry.js';
import { CORE_EVENT_TYPES, PROJECTION_CONSUMER } from '../src/server/modules/core/operations.js';
import { memoryDb, startApi } from './helpers.js';

const evt = (db, over = {}) => publishEvent(db, { type: 'test.thing.happened', entity: 'thing', entityId: 7, actorId: 'tester', companyId: 1, data: { n: 1 }, ...over });
const count = (db, sql) => db.prepare(sql).get().n;
/** A bus with a clock the test controls. */
const clocked = (db, opts = {}) => {
  const clock = { t: Date.parse('2026-10-30T10:00:00.000Z') };
  const bus = createEventBus({ db, now: () => new Date(clock.t), ...opts });
  return { bus, clock };
};

// ---- the outbox ----
test('T-01 a business transaction that rolls back leaves no outbox row', () => {
  const db = memoryDb();
  assert.throws(() =>
    transaction(db, () => {
      evt(db);
      throw new Error('the document could not be saved');
    }),
  );
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM core_outbox'), 0);
  transaction(db, () => evt(db));
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM core_outbox'), 1, 'a committed transaction keeps its event');
});

test('FR-02 the envelope carries every standard field', () => {
  const db = memoryDb();
  const e = evt(db, { projectId: 4, siteId: 9, correlationId: 'corr-1', version: 3 });
  for (const k of ['eventId', 'type', 'version', 'occurredAt', 'companyId', 'projectId', 'siteId', 'entity', 'entityId', 'actorId', 'correlationId', 'data']) assert.ok(k in e, `${k} is in the envelope`);
  assert.deepEqual([e.type, e.projectId, e.siteId, e.correlationId, e.entityVersion, e.entityId], ['test.thing.happened', 4, 9, 'corr-1', 3, '7']);
  const stored = JSON.parse(db.prepare('SELECT payload FROM core_outbox').get().payload);
  assert.deepEqual(stored, e);
});

test('FR-03 a catalogued event type validates its payload and takes the catalogue version', () => {
  const reg = createEventTypeRegistry();
  reg.define({ type: 'test.order.placed', version: 2, owner: 'test', schema: { type: 'object', required: ['qty'], properties: { qty: { type: 'integer' }, kind: { type: 'string', enum: ['a', 'b'] } } } });
  assert.deepEqual(reg.validate('test.order.placed', { qty: 3, kind: 'a' }), []);
  assert.deepEqual(reg.validate('test.order.placed', { kind: 'z', qty: 'x' }).sort(), ['data.kind must be one of a, b', 'data.qty must be integer, not string']);
  assert.deepEqual(reg.validate('test.order.placed', {}), ['data.qty is required']);
  assert.deepEqual(reg.validate('other.unknown.thing', {}), [], 'an unregistered type is not validated');
  assert.throws(() => reg.define({ type: 'bad type', owner: 'x' }), /module.entity/);
  assert.throws(() => reg.define({ type: 'test.order.placed', version: 2, owner: 'test' }), /already defined/);
  assert.throws(() => reg.define({ type: 'test.order.placed', version: 3 }), /owning module/);
  assert.throws(() => reg.define({ type: 'test.order.sent', owner: 'test', schema: { type: 'date' } }), /not supported/);

  eventTypes.define({ type: 'test.strict.recorded', version: 4, owner: 'test', schema: { type: 'object', required: ['amount'], properties: { amount: { type: 'integer' } } } });
  const db = memoryDb();
  assert.throws(() => evt(db, { type: 'test.strict.recorded', data: {} }), EventSchemaError);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM core_outbox'), 0, 'an invalid payload is never stored');
  assert.equal(evt(db, { type: 'test.strict.recorded', data: { amount: 5 } }).version, 4);
  syncEventTypes(db);
  assert.ok(db.prepare("SELECT 1 FROM core_event_types WHERE type = 'test.strict.recorded' AND version = 4").get());
  syncEventTypes(db); // idempotent
});

test('every event type the core module publishes is in the catalogue', () => {
  const found = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith('.js')) for (const m of readFileSync(p, 'utf8').matchAll(/type: '(core\.[a-z_]+\.[a-z_]+)'/g)) found.add(m[1]);
    }
  };
  walk(join(ROOT, 'src', 'server'));
  const missing = [...found].filter((t) => !CORE_EVENT_TYPES.includes(t) && !eventTypes.get(t));
  assert.deepEqual(missing, []);
});

test('payloads shown to administrators are masked', () => {
  assert.deepEqual(maskPayload({ pan: 'ABCDE1234F', gstin: 'x', unitRate: 5, bank_account: '1', name: 'ok', nested: { salary: 9, items: [{ cost: 1, id: 2 }] }, empty: null }), {
    pan: '***', gstin: '***', unitRate: '***', bank_account: '***', name: 'ok', nested: { salary: '***', items: [{ cost: '***', id: 2 }] }, empty: null,
  });
});

// ---- consumers ----
test('FR-04 the relay queues each event once per subscribed consumer and the consumer reacts', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  const seen = { a: [], b: [] };
  bus.subscribe('test.thing.*', (e) => seen.a.push(e.eventId), { consumer: 'test.a' });
  bus.subscribe('test.thing.happened', (e) => seen.b.push(e.eventId), { consumer: 'test.b' });
  bus.subscribe('other.*', () => assert.fail('not subscribed'), { consumer: 'test.c' });
  const e = evt(db);
  assert.equal(bus.relayOnce(), 1);
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM core_inbox'), 2);
  assert.ok(db.prepare('SELECT published_at FROM core_outbox').get().published_at, 'the outbox row is marked published');
  assert.deepEqual(bus.deliverOnce(), { processed: 2, failed: 0, dead: 0 });
  assert.deepEqual([seen.a, seen.b], [[e.eventId], [e.eventId]]);
  assert.equal(bus.relayOnce(), 0, 'nothing left to relay');
});

test('T-02 a consumer that receives the same event twice processes it once', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  let calls = 0;
  bus.subscribe('test.thing.happened', () => (calls += 1), { consumer: 'test.once' });
  evt(db);
  bus.drain();
  assert.equal(calls, 1);
  // The transport hands the same event over again: the outbox row is relayed a second time.
  db.prepare('UPDATE core_outbox SET published_at = NULL').run();
  bus.drain();
  assert.equal(calls, 1, 'the inbox row for (consumer, eventId) already exists');
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM core_inbox'), 1);
  // Delivering the processed row again does nothing either.
  const row = db.prepare('SELECT * FROM core_inbox').get();
  assert.equal(bus.deliver(row), 'skipped');
  assert.equal(calls, 1);
});

test('BR-02 a handler and its inbox mark commit together: a failing handler leaves none of its writes', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  db.exec('CREATE TABLE tst_effects (n INTEGER)');
  bus.subscribe('test.thing.happened', (_e, { db: tx }) => {
    tx.exec('INSERT INTO tst_effects VALUES (1)');
    throw new Error('boom after writing');
  }, { consumer: 'test.atomic' });
  evt(db);
  bus.relayOnce();
  assert.deepEqual(bus.deliverOnce(), { processed: 0, failed: 1, dead: 0 });
  assert.equal(count(db, 'SELECT COUNT(*) AS n FROM tst_effects'), 0);
  const row = db.prepare('SELECT * FROM core_inbox').get();
  assert.deepEqual([row.status, row.attempts, row.last_error], ['PENDING', 1, 'boom after writing']);
});

test('FR-04 a failing consumer retries with exponential back-off, not before it is due', () => {
  const db = memoryDb();
  const { bus, clock } = clocked(db, { maxAttempts: 5 });
  let calls = 0;
  bus.subscribe('test.thing.happened', () => {
    calls += 1;
    throw new Error('down');
  }, { consumer: 'test.flaky' });
  evt(db);
  bus.relayOnce();
  bus.deliverOnce();
  assert.equal(calls, 1);
  const waits = [];
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const row = db.prepare('SELECT * FROM core_inbox').get();
    waits.push(Date.parse(row.next_attempt_at) - clock.t);
    assert.deepEqual(bus.deliverOnce(), { processed: 0, failed: 0, dead: 0 }, 'not due yet');
    clock.t = Date.parse(row.next_attempt_at);
    bus.deliverOnce();
  }
  assert.deepEqual(waits, [30_000, 60_000, 120_000]);
  assert.equal(calls, 4);
});

test('T-03 a poison message lands in the dead-letter queue after the configured attempts and can be re-driven after the fix', () => {
  const db = memoryDb();
  const { bus, clock } = clocked(db);
  let fixed = false;
  let handled = 0;
  bus.subscribe('test.thing.happened', () => {
    if (!fixed) throw new Error('cannot parse the payload');
    handled += 1;
  }, { consumer: 'test.poison', maxAttempts: 3 });
  evt(db);
  bus.relayOnce();
  for (let i = 0; i < 3; i += 1) {
    clock.t += 3_600_000;
    bus.deliverOnce();
  }
  const dead = db.prepare('SELECT * FROM core_inbox').get();
  assert.deepEqual([dead.status, dead.attempts, dead.last_error], ['DEAD', 3, 'cannot parse the payload']);
  clock.t += 3_600_000;
  assert.deepEqual(bus.deliverOnce(), { processed: 0, failed: 0, dead: 0 }, 'a dead letter is not retried by itself');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.event.dead_lettered'").get().n, 1, 'the dead letter is announced as an event');

  assert.throws(() => bus.redrive(9999, { actor: 'a', reason: 'x' }), /does not exist/);
  fixed = true;
  const back = bus.redrive(dead.id, { actor: 'itadm', reason: 'parser fixed in release 1.4' });
  assert.deepEqual([back.status, back.attempts, back.resolution], ['PENDING', 0, 'redriven']);
  assert.throws(() => bus.redrive(dead.id, { actor: 'itadm', reason: 'again' }), /not dead/);
  bus.deliverOnce();
  assert.equal(handled, 1);
  assert.equal(db.prepare('SELECT status FROM core_inbox').get().status, 'PROCESSED');
  const audit = db.prepare("SELECT actor, reason FROM core_audit_log WHERE entity = 'core_inbox' AND action = 'redrive'").get();
  assert.deepEqual({ ...audit }, { actor: 'itadm', reason: 'parser fixed in release 1.4' });
});

test('a dead letter can be discarded on purpose; it stays visible with who decided', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  bus.subscribe('test.thing.happened', () => { throw new Error('bad'); }, { consumer: 'test.discard', maxAttempts: 1 });
  evt(db);
  bus.drain();
  const dead = db.prepare('SELECT * FROM core_inbox').get();
  assert.equal(dead.status, 'DEAD');
  const out = bus.discard(dead.id, { actor: 'itadm', reason: 'obsolete event, no business effect' });
  assert.deepEqual([out.status, out.resolved_by, out.resolution], ['DISCARDED', 'itadm', 'discarded']);
  assert.throws(() => bus.discard(dead.id, { actor: 'itadm', reason: 'twice' }), /not dead/);
});

// ---- replay ----
test('AC-03 / FR-05 / BR-03 replaying a date range rebuilds a projection identically and suppresses side effects', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  const sent = [];
  const project = (event, ctx) => {
    ctx.db.prepare(
      `INSERT INTO core_projection_event_counts (company_id, event_type, total, last_event_at) VALUES (?, ?, 1, ?)
       ON CONFLICT (company_id, event_type) DO UPDATE SET total = total + 1, last_event_at = excluded.last_event_at`,
    ).run(event.companyId, event.type, event.occurredAt);
    if (!ctx.replay) sent.push(event.eventId); // an external notification: never during a replay
  };
  bus.subscribe('test.thing.*', project, { consumer: 'test.projection', reset: (tx) => tx.exec('DELETE FROM core_projection_event_counts') });
  const days = ['2026-10-01', '2026-10-02', '2026-10-02', '2026-10-05', '2026-10-09'];
  days.forEach((d, i) => evt(db, { type: i % 2 ? 'test.thing.moved' : 'test.thing.happened', companyId: i < 4 ? 1 : 2, now: new Date(`${d}T09:00:00.000Z`) }));
  bus.drain();
  const snapshot = () => db.prepare('SELECT * FROM core_projection_event_counts ORDER BY company_id, event_type').all().map((r) => ({ ...r }));
  const before = snapshot();
  assert.equal(sent.length, 5);
  assert.ok(before.length >= 3);
  const inboxBefore = db.prepare('SELECT * FROM core_inbox ORDER BY id').all().map((r) => ({ ...r }));

  const all = bus.replay({ types: ['test.thing.*'], reset: true });
  assert.deepEqual([all.events, all.deliveries], [5, 5]);
  assert.deepEqual(snapshot(), before, 'the projection is rebuilt identically');
  assert.equal(sent.length, 5, 'no notification was sent again');
  assert.deepEqual(db.prepare('SELECT * FROM core_inbox ORDER BY id').all().map((r) => ({ ...r })), inboxBefore, 'the inbox is untouched');

  const part = bus.replay({ types: ['test.thing.*'], from: '2026-10-02', to: '2026-10-05', reset: true });
  assert.equal(part.events, 3, 'only the events of the date range');
  assert.equal(snapshot().reduce((n, r) => n + r.total, 0), 3);
  const one = bus.replay({ types: ['test.thing.moved'], reset: true, companyId: 1 });
  assert.equal(one.events, 2, 'by type and company');
  assert.throws(() => bus.replay({ consumer: 'nope' }), /no consumer/);
});

test('a reset replay for one company rebuilds a reset consumer from every company, and gives a consumer without a reset only that company', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  const rebuilt = []; const kept = [];
  bus.subscribe('test.thing.*', (e) => rebuilt.push(e.companyId), { consumer: 'test.rebuilt', reset: () => { rebuilt.length = 0; } });
  bus.subscribe('test.thing.*', (e) => kept.push(e.companyId), { consumer: 'test.kept' });
  [1, 2, 1, 2].forEach((companyId) => evt(db, { companyId }));
  bus.drain();
  kept.length = 0;
  const r = bus.replay({ reset: true, companyId: 1 });
  assert.deepEqual(rebuilt.sort(), [1, 1, 2, 2], 'the emptied projection gets every company back');
  assert.deepEqual(kept, [1, 1], 'the consumer that kept its rows sees no other company again');
  assert.deepEqual([r.events, r.deliveries], [4, 6]);
});

test('replay stops when cancelled and reports progress', () => {
  const db = memoryDb();
  const { bus } = clocked(db);
  let handled = 0;
  bus.subscribe('test.thing.*', () => (handled += 1), { consumer: 'test.count' });
  for (let i = 0; i < 6; i += 1) evt(db);
  let calls = 0;
  const out = bus.replay({ types: ['*'], isCancelled: () => (calls += 1) > 3, onProgress: () => {} });
  assert.equal(out.cancelled, true);
  assert.equal(handled, 3);
});

// ---- metrics ----
test('FR-07 metrics report throughput, lag, failures and consumers', () => {
  const db = memoryDb();
  const { bus, clock } = clocked(db);
  syncEventTypes(db);
  bus.subscribe('test.thing.happened', () => { throw new Error('x'); }, { consumer: 'test.m', maxAttempts: 1 });
  evt(db, { companyId: 1 });
  evt(db, { companyId: 2 });
  evt(db, { type: 'unknown.thing.done', companyId: null });
  clock.t += 120_000;
  let m = bus.metrics({ companyId: 1 });
  assert.deepEqual([m.events.total, m.events.unpublished, m.events.relayLagSeconds >= 0], [2, 2, true], 'company 1 sees its own events and the system ones');
  assert.deepEqual(m.events.unregisteredTypes, ['test.thing.happened', 'unknown.thing.done']);
  bus.drain();
  m = bus.metrics({ companyId: 1 });
  assert.deepEqual([m.events.unpublished, m.inbox.dead, m.inbox.pending], [0, 1, 0]);
  assert.deepEqual(m.consumers.map((c) => [c.name, c.dead]), [['test.m', 1]]);
  assert.equal(bus.metrics().events.total, 3 + 2, 'unscoped sees everything, including the two dead-letter announcements');
});

// ---- the running worker ----
test('AC-01 the worker relays and delivers on its own, and the core projection reacts to a sample-document event', async () => {
  const api = await startApi();
  const stop = startWorkers(api.db, { intervalMs: 15, logger: { error: () => {} } });
  try {
    publishEvent(api.db, { type: 'core.sample_document.created', entity: 'sample_document', entityId: 1, actorId: 'tester', companyId: 1, data: {} });
    let row;
    for (let i = 0; i < 100 && !row; i += 1) {
      await new Promise((r) => setTimeout(r, 20));
      row = api.db.prepare("SELECT total FROM core_projection_event_counts WHERE event_type = 'core.sample_document.created'").get();
    }
    assert.equal(row?.total, 1);
    assert.equal(api.db.prepare("SELECT status FROM core_inbox WHERE consumer = ?").get(PROJECTION_CONSUMER).status, 'PROCESSED');
  } finally {
    stop();
    await api.close();
  }
});

test('the runtime is one bus, runner and scheduler per database', () => {
  const db = memoryDb();
  assert.equal(runtimeOf(db), runtimeOf(db));
  assert.notEqual(runtimeOf(db), runtimeOf(memoryDb()));
});
