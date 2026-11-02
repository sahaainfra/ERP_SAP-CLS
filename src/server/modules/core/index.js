import { Router } from 'express';
import './search.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { notFound } from '../../platform/http/errors.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { createApprovalEngine } from '../../platform/approvals/index.js';
import { createParameterStore, parameterRegistry } from '../../platform/parameters/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { syncEventTypes } from '../../platform/events/index.js';
import { registerOperations } from './operations.js';
import { mountFiles } from './files/index.js';
import { mountCalc } from './calc/index.js';
import { mountOps } from './ops/index.js';
import { mountAudit } from './audit/index.js';
import { mountSecurity } from './security/index.js';
import { securityHandlers } from '../../platform/security/index.js';
import { connectorChangeHandlerFor, mountConnectors } from './connectors/index.js';
import { sampleRequestHandlers } from '../ui/sample-request-object.js';
import { navHandlers } from '../ui/shell.js';
import { dashboardHandlers } from '../ui/widgets.js';
import { translationHandlers } from '../ui/translations.js';
import { pageRouteHandlers } from '../ui/page-migration.js';
import { accessHandlers, orgHandlers, policyChangeHandlerFor, privilegedHandlers, userHandlers } from '../iam/index.js';
import { opsConfigChangeHandler } from './ops/service.js';
import { formulaActivationHandler } from './calc/service.js';
import { fileSettingsChangeHandler } from './files/service.js';
import { eventRoutes } from './events/routes.js';
import { createEventService } from './events/service.js';
import { jobRoutes } from './jobs/routes.js';
import { createJobService, createScheduleChangeHandler } from './jobs/service.js';
import { aboutRoutes } from './about/routes.js';
import { createAboutService } from './about/service.js';
import { architectureRoutes } from './architecture/routes.js';
import { createArchitectureService } from './architecture/service.js';
import { changeRequestRoutes } from './change-requests/routes.js';
import { createChangeRequestService } from './change-requests/service.js';
import { featureFlagRoutes } from './feature-flags/routes.js';
import { createFlagService } from './feature-flags/service.js';
import { financialYearRoutes } from './financial-years/routes.js';
import { createFinancialYearService, periodReopenHandler } from './financial-years/service.js';
import { holidayRoutes } from './holidays/routes.js';
import { createHolidayService } from './holidays/service.js';
import { integrityRoutes } from './integrity/routes.js';
import { createIntegrityService } from './integrity/service.js';
import { numberingRoutes } from './numbering/routes.js';
import { createNumberingService, seriesChangeHandler } from './numbering/service.js';
import { parameterRoutes } from './parameters/routes.js';
import { createParameterService } from './parameters/service.js';
import { sampleDocumentRoutes } from './sample-documents/routes.js';
import { createSampleDocumentService } from './sample-documents/service.js';
import { sessionRoutes } from './session/routes.js';
import { displaySettingsRoutes, settingsRoutes } from './settings/routes.js';
import { createSettingsService } from './settings/service.js';
import './forms.js'; // lookups and create-from for forms (part 03.02)

// Platform parameters this module owns (part 01.03). Others are defined by the modules that use them.
parameterRegistry.define({ key: 'core.session.timeout_minutes', dataType: 'integer', default: 30, min: 5, max: 480, scopes: ['system', 'company'], description: 'Minutes of inactivity before a user is signed out.' });
parameterRegistry.define({ key: 'core.export.max_rows', dataType: 'integer', default: 50000, min: 1000, max: 1_000_000, scopes: ['system', 'company'], description: 'The most rows a synchronous export may contain; larger exports run as background jobs.' });
parameterRegistry.define({ key: 'core.ui.default_page_size', dataType: 'integer', default: 25, min: 10, max: 200, scopes: ['system', 'company'], description: 'Rows per page in lists, until a user chooses another size.' });
parameterRegistry.define({ key: 'core.calendar.week_off_days', dataType: 'json', default: [0], scopes: ['system', 'company', 'site'], description: 'Weekly off days as day numbers, 0 = Sunday to 6 = Saturday.' });

// What the integrity checks need to know about this module's tables.
integrityRegistry.register({
  technicalTables: ['core_route_registry', 'core_security_settings', 'core_audit_chain', 'core_security_events', 'core_audit_verifications', 'core_audit_segments', 'core_number_counters', 'core_change_request_steps', 'core_event_types', 'core_inbox', 'core_jobs', 'core_projection_event_counts', 'core_file_uploads', 'core_calc_traces', 'core_calc_shadow_results', 'core_alerts', 'core_metric_samples', 'core_client_events', 'core_integration_logs', 'core_webhook_receipts'],
  companyOptional: ['core_feature_flags', 'core_integrity_runs', 'core_backfill_runs', 'core_document_types', 'core_parameters', 'core_schedules', 'core_formulas', 'core_uoms', 'core_uom_conversions', 'core_slo_definitions', 'core_alert_rules'],
  statuses: {
    core_integrity_runs: ['pass', 'fail', 'not_applicable'],
    core_backfill_runs: ['running', 'completed', 'failed'],
    core_financial_years: ['Open', 'Closed'],
    core_change_requests: ['SUBMITTED', 'APPROVED', 'REJECTED', 'RETURNED', 'CANCELLED'],
    core_number_issues: ['ISSUED', 'CANCELLED'],
    core_sample_documents: ['DRAFT', 'SUBMITTED', 'CANCELLED'],
    core_inbox: ['PENDING', 'PROCESSED', 'DEAD', 'DISCARDED'],
    core_jobs: ['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'],
    core_files: ['PENDING', 'CLEAN', 'INFECTED', 'ERROR'],
    core_formulas: ['DRAFT', 'SHADOW', 'ACTIVE', 'RETIRED'],
    core_sample_bills: ['DRAFT', 'SUBMITTED'],
    core_alerts: ['OPEN', 'RESOLVED'],
    core_connectors: ['PENDING', 'DISABLED', 'ENABLED'],
    core_connector_secrets: ['PENDING', 'ACTIVE', 'RETIRED'],
  },
  // A gap-free series must have no missing number, cancelled ones included.
  sequences: [{ table: 'core_number_issues', groupBy: ['series_id', 'period_key'], seq: 'seq', where: 'series_id IN (SELECT id FROM core_number_series WHERE gap_free = 1)' }],
});

/** The feature flag that hides everything this part added until an administrator turns it on for the company. */
const flagGate = (isFlagOn, key) => (req, _res, next) =>
  isFlagOn(req.actor, key) ? next() : next(notFound(`This is not enabled for your company yet (feature flag ${key} is OFF).`));

/**
 * Module "core": the reference implementation of the layered architecture
 * (route -> controller -> service -> repository). Other modules copy this shape.
 */
export const core = {
  code: 'core',
  name: 'Core Architecture & Platform Services',
  routePrefix: '/api/v1/core',
  ownerPart: '01.x',
  status: 'Reference implementation',
  tables: [
    'core_feature_flags', 'core_audit_log', 'core_route_registry', 'core_security_settings', 'core_audit_chain', 'core_security_events', 'core_audit_verifications', 'core_audit_segments', 'core_outbox', 'core_idempotency_keys', 'core_integrity_runs', 'core_backfill_runs',
    'core_company_settings', 'core_financial_years', 'core_periods', 'core_parameters', 'core_holiday_calendars', 'core_holidays',
    'core_document_types', 'core_number_series', 'core_number_counters', 'core_number_issues', 'core_change_requests', 'core_change_request_steps',
    'core_sample_documents', 'core_event_types', 'core_inbox', 'core_jobs', 'core_schedules', 'core_projection_event_counts', 'core_files', 'core_file_uploads', 'core_file_settings', 'core_formulas', 'core_calc_traces', 'core_calc_shadow_results', 'core_uoms', 'core_uom_conversions', 'core_sample_bills', 'core_slo_definitions', 'core_alert_rules', 'core_alerts', 'core_metric_samples', 'core_client_events', 'core_connectors', 'core_connector_secrets', 'core_integration_logs', 'core_webhook_receipts', 'core_schema_migrations',
  ],
  resources: [
    'session', 'audit', 'security-events', 'routes', 'security-settings', 'about', 'feature-flags', 'architecture', 'integrity', 'display-settings', 'company-settings', 'financial-years', 'periods',
    'change-requests', 'document-types', 'number-series', 'numbering', 'parameters', 'holiday-calendars', 'holidays', 'sample-documents', 'events', 'jobs', 'schedules', 'files', 'formulas', 'calc-traces', 'uoms', 'uom-conversions', 'calc', 'sample-bills', 'ops', 'connectors', 'integration-logs', 'webhooks',
  ],
  /** Build the module's services and attach its routes to the authenticated /api/v1 router. */
  mount(api, { db, config, buildInfo, modules, publicApi, storagePath }) {
    const flags = createFlagService({ db, environment: config.environment });
    const isFlagOn = (actor, key) => flags.isOn(actor, key);
    const idempotent = idempotency(db); // honoured when the client sends an Idempotency-Key; never required here
    const idempotentRequired = idempotency(db, { required: true }); // every approval, posting and number-issuing action

    const settings = createSettingsService({ db });
    const store = createParameterStore(db, parameterRegistry);
    const runtime = runtimeOf(db);
    // A database older than part 01.04 (the frozen legacy dataset of the contract test) has no tables to write to yet.
    const migrated = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'core_schedules'").get());
    if (migrated) syncEventTypes(db);
    registerOperations({ db, ...runtime, persist: migrated });
    const approvals = createApprovalEngine({ db, handlers: { period_reopen: periodReopenHandler, number_series_change: seriesChangeHandler, schedule_change: createScheduleChangeHandler(runtime.scheduler), file_settings_change: fileSettingsChangeHandler, formula_activation: formulaActivationHandler, ops_config_change: opsConfigChangeHandler, connector_change: connectorChangeHandlerFor(db, config), auth_policy_change: policyChangeHandlerFor(db, config), ...orgHandlers, ...userHandlers, ...accessHandlers, ...privilegedHandlers, ...securityHandlers, ...sampleRequestHandlers, ...navHandlers, ...dashboardHandlers, ...translationHandlers, ...pageRouteHandlers } });
    const opts = { idempotent, idempotentRequired };

    api.use('/core', sessionRoutes({ config }));
    api.use('/core', aboutRoutes(createAboutService({ db, config, buildInfo })));
    api.use('/core', architectureRoutes(createArchitectureService({ modules, isFlagOn })));
    api.use('/core', integrityRoutes(createIntegrityService({ db, isFlagOn }), opts));
    api.use('/core', featureFlagRoutes(flags, opts));
    api.use('/core', displaySettingsRoutes(settings));

    // Event bus, jobs and schedules (part 01.04): hidden while ff.core.p0104 is OFF for the company.
    const operations = Router();
    const mine = (req) => ['/events', '/jobs', '/schedules'].some((p) => req.path === p || req.path.startsWith(`${p}/`));
    operations.use((req, res, next) => (mine(req) ? flagGate(isFlagOn, 'ff.core.p0104')(req, res, next) : next()));
    operations.use(eventRoutes(createEventService({ db, bus: runtime.bus, jobs: runtime.jobs }), opts));
    operations.use(jobRoutes(createJobService({ db, jobs: runtime.jobs, scheduler: runtime.scheduler, approvals }), opts));
    api.use('/core', operations);

    // File storage and attachments (part 01.05): hidden while ff.core.p0105 is OFF for the company.
    mountFiles({ api, publicApi, db, config, runtime, approvals, opts, isFlagOn, storagePath, persist: migrated });

    // The audit trail engine and security event log (part 02.06): hidden while ff.iam.p0206 is OFF for the company.
    mountAudit({ api, db, runtime, opts, isFlagOn, persist: migrated });
    mountSecurity({ api, db, config, approvals, opts, isFlagOn });

    // Observability (part 01.07): hidden while ff.core.p0107 is OFF for the company.
    mountOps({ api, db, runtime, approvals, opts, isFlagOn, storagePath, persist: migrated });

    // Integration hub (part 01.08): hidden while ff.core.p0108 is OFF for the company; the webhook receiver is public (signed).
    mountConnectors({ api, publicApi, db, config, runtime, approvals, opts, isFlagOn, persist: migrated });

    // Calculation engine and formula registry (part 01.06): hidden while ff.core.p0106 is OFF for the company.
    mountCalc({ api, db, approvals, opts, isFlagOn, persist: migrated });

    // System configuration (part 01.03): everything below is hidden while ff.core.p0103 is OFF for the company.
    const configuration = Router();
    configuration.use(flagGate(isFlagOn, 'ff.core.p0103'));
    configuration.use(settingsRoutes(settings, opts));
    configuration.use(financialYearRoutes(createFinancialYearService({ db, approvals, settings }), opts));
    configuration.use(changeRequestRoutes(createChangeRequestService({ approvals }), opts));
    configuration.use(numberingRoutes(createNumberingService({ db, approvals }), opts));
    configuration.use(parameterRoutes(createParameterService({ db, store, registry: parameterRegistry }), opts));
    configuration.use(holidayRoutes(createHolidayService({ db }), opts));
    configuration.use(sampleDocumentRoutes(createSampleDocumentService({ db }), opts));
    api.use('/core', configuration);
  },
};
