import { eventTypes } from '../../platform/events/index.js';
import { recordRun } from './integrity/service.js';
import { integrityRegistry, runChecks } from '../../platform/integrity/index.js';

// Part 01.04: the event catalogue this module owns, and the consumers, job types and schedules it registers on the
// shared bus, job runner and scheduler (platform/runtime). Other modules do the same for their own events.

const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = { type: 'string' };
/** @type {[string, string, any][]} */
const CORE_EVENTS = [
  ['core.change_request.submitted', 'An approval request was raised.', obj({ type: str, targetType: str }, ['type'])],
  ['core.company_settings.changed', 'The company settings were saved.', obj({ currency: str })],
  ['core.document_type.created', 'A document type was added.', obj()],
  ['core.document_type.changed', 'A document type was changed.', obj()],
  ['core.feature_flag.changed', 'A feature flag value was changed.', obj()],
  ['core.financial_year.created', 'A financial year and its periods were created.', obj()],
  ['core.financial_year.closed', 'A financial year was closed.', obj()],
  ['core.holiday_calendar.created', 'A holiday calendar was added.', obj()],
  ['core.holiday_calendar.imported', 'Holidays were imported into a calendar.', obj()],
  ['core.integrity_run.completed', 'A data-integrity run finished.', obj()],
  ['core.number_series.created', 'A numbering series was added.', obj()],
  ['core.number_series.changed', 'A numbering series was changed.', obj()],
  ['core.parameter.changed', 'A parameter value was set.', obj()],
  ['core.period.status_changed', 'A period status changed for a module.', obj()],
  ['core.period.reopened', 'A closed period was reopened after approval.', obj()],
  ['core.sample_document.created', 'A sample document was created.', obj()],
  ['core.sample_document.submitted', 'A sample document was submitted.', obj()],
  ['core.sample_document.cancelled', 'A sample document was cancelled.', obj()],
  ['core.job.completed', 'A background job finished successfully.', obj({ jobType: str }, ['jobType'])],
  ['core.job.failed', 'A background job failed after its last attempt.', obj({ jobType: str, error: str }, ['jobType', 'error'])],
  ['core.schedule.changed', 'A schedule was changed after approval.', obj({ code: str, cron: str, enabled: { type: 'boolean' } }, ['code', 'cron'])],
  ['core.event.dead_lettered', 'A consumer gave up on an event after its last attempt.', obj({ consumer: str, eventId: str, error: str }, ['consumer', 'eventId'])],
  ['core.event.redriven', 'An administrator put a dead letter back in the queue.', obj({ consumer: str, eventId: str }, ['consumer', 'eventId'])],
  ['core.event.discarded', 'An administrator discarded a dead letter.', obj({ consumer: str, eventId: str }, ['consumer', 'eventId'])],
];
for (const [type, description, schema] of CORE_EVENTS) eventTypes.define({ type, version: 1, schema, owner: 'core', description });

export const CORE_EVENT_TYPES = CORE_EVENTS.map(([type]) => type);

/** The consumer that keeps a read model of how many events of each type each company raised for sample documents. */
export const PROJECTION_CONSUMER = 'core.projection.event_counts';

export function registerOperations({ db, bus, jobs, scheduler, persist = true }) {
  bus.subscribe(
    'core.sample_document.*',
    (event, { db: tx }) => {
      tx.prepare(
        `INSERT INTO core_projection_event_counts (company_id, event_type, total, last_event_at) VALUES (?, ?, 1, ?)
         ON CONFLICT (company_id, event_type) DO UPDATE SET total = total + 1, last_event_at = MAX(COALESCE(last_event_at, ''), excluded.last_event_at)`,
      ).run(event.companyId ?? 0, event.type, event.occurredAt);
    },
    { consumer: PROJECTION_CONSUMER, reset: (tx) => tx.exec('DELETE FROM core_projection_event_counts') },
  );

  jobs.register(
    'core.event_replay',
    (ctx) => {
      const { types, from, to, consumer, reset, companyId } = ctx.params;
      ctx.log(`Replaying ${[].concat(types ?? '*').join(', ')} from ${from ?? 'the start'} to ${to ?? 'now'}${consumer ? ` for ${consumer}` : ''}${reset ? ' (projection reset first)' : ''}`);
      const out = bus.replay({
        types: types ?? ['*'],
        from: from ?? null,
        to: to ?? null,
        consumer: consumer ?? null,
        reset: Boolean(reset),
        companyId: companyId ?? null,
        onProgress: (pct, message) => ctx.setProgress(pct, message),
        isCancelled: ctx.isCancelled,
      });
      ctx.log(`${out.events} events replayed, ${out.deliveries} deliveries${out.cancelled ? ', stopped by cancellation' : ''}`);
      return out;
    },
    { maxAttempts: 1, description: 'Re-run past events through consumers to rebuild a projection. Side effects are suppressed.' },
  );

  jobs.register(
    'core.housekeeping',
    (ctx) => {
      const now = new Date();
      const iso = (ms) => new Date(now.getTime() - ms).toISOString();
      const keys = db.prepare('DELETE FROM core_idempotency_keys WHERE expires_at < ?').run(now.toISOString()).changes;
      ctx.setProgress(40, 'Expired idempotency keys removed');
      const inbox = db.prepare("DELETE FROM core_inbox WHERE status = 'PROCESSED' AND processed_at < ?").run(iso(30 * 86_400_000)).changes;
      ctx.setProgress(70, 'Old processed inbox rows removed');
      const finished = db.prepare("DELETE FROM core_jobs WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED') AND finished_at < ?").run(iso(90 * 86_400_000)).changes;
      ctx.log(`Removed ${keys} expired idempotency keys, ${inbox} processed inbox rows older than 30 days and ${finished} finished jobs older than 90 days`);
      return { keys, inbox, finished };
    },
    { maxAttempts: 2, description: 'Removes expired idempotency keys, processed inbox rows after 30 days and finished jobs after 90 days. The outbox is never purged: it is the replay history.' },
  );

  jobs.register(
    'core.integrity_run',
    (ctx) => {
      const run = runChecks(db, { registry: integrityRegistry });
      recordRun(db, run, { actor: 'scheduler' });
      ctx.log(`${run.summary.fail} failing checks of ${run.results.length}`);
      return run.summary;
    },
    { maxAttempts: 2, description: 'Runs the data-integrity checks and records the result (the Data Health page shows it).' },
  );

  if (!persist) return;
  scheduler.define({ code: 'core.integrity_nightly', cron: '30 1 * * *', jobType: 'core.integrity_run', description: 'Nightly data-integrity checks (01:30 IST)' });
  scheduler.define({ code: 'core.housekeeping_daily', cron: '0 3 * * *', jobType: 'core.housekeeping', description: 'Daily clean-up of expired technical rows (03:00 IST)' });
}
