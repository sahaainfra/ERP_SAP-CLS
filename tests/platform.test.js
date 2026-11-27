import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import express from 'express';
import { z } from 'zod';
import { ERROR_CODES, HttpError, errorHandler, forbidden } from '../src/server/platform/http/errors.js';
import { createLogger, createMemoryLogger } from '../src/server/platform/http/logger.js';
import { pseudonym } from '../src/server/platform/observability/context.js';
import { applyPipeline } from '../src/server/platform/http/pipeline.js';
import { parse } from '../src/server/platform/validation/index.js';
import { likePattern, orderBySql, pageMeta, pageResponse, parseListQuery } from '../src/server/platform/pagination/index.js';
import { assertVersion, insertRow, softDelete, standardInsertColumns, updateVersioned } from '../src/server/platform/db/repository.js';
import { startApi } from './helpers.js';

// A tiny app on the shared pipeline with routes that fail in each way (T-01).
async function pipelineApp(extra = () => {}) {
  const logger = createMemoryLogger();
  const app = express();
  applyPipeline(app, { logger });
  app.get('/ok', (_req, res) => res.json({ ok: true }));
  app.get('/validate', () => parse(z.object({ n: z.number() }), { n: 'x' }));
  app.get('/forbidden', () => {
    throw forbidden('Your role does not include x.y.z. Ask a system administrator for access.');
  });
  app.get('/boom', () => {
    throw new Error('SELECT * FROM secret_table failed at C:\\src\\db.js:12');
  });
  app.get('/boom-async', async () => {
    throw new TypeError('async failure with internal detail');
  });
  app.post('/echo', (req, res) => res.json(req.body));
  extra(app);
  app.use(errorHandler(logger));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { logger, base, close: () => new Promise((r) => server.close(r)) };
}

test('T-01 validation error: 400 envelope with field details and a correlation id', async () => {
  const app = await pipelineApp();
  const res = await fetch(`${app.base}/validate`);
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error.code, 'VALIDATION_ERROR');
  assert.deepEqual(body.error.details.map((d) => d.field), ['n']);
  assert.equal(body.error.correlationId, res.headers.get('x-correlation-id'));
  await app.close();
});

test('T-01 permission error: 403 envelope explains what to do', async () => {
  const app = await pipelineApp();
  const res = await fetch(`${app.base}/forbidden`);
  const body = await res.json();
  assert.equal(res.status, 403);
  assert.equal(body.error.code, 'FORBIDDEN');
  assert.match(body.error.message, /Ask a system administrator/);
  await app.close();
});

test('T-01 unhandled errors (sync and async): 500 envelope, no stack trace, SQL or file path leaked, detail logged', async () => {
  const app = await pipelineApp();
  for (const path of ['/boom', '/boom-async']) {
    const res = await fetch(`${app.base}${path}`);
    const text = await res.text();
    assert.equal(res.status, 500, path);
    const body = JSON.parse(text);
    assert.equal(body.error.code, 'INTERNAL_ERROR');
    assert.ok(body.error.correlationId);
    assert.ok(!/secret_table|\\src\\|at \w+|stack|TypeError/.test(text), `${path} leaked: ${text}`);
    const logged = app.logger.entries.find((e) => e.level === 'error' && e.correlationId === body.error.correlationId);
    assert.ok(logged?.stack, 'the stack is kept in the server log under the correlation id');
  }
  await app.close();
});

test('pipeline: a write naming a record that does not exist (a foreign key) is a 422 REFERENCE_MISSING, never a 500', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:'); db.exec('PRAGMA foreign_keys = ON; CREATE TABLE parent (id INTEGER PRIMARY KEY); CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent (id));');
  const app = await pipelineApp((a) => a.post('/child', () => { db.prepare('INSERT INTO child (parent_id) VALUES (99)').run(); }));
  const res = await fetch(`${app.base}/child`, { method: 'POST' });
  const text = await res.text();
  assert.equal(res.status, 422); assert.equal(JSON.parse(text).error.code, 'REFERENCE_MISSING'); assert.ok(!/FOREIGN KEY|child|parent_id/.test(text), 'no SQL detail leaked');
  await app.close();
});

test('pipeline: malformed JSON is a 400 BAD_JSON and an oversized body is a 413, never a 500', async () => {
  const app = await pipelineApp();
  const bad = await fetch(`${app.base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":' });
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).error.code, 'BAD_JSON');
  const big = await fetch(`${app.base}/echo`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ x: 'a'.repeat(60 * 1024) }) });
  assert.equal(big.status, 413);
  assert.equal((await big.json()).error.code, 'PAYLOAD_TOO_LARGE');
  await app.close();
});

test('pipeline: a well-formed X-Correlation-Id is kept, a malformed one is replaced', async () => {
  const app = await pipelineApp();
  const kept = await fetch(`${app.base}/ok`, { headers: { 'x-correlation-id': 'trace-abc-12345' } });
  assert.equal(kept.headers.get('x-correlation-id'), 'trace-abc-12345');
  const replaced = await fetch(`${app.base}/ok`, { headers: { 'x-correlation-id': 'bad id <script>' } });
  assert.match(replaced.headers.get('x-correlation-id'), /^[0-9a-f-]{36}$/);
  assert.equal(replaced.headers.get('x-powered-by'), null);
  assert.equal(replaced.headers.get('x-content-type-options'), 'nosniff');
  await app.close();
});

/** Waits until `find()` returns something (PACK-W0-01): the request line is written on the response's 'finish' event, which can come
 * after the client already holds the response, so reading the logger straight away was flaky in the full suite. */
async function eventually(find, { timeoutMs = 5000, label = 'the expected entry' } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const found = find();
    if (found) return found;
    if (Date.now() > until) assert.fail(`${label} did not appear within ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

test('request logging: one line per request with the correlation id and user, never the query string or body', async (t) => {
  const logger = createMemoryLogger();
  const api = await startApi({}, { logger });
  t.after(() => api.close()); // closed even when an assertion fails, so a failure cannot leave the server open and hang the file
  const res = await api.call('GET', '/api/v1/core/feature-flags?q=confidential-text', { user: 'meera', roles: 'SYSADM' });
  const line = await eventually(() => logger.entries.find((e) => e.msg === 'request' && e.path.endsWith('/feature-flags')), { label: 'the request log line' });
  assert.equal(line.correlationId, res.headers.get('x-correlation-id'));
  assert.equal(line.method, 'GET');
  assert.equal(line.status, 200);
  assert.equal(line.user, pseudonym('meera'), 'the user appears as a pseudonym, never by name');
  assert.ok(!JSON.stringify(logger.entries).includes('meera'));
  assert.equal(line.route, '/api/v1/core/feature-flags');
  assert.equal(line.module, 'core');
  assert.ok(Number.isInteger(line.durationMs));
  assert.ok(!JSON.stringify(logger.entries).includes('confidential-text'));
});

test('the JSON logger writes one parseable object per line', () => {
  const lines = [];
  const logger = createLogger({ write: (l) => lines.push(l), clock: () => new Date('2026-10-30T00:00:00Z') });
  logger.info({ msg: 'hello', n: 1 });
  logger.error({ msg: 'bad' });
  assert.deepEqual(JSON.parse(lines[0]), { time: '2026-10-30T00:00:00.000Z', level: 'info', msg: 'hello', n: 1 });
  assert.equal(JSON.parse(lines[1]).level, 'error');
});

test('T-01 on the real app: 401, 403, 404 and validation all use the one envelope', async (t) => {
  const api = await startApi();
  t.after(() => api.close());
  const cases = [
    [await api.call('GET', '/api/v1/core/session', { user: null }), 401, 'UNAUTHENTICATED'],
    [await api.call('GET', '/api/v1/core/feature-flags', { roles: 'PM' }), 403, 'FORBIDDEN'],
    [await api.call('GET', '/api/v1/nothing', { roles: 'SYSADM' }), 404, 'NOT_FOUND'],
    [await api.call('GET', '/api/v1/core/feature-flags?pageSize=0', { roles: 'SYSADM' }), 400, 'VALIDATION_ERROR'],
  ];
  for (const [r, status, code] of cases) {
    assert.equal(r.status, status);
    assert.equal(r.json.error.code, code);
    assert.ok(Array.isArray(r.json.error.details));
    assert.equal(r.json.error.correlationId, r.headers.get('x-correlation-id'));
  }
});

test('every code in the error registry has a status, a meaning and advice, and codes are unique', () => {
  assert.equal(new Set(ERROR_CODES.map((e) => e.code)).size, ERROR_CODES.length);
  for (const e of ERROR_CODES) assert.ok(e.status >= 400 && e.meaning && e.action, e.code);
  for (const code of ['VALIDATION_ERROR', 'UNAUTHENTICATED', 'FORBIDDEN', 'NOT_FOUND', 'VERSION_CONFLICT', 'INTERNAL_ERROR']) {
    assert.ok(ERROR_CODES.some((e) => e.code === code), code);
  }
  assert.ok(new HttpError(422, 'BUSINESS_RULE', 'm') instanceof Error);
});

// ---- pagination (T-02) ----
const opts = { sortable: ['name', 'created_at'], filterable: ['status'], defaultSort: [{ column: 'name', dir: 'asc' }] };

test('T-02 list query defaults and parsing', () => {
  const q = parseListQuery({}, opts);
  assert.deepEqual([q.page, q.pageSize, q.offset, q.limit, q.q], [1, 25, 0, 25, '']);
  assert.deepEqual(q.sort, [{ column: 'name', dir: 'asc' }]);
  const r = parseListQuery({ page: '3', pageSize: '50', sort: '-created_at,name', q: 'abc', 'filter[status]': 'APPROVED', from: '2026-04-01', to: '2026-04-30' }, opts);
  assert.deepEqual([r.page, r.pageSize, r.offset], [3, 50, 100]);
  assert.deepEqual(r.sort, [{ column: 'created_at', dir: 'desc' }, { column: 'name', dir: 'asc' }]);
  assert.deepEqual(r.filters, { status: 'APPROVED' });
  assert.deepEqual([r.from, r.to], ['2026-04-01', '2026-04-30']);
});

test('T-02 max pageSize 200 is enforced and bad input names the field', () => {
  assert.equal(parseListQuery({ pageSize: '200' }, opts).pageSize, 200);
  const field = (query) => {
    try {
      parseListQuery(query, opts);
    } catch (e) {
      return e.details.map((d) => d.field);
    }
    return null;
  };
  assert.deepEqual(field({ pageSize: '201' }), ['pageSize']);
  assert.deepEqual(field({ pageSize: '0' }), ['pageSize']);
  assert.deepEqual(field({ page: '0' }), ['page']);
  assert.deepEqual(field({ page: 'x' }), ['page']);
  assert.deepEqual(field({ sort: 'password' }), ['sort']);
  assert.deepEqual(field({ 'filter[secret]': 'x' }), ['filter[secret]']);
  assert.deepEqual(field({ from: '30-04-2026' }), ['from']);
  assert.deepEqual(field({ from: '2026-05-01', to: '2026-04-01' }), ['from']);
  assert.deepEqual(field({ q: 'x'.repeat(101) }), ['q']);
});

test('T-02 meta: totals, pages, empty result and the response envelope', () => {
  assert.deepEqual(pageMeta(51, { page: 1, pageSize: 25 }), { page: 1, pageSize: 25, total: 51, totalPages: 3 });
  assert.deepEqual(pageMeta(50, { page: 2, pageSize: 25 }), { page: 2, pageSize: 25, total: 50, totalPages: 2 });
  assert.equal(pageMeta(0, { page: 1, pageSize: 25 }).totalPages, 1);
  assert.deepEqual(pageResponse([1], 1, { page: 1, pageSize: 25 }), { data: [1], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } });
});

test('ORDER BY comes only from the column map, and LIKE text is escaped', () => {
  assert.equal(orderBySql([{ column: 'name', dir: 'desc' }], { name: 'name' }, 'id'), 'ORDER BY name DESC, id');
  assert.equal(orderBySql([], { name: 'name' }), '');
  assert.throws(() => orderBySql([{ column: 'evil', dir: 'asc' }], { name: 'name' }));
  assert.equal(likePattern('50%_off\\'), '%50\\%\\_off\\\\%');
});

// ---- repository helpers ----
function docsDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE t_docs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, company_id INTEGER, title TEXT, status TEXT NOT NULL DEFAULT 'DRAFT',
    created_by TEXT, created_at TEXT, updated_by TEXT, updated_at TEXT, version INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1, deleted_at TEXT, deleted_by TEXT)`);
  return db;
}

test('standard columns are filled on insert; version starts at 1', () => {
  const db = docsDb();
  const now = new Date('2026-10-30T10:00:00Z');
  assert.deepEqual(standardInsertColumns({ companyId: 7, actor: 'meera', now }), {
    company_id: 7, created_by: 'meera', created_at: now.toISOString(), updated_by: 'meera', updated_at: now.toISOString(), version: 1, is_active: 1,
  });
  const id = insertRow(db, 't_docs', { title: 'A' }, { companyId: 7, actor: 'meera', now });
  const row = db.prepare('SELECT * FROM t_docs WHERE id = ?').get(id);
  assert.deepEqual([row.company_id, row.created_by, row.version, row.is_active], [7, 'meera', 1, 1]);
});

test('optimistic update changes the row once; a stale version changes nothing', () => {
  const db = docsDb();
  const id = insertRow(db, 't_docs', { title: 'A' }, { companyId: 1, actor: 'a' });
  assert.equal(updateVersioned(db, 't_docs', id, 1, { title: 'B' }, { actor: 'b' }), true);
  assert.equal(updateVersioned(db, 't_docs', id, 1, { title: 'C' }, { actor: 'c' }), false, 'second writer holding version 1 loses');
  const row = db.prepare('SELECT * FROM t_docs WHERE id = ?').get(id);
  assert.deepEqual([row.title, row.version, row.updated_by], ['B', 2, 'b']);
  assert.throws(() => assertVersion(2, 1, 'Doc'), { status: 409 });
  assert.throws(() => assertVersion(2, undefined), { status: 409 });
  assert.doesNotThrow(() => assertVersion(2, 2));
});

test('soft delete: only DRAFT rows, version checked, row kept with who and when', () => {
  const db = docsDb();
  const draft = insertRow(db, 't_docs', { title: 'D' }, { companyId: 1, actor: 'a' });
  const approved = insertRow(db, 't_docs', { title: 'P', status: 'APPROVED' }, { companyId: 1, actor: 'a' });
  assert.throws(() => softDelete(db, 't_docs', approved, 1, { actor: 'x' }), { status: 422 });
  assert.throws(() => softDelete(db, 't_docs', draft, 9, { actor: 'x' }), { status: 409 });
  assert.throws(() => softDelete(db, 't_docs', 999, 1, { actor: 'x' }), { status: 404 });
  softDelete(db, 't_docs', draft, 1, { actor: 'x', now: new Date('2026-10-30T10:00:00Z') });
  const row = db.prepare('SELECT * FROM t_docs WHERE id = ?').get(draft);
  assert.deepEqual([row.is_active, row.deleted_by, row.deleted_at, row.version], [0, 'x', '2026-10-30T10:00:00.000Z', 2]);
  assert.throws(() => softDelete(db, 't_docs', draft, 2, { actor: 'x' }), { status: 404 }, 'already deleted');
});

test('table and column names are checked before they reach SQL', () => {
  const db = docsDb();
  assert.throws(() => updateVersioned(db, 't_docs; DROP TABLE t_docs', 1, 1, { title: 'x' }, { actor: 'a' }), /Unsafe SQL identifier/);
  assert.throws(() => updateVersioned(db, 't_docs', 1, 1, { 'title = 1; --': 'x' }, { actor: 'a' }), /Unsafe SQL identifier/);
  assert.throws(() => insertRow(db, 'T_DOCS', {}, { actor: 'a' }), /Unsafe SQL identifier/);
});
