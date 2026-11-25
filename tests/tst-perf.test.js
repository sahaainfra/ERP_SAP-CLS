import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import '../src/server/modules/registry.js';
import { setupCompany, startApi } from './helpers.js';
import { enableFlags } from './tst-fixtures.js';
import { judgeRun, memoryGrowth } from '../src/server/modules/tst/perf.js';

// Part 30.06: the performance results. Runs and journeys judged against the SLOs (list 500, record 300, save 800, report 3,000,
// real-time 2,000 ms at p95; the punch burst 2,000 a minute); a soak judged by the growth of its memory; the SLOs are parameters
// changed only through the maker-checker; roles, export.
const T = '/api/v1/tst';
const opened = []; after(async () => { for (const a of opened) await a.close(); });
let seq = 0; const key = () => ({ 'idempotency-key': `prf-${Date.now().toString(36)}-${(seq += 1)}` });
const itadm = { roles: 'ITADM', user: 'perfeng' }; const sys = { roles: 'SYSADM', user: 'sys1' }; const aud = { roles: 'AUD', user: 'aud1' }; const pm = { roles: 'PM', user: 'pm1' };
async function boot() {
  const api = await startApi(); opened.push(api); await setupCompany(api); enableFlags(api.db, 1, ['ff.qa.p3006']);
  return { api, d: api.db, call: (who, method, path, body) => api.call(method, `${T}${path}`, { ...who, headers: key(), body }) };
}
const j = (model, journey, sloKind, p95, o = {}) => ({ model, journey, sloKind, requests: 1000, errors: 0, p50: p95 / 3, p95, p99: p95 * 1.4, max: p95 * 2, throughputRps: 20, ...o });
const loadRun = (o = {}) => ({ profile: 'LOAD', tool: 'NODE', environment: 'perf-lab', machine: 'test', startedAt: '2026-11-23T10:00:00.000Z', finishedAt: '2026-11-23T10:04:00.000Z', users: 1000, memory: { startMb: 470, endMb: 610, maxMb: 650, samples: [{ t: 0, rssMb: 470 }, { t: 2, rssMb: 600 }] },
  results: [j('USERS', 'Sample documents list', 'LIST', 120), j('USERS', 'Session check', 'RECORD', 40), j('PUNCH_BURST', 'Punch in', 'BURST', 300, { requests: 2000, throughputRps: 33.4 }), j('DPR_BURST', 'Create a DPR', 'SAVE', 60), j('MONTH_END', 'Trial balance', 'REPORT', 900), j('REALTIME', 'Event to screen', 'REALTIME', 950, { requests: 60 })], ...o });

test('T-01 the judgement: each journey against its SLO, the burst against 2,000 a minute, a soak against the growth of its memory', () => {
  assert.equal(judgeRun(loadRun()).result, 'PASS');
  const slow = judgeRun(loadRun({ results: [j('USERS', 'A list', 'LIST', 501)] })); assert.deepEqual([slow.result, slow.judged[0].status, slow.judged[0].sloMs], ['FAIL', 'FAIL', 500]);
  assert.equal(judgeRun(loadRun({ results: [j('USERS', 'A record', 'RECORD', 120, { errors: 1 })] })).result, 'FAIL', 'an error fails the journey');
  assert.equal(judgeRun(loadRun({ results: [j('PUNCH_BURST', 'Punch in', 'BURST', 300, { throughputRps: 30 })] })).result, 'FAIL', '1,800 a minute is not 2,000');
  assert.equal(judgeRun(loadRun({ profile: 'SMOKE', burstScale: 600, results: [j('PUNCH_BURST', 'Punch in', 'BURST', 300, { throughputRps: 10 })] })).result, 'PASS', 'a smoke run is held to its own pace');
  const flat = Array.from({ length: 100 }, (_, i) => ({ t: i * 300, rssMb: 600 + (i % 5) }));
  const leak = Array.from({ length: 100 }, (_, i) => ({ t: i * 300, rssMb: 600 + i * 3 }));
  assert.ok(memoryGrowth(flat).growthPct < 2); assert.ok(memoryGrowth(leak).growthPct > 40); assert.ok(memoryGrowth(leak).slopeMbPerHour > 30);
  assert.equal(judgeRun({ profile: 'SOAK', memory: { samples: flat }, results: [j('USERS', 'A list', 'LIST', 100)] }).result, 'PASS');
  assert.equal(judgeRun({ profile: 'SOAK', memory: { samples: leak }, results: [j('USERS', 'A list', 'LIST', 100)] }).result, 'FAIL', 'a leak fails the soak');
});

test('FR-02 runs are recorded and judged by the installation; the console shows the verdict, the trend and the selected run; export audited', async () => {
  const t = await boot();
  const r = await t.call(itadm, 'POST', '/perf/runs', loadRun()); assert.equal(r.status, 201, JSON.stringify(r.json));
  const run = r.json.data; assert.deepEqual([run.runNo, run.result, run.results.length, run.requests, run.durationS, run.rss.max], ['PRF-00001', 'PASS', 6, 6060, 240, 650]);
  assert.ok(run.results.every((x) => x.status === 'PASS')); assert.equal(run.results.find((x) => x.sloKind === 'BURST').targetRps, 33.33);
  const bad = await t.call(itadm, 'POST', '/perf/runs', loadRun({ profile: 'STRESS', results: [j('USERS', 'Sample documents list', 'LIST', 1400)] })); assert.equal(bad.json.data.result, 'FAIL');
  const soak = await t.call(itadm, 'POST', '/perf/runs', { ...loadRun({ profile: 'SOAK' }), memory: { startMb: 500, endMb: 505, maxMb: 520, samples: Array.from({ length: 200 }, (_, i) => ({ t: i * 144, rssMb: 500 + (i % 7) })) }, finishedAt: '2026-11-23T18:00:00.000Z' });
  assert.deepEqual([soak.json.data.result, soak.json.data.durationS], ['PASS', 28800]); assert.ok(soak.json.data.growthPct < 2);
  const o = (await t.call(aud, 'GET', '/perf')).json.data;
  assert.deepEqual([o.verdict, o.last.LOAD.runNo, o.last.SOAK.result, o.last.STRESS.result, o.runs.total], ['PASS', 'PRF-00001', 'PASS', 'FAIL', 3]);
  assert.deepEqual(o.slos, { LIST: 500, RECORD: 300, SAVE: 800, REPORT: 3000, REALTIME: 2000, BURST_PER_MIN: 2000, SOAK_GROWTH_PCT: 10 });
  assert.equal(o.trend.length, 3); assert.equal(o.trend[1].LIST, 1400); assert.equal(o.selected.id, run.id, 'the latest load run is shown');
  assert.equal((await t.call(aud, 'GET', `/perf?run=${bad.json.data.id}`)).json.data.selected.result, 'FAIL');
  assert.equal((await t.call(itadm, 'POST', '/perf/runs', loadRun({ finishedAt: '2026-11-23T09:00:00.000Z' }))).status, 400, 'finishes before it starts');
  assert.equal((await t.call(itadm, 'POST', '/perf/runs', loadRun({ results: [j('users', 'x', 'LIST', 1)] }))).status, 400);
  const x = await t.api.raw('GET', `${T}/perf/runs/${run.id}/export?format=csv`, itadm); assert.equal(x.status, 200); assert.match(x.buffer.toString('utf8'), /Punch in/);
  assert.ok(t.d.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'report' AND entity_id = 'tst.perf'").get());
  assert.ok(t.d.prepare("SELECT 1 FROM core_outbox WHERE event_type = 'tst.perf.recorded'").get());
});

test('FR-02 the SLOs are parameters: a change asked by one administrator applies only when another approves it (29.01 maker-checker)', async () => {
  const t = await boot(); enableFlags(t.d, 1, ['ff.admin.p2901']);
  const A = '/api/v1/admin';
  const ask = await t.api.call('POST', `${A}/changes`, { ...sys, headers: key(), body: { area: 'PARAMETER', key: 'tst.perf.slo_list_ms', value: '1500', reason: 'Lists of the archive are allowed longer while they move' } });
  assert.equal(ask.status, 201, JSON.stringify(ask.json));
  const before = (await t.call(itadm, 'POST', '/perf/runs', loadRun({ results: [j('USERS', 'Archive list', 'LIST', 1400)] }))).json.data;
  assert.equal(before.result, 'FAIL', 'not before the checker approves');
  assert.equal((await t.api.call('POST', `${A}/changes/${ask.json.data.id}/act`, { ...sys, headers: key(), body: { action: 'approve' } })).status, 403, 'the maker never approves');
  const ok = await t.api.call('POST', `${A}/changes/${ask.json.data.id}/act`, { ...itadm, headers: key(), body: { action: 'approve', comment: 'Agreed for the archive move' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const after = (await t.call(itadm, 'POST', '/perf/runs', loadRun({ results: [j('USERS', 'Archive list', 'LIST', 1400)] }))).json.data;
  assert.deepEqual([after.result, after.results[0].sloMs], ['PASS', 1500]);
  assert.equal((await t.call(itadm, 'GET', '/perf')).json.data.slos.LIST, 1500);
});

test('AC-03 roles: the performance engineer (ITADM) and SYSADM record; the auditor reads; others are refused; the flag hides it', async () => {
  const t = await boot();
  assert.equal((await t.call(sys, 'POST', '/perf/runs', loadRun())).status, 201);
  assert.equal((await t.call(aud, 'POST', '/perf/runs', loadRun())).status, 403);
  assert.equal((await t.call(aud, 'GET', '/perf')).status, 200); assert.deepEqual((await t.call(aud, 'GET', '/perf')).json.data.can.record, false);
  assert.equal((await t.call(pm, 'GET', '/perf')).status, 403);
  assert.equal((await t.call(itadm, 'GET', '/perf/runs/999')).status, 404);
  assert.equal((await t.call({ ...itadm, company: '2' }, 'GET', '/perf')).status, 404);
});
