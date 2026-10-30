import { transaction } from '../../../platform/db/index.js';
import { writeAudit } from '../../../platform/audit/index.js';
import { publishEvent } from '../../../platform/events/index.js';
import { assertPermission } from '../../../platform/auth/index.js';
import { notFound } from '../../../platform/http/errors.js';
import { pageResponse } from '../../../platform/pagination/index.js';
import { CHECKS, integrityRegistry, runChecks } from '../../../platform/integrity/index.js';
import { createIntegrityRepository } from './repository.js';

const present = (r) => ({
  id: r.id,
  runId: r.run_id,
  runAt: r.run_at,
  code: r.check_code,
  severity: r.severity,
  status: r.status,
  failures: r.failures_count,
  checked: r.checked_count,
  samples: r.sample_json ? JSON.parse(r.sample_json) : [],
  durationMs: r.duration_ms,
  triggeredBy: r.triggered_by,
});

/**
 * Store a finished run: one row per check, an audit entry and the event `core.integrity_run.completed`,
 * all in one transaction. Used by the API and by the command-line check (which has no HTTP actor).
 */
export function recordRun(db, run, { actor, correlationId = null }) {
  const repo = createIntegrityRepository(db);
  transaction(db, () => {
    for (const result of run.results) repo.insertResult(run, result, actor);
    writeAudit(db, { entity: 'core_integrity_runs', entityId: run.runId, action: 'run', newValues: run.summary, actor, correlationId });
    publishEvent(db, { type: 'core.integrity_run.completed', entity: 'integrity_run', entityId: run.runId, actorId: actor, data: run.summary });
  });
}

/** Integrity-check service. Installation-wide; samples are identifiers only, never business amounts. */
export function createIntegrityService({ db, registry = integrityRegistry, isFlagOn = (_actor, _key) => true }) {
  const repo = createIntegrityRepository(db);
  const enabled = (actor) => {
    if (!isFlagOn(actor, 'ff.core.p0102')) throw notFound('Data Health is not enabled for your company yet (feature flag ff.core.p0102 is OFF).');
  };

  return {
    /** Run every check now and keep the result (ITADM). */
    run(actor, correlationId) {
      assertPermission(actor, 'core.integrity.run');
      enabled(actor);
      const run = runChecks(db, { registry });
      recordRun(db, run, { actor: actor.user, correlationId });
      return { runId: run.runId, runAt: run.runAt, summary: run.summary, results: run.results.map(({ description: _d, name: _n, ...r }) => r) };
    },

    /** The last run, and the list of checks (so a check that never ran is still visible). */
    summary(actor) {
      assertPermission(actor, 'core.integrity.view');
      enabled(actor);
      const runId = repo.latestRunId();
      const rows = runId ? repo.rowsForRun(runId).map(present) : [];
      const byCode = new Map(rows.map((r) => [r.code, r]));
      return {
        runId,
        runAt: rows[0]?.runAt ?? null,
        triggeredBy: rows[0]?.triggeredBy ?? null,
        checks: CHECKS.map((c) => ({ code: c.code, name: c.name, severity: c.severity, description: c.description, last: byCode.get(c.code) ?? null })),
      };
    },

    /** History: one row per check per run, newest first. */
    runs(actor, query) {
      assertPermission(actor, 'core.integrity.view');
      enabled(actor);
      const { rows, total } = repo.listPage(query);
      return pageResponse(rows.map(present), total, query);
    },
  };
}
