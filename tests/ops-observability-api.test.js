import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { createLogger } from '../src/server/platform/http/logger.js';
import { logBuffer } from '../src/server/platform/observability/logbuffer.js';
import { metrics } from '../src/server/platform/observability/metrics.js';
import { opsOf } from '../src/server/platform/observability/ops.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import { startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `ops7-${n}-${Math.random().toString(36).slice(2, 10)}` });
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const quiet = () => createLogger({ write: () => {} });

test('AC-04 who may see operations: ITADM and SYSADM view; only ITADM manages; nobody else, nobody anonymous', async () => {
  const api = await startApi();
  for (const path of ['/ops/summary', '/ops/slos', '/ops/alert-rules', '/ops/alerts', '/ops/traces', '/ops/baseline', '/ops/client-events']) {
    assert.equal((await api.call('GET', C + path, itadm)).status, 200, `ITADM ${path}`);
    assert.equal((await api.call('GET', C + path, sys)).status, 200, `SYSADM ${path}`);
    assert.equal((await api.call('GET', C + path, pm)).status, 403, `PM ${path}`);
    assert.equal((await api.call('GET', C + path, { user: null })).status, 401, `anonymous ${path}`);
  }
  for (const [method, path, body] of [
    ['POST', '/ops/evaluate', {}],
    ['POST', '/ops/alerts/1/acknowledge', {}],
    ['POST', '/ops/diagnostics/force-error', {}],
    ['POST', '/ops/slo-definitions/login/change-requests', { changes: { targetLatencyMs: 400 }, reason: 'tighten login' }],
    ['POST', '/ops/alert-rules/error_spike/change-requests', { changes: { threshold: 300 }, reason: 'tighten alert' }],
  ]) {
    assert.equal((await api.call(method, C + path, { ...sys, headers: key('s'), body })).status, 403, `SYSADM may view but not ${path}`);
    assert.equal((await api.call(method, C + path, { ...pm, headers: key('p'), body })).status, 403, `PM ${path}`);
  }
  await api.close();
});

test('AC-01 the summary shows live figures: requests, errors, latency, queues, database, objectives, alerts and tracing', async () => {
  const api = await startApi();
  metrics.reset();
  for (let i = 0; i < 12; i += 1) await api.call('GET', `${C}/session`, sys);
  await api.call('GET', `${C}/nothing-here`, sys);
  const s = (await api.call('GET', `${C}/ops/summary`, itadm)).json.data;
  assert.ok(s.http.last5m.requests >= 13 && s.http.last5m.clientErrors >= 1 && s.http.last5m.serverErrors === 0);
  assert.ok(s.http.last5m.p95 > 0 && s.http.last5m.p50 <= s.http.last5m.p95);
  const session = s.http.topRoutes.find((r) => r.route === 'GET /api/v1/core/session');
  assert.equal(session.requests, 12);
  assert.ok(s.http.topRoutes.some((r) => r.route === 'GET unmatched'), 'a stray URL is one "unmatched" route, not a new series per URL');
  assert.deepEqual(Object.keys(s.system.queues).sort(), ['deadLetters', 'inboxPending', 'jobsFailedLastHour', 'jobsQueued', 'jobsRunning', 'outboxUnpublished']);
  assert.ok(s.system.database.sizeMb >= 0 && s.system.database.connections.open === 1 && s.system.database.queries > 0);
  assert.ok(s.system.disk.freePct > 0);
  assert.equal(s.system.sockets.connections, null);
  assert.ok(s.process.uptimeSeconds >= 0 && s.process.rssMb > 0 && s.process.eventLoopLagMs >= 0);
  assert.equal(s.slos.length, 8);
  assert.equal(s.slos.find((x) => x.journey === 'login').requests, 12);
  assert.deepEqual([s.alerts.open, s.baseline.available === true || s.baseline.available === false], [[], true]);
  assert.ok(s.topQueries.length > 0 && Array.isArray(s.slowQueries));
  assert.ok(!JSON.stringify(s).includes('sysadmin'), 'no user name in the summary');
  await api.close();
});

test('AC-01 / BR-02 a forced error is traceable end to end by its correlation ID: request, event, consumer, job, trace and log lines', async () => {
  const api = await startApi({}, { logger: quiet() });
  const { bus, jobs } = runtimeOf(api.db);
  const cid = 'forced-error-0001';
  const res = await api.call('POST', `${C}/ops/diagnostics/force-error`, { ...itadm, headers: { 'x-correlation-id': cid, ...key(1) }, body: {} });
  assert.equal(res.status, 500);
  assert.equal(res.json.error.code, 'INTERNAL_ERROR');
  assert.equal(res.json.error.correlationId, cid, 'the user sees the ID that finds the log lines');
  assert.ok(!res.json.error.message.includes('forced by an administrator'), 'the internal message is not shown to the user');
  bus.drain();
  await jobs.drain();

  const follow = (await api.call('GET', `${C}/ops/follow?correlationId=${cid}`, itadm)).json.data;
  const msgs = follow.logs.map((l) => l.msg);
  for (const expected of ['diagnostic started', 'diagnostic about to fail on purpose', 'unhandled error', 'request', 'event handled', 'diagnostic event consumed', 'job started', 'diagnostic job running', 'job succeeded']) assert.ok(msgs.includes(expected), `${expected} missing from: ${msgs.join(' | ')}`);
  assert.ok(follow.logs.every((l) => l.correlationId === cid));
  const errorLine = follow.logs.find((l) => l.msg === 'unhandled error');
  assert.equal(errorLine.level, 'error');
  assert.ok(errorLine.traceId && errorLine.route, 'the error line names the trace and the route');
  assert.deepEqual(follow.events.map((e) => e.type), ['core.ops.diagnostic']);
  assert.deepEqual(follow.jobs.map((j) => [j.type, j.status]), [['core.ops_diagnostic', 'SUCCEEDED']]);
  assert.equal(follow.traces.length, 1);
  const names = follow.traces[0].spans.map((s) => s.name);
  assert.ok(names.some((n) => n.startsWith('POST ')) && names.includes('consume core.ops.diagnostic') && names.includes('job core.ops_diagnostic'), names.join(' | '));
  assert.equal(follow.traces[0].status, 'error');

  const listed = (await api.call('GET', `${C}/ops/traces?status=error`, itadm)).json.data;
  assert.ok(listed.some((t) => t.correlationId === cid));
  const detail = (await api.call('GET', `${C}/ops/traces/${follow.traces[0].traceId}`, sys)).json.data;
  assert.equal(detail.spans.length, follow.traces[0].spans.length);
  const otlp = (await api.call('GET', `${C}/ops/traces/${follow.traces[0].traceId}/otlp`, sys)).json;
  assert.equal(otlp.resourceSpans[0].scopeSpans[0].spans.length, detail.spans.length);
  assert.equal((await api.call('GET', `${C}/ops/traces/${'0'.repeat(32)}`, itadm)).status, 404);
  assert.equal((await api.call('GET', `${C}/ops/traces/not-a-trace`, itadm)).status, 400);
  assert.equal((await api.call('GET', `${C}/ops/follow?correlationId=x`, itadm)).status, 400);
  assert.equal((await api.call('GET', `${C}/ops/follow?correlationId=${cid}`, pm)).status, 403);
  await api.close();
  logBuffer.clear();
});

test('BR-01 request logs hold no query strings, bodies, tokens or names, only a pseudonym', async () => {
  logBuffer.clear();
  const api = await startApi({}, { logger: quiet() });
  await api.call('PUT', `${C}/company-settings`, { ...sys, user: 'meera.sharma', headers: { ...key(1), authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln' }, body: { legalName: 'Redaction Test Pvt Ltd', pan: 'AAPCS1234F', reason: 'initial set-up' } });
  await api.call('GET', `${C}/feature-flags?q=AAPCS1234F`, { ...sys, user: 'meera.sharma' });
  const all = JSON.stringify(logBuffer.recent(500));
  for (const leaked of ['AAPCS1234F', 'meera.sharma', 'eyJhbGci', 'Redaction Test Pvt Ltd']) assert.ok(!all.includes(leaked), `${leaked} leaked into the log`);
  assert.match(all, /"user":"u_[0-9a-f]{10}"/);
  await api.close();
  logBuffer.clear();
});

test('FR-04 browsers report errors, failed calls and page loads; the report is redacted, bounded and tied to a correlation ID', async () => {
  const api = await startApi({}, { logger: quiet() });
  const send = (events, who = pm) => api.call('POST', `${C}/ops/client-events`, { ...who, body: { events } });
  const ok = await send([
    { type: 'js_error', message: 'TypeError: x is undefined at PAN ABCDE1234F', path: '/admin/formulas?token=secret#frag', correlationId: 'browser-corr-0009' },
    { type: 'api_failure', status: 500, path: '/api/v1/core/files', correlationId: 'server-corr-00010' },
    { type: 'page_load', path: '/admin/ops', durationMs: 842.4 },
  ]);
  assert.equal(ok.status, 202, 'any signed-in user may report');
  assert.equal(ok.json.data.recorded, 3);
  const rows = (await api.call('GET', `${C}/ops/client-events`, itadm)).json.data;
  assert.equal(rows.length, 3);
  const js = rows.find((r) => r.type === 'js_error');
  assert.ok(!JSON.stringify(rows).includes('ABCDE1234F') && !JSON.stringify(rows).includes('secret'), 'identifiers and query strings are removed');
  assert.deepEqual([js.path, js.correlationId], ['/admin/formulas', 'browser-corr-0009']);
  assert.equal(rows.find((r) => r.type === 'page_load').durationMs, 842);
  assert.equal((await api.call('GET', `${C}/ops/client-events?type=api_failure`, itadm)).json.data.length, 1);
  assert.equal((await api.call('GET', `${C}/ops/client-events`, pm)).status, 403, 'reading them is for administrators');

  assert.equal((await send([])).status, 400);
  assert.equal((await send([{ type: 'nope' }])).status, 400);
  assert.equal((await send(Array.from({ length: 21 }, () => ({ type: 'js_error', message: 'x' })))).status, 400);
  assert.equal((await api.call('POST', `${C}/ops/client-events`, { user: null, body: { events: [{ type: 'js_error' }] } })).status, 401);
  let refused = 0;
  for (let i = 0; i < 8; i += 1) refused += (await send(Array.from({ length: 10 }, () => ({ type: 'js_error', message: 'loop' })), { ...pm, user: 'loopy' })).status === 422 ? 1 : 0;
  assert.ok(refused >= 2, 'a browser in a loop is cut off after 60 reports a minute');
  assert.ok(api.db.prepare("SELECT COUNT(*) AS n FROM core_client_events WHERE message = 'loop'").get().n <= 60);
  await api.close();
});

test('FR-06 the alert page: evaluate now, acknowledge, and the open alert is listed with who was told', async () => {
  const api = await startApi({}, { logger: quiet() });
  const ops = opsOf(api.db, { metrics, storagePath: '.' });
  api.db.exec("INSERT INTO core_outbox (id, event_type, aggregate_id, payload) VALUES (7001, 'x.y.z', '1', '{}')");
  api.db.prepare("INSERT INTO core_inbox (consumer, event_id, outbox_id, event_type, status, attempts, next_attempt_at) VALUES ('c', 'e1', 7001, 'x.y.z', 'DEAD', 5, '2026-10-30T09:00:00.000Z')").run();
  const run = await api.call('POST', `${C}/ops/evaluate`, { ...itadm, headers: key(1), body: {} });
  assert.equal(run.status, 200);
  assert.ok(run.json.data.fired >= 1);
  const open = (await api.call('GET', `${C}/ops/alerts?status=OPEN`, sys)).json.data;
  const dlq = open.find((a) => a.rule === 'dead_letters');
  assert.ok(dlq && dlq.severity === 'warning' && dlq.notified[0].status === 'not_configured');
  const summary = (await api.call('GET', `${C}/ops/summary`, itadm)).json.data;
  assert.ok(summary.alerts.open.some((a) => a.rule === 'dead_letters'));
  assert.equal((await api.call('POST', `${C}/ops/alerts/${dlq.id}/acknowledge`, { ...itadm, body: {} })).status, 400, 'needs an Idempotency-Key');
  const ack = await api.call('POST', `${C}/ops/alerts/${dlq.id}/acknowledge`, { ...itadm, headers: key(2), body: {} });
  assert.equal(ack.json.data.acknowledgedBy, 'ishaan');
  assert.equal((await api.call('POST', `${C}/ops/alerts/9999/acknowledge`, { ...itadm, headers: key(3), body: {} })).status, 404);
  assert.equal((await api.call('GET', `${C}/ops/alerts?status=WRONG`, itadm)).status, 400);
  assert.ok(ops);
  await api.close();
});

test('AC-05 alert rules and objectives change only through an approved request: ITADM asks, SYSADM decides, the change is audited', async () => {
  const api = await startApi({}, { logger: quiet() });
  const ask = (path, body, who = itadm, n = 'a') => api.call('POST', `${C}${path}`, { ...who, headers: key(n), body });
  assert.equal((await ask('/ops/alert-rules/error_spike/change-requests', { changes: {}, reason: 'nothing' })).status, 400);
  assert.equal((await ask('/ops/alert-rules/error_spike/change-requests', { changes: { threshold: 500 }, reason: 'same value again' })).status, 422);
  assert.equal((await ask('/ops/alert-rules/error_spike/change-requests', { changes: { threshold: -1 }, reason: 'negative threshold' })).status, 400);
  assert.equal((await ask('/ops/alert-rules/error_spike/change-requests', { changes: { channels: ['pigeon'] }, reason: 'unknown channel' })).status, 400);
  assert.equal((await ask('/ops/alert-rules/nope/change-requests', { changes: { threshold: 1 }, reason: 'unknown rule' })).status, 404);
  const req = await ask('/ops/alert-rules/error_spike/change-requests', { changes: { threshold: 300, channels: ['email', 'whatsapp'], enabled: true }, reason: 'alert earlier on errors' });
  assert.equal(req.status, 201, JSON.stringify(req.json));
  assert.deepEqual(req.json.data.chain, ['SYSADM']);
  assert.equal((await ask('/ops/alert-rules/error_spike/change-requests', { changes: { threshold: 200 }, reason: 'a second one' }, itadm, 'b')).status, 409, 'one open request per rule');
  const rule = () => api.call('GET', `${C}/ops/alert-rules`, sys).then((r) => r.json.data.find((x) => x.code === 'error_spike'));
  assert.equal((await rule()).threshold, 500, 'nothing changes before the decision');
  const act = (who, n) => api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...who, headers: key(n), body: { action: 'approve', comment: 'ok' } });
  assert.equal((await act(itadm, 'x')).status, 403, 'the requester cannot decide');
  assert.equal((await act(sys, 'y')).status, 200);
  const after = await rule();
  assert.deepEqual([after.threshold, after.channels, after.version], [300, ['email', 'whatsapp'], 2]);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_audit_log WHERE entity = 'core_alert_rules' AND action = 'change_approved'").get().n, 1);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_outbox WHERE event_type = 'core.ops_config.changed'").get().n, 1);

  const slo = await ask('/ops/slo-definitions/login/change-requests', { changes: { targetLatencyMs: 250, targetAvailabilityBp: 9995 }, reason: 'tighten the login objective' }, itadm, 'c');
  assert.equal(slo.status, 201);
  assert.equal((await act({ ...sys, user: 'someone' }, 'z')).status, 422, 'the first request is already decided');
  const decide = await api.call('POST', `${C}/change-requests/${slo.json.data.id}/act`, { ...sys, headers: key('d'), body: { action: 'approve', comment: 'ok' } });
  assert.equal(decide.status, 200);
  const login = (await api.call('GET', `${C}/ops/slos`, sys)).json.data.find((s) => s.journey === 'login');
  assert.deepEqual([login.targetLatencyMs, login.targetAvailabilityBp, login.measured.targetAvailabilityPct], [250, 9995, 99.95]);
  assert.equal((await ask('/ops/slo-definitions/login/change-requests', { changes: { windowDays: 120 }, reason: 'window too long' })).status, 400);
  await api.close();
});

test('FR-08 the stored baseline is served with its environment and the journeys that miss the standard', async () => {
  const api = await startApi();
  const b = (await api.call('GET', `${C}/ops/baseline`, itadm)).json.data;
  assert.equal(b.available, true, 'run npm run erp:perf-baseline -- --save to store one');
  assert.ok(b.environment.node && b.environment.cpus > 0 && b.dataset.events >= 100_000);
  assert.deepEqual(b.journeys.map((j) => j.id), ['session', 'flags_list', 'sample_documents_list', 'sample_bills_list', 'events_list', 'formula_detail', 'calc_bench', 'bill_create', 'file_upload']);
  for (const j of b.journeys) {
    assert.ok(j.requests > 0 && j.p95Ms >= j.p50Ms && j.p99Ms >= j.p95Ms && j.requestsPerSecond > 0, j.id);
    assert.equal(j.meetsStandard, j.errors === 0 && j.p95Ms <= j.standardMs, j.id);
  }
  const summary = (await api.call('GET', `${C}/ops/summary`, itadm)).json.data.baseline;
  assert.equal(summary.journeys, 9);
  await api.close();
});

test('the whole operations console is hidden while ff.core.p0107 is OFF for the company, except browsers\' own error reports', async () => {
  const api = await startApi({}, { logger: quiet() });
  await api.call('PATCH', `${C}/feature-flags/ff.core.p0107`, { ...sys, headers: key(1), body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'switching monitoring off' } });
  for (const path of ['/ops/summary', '/ops/slos', '/ops/traces']) assert.equal((await api.call('GET', C + path, itadm)).status, 404, path);
  assert.equal((await api.call('POST', `${C}/ops/client-events`, { ...pm, body: { events: [{ type: 'js_error', message: 'still reported' }] } })).status, 202);
  assert.equal((await api.call('GET', `${C}/financial-years`, sys)).status, 200, 'other parts are unaffected');
  assert.equal((await api.call('GET', `${C}/ops/summary`, { ...itadm, company: '2' })).status, 200, 'another company still has it');
  await api.close();
});
