import { DatabaseSync } from 'node:sqlite';
import { loadConfig } from '../src/server/config.js';
import { migrateUp } from '../src/server/db.js';
import { createApp } from '../src/server/app.js';

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
export async function startApi(configOverrides = {}) {
  const db = memoryDb();
  const app = createApp({ config: testConfig(configOverrides), db, log: () => {} });
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
  return { db, call, close: () => new Promise((resolve) => server.close(resolve)) };
}
