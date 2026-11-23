import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, notFound } from '../../platform/http/errors.js';
import { todayIST } from '../../../shared/dates.js';
import { amountOf } from '../bill/clientbill.js';
import { billOf } from '../bill/index.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { registerProject360Widget } from '../proj/p360.js';

/**
 * Part 27.06 — daily execution intelligence and work-done / WIP valuation.
 *
 * Each day and site, the work done is valued from the approved DPRs only (BR-01): the executed quantity of each DPR work line, apportioned to
 * BOQ items by the quantity reconciliation of 22.02 (never re-computed here), × the item's contract rate (FR-01), and × the budget cost rate of
 * the approved project budget for the internal margin view (masked without bi.execution.cost). The project row of the day adds the cumulative
 * value, WIP (executed not certified), the billed-vs-executed gap and the balance work from the 22.02 chain (FR-02). The site rows carry the
 * planned value of the day (DPR planned quantity × rate), labour deployed, plant hours, hindrances open and RFIs raised and answered (FR-04).
 * The rows are snapshots in `dei_daily` (FR-03), recomputed when a DPR of that day is approved and by a nightly job; MIS and forecasting read
 * them through `executionOf(db).series` and the `bi.execution.snapshot_captured` event.
 */

export const EXEC_FLAG = 'ff.bi.p2706';
const JOB = 'bi.execution.capture';
const rs = (paise) => (paise == null ? null : Math.round(Number(paise)) / 100);
/** Hours and quantities of the DPR are kept in thousandths. */
const d3 = (v) => (v == null ? null : Math.round(Number(v)) / 1000);
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const services = new WeakMap();
export const executionOf = (db) => services.get(db) ?? null;

const capturedShape = { type: 'object', required: ['projectId', 'date', 'executedValue'], properties: { projectId: { type: 'integer' }, date: { type: 'string' }, executedValue: { type: 'number' }, cumValue: { type: 'number' }, wipValue: { type: 'number' } } };
eventTypes.define({ type: 'bi.execution.snapshot_captured', version: 1, schema: capturedShape, owner: 'bi',
  description: 'The daily execution snapshot of a project was captured or recomputed (part 27.06): data { projectId, date, executedValue, cumValue, wipValue } in rupees. MIS (27.07) and forecasting read it.' });

export function requireExecution(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, EXEC_FLAG)) throw notFound('Daily execution intelligence is unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export function createExecution(context, { jobs, scheduler, bus }) {
  const { db } = context;
  const authz = authzOf(db);
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const recon = () => billOf(db)?.svc?.recon ?? null;

  /** Budget cost per BOQ line of the latest approved budget of the project: { amount (paise), qty (thousandths) } per line id. */
  function costRates(companyId, projectId) {
    if (!has('bud_lines')) return new Map();
    const rows = db.prepare(`SELECT l.boq_line_id AS lineId, SUM(l.amount) AS amount, SUM(l.qty) AS qty FROM bud_lines l
      WHERE l.company_id = ? AND l.boq_line_id IS NOT NULL AND l.deleted_at IS NULL AND l.budget_id = (SELECT b.id FROM bud_budgets b WHERE b.company_id = ? AND b.org_project_id = ?
        AND b.status = 'APPROVED' AND b.deleted_at IS NULL ORDER BY b.id DESC LIMIT 1) GROUP BY l.boq_line_id`).all(companyId, companyId, projectId);
    return new Map(rows.map((r) => [r.lineId, r]));
  }
  const costOf = (rates, lineIds, qtyTh) => {
    let amount = 0; let qty = 0;
    for (const id of lineIds) { const r = rates.get(id); if (r) { amount += r.amount; qty += r.qty; } }
    return qty > 0 ? Math.round((qtyTh * amount) / qty) : null;
  };

  /** The rows of one project and day (site rows and the project row), computed from the owners. */
  /** @returns {any[]} */
  function computeProject(companyId, projectId, date) {
    const rc = recon();
    if (!rc) return [];
    const lines = rc.executedLines(companyId, projectId, { date });
    const rates = costRates(companyId, projectId);
    const bySite = new Map();
    const site = (id) => { if (!bySite.has(id)) bySite.set(id, { planned: 0, executed: 0, cost: 0, costKnown: true, items: new Map(), dprs: new Set(), labour: 0, plantHours: 0, idleHours: 0, hindrances: 0 }); return bySite.get(id); };
    for (const l of lines) {
      const s = site(l.siteId);
      const value = amountOf(l.qtyTh, l.rate); const planned = amountOf(l.plannedTh, l.rate); const cost = costOf(rates, l.lineIds, l.qtyTh);
      s.executed += value; s.planned += planned; if (cost == null) s.costKnown = false; else s.cost += cost; s.dprs.add(l.dprId);
      const it = s.items.get(l.code) ?? { code: l.code, description: l.description, uom: l.uom, rate: l.rate / 10000, qtyTh: 0, value: 0, cost: 0, costKnown: true, dprs: [] };
      it.qtyTh += l.qtyTh; it.value += value; if (cost == null) it.costKnown = false; else it.cost += cost; if (!it.dprs.some((d) => d.id === l.dprId)) it.dprs.push({ id: l.dprId, no: l.dprNo });
      s.items.set(l.code, it);
    }
    // labour and plant of the approved DPRs of the day (FR-04); sites with a DPR but no valued work still appear
    for (const r of db.prepare(`SELECT d.id, d.dpr_site_id AS siteId,
        (SELECT COALESCE(SUM(headcount), 0) FROM site_dpr_labour x WHERE x.dpr_id = d.id AND x.deleted_at IS NULL) AS labour,
        (SELECT COALESCE(SUM(hours_worked), 0) FROM site_dpr_equipment x WHERE x.dpr_id = d.id AND x.deleted_at IS NULL) AS plant,
        (SELECT COALESCE(SUM(hours_idle + hours_breakdown), 0) FROM site_dpr_equipment x WHERE x.dpr_id = d.id AND x.deleted_at IS NULL) AS idle
      FROM site_dprs d WHERE d.company_id = ? AND d.org_project_id = ? AND d.dpr_date = ? AND d.status = 'APPROVED' AND d.deleted_at IS NULL`).all(companyId, projectId, date)) {
      const s = site(r.siteId); s.labour += r.labour; s.plantHours += r.plant; s.idleHours += r.idle; s.dprs.add(r.id);
    }
    if (has('site_hindrances')) {
      for (const r of db.prepare(`SELECT hin_site_id AS siteId, COUNT(*) AS n FROM site_hindrances WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL
        AND status IN ('SUBMITTED','APPROVED') AND start_date <= ? AND (end_date IS NULL OR end_date >= ?) GROUP BY hin_site_id`).all(companyId, projectId, date, date)) site(r.siteId).hindrances = r.n;
    }
    const rfi = has('engg_rfis') ? db.prepare(`SELECT COALESCE(SUM(CASE WHEN substr(issued_on, 1, 10) = :d THEN 1 ELSE 0 END), 0) AS raised,
        COALESCE(SUM(CASE WHEN substr(responded_on, 1, 10) = :d THEN 1 ELSE 0 END), 0) AS answered,
        COALESCE(SUM(CASE WHEN status IN ('ISSUED') AND substr(issued_on, 1, 10) <= :d THEN 1 ELSE 0 END), 0) AS open
      FROM engg_rfis WHERE company_id = :c AND org_project_id = :p AND deleted_at IS NULL`).get({ c: companyId, p: projectId, d: date }) : { raised: 0, answered: 0, open: 0 };
    // cumulative to the day, and WIP, billed gap and balance from the 22.02 chain (current certification and billing)
    const cum = rc.executedLines(companyId, projectId, { upTo: date }).reduce((n, l) => n + amountOf(l.qtyTh, l.rate), 0);
    const chain = rc.chainRows(companyId, projectId);
    const th = (v) => Math.round(Number(v ?? 0) * 1000);
    const val = (q, rate) => amountOf(th(q), rate ?? 0);
    const wip = chain.reduce((n, r) => n + val(Math.max(0, (r.executed ?? 0) - (r.certified ?? 0)), r.rate), 0);
    const billedGap = chain.reduce((n, r) => n + val(Math.max(0, (r.executed ?? 0) - (r.billed ?? 0)), r.rate), 0);
    const balance = chain.reduce((n, r) => n + val(Math.max(0, (r.revised ?? r.contract ?? 0) - (r.executed ?? 0)), r.rate), 0);
    const certified = chain.reduce((n, r) => n + val(r.certified ?? 0, r.rate), 0);
    const items = (m) => [...m.values()].map((it) => ({ code: it.code, description: it.description, uom: it.uom, rate: it.rate, qty: it.qtyTh / 1000, value: rs(it.value), cost: it.costKnown ? rs(it.cost) : null, dprs: it.dprs }))
      .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code, undefined, { numeric: true }));
    /** @type {any[]} */
    const out = [...bySite.entries()].map(([siteId, s]) => ({ siteId, planned: s.planned, executed: s.executed, cost: s.costKnown ? s.cost : null, labour: s.labour, plantHours: s.plantHours,
      idleHours: s.idleHours, hindrances: s.hindrances, snapshot: { items: items(s.items), dprs: [...s.dprs] } }));
    const all = new Map();
    for (const [, s] of bySite) for (const it of s.items.values()) { const t = all.get(it.code) ?? { ...it, qtyTh: 0, value: 0, cost: 0, dprs: [] }; t.qtyTh += it.qtyTh; t.value += it.value; t.costKnown = t.costKnown && it.costKnown; t.cost += it.cost; t.dprs.push(...it.dprs.filter((d) => !t.dprs.some((x) => x.id === d.id))); all.set(it.code, t); }
    const sum = (k) => out.reduce((n, r) => n + (r[k] ?? 0), 0);
    out.push({ siteId: null, planned: sum('planned'), executed: sum('executed'), cost: out.every((r) => r.cost != null) ? sum('cost') : null, labour: sum('labour'), plantHours: sum('plantHours'), idleHours: sum('idleHours'),
      hindrances: sum('hindrances'), cum, wip, billedGap, balance, certified, rfisRaised: rfi.raised, rfisAnswered: rfi.answered, rfisOpen: rfi.open,
      snapshot: { items: items(all), dprs: [...new Set(out.flatMap((r) => r.snapshot.dprs))], certifiedValue: rs(certified) } });
    return out;
  }

  /** Capture (or recompute) the snapshots of a company for a day. Idempotent: a row per company, project, site and day. */
  function capture(companyId, date, { projectId = null } = {}) {
    const ctx = { companyId, user: 'system' };
    if (!context.flags.isOn(ctx, EXEC_FLAG)) return { projects: 0 };
    const projects = db.prepare(`SELECT id FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status IN ('ACTIVE','ON_HOLD') ${projectId ? 'AND id = ?' : ''} ORDER BY id`).all(companyId, ...(projectId ? [projectId] : []));
    let n = 0;
    for (const { id } of projects) {
      const rows = computeProject(companyId, id, date);
      transaction(db, () => {
        const now = new Date().toISOString();
        const keep = new Set();
        for (const r of rows) {
          const siteKey = r.siteId ?? 0; keep.add(siteKey);
          db.prepare(`INSERT INTO dei_daily (company_id, project_id, site_id, site_key, snap_date, planned_value, executed_value, cost_value, wip_value, cum_value, billed_gap_value, balance_value,
              labour_count, plant_hours, idle_hours, hindrances_open, rfis_raised, rfis_answered, rfis_open, snapshot_json, captured_at, created_by, source_type, source_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system', 'site_dprs', ?)
            ON CONFLICT(company_id, project_id, site_key, snap_date) DO UPDATE SET planned_value = excluded.planned_value, executed_value = excluded.executed_value, cost_value = excluded.cost_value,
              wip_value = excluded.wip_value, cum_value = excluded.cum_value, billed_gap_value = excluded.billed_gap_value, balance_value = excluded.balance_value, labour_count = excluded.labour_count,
              plant_hours = excluded.plant_hours, idle_hours = excluded.idle_hours, hindrances_open = excluded.hindrances_open, rfis_raised = excluded.rfis_raised, rfis_answered = excluded.rfis_answered,
              rfis_open = excluded.rfis_open, snapshot_json = excluded.snapshot_json, captured_at = excluded.captured_at, source_id = excluded.source_id, updated_by = 'system', updated_at = excluded.captured_at,
              version = dei_daily.version + 1, deleted_at = NULL`)
            .run(companyId, id, r.siteId, siteKey, date, r.planned, r.executed, r.cost, r.wip ?? null, r.cum ?? null, r.billedGap ?? null, r.balance ?? null, r.labour, r.plantHours, r.idleHours, r.hindrances,
              r.rfisRaised ?? null, r.rfisAnswered ?? null, r.rfisOpen ?? null, JSON.stringify(r.snapshot), now, r.snapshot.dprs.join(',') || null);
        }
        // a site whose DPR was withdrawn from approval no longer has a row of the day
        for (const old of db.prepare('SELECT id, site_key FROM dei_daily WHERE company_id = ? AND project_id = ? AND snap_date = ? AND deleted_at IS NULL').all(companyId, id, date)) {
          if (!keep.has(old.site_key)) db.prepare("UPDATE dei_daily SET deleted_at = ?, deleted_by = 'system', is_active = 0 WHERE id = ?").run(now, old.id);
        }
        const total = rows.find((r) => r.siteId == null);
        publishEvent(db, { type: 'bi.execution.snapshot_captured', entity: 'dei_daily', entityId: `${id}:${date}`, actorId: 'system', companyId, projectId: id,
          data: { projectId: id, date, executedValue: rs(total?.executed ?? 0), cumValue: rs(total?.cum ?? 0), wipValue: rs(total?.wip ?? 0) } });
      });
      n += 1;
    }
    writeAudit(db, { companyId, entity: 'dei_daily', entityId: date, action: 'capture', newValues: { date, projects: n, projectId }, actor: 'system' });
    return { projects: n, date };
  }

  jobs.register(JOB, ({ params }) => {
    const date = params.date ?? todayIST();
    if (params.companyId) return capture(params.companyId, date, { projectId: params.projectId ?? null });
    let projects = 0;
    for (const { id } of db.prepare('SELECT id FROM org_companies WHERE is_active = 1 ORDER BY id').all()) {
      try { requireExecution(context, { companyId: id, user: 'system' }); projects += capture(id, date).projects; } catch (error) { if (error.status !== 404) throw error; }
    }
    return { projects, date };
  }, { description: 'Captures the daily execution snapshots (work done, WIP, labour, plant) of every project (part 27.06).' });
  scheduler.define({ code: JOB, cron: '45 23 * * *', jobType: JOB, description: 'Capture the daily execution snapshots at 23:45 IST.' });
  // an approved (or amended) DPR recomputes its project's day at once; the consumer is idempotent (the rows are upserted)
  bus.subscribe('site.dpr.approved', (event) => {
    const companyId = Number(event.companyId);
    if (!companyId || !context.flags.isOn({ companyId }, EXEC_FLAG)) return;
    const dpr = db.prepare('SELECT org_project_id AS projectId, dpr_date AS date FROM site_dprs WHERE id = ? AND company_id = ?').get(Number(event.entityId ?? event.data?.dprId), companyId);
    if (dpr) capture(companyId, dpr.date, { projectId: dpr.projectId });
  }, { consumer: 'bi.execution.dpr' });

  // ---------------------------------------------------------------- reading (scoped; costs masked)
  const guard = (actor, permission = 'bi.execution.view') => { requireExecution(context, actor); assertPermissionAnywhere(actor, permission); };
  const siteScope = (actor) => authz.scopeFilter(actor, 'bi.execution.view', { project: 'x.project_id', site: 'x.site_id' }).sql;
  const projectScope = (actor) => authz.scopeFilter(actor, 'bi.execution.view', { project: 'x.project_id' }).sql;
  const seeCost = (actor) => hasPermissionAnywhere(actor, 'bi.execution.cost');
  const filterSql = (q) => `${q.projectId ? ' AND x.project_id = :project' : ''}${q.siteId ? ' AND x.site_id = :site' : ''}`;

  /** node:sqlite refuses a named parameter the statement does not use: bind only those that appear in it. */
  const bind = (sql, p) => Object.fromEntries(Object.entries(p).filter(([k]) => new RegExp(`:${k}\\b`).test(sql)));
  const rowsAll = (sql, p) => db.prepare(sql).all(bind(sql, p));
  const rowsGet = (sql, p) => db.prepare(sql).get(bind(sql, p));

  function overview(actor, q = {}) {
    guard(actor);
    const date = q.date ?? todayIST();
    const days = Math.min(Math.max(Number(q.days ?? 30), 7), 90);
    const params = { c: actor.companyId, d: date, from: addDays(date, -(days - 1)), project: q.projectId ?? null, site: q.siteId ?? null };
    const cost = seeCost(actor);
    const sites = rowsAll(`SELECT x.*, p.code AS projectCode, s.code AS siteCode, s.name AS siteName FROM dei_daily x JOIN org_projects p ON p.id = x.project_id LEFT JOIN org_sites s ON s.id = x.site_id
      WHERE x.company_id = :c AND x.snap_date = :d AND x.site_id IS NOT NULL AND x.deleted_at IS NULL AND (${siteScope(actor)})${filterSql(q)} ORDER BY x.executed_value DESC, p.code, s.code`, params);
    const projects = rowsAll(`SELECT x.*, p.code AS projectCode, p.name AS projectName FROM dei_daily x JOIN org_projects p ON p.id = x.project_id
      WHERE x.company_id = :c AND x.snap_date = :d AND x.site_id IS NULL AND x.deleted_at IS NULL AND (${projectScope(actor)})${q.projectId ? ' AND x.project_id = :project' : ''} ORDER BY p.code`, params);
    // the latest project row on or before the day carries WIP, cumulative and balance even on a day without approved work
    const latest = rowsAll(`SELECT x.* FROM dei_daily x JOIN (SELECT project_id, MAX(snap_date) AS d FROM dei_daily WHERE company_id = :c AND site_id IS NULL AND snap_date <= :d AND deleted_at IS NULL GROUP BY project_id) m
        ON m.project_id = x.project_id AND m.d = x.snap_date
      WHERE x.company_id = :c AND x.site_id IS NULL AND x.deleted_at IS NULL AND (${projectScope(actor)})${q.projectId ? ' AND x.project_id = :project' : ''}`, params);
    const trend = rowsAll(`SELECT x.snap_date AS date, SUM(x.planned_value) AS planned, SUM(x.executed_value) AS executed, SUM(x.labour_count) AS labour, SUM(x.plant_hours) AS plant
      FROM dei_daily x WHERE x.company_id = :c AND x.snap_date BETWEEN :from AND :d AND x.site_id IS NOT NULL AND x.deleted_at IS NULL AND (${siteScope(actor)})${filterSql(q)}
      GROUP BY x.snap_date ORDER BY x.snap_date`, params);
    const sum = (rows, k) => rows.reduce((n, r) => n + (r[k] ?? 0), 0);
    const costKnown = sites.length > 0 && sites.every((r) => r.cost_value != null);
    const executed = sum(sites, 'executed_value'); const costValue = costKnown ? sum(sites, 'cost_value') : null;
    const lastCapturedAt = rowsGet(`SELECT MAX(x.captured_at) AS t FROM dei_daily x WHERE x.company_id = :c AND x.snap_date = :d AND (${siteScope(actor)})${filterSql(q)}`, params).t;
    const prevDay = rowsGet(`SELECT COALESCE(SUM(x.executed_value), 0) AS v, COUNT(*) AS n FROM dei_daily x WHERE x.company_id = :c AND x.snap_date = :prev AND x.site_id IS NOT NULL AND x.deleted_at IS NULL AND (${siteScope(actor)})${filterSql(q)}`, { ...params, prev: addDays(date, -1) });return {
      date, days, lastCapturedAt, costVisible: cost,
      tiles: {
        executed: rs(executed), planned: rs(sum(sites, 'planned_value')), previousExecuted: prevDay.n ? rs(prevDay.v) : null,
        cost: cost ? rs(costValue) : null, margin: cost && costValue != null ? rs(executed - costValue) : null, marginPct: cost && costValue != null && executed ? Math.round(((executed - costValue) * 1000) / executed) / 10 : null,
        wip: rs(sum(latest, 'wip_value')), billedGap: rs(sum(latest, 'billed_gap_value')), cumulative: rs(sum(latest, 'cum_value')), balance: rs(sum(latest, 'balance_value')),
        labour: sum(sites, 'labour_count'), plantHours: d3(sum(sites, 'plant_hours')), idleHours: d3(sum(sites, 'idle_hours')),
        hindrances: sum(sites, 'hindrances_open'), rfisRaised: sum(projects, 'rfis_raised'), rfisAnswered: sum(projects, 'rfis_answered'), rfisOpen: sum(latest, 'rfis_open'),
        sitesReporting: sites.length,
      },
      trend: trend.map((r) => ({ date: r.date, planned: rs(r.planned), executed: rs(r.executed), labour: r.labour, plantHours: d3(r.plant) })),
      sites: sites.map((r) => ({ projectId: r.project_id, siteId: r.site_id, project: r.projectCode, site: `${r.siteCode} ${r.siteName}`, planned: rs(r.planned_value), executed: rs(r.executed_value),
        achievedPct: r.planned_value ? Math.round((r.executed_value * 1000) / r.planned_value) / 10 : null, cost: cost ? rs(r.cost_value) : null, labour: r.labour_count, plantHours: d3(r.plant_hours),
        hindrances: r.hindrances_open, valuation: `/bi/execution?tab=valuation&projectId=${r.project_id}&siteId=${r.site_id}&date=${date}`, dprs: `/site/dprs?siteId=${r.site_id}&date=${date}` })),
      projects: latest.map((r) => ({ projectId: r.project_id, wip: rs(r.wip_value), billedGap: rs(r.billed_gap_value), cumulative: rs(r.cum_value), balance: rs(r.balance_value), asOf: r.snap_date,
        drill: `/bill/qty-recon?projectId=${r.project_id}` })),
      exceptions: sites.filter((r) => r.planned_value > 0 && r.executed_value < r.planned_value * 0.8).map((r) => ({ kind: 'BEHIND_PLAN', site: `${r.siteCode} ${r.siteName}`, project: r.projectCode,
        achievedPct: Math.round((r.executed_value * 1000) / r.planned_value) / 10, route: `/bi/execution?tab=valuation&projectId=${r.project_id}&siteId=${r.site_id}&date=${date}` }))
        .concat(sites.filter((r) => r.hindrances_open > 0).map((r) => ({ kind: 'HINDRANCE', site: `${r.siteCode} ${r.siteName}`, project: r.projectCode, count: r.hindrances_open, route: `/site/hindrances?siteId=${r.site_id}` }))),
      options: optionsFor(actor),
      can: { export: hasPermissionAnywhere(actor, 'bi.execution.export'), run: hasPermissionAnywhere(actor, 'bi.execution.run') },
    };
  }

  function optionsFor(actor) {
    const projects = db.prepare(`SELECT x.id, x.code, x.name FROM org_projects x WHERE x.company_id = ? AND x.deleted_at IS NULL AND x.status IN ('ACTIVE','ON_HOLD') AND (${authz.scopeFilter(actor, 'bi.execution.view', { project: 'x.id' }).sql}) ORDER BY x.code`).all(actor.companyId);
    const sites = db.prepare(`SELECT s.id, s.code, s.name, s.org_project_id AS projectId FROM org_sites s WHERE s.company_id = ? AND s.status = 'ACTIVE' AND (${authz.scopeFilter(actor, 'bi.execution.view', { project: 's.org_project_id', site: 's.id' }).sql}) ORDER BY s.code`).all(actor.companyId);
    return { projects, sites };
  }

  /** The valuation report: BOQ items of the day with quantity × rate (and budget cost), from the snapshot; drill to the DPRs. */
  function valuation(actor, q) {
    guard(actor);
    if (!q.projectId) throw badRequest('Choose a project.', [{ field: 'projectId', message: 'is required' }]);
    const date = q.date ?? todayIST();
    const scope = q.siteId ? siteScope(actor) : projectScope(actor);
    const row = db.prepare(`SELECT x.*, p.code AS projectCode, p.name AS projectName, s.code AS siteCode FROM dei_daily x JOIN org_projects p ON p.id = x.project_id LEFT JOIN org_sites s ON s.id = x.site_id
      WHERE x.company_id = :c AND x.project_id = :project AND x.site_key = :key AND x.snap_date = :d AND x.deleted_at IS NULL AND (${scope})`)
      .get({ c: actor.companyId, project: q.projectId, key: q.siteId ?? 0, d: date });
    if (!row) {
      const inScope = db.prepare(`SELECT 1 FROM org_projects x WHERE x.id = ? AND x.company_id = ? AND (${authz.scopeFilter(actor, 'bi.execution.view', { project: 'x.id' }).sql})`).get(q.projectId, actor.companyId);
      if (!inScope) throw notFound('That project is not in your scope.');
      return { projectId: q.projectId, siteId: q.siteId ?? null, date, items: [], totals: null, captured: false };
    }
    const snap = JSON.parse(row.snapshot_json); const cost = seeCost(actor);
    const items = snap.items.map((it) => ({ ...it, cost: cost ? it.cost : null, margin: cost && it.cost != null ? Math.round((it.value - it.cost) * 100) / 100 : null,
      dprs: it.dprs.map((d) => ({ ...d, route: `/site/dprs?id=${d.id}` })) }));
    return { projectId: row.project_id, project: `${row.projectCode} ${row.projectName}`, siteId: row.site_id, site: row.siteCode ?? null, date, capturedAt: row.captured_at, captured: true, costVisible: cost,
      items, totals: { planned: rs(row.planned_value), executed: rs(row.executed_value), cost: cost ? rs(row.cost_value) : null,
        ...(row.site_id == null ? { cumulative: rs(row.cum_value), wip: rs(row.wip_value), billedGap: rs(row.billed_gap_value), balance: rs(row.balance_value) } : {}) },
      dprs: snap.dprs.map((id) => ({ id, route: `/site/dprs?id=${id}` })) };
  }

  function exportValuation(actor, q, format) {
    guard(actor, 'bi.execution.export');
    const v = valuation(actor, q);
    const cost = v.costVisible;
    const columns = [['code', 'Item', 'text'], ['description', 'Description', 'text'], ['uom', 'Unit', 'text'], ['qty', 'Quantity', 'number'], ['rate', 'Contract rate (₹)', 'number'], ['value', 'Work done (₹)', 'number'],
      ...(cost ? [['cost', 'Budget cost (₹)', 'number'], ['margin', 'Margin (₹)', 'number']] : []), ['dprs', 'DPRs', 'text']].map(([key, label, type]) => ({ key, label, type }));
    const rows = v.items.map((it) => ({ ...it, dprs: it.dprs.map((d) => d.no).join(', ') }));
    const buffer = writeExport(format, { columns, rows, title: `Work-done valuation ${v.project ?? ''} ${v.site ?? ''} ${v.date}`.replace(/\s+/g, ' '), sheetName: 'Valuation',
      footer: [`Approved DPRs only · contract BOQ rates${cost ? ' · budget cost of the approved budget' : ''} · captured ${v.capturedAt ?? 'not yet'}`, `Total work done ₹${v.totals?.executed ?? 0}`] });
    writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'bi.execution_valuation', action: 'export', newValues: { format, projectId: q.projectId, siteId: q.siteId ?? null, date: v.date }, actor: actor.user });
    return { buffer, contentType: FORMATS[format], fileName: `work-done-${v.date}.${format}` };
  }

  /** For MIS and forecasting (27.07, 23.11): the project rows of a period, as the system (no person's scope). */
  function series(companyId, projectId, from, to) {
    return db.prepare(`SELECT snap_date AS date, planned_value AS planned, executed_value AS executed, cost_value AS cost, wip_value AS wip, cum_value AS cumulative, balance_value AS balance
      FROM dei_daily WHERE company_id = ? AND project_id = ? AND site_id IS NULL AND snap_date BETWEEN ? AND ? AND deleted_at IS NULL ORDER BY snap_date`).all(companyId, projectId, from, to)
      .map((r) => ({ ...r, planned: rs(r.planned), executed: rs(r.executed), cost: rs(r.cost), wip: rs(r.wip), cumulative: rs(r.cumulative), balance: rs(r.balance) }));
  }

  function queue(actor, { date, projectId }) {
    guard(actor, 'bi.execution.run');
    if (date > todayIST()) throw badRequest('A future day has no approved DPRs.', [{ field: 'date', message: 'is in the future' }]);
    return jobs.enqueue(JOB, { companyId: actor.companyId, date, projectId: projectId ?? null }, { companyId: actor.companyId, createdBy: actor.user });
  }

  const service = { capture, overview, valuation, exportValuation, series, queue, computeProject };
  services.set(db, service);
  return service;
}

const contexts = new WeakMap();
export const bindExecution = (db, context) => contexts.set(db, context);
const availableTo = (db, actor) => {
  const context = contexts.get(db);
  if (!context || !executionOf(db) || !hasPermissionAnywhere(actor, 'bi.execution.view')) return false;
  try { requireExecution(context, actor); return true; } catch (error) { if (error.status === 404) return false; throw error; }
};
/** Dashboard (03.07): today's work done in the actor's scope, with the planned value of the day. */
widgetRegistry.register({
  code: 'bi.work_done_today',
  available: availableTo,
  provider({ db, actor, filters }) {
    const d = executionOf(db).overview(actor, { projectId: filters.projectId ?? undefined, siteId: filters.siteId ?? undefined });
    return { label: 'Work done today', value: d.tiles.executed, kind: 'money', currency: 'INR', subtitle: `Planned ₹${d.tiles.planned ?? 0} · ${d.tiles.sitesReporting} site(s)`,
      drill: `/bi/execution${filters.projectId ? `?projectId=${filters.projectId}` : ''}` };
  },
});
/** Project 360 (10.08): the work done and WIP of the selected project. */
registerProject360Widget('bi.work_done_today', ({ db, actor, project }) => {
  if (!availableTo(db, actor)) return null;
  const d = executionOf(db).overview(actor, { projectId: project.project_id });
  return { figures: [{ key: 'workDone', label: 'Work done today (₹)', value: d.tiles.executed, drill: `/bi/execution?projectId=${project.project_id}` },
    { key: 'wip', label: 'WIP, executed not certified (₹)', value: d.tiles.wip, drill: `/bi/execution?tab=valuation&projectId=${project.project_id}` }], note: `As of ${d.date}` };
});
