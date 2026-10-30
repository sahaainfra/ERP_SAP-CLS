// T-04 (part 01.01): contract snapshot of every route that existed before the architecture refactor.
// Statuses and bodies must stay identical (BR-03). Re-record only on purpose:
//   UPDATE_CONTRACTS=1 node --test tests/contract.test.js   (and explain the change in docs/erp/DECISIONS.md)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, copyFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { MIGRATIONS_DIR, migrateUp } from '../src/server/platform/db/index.js';
import { startApi } from './helpers.js';

const FILE = join(dirname(fileURLToPath(import.meta.url)), 'contracts', 'legacy-routes.json');
const L = '/api/v1/core/feature-flags';
const SYS = { roles: 'SYSADM' };

// Volatile values are replaced so the snapshot is stable across machines and runs.
// Permission lists may grow when a part adds permission keys but must never lose one, so only the keys
// that existed when the snapshot was recorded are compared.
const RECORDED_PERMISSIONS = new Set(['core.about.view', 'core.flag.configure', 'core.flag.view']);

function normalise(value) {
  if (Array.isArray(value?.data?.permissions)) {
    value = { ...value, data: { ...value.data, permissions: value.data.permissions.filter((p) => RECORDED_PERMISSIONS.has(p)) } };
  }
  const text = JSON.stringify(value)
    .replace(/"correlationId":"[^"]+"/g, '"correlationId":"<id>"')
    .replace(/"(appliedAt|changedAt|builtAt|deployedAt)":"[^"]*"/g, '"$1":"<time>"')
    .replace(/"(commit)":"[^"]*"/g, '"$1":"<commit>"')
    .replace(/"(node)":"[^"]*"/g, '"$1":"<node>"')
    .replace(/"(version)":"\d+\.\d+\.\d+[^"]*"/g, '"$1":"<semver>"');
  return JSON.parse(text);
}

const scenarios = [
  ['GET /api/health', 'GET', '/api/health', {}],
  ['GET session as ITADM', 'GET', '/api/v1/core/session', { roles: 'ITADM' }],
  ['GET session without identity', 'GET', '/api/v1/core/session', { user: null }],
  ['GET about as SYSADM', 'GET', '/api/v1/core/about', SYS],
  ['GET about as PM', 'GET', '/api/v1/core/about', { roles: 'PM' }],
  ['GET list default', 'GET', L, SYS],
  ['GET list page 2 size 2', 'GET', `${L}?page=2&pageSize=2`, SYS],
  ['GET list search p0003', 'GET', `${L}?q=p0003`, SYS],
  ['GET list pageSize too large', 'GET', `${L}?pageSize=500`, SYS],
  ['GET list as PM', 'GET', L, { roles: 'PM' }],
  ['GET evaluate', 'GET', `${L}/evaluate?keys=ff.prog.p0001,ff.nope`, {}],
  ['GET evaluate other company', 'GET', `${L}/evaluate?keys=ff.prog.p0001&company_id=2`, {}],
  ['GET evaluate without keys', 'GET', `${L}/evaluate`, {}],
  [
    'PATCH create company override',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'company', companyId: 1 }, enabled: false, reason: 'contract snapshot' } },
  ],
  [
    'PATCH update without version',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'contract snapshot' } },
  ],
  [
    'PATCH update with version',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'contract snapshot', version: 1 } },
  ],
  [
    'PATCH stale version',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'contract snapshot', version: 1 } },
  ],
  [
    'PATCH validation errors',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'project', companyId: 1 }, enabled: 'yes', reason: 'x' } },
  ],
  [
    'PATCH missing project id',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'project', companyId: 1 }, enabled: true, reason: 'valid reason' } },
  ],
  [
    'PATCH other company',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { ...SYS, body: { scope: { level: 'company', companyId: 2 }, enabled: true, reason: 'valid reason' } },
  ],
  [
    'PATCH as ITADM',
    'PATCH',
    `${L}/ff.prog.p0001`,
    { roles: 'ITADM', body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'valid reason' } },
  ],
  [
    'PATCH undefined flag',
    'PATCH',
    `${L}/ff.nope`,
    { ...SYS, body: { scope: { level: 'company', companyId: 1 }, enabled: true, reason: 'valid reason' } },
  ],
  [
    'PATCH environment default',
    'PATCH',
    `${L}/ff.prog.p0002`,
    { ...SYS, body: { scope: { level: 'environment', environment: 'production' }, enabled: true, reason: 'contract snapshot' } },
  ],
  ['GET list after changes', 'GET', `${L}?pageSize=50`, SYS],
  ['GET unknown API route', 'GET', '/api/v1/nothing', SYS],
];

// The routes are replayed against the data that existed when the snapshot was recorded (migrations up to this
// id). Reference seeds added by later parts are new data, not a change to a legacy route, so they must not
// alter the snapshot.
const LEGACY_DATA_CUTOFF = '20261030000004';

function legacyDb() {
  const dir = mkdtempSync(join(tmpdir(), 'erp-legacy-'));
  for (const f of readdirSync(MIGRATIONS_DIR)) if (f.slice(0, 14) <= LEGACY_DATA_CUTOFF) copyFileSync(join(MIGRATIONS_DIR, f), join(dir, f));
  const db = new DatabaseSync(':memory:');
  migrateUp(db, dir);
  return db;
}

async function record() {
  const api = await startApi({}, { db: legacyDb() });
  const out = {};
  try {
    for (const [name, method, path, opts] of scenarios) {
      const r = await api.call(method, path, opts);
      out[name] = { status: r.status, body: normalise(r.json), hasCorrelationHeader: Boolean(r.headers.get('x-correlation-id')) };
    }
  } finally {
    await api.close();
  }
  return out;
}

test('T-04 legacy routes respond identically to the recorded contract snapshot', async () => {
  const actual = await record();
  if (process.env.UPDATE_CONTRACTS === '1' || !existsSync(FILE)) {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, `${JSON.stringify(actual, null, 2)}\n`);
    return;
  }
  const expected = JSON.parse(readFileSync(FILE, 'utf8'));
  assert.deepEqual(Object.keys(actual), Object.keys(expected), 'the scenario list changed');
  for (const name of Object.keys(expected)) assert.deepEqual(actual[name], expected[name], name);
});
