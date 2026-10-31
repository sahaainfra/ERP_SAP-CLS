import { createServer } from 'node:http';

/**
 * The route self-test (part 02.07, T-01): every route that is not public is called without signing in (it must answer 401) and,
 * where the application runs with development headers, as a person holding the Employee role, which grants nothing (a route
 * declared with a permission must answer 403; a self or record route must not fail with a server error). The result of each
 * route is written to core_route_registry. The rate limiter stands aside while it runs.
 */
export async function runRouteTests({ app, db, routes, limiter, authMode }) {
  const server = await new Promise((resolve) => { const s = createServer(app); s.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  limiter?.suspend(true);
  const results = [];
  const call = async (method, path, headers) => {
    const res = await fetch(base + path.replace(/:[A-Za-z0-9_]+/g, '1'), { method, headers: { 'content-type': 'application/json', ...headers }, body: ['GET', 'HEAD'].includes(method) ? undefined : '{}' });
    await res.arrayBuffer();
    return res.status;
  };
  try {
    for (const r of routes) {
      const rule = r.rule;
      if (!rule || rule.g === 'public' || rule.g === 'infra') { results.push({ ...r, result: 'skipped', detail: rule ? `${rule.g} route: protected by its own proof` : 'not declared' }); continue; }
      const problems = [];
      const anon = await call(r.method, r.path, {});
      if (anon !== 401) problems.push(`without signing in: ${anon}, expected 401`);
      if (authMode === 'dev-headers') {
        const emp = await call(r.method, r.path, { 'x-erp-user': 'route-self-test', 'x-erp-roles': 'EMP', 'x-erp-company': '1' });
        if (rule.g === 'permission' && emp !== 403) problems.push(`as a person with no permissions: ${emp}, expected 403`);
        if (rule.g !== 'permission' && emp >= 500) problems.push(`as a person with no permissions: server error ${emp}`);
      }
      results.push({ ...r, result: problems.length ? 'fail' : 'pass', detail: problems.join('; ') || (authMode === 'dev-headers' ? '401 without sign-in, 403 without the permission' : '401 without sign-in') });
    }
  } finally {
    limiter?.suspend(false);
    await new Promise((resolve) => server.close(resolve));
  }
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_route_registry'").get()) {
    const at = new Date().toISOString();
    db.exec('BEGIN IMMEDIATE');
    try {
      const upd = db.prepare('UPDATE core_route_registry SET last_test_at = ?, last_test_result = ?, last_test_detail = ? WHERE method = ? AND path = ?');
      for (const x of results) upd.run(at, x.result, x.detail.slice(0, 300), x.method, x.path);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return {
    tested: results.filter((x) => x.result !== 'skipped').length,
    passed: results.filter((x) => x.result === 'pass').length,
    failed: results.filter((x) => x.result === 'fail').length,
    skipped: results.filter((x) => x.result === 'skipped').length,
    failures: results.filter((x) => x.result === 'fail').map((x) => ({ method: x.method, path: x.path, detail: x.detail })),
  };
}
