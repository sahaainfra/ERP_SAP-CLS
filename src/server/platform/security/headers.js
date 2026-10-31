import { HttpError } from '../http/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_REQUEST_HEADERS = 'Authorization, Content-Type, Idempotency-Key, X-Correlation-Id, X-Erp-Csrf, X-Token-Delivery, X-Health-Token, Traceparent';
const COOKIE = 'erp_rt';

/**
 * Security headers on every response (part 02.07, FR-04): a content security policy that allows only this application's own
 * scripts, HSTS where the connection is secure (or the environment is production), nothing may frame the application, no referrer,
 * a permissions policy, and API answers are never cached. Values come from the security settings.
 */
export function securityHeaders({ settings, config }) {
  return (req, res, next) => {
    const h = settings.get().settings.headers;
    const secure = req.secure || req.get('x-forwarded-proto') === 'https' || config?.nodeEnv === 'production';
    res.set({
      'content-security-policy': h.csp,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': h.referrerPolicy,
      'permissions-policy': h.permissionsPolicy,
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-site',
      'x-permitted-cross-domain-policies': 'none',
      ...(secure ? { 'strict-transport-security': `max-age=${h.hstsMaxAgeDays * 86_400}${h.hstsIncludeSubDomains ? '; includeSubDomains' : ''}` } : {}),
      ...(req.path.startsWith('/api') ? { 'cache-control': 'no-store' } : {}),
    });
    next();
  };
}

const originOf = (v) => { try { return new URL(v).origin; } catch { return null; } };

/**
 * A strict CORS allow-list (FR-04): the application's own origin and the origins named in the settings (and APP_URL); nobody
 * else. A browser request from another origin that changes data is refused outright, which is also the cross-site request defence.
 */
export function cors({ settings, config }) {
  return (req, res, next) => {
    const origin = req.get('origin');
    if (!origin) return next();
    const own = `${req.protocol}://${req.get('host')}`;
    const allowed = new Set([own, originOf(config?.appUrl ?? ''), ...settings.get().settings.cors.allowedOrigins].filter(Boolean));
    const ok = originOf(origin) === origin && (allowed.has(origin) || originOf(origin)?.split('://')[1] === req.get('host'));
    if (req.method === 'OPTIONS') {
      if (!ok) return next(new HttpError(403, 'CORS_FORBIDDEN', 'This origin is not allowed to call the API. An administrator can add it under Security Settings.'));
      res.set({ 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE', 'access-control-allow-headers': ALLOWED_REQUEST_HEADERS, 'access-control-allow-credentials': 'true', 'access-control-max-age': '600', vary: 'Origin' });
      return res.status(204).end();
    }
    if (ok) res.set({ 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', 'access-control-expose-headers': 'X-Correlation-Id, Retry-After, X-Audit-Head-Hash', vary: 'Origin' });
    else if (!SAFE.has(req.method)) return next(new HttpError(403, 'CORS_FORBIDDEN', 'This origin is not allowed to change data through the API.'));
    next();
  };
}

/** Cookie sessions (FR-04): a request that changes data and carries the session cookie but no token must send the header a cross-site page cannot. */
export function csrfGuard() {
  // The cookie authenticates only these routes (it is ignored everywhere else, so there is nothing to forge); signing in does not use it.
  const USES_COOKIE = /\/iam\/auth\/(refresh|logout|resume)\/?$/;
  return (req, _res, next) => {
    if (SAFE.has(req.method) || !USES_COOKIE.test(req.path)) return next();
    const cookie = req.get('cookie') ?? '';
    const hasSession = cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE}=`));
    if (hasSession && !req.get('authorization') && req.get('x-erp-csrf') !== '1') {
      return next(new HttpError(403, 'CSRF', 'This request carries a session cookie but not the x-erp-csrf header, so it was refused.'));
    }
    next();
  };
}
