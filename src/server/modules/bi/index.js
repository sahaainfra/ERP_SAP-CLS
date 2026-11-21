import { Router } from 'express';
import { z } from 'zod';
import { parse } from '../../platform/validation/index.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { idempotency } from '../../platform/http/idempotency.js';
import { authzOf } from '../../platform/authz/index.js';
import { runtimeOf } from '../../platform/runtime/index.js';
import { assertPermission } from '../../platform/auth/index.js';
import { integrityRegistry } from '../../platform/integrity/index.js';
import { defineList, listExportsOf, parseListRequest, queryOf } from '../../platform/list/index.js';
import { createFlagService } from '../core/api.js';
import { createSavedViewService, parseViewCreate, parseViewUpdate } from '../ui/lists.js';
import { projectList, projectsOf } from '../proj/project.js';
import { projectStatusReport as report, reportsFor } from './catalogue.js';
import { readProjectStatusReport, requireReportRegistry } from './project-status.js';
import { projectStatusColumns, projectStatusDatasetVersion, projectStatusGroups, readProjectStatusDataset } from './project-status-dataset.js';
import { createReportSubscriptions, subscriptionStatus, subscriptionUpdate } from './subscriptions.js';
import { readProjectCountMetric } from './project-count-metric.js';
import { createMetricCatalogue, metricExport } from './metric-catalogue.js';
import { domainHistoryCode, domainMetricDefinition, listDomainMetrics, readDomainMetric, readDomainQuality, registerDomainHistoryExports } from './domain-metrics.js';
import { bindExecution, createExecution } from './execution.js';
import { SECTIONS as MR_SECTIONS, CHANNELS as MR_CHANNELS, createMorningReport } from './morning-report.js';
import { ALERT_STATUSES, RULES, SEVERITIES, DIMENSIONS, bindTower, createControlTower } from './control-tower.js';

const reportCode = 'bi.project_status';
const builderExportCode = 'bi.project_status_builder';
const standardExportFields = ['code', 'name', 'stateLabel', 'statusLabel', 'health'];
const columns = Object.fromEntries(projectStatusColumns.map(({ key, label, type }) => [key, {
  label,
  type,
  sql: projectList.columns[key]?.sql ?? ({ projectId: 'x.project_id', stateLabel: 'x.lifecycle_state', statusLabel: 'x.status' })[key],
  sortable: false,
  filterable: key === 'state',
  ...(key === 'state' ? { options: projectList.columns.state.options } : {}),
}]));
defineList({ code: reportCode, label: report.title, from: projectList.from, columns, managedViews: true });
defineList({ code: builderExportCode, label: report.title, from: projectList.from, columns, managedViews: true });
integrityRegistry.register({
  statuses: { rpt_subscriptions: ['ACTIVE', 'PAUSED'], rpt_runs: ['QUEUED', 'READY', 'FAILED', 'SKIPPED'],
    bi_metrics: ['CERTIFIED', 'REVOKED'], bi_refresh_log: ['COMPLETE'], bi_project_snapshots: ['CAPTURED'],
    bi_domain_refreshes: ['COMPLETE'], bi_domain_observations: ['CAPTURED'], exec_alerts: ALERT_STATUSES, exec_alert_settings: ['APPROVED'], mr_configs: ['APPROVED'], mr_reports: ['GENERATED', 'DELIVERED'], dei_daily: ['CAPTURED'] },
});

const configSchema = z.object({
  name: z.string().trim().min(1).max(80),
  fields: z.array(z.string()).min(1).max(projectStatusColumns.length),
  state: z.string().max(80).optional(),
  groupBy: z.enum(['', 'state', 'status']).optional(),
  shared: z.boolean().default(false),
  roles: z.array(z.string().regex(/^[A-Z][A-Z0-9-]{1,19}$/)).max(20).default([]),
  version: z.number().int().positive().optional(),
}).strict();
const parseId = (id) => parse(z.coerce.number().int().positive(), id);
const metricCode = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const actorKey = ({ companyId, userId, user }) => JSON.stringify([companyId, userId ?? null, user]);

export const bi = {
  code: 'bi', name: 'Reports', routePrefix: '/api/v1/bi', ownerPart: '27.01',
  status: 'Project status catalogue, builder, exports, personal subscriptions and usage.',
  tables: ['rpt_subscriptions', 'rpt_runs', 'bi_metrics', 'bi_refresh_log', 'bi_project_snapshots', 'bi_domain_refreshes', 'bi_domain_observations', 'exec_alerts', 'exec_alert_settings', 'mr_configs', 'mr_reports', 'dei_daily'], companyOptional: [], resources: ['reports', 'datasets', 'custom-reports', 'subscriptions', 'usage', 'metrics', 'control-tower', 'exec-alerts', 'exec-alert-settings', 'morning-reports', 'morning-report-settings', 'execution'],
  mount(api, { db, config }) {
    // The report background jobs are available once the reporting schema has been installed.
    if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'rpt_subscriptions'").get()) return;
    const context = { db, flags: createFlagService({ db, environment: config.environment }) };
    const exports = listExportsOf(db);
    if (!exports) return;
    const views = createSavedViewService({ db, managedList: reportCode });
    const router = Router();
    const ok = (res, data, status = 200) => res.status(status).json({ data });
    const exportsAvailable = (actor) => context.flags.isOn(actor, 'ff.ui.p0303');
    const requireExports = (actor) => {
      if (!exportsAvailable(actor)) throw notFound('Reporting exports are unavailable.');
    };
    const withFormats = (entry, actor) => entry.formats && !exportsAvailable(actor) ? { ...entry, formats: [] } : entry;
    const verifyReport = (actor) => readProjectStatusReport(context, actor, { pageSize: '10' });
    const verifyBuilder = (actor) => readProjectStatusDataset(context, actor, { pageSize: '10', fields: ['code'] });
    const ownedReport = (actor, id) => {
      if (!views.list(actor, reportCode).some((view) => view.id === id && view.mine)) {
        throw notFound('That custom report does not exist.');
      }
    };
    const saveInput = (actor, input) => {
      const { name, fields, state, groupBy, shared, roles } = input;
      if (shared && roles.length === 0) throw badRequest('Select at least one role for the shared report.');
      readProjectStatusDataset(context, actor, { fields, pageSize: '10', groupBy: groupBy || undefined, ...(state ? { 'filter[state]': state } : {}) });
      return {
        name, isShared: shared, shareScope: { roles: shared ? roles : [], projects: [] },
        config: { columns: fields, groupBy: groupBy || undefined, filters: state ? [{ key: 'state', op: 'eq', value: state }] : [] },
      };
    };

    const registerExport = (code, custom) => {
      exports.register(code, (actor, parsed) => {
        const query = { ...queryOf(parsed), pageSize: '10' };
        const fields = custom && typeof parsed.fields === 'string' ? parsed.fields.split(',') : standardExportFields;
        if (custom && typeof parsed.fields !== 'string') throw badRequest('Select fields for the report export.');
        if (custom) readProjectStatusDataset(context, actor, { ...query, fields });
        else readProjectStatusReport(context, actor, query);
        const source = projectsOf(db).projects.exportSource(actor, parseListRequest(projectList, query), {
          project: (row) => Object.fromEntries(fields.map((field) => [field, row[field]])),
          scopedExport: true,
        });
        return {
          ...source,
          title: report.title,
          columns: fields.map((field) => projectStatusColumns.find(({ key }) => key === field)),
        };
      }, {
        parameters: custom ? ['fields'] : [],
        checkAccess: (actor) => {
          requireExports(actor);
          if (custom) verifyBuilder(actor);
          else verifyReport(actor);
          projectsOf(db).projects.exportSource(actor, {});
          const authz = authzOf(db);
          return JSON.stringify(['proj.project.view', 'proj.project.export'].map((permission) => (
            authz.scopeFilter(actor, permission, { project: 'x.project_id' })
          )));
        },
      });
    };
    registerExport(reportCode, false);
    registerExport(builderExportCode, true);
    const subscriptions = createReportSubscriptions({
      db, exports, views, environment: config.environment,
      exportCodes: { standard: reportCode, custom: builderExportCode },
      verify(actor, savedReportId = undefined, state = undefined) {
        requireExports(actor);
        if (savedReportId) return verifyBuilder(actor);
        return readProjectStatusReport(context, actor, { pageSize: '10', ...(state ? { 'filter[state]': state } : {}) });
      },
    });
    const runtime = runtimeOf(db);
    const catalogue = createMetricCatalogue(context, { ...runtime, environment: config.environment, exports });
    registerDomainHistoryExports(context, exports);
    runtime.jobs.register('bi.subscriptions', () => subscriptions.tick(), { description: 'Queues due report exports and records delivery outcomes.' });
    runtime.scheduler.define({
      code: 'bi.subscriptions', cron: '*/5 * * * *', jobType: 'bi.subscriptions',
      description: 'Process personal report subscriptions every five minutes.',
    });
    const startExport = (code, params, allowState = true) => (req, res) => {
      requireExports(req.actor);
      const query = parse(z.object({
        ...(allowState ? { 'filter[state]': z.string().max(80).optional() } : {}),
        format: z.enum(['csv', 'xlsx', 'pdf']).default('csv'),
        ...params,
      }).strict(), req.query);
      const out = exports.start(req.actor, code, query);
      if (out.kind === 'job') return ok(res, out, 202);
      return res.set({
        'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`,
        'x-export-rows': String(out.rows), 'cache-control': 'no-store',
      }).send(out.buffer);
    };

    router.get('/reports', (req, res) => {
      requireReportRegistry(context, req.actor);
      return ok(res, reportsFor(context.flags, req.actor).map((entry) => withFormats(entry, req.actor)));
    });
    router.get('/reports/project-status', (req, res) => ok(res, readProjectStatusReport(context, req.actor, req.query)));
    router.get('/metrics/project-count', (req, res) => {
      parse(z.object({}).strict(), req.query);
      return ok(res, readProjectCountMetric(context, req.actor));
    });
    const metricIdempotency = idempotency(db, { required: true, actorKey });
    const metricAccess = (permission) => (req, _res, next) => {
      catalogue.authorize(req.actor, permission);
      next();
    };
    const mayCertify = metricAccess('bi.metric.certify');
    router.get('/metrics', (req, res) => ok(res, catalogue.read(req.actor)));
    router.get('/metrics/domains', (req, res) => ok(res, listDomainMetrics(context, req.actor)));
    router.get('/metrics/domain-quality', (req, res) => ok(res, readDomainQuality(context, req.actor)));
    router.get('/metrics/domains/:code', (req, res) => {
      const query = parse(z.object({ projectId: z.coerce.number().int().positive().optional(),
        search: z.string().trim().max(80).optional() }).strict(), req.query);
      return ok(res, readDomainMetric(context, req.actor, parse(metricCode, req.params.code), query));
    });
    router.get('/metrics/domains/:code/export', (req, res) => {
      const definition = domainMetricDefinition(context, req.actor, parse(metricCode, req.params.code));
      return startExport(domainHistoryCode(definition.code), { 'filter[projectId]': z.coerce.number().int().positive().transform(String) }, false)(req, res);
    });
    router.get('/metrics/history/export', startExport(metricExport, {}, false));
    router.post('/metrics/snapshots', metricAccess('bi.snapshot.run'), metricIdempotency, (req, res) => {
      parse(z.object({}).strict(), req.body ?? {});
      return ok(res, catalogue.queue(req.actor), 202);
    });
    router.get('/metrics/certifications', (req, res) => {
      const { code } = parse(z.object({ code: metricCode.optional() }).strict(), req.query);
      return ok(res, catalogue.requests(req.actor, code));
    });
    router.post('/metrics/certifications', mayCertify, metricIdempotency, (req, res) => {
      const input = parse(z.object({ certify: z.boolean(), reason: z.string().trim().min(5).max(500),
        code: metricCode.optional() }).strict(), req.body);
      return ok(res, catalogue.submit(req.actor, input), 201);
    });
    router.post('/metrics/certifications/:id/act', mayCertify, metricIdempotency, (req, res) => {
      const input = parse(z.object({ action: z.enum(['approve', 'reject', 'return']),
        comment: z.string().trim().max(500).optional(), version: z.number().int().positive() }).strict(), req.body);
      return ok(res, catalogue.decide(req.actor, parseId(req.params.id), input));
    });
    // ---- part 27.04: the enterprise control tower, the executive dashboard and the executive alerts
    const tower = createControlTower(context, { ...runtime, environment: config.environment });
    bindTower(db, tower);
    const towerQuery = z.object({
      regionId: z.coerce.number().int().positive().optional(), sector: z.string().trim().max(40).optional(), pm: z.string().trim().max(80).optional(),
      rag: z.enum(['RED', 'AMBER', 'GREEN', 'NONE']).optional(), search: z.string().trim().max(80).optional(),
      sort: z.enum(['overall', 'spi', 'cpi', 'eac', 'revenue', 'margin', 'dso', 'ltifr', 'stock']).optional(),
      dimension: z.enum(DIMENSIONS).optional(), dimensionRag: z.enum(['RED', 'AMBER', 'GREEN', 'NONE']).optional(),
      page: z.coerce.number().int().positive().max(10000).optional(), pageSize: z.coerce.number().int().positive().max(100).optional(),
    }).strict();
    router.get('/control-tower', (req, res) => ok(res, tower.portfolio(req.actor, parse(towerQuery, req.query))));
    router.get('/control-tower/projects/:id', (req, res) => {
      parse(z.object({}).strict(), req.query);
      return ok(res, tower.project(req.actor, parseId(req.params.id)));
    });
    router.get('/control-tower/export', (req, res) => {
      const { format, ...query } = parse(towerQuery.extend({ format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }), req.query);
      const out = tower.exportMatrix(req.actor, query, format);
      return res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`,
        'x-export-rows': String(out.rows), 'cache-control': 'no-store' }).send(out.buffer);
    });
    const alertQuery = z.object({
      status: z.enum([...ALERT_STATUSES, 'ACTIVE']).optional(), severity: z.enum(SEVERITIES).optional(),
      ruleCode: z.enum(RULES.map((rule) => rule.code)).optional(), projectId: z.coerce.number().int().positive().optional(),
      mine: z.enum(['1', 'true']).optional(), page: z.coerce.number().int().positive().max(10000).optional(), pageSize: z.coerce.number().int().positive().max(100).optional(),
    }).strict();
    const towerIdempotency = idempotency(db, { required: true, actorKey });
    router.get('/exec-alerts', (req, res) => ok(res, tower.alertsList(req.actor, parse(alertQuery, req.query))));
    router.get('/exec-alerts/:id', (req, res) => ok(res, tower.getAlert(req.actor, parseId(req.params.id))));
    router.post('/exec-alerts/evaluations', towerIdempotency, (req, res) => {
      parse(z.object({}).strict(), req.body ?? {});
      return ok(res, tower.queueEvaluation(req.actor), 202);
    });
    router.post('/exec-alerts/:id/act', towerIdempotency, (req, res) => {
      const input = parse(z.object({ action: z.enum(['acknowledge', 'resolve']), note: z.string().trim().max(500).optional(),
        version: z.number().int().positive() }).strict(), req.body);
      return ok(res, tower.actOnAlert(req.actor, parseId(req.params.id), input));
    });
    router.get('/exec-alert-settings', (req, res) => ok(res, tower.settingsView(req.actor)));
    router.post('/exec-alert-settings/requests', towerIdempotency, (req, res) => {
      const input = parse(z.object({ ruleCode: z.enum(RULES.map((rule) => rule.code)), enabled: z.boolean(),
        threshold: z.number().finite(), periods: z.number().int().min(1).max(6).default(1), severity: z.enum(SEVERITIES),
        reason: z.string().trim().min(5).max(500) }).strict(), req.body);
      return ok(res, tower.proposeSettings(req.actor, input), 201);
    });
    router.post('/exec-alert-settings/requests/:id/act', towerIdempotency, (req, res) => {
      const input = parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(),
        version: z.number().int().positive() }).strict(), req.body);
      return ok(res, tower.decideSettings(req.actor, parseId(req.params.id), input));
    });
    // ---- part 27.05: the daily morning management report
    const morning = createMorningReport(context, { ...runtime, environment: config.environment });
    const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
    router.get('/morning-reports/current', (req, res) => {
      const { date } = parse(z.object({ date: isoDate.optional() }).strict(), req.query);
      return ok(res, morning.open(req.actor, { date }));
    });
    router.get('/morning-reports', (req, res) => ok(res, morning.archive(req.actor, parse(z.object({ from: isoDate.optional(), to: isoDate.optional(),
      page: z.coerce.number().int().positive().max(10000).optional(), pageSize: z.coerce.number().int().positive().max(100).optional() }).strict(), req.query))));
    router.get('/morning-reports/:id', (req, res) => ok(res, morning.open(req.actor, { id: parseId(req.params.id) })));
    router.get('/morning-reports/:id/verify', (req, res) => ok(res, morning.verify(req.actor, parseId(req.params.id))));
    router.get('/morning-reports/:id/export', (req, res) => {
      const { format } = parse(z.object({ format: z.enum(['csv', 'xlsx', 'pdf']).default('pdf') }).strict(), req.query);
      const out = morning.exportReport(req.actor, parseId(req.params.id), format);
      return res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }).send(out.buffer);
    });
    router.post('/morning-reports/deliveries', towerIdempotency, (req, res) => {
      parse(z.object({}).strict(), req.body ?? {});
      return ok(res, morning.queueDelivery(req.actor), 202);
    });
    router.get('/morning-report-settings', (req, res) => ok(res, morning.settings(req.actor)));
    const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
    router.post('/morning-report-settings/requests', towerIdempotency, (req, res) => {
      const input = parse(z.object({ scopeType: z.enum(['ROLE', 'USER']), scopeRef: z.string().trim().min(2).max(80),
        sections: z.array(z.enum(MR_SECTIONS)).min(1).max(MR_SECTIONS.length).refine((a) => new Set(a).size === a.length, 'Each section once'),
        cutoff: hhmm, time: hhmm, channels: z.array(z.enum(MR_CHANNELS)).min(1).max(3).refine((a) => a.includes('IN_APP'), 'In-app delivery is always on'),
        pdf: z.boolean().default(true), active: z.boolean(), reason: z.string().trim().min(5).max(500) }).strict(), req.body);
      return ok(res, morning.propose(req.actor, input), 201);
    });
    router.post('/morning-report-settings/requests/:id/act', towerIdempotency, (req, res) => {
      const input = parse(z.object({ action: z.enum(['approve', 'reject', 'return']), comment: z.string().trim().max(500).optional(),
        version: z.number().int().positive() }).strict(), req.body);
      return ok(res, morning.decide(req.actor, parseId(req.params.id), input));
    });
    // ---- part 27.06: daily execution intelligence and work-done / WIP valuation
    const execution = createExecution(context, runtime);
    bindExecution(db, context);
    const execQuery = z.object({ projectId: z.coerce.number().int().positive().optional(), siteId: z.coerce.number().int().positive().optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), days: z.coerce.number().int().min(7).max(90).optional() }).strict();
    router.get('/execution', (req, res) => ok(res, execution.overview(req.actor, parse(execQuery, req.query))));
    router.get('/execution/valuation', (req, res) => ok(res, execution.valuation(req.actor, parse(execQuery.omit({ days: true }), req.query))));
    router.get('/execution/valuation/export', (req, res) => {
      const { format, ...q } = parse(execQuery.omit({ days: true }).extend({ format: z.enum(['csv', 'xlsx', 'pdf']).default('csv') }), req.query);
      const out = execution.exportValuation(req.actor, q, format);
      return res.set({ 'content-type': out.contentType, 'content-disposition': `attachment; filename="${out.fileName}"`, 'cache-control': 'no-store' }).send(out.buffer);
    });
    router.post('/execution/captures', towerIdempotency, (req, res) => {
      const input = parse(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), projectId: z.number().int().positive().optional() }).strict(), req.body);
      return ok(res, execution.queue(req.actor, input), 202);
    });
    router.get('/reports/project-status/export', startExport(reportCode, {}));
    router.get('/datasets/project-status', (req, res) => {
      verifyBuilder(req.actor);
      return ok(res, withFormats({ ...report, version: projectStatusDatasetVersion, columns: projectStatusColumns, states: projectList.columns.state.options, groups: projectStatusGroups }, req.actor));
    });
    router.post('/datasets/project-status/preview', (req, res) => ok(res, readProjectStatusDataset(context, req.actor, req.body)));
    router.get('/datasets/project-status/export', startExport(builderExportCode, { fields: z.string().min(1).max(160) }));
    router.get('/custom-reports', (req, res) => {
      verifyBuilder(req.actor);
      return ok(res, views.list(req.actor, reportCode));
    });
    router.post('/custom-reports', (req, _res, next) => {
      verifyBuilder(req.actor);
      next();
    }, idempotency(db, {
      required: true,
      actorKey,
    }), (req, res) => {
      const input = parse(configSchema, req.body);
      const saved = views.create(req.actor, parseViewCreate({ list: reportCode, ...saveInput(req.actor, input) }));
      return ok(res, saved, 201);
    });
    router.put('/custom-reports/:id', (req, res) => {
      verifyBuilder(req.actor);
      const id = parseId(req.params.id);
      ownedReport(req.actor, id);
      const input = parse(configSchema.required({ version: true }), req.body);
      return ok(res, views.update(req.actor, id, parseViewUpdate({ ...saveInput(req.actor, input), version: input.version })));
    });
    router.delete('/custom-reports/:id', (req, res) => {
      verifyBuilder(req.actor);
      const id = parseId(req.params.id);
      ownedReport(req.actor, id);
      const { version } = parse(z.object({ version: z.coerce.number().int().positive() }).strict(), req.query);
      return ok(res, views.remove(req.actor, id, { version }));
    });
    router.get('/subscriptions', (req, res) => ok(res, subscriptions.list(req.actor)));
    router.post('/subscriptions', (req, _res, next) => {
      subscriptions.assertAccess(req.actor);
      next();
    }, idempotency(db, { required: true, actorKey }), (req, res) => {
      return ok(res, subscriptions.create(req.actor, req.body), 201);
    });
    router.patch('/subscriptions/:id', (req, res) => ok(res, subscriptions.change(req.actor, parseId(req.params.id), parse(subscriptionStatus, req.body))));
    router.put('/subscriptions/:id', (req, res) => ok(res, subscriptions.update(req.actor, parseId(req.params.id), parse(subscriptionUpdate, req.body))));
    router.delete('/subscriptions/:id', (req, res) => {
      const { version } = parse(z.object({ version: z.coerce.number().int().positive() }).strict(), req.query);
      return ok(res, subscriptions.change(req.actor, parseId(req.params.id), { status: 'PAUSED', version, remove: true }));
    });
    router.get('/usage', (req, res) => {
      requireReportRegistry(context, req.actor);
      assertPermission(req.actor, 'core.audit.view');
      const { days } = parse(z.object({ days: z.enum(['7', '30', '90']).default('30') }).strict(), req.query);
      const since = new Date(Date.now() - Number(days) * 86_400_000).toISOString();
      const company = req.actor.companyId;
      const exportCounts = db.prepare(`SELECT a.entity_id AS report, json_extract(a.new_values, '$.format') AS format, COUNT(*) AS total
        FROM core_audit_log a JOIN core_audit_chain c ON c.audit_id = a.id
        WHERE c.company_id = ? AND c.occurred_at >= ? AND a.entity = 'report' AND a.action = 'export' AND a.entity_id IN (?, ?)
        GROUP BY a.entity_id, format ORDER BY a.entity_id, format`).all(company, since, reportCode, builderExportCode);
      const scheduleCounts = db.prepare(`SELECT status, COUNT(*) AS total FROM rpt_runs WHERE company_id = ? AND scheduled_at >= ?
        GROUP BY status ORDER BY status`).all(company, since);
      return ok(res, { days: Number(days), exports: exportCounts, scheduledRuns: scheduleCounts });
    });
    api.use('/bi', router);
  },
};
