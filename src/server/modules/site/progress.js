import { createHash } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { writeAudit } from '../../platform/audit/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toCsv, toPdf, toXlsx } from '../../platform/export/index.js';
import { countList, defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry, createParameterStore } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { issueNumber } from '../core/numbering/service.js';
import { isoOf, ordOf } from '../plan/cpm.js';
import { metrics, plannedFraction, rollup } from './evm.js';
import { isEnabled } from '../core/feature-flags/service.js';

// Progress measurement, earned value and S-curves (part 14.05).
// - Physical progress of an activity is the quantity executed in the approved DPRs over its total quantity (FR-01, BR-01); the project and each WBS node are weighted by the budget of the activity (the approved
//   budget of the WBS shared by quantity) or by a manual weight. Planned progress comes from the current baseline (13.03), the forecast from the current schedule.
// - A period (week or month) is closed by approval, PLAN then PM: the adjustments in it (a quantity added or taken off, with a reason) are written, the snapshot and the earned-value figures are kept, and nothing
//   in a closed period changes again (BR-02); a correction is an amendment of the latest closed period.
// - Earned value: PV = sum of budget x planned, EV = sum of budget x financial progress (a measured quantity replaces the DPR one where `site.progress.mb_override` is on), AC is entered with the period until the control engine (14.07) supplies it.
export const PRD_DOC = 'SITE_PROGRESS_PERIOD';
export const PRD_STATUS = { DRAFT: 'Open: being prepared', SUBMITTED: 'Waiting for approval', APPROVED: 'Closed', RETURNED: 'Returned for correction', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded by an amendment' };
export const PERIOD_TYPES = { WEEK: 'Week', MONTH: 'Month' };
const HORIZON = 30; // the forecast of a report is the progress expected this many days after its date
const nowIso = () => new Date().toISOString();
const rid = (v) => parseInt(String(v), 10);
const lower = (s) => String(s ?? '').toLowerCase();
const same = (a, b) => Boolean(a && b && lower(a) === lower(b));
const json = (s, d) => { try { return JSON.parse(s ?? ''); } catch { return d; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const q3 = (n) => Math.round(Number(n) * 1000);
const d3 = (n) => (n == null ? null : n / 1000);
const bp = (f) => Math.round(Math.max(0, Math.min(1, f)) * 10000);
const pc = (f) => Math.round(f * 10000) / 100;
const rs = (n) => (n == null ? null : n / 100);
const ratio = (n) => (n == null ? null : n / 10000);

for (const [key, dataType, def, description, extra] of [
  ['site.progress.mb_override', 'boolean', false, 'BR-01: a measured quantity (measurement book, 22.01) replaces the DPR quantity in the financial progress and the earned value of an activity that has one.', {}],
  ['site.progress.spi_alert', 'integer', 90, 'FR-06: the schedule performance index, in percent, below which a WBS node or the project is shown as behind plan.', { min: 10, max: 100 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

export const periodList = defineList({
  code: 'site.periods', label: 'Progress periods', permission: 'site.period.view', from: 'prs_periods x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code'], defaultSort: '-periodEnd',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Period no.' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, periodType: { sql: 'x.period_type', type: 'enum', label: 'Type', options: Object.entries(PERIOD_TYPES) },
    periodStart: { sql: 'x.period_start', type: 'date', label: 'From' }, periodEnd: { sql: 'x.period_end', type: 'date', label: 'To' }, physical: { sql: 'x.physical_pct', type: 'number', label: 'Physical %' }, planned: { sql: 'x.planned_pct', type: 'number', label: 'Planned %' },
    revisionNo: { sql: 'x.revision_no', type: 'number', label: 'Revision' }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(PRD_STATUS) },
  },
});

export function createProgressService({ db, planOf = () => null }) {
  const authz = authzOf(db);
  // a parameter is read afresh each time (a store keeps its own cache, which a change made through the API does not empty: D-496)
  const param = (companyId, key) => createParameterStore(db).get(key, { companyId, date: todayIST() });
  const may = (actor, key, pid) => authz.check(actor, key, { companyId: actor.companyId, projectId: pid }).allowed;
  const need = (actor, key, what, pid) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const fail = (p) => { if (p.length) throw badRequest('Correct the highlighted fields', p); };
  const audit = (actor, entity, id, action, companyId, extra = {}) => writeAudit(db, { entity, entityId: id, action, actor: actor.user, companyId, ...extra });
  const notify = (companyId, code, recipients, ref, subject, detail, link, sourceId, scope = {}) => { if (!recipients.length) return; try { notificationsOf(db).notify({ companyId, templateCode: code, recipients, data: { ref, subject, detail, link }, link, sourceType: `${code}.${sourceId}`, sourceId, ...scope }); } catch { /* saved anyway */ } };
  const number = (companyId, user) => {
    try { return issueNumber(db, { companyId, docType: PRD_DOC, actor: user, refType: 'prs_periods' }).number; } catch (x) { if (!['DOCUMENT_TYPE_UNKNOWN', 'NUMBER_SERIES_MISSING'].includes(x?.code)) throw x; }
    const n = (db.prepare('SELECT COUNT(*) AS n FROM prs_periods WHERE company_id = ?').get(companyId).n ?? 0) + 1; let no = `PRD/${String(n).padStart(6, '0')}`;
    for (let k = n + 1; db.prepare('SELECT 1 FROM prs_periods WHERE company_id = ? AND doc_no = ?').get(companyId, no); k += 1) no = `PRD/${String(k).padStart(6, '0')}`; return no;
  };
  const project = (actor, projectId, key = 'site.period.view') => {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(rid(projectId));
    if (!p || p.company_id !== actor.companyId || !may(actor, 'site.period.view', p.id)) throw notFound('That project does not exist.'); if (key !== 'site.period.view') need(actor, key, 'do that for this project', p.id); return p;
  };
  const costOf = (actor, pid) => may(actor, 'site.period.cost', pid);

  // ---- the picture of a project on a day: the one place progress and earned value are worked out -----------------------------------------------------------------------------------
  /** Everything one calculation reads, loaded once: the current schedule, the baseline, the budget shares, the weights and the executed quantities. `virtual` adds adjustments not yet written. */
  function load(companyId, projectId, asOf, virtual = []) {
    const sched = db.prepare("SELECT * FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status IN ('APPROVED') ORDER BY version_no DESC LIMIT 1").get(projectId, companyId)
      ?? db.prepare("SELECT * FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY version_no DESC LIMIT 1").get(projectId, companyId);
    if (!sched) throw unprocessable('The project has no schedule yet: build and approve one (13.01) before measuring progress.');
    const acts = db.prepare("SELECT * FROM plan_activities WHERE schedule_id = ? AND deleted_at IS NULL AND act_type IN ('TASK', 'MILESTONE') ORDER BY sort_order, id").all(sched.id);
    const bl = db.prepare('SELECT id, doc_no, baseline_no, snapshot_json FROM plan_baselines WHERE org_project_id = ? AND company_id = ? AND is_current = 1 AND deleted_at IS NULL').get(projectId, companyId);
    const snap = bl ? json(bl.snapshot_json, null) : null; const bmap = new Map((snap?.activities ?? []).map((a) => [String(a.code).toLowerCase(), a]));
    const wbs = new Map(db.prepare('SELECT id, parent_id, code, name FROM proj_wbs WHERE project_id = ? AND deleted_at IS NULL').all(projectId).map((w) => [w.id, w]));
    // the budget of each WBS node (the approved budget's direct lines) shared by quantity among the activities under it that no nearer node claims
    const bud = db.prepare("SELECT id, doc_no FROM bud_budgets WHERE org_project_id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(projectId, companyId);
    const budByWbs = new Map(bud ? db.prepare("SELECT wbs_id, SUM(amount) AS a FROM bud_lines WHERE budget_id = ? AND line_kind = 'DIRECT' AND wbs_id IS NOT NULL AND deleted_at IS NULL GROUP BY wbs_id").all(bud.id).map((r) => [r.wbs_id, r.a]) : []);
    const claim = (wbsId) => { let w = wbs.get(wbsId); while (w) { if (budByWbs.has(w.id)) return w.id; w = wbs.get(w.parent_id); } return null; };
    const groups = new Map(); for (const a of acts) { const c = a.wbs_id ? claim(a.wbs_id) : null; if (c) { if (!groups.has(c)) groups.set(c, []); groups.get(c).push(a); } }
    const share = new Map(); for (const [w, list] of groups) { const total = list.reduce((n, a) => n + a.qty, 0); let left = budByWbs.get(w); list.forEach((a, i) => { const v = i === list.length - 1 ? left : Math.floor(total > 0 ? (budByWbs.get(w) * a.qty) / total : budByWbs.get(w) / list.length); share.set(a.id, v); left -= v; }); }
    const weights = new Map(db.prepare('SELECT activity_code, weight_amount FROM prs_weights WHERE org_project_id = ? AND deleted_at IS NULL').all(projectId).map((r) => [r.activity_code.toLowerCase(), r.weight_amount]));
    const rows = db.prepare('SELECT activity_code, work_date, qty, source FROM prs_activity_progress WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY activity_code, work_date, id').all(projectId);
    for (const v of virtual) rows.push({ activity_code: v.code, work_date: asOf, qty: v.qty, source: 'MANUAL' });
    rows.sort((a, b) => (lower(a.activity_code) < lower(b.activity_code) ? -1 : lower(a.activity_code) > lower(b.activity_code) ? 1 : a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : 0));
    const series = new Map(); const mb = new Map();
    for (const r of rows) {
      const k = r.activity_code.toLowerCase();
      if (r.source === 'MB') { const m = mb.get(k) ?? { d: [], c: [] }; m.d.push(r.work_date); m.c.push(r.qty); mb.set(k, m); continue; } // a measured row holds the certified cumulative quantity
      const s = series.get(k) ?? { d: [], c: [], total: 0 }; s.total += r.qty; s.d.push(r.work_date); s.c.push(s.total); series.set(k, s);
    }
    const override = Boolean(param(companyId, 'site.progress.mb_override'));
    const items = acts.map((a) => {
      const k = a.code.toLowerCase(); const b = bmap.get(k); const manual = weights.get(k); const bac = manual ?? share.get(a.id) ?? 0;
      return { id: a.id, code: a.code, name: a.name, type: a.act_type, wbsId: a.wbs_id, qty: a.qty, uom: a.uom, bac, basis: manual != null ? 'MANUAL' : share.has(a.id) ? 'BUDGET' : 'NONE', bs: b ? b.start : a.es, bf: b ? b.finish : a.ef, fs: a.es, ef: a.ef, actualStart: a.actual_start, actualFinish: a.actual_finish, pctComplete: a.pct_complete, series: series.get(k) ?? null, mb: override ? (mb.get(k) ?? null) : null };
    });
    return { companyId, projectId, asOf, sched, baseline: bl ? { id: bl.id, docNo: bl.doc_no, baselineNo: bl.baseline_no } : null, baselineMissing: !bl, budget: bud ? { id: bud.id, docNo: bud.doc_no } : null, wbs, items, override };
  }
  const at = (arr, d) => { let lo = 0; let hi = arr.d.length - 1; let best = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (arr.d[m] <= d) { best = m; lo = m + 1; } else hi = m - 1; } return best; };
  /** Physical progress of an activity on a day, 0..1: executed quantity over total; an activity with no quantity takes the percentage of the schedule on and after the data date and 1 from its actual finish. */
  function phys(cx, a, d) {
    if (a.actualFinish && d >= a.actualFinish && a.qty === 0) return 1;
    if (a.qty > 0) { if (!a.series) return a.actualFinish && d >= a.actualFinish ? 1 : 0; const i = at(a.series, d); return i < 0 ? 0 : Math.min(1, Math.max(0, a.series.c[i] / a.qty)); }
    return d >= cx.asOf ? a.pctComplete / 10000 : 0;
  }
  function fin(cx, a, d) { if (a.mb && a.qty > 0) { const i = at(a.mb, d); return i < 0 ? 0 : Math.min(1, Math.max(0, a.mb.c[i] / a.qty)); } return phys(cx, a, d); }
  const planned = (a, d) => (a.type === 'MILESTONE' ? (a.bf && d >= a.bf ? 1 : 0) : plannedFraction(ordOf, a.bs, a.bf, d));
  function forecast(cx, a, d) {
    if (d <= cx.asOf) return phys(cx, a, d); const p0 = phys(cx, a, cx.asOf); if (p0 >= 1) return 1; if (!a.ef || a.ef <= cx.asOf) return 1;
    if (a.type === 'MILESTONE') return d >= a.ef ? 1 : 0; return Math.min(1, p0 + ((1 - p0) * (ordOf(d) - ordOf(cx.asOf))) / (ordOf(a.ef) - ordOf(cx.asOf)));
  }
  /** The totals of a set of activities on a day: weighted progress (planned, physical, financial, forecast) and the money. */
  function totals(cx, list, d, fd = d) {
    const pl = rollup(list.map((a) => ({ weight: a.bac, pct: planned(a, d) }))); const ph = rollup(list.map((a) => ({ weight: a.bac, pct: phys(cx, a, d) }))); const fc = rollup(list.map((a) => ({ weight: a.bac, pct: forecast(cx, a, fd) })));
    const bac = list.reduce((n, a) => n + a.bac, 0); const pv = Math.round(list.reduce((n, a) => n + a.bac * planned(a, d), 0)); const ev = Math.round(list.reduce((n, a) => n + a.bac * fin(cx, a, d), 0));
    const fn = rollup(list.map((a) => ({ weight: a.bac, pct: fin(cx, a, d) })));
    return { bac, pv, ev, planned: pl, physical: ph, financial: fn, forecast: fc };
  }
  /** The evaluation of a project on a day: activities, WBS nodes and the project, with the earned-value figures (AC from the period or the argument). */
  function evaluate(companyId, projectId, asOf, { ac = null, virtual = [] } = {}) {
    const cx = load(companyId, projectId, asOf, virtual); const fd = isoOf(ordOf(asOf) + HORIZON);
    const acts = cx.items.map((a) => { const i = a.series ? at(a.series, asOf) : -1; return { code: a.code, name: a.name, type: a.type, wbsId: a.wbsId, qty: d3(a.qty), uom: a.uom, cumQty: i >= 0 ? d3(a.series.c[i]) : 0, bac: a.bac, basis: a.basis,
      planned: planned(a, asOf), physical: phys(cx, a, asOf), financial: fin(cx, a, asOf), forecast: forecast(cx, a, fd), pv: Math.round(a.bac * planned(a, asOf)), ev: Math.round(a.bac * fin(cx, a, asOf)), plannedStart: a.bs, plannedFinish: a.bf, forecastFinish: a.ef, actualStart: a.actualStart, actualFinish: a.actualFinish }; });
    const t = totals(cx, cx.items, asOf, fd); const m = metrics({ bac: t.bac, pv: t.pv, ev: t.ev, ac });
    // WBS nodes: each node sums the activities under it
    const under = new Map(); for (const a of cx.items) { let w = cx.wbs.get(a.wbsId); while (w) { if (!under.has(w.id)) under.set(w.id, []); under.get(w.id).push(a); w = cx.wbs.get(w.parent_id); } }
    const depth = (w) => { let n = 0; let x = cx.wbs.get(w.parent_id); while (x) { n += 1; x = cx.wbs.get(x.parent_id); } return n; };
    const nodes = [...under.keys()].map((id) => cx.wbs.get(id)).sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true })).map((w) => { const x = totals(cx, under.get(w.id), asOf, fd); const mm = metrics({ bac: x.bac, pv: x.pv, ev: x.ev, ac: null }); return { id: w.id, parentId: cx.wbs.has(w.parent_id) ? w.parent_id : null, code: w.code, name: w.name, level: depth(w), activities: under.get(w.id).length, bac: x.bac, pv: x.pv, ev: x.ev, planned: x.planned, physical: x.physical, financial: x.financial, forecast: x.forecast, sv: mm.sv, spi: mm.spi }; });
    const maxFc = cx.items.reduce((n, a) => (a.ef && a.ef > n ? a.ef : n), ''); const maxBl = cx.items.reduce((n, a) => (a.bf && a.bf > n ? a.bf : n), '');
    const milestones = cx.items.filter((a) => a.type === 'MILESTONE').map((a) => ({ code: a.code, name: a.name, baselineFinish: a.bf, forecastFinish: a.ef, actualFinish: a.actualFinish, slipDays: a.bf && (a.actualFinish ?? a.ef) ? ordOf(a.actualFinish ?? a.ef) - ordOf(a.bf) : null, done: Boolean(a.actualFinish) }));
    return { cx, asOf, dataDate: cx.sched.data_date, schedule: { id: cx.sched.id, docNo: cx.sched.doc_no, versionNo: cx.sched.version_no, status: cx.sched.status }, baseline: cx.baseline, baselineMissing: cx.baselineMissing, budget: cx.budget, mbOverride: cx.override,
      project: { ...m, planned: t.planned, physical: t.physical, financial: t.financial, forecast: t.forecast, baselineFinish: maxBl || null, forecastFinish: maxFc || null }, wbs: nodes, activities: acts, milestones };
  }

  // ---- the shapes the API gives: money only to those who may see it ------------------------------------------------------------------------------------------------------------------------
  const moneyKeys = ['bac', 'pv', 'ev', 'ac', 'sv', 'cv', 'eac'];
  function shapeMetrics(m, cost) { const o = { planned: pc(m.planned), physical: pc(m.physical), financial: pc(m.financial), forecast: m.forecast == null ? null : pc(m.forecast), spi: ratio(m.spi) }; if (cost) { for (const k of moneyKeys) o[k] = rs(m[k]); o.cpi = ratio(m.cpi); o.tcpi = ratio(m.tcpi); } return o; }
  const shapeNode = (n, cost) => ({ id: n.id, parentId: n.parentId, code: n.code, name: n.name, level: n.level, activities: n.activities, ...shapeMetrics(n, cost), varianceBehind: pc(n.planned - n.physical)});
  const shapeActivity = (a, cost) => ({ code: a.code, name: a.name, type: a.type, wbsId: a.wbsId, qty: a.qty, uom: a.uom, cumQty: a.cumQty, planned: pc(a.planned), physical: pc(a.physical), financial: pc(a.financial), forecast: pc(a.forecast), variance: pc(a.physical - a.planned), weightBasis: a.basis, ...(cost ? { bac: rs(a.bac), pv: rs(a.pv), ev: rs(a.ev) } : {}), plannedStart: a.plannedStart, plannedFinish: a.plannedFinish, forecastFinish: a.forecastFinish, actualStart: a.actualStart, actualFinish: a.actualFinish });
  function shape(actor, e, { cost }) {
    const spiLimit = Number(param(actor.companyId, 'site.progress.spi_alert') ?? 90) / 100;
    return { asOf: e.asOf, dataDate: e.dataDate, schedule: e.schedule, baseline: e.baseline, baselineMissing: e.baselineMissing, budget: e.budget, mbOverride: e.mbOverride, canSeeCost: cost, spiLimit,
      project: { ...shapeMetrics(e.project, cost), baselineFinish: e.project.baselineFinish, forecastFinish: e.project.forecastFinish }, wbs: e.wbs.map((n) => ({ ...shapeNode(n, cost), behind: n.spi != null && n.spi / 10000 < spiLimit })), activities: e.activities.map((a) => shapeActivity(a, cost)), milestones: e.milestones };
  }

  // ---- the S-curves (FR-05) ---------------------------------------------------------------------------------------------------------------------------------------------------------------
  function scurve(actor, projectId, asOf) {
    const p = project(actor, projectId); const cost = costOf(actor, p.id); const cx = load(actor.companyId, p.id, asOf);
    const firstRow = db.prepare('SELECT MIN(work_date) AS d FROM prs_activity_progress WHERE org_project_id = ? AND deleted_at IS NULL').get(p.id).d;
    const starts = cx.items.map((a) => a.bs).filter(Boolean); const ends = [...cx.items.map((a) => a.bf), ...cx.items.map((a) => a.ef), asOf].filter(Boolean);
    const from = [...starts, firstRow].filter(Boolean).sort()[0] ?? asOf; const to = ends.sort().at(-1); const span = Math.max(1, ordOf(to) - ordOf(from)); const step = Math.max(7, Math.ceil(span / 150 / 7) * 7);
    const dates = []; for (let o = ordOf(from); o < ordOf(to); o += step) dates.push(isoOf(o)); dates.push(to); if (!dates.includes(asOf) && asOf > from && asOf < to) dates.push(asOf); dates.sort();
    const out = /** @type {any} */ ({ dates, planned: { physical: [], financial: [] }, actual: { physical: [], financial: [] }, forecast: { physical: [], financial: [] } });
    for (const d of dates) {
      const t = totals(cx, cx.items, d); out.planned.physical.push(pc(t.planned)); out.planned.financial.push(rs(Math.round(cx.items.reduce((n, a) => n + a.bac * planned(a, d), 0))));
      if (d <= asOf) { out.actual.physical.push(pc(t.physical)); out.actual.financial.push(rs(t.ev)); } else { out.actual.physical.push(null); out.actual.financial.push(null); }
      if (d >= asOf) { out.forecast.physical.push(pc(t.forecast)); out.forecast.financial.push(rs(Math.round(cx.items.reduce((n, a) => n + a.bac * forecast(cx, a, d), 0)))); } else { out.forecast.physical.push(null); out.forecast.financial.push(null); }
    }
    // PACK-20 (ff.plan.pack20): the three lines of earned value on one curve: planned (PV, above), earned (EV, the actual financial line) and
    // the actual cost (AC) of the closed periods: the AC of the latest approved period ending on or before each date, a step, nothing after the as-of date
    if (cost && isEnabled(db, 'ff.plan.pack20', { companyId: actor.companyId })) {
      const acs = db.prepare("SELECT p.period_end AS d, e.ac FROM prs_periods p JOIN prs_evm e ON e.period_id = p.id AND e.wbs_id IS NULL AND e.deleted_at IS NULL WHERE p.org_project_id = ? AND p.status = 'APPROVED' AND p.deleted_at IS NULL AND e.ac IS NOT NULL ORDER BY p.period_end").all(p.id);
      out.earned = { financial: out.actual.financial }; out.actualCost = { financial: dates.map((d) => { if (d > asOf) return null; const x = acs.filter((a) => a.d <= d).at(-1); return x ? rs(x.ac) : null; }) };
      out.periodsClosed = acs.map((a) => ({ periodEnd: a.d, ac: rs(a.ac) }));
    }
    if (!cost) { delete out.planned.financial; delete out.actual.financial; delete out.forecast.financial; out.planned = { physical: out.planned.physical }; }
    const last = dates.indexOf(asOf); return { projectId: p.id, asOf, canSeeCost: cost, baselineMissing: cx.baselineMissing, ...out, today: last >= 0 ? last : null };
  }

  // ---- the quantities of the approved DPRs (FR-01, BR-01) -------------------------------------------------------------------------------------------------------------------------------
  /** Rebuild the running total of an activity (by code): each row keeps the cumulative quantity and the percentage of the activity's quantity. */
  function recompute(projectId, code) {
    const a = db.prepare("SELECT a.qty FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND s.deleted_at IS NULL AND s.status = 'APPROVED' AND a.code = ? COLLATE NOCASE AND a.deleted_at IS NULL ORDER BY s.version_no DESC LIMIT 1").get(projectId, code);
    let run = 0; for (const r of db.prepare("SELECT id, qty FROM prs_activity_progress WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND deleted_at IS NULL AND source <> 'MB' ORDER BY work_date, id").all(projectId, code)) { run += r.qty; db.prepare('UPDATE prs_activity_progress SET cum_qty = ?, pct_complete = ? WHERE id = ?').run(run, a?.qty > 0 ? bp(run / a.qty) : 0, r.id); }
  }
  /** `site.dpr.approved`: the quantities of an approved report replace those of the report it amends and of itself (a replay changes nothing); a site report is the authority of its day over the supervisors' reports. */
  function onDpr(e) {
    const d = e.data ?? {}; const companyId = Number(e.companyId ?? e.company_id); const projectId = Number(d.projectId); if (!companyId || !projectId || !d.dprId || !d.date) return null;
    const touched = new Set(); const now = nowIso();
    transaction(db, () => {
      const kill = (where, ...params) => { for (const r of db.prepare(`SELECT id, activity_code FROM prs_activity_progress WHERE org_project_id = ? AND deleted_at IS NULL AND ${where}`).all(projectId, ...params)) { db.prepare('UPDATE prs_activity_progress SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, 'system', r.id); touched.add(r.activity_code); } };
      if (d.supersedes) kill('dpr_id = ?', Number(d.supersedes)); kill('dpr_id = ?', Number(d.dprId));
      if (d.scope === 'SITE') kill("dpr_scope = 'SUPERVISOR' AND prog_site_id = ? AND work_date = ?", Number(d.siteId), d.date);
      const siteDone = d.scope === 'SUPERVISOR' && db.prepare("SELECT 1 FROM prs_activity_progress WHERE org_project_id = ? AND dpr_scope = 'SITE' AND prog_site_id = ? AND work_date = ? AND deleted_at IS NULL").get(projectId, Number(d.siteId), d.date);
      if (!siteDone) for (const w of d.work ?? []) {
        const a = db.prepare('SELECT id, code FROM plan_activities WHERE id = ? AND company_id = ?').get(Number(w.activityId), companyId); if (!a || !(Number(w.qty) > 0)) continue;
        db.prepare("INSERT INTO prs_activity_progress (company_id, org_project_id, activity_id, activity_code, work_date, qty, source, dpr_id, dpr_scope, prog_site_id, project_id, site_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'DPR', ?, ?, ?, ?, ?, 'system', 'site_dpr', ?)")
          .run(companyId, projectId, a.id, a.code, d.date, q3(w.qty), Number(d.dprId), d.scope ?? 'SITE', Number(d.siteId), projectId, Number(d.siteId), String(d.dprId)); touched.add(a.code);
      }
      for (const code of touched) recompute(projectId, code);
      if (touched.size) publishEvent(db, { type: 'site.progress.updated', entity: 'site_progress', entityId: Number(d.dprId), actorId: 'system', companyId, projectId, data: { projectId, date: d.date, dprId: Number(d.dprId), activities: [...touched] } });
    });
    if (touched.size) pushToPlan(companyId, projectId, [...touched]);
    return { touched: touched.size };
  }
  /** The schedule keeps its percent complete and actual dates from the executed quantities, through its own service (13.01). */
  function pushToPlan(companyId, projectId, codes) {
    const plan = planOf(); if (!plan) return;
    try {
      const sched = db.prepare("SELECT id FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(projectId, companyId); if (!sched) return;
      const lines = []; let last = '';
      for (const code of codes) {
        const a = db.prepare("SELECT id, qty, actual_start, act_type FROM plan_activities WHERE schedule_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL").get(sched.id, code); if (!a || !(a.qty > 0) || a.act_type !== 'TASK') continue;
        const r = db.prepare("SELECT MIN(work_date) AS f, MAX(work_date) AS l, MAX(cum_qty) AS c FROM prs_activity_progress WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND deleted_at IS NULL AND source <> 'MB'").get(projectId, code); if (!r.f) continue;
        const pct = Math.min(100, Math.round((r.c * 10000) / a.qty) / 100); last = r.l > last ? r.l : last;
        lines.push({ activityId: a.id, pctComplete: pct, actualStart: a.actual_start ?? r.f, ...(pct >= 100 ? { actualFinish: r.l } : {}) });
      }
      if (lines.length) plan.onDpr({ companyId, data: { projectId, date: last, lines } });
    } catch (x) { audit({ user: 'system' }, 'prs_activity_progress', String(projectId), 'plan_push_failed', companyId, { reason: String(x?.message ?? x).slice(0, 300) }); }
  }
  /** The adapter for the measurement book (22.01): a certified cumulative quantity of an activity on a day. It counts in the financial progress only while `site.progress.mb_override` is on. */
  function recordMeasured(actor, { projectId, activityCode, date, cumQty, ref }) {
    const a = db.prepare("SELECT a.id, a.code FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND s.company_id = ? AND a.code = ? COLLATE NOCASE AND a.deleted_at IS NULL ORDER BY s.version_no DESC LIMIT 1").get(projectId, actor.companyId, activityCode); if (!a) throw notFound('That activity does not exist.');
    return transaction(db, () => { const id = Number(db.prepare("INSERT INTO prs_activity_progress (company_id, org_project_id, activity_id, activity_code, work_date, qty, cum_qty, source, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, 'MB', ?, ?, 'measurement', ?)").run(actor.companyId, projectId, a.id, a.code, date, q3(cumQty), q3(cumQty), projectId, actor.user, ref ?? null).lastInsertRowid); audit(actor, 'prs_activity_progress', id, 'measured', actor.companyId, { newValues: { code: a.code, date, cumQty } }); return { id }; });
  }

  // ---- weights (FR-01) -----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const weights = {
    get(actor, projectId) { const p = project(actor, projectId); const cost = costOf(actor, p.id); return db.prepare('SELECT activity_code, weight_amount FROM prs_weights WHERE org_project_id = ? AND deleted_at IS NULL ORDER BY activity_code').all(p.id).map((r) => ({ activityCode: r.activity_code, amount: cost ? rs(r.weight_amount) : null })); },
    set(actor, b) {
      const p = project(actor, b.projectId, 'site.period.edit'); const cx = load(actor.companyId, p.id, todayIST()); const codes = new Map(cx.items.map((a) => [a.code.toLowerCase(), a.code])); const probs = [];
      b.weights.forEach((w, i) => { if (!codes.has(w.activityCode.toLowerCase())) probs.push({ field: `weights.${i}.activityCode`, message: 'Not an activity of the current schedule' }); }); fail(probs);
      return transaction(db, () => { const now = nowIso(); for (const w of b.weights) { const code = codes.get(w.activityCode.toLowerCase()); db.prepare('UPDATE prs_weights SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE org_project_id = ? AND activity_code = ? COLLATE NOCASE AND deleted_at IS NULL').run(now, actor.user, p.id, code); if (w.amount != null) db.prepare("INSERT INTO prs_weights (company_id, org_project_id, activity_code, weight_amount, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, p.id, code, Math.round(w.amount * 100), p.id, actor.user); } audit(actor, 'prs_weights', String(p.id), 'set', actor.companyId, { newValues: { count: b.weights.length } }); return weights.get(actor, p.id); });
    },
  };

  // ---- dashboards and reports (FR-05, FR-06) -----------------------------------------------------------------------------------------------------------------------------------------
  const projects = (actor) => db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'site.period.view', p.id)).map((p) => ({ id: p.id, code: p.code, name: p.name, canCreate: may(actor, 'site.period.create', p.id) }));
  function dashboard(actor, { projectId, asOf }) {
    const p = project(actor, projectId); const cost = costOf(actor, p.id); const date = asOf ?? todayIST(); if (date > todayIST()) fail([{ field: 'asOf', message: 'Use today or an earlier day' }]);
    const last = db.prepare("SELECT * FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1").get(p.id); const lastEvm = last ? db.prepare('SELECT * FROM prs_evm WHERE period_id = ? AND wbs_id IS NULL AND deleted_at IS NULL').get(last.id) : null;
    const ac = lastEvm?.ac ?? null; const e = evaluate(actor.companyId, p.id, date, { ac }); const s = shape(actor, e, { cost });
    const exceptions = [...s.wbs.filter((n) => n.behind && n.level <= 1).map((n) => ({ kind: 'WBS_BEHIND', code: n.code, name: n.name, spi: n.spi, varianceBehind: n.varianceBehind })), ...s.milestones.filter((m) => !m.done && m.slipDays > 0).map((m) => ({ kind: 'MILESTONE_LATE', code: m.code, name: m.name, slipDays: m.slipDays }))];
    if (s.project.spi != null && s.project.spi < s.spiLimit) exceptions.unshift({ kind: 'PROJECT_BEHIND', code: p.code, name: p.name, spi: s.project.spi });
    const open = db.prepare("SELECT id, doc_no, period_end, status FROM prs_periods WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL ORDER BY id DESC").all(p.id);
    const myTasks = open.filter((x) => x.status === 'SUBMITTED' && may(actor, 'site.period.approve', p.id)).map((x) => ({ id: x.id, docNo: x.doc_no, action: 'APPROVE' })).concat(open.filter((x) => x.status !== 'SUBMITTED' && may(actor, 'site.period.edit', p.id)).map((x) => ({ id: x.id, docNo: x.doc_no, action: 'FINISH' })));
    return { ...s, project: { ...s.project, id: p.id, code: p.code, name: p.name }, lastClosed: last ? { id: last.id, docNo: last.doc_no, periodEnd: last.period_end, physical: pc(last.physical_pct / 10000), planned: pc(last.planned_pct / 10000), spi: lastEvm ? ratio(lastEvm.spi) : null, cpi: cost && lastEvm ? ratio(lastEvm.cpi) : null } : null,
      curve: scurve(actor, p.id, date), exceptions, pending: myTasks, openPeriods: open.map((x) => ({ id: x.id, docNo: x.doc_no, periodEnd: x.period_end, status: x.status })) };
  }
  function report(actor, { projectId, asOf, wbsId }) {
    const p = project(actor, projectId); const cost = costOf(actor, p.id); const date = asOf ?? todayIST(); if (date > todayIST()) fail([{ field: 'asOf', message: 'Use today or an earlier day' }]);
    const last = db.prepare("SELECT * FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL AND period_end <= ? ORDER BY period_end DESC LIMIT 1").get(p.id, date); const lastEvm = last ? db.prepare('SELECT ac FROM prs_evm WHERE period_id = ? AND wbs_id IS NULL AND deleted_at IS NULL').get(last.id) : null;
    const e = evaluate(actor.companyId, p.id, date, { ac: lastEvm?.ac ?? null }); const s = shape(actor, e, { cost });
    const wbsSet = wbsId ? new Set([wbsId, ...s.wbs.filter((n) => { let x = n; const byId = new Map(s.wbs.map((y) => [y.id, y])); while (x) { if (x.id === wbsId) return true; x = byId.get(x.parentId); } return false; }).map((n) => n.id)]) : null;
    return { ...s, project: { ...s.project, id: p.id, code: p.code, name: p.name }, activities: wbsSet ? s.activities.filter((a) => wbsSet.has(a.wbsId)) : s.activities, wbs: wbsSet ? s.wbs.filter((n) => wbsSet.has(n.id)) : s.wbs, wbsId: wbsId ?? null };
  }
  function reportExport(actor, q) {
    const r = report(actor, q); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? ''; audit(actor, 'prs_activity_progress', String(q.projectId), 'export', actor.companyId, { newValues: { format: q.format, asOf: r.asOf } });
    const cost = r.canSeeCost; const columns = [['kind', 'Level'], ['code', 'Code'], ['name', 'Name'], ['qty', 'Quantity'], ['cumQty', 'Done'], ['planned', 'Planned %'], ['physical', 'Actual %'], ['forecast', 'Forecast %'], ['variance', 'Variance %'], ...(cost ? [['bac', 'Budget'], ['pv', 'PV'], ['ev', 'EV']] : []), ['finish', 'Forecast finish']].map(([key, label]) => ({ key, label, type: 'text' }));
    const rows = [...r.wbs.map((n) => ({ kind: 'WBS', code: n.code, name: n.name, qty: '', cumQty: '', planned: n.planned, physical: n.physical, forecast: n.forecast, variance: pc((n.physical - n.planned) / 100), bac: n.bac ?? '', pv: n.pv ?? '', ev: n.ev ?? '', finish: '' })), ...r.activities.map((a) => ({ kind: 'Activity', code: a.code, name: a.name, qty: a.qty ?? '', cumQty: a.cumQty ?? '', planned: a.planned, physical: a.physical, forecast: a.forecast, variance: a.variance, bac: a.bac ?? '', pv: a.pv ?? '', ev: a.ev ?? '', finish: a.forecastFinish ?? '' }))].map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === null ? '' : String(v)])));
    const footer = [`${co}: progress of ${r.project.code} as at ${r.asOf}`, `Planned ${r.project.planned} % · actual ${r.project.physical} % · forecast ${r.project.forecast} %${r.project.spi != null ? ` · SPI ${r.project.spi}` : ''}`];
    const name = `progress-${r.project.code}-${r.asOf}`.replace(/\W+/g, '-');
    if (q.format === 'csv') return { buffer: Buffer.from(toCsv({ columns, rows, footer })), contentType: 'text/csv; charset=utf-8', fileName: `${name}.csv`, rows: rows.length };
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Progress' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }
  /** The client's progress report: percentages, the WBS table, the milestones and the S-curve in physical terms; no cost. From a closed period it is that period's snapshot, so it never changes. */
  function clientReport(actor, { projectId, periodId, asOf }) {
    const p = project(actor, projectId); let src = null; let period;
    if (periodId) { period = db.prepare("SELECT * FROM prs_periods WHERE id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(rid(periodId), p.id); if (!period) throw notFound('That closed period does not exist.'); src = json(period.snapshot_json, null); }
    else { period = db.prepare("SELECT * FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1").get(p.id); if (period && !asOf) src = json(period.snapshot_json, null); }
    const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(actor.companyId)?.legal_name ?? '';
    if (src) return { company: co, project: { id: p.id, code: p.code, name: p.name }, period: { id: period.id, docNo: period.doc_no, type: period.period_type, start: period.period_start, end: period.period_end }, live: false, asOf: src.asOf, summary: src.summary, wbs: src.wbs, milestones: src.milestones, curve: src.curve };
    const e = evaluate(actor.companyId, p.id, asOf ?? todayIST()); const s = shape(actor, e, { cost: false }); const cv = scurve(actor, p.id, e.asOf);
    return { company: co, project: { id: p.id, code: p.code, name: p.name }, period: null, live: true, asOf: e.asOf, summary: { planned: s.project.planned, physical: s.project.physical, forecast: s.project.forecast, baselineFinish: s.project.baselineFinish, forecastFinish: s.project.forecastFinish }, wbs: s.wbs.filter((n) => n.level <= 1).map(clientNode), milestones: s.milestones, curve: { dates: cv.dates, planned: cv.planned.physical, actual: cv.actual.physical, forecast: cv.forecast.physical } };
  }
  const clientNode = (n) => ({ code: n.code, name: n.name, level: n.level, planned: n.planned, physical: n.physical, forecast: n.forecast, variance: pc((n.physical - n.planned) / 100) });
  function clientExport(actor, q) {
    const r = clientReport(actor, q); audit(actor, 'prs_periods', String(r.period?.id ?? q.projectId), 'client_report', actor.companyId, { newValues: { format: q.format } });
    const columns = [['code', 'WBS'], ['name', 'Description'], ['planned', 'Planned %'], ['physical', 'Actual %'], ['forecast', 'Forecast %'], ['variance', 'Variance %']].map(([key, label]) => ({ key, label, type: 'text' }));
    const rows = r.wbs.map((n) => Object.fromEntries(Object.entries({ code: n.code, name: n.name, planned: n.planned, physical: n.physical, forecast: n.forecast, variance: n.variance }).map(([k, v]) => [k, String(v ?? '')])));
    const footer = [`${r.company}: progress report ${r.project.code} ${r.project.name}${r.period ? ` · ${r.period.docNo} (${r.period.start} to ${r.period.end})` : ` · as at ${r.asOf}`}`, `Overall: planned ${r.summary.planned} % · actual ${r.summary.physical} % · forecast ${r.summary.forecast ?? '—'} %`, ...r.milestones.slice(0, 8).map((m) => `Milestone ${m.code} ${m.name}: baseline ${m.baselineFinish ?? '—'}, forecast ${m.forecastFinish ?? '—'}${m.actualFinish ? `, achieved ${m.actualFinish}` : ''}`)];
    const name = `client-progress-${r.project.code}-${r.asOf}`.replace(/\W+/g, '-');
    if (q.format === 'pdf') return { buffer: toPdf({ columns, rows, footer, title: footer[0] }), contentType: 'application/pdf', fileName: `${name}.pdf`, rows: rows.length };
    return { buffer: toXlsx({ columns, rows, footer, sheetName: 'Progress' }), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', fileName: `${name}.xlsx`, rows: rows.length };
  }

  // ---- periods (FR-02, BR-02) ----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const fresh = (id) => db.prepare('SELECT * FROM prs_periods WHERE id = ?').get(id);
  const editable = (r) => ['DRAFT', 'RETURNED'].includes(r.status);
  const mustEdit = (r) => { if (!editable(r)) throw conflict(r.status === 'APPROVED' ? `${r.doc_no} is closed: it is immutable; a correction is an amendment of the latest closed period.` : `${r.doc_no} is ${lower(PRD_STATUS[r.status])}: it is not changed now.`); };
  function row(actor, id, key = 'site.period.view') {
    const r = db.prepare('SELECT * FROM prs_periods WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId);
    if (!r || !may(actor, 'site.period.view', r.org_project_id)) throw notFound('That progress period does not exist.'); if (key !== 'site.period.view') need(actor, key, 'do that with a progress period', r.org_project_id); return r;
  }
  function startOf(companyId, projectId) {
    const last = db.prepare("SELECT period_end FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1").get(projectId); if (last) return isoOf(ordOf(last.period_end) + 1);
    const sched = db.prepare("SELECT start_date FROM plan_schedules WHERE org_project_id = ? AND company_id = ? AND deleted_at IS NULL AND status IN ('APPROVED', 'DRAFT', 'SUBMITTED', 'RETURNED') ORDER BY (status = 'APPROVED') DESC, version_no DESC LIMIT 1").get(projectId, companyId);
    if (!sched) throw unprocessable('The project has no schedule yet: build and approve one (13.01) before closing progress periods.'); return sched.start_date;
  }
  /** What a period needs: its dates in order after the last closed one, the type's length, and its adjustments (a quantity added or taken off an activity with a quantity, never below nothing or above its total). */
  function check(companyId, r, v) {
    const p = []; const start = r.parent_period_id ? r.period_start : startOf(companyId, r.org_project_id);
    if (v.periodEnd < start) p.push({ field: 'periodEnd', message: `The period ends on or after ${start}` }); if (v.periodEnd > todayIST()) p.push({ field: 'periodEnd', message: 'A period ends today or on an earlier day' });
    const len = ordOf(v.periodEnd) - ordOf(start) + 1; if (v.periodType === 'WEEK' && len > 8) p.push({ field: 'periodEnd', message: `A weekly period is at most 7 days; this one is ${len}` }); if (v.periodType === 'MONTH' && len > 32) p.push({ field: 'periodEnd', message: `A monthly period is at most 31 days; this one is ${len}` });
    const adj = v.adjustments ?? []; const cx = p.length ? null : load(companyId, r.org_project_id, v.periodEnd); const seen = new Set();
    adj.forEach((a, i) => {
      const k = a.activityCode.toLowerCase(); if (seen.has(k)) p.push({ field: `adjustments.${i}.activityCode`, message: 'One adjustment for each activity' }); seen.add(k); if (!cx) return;
      const it = cx.items.find((x) => x.code.toLowerCase() === k); if (!it) { p.push({ field: `adjustments.${i}.activityCode`, message: 'Not an activity of the current schedule' }); return; }
      if (!(it.qty > 0)) { p.push({ field: `adjustments.${i}.activityCode`, message: `${it.code} has no quantity: its progress is set in the schedule` }); return; }
      const cum = it.series ? (it.series.c[at(it.series, v.periodEnd)] ?? 0) : 0; const after = cum + q3(a.qty);
      if (after < 0) p.push({ field: `adjustments.${i}.qty`, message: `${it.code}: only ${d3(cum)} is recorded, so ${d3(-q3(a.qty))} cannot be taken off` }); if (after > it.qty) p.push({ field: `adjustments.${i}.qty`, message: `${it.code}: the total would be ${d3(after)} of ${d3(it.qty)}` });
    });
    fail(p); return { start };
  }
  const virtualOf = (adj) => (adj ?? []).map((a) => ({ code: a.activityCode, qty: q3(a.qty) }));
  /** The snapshot of a period: the picture as at its end with the adjustments counted, kept as it was. */
  function snapshotOf(companyId, r, adj, ac) {
    const e = evaluate(companyId, r.org_project_id, r.period_end, { ac, virtual: virtualOf(adj) }); const cx = e.cx; const cv = (() => {
      const dates = []; const from = [...cx.items.map((a) => a.bs).filter(Boolean)].sort()[0] ?? r.period_start; const to = [...cx.items.map((a) => a.bf), ...cx.items.map((a) => a.ef), r.period_end].filter(Boolean).sort().at(-1); const step = Math.max(7, Math.ceil((ordOf(to) - ordOf(from)) / 150 / 7) * 7);
      for (let o = ordOf(from); o < ordOf(to); o += step) dates.push(isoOf(o)); dates.push(to); if (!dates.includes(r.period_end) && r.period_end > from && r.period_end < to) dates.push(r.period_end); dates.sort();
      const t = dates.map((d) => totals(cx, cx.items, d)); return { dates, planned: t.map((x) => pc(x.planned)), actual: dates.map((d, i) => (d <= r.period_end ? pc(t[i].physical) : null)), forecast: dates.map((d, i) => (d >= r.period_end ? pc(t[i].forecast) : null)) };
    })();
    const snap = /** @type {any} */ ({ v: 1, takenAt: nowIso(), asOf: r.period_end, period: { start: r.period_start, end: r.period_end, type: r.period_type }, schedule: e.schedule, baseline: e.baseline, budget: e.budget, project: e.project, wbs: e.wbs.map((n) => ({ ...n })), activities: e.activities, milestones: e.milestones, adjustments: adj ?? [], actualCost: ac,
      summary: { planned: pc(e.project.planned), physical: pc(e.project.physical), financial: pc(e.project.financial), forecast: pc(e.project.forecast), baselineFinish: e.project.baselineFinish, forecastFinish: e.project.forecastFinish }, curve: cv });
    snap.wbs = e.wbs.filter((n) => n.level <= 1).map((n) => clientNode({ ...n, planned: pc(n.planned), physical: pc(n.physical), forecast: pc(n.forecast) })); snap.wbsFull = e.wbs;
    snap.milestones = e.milestones; return snap;
  }
  function view(actor, r, { detail = false } = {}) {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user); const cost = costOf(actor, r.org_project_id);
    const latest = db.prepare("SELECT id FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1").get(r.org_project_id); const openOne = db.prepare("SELECT 1 FROM prs_periods WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.org_project_id);
    const v = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, periodType: r.period_type, periodTypeLabel: PERIOD_TYPES[r.period_type], periodStart: r.period_start, periodEnd: r.period_end, actualCost: cost ? rs(r.actual_cost) : null, costMasked: !cost && r.actual_cost != null,
      adjustments: json(r.adjustments_json, []).map((a) => ({ activityCode: a.activityCode, qty: a.qty, reason: a.reason })), physical: r.physical_pct == null ? null : pc(r.physical_pct / 10000), planned: r.planned_pct == null ? null : pc(r.planned_pct / 10000), financial: r.financial_pct == null ? null : pc(r.financial_pct / 10000),
      status: r.status, statusLabel: PRD_STATUS[r.status], revisionNo: r.revision_no, parentPeriodId: r.parent_period_id, reason: r.reason, requestedBy: r.requested_by, closedBy: r.closed_by, closedAt: r.closed_at, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      can: { edit: can('site.period.edit') && editable(r), submit: can('site.period.submit') && editable(r), withdraw: r.status === 'SUBMITTED' && own, cancel: can('site.period.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status), delete: can('site.period.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('site.period.amend') && r.status === 'APPROVED' && latest?.id === r.id && !openOne, approve: can('site.period.approve') && r.status === 'SUBMITTED' && !own, print: can('site.period.print'), export: can('site.period.export') } };
    if (detail) {
      const snap = json(r.snapshot_json, null); v.preview = r.status !== 'APPROVED'; v.snapshot = snap ? { takenAt: snap.takenAt, summary: snap.summary, baseline: snap.baseline, schedule: snap.schedule, milestones: snap.milestones, wbs: (snap.wbsFull ?? []).map((n) => ({ code: n.code, name: n.name, level: n.level, planned: pc(n.planned), physical: pc(n.physical), forecast: pc(n.forecast), spi: ratio(n.spi), ...(cost ? { bac: rs(n.bac), pv: rs(n.pv), ev: rs(n.ev) } : {}) })), project: shapeMetrics(snap.project, cost) } : null;
      v.hash = r.snapshot_hash; const pr = r.parent_period_id ? fresh(r.parent_period_id) : null; v.previous = pr ? { id: pr.id, docNo: pr.doc_no, revisionNo: pr.revision_no } : null; v.revisions = db.prepare('SELECT id, doc_no, revision_no, status FROM prs_periods WHERE (parent_period_id = ? OR id = ?) AND id <> ? AND deleted_at IS NULL ORDER BY revision_no').all(r.id, r.parent_period_id ?? 0, r.id).map((x) => ({ id: x.id, docNo: x.doc_no, revisionNo: x.revision_no, status: x.status }));
    }
    return v;
  }
  const scopeOf = (actor) => { const f = authz.scopeFilter(actor, 'site.period.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const SELECT = 'x.id, x.doc_no, x.org_project_id, x.period_type, x.period_start, x.period_end, x.physical_pct, x.planned_pct, x.revision_no, x.status, p.code AS pcode';
  const listRow = (x) => ({ id: x.id, docNo: x.doc_no, project: x.pcode, projectId: x.org_project_id, periodType: x.period_type, periodTypeLabel: PERIOD_TYPES[x.period_type], periodStart: x.period_start, periodEnd: x.period_end, physical: x.physical_pct == null ? null : pc(x.physical_pct / 10000), planned: x.planned_pct == null ? null : pc(x.planned_pct / 10000), revisionNo: x.revision_no, status: x.status, statusLabel: PRD_STATUS[x.status] });
  const periods = {
    list(actor, query) { if (!authz.check(actor, 'site.period.view').allowed) throw forbidden('You may not see progress periods (permission site.period.view).'); const sc = scopeOf(actor); return runList(db, periodList, parseListRequest(periodList, query), { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: listRow }); },
    exportSource(actor, req) {
      if (!authz.check(actor, 'site.period.export').allowed) throw forbidden('You may not export progress periods (permission site.period.export).'); const sc = scopeOf(actor); const opts = { select: SELECT, scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id' };
      return { title: periodList.label, permission: 'site.period.export', personal: false, columns: ['docNo', 'project', 'periodType', 'periodStart', 'periodEnd', 'planned', 'physical', 'revisionNo', 'status'].map((k) => ({ key: k, label: periodList.columns[k]?.label ?? k, type: 'text' })), rows: () => runList(db, periodList, req, { ...opts, limit: null, map: (x) => { const v = listRow(x); return { ...v, periodType: v.periodTypeLabel, planned: String(v.planned ?? ''), physical: String(v.physical ?? ''), revisionNo: String(v.revisionNo), status: v.statusLabel }; } }).data, describe: (r) => [r.q ? `Search: ${r.q}` : 'All progress periods you may see'], count: () => countList(db, periodList, req, opts) };
    },
    projects,
    /** What the form starts from: the next period's first day and the activities with a quantity (for adjustments). */
    options(actor, projectId) { const p = project(actor, projectId); const cx = load(actor.companyId, p.id, todayIST()); return { projectId: p.id, nextStart: startOf(actor.companyId, p.id), today: todayIST(), canSeeCost: costOf(actor, p.id), activities: cx.items.filter((a) => a.qty > 0).map((a) => ({ code: a.code, name: a.name, qty: d3(a.qty), uom: a.uom })) }; },
    get(actor, id) {
      const v = view(actor, row(actor, id), { detail: true });
      if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null;
      return v;
    },
    create(actor, b) {
      const p = project(actor, b.projectId, 'site.period.create'); if (db.prepare("SELECT doc_no FROM prs_periods WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(p.id)) throw conflict('A progress period of this project is already open: finish or cancel it first.');
      const start = startOf(actor.companyId, p.id); const stub = { org_project_id: p.id, period_start: start, parent_period_id: null }; check(actor.companyId, stub, b);
      return transaction(db, () => { const id = Number(db.prepare("INSERT INTO prs_periods (company_id, doc_no, org_project_id, period_type, period_start, period_end, actual_cost, adjustments_json, status, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'api')").run(actor.companyId, number(actor.companyId, actor.user), p.id, b.periodType, start, b.periodEnd, b.actualCost == null ? null : Math.round(b.actualCost * 100), JSON.stringify(b.adjustments ?? []), actor.user, p.id, actor.user).lastInsertRowid); audit(actor, 'prs_periods', id, 'create', actor.companyId, { newValues: { type: b.periodType, end: b.periodEnd } }); return periods.get(actor, id); });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'site.period.edit'); mustEdit(r); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this period; reload it.');
      const v = { periodType: b.periodType ?? r.period_type, periodEnd: b.periodEnd ?? r.period_end, adjustments: 'adjustments' in b ? b.adjustments : json(r.adjustments_json, []) }; check(r.company_id, r, v);
      return transaction(db, () => { db.prepare('UPDATE prs_periods SET period_type = ?, period_end = ?, actual_cost = ?, adjustments_json = ?, snapshot_json = NULL, snapshot_hash = NULL, physical_pct = NULL, planned_pct = NULL, financial_pct = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(v.periodType, v.periodEnd, 'actualCost' in b ? (b.actualCost == null ? null : Math.round(b.actualCost * 100)) : r.actual_cost, JSON.stringify(v.adjustments), actor.user, nowIso(), r.id); const ch = { ...b }; delete ch.rowVersion; if (ch.adjustments) ch.adjustments = `${ch.adjustments.length} adjustments`; delete ch.actualCost; audit(actor, 'prs_periods', r.id, 'update', r.company_id, { newValues: ch }); return periods.get(actor, r.id); });
    },
    remove(actor, id) { const r = row(actor, id, 'site.period.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); transaction(db, () => { db.prepare('UPDATE prs_periods SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(nowIso(), actor.user, r.id); audit(actor, 'prs_periods', r.id, 'delete', r.company_id); }); return { id: r.id, deleted: true }; },
    /** Sending a period works it out again on the server: the snapshot shown to the approver is the one that will be kept (the approval takes it again with what the day's DPRs have become). */
    submit(actor, id) {
      const r = row(actor, id, 'site.period.submit'); if (!editable(r)) throw unprocessable('Only a draft or a returned period is sent for approval.'); const adj = json(r.adjustments_json, []); check(r.company_id, r, { periodType: r.period_type, periodEnd: r.period_end, adjustments: adj });
      return transaction(db, () => {
        const snap = snapshotOf(r.company_id, r, adj, r.actual_cost); const text = JSON.stringify(snap); db.prepare('UPDATE prs_periods SET snapshot_json = ?, snapshot_hash = ?, physical_pct = ?, planned_pct = ?, financial_pct = ? WHERE id = ?').run(text, createHash('sha256').update(JSON.stringify({ ...snap, takenAt: null })).digest('hex'), bp(snap.project.physical), bp(snap.project.planned), bp(snap.project.financial), r.id);
        const ctx = { projectId: r.org_project_id, amendment: r.parent_period_id ? 'yes' : 'no' };
        if (r.status === 'RETURNED') workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: PRD_DOC, docId: String(r.id), comment: `${r.doc_no}: ${r.period_start} to ${r.period_end}`.slice(0, 300), context: ctx }); db.prepare('UPDATE prs_periods SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE prs_periods SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'prs_periods', r.id, 'submit', r.company_id); return periods.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a period waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return periods.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'site.period.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED'].includes(r.status)) throw unprocessable('Only a period that is not closed is cancelled; a closed one is changed by an amendment.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE prs_periods SET status = 'CANCELLED', reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'prs_periods', r.id, 'cancel', r.company_id, { reason }); return periods.get(actor, r.id); });
    },
    /** BR-02: a closed period is immutable. The latest one can be amended: a copy with the same dates that, once approved, replaces it, its adjustments and its figures. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'site.period.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only a closed period is amended.');
      const latest = db.prepare("SELECT id FROM prs_periods WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period_end DESC LIMIT 1").get(r.org_project_id); if (latest.id !== r.id) throw conflict('Only the latest closed period of the project is amended: a later period rests on this one.');
      if (db.prepare("SELECT 1 FROM prs_periods WHERE org_project_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.org_project_id)) throw conflict('A progress period of this project is open: finish it first.');
      return transaction(db, () => { const nid = Number(db.prepare("INSERT INTO prs_periods (company_id, doc_no, org_project_id, period_type, period_start, period_end, actual_cost, adjustments_json, status, revision_no, parent_period_id, reason, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 'prs_period', ?)").run(r.company_id, number(r.company_id, actor.user), r.org_project_id, r.period_type, r.period_start, r.period_end, r.actual_cost, r.adjustments_json, r.revision_no + 1, r.id, reason, actor.user, r.org_project_id, actor.user, String(r.id)).lastInsertRowid); audit(actor, 'prs_periods', nid, 'amend', r.company_id, { reason, newValues: { from: r.doc_no } }); return periods.get(actor, nid); });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'prs_periods' AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'site.period.print'); const v = view(actor, r, { detail: true }); const co = db.prepare('SELECT legal_name FROM org_companies WHERE id = ?').get(r.company_id)?.legal_name ?? ''; audit(actor, 'prs_periods', r.id, 'print', r.company_id); const s = v.snapshot;
      const tr = (c, h = false) => `<tr>${c.map((x) => `<${h ? 'th' : 'td'}>${esc(x ?? '')}</${h ? 'th' : 'td'}>`).join('')}</tr>`;
      return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(v.docNo)}</title></head><body>${v.status === 'APPROVED' ? '' : `<p><strong>${esc(v.statusLabel.toUpperCase())}: NOT A CLOSED PERIOD</strong></p>`}<h1>${esc(co)}</h1><h2>Progress period ${esc(v.docNo)}${v.revisionNo > 1 ? ` · amendment ${v.revisionNo - 1}` : ''}</h2><p>${esc(v.projectCode)} ${esc(v.projectName)} · ${esc(v.periodTypeLabel)} · ${esc(v.periodStart)} to ${esc(v.periodEnd)}</p>`
        + (s ? `<p>Planned ${s.summary.planned} % · actual ${s.summary.physical} % · forecast ${s.summary.forecast} % · SPI ${s.project.spi ?? '—'}${s.project.cpi != null ? ` · CPI ${s.project.cpi}` : ''}</p><table border="1" cellpadding="3">${tr(['WBS', 'Name', 'Planned %', 'Actual %', 'Forecast %', 'SPI'], true)}${s.wbs.map((n) => tr([n.code, n.name, n.planned, n.physical, n.forecast, n.spi ?? ''])).join('')}</table>` : '<p>No snapshot yet.</p>')
        + `<h3>Adjustments</h3>${v.adjustments.length ? `<table border="1" cellpadding="3">${tr(['Activity', 'Quantity', 'Reason'], true)}${v.adjustments.map((a) => tr([a.activityCode, a.qty, a.reason])).join('')}</table>` : '<p>None.</p>'}<p>${v.closedAt ? `Closed by ${esc(v.closedBy)} on ${esc(v.closedAt.slice(0, 10))}` : `Prepared by ${esc(v.requestedBy ?? '')}`}</p></body></html>`;
    },
    /** The approval engine's decision: closing writes the adjustments, takes the snapshot and the earned-value figures, and publishes the close (the hook runs in the same transaction). */
    decide(instance, actor, outcome, comment) {
      const r = fresh(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        const adj = json(r.adjustments_json, []);
        if (r.parent_period_id) { // the amendment replaces its parent: the adjustments and the figures of the parent are taken away
          db.prepare("UPDATE prs_activity_progress SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE period_id = ? AND deleted_at IS NULL").run(now, actor.user, r.parent_period_id); db.prepare('UPDATE prs_evm SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE period_id = ? AND deleted_at IS NULL').run(now, actor.user, r.parent_period_id);
          db.prepare("UPDATE prs_periods SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.parent_period_id);
        }
        const codes = new Set(); for (const a of adj) { const it = db.prepare("SELECT a.id, a.code FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.org_project_id = ? AND a.code = ? COLLATE NOCASE AND a.deleted_at IS NULL ORDER BY (s.status = 'APPROVED') DESC, s.version_no DESC LIMIT 1").get(r.org_project_id, a.activityCode); if (!it) continue; db.prepare("INSERT INTO prs_activity_progress (company_id, org_project_id, activity_id, activity_code, work_date, qty, source, period_id, reason, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, 'prs_period', ?)").run(r.company_id, r.org_project_id, it.id, it.code, r.period_end, q3(a.qty), r.id, a.reason, r.org_project_id, actor.user, String(r.id)); codes.add(it.code); }
        for (const c of codes) recompute(r.org_project_id, c);
        const snap = snapshotOf(r.company_id, r, [], r.actual_cost); const hash = createHash('sha256').update(JSON.stringify({ ...snap, takenAt: null })).digest('hex');
        db.prepare("UPDATE prs_periods SET status = 'APPROVED', snapshot_json = ?, snapshot_hash = ?, physical_pct = ?, planned_pct = ?, financial_pct = ?, closed_by = ?, closed_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(JSON.stringify(snap), hash, bp(snap.project.physical), bp(snap.project.planned), bp(snap.project.financial), actor.user, now, actor.user, now, r.id);
        const ins = (wbsId, m, planned, physical) => db.prepare("INSERT INTO prs_evm (company_id, org_project_id, period_id, wbs_id, period_end, bac, pv, ev, ac, sv, cv, spi, cpi, eac, tcpi, planned_pct, physical_pct, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'prs_period')").run(r.company_id, r.org_project_id, r.id, wbsId, r.period_end, m.bac, m.pv, m.ev, m.ac, m.sv, m.cv, m.spi, m.cpi, m.eac, m.tcpi, bp(planned), bp(physical), r.org_project_id, actor.user);
        ins(null, snap.project, snap.project.planned, snap.project.physical); for (const n of snap.wbsFull) ins(n.id, { bac: n.bac, pv: n.pv, ev: n.ev, ac: null, sv: n.sv, cv: null, spi: n.spi, cpi: null, eac: null, tcpi: null }, n.planned, n.physical);
        audit(actor, 'prs_periods', r.id, r.parent_period_id ? 'close_amendment' : 'close', r.company_id, { newValues: { hash: hash.slice(0, 12), physical: snap.summary.physical, planned: snap.summary.planned } });
        const pr = db.prepare('SELECT code FROM org_projects WHERE id = ?').get(r.org_project_id);
        publishEvent(db, { type: 'site.period.closed', entity: 'prs_period', entityId: r.id, actorId: actor.user, companyId: r.company_id, projectId: r.org_project_id, data: { periodId: r.id, docNo: r.doc_no, projectId: r.org_project_id, periodType: r.period_type, periodStart: r.period_start, periodEnd: r.period_end, revisionNo: r.revision_no, supersedes: r.parent_period_id ?? null,
          physical: snap.summary.physical, planned: snap.summary.planned, financial: snap.summary.financial, forecastFinish: snap.summary.forecastFinish, bac: rs(snap.project.bac), pv: rs(snap.project.pv), ev: rs(snap.project.ev), ac: rs(snap.project.ac), spi: ratio(snap.project.spi), cpi: ratio(snap.project.cpi), eac: rs(snap.project.eac), tcpi: ratio(snap.project.tcpi), snapshotHash: hash } });
        notify(r.company_id, 'site.period.closed', [`user:${r.requested_by}`], r.doc_no, `${pr?.code} ${r.period_end}`, `${r.doc_no} is closed: planned ${snap.summary.planned} %, actual ${snap.summary.physical} %.`, `/site/periods?id=${r.id}`, r.id);
        const limit = Number(param(r.company_id, 'site.progress.spi_alert') ?? 90) / 100; if (snap.project.spi != null && snap.project.spi / 10000 < limit) notify(r.company_id, 'site.period.alert', ['role:PM|PD'], r.doc_no, String(pr?.code), `Progress of ${pr?.code} to ${r.period_end} is behind plan: SPI ${ratio(snap.project.spi)}.`, `/site/progress?projectId=${r.org_project_id}`, `a${r.id}`, { projectId: r.org_project_id });
        if (codes.size) pushToPlan(r.company_id, r.org_project_id, [...codes]); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE prs_periods SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'prs_periods', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'site.period.rejected', [`user:${r.requested_by}`], r.doc_no, String(r.period_end), `${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/site/periods?id=${r.id}`, r.id);
    },
  };
  function approvedMetricFacts(companyId, asOf, projectId = null) {
    return db.prepare(`WITH latest AS (
      SELECT p.org_project_id AS projectId, p.id AS sourceId, p.period_end AS sourcePeriod,
        p.revision_no AS sourceVersion,
        ROW_NUMBER() OVER (PARTITION BY p.org_project_id ORDER BY p.period_end DESC, p.revision_no DESC, p.id DESC) AS newest
      FROM prs_periods p
      JOIN org_projects o ON o.id = p.org_project_id AND o.company_id = p.company_id AND o.deleted_at IS NULL
      WHERE p.company_id = :companyId AND p.status = 'APPROVED' AND p.deleted_at IS NULL
        AND p.period_end <= :asOf ${projectId == null ? '' : 'AND p.org_project_id = :projectId'}
    )
    SELECT p.projectId, p.sourceId, p.sourcePeriod, p.sourceVersion, e.spi, e.cpi
    FROM latest p
    LEFT JOIN prs_evm e INDEXED BY ux_prs_evm ON e.period_id = p.sourceId AND COALESCE(e.wbs_id, 0) = 0
      AND e.company_id = :companyId AND e.org_project_id = p.projectId AND e.deleted_at IS NULL
    WHERE p.newest = 1`).iterate({ companyId, asOf, ...(projectId == null ? {} : { projectId }) });
  }

  return { periods, weights, onDpr, recordMeasured, dashboard, scurve: (actor, q) => scurve(actor, q.projectId, q.asOf ?? todayIST()), report, reportExport, clientReport, clientExport, periodDecide: periods.decide, evaluate, approvedMetricFacts, base: { may, param, project } };
}
