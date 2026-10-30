import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApiClient } from '../src/client/platform/api/client.js';
import { allRoutes, defaultRoute, findRoute, registerModule, resetRegistry, routesFor } from '../src/client/platform/shell/registry.js';
import { headingText, parseMarkdown, slug } from '../src/client/platform/markdown.js';
import { queryKeys } from '../src/client/platform/query/keys.js';

const response = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const envelope = (status, code, message, extra = {}) => response(status, { error: { code, message, details: [], correlationId: 'srv-corr-1', ...extra } });

function client(responses, options = {}) {
  const calls = [];
  const sleeps = [];
  const queue = [...responses];
  const api = createApiClient({
    getAuthHeaders: () => ({ 'x-erp-user': 'meera' }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    sleep: async (ms) => sleeps.push(ms),
    newId: () => 'client-corr-1',
    ...options,
  });
  return { api, calls, sleeps };
}

test('requests carry auth headers, a correlation id and a JSON body', async () => {
  const { api, calls } = client([response(200, { data: 1 })]);
  assert.deepEqual(await api.patch('/core/x', { a: 1 }), { data: 1 });
  assert.equal(calls[0].url, '/api/v1/core/x');
  assert.equal(calls[0].init.method, 'PATCH');
  assert.equal(calls[0].init.headers['x-erp-user'], 'meera');
  assert.equal(calls[0].init.headers['x-correlation-id'], 'client-corr-1');
  assert.equal(calls[0].init.body, '{"a":1}');
});

test('idempotent GET retries a 503 with growing back-off and then succeeds', async () => {
  const { api, calls, sleeps } = client([envelope(503, 'SERVICE_UNAVAILABLE', 'down'), envelope(503, 'SERVICE_UNAVAILABLE', 'down'), response(200, { ok: true })]);
  assert.deepEqual(await api.get('/core/x'), { ok: true });
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps, [200, 400]);
  assert.ok(calls.every((c) => c.init.headers['x-correlation-id'] === 'client-corr-1'), 'one correlation id across the retries');
});

test('GET gives up after the retries and reports how many attempts were made', async () => {
  const { api, calls } = client([502, 502, 502].map(() => envelope(502, 'SERVICE_UNAVAILABLE', 'bad gateway')));
  await assert.rejects(api.get('/core/x'), (e) => e instanceof ApiError && e.status === 502 && e.attempts === 3);
  assert.equal(calls.length, 3);
});

test('a network error on GET is retried; on a write it is not', async () => {
  const boom = () => new TypeError('fetch failed');
  const get = client([boom(), response(200, { ok: 1 })]);
  assert.deepEqual(await get.api.get('/core/x'), { ok: 1 });
  assert.equal(get.calls.length, 2);
  const post = client([boom(), response(200, {})]);
  await assert.rejects(post.api.post('/core/x', {}), (e) => e.code === 'NETWORK' && e.status === 0 && /Cannot reach the server/.test(e.message));
  assert.equal(post.calls.length, 1, 'a write is never retried');
});

test('writes and client errors are never retried', async () => {
  const w = client([envelope(503, 'SERVICE_UNAVAILABLE', 'down'), response(200, {})]);
  await assert.rejects(w.api.post('/core/x', {}), { status: 503 });
  assert.equal(w.calls.length, 1);
  const bad = client([envelope(400, 'VALIDATION_ERROR', 'bad'), response(200, {})]);
  await assert.rejects(bad.api.get('/core/x'), { status: 400 });
  assert.equal(bad.calls.length, 1);
  const notFound = client([envelope(404, 'NOT_FOUND', 'nope')]);
  await assert.rejects(notFound.api.get('/core/x'), { code: 'NOT_FOUND' });
});

test('error normalisation: code, message, field errors and the server correlation id', async () => {
  const { api } = client([
    response(400, { error: { code: 'VALIDATION_ERROR', message: 'Fix these', details: [{ field: 'reason', message: 'too short' }, { field: 'enabled', message: 'must be true or false' }], correlationId: 'srv-9' } }),
  ]);
  try {
    await api.patch('/core/x', {});
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof ApiError);
    assert.deepEqual([e.status, e.code, e.message, e.correlationId], [400, 'VALIDATION_ERROR', 'Fix these', 'srv-9']);
    assert.deepEqual(e.fieldErrors, { reason: 'too short', enabled: 'must be true or false' });
  }
});

test('a non-JSON error (a proxy HTML page) still becomes an ApiError with a usable message', async () => {
  const { api } = client([response(500, '<html>Bad gateway</html>', { 'x-correlation-id': 'proxy-1' })]);
  await assert.rejects(api.get('/core/x'), (e) => e.code === 'SERVICE_UNAVAILABLE' && /HTTP 500/.test(e.message) && e.correlationId === 'proxy-1' && !e.message.includes('<html>'));
  const client404 = client([response(404, 'Not Found')]);
  await assert.rejects(client404.api.get('/core/x'), { code: 'UNEXPECTED_RESPONSE', status: 404 });
});

test('an aborted request is neither retried nor wrapped', async () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const { api, calls } = client([abort, response(200, {})]);
  await assert.rejects(api.get('/core/x'), { name: 'AbortError' });
  assert.equal(calls.length, 1);
});

test('module route registration: validation, duplicates and permission filtering', () => {
  resetRegistry();
  const Page = () => null;
  assert.throws(() => registerModule({ code: 'x', routes: [] }), /at least one route/);
  assert.throws(() => registerModule({ code: 'x', routes: [{ path: 'no-slash', label: 'L', Page }] }), /needs a path/);
  registerModule({
    code: 'one',
    label: 'One',
    routes: [
      { path: '/a', label: 'A', permission: 'p.a', Page },
      { path: '/b', label: 'B', Page },
    ],
  });
  assert.throws(() => registerModule({ code: 'one', routes: [{ path: '/z', label: 'Z', Page }] }), /already registered/);
  assert.throws(() => registerModule({ code: 'two', routes: [{ path: '/a', label: 'Dup', Page }] }), /already taken by module "one"/);
  registerModule({ code: 'two', label: 'Two', routes: [{ path: '/c', label: 'C', permission: 'p.c', flag: 'ff.two', Page }] });
  assert.deepEqual(allRoutes().map((r) => [r.module, r.path]), [['one', '/a'], ['one', '/b'], ['two', '/c']]);
  assert.equal(defaultRoute(), '/a');
  assert.equal(findRoute('/c').flag, 'ff.two');
  assert.equal(findRoute('/missing'), undefined);
  assert.deepEqual(routesFor([]).map((r) => r.path), ['/b'], 'entries without a permission are always shown; others are hidden');
  assert.deepEqual(routesFor(['p.a', 'p.c']).map((r) => r.path), ['/a', '/b', '/c']);
  resetRegistry();
  assert.equal(defaultRoute(), '/');
});

test('markdown: headings, paragraphs, lists, code blocks and tables parse into a tree', () => {
  const blocks = parseMarkdown(['# Title', '', 'one line', 'continues here', '', '- first', '- second `code`', '', '1. step', '2. step two', '', '```js', 'const a = 1;', '```', '', '| A | B |', '|---|---|', '| 1 | **two** |'].join('\n'));
  assert.deepEqual(blocks.map((b) => b.t), ['heading', 'paragraph', 'list', 'list', 'code', 'table']);
  assert.equal(headingText(blocks[0]), 'Title');
  assert.equal(blocks[1].children[0].v, 'one line continues here');
  assert.deepEqual([blocks[2].ordered, blocks[2].items.length, blocks[3].ordered], [false, 2, true]);
  assert.deepEqual(blocks[2].items[1].map((n) => n.t), ['text', 'code']);
  assert.deepEqual([blocks[4].lang, blocks[4].v], ['js', 'const a = 1;']);
  assert.deepEqual(blocks[5].header.map((h) => h[0].v), ['A', 'B']);
  assert.equal(blocks[5].rows[0][1][0].t, 'bold');
});

test('markdown: HTML in the source stays plain text (the renderer never injects markup)', () => {
  const [p] = parseMarkdown('Hello <script>alert(1)</script> world');
  assert.deepEqual(p.children, [{ t: 'text', v: 'Hello <script>alert(1)</script> world' }]);
  assert.equal(slug('2. Folder structure'), '2-folder-structure');
});

test('the real architecture guide parses into its sections and tables', async () => {
  const { readFileSync } = await import('node:fs');
  const blocks = parseMarkdown(readFileSync(new URL('../docs/erp/ARCHITECTURE.md', import.meta.url), 'utf8'));
  const h2 = blocks.filter((b) => b.t === 'heading' && b.level === 2).map(headingText);
  assert.ok(h2.includes('1. Layers') && h2.includes('6. Lists: pagination, sorting, filtering'));
  assert.ok(blocks.filter((b) => b.t === 'table').length >= 2);
  assert.ok(blocks.some((b) => b.t === 'code'));
});

test('query keys: module first, resource next, so one prefix invalidates a whole resource', () => {
  assert.deepEqual(queryKeys.core.flags.all, ['core', 'flags']);
  assert.deepEqual(queryKeys.core.flags.list({ page: 1 }).slice(0, 2), queryKeys.core.flags.all);
  assert.deepEqual(queryKeys.core.flags.evaluate(['b', 'a']).slice(0, 2), queryKeys.core.flags.all);
  assert.equal(queryKeys.core.flags.evaluate(['b', 'a'])[3], 'a,b', 'key order does not create separate cache entries');
});
