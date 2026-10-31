import { Router } from 'express';
import { backfillChain, hasChain } from '../../../platform/audit/index.js';
import { eventTypes } from '../../../platform/events/index.js';
import { notFound } from '../../../platform/http/errors.js';
import { parameterRegistry } from '../../../platform/parameters/index.js';
import { auditRoutes } from './routes.js';
import { createAuditService, importLegacyLoginEvents } from './service.js';

// Part 02.06: the audit trail engine and security event log. Events this module publishes:
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
eventTypes.define({ type: 'core.audit.tamper_detected', version: 1, schema: obj({ brokenSeq: { type: 'number' }, problem: { type: 'string' } }, ['brokenSeq']), owner: 'core', description: 'The nightly check found that the audit trail was changed, or that protection was removed from it.' });
parameterRegistry.define({ key: 'core.audit.retention_months', dataType: 'integer', default: 84, min: 12, max: 240, scopes: ['system', 'company'], description: 'Months the audit trail is kept. Older sealed months are marked as past retention; the application never deletes them.' });

/** Mount the audit routes (behind ff.iam.p0206), the nightly verification and the monthly sealing. */
export function mountAudit({ api, db, runtime, opts, isFlagOn, persist = true }) {
  const service = createAuditService({ db });
  if (persist && hasChain(db)) {
    // the log written before this part is chained once, in its original order, and the old sign-in failures join the security log
    db.exec('BEGIN IMMEDIATE');
    try {
      backfillChain(db);
      importLegacyLoginEvents(db);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    runtime.jobs.register('core.audit_verify', (ctx) => { const r = service.runVerification('nightly'); ctx.log(r.ok ? `Audit chain verified: ${r.checked} entries` : `AUDIT CHAIN BROKEN at ${r.brokenSeq}: ${r.problem}`); return r; }, { maxAttempts: 2, description: 'Walks the whole audit chain and records the result; a break raises a critical security event.' });
    runtime.jobs.register('core.audit_seal', (ctx) => { const r = service.sealDue(); ctx.log(`Sealed ${r.sealed.length} month(s)`); return r; }, { maxAttempts: 2, description: 'Seals each finished month of the audit trail.' });
    runtime.scheduler.define({ code: 'core.audit_verify_nightly', cron: '15 2 * * *', jobType: 'core.audit_verify', description: 'Nightly verification of the audit hash chain (02:15 IST)' });
    runtime.scheduler.define({ code: 'core.audit_seal_daily', cron: '30 2 * * *', jobType: 'core.audit_seal', description: 'Daily sealing of finished audit months (02:30 IST)' });
  }
  const router = Router();
  const mine = (req) => ['/audit', '/security-events'].some((p) => req.path === p || req.path.startsWith(`${p}/`));
  router.use((req, _res, next) => (!mine(req) || isFlagOn(req.actor, 'ff.iam.p0206') ? next() : next(notFound('The audit trail and security events are not enabled for your company yet (feature flag ff.iam.p0206 is OFF).'))));
  router.use(auditRoutes(service, opts));
  api.use('/core', router);
  return service;
}
