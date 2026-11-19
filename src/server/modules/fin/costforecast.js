import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { toPdf } from '../../platform/export/index.js';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso } from '../proc/base.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Part 23.11: the cost forecast of a project for a month.
//  FR-01 versions per project and month; lines by WBS and cost code from the facts of the project control engine (14.07): budget, committed (open), actual,
//  earned; the accrued cost is entered on the line.
//  FR-02 the estimate to complete by a method chosen per line: the remaining budget; CPI ((BAC − EV) ÷ CPI, CPI = EV ÷ (actual + accrued)); bottom-up
//  (remaining quantity × the current rate: the rate paid to date, else the budget rate, or one entered); committed + the uncommitted remaining budget; manual
//  with a justification.
//  FR-03 EAC = actual + accrued + ETC by line; the forecast adds the risk allowance (the EMV of the project's open risks, 10.06) and the cost of pending
//  variations and claims entered with a note; VAC = budget − EAC.
//  FR-04 confidence and commentary; the EAC bridge against the last approved forecast of the project: what changed by line, the risk allowance and the
//  pending variations, adding up to the change of the EAC (T-01).
//  FR-05 approval (PCMGR → PM → PD, the CFO too when the EAC is above the contract revenue) and publication: `fin.eac_version.approved` (23.10, 23.12, 23.13).
//  BR-01 one approved forecast a project and month; approved forecasts are not changed (a correction is a new version that supersedes).

export const FORECAST_DOC = 'FIN_COST_FORECAST';
export const METHODS = { REMAINING_BUDGET: 'Remaining budget', CPI: 'CPI-based ((BAC − EV) ÷ CPI)', BOTTOM_UP: 'Bottom-up (remaining quantity × current rate)', COMMITTED_PLUS: 'Committed + uncommitted remaining', MANUAL: 'Manual with justification' };
export const CONFIDENCE = { HIGH: 'High', MEDIUM: 'Medium', LOW: 'Low' };
const rs = (p) => (p == null ? null : p / 100);
const paise = (v) => Math.round(Number(v) * 100);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const monthEnd = (p) => { const [y, m] = p.split('-').map(Number); return `${p}-${String(lastDay(y, m)).padStart(2, '0')}`; };

/**
 * The estimate to complete of one line, in paise (FR-02). `l`: { method, budget, actual, accrued, committed, earned, budgetQty, actualQty (×1000),
 * remainingQty (×1000, or null: the budget quantity not yet used), rate (paise per unit, or null: the rate paid to date, else the budget rate), manual }.
 * Returns { etc, note } — the note says how it was worked out (and a fallback when the method cannot apply).
 */
export function etcOf(l) {
  const spent = l.actual + l.accrued; const remaining = Math.max(0, l.budget - spent);
  if (l.method === 'CPI') {
    if (!(l.earned > 0) || !(spent > 0)) return { etc: remaining, note: 'No earned value or cost yet: the remaining budget is used.' };
    const cpi = l.earned / spent; return { etc: Math.max(0, Math.round((l.budget - l.earned) / cpi)), note: `CPI ${cpi.toFixed(3)} = earned ${rs(l.earned)} ÷ cost ${rs(spent)}; (BAC − EV) ÷ CPI.` };
  }
  if (l.method === 'BOTTOM_UP') {
    const qty = l.remainingQty ?? Math.max(0, l.budgetQty - l.actualQty); const rate = l.rate ?? (l.actualQty > 0 ? Math.round((l.actual * 1000) / l.actualQty) : l.budgetQty > 0 ? Math.round((l.budget * 1000) / l.budgetQty) : 0);
    return { etc: Math.round((qty * rate) / 1000), note: `${qty / 1000} remaining × ₹${rs(rate)} (${l.rate != null ? 'rate entered' : l.actualQty > 0 ? 'rate paid to date' : 'budget rate'}).` };
  }
  if (l.method === 'COMMITTED_PLUS') return { etc: l.committed + Math.max(0, l.budget - spent - l.committed), note: `Committed ${rs(l.committed)} + uncommitted remaining ${rs(Math.max(0, l.budget - spent - l.committed))}.` };
  if (l.method === 'MANUAL') return { etc: Math.max(0, l.manual ?? 0), note: 'Entered with a justification.' };
  return { etc: remaining, note: 'Budget less cost and accruals to date.' };
}
/** The EAC bridge from the last approved forecast (FR-04): the change by line, the risk allowance and the pending variations; the items add up to the change. */
export function bridgeOf(prev, cur) {
  const pl = new Map((prev?.lines ?? []).map((l) => [l.key, l])); const items = [];
  for (const l of cur.lines) { const p = pl.get(l.key); const d = l.eac - (p?.eac ?? 0); pl.delete(l.key); if (d) items.push({ kind: 'LINE', key: l.key, label: l.label, change: d, why: [p && l.actual !== p.actual ? `actual ${rs(p.actual)} → ${rs(l.actual)}` : null, p && l.method !== p.method ? `method ${p.method} → ${l.method}` : null, p && l.etc !== p.etc ? `ETC ${rs(p.etc)} → ${rs(l.etc)}` : null, !p ? 'new line' : null, l.notes || null].filter(Boolean).join('; ') }); }
  for (const p of pl.values()) if (p.eac) items.push({ kind: 'LINE', key: p.key, label: p.label, change: -p.eac, why: 'line no longer in the forecast' });
  const r = cur.risk - (prev?.risk ?? 0); if (r) items.push({ kind: 'RISK', label: 'Risk allowance (EMV of open risks)', change: r, why: '' });
  const v = cur.pendingVar - (prev?.pendingVar ?? 0); if (v) items.push({ kind: 'VARIATION', label: 'Pending variations and claims', change: v, why: cur.pendingVarNote ?? '' });
  return { from: prev?.eacTotal ?? 0, to: cur.eacTotal, items: items.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)) };
}

export const forecastList = defineList({
  code: 'fin.cost_forecasts', label: 'Cost forecasts', permission: 'fin.forecast.view',
  from: 'fc_forecasts x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'p.code', 'p.name'], defaultSort: '-period',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Forecast' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, projectId: { sql: 'x.org_project_id', type: 'number', label: 'Project id' }, period: { sql: 'x.period', type: 'text', label: 'Month' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' },
    budget: { sql: '(x.budget_paise / 100.0)', type: 'money', label: 'Budget', total: true }, eac: { sql: '(x.eac_total_paise / 100.0)', type: 'money', label: 'EAC', total: true }, vac: { sql: '(x.vac_total_paise / 100.0)', type: 'money', label: 'VAC', total: true },
    confidence: { sql: 'x.confidence', type: 'enum', label: 'Confidence', options: Object.entries(CONFIDENCE) }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(STATUS) },
  },
});

/** @param {{ db: any, base: any, flags: any, projectAccounts?: () => any }} o */
export function createCostForecastService({ db, base, flags, projectAccounts = () => null }) {
  const { may, audit, notify, authz } = base;
  const need = (actor, key, what, pid = null) => { if (!may(actor, key, pid)) throw forbidden(`You may not ${what} (permission ${key}).`); };
  const on = (companyId) => flags.isOn({ companyId, user: 'system', roles: [] }, 'ff.fin.p2311');
  const evt = (type, actor, companyId, entity, entityId, data, projectId = undefined) => publishEvent(db, { type, entity, entityId, actorId: actor?.user ?? 'system', companyId, projectId, data });
  const projOf = (id) => db.prepare('SELECT id, company_id, code, name FROM org_projects WHERE id = ? AND deleted_at IS NULL').get(Number(id)) ?? null;
  const has = (t) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t));
  const rolesOf = (companyId, user) => { try { return JSON.parse(db.prepare('SELECT roles_json FROM iam_users WHERE company_id = ? AND username = ?').get(companyId, user)?.roles_json ?? '[]').flat(); } catch { return []; } };
  const periodId = (companyId, date) => db.prepare('SELECT id FROM core_periods WHERE company_id = ? AND start_date <= ? AND end_date >= ? AND deleted_at IS NULL ORDER BY id LIMIT 1').get(companyId, date, date)?.id ?? null;
  const scope = (actor, key) => { need(actor, key, 'see cost forecasts'); const f = authz.scopeFilter(actor, key, { project: 'x.org_project_id' }); return `x.company_id = :c AND ${f.sql}`; };
  const keyOf = (w, c) => `${w ?? 0}:${c ?? 0}`;
  const contractRevenue = (projectId) => (has('ctr_contracts') ? db.prepare("SELECT COALESCE(SUM(CASE WHEN revised_paise > 0 THEN revised_paise ELSE original_paise + amended_paise + variation_paise END), 0) AS v FROM ctr_contracts WHERE org_project_id = ? AND status = 'APPROVED' AND contract_state IN ('ACTIVE', 'COMPLETED', 'CLOSED') AND deleted_at IS NULL").get(projectId).v : 0);
  const riskAllowance = (projectId) => (has('proj_risks') ? db.prepare("SELECT COALESCE(SUM(emv), 0) AS v FROM proj_risks WHERE org_project_id = ? AND rtype = 'RISK' AND status IN ('OPEN', 'CLOSE_REQUESTED') AND deleted_at IS NULL").get(projectId).v : 0);
  /** The facts of the project by WBS and cost code (14.07): budget at the project, commitments open, actuals by month, earned — summed over the months. */
  function facts(projectId) {
    if (!has('ctl_facts')) return [];
    return db.prepare(`SELECT f.wbs_id, f.cost_code_id, w.code AS wcode, w.name AS wname, c.code AS ccode, c.name AS cname, SUM(f.budget_cost) AS budget, SUM(f.budget_qty) AS bqty, SUM(f.committed_cost) AS committed, SUM(f.actual_cost) AS actual, SUM(f.actual_qty) AS aqty, SUM(f.earned_cost) AS earned
      FROM ctl_facts f LEFT JOIN proj_wbs w ON w.id = f.wbs_id LEFT JOIN fin_cost_codes c ON c.id = f.cost_code_id WHERE f.org_project_id = ? AND f.deleted_at IS NULL GROUP BY f.wbs_id, f.cost_code_id ORDER BY w.code, c.code`).all(projectId)
      .map((r) => ({ wbsId: r.wbs_id, costCodeId: r.cost_code_id, label: [r.wcode ? `${r.wcode} ${r.wname}` : 'No WBS', r.ccode ? `${r.ccode} ${r.cname}` : 'No cost code'].join(' · '), budget: r.budget ?? 0, budgetQty: r.bqty ?? 0, committed: r.committed ?? 0, actual: r.actual ?? 0, actualQty: r.aqty ?? 0, earned: r.earned ?? 0 }));
  }
  const lastApproved = (projectId, before, exceptId = 0) => db.prepare("SELECT * FROM fc_forecasts WHERE org_project_id = ? AND period <= ? AND status = 'APPROVED' AND id <> ? AND deleted_at IS NULL ORDER BY period DESC, version_no DESC LIMIT 1").get(projectId, before, exceptId) ?? null;
  const linesOf = (id) => db.prepare('SELECT * FROM fc_forecast_lines WHERE forecast_id = ? AND deleted_at IS NULL ORDER BY id').all(id);
  const shapeOf = (f) => (f ? { eacTotal: f.eac_total_paise, risk: f.risk_allowance_paise, pendingVar: f.pending_var_cost_paise, pendingVarNote: f.pending_var_note, lines: linesOf(f.id).map((l) => ({ key: keyOf(l.wbs_id, l.cost_code_id), label: l.line_label, eac: l.eac_paise, etc: l.etc_paise, actual: l.actual_paise, method: l.etc_method, notes: l.notes })) } : null);

  /** FR-02, FR-03: the lines worked out (from the facts, with the choices of the existing lines kept) and the totals; the bridge against the last approved. */
  function recompute(f) {
    const old = new Map(linesOf(f.id).map((l) => [keyOf(l.wbs_id, l.cost_code_id), l])); const fx = facts(f.org_project_id); const seen = new Set();
    const rows = fx.map((x) => { const o = old.get(keyOf(x.wbsId, x.costCodeId)); seen.add(keyOf(x.wbsId, x.costCodeId)); return { ...x, accrued: o?.accrued_paise ?? 0, method: o?.etc_method ?? 'REMAINING_BUDGET', remainingQty: o?.remaining_qty_milli ?? null, rate: o?.rate_x100 ?? null, manual: o?.manual_paise ?? null, notes: o?.notes ?? null, id: o?.id ?? null }; });
    for (const [k, o] of old) if (!seen.has(k)) rows.push({ wbsId: o.wbs_id, costCodeId: o.cost_code_id, label: o.line_label, budget: 0, budgetQty: 0, committed: 0, actual: 0, actualQty: 0, earned: 0, accrued: o.accrued_paise, method: o.etc_method, remainingQty: o.remaining_qty_milli, rate: o.rate_x100, manual: o.manual_paise, notes: o.notes, id: o.id });
    const ins = db.prepare('INSERT INTO fc_forecast_lines (company_id, forecast_id, wbs_id, cost_code_id, line_label, budget_paise, budget_qty_milli, committed_paise, actual_paise, actual_qty_milli, earned_paise, accrued_paise, etc_method, remaining_qty_milli, rate_x100, manual_paise, etc_paise, eac_paise, vac_paise, method_note, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, \'ctl_facts\')');
    const upd = db.prepare('UPDATE fc_forecast_lines SET line_label = ?, budget_paise = ?, budget_qty_milli = ?, committed_paise = ?, actual_paise = ?, actual_qty_milli = ?, earned_paise = ?, etc_paise = ?, eac_paise = ?, vac_paise = ?, method_note = ?, updated_at = ?, version = version + 1 WHERE id = ?');
    const t = { budget: 0, committed: 0, actual: 0, accrued: 0, etc: 0, eac: 0 };
    for (const r of rows) { const e = etcOf(r); const eac = r.actual + r.accrued + e.etc; const vac = r.budget - eac; for (const [k, v] of [['budget', r.budget], ['committed', r.committed], ['actual', r.actual], ['accrued', r.accrued], ['etc', e.etc], ['eac', eac]]) t[k] += v;
      if (r.id) upd.run(r.label, r.budget, r.budgetQty, r.committed, r.actual, r.actualQty, r.earned, e.etc, eac, vac, e.note, nowIso(), r.id); else ins.run(f.company_id, f.id, r.wbsId, r.costCodeId, r.label, r.budget, r.budgetQty, r.committed, r.actual, r.actualQty, r.earned, r.accrued, r.method, r.remainingQty, r.rate, r.manual, e.etc, eac, vac, e.note, r.notes, 'system'); }
    const risk = riskAllowance(f.org_project_id); const total = t.eac + risk + f.pending_var_cost_paise; const rev = contractRevenue(f.org_project_id);
    const prev = f.amends_id ? db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(f.amends_id) : lastApproved(f.org_project_id, f.period, f.id);
    const cur = { ...shapeOf({ ...f, id: f.id, eac_total_paise: total, risk_allowance_paise: risk }), eacTotal: total, risk, pendingVar: f.pending_var_cost_paise, pendingVarNote: f.pending_var_note };
    const bridge = bridgeOf(shapeOf(prev), cur);
    db.prepare('UPDATE fc_forecasts SET budget_paise = ?, committed_paise = ?, actual_paise = ?, accrued_paise = ?, etc_paise = ?, lines_eac_paise = ?, risk_allowance_paise = ?, eac_total_paise = ?, vac_total_paise = ?, contract_revenue_paise = ?, loss_making = ?, prev_forecast_id = ?, bridge_json = ? WHERE id = ?')
      .run(t.budget, t.committed, t.actual, t.accrued, t.etc, t.eac, risk, total, t.budget - total, rev, rev > 0 && total > rev ? 1 : 0, prev?.id ?? null, JSON.stringify(bridge), f.id);
    return db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(f.id);
  }

  const flow = createFlow({ db, base, docType: FORECAST_DOC, table: 'fc_forecasts', perm: 'fin.forecast', label: 'cost forecast', route: '/finance/cost-forecasts?id=', where: (r) => ({ pid: r.org_project_id, sid: null }),
    ctx: (r) => { const roles = rolesOf(r.company_id, r.requested_by); return { total: rs(r.eac_total_paise), period: r.period, loss: r.loss_making ? 'yes' : 'no', makerRole: roles.includes('PCMGR') ? 'PCMGR' : roles.includes('PM') ? 'PM' : 'OTHER' }; },
    title: (r) => `Cost forecast of ${projOf(r.org_project_id)?.code ?? ''} for ${r.period} (v${r.version_no}): EAC ₹${rs(r.eac_total_paise)}`, notifyCode: 'fin.forecast.decided', prefix: 'FC',
    beforeSubmit: (_a, r) => { if (!on(r.company_id)) throw unprocessable('Cost forecasting is off for the company (ff.fin.p2311).'); const x = recompute(r); const bad = linesOf(x.id).filter((l) => l.etc_method === 'MANUAL' && !(l.notes ?? '').trim()); if (bad.length) throw badRequest('Correct the highlighted fields', bad.map((l) => ({ field: `lines.${l.id}.notes`, message: `${l.line_label}: a manual estimate needs its justification.` }))); if (x.confidence === 'LOW' && !(x.commentary ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'commentary', message: 'Say why the confidence is low.' }]); },
    onApproved: (actor, r) => {
      const x = db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(r.id);
      db.prepare("UPDATE fc_forecasts SET status = 'SUPERSEDED', updated_at = ? WHERE org_project_id = ? AND period = ? AND status = 'APPROVED' AND id <> ?").run(nowIso(), x.org_project_id, x.period, x.id);
      db.prepare('UPDATE fc_forecasts SET period_id = ? WHERE id = ?').run(periodId(x.company_id, monthEnd(x.period)), x.id);
      evt('fin.eac_version.approved', actor, x.company_id, 'fc_forecasts', x.id, { forecastId: x.id, docNo: x.doc_no, projectId: x.org_project_id, period: x.period, version: x.version_no, budget: rs(x.budget_paise), actual: rs(x.actual_paise), etc: rs(x.etc_paise), eac: rs(x.eac_total_paise), vac: rs(x.vac_total_paise), riskAllowance: rs(x.risk_allowance_paise), lossMaking: Boolean(x.loss_making), confidence: x.confidence }, x.org_project_id);
    },
  });
  const lineView = (l) => ({ id: l.id, wbsId: l.wbs_id, costCodeId: l.cost_code_id, label: l.line_label, budget: rs(l.budget_paise), budgetQty: l.budget_qty_milli / 1000, committed: rs(l.committed_paise), actual: rs(l.actual_paise), actualQty: l.actual_qty_milli / 1000, earned: rs(l.earned_paise), accrued: rs(l.accrued_paise), method: l.etc_method, methodLabel: METHODS[l.etc_method], remainingQty: l.remaining_qty_milli != null ? l.remaining_qty_milli / 1000 : null, rate: l.rate_x100 != null ? rs(l.rate_x100) : null, manual: l.manual_paise != null ? rs(l.manual_paise) : null, etc: rs(l.etc_paise), eac: rs(l.eac_paise), vac: rs(l.vac_paise), methodNote: l.method_note, notes: l.notes, version: l.version });
  const view = (actor, r, detail = false) => {
    const p = projOf(r.org_project_id); let bridge; try { bridge = JSON.parse(r.bridge_json); } catch { bridge = { items: [] }; }
    const o = { id: r.id, docNo: r.doc_no, projectId: r.org_project_id, project: p ? `${p.code} ${p.name}` : null, period: r.period, versionNo: r.version_no, budget: rs(r.budget_paise), committed: rs(r.committed_paise), actual: rs(r.actual_paise), accrued: rs(r.accrued_paise), etc: rs(r.etc_paise), linesEac: rs(r.lines_eac_paise), riskAllowance: rs(r.risk_allowance_paise), pendingVarCost: rs(r.pending_var_cost_paise), pendingVarNote: r.pending_var_note, eac: rs(r.eac_total_paise), vac: rs(r.vac_total_paise), contractRevenue: rs(r.contract_revenue_paise), lossMaking: Boolean(r.loss_making), confidence: r.confidence, confidenceLabel: CONFIDENCE[r.confidence], commentary: r.commentary, amendsId: r.amends_id, status: r.status, statusLabel: STATUS[r.status], requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, version: r.version,
      can: { ...flow.can(actor, r), recompute: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'fin.forecast.edit', r.org_project_id), amend: r.status === 'APPROVED' && may(actor, 'fin.forecast.amend', r.org_project_id) } };
    if (detail) { Object.assign(o.can, flow.approveInfo(actor, r)); o.lines = linesOf(r.id).map(lineView); o.bridge = { from: rs(bridge.from ?? 0), to: rs(bridge.to ?? 0), items: (bridge.items ?? []).map((b) => ({ ...b, change: rs(b.change) })) }; o.history = flow.history(actor, r.id); }
    return o;
  };
  const projectOk = (actor, projectId, key, what) => { const p = projOf(projectId); if (!p || p.company_id !== actor.companyId) throw notFound('That project does not exist.'); need(actor, key, what, p.id); return p; };
  const editable = (actor, id) => { const r = flow.row(actor, id, 'fin.forecast.edit'); if (!['DRAFT', 'RETURNED'].includes(r.status)) throw conflict('Only a draft or a returned forecast is changed (BR-01).'); return r; };

  const forecasts = {
    flow,
    list(actor, query) { return runList(db, forecastList, parseListRequest(forecastList, query), { select: 'x.*', scopeSql: scope(actor, 'fin.forecast.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get(actor, id) { return view(actor, flow.row(actor, id), true); },
    /** FR-01: a new version of the month from the facts; the methods and accruals of the last approved forecast are carried over. */
    create(actor, { projectId, period }) {
      const p = projectOk(actor, projectId, 'fin.forecast.create', 'prepare cost forecasts'); if (period > todayIST().slice(0, 7)) throw badRequest('Correct the highlighted fields', [{ field: 'period', message: 'A forecast is made for a month that has begun.' }]);
      if (!facts(p.id).length) throw unprocessable('The project has no budget, commitment or cost in the project control engine (14.07): nothing to forecast yet.');
      const prev = lastApproved(p.id, period); const version = (db.prepare('SELECT MAX(version_no) AS v FROM fc_forecasts WHERE org_project_id = ? AND period = ? AND deleted_at IS NULL').get(p.id, period).v ?? 0) + 1;
      return transaction(db, () => { let id; try { id = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, pending_var_cost_paise, pending_var_note, confidence, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(actor.companyId, flow.next(actor), p.id, period, version, prev?.pending_var_cost_paise ?? 0, prev?.pending_var_note ?? null, prev?.confidence ?? 'MEDIUM', actor.user, actor.user).lastInsertRowid); } catch (x) { if (/UNIQUE/.test(String(x.message))) throw conflict('A forecast of this project and month is already open.'); throw x; }
        if (prev) { const ins = db.prepare("INSERT INTO fc_forecast_lines (company_id, forecast_id, wbs_id, cost_code_id, line_label, accrued_paise, etc_method, remaining_qty_milli, rate_x100, manual_paise, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fc_forecasts')"); for (const l of linesOf(prev.id)) ins.run(actor.companyId, id, l.wbs_id, l.cost_code_id, l.line_label, l.accrued_paise, l.etc_method, l.remaining_qty_milli, l.rate_x100, l.manual_paise, l.notes, actor.user); }
        const x = recompute(db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(id)); audit(actor, 'fc_forecasts', id, 'create', actor.companyId, { newValues: { project: p.code, period, version, eac: rs(x.eac_total_paise) } }); return forecasts.get(actor, id); });
    },
    /** The header: pending variations and their note, confidence, commentary; worked out again. */
    update(actor, id, b) {
      const r = editable(actor, id); if (b.version != null && b.version !== r.version) throw conflict('Someone changed this forecast meanwhile: reload it.');
      if (b.pendingVarCost != null && paise(b.pendingVarCost) > 0 && !((b.pendingVarNote ?? r.pending_var_note) ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'pendingVarNote', message: 'Say which variations or claims are counted.' }]);
      db.prepare('UPDATE fc_forecasts SET pending_var_cost_paise = ?, pending_var_note = ?, confidence = ?, commentary = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.pendingVarCost != null ? paise(b.pendingVarCost) : r.pending_var_cost_paise, 'pendingVarNote' in b ? b.pendingVarNote : r.pending_var_note, b.confidence ?? r.confidence, 'commentary' in b ? b.commentary : r.commentary, actor.user, nowIso(), r.id);
      const x = recompute(db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(r.id)); audit(actor, 'fc_forecasts', r.id, 'update', r.company_id, { oldValues: { eac: rs(r.eac_total_paise), confidence: r.confidence }, newValues: { eac: rs(x.eac_total_paise), confidence: x.confidence } }); return forecasts.get(actor, r.id);
    },
    /** FR-02: a line's method and its inputs (accrued, remaining quantity, rate, manual amount, justification). */
    updateLine(actor, id, lineId, b) {
      const r = editable(actor, id); const l = db.prepare('SELECT * FROM fc_forecast_lines WHERE id = ? AND forecast_id = ? AND deleted_at IS NULL').get(Number(lineId), r.id); if (!l) throw notFound('That line is not in the forecast.');
      const method = b.method ?? l.etc_method; const notes = 'notes' in b ? b.notes : l.notes;
      if (method === 'MANUAL' && (b.manual ?? (l.manual_paise != null ? rs(l.manual_paise) : null)) == null) throw badRequest('Correct the highlighted fields', [{ field: 'manual', message: 'Give the estimate to complete.' }]);
      if (method === 'MANUAL' && !(notes ?? '').trim()) throw badRequest('Correct the highlighted fields', [{ field: 'notes', message: 'A manual estimate needs its justification.' }]);
      db.prepare('UPDATE fc_forecast_lines SET etc_method = ?, accrued_paise = ?, remaining_qty_milli = ?, rate_x100 = ?, manual_paise = ?, notes = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(method, b.accrued != null ? paise(b.accrued) : l.accrued_paise, 'remainingQty' in b ? (b.remainingQty == null ? null : Math.round(b.remainingQty * 1000)) : l.remaining_qty_milli, 'rate' in b ? (b.rate == null ? null : paise(b.rate)) : l.rate_x100, 'manual' in b ? (b.manual == null ? null : paise(b.manual)) : l.manual_paise, notes ?? null, actor.user, nowIso(), l.id);
      recompute(r); audit(actor, 'fc_forecast_lines', l.id, 'update', r.company_id, { oldValues: { method: l.etc_method, etc: rs(l.etc_paise) }, newValues: { method } }); return forecasts.get(actor, r.id);
    },
    refresh(actor, id) { const r = editable(actor, id); recompute(r); audit(actor, 'fc_forecasts', r.id, 'refresh', r.company_id); return forecasts.get(actor, r.id); },
    remove: (actor, id) => flow.remove(actor, id),
    submit(actor, id) { flow.submit(actor, id); return forecasts.get(actor, id); },
    withdraw(actor, id, b) { flow.withdraw(actor, id, b); return forecasts.get(actor, id); },
    cancel(actor, id, b) { flow.cancel(actor, id, b); return forecasts.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** BR-01: an approved forecast is not changed; a new version of the month starts from it and supersedes it when approved. */
    amend(actor, id, { reason }) {
      const r = flow.row(actor, id, 'fin.forecast.amend'); if (r.status !== 'APPROVED') throw conflict('Only an approved forecast is amended.'); if (db.prepare("SELECT 1 FROM fc_forecasts WHERE org_project_id = ? AND period = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.org_project_id, r.period)) throw conflict('A new version of this month is already open.');
      const version = (db.prepare('SELECT MAX(version_no) AS v FROM fc_forecasts WHERE org_project_id = ? AND period = ?').get(r.org_project_id, r.period).v ?? 0) + 1;
      return transaction(db, () => { const nid = Number(db.prepare("INSERT INTO fc_forecasts (company_id, doc_no, org_project_id, period, version_no, pending_var_cost_paise, pending_var_note, confidence, commentary, amends_id, requested_by, created_by, source_type, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fc_forecasts', ?)").run(r.company_id, `${r.doc_no}-V${version}`, r.org_project_id, r.period, version, r.pending_var_cost_paise, r.pending_var_note, r.confidence, r.commentary, r.id, actor.user, actor.user, reason).lastInsertRowid);
        const ins = db.prepare("INSERT INTO fc_forecast_lines (company_id, forecast_id, wbs_id, cost_code_id, line_label, accrued_paise, etc_method, remaining_qty_milli, rate_x100, manual_paise, notes, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'fc_forecasts')"); for (const l of linesOf(r.id)) ins.run(r.company_id, nid, l.wbs_id, l.cost_code_id, l.line_label, l.accrued_paise, l.etc_method, l.remaining_qty_milli, l.rate_x100, l.manual_paise, l.notes, actor.user);
        recompute(db.prepare('SELECT * FROM fc_forecasts WHERE id = ?').get(nid)); audit(actor, 'fc_forecasts', nid, 'amend', r.company_id, { reason: `amends ${r.doc_no}: ${reason}` }); return forecasts.get(actor, nid); });
    },
    print(actor, id) {
      const r = flow.row(actor, id, 'fin.forecast.print'); const v = view(actor, r, true); audit(actor, 'fc_forecasts', r.id, 'print', r.company_id); const m = (x) => (x ?? 0).toFixed(2);
      return { contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, buffer: toPdf({ title: `Cost forecast ${r.doc_no} · ${v.project} · ${v.period} v${v.versionNo}`, columns: [{ key: 'l', label: 'Line', type: 'text' }, { key: 'b', label: 'Budget' }, { key: 'a', label: 'Actual' }, { key: 'm', label: 'Method', type: 'text' }, { key: 'e', label: 'ETC' }, { key: 'c', label: 'EAC' }, { key: 'v', label: 'VAC' }], rows: v.lines.map((l) => ({ l: l.label, b: m(l.budget), a: m(l.actual + l.accrued), m: l.methodLabel, e: m(l.etc), c: m(l.eac), v: m(l.vac) })), footer: [`Budget ${m(v.budget)}; lines EAC ${m(v.linesEac)} + risk allowance ${m(v.riskAllowance)} + pending variations ${m(v.pendingVarCost)} = EAC ${m(v.eac)}; VAC ${m(v.vac)}. Confidence ${v.confidenceLabel}. ${v.commentary ?? ''}`] }) };
    },
    exportCsv(actor, query = {}) { need(actor, 'fin.forecast.export', 'export cost forecasts'); const l = forecasts.list(actor, { ...query, page: 1, pageSize: 100 }); audit(actor, 'fc_forecasts', 0, 'export', actor.companyId, { reason: `${l.data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `cost-forecasts-${todayIST()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(['Forecast', 'Project', 'Month', 'Version', 'Budget', 'Actual', 'ETC', 'Risk allowance', 'EAC', 'VAC', 'Confidence', 'Status'], l.data.map((x) => [x.docNo, x.project, x.period, x.versionNo, x.budget, x.actual, x.etc, x.riskAllowance, x.eac, x.vac, x.confidenceLabel, x.statusLabel]))}`, 'utf8') }; },
    /** Line methods from rows { wbs?, costCode?, method, accrued?, remainingQty?, rate?, manual?, notes? } (matched by codes); each row stands alone. */
    importLines(actor, id, { rows }) {
      const r = editable(actor, id); const out = []; const all = linesOf(r.id);
      for (const [i, x] of rows.entries()) { try { const l = all.find((y) => y.line_label.includes(String(x.costCode ?? '')) && (!x.wbs || y.line_label.startsWith(String(x.wbs)))); if (!l) throw notFound('No such line in the forecast.'); forecasts.updateLine(actor, r.id, l.id, x); out.push({ row: i + 1, ok: true }); } catch (e) { out.push({ row: i + 1, ok: false, error: e.message }); } }
      return { updated: out.filter((x) => x.ok).length, rows: out };
    },
  };

  // ---- reports ----
  const reports = {
    /** The EAC of a project month by month (approved versions in force), against its budget and the contract revenue. */
    trend(actor, { projectId }) {
      const p = projectOk(actor, projectId, 'fin.forecast.view', 'see cost forecasts');
      const rows = db.prepare("SELECT * FROM fc_forecasts WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period").all(p.id);
      return { projectId: p.id, project: `${p.code} ${p.name}`, contractRevenue: rs(contractRevenue(p.id)), rows: rows.map((r) => ({ id: r.id, docNo: r.doc_no, period: r.period, versionNo: r.version_no, budget: rs(r.budget_paise), actual: rs(r.actual_paise), eac: rs(r.eac_total_paise), vac: rs(r.vac_total_paise), confidence: r.confidence, lossMaking: Boolean(r.loss_making) })) };
    },
    /** Forecast against budget for every project: the latest approved forecast to a month, its variance at completion; worst first. */
    variance(actor, { period }) {
      need(actor, 'fin.forecast.view', 'see cost forecasts');
      const rows = db.prepare("SELECT x.*, p.code, p.name FROM fc_forecasts x JOIN org_projects p ON p.id = x.org_project_id WHERE x.company_id = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL AND x.period = (SELECT MAX(y.period) FROM fc_forecasts y WHERE y.org_project_id = x.org_project_id AND y.status = 'APPROVED' AND y.deleted_at IS NULL AND y.period <= ?) ORDER BY x.vac_total_paise").all(actor.companyId, period).filter((r) => may(actor, 'fin.forecast.view', r.org_project_id));
      const t = (k) => rs(rows.reduce((a, r) => a + r[k], 0));
      return { period, rows: rows.map((r) => ({ id: r.id, projectId: r.org_project_id, project: `${r.code} ${r.name}`, period: r.period, budget: rs(r.budget_paise), eac: rs(r.eac_total_paise), vac: rs(r.vac_total_paise), vacPct: r.budget_paise ? Math.round((r.vac_total_paise * 10000) / r.budget_paise) / 100 : null, confidence: r.confidence, lossMaking: Boolean(r.loss_making) })), totals: { budget: t('budget_paise'), eac: t('eac_total_paise'), vac: t('vac_total_paise') } };
    },
    /** The projects that can be forecast for a month and the state of each. */
    candidates(actor, { period }) {
      need(actor, 'fin.forecast.view', 'see cost forecasts');
      const rows = has('ctl_facts') ? db.prepare('SELECT DISTINCT p.id, p.code, p.name FROM org_projects p JOIN ctl_facts f ON f.org_project_id = p.id AND f.deleted_at IS NULL WHERE p.company_id = ? AND p.deleted_at IS NULL ORDER BY p.code LIMIT 500').all(actor.companyId) : [];
      return rows.filter((p) => may(actor, 'fin.forecast.view', p.id)).map((p) => { const r = db.prepare("SELECT id, doc_no, status, version_no FROM fc_forecasts WHERE org_project_id = ? AND period = ? AND status NOT IN ('CANCELLED', 'REJECTED', 'SUPERSEDED') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1").get(p.id, period); return { projectId: p.id, project: `${p.code} ${p.name}`, forecastId: r?.id ?? null, docNo: r?.doc_no ?? null, status: r?.status ?? null, versionNo: r?.version_no ?? null }; });
    },
  };
  /** What 23.10 and 23.12 read: the EAC of the approved forecast of the month or the latest before it (paise). */
  const approvedEac = (companyId, projectId, period) => { const r = db.prepare("SELECT doc_no, version_no, eac_total_paise FROM fc_forecasts WHERE company_id = ? AND org_project_id = ? AND period <= ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY period DESC, version_no DESC LIMIT 1").get(companyId, projectId, period); return r ? { eac: r.eac_total_paise, docNo: `${r.doc_no} v${r.version_no}` } : null; };
  const jobs = {
    /** From the 10th: projects with facts and no approved forecast of last month are told to who prepares them. */
    remind() { let n = 0; const today = todayIST(); if (Number(today.slice(8, 10)) < 10 || !has('ctl_facts')) return { reminded: 0 }; const [y, m] = today.slice(0, 7).split('-').map(Number); const last = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, '0')}`;
      for (const c of db.prepare('SELECT id FROM org_companies').all()) { if (!on(c.id)) continue; const k = db.prepare("SELECT COUNT(DISTINCT f.org_project_id) AS n FROM ctl_facts f WHERE f.company_id = ? AND f.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM fc_forecasts x WHERE x.org_project_id = f.org_project_id AND x.period = ? AND x.status = 'APPROVED' AND x.deleted_at IS NULL)").get(c.id, last).n; if (!k) continue; n += 1; notify(c.id, 'fin.forecast.alert', ['permission:fin.forecast.create'], last, 'forecast due', `${k} project(s) have no approved cost forecast for ${last}.`, '/finance/cost-forecasts', `${c.id}-${last}`); }
      return { reminded: n }; },
  };
  void projectAccounts;
  return { forecasts, reports, approvedEac, jobs };
}
