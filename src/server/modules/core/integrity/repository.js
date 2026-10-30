import { likePattern, orderBySql } from '../../../platform/pagination/index.js';

const SORT_COLUMNS = { run_at: 'run_at', check_code: 'check_code', status: 'status', severity: 'severity' };
const COLUMNS = 'id, run_id, run_at, check_code, severity, status, failures_count, checked_count, sample_json, duration_ms, triggered_by';

/** Data access for core_integrity_runs: one row per check per run. */
export function createIntegrityRepository(db) {
  return {
    insertResult(run, result, actor) {
      db.prepare(
        `INSERT INTO core_integrity_runs (run_id, run_at, check_code, severity, status, failures_count, checked_count, sample_json, duration_ms, triggered_by, created_by, source_type)
         VALUES (:runId, :runAt, :code, :severity, :status, :failures, :checked, :samples, :durationMs, :actor, :actor, 'integrity_run')`,
      ).run({
        runId: run.runId,
        runAt: run.runAt,
        code: result.code,
        severity: result.severity,
        status: result.status,
        failures: result.failures,
        checked: result.checked,
        samples: JSON.stringify(result.samples),
        durationMs: result.durationMs,
        actor,
      });
    },

    latestRunId() {
      return db.prepare('SELECT run_id FROM core_integrity_runs WHERE is_active = 1 ORDER BY run_at DESC, id DESC LIMIT 1').get()?.run_id ?? null;
    },

    rowsForRun(runId) {
      return db.prepare(`SELECT ${COLUMNS} FROM core_integrity_runs WHERE run_id = ? AND is_active = 1 ORDER BY id`).all(runId);
    },

    listPage({ q, sort, filters, limit, offset }) {
      let where = "is_active = 1 AND check_code LIKE :q ESCAPE '\\'";
      const params = { q: likePattern(q) };
      for (const col of ['check_code', 'status', 'severity']) {
        if (filters[col]) {
          where += ` AND ${col} = :${col}`;
          params[col] = filters[col];
        }
      }
      const total = db.prepare(`SELECT COUNT(*) AS n FROM core_integrity_runs WHERE ${where}`).get(params).n;
      const order = orderBySql(sort, SORT_COLUMNS, 'id DESC') || 'ORDER BY run_at DESC, id DESC';
      const rows = db.prepare(`SELECT ${COLUMNS} FROM core_integrity_runs WHERE ${where} ${order} LIMIT :limit OFFSET :offset`).all({ ...params, limit, offset });
      return { rows, total };
    },
  };
}
