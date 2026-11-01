import { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { lookupRegistry, lookupRoutes } from '../../platform/lookups/index.js';
import { createFlagService } from '../core/api.js';
import { createDraftService } from './drafts.js';
import { createFormService } from './forms.js';
import { dashboardRoutes, deviceRoutes, formRoutes, listRoutes, objectRoutes, shellRoutes, uiRoutes } from './routes.js';
import { createWidgetService, dashboardHandlers } from './widgets.js';
import { registerWidgetProviders } from './widget-providers.js';
import { createDeviceService } from './device.js';
import { loadVapid, sendPush } from '../../platform/push/index.js';
import { createShellService, navHandlers } from './shell.js';
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
// Part 03.05: the navigation registry's events.
/** @type {any} */
const navSchema = { type: 'object', properties: { code: { type: 'string' }, fields: { type: 'array' }, request: { type: 'number' } }, required: ['code'] };
eventTypes.define({ type: 'ui.navigation.changed', version: 1, schema: navSchema, owner: 'ui', description: 'A navigation registry entry was changed after another administrator approved the request.' });
// Part 03.07: the providers of the widgets of this module, the target of the timeliness gauge and the dashboard event.
registerWidgetProviders();
/** @type {any} */
const dashboardSchema = { type: 'object', properties: { code: { type: 'string' }, role: { type: 'string' }, removed: { type: 'boolean' } }, required: ['code'] };
eventTypes.define({ type: 'ui.dashboard.changed', version: 1, schema: dashboardSchema, owner: 'ui', description: 'The default dashboard of a role was set, changed or removed after another administrator approved the request.' });
parameterRegistry.define({ key: 'ui.widget.timeliness_target', dataType: 'integer', default: 90, min: 50, max: 100, scopes: ['system', 'company'], description: 'The share (percent) of approvals that should be decided within the allowed time; the gauge on the dashboards turns amber under it and red well under it.' });
// Part 03.06: the camera's limits and the push subscription event.
/** @type {any} */
const pushSchema = { type: 'object', properties: { change: { type: 'string' } }, required: ['change'] };
eventTypes.define({ type: 'ui.push_subscription.changed', version: 1, schema: pushSchema, owner: 'ui', description: 'A person subscribed a device to push notifications or removed one.' });
for (const [key, def, min, max, description] of [
  ['ui.device.image_max_px', 1600, 640, 4096, 'The longest side, in pixels, a photo taken in the application is reduced to before it is uploaded. The original EXIF time and position are kept.'],
  ['ui.device.image_quality', 80, 40, 95, 'JPEG quality (percent) of a photo taken in the application.'],
  ['ui.device.low_bandwidth_image_px', 1024, 480, 2048, 'The longest side, in pixels, of a photo when the device is in low-bandwidth mode (data saver or a slow connection).'],
  ['ui.device.low_bandwidth_quality', 60, 30, 90, 'JPEG quality (percent) of a photo in low-bandwidth mode.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
parameterRegistry.define({ key: 'ui.approval.sla_hours', dataType: 'integer', default: 24, min: 1, max: 720, scopes: ['system', 'company'], description: 'Hours an approver has for one step of an approval before it shows as overdue on the Object Page.' });
integrityRegistry.register({ statuses: { ui_export_jobs: ['QUEUED', 'RUNNING', 'DONE', 'FAILED', 'EXPIRED'] } });
integrityRegistry.register({
  companyOptional: ['ui_form_metadata', 'ui_reason_codes', 'ui_required_documents', 'ui_navigation_entries', 'ui_field_tiles', 'ui_widgets', 'ui_dashboards'], // the shared definitions, reasons and requirements have no company; a company's own would
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
  tables: ['ui_user_preferences', 'ui_drafts', 'ui_form_metadata', 'ui_sample_requests', 'ui_sample_request_lines', 'ui_saved_views', 'ui_export_jobs', 'ui_record_comments', 'ui_record_versions', 'ui_reason_codes', 'ui_required_documents', 'ui_record_documents', 'ui_navigation_entries', 'ui_favourites', 'ui_recent_records', 'ui_user_context', 'ui_push_subscriptions', 'ui_field_tiles', 'ui_widgets', 'ui_dashboards'],
  resources: ['preferences', 'style-guide', 'drafts', 'forms', 'form-registry', 'duplicate-check', 'create-from', 'sample-requests', 'lists', 'saved-views', 'exports', 'objects', 'reason-codes', 'navigation', 'favourites', 'recent', 'context-options', 'context', 'launchpad', 'bell', 'device-settings', 'push-subscriptions', 'qr', 'widgets', 'dashboards'],

  mount(api, { db, config, storagePath }) {
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const router = Router();
    router.use(['/preferences', '/style-guide'], gate('ff.ui.p0301', 'Screen preferences and the style guide are'));
    router.use(uiRoutes(createUiService({ db, config })));
    const drafts = createDraftService({ db });
    const approvals = createApprovalEngine({ db, handlers: { ...sampleRequestHandlers, ...navHandlers, ...dashboardHandlers } });
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
    // Part 03.05: the application shell's routes.
    const shellRouter = Router();
    shellRouter.use(['/navigation', '/favourites', '/recent', '/context-options', '/context', '/launchpad', '/bell'], gate('ff.ui.p0305', 'The application shell is'));
    const shell = createShellService({ db, flags, approvals });
    shellRouter.use(shellRoutes(shell, { idempotent: idempotency(db) }));
    router.use(shellRouter);
    // Part 03.07: widgets and dashboards.
    const dashboardRouter = Router();
    dashboardRouter.use(['/widgets', '/dashboards'], gate('ff.ui.p0307', 'Dashboards and widgets are'));
    dashboardRouter.use(dashboardRoutes(createWidgetService({ db, approvals, shell }), { idempotent: idempotency(db) }));
    router.use(dashboardRouter);
    // Part 03.06: camera settings, push subscriptions and the QR resolver.
    const vapid = loadVapid({ config, dir: storagePath ?? config.storagePath ?? 'data' });
    const pushService = vapid ? { vapid, send: (sub, message) => sendPush(sub, message, { vapid }) } : null;
    const allowHosts = config.environment === 'test' ? String(process.env.PUSH_ALLOW_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean) : [];
    const deviceRouter = Router();
    deviceRouter.use(['/device-settings', '/push', '/push-subscriptions', '/qr'], gate('ff.ui.p0306', 'Device capabilities are'));
    deviceRouter.use(deviceRoutes(createDeviceService({ db, push: pushService, allowHosts }), { idempotent: idempotency(db) }));
    router.use(deviceRouter);
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
