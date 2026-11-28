import express, { Router } from 'express';
import { eventTypes } from '../../platform/events/index.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { lookupRegistry, lookupRoutes } from '../../platform/lookups/index.js';
import { createFlagService } from '../core/api.js';
import { createDraftService } from './drafts.js';
import { createFormService } from './forms.js';
import { pageMigrationRoutes, translationRoutes } from './routes.js';
import { createPageMigrationService, pageRouteHandlers } from './page-migration.js';
import { createTranslationService, translationHandlers } from './translations.js';
import { dashboardRoutes, deviceRoutes, formRoutes, listRoutes, objectRoutes, searchRoutes, shellRoutes, uiRoutes } from './routes.js';
import { createFieldToday } from './field-today.js';
import { createWidgetService, dashboardHandlers } from './widgets.js';
import { registerWidgetProviders } from './widget-providers.js';
import { registerOverviewProviders } from './overviews.js';
import { createDocFlowService } from './docflow.js';
import { parseDocFlow } from './validators.js';
import { createDeviceService } from './device.js';
import { loadVapid, sendPush } from '../../platform/push/index.js';
import { createShellService, navHandlers } from './shell.js';
import { createExportService, createSavedViewService, describeFor } from './lists.js';
import { bindListExports, listExports } from '../../platform/list/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { createObjectService } from './objects.js';
import { createSampleRequestService } from './sample-requests.js';
import { sampleRequestHandlers } from './sample-request-object.js';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { createUiService } from './service.js';
import { searchEntities } from '../../platform/search/registry.js';
import { createParameterStore } from '../../platform/parameters/index.js';
import { RECONCILE_JOB, REINDEX_JOB, createSearchApi } from './search.js';
import './search-entities.js';
import './search-commands.js';

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
registerOverviewProviders(); // the cards of the overview pages (part 166.5)
/** @type {any} */
const dashboardSchema = { type: 'object', properties: { code: { type: 'string' }, role: { type: 'string' }, removed: { type: 'boolean' } }, required: ['code'] };
eventTypes.define({ type: 'ui.dashboard.changed', version: 1, schema: dashboardSchema, owner: 'ui', description: 'The default dashboard of a role was set, changed or removed after another administrator approved the request.' });
parameterRegistry.define({ key: 'ui.widget.timeliness_target', dataType: 'integer', default: 90, min: 50, max: 100, scopes: ['system', 'company'], description: 'The share (percent) of approvals that should be decided within the allowed time; the gauge on the dashboards turns amber under it and red well under it.' });
// Part 03.08: global search. Its events, its parameters and (below, in mount) its consumer, jobs and routes.
/** @type {any} */
const searchSchema = { type: 'object', properties: { types: { type: 'array' } }, required: ['types'] };
eventTypes.define({ type: 'ui.search.reindex_requested', version: 1, schema: searchSchema, owner: 'ui', description: 'An administrator asked for the search index of a type of record (or all) to be rebuilt.' });
eventTypes.define({ type: 'ui.search.reindexed', version: 1, schema: searchSchema, owner: 'ui', description: 'The search index of a type of record (or all) was rebuilt from its source.' });
for (const [key, def, min, max, description] of [
  ['ui.search.min_query_length', 2, 1, 5, 'The fewest letters a search needs before it looks for words inside records; a shorter search finds only titles and codes that start with it.'],
  ['ui.search.results_per_group', 5, 1, 10, 'How many results of each kind the command palette shows before "show all".'],
  ['ui.search.retention_days', 90, 7, 730, 'Days the text people searched for is kept for the search analytics, then removed.'],
]) parameterRegistry.define({ key, dataType: 'integer', default: def, min, max, scopes: ['system', 'company'], description });
// Part 03.09: localisation. Its events, parameters and (in mount) routes.
/** @type {any} */
const translationSchema = { type: 'object', properties: { changes: { type: 'number' }, languages: { type: 'array' } }, required: ['changes'] };
eventTypes.define({ type: 'ui.translation.changed', version: 1, schema: translationSchema, owner: 'ui', description: 'The wording of one or more texts of the screens was changed after another administrator approved the request.' });
/** @type {any} */
const localeSchema = { type: 'object', properties: { numberStyle: { type: 'string' }, timeFormat: { type: 'string' } }, required: ['numberStyle', 'timeFormat'] };
eventTypes.define({ type: 'ui.locale.changed', version: 1, schema: localeSchema, owner: 'ui', description: 'A person changed their number grouping or hour format.' });
parameterRegistry.define({ key: 'ui.locale.number_style', dataType: 'string', default: 'indian', allowed: ['indian', 'international'], scopes: ['system', 'company'], description: 'How amounts are grouped when a person has not chosen: "indian" (12,34,56,789.00) or "international" (123,456,789.00).' });
parameterRegistry.define({ key: 'ui.locale.time_format', dataType: 'string', default: '24', allowed: ['12', '24'], scopes: ['system', 'company'], description: 'The hour format when a person has not chosen: 24 (14:05) or 12 (2:05 PM).' });
// Part 03.10: the screen migration tracker's event.
/** @type {any} */
const migrationSchema = { type: 'object', properties: { code: { type: 'string' }, change: { type: 'string' } }, required: ['code', 'change'] };
eventTypes.define({ type: 'ui.page_migration.changed', version: 1, schema: migrationSchema, owner: 'ui', description: 'A page of the application was migrated, verified, reopened or scheduled, a defect was raised or resolved on it, or its old address was registered.' });
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
// Part 03.08: the full-text indexes are the engine's own tables (and their shadow tables), not business records.
integrityRegistry.register({ technicalTables: ['core_search_fts', 'core_search_fts_data', 'core_search_fts_idx', 'core_search_fts_docsize', 'core_search_fts_config', 'core_search_secret', 'core_search_secret_data', 'core_search_secret_idx', 'core_search_secret_docsize', 'core_search_secret_config', 'core_search_secret_content'] });
integrityRegistry.register({
  companyOptional: ['ui_page_migration', 'ui_form_metadata', 'ui_reason_codes', 'ui_required_documents', 'ui_navigation_entries', 'ui_field_tiles', 'ui_widgets', 'ui_dashboards', 'core_search_index', 'core_search_queries', 'ui_translations', 'ui_locale_preferences', 'ui_page_migration', 'ui_navigation_labels', 'ui_field_tile_rules', 'ui_bottom_bar'], // the shared definitions, reasons and requirements have no company; a company's own would
  statuses: { ui_page_migration: ['NOT_STARTED', 'MIGRATED', 'VERIFIED', 'SCHEDULED'], ui_form_metadata: ['ACTIVE', 'RETIRED'], ui_sample_requests: ['DRAFT', 'SUBMITTED', 'CANCELLED'] },
  headerLines: [{ header: 'ui_sample_requests', line: 'ui_sample_request_lines', lineKey: 'request_id', headerTotal: 'total_amount', lineAmount: 'line_amount' }],
});

/** Module "ui": the design system's server side, screen preferences, the style guide and the data-entry framework. */
export const ui = {
  code: 'ui',
  name: 'Design System, Application Shell & UX Framework',
  routePrefix: '/api/v1/ui',
  ownerPart: '03.x',
  status: 'Design tokens, themes, typography and iconography (03.01); form components and data-entry framework (03.02); data table and List Report (03.03)',
  tables: ['ui_user_preferences', 'ui_drafts', 'ui_form_metadata', 'ui_sample_requests', 'ui_sample_request_lines', 'ui_saved_views', 'ui_export_jobs', 'ui_record_comments', 'ui_record_versions', 'ui_reason_codes', 'ui_required_documents', 'ui_record_documents', 'ui_navigation_entries', 'ui_favourites', 'ui_recent_records', 'ui_user_context', 'ui_context_recent', 'ui_push_subscriptions', 'ui_field_tiles', 'ui_widgets', 'ui_dashboards', 'core_search_index', 'core_search_queries', 'ui_navigation_labels', 'ui_field_tile_rules', 'ui_bottom_bar'],
  resources: ['preferences', 'style-guide', 'drafts', 'forms', 'form-registry', 'duplicate-check', 'create-from', 'sample-requests', 'lists', 'saved-views', 'exports', 'objects', 'reason-codes', 'navigation', 'favourites', 'recent', 'context-options', 'context', 'launchpad', 'bell', 'device-settings', 'push-subscriptions', 'qr', 'widgets', 'dashboards', 'search', 'translations', 'locale-preferences', 'page-migration'],

  mount(api, { db, config, storagePath }) {
    const flags = createFlagService({ db, environment: config.environment });
    const gate = (key, what) => (req, _res, next) => (flags.isOn(req.actor, key) ? next() : next(notFound(`${what} not enabled for your company yet (feature flag ${key} is OFF).`)));
    const router = Router();
    router.use(['/preferences', '/style-guide'], gate('ff.ui.p0301', 'Screen preferences and the style guide are'));
    router.use(uiRoutes(createUiService({ db, config })));
    const drafts = createDraftService({ db });
    const approvals = createApprovalEngine({ db, handlers: { ...sampleRequestHandlers, ...navHandlers, ...dashboardHandlers, ...translationHandlers, ...pageRouteHandlers } });
    const objects = createObjectService({ db, approvals });
    const requests = createSampleRequestService({ db, drafts, approvals, objects });
    const idempotentRequired = idempotency(db, { required: true });
    // Part 03.03: the List Report's routes come first, so /sample-requests/export is not read as a record id.
    const migrated = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ui_export_jobs'").get());
    const runtime = runtimeOf(db);
    const exports = createExportService({ db, storagePath: storagePath ?? 'data', jobs: runtime.jobs, devHeaders: config.authMode === 'dev-headers' });
    exports.register('ui.sample_requests', (actor, req) => requests.exportSource(actor, req));
    bindListExports(db, exports);
    if (migrated) {
      runtime.jobs.register('ui.export', (ctx) => exports.run(ctx.params.exportId, (m) => ctx.log(m), { final: ctx.attempt >= ctx.maxAttempts }), { maxAttempts: 2, description: 'Writes a large list export in the background; the file appears under My Exports.' });
      runtime.jobs.register('ui.export_purge', (ctx) => { const r = exports.purge(); ctx.log(`Removed ${r.expired} expired export file(s)`); return r; }, { maxAttempts: 1, description: 'Removes list exports older than 7 days.' });
      runtime.scheduler.define({ code: 'ui.export_purge_daily', cron: '15 1 * * *', jobType: 'ui.export_purge', description: 'Daily removal of expired list exports (01:15 IST)' });
    }
    const hidden = { 'ui.sample_requests': (actor) => requests.maskedColumns(actor) };
    const lists = Router();
    lists.use(['/lists', '/saved-views', '/exports', '/sample-requests/export', '/sample-requests/bulk'], gate('ff.ui.p0303', 'Saved views, list exports and bulk actions are'));
    lists.use(listRoutes({ views: createSavedViewService({ db }), exports, requests, describe: (actor, code) => ({ ...describeFor(actor, code, hidden[code] ?? listExports.hidden(code) ?? undefined), exportable: exports.has(code) }) }, { idempotentRequired }));
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
    // Part 166.3: what waits for a site person today (the Field Home's task cards).
    const fieldRouter = Router();
    const fieldToday = createFieldToday({ db, approvals });
    fieldRouter.use('/field', gate('ff.field.p16603', 'The mobile site app is'));
    fieldRouter.get('/field/today', (req, res) => res.json({ data: fieldToday.today(req.actor) }));
    router.use(fieldRouter);
    // Part 166.7, FR-03: the document flow of a document (rights checked in the service, node by node)
    const flowRouter = Router();
    const docflow = createDocFlowService({ db });
    flowRouter.use('/doc-flow', gate('ff.ui.p16607', 'The document flow is'));
    flowRouter.get('/doc-flow', (req, res) => res.json({ data: docflow.flow(req.actor, parseDocFlow(req.query)) }));
    router.use(flowRouter);
    // Part 03.07: widgets and dashboards.
    const dashboardRouter = Router();
    dashboardRouter.use(['/widgets', '/dashboards'], gate('ff.ui.p0307', 'Dashboards and widgets are'));
    dashboardRouter.use(dashboardRoutes(createWidgetService({ db, approvals, shell }), { idempotent: idempotency(db) }));
    router.use(dashboardRouter);
    // Part 03.10: the migration tracker and the redirects of old addresses.
    const migrationRouter = Router();
    migrationRouter.use('/page-migration', gate('ff.ui.p0310', 'The screen migration tracker is'));
    migrationRouter.use(pageMigrationRoutes(createPageMigrationService({ db, approvals }), { idempotent: idempotency(db) }));
    router.use(migrationRouter);
    // Part 03.09: the text of the screens, wording overrides and number formats.
    const localeRouter = Router();
    localeRouter.use(['/translations', '/locale-preferences'], gate('ff.ui.p0309', 'Translations and number formats are'));
    localeRouter.use(translationRoutes(createTranslationService({ db, approvals }), { idempotent: idempotency(db), xlsxBody: express.raw({ type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'], limit: '4mb' }) }));
    router.use(localeRouter);
    // Part 03.08: global search and the command palette.
    const searchReady = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_search_index'").get());
    const searchApi = createSearchApi({ db, flags, runtime });
    if (searchReady) {
      runtime.bus.subscribe(searchEntities.eventPatterns(), (event) => searchApi.index.onEvent(event), { consumer: 'ui.search_index', reset: () => searchApi.index.clear() });
      runtime.jobs.register(REINDEX_JOB, (ctx) => searchApi.runReindex(ctx), { maxAttempts: 1, description: 'Rebuilds the search index of a type of record from its source, with progress.' });
      runtime.jobs.register(RECONCILE_JOB, (ctx) => { const r = searchApi.index.reconcile(); ctx.log(`Checked ${r.checked}, indexed ${r.indexed}, removed ${r.removed}`); return r; }, { maxAttempts: 2, description: 'Indexes the records that changed or appeared without an event, and drops the ones that are gone.' });
      runtime.jobs.register('ui.search_purge', (ctx) => {
        let removed = 0;
        for (const c of db.prepare('SELECT id FROM org_companies').all()) removed += searchApi.index.purgeQueries(Number(createParameterStore(db).get('ui.search.retention_days', { companyId: c.id, date: new Date().toISOString().slice(0, 10) })));
        ctx.log(`Removed ${removed} old search(es)`);
        return { removed };
      }, { maxAttempts: 1, description: 'Removes the text of searches older than the retention period.' });
      runtime.scheduler.define({ code: 'ui.search_reconcile_5min', cron: '*/5 * * * *', jobType: RECONCILE_JOB, description: 'Every five minutes: index what changed without an event' });
      runtime.scheduler.define({ code: 'ui.search_purge_daily', cron: '30 1 * * *', jobType: 'ui.search_purge', description: 'Daily removal of old search text (01:30 IST)' });
      // a first build for records that existed before search did, without holding up the start
      if (config.environment !== 'test' && searchEntities.list().some((d) => searchApi.index.stale(d.type, 1).length > 0) && !db.prepare("SELECT 1 FROM core_jobs WHERE type = ? AND status IN ('QUEUED', 'RUNNING')").get(RECONCILE_JOB)) runtime.jobs.enqueue(RECONCILE_JOB, {}, { createdBy: 'system' });
    }
    const searchRouter = Router();
    searchRouter.use('/search', gate('ff.ui.p0308', 'Search and the command palette are'));
    searchRouter.use(searchRoutes(searchApi, { shell, idempotent: idempotency(db) }));
    router.use(searchRouter);
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
