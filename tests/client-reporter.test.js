import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/client/platform/api/client.js';
import { createReporter, failureEvent, installReporter, isReportableFailure } from '../src/client/platform/observability/reporter.js';

const manual = () => {
  const timers = [];
  return { setTimer: (f) => (timers.push(f), timers.length), clearTimer: () => {}, fire: () => timers.splice(0).forEach((f) => f()) };
};

test('FR-04 reports are batched, de-duplicated, stripped of query strings and capped', async () => {
  const sent = [];
  const t = manual();
  const r = createReporter({ send: async (b) => sent.push(b), setTimer: t.setTimer, clearTimer: t.clearTimer });
  assert.equal(r.report({ type: 'js_error', message: 'boom', path: '/a?token=1#x' }), true);
  assert.equal(r.report({ type: 'js_error', message: 'boom', path: '/a' }), false, 'the same error twice is one report');
  r.report({ type: 'page_load', path: '/a', durationMs: 10 });
  r.report({ type: 'page_load', path: '/a', durationMs: 12 });
  assert.equal(sent.length, 0, 'nothing is sent until the timer fires');
  t.fire();
  await new Promise((res) => setImmediate(res));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((e) => e.path), ['/a', '/a', '/a']);
  for (let i = 0; i < 150; i += 1) r.report({ type: 'js_error', message: `m${i}` });
  assert.equal(r.count(), 100, 'a session reports at most 100 events');
});

test('a failing send is swallowed, and only network and 5xx failures are reportable', async () => {
  const r = createReporter({ send: async () => { throw new Error('offline'); } });
  r.report({ type: 'js_error', message: 'x' });
  await assert.doesNotReject(r.flush());
  assert.equal(isReportableFailure({ status: 0 }), true);
  assert.equal(isReportableFailure({ status: 503 }), true);
  assert.equal(isReportableFailure({ status: 422 }), false);
  assert.equal(isReportableFailure({ status: 403 }), false);
  assert.deepEqual(failureEvent(new ApiError({ status: 500, code: 'INTERNAL_ERROR', message: 'm', correlationId: 'abc-12345' }), '/api/v1/x'), { type: 'api_failure', status: 500, message: 'INTERNAL_ERROR', path: '/api/v1/x', correlationId: 'abc-12345' });
});

test('the API client tells its observer about a failed call with the correlation ID, and a broken observer changes nothing', async () => {
  const seen = [];
  const res = (status) => ({ ok: false, status, headers: { get: () => null }, text: async () => JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'bad', correlationId: 'corr-0000001' } }) });
  const api = createApiClient({ fetchImpl: async () => res(500), retries: 0, onFailure: (e, p) => seen.push([e.correlationId, p]) });
  await assert.rejects(api.post('/core/x', {}), (e) => e.correlationId === 'corr-0000001');
  assert.deepEqual(seen, [['corr-0000001', '/core/x']]);
  const broken = createApiClient({ fetchImpl: async () => { throw new TypeError('down'); }, retries: 0, onFailure: () => { throw new Error('observer'); } });
  await assert.rejects(broken.get('/core/y'), (e) => e.code === 'NETWORK');
});

test('installReporter listens for errors, rejected promises and page unload', () => {
  const handlers = {};
  const win = { location: { pathname: '/admin/x' }, addEventListener: (n, f) => { handlers[n] = f; }, setTimeout: (f) => f(), performance: { getEntriesByType: () => [{ loadEventEnd: 900.6 }] } };
  const posted = [];
  const reporter = installReporter({ authHeaders: () => ({ 'x-erp-user': 'u' }), win, fetchImpl: async (url, init) => posted.push([url, JSON.parse(init.body)]) });
  handlers.error({ message: 'ReferenceError: q is not defined' });
  handlers.unhandledrejection({ reason: new Error('nope') });
  handlers.load();
  assert.equal(reporter.count(), 3);
  assert.deepEqual(Object.keys(handlers).sort(), ['error', 'load', 'pagehide', 'unhandledrejection']);
  return reporter.flush().then(() => {
    assert.equal(posted[0][0], '/api/v1/core/ops/client-events');
    assert.deepEqual(posted[0][1].events.map((e) => e.type), ['js_error', 'js_error', 'page_load']);
    assert.equal(posted[0][1].events[2].durationMs, 901);
  });
});
