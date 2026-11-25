import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { THREADS } from '../src/server/modules/tst/threads.js';
import { tstOf } from '../src/server/modules/tst/index.js';
import { enableFlags, threadsApi } from './tst-fixtures.js';

// Part 30.01 — cross-module integration and real-time propagation.
//  T-01  every mandatory thread (IT-01 … IT-15) passes end to end on the seeded company: each hand-off finds its source, carries the
//        source's fields unchanged, and no posting failed; the run is GREEN and the matrix lists the producers, events, consumers and tests.
//  FR-02 the latency probe goes through the outbox, the bus, the real-time room and the notification within 2 s.
//  FR-03 a field typed again (a GRN for another vendor than its order) and a broken hand-off (an AP bill whose invoice is gone) are found.
//  FR-04 a dead letter fails its edge; a subscription to an event nobody declares is listed.
//  Standard set: 403 by role, another company's run not found, flag off, 409 while a run is queued, idempotent replay, export with audit.
const opened = [];
after(async () => { for (const a of opened) await a.close(); });
const QA = { roles: 'ITADM', user: 'qa-lead', company: '1' };
const AUD = { roles: 'AUD', user: 'auditor', company: '1' };
const key = (k = `tst-${Math.random().toString(36).slice(2)}`) => ({ 'idempotency-key': k });
const I = '/api/v1/tst/integration';
async function world() { const w = await threadsApi(); opened.push(w.api); return w; }
async function run(w, who = QA) {
  const r = await w.api.call('POST', `${I}/runs`, { ...who, headers: key(), body: {} });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  await runtimeOf(w.d).jobs.drain(5);
  const g = await w.api.call('GET', `${I}/runs/${r.json.data.id}`, who);
  assert.equal(g.status, 200, JSON.stringify(g.json));
  return g.json.data;
}

test('T-01 every mandatory thread passes end to end: hand-offs linked, nothing re-keyed, every thread exercised', async () => {
  const w = await world();
  const out = await run(w);
  assert.equal(out.status, 'DONE');
  assert.equal(out.result, 'GREEN', JSON.stringify(out.totals));
  assert.equal(out.threads.length, THREADS.length);
  assert.ok(THREADS.length >= 15, 'fifteen or more threads');
  for (const t of out.threads) {
    assert.equal(t.status, 'PASS', `${t.code} ${t.name}: ${JSON.stringify(t.handoffs.filter((h) => h.status !== 'PASS'))}`);
    assert.equal(t.coverage, 100, `${t.code}: every hand-off has data`);
  }
  assert.deepEqual(out.threads.map((t) => t.code), THREADS.map((t) => t.code));
  assert.equal(out.totals.rekeyed, 0);
  assert.equal(out.totals.handoffsBroken, 0);
  assert.equal(out.totals.threadsPassed, THREADS.length);
  // the matrix: every event of the catalogue with each consumer the bus delivers it to; the hand-off events carry their thread IDs
  const m = await w.api.call('GET', `${I}?pageSize=200&q=bill.sub.approved`, QA);
  assert.equal(m.status, 200, JSON.stringify(m.json));
  const rows = m.json.data.matrix.rows;
  assert.deepEqual(rows.map((r) => r.consumer).sort(), ['bill.ledger_sub', 'fin.ap_sub_bill', 'fin.posting']);
  for (const r of rows) { assert.equal(r.producer, 'bill'); assert.ok(r.threads.includes('IT-07.3'), 'the thread hand-off'); assert.ok(r.tests.length > 0, `${r.consumer}: covered by a test`); }
  assert.ok(m.json.data.totals.edges > 300 && m.json.data.totals.eventTypes > 800);
  // the trace of a purchase order now reaches its AP bill and payment (166.7 listed them as not yet available)
  const flow = await w.api.call('GET', `/api/v1/ui/doc-flow?type=PO&id=${w.ids.PO}`, { roles: 'ACCMGR,PROCMGR', user: 'acc', company: '1' });
  assert.equal(flow.status, 200, JSON.stringify(flow.json));
  assert.deepEqual(flow.json.data.nodes.map((n) => n.type), ['MR', 'PR', 'RFQ', 'CS', 'PO', 'GATE', 'GRN', 'QC', 'ISSUE', 'VINV', 'APBILL', 'PAY']);
  assert.deepEqual(flow.json.data.later, []);
  const bill = await w.api.call('GET', `/api/v1/ui/doc-flow?type=TINV&id=${w.ids.TI}`, { roles: 'ACCMGR,QS', user: 'acc', company: '1' });
  assert.deepEqual(bill.json.data.nodes.map((n) => n.type), ['CBILL', 'CERT', 'TINV', 'ARINV', 'RCPT']);
});

test('FR-03 a re-keyed field and a broken hand-off are found against the owning thread; BR-01 the run is RED until fixed', async () => {
  const w = await world();
  const other = Number(w.d.prepare("INSERT INTO mdm_partners (company_id, code, legal_name, trade_name, constitution, partner_status, steward_role, created_by) VALUES (1, 'VEN-09', 'Other Traders', 'Other', 'PRIVATE_LIMITED', 'ACTIVE', 'PROCMGR', 'test')").run().lastInsertRowid);
  w.d.prepare('UPDATE inv_grns SET vendor_id = ? WHERE id = ?').run(other, w.ids.GRN);
  w.d.exec('PRAGMA foreign_keys = OFF');
  w.d.prepare('UPDATE ap_bills SET source_ref = ? WHERE id = ?').run('999999', w.ids.APV);
  w.d.exec('PRAGMA foreign_keys = ON');
  const out = await run(w);
  assert.equal(out.result, 'RED');
  const t = out.threads.find((x) => x.code === 'IT-02');
  assert.equal(t.status, 'FAIL');
  const grn = t.handoffs.find((h) => h.code === 'IT-02.7');
  assert.equal(grn.status, 'REKEYED');
  assert.deepEqual(grn.rekeyedRows.map((r) => [r.ref, r.field, r.value, r.source]), [['GRN/TWR-A/0001', 'vendor_id', String(other), String(w.ids.V)]]);
  assert.equal(grn.rekeyedRows[0].fieldLabel, 'Vendor of the order');
  const ap = t.handoffs.find((h) => h.code === 'IT-02.10');
  assert.equal(ap.status, 'BROKEN');
  assert.deepEqual(ap.brokenRows.map((r) => r.ref), ['APB/26-27/0001']);
  assert.ok(out.rekeying.some((r) => r.handoff === 'IT-02.7' && r.count === 1));
  // the same change shows where the vendor travelled next: the fuel received against that GRN still names the order's vendor
  const fuel = out.threads.find((x) => x.code === 'IT-05').handoffs.find((h) => h.code === 'IT-05.6');
  assert.equal(fuel.status, 'REKEYED');
  // the other threads are untouched
  assert.deepEqual(out.threads.filter((x) => x.status !== 'PASS').map((x) => x.code), ['IT-02', 'IT-05']);
});

test('FR-02 the latency probe: event → bus → real-time room and notification within the 2 s target; the probe of another company is not visible', async () => {
  const w = await world();
  const sent = await w.api.call('POST', `${I}/probes`, { ...QA, headers: key(), body: {} });
  assert.equal(sent.status, 202, JSON.stringify(sent.json));
  assert.equal(sent.json.data.status, 'SENT');
  assert.equal(sent.json.data.targetMs, 2000);
  runtimeOf(w.d).bus.drain();
  const got = await w.api.call('GET', `${I}/probes/${sent.json.data.id}`, QA);
  assert.equal(got.json.data.status, 'PASS', JSON.stringify(got.json));
  for (const k of ['busMs', 'realtimeMs', 'notificationMs']) assert.ok(got.json.data[k] >= 0 && got.json.data[k] <= 2000, `${k} ${got.json.data[k]}`);
  // the person's room got the event and the person got the notification
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM ntf_realtime_events WHERE room = 'user:qa-lead' AND event_type = 'tst.probe.delivered'").get().n, 1);
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_type = 'tst_latency_probes' AND source_id = ?").get(String(sent.json.data.id)).n, 1);
  const o = await w.api.call('GET', I, QA);
  assert.ok(o.json.data.latency.p95Ms <= 2000 && o.json.data.latency.withinTarget);
  enableFlags(w.d, 2, ['ff.qa.p3001']);
  assert.equal((await w.api.call('GET', `${I}/probes/${sent.json.data.id}`, { ...QA, company: '2' })).status, 404);
});

test('FR-04 a dead letter fails its edge, a pending event past its time too; subscriptions to undeclared events are listed', async () => {
  const w = await world();
  const bus = runtimeOf(w.d).bus;
  // a real event the posting engine and the AP consumer take; one delivery dead, one handled
  const o = Number(w.d.prepare("INSERT INTO core_outbox (event_type, aggregate_id, payload, published_at) VALUES ('bill.sub.approved', 'bill_sub_bills:1', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(JSON.stringify({ eventId: 'e-dead-1', companyId: 1, data: {} })).lastInsertRowid);
  w.d.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, company_id, status, attempts, next_attempt_at, last_error) VALUES ('fin.ap_sub_bill', 'e-dead-1', ?, 'bill.sub.approved', 1, 'DEAD', 5, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'no such bill')").run(o);
  w.d.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, company_id, status, attempts, next_attempt_at, processed_at) VALUES ('bill.ledger_sub', 'e-dead-1', ?, 'bill.sub.approved', 1, 'PROCESSED', 1, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))").run(o);
  w.d.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, company_id, status, attempts, next_attempt_at, created_at) VALUES ('fin.posting', 'e-dead-1', ?, 'bill.sub.approved', 1, 'PENDING', 0, '2099-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run(o);
  const out = await run(w);
  const edges = out.matrix.filter((r) => r.event === 'bill.sub.approved');
  assert.equal(edges.find((r) => r.consumer === 'fin.ap_sub_bill').status, 'FAIL');
  assert.equal(edges.find((r) => r.consumer === 'fin.ap_sub_bill').dead, 1);
  assert.equal(edges.find((r) => r.consumer === 'bill.ledger_sub').status, 'PASS');
  assert.equal(edges.find((r) => r.consumer === 'fin.posting').status, 'FAIL', 'pending for longer than the alert time');
  assert.equal(out.result, 'RED');
  assert.ok(out.totals.edgesFailed >= 2);
  // the budget ledger waits for work-order and service-order events under names the producers do not publish (recorded as a defect)
  assert.ok(out.dangling.some((x) => x.consumer === 'bud.ledger' && x.pattern === 'ctr.workorder.approved'));
  assert.ok(bus.consumers().some((c) => c.name === 'tst.probe'));
  // filters and the history
  const f = await w.api.call('GET', `${I}?status=FAIL&pageSize=200`, QA);
  assert.ok(f.json.data.matrix.rows.length >= 2 && f.json.data.matrix.rows.every((r) => r.status === 'FAIL'));
  assert.equal(f.json.data.history.length, 1);
});

test('AC-03 roles, scope and safety: SE 403, AUD reads but does not run, another company and the flag off are not found, 409 while queued, idempotent replay, export audited', async () => {
  const w = await world();
  assert.equal((await w.api.call('GET', I, { roles: 'SE', user: 'se1', company: '1' })).status, 403);
  assert.equal((await w.api.call('GET', I, AUD)).status, 200);
  assert.equal((await w.api.call('POST', `${I}/runs`, { ...AUD, headers: key(), body: {} })).status, 403);
  assert.equal((await w.api.call('POST', `${I}/probes`, { ...AUD, headers: key(), body: {} })).status, 403);
  // without the flag the console is not there
  assert.equal((await w.api.call('GET', I, { ...QA, company: '2' })).status, 404);
  const out = await run(w);
  enableFlags(w.d, 2, ['ff.qa.p3001']);
  assert.equal((await w.api.call('GET', `${I}/runs/${out.id}`, { ...QA, company: '2' })).status, 404, 'another company\'s run');
  // a queued run blocks a second one; the same key replays the first answer
  const k = key('replay-1');
  const a = await w.api.call('POST', `${I}/runs`, { ...QA, headers: k, body: {} });
  const b = await w.api.call('POST', `${I}/runs`, { ...QA, headers: k, body: {} });
  assert.equal(a.status, 202); assert.equal(b.status, 202); assert.equal(b.json.data.id, a.json.data.id);
  const c = await w.api.call('POST', `${I}/runs`, { ...QA, headers: key(), body: {} });
  assert.equal(c.status, 409, JSON.stringify(c.json));
  assert.ok(c.json.error.correlationId);
  assert.equal((await w.api.call('POST', `${I}/runs`, { ...QA, body: {} })).status, 400, 'the idempotency key is required');
  assert.equal((await w.api.call('GET', `${I}?status=WRONG`, QA)).status, 400);
  await runtimeOf(w.d).jobs.drain(5);
  const x = await w.api.raw('GET', `${I}/export?format=xlsx`, QA);
  assert.equal(x.status, 200);
  assert.match(x.headers.get('content-type'), /spreadsheetml/);
  assert.equal(w.d.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.integration_matrix' AND action = 'export'").get().n, 1);
  assert.equal((await w.api.raw('GET', `${I}/export?format=csv`, { roles: 'SE', user: 'se1', company: '1' })).status, 403);
  // the run notified the person who started it
  assert.ok(w.d.prepare("SELECT COUNT(*) AS n FROM ntf_notifications WHERE source_type = 'tst_integration_runs'").get().n >= 1);
  // the service guards the job path too: a company without the flag gets nothing
  assert.throws(() => tstOf(w.d).integration.overview({ companyId: 3, user: 'x', roles: ['ITADM'] }), /not enabled/);
});

test('D-777 the monthly lock of a project reaches the measurement book: a measurement dated in a locked month is refused', async () => {
  const w = await world();
  w.d.prepare("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) VALUES ('ff.bill.p2201', 1, 'mb', 0, 1)").run();
  w.d.prepare("UPDATE mc_monthly_closes SET project_id = ?, status = 'APPROVED', lock_state = 'LOCKED', locked_at = '2026-11-05T00:00:00Z' WHERE company_id = 1").run(w.ids.A);
  const QS = { roles: 'QS', user: 'qs1', company: '1' };
  const body = { projectId: w.ids.A, boqLineId: 1, description: 'Excavation for raft, grid A-C', measuredOn: '2026-10-20' };
  const locked = await w.api.call('POST', '/api/v1/bill/mb-entries', { ...QS, headers: key(), body });
  assert.equal(locked.status, 422, JSON.stringify(locked.json));
  assert.equal(locked.json.error.code, 'PERIOD_LOCKED');
  assert.match(locked.json.error.message, /2026-10/);
  const open = await w.api.call('POST', '/api/v1/bill/mb-entries', { ...QS, headers: key(), body: { ...body, measuredOn: '2026-11-02' } });
  assert.notEqual(open.json?.error?.code, 'PERIOD_LOCKED', 'an open month is not refused by the lock');
});
