import { createApprovalEngine } from '../../platform/approvals/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { writeExport, FORMATS } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createFlagService } from '../core/feature-flags/service.js';
import { siteOf } from '../site/index.js';
import { readPortfolioMetrics, requireMetricCatalogueSource } from './domain-metrics.js';

/**
 * Part 27.04 — the enterprise project control tower and the executive dashboard.
 *
 * Every tile reads the certified metrics of 27.03 (BR-01): a metric that is not certified shows no figure. The health matrix gives each project
 * a RAG status on time (SPI), cost (CPI and EAC growth), quality, safety (LTIFR) and cash (DSO). The early-warning rules (FR-03) run as a daily
 * job, on demand and on the events of their sources; each breach raises one executive alert (`exec_alerts`) with an owner, a task (04.08), a
 * notification (04.06) and an event. An alert clears itself when its condition clears and is never raised twice for the same evidence.
 * Thresholds change only through a maker-checker request (DIR or CFO approves; the requester never approves their own) and are audited.
 */

export const TOWER_FLAG = 'ff.bi.p2704';
const SETTINGS_TYPE = 'bi_exec_alert_settings';
const EVALUATE_JOB = 'bi.exec_alerts.evaluate';
export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'RESOLVED'];
export const SEVERITIES = ['INFO', 'WARNING', 'CRITICAL'];
export const DIMENSIONS = ['time', 'cost', 'quality', 'safety', 'cash'];
const RAG_ORDER = { NONE: 0, GREEN: 1, AMBER: 2, RED: 3 };

/** The early-warning rules (FR-03). `metric` names the certified 27.03 metric; `periods` applies to the index rules. */
export const RULES = Object.freeze([
  { code: 'SPI_LOW', name: 'Schedule performance below threshold', dimension: 'time', metric: 'spi', unit: 'ratio', min: 0.1, max: 1.5,
    defaults: { threshold: 0.9, periods: 2, severity: 'CRITICAL', enabled: true }, usesPeriods: true },
  { code: 'CPI_LOW', name: 'Cost performance below threshold', dimension: 'cost', metric: 'cpi', unit: 'ratio', min: 0.1, max: 1.5,
    defaults: { threshold: 0.9, periods: 2, severity: 'WARNING', enabled: true }, usesPeriods: true },
  { code: 'EAC_GROWTH', name: 'Estimate at completion growing', dimension: 'cost', metric: 'eac', unit: '%', min: 0.5, max: 100,
    defaults: { threshold: 5, periods: 1, severity: 'WARNING', enabled: true } },
  { code: 'COLLECTIONS_OVERDUE', name: 'Collections overdue', dimension: 'cash', metric: 'dso', unit: 'days', min: 15, max: 365,
    defaults: { threshold: 90, periods: 1, severity: 'WARNING', enabled: true } },
  { code: 'CASH_NEGATIVE', name: 'Cash negative in the 13-week forecast', dimension: 'cash', metric: null, unit: 'INR', min: -1e12, max: 1e12,
    defaults: { threshold: 0, periods: 1, severity: 'CRITICAL', enabled: true }, companyLevel: true },
  { code: 'LTI', name: 'Lost-time injury', dimension: 'safety', metric: 'ltifr', unit: 'rate', min: 0, max: 100,
    defaults: { threshold: 0, periods: 1, severity: 'CRITICAL', enabled: true } },
  { code: 'MATERIAL_SHORTAGE', name: 'Late material shortage', dimension: 'time', metric: null, unit: 'shortages', min: 1, max: 100,
    defaults: { threshold: 1, periods: 1, severity: 'WARNING', enabled: true }, eventDriven: true },
].map((rule) => Object.freeze(rule)));
const ruleOf = (code) => RULES.find((rule) => rule.code === code);

/** The KPI tiles of the executive dashboard, each from one certified metric. */
export const TILES = Object.freeze([
  { key: 'eac', metric: 'eac', label: 'Portfolio EAC', aggregate: 'sum', kind: 'money', better: 'down', hero: true },
  { key: 'revenue', metric: 'revenue-to-date', label: 'Revenue to date', aggregate: 'sum', kind: 'money', better: 'up' },
  { key: 'margin', metric: 'gross-margin', label: 'Gross margin', aggregate: 'mean', kind: 'percent', unit: '%', better: 'up' },
  { key: 'spi', metric: 'spi', label: 'Schedule performance (SPI)', aggregate: 'mean', kind: 'time', better: 'up', rule: 'SPI_LOW' },
  { key: 'cpi', metric: 'cpi', label: 'Cost performance (CPI)', aggregate: 'mean', kind: 'money', better: 'up', rule: 'CPI_LOW' },
  { key: 'dso', metric: 'dso', label: 'Days sales outstanding', aggregate: 'mean', kind: 'time', unit: 'days', better: 'down', rule: 'COLLECTIONS_OVERDUE' },
  { key: 'ltifr', metric: 'ltifr', label: 'Lost-time injury frequency', aggregate: 'mean', kind: 'safety', better: 'down', rule: 'LTI' },
  { key: 'stock', metric: 'stock-turns', label: 'Stock turns', aggregate: 'mean', kind: 'quantity', unit: 'turns/yr', better: 'up' },
].map((tile) => Object.freeze(tile)));
const METRIC_CODES = [...new Set(TILES.map((tile) => tile.metric))];

const round = (value, places = 4) => (value == null || Number.isNaN(value) ? null : Math.round(value * 10 ** places) / 10 ** places);
const settingsShape = { type: 'object', required: ['ruleCode', 'version'], properties: { ruleCode: { type: 'string' }, version: { type: 'integer' }, requestId: { type: 'integer' } } };
const alertShape = { type: 'object', required: ['alertNo', 'ruleCode', 'severity'], properties: { alertNo: { type: 'string' }, ruleCode: { type: 'string' }, severity: { type: 'string' }, status: { type: 'string' } } };
eventTypes.define({ type: 'bi.exec_alert.raised', version: 1, schema: alertShape, owner: 'bi',
  description: 'An executive early-warning alert was raised by the control tower (part 27.04 FR-03): data { alertNo, ruleCode, severity, projectId, status }. The morning report (27.05) reads it.' });
eventTypes.define({ type: 'bi.exec_alert.resolved', version: 1, schema: alertShape, owner: 'bi',
  description: 'An executive alert was resolved, by a person or because its condition cleared (part 27.04).' });
eventTypes.define({ type: 'bi.exec_alert.acknowledged', version: 1, schema: alertShape, owner: 'bi',
  description: 'An executive alert was acknowledged by its owner or an executive (part 27.04).' });
eventTypes.define({ type: 'bi.exec_alert.settings_changed', version: 1, schema: settingsShape, owner: 'bi',
  description: 'An early-warning threshold change was approved (maker-checker, part 27.04).' });

/** The thresholds in force for a company: the latest approved row per rule, else the rule's defaults. */
export function currentSettings(db, companyId) {
  const rows = db.prepare(`SELECT s.* FROM exec_alert_settings s WHERE s.company_id = ? AND s.deleted_at IS NULL
    AND s.version = (SELECT MAX(t.version) FROM exec_alert_settings t WHERE t.company_id = s.company_id AND t.rule_code = s.rule_code AND t.deleted_at IS NULL)`)
    .all(companyId);
  const byCode = new Map(rows.map((row) => [row.rule_code, row]));
  return RULES.map((rule) => {
    const row = byCode.get(rule.code);
    return { code: rule.code, name: rule.name, dimension: rule.dimension, metric: rule.metric, unit: rule.unit, min: rule.min, max: rule.max,
      usesPeriods: Boolean(rule.usesPeriods), companyLevel: Boolean(rule.companyLevel), eventDriven: Boolean(rule.eventDriven),
      enabled: row ? row.enabled === 1 : rule.defaults.enabled, threshold: row ? Number(row.threshold) : rule.defaults.threshold,
      periods: row ? row.periods : rule.defaults.periods, severity: row?.severity ?? rule.defaults.severity,
      version: row?.version ?? 0, approvedBy: row?.created_by ?? null, approvedAt: row?.created_at ?? null, requestId: row?.request_id ?? null };
  });
}

const contexts = new WeakMap();
const contextOf = (db, environment) => contexts.get(db) ?? { db, flags: createFlagService({ db, environment }) };

export const towerApprovalHandlers = (environment) => ({
  [SETTINGS_TYPE]: {
    authorize(db, actor) {
      requireTower(contextOf(db, environment), actor);
      if (!hasPermissionAnywhere(actor, 'bi.exec_alert.configure')) throw forbidden('Your role does not include bi.exec_alert.configure.');
    },
    apply(db, request, actor) {
      const { ruleCode, enabled, threshold, periods, severity, baseVersion } = request.payload;
      const current = currentSettings(db, request.companyId).find((row) => row.code === ruleCode);
      if (!current) throw notFound('That early-warning rule does not exist.');
      if (current.version !== baseVersion) throw conflict('The rule changed after this request was raised. Raise a new request.');
      const version = baseVersion + 1;
      db.prepare(`INSERT INTO exec_alert_settings (company_id, rule_code, enabled, threshold, periods, severity, request_id, version, created_by, source_type, source_id, remarks)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'change_request', ?, ?)`)
        .run(request.companyId, ruleCode, enabled ? 1 : 0, threshold, periods, severity, request.id, version, actor.user, String(request.id), request.reason);
      writeAudit(db, { companyId: request.companyId, entity: 'exec_alert_settings', entityId: ruleCode, action: 'settings_change',
        oldValues: { enabled: current.enabled, threshold: current.threshold, periods: current.periods, severity: current.severity, version: current.version },
        newValues: { enabled, threshold, periods, severity, version, requestId: request.id, requestedBy: request.requestedBy }, actor: actor.user });
      publishEvent(db, { type: 'bi.exec_alert.settings_changed', entity: 'exec_alert_settings', entityId: ruleCode, actorId: actor.user,
        companyId: request.companyId, data: { ruleCode, version, requestId: request.id } });
    },
  },
});

export function requireTower(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, TOWER_FLAG)) {
    throw notFound('The control tower is unavailable.');
  }
  requireMetricCatalogueSource(context, actor);
}

const ragOf = (value, red, amber, higherIsBetter = true) => {
  if (value == null) return 'NONE';
  if (higherIsBetter) return value < red ? 'RED' : value < amber ? 'AMBER' : 'GREEN';
  return value > red ? 'RED' : value > amber ? 'AMBER' : 'GREEN';
};
const worst = (...states) => states.reduce((a, b) => (RAG_ORDER[b] > RAG_ORDER[a] ? b : a), 'NONE');
const growthOf = (metric) => (metric?.value != null && metric.previous?.value ? round(((metric.value - metric.previous.value) * 100) / metric.previous.value, 2) : null);

/** The RAG of one project on each dimension, from its certified metrics and the thresholds in force. */
export function healthOf(values, settings) {
  const t = Object.fromEntries(settings.map((row) => [row.code, row]));
  const time = ragOf(values.spi?.value, t.SPI_LOW.threshold, t.SPI_LOW.threshold + 0.05);
  const cpi = ragOf(values.cpi?.value, t.CPI_LOW.threshold, t.CPI_LOW.threshold + 0.05);
  const growth = growthOf(values.eac);
  const eac = growth == null ? 'NONE' : ragOf(growth, t.EAC_GROWTH.threshold, t.EAC_GROWTH.threshold / 2, false);
  const safety = values.ltifr?.value == null ? 'NONE' : values.ltifr.value > t.LTI.threshold ? 'RED' : 'GREEN';
  const cash = ragOf(values.dso?.value, t.COLLECTIONS_OVERDUE.threshold, (t.COLLECTIONS_OVERDUE.threshold * 2) / 3, false);
  const rag = { time, cost: worst(cpi, eac), quality: 'NONE', safety, cash };
  return { ...rag, overall: worst(...Object.values(rag)), eacGrowth: growth };
}

export function createControlTower(context, { jobs, scheduler, bus, environment }) {
  const { db } = context;
  contexts.set(db, context);
  const authz = authzOf(db);
  const approvals = createApprovalEngine({ db, handlers: towerApprovalHandlers(environment) });
  const notify = notificationsOf(db);

  const guard = (actor, permission) => {
    requireTower(context, actor);
    assertPermissionAnywhere(actor, permission);
  };
  const towerScope = (actor, column = 'p.id') => authz.scopeFilter(actor, 'bi.control_tower.view', { project: column }).sql;
  const companyWide = (actor, permission) => authz.check(actor, permission, { companyId: actor.companyId }).allowed;

  /** The projects of the tower in the actor's scope, with the attributes the filters use. */
  function projectsInScope(actor, filters = {}) {
    const where = ['p.company_id = :company', 'p.deleted_at IS NULL', "p.status IN ('ACTIVE', 'ON_HOLD')", `(${towerScope(actor)})`];
    const params = { company: actor.companyId };
    if (filters.regionId) { where.push('(p.branch_id = :region OR b.parent_id = :region)'); params.region = filters.regionId; }
    if (filters.sector) { where.push('x.sector = :sector'); params.sector = filters.sector; }
    if (filters.pm) { where.push('x.pm_user = :pm'); params.pm = filters.pm; }
    if (filters.search) { where.push("(p.code LIKE :search ESCAPE '\\' OR p.name LIKE :search ESCAPE '\\')"); params.search = `%${filters.search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`; }
    return db.prepare(`SELECT p.id, p.code, p.name, p.status, p.branch_id AS branchId, b.name AS region, x.sector, x.pm_user AS pm, x.director_user AS director,
        x.lifecycle_state AS lifecycle
      FROM org_projects p
      LEFT JOIN org_branches b ON b.id = p.branch_id
      LEFT JOIN proj_projects x ON x.project_id = p.id AND x.deleted_at IS NULL
      WHERE ${where.join(' AND ')} ORDER BY p.code, p.id`).all(params);
  }

  const latestCashForecast = (companyId) => {
    const row = db.prepare(`SELECT id, payload, created_at FROM core_outbox WHERE event_type = 'fin.cash_forecast.published'
      AND json_extract(payload, '$.companyId') = ? ORDER BY id DESC LIMIT 1`).get(companyId);
    if (!row) return null;
    const data = JSON.parse(row.payload).data ?? {};
    return { forecastId: data.forecastId, docNo: data.docNo, weekStart: data.weekStart, weeks: data.weeks, opening: data.opening, closing: data.closing,
      lowest: data.lowest, lowestWeek: data.lowestWeek, publishedAt: row.created_at, route: '/finance/treasury', eventId: row.id };
  };

  /** FR-01, FR-02: the executive dashboard and the health matrix. */
  function portfolio(actor, query = {}) {
    guard(actor, 'bi.control_tower.view');
    const settings = currentSettings(db, actor.companyId);
    const all = projectsInScope(actor, query);
    const { evaluatedAt, metrics } = readPortfolioMetrics(context, actor, { codes: METRIC_CODES, projectIds: all.map((p) => p.id) });
    const byMetric = new Map(metrics.map((metric) => [metric.code, metric]));
    const valuesOf = (id) => Object.fromEntries(['spi', 'cpi', 'eac', 'dso', 'ltifr', 'gross-margin', 'revenue-to-date', 'stock-turns']
      .map((code) => [code === 'gross-margin' ? 'margin' : code === 'revenue-to-date' ? 'revenue' : code === 'stock-turns' ? 'stock' : code,
        byMetric.get(code)?.projects.get(id) ?? null]));
    const openAlerts = alertCounts(actor);
    let rows = all.map((project) => {
      const values = valuesOf(project.id);
      const health = healthOf(values, settings);
      const figure = (metric) => (metric ? { value: metric.value, sourcePeriod: metric.sourcePeriod, sourceRoute: metric.sourceRoute, previous: metric.previous?.value ?? null } : null);
      return { projectId: project.id, code: project.code, name: project.name, region: project.region, sector: project.sector, pm: project.pm,
        lifecycle: project.lifecycle, health, alerts: openAlerts.byProject.get(project.id) ?? 0,
        metrics: Object.fromEntries(Object.entries(values).map(([key, metric]) => [key, figure(metric)])),
        drill: `/bi/control-tower?tab=matrix&projectId=${project.id}`, project360: `/proj/project-360?projectId=${project.id}` };
    });
    if (query.rag) rows = rows.filter((row) => row.health.overall === query.rag);
    if (query.dimension && query.dimensionRag) rows = rows.filter((row) => row.health[query.dimension] === query.dimensionRag);
    const sortKey = query.sort ?? 'overall';
    rows.sort((a, b) => (sortKey === 'overall' ? RAG_ORDER[b.health.overall] - RAG_ORDER[a.health.overall]
      : (a.metrics[sortKey]?.value ?? Infinity) - (b.metrics[sortKey]?.value ?? Infinity)) || a.code.localeCompare(b.code));
    const inMatrix = new Set(rows.map((row) => row.projectId));
    const tiles = TILES.map((tile) => tileOf(tile, byMetric.get(tile.metric), inMatrix, settings));
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? 25), 1), 100);
    const page = Math.max(Number(query.page ?? 1), 1);
    const distribution = Object.fromEntries(['RED', 'AMBER', 'GREEN', 'NONE'].map((state) => [state, rows.filter((row) => row.health.overall === state).length]));
    const dimensions = Object.fromEntries(DIMENSIONS.map((dimension) => [dimension,
      Object.fromEntries(['RED', 'AMBER', 'GREEN', 'NONE'].map((state) => [state, rows.filter((row) => row.health[dimension] === state).length]))]));
    const cashVisible = context.flags.isOn(actor, 'ff.fin.p2313') && companyWide(actor, 'fin.cash_forecast.view');
    const lastCapturedAt = metrics.map((metric) => metric.lastCapturedAt).filter(Boolean).sort().at(-1) ?? null;
    return {
      asOf: todayIST(), evaluatedAt, lastCapturedAt, filters: { regionId: query.regionId ?? null, sector: query.sector ?? null, pm: query.pm ?? null, rag: query.rag ?? null },
      tiles, distribution, dimensions,
      matrix: { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize },
      alerts: { open: openAlerts.open, critical: openAlerts.critical, top: alertsList(actor, { status: 'OPEN', pageSize: 5 }).rows },
      cash: cashVisible ? latestCashForecast(actor.companyId) : null, cashMasked: !cashVisible,
      pending: pendingFor(actor),
      options: filterOptions(actor),
      uncertified: metrics.filter((metric) => !metric.certified).map((metric) => ({ code: metric.code, name: metric.name })),
      can: { configure: hasPermissionAnywhere(actor, 'bi.exec_alert.configure'), run: hasPermissionAnywhere(actor, 'bi.exec_alert.run'),
        manage: hasPermissionAnywhere(actor, 'bi.exec_alert.manage'), export: hasPermissionAnywhere(actor, 'bi.control_tower.export') },
    };
  }

  function tileOf(tile, metric, inMatrix, settings) {
    const base = { key: tile.key, metric: tile.metric, label: tile.label, kind: tile.kind, unit: tile.unit ?? metric?.unit ?? null, hero: Boolean(tile.hero),
      aggregate: tile.aggregate, better: tile.better, drill: `/bi/control-tower?tab=matrix&sort=${tile.key}` };
    if (!metric) return { ...base, state: 'UNAVAILABLE', value: null };
    if (!metric.certified) return { ...base, state: 'UNCERTIFIED', value: null, catalogue: '/bi/metrics' };
    if (!metric.canRead) return { ...base, state: 'MASKED', value: null };
    const entries = [...metric.projects.entries()].filter(([id, entry]) => inMatrix.has(id) && entry.value != null);
    const fold = (list) => (!list.length ? null : tile.aggregate === 'sum' ? round(list.reduce((a, b) => a + b, 0), 2)
      : round(list.reduce((a, b) => a + b, 0) / list.length, 4));
    const value = fold(entries.map(([, entry]) => entry.value));
    // the trend compares like with like: only when every project of the tile was also captured last month
    const previous = entries.length && entries.every(([, entry]) => entry.lastMonth != null) ? fold(entries.map(([, entry]) => entry.lastMonth)) : null;
    const rule = tile.rule ? settings.find((row) => row.code === tile.rule) : null;
    let tone = 'neutral';
    if (rule && value != null) {
      if (tile.key === 'spi' || tile.key === 'cpi') tone = value < rule.threshold ? 'error' : value < rule.threshold + 0.05 ? 'warning' : 'success';
      else if (tile.key === 'dso') tone = value > rule.threshold ? 'error' : value > (rule.threshold * 2) / 3 ? 'warning' : 'success';
      else if (tile.key === 'ltifr') tone = value > rule.threshold ? 'error' : 'success';
    }
    return { ...base, state: entries.length ? 'OK' : 'NO_DATA', value, projects: entries.length, previous, target: rule ? rule.threshold : null, tone,
      certified: true, certificationVersion: metric.certificationVersion, evaluatedAt: metric.evaluatedAt, lastCapturedAt: metric.lastCapturedAt,
      exact: entries.map(([id, entry]) => ({ projectId: id, value: entry.value, sourceRoute: entry.sourceRoute })) };
  }

  function filterOptions(actor) {
    const projects = projectsInScope(actor);
    const regions = db.prepare(`SELECT id, code, name FROM org_branches WHERE company_id = ? AND status = 'ACTIVE' ORDER BY name`).all(actor.companyId)
      .filter((branch) => projects.some((p) => p.branchId === branch.id) || db.prepare('SELECT 1 FROM org_branches c WHERE c.parent_id = ? LIMIT 1').get(branch.id));
    return { regions, sectors: [...new Set(projects.map((p) => p.sector).filter(Boolean))].sort(), pms: [...new Set(projects.map((p) => p.pm).filter(Boolean))].sort() };
  }

  // ---------------------------------------------------------------- FR-04: project → WBS → transaction
  function project(actor, projectId) {
    guard(actor, 'bi.control_tower.view');
    const [row] = projectsInScope(actor).filter((p) => p.id === projectId);
    if (!row) throw notFound('That project is not in your control tower.');
    const settings = currentSettings(db, actor.companyId);
    const { metrics } = readPortfolioMetrics(context, actor, { codes: METRIC_CODES, projectIds: [projectId] });
    const values = {};
    const figures = metrics.map((metric) => {
      const entry = metric.projects.get(projectId) ?? null;
      values[{ 'gross-margin': 'margin', 'revenue-to-date': 'revenue', 'stock-turns': 'stock' }[metric.code] ?? metric.code] = entry;
      return { code: metric.code, name: metric.name, unit: metric.unit, certified: metric.certified, masked: metric.certified && !metric.canRead,
        value: entry?.value ?? null, sourcePeriod: entry?.sourcePeriod ?? null, sourceRoute: entry?.sourceRoute ?? null,
        previous: entry?.previous ?? null, history: entry?.earlier ?? [] };
    });
    const health = healthOf(values, settings);
    // WBS level: the snapshot of the approved progress period behind the SPI (the owner's service, with its own permission and cost masking)
    let wbs = null;
    const spi = values.spi;
    const progress = siteOf(db)?.progressSvc;
    if (spi?.sourceId && progress && hasPermissionAnywhere(actor, 'site.period.view')) {
      try {
        const period = progress.periods.get(actor, spi.sourceId);
        wbs = { periodId: period.id, docNo: period.docNo, periodEnd: period.periodEnd, route: `/site/periods?id=${period.id}`,
          rows: (period.snapshot?.wbs ?? []).map((node) => ({ code: node.code, name: node.name, level: node.level, planned: node.planned, physical: node.physical,
            spi: node.spi, ev: node.ev ?? null, pv: node.pv ?? null, route: `/site/periods?id=${period.id}&wbs=${encodeURIComponent(node.code)}` })) };
      } catch (error) {
        if (![403, 404].includes(error.status)) throw error;
      }
    }
    return { projectId: row.id, code: row.code, name: row.name, region: row.region, sector: row.sector, pm: row.pm, lifecycle: row.lifecycle,
      health, metrics: figures, wbs, alerts: alertsList(actor, { projectId, status: 'ACTIVE', pageSize: 20 }).rows,
      project360: `/proj/project-360?projectId=${row.id}` };
  }

  // ---------------------------------------------------------------- alerts (the worklist)
  const alertScope = (actor, permission = 'bi.exec_alert.view') => {
    const scoped = authz.scopeFilter(actor, permission, { project: 'a.project_id' }).sql;
    return `((a.project_id IS NOT NULL AND ${scoped}) OR (a.project_id IS NULL AND ${companyWide(actor, permission) ? '1 = 1' : '1 = 0'}))`;
  };
  const presentAlert = (row) => ({ id: row.id, alertNo: row.alert_no, ruleCode: row.rule_code, rule: ruleOf(row.rule_code)?.name ?? row.rule_code,
    dimension: row.dimension, projectId: row.project_id, project: row.project_code ? `${row.project_code} ${row.project_name}` : null,
    severity: row.severity, message: row.message, observed: row.observed_value == null ? null : Number(row.observed_value),
    threshold: row.threshold == null ? null : Number(row.threshold), raisedAt: row.raised_at, lastSeenAt: row.last_seen_at, occurrences: row.occurrences,
    owner: row.owner_user, status: row.status, acknowledgedBy: row.acknowledged_by, acknowledgedAt: row.acknowledged_at,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at, resolution: row.resolution, taskId: row.task_id,
    taskRoute: row.task_id ? `/tasks/task?id=${row.task_id}` : null, route: row.route, sourceType: row.source_type, sourceId: row.source_id, version: row.version });
  const SELECT_ALERT = `SELECT a.*, p.code AS project_code, p.name AS project_name FROM exec_alerts a LEFT JOIN org_projects p ON p.id = a.project_id`;

  function alertsList(actor, query = {}) {
    guard(actor, 'bi.exec_alert.view');
    const where = ['a.company_id = :company', 'a.deleted_at IS NULL', alertScope(actor)];
    const params = { company: actor.companyId };
    if (query.status === 'ACTIVE') where.push("a.status IN ('OPEN', 'ACKNOWLEDGED')");
    else if (query.status) { where.push('a.status = :status'); params.status = query.status; }
    if (query.severity) { where.push('a.severity = :severity'); params.severity = query.severity; }
    if (query.ruleCode) { where.push('a.rule_code = :rule'); params.rule = query.ruleCode; }
    if (query.projectId) { where.push('a.project_id = :project'); params.project = Number(query.projectId); }
    if (query.mine) { where.push('a.owner_user = :me'); params.me = actor.user; }
    const pageSize = Math.min(Math.max(Number(query.pageSize ?? 25), 1), 100);
    const page = Math.max(Number(query.page ?? 1), 1);
    const total = db.prepare(`SELECT COUNT(*) AS n FROM exec_alerts a WHERE ${where.join(' AND ')}`).get(params).n;
    const rows = db.prepare(`${SELECT_ALERT} WHERE ${where.join(' AND ')}
      ORDER BY CASE a.status WHEN 'OPEN' THEN 0 WHEN 'ACKNOWLEDGED' THEN 1 ELSE 2 END, CASE a.severity WHEN 'CRITICAL' THEN 0 WHEN 'WARNING' THEN 1 ELSE 2 END, a.raised_at DESC, a.id DESC
      LIMIT :limit OFFSET :offset`).all({ ...params, limit: pageSize, offset: (page - 1) * pageSize });
    return { rows: rows.map(presentAlert), total, page, pageSize };
  }

  function alertCounts(actor) {
    if (!hasPermissionAnywhere(actor, 'bi.exec_alert.view')) return { open: 0, critical: 0, byProject: new Map() };
    const rows = db.prepare(`SELECT a.project_id AS projectId, a.severity, COUNT(*) AS n FROM exec_alerts a
      WHERE a.company_id = :company AND a.deleted_at IS NULL AND a.status IN ('OPEN', 'ACKNOWLEDGED') AND ${alertScope(actor)}
      GROUP BY a.project_id, a.severity`).all({ company: actor.companyId });
    const byProject = new Map();
    for (const row of rows) if (row.projectId) byProject.set(row.projectId, (byProject.get(row.projectId) ?? 0) + row.n);
    return { open: rows.reduce((a, r) => a + r.n, 0), critical: rows.filter((r) => r.severity === 'CRITICAL').reduce((a, r) => a + r.n, 0), byProject };
  }

  function pendingFor(actor) {
    const mine = hasPermissionAnywhere(actor, 'bi.exec_alert.view') ? alertsList(actor, { status: 'OPEN', mine: true, pageSize: 5 }) : { rows: [], total: 0 };
    const approvalsWaiting = hasPermissionAnywhere(actor, 'bi.exec_alert.configure')
      ? approvals.awaiting(actor).filter((request) => request.type === SETTINGS_TYPE) : [];
    return { alerts: mine.rows, alertsTotal: mine.total, approvals: approvalsWaiting };
  }

  const alertRow = (actor, id) => {
    const row = db.prepare(`${SELECT_ALERT} WHERE a.id = :id AND a.company_id = :company AND a.deleted_at IS NULL AND ${alertScope(actor, 'bi.exec_alert.manage')}`)
      .get({ id, company: actor.companyId });
    if (!row) throw notFound('That executive alert does not exist or is outside your scope.');
    return row;
  };

  function getAlert(actor, id) {
    guard(actor, 'bi.exec_alert.view');
    const row = db.prepare(`${SELECT_ALERT} WHERE a.id = :id AND a.company_id = :company AND a.deleted_at IS NULL AND ${alertScope(actor)}`)
      .get({ id, company: actor.companyId });
    if (!row) throw notFound('That executive alert does not exist or is outside your scope.');
    return presentAlert(row);
  }

  /** Acknowledge or resolve an alert (optimistic locking on `version`). */
  function actOnAlert(actor, id, { action, note, version }) {
    guard(actor, 'bi.exec_alert.manage');
    return transaction(db, () => {
      const row = alertRow(actor, id);
      if (row.version !== version) throw conflict('This alert was changed by someone else. Refresh it and try again.');
      if (row.status === 'RESOLVED') throw unprocessable('This alert is already resolved.');
      if (action === 'acknowledge' && row.status !== 'OPEN') throw unprocessable('Only an open alert can be acknowledged.');
      if (action === 'resolve' && (!note || note.trim().length < 5)) throw badRequest('Say how the alert was resolved (at least 5 characters).', [{ field: 'note', message: 'is required' }]);
      const now = new Date().toISOString();
      if (action === 'acknowledge') {
        db.prepare(`UPDATE exec_alerts SET status = 'ACKNOWLEDGED', acknowledged_by = ?, acknowledged_at = ?, remarks = COALESCE(?, remarks),
          updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(actor.user, now, note ?? null, actor.user, now, id);
      } else {
        db.prepare(`UPDATE exec_alerts SET status = 'RESOLVED', resolved_by = ?, resolved_at = ?, resolution = ?, updated_by = ?, updated_at = ?, version = version + 1
          WHERE id = ?`).run(actor.user, now, note.trim(), actor.user, now, id);
        closeTask(row, actor.user);
      }
      const status = action === 'acknowledge' ? 'ACKNOWLEDGED' : 'RESOLVED';
      writeAudit(db, { companyId: actor.companyId, entity: 'exec_alerts', entityId: id, action, oldValues: { status: row.status, version: row.version },
        newValues: { status, note: note ?? null }, actor: actor.user });
      publishEvent(db, { type: `bi.exec_alert.${action === 'acknowledge' ? 'acknowledged' : 'resolved'}`, entity: 'exec_alerts', entityId: id, actorId: actor.user,
        companyId: actor.companyId, projectId: row.project_id, data: { alertNo: row.alert_no, ruleCode: row.rule_code, severity: row.severity, projectId: row.project_id, status } });
      return getAlert(actor, id);
    });
  }

  function closeTask(row, user) {
    if (!row.task_id) return;
    // the task made for the alert is completed with it through the task service (04.08); it stays in the owner's history
    const task = tasksOf(db).get(row.task_id);
    if (!task || ['DONE', 'VERIFIED', 'CLOSED', 'CANCELLED'].includes(task.status)) return;
    tasksOf(db).act(user, row.task_id, 'complete', { reason: 'The executive alert was resolved.' });
  }

  // ---------------------------------------------------------------- FR-03: the evaluation
  const nextNo = (companyId) => `EXA-${String(Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(alert_no, 5) AS INTEGER)), 0) + 1 AS n FROM exec_alerts WHERE company_id = ?").get(companyId).n)).padStart(5, '0')}`;
  const activeUser = (companyId, username) => (username ? db.prepare("SELECT id, username FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1 AND status = 'ACTIVE'").get(companyId, username) : null);
  const roleHolder = (companyId, roles) => {
    for (const role of roles) {
      const user = db.prepare(`SELECT u.id, u.username FROM iam_users u WHERE u.company_id = ? AND u.is_active = 1 AND u.status = 'ACTIVE'
        AND EXISTS (SELECT 1 FROM json_each(u.roles_json) WHERE value = ?) ORDER BY u.username LIMIT 1`).get(companyId, role);
      if (user) return user;
    }
    return null;
  };
  /** The owner of an alert: the project manager, else the project director, else a holder of PD; for a company-level alert the CFO, else a director. */
  const ownerOf = (companyId, projectId) => {
    if (projectId) {
      const project = db.prepare('SELECT pm_user, director_user FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1').get(projectId);
      return activeUser(companyId, project?.pm_user) ?? activeUser(companyId, project?.director_user) ?? roleHolder(companyId, ['PD', 'DIR']);
    }
    return roleHolder(companyId, ['CFO', 'DIR']);
  };

  function raise(companyId, rule, setting, breach) {
    return transaction(db, () => {
      const key = breach.projectId ?? null;
      const open = db.prepare(`SELECT * FROM exec_alerts WHERE company_id = ? AND rule_code = ? AND project_id IS ? AND status IN ('OPEN', 'ACKNOWLEDGED') AND deleted_at IS NULL`)
        .get(companyId, rule.code, key);
      const now = new Date().toISOString();
      if (open) {
        db.prepare(`UPDATE exec_alerts SET last_seen_at = ?, occurrences = occurrences + CASE WHEN evidence_key = ? THEN 0 ELSE 1 END, message = ?, observed_value = ?,
          threshold = ?, evidence_key = ?, route = ?, updated_by = 'system', updated_at = ?,
          version = version + CASE WHEN evidence_key = ? AND message = ? THEN 0 ELSE 1 END WHERE id = ?`)
          .run(now, breach.evidence, breach.message, breach.observed, setting.threshold, breach.evidence, breach.route ?? null, now, breach.evidence, breach.message, open.id);
        return { outcome: 'REFRESHED', id: open.id };
      }
      // the same evidence never raises a second alert after someone resolved the first one
      if (db.prepare(`SELECT 1 FROM exec_alerts WHERE company_id = ? AND rule_code = ? AND project_id IS ? AND evidence_key = ? AND deleted_at IS NULL`)
        .get(companyId, rule.code, key, breach.evidence)) return { outcome: 'SUPPRESSED' };
      const owner = ownerOf(companyId, key);
      const alertNo = nextNo(companyId);
      const id = Number(db.prepare(`INSERT INTO exec_alerts (company_id, alert_no, rule_code, rule_version, dimension, project_id, severity, message, observed_value, threshold,
          evidence_key, route, raised_at, last_seen_at, owner_id, owner_user, status, created_by, source_type, source_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', 'system', ?, ?)`)
        .run(companyId, alertNo, rule.code, setting.version, rule.dimension, key, setting.severity, breach.message, breach.observed, setting.threshold,
          breach.evidence, breach.route ?? null, now, now, owner?.id ?? null, owner?.username ?? null, breach.sourceType, breach.sourceId == null ? null : String(breach.sourceId)).lastInsertRowid);
      let taskId = null;
      if (owner) {
        const made = tasksOf(db).create({ companyId, title: `${alertNo}: ${rule.name}`.slice(0, 200), description: breach.message, entity: 'exec_alert', entityId: id,
          entityLabel: alertNo, projectId: key, priority: setting.severity === 'CRITICAL' ? 'URGENT' : 'HIGH', dueDate: dueIn(setting.severity === 'CRITICAL' ? 2 : 7),
          assignees: [owner.username], origin: 'auto', assigner: 'system', actor: 'system', source: { type: 'exec_alert', id: String(id) } });
        taskId = made.id;
        db.prepare('UPDATE exec_alerts SET task_id = ? WHERE id = ?').run(taskId, id);
      }
      const recipients = [...(owner ? [`user:${owner.username}`] : []), ...(setting.severity === 'CRITICAL' ? ['role:DIR'] : [])];
      if (recipients.length) {
        notify.notify({ companyId, templateCode: 'bi.exec_alert.raised', recipients, data: { alertNo, rule: rule.name, message: breach.message, severity: setting.severity.toLowerCase() },
          priority: setting.severity === 'CRITICAL' ? 'URGENT' : 'NORMAL', category: 'alerts', projectId: key, link: `/bi/control-tower?tab=alerts&alert=${id}`,
          channels: ['IN_APP'], sourceType: 'exec_alert', sourceId: id, eventKey: `exec_alert:${id}:raised` });
      }
      writeAudit(db, { companyId, entity: 'exec_alerts', entityId: id, action: 'raise', newValues: { alertNo, rule: rule.code, projectId: key, severity: setting.severity, observed: breach.observed, threshold: setting.threshold, owner: owner?.username ?? null }, actor: 'system' });
      publishEvent(db, { type: 'bi.exec_alert.raised', entity: 'exec_alerts', entityId: id, actorId: 'system', companyId, projectId: key,
        data: { alertNo, ruleCode: rule.code, severity: setting.severity, projectId: key, status: 'OPEN' } });
      return { outcome: 'RAISED', id, taskId };
    });
  }

  function clear(companyId, rule, projectId, why) {
    return transaction(db, () => {
      const open = db.prepare(`SELECT * FROM exec_alerts WHERE company_id = ? AND rule_code = ? AND project_id IS ? AND status IN ('OPEN', 'ACKNOWLEDGED') AND deleted_at IS NULL`)
        .get(companyId, rule.code, projectId ?? null);
      if (!open) return 0;
      const now = new Date().toISOString();
      db.prepare(`UPDATE exec_alerts SET status = 'RESOLVED', resolved_by = 'system', resolved_at = ?, resolution = ?, updated_by = 'system', updated_at = ?, version = version + 1 WHERE id = ?`)
        .run(now, why, now, open.id);
      closeTask(open, 'system');
      writeAudit(db, { companyId, entity: 'exec_alerts', entityId: open.id, action: 'auto_resolve', oldValues: { status: open.status }, newValues: { status: 'RESOLVED', resolution: why }, actor: 'system' });
      publishEvent(db, { type: 'bi.exec_alert.resolved', entity: 'exec_alerts', entityId: open.id, actorId: 'system', companyId, projectId: open.project_id,
        data: { alertNo: open.alert_no, ruleCode: open.rule_code, severity: open.severity, projectId: open.project_id, status: 'RESOLVED' } });
      return 1;
    });
  }

  const dueIn = (days) => new Date(Date.parse(todayIST()) + days * 86_400_000).toISOString().slice(0, 10);
  const fmt = (value, unit) => (value == null ? '—' : unit === 'INR' ? `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}` : String(round(value, 2)));

  /** The breaches of the metric rules now, for every live project of the company (the system reads every project). */
  function breaches(companyId, settings) {
    const actor = { companyId, user: 'system', system: true };
    const live = new Set(db.prepare("SELECT id FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status IN ('ACTIVE', 'ON_HOLD')").all(companyId).map((row) => row.id));
    const { metrics } = readPortfolioMetrics(context, actor, { codes: ['spi', 'cpi', 'eac', 'dso', 'ltifr'], projectIds: [...live] });
    const byMetric = new Map(metrics.map((metric) => [metric.code, metric]));
    const codes = new Map(db.prepare('SELECT id, code FROM org_projects WHERE company_id = ?').all(companyId).map((row) => [row.id, row.code]));
    const out = { found: [], evaluated: [], skipped: [] };
    for (const setting of settings) {
      const rule = ruleOf(setting.code);
      if (!rule.metric) continue;
      const metric = byMetric.get(rule.metric);
      if (!setting.enabled) { out.skipped.push({ rule: rule.code, why: 'disabled' }); continue; }
      if (!metric) { out.skipped.push({ rule: rule.code, why: 'metric unavailable' }); continue; }
      if (!metric.certified) { out.skipped.push({ rule: rule.code, why: 'metric not certified' }); continue; }
      out.evaluated.push(rule.code);
      for (const projectId of live) {
        const entry = metric.projects.get(projectId);
        const code = codes.get(projectId);
        const t = setting.threshold;
        let breach = null;
        if (entry?.value != null) {
          if (rule.usesPeriods) {
            const trail = [entry.value, ...entry.earlier.map((row) => row.value)].slice(0, setting.periods);
            if (trail.length >= setting.periods && trail.every((value) => value < t)) {
              breach = { observed: entry.value, message: `${code}: ${rule.metric.toUpperCase()} ${trail.map((v) => round(v, 3)).join(', ')} below ${t} for ${setting.periods} period(s) (latest ${entry.sourcePeriod}).` };
            }
          } else if (rule.code === 'EAC_GROWTH') {
            const growth = growthOf(entry);
            if (growth != null && growth > t) breach = { observed: growth, message: `${code}: EAC grew ${growth}% (${fmt(entry.previous.value, 'INR')} → ${fmt(entry.value, 'INR')}), above ${t}%.` };
          } else if (rule.code === 'COLLECTIONS_OVERDUE') {
            if (entry.value > t) breach = { observed: entry.value, message: `${code}: collections outstanding ${round(entry.value, 1)} days (DSO), above ${t} days.` };
          } else if (rule.code === 'LTI') {
            if (entry.value > t) breach = { observed: entry.value, message: `${code}: lost-time injury frequency ${round(entry.value, 2)}, above ${t}.` };
          }
        }
        if (breach) out.found.push({ rule, setting, breach: { ...breach, projectId, evidence: `${rule.metric}:${entry.sourceId}:${entry.sourcePeriod}`, route: entry.sourceRoute, sourceType: `bi_metric_${rule.metric}`, sourceId: entry.sourceId } });
        else out.found.push({ rule, setting, clear: projectId, hasValue: entry?.value != null });
      }
    }
    return out;
  }

  function cashBreach(companyId, setting) {
    const forecast = latestCashForecast(companyId);
    if (!forecast) return { skipped: 'no published cash forecast' };
    if (forecast.lowest < setting.threshold) {
      return { breach: { projectId: null, observed: forecast.lowest, evidence: `cf:${forecast.forecastId}`, route: forecast.route, sourceType: 'cf_forecasts', sourceId: forecast.forecastId,
        message: `Cash forecast ${forecast.docNo}: closing balance falls to ${fmt(forecast.lowest, 'INR')} in the week of ${forecast.lowestWeek ?? '—'} (13-week forecast from ${forecast.weekStart}).` } };
    }
    return { clear: true };
  }

  /** Run every enabled rule for a company. Returns what happened. */
  function evaluate(companyId, trigger = 'manual') {
    const actor = { companyId, user: 'system' };
    if (!context.flags.isOn(actor, TOWER_FLAG)) return { skipped: true };
    const settings = currentSettings(db, companyId);
    const result = { trigger, raised: 0, refreshed: 0, suppressed: 0, resolved: 0, evaluated: [], skipped: [] };
    const tally = (outcome) => {
      if (outcome === 'RAISED') result.raised += 1; else if (outcome === 'REFRESHED') result.refreshed += 1; else if (outcome === 'SUPPRESSED') result.suppressed += 1;
    };
    const found = breaches(companyId, settings);
    result.evaluated.push(...found.evaluated);
    result.skipped.push(...found.skipped);
    for (const item of found.found) {
      if (item.breach) tally(raise(companyId, item.rule, item.setting, item.breach).outcome);
      else if (item.hasValue) result.resolved += clear(companyId, item.rule, item.clear, 'The condition cleared on the latest certified value.');
    }
    const cash = settings.find((row) => row.code === 'CASH_NEGATIVE');
    if (cash.enabled && context.flags.isOn(actor, 'ff.fin.p2313')) {
      const out = cashBreach(companyId, cash);
      if (out.breach) tally(raise(companyId, ruleOf('CASH_NEGATIVE'), cash, out.breach).outcome);
      else if (out.clear) result.resolved += clear(companyId, ruleOf('CASH_NEGATIVE'), null, 'The latest published cash forecast stays above the threshold.');
      if (out.skipped) result.skipped.push({ rule: 'CASH_NEGATIVE', why: out.skipped }); else result.evaluated.push('CASH_NEGATIVE');
    } else result.skipped.push({ rule: 'CASH_NEGATIVE', why: cash.enabled ? 'cash forecast not enabled' : 'disabled' });
    writeAudit(db, { companyId, entity: 'exec_alerts', entityId: 0, action: 'evaluate', newValues: { trigger, raised: result.raised, resolved: result.resolved, evaluated: result.evaluated }, actor: 'system' });
    return result;
  }

  // ---------------------------------------------------------------- jobs, schedule and the event consumers
  jobs.register(EVALUATE_JOB, ({ params }) => {
    if (params.companyId) return evaluate(params.companyId, params.trigger ?? 'manual');
    const out = [];
    for (const { id } of db.prepare('SELECT id FROM org_companies WHERE is_active = 1 ORDER BY id').all()) {
      try {
        out.push({ companyId: id, ...evaluate(id, 'schedule') });
      } catch (error) {
        if (error.status !== 404) throw error;
      }
    }
    return { companies: out.length, raised: out.reduce((a, r) => a + (r.raised ?? 0), 0), resolved: out.reduce((a, r) => a + (r.resolved ?? 0), 0) };
  }, { description: 'Evaluates the executive early-warning rules of the control tower (part 27.04).' });
  // 05:45 IST every day, before the morning report (27.05)
  scheduler.define({ code: EVALUATE_JOB, cron: '45 5 * * *', jobType: EVALUATE_JOB, description: 'Evaluate the executive early-warning rules daily at 05:45 IST.' });

  const tryRun = (companyId, fn) => {
    if (!companyId || !context.flags.isOn({ companyId }, TOWER_FLAG)) return;
    try {
      requireMetricCatalogueSource(context, { companyId, user: 'system' });
    } catch (error) {
      if (error.status === 404) return;
      throw error;
    }
    fn();
  };
  // a newly published cash forecast is checked at once (the consumer is idempotent: the evidence key is the forecast)
  bus.subscribe('fin.cash_forecast.published', (event) => tryRun(event.companyId, () => {
    const setting = currentSettings(db, event.companyId).find((row) => row.code === 'CASH_NEGATIVE');
    if (!setting.enabled) return;
    const out = cashBreach(event.companyId, setting);
    if (out.breach) raise(event.companyId, ruleOf('CASH_NEGATIVE'), setting, out.breach);
    else if (out.clear) clear(event.companyId, ruleOf('CASH_NEGATIVE'), null, 'The latest published cash forecast stays above the threshold.');
  }), { consumer: 'bi.exec_alerts.cash' });
  // late material shortages found by an MRP run of a project; a later run without late shortages clears the alert
  bus.subscribe(['proc.mrp.shortages_found', 'proc.mrp.run_completed'], (event) => tryRun(event.companyId, () => {
    const setting = currentSettings(db, event.companyId).find((row) => row.code === 'MATERIAL_SHORTAGE');
    const projectId = Number(event.projectId ?? event.data?.projectId) || null;
    if (!setting.enabled || !projectId) return;
    const rule = ruleOf('MATERIAL_SHORTAGE');
    if (event.type === 'proc.mrp.run_completed') {
      if (!Number(event.data?.late ?? 0)) clear(event.companyId, rule, projectId, `MRP run ${event.data?.docNo ?? ''} found no late shortages.`.trim());
      return;
    }
    const late = (event.data?.shortages ?? []).filter((row) => row.late);
    if (late.length < setting.threshold) return;
    const code = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(projectId)?.code ?? projectId;
    raise(event.companyId, rule, setting, { projectId, observed: late.length, evidence: `mrp:${event.data?.runId}`, route: `/proc/mrp?id=${event.data?.runId}`,
      sourceType: 'proc_mrp_runs', sourceId: event.data?.runId,
      message: `${code}: MRP run ${event.data?.docNo ?? event.data?.runId} found ${late.length} material shortage(s) that cannot arrive before they are required (first: week of ${late[0].weekStart}).` });
  }), { consumer: 'bi.exec_alerts.mrp' });
  // the requester learns the outcome of a threshold request
  bus.subscribe('bi.exec_alert.settings_changed', (event) => {
    if (!event.companyId) return;
    const request = db.prepare('SELECT requested_by FROM core_change_requests WHERE company_id = ? AND type = ? AND id = ?').get(event.companyId, SETTINGS_TYPE, event.data.requestId);
    if (!request) return;
    notify.notify({ companyId: event.companyId, templateCode: 'bi.exec_alert.settings_decided', recipients: [`user:${request.requested_by}`],
      data: { rule: ruleOf(event.data.ruleCode)?.name ?? event.data.ruleCode, version: String(event.data.version) }, link: '/bi/control-tower?tab=settings',
      channels: ['IN_APP'], sourceType: 'bi_exec_alert_settings', sourceId: event.eventId });
  }, { consumer: 'bi.exec_alerts.settings' });

  // ---------------------------------------------------------------- configuration (maker-checker)
  function settingsView(actor) {
    guard(actor, 'bi.control_tower.view');
    const configure = hasPermissionAnywhere(actor, 'bi.exec_alert.configure');
    return { rules: currentSettings(db, actor.companyId),
      requests: configure ? approvals.list(actor, { type: SETTINGS_TYPE, status: undefined, limit: 25, offset: 0 }).rows : [],
      can: { configure } };
  }

  function proposeSettings(actor, input) {
    guard(actor, 'bi.exec_alert.configure');
    const rule = ruleOf(input.ruleCode);
    if (!rule) throw notFound('That early-warning rule does not exist.');
    if (input.threshold < rule.min || input.threshold > rule.max) throw badRequest(`The threshold of ${rule.name} must be between ${rule.min} and ${rule.max}.`, [{ field: 'threshold', message: 'is out of range' }]);
    if (!rule.usesPeriods && input.periods !== 1) throw badRequest('Only the index rules look at more than one period.', [{ field: 'periods', message: 'must be 1' }]);
    return transaction(db, () => {
      const current = currentSettings(db, actor.companyId).find((row) => row.code === rule.code);
      if (current.enabled === input.enabled && current.threshold === input.threshold && current.periods === input.periods && current.severity === input.severity) {
        throw conflict('These settings are already in force.');
      }
      if (db.prepare("SELECT 1 FROM core_change_requests WHERE company_id = ? AND type = ? AND target_type = ? AND status = 'SUBMITTED'").get(actor.companyId, SETTINGS_TYPE, `exec_rule_${rule.code}`)) {
        throw conflict('A change to this rule is already awaiting approval.');
      }
      return approvals.submit(actor, { type: SETTINGS_TYPE, title: `Early warning: ${rule.name}`, targetType: `exec_rule_${rule.code}`, targetId: 0,
        reason: input.reason, chain: ['DIR|CFO'],
        payload: { ruleCode: rule.code, enabled: input.enabled, threshold: input.threshold, periods: input.periods, severity: input.severity, baseVersion: current.version,
          from: { enabled: current.enabled, threshold: current.threshold, periods: current.periods, severity: current.severity } } });
    });
  }

  function decideSettings(actor, id, input) {
    guard(actor, 'bi.exec_alert.configure');
    if (approvals.get(actor, id).type !== SETTINGS_TYPE) throw notFound('That threshold request does not exist.');
    return approvals.act(actor, id, input);
  }

  function queueEvaluation(actor) {
    guard(actor, 'bi.exec_alert.run');
    return jobs.enqueue(EVALUATE_JOB, { companyId: actor.companyId, trigger: 'manual' }, { companyId: actor.companyId, createdBy: actor.user });
  }

  // ---------------------------------------------------------------- export (honours scope and masks: the figures are those the actor sees)
  function exportMatrix(actor, query, format) {
    guard(actor, 'bi.control_tower.export');
    const data = portfolio(actor, { ...query, page: 1, pageSize: 100 });
    const total = data.matrix.total;
    const rows = [];
    for (let page = 1; (page - 1) * 100 < total; page += 1) rows.push(...(page === 1 ? data.matrix.rows : portfolio(actor, { ...query, page, pageSize: 100 }).matrix.rows));
    const v = (row, key) => row.metrics[key]?.value ?? '';
    const columns = [['code', 'Project'], ['name', 'Name'], ['region', 'Region'], ['sector', 'Sector'], ['pm', 'Project manager'], ['overall', 'Overall'], ['time', 'Time'],
      ['cost', 'Cost'], ['quality', 'Quality'], ['safety', 'Safety'], ['cash', 'Cash'], ['spi', 'SPI'], ['cpi', 'CPI'], ['eac', 'EAC (₹)'], ['eacGrowth', 'EAC growth %'],
      ['margin', 'Gross margin %'], ['revenue', 'Revenue to date (₹)'], ['dso', 'DSO (days)'], ['ltifr', 'LTIFR'], ['alerts', 'Open alerts']]
      .map(([key, label]) => ({ key, label, type: ['code', 'name', 'region', 'sector', 'pm', 'overall', 'time', 'cost', 'quality', 'safety', 'cash'].includes(key) ? 'text' : 'number' }));
    const body = rows.map((row) => ({ code: row.code, name: row.name, region: row.region ?? '', sector: row.sector ?? '', pm: row.pm ?? '', ...row.health,
      spi: v(row, 'spi'), cpi: v(row, 'cpi'), eac: v(row, 'eac'), eacGrowth: row.health.eacGrowth ?? '', margin: v(row, 'margin'), revenue: v(row, 'revenue'),
      dso: v(row, 'dso'), ltifr: v(row, 'ltifr'), alerts: row.alerts }));
    const footer = [`Enterprise control tower · ${data.asOf} · certified metrics evaluated ${data.evaluatedAt}`, `Generated by ${actor.user}`, `${body.length} project(s)`];
    const buffer = writeExport(format, { columns, rows: body, footer, title: 'Enterprise control tower — project health', sheetName: 'Health matrix' });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'bi.control_tower', action: 'export', newValues: { format, rows: body.length, filters: data.filters }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `control-tower-${data.asOf}.${format}`, rows: body.length };
  }

  return { portfolio, project, alertsList, getAlert, actOnAlert, evaluate, queueEvaluation, settingsView, proposeSettings, decideSettings, exportMatrix,
    alertCounts, requests: (actor) => { guard(actor, 'bi.exec_alert.configure'); return approvals.list(actor, { type: SETTINGS_TYPE, status: undefined, limit: 25, offset: 0 }).rows; } };
}

/** The dashboard widget (03.07): open executive alerts in the actor's scope. */
const towers = new WeakMap();
export const bindTower = (db, tower) => towers.set(db, tower);
export const towerOf = (db) => towers.get(db) ?? null;
widgetRegistry.register({
  code: 'bi.exec_alerts',
  available(db, actor) {
    const tower = towers.get(db);
    const context = contexts.get(db);
    if (!tower || !context || !hasPermissionAnywhere(actor, 'bi.exec_alert.view')) return false;
    try {
      requireTower(context, actor);
      return true;
    } catch (error) {
      if (error.status === 404) return false;
      throw error;
    }
  },
  provider({ db, actor }) {
    const counts = towers.get(db).alertCounts(actor);
    return { label: 'Open executive alerts', value: counts.open, unit: 'alerts', subtitle: `${counts.critical} critical`, status: counts.critical ? 'red' : counts.open ? 'amber' : 'green',
      drill: '/bi/control-tower?tab=alerts' };
  },
});
