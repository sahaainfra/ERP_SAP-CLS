import { transaction } from '../../platform/db/index.js';
import { conflict, unprocessable } from '../../platform/http/errors.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { nowIso, rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { isEnabled } from '../core/feature-flags/service.js';
import { amountOf } from './clientbill.js';

// Quantity reconciliation (part 22.02): the chain of quantities of every BOQ item and location: contract, revised (approved variations), executed (approved daily reports), measured (measurement book), certified, billed, paid, balance and the forecast at completion.
// Every figure is read from the module that owns it (BR-01); the forecast is the only quantity typed here. Quantities are x1000.
for (const [key, type, def, description, min, max] of [
  ['bill.qty.alert_pct', 'integer', 90, 'The percentage of the BOQ quantity (with approved variations) at which an item is reported as approaching its limit (part 22.02 FR-04).', 1, 100],
  ['bill.deviation.threshold_pct', 'integer', 25, 'The percentage by which the quantity of an item may differ from the contract quantity before a deviation statement is prepared (part 22.02 FR-02).', 0, 100]]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description, min, max });
}
const d3 = (t) => (t == null ? null : t / 1000); const q3 = (x) => Math.round(Number(x) * 1000); const pct1 = (a, b) => (b > 0 ? Math.round((a * 1000) / b) / 10 : null);
export const LEVEL = { OK: 'Within the quantity', APPROACHING: 'Approaching the limit', OVER: 'Beyond the quantity', FORECAST_OVER: 'Forecast beyond the quantity' };
export const CHAIN_COLS = ['contract', 'revised', 'executed', 'measured', 'certified', 'billed', 'paid', 'balance', 'forecast'];

export function createReconService({ db, base }) {
  const { audit, fail, notify, param } = base; const { evt, gate, pcode, projectOk } = qaHelpers({ db, base }); const today = () => todayIST();
  /** The BOQ items of a project, one per item code across the versions: the contract quantity, the revised quantity and the rate. */
  function itemsOf(companyId, pj) {
    const rows = db.prepare("SELECT l.id, l.item_code AS code, l.description, l.uom, l.qty, l.rate, v.vtype, v.status AS vstatus, v.variation_ref AS vref FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE v.company_id = ? AND v.org_project_id = ? AND l.deleted_at IS NULL AND v.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') ORDER BY v.version_no, l.id").all(companyId, pj);
    const vos = new Set(db.prepare("SELECT vo_no FROM ctr_variation_orders WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").all(companyId, pj).map((x) => x.vo_no.toLowerCase())); const m = new Map();
    for (const r of rows) {
      const k = r.code.toLowerCase(); const it = m.get(k) ?? { code: r.code, ids: [], contract: 0, revised: 0 }; m.set(k, it); it.ids.push(r.id); it.lineId = r.id; it.description = r.description; it.uom = r.uom ?? it.uom; it.rate = r.rate;
      if (r.vtype === 'CONTRACT' && r.vstatus === 'APPROVED') it.contract = r.qty;
      if (r.vstatus === 'APPROVED' || (r.vtype === 'REVISED' && r.vref && vos.has(r.vref.toLowerCase()))) it.revised = Math.max(it.revised, r.qty);
    }
    for (const it of m.values()) it.revised = Math.max(it.revised, it.contract);
    return m;
  }
  /** The quantities of the approved daily reports shared among the BOQ items of the activity (by the planned quantities of the activity-BOQ mapping). */
  function executedOf(companyId, pj, items, { date = null, upTo = null } = {}) {
    const lineCode = new Map(); for (const it of items.values()) for (const id of it.ids) lineCode.set(id, it.code.toLowerCase());
    const maps = new Map(); for (const x of db.prepare('SELECT activity_id, boq_line_id, qty FROM plan_activity_boq WHERE company_id = ? AND deleted_at IS NULL').all(companyId)) { const code = lineCode.get(x.boq_line_id); if (!code) continue; const a = maps.get(x.activity_id) ?? new Map(); a.set(code, (a.get(code) ?? 0) + x.qty); maps.set(x.activity_id, a); }
    const works = db.prepare(`SELECT w.id, w.activity_id, w.location_id, w.qty, w.planned_qty, d.id AS dprId, d.doc_no AS dprNo, d.dpr_date AS date, d.dpr_site_id AS siteId FROM site_dpr_work w JOIN site_dprs d ON d.id = w.dpr_id WHERE w.company_id = ? AND d.org_project_id = ? AND d.status = 'APPROVED' AND w.deleted_at IS NULL AND d.deleted_at IS NULL${date ? ' AND d.dpr_date = ?' : ''}${upTo ? ' AND d.dpr_date <= ?' : ''} ORDER BY w.id`).all(companyId, pj, ...(date ? [date] : []), ...(upTo ? [upTo] : [])); const out = [];
    for (const w of works) { const a = maps.get(w.activity_id); if (!a) continue; const entries = [...a.entries()]; const total = entries.reduce((n, [, q]) => n + q, 0); let left = w.qty; let leftPlan = w.planned_qty ?? 0; entries.forEach(([code, q], i) => { const last = i === entries.length - 1; const part = (v) => Math.floor((v * (total > 0 ? q : 1)) / (total > 0 ? total : entries.length)); const share = last ? left : part(w.qty); const plan = last ? leftPlan : part(w.planned_qty ?? 0); left -= share; leftPlan -= plan; out.push({ ...w, code, qty: share, planned_qty: plan }); }); }
    return out;
  }
  /**
   * FR-01: the chain per item (by = item) or per item and location (by = location). Each figure comes from its owner; the deviation is the projected quantity (the forecast, or else the larger of the contract, the measured and the executed quantity) against the contract quantity.
   */
  function rows(companyId, projectId, { by = 'item', locationId = null, code = null, withRate = false } = {}) {
    const pj = rid(projectId); const items = itemsOf(companyId, pj); const alertPct = Number(param(companyId, 'bill.qty.alert_pct') ?? 90); const acc = new Map(); const key = (c, loc) => (by === 'location' ? `${c.toLowerCase()}|${loc ?? 0}` : c.toLowerCase());
    const slot = (c, loc) => { const k = key(c, loc); const a = acc.get(k) ?? { code: c, locationId: by === 'location' ? loc ?? null : null, executed: 0, measured: 0, certified: 0, billed: 0, paid: 0 }; acc.set(k, a); return a; };
    const codeOfLine = new Map(); for (const it of items.values()) for (const id of it.ids) codeOfLine.set(id, it.code);
    for (const e of db.prepare("SELECT boq_line_id, location_id, status, qty_th, certified_qty_th, bill_ref FROM bill_mb_entries WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status IN ('SUBMITTED', 'APPROVED')").all(companyId, pj)) {
      const c = codeOfLine.get(e.boq_line_id); if (!c) continue; const a = slot(c, e.location_id); a.measured += e.status === 'APPROVED' ? e.certified_qty_th ?? e.qty_th : e.qty_th; if (e.status === 'APPROVED') { a.certified += e.certified_qty_th ?? 0; if (e.bill_ref) a.billed += e.certified_qty_th ?? 0; }
    }
    for (const w of executedOf(companyId, pj, items)) slot(items.get(w.code)?.code ?? w.code, w.location_id).executed += w.qty;
    if (by === 'item') for (const it of items.values()) slot(it.code, null);
    const fc = new Map(db.prepare('SELECT item_code, forecast_qty_th, basis, updated_on FROM bill_qty_forecasts WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL').all(companyId, pj).map((x) => [x.item_code.toLowerCase(), x]));
    const locs = new Map(db.prepare('SELECT id, name FROM proj_locations WHERE company_id = ? AND project_id = ?').all(companyId, pj).map((x) => [x.id, x.name]));
    const out = [];
    for (const a of acc.values()) {
      const it = items.get(a.code.toLowerCase()); if (!it) continue; if (code && it.code.toLowerCase() !== String(code).toLowerCase()) continue; if (locationId && a.locationId !== rid(locationId)) continue;
      const f = by === 'item' ? fc.get(it.code.toLowerCase()) : null; const projected = by === 'item' ? (f ? f.forecast_qty_th : Math.max(it.contract, a.measured, a.executed)) : null; const used = Math.max(a.measured, a.executed);
      const usedPct = by === 'item' ? pct1(used, it.revised) : null; const level = by !== 'item' ? null : usedPct != null && usedPct > 100 ? 'OVER' : usedPct != null && usedPct >= alertPct ? 'APPROACHING' : f && f.forecast_qty_th > it.revised ? 'FORECAST_OVER' : 'OK';
      out.push({ code: it.code, boqLineId: it.lineId, description: it.description, uom: it.uom, locationId: a.locationId, location: a.locationId ? locs.get(a.locationId) ?? null : null,
        contract: by === 'item' ? d3(it.contract) : null, revised: by === 'item' ? d3(it.revised) : null, executed: d3(a.executed), measured: d3(a.measured), certified: d3(a.certified), billed: d3(a.billed), paid: d3(a.paid), balance: by === 'item' ? d3(Math.max(0, it.revised - a.certified)) : null,
        forecast: f ? d3(f.forecast_qty_th) : null, forecastBasis: f?.basis ?? null, forecastOn: f?.updated_on ?? null, projected: d3(projected), forecastSource: f ? 'FORECAST' : 'PROJECTED',
        deviationPct: by === 'item' && it.contract > 0 ? pct1(Math.abs(projected - it.contract), it.contract) * Math.sign(projected - it.contract) : null, extra: by === 'item' && it.contract === 0, usedPct, level, ...(withRate ? { rate: it.rate } : {}) });
    }
    return out.sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }) || String(x.location ?? '').localeCompare(String(y.location ?? '')));
  }
  /**
   * PACK-18 (flag ff.bill.pack18): the money of the chain, tied to the client bills. The certified value is the certified quantity at the
   * contract rate (amountOf, the rounding of the bill); the billed quantity and value are read from the items of the approved client bills,
   * never recomputed; the tie compares the gross of those bills with the sum of their items. Variances: billed beyond certified, certified not
   * yet billed, and the measurement book marked billed for a quantity other than the bills carry.
   */
  function moneyOf(companyId, pj, rs) {
    const bills = db.prepare("SELECT id, doc_no, gross_paise FROM bill_client_bills WHERE company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id").all(companyId, pj);
    const lines = bills.length ? db.prepare(`SELECT bill_id, item_kind, item_code, this_qty_th, this_amount_paise FROM bill_client_bill_items WHERE company_id = ? AND deleted_at IS NULL AND bill_id IN (${bills.map(() => '?').join(', ')})`).all(companyId, ...bills.map((b) => b.id)) : [];
    const byCode = new Map(); let milestones = 0;
    for (const l of lines) { if (l.item_kind === 'MILESTONE') { milestones += l.this_amount_paise; continue; } const k = l.item_code.toLowerCase(); const a = byCode.get(k) ?? { qty: 0, amount: 0 }; a.qty += l.this_qty_th; a.amount += l.this_amount_paise; byCode.set(k, a); }
    const rate = new Map([...itemsOf(companyId, pj).values()].map((it) => [it.code.toLowerCase(), it.rate ?? 0]));
    const items = rs.map((r) => {
      const k = r.code.toLowerCase(); const rt = rate.get(k) ?? 0; const certTh = Math.round((r.certified ?? 0) * 1000); const mbBilledTh = Math.round((r.billed ?? 0) * 1000); const b = byCode.get(k) ?? { qty: 0, amount: 0 };
      const certifiedPaise = amountOf(certTh, rt); const variances = [];
      if (b.qty > certTh) variances.push('BILLED_BEYOND_CERTIFIED'); if (certTh > b.qty) variances.push('CERTIFIED_NOT_BILLED'); if (mbBilledTh !== b.qty) variances.push('MB_BILL_MISMATCH');
      return { code: r.code, rate: rt / 10000, certifiedQty: certTh / 1000, certifiedAmount: certifiedPaise / 100, billedQty: b.qty / 1000, billedAmount: b.amount / 100, mbBilledQty: mbBilledTh / 1000, unbilledAmount: (certifiedPaise - b.amount) / 100, variances };
    });
    const itemsPaise = [...byCode.values()].reduce((n, a) => n + a.amount, 0); const grossPaise = bills.reduce((n, b) => n + b.gross_paise, 0);
    return { bills: bills.map((b) => ({ id: b.id, docNo: b.doc_no, gross: b.gross_paise / 100 })), items,
      tie: { billsGross: grossPaise / 100, itemsAmount: itemsPaise / 100, milestones: milestones / 100, differencePaise: grossPaise - itemsPaise - milestones, ties: grossPaise === itemsPaise + milestones },
      variances: items.filter((x) => x.variances.length).length };
  }
  const totalsOf = (rs) => { const m = new Map(); for (const r of rs) { const t = m.get(r.uom ?? '') ?? { uom: r.uom ?? '', ...Object.fromEntries(CHAIN_COLS.map((c) => [c, 0])) }; m.set(r.uom ?? '', t); for (const c of CHAIN_COLS) if (c !== 'forecast') t[c] = Math.round((t[c] + (r[c] ?? 0)) * 1000) / 1000; } return [...m.values()]; };
  const recon = {
    /** For the QS dashboard (22.08): the chain of every BOQ item of a project with the rate, read from here and never re-computed elsewhere. */
    chainRows: (companyId, projectId) => rows(companyId, rid(projectId), { by: 'item', withRate: true }),
    /**
     * For the daily execution intelligence (27.06): the executed quantity of approved DPRs per work line, apportioned to BOQ items the same way
     * as the executed column of the chain (thousandths), with the item's contract rate (×10⁴) and line ids. `date` limits to one DPR date,
     * `upTo` to DPR dates on or before it.
     */
    executedLines(companyId, projectId, { date = null, upTo = null } = {}) {
      const pj = rid(projectId); const items = itemsOf(companyId, pj);
      return executedOf(companyId, pj, items, { date, upTo }).map((w) => { const it = items.get(w.code); return { dprId: w.dprId, dprNo: w.dprNo, date: w.date, siteId: w.siteId, activityId: w.activity_id,
        code: it?.code ?? w.code, description: it?.description ?? null, uom: it?.uom ?? null, lineIds: it?.ids ?? [], qtyTh: w.qty, plannedTh: w.planned_qty ?? 0, rate: it?.rate ?? 0 }; });
    },
    options(actor) { gate(actor, 'bill.qty_recon.view', 'see the quantity reconciliation'); return { projects: db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => base.may(actor, 'bill.qty_recon.view', p.id)), locations: db.prepare('SELECT id, project_id AS projectId, code, name FROM proj_locations WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 2000').all(actor.companyId), levels: Object.entries(LEVEL).map(([id, label]) => ({ id, label })) }; },
    /** FR-01 */
    report(actor, q) {
      gate(actor, 'bill.qty_recon.view', 'see the quantity reconciliation'); const pj = projectOk(actor, q.projectId, 'bill.qty_recon.view'); const by = q.by === 'location' ? 'location' : 'item'; let rs = rows(actor.companyId, pj.id, { by, locationId: q.locationId ?? null, code: q.code ?? null });
      if (q.level) rs = rs.filter((r) => r.level === q.level); if (q.deviatingOnly) rs = rs.filter((r) => r.deviationPct != null && Math.abs(r.deviationPct) > Number(param(actor.companyId, 'bill.deviation.threshold_pct') ?? 25));
      const lv = (l) => rs.filter((r) => r.level === l).length;
      const money = by === 'item' && isEnabled(db, 'ff.bill.pack18', { companyId: actor.companyId }) ? moneyOf(actor.companyId, pj.id, rs) : undefined;
      return { projectId: pj.id, project: pcode(pj.id), by, rows: rs, totals: totalsOf(rs), ...(money ? { money } : {}), counts: { items: by === 'item' ? rs.length : new Set(rs.map((r) => r.code)).size, over: lv('OVER'), approaching: lv('APPROACHING'), forecastOver: lv('FORECAST_OVER') }, thresholdPct: Number(param(actor.companyId, 'bill.deviation.threshold_pct') ?? 25), alertPct: Number(param(actor.companyId, 'bill.qty.alert_pct') ?? 90), can: { forecast: base.may(actor, 'bill.qty_recon.forecast', pj.id), export: base.may(actor, 'bill.qty_recon.export', pj.id), prepare: base.may(actor, 'bill.deviation_statement.create', pj.id) } };
    },
    /** The drill-down of one item to the records behind each figure. */
    detail(actor, q) {
      gate(actor, 'bill.qty_recon.view', 'see the quantity reconciliation'); const pj = projectOk(actor, q.projectId, 'bill.qty_recon.view'); const items = itemsOf(actor.companyId, pj.id); const it = items.get(String(q.code ?? '').toLowerCase()); if (!it) throw unprocessable('No BOQ item with this code in this project.');
      const item = rows(actor.companyId, pj.id, { code: it.code })[0]; const byLoc = rows(actor.companyId, pj.id, { by: 'location', code: it.code });
      const entries = db.prepare(`SELECT e.id, e.doc_no AS docNo, e.description, e.location_id AS locationId, e.qty_th, e.certified_qty_th, e.status, e.measured_on AS measuredOn, e.bill_ref AS billRef FROM bill_mb_entries e WHERE e.company_id = ? AND e.org_project_id = ? AND e.deleted_at IS NULL AND e.status <> 'CANCELLED' AND e.boq_line_id IN (${it.ids.map(() => '?').join(',')}) ORDER BY e.id DESC LIMIT 200`).all(actor.companyId, pj.id, ...it.ids).map((e) => ({ id: e.id, docNo: e.docNo, description: e.description, locationId: e.locationId, qty: d3(e.qty_th), certified: d3(e.certified_qty_th), status: e.status, measuredOn: e.measuredOn, billRef: e.billRef }));
      const dpr = executedOf(actor.companyId, pj.id, items).filter((w) => w.code === it.code.toLowerCase() || w.code === it.code).slice(-100).map((w) => ({ id: w.id, dprNo: w.dprNo, date: w.date, activityId: w.activity_id, locationId: w.location_id, qty: d3(w.qty) }));
      const statements = db.prepare("SELECT id, doc_no AS docNo, ds_no AS dsNo, status, client_state AS clientState, items_json FROM bill_deviation_statements WHERE company_id = ? AND org_project_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED' ORDER BY id DESC LIMIT 50").all(actor.companyId, pj.id).filter((s) => JSON.parse(s.items_json).some((x) => String(x.code).toLowerCase() === it.code.toLowerCase())).map(({ items_json: _j, ...s }) => s);
      return { projectId: pj.id, item: item ?? null, locations: byLoc, entries, dpr, statements };
    },
    /** FR-04: the items beyond, approaching or forecast beyond their quantity. */
    limits(actor, q) {
      gate(actor, 'bill.qty_recon.view', 'see the items approaching their limit'); const pj = projectOk(actor, q.projectId, 'bill.qty_recon.view'); const rs = rows(actor.companyId, pj.id).filter((r) => r.level !== 'OK');
      const rank = { OVER: 0, APPROACHING: 1, FORECAST_OVER: 2 }; rs.sort((a, b) => rank[a.level] - rank[b.level] || (b.usedPct ?? 0) - (a.usedPct ?? 0)); return { projectId: pj.id, project: pcode(pj.id), alertPct: Number(param(actor.companyId, 'bill.qty.alert_pct') ?? 90), rows: rs, counts: { over: rs.filter((r) => r.level === 'OVER').length, approaching: rs.filter((r) => r.level === 'APPROACHING').length, forecastOver: rs.filter((r) => r.level === 'FORECAST_OVER').length } };
    },
    /** The one quantity typed in this view (BR-01): the forecast at completion of an item, with its basis. */
    setForecast(actor, b) {
      const pj = projectOk(actor, b.projectId, 'bill.qty_recon.forecast'); const items = itemsOf(actor.companyId, pj.id); const l = db.prepare('SELECT l.item_code FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ? AND v.org_project_id = ? AND l.deleted_at IS NULL').get(rid(b.boqLineId), pj.id); const it = l && items.get(l.item_code.toLowerCase()); if (!it) fail([{ field: 'boqLineId', message: 'Not an item of the BOQ of this project' }]);
      return transaction(db, () => {
        const old = db.prepare('SELECT * FROM bill_qty_forecasts WHERE company_id = ? AND org_project_id = ? AND item_code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, pj.id, it.code); const th = q3(b.forecastQty); let id;
        if (old) { db.prepare('UPDATE bill_qty_forecasts SET forecast_qty_th = ?, basis = ?, boq_line_id = ?, updated_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(th, b.basis, it.lineId, today(), actor.user, nowIso(), old.id); id = old.id; } else id = Number(db.prepare('INSERT INTO bill_qty_forecasts (company_id, org_project_id, item_code, boq_line_id, forecast_qty_th, basis, updated_on, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, pj.id, it.code, it.lineId, th, b.basis, today(), actor.user, 'manual').lastInsertRowid);
        audit(actor, 'bill_qty_forecasts', id, old ? 'update' : 'create', actor.companyId, { newValues: { item: it.code, forecast: b.forecastQty, basis: b.basis }, oldValues: old ? { forecast: d3(old.forecast_qty_th) } : undefined });
        evt('bill.qty.forecast', actor, actor.companyId, 'bill_qty_forecasts', id, { projectId: pj.id, boqCode: it.code, boqLineId: it.lineId, forecastQty: b.forecastQty, previous: old ? d3(old.forecast_qty_th) : null, revisedQty: d3(it.revised), uom: it.uom, basis: b.basis }, pj.id);
        return rows(actor.companyId, pj.id, { code: it.code })[0];
      });
    },
    clearForecast(actor, q) {
      const pj = projectOk(actor, q.projectId, 'bill.qty_recon.forecast'); const old = db.prepare('SELECT * FROM bill_qty_forecasts WHERE company_id = ? AND org_project_id = ? AND item_code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, pj.id, String(q.code ?? '')); if (!old) throw conflict('There is no forecast for this item.');
      db.prepare('UPDATE bill_qty_forecasts SET deleted_at = ?, deleted_by = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, old.id); audit(actor, 'bill_qty_forecasts', old.id, 'delete', actor.companyId); return { cleared: true };
    },
    exportCsv(actor, q) {
      gate(actor, 'bill.qty_recon.export', 'export the quantity reconciliation'); const r = recon.report(actor, q); const headers = ['Item', 'Description', 'Unit', 'Location', 'Contract', 'Revised', 'Executed', 'Measured', 'Certified', 'Billed', 'Paid', 'Balance', 'Forecast', 'Deviation %', 'Level'];
      const data = r.rows.map((x) => [x.code, x.description, x.uom ?? '', x.location ?? '', x.contract ?? '', x.revised ?? '', x.executed, x.measured, x.certified, x.billed, x.paid, x.balance ?? '', x.forecast ?? '', x.deviationPct ?? '', x.level ?? '']); audit(actor, 'bill_mb_entries', 0, 'export', actor.companyId, { reason: `quantity reconciliation, ${data.length} row(s)` });
      return { contentType: 'text/csv; charset=utf-8', fileName: `quantity-reconciliation-${r.project}-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, data)}`, 'utf8') };
    },
    /** For the estimate at completion (23.11): the forecast quantities of a project with the revised quantity and the rate. */
    forecastsOf(companyId, projectId) { return rows(companyId, projectId, { withRate: true }).map((r) => ({ boqCode: r.code, boqLineId: r.boqLineId, uom: r.uom, revisedQty: r.revised, forecastQty: r.forecast ?? r.projected, source: r.forecastSource, rate: r.rate == null ? null : r.rate / 10000 })); },
    /** FR-04: items newly beyond or approaching their limit are told to the QS and the project manager, once for each level. */
    sweep(companyId) {
      let told = 0; for (const p of db.prepare("SELECT id FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE'").all(companyId)) {
        for (const r of rows(companyId, p.id).filter((x) => x.level !== 'OK')) { const label = LEVEL[r.level]; notify(companyId, 'bill.qty.alert', ['role:QS', 'role:PM'], `${pcode(p.id)} ${r.code}`, label.toLowerCase(), `${pcode(p.id)} item ${r.code} ${r.description}: ${label.toLowerCase()} (${r.usedPct ?? '—'}% of ${r.revised} ${r.uom ?? ''} used; forecast ${r.forecast ?? '—'}).`, `/bill/qty-recon?projectId=${p.id}&code=${encodeURIComponent(r.code)}`, `qty.${p.id}.${r.code}.${r.level}`, { projectId: p.id }); told += 1; }
      } return { told };
    },
    itemsOf, rows,
  };
  return { recon };
}
