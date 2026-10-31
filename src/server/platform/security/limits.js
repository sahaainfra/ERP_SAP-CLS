import { HttpError } from '../http/errors.js';
import { recordSecurityEvent } from '../audit/index.js';

/**
 * Rate limiting (part 02.07, FR-03): a sliding one-minute window per address and per person, for each class of route (sign-in,
 * second step, export, write, read, webhook). The limits come from the security settings. A request over its limit gets 429 with
 * Retry-After, and the first refusal of a window is a security event. Counts live in this process (D-107).
 */
export function createRateLimiter({ db, settings, now = () => Date.now() }) {
  const windows = new Map();
  const announced = new Map();
  let suspended = false;
  const WINDOW = 60_000;

  function take(key, max) {
    const t = now();
    const hits = (windows.get(key) ?? []).filter((x) => t - x < WINDOW);
    if (hits.length >= max) {
      windows.set(key, hits);
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((WINDOW - (t - hits[0])) / 1000)), remaining: 0 };
    }
    hits.push(t);
    windows.set(key, hits);
    return { ok: true, remaining: max - hits.length, retryAfterSec: 0 };
  }
  const tidy = setInterval(() => {
    const t = now();
    for (const [k, v] of windows) if (!v.some((x) => t - x < WINDOW)) windows.delete(k);
    for (const [k, v] of announced) if (t - v > WINDOW) announced.delete(k);
  }, 30_000);
  tidy.unref?.();

  return {
    take,
    /** Count one request of `klass` from this address (and person, when known). Throws a 429 when over the limit. */
    check(req, klass, who = 'ip') {
      if (suspended) return;
      const cfg = settings.get().settings.rateLimits[klass];
      if (!cfg) return;
      const ip = req.ip ?? 'unknown';
      const key = who === 'ip' ? `${klass}|ip|${ip}` : `${klass}|user|${req.actor?.user ?? ip}`;
      const r = take(key, who === 'ip' ? cfg.ipPerMinute : cfg.userPerMinute);
      if (r.ok) return;
      if (!announced.has(key)) {
        announced.set(key, now());
        try {
          recordSecurityEvent(db, { companyId: req.actor?.companyId ?? null, userId: req.actor?.userId ?? null, username: req.actor?.user ?? null, type: 'rate_limit.exceeded', severity: 'WARNING', details: { class: klass, by: who, limitPerMinute: who === 'ip' ? cfg.ipPerMinute : cfg.userPerMinute, method: req.method }, ip, correlationId: req.correlationId ?? null });
        } catch { /* the log never stops the refusal */ }
      }
      /** @type {any} */
      const err = new HttpError(429, 'RATE_LIMITED', `Too many ${klass === 'auth' || klass === 'otp' ? 'sign-in attempts' : 'requests'} from ${who === 'ip' ? 'this address' : 'this account'}. Wait ${r.retryAfterSec} seconds and try again.`);
      err.retryAfterSec = r.retryAfterSec;
      throw err;
    },
    /** The self-test sends a few hundred requests in a few seconds; the limiter stands aside for it. */
    suspend(on) { suspended = on; },
    reset() { windows.clear(); announced.clear(); },
  };
}
