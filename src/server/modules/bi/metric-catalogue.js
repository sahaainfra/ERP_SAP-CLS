import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermission, assertPermissionAnywhere, hasPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { conflict, notFound } from '../../platform/http/errors.js';
import { defineList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createFlagService } from '../core/feature-flags/service.js';
import { projectStatusDatasetSource, projectStatusDatasetVersion } from './project-status-dataset.js';
import { metricCertification, projectCountDefinition, readProjectCountMetric, requireMetricFlag } from './project-count-metric.js';
import { captureDomainMetrics, domainMetricDefinition, registerDomainMetricWidgets, requireMetricCatalogueSource } from './domain-metrics.js';

const type = 'bi_metric_certification';
const projectCount = 'project-count';
const targetOf = (code) => code === projectCount ? 'bi_metric' : `bi_metric_${code}`;
const snapshotJob = 'bi.project_snapshot';
export const metricExport = 'bi.project_history';
const exportColumns = {
  period: { sql: 'r.period', label: 'Month', type: 'text' },
  capturedAt: { sql: 'r.captured_at', label: 'Captured at', type: 'datetime' },
  value: { sql: 'r.row_count', label: 'Visible projects', type: 'number' },
  completeness: { sql: 'r.status', label: 'Completeness', type: 'text' },
};
defineList({ code: metricExport, label: 'Project count history', from: 'bi_refresh_log r', managedViews: true,
  columns: Object.fromEntries(Object.entries(exportColumns).map(([key, column]) => [key, { ...column, sortable: false, filterable: false }])) });
const month = () => todayIST().slice(0, 7);
const sourceOf = (context, actor) => {
  requireMetricFlag(context, actor);
  return projectStatusDatasetSource(context, actor);
};
const definitionFor = (context, actor, code) => {
  if (code !== projectCount) return domainMetricDefinition(context, actor, code);
  sourceOf(context, actor);
  return { name: 'project count', datasetVersion: projectStatusDatasetVersion };
};
const contexts = new WeakMap();
registerDomainMetricWidgets((db) => contexts.get(db));
widgetRegistry.register({
  code: 'bi.project_count',
  available(db, actor) {
    const context = contexts.get(db);
    if (!context) return false;
    try {
      sourceOf(context, actor);
      return metricCertification(db, actor.companyId)?.status === 'CERTIFIED';
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  },
  provider({ db, actor, filters }) {
    if (filters.siteId) throw notFound('Project Count is available at project or company scope.');
    const metric = readProjectCountMetric(contexts.get(db), actor, filters.projectId);
    if (!metric.certified) throw notFound('Project Count is awaiting certification.');
    return { label: 'Project count', value: metric.value, unit: 'projects', drill: filters.projectId ? null : '/bi/metrics' };
  },
});
const certificationEvent = { type: 'object', required: ['status', 'version', 'requestId'],
  properties: { status: { type: 'string', enum: ['CERTIFIED', 'REVOKED'] }, version: { type: 'integer' }, requestId: { type: 'integer' } } };
const snapshotEvent = { type: 'object', required: ['period', 'rows'],
  properties: { period: { type: 'string' }, rows: { type: 'integer' } } };
eventTypes.define({ type: 'bi.metric.certification_changed', version: 1, schema: certificationEvent,
  owner: 'bi', description: 'A metric certification decision took effect.' });
eventTypes.define({ type: 'bi.snapshot.captured', version: 1, schema: snapshotEvent,
  owner: 'bi', description: 'A monthly project lifecycle snapshot was captured.' });

export const metricApprovalHandlers = (environment) => ({
  [type]: {
    authorize(db, actor, request) {
      assertPermission(actor, 'bi.metric.certify');
      const { code = projectCount } = JSON.parse(request.payload_json);
      definitionFor({ db, flags: createFlagService({ db, environment }) }, actor, code);
    },
    apply(db, request, actor) {
      const { code = projectCount, datasetVersion, baseVersion, certify } = request.payload;
      const current = definitionFor({ db, flags: createFlagService({ db, environment }) }, actor, code);
      const prior = metricCertification(db, request.companyId, code, current.datasetVersion);
      if ((prior?.version ?? 0) !== baseVersion || datasetVersion !== current.datasetVersion) {
        throw conflict('The metric definition changed. Submit a new request.');
      }
      const status = certify ? 'CERTIFIED' : 'REVOKED';
      const version = baseVersion + 1;
      db.prepare(`INSERT INTO bi_metrics (company_id, code, dataset_version, status, request_id, version, created_by, source_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(request.companyId, code, datasetVersion, status, request.id, version, actor.user, String(request.id), request.reason);
      writeAudit(db, { companyId: request.companyId, entity: 'bi_metric', entityId: code, action: 'certification',
        oldValues: prior, newValues: { status, version, requestId: request.id }, actor: actor.user });
      publishEvent(db, { type: 'bi.metric.certification_changed', entity: 'bi_metric', entityId: code,
        actorId: actor.user, companyId: request.companyId, data: { status, version, requestId: request.id } });
    },
  },
});

export function createMetricCatalogue(context, { jobs, scheduler, environment, exports, bus }) {
  const { db } = context;
  contexts.set(db, context);
  const approvals = createApprovalEngine({ db, handlers: metricApprovalHandlers(environment) });
  const history = (actor, viewProjects, exportScope = { sql: '1 = 1', params: {} }) => {
    const scope = viewProjects ? authzOf(db).scopeFilter(actor, 'proj.project.view', { project: 's.project_id' }) : { sql: '1 = 0' };
    const rows = db.prepare(`WITH recent AS (
      SELECT id, period, captured_at, row_count FROM bi_refresh_log WHERE company_id = :company AND dataset_version = :version
      ORDER BY period DESC LIMIT 24
    )
    SELECT recent.period, recent.captured_at AS capturedAt, COUNT(s.id) AS value,
      CASE WHEN recent.row_count = (SELECT COUNT(*) FROM bi_project_snapshots a WHERE a.refresh_id = recent.id AND a.company_id = :company)
        THEN 'COMPLETE' ELSE 'INCOMPLETE' END AS completeness
      FROM recent LEFT JOIN bi_project_snapshots s ON s.refresh_id = recent.id AND s.company_id = :company
        AND (${scope.sql}) AND (${exportScope.sql})
      GROUP BY recent.id ORDER BY recent.period DESC`).all({ company: actor.companyId, version: projectStatusDatasetVersion, ...scope.params, ...exportScope.params });
    return { periods: viewProjects ? rows : rows.map(({ period, capturedAt, completeness }) => ({ period, capturedAt, completeness })),
      freshness: !rows.length ? 'MISSING' : rows[0].period === month() ? 'CURRENT' : 'STALE' };
  };
  const checkOperator = (actor, permission) => {
    requireMetricCatalogueSource(context, actor);
    assertPermission(actor, permission);
  };
  function exportAccess(actor) {
    sourceOf(context, actor);
    assertPermissionAnywhere(actor, 'proj.project.view');
    assertPermissionAnywhere(actor, 'proj.project.export');
    const certificate = metricCertification(db, actor.companyId);
    if (!context.flags.isOn(actor, 'ff.ui.p0303') || certificate?.status !== 'CERTIFIED') {
      throw notFound('Certified metric exports are unavailable.');
    }
    const authz = authzOf(db);
    return {
      version: certificate.version,
      viewScope: authz.scopeFilter(actor, 'proj.project.view', { project: 's.project_id' }),
      exportScope: authz.scopeFilter(actor, 'proj.project.export', { project: 's.project_id' }),
    };
  }
  exports.register(metricExport, (actor) => {
    const { exportScope } = exportAccess(actor);
    const { periods } = history(actor, true, exportScope);
    return { title: 'Certified project count history', permission: 'proj.project.export', personal: false,
      columns: Object.entries(exportColumns).map(([key, column]) => ({ key, label: column.label, type: column.type })),
      count: () => periods.length, rows: () => periods, describe: () => [] };
  }, { checkAccess: (actor) => JSON.stringify(exportAccess(actor)) });

  function capture(companyId) {
    const actor = { companyId, user: 'scheduler' };
    const source = sourceOf(context, actor);
    return transaction(db, () => {
      const period = month();
      const capturedAt = new Date().toISOString();
      const insert = db.prepare(`INSERT INTO bi_refresh_log
        (company_id, period, dataset_version, captured_at, row_count, status, created_by, source_id)
        VALUES (?, ?, ?, ?, 0, 'COMPLETE', ?, ?) ON CONFLICT(company_id, period, dataset_version) DO NOTHING`)
        .run(companyId, period, projectStatusDatasetVersion, capturedAt, actor.user, period);
      if (!insert.changes) return false;
      const add = db.prepare(`INSERT INTO bi_project_snapshots
        (company_id, refresh_id, project_id, lifecycle_state, created_by, source_id) VALUES (?, ?, ?, ?, ?, ?)`);
      let rows = 0;
      for (const row of source.snapshotLifecycle(companyId)) {
        add.run(companyId, insert.lastInsertRowid, row.projectId, row.state, actor.user, String(row.sourceId));
        rows += 1;
      }
      db.prepare('UPDATE bi_refresh_log SET row_count = ? WHERE id = ?').run(rows, insert.lastInsertRowid);
      writeAudit(db, { companyId, entity: 'bi_refresh_log', entityId: Number(insert.lastInsertRowid), action: 'capture',
        newValues: { period, rows, datasetVersion: projectStatusDatasetVersion }, actor: actor.user });
      publishEvent(db, { type: 'bi.snapshot.captured', entity: 'bi_refresh_log', entityId: Number(insert.lastInsertRowid),
        actorId: actor.user, companyId, data: { period, rows } });
      return true;
    });
  }

  function captureCompany(companyId) {
    const actor = { companyId, user: 'scheduler' };
    requireMetricCatalogueSource(context, actor);
    const project = context.flags.isOn(actor, 'ff.proj.p1001') && capture(companyId);
    return { captured: project, metricsCaptured: captureDomainMetrics(context, companyId) };
  }
  jobs.register(snapshotJob, ({ params }) => {
    if (params.companyId) return captureCompany(params.companyId);
    let captured = 0;
    let metricsCaptured = 0;
    for (const { id } of db.prepare('SELECT id FROM org_companies WHERE is_active = 1 ORDER BY id').all()) {
      try {
        const result = captureCompany(id);
        if (result.captured) captured += 1;
        metricsCaptured += result.metricsCaptured;
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    return { captured, metricsCaptured };
  }, { description: 'Captures project lifecycle and enabled domain metrics monthly.' });
  scheduler.define({ code: snapshotJob, cron: '5 0 1 * *', jobType: snapshotJob, description: 'Capture monthly analytics at 00:05 IST.' });
  bus.subscribe(['bi.snapshot.captured', 'bi.metric.certification_changed'], (event) => {
    if (!event.companyId || !context.flags.isOn({ companyId: event.companyId }, 'ff.bi.p2703')) return;
    const capture = event.type === 'bi.snapshot.captured';
    const request = capture ? null : db.prepare('SELECT requested_by FROM core_change_requests WHERE company_id = ? AND type = ? AND id = ?')
      .get(event.companyId, type, event.data.requestId);
    if (!capture && !request) return;
    notificationsOf(db).notify({
      companyId: event.companyId,
      templateCode: capture ? 'bi.snapshot.ready' : event.entityId === projectCount ? 'bi.metric.decided' : 'bi.domain_metric.decided',
      recipients: capture ? ['role:SYSADM', 'role:ITADM'] : [`user:${request.requested_by}`],
      data: capture ? { period: event.data.period } : { metric: event.entityId, outcome: event.data.status === 'CERTIFIED' ? 'certified' : 'revoked' },
      link: '/bi/metrics', channels: ['IN_APP'], sourceType: 'bi_metric_event', sourceId: event.eventId,
    });
  }, { consumer: 'bi.metrics.notifications' });

  return {
    read(actor) {
      requireMetricCatalogueSource(context, actor);
      assertPermissionAnywhere(actor, 'bi.metric.catalogue.view');
      const projectSource = context.flags.isOn(actor, 'ff.proj.p1001');
      const viewProjects = projectSource && hasPermissionAnywhere(actor, 'proj.project.view');
      const metric = !projectSource ? null : viewProjects ? readProjectCountMetric(context, actor) : {
        ...projectCountDefinition, certified: metricCertification(db, actor.companyId)?.status === 'CERTIFIED',
      };
      const observations = projectSource && (viewProjects || hasPermission(actor, 'bi.snapshot.run')) ? history(actor, viewProjects) : { periods: [], freshness: null };
      return { metric, ...observations, canCertify: hasPermission(actor, 'bi.metric.certify'),
        canCapture: hasPermission(actor, 'bi.snapshot.run'),
        canExport: Boolean(metric?.certified && viewProjects && hasPermissionAnywhere(actor, 'proj.project.export') && context.flags.isOn(actor, 'ff.ui.p0303')) };
    },
    queue(actor) {
      checkOperator(actor, 'bi.snapshot.run');
      return jobs.enqueue(snapshotJob, { companyId: actor.companyId }, { companyId: actor.companyId, createdBy: actor.user });
    },
    authorize: checkOperator,
    requests(actor, code = projectCount) {
      checkOperator(actor, 'bi.metric.certify');
      definitionFor(context, actor, code);
      return approvals.list(actor, { type, targetType: targetOf(code), status: undefined, limit: 25, offset: 0 }).rows;
    },
    submit(actor, { certify, reason, code = projectCount }) {
      checkOperator(actor, 'bi.metric.certify');
      const { name, datasetVersion } = definitionFor(context, actor, code);
      return transaction(db, () => {
        const current = metricCertification(db, actor.companyId, code, datasetVersion);
        if ((current?.status === 'CERTIFIED') === certify) throw conflict('The requested certification status is already in effect.');
        if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = ? AND status = 'SUBMITTED'")
          .get(actor.companyId, type, targetOf(code))) {
          throw conflict('A certification request is already awaiting review.');
        }
        return approvals.submit(actor, { type, title: certify ? `Certify ${name}` : `Revoke ${name} certification`,
          targetType: targetOf(code), targetId: 0, reason, chain: ['PCMGR|CFO'],
          payload: { code, certify, datasetVersion, baseVersion: current?.version ?? 0 } });
      });
    },
    decide(actor, id, input) {
      checkOperator(actor, 'bi.metric.certify');
      if (approvals.get(actor, id).type !== type) throw notFound('That metric request does not exist.');
      return approvals.act(actor, id, input);
    },
  };
}
