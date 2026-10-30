import { currentContext } from './context.js';
import { normaliseSql } from './metrics.js';

const WRAPPED = Symbol('erp.instrumented');
const TIMED = new Set(['run', 'get', 'all', 'iterate']);

/**
 * Time every prepared statement of a database (FR-02, FR-03): each run is counted, slow ones are listed with their correlation
 * ID, and inside a traced request each becomes a child span of the request. SQL text is normalised (literals become ?), so no
 * data reaches the metrics or the traces. Safe to call twice on one database.
 */
/** @param {any} db @param {{ metrics?: any, tracer?: any, slowMs?: number, spanMs?: number }} [options] */
export function instrumentDb(db, { metrics, tracer, slowMs = 100, spanMs = 0 } = {}) {
  if (db[WRAPPED]) return db;
  const prepare = db.prepare.bind(db);
  db.prepare = (sql) => {
    const statement = prepare(sql);
    return new Proxy(statement, {
      get(target, prop) {
        const value = target[prop];
        if (typeof value !== 'function') return value;
        if (typeof prop !== 'string' || !TIMED.has(prop)) return value.bind(target);
        return (...args) => {
          const started = process.hrtime.bigint();
          try {
            return value.apply(target, args);
          } finally {
            const ms = Number(process.hrtime.bigint() - started) / 1e6;
            const ctx = currentContext();
            metrics?.observeQuery({ sql, ms, correlationId: ctx?.correlationId ?? null, slowMs });
            if (tracer && ctx?.span && ms >= spanMs) {
              const span = tracer.startSpan(`db ${normaliseSql(sql).slice(0, 60)}`, { kind: 'client', attributes: { 'db.system': 'sqlite', 'db.operation': String(prop) } });
              span.startMs -= ms;
              span.end({ status: 'ok' });
              span.durationMs = ms;
            }
          }
        };
      },
    });
  };
  Object.defineProperty(db, WRAPPED, { value: true });
  return db;
}
