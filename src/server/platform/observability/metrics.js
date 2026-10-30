import { monitorEventLoopDelay } from 'node:perf_hooks';

// Metrics (FR-02): request rate, latency and errors by route, in one-minute slices kept for 26 hours, plus counters and the
// slow-query log. Latency is a fixed-bucket histogram, so memory stays small and percentiles are estimates inside a bucket.
// The bucket edges include the standard's targets (300 ms for a record, 500 ms for a list, 800 ms for a save).
export const HIST_EDGES = Object.freeze([5, 10, 25, 50, 100, 250, 300, 500, 800, 1000, 2000, 5000]);
const MINUTE = 60_000;
const KEEP_MINUTES = 26 * 60;
const MAX_ROUTE_KEYS = 300;

export const emptyHist = () => new Array(HIST_EDGES.length + 1).fill(0);
export const bucketOf = (ms) => {
  const i = HIST_EDGES.findIndex((e) => ms <= e);
  return i === -1 ? HIST_EDGES.length : i;
};
export const addHist = (a, b) => a.map((v, i) => v + (b[i] ?? 0));

/** A percentile (0 to 1) from a histogram, interpolated inside its bucket. Returns null for an empty histogram. */
export function percentile(hist, q) {
  const total = hist.reduce((a, b) => a + b, 0);
  if (total === 0) return null;
  const target = q * total;
  let seen = 0;
  for (let i = 0; i < hist.length; i += 1) {
    if (seen + hist[i] >= target && hist[i] > 0) {
      if (i === HIST_EDGES.length) return HIST_EDGES.at(-1); // slower than the last edge: report the edge
      const lower = i === 0 ? 0 : HIST_EDGES[i - 1];
      return Math.round((lower + ((target - seen) / hist[i]) * (HIST_EDGES[i] - lower)) * 10) / 10;
    }
    seen += hist[i];
  }
  return HIST_EDGES.at(-1);
}

/** How many requests in a histogram finished within `ms` (using the largest bucket edge not above it: never flattering). */
export function withinMs(hist, ms) {
  let n = 0;
  for (let i = 0; i < HIST_EDGES.length; i += 1) if (HIST_EDGES[i] <= ms) n += hist[i];
  return n;
}

/** Normalise SQL for grouping: literals become ?, whitespace collapses. */
export const normaliseSql = (sql) => String(sql).replace(/'(?:[^']|'')*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?').replace(/\s+/g, ' ').trim().slice(0, 240);

export function createMetrics({ now = () => Date.now() } = {}) {
  /** @type {Map<number, Map<string, { n: number, e4: number, e5: number, sum: number, hist: number[], flushed: boolean }>>} */
  const minutes = new Map();
  const counters = new Map();
  const routeKeys = new Set();
  const slow = [];
  const queryStats = new Map(); // normalised sql -> { count, totalMs, maxMs }
  const startedAt = now();
  const loop = monitorEventLoopDelay({ resolution: 20 });
  loop.enable();

  const slice = (key) => {
    const minute = Math.floor(now() / MINUTE) * MINUTE;
    let m = minutes.get(minute);
    if (!m) {
      m = new Map();
      minutes.set(minute, m);
      for (const k of minutes.keys()) if (k < minute - KEEP_MINUTES * MINUTE) minutes.delete(k);
    }
    let s = m.get(key);
    if (!s) {
      s = { n: 0, e4: 0, e5: 0, sum: 0, hist: emptyHist(), flushed: false };
      m.set(key, s);
    }
    return s;
  };

  const metrics = {
    startedAt,

    /** Record one finished request. `route` is the matched pattern ("/api/v1/core/files/:id"), never the raw URL. */
    observeRequest({ method, route, status, durationMs }) {
      let key = `${method} ${route}`;
      if (!routeKeys.has(key)) {
        if (routeKeys.size >= MAX_ROUTE_KEYS) key = `${method} other`;
        else routeKeys.add(key);
      }
      const s = slice(key);
      s.n += 1;
      s.sum += durationMs;
      if (status >= 500) s.e5 += 1;
      else if (status >= 400) s.e4 += 1;
      s.hist[bucketOf(durationMs)] += 1;
      s.flushed = false;
    },

    /** Sum the slices of the last `windowMinutes` for routes accepted by `match` (all by default). */
    /** @param {number} windowMinutes @param {(key: string) => boolean} [match] @param {{ onlyUnflushed?: boolean }} [options] */
    aggregate(windowMinutes, match = (_key) => true, { onlyUnflushed = false } = {}) {
      const from = Math.floor(now() / MINUTE) * MINUTE - (windowMinutes - 1) * MINUTE;
      const out = { requests: 0, serverErrors: 0, clientErrors: 0, sumMs: 0, hist: emptyHist() };
      for (const [minute, m] of minutes) {
        if (minute < from) continue;
        for (const [key, s] of m) {
          if (!match(key) || (onlyUnflushed && s.flushed)) continue;
          out.requests += s.n;
          out.serverErrors += s.e5;
          out.clientErrors += s.e4;
          out.sumMs += s.sum;
          out.hist = addHist(out.hist, s.hist);
        }
      }
      return out;
    },

    /** Per-route figures for the last window: requests, rate, errors, p50, p95, p99. */
    routes(windowMinutes = 60) {
      const from = Math.floor(now() / MINUTE) * MINUTE - (windowMinutes - 1) * MINUTE;
      const byKey = new Map();
      for (const [minute, m] of minutes) {
        if (minute < from) continue;
        for (const [key, s] of m) {
          const t = byKey.get(key) ?? { n: 0, e4: 0, e5: 0, sum: 0, hist: emptyHist() };
          t.n += s.n;
          t.e4 += s.e4;
          t.e5 += s.e5;
          t.sum += s.sum;
          t.hist = addHist(t.hist, s.hist);
          byKey.set(key, t);
        }
      }
      return [...byKey.entries()]
        .map(([key, t]) => ({ route: key, requests: t.n, perMinute: Math.round((t.n / windowMinutes) * 100) / 100, serverErrors: t.e5, clientErrors: t.e4, errorRate: t.n ? t.e5 / t.n : 0, meanMs: Math.round((t.sum / t.n) * 10) / 10, p50: percentile(t.hist, 0.5), p95: percentile(t.hist, 0.95), p99: percentile(t.hist, 0.99) }))
        .sort((a, b) => b.requests - a.requests);
    },

    /**
     * Slices of completed minutes that have not been saved yet, grouped by hour and route, for persistence. They are marked as
     * flushed; an entry returned here is the caller's to save.
     */
    drainFlushable() {
      const current = Math.floor(now() / MINUTE) * MINUTE;
      const byHour = new Map();
      for (const [minute, m] of minutes) {
        if (minute >= current) continue;
        for (const [key, s] of m) {
          if (s.flushed) continue;
          const hour = new Date(Math.floor(minute / 3_600_000) * 3_600_000).toISOString();
          const k = `${hour}|${key}`;
          const t = byHour.get(k) ?? { hour, route: key, requests: 0, serverErrors: 0, clientErrors: 0, sumMs: 0, hist: emptyHist() };
          t.requests += s.n;
          t.serverErrors += s.e5;
          t.clientErrors += s.e4;
          t.sumMs += s.sum;
          t.hist = addHist(t.hist, s.hist);
          byHour.set(k, t);
          s.flushed = true;
        }
      }
      return [...byHour.values()];
    },

    /** @param {string} name @param {number} [inc] */
    counter(name, inc = 1) {
      counters.set(name, (counters.get(name) ?? 0) + inc);
    },
    counters: () => Object.fromEntries(counters),

    /** A database statement finished (see dbstats.js). Slow ones are listed; every one is counted by normalised text. */
    observeQuery({ sql, ms, correlationId = null, slowMs = 100 }) {
      const key = normaliseSql(sql);
      const q = queryStats.get(key) ?? { count: 0, totalMs: 0, maxMs: 0 };
      q.count += 1;
      q.totalMs += ms;
      q.maxMs = Math.max(q.maxMs, ms);
      if (queryStats.size < 500 || queryStats.has(key)) queryStats.set(key, q);
      metrics.counter('db.queries');
      if (ms >= slowMs) {
        metrics.counter('db.slow_queries');
        slow.push({ sql: key, ms: Math.round(ms * 10) / 10, at: new Date(now()).toISOString(), correlationId });
        if (slow.length > 100) slow.shift();
      }
    },
    slowQueries: (n = 20) => slow.slice(-n).reverse(),
    queryStats: (n = 10) =>
      [...queryStats.entries()]
        .map(([sql, q]) => ({ sql, count: q.count, meanMs: Math.round((q.totalMs / q.count) * 100) / 100, maxMs: Math.round(q.maxMs * 10) / 10, totalMs: Math.round(q.totalMs) }))
        .sort((a, b) => b.totalMs - a.totalMs)
        .slice(0, n),

    process() {
      const mem = process.memoryUsage();
      const cpu = process.cpuUsage();
      return {
        uptimeSeconds: Math.round((now() - startedAt) / 1000),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        eventLoopLagMs: Math.round((loop.mean / 1e6) * 100) / 100,
        eventLoopLagP99Ms: Math.round((loop.percentile(99) / 1e6) * 100) / 100,
        cpuSeconds: Math.round((cpu.user + cpu.system) / 1e4) / 100,
        node: process.version,
      };
    },
    stop: () => loop.disable(),
    reset() {
      minutes.clear();
      counters.clear();
      routeKeys.clear();
      slow.length = 0;
      queryStats.clear();
    },

    /** Prometheus text exposition (version 0.0.4) of the request metrics, counters and any extra gauges. */
    prometheus(extra = []) {
      const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
      const lines = ['# HELP erp_http_requests_total Requests by route and outcome (last 26 hours in memory).', '# TYPE erp_http_requests_total counter'];
      const byKey = new Map();
      for (const m of minutes.values()) {
        for (const [key, s] of m) {
          const t = byKey.get(key) ?? { n: 0, e4: 0, e5: 0, sum: 0, hist: emptyHist() };
          t.n += s.n;
          t.e4 += s.e4;
          t.e5 += s.e5;
          t.sum += s.sum;
          t.hist = addHist(t.hist, s.hist);
          byKey.set(key, t);
        }
      }
      for (const [key, t] of byKey) {
        const [method, ...rest] = key.split(' ');
        const labels = `method="${esc(method)}",route="${esc(rest.join(' '))}"`;
        lines.push(`erp_http_requests_total{${labels},class="ok"} ${t.n - t.e4 - t.e5}`, `erp_http_requests_total{${labels},class="4xx"} ${t.e4}`, `erp_http_requests_total{${labels},class="5xx"} ${t.e5}`);
      }
      lines.push('# HELP erp_http_request_duration_ms Request duration in milliseconds.', '# TYPE erp_http_request_duration_ms histogram');
      for (const [key, t] of byKey) {
        const [method, ...rest] = key.split(' ');
        const labels = `method="${esc(method)}",route="${esc(rest.join(' '))}"`;
        let cumulative = 0;
        HIST_EDGES.forEach((edge, i) => {
          cumulative += t.hist[i];
          lines.push(`erp_http_request_duration_ms_bucket{${labels},le="${edge}"} ${cumulative}`);
        });
        lines.push(`erp_http_request_duration_ms_bucket{${labels},le="+Inf"} ${t.n}`, `erp_http_request_duration_ms_sum{${labels}} ${Math.round(t.sum * 100) / 100}`, `erp_http_request_duration_ms_count{${labels}} ${t.n}`);
      }
      for (const [name, value] of counters) lines.push(`# TYPE erp_${name.replace(/\W/g, '_')}_total counter`, `erp_${name.replace(/\W/g, '_')}_total ${value}`);
      for (const g of extra) lines.push(`# HELP ${g.name} ${g.help}`, `# TYPE ${g.name} gauge`, ...g.values.map((v) => `${g.name}${v.labels ? `{${Object.entries(v.labels).map(([k, x]) => `${k}="${esc(x)}"`).join(',')}}` : ''} ${v.value}`));
      return `${lines.join('\n')}\n`;
    },
  };
  return metrics;
}

/** The process-wide metrics registry. */
export const metrics = createMetrics();
