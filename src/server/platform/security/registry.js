import { collectRoutes } from './routes.js';

const moduleOf = (path) => /^\/api\/v\d+\/([a-z0-9_-]+)/.exec(path)?.[1] ?? (path.startsWith('/health') || path === '/metrics' ? 'health' : 'app');
const DEV = new Set(['development', 'test']);

/** The live routes matched against the policy: which are declared, which are not, and which policy lines name no route. */
export function buildRegistry(app, policy) {
  const live = collectRoutes(app);
  const rows = live.map((r) => {
    const rule = policy.exact(r.method, r.path);
    const externalPortal = r.path.startsWith('/api/v1/portal/') && !r.path.startsWith('/api/v1/portal/admin/');
    return { ...r, rule: externalPortal && rule?.scope !== 'partner' ? null : rule };
  });
  const liveKeys = new Set(live.map((r) => `${r.method} ${r.path}`));
  return {
    routes: rows,
    undeclared: rows.filter((r) => !r.rule).map((r) => `${r.method} ${r.path}`),
    stale: policy.rules.filter((r) => !liveKeys.has(`${r.m} ${r.p}`)).map((r) => `${r.m} ${r.p}`),
  };
}

/** Every permission a rule names must exist. `known` is the set of permission keys of the permission registry and the role templates. */
export function checkKeys(built, known) {
  const bad = [];
  for (const r of built.routes) {
    for (const k of [r.rule?.k ?? []].flat()) if (k && !known.has(k)) bad.push(`${r.method} ${r.path}: ${k}`);
  }
  return bad;
}

/**
 * Start-up check (BR-01): outside development and test, a route with no policy line stops the application from starting. In
 * development and test the problem is only reported, so a new route can be written before it is declared.
 */
export function assertDeclared(built, /** @type {{ environment: string, log?: (text: string) => void }} */ { environment, log = () => {} }) {
  if (!built.undeclared.length) return;
  const text = `${built.undeclared.length} route(s) are not in the route policy (platform/security/route-policy.js): ${built.undeclared.slice(0, 10).join(', ')}${built.undeclared.length > 10 ? ', ...' : ''}`;
  if (DEV.has(environment)) log(text);
  else throw new Error(`Refusing to start: ${text}. Declare each route's permission, or mark it public.`);
}

/** Write the snapshot to core_route_registry (keeping each route's last test result). */
export function persistRegistry(db, built) {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_route_registry'").get()) return 0;
  const upsert = db.prepare(`INSERT INTO core_route_registry (method, path, module, guard, permission_key, scope_resolver, schema_ref, limit_class, is_public, audit_flag)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (method, path) DO UPDATE SET module = excluded.module, guard = excluded.guard, permission_key = excluded.permission_key, scope_resolver = excluded.scope_resolver, schema_ref = excluded.schema_ref, limit_class = excluded.limit_class, is_public = excluded.is_public, audit_flag = excluded.audit_flag`);
  db.exec('BEGIN IMMEDIATE');
  try {
    const keep = new Set();
    for (const r of built.routes) {
      const p = r.rule;
      if (!p) continue;
      keep.add(`${r.method} ${r.path}`);
      upsert.run(r.method, r.path, moduleOf(r.path), p.g, [p.k ?? []].flat().join(' | ') || null, p.scope, p.s, p.rate, p.g === 'public' ? 1 : 0, p.audit ? 1 : 0);
    }
    for (const row of db.prepare('SELECT id, method, path FROM core_route_registry').all()) if (!keep.has(`${row.method} ${row.path}`)) db.prepare('DELETE FROM core_route_registry WHERE id = ?').run(row.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return built.routes.length;
}

export { moduleOf };
