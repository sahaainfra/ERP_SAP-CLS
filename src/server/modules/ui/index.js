import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { lookupRegistry, lookupRoutes } from '../../platform/lookups/index.js';
import { createFlagService } from '../core/api.js';
import { createDraftService } from './drafts.js';
import { createFormService } from './forms.js';
import { formRoutes, listRoutes, objectRoutes, uiRoutes } from './routes.js';
import { createExportService, createSavedViewService, describeFor } from './lists.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createObjectService } from './objects.js';
import { createSampleRequestService } from './sample-requests.js';
import { sampleRequestHandlers } from './sample-request-object.js';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
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
// Part 03.04: the Object Page's events and the approval clock.
for (const [verb, description] of [['approved', 'A sample material request was approved at its last step.'], ['rejected', 'A sample material request was rejected and cancelled; it keeps its number.'], ['returned', 'A sample material request was returned to its requester as a draft.']]) {
  eventTypes.define({ type: `ui.sample_request.${verb}`, version: 1, schema: requestSchema, owner: 'ui', description });
}
/** @type {any} */
const commentSchema = { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] };
eventTypes.define({ type: 'ui.comment.created', version: 1, schema: commentSchema, owner: 'ui', description: 'A comment was added to a record\'s discussion (people mentioned are in the data).' });
parameterRegistry.define({ key: 'ui.approval.sla_hours', dataType: 'integer', default: 24, min: 1, max: 720, scopes: ['system', 'company'], description: 'Hours an approver has for one step of an approval before it shows as overdue on the Object Page.' });
integrityRegistry.register({ statuses: { ui_export_jobs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'] } });
integrityRegistry.register({
  companyOptional: ['ui_form_metadata', 'ui_reason_codes', 'ui_required_documents'], // the shared definitions, reasons and requirements have no company; a company's own would
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
  tables: ['ui_user_preferences', 'ui_drafts', 'ui_form_metadata', 'ui_sample_requests', 'ui_sample_request_lines', 'ui_saved_views', 'ui_export_jobs', 'ui_record_comments', 'ui_record_versions', 'ui_reason_codes', 'ui_required_documents', 'ui_record_documents'],
  resources: ['preferences', 'style-guide', 'drafts', 'forms', 'form-registry', 'duplicate-check', 'create-from', 'sample-requests', 'lists', 'saved-views', 'exports', 'objects', 'reason-codes'],

  mount(api, { db, config, storagePath }) {
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const router = Router();
    router.use(['/preferences', '/style-guide'], gate('ff.ui.p0301', 'Screen preferences and the style guide are'));
    router.use(uiRoutes(createUiService({ db, config })));
    const drafts = createDraftService({ db });
    const approvals = createApprovalEngine({ db, handlers: sampleRequestHandlers });
    const objects = createObjectService({ db, approvals });
    const requests = createSampleRequestService({ db, drafts, approvals, objects });
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
    // Part 03.04: the Object Page's routes (the record's own GET and actions are under /sample-requests).
    const objectsRouter = Router();
    objectsRouter.use(['/objects', '/reason-codes', '/sample-requests/:id/decision'], gate('ff.ui.p0304', 'The Object Page, its approvals and discussion are'));
    objectsRouter.use(objectRoutes({ objects, reasonCodes: (actor, forAction) => objects.reasonCodes(actor, forAction) }, { idempotent: idempotency(db) }));
    router.use(objectsRouter);
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
