import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/server/platform/config/index.js';
import { migrateUp } from '../src/server/platform/db/index.js';
import { createApp } from '../src/server/app.js';
import { silentLogger } from '../src/server/platform/http/logger.js';

export function testConfig(overrides = {}) {
  return loadConfig({ NODE_ENV: 'test', DATABASE_PATH: ':memory:', AUTH_MODE: 'dev-headers', ...overrides });
}

export function memoryDb() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  migrateUp(db);
  return db;
}

/** Start the API on a random port; returns { db, call, close }. */
/**
 * A wall-clock budget for a test, in ms (PACK-W0-01). The unit job runs with coverage on a shared runner, where the same work takes
 * about twice as long as on a developer machine: tests/plan-gantt.test.js T-02 took 31 s against its 15 s budget on main run #159
 * and passed on the next run. CI sets ERP_TEST_TIME_FACTOR; the real response-time targets are measured by the perf scripts
 * (npm run erp:*-perf, perf-smoke), not by unit tests, which only catch a gross slow-down.
 */
export const timeBudget = (ms) => ms * (Number(process.env.ERP_TEST_TIME_FACTOR) > 0 ? Number(process.env.ERP_TEST_TIME_FACTOR) : 1);

export async function startApi(configOverrides = {}, appOverrides = {}) {
  const db = memoryDb();
  const app = createApp({ config: testConfig(configOverrides), db, logger: process.env.TEST_LOG ? { ...silentLogger, error: (...a) => console.error(...a), warn: (...a) => console.error(...a) } : silentLogger, ...appOverrides });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  // The test client and the server share one process. When a test keeps the event loop busy for about 5 s (a burst of 2,000 records under coverage), the server's
  // keep-alive (5 s) closes an idle connection just as the client reuses it: ECONNRESET (D-455, reproduced 2 times in 6 with coverage). A longer server side keep-alive
  // leaves the client (undici, 4 s) to retire idle connections itself.
  server.keepAliveTimeout = 65_000; server.headersTimeout = 66_000;
  // PACK-W0-01: a test that fails before its `await api.close()` used to leave this server listening, so the test file never exited
  // (one flaky assertion stalled the whole local suite for 15 minutes; on CI it ran into the job timeout). The listening socket no
  // longer keeps the process alive; tests still close their server, preferably in t.after(() => api.close()).
  server.unref(); server.on('connection', (socket) => socket.unref()); // an idle keep-alive connection does not hold the process either
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { user = 'tester', roles = '', company = '1', body, headers = {} } = {}) => {
    const h = { 'content-type': 'application/json', ...headers };
    if (user) h['x-erp-user'] = user;
    if (roles) h['x-erp-roles'] = roles;
    if (company) h['x-erp-company'] = company;
    const res = await fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, headers: res.headers, json: await res.json().catch(() => null) };
  };
  /** Like call, but with a raw body (a FormData, a Buffer) and a binary response: { status, headers, buffer, json }. */
  const raw = async (method, path, { user = 'tester', roles = '', company = '1', body, headers = {} } = {}) => {
    const h = { ...headers };
    if (user) h['x-erp-user'] = user;
    if (roles) h['x-erp-roles'] = roles;
    if (company) h['x-erp-company'] = company;
    const res = await fetch(base + path, { method, headers: h, body });
    const buffer = Buffer.from(await res.arrayBuffer());
    let json = null;
    if ((res.headers.get('content-type') ?? '').includes('json')) json = JSON.parse(buffer.toString('utf8'));
    return { status: res.status, headers: res.headers, buffer, json };
  };
  return { db, call, raw, base, close: () => new Promise((resolve) => server.close(resolve)) };
}

const C = '/api/v1/core';
export const admin = (company = '1', user = 'sysadmin') => ({ roles: 'SYSADM', company, user });

/**
 * Make a company ready to number and post documents: its settings, the financial year 2026-27 (twelve open periods)
 * and a numbering series for the sample document type. Returns what was created.
 */
export async function setupCompany(api, { company = '1', format = '{PREFIX}/{FY}/{SEQ:4}', gapFree = false, resetRule = 'financial_year', prefix = 'SMP' } = {}) {
  const sys = admin(company);
  const settings = await api.call('PUT', `${C}/company-settings`, { ...sys, body: { legalName: `Company ${company} Pvt Ltd`, reason: 'initial set-up' } });
  const fy = await api.call('POST', `${C}/financial-years`, { ...sys, body: { startDate: '2026-04-01' } });
  const series = await api.call('POST', `${C}/number-series`, {
    ...sys,
    body: { docType: 'SAMPLE_DOC', name: 'Sample documents', prefix, format, gapFree, resetRule, reason: 'initial set-up' },
  });
  return { settings: settings.json?.data, fy: fy.json?.data, series: series.json?.data, responses: { settings, fy, series } };
}
