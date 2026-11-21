import { assertPermission, assertPermissionAnywhere, hasPermission, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { badRequest, forbidden, notFound } from '../../platform/http/errors.js';
import { defineList } from '../../platform/list/index.js';
import { likePattern } from '../../platform/pagination/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { arOf, costForecastsOf, projectPlOf } from '../fin/index.js';
import { hseOf } from '../hse/index.js';
import { invOf } from '../inv/index.js';
import { registerProject360Widget } from '../proj/p360.js';
import { siteOf } from '../site/index.js';
import { requireReportRegistry } from './project-status.js';
import { metricCertification, requireMetricFlag } from './project-count-metric.js';

const progressSource = (db) => siteOf(db)?.progressSvc;
const inventorySource = (db) => invOf(db)?.mmd;
const safetySource = (db) => hseOf(db)?.svc.kpi;
const progress = { permission: 'site.period.view', exportPermission: 'site.period.export', flag: 'ff.site.p1405', source: progressSource, scale: 10000,
  dataset: 'approved-progress', register: 'site.periods', sourceType: 'prs_periods', route: '/site/periods', unit: 'ratio' };

const definitions = [
  { ...progress, code: 'spi', field: 'spi', name: 'Schedule performance index', formula: 'Earned value ÷ planned value',
    owner: 'Project Controls', definition: 'SPI from the latest approved progress period for the selected project.' },
  { ...progress, code: 'cpi', field: 'cpi', name: 'Cost performance index', formula: 'Earned value ÷ actual cost',
    owner: 'Project Controls', sensitivePermission: 'site.period.cost', definition: 'CPI from the latest approved progress period for the selected project.' },
  { code: 'eac', field: 'eac', name: 'Estimate at completion', formula: 'Approved forecast total including risk and pending variations',
    definition: 'EAC from the latest approved Finance cost forecast for the selected project.', owner: 'Finance', unit: 'INR', scale: 100,
    permission: 'fin.forecast.view', exportPermission: 'fin.forecast.export', flag: 'ff.fin.p2311', source: costForecastsOf, dataset: 'approved-cost-forecast',
    register: 'fin.cost_forecasts', sourceType: 'fc_forecasts', route: '/finance/cost-forecasts' },
  { code: 'gross-margin', field: 'grossMargin', name: 'Gross margin', formula: 'Gross profit ÷ revenue × 100',
    definition: 'Gross margin for the latest frozen monthly project P&L.', owner: 'Finance', unit: '%', scale: 100,
    permission: 'fin.pl_snapshot.view', sensitivePermission: 'fin.pl.view', exportPermission: 'fin.pl_snapshot.export',
    flag: 'ff.fin.p2312', source: projectPlOf,
    dataset: 'frozen-project-pl', register: 'fin.pl_snapshots', sourceType: 'pl_snapshots', route: '/finance/project-pl', recordParam: 'snapshot' },
  { code: 'dso', field: 'dso', name: 'Days sales outstanding', formula: 'Open receivables ÷ recent approved sales × sales window in days',
    definition: 'Days sales outstanding for the project using the receivables sales window and current posted balances.',
    owner: 'Finance', unit: 'days', scale: 1, permission: 'fin.invoice.view', exportPermission: 'fin.invoice.export',
    flag: 'ff.fin.p2305', source: arOf, dataset: 'project-receivables', register: 'fin.receivables.ageing',
    sourceType: 'ar_project_ageing', route: '/finance/receivables', aggregate: true, reportParams: { tab: 'ageing' } },
  { code: 'stock-turns', field: 'stockTurns', name: 'Stock turns', formula: 'Annualised issues at cost ÷ average of opening and closing stock value',
    definition: 'Stock turns for the project’s active stores over the last 90 days.', owner: 'Stores', unit: 'turns per year', scale: 100,
    permission: 'inv.dashboard.view', sensitivePermission: 'inv.stock.values', exportPermission: 'inv.dashboard.export',
    flag: 'ff.inv.p1611', source: inventorySource, dataset: 'project-stock-ledger', register: 'inv.stock_ledger',
    sourceType: 'inv_project_stock_turns', route: '/inv/materials-dashboard', aggregate: true, usesSiteData: true },
  { code: 'ltifr', field: 'ltifr', name: 'Lost-time injury frequency rate', formula: 'Lost-time injuries and fatalities × configured rate base ÷ hours worked',
    definition: 'Lost-time injury frequency for the project using the HSE dashboard window and attendance hours.',
    owner: 'HSE', unit: 'rate', scale: 100, permission: 'hse.dashboard.view', exportPermission: 'hse.dashboard.export',
    flag: 'ff.hse.p1908', source: safetySource, dataset: 'project-safety-indicators', register: 'hse.dashboard',
    sourceType: 'hse_project_ltifr', route: '/hse/dashboard', aggregate: true, usesSiteData: true },
].map((definition) => Object.freeze({ ...definition, datasetVersion: 1 }));
const byCode = new Map(definitions.map((definition) => [definition.code, definition]));

export const domainHistoryCode = (code) => `bi.${code.replaceAll('-', '_')}_history`;
const historyColumns = [
  { key: 'period', label: 'Observed month', type: 'text', sql: 'r.period' },
  { key: 'value', label: 'Value', type: 'number', sql: 'o.value_scaled' },
  { key: 'sourcePeriod', label: 'Source period', type: 'text', sql: 'o.source_period' },
  { key: 'sourceId', label: 'Source record ID', type: 'number', sql: 'o.source_id' },
  { key: 'sourceVersion', label: 'Source revision', type: 'number', sql: 'o.source_version' },
  { key: 'capturedAt', label: 'Captured at', type: 'datetime', sql: 'r.captured_at' },
];
for (const { code, name } of definitions) {
  defineList({ code: domainHistoryCode(code), label: `${name} history`, managedViews: true,
    from: 'bi_domain_observations o JOIN bi_domain_refreshes r ON r.id = o.refresh_id',
    columns: {
      projectId: { sql: 'o.project_id', label: 'Project ID', type: 'number', sortable: false },
      ...Object.fromEntries(historyColumns.map(({ key, ...column }) => [key, { ...column, sortable: false, filterable: false }])),
    } });
}

const domainCaptureEvent = {
  type: 'object', required: ['code', 'period', 'rows', 'missing'],
  properties: { code: { type: 'string' }, period: { type: 'string' }, rows: { type: 'integer' }, missing: { type: 'integer' } },
};
eventTypes.define({ type: 'bi.domain_metric.captured', version: 1, schema: domainCaptureEvent,
  owner: 'bi', description: 'Monthly observations from an approved source were captured.' });

export function requireMetricCatalogueSource(context, actor) {
  requireMetricFlag(context, actor);
  requireReportRegistry(context, actor);
  if (!context.flags.isOn(actor, 'ff.bi.p2702')) throw notFound('The metric dataset is unavailable.');
}
const enabled = (context, actor, definition) =>
  Boolean(definition && context.flags.isOn(actor, definition.flag) && definition.source(context.db));

export function domainMetricDefinition(context, actor, code) {
  requireMetricCatalogueSource(context, actor);
  const definition = byCode.get(code);
  if (!enabled(context, actor, definition)) throw notFound('That metric is unavailable.');
  return definition;
}
const permissions = (definition) => ['bi.metric.catalogue.view', definition.permission, ...(definition.sensitivePermission ? [definition.sensitivePermission] : [])];
const canRead = (actor, definition) => permissions(definition).every((permission) => hasPermissionAnywhere(actor, permission));
const metadata = (definition) => ({
  code: definition.code, name: definition.name, definition: definition.definition, formula: definition.formula,
  unit: definition.unit, scale: definition.scale, grain: 'project', owner: definition.owner,
  refresh: { live: 'on demand', observations: 'monthly' },
  lineage: { dataset: definition.dataset, datasetVersion: definition.datasetVersion, source: definition.register, aggregate: Boolean(definition.aggregate) },
});
const display = (definition, value) => value == null ? null : value / definition.scale;
const sourceRoute = (definition, id, period) => {
  const params = definition.aggregate ? { ...definition.reportParams, projectId: id, ...(definition.code === 'dso' ? {} : { to: period }) }
    : { [definition.recordParam ?? 'id']: id };
  return `${definition.route}?${new URLSearchParams(params)}`;
};
const siteFilter = (authz, actor, key) => authz.scopeFilter(actor, key, { project: 's.org_project_id', site: 's.id' }).sql;
const scopedSites = (authz, actor, key, column) => `NOT EXISTS (
  SELECT 1 FROM org_sites s WHERE s.company_id = :company AND s.org_project_id = ${column}
   AND NOT (${siteFilter(authz, actor, key)}))`;
const projectScope = (authz, actor, definition) => permissions(definition).map((permission) => {
  assertPermissionAnywhere(actor, permission);
  const sql = authz.scopeFilter(actor, permission, { project: 'p.id' }).sql;
  return definition.usesSiteData ? `(${sql}) AND ${scopedSites(authz, actor, permission, 'p.id')}` : `(${sql})`;
}).join(' AND ');
const scopedProject = (db, actor, id, scope) => db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p
  WHERE p.company_id = :company AND p.id = :project AND p.deleted_at IS NULL AND (${scope})`)
  .get({ company: actor.companyId, project: id });
const mayExport = (context, actor, definition, projectId) => {
  const authz = authzOf(context.db);
  const key = definition.exportPermission;
  return authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed
    && (!definition.usesSiteData || context.db.prepare(`SELECT 1 WHERE ${scopedSites(authz, actor, key, ':project')}`)
      .get({ company: actor.companyId, project: projectId }));
};

export function listDomainMetrics(context, actor) {
  requireMetricCatalogueSource(context, actor);
  assertPermissionAnywhere(actor, 'bi.metric.catalogue.view');
  const canCertify = hasPermission(actor, 'bi.metric.certify');
  return definitions.filter((definition) => enabled(context, actor, definition) && (canRead(actor, definition) || canCertify))
    .map((definition) => ({ ...metadata(definition), certified: metricCertification(context.db, actor.companyId, definition.code, definition.datasetVersion)?.status === 'CERTIFIED',
      canRead: canRead(actor, definition) }));
}

export function readDomainMetric(context, actor, code, { projectId = null, search = '', certifiedOnly = false, includeHistory = true }) {
  assertPermissionAnywhere(actor, 'bi.metric.catalogue.view');
  const definition = domainMetricDefinition(context, actor, code);
  const { db } = context;
  const authz = authzOf(db);
  const info = { ...metadata(definition),
    certified: metricCertification(db, actor.companyId, code, definition.datasetVersion)?.status === 'CERTIFIED',
    canRead: canRead(actor, definition), canCertify: hasPermission(actor, 'bi.metric.certify') };
  if (certifiedOnly && !info.certified) throw notFound('This metric is awaiting certification.');
  if (!info.canRead) {
    if (projectId || !info.canCertify) throw forbidden('You do not have access to the source metric values.');
    return { ...info, projects: [], live: null, periods: [] };
  }

  const scope = projectScope(authz, actor, definition);
  if (!projectId) {
    const projects = db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p
      WHERE p.company_id = :company AND p.deleted_at IS NULL AND (${scope})
        AND (p.code LIKE :search ESCAPE '\\' OR p.name LIKE :search ESCAPE '\\') ORDER BY p.code, p.id LIMIT 50`)
      .all({ company: actor.companyId, search: likePattern(search ?? '') });
    return { ...info, projects, live: null, periods: [] };
  }
  const project = scopedProject(db, actor, projectId, scope);
  if (!project) throw notFound('That project is unavailable for this metric.');
  const resource = { companyId: actor.companyId, projectId };
  if (!permissions(definition).every((permission) => authz.check(actor, permission, resource).allowed)) {
    throw notFound('That project is unavailable for this metric.');
  }
  const source = definition.source(db);
  const [fact] = Array.from(source.approvedMetricFacts(actor.companyId, todayIST(), projectId));
  const value = (row) => ({ value: display(definition, row.valueScaled), sourceId: Number(row.sourceId),
    sourceVersion: row.sourceVersion, sourcePeriod: row.sourcePeriod, sourceRoute: sourceRoute(definition, row.sourceId, row.sourcePeriod) });
  const live = fact ? value({ ...fact, valueScaled: fact[definition.field] }) : null;
  const periods = includeHistory ? db.prepare(`SELECT r.period, r.captured_at AS capturedAt, o.value_scaled AS valueScaled,
      o.source_id AS sourceId, o.source_period AS sourcePeriod, o.source_version AS sourceVersion
    FROM bi_domain_observations o JOIN bi_domain_refreshes r ON r.id = o.refresh_id AND r.company_id = o.company_id
    WHERE o.company_id = ? AND o.project_id = ? AND r.metric_code = ? AND r.dataset_version = ?
      AND o.deleted_at IS NULL AND r.deleted_at IS NULL
    ORDER BY r.period DESC LIMIT 24`).all(actor.companyId, projectId, code, definition.datasetVersion)
    .map((row) => ({ period: row.period, capturedAt: row.capturedAt, ...value(row) })) : [];
  const canExport = info.certified && context.flags.isOn(actor, 'ff.ui.p0303')
    && Boolean(mayExport(context, actor, definition, projectId));
  return { ...info, project, live, periods, canExport };
}

export function registerDomainHistoryExports(context, exports) {
  for (const definition of definitions) {
    const { code, datasetVersion, exportPermission, name, unit } = definition;
    const authz = authzOf(context.db);
    const scope = (actor, projectId) => {
      domainMetricDefinition(context, actor, code);
      const certification = metricCertification(context.db, actor.companyId, code, datasetVersion);
      if (!context.flags.isOn(actor, 'ff.ui.p0303') || certification?.status !== 'CERTIFIED') {
        throw notFound('Certified metric exports are unavailable.');
      }
      assertPermissionAnywhere(actor, exportPermission);
      const sourceScope = projectScope(authz, actor, definition);
      if (!Number.isSafeInteger(projectId) || projectId < 1
        || !scopedProject(context.db, actor, projectId, sourceScope) || !mayExport(context, actor, definition, projectId)) {
        throw notFound('That project is unavailable for this export.');
      }
      return JSON.stringify({ companyId: actor.companyId, projectId, certification: certification.version });
    };
    exports.register(domainHistoryCode(code), (actor, request) => {
      const projectId = Number(request.filters[0]?.raw);
      if (request.filters.length !== 1 || request.filters[0].key !== 'projectId' || request.filters[0].op !== 'eq'
        || !Number.isSafeInteger(projectId) || projectId < 1) {
        throw badRequest('Select one project to export this metric.');
      }
      scope(actor, projectId);
      const metric = readDomainMetric(context, actor, code, { projectId, certifiedOnly: true });
      if (!('project' in metric)) throw notFound('That project is unavailable for this export.');
      const { project, periods } = metric;
      const columns = historyColumns.map((column) => {
        if (column.key === 'value') return { ...column, label: `Value (${unit})` };
        if (definition.aggregate && column.key === 'sourceId') return { ...column, label: 'Source project ID' };
        if (definition.aggregate && column.key === 'sourceVersion') return { ...column, label: 'Source calculation version' };
        return column;
      });
      return { title: `Certified ${name} history`, permission: exportPermission, personal: false, columns,
        count: () => periods.length, rows: () => periods, describe: () => [`Project ${project.code}`, `Dataset version ${datasetVersion}`] };
    }, { checkAccess: (actor, query) => scope(actor, Number(query['filter[projectId]'])) });
  }
}

export function readDomainQuality(context, actor) {
  requireMetricCatalogueSource(context, actor);
  assertPermission(actor, 'bi.snapshot.run');
  const current = todayIST().slice(0, 7);
  return definitions.filter((definition) => enabled(context, actor, definition)).map((definition) => {
    const row = context.db.prepare(`SELECT r.period, r.captured_at AS capturedAt, r.row_count AS rows, r.missing_count AS missing,
      (SELECT COUNT(*) FROM bi_domain_observations o WHERE o.company_id = r.company_id AND o.refresh_id = r.id AND o.deleted_at IS NULL) AS stored,
      (SELECT COUNT(*) FROM bi_domain_observations o WHERE o.company_id = r.company_id AND o.refresh_id = r.id AND o.deleted_at IS NULL AND o.value_scaled IS NULL) AS storedMissing
      FROM bi_domain_refreshes r WHERE r.company_id = ? AND r.metric_code = ? AND r.dataset_version = ? AND r.deleted_at IS NULL
      ORDER BY r.period DESC LIMIT 1`).get(actor.companyId, definition.code, definition.datasetVersion);
    if (!row) return { code: definition.code, name: definition.name, freshness: 'MISSING' };
    const { stored, storedMissing, ...observation } = row;
    return { code: definition.code, name: definition.name, ...observation, freshness: row.period === current ? 'CURRENT' : 'STALE',
      completeness: stored !== row.rows || storedMissing !== row.missing ? 'MISMATCH'
        : row.rows === 0 ? 'NO_DATA' : row.missing ? 'INCOMPLETE' : 'COMPLETE' };
  });
}

export function registerDomainMetricWidgets(contextOf) {
  for (const definition of definitions) {
    const { code, datasetVersion, name, unit } = definition;
    const widgetCode = `bi.${code.replaceAll('-', '_')}`;
    widgetRegistry.register({
      code: widgetCode,
      available(db, actor) {
        const context = contextOf(db);
        if (!context || !canRead(actor, definition)) return false;
        try {
          domainMetricDefinition(context, actor, code);
          return metricCertification(db, actor.companyId, code, datasetVersion)?.status === 'CERTIFIED';
        } catch (error) {
          if (error.status === 404) return false;
          throw error;
        }
      },
      provider({ db, actor, filters }) {
        if (!filters.projectId || filters.siteId) return { empty: true, emptyTitle: 'Select a project', emptyText: 'This metric uses project-level source records.' };
        const metric = readDomainMetric(contextOf(db), actor, code, { projectId: filters.projectId, certifiedOnly: true, includeHistory: false });
        return { label: name, value: metric.live?.value ?? null, ...(unit === 'INR' ? { kind: 'money', currency: 'INR' } : { unit, decimals: Math.log10(definition.scale) }),
          subtitle: metric.live?.sourcePeriod, drill: metric.live?.sourceRoute };
      },
    });
    registerProject360Widget(widgetCode, ({ db, actor, project, period, forExport }) => {
      const context = contextOf(db);
      if (!context || !canRead(actor, definition)) return null;
      if (forExport && !mayExport(context, actor, definition, project.project_id)) return null;
      const current = period.period === todayIST().slice(0, 7);
      try {
        const metric = readDomainMetric(context, actor, code, {
          projectId: project.project_id, certifiedOnly: true, includeHistory: !current,
        });
        const observation = current ? metric.live : metric.periods.find((row) => row.period === period.period);
        return { figures: [{
          key: code, label: unit === 'INR' ? `${name} (₹)` : unit === '%' ? `${name} (%)` : name, value: observation?.value ?? null,
          drill: observation?.sourceRoute ?? null,
        }], note: observation ? `Source period ${observation.sourcePeriod}` : 'No observation for the selected month.' };
      } catch (error) {
        if (error.status === 404) return null;
        throw error;
      }
    });
  }
}

/** Owner-approved facts only. The existing queue calls this for a single authorized company. */
export function captureDomainMetrics(context, companyId) {
  const actor = { companyId, user: 'scheduler' };
  requireMetricCatalogueSource(context, actor);
  const { db } = context;
  const date = todayIST();
  const period = date.slice(0, 7);
  let captured = 0;
  // SPI and CPI share one source query, while each metric retains its own version and quality.
  for (const owner of new Set(definitions.map((definition) => definition.source))) {
    const metrics = definitions.filter((definition) => definition.source === owner && enabled(context, actor, definition));
    if (!metrics.length) continue;
    captured += transaction(db, () => {
      const opened = metrics.flatMap((definition) => {
        const insert = db.prepare(`INSERT INTO bi_domain_refreshes
          (company_id, metric_code, dataset_version, period, captured_at, created_by, source_id)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(company_id,metric_code,dataset_version,period) DO NOTHING`)
          .run(companyId, definition.code, definition.datasetVersion, period, new Date().toISOString(), actor.user, period);
        return insert.changes ? [{ definition, id: Number(insert.lastInsertRowid), missing: 0 }] : [];
      });
      if (!opened.length) return 0;
      const add = db.prepare(`INSERT INTO bi_domain_observations
        (company_id, refresh_id, project_id, value_scaled, source_period, source_version, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      let rows = 0;
      for (const fact of owner(db).approvedMetricFacts(companyId, date)) {
        for (const observation of opened) {
          const { definition } = observation;
          const value = fact[definition.field];
          if (value == null) observation.missing += 1;
          add.run(companyId, observation.id, fact.projectId, value ?? null, fact.sourcePeriod, fact.sourceVersion,
            actor.user, definition.sourceType, String(fact.sourceId));
        }
        rows += 1;
      }
      for (const { definition, id, missing } of opened) {
        db.prepare('UPDATE bi_domain_refreshes SET row_count = ?, missing_count = ? WHERE id = ?').run(rows, missing, id);
        const data = { code: definition.code, period, rows, missing };
        writeAudit(db, { companyId, entity: 'bi_domain_refreshes', entityId: id, action: 'capture', newValues: data, actor: actor.user });
        publishEvent(db, { type: 'bi.domain_metric.captured', entity: 'bi_domain_refreshes', entityId: id, actorId: actor.user, companyId, data });
      }
      return opened.length;
    });
  }
  return captured;
}
