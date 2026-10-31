import { assertPermission } from '../../../platform/auth/index.js';
import { likePattern, orderBySql, pageResponse } from '../../../platform/pagination/index.js';
import { conflict, unprocessable } from '../../../platform/http/errors.js';
import { runRouteTests, securityOf, settingsSchema, DEFAULT_SETTINGS } from '../../../platform/security/index.js';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The route registry, the rate limits, headers, CORS and export settings, and the state of the secrets (part 02.07). */
export function createSecurityService({ db, config, approvals }) {
  const sec = securityOf(db);
  const rowOut = (r) => ({
    method: r.method, path: r.path, module: r.module, guard: r.guard, permission: r.permission_key, scope: r.scope_resolver, schema: r.schema_ref, rateClass: r.limit_class,
    public: Boolean(r.is_public), audit: Boolean(r.audit_flag), lastTestAt: r.last_test_at, lastTestResult: r.last_test_result, lastTestDetail: r.last_test_detail,
  });

  return {
    /** Every route with how it is protected and the result of its last test. */
    routes(actor, query) {
      assertPermission(actor, 'core.routes.view');
      const where = ["(path LIKE :q ESCAPE '\\' OR COALESCE(permission_key, '') LIKE :q ESCAPE '\\')"];
      const p = { q: likePattern(query.q) };
      for (const [name, col] of [['module', 'module'], ['guard', 'guard'], ['result', 'last_test_result'], ['method', 'method'], ['rate', 'limit_class']]) {
        if (query.filters[name]) { where.push(`${col} = :f_${name}`); p[`f_${name}`] = query.filters[name]; }
      }
      const w = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_route_registry WHERE ${w}`).get(p).n;
      const order = orderBySql(query.sort, { path: 'path', module: 'module', result: 'last_test_result' }, 'path, method');
      const rows = db.prepare(`SELECT * FROM core_route_registry WHERE ${w} ${order} LIMIT :limit OFFSET :offset`).all({ ...p, limit: query.limit, offset: query.offset });
      const s = db.prepare("SELECT COUNT(*) AS total, SUM(guard = 'public') AS public, SUM(guard = 'permission') AS permission, SUM(guard = 'self') AS self, SUM(guard = 'record') AS record, SUM(guard = 'infra') AS infra, SUM(last_test_result = 'pass') AS passed, SUM(last_test_result = 'fail') AS failed, SUM(last_test_result = 'skipped') AS skipped, MAX(last_test_at) AS tested_at FROM core_route_registry").get();
      const modules = db.prepare('SELECT module, COUNT(*) AS n FROM core_route_registry GROUP BY module ORDER BY module').all().map((m) => ({ module: m.module, routes: m.n }));
      const undeclared = sec.registry?.undeclared ?? [];
      return { ...pageResponse(rows.map(rowOut), total, query), summary: { total: s.total, public: s.public ?? 0, permission: s.permission ?? 0, self: s.self ?? 0, record: s.record ?? 0, infra: s.infra ?? 0, passed: s.passed ?? 0, failed: s.failed ?? 0, skipped: s.skipped ?? 0, testedAt: s.tested_at, undeclared: undeclared.length, declaredPct: s.total ? Math.round(((s.total) / (s.total + undeclared.length)) * 100) : 0 }, modules };
    },

    /** Call every route without signing in, and as a person with no permissions, and record each result. */
    async selfTest(actor) {
      assertPermission(actor, 'core.security.configure');
      if (!sec.registry || !sec.app) throw unprocessable('The route registry is not built yet.');
      return runRouteTests({ app: sec.app, db, routes: sec.registry.routes, limiter: sec.limiter, authMode: config.authMode });
    },

    /** The effective settings, the built-in defaults, any request waiting, and whether the secrets are set (never their values). */
    settings(actor) {
      assertPermission(actor, 'core.routes.view');
      const cur = sec.settings.get();
      const pending = db.prepare("SELECT id FROM core_change_requests WHERE company_id = ? AND type = 'security_settings_change' AND status IN ('SUBMITTED', 'RETURNED') AND is_active = 1 ORDER BY id DESC LIMIT 1").get(actor.companyId);
      const secret = (name, value) => ({ name, set: Boolean(value), source: 'environment' });
      return {
        version: cur.version, updatedBy: cur.updatedBy, updatedAt: cur.updatedAt, settings: cur.settings, defaults: DEFAULT_SETTINGS, customised: !same(cur.settings, DEFAULT_SETTINGS),
        pending: pending ? approvals.get(actor, pending.id) : null,
        secrets: [secret('AUTH_SECRET', config.authSecret), secret('VAULT_KEY', config.vaultKey), secret('FILE_URL_SECRET', config.fileUrlSecret), secret('HEALTH_TOKEN', config.healthToken)],
        environment: config.environment,
        canConfigure: actor.grants?.perms?.includes('core.security.configure') ?? false,
      };
    },

    /** Ask to change the settings. Nothing changes until the system administrator or the director approves. */
    requestChange(actor, { settings, reason }) {
      assertPermission(actor, 'core.security.configure');
      if (same(settingsSchema.parse(settings), sec.settings.get().settings)) throw unprocessable('Nothing would change: the requested settings are the current ones.');
      if (approvals.hasOpen(actor.companyId, 'security_settings_change', 'security_settings', 1)) throw conflict('There is already an open change to the security settings. Decide or withdraw it first.');
      const was = sec.settings.get().settings;
      const changed = [];
      for (const group of Object.keys(settings)) if (!same(settings[group], was[group])) changed.push(group);
      return approvals.submit(actor, {
        type: 'security_settings_change', title: `Change security settings: ${changed.join(', ')}`, targetType: 'security_settings', targetId: 1, reason,
        chain: ['SYSADM|DIR'], payload: { settings, changed },
      });
    },
  };
}
