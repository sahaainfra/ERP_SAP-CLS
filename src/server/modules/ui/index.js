import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { lookupRegistry, lookupRoutes } from '../../platform/lookups/index.js';
import { createFlagService } from '../core/api.js';
import { createDraftService } from './drafts.js';
import { createFormService } from './forms.js';
import { formRoutes, listRoutes, uiRoutes } from './routes.js';
import { createExportService, createSavedViewService, describeFor } from './lists.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createSampleRequestService } from './sample-requests.js';
import { createUiService } from './service.js';

// Part 03.01: events this module publishes.
/** @type {any} */
const schema = { type: 'object', properties: { theme: { type: 'string' }, density: { type: 'string' }, language: { type: 'string' } }, required: ['theme'] };
eventTypes.define({ type: 'ui.preferences.changed', version: 1, schema, owner: 'ui', description: 'A person changed their theme, density, language or other screen preferences.' });
integrityRegistry.register({ uniqueKeys: [{ table: 'ui_user_preferences', columns: ['company_id', 'user_ref'] }] });
// Part 03.02: the reference form's events and keys.
/** @type {any} */
const requestSchema = { type: 'object', properties: { total: { type: 'string' }, lines: { type: 'number' } } };
for (const [verb, description] of [['created', 'A sample material request was saved as a draft.'], ['updated', 'A draft sample material request was changed.'], ['submitted', 'A sample material request was submitted and numbered.'], ['cancelled', 'A sample material request was cancelled; it keeps its number.']]) {
  eventTypes.define({ type: `ui.sample_request.${verb}`, version: 1, schema: requestSchema, owner: 'ui', description });
}
// Part 03.03: saved views and list exports.
/** @type {any} */
const listEventSchema = { type: 'object', properties: { list: { type: 'string' } }, required: ['list'] };
eventTypes.define({ type: 'ui.saved_view.changed', version: 1, schema: listEventSchema, owner: 'ui', description: 'A saved list view was created, changed or deleted.' });
eventTypes.define({ type: 'ui.export.completed', version: 1, schema: listEventSchema, owner: 'ui', description: 'A background export of a list finished; the file is under My Exports.' });
integrityRegistry.register({ statuses: { ui_export_jobs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'] } });
integrityRegistry.register({
  companyOptional: ['ui_form_metadata'], // a shared definition has no company; a company-specific version would
  statuses: { ui_form_metadata: ['ACTIVE', 'RETIRED'], ui_sample_requests: ['DRAFT', 'SUBMITTED', 'CANCELLED'] },
  headerLines: [{ header: 'ui_sample_requests', line: 'ui_sample_request_lines', lineKey: 'request_id', headerTotal: 'total_amount', lineAmount: 'line_amount' }],
});

/** Module "ui": the design system's server side, screen preferences, the style guide and the data-entry framework. */
export const ui = {
  code: 'ui',
  name: 'Design System, Application Shell & UX Framework',
  routePrefix: '/api/v1/ui',
  ownerPart: '03.x',
  status: 'Design tokens, themes, typography and iconography (03.01); form components and data-entry framework (03.02); data table and List Report (03.03)',
  tables: ['ui_user_preferences', 'ui_drafts', 'ui_form_metadata', 'ui_sample_requests', 'ui_sample_request_lines', 'ui_saved_views', 'ui_export_jobs'],
  resources: ['preferences', 'style-guide', 'drafts', 'forms', 'form-registry', 'duplicate-check', 'create-from', 'sample-requests', 'lists', 'saved-views', 'exports'],

  mount(api, { db, config, storagePath }) {
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const router = Router();
    router.use(['/preferences', '/style-guide'], gate('ff.ui.p0301', 'Screen preferences and the style guide are'));
    router.use(uiRoutes(createUiService({ db, config })));
    const drafts = createDraftService({ db });
    const requests = createSampleRequestService({ db, drafts });
    const idempotentRequired = idempotency(db, { required: true });
    // Part 03.03: the List Report's routes come first, so /sample-requests/export is not read as a record id.
    const migrated = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_export_jobs'").get());
    const runtime = runtimeOf(db);
    const exports = createExportService({ db, storagePath: storagePath ?? 'data', jobs: runtime.jobs });
    exports.register('ui.sample_requests', (actor, req) => requests.exportSource(actor, req));
    if (migrated) {
      runtime.jobs.register('ui.export', (ctx) => exports.run(ctx.params.exportId, (m) => ctx.log(m)), { maxAttempts: 2, description: 'Writes a large list export in the background; the file appears under My Exports.' });
      runtime.jobs.register('ui.export_purge', (ctx) => { const r = exports.purge(); ctx.log(`Removed ${r.expired} expired export file(s)`); return r; }, { maxAttempts: 1, description: 'Removes list exports older than 7 days.' });
      runtime.scheduler.define({ code: 'ui.export_purge_daily', cron: '15 1 * * *', jobType: 'ui.export_purge', description: 'Daily removal of expired list exports (01:15 IST)' });
    }
    const hidden = { 'ui.sample_requests': (actor) => requests.maskedColumns(actor) };
    const lists = Router();
    lists.use(['/lists', '/saved-views', '/exports', '/sample-requests/export', '/sample-requests/bulk'], gate('ff.ui.p0303', 'Saved views, list exports and bulk actions are'));
    lists.use(listRoutes({ views: createSavedViewService({ db }), exports, requests, describe: (actor, code) => describeFor(actor, code, hidden[code]) }, { idempotentRequired }));
    router.use(lists);
    const framework = Router();
    framework.use(gate('ff.ui.p0302', 'Drafts, form definitions and the reference form are'));
    framework.use(formRoutes({ drafts, forms: createFormService({ db }), requests }, { idempotent: idempotency(db), idempotentRequired }));
    router.use(framework);
    api.use('/ui', router);
    // The generic lookup contract, GET /api/v1/<module>/lookups/<name> (part 03.02): each module registers its lookups; they are
    // served under the module's own prefix behind this part's flag.
    for (const module of lookupRegistry.modules()) {
      const lookups = Router();
      lookups.use(gate('ff.ui.p0302', 'Lookups are'));
      lookups.use(lookupRoutes(db, module));
      api.use(`/${module}/lookups`, lookups);
    }
  },
};
