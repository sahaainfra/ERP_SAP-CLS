#!/usr/bin/env node
// Part 30.06 FR-01 FR-02: the load models, run against the real server (src/server/index.js in its own process, on a seeded SQLite file),
// with the memory of the server sampled from the operating system while it runs.
//   USERS       N concurrent people with think time, each opening lists and records (LIST, RECORD) — 1,000 in the load profile
//   PUNCH_BURST the morning burst: 2,000 punches in a minute, each by its own employee (BURST: the rate, and SAVE at p95)
//   DPR_BURST   the evening: 200 daily progress reports created (SAVE) — in 60 s here, 30 minutes on site
//   MONTH_END   the month-end: the attendance register, the progress report, the trial balance and the daily summary at once (REPORT),
//               with bills posted through the calculation engine (SAVE)
//   REALTIME    a latency probe every 2 s through the outbox, the bus, the person's real-time room and notifications (REALTIME)
// Profiles: smoke (CI, about a minute), load (the models above), stress (twice the load), soak (USERS for --duration, memory every 10 s).
// Usage: node scripts/load_test.mjs [--profile smoke|load|stress|soak] [--duration 1800] [--post http://host:port] [--token …] [--out file]
// With --post the run is recorded in that installation (POST /api/v1/tst/perf/runs); the report is written to reports/load-<profile>.json.
import { execFileSync, spawn } from 'node:child_process';
import http from 'node:http';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrateUp, openDatabase } from '../src/server/platform/db/index.js';
import { summarize } from './lib/perf.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const profile = opt('profile', 'smoke').toUpperCase();
const P = {
  SMOKE: { users: 20, think: 1000, punches: 100, punchWindow: 10, dprs: 10, dprWindow: 10, monthEnd: 10, monthEndConc: 4, phase: 15 },
  LOAD: { users: 1000, think: 10_000, punches: 2000, punchWindow: 60, dprs: 200, dprWindow: 60, monthEnd: 60, monthEndConc: 50, monthEndThink: 1000, phase: 60 },
  STRESS: { users: 2000, think: 5000, punches: 4000, punchWindow: 60, dprs: 400, dprWindow: 60, monthEnd: 60, monthEndConc: 100, monthEndThink: 500, phase: 60 },
  USERS: { users: Number(process.env.LOAD_USERS ?? 1000), think: Number(process.env.LOAD_THINK ?? 10_000), punches: 0, dprs: 0, monthEnd: 0, phase: Number(opt('duration', 90)) },
  BURST: { users: 0, think: 1000, punches: 2000, punchWindow: 60, dprs: 0, monthEnd: 0, phase: 60 },
  SOAK: { users: 200, think: 5000, punches: 0, dprs: 0, monthEnd: 0, phase: Number(opt('duration', 1800)) },
}[profile];
if (!P) { console.error('--profile smoke|load|stress|soak'); process.exit(2); }
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const TODAY = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const SPARE = 20; const EMPLOYEES = Math.max(P.punches, 50) + SPARE; const DPR_SITES = Math.max(P.dprs, 5) + SPARE;
const LAT = 17.385; const LNG = 78.4867;

// ---------------------------------------------------------------- the database: volumes, people and places (SQL, before the server starts)
const dir = mkdtempSync(join(tmpdir(), 'erp-load-'));
const file = join(dir, 'load.sqlite'); mkdirSync(join(dir, 'storage'));
{
  const db = openDatabase(file); migrateUp(db);
  db.exec('BEGIN');
  db.exec('UPDATE core_feature_flags SET enabled = 1 WHERE company_id IS NULL');
  db.exec("INSERT INTO core_feature_flags (key, company_id, description, default_enabled, enabled) SELECT DISTINCT key, 1, 'load test', 0, 1 FROM core_feature_flags WHERE company_id IS NULL AND key NOT IN (SELECT key FROM core_feature_flags WHERE company_id = 1)");
  const run = (sql, ...p) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const series = (n) => `WITH RECURSIVE s(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM s WHERE i < ${n})`;
  db.exec(`${series(20000)} INSERT INTO core_sample_documents (company_id, doc_date, title, status, created_by, source_type) SELECT 1, '2026-10-15', 'Load document ' || i, 'DRAFT', 'seed', 'perf' FROM s`);
  const dept = run("INSERT INTO org_departments (company_id, code, name, created_by, source_type) VALUES (1, 'SITE', 'Site', 'seed', 'perf')");
  const des = run("INSERT INTO org_designations (company_id, code, name, grade, level, created_by, source_type) VALUES (1, 'WK', 'Worker', 'G1', 1, 'seed', 'perf')");
  const pid = run("INSERT INTO org_projects (company_id, code, name, type, status, created_by, source_type) VALUES (1, 'LD1', 'Load Tower', 'BUILDING', 'ACTIVE', 'seed', 'perf')");
  const s1 = run("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, 'LD-S1', 'Load site', 'ACTIVE', ?, ?, 'CIRCLE', 500, 'seed', 'perf')", pid, LAT, LNG);
  const sites = [];
  for (let i = 0; i < DPR_SITES; i += 1) sites.push(run("INSERT INTO org_sites (company_id, org_project_id, code, name, status, latitude, longitude, geofence_type, geofence_radius_m, created_by, source_type) VALUES (1, ?, ?, ?, 'ACTIVE', ?, ?, 'CIRCLE', 500, 'seed', 'perf')", pid, `LD-D${i}`, `DPR site ${i}`, LAT, LNG));
  for (let i = 0; i < EMPLOYEES; i += 1) {
    const u = run('INSERT INTO iam_users (company_id, username, display_name, roles_json, email) VALUES (1, ?, ?, ?, ?)', `lw${i}`, `Load worker ${i}`, '["EMP"]', `lw${i}@load.invalid`);
    const e = run("INSERT INTO hr_employees (company_id, emp_code, first_name, full_name, name_key, gender, dob, mobile, department_id, designation_id, grade, employment_type, doj, location_type, employment_status, record_status, user_id, created_by, source_type) VALUES (1, ?, 'Load', ?, ?, 'MALE', '1990-01-01', ?, ?, ?, 'G1', 'PERMANENT', '2026-01-01', 'SITE', 'ACTIVE', 'APPROVED', ?, 'seed', 'perf')", `LW${i}`, `Load worker ${i}`, `lw${i}`, `92${String(i).padStart(8, '0')}`, dept, des, u);
    run("INSERT INTO hr_deployments (company_id, doc_no, doc_date, person_type, person_id, dep_project_id, dep_site_id, from_date, is_primary, status, project_id, site_id, created_by, source_type) VALUES (1, ?, '2026-01-01', 'EMPLOYEE', ?, ?, ?, '2026-01-01', 1, 'APPROVED', ?, ?, 'seed', 'perf')", `LD-DEP-${i}`, e, pid, s1, pid, s1);
  }
  db.exec('COMMIT');
  db.close();
  writeFileSync(join(dir, 'ids.json'), JSON.stringify({ pid, s1, sites }));
  globalThis.ids = { pid, s1, sites };
}

// ---------------------------------------------------------------- the server in its own process
const port = await new Promise((r) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = /** @type {import('node:net').AddressInfo} */ (s.address()).port; s.close(() => r(p)); }); });
const server = spawn(process.execPath, [...(process.env.LOAD_CPU_PROF ? ['--cpu-prof', `--cpu-prof-dir=${process.env.LOAD_CPU_PROF}`, '--import', `${process.env.LOAD_CPU_PROF}/exit.mjs`] : []), 'src/server/index.js'], { cwd: root, env: { ...process.env, NODE_ENV: 'development', PORT: String(port), DATABASE_PATH: file, STORAGE_PATH: join(dir, 'storage'), AUTH_MODE: 'dev-headers', }, stdio: ['ignore', 'ignore', 'pipe'] });
let serverErr = ''; server.stderr.on('data', (d) => { serverErr = (serverErr + d).slice(-4000); });
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i += 1) { try { if ((await fetch(`${base}/api/v1/health`)).status < 500) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 200)); }
const rssMb = () => { try { return Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(server.pid)], { encoding: 'utf8' }).trim()) / 1024); } catch { return null; } };
const as = (user, roles) => ({ 'content-type': 'application/json', 'x-erp-user': user, 'x-erp-roles': roles, 'x-erp-company': '1' });
let seq = 0;
// every person calls from an address of their own (phones on mobile data, as on site): 127.x.y.z on the loopback, one agent each (a new connection per request, as after a think time),
// so the per-address limits of the server (02.07) act as they would in production rather than on one generator's address
const agents = new Map(); const addressOf = new Map();
const agentFor = (user) => { let ip = addressOf.get(user); if (!ip) { const n = addressOf.size + 1; ip = `127.${10 + Math.floor(n / 62500)}.${Math.floor(n / 250) % 250}.${(n % 250) + 1}`; addressOf.set(user, ip); } let a = agents.get(ip); if (!a) { a = new http.Agent({ keepAlive: false, localAddress: ip, maxSockets: 4 }); /* a phone opens a connection after its think time: the server closes idle ones after 5 s */ agents.set(ip, a); } return a; };
const call = (method, path, headers, body) => new Promise((resolveCall) => {
  const t = process.hrtime.bigint(); const text = body === undefined ? undefined : JSON.stringify(body);
  const h = { ...headers, ...(method === 'GET' ? {} : { 'idempotency-key': `load-${process.pid}-${(seq += 1)}` }), ...(text ? { 'content-length': Buffer.byteLength(text) } : {}) };
  const done = (status, raw) => { let json = null; try { json = JSON.parse(raw); } catch { /* not JSON */ } resolveCall({ ms: Number(process.hrtime.bigint() - t) / 1e6, ok: status > 0 && status < 400, status, json }); };
  const req = http.request(`${base}${path}`, { method, headers: h, agent: agentFor(headers['x-erp-user'] ?? 'anon'), timeout: 120_000 }, (res) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => done(res.statusCode, Buffer.concat(chunks).toString('utf8'))); res.on('error', () => done(0, '')); });
  req.on('error', () => done(0, '')); req.on('timeout', () => req.destroy());
  if (text) req.write(text); req.end();
});
const sys = as('load-admin', 'SYSADM,ITADM,HRMGR,PM,CFO');
await call('PUT', '/api/v1/core/company-settings', sys, { legalName: 'Load Test Constructions Pvt Ltd', reason: 'load test set-up' });
const fyStart = `${Number(TODAY.slice(0, 4)) - (Number(TODAY.slice(5, 7)) < 4 ? 1 : 0)}-04-01`;
await call('POST', '/api/v1/core/financial-years', sys, { startDate: fyStart });

// ---------------------------------------------------------------- the journeys and the recorder
const rec = new Map();
const note = (model, journey, sloKind, r) => { const k = `${model}|${journey}`; if (!rec.has(k)) rec.set(k, { model, journey, sloKind, lat: [], errors: 0, first: Date.now(), last: Date.now(), statuses: {} }); const x = rec.get(k); x.lat.push(r.ms); if (!r.ok) { x.errors += 1; x.statuses[r.status] = (x.statuses[r.status] ?? 0) + 1; x.sample ??= String(r.json?.error?.message ?? '').slice(0, 160); } x.last = Date.now(); };
const { s1, sites } = globalThis.ids;
const pick = (a) => a[Math.floor(Math.random() * a.length)];
/** @type {[string, string, () => string][]} */
const browse = [
  ['Sample documents list (20,000 rows)', 'LIST', () => `/api/v1/core/sample-documents?page=${1 + Math.floor(Math.random() * 20)}&pageSize=25`],
  ['Employees list', 'LIST', () => '/api/v1/hr/employees?page=1&pageSize=25'],
  ['Daily progress reports list', 'LIST', () => '/api/v1/site/dprs?page=1&pageSize=25'],
  ['Punches of the site today', 'LIST', () => `/api/v1/att/punches?siteId=${s1}&date=${TODAY}`],
  ['My approvals inbox', 'LIST', () => '/api/v1/workflow/tasks?mine=assigned'],
  ['Session check (every page)', 'RECORD', () => '/api/v1/core/session'],
  ['An employee record', 'RECORD', () => `/api/v1/hr/employees/${1 + Math.floor(Math.random() * EMPLOYEES)}`],
  ['Navigation menu', 'RECORD', () => '/api/v1/ui/navigation'],
];
let stopUsers = false;
async function users(n, think) {
  await Promise.all(Array.from({ length: n }, async (_, i) => {
    const h = as(`lu${i}`, 'PM,CM,HRMGR');
    if (!n) return; await new Promise((r) => setTimeout(r, Math.random() * think));
    while (!stopUsers) {
      const [label, kind, path] = pick(browse);
      note('USERS', label, kind, await call('GET', path(), h));
      await new Promise((r) => setTimeout(r, think * (0.5 + Math.random())));
    }
  }));
}
async function paced(count, windowS, fn) { const gap = (windowS * 1000) / Math.max(count, 1); const started = Date.now(); const all = []; for (let i = 0; i < count; i += 1) { const due = started + i * gap; const wait = due - Date.now(); if (wait > 0) await new Promise((r) => setTimeout(r, wait)); all.push(fn(i)); } await Promise.all(all); return (Date.now() - started) / 1000; }
async function punchBurst() {
  if (!P.punches) return null;
  const took = await paced(P.punches, P.punchWindow, async (i) => note('PUNCH_BURST', 'Punch in (own phone)', 'BURST', await call('POST', '/api/v1/att/punches', as(`lw${i}`, 'EMP'), { siteId: s1, punchType: 'IN', deviceTime: new Date().toISOString(), lat: LAT + (i % 50) * 0.00001, lng: LNG, accuracyM: 12, deviceId: `load-${i}`, clientUuid: `load-${process.pid}-${i}` })));
  return took;
}
async function dprBurst() {
  if (!P.dprs) return;
  await paced(P.dprs, P.dprWindow, async (i) => note('DPR_BURST', 'Create a daily progress report', 'SAVE', await call('POST', '/api/v1/site/dprs', as(`lse${i}`, 'SE'), { siteId: sites[i % sites.length], dprDate: TODAY, supervisor: `Supervisor ${i}` })));
}
async function monthEnd() {
  if (!P.monthEnd) return;
  const end = Date.now() + P.monthEnd * 1000; const period = `${TODAY.slice(0, 7)}-01`;
  /** @type {[string, () => string][]} */
  const reports = [
    ['Attendance register of the month', () => `/api/v1/att/register?period=${period}&siteId=${s1}`],
    ['Event log (last 100)', () => '/api/v1/core/events?page=1&pageSize=100'],
    ['Trial balance', () => '/api/v1/fin/trial-balance'],
    ['Daily attendance summary', () => `/api/v1/att/daily?date=${TODAY}`],
  ];
  await Promise.all(Array.from({ length: P.monthEndConc }, async (_, i) => {
    const h = as(`lme${i}`, 'SYSADM,CFO,HRMGR,PM'); let k = 0;
    while (Date.now() < end) {
      if (k % 4 === 3) note('MONTH_END', 'Post a bill (calculation engine, trace, audit, event)', 'SAVE', await call('POST', '/api/v1/core/sample-bills', h, { title: `Month-end bill ${i}-${k}`, quantity: '10', unitRate: '1250.00', gstPercent: '18', supply: 'intra' }));
      else { const [label, path] = reports[k % reports.length]; note('MONTH_END', label, 'REPORT', await call('GET', path(), h)); }
      k += 1;
      await new Promise((r) => setTimeout(r, P.monthEndThink ?? 0));
    }
  }));
}
let stopProbes = false;
async function probes() {
  const h = as('load-probe', 'ITADM');
  while (!stopProbes) {
    const s = await call('POST', '/api/v1/tst/integration/probes', h, {});
    const id = s.json?.data?.id;
    if (id) {
      let done = null;
      for (let i = 0; i < 50 && !done; i += 1) { await new Promise((r) => setTimeout(r, 200)); const g = await call('GET', `/api/v1/tst/integration/probes/${id}`, h); if (['PASS', 'FAIL'].includes(g.json?.data?.status)) done = g.json.data; }
      note('REALTIME', 'Event to screen and notification', 'REALTIME', done ? { ms: Math.max(done.realtimeMs ?? 0, done.notificationMs ?? 0), ok: true, status: 200 } : { ms: 10_000, ok: false, status: 0 });
    } else note('REALTIME', 'Event to screen and notification', 'REALTIME', { ms: s.ms, ok: false, status: s.status });
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------------------------------------------------------------- warm-up (not measured): the first call of each path compiles and fills caches
{
  const h = as('load-warm', 'PM,CM,HRMGR');
  for (let k = 0; k < 3; k += 1) for (const [, , path] of browse) await call('GET', path(), h);
  for (let k = 0; k < SPARE; k += 1) await call('POST', '/api/v1/att/punches', as(`lw${EMPLOYEES - 1 - k}`, 'EMP'), { siteId: s1, punchType: 'IN', deviceTime: new Date().toISOString(), lat: LAT, lng: LNG, accuracyM: 12, deviceId: `warm-${k}`, clientUuid: `warm-${process.pid}-${k}` });
  for (let k = 0; k < 3; k += 1) await call('POST', '/api/v1/site/dprs', as('lse-warm', 'SE'), { siteId: sites[sites.length - 1 - k], dprDate: TODAY, supervisor: 'Warm-up' });
  for (const path of ['/api/v1/att/register?period=' + `${TODAY.slice(0, 7)}-01&siteId=${s1}`, '/api/v1/fin/trial-balance', `/api/v1/att/daily?date=${TODAY}`, '/api/v1/core/events?page=1&pageSize=100']) await call('GET', path, as('lme-warm', 'SYSADM,CFO,HRMGR,PM'));
}

// ---------------------------------------------------------------- the run
const memory = []; const t0 = Date.now(); const startMb = rssMb(); let maxMb = startMb ?? 0;
const sampler = setInterval(() => { const m = rssMb(); if (m != null) { memory.push({ t: Math.round((Date.now() - t0) / 1000), rssMb: m }); maxMb = Math.max(maxMb, m); } }, profile === 'SOAK' ? 10_000 : 2000);
const startedAt = new Date().toISOString();
log(`${profile}: server ${base} (pid ${server.pid}), ${EMPLOYEES} employees, ${sites.length} DPR sites, RSS ${startMb} MB`);
const background = users(P.users, P.think); const prober = probes();
let punchSeconds = null;
if (profile === 'SOAK' || profile === 'USERS') await new Promise((r) => setTimeout(r, P.phase * 1000));
else {
  log('phase 1: the morning punch burst'); punchSeconds = await punchBurst();
  log('phase 2: the evening DPRs'); await dprBurst();
  log('phase 3: month-end reports and posting'); await monthEnd();
}
stopUsers = true; stopProbes = true; await background; await prober;
clearInterval(sampler);
const finishedAt = new Date().toISOString(); const endMb = rssMb();
server.kill('SIGTERM');
const results = [...rec.values()].map((x) => {
  const s = summarize(x.lat); const secs = Math.max((x.last - x.first) / 1000, 1);
  const rate = x.model === 'PUNCH_BURST' && punchSeconds ? x.lat.length / punchSeconds : x.lat.length / secs;
  return { model: x.model, journey: x.journey, sloKind: x.sloKind, requests: s.count, errors: x.errors, p50: s.p50Ms, p95: s.p95Ms, p99: s.p99Ms, max: s.maxMs ?? Math.max(...x.lat), throughputRps: Math.round(rate * 100) / 100, ...(Object.keys(x.statuses).length ? { _statuses: x.statuses, _sample: x.sample } : {}) };
});
const step = Math.max(1, Math.ceil(memory.length / 600));
const report = {
  profile, tool: 'NODE', environment: opt('environment', 'perf-lab'), machine: `${platform()} ${release()} · ${cpus().length} × ${cpus()[0]?.model ?? 'cpu'} · ${Math.round(totalmem() / 1073741824)} GB · Node ${process.version} · SQLite file`,
  startedAt, finishedAt, users: P.users, ...(profile === 'SMOKE' ? { burstScale: P.punches * (60 / P.punchWindow) } : {}), memory: { startMb: startMb ?? 0, endMb: endMb ?? memory.at(-1)?.rssMb ?? 0, maxMb, samples: memory.filter((_, i) => i % step === 0) },
  results: results.map(({ _statuses, _sample, ...r }) => r),
};
for (const r of results) log(`${r.model.padEnd(12)} ${r.journey.padEnd(52)} n=${String(r.requests).padStart(6)} err=${r.errors}${r._statuses ? ` ${JSON.stringify(r._statuses)} ${r._sample}` : ''} p50=${r.p50} p95=${r.p95} p99=${r.p99} rps=${r.throughputRps}`);
log(`memory: ${startMb} → ${endMb} MB, max ${maxMb} MB, ${memory.length} samples`);
mkdirSync(join(root, 'reports'), { recursive: true });
const out = opt('out', join(root, 'reports', `load-${profile.toLowerCase()}.json`)); writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`); log(`report: ${out}`);
if (opt('post')) {
  const token = opt('token', process.env.ERP_TOKEN ?? null);
  const r = await fetch(`${opt('post')}/api/v1/tst/perf/runs`, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `perf-${Date.now()}`, ...(token ? { authorization: `Bearer ${token}` } : { 'x-erp-user': 'perf-runner', 'x-erp-roles': 'ITADM', 'x-erp-company': process.env.ERP_COMPANY ?? '1' }) }, body: JSON.stringify(report) });
  const j = await r.json().catch(() => null); log(r.ok ? `recorded as ${j.data.runNo}: ${j.data.result}` : `could not record: ${r.status} ${j?.error?.message ?? ''}`);
}
if (serverErr.trim()) console.error(`server stderr (last lines):\n${serverErr.split('\n').slice(-15).join('\n')}`);
rmSync(dir, { recursive: true, force: true });
