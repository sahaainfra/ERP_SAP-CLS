import { test } from 'node:test';
import assert from 'node:assert/strict';
import { publishEvent } from '../src/server/platform/events/index.js';
import { runtimeOf } from '../src/server/platform/runtime/index.js';
import '../src/server/modules/registry.js';
import { startApi } from './helpers.js';

const C = '/api/v1/core';
const key = (n) => ({ 'idempotency-key': `ops-${n}-${Math.random().toString(36).slice(2, 10)}` });
const itadm = { roles: 'ITADM', user: 'ishaan', company: '1' };
const sys = { roles: 'SYSADM', user: 'sysadmin', company: '1' };
const pm = { roles: 'PM', user: 'pooja', company: '1' };
const other = { roles: 'ITADM', user: 'otto', company: '2' };

/** A consumer that always fails, so an event becomes a dead letter at once. Returns the dead letter's id. */
async function deadLetter(api, { companyId = 1, data = { pan: 'ABCDE1234F', note: 'visible' } } = {}) {
  const { bus } = runtimeOf(api.db);
  bus.subscribe('test.ops.failed', () => { throw new Error('consumer is broken'); }, { consumer: 'test.ops', maxAttempts: 1 });
  publishEvent(api.db, { type: 'test.ops.failed', entity: 'thing', entityId: 5, actorId: 'tester', companyId, data });
  bus.drain();
  return api.db.prepare("SELECT id FROM core_inbox WHERE consumer = 'test.ops' ORDER BY id DESC LIMIT 1").get().id;
}

test('AC-05 who can see the events console: ITADM and SYSADM view; nobody else, and nobody anonymous', async () => {
  const api = await startApi();
  for (const path of ['/events/metrics', '/events', '/events/dlq', '/events/types', '/events/consumers', '/jobs', '/jobs/types', '/schedules']) {
    assert.equal((await api.call('GET', C + path, itadm)).status, 200, `ITADM ${path}`);
    assert.equal((await api.call('GET', C + path, sys)).status, 200, `SYSADM ${path}`);
    assert.equal((await api.call('GET', C + path, pm)).status, 403, `PM ${path}`);
    assert.equal((await api.call('GET', C + path, { user: null })).status, 401, `anonymous ${path}`);
  }
  await api.close();
});

test('FR-07 metrics, the event log, the catalogue and the consumers are readable', async () => {
  const api = await startApi();
  runtimeOf(api.db).bus.drain();
  const m = (await api.call('GET', `${C}/events/metrics`, itadm)).json.data;
  assert.ok(m.events.total >= 0 && 'relayLagSeconds' in m.events && 'deliveryLagSeconds' in m.inbox);
  assert.ok(m.consumers.some((c) => c.name === 'core.projection.event_counts'));
  const types = (await api.call('GET', `${C}/events/types`, itadm)).json.data;
  assert.ok(types.some((t) => t.type === 'core.job.failed' && t.version === 1 && t.owner === 'core'));
  const list = await api.call('GET', `${C}/events?filter[type]=core.job.failed&pageSize=5`, itadm);
  assert.equal(list.status, 200);
  assert.equal((await api.call('GET', `${C}/events?filter[nope]=1`, itadm)).status, 400);
  assert.equal((await api.call('GET', `${C}/events?pageSize=500`, itadm)).status, 400);
  await api.close();
});

test('AC-02 a dead letter is listed with its error and a masked payload, then re-driven', async () => {
  const api = await startApi();
  const id = await deadLetter(api);
  const dlq = (await api.call('GET', `${C}/events/dlq`, itadm)).json;
  assert.equal(dlq.meta.total, 1);
  const item = dlq.data[0];
  assert.deepEqual([item.id, item.consumer, item.status, item.attempts, item.lastError], [id, 'test.ops', 'DEAD', 1, 'consumer is broken']);
  assert.deepEqual(item.event.data, { pan: '***', note: 'visible' }, 'sensitive values never reach the console');
  assert.ok(!JSON.stringify(dlq).includes('ABCDE1234F'));
  const m = (await api.call('GET', `${C}/events/metrics`, sys)).json.data;
  assert.equal(m.inbox.dead, 1);

  assert.equal((await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...itadm, body: { reason: 'consumer fixed' } })).status, 400, 'an Idempotency-Key is required');
  assert.equal((await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...itadm, headers: key(1), body: {} })).status, 400, 'a reason is required');
  assert.equal((await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...sys, headers: key(2), body: { reason: 'try it' } })).status, 403, 'SYSADM may view but not re-drive');
  assert.equal((await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...other, headers: key(3), body: { reason: 'not mine' } })).status, 404, 'a company never sees another company\'s letters');
  const ok = await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...itadm, headers: key(4), body: { reason: 'consumer fixed' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.data.status, 'PENDING');
  assert.equal((await api.call('GET', `${C}/events/dlq`, itadm)).json.meta.total, 0);
  assert.equal((await api.call('POST', `${C}/events/dlq/${id}/redrive`, { ...itadm, headers: key(5), body: { reason: 'again please' } })).status, 422);
  await api.close();
});

test('a dead letter can be discarded with a reason, and stays listed as discarded', async () => {
  const api = await startApi();
  const id = await deadLetter(api);
  const r = await api.call('POST', `${C}/events/dlq/${id}/discard`, { ...itadm, headers: key(1), body: { reason: 'no business effect' } });
  assert.equal(r.json.data.status, 'DISCARDED');
  const list = (await api.call('GET', `${C}/events/dlq?filter[status]=DISCARDED`, itadm)).json;
  assert.equal(list.meta.total, 1);
  assert.equal(list.data[0].resolvedBy, 'ishaan');
  await api.close();
});

test('AC-05 company isolation: events and dead letters of another company are invisible', async () => {
  const api = await startApi();
  await deadLetter(api, { companyId: 2 });
  assert.equal((await api.call('GET', `${C}/events/dlq`, itadm)).json.meta.total, 0);
  assert.equal((await api.call('GET', `${C}/events/dlq`, other)).json.meta.total, 1);
  const list = (await api.call('GET', `${C}/events?filter[type]=test.ops.failed`, itadm)).json;
  assert.equal(list.meta.total, 0);
  assert.equal((await api.call('GET', `${C}/events?filter[type]=test.ops.failed`, other)).json.meta.total, 1);
  await api.close();
});

test('FR-05 a replay is queued as a background job, runs, and rebuilds the projection', async () => {
  const api = await startApi();
  const { bus, jobs } = runtimeOf(api.db);
  for (const id of [1, 2, 3]) publishEvent(api.db, { type: 'core.sample_document.created', entity: 'sample_document', entityId: id, actorId: 't', companyId: 1, data: {} });
  bus.drain();
  const total = () => api.db.prepare("SELECT total FROM core_projection_event_counts WHERE event_type = 'core.sample_document.created'").get()?.total;
  assert.equal(total(), 3);
  api.db.exec('UPDATE core_projection_event_counts SET total = 99'); // a corrupted read model

  const body = { types: ['core.sample_document.*'], consumer: 'core.projection.event_counts', reset: true, reason: 'projection looked wrong' };
  assert.equal((await api.call('POST', `${C}/events/replay`, { ...itadm, body })).status, 400, 'Idempotency-Key required');
  assert.equal((await api.call('POST', `${C}/events/replay`, { ...sys, headers: key(1), body })).status, 403);
  assert.equal((await api.call('POST', `${C}/events/replay`, { ...itadm, headers: key(2), body: { ...body, consumer: 'nope' } })).status, 404);
  assert.equal((await api.call('POST', `${C}/events/replay`, { ...itadm, headers: key(3), body: { ...body, from: '2026-02-01', to: '2026-01-01' } })).status, 400);
  assert.equal((await api.call('POST', `${C}/events/replay`, { ...itadm, headers: key(4), body: { ...body, types: ['Bad Pattern'] } })).status, 400);
  const res = await api.call('POST', `${C}/events/replay`, { ...itadm, headers: key(5), body });
  assert.equal(res.status, 202);
  assert.equal(res.json.data.type, 'core.event_replay');
  await jobs.drain();
  const job = (await api.call('GET', `${C}/jobs/${res.json.data.id}`, itadm)).json.data;
  assert.deepEqual([job.status, job.result.events, job.result.deliveries], ['SUCCEEDED', 3, 3]);
  assert.equal(total(), 3, 'rebuilt from the event history');
  assert.match(job.log.join('\n'), /Replaying core.sample_document.\*/);
  await api.close();
});

test('AC-05 jobs: list, filter, cancel and retry need the right role and stay within the company', async () => {
  const api = await startApi();
  const { jobs } = runtimeOf(api.db);
  jobs.register('test.api_job', () => { throw new Error('always fails'); }, { maxAttempts: 1 });
  const mine = jobs.enqueue('test.api_job', {}, { createdBy: 'ishaan', companyId: 1 });
  const theirs = jobs.enqueue('test.api_job', {}, { createdBy: 'otto', companyId: 2 });
  const system = jobs.enqueue('test.api_job', {}, { createdBy: 'scheduler' });
  const list = (await api.call('GET', `${C}/jobs?filter[type]=test.api_job`, itadm)).json;
  assert.deepEqual(list.data.map((j) => j.id).sort(), [mine.id, system.id].sort(), 'own company and system jobs only');
  assert.equal((await api.call('GET', `${C}/jobs/${theirs.id}`, itadm)).status, 404);
  assert.equal((await api.call('GET', `${C}/jobs/${mine.id}`, itadm)).status, 200);
  assert.equal((await api.call('POST', `${C}/jobs/${mine.id}/cancel`, { ...sys, headers: key(1), body: {} })).status, 403, 'SYSADM may only view');
  assert.equal((await api.call('POST', `${C}/jobs/${mine.id}/cancel`, { ...itadm, body: {} })).status, 400, 'Idempotency-Key required');
  const cancelled = await api.call('POST', `${C}/jobs/${mine.id}/cancel`, { ...itadm, headers: key(2), body: { reason: 'not needed anymore' } });
  assert.equal(cancelled.json.data.status, 'CANCELLED');
  const retried = await api.call('POST', `${C}/jobs/${mine.id}/retry`, { ...itadm, headers: key(3), body: {} });
  assert.equal(retried.status, 201);
  assert.equal(retried.json.data.status, 'QUEUED');
  await jobs.drain();
  const failed = (await api.call('GET', `${C}/jobs?filter[status]=FAILED`, itadm)).json;
  assert.ok(failed.data.every((j) => j.status === 'FAILED' && j.error === 'always fails'));
  assert.equal((await api.call('POST', `${C}/jobs/${retried.json.data.id}/cancel`, { ...itadm, headers: key(4), body: {} })).status, 422, 'a finished job cannot be cancelled');
  await api.close();
});

test('AC-06 a schedule change is maker-checker: ITADM asks, SYSADM decides, then it takes effect and is audited', async () => {
  const api = await startApi();
  const list = (await api.call('GET', `${C}/schedules`, itadm)).json.data;
  const s = list.find((x) => x.code === 'core.housekeeping_daily');
  assert.ok(s && s.enabled && s.cron === '0 3 * * *' && s.nextRunAt);
  const preview = (await api.call('GET', `${C}/schedules/preview?cron=${encodeURIComponent('*/30 * * * *')}&count=3`, itadm)).json.data;
  assert.equal(preview.nextRuns.length, 3);
  assert.equal((await api.call('GET', `${C}/schedules/preview?cron=nonsense`, itadm)).status, 400);

  const ask = (who, body, n) => api.call('POST', `${C}/schedules/${s.id}/change-requests`, { ...who, headers: key(n), body });
  assert.equal((await ask(sys, { changes: { cron: '0 4 * * *' }, reason: 'move later' }, 1)).status, 403, 'only ITADM manages schedules');
  assert.equal((await ask(itadm, { changes: { cron: 'bad cron' }, reason: 'try it' }, 2)).status, 400);
  assert.equal((await ask(itadm, { changes: { cron: '0 3 * * *' }, reason: 'same again' }, 3)).status, 422);
  assert.equal((await ask(itadm, { changes: {}, reason: 'nothing' }, 4)).status, 400);
  const req = await ask(itadm, { changes: { cron: '0 4 * * *', enabled: false }, reason: 'move after the backup window' }, 5);
  assert.equal(req.status, 201);
  assert.equal((await ask(itadm, { changes: { enabled: false }, reason: 'second request' }, 6)).status, 409, 'one open request per schedule');
  const unchanged = (await api.call('GET', `${C}/schedules`, itadm)).json.data.find((x) => x.id === s.id);
  assert.equal(unchanged.cron, '0 3 * * *', 'nothing changes before approval');

  const act = (who, body, n) => api.call('POST', `${C}/change-requests/${req.json.data.id}/act`, { ...who, headers: key(n), body });
  assert.equal((await act(itadm, { action: 'approve' }, 7)).status, 403, 'the requester (not in the chain) cannot approve');
  const approved = await act(sys, { action: 'approve', comment: 'ok' }, 8);
  assert.equal(approved.status, 200);
  const changed = (await api.call('GET', `${C}/schedules`, itadm)).json.data.find((x) => x.id === s.id);
  assert.deepEqual([changed.cron, changed.enabled], ['0 4 * * *', false]);
  assert.ok(api.db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'core_schedules' AND action = 'update'").get());
  await api.close();
});

test('the whole console is hidden while ff.core.p0104 is OFF for the company', async () => {
  const api = await startApi();
  await api.call('PATCH', `${C}/feature-flags/ff.core.p0104`, { ...sys, headers: key(1), body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'switching the console off' } });
  for (const path of ['/events/metrics', '/jobs', '/schedules']) assert.equal((await api.call('GET', C + path, itadm)).status, 404, path);
  assert.equal((await api.call('GET', `${C}/financial-years`, sys)).status, 200, 'other parts are unaffected');
  assert.equal((await api.call('GET', `${C}/events/metrics`, other)).status, 200, 'another company still has it');
  await api.close();
});

test('housekeeping and the nightly integrity run are real jobs that do real work', async () => {
  const api = await startApi();
  const { jobs } = runtimeOf(api.db);
  api.db.prepare("INSERT INTO core_idempotency_keys (key, user_id, endpoint, request_hash, expires_at) VALUES ('old', 'u', 'e', 'h', '2020-01-01T00:00:00.000Z')").run();
  const hk = jobs.enqueue('core.housekeeping', {});
  const ig = jobs.enqueue('core.integrity_run', {});
  await jobs.drain();
  assert.deepEqual([jobs.get(hk.id).status, jobs.get(hk.id).result.keys >= 1], ['SUCCEEDED', true]);
  assert.equal(api.db.prepare("SELECT COUNT(*) AS n FROM core_idempotency_keys WHERE key = 'old'").get().n, 0);
  assert.equal(jobs.get(ig.id).status, 'SUCCEEDED');
  assert.ok(api.db.prepare('SELECT COUNT(*) AS n FROM core_integrity_runs').get().n > 0, 'the integrity result was recorded');
  await api.close();
});
