import { writeAudit } from '../../platform/audit/index.js';
import { hasPermissionAnywhere } from '../../platform/auth/index.js';
import { authzOf } from '../../platform/authz/index.js';
import { transaction } from '../../platform/db/index.js';
import { eventTypes, publishEvent } from '../../platform/events/index.js';
import { FORMATS, writeExport } from '../../platform/export/index.js';
import { forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { notificationsOf } from '../../platform/notify/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { widgetRegistry } from '../../platform/widgets/index.js';
import { workflowTypes } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { createBase, nowIso } from '../proc/base.js';
import { procOf } from '../proc/index.js';
import { registerProject360Widget } from '../proj/p360.js';
import { createFlow } from '../qa/flow.js';

/**
 * Part 28.03 — forecasting, anomaly detection and rate intelligence.
 *
 * Statistical models first (FR-01): a moving average, Holt's linear smoothing (level and trend, the "ARIMA/Prophet-like" baseline) and a
 * regression on time and, for material rates, on the price index of the item's category (drivers). Every forecast gives its range (80 %,
 * widening with the horizon) and its drivers. Four use cases read their history from the owners, as the person:
 *   RATE          monthly average landed rate of an item and region from the 15.09 rate intelligence (`procOf(db).rti.series`)
 *   COLLECTIONS   monthly approved client receipts (23.x accounts receivable), of a project or the company
 *   PRODUCTIVITY  weekly quantity of an activity from the progress records (14.02/14.06), with the finish of the remaining quantity
 *   COMPLETION    weekly percent complete of a project (activities weighted by duration), with the forecast completion date and its range
 * Forecast values are kept apart (`aif_forecasts`) and never written over actuals (BR-01); every point says ACTUAL, CALCULATED or FORECAST.
 * Models live in a registry with versions (`aif_models`); a version is back-tested (rolling origin: MAE, MAPE, RMSE, bias, range coverage)
 * and feeds official forecasts only once approved, model owner → CFO or PCMGR (section 9, FR-04). Without an approved model a forecast is a
 * preview, labelled as such and not stored.
 * Anomaly detection (FR-03) complements the 27.09 rules with statistical outliers (robust z-score: median and MAD) on purchase rates,
 * material issues, site attendance and payments, plus paid staff with no attendance (the payroll-to-attendance check of D-780). Each flag
 * names its source record, is shown only to people who may see that source, and is reviewed (confirmed or dismissed) by a person.
 */

export const FORECAST_FLAG = 'ff.ai.p2803';
export const MODEL_DOC = 'AI_MODEL';
export const FORECAST_LABEL = 'Forecast — statistical, verify';
const Z80 = 1.2816;

export const USE_CASES = Object.freeze({
  RATE: { label: 'Material rate', period: 'month', unit: '₹ per base unit', source: 'Rate intelligence (15.09)', defaultMethod: 'REGRESSION' },
  COLLECTIONS: { label: 'Client collections', period: 'month', unit: '₹', source: 'Client receipts (accounts receivable)', defaultMethod: 'HOLT' },
  PRODUCTIVITY: { label: 'Productivity', period: 'week', unit: 'quantity a week', source: 'Activity progress (14.02, 14.06)', defaultMethod: 'MOVING_AVERAGE' },
  COMPLETION: { label: 'Completion date', period: 'week', unit: '% complete', source: 'Activity progress and the schedule (13.01, 14.05)', defaultMethod: 'REGRESSION' },
});
export const METHODS = Object.freeze({
  MOVING_AVERAGE: { label: 'Moving average', params: { window: [4, 2, 24] } },
  HOLT: { label: 'Holt linear smoothing (level and trend)', params: { alpha: [0.5, 0.05, 0.95], beta: [0.2, 0.01, 0.9] } },
  REGRESSION: { label: 'Regression on time and drivers', params: { lookback: [12, 4, 60] } },
});
export const ANOMALY_KINDS = Object.freeze({
  RATE: { label: 'Purchase rate', perm: 'proc.purchase_order.view' },
  CONSUMPTION: { label: 'Material issue', perm: 'inv.issue.view' },
  ATTENDANCE: { label: 'Site attendance', perm: 'att.register.view' },
  PAYMENT: { label: 'Payment', perm: 'fin.payment.view' },
  PAYROLL_NO_ATTENDANCE: { label: 'Paid without attendance', perm: 'pay.run.view' },
});

for (const [key, def, description, min, max, type] of [
  ['ai.anomaly.z_threshold', 3.5, 'FR-03: a value is an outlier when its robust z-score (median and MAD of its history) is above this.', 2, 10, 'decimal'],
  ['ai.anomaly.min_history', 8, 'FR-03: values of the same series needed before outliers are looked for.', 4, 200, 'integer'],
  ['ai.anomaly.lookback_days', 365, 'FR-03: days of history the detection reads.', 30, 1095, 'integer'],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, min, max });

// ---------------------------------------------------------------------------------------------------------------- statistics (pure; tested)
const mean = (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0);
const round = (v, d = 2) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
export const medianOf = (v) => { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
/** Robust z-score of x against a history: 0.6745 × (x − median) / MAD; when MAD is 0 the mean absolute deviation is used (× 1.2533). */
export function robustZ(history, x) {
  const m = medianOf(history); if (m == null) return null;
  const mad = medianOf(history.map((v) => Math.abs(v - m)));
  if (mad > 0) return (0.6745 * (x - m)) / mad;
  const meanAd = mean(history.map((v) => Math.abs(v - m)));
  return meanAd > 0 ? (x - m) / (1.2533 * meanAd) : x === m ? 0 : Infinity * Math.sign(x - m);
}
/** Ordinary least squares of y on the columns of X (each row starts with 1); returns the coefficients or null when singular. */
function ols(X, y) {
  const k = X[0].length; const A = Array.from({ length: k }, () => Array(k + 1).fill(0));
  for (let r = 0; r < X.length; r += 1) for (let i = 0; i < k; i += 1) { for (let j = 0; j < k; j += 1) A[i][j] += X[r][i] * X[r][j]; A[i][k] += X[r][i] * y[r]; }
  for (let c = 0; c < k; c += 1) {
    let p = c; for (let r = c + 1; r < k; r += 1) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null; [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < k; r += 1) if (r !== c) { const f = A[r][c] / A[c][c]; for (let j = c; j <= k; j += 1) A[r][j] -= f * A[c][j]; }
  }
  return A.map((row, i) => row[k] / A[i][i]);
}
/** The linear trend of a series (for extending a driver into the future). */
const trendOf = (v) => { const b = v.length > 1 ? ols(v.map((_, i) => [1, i]), v) : null; return b ?? [v.at(-1) ?? 0, 0]; };

/**
 * Point forecasts 1..h steps after `y` with a method; `x` is an optional driver aligned with y (nulls allowed). Returns the forecasts and
 * the drivers that explain them.
 */
export function predict(method, y, params = {}, h = 1, x = null) {
  const n = y.length; if (!n) return { values: [], drivers: [] };
  if (method === 'MOVING_AVERAGE') {
    const w = Math.max(1, Math.min(params.window ?? 4, n)); const m = mean(y.slice(-w));
    return { values: Array(h).fill(m), drivers: [{ name: `Average of the last ${w} periods`, value: round(m) }] };
  }
  if (method === 'HOLT') {
    const a = params.alpha ?? 0.5; const b = params.beta ?? 0.2;
    let level = y[0]; let trend = n > 1 ? y[1] - y[0] : 0;
    for (let i = 1; i < n; i += 1) { const prev = level; level = a * y[i] + (1 - a) * (level + trend); trend = b * (level - prev) + (1 - b) * trend; }
    return { values: Array.from({ length: h }, (_, k) => level + (k + 1) * trend), drivers: [{ name: 'Level', value: round(level) }, { name: 'Trend per period', value: round(trend) }] };
  }
  // REGRESSION on time, and on the driver when it is known for every point of the window
  const L = Math.max(3, Math.min(params.lookback ?? 12, n)); const ys = y.slice(-L); const t0 = n - L;
  const xs = x ? x.slice(-L) : null; const useX = Boolean(xs && xs.length === L && xs.every((v) => v != null && Number.isFinite(v)) && new Set(xs).size > 1);
  const X = ys.map((_, i) => (useX ? [1, t0 + i, xs[i]] : [1, t0 + i]));
  const beta = ols(X, ys) ?? (useX ? null : [mean(ys), 0]);
  if (!beta) return predict('REGRESSION', y, params, h, null);
  const [xa, xb] = useX ? trendOf(xs) : [0, 0];
  const values = Array.from({ length: h }, (_, k) => { const t = n + k; const xf = useX ? xa + xb * (L + k) : 0; return beta[0] + beta[1] * t + (useX ? beta[2] * xf : 0); });
  const drivers = [{ name: 'Trend per period', value: round(beta[1]) }];
  if (useX) drivers.push({ name: 'Effect of one point of the price index', value: round(beta[2]) }, { name: 'Price index trend per period', value: round(xb) });
  return { values, drivers, usedDriver: useX };
}

/** Rolling-origin back-test of one-step forecasts over the last `holdout` points: MAE, MAPE, RMSE, bias and the share inside the 80 % range. */
export function backtest(method, y, params = {}, { holdout = null, x = null } = {}) {
  const n = y.length; const H = holdout ?? Math.max(3, Math.min(12, Math.floor(n / 3)));
  const start = n - H; if (start < 3) return null;
  const errors = []; const rows = []; let inside = 0; let ranged = 0;
  for (let i = start; i < n; i += 1) {
    const f = predict(method, y.slice(0, i), params, 1, x ? x.slice(0, i) : null).values[0];
    // the range of a point uses only the errors seen before it (no look-ahead)
    const prior = rolling(method, y.slice(0, i), params, x ? x.slice(0, i) : null);
    const sd = prior.length >= 3 ? Math.sqrt(mean(prior.map((e) => e * e))) : null;
    const low = sd == null ? null : f - Z80 * sd; const high = sd == null ? null : f + Z80 * sd;
    if (sd != null) { ranged += 1; if (y[i] >= low && y[i] <= high) inside += 1; }
    errors.push(f - y[i]); rows.push({ index: i, actual: round(y[i]), forecast: round(f), error: round(f - y[i]), low: round(low), high: round(high) });
  }
  const abs = errors.map(Math.abs); const pct = rows.filter((r) => r.actual).map((r) => Math.abs(r.error / r.actual));
  return { n: errors.length, mae: round(mean(abs)), mape: pct.length ? round(mean(pct) * 100, 1) : null, rmse: round(Math.sqrt(mean(errors.map((e) => e * e)))), bias: round(mean(errors)), coverage: ranged ? round((inside / ranged) * 100, 1) : null, rows };
}
/** One-step errors of the method over a history (from the fourth point), for the spread of its forecasts. */
function rolling(method, y, params, x) {
  const out = []; for (let i = 3; i < y.length; i += 1) out.push(predict(method, y.slice(0, i), params, 1, x ? x.slice(0, i) : null).values[0] - y[i]); return out;
}
/** Forecast h steps with an 80 % range widening with √k, from the one-step errors of the method on the history. */
export function forecastSeries(method, y, params = {}, h = 6, x = null, { floor = null, ceil = null } = {}) {
  const p = predict(method, y, params, h, x); const errs = rolling(method, y, params, x);
  const sd = errs.length >= 2 ? Math.sqrt(mean(errs.map((e) => e * e))) : Math.abs(mean(y)) * 0.1;
  const clamp = (v) => { let r = v; if (floor != null) r = Math.max(floor, r); if (ceil != null) r = Math.min(ceil, r); return r; };
  return { sd, drivers: p.drivers, usedDriver: Boolean(p.usedDriver), points: p.values.map((v, k) => ({ value: clamp(v), low: clamp(v - Z80 * sd * Math.sqrt(k + 1)), high: clamp(v + Z80 * sd * Math.sqrt(k + 1)) })) };
}

// ---------------------------------------------------------------------------------------------------------------- periods
const monthAdd = (m, k) => { const [y, mo] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mo - 1 + k, 1)); return d.toISOString().slice(0, 7); };
const dayAdd = (d, k) => new Date(Date.parse(`${d}T00:00:00Z`) + k * 86_400_000).toISOString().slice(0, 10);
const mondayOf = (d) => { const t = new Date(`${d}T00:00:00Z`); const wd = (t.getUTCDay() + 6) % 7; return dayAdd(d, -wd); };
const nextPeriod = (period, p, k) => (period === 'month' ? monthAdd(p, k) : dayAdd(p, 7 * k));

// ---------------------------------------------------------------------------------------------------------------- workflow (section 9)
const services = new WeakMap();
export const forecastOf = (db) => services.get(db) ?? null;
const decideWith = (outcome) => (db, { instance, actor, comment }) => forecastOf(db)?.flow.decide(instance, actor, outcome, comment);
workflowTypes.register({
  docType: MODEL_DOC, label: 'Forecast model activation', processOwner: 'ITADM', route: (id) => `/ai/forecasts?tab=models&id=${id}`,
  describe(db, companyId, id) { const r = db.prepare('SELECT * FROM aif_models WHERE id = ?').get(Number(id)); return r && r.company_id === companyId ? { ref: r.doc_no, title: `Forecast model ${r.code} v${r.version_no}`, originator: r.requested_by } : null; },
  summarise(db, _actor, id) {
    const r = db.prepare('SELECT * FROM aif_models WHERE id = ?').get(Number(id)); if (!r) return null;
    const bt = r.backtest_json ? JSON.parse(r.backtest_json) : null;
    return { fields: [{ label: 'Use case', value: USE_CASES[r.use_case]?.label ?? r.use_case }, { label: 'Method', value: METHODS[r.method]?.label ?? r.method }, { label: 'Parameters', value: r.params_json },
      { label: 'Back-test', value: bt ? `MAPE ${bt.mape ?? '—'} %, MAE ${bt.mae}, bias ${bt.bias}, ${bt.coverage ?? '—'} % inside the range, ${bt.n} points (${bt.subject})` : 'not run' }] };
  },
  defaultDefinition: { name: 'Forecast model: the model owner prepares it, the CFO or the project controls manager approves', settings: { resubmit: 'first', distinctApprovers: true },
    steps: [{ code: 'CFO_PCMGR', name: 'CFO or project controls manager approval', type: 'approval', mode: 'single', approvers: [{ kind: 'role', role: 'CFO' }, { kind: 'role', role: 'PCMGR' }], slaHours: 72, requireAttachment: false, checklist: [], when: null, notify: [], action: null }] },
  hooks: { onApproved: decideWith('APPROVED'), onRejected: decideWith('REJECTED'), onReturned: decideWith('RETURNED'), onCancelled: decideWith('CANCELLED') },
});
const shape = { type: 'object', additionalProperties: true };
eventTypes.define({ type: 'ai.model.activated', version: 1, schema: shape, owner: 'ai', description: 'A forecast model version was approved for official forecasts (part 28.03): data { model, useCase, version }.' });
eventTypes.define({ type: 'ai.anomaly.flagged', version: 1, schema: shape, owner: 'ai', description: 'An anomaly detection run flagged new statistical outliers (part 28.03): data { flagged, byKind }.' });
eventTypes.define({ type: 'ai.anomaly.reviewed', version: 1, schema: shape, owner: 'ai', description: 'A flagged anomaly was confirmed or dismissed (part 28.03): data { kind, outcome, sourceType, sourceId }.' });

export function requireForecasts(context, actor) {
  if (!Number.isSafeInteger(actor?.companyId) || actor.companyId < 1 || !context.flags.isOn(actor, FORECAST_FLAG)) throw notFound('Forecasting is not enabled for this company.');
}

/** @param {any} context @param {{ jobs?: any, scheduler?: any }} [deps] */
export function createForecasting(context, { jobs, scheduler } = {}) {
  const { db } = context;
  const base = createBase({ db });
  const authz = authzOf(db);
  const notify = notificationsOf(db);
  const guard = (actor, key) => { requireForecasts(context, actor); if (key && !hasPermissionAnywhere(actor, key)) throw forbidden(`You may not do this (permission ${key}).`); };
  const audit = (actor, entity, id, action, extra = {}) => writeAudit(db, { companyId: actor.companyId, entity, entityId: String(id), action, actor: actor.user, ...extra });
  const numParam = (companyId, key) => Number(base.param(companyId, key) ?? parameterRegistry.get(key)?.default);
  const projectOk = (actor, key, projectId) => authz.check(actor, key, { companyId: actor.companyId, projectId }).allowed;
  const projectRow = (actor, id, key) => {
    const p = db.prepare('SELECT id, code, name, company_id FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id));
    if (!p || p.company_id !== actor.companyId || !projectOk(actor, key, p.id)) throw notFound('That project does not exist.');
    return p;
  };

  // ------------------------------------------------------------------------------------------ the histories, read from the owners as the person
  /** @returns {{ subject: any, period: string, points: any[], driver: (number|null)[] | null, driverName?: string | null, sources: any[], extra?: any }} */
  function history(actor, useCase, q) {
    if (useCase === 'RATE') {
      const rti = procOf(db)?.rtiSvc; if (!rti) throw notFound('Rate intelligence (15.09) is not installed.');
      if (!q.itemId) throw unprocessable('Choose an item.');
      const s = rti.series(actor, { itemId: Number(q.itemId), region: q.region || null, months: 36 }); // refuses without proc.rate_intel.view
      const idx = new Map((s.indices ?? []).map((i) => [i.period, i.value]));
      const pts = s.points.filter((p) => p.avg != null).map((p) => ({ period: p.month, value: p.avg / 100, kind: 'CALCULATED', note: `average of ${p.count} observations` }));
      return { subject: { itemId: s.item.id, item: `${s.item.code} ${s.item.name}`, region: s.region, uom: s.item.uom, label: `${s.item.code} ${s.item.name} · ${s.region}` }, period: 'month', points: pts,
        driver: s.indexGroup && idx.size ? pts.map((p) => idx.get(p.period) ?? null) : null, driverName: s.indexGroup ? `Price index ${s.indexGroup}` : null,
        sources: [{ type: 'rate_series', label: `Rate intelligence: ${s.item.code}`, route: `/proc/rate-intelligence?itemId=${s.item.id}` }] };
    }
    if (useCase === 'COLLECTIONS') {
      const f = authz.scopeFilter(actor, 'fin.receipt.view', { project: 'r.org_project_id' });
      if (f.sql === '1 = 0') throw forbidden('You may not see client receipts (permission fin.receipt.view).');
      const p = q.projectId ? projectRow(actor, q.projectId, 'fin.receipt.view') : null;
      const last = monthAdd(todayIST().slice(0, 7), -1); const first = monthAdd(last, -35);
      const rows = db.prepare(`SELECT substr(r.receipt_date, 1, 7) AS m, SUM(r.amount_paise) AS v, COUNT(*) AS n FROM ar_receipts r WHERE r.company_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL AND ${f.sql}
        ${p ? 'AND r.org_project_id = ?' : ''} AND substr(r.receipt_date, 1, 7) BETWEEN ? AND ? GROUP BY m`).all(...[actor.companyId, ...(p ? [p.id] : []), first, last]);
      const by = new Map(rows.map((r) => [r.m, r]));
      const begin = rows.length ? rows.map((r) => r.m).sort()[0] : last; const pts = [];
      for (let m = begin; m <= last; m = monthAdd(m, 1)) pts.push({ period: m, value: (by.get(m)?.v ?? 0) / 100, kind: 'ACTUAL', note: `${by.get(m)?.n ?? 0} receipts` });
      return { subject: { projectId: p?.id ?? null, label: p ? `${p.code} ${p.name}` : 'All projects you may see' }, period: 'month', points: rows.length ? pts : [], driver: null,
        sources: [{ type: 'ar_receipts', label: 'Client receipts', route: `/finance/collections${p ? `?projectId=${p.id}` : ''}` }] };
    }
    if (useCase === 'PRODUCTIVITY') {
      if (!q.projectId || !q.activityId) throw unprocessable('Choose a project and an activity.');
      const p = projectRow(actor, q.projectId, 'site.productivity.view');
      const a = db.prepare('SELECT a.id, a.code, a.name, a.qty, a.uom FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE a.id = ? AND s.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL').get(Number(q.activityId), actor.companyId, p.id);
      if (!a) throw notFound('That activity does not exist.');
      const rows = db.prepare('SELECT work_date, qty FROM prs_activity_progress WHERE company_id = ? AND org_project_id = ? AND activity_id = ? AND deleted_at IS NULL ORDER BY work_date').all(actor.companyId, p.id, a.id);
      const by = new Map(); for (const r of rows) { const w = mondayOf(r.work_date); by.set(w, (by.get(w) ?? 0) + Number(r.qty)); }
      const weeks = [...by.keys()].sort(); const pts = [];
      if (weeks.length) for (let w = weeks[0]; w <= weeks.at(-1); w = dayAdd(w, 7)) pts.push({ period: w, value: round(by.get(w) ?? 0, 3), kind: 'ACTUAL' });
      const done = rows.reduce((s, r) => s + Number(r.qty), 0);
      return { subject: { projectId: p.id, activityId: a.id, label: `${p.code} · ${a.code} ${a.name}`, uom: a.uom }, period: 'week', points: pts, driver: null,
        extra: { plannedQty: a.qty, doneQty: round(done, 3), remainingQty: a.qty != null ? round(Math.max(0, a.qty - done), 3) : null },
        sources: [{ type: 'productivity', label: `Productivity of ${a.code}`, route: `/site/productivity?projectId=${p.id}&activityId=${a.id}` }] };
    }
    if (useCase === 'COMPLETION') {
      if (!q.projectId) throw unprocessable('Choose a project.');
      const p = projectRow(actor, q.projectId, 'plan.schedule.view');
      const acts = db.prepare('SELECT a.id, a.duration_days FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL').all(actor.companyId, p.id);
      const weight = new Map(acts.map((x) => [x.id, Math.max(1, Number(x.duration_days) || 1)])); const total = [...weight.values()].reduce((s, v) => s + v, 0);
      const prog = db.prepare('SELECT activity_id, work_date, pct_complete FROM prs_activity_progress WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND pct_complete IS NOT NULL ORDER BY work_date, id').all(actor.companyId, p.id).filter((x) => weight.has(x.activity_id));
      const pts = [];
      if (prog.length && total) {
        const latest = new Map(); let i = 0;
        for (let w = mondayOf(prog[0].work_date); w <= mondayOf(prog.at(-1).work_date); w = dayAdd(w, 7)) {
          const end = dayAdd(w, 6); while (i < prog.length && prog[i].work_date <= end) { latest.set(prog[i].activity_id, Number(prog[i].pct_complete)); i += 1; }
          let s = 0; for (const [id, pct] of latest) s += (weight.get(id) ?? 0) * Math.min(100, Math.max(0, pct));
          pts.push({ period: w, value: round(s / total, 2), kind: 'CALCULATED', note: 'activities weighted by duration' });
        }
      }
      const sched = db.prepare("SELECT MAX(a.ef) AS finish FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL AND s.deleted_at IS NULL").get(actor.companyId, p.id);
      return { subject: { projectId: p.id, label: `${p.code} ${p.name}` }, period: 'week', points: pts, driver: null, extra: { scheduledFinish: sched?.finish ?? null },
        sources: [{ type: 'schedule', label: `Schedule of ${p.code}`, route: `/plan/gantt?projectId=${p.id}` }] };
    }
    throw unprocessable('Unknown use case.');
  }

  // ------------------------------------------------------------------------------------------ the model registry (FR-04) and its approval
  const flow = createFlow({ db, base, docType: MODEL_DOC, table: 'aif_models', perm: 'ai.model', label: 'forecast model', route: '/ai/forecasts?tab=models&id=', where: () => ({ pid: null, sid: null }), prefix: 'AIM', notifyCode: 'ai.model.decided',
    ctx: (r) => ({ useCase: r.use_case }), title: (r) => `Forecast model ${r.code} v${r.version_no}`,
    beforeSubmit: (_actor, r) => { if (!r.backtest_json || !r.backtest_at) throw unprocessable('Run the back-test before asking for approval (FR-04).'); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM aif_models WHERE id = ?').get(r.id);
      // one official model per use case: the version approved last replaces the earlier ones
      db.prepare("UPDATE aif_models SET status = 'SUPERSEDED', updated_by = ?, updated_at = ?, version = version + 1 WHERE company_id = ? AND use_case = ? AND status = 'APPROVED' AND id <> ?").run(actor.user, nowIso(), x.company_id, x.use_case, x.id);
      publishEvent(db, { type: 'ai.model.activated', entity: 'aif_models', entityId: x.id, actorId: actor.user, companyId: x.company_id, data: { model: x.code, useCase: x.use_case, version: x.version_no } });
    },
  });
  const paramsOf = (method, given = {}) => {
    const spec = METHODS[method]; if (!spec) throw unprocessable('Unknown method.'); const out = {};
    for (const [k, [def, min, max]] of Object.entries(spec.params)) { const v = given[k] ?? def; if (typeof v !== 'number' || v < min || v > max) throw unprocessable(`${k} must be between ${min} and ${max}.`); out[k] = v; }
    for (const k of Object.keys(given)) if (!(k in spec.params)) throw unprocessable(`${METHODS[method].label} has no parameter ${k}.`);
    return out;
  };
  const modelView = (actor, r) => {
    const can = flow.can(actor, r);
    return { id: r.id, docNo: r.doc_no, code: r.code, name: r.name, useCase: r.use_case, useCaseLabel: USE_CASES[r.use_case].label, method: r.method, methodLabel: METHODS[r.method].label, params: JSON.parse(r.params_json), horizon: r.horizon,
      version: r.version_no, parentId: r.parent_id, status: r.status, official: r.status === 'APPROVED', backtest: r.backtest_json ? JSON.parse(r.backtest_json) : null, backtestAt: r.backtest_at, requestedBy: r.requested_by, approvedBy: r.approved_by,
      approvedAt: r.approved_at, createdBy: r.created_by, rowVersion: r.version, approval: flow.approveInfo(actor, r), can: { ...can, backtest: hasPermissionAnywhere(actor, 'ai.model.edit') && ['DRAFT', 'RETURNED'].includes(r.status), retire: hasPermissionAnywhere(actor, 'ai.model.edit') && r.status === 'APPROVED' } };
  };
  const official = (companyId, useCase) => db.prepare("SELECT * FROM aif_models WHERE company_id = ? AND use_case = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(companyId, useCase) ?? null;

  const models = {
    list(actor) {
      guard(actor, 'ai.model.view');
      return { rows: db.prepare('SELECT * FROM aif_models WHERE company_id = ? AND deleted_at IS NULL ORDER BY use_case, code, version_no DESC').all(actor.companyId).map((r) => modelView(actor, r)),
        useCases: Object.entries(USE_CASES).map(([code, u]) => ({ code, ...u })), methods: Object.entries(METHODS).map(([code, m]) => ({ code, label: m.label, params: m.params })), canCreate: hasPermissionAnywhere(actor, 'ai.model.create') };
    },
    get(actor, id) { guard(actor, 'ai.model.view'); return modelView(actor, flow.row(actor, id)); },
    create(actor, b) {
      guard(actor, 'ai.model.create');
      if (!USE_CASES[b.useCase]) throw unprocessable('Unknown use case.');
      const params = paramsOf(b.method, b.params);
      return transaction(db, () => {
        const prev = db.prepare('SELECT MAX(version_no) AS v FROM aif_models WHERE company_id = ? AND code = ? AND deleted_at IS NULL').get(actor.companyId, b.code).v ?? 0;
        const parent = prev ? db.prepare("SELECT id FROM aif_models WHERE company_id = ? AND code = ? AND deleted_at IS NULL AND status = 'APPROVED' ORDER BY version_no DESC LIMIT 1").get(actor.companyId, b.code)?.id ?? null : null;
        const used = prev ? db.prepare('SELECT use_case FROM aif_models WHERE company_id = ? AND code = ? AND deleted_at IS NULL LIMIT 1').get(actor.companyId, b.code)?.use_case : null;
        if (used && used !== b.useCase) throw unprocessable(`The model ${b.code} is for ${USE_CASES[used].label}; use another code.`);
        const docNo = flow.next(actor);
        const id = Number(db.prepare(`INSERT INTO aif_models (company_id, doc_no, code, name, use_case, method, params_json, horizon, version_no, parent_id, status, requested_by, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?)`).run(actor.companyId, docNo, b.code, b.name, b.useCase, b.method, JSON.stringify(params), b.horizon ?? 6, prev + 1, parent, actor.user, actor.user).lastInsertRowid);
        audit(actor, 'aif_models', id, 'create', { newValues: { code: b.code, useCase: b.useCase, method: b.method, params, version: prev + 1 } });
        return models.get(actor, id);
      });
    },
    update(actor, id, b) {
      guard(actor, 'ai.model.edit');
      const r = flow.row(actor, id, 'ai.model.edit');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or returned version is changed; prepare a new version of an approved one.');
      if (b.rowVersion !== r.version) throw Object.assign(new Error('The model was changed by someone else: reload it.'), { status: 409, code: 'CONFLICT' });
      const method = b.method ?? r.method; const params = paramsOf(method, b.params ?? (b.method ? {} : JSON.parse(r.params_json)));
      db.prepare('UPDATE aif_models SET name = ?, method = ?, params_json = ?, horizon = ?, backtest_json = NULL, backtest_at = NULL, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(b.name ?? r.name, method, JSON.stringify(params), b.horizon ?? r.horizon, actor.user, nowIso(), r.id);
      audit(actor, 'aif_models', r.id, 'update', { oldValues: { method: r.method, params: JSON.parse(r.params_json), horizon: r.horizon }, newValues: { method, params, horizon: b.horizon ?? r.horizon } });
      return models.get(actor, r.id);
    },
    remove(actor, id) { guard(actor, 'ai.model.delete'); return flow.remove(actor, id); },
    /** FR-04: back-test the version on the history of a subject the preparer may see; kept on the version and shown to the approver. */
    runBacktest(actor, id, subject) {
      guard(actor, 'ai.model.edit');
      const r = flow.row(actor, id, 'ai.model.edit');
      if (!['DRAFT', 'RETURNED'].includes(r.status)) throw unprocessable('Only a draft or returned version is back-tested.');
      const h = history(actor, r.use_case, subject);
      const y = h.points.map((p) => p.value);
      if (y.length < 8) throw unprocessable(`Not enough history to back-test: ${y.length} ${h.period}s of ${h.subject.label}; at least 8 are needed.`);
      const params = JSON.parse(r.params_json);
      const bt = backtest(r.method, y, params, { x: h.driver });
      const baseline = backtest('MOVING_AVERAGE', y, { window: 1 }, { holdout: bt.n }); // the naive forecast: the last value
      const out = { ...bt, rows: bt.rows.map((row) => ({ ...row, period: h.points[row.index].period })), subject: h.subject.label, subjectQuery: subject, period: h.period, naive: { mae: baseline.mae, mape: baseline.mape }, skill: baseline.mae ? round(1 - bt.mae / baseline.mae, 3) : null, at: nowIso() };
      db.prepare('UPDATE aif_models SET backtest_json = ?, backtest_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify(out), out.at, actor.user, nowIso(), r.id);
      audit(actor, 'aif_models', r.id, 'backtest', { newValues: { mae: out.mae, mape: out.mape, rmse: out.rmse, bias: out.bias, coverage: out.coverage, n: out.n, subject: out.subject } });
      return models.get(actor, r.id);
    },
    exportBacktest(actor, id, format) {
      guard(actor, 'ai.forecast.export');
      const m = models.get(actor, id); if (!m.backtest) throw unprocessable('This version has no back-test yet.');
      const bt = m.backtest;
      const columns = [['period', 'Period'], ['actual', 'Actual'], ['forecast', 'Forecast (one step ahead)'], ['error', 'Error'], ['low', 'Range low (80 %)'], ['high', 'Range high (80 %)']].map(([key, label]) => ({ key, label }));
      const rows = bt.rows.map((r) => ({ period: r.period, actual: String(r.actual), forecast: String(r.forecast), error: String(r.error), low: String(r.low ?? ''), high: String(r.high ?? '') }));
      const buffer = writeExport(format, { columns, rows, title: `Back-test of ${m.code} v${m.version} (${m.methodLabel})`, sheetName: 'Back-test',
        footer: [`${bt.subject} · MAE ${bt.mae} · MAPE ${bt.mape ?? '—'} % · RMSE ${bt.rmse} · bias ${bt.bias} · inside the 80 % range ${bt.coverage ?? '—'} % · naive MAE ${bt.naive?.mae ?? '—'} · run ${bt.at}`] });
      audit(actor, 'aif_models', m.id, 'export', { newValues: { format } });
      return { buffer, contentType: FORMATS[format], fileName: `backtest-${m.code}-v${m.version}.${format}` };
    },
    submit(actor, id) { guard(actor, 'ai.model.submit'); flow.submit(actor, id); return models.get(actor, id); },
    withdraw(actor, id, b) { guard(actor); flow.withdraw(actor, id, b); return models.get(actor, id); },
    cancel(actor, id, b) { guard(actor, 'ai.model.cancel'); flow.cancel(actor, id, b); return models.get(actor, id); },
    history(actor, id) { guard(actor, 'ai.model.view'); return flow.history(actor, id); },
    /** Retire an official model at once (no approval needed to stop); the use case falls back to previews until another version is approved. */
    retire(actor, id, { reason }) {
      guard(actor, 'ai.model.edit');
      const r = flow.row(actor, id, 'ai.model.edit');
      if (r.status !== 'APPROVED') throw unprocessable('Only an official model is retired.');
      db.prepare("UPDATE aif_models SET status = 'SUPERSEDED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id);
      audit(actor, 'aif_models', r.id, 'retire', { reason });
      return models.get(actor, r.id);
    },
    amend(actor, id, { reason }) {
      guard(actor, 'ai.model.amend');
      const r = flow.row(actor, id, 'ai.model.amend');
      if (!['APPROVED', 'SUPERSEDED'].includes(r.status)) throw unprocessable('Only an approved or retired version is amended.');
      const made = models.create(actor, { code: r.code, name: r.name, useCase: r.use_case, method: r.method, params: JSON.parse(r.params_json), horizon: r.horizon });
      audit(actor, 'aif_models', made.id, 'amend', { reason, newValues: { from: r.id } });
      return made;
    },
  };

  // ------------------------------------------------------------------------------------------ forecasts (FR-01, FR-02, BR-01)
  function forecast(actor, q) {
    guard(actor, 'ai.forecast.view');
    const uc = USE_CASES[q.useCase]; if (!uc) throw unprocessable('Unknown use case.');
    let model; let preview;
    if (q.modelId) {
      if (!hasPermissionAnywhere(actor, 'ai.model.view')) throw forbidden('Only model owners preview a model that is not official (permission ai.model.view).');
      const r = flow.row(actor, q.modelId); if (r.use_case !== q.useCase) throw unprocessable('That model is for another use case.');
      model = r; preview = r.status !== 'APPROVED';
    } else { model = official(actor.companyId, q.useCase); preview = !model; }
    const method = model?.method ?? uc.defaultMethod; const params = model ? JSON.parse(model.params_json) : paramsOf(uc.defaultMethod, {}); const horizon = model?.horizon ?? 6;
    const h = history(actor, q.useCase, q);
    const y = h.points.map((p) => p.value);
    const out = { useCase: q.useCase, useCaseLabel: uc.label, unit: q.useCase === 'PRODUCTIVITY' ? `${h.subject.uom ?? ''} a week`.trim() : uc.unit, period: h.period, subject: h.subject, sources: h.sources,
      model: model ? { id: model.id, docNo: model.doc_no, code: model.code, version: model.version_no, method, methodLabel: METHODS[method].label, status: model.status } : { id: null, code: null, method, methodLabel: METHODS[method].label, status: 'BASELINE' },
      official: !preview, label: preview ? `${FORECAST_LABEL} · preview: no approved model` : FORECAST_LABEL, asOf: todayIST(), history: h.points, points: h.points, extra: h.extra ?? null };
    if (y.length < 4) return { ...out, empty: `Not enough history for ${h.subject.label}: ${y.length} ${h.period}s; at least 4 are needed.`, drivers: [], next: null, backtest: null };
    const bounds = q.useCase === 'COMPLETION' ? { floor: 0, ceil: 100 } : { floor: 0 };
    const reach = q.useCase === 'COMPLETION' ? 104 : horizon;
    const f = forecastSeries(method, y, params, reach, h.driver, bounds);
    const last = h.points.at(-1).period;
    const fc = f.points.map((p, k) => ({ period: nextPeriod(h.period, last, k + 1), value: round(p.value, 2), low: round(p.low, 2), high: round(p.high, 2), kind: 'FORECAST' }));
    const shown = fc.slice(0, horizon);
    const drivers = [...f.drivers]; if (h.driverName && f.usedDriver) drivers.push({ name: `Driver: ${h.driverName}`, value: null });
    const bt = y.length >= 8 ? backtest(method, y, params, { x: h.driver }) : null;
    let completion = null;
    if (q.useCase === 'COMPLETION') {
      const at = (key) => fc.find((p) => p[key] >= 99.95)?.period ?? null;
      completion = { date: at('value'), early: at('high'), late: at('low'), scheduled: h.extra?.scheduledFinish ?? null, current: y.at(-1), beyond: !at('value') ? 'Beyond two years at the current pace' : null };
    }
    if (q.useCase === 'PRODUCTIVITY' && h.extra?.remainingQty != null) {
      const rate = shown[0]?.value; const weeks = rate > 0 ? Math.ceil(h.extra.remainingQty / rate) : null;
      completion = { remainingQty: h.extra.remainingQty, weeksLeft: weeks, date: weeks != null ? nextPeriod('week', last, weeks) : null };
    }
    const result = { ...out, points: [...h.points, ...shown], next: shown[0] ?? null, drivers, backtest: bt ? { n: bt.n, mae: bt.mae, mape: bt.mape, rmse: bt.rmse, bias: bt.bias, coverage: bt.coverage } : null, completion };
    // official forecasts are kept (one a day per model and subject) for dashboards and scenarios; actuals are never touched (BR-01)
    if (!preview) {
      const key = JSON.stringify({ useCase: q.useCase, itemId: q.itemId ?? null, region: q.region || null, projectId: q.projectId ?? null, activityId: q.activityId ?? null });
      db.prepare(`INSERT INTO aif_forecasts (company_id, model_id, use_case, subject_key, subject_label, as_of, points_json, next_value, next_low, next_high, completion_json, project_id, source_type, source_id, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'aif_models', ?, ?)
        ON CONFLICT (company_id, model_id, subject_key, as_of) DO UPDATE SET points_json = excluded.points_json, next_value = excluded.next_value, next_low = excluded.next_low, next_high = excluded.next_high, completion_json = excluded.completion_json, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by = excluded.created_by, version = aif_forecasts.version + 1`)
        .run(actor.companyId, model.id, q.useCase, key, h.subject.label, out.asOf, JSON.stringify(shown), shown[0]?.value ?? null, shown[0]?.low ?? null, shown[0]?.high ?? null, completion ? JSON.stringify(completion) : null, h.subject.projectId ?? null, String(model.id), actor.user);
    }
    return result;
  }
  /** The latest official forecasts the person may see (for dashboards, Project 360 and scenarios). */
  function latest(actor, { projectId = null, limit = 20 } = {}) {
    guard(actor, 'ai.forecast.view');
    const rows = db.prepare(`SELECT f.*, m.code, m.version_no FROM aif_forecasts f JOIN aif_models m ON m.id = f.model_id WHERE f.company_id = ? ${projectId ? 'AND f.project_id = ?' : ''}
      AND f.id IN (SELECT MAX(id) FROM aif_forecasts WHERE company_id = f.company_id GROUP BY model_id, subject_key) ORDER BY f.as_of DESC, f.id DESC LIMIT ?`).all(...[actor.companyId, ...(projectId ? [projectId] : []), limit]);
    const keyOf = { COLLECTIONS: 'fin.receipt.view', PRODUCTIVITY: 'site.productivity.view', COMPLETION: 'plan.schedule.view' };
    return rows.filter((r) => (r.use_case === 'RATE' ? hasPermissionAnywhere(actor, 'proc.rate_intel.view') : r.project_id == null ? hasPermissionAnywhere(actor, keyOf[r.use_case]) && authz.scopeFilter(actor, keyOf[r.use_case], {}).unrestricted : projectOk(actor, keyOf[r.use_case], r.project_id)))
      .map((r) => ({ id: r.id, useCase: r.use_case, useCaseLabel: USE_CASES[r.use_case].label, subject: r.subject_label, asOf: r.as_of, model: `${r.code} v${r.version_no}`, next: { value: r.next_value, low: r.next_low, high: r.next_high },
        points: JSON.parse(r.points_json), completion: r.completion_json ? JSON.parse(r.completion_json) : null, query: JSON.parse(r.subject_key), label: FORECAST_LABEL }));
  }

  // ------------------------------------------------------------------------------------------ anomaly detection (FR-03)
  /** Each detector returns candidate flags: the value, its expected value (the median of its series) and the robust z-score. */
  function detect(companyId) {
    const z = numParam(companyId, 'ai.anomaly.z_threshold'); const minH = numParam(companyId, 'ai.anomaly.min_history'); const since = dayAdd(todayIST(), -numParam(companyId, 'ai.anomaly.lookback_days'));
    const out = [];
    /** groups: Map key → [{ v, ...row }] in date order; each value is tested against the others of its group. */
    const scan = (groups, make) => {
      for (const rows of groups.values()) {
        if (rows.length < minH + 1) continue;
        for (let i = 0; i < rows.length; i += 1) {
          const hist = rows.filter((_, j) => j !== i).map((r) => r.v); const s = robustZ(hist, rows[i].v);
          if (s != null && Math.abs(s) >= z) out.push(make(rows[i], medianOf(hist), s));
        }
      }
    };
    const group = (rows, key) => { const m = new Map(); for (const r of rows) { const k = key(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
    const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
    if (has('proc_po_lines')) {
      const rows = db.prepare(`SELECT l.id, l.po_id, l.item_id, l.uom, l.rate AS v, o.doc_no, o.org_project_id AS project_id, i.code AS item FROM proc_po_lines l JOIN proc_purchase_orders o ON o.id = l.po_id LEFT JOIN mdm_items i ON i.id = l.item_id
        WHERE o.company_id = ? AND o.deleted_at IS NULL AND l.deleted_at IS NULL AND o.status NOT IN ('DRAFT', 'CANCELLED', 'REJECTED') AND l.rate > 0 AND o.doc_date >= ? ORDER BY o.doc_date, l.id`).all(companyId, since);
      scan(group(rows, (r) => `${r.item_id}|${r.uom}`), (r, exp, s) => ({ kind: 'RATE', sourceType: 'proc_po_lines', sourceId: r.id, projectId: r.project_id, siteId: null, subject: `${r.item ?? `item ${r.item_id}`} on ${r.doc_no}`,
        observed: r.v, expected: exp, z: s, detail: `rate ${r.v} per ${r.uom} against a median of ${round(exp)} on ${rows.filter((x) => x.item_id === r.item_id && x.uom === r.uom).length} order lines`, route: `/proc/purchase-orders?id=${r.po_id}` }));
    }
    if (has('inv_stock_ledger')) {
      const rows = db.prepare(`SELECT MIN(x.id) AS id, x.project_id, x.item_id, x.txn_date, SUM(x.qty_out) AS v, i.code AS item FROM inv_stock_ledger x LEFT JOIN mdm_items i ON i.id = x.item_id
        WHERE x.company_id = ? AND x.txn_type = 'ISSUE' AND x.deleted_at IS NULL AND x.reverses_id IS NULL AND x.txn_date >= ? GROUP BY x.project_id, x.item_id, x.txn_date ORDER BY x.txn_date`).all(companyId, since);
      scan(group(rows, (r) => `${r.project_id}|${r.item_id}`), (r, exp, s) => ({ kind: 'CONSUMPTION', sourceType: 'inv_stock_ledger', sourceId: r.id, projectId: r.project_id, siteId: null, subject: `${r.item ?? `item ${r.item_id}`} issued on ${r.txn_date}`,
        observed: r.v, expected: exp, z: s, detail: `issued ${r.v} in a day against a median of ${round(exp)} a day`, route: `/inv/ledger?itemId=${r.item_id}${r.project_id ? `&projectId=${r.project_id}` : ''}` }));
    }
    if (has('att_daily')) {
      const rows = db.prepare(`SELECT MIN(d.id) AS id, COALESCE(d.daily_site_id, d.site_id) AS site_id, d.project_id, d.work_date, COUNT(*) AS v FROM att_daily d
        WHERE d.company_id = ? AND d.deleted_at IS NULL AND d.status IN ('PRESENT', 'HALF_DAY', 'ON_DUTY', 'HOLIDAY_WORKED', 'WEEKLY_OFF_WORKED') AND d.work_date >= ? GROUP BY COALESCE(d.daily_site_id, d.site_id), d.work_date ORDER BY d.work_date`).all(companyId, since);
      scan(group(rows.filter((r) => r.site_id != null), (r) => String(r.site_id)), (r, exp, s) => ({ kind: 'ATTENDANCE', sourceType: 'att_daily', sourceId: r.id, projectId: r.project_id, siteId: r.site_id, subject: `Site ${db.prepare('SELECT code FROM org_sites WHERE id = ?').get(r.site_id)?.code ?? r.site_id} on ${r.work_date}`,
        observed: r.v, expected: exp, z: s, detail: `${r.v} people present against a median of ${round(exp, 1)} a day`, route: `/att/daily?siteId=${r.site_id}&date=${r.work_date}` }));
    }
    if (has('pmt_payments')) {
      const rows = db.prepare(`SELECT p.id, p.partner_id, p.payee_name, p.doc_no, p.project_id, p.amount_paise AS v FROM pmt_payments p WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.pay_status NOT IN ('FAILED', 'CANCELLED') AND COALESCE(p.paid_on, p.released_on, substr(p.created_at, 1, 10)) >= ? ORDER BY p.id`).all(companyId, since);
      scan(group(rows, (r) => String(r.partner_id ?? r.payee_name)), (r, exp, s) => ({ kind: 'PAYMENT', sourceType: 'pmt_payments', sourceId: r.id, projectId: r.project_id, siteId: null, subject: `${r.payee_name} · ${r.doc_no}`,
        observed: r.v / 100, expected: exp / 100, z: s, detail: `₹${(r.v / 100).toLocaleString('en-IN')} against a median of ₹${(exp / 100).toLocaleString('en-IN')} to this payee`, route: `/finance/payments?id=${r.id}` }));
    }
    // D-780: staff paid for days in a month in which the attendance of the company has records but none for them (possible ghost workers)
    if (has('pay_run_lines') && has('att_daily')) {
      const rows = db.prepare(`SELECT l.id, l.run_id, l.employee_id, l.paid_days, r.period, r.doc_no, l.project_id, l.site_id, e.emp_code, e.full_name FROM pay_run_lines l JOIN pay_runs r ON r.id = l.run_id LEFT JOIN hr_employees e ON e.id = l.employee_id
        WHERE r.company_id = ? AND r.deleted_at IS NULL AND l.deleted_at IS NULL AND r.status NOT IN ('DRAFT', 'CANCELLED', 'REJECTED') AND l.paid_days > 0 AND r.period >= ?
        AND EXISTS (SELECT 1 FROM att_daily a WHERE a.company_id = r.company_id AND a.person_type = 'EMPLOYEE' AND substr(a.work_date, 1, 7) = r.period AND a.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM att_daily a WHERE a.company_id = r.company_id AND a.person_type = 'EMPLOYEE' AND a.person_id = l.employee_id AND substr(a.work_date, 1, 7) = r.period AND a.deleted_at IS NULL)`).all(companyId, since.slice(0, 7));
      for (const r of rows) out.push({ kind: 'PAYROLL_NO_ATTENDANCE', sourceType: 'pay_run_lines', sourceId: r.id, projectId: r.project_id, siteId: r.site_id, subject: `${r.emp_code ?? `employee ${r.employee_id}`} ${r.full_name ?? ''} · ${r.doc_no}`.trim(),
        observed: r.paid_days, expected: 0, z: null, detail: `paid for ${r.paid_days} days of ${r.period} with no attendance record in that month`, route: `/payroll/runs?id=${r.run_id}` });
    }
    return out;
  }
  function runDetection(actor) {
    const found = detect(actor.companyId); let flagged = 0; const byKind = {};
    transaction(db, () => {
      const up = db.prepare(`INSERT INTO aif_anomalies (company_id, kind, source_type, source_id, project_id, site_id, subject, observed, expected, score, detail, route, status, detected_at, created_by, source_ref)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)
        ON CONFLICT (company_id, kind, source_type, source_id) DO UPDATE SET observed = excluded.observed, expected = excluded.expected, score = excluded.score, detail = excluded.detail, updated_at = excluded.detected_at, updated_by = excluded.created_by, version = aif_anomalies.version + 1
        WHERE aif_anomalies.status = 'OPEN'`);
      const seen = db.prepare('SELECT 1 FROM aif_anomalies WHERE company_id = ? AND kind = ? AND source_type = ? AND source_id = ?');
      const at = nowIso();
      for (const a of found) {
        const isNew = !seen.get(actor.companyId, a.kind, a.sourceType, String(a.sourceId));
        up.run(actor.companyId, a.kind, a.sourceType, String(a.sourceId), a.projectId ?? null, a.siteId ?? null, a.subject, a.observed, a.expected, a.z == null ? null : round(a.z, 2), a.detail, a.route, at, actor.user, `${a.sourceType}:${String(a.sourceId)}`);
        if (isNew) { flagged += 1; byKind[a.kind] = (byKind[a.kind] ?? 0) + 1; }
      }
      if (flagged) publishEvent(db, { type: 'ai.anomaly.flagged', entity: 'aif_anomalies', entityId: 0, actorId: actor.user, companyId: actor.companyId, data: { flagged, byKind } });
    });
    return { candidates: found.length, flagged, byKind };
  }
  /** The flags the person may see: each kind only where they may see its source records. */
  function visible(actor) {
    const parts = [];
    for (const [kind, k] of Object.entries(ANOMALY_KINDS)) {
      const f = authz.scopeFilter(actor, k.perm, { project: 'a.project_id', site: 'a.site_id' });
      if (f.sql !== '1 = 0') parts.push(`(a.kind = '${kind}' AND ${f.sql})`);
    }
    return parts.length ? `(${parts.join(' OR ')})` : '1 = 0';
  }
  const anomalyView = (a) => ({ id: a.id, kind: a.kind, kindLabel: ANOMALY_KINDS[a.kind].label, subject: a.subject, observed: a.observed, expected: a.expected, score: a.score, detail: a.detail, route: a.route, projectId: a.project_id,
    status: a.status, detectedAt: a.detected_at, reviewedBy: a.reviewed_by, reviewedAt: a.reviewed_at, note: a.review_note, source: { type: a.source_type, id: a.source_id } });
  const anomalies = {
    list(actor, { status = 'OPEN', kind = null, projectId = null, page = 1, pageSize = 25 } = {}) {
      guard(actor, 'ai.anomaly.view');
      const where = [`a.company_id = ?`, visible(actor)]; const params = [actor.companyId];
      if (status !== 'ALL') { where.push('a.status = ?'); params.push(status); }
      if (kind) { where.push('a.kind = ?'); params.push(kind); }
      if (projectId) { where.push('a.project_id = ?'); params.push(projectId); }
      const sql = where.join(' AND ');
      const total = db.prepare(`SELECT COUNT(*) AS n FROM aif_anomalies a WHERE ${sql}`).get(...params).n;
      const rows = db.prepare(`SELECT a.* FROM aif_anomalies a WHERE ${sql} ORDER BY a.status = 'OPEN' DESC, ABS(COALESCE(a.score, 99)) DESC, a.id DESC LIMIT ? OFFSET ?`).all(...params, pageSize, (page - 1) * pageSize).map(anomalyView);
      const byKind = db.prepare(`SELECT a.kind, COUNT(*) AS n FROM aif_anomalies a WHERE a.company_id = ? AND a.status = 'OPEN' AND ${visible(actor)} GROUP BY a.kind`).all(actor.companyId);
      return { rows, total, page, pageSize, open: Object.fromEntries(byKind.map((x) => [x.kind, x.n])), kinds: Object.entries(ANOMALY_KINDS).map(([code, k]) => ({ code, label: k.label })),
        canReview: hasPermissionAnywhere(actor, 'ai.anomaly.review'), canRun: hasPermissionAnywhere(actor, 'ai.anomaly.run'), threshold: numParam(actor.companyId, 'ai.anomaly.z_threshold') };
    },
    run(actor) { guard(actor, 'ai.anomaly.run'); const r = runDetection(actor); audit(actor, 'aif_anomalies', 0, 'run', { newValues: r }); return r; },
    review(actor, id, { outcome, note }) {
      guard(actor, 'ai.anomaly.review');
      const a = db.prepare(`SELECT a.* FROM aif_anomalies a WHERE a.id = ? AND a.company_id = ? AND ${visible(actor)}`).get(Number(id), actor.companyId);
      if (!a) throw notFound('That anomaly does not exist.');
      if (a.status !== 'OPEN') throw unprocessable('This anomaly was reviewed already.');
      if (!authz.check(actor, ANOMALY_KINDS[a.kind].perm, { companyId: actor.companyId, projectId: a.project_id ?? undefined, siteId: a.site_id ?? undefined }).allowed) throw forbidden('You may not see the record behind this anomaly.');
      transaction(db, () => {
        db.prepare('UPDATE aif_anomalies SET status = ?, reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(outcome, actor.user, nowIso(), note, actor.user, nowIso(), a.id);
        audit(actor, 'aif_anomalies', a.id, 'review', { reason: note, newValues: { outcome } });
        publishEvent(db, { type: 'ai.anomaly.reviewed', entity: 'aif_anomalies', entityId: a.id, actorId: actor.user, companyId: actor.companyId, projectId: a.project_id ?? null, data: { kind: a.kind, outcome, sourceType: a.source_type, sourceId: a.source_id } });
      });
      return anomalyView(db.prepare('SELECT * FROM aif_anomalies WHERE id = ?').get(a.id));
    },
  };

  /** The choices of the page: items with rate history, the projects of each use case and the activities of a project. */
  function options(actor, { projectId = null } = {}) {
    guard(actor, 'ai.forecast.view');
    const projects = (key) => db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL ORDER BY code").all(actor.companyId).filter((p) => projectOk(actor, key, p.id)).map((p) => ({ id: p.id, label: `${p.code} ${p.name}` }));
    const items = hasPermissionAnywhere(actor, 'proc.rate_intel.view') ? db.prepare('SELECT i.id, i.code, i.name, COUNT(*) AS n FROM rti_observations x JOIN mdm_items i ON i.id = x.item_id WHERE x.company_id = ? GROUP BY i.id ORDER BY n DESC, i.code LIMIT 60').all(actor.companyId).map((i) => ({ id: i.id, label: `${i.code} ${i.name}` })) : [];
    const regions = hasPermissionAnywhere(actor, 'proc.rate_intel.view') ? db.prepare('SELECT DISTINCT region_code AS r FROM rti_observations WHERE company_id = ? ORDER BY r').all(actor.companyId).map((x) => x.r) : [];
    const activities = projectId && projectOk(actor, 'site.productivity.view', Number(projectId)) ? db.prepare(`SELECT a.id, a.code, a.name FROM plan_activities a JOIN plan_schedules s ON s.id = a.schedule_id WHERE s.company_id = ? AND s.org_project_id = ? AND a.deleted_at IS NULL
      AND EXISTS (SELECT 1 FROM prs_activity_progress p WHERE p.activity_id = a.id AND p.deleted_at IS NULL) ORDER BY a.code LIMIT 200`).all(actor.companyId, Number(projectId)).map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })) : [];
    const official = Object.fromEntries(Object.keys(USE_CASES).map((u) => { const m = db.prepare("SELECT code, version_no FROM aif_models WHERE company_id = ? AND use_case = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(actor.companyId, u); return [u, m ? `${m.code} v${m.version_no}` : null]; }));
    return { useCases: Object.entries(USE_CASES).map(([code, u]) => ({ code, label: u.label, period: u.period })), items, regions, activities, official,
      projects: { COLLECTIONS: projects('fin.receipt.view'), PRODUCTIVITY: projects('site.productivity.view'), COMPLETION: projects('plan.schedule.view') },
      can: { models: hasPermissionAnywhere(actor, 'ai.model.view'), anomalies: hasPermissionAnywhere(actor, 'ai.anomaly.view'), export: hasPermissionAnywhere(actor, 'ai.forecast.export') } };
  }

  const svc = { flow, models, forecast, latest, anomalies, options, history, detect: (companyId) => detect(companyId) };
  services.set(db, svc);
  contexts.set(db, context);
  if (jobs) {
    jobs.register('ai.anomaly.detect', () => {
      let n = 0;
      for (const c of db.prepare("SELECT DISTINCT company_id AS id FROM core_feature_flags WHERE key = ? AND enabled = 1 AND company_id IS NOT NULL").all(FORECAST_FLAG)) n += runDetection({ companyId: c.id, user: 'system', roles: ['SYSADM'] }).flagged;
      return { flagged: n };
    }, { description: 'Looks for statistical outliers in rates, issues, attendance, payments and payroll (part 28.03).' });
    scheduler?.define({ code: 'ai.anomaly.detect', cron: '40 3 * * *', jobType: 'ai.anomaly.detect', description: 'Anomaly detection daily at 03:40 IST.' });
  }
  void notify;
  return svc;
}

// ---------------------------------------------------------------------------------------------------------------- widgets: predictions on dashboards and Project 360
const contexts = new WeakMap();
const widgetOk = (db, actor) => {
  const c = contexts.get(db);
  if (!c || !forecastOf(db) || !hasPermissionAnywhere(actor, 'ai.forecast.view')) return false;
  try { requireForecasts(c, actor); return true; } catch (e) { if (e.status === 404) return false; throw e; }
};
widgetRegistry.register({
  code: 'ai.forecast_anomalies', available: widgetOk,
  provider({ db, actor, filters }) {
    const svc = forecastOf(db);
    const open = hasPermissionAnywhere(actor, 'ai.anomaly.view') ? svc.anomalies.list(actor, { projectId: filters.projectId ?? null, pageSize: 1 }).total : 0;
    const f = svc.latest(actor, { projectId: filters.projectId ?? null, limit: 5 });
    return { label: 'Anomalies to review', value: open, unit: 'flags', subtitle: f.length ? `${f.length} official forecasts · ${f[0].useCaseLabel}: ${f[0].subject}` : 'No official forecast yet', status: open ? 'amber' : 'green', drill: '/ai/forecasts?tab=anomalies' };
  },
});
registerProject360Widget('ai.forecast_anomalies', ({ db, actor, project }) => {
  if (!widgetOk(db, actor)) return null;
  const svc = forecastOf(db); const pid = project.project_id;
  const done = svc.latest(actor, { projectId: pid, limit: 10 }).find((f) => f.useCase === 'COMPLETION');
  const open = hasPermissionAnywhere(actor, 'ai.anomaly.view') ? svc.anomalies.list(actor, { projectId: pid, pageSize: 1 }).total : 0;
  return { figures: [{ key: 'anomalies', label: 'Anomalies to review', value: open, drill: `/ai/forecasts?tab=anomalies&projectId=${pid}` },
    { key: 'completion', label: 'Forecast completion', value: done?.completion?.date ?? '—', drill: `/ai/forecasts?useCase=COMPLETION&projectId=${pid}` }], note: `${FORECAST_LABEL} (28.03)` };
});
