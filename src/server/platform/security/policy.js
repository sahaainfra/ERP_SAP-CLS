import { HttpError, forbidden } from '../http/errors.js';
import { hasPermissionAnywhere } from '../auth/index.js';
import { ROUTE_POLICY } from './route-policy.js';
import { patternRegex } from './routes.js';

/**
 * The route policy (part 02.07, FR-01): what every route of the application declares, the one place a reviewer reads to see who
 * may call what. `guard` is how the route is protected:
 *   permission  one of the permissions in `permission` is needed (checked here, before the route runs, and again in the service)
 *   self        any signed-in person, about their own account or a lookup that exposes nothing of anyone else
 *   record      the route's own record rules decide (a file's record, an organisation entity); `permission` lists what it may need
 *   public      no sign-in (sign-in itself, signed links and webhooks, each with its own proof)
 *   infra       health and metrics, protected by their own token or permission
 */
export function createPolicy(rules = ROUTE_POLICY) {
  const compiled = rules.map((r) => ({ ...r, re: patternRegex(r.p), params: (r.p.match(/:/g) ?? []).length, len: r.p.length }));
  compiled.sort((a, b) => a.params - b.params || b.len - a.len);
  const keyOf = (m, p) => `${m} ${p}`;
  const exact = new Map(rules.map((r) => [keyOf(r.m, r.p), r]));
  return {
    rules,
    exact: (method, pattern) => exact.get(keyOf(method, pattern)) ?? null,
    /** The rule for a real request path (parameters filled in), most specific first. */
    find(method, path) {
      for (const r of compiled) if (r.m === method && r.re.test(path)) return r;
      return null;
    },
  };
}

const list = (k) => (Array.isArray(k) ? k : k ? [k] : []);

/** The Authorise stage in front of every route: a route declared with a permission is closed to anyone who holds none of them. */
export function enforcePolicy({ policy, isFlagOn }) {
  return (req, _res, next) => {
    // Express answers HEAD with the GET handler, so a HEAD request is held to the GET route's rule
    const rule = policy.find(req.method === 'HEAD' ? 'GET' : req.method, req.baseUrl + req.path);
    req.routePolicy = rule;
    if (!rule || rule.g !== 'permission' || !req.actor) return next();
    if (!isFlagOn(req.actor, 'ff.iam.p0207')) return next();
    const keys = list(rule.k);
    if (keys.some((k) => hasPermissionAnywhere(req.actor, k))) return next();
    return next(forbidden(`Your role does not include ${keys.join(' or ')}. Ask a system administrator for access.`));
  };
}

export { HttpError };
