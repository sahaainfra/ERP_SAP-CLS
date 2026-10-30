/**
 * A circuit breaker (FR-04). Closed: calls go through and failures are counted. After `threshold` failures in a row it
 * opens and calls fail at once without touching the provider. After `resetMs` it lets one probe call through (half open):
 * if that succeeds the circuit closes, if it fails the circuit opens again for another `resetMs`.
 */
export function createBreaker({ threshold, resetMs, now = () => Date.now() }) {
  let state = 'closed';
  let failures = 0;
  let openedAt = 0;
  let probing = false;
  return {
    /** May a call go to the provider now? */
    allow() {
      if (state === 'closed') return true;
      if (state === 'open' && now() - openedAt >= resetMs) {
        state = 'half_open';
        probing = false;
      }
      if (state === 'half_open' && !probing) {
        probing = true;
        return true;
      }
      return false;
    },
    /** @returns {'closed' | null} 'closed' when this success closed an open circuit. */
    success() {
      const was = state;
      state = 'closed';
      failures = 0;
      probing = false;
      return was === 'closed' ? null : 'closed';
    },
    /** @returns {'open' | null} 'open' when this failure opened the circuit. */
    failure() {
      if (state === 'half_open') {
        state = 'open';
        openedAt = now();
        probing = false;
        return 'open';
      }
      failures += 1;
      if (state === 'closed' && failures >= threshold) {
        state = 'open';
        openedAt = now();
        return 'open';
      }
      return null;
    },
    snapshot() {
      return { state, failures, openedAt: state === 'closed' ? null : new Date(openedAt).toISOString(), retryAfterMs: state === 'open' ? Math.max(0, resetMs - (now() - openedAt)) : 0 };
    },
    config: { threshold, resetMs },
  };
}

/** A sliding one-minute window per key (FR-04: rate limiting per provider). */
export function createRateLimiter({ now = () => Date.now(), windowMs = 60_000 } = {}) {
  const hits = new Map();
  return {
    take(key, limit) {
      const t = now();
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: windowMs - (t - recent[0]) };
      }
      recent.push(t);
      hits.set(key, recent);
      return { ok: true, retryAfterMs: 0 };
    },
    used(key) {
      const t = now();
      return (hits.get(key) ?? []).filter((x) => t - x < windowMs).length;
    },
    reset() {
      hits.clear();
    },
  };
}
