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
export async function startApi(configOverrides = {}, appOverrides = {}) {
  const db = memoryDb();
  const app = createApp({ config: testConfig(configOverrides), db, logger: silentLogger, ...appOverrides });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
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
