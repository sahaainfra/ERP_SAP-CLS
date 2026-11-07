import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import '../src/server/modules/registry.js';
import { createLogger, createMemoryLogger, log } from '../src/server/platform/http/logger.js';
import { createLogBuffer } from '../src/server/platform/observability/logbuffer.js';
import { currentContext, pseudonym, runWithContext } from '../src/server/platform/observability/context.js';
import { instrumentDb } from '../src/server/platform/observability/dbstats.js';
import { HIST_EDGES, createMetrics, emptyHist, normaliseSql, percentile, withinMs } from '../src/server/platform/observability/metrics.js';
import { createOps, evaluateSlo } from '../src/server/platform/observability/ops.js';
import { maskTail, redact, redactText } from '../src/server/platform/observability/redact.js';
import { createTracer, formatTraceparent, parseTraceparent } from '../src/server/platform/observability/tracing.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { memoryDb, startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `obs-${n}-${Math.random().toString(36).slice(2, 10)}` });
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };

// ---- T-02 redaction (BR-01) ----
test('T-02 an object with PAN, bank, Aadhaar and secret fields is logged masked', () => {
  const out = redact({
    pan: 'ABCDE1234F', gstin: '27ABCDE1234F1Z5', bank_account: '123456789012', accountNumber: '9876543210', ifsc: 'HDFC0001234', aadhaar: '2345 6789 0123', salary: 85000,
    password: 'hunter2', token: 'abc.def',
    Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl', apiKey: 'sk-live-1', cookie: 'sid=1', client_secret: 'x', // secret-scan:allow fake credentials, the point of the test
    name: 'Meera', amount: 1250, nested: { panNumber: 'ZZZZZ9999Z', deeper: { document: 'the full text of a contract', content: 'secret clause' } }, list: [{ pan: 'AAAAA1111A' }], email: 'meera@example.com',
  });
  const text = JSON.stringify(out);
  for (const raw of ['ABCDE1234F', '27ABCDE1234F1Z5', '123456789012', '9876543210', 'HDFC0001234', '2345 6789 0123', 'hunter2', 'abc.def', 'eyJhbGci', 'sk-live-1', 'sid=1', 'ZZZZZ9999Z', 'AAAAA1111A', 'the full text', 'secret clause', 'meera@example.com']) {
    assert.ok(!text.includes(raw), `${raw} must not appear: ${text}`);
  }
  assert.equal(out.pan, 'XXXXXX234F', 'an identifier keeps its last four characters');
  assert.equal(out.bank_account, 'XXXXXXXX9012');
  assert.equal(out.salary, '[redacted]', 'what someone is paid is never logged, not even its last digits');
  assert.equal(out.password, '[redacted]');
  assert.equal(out.token, '[redacted]');
  assert.equal(out.nested.deeper.document, '[content omitted]');
  assert.deepEqual([out.name, out.amount], ['Meera', 1250], 'ordinary fields are untouched');
  assert.equal(maskTail('1234'), '****');
});

test('T-02 identifiers are masked inside free text, wherever they sit', () => {
  const t = redactText('Payment for PAN ABCDE1234F to account 123456789012 failed; GSTIN 27ABCDE1234F1Z5; aadhaar 2345-6789-0123; Bearer abcdefghijklmnop; mail meera@example.com; IFSC HDFC0001234');
  for (const raw of ['ABCDE1234F', '123456789012', '27ABCDE1234F1Z5', '2345-6789-0123', 'abcdefghijklmnop', 'meera@', 'HDFC0001234']) assert.ok(!t.includes(raw), `${raw} in: ${t}`);
  assert.match(t, /XXXXXX234F/);
  assert.match(t, /\*\*\*@example\.com/);
  assert.equal(redactText('x'.repeat(2000)).length < 520, true, 'long text is cut');
  assert.equal(redactText('Request 3f2a1b7c-9d4e-4f60-8a1b-2c3d4e5f6a7b took 12 ms'), 'Request 3f2a1b7c-9d4e-4f60-8a1b-2c3d4e5f6a7b took 12 ms', 'a correlation ID is not an identifier');
});

test('redaction never throws: cycles, errors, buffers, functions, huge objects', () => {
  const a = { name: 'a' };
  a.self = a;
  const out = redact({ a, err: new Error('failed for PAN ABCDE1234F'), buf: Buffer.from('secret bytes'), fn() {}, big: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`k${i}`, i])), when: new Date('2026-10-30T00:00:00Z'), n: 10n, deep: { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } } });
  assert.equal(out.a.self, '[circular]');
  assert.ok(!JSON.stringify(out).includes('ABCDE1234F') && !JSON.stringify(out).includes('secret bytes'));
  assert.equal(out.buf, '[12 bytes omitted]');
  assert.equal(Object.keys(out.big).length, 60);
  assert.equal(out.when, '2026-10-30T00:00:00.000Z');
  assert.equal(out.n, '10');
  assert.ok(JSON.stringify(out.deep).includes('[too deep]'));
});

test('FR-01 the logger writes one redacted JSON line with level, time and the correlation ID of the work in progress', () => {
  const lines = [];
  const buffer = createLogBuffer(3);
  const logger = createLogger({ write: (l) => lines.push(l), clock: () => new Date('2026-10-30T10:00:00Z'), buffer });
  runWithContext({ correlationId: 'corr-1234-abcd', user: pseudonym('meera') }, () => logger.warn({ msg: 'rejected', pan: 'ABCDE1234F', note: 'account 123456789012' }));
  const line = JSON.parse(lines[0]);
  assert.deepEqual({ time: line.time, level: line.level, correlationId: line.correlationId, user: line.user, msg: line.msg }, { time: '2026-10-30T10:00:00.000Z', level: 'warn', correlationId: 'corr-1234-abcd', user: pseudonym('meera'), msg: 'rejected' });
  assert.ok(!lines[0].includes('ABCDE1234F') && !lines[0].includes('123456789012') && !lines[0].includes('meera'));
  logger.info({ msg: 'explicit', correlationId: 'other-corr-0001' });
  assert.equal(JSON.parse(lines[1]).correlationId, 'other-corr-0001', 'an explicit ID wins');
  for (let i = 0; i < 5; i += 1) logger.info({ msg: `m${i}`, correlationId: 'c-0000000' });
  assert.equal(buffer.size(), 3, 'the recent-log buffer is bounded');
  assert.deepEqual(buffer.recent(10).map((e) => e.msg), ['m2', 'm3', 'm4']);
});

test('user IDs are pseudonymised: stable, not reversible, and different people differ', () => {
  assert.equal(pseudonym('meera'), pseudonym('meera'));
  assert.notEqual(pseudonym('meera'), pseudonym('ravi'));
  assert.match(pseudonym('meera'), /^u_[0-9a-f]{10}$/);
  assert.notEqual(pseudonym('meera', 'secret-one'), pseudonym('meera', 'secret-two'));
  assert.equal(pseudonym(null), null);
  assert.equal(pseudonym(''), null);
});

test('the context follows the work through awaits and timers, and does not leak out', async () => {
  assert.equal(currentContext(), null);
  await runWithContext({ correlationId: 'ctx-aaaaaaaa' }, async () => {
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(currentContext().correlationId, 'ctx-aaaaaaaa');
    await runWithContext({ span: 'x' }, async () => {
      await Promise.resolve();
      assert.deepEqual([currentContext().correlationId, currentContext().span], ['ctx-aaaaaaaa', 'x'], 'a nested context inherits');
    });
    assert.equal(currentContext().span, undefined);
  });
  assert.equal(currentContext(), null);
});

// ---- T-01 correlation (BR-02, FR-03) ----
test('T-01 the correlation ID and trace of a browser request reach the consumer and job log lines', async () => {
  const logger = createMemoryLogger();
  const api = await startApi({}, { logger });
  const { bus, jobs } = runtimeOf(api.db);
  bus.subscribe('core.company_settings.changed', () => log.info({ msg: 'consumer handled the settings change' }), { consumer: 'test.t01' });
  const cid = 'browser-corr-0001';
  const traceId = 'a'.repeat(32);
  const res = await api.call('PUT', `${C}/company-settings`, { ...sys, headers: { 'x-correlation-id': cid, traceparent: formatTraceparent(traceId, 'b'.repeat(16)), ...key(1) }, body: { legalName: 'Trace Test Pvt Ltd', reason: 'initial set-up' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('x-correlation-id'), cid);
  assert.equal(res.headers.get('x-trace-id'), traceId, 'the trace the browser started is continued');
  assert.match(res.headers.get('traceparent'), new RegExp(`^00-${traceId}-[0-9a-f]{16}-01$`));

  bus.drain(); // later, outside the request, as the worker does
  const replay = await api.call('POST', `${C}/events/replay`, { ...itadm, headers: { 'x-correlation-id': 'job-corr-00002', ...key(2) }, body: { types: ['core.company_settings.*'], reason: 'rebuild for the trace test' } });
  assert.equal(replay.status, 202);
  assert.equal(replay.json.data.correlationId, 'job-corr-00002', 'the job knows which request queued it');
  assert.ok(!('_cid' in replay.json.data.params), 'the carrier key is not shown as a parameter');
  await jobs.drain();

  const mine = logger.entries.filter((e) => e.correlationId === cid).map((e) => e.msg);
  assert.ok(mine.includes('request'), 'the request line');
  assert.ok(mine.includes('event handled'), 'the bus delivering the event');
  assert.ok(mine.includes('consumer handled the settings change'), 'the consumer\'s own line, written deep in its handler');
  const jobLines = logger.entries.filter((e) => e.correlationId === 'job-corr-00002').map((e) => e.msg);
  assert.ok(jobLines.includes('job started') && jobLines.includes('job succeeded'), jobLines.join());
  assert.ok(logger.entries.filter((e) => e.msg === 'event handled').every((e) => e.correlationId), 'no consumer line without a correlation ID');

  const { tracer } = await import('../src/server/platform/observability/tracing.js');
  const trace = tracer.get(traceId);
  const names = trace.spans.map((s) => s.name);
  assert.ok(names.some((n) => n.startsWith('PUT ') && n.includes('company-settings')), names.join(' | '));
  assert.ok(names.some((n) => n.startsWith('db ')), 'database statements are spans of the request');
  assert.ok(names.includes('consume test.t01'), 'the consumer is a span of the same trace');
  const root = trace.spans.find((s) => s.parentId === 'b'.repeat(16));
  assert.ok(root, 'the request span hangs under the span the browser sent');
  assert.equal(trace.correlationId, cid);
  await api.close();
});

test('BR-02 every error response carries the correlation ID that finds its log line', async () => {
  const logger = createMemoryLogger();
  const api = await startApi({}, { logger });
  const cases = [
    api.call('GET', `${C}/nothing-here`, sys),
    api.call('GET', `${C}/session`, { user: null }),
    api.call('GET', `${C}/formulas`, pm),
    api.call('POST', `${C}/files/uploads`, { ...pm, body: { size: 'x' } }),
  ];
  for (const r of await Promise.all(cases)) {
    assert.ok(r.status >= 400);
    const id = r.json.error.correlationId;
    assert.equal(id, r.headers.get('x-correlation-id'));
    assert.ok(logger.entries.some((e) => e.msg === 'request' && e.correlationId === id && e.status === r.status), `a request line for ${id}`);
  }
  await api.close();
});

// ---- tracing ----
test('FR-03 traceparent is parsed strictly, spans nest, errors are marked, and a trace exports as OTLP/JSON', async () => {
  assert.deepEqual(parseTraceparent(`00-${'1'.repeat(32)}-${'2'.repeat(16)}-01`), { traceId: '1'.repeat(32), spanId: '2'.repeat(16) });
  for (const bad of [null, '', 'nope', `00-${'0'.repeat(32)}-${'2'.repeat(16)}-01`, `00-${'1'.repeat(31)}-${'2'.repeat(16)}-01`, `ff-${'1'.repeat(32)}-${'2'.repeat(16)}-01`]) assert.equal(parseTraceparent(bad), null, String(bad));
  const tracer = createTracer({ maxTraces: 3 });
  const out = tracer.withSpan('outer', { kind: 'server' }, () => tracer.withSpan('inner', {}, () => 42));
  assert.equal(out, 42);
  await assert.rejects(() => tracer.withSpan('failing', {}, async () => { throw new Error('boom for PAN ABCDE1234F'); }), /boom/);
  const [failed, ok] = tracer.recent(2);
  assert.equal(failed.status, 'error');
  const detail = tracer.get(ok.traceId);
  assert.deepEqual(detail.spans.map((s) => [s.name, s.parentId === null]), [['outer', true], ['inner', false]]);
  assert.equal(detail.spans[1].parentId, detail.spans[0].spanId);
  const errorSpan = tracer.get(failed.traceId).spans[0];
  assert.ok(!JSON.stringify(errorSpan).includes('ABCDE1234F'), 'span attributes are redacted too');
  const otlp = tracer.otlp(ok.traceId);
  const spans = otlp.resourceSpans[0].scopeSpans[0].spans;
  assert.equal(spans.length, 2);
  assert.deepEqual([spans[0].traceId === ok.traceId, spans[1].parentSpanId === spans[0].spanId, typeof spans[0].startTimeUnixNano], [true, true, 'string']);
  assert.equal(otlp.resourceSpans[0].resource.attributes[0].value.stringValue, 'erp-sap-cls');
  for (let i = 0; i < 5; i += 1) tracer.withSpan(`t${i}`, {}, () => {});
  assert.equal(tracer.size(), 3, 'only the most recent traces are kept');
  assert.equal(tracer.get(ok.traceId), null);
});

// ---- metrics ----
test('FR-02 request metrics: rate, errors and latency percentiles per route, with a bounded histogram', () => {
  let t = Date.parse('2026-10-30T10:00:30Z');
  const m = createMetrics({ now: () => t });
  for (let i = 0; i < 100; i += 1) m.observeRequest({ method: 'GET', route: '/api/v1/core/files/:id', status: 200, durationMs: i < 95 ? 20 : 400 });
  for (let i = 0; i < 5; i += 1) m.observeRequest({ method: 'GET', route: '/api/v1/core/files/:id', status: 500, durationMs: 30 });
  m.observeRequest({ method: 'POST', route: '/api/v1/core/files', status: 404, durationMs: 5 });
  t += 60_000;
  m.observeRequest({ method: 'GET', route: '/api/v1/core/session', status: 200, durationMs: 4 });
  const routes = m.routes(5);
  const files = routes.find((r) => r.route === 'GET /api/v1/core/files/:id');
  assert.deepEqual([files.requests, files.serverErrors, files.perMinute, Math.round(files.errorRate * 1000) / 1000], [105, 5, 21, 0.048]);
  assert.ok(files.p50 > 10 && files.p50 <= 25 && files.p95 <= 100 && files.p99 >= 300 && files.p99 <= 500, JSON.stringify(files));
  assert.equal(m.routes(5)[0].route, 'GET /api/v1/core/files/:id', 'busiest first');
  const all = m.aggregate(5);
  assert.deepEqual([all.requests, all.serverErrors, all.clientErrors], [107, 5, 1]);
  assert.equal(m.aggregate(1).requests, 1, 'only the current minute');
  assert.equal(m.aggregate(5, (k) => k.startsWith('POST')).requests, 1);
  assert.deepEqual(m.aggregate(1, () => true, { onlyUnflushed: true }).requests, 1);
  m.stop();
});

test('latency histogram helpers: percentiles interpolate inside a bucket, "within" never flatters', () => {
  const h = emptyHist();
  h[3] = 80; // 25 to 50 ms
  h[7] = 20; // 300 to 500 ms
  assert.ok(percentile(h, 0.5) > 25 && percentile(h, 0.5) <= 50);
  assert.ok(percentile(h, 0.95) > 300 && percentile(h, 0.95) <= 500);
  assert.equal(percentile(emptyHist(), 0.5), null);
  assert.equal(withinMs(h, 300), 80);
  assert.equal(withinMs(h, 299), 80, 'a threshold between edges uses the lower edge');
  assert.equal(withinMs(h, 500), 100);
  const over = emptyHist();
  over[HIST_EDGES.length] = 3;
  assert.equal(percentile(over, 0.99), 5000, 'slower than the last edge is reported as that edge');
  assert.equal(normaliseSql("SELECT * FROM t WHERE id = 42 AND name = 'O''Neil' AND x > 1.5"), 'SELECT * FROM t WHERE id = ? AND name = ? AND x > ?');
});

test('FR-02 database statements are counted, slow ones listed with their correlation ID, and become spans; the statement still works', () => {
  const db = memoryDb();
  const m = createMetrics();
  const tracer = createTracer();
  instrumentDb(db, { metrics: m, tracer, slowMs: 0, spanMs: 0 });
  instrumentDb(db, { metrics: m, tracer, slowMs: 0 }); // twice is harmless
  db.exec('CREATE TABLE tst_t (id INTEGER PRIMARY KEY, name TEXT)');
  const ins = db.prepare('INSERT INTO tst_t (name) VALUES (?)');
  runWithContext({ correlationId: 'db-corr-00001' }, () => tracer.withSpan('request', { kind: 'server' }, () => {
    ins.run('secret-name-value');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM tst_t WHERE name = ?').get('secret-name-value').n, 1);
    assert.equal(db.prepare('SELECT * FROM tst_t').all().length, 1);
    assert.equal([...db.prepare('SELECT id FROM tst_t').iterate()].length, 1);
  }));
  assert.ok(m.counters()['db.queries'] >= 4);
  const slow = m.slowQueries();
  assert.ok(slow.length >= 4 && slow.every((s) => s.correlationId === 'db-corr-00001'));
  assert.ok(!JSON.stringify(slow).includes('secret-name-value'), 'values never reach the slow-query log');
  assert.ok(m.queryStats(3).length > 0);
  const t = tracer.recent(1)[0];
  const spans = tracer.get(t.traceId).spans.filter((s) => s.name.startsWith('db '));
  assert.ok(spans.length >= 4 && spans.every((s) => s.attributes['db.system'] === 'sqlite'));
  assert.ok(!JSON.stringify(spans).includes('secret-name-value'));
  m.stop();
});

test('/metrics: Prometheus text for requests, latency buckets and gauges; restricted to ITADM, SYSADM or the monitoring token', async () => {
  const api = await startApi({ HEALTH_TOKEN: 'monitoring-token-0123456789' });
  await api.call('GET', `${C}/session`, sys);
  assert.equal((await api.call('GET', '/metrics', { user: null })).status, 401);
  assert.equal((await api.call('GET', '/metrics', pm)).status, 403);
  const ok = await api.raw('GET', '/metrics', itadm);
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type'), /text\/plain/);
  const text = ok.buffer.toString();
  assert.match(text, /erp_http_requests_total\{method="GET",route="\/api\/v1\/core\/session",class="ok"\} \d+/);
  assert.match(text, /erp_http_request_duration_ms_bucket\{method="GET",route="\/api\/v1\/core\/session",le="\+Inf"\} \d+/);
  assert.match(text, /erp_dead_letters 0/);
  assert.match(text, /erp_slo_error_budget_remaining_pct\{journey="login"\}/);
  assert.match(text, /# TYPE erp_http_request_duration_ms histogram/);
  assert.ok(!text.includes('sysadmin') && !text.includes('?'), 'no user names or query strings in labels');
  const viaToken = await api.raw('GET', '/metrics', { user: null, headers: { 'x-health-token': 'monitoring-token-0123456789' } });
  assert.equal(viaToken.status, 200);
  assert.equal((await api.raw('GET', '/metrics', { user: null, headers: { 'x-health-token': 'wrong-token-wrong-token' } })).status, 401);
  await api.close();
});

// ---- SLOs (FR-05) ----
function opsSetup(start = '2026-10-30T10:00:00.000Z') {
  const db = memoryDb();
  const clock = { t: Date.parse(start) };
  const m = createMetrics({ now: () => clock.t });
  // a disk half full, whatever the machine running the tests has left
  const ops = createOps({ db, metrics: m, storagePath: tmpdir(), now: () => clock.t, statfs: () => ({ blocks: 1000, bsize: 1_048_576, bavail: 500 }) });
  ops.ensureDefaults();
  return { db, clock, m, ops };
}
const feed = (m, route, n, { errors = 0, ms = 40, method = 'POST' } = {}) => {
  for (let i = 0; i < n; i += 1) m.observeRequest({ method, route, status: i < errors ? 500 : 200, durationMs: ms });
};
const slo = (ops, journey) => ops.sloReport().find((s) => s.journey === journey);

test('FR-05 the five critical journeys and three real ones have objectives; journeys with no traffic say so', () => {
  const { ops, m } = opsSetup();
  const all = ops.sloReport();
  assert.deepEqual(all.map((s) => s.journey), ['login', 'attendance_punch', 'dpr_submit', 'po_approval', 'payment_run', 'approval_decision', 'file_upload', 'bill_calculation']);
  assert.ok(all.every((s) => s.status === 'no_data' && s.requests === 0 && s.availabilityPct === null));
  assert.deepEqual([slo(ops, 'login').targetLatencyMs, slo(ops, 'login').targetAvailabilityPct, slo(ops, 'login').windowDays], [300, 99.9, 30]);
  assert.equal(ops.ensureDefaults(), undefined);
  assert.equal(ops.sloReport().length, 8, 'ensuring defaults twice adds nothing');
  m.stop();
});

test('FR-05 error budget: ok, then at risk when half is spent, then breached when the target is missed', () => {
  const { ops, m } = opsSetup();
  const route = 'POST /api/v1/core/sample-bills';
  feed(m, '/api/v1/core/sample-bills', 1000);
  let s = slo(ops, 'bill_calculation');
  assert.deepEqual([s.status, s.requests, s.availabilityPct, s.errorBudget.usedPct, s.errorBudget.remainingPct], ['ok', 1000, 100, 0, 100]);
  assert.equal(route.startsWith('POST'), true);
  feed(m, '/api/v1/core/sample-bills', 4, { errors: 4 });
  s = slo(ops, 'bill_calculation');
  assert.equal(s.status, 'at_risk', `4 errors in 1004 against a budget of 5.02: ${JSON.stringify(s.errorBudget)}`);
  assert.ok(s.errorBudget.usedPct > 75 && s.errorBudget.usedPct < 85);
  feed(m, '/api/v1/core/sample-bills', 6, { errors: 6 });
  s = slo(ops, 'bill_calculation');
  assert.equal(s.status, 'breached');
  assert.ok(s.availabilityPct < 99.5 && s.errorBudget.remainingPct === 0);
  m.stop();
});

test('FR-05 a latency objective is judged on the percentile, not the average', () => {
  const { ops, m } = opsSetup();
  feed(m, '/api/v1/core/sample-bills', 90, { ms: 40 });
  feed(m, '/api/v1/core/sample-bills', 10, { ms: 3000 });
  const s = slo(ops, 'bill_calculation');
  assert.equal(s.status, 'breached', `p95 ${s.latencyMs} ms against 800 ms`);
  assert.ok(s.latencyMs > 800);
  assert.equal(s.availabilityPct, 100, 'slow but available: the failure is latency');
  assert.equal(s.withinTargetPct, 90);
  m.stop();
});

test('FR-05 saved hours and the minutes not yet saved are added once, and routes outside a journey do not count', () => {
  const { ops, m, clock, db } = opsSetup();
  feed(m, '/api/v1/core/sample-bills', 50);
  feed(m, '/api/v1/core/sample-bills/:id', 10, { method: 'PATCH' });
  feed(m, '/api/v1/core/formulas', 99, { method: 'GET' });
  clock.t += 120_000;
  assert.ok(ops.flushMetrics() > 0);
  assert.equal(ops.flushMetrics(), 0, 'nothing left to save');
  assert.equal(slo(ops, 'bill_calculation').requests, 60, 'saved rows alone');
  feed(m, '/api/v1/core/sample-bills', 5);
  assert.equal(slo(ops, 'bill_calculation').requests, 65, 'saved plus live, no double count');
  clock.t += 120_000;
  ops.flushMetrics();
  assert.equal(slo(ops, 'bill_calculation').requests, 65);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_metric_samples WHERE route_key = 'POST /api/v1/core/sample-bills'").get().n, 1, 'the same hour is one row, merged');
  clock.t += 40 * 86_400_000;
  assert.equal(slo(ops, 'bill_calculation').requests, 0, 'outside the window it no longer counts');
  assert.ok(ops.purge().metricRows >= 1, 'and old rows are removed');
  m.stop();
});

test('evaluateSlo on its own: a burn rate over the last hour and a budget that cannot be spent when no error is allowed', () => {
  const def = { journey: 'x', label: 'X', description: '', enabled: 1, window_days: 30, target_latency_ms: 500, latency_percentile: 95, target_availability_bp: 10000 };
  const h = emptyHist();
  h[2] = 100;
  const s = evaluateSlo(def, { persisted: { requests: 100, serverErrors: 1, hist: h }, live: { requests: 0, serverErrors: 0, hist: emptyHist() }, last1h: { requests: 10, serverErrors: 1 } });
  assert.equal(s.status, 'breached');
  assert.equal(s.errorBudget.usedPct, 100);
});

// ---- T-03 alerts (FR-06) ----
test('T-03 an alert fires when the error rate passes the threshold: recorded, announced, logged and sent to each configured channel', () => {
  const logger = createMemoryLogger();
  const { ops, m, db } = opsSetup();
  const lib = [];
  runWithContext({}, () => {});
  import('../src/server/platform/http/logger.js').then((mod) => mod.setAppLogger(logger));
  ops.setSender('email', ({ message, severity }) => (lib.push({ message, severity }), { status: 'sent' }));
  feed(m, '/api/v1/core/files', 30, { errors: 10, method: 'GET' });
  const { fired, resolved } = ops.evaluateAlerts();
  assert.deepEqual([fired.length, resolved.length], [1, 0]);
  const a = ops.alerts({ status: 'OPEN' })[0];
  assert.deepEqual([a.rule, a.severity, a.status, a.value], ['error_spike', 'critical', 'OPEN', '33.33%']);
  assert.match(a.message, /10 of 30 requests failed with a server error in the last 5 minutes/);
  assert.deepEqual(a.notified, [{ channel: 'email', to: 'ITADM', status: 'sent' }]);
  assert.equal(lib.length, 1, 'the email channel was used');
  const event = db.prepare("SELECT payload FROM core_outbox WHERE event_type = 'core.alert.fired'").get();
  assert.equal(JSON.parse(event.payload).data.rule, 'error_spike');
  m.stop();
});

test('T-03 an alert is not repeated while open, resolves when the window clears, and is not raised again during the cool-down', () => {
  const { ops, m, db, clock } = opsSetup();
  feed(m, '/api/v1/core/files', 40, { errors: 10, method: 'GET' });
  assert.equal(ops.evaluateAlerts().fired.length, 1);
  assert.equal(ops.evaluateAlerts().fired.length, 0, 'still open: no second alert');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM core_alerts').get().n, 1);
  assert.deepEqual(ops.alerts({ status: 'OPEN' })[0].notified, [{ channel: 'email', to: 'ITADM', status: 'not_configured' }], 'no sender yet: the alert says so rather than pretending');

  clock.t += 6 * 60_000; // the five-minute window no longer holds the errors
  const r = ops.evaluateAlerts();
  assert.deepEqual([r.fired.length, r.resolved.length], [0, 1]);
  assert.equal(ops.alerts({ status: 'RESOLVED' }).length, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.alert.resolved'").get().n, 1);

  feed(m, '/api/v1/core/files', 40, { errors: 10, method: 'GET' });
  assert.equal(ops.evaluateAlerts().fired.length, 0, 'inside the 30-minute cool-down');
  clock.t += 6 * 60_000;
  ops.evaluateAlerts();
  clock.t += 30 * 60_000;
  feed(m, '/api/v1/core/files', 40, { errors: 10, method: 'GET' });
  assert.equal(ops.evaluateAlerts().fired.length, 1, 'after the cool-down it can fire again');
  m.stop();
});

test('an error spike below the minimum number of requests is not an alert', () => {
  const { ops, m } = opsSetup();
  feed(m, '/api/v1/core/files', 5, { errors: 5, method: 'GET' });
  assert.equal(ops.evaluateAlerts().fired.length, 0);
  m.stop();
});

test('FR-06 the other rules: SLO breach per journey, event backlog, dead letters, failed jobs, disk, database size and browser errors', () => {
  const { ops, m, db } = opsSetup();
  feed(m, '/api/v1/core/sample-bills', 50, { errors: 40 });
  db.exec("INSERT INTO core_outbox (event_type, aggregate_id, payload) VALUES ('x.y.z', '1', '{}')");
  db.exec("UPDATE core_alert_rules SET threshold = 1 WHERE code = 'outbox_backlog'");
  db.prepare("INSERT INTO core_outbox (id, event_type, aggregate_id, payload, published_at) VALUES (900, 'x.y.z', '9', '{}', '2026-10-30T09:00:00.000Z')").run();
  db.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, status, attempts, next_attempt_at) VALUES ('c', 'e1', 900, 'x.y.z', 'DEAD', 5, '2026-10-30T09:00:00.000Z')").run();
  for (let i = 0; i < 3; i += 1) db.prepare("INSERT INTO core_jobs (job_id, type, status, run_after, finished_at, created_by) VALUES (?, 'x.y', 'FAILED', '2026-10-30T09:50:00.000Z', '2026-10-30T09:55:00.000Z', 'u')").run(`j${i}`);
  for (let i = 0; i < 20; i += 1) db.prepare("INSERT INTO core_client_events (type, message, created_at) VALUES ('js_error', 'boom', '2026-10-30T09:59:00.000Z')").run();
  db.exec("UPDATE core_alert_rules SET threshold = 100 WHERE code IN ('disk_low', 'db_large')"); // 100% free and 100 MB: both true on a tiny test database
  db.exec("UPDATE core_alert_rules SET threshold = 0 WHERE code = 'db_large'");
  const { fired } = ops.evaluateAlerts();
  const rules = fired.map((f) => f.dedupe_key).sort();
  assert.deepEqual(rules, ['browser_errors:browser', 'db_large:db', 'dead_letters:dlq', 'disk_low:disk', 'error_spike:all', 'job_failures:jobs', 'outbox_backlog:outbox', 'slo_breach:bill_calculation']);
  assert.equal(ops.alerts({ status: 'OPEN' }).length, 8);
  m.stop();
});

test('a disabled rule raises nothing and closes an alert it had opened', () => {
  const { ops, m, db } = opsSetup();
  feed(m, '/api/v1/core/files', 40, { errors: 20, method: 'GET' });
  ops.evaluateAlerts();
  assert.equal(ops.alerts({ status: 'OPEN' }).length, 1);
  db.exec("UPDATE core_alert_rules SET enabled = 0 WHERE code = 'error_spike'");
  const r = ops.evaluateAlerts();
  assert.equal(r.resolved.length, 1);
  assert.equal(ops.alerts({ status: 'OPEN' }).length, 0);
  m.stop();
});

test('a sender that throws is recorded as failed and never stops the alert', () => {
  const { ops, m } = opsSetup();
  ops.setSender('email', () => {
    throw new Error('SMTP is down');
  });
  feed(m, '/api/v1/core/files', 40, { errors: 20, method: 'GET' });
  ops.evaluateAlerts();
  assert.deepEqual(ops.alerts({ status: 'OPEN' })[0].notified, [{ channel: 'email', to: 'ITADM', status: 'failed', error: 'SMTP is down' }]);
  m.stop();
});
