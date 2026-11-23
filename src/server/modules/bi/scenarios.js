import { writeAudit } from '../../platform/audit/index.js';
import { assertPermissionAnywhere, hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { tasksOf } from '../../platform/tasks/index.js';
import { todayIST } from '../../../shared/dates.js';
import { INFLOWS, weekly } from '../fin/cashforecast.js';
import { etcOf } from '../fin/costforecast.js';
import { calculate, makeCalendar, ordOf } from '../plan/cpm.js';
import { requireMetricCatalogueSource } from './domain-metrics.js';

/**
 * Part 27.11 — scenario and what-if simulation.
 *
 * A scenario (`scn_scenarios`) names a project (or the portfolio) and a list of drivers; its impact is computed on copies read from the owners
 * and never written back (BR-01):
 *   cost and margin   the lines of the latest approved cost forecast (23.11), their estimate to complete worked out as 23.11 does (`etcOf`);
 *                     a price or wage driver changes the remaining quantity × rate of the matching lines by its percent (T-01: steel +10 %
 *                     changes the EAC by remaining steel quantity × 10 % × rate); margin = contract revenue − EAC
 *   completion date   the current schedule (13.01) recalculated in memory by its own CPM with the delays added to the activities named
 *   cash              the lines of the latest approved 13-week cash forecast (23.13) through its own weekly roll-up, with collections shifted
 *                     and the extra cost spread over the weeks; a cash constraint reports the weeks under the floor
 * Scenarios are compared side by side, shared with chosen people, and turned into tasks (04.08) or forecast assumptions (a task and a
 * notification to the forecast owner — the forecast itself is changed only through its own approval).
 */

export const SCN_FLAG = 'ff.bi.p2711';
export const DRIVERS = Object.freeze({
  MATERIAL_PRICE: { label: 'Material price change', fields: { match: 'text', pct: [-50, 200] } },
  WAGE_RATE: { label: 'Wage increase', fields: { pct: [-50, 200] } },
  PRODUCTIVITY_LOSS: { label: 'Productivity loss', fields: { match: 'text?', pct: [0, 100] } },
  EQUIPMENT_BREAKDOWN: { label: 'Equipment breakdown', fields: { activity: 'text?', days: [0, 365], dailyCost: [0, 1e8] } },
  PROCUREMENT_DELAY: { label: 'Procurement delay', fields: { activity: 'text', days: [0, 365] } },
  SCHEDULE_DELAY: { label: 'Schedule delay', fields: { activity: 'text?', days: [0, 730] } },
  CLIENT_PAYMENT_DELAY: { label: 'Client payment delay', fields: { weeks: [0, 13] } },
  QUANTITY_VARIATION: { label: 'Quantity variation', fields: { match: 'text', pct: [-100, 200] } },
  SCOPE_CHANGE: { label: 'Scope change', fields: { cost: [-1e11, 1e11], revenue: [-1e11, 1e11], days: [0, 730] } },
  CASH_CONSTRAINT: { label: 'Cash constraint', fields: { minBalance: [-1e12, 1e12] } },
});
const rs = (p) => (p == null ? null : Math.round(Number(p)) / 100);
const paise = (r) => Math.round(Number(r) * 100);
const inr = (rupees) => `₹${Number(rupees).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const iso = () => new Date().toISOString();
const has = (db, t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
const scnShape = { type: 'object', required: ['docNo'], properties: { docNo: { type: 'string' }, kind: { type: 'string' } } };
eventTypes.define({ type: 'bi.scenario.assumption_proposed', version: 1, schema: scnShape, owner: 'bi', description: 'A what-if scenario was proposed as an assumption for the next cost forecast (part 27.11): data { docNo, kind, projectId, eacDelta, note }. The forecast owner decides in 23.11.' });

/** Validate the drivers against their definitions; returns the clean list or throws 400 with each field. */
export function checkDrivers(drivers) {
  const problems = [];
  const out = (drivers ?? []).map((d, i) => {
    const def = DRIVERS[d?.type];
    if (!def) { problems.push({ field: `drivers.${i}.type`, message: 'is not a driver' }); return null; }
    const clean = { type: d.type };
    for (const [k, spec] of Object.entries(def.fields)) {
      const v = d[k];
      if (typeof spec === 'string') {
        if (v == null || v === '') { if (!spec.endsWith('?')) problems.push({ field: `drivers.${i}.${k}`, message: 'is required' }); continue; }
        if (typeof v !== 'string' || v.length > 60) problems.push({ field: `drivers.${i}.${k}`, message: 'must be a short text' }); else clean[k] = v.trim();
      } else if (typeof v !== 'number' || Number.isNaN(v) || v < spec[0] || v > spec[1]) problems.push({ field: `drivers.${i}.${k}`, message: `must be between ${spec[0]} and ${spec[1]}` });
      else clean[k] = v;
    }
    return clean;
  });
  if (!out.length) problems.push({ field: 'drivers', message: 'Add at least one driver' });
  if (problems.length) throw badRequest('Correct the highlighted drivers.', problems);
  return out;
}

const contexts = new WeakMap();
export function requireScenarios(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, SCN_FLAG)) throw notFound('Scenarios are unavailable.');
  requireMetricCatalogueSource(context, actor);
}

export function createScenarios(context) {
  const { db } = context;
  contexts.set(db, context);
  const authz = authzOf(db);
  const notify = notificationsOf(db);
  const may = (actor, key, projectId) => authz.check(actor, key, { companyId: actor.companyId, ...(projectId ? { projectId } : {}) }).allowed;
  const guard = (actor, key = 'bi.scenario.view') => { requireScenarios(context, actor); assertPermissionAnywhere(actor, key); };
  const projectOf = (actor, id) => {
    const p = db.prepare('SELECT id, code, name FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!p || !may(actor, 'bi.scenario.view', p.id)) throw notFound('That project is not in your scope.');
    return p;
  };

  // ---------------------------------------------------------------- the copies of the owners' figures (read only)
  function forecastCopy(companyId, projectId) {
    if (!has(db, 'fc_forecasts')) return null;
    const f = db.prepare("SELECT * FROM fc_forecasts WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period DESC, version_no DESC, id DESC LIMIT 1").get(companyId, projectId);
    if (!f) return null;
    const lines = db.prepare(`SELECT l.*, c.code AS cc, c.name AS ccName, h.code AS head, h.name AS headName FROM fc_forecast_lines l LEFT JOIN fin_cost_codes c ON c.id = l.cost_code_id LEFT JOIN fin_cost_heads h ON h.id = c.cost_head_id
      WHERE l.forecast_id = ? AND l.deleted_at IS NULL ORDER BY l.id`).all(f.id).map((l) => {
      const shaped = { method: l.etc_method, budget: l.budget_paise, actual: l.actual_paise, accrued: l.accrued_paise, committed: l.committed_paise, earned: l.earned_paise, budgetQty: l.budget_qty_milli, actualQty: l.actual_qty_milli,
        remainingQty: l.remaining_qty_milli, rate: l.rate_x100, manual: l.manual_paise };
      const etc = l.etc_paise ?? etcOf(shaped).etc;
      const qty = l.remaining_qty_milli ?? Math.max(0, l.budget_qty_milli - l.actual_qty_milli);
      const rate = l.rate_x100 ?? (l.actual_qty_milli > 0 ? Math.round((l.actual_paise * 1000) / l.actual_qty_milli) : l.budget_qty_milli > 0 ? Math.round((l.budget_paise * 1000) / l.budget_qty_milli) : 0);
      return { id: l.id, label: l.line_label ?? l.ccName ?? `Line ${l.id}`, costCode: l.cc, costCodeName: l.ccName, head: l.head, headName: l.headName, spent: l.actual_paise + l.accrued_paise, etc, eac: l.eac_paise ?? (l.actual_paise + l.accrued_paise + etc), qty, rate };
    });
    return { id: f.id, docNo: f.doc_no, period: f.period, eac: f.eac_total_paise, revenue: f.contract_revenue_paise, risk: f.risk_allowance_paise ?? 0, pendingVar: f.pending_var_cost_paise ?? 0, lines };
  }
  function scheduleCopy(companyId, projectId) {
    if (!has(db, 'plan_schedules')) return null;
    const s = db.prepare("SELECT * FROM plan_schedules WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY (status = 'APPROVED') DESC, id DESC LIMIT 1").get(companyId, projectId);
    if (!s) return null;
    const calRow = db.prepare('SELECT * FROM plan_calendars WHERE id = ?').get(s.calendar_id);
    const holidays = calRow?.holiday_calendar_id ? db.prepare('SELECT holiday_date FROM core_holidays WHERE calendar_id = ? AND deleted_at IS NULL').all(calRow.holiday_calendar_id).map((h) => h.holiday_date) : [];
    const exceptions = (() => { try { return JSON.parse(calRow?.exceptions_json ?? '[]'); } catch { return []; } })();
    const calendar = makeCalendar({ workWeek: calRow?.work_week ?? '1111110', holidays, exceptions });
    const acts = db.prepare('SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id);
    const links = db.prepare('SELECT pred_id AS pred, succ_id AS succ, dep_type AS type, lag_days AS lag FROM plan_dependencies WHERE schedule_id = ? AND deleted_at IS NULL').all(s.id);
    return { id: s.id, docNo: s.doc_no, start: s.start_date, dataDate: s.data_date ?? null, calendar, links,
      activities: acts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.act_type, duration: a.duration_days ?? 0, constraintType: a.constraint_type, constraintDate: a.constraint_date, actualStart: a.actual_start, actualFinish: a.actual_finish, pct: a.pct_complete ?? 0, remaining: a.remaining_days ?? null })) };
  }
  function cashCopy(companyId, projectId) {
    if (!has(db, 'cf_forecasts')) return null;
    const f = db.prepare("SELECT * FROM cf_forecasts WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY week_start DESC, version_no DESC, id DESC LIMIT 1").get(companyId);
    if (!f) return null;
    const lines = db.prepare('SELECT * FROM cf_lines WHERE forecast_id = ? AND deleted_at IS NULL ORDER BY week_start, id').all(f.id);
    return { id: f.id, docNo: f.doc_no, weekStart: f.week_start, weeks: f.weeks, opening: f.opening_paise, lines, projectId };
  }
  const matches = (l, m) => { const q = String(m).toLowerCase(); return [l.label, l.costCode, l.costCodeName, l.head, l.headName].some((x) => x && String(x).toLowerCase().includes(q)); };
  const isLabour = (l) => /labou?r|wage|gang|manpower/i.test(`${l.label} ${l.costCodeName ?? ''} ${l.head ?? ''} ${l.headName ?? ''}`);

  /** The impact of the drivers on copies (FR-02). Pure with respect to the database: it reads, never writes. */
  function compute(companyId, projectId, drivers, { overheadPerDay = 0 } = {}) {
    const fc = forecastCopy(companyId, projectId);
    const sc = scheduleCopy(companyId, projectId);
    const cf = cashCopy(companyId, projectId);
    const effects = [];
    // ---- cost: price, wage, productivity, quantity on the remaining quantity × rate of the lines
    const lineDeltas = new Map();
    const addLine = (l, d, driver, why) => { if (!d) return; lineDeltas.set(l.id, (lineDeltas.get(l.id) ?? 0) + d); effects.push({ driver, area: 'cost', line: l.label, amount: rs(d), why }); };
    let costExtra = 0; let revenueExtra = 0; const delays = [];
    for (const d of drivers) {
      const lines = fc?.lines ?? [];
      if (d.type === 'MATERIAL_PRICE' || d.type === 'QUANTITY_VARIATION') {
        const hit = lines.filter((l) => matches(l, d.match));
        if (!hit.length) effects.push({ driver: d.type, area: 'cost', line: null, amount: 0, why: `No forecast line matches "${d.match}"` });
        for (const l of hit) {
          const base = l.qty > 0 && l.rate > 0 ? Math.round((l.qty * l.rate) / 1000) : l.etc;
          addLine(l, Math.round((base * d.pct) / 100), d.type, l.qty > 0 && l.rate > 0 ? `${l.qty / 1000} remaining × ${inr(rs(l.rate))} × ${d.pct} %` : `estimate to complete ${inr(rs(l.etc))} × ${d.pct} %`);
        }
      }
      if (d.type === 'WAGE_RATE') for (const l of lines.filter(isLabour)) { const base = l.qty > 0 && l.rate > 0 ? Math.round((l.qty * l.rate) / 1000) : l.etc; addLine(l, Math.round((base * d.pct) / 100), d.type, `labour to complete ${inr(rs(base))} × ${d.pct} %`); }
      if (d.type === 'PRODUCTIVITY_LOSS') {
        const hit = d.match ? lines.filter((l) => matches(l, d.match)) : lines.filter(isLabour);
        for (const l of hit) { const extra = d.pct >= 100 ? l.etc : Math.round((l.etc * d.pct) / (100 - d.pct)); addLine(l, extra, d.type, `${d.pct} % less output: estimate to complete ${inr(rs(l.etc))} ÷ (1 − ${d.pct} %) − itself`); }
      }
      if (d.type === 'EQUIPMENT_BREAKDOWN') { const c = paise(d.dailyCost) * d.days; costExtra += c; effects.push({ driver: d.type, area: 'cost', line: null, amount: rs(c), why: `${d.days} days × ${inr(d.dailyCost)} standby and repair` }); if (d.activity) delays.push({ driver: d.type, activity: d.activity, days: d.days }); }
      if (d.type === 'PROCUREMENT_DELAY' || d.type === 'SCHEDULE_DELAY') delays.push({ driver: d.type, activity: d.activity ?? null, days: d.days });
      if (d.type === 'SCOPE_CHANGE') { costExtra += paise(d.cost); revenueExtra += paise(d.revenue); effects.push({ driver: d.type, area: 'cost', line: null, amount: rs(paise(d.cost)), why: `scope change: cost ₹${d.cost}, revenue ₹${d.revenue}` }); if (d.days) delays.push({ driver: d.type, activity: null, days: d.days }); }
    }
    // ---- schedule: the CPM of 13.01 on a copy, with the delays added to the activities named (or to the last open activity of the critical path)
    let schedule = null;
    if (sc && sc.activities.length) {
      const run = (acts) => calculate({ start: sc.start, dataDate: sc.dataDate, calendar: sc.calendar, activities: acts, links: sc.links });
      const base = run(sc.activities);
      if (base.ok) {
        const copy = sc.activities.map((a) => ({ ...a }));
        const open = (a) => !a.actualFinish && !['MILESTONE', 'LOE', 'SUMMARY'].includes(a.type);
        const lastCritical = () => [...copy].filter((a) => open(a) && base.results.get(a.id)?.critical).sort((a, b) => ordOf(base.results.get(b.id).ef) - ordOf(base.results.get(a.id).ef))[0] ?? copy.filter(open).at(-1);
        const applied = [];
        for (const dl of delays) {
          const a = dl.activity ? copy.find((x) => x.code.toLowerCase() === dl.activity.toLowerCase()) : lastCritical();
          if (!a) { effects.push({ driver: dl.driver, area: 'schedule', line: dl.activity, amount: 0, why: `Activity ${dl.activity} is not in the schedule` }); continue; }
          if (a.actualStart && !a.actualFinish) a.remaining = (a.remaining ?? Math.max(0, Math.round((a.duration * (10000 - (a.pct ?? 0))) / 10000))) + dl.days; else a.duration += dl.days;
          applied.push({ driver: dl.driver, activity: a.code, days: dl.days });
        }
        const after = run(copy);
        const shift = after.ok ? ordOf(after.finish) - ordOf(base.finish) : 0;
        for (const x of applied) effects.push({ driver: x.driver, area: 'schedule', line: x.activity, amount: 0, why: `${x.activity} ${x.days} working days longer; completion ${after.ok ? after.finish : base.finish} against ${base.finish}` });
        let work = 0; if (after.ok) for (let o = ordOf(base.finish) + 1; o <= ordOf(after.finish); o += 1) if (sc.calendar.isWork(o)) work += 1;
        const overhead = paise(overheadPerDay) * Math.max(0, work);
        if (overhead) { costExtra += overhead; effects.push({ driver: 'DELAY_OVERHEAD', area: 'cost', line: null, amount: rs(overhead), why: `${work} working days later × ${inr(overheadPerDay)} site overhead a day` }); }
        schedule = { source: `${sc.docNo} (13.01)`, scheduleId: sc.id, baseFinish: base.finish, finish: after.ok ? after.finish : base.finish, shiftDays: shift, shiftWorkingDays: work, applied };
      } else schedule = { source: `${sc.docNo} (13.01)`, error: 'The schedule has a loop and cannot be recalculated.' };
    }
    const lineTotal = [...lineDeltas.values()].reduce((a, b) => a + b, 0);
    const eacDelta = lineTotal + costExtra;
    const cost = fc ? { source: `${fc.docNo} ${fc.period} (23.11)`, forecastId: fc.id, baseEac: rs(fc.eac), eac: rs(fc.eac + eacDelta), eacDelta: rs(eacDelta), revenue: rs(fc.revenue), scenarioRevenue: rs(fc.revenue + revenueExtra),
      baseMargin: rs(fc.revenue - fc.eac), margin: rs(fc.revenue + revenueExtra - fc.eac - eacDelta), marginDelta: rs(revenueExtra - eacDelta),
      lines: fc.lines.filter((l) => lineDeltas.get(l.id)).map((l) => ({ label: l.label, baseEac: rs(l.eac), delta: rs(lineDeltas.get(l.id)), eac: rs(l.eac + lineDeltas.get(l.id)) })) } : null;
    // ---- cash: the weekly roll-up of 23.13 on a copy: collections of the project shifted, the extra cost spread over the horizon, the floor checked
    let cash = null;
    if (cf) {
      const shiftWeeks = drivers.filter((d) => d.type === 'CLIENT_PAYMENT_DELAY').reduce((n, d) => n + d.weeks, 0);
      const base = weekly(cf.lines, { weekStart: cf.weekStart, weeks: cf.weeks, opening: cf.opening });
      const add = (w, n) => { const t = new Date(Date.parse(`${w}T00:00:00Z`) + n * 7 * 86_400_000); return t.toISOString().slice(0, 10); };
      const moved = cf.lines.map((l) => (shiftWeeks && INFLOWS.includes(l.category) && (!projectId || l.org_project_id === projectId) ? { ...l, week_start: add(l.week_start, shiftWeeks) } : l));
      const spread = Math.round(eacDelta / cf.weeks);
      const extra = eacDelta ? Array.from({ length: cf.weeks }, (_, k) => ({ week_start: add(cf.weekStart, k), category: 'SCENARIO', inflow_paise: spread < 0 ? -spread : 0, outflow_paise: spread > 0 ? spread : 0 })) : [];
      const after = weekly([...moved, ...extra], { weekStart: cf.weekStart, weeks: cf.weeks, opening: cf.opening });
      const floor = drivers.filter((d) => d.type === 'CASH_CONSTRAINT').map((d) => paise(d.minBalance))[0];
      cash = { source: `${cf.docNo} (23.13)`, forecastId: cf.id, weeks: cf.weeks, baseClosing: rs(base.closing), closing: rs(after.closing), baseLowest: rs(base.lowest), lowest: rs(after.lowest), lowestWeek: after.lowWeek, lowestDelta: rs(after.lowest - base.lowest),
        collectionsShiftedWeeks: shiftWeeks, costSpreadPerWeek: rs(spread), floor: floor == null ? null : rs(floor), weeksBelowFloor: floor == null ? [] : after.rows.filter((r) => r.closing < floor).map((r) => r.week),
        series: after.rows.map((r, i) => ({ week: r.week, base: rs(base.rows[i].closing), scenario: rs(r.closing) })) };
      if (shiftWeeks) effects.push({ driver: 'CLIENT_PAYMENT_DELAY', area: 'cash', line: null, amount: rs(after.lowest - base.lowest), why: `collections ${projectId ? 'of the project ' : ''}${shiftWeeks} weeks later` });
    }
    return { cost, schedule, cash, effects, computedAt: iso(), method: 'Computed on copies; the forecast, schedule and cash forecast are unchanged.' };
  }

  // ---------------------------------------------------------------- the record
  const visible = (actor, r) => r.created_by === actor.user || JSON.parse(r.shared_json || '[]').includes(actor.user) || (hasPermissionAnywhere(actor, 'bi.scenario.share') && r.status !== 'DRAFT');
  function row(actor, id) {
    const r = db.prepare('SELECT * FROM scn_scenarios WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(Number(id), actor.companyId);
    if (!r || (r.project_id && !may(actor, 'bi.scenario.view', r.project_id)) || !visible(actor, r)) throw notFound('That scenario does not exist.');
    return r;
  }
  const view = (actor, r) => {
    const p = r.project_id ? db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.project_id) : null;
    const own = r.created_by === actor.user;
    return { id: r.id, docNo: r.doc_no, name: r.name, projectId: r.project_id, project: p ? `${p.code} ${p.name}` : null, drivers: JSON.parse(r.drivers_json), overheadPerDay: rs(r.overhead_per_day), results: r.results_json ? JSON.parse(r.results_json) : null,
      status: r.status, sharedWith: JSON.parse(r.shared_json), actions: JSON.parse(r.actions_json), owner: r.created_by, computedAt: r.computed_at, rowVersion: r.version,
      summary: { eacDelta: rs(r.eac_delta), marginDelta: rs(r.margin_delta), finishDeltaDays: r.finish_delta_days, cashLowDelta: rs(r.cash_low_delta) },
      can: { edit: own && r.status !== 'ARCHIVED' && hasPermissionAnywhere(actor, 'bi.scenario.edit'), delete: own && hasPermissionAnywhere(actor, 'bi.scenario.delete'), share: own && hasPermissionAnywhere(actor, 'bi.scenario.share'),
        convert: hasPermissionAnywhere(actor, 'bi.scenario.convert') && r.status === 'SAVED', export: hasPermissionAnywhere(actor, 'bi.scenario.export') } };
  };
  const nextNo = (c) => `SCN-${String(Number(db.prepare("SELECT COALESCE(MAX(CAST(substr(doc_no, 5) AS INTEGER)), 0) + 1 AS n FROM scn_scenarios WHERE company_id = ?").get(c).n)).padStart(5, '0')}`;
  const store = (r, out) => db.prepare('UPDATE scn_scenarios SET results_json = ?, base_json = ?, eac_delta = ?, margin_delta = ?, finish_delta_days = ?, cash_low_delta = ?, computed_at = ? WHERE id = ?')
    .run(JSON.stringify(out), JSON.stringify({ forecastId: out.cost?.forecastId ?? null, scheduleId: out.schedule?.scheduleId ?? null, cashForecastId: out.cash?.forecastId ?? null }),
      out.cost ? paise(out.cost.eacDelta) : null, out.cost ? paise(out.cost.marginDelta) : null, out.schedule?.shiftDays ?? null, out.cash ? paise(out.cash.lowestDelta) : null, out.computedAt, r.id);

  const svc = {
    drivers(actor) {
      guard(actor);
      const scope = authz.scopeFilter(actor, 'bi.scenario.view', { project: 'p.id' });
      return { drivers: Object.entries(DRIVERS).map(([type, d]) => ({ type, label: d.label, fields: Object.entries(d.fields).map(([k, f]) => (typeof f === 'string' ? { key: k, kind: 'text', required: !f.endsWith('?') } : { key: k, kind: 'number', min: f[0], max: f[1], required: true })) })),
        projects: db.prepare(`SELECT p.id, p.code, p.name FROM org_projects p WHERE p.company_id = :c AND p.deleted_at IS NULL AND p.status IN ('ACTIVE', 'ON_HOLD') AND (${scope.sql}) ORDER BY p.code`).all({ ...(scope.params ?? {}), c: actor.companyId }),
        can: { create: hasPermissionAnywhere(actor, 'bi.scenario.create'), export: hasPermissionAnywhere(actor, 'bi.scenario.export') } };
    },
    preview(actor, b) {
      guard(actor);
      const p = projectOf(actor, b.projectId);
      return compute(actor.companyId, p.id, checkDrivers(b.drivers), { overheadPerDay: b.overheadPerDay ?? 0 });
    },
    list(actor, q = {}) {
      guard(actor);
      const rows = db.prepare('SELECT * FROM scn_scenarios WHERE company_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 500').all(actor.companyId)
        .filter((r) => (!r.project_id || may(actor, 'bi.scenario.view', r.project_id)) && visible(actor, r) && (!q.projectId || r.project_id === q.projectId) && (!q.status || r.status === q.status));
      return { rows: rows.slice(0, q.limit ?? 100).map((r) => { const v = view(actor, r); delete v.results; return v; }), total: rows.length };
    },
    get: (actor, id) => { guard(actor); return view(actor, row(actor, id)); },
    create(actor, b) {
      guard(actor, 'bi.scenario.create');
      const p = projectOf(actor, b.projectId); const drivers = checkDrivers(b.drivers);
      return transaction(db, () => {
        const docNo = nextNo(actor.companyId);
        const id = Number(db.prepare("INSERT INTO scn_scenarios (company_id, doc_no, name, project_id, scope_json, drivers_json, overhead_per_day, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .run(actor.companyId, docNo, b.name, p.id, JSON.stringify({ projectId: p.id }), JSON.stringify(drivers), paise(b.overheadPerDay ?? 0), b.save ? 'SAVED' : 'DRAFT', actor.user).lastInsertRowid);
        const r = db.prepare('SELECT * FROM scn_scenarios WHERE id = ?').get(id);
        store(r, compute(actor.companyId, p.id, drivers, { overheadPerDay: b.overheadPerDay ?? 0 }));
        writeAudit(db, { companyId: actor.companyId, entity: 'scn_scenarios', entityId: id, action: 'create', newValues: { docNo, name: b.name, projectId: p.id, drivers }, actor: actor.user });
        return view(actor, db.prepare('SELECT * FROM scn_scenarios WHERE id = ?').get(id));
      });
    },
    update(actor, id, b) {
      guard(actor, 'bi.scenario.edit');
      return transaction(db, () => {
        const r = row(actor, id);
        if (r.created_by !== actor.user) throw forbidden('Only the author changes a scenario; make a copy to try your own drivers.');
        if (r.version !== b.rowVersion) throw conflict('The scenario changed since you opened it. Refresh and try again.');
        if (r.status === 'ARCHIVED') throw unprocessable('An archived scenario is not changed.');
        const drivers = b.drivers ? checkDrivers(b.drivers) : JSON.parse(r.drivers_json);
        const overhead = b.overheadPerDay ?? rs(r.overhead_per_day);
        const status = b.status ?? (b.save ? 'SAVED' : r.status);
        db.prepare('UPDATE scn_scenarios SET name = ?, drivers_json = ?, overhead_per_day = ?, status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.name ?? r.name, JSON.stringify(drivers), paise(overhead), status, actor.user, iso(), r.id);
        if (status !== 'ARCHIVED') store(r, compute(actor.companyId, r.project_id, drivers, { overheadPerDay: overhead }));
        writeAudit(db, { companyId: actor.companyId, entity: 'scn_scenarios', entityId: r.id, action: 'update', oldValues: { drivers: JSON.parse(r.drivers_json), status: r.status }, newValues: { drivers, status }, actor: actor.user });
        return view(actor, db.prepare('SELECT * FROM scn_scenarios WHERE id = ?').get(r.id));
      });
    },
    remove(actor, id) {
      guard(actor, 'bi.scenario.delete');
      const r = row(actor, id); if (r.created_by !== actor.user) throw forbidden('Only the author deletes a scenario.');
      db.prepare('UPDATE scn_scenarios SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(iso(), actor.user, r.id);
      writeAudit(db, { companyId: actor.companyId, entity: 'scn_scenarios', entityId: r.id, action: 'delete', actor: actor.user });
      return { id: r.id, deleted: true };
    },
    share(actor, id, { users }) {
      guard(actor, 'bi.scenario.share');
      return transaction(db, () => {
        const r = row(actor, id); if (r.created_by !== actor.user) throw forbidden('Only the author shares a scenario.');
        const known = users.filter((u) => db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1").get(actor.companyId, u));
        if (known.length !== users.length) throw badRequest('Share only with people of the company.', [{ field: 'users', message: `unknown: ${users.filter((u) => !known.includes(u)).join(', ')}` }]);
        db.prepare("UPDATE scn_scenarios SET shared_json = ?, status = CASE WHEN status = 'DRAFT' THEN 'SAVED' ELSE status END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(known), actor.user, iso(), r.id);
        if (known.length) notify.notify({ companyId: actor.companyId, templateCode: 'bi.scenario.shared', recipients: known.map((u) => `user:${u}`), data: { docNo: r.doc_no, name: r.name, actor: actor.user },
          category: 'mentions', link: `/bi/scenarios?id=${r.id}`, channels: ['IN_APP'], sourceType: 'scn_scenario', sourceId: r.id, eventKey: `scn:${r.id}:share:${r.version}` });
        writeAudit(db, { companyId: actor.companyId, entity: 'scn_scenarios', entityId: r.id, action: 'share', newValues: { users: known }, actor: actor.user });
        return view(actor, db.prepare('SELECT * FROM scn_scenarios WHERE id = ?').get(r.id));
      });
    },
    /** FR-03: turn a saved scenario into a task (04.08) or a forecast assumption (a task and an event for the forecast owner; the forecast changes only by its own approval). */
    convert(actor, id, { kind, assignee, note, dueDate }) {
      guard(actor, 'bi.scenario.convert');
      return transaction(db, () => {
        const r = row(actor, id);
        if (r.status !== 'SAVED') throw unprocessable('Save the scenario before turning it into actions.');
        if (!db.prepare("SELECT 1 FROM iam_users WHERE company_id = ? AND username = ? AND is_active = 1").get(actor.companyId, assignee)) throw badRequest('Choose a person of the company.', [{ field: 'assignee', message: 'is not a user' }]);
        const res = JSON.parse(r.results_json || '{}');
        const title = kind === 'ASSUMPTION' ? `Forecast assumption from ${r.doc_no}: ${r.name}` : `${r.doc_no}: ${r.name}`;
        const desc = `${note}\n\nScenario impact: EAC ${res.cost ? `${res.cost.eacDelta >= 0 ? '+' : ''}₹${res.cost.eacDelta}` : 'n/a'}, completion ${res.schedule?.shiftDays ?? 0} days, lowest cash ${res.cash ? `₹${res.cash.lowestDelta}` : 'n/a'}.`;
        const t = tasksOf(db).create({ companyId: actor.companyId, title: title.slice(0, 200), description: desc.slice(0, 2000), entity: 'scn_scenario', entityId: r.id, entityLabel: r.doc_no, projectId: r.project_id ?? null, priority: 'MEDIUM',
          dueDate: dueDate ?? null, assignees: [assignee], origin: 'manual', assigner: actor.user, actor: actor.user, source: { type: 'scn_scenario', id: String(r.id) } });
        const actions = [...JSON.parse(r.actions_json || '[]'), { kind, taskId: t.id, assignee, note, at: iso(), by: actor.user }];
        db.prepare('UPDATE scn_scenarios SET actions_json = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(actions), actor.user, iso(), r.id);
        if (kind === 'ASSUMPTION') publishEvent(db, { type: 'bi.scenario.assumption_proposed', entity: 'scn_scenarios', entityId: r.id, actorId: actor.user, companyId: actor.companyId, projectId: r.project_id ?? undefined,
          data: { docNo: r.doc_no, kind, projectId: r.project_id, eacDelta: res.cost?.eacDelta ?? null, note } });
        writeAudit(db, { companyId: actor.companyId, entity: 'scn_scenarios', entityId: r.id, action: 'convert', newValues: { kind, taskId: t.id, assignee }, actor: actor.user });
        return view(actor, db.prepare('SELECT * FROM scn_scenarios WHERE id = ?').get(r.id));
      });
    },
    /** FR-03: side by side. */
    compare(actor, ids) {
      guard(actor);
      const list = ids.map((id) => view(actor, row(actor, id)));
      const projects = new Set(list.map((s) => s.projectId));
      return { scenarios: list.map((s) => ({ id: s.id, docNo: s.docNo, name: s.name, project: s.project, drivers: s.drivers, cost: s.results?.cost ?? null, schedule: s.results?.schedule ?? null, cash: s.results?.cash ? { ...s.results.cash, series: undefined } : null, computedAt: s.computedAt })),
        sameProject: projects.size === 1, base: list[0]?.results ? { eac: list[0].results.cost?.baseEac ?? null, margin: list[0].results.cost?.baseMargin ?? null, finish: list[0].results.schedule?.baseFinish ?? null, lowest: list[0].results.cash?.baseLowest ?? null } : null };
    },
    exportCompare(actor, ids, format) {
      guard(actor, 'bi.scenario.export');
      const c = svc.compare(actor, ids);
      const columns = [['docNo', 'Scenario'], ['name', 'Name'], ['project', 'Project'], ['drivers', 'Drivers'], ['eac', 'EAC (₹)'], ['eacDelta', 'EAC change (₹)'], ['margin', 'Margin (₹)'], ['finish', 'Completion'], ['shift', 'Days later'], ['lowest', 'Lowest cash (₹)']].map(([key, label]) => ({ key, label, type: 'text' }));
      const rows = c.scenarios.map((s) => ({ docNo: s.docNo, name: s.name, project: s.project ?? '', drivers: s.drivers.map((d) => `${DRIVERS[d.type].label} ${d.pct ?? d.days ?? d.weeks ?? ''}`).join('; '), eac: String(s.cost?.eac ?? ''), eacDelta: String(s.cost?.eacDelta ?? ''),
        margin: String(s.cost?.margin ?? ''), finish: s.schedule?.finish ?? '', shift: String(s.schedule?.shiftDays ?? ''), lowest: String(s.cash?.lowest ?? '') }));
      const buffer = writeExport(format, { columns, rows, title: 'Scenario comparison', sheetName: 'Scenarios', footer: [`Base: EAC ₹${c.base?.eac ?? '—'}, margin ₹${c.base?.margin ?? '—'}, completion ${c.base?.finish ?? '—'}, lowest cash ₹${c.base?.lowest ?? '—'} · computed on copies as of ${todayIST()}`] });
      writeAudit(db, { companyId: actor.companyId, entity: 'report', entityId: 'bi.scenarios', action: 'export', newValues: { format, ids }, actor: actor.user });
      return { buffer, contentType: FORMATS[format], fileName: `scenario-comparison.${format}` };
    },
  };
  return svc;
}
