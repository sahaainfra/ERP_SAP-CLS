import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { rateBenchmarks, rateContracts } from './pr.js';
import { d3, json, nowIso, q3, rid, rs, same } from './base.js';

// Comparative statement and vendor selection (part 15.04). From the quotations received for an RFQ the statement lays out every line against every vendor with the landed rate, the rank (equal rates share a rank), the technical compliance and
// the benchmarks (last purchase rates, rate contract, the rate on the requisition, market index when 15.09 exists). It recommends the overall L1 vendor, the L1 of each line (a vendor who cannot supply the whole quantity gets what it offers and
// the next vendor the rest: a split award), or a choice made by hand. A choice that is not L1 needs a reason and goes one level higher in the approval (BR-01, CP-PROC-04). The quantity selected on a line never exceeds the RFQ quantity
// (BR-02) nor what the vendor offered. An approved statement is what the purchase order is made from (15.05).
export const CS_DOC = 'PROC_CS';
export const CS_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Waiting for approval', RETURNED: 'Returned for correction', APPROVED: 'Approved', REJECTED: 'Rejected', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const CS_TYPES = { OVERALL_L1: 'Overall L1 vendor', SPLIT_L1: 'L1 of each line (split award)', CUSTOM: 'Chosen by hand' };
export const REASONS = { TECHNICAL: 'Technical', DELIVERY: 'Delivery', QUALITY: 'Quality', OTHER: 'Other' };
const EDITABLE = ['DRAFT', 'RETURNED'];

controlRegistry.define({
  code: 'CP-PROC-04', module: 'proc', stage: 'APPROVE', description: 'A vendor who is not the L1 is chosen only with a reason, and the statement is approved one level higher', enforcement: 'BLOCK', evidenceRequired: false, escalationLevel: 1, ownerRole: 'PROCMGR', mode: 'WARN',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'Non-L1 selection', details: { ref: context.ref ?? null, lines: context.lines ?? null, reason: context.reason ?? null } }),
});
for (const [key, dataType, def, description, extra] of [
  ['proc.cs.band_pd_minor', 'integer', 50_000_000, 'Section 9: a statement above this value, in paise (₹ 5 lakh), is also approved by the project director.', { min: 0, max: 100_000_000_000 }],
  ['proc.cs.band_dir_minor', 'integer', 500_000_000, 'Section 9: a statement above this value, in paise (₹ 50 lakh), is also approved by the direction.', { min: 0, max: 100_000_000_000 }],
  ['proc.cs.min_justification', 'integer', 20, 'BR-01: the least characters of the justification of a non-L1 choice.', { min: 5, max: 500 }],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/** Cells are { vendorId, landedRate, offeredQty, deliveryDays, quotationId }. Equal landed rates share a rank (1, 1, 3); the order among equals is by delivery days, then the earlier quotation. */
export function rankCells(cells) {
  const order = [...cells].sort((a, b) => a.landedRate - b.landedRate || a.deliveryDays - b.deliveryDays || a.quotationId - b.quotationId); const ranks = new Map();
  order.forEach((c, i) => ranks.set(c.vendorId, i > 0 && c.landedRate === order[i - 1].landedRate ? ranks.get(order[i - 1].vendorId) : i + 1)); return { order, ranks };
}
/** The split award by price: the quantity goes to the vendors in order of price, each up to what it offered. */
export function allocate(cells, qty) {
  let left = qty; const out = []; for (const c of rankCells(cells).order) { if (left <= 0) break; const q = Math.min(left, c.offeredQty); if (q > 0) { out.push({ vendorId: c.vendorId, qty: q }); left -= q; } } return { picks: out, short: left };
}
/** A choice is L1 on a line when every vendor with a lower landed rate has been given all it offered (up to the RFQ quantity). */
export function nonL1Vendors(cells, picks, qty) {
  const sel = new Map(picks.map((p) => [p.vendorId, p.qty])); const bad = [];
  for (const p of picks) if (p.qty > 0) { const lower = cells.filter((c) => c.landedRate < cells.find((x) => x.vendorId === p.vendorId).landedRate); const cheaperRoom = lower.some((c) => (sel.get(c.vendorId) ?? 0) < Math.min(c.offeredQty, qty)); if (cheaperRoom) bad.push(p.vendorId); }
  return bad;
}

export const csList = defineList({
  code: 'proc.comparative_statements', label: 'Comparative statements', permission: 'proc.comparative_statement.view', from: 'proc_comparative_statements x JOIN proc_rfqs f ON f.id = x.rfq_id JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'f.doc_no', 'f.title', 'p.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Statement' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, rfq: { sql: 'f.doc_no', type: 'text', label: 'RFQ' }, title: { sql: 'f.title', type: 'text', label: 'Title' }, project: { sql: 'p.code', type: 'text', label: 'Project' },
    type: { sql: 'x.recommendation_type', type: 'enum', label: 'Recommendation', options: Object.entries(CS_TYPES) }, value: { sql: 'x.total_value', type: 'text', label: 'Value', sortable: false }, savings: { sql: 'x.savings_vs_budget', type: 'text', label: 'Against the estimate', sortable: false },
    nonL1: { sql: "CASE WHEN x.non_l1 = 1 THEN 'YES' ELSE 'NO' END", type: 'enum', label: 'Not L1', options: [['YES', 'Yes'], ['NO', 'No']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(CS_STATUS) },
  },
});

export function createCsService({ db, base }) {
  const { authz, param, may, need, fail, audit, notify, number, itemOf } = base;
  const evt = (type, actor, r, data) => publishEvent(db, { type, entity: 'proc_comparative_statement', entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, data: { csId: r.id, docNo: r.doc_no, rfqId: r.rfq_id, projectId: r.org_project_id, ...data } });
  const vname = (id) => { const v = db.prepare('SELECT code, trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? { code: v.code, name: v.trade_name ?? v.legal_name } : { code: '', name: '' }; };
  const rfqLines = (rfqId) => db.prepare('SELECT * FROM proc_rfq_lines WHERE rfq_id = ? AND deleted_at IS NULL ORDER BY line_no').all(rfqId);
  const csLines = (csId) => db.prepare('SELECT * FROM proc_cs_lines WHERE cs_id = ? AND deleted_at IS NULL').all(csId);
  const row = (actor, id, key = 'proc.comparative_statement.view') => {
    const r = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.comparative_statement.view', r.org_project_id)) throw notFound('That comparative statement does not exist.'); if (key !== 'proc.comparative_statement.view') need(actor, key, 'do that with a comparative statement', r.org_project_id); return r;
  };
  const scope = (actor) => { const f = authz.scopeFilter(actor, 'proc.comparative_statement.view', { project: 'x.org_project_id' }); return { sql: `x.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const levelOf = (cid, value, nonL1) => { const pd = Number(param(cid, 'proc.cs.band_pd_minor') ?? 50_000_000); const dir = Number(param(cid, 'proc.cs.band_dir_minor') ?? 500_000_000); let lvl = value > dir ? 2 : value > pd ? 1 : 0; if (nonL1) lvl = Math.min(lvl + 1, 2); return lvl; };

  // ---- the matrix: the latest received quotation of each vendor, line by line, with the benchmarks (FR-01, FR-02) ------------------------------------------------------------------------------------------------
  function benchmarks(rfq, l) {
    const item = l.item_id ? itemOf(rfq.company_id, l.item_id) : null; const pl = db.prepare('SELECT est_rate FROM proc_pr_lines WHERE id = ?').get(l.pr_line_id);
    const lastProject = l.item_id ? db.prepare("SELECT c.landed_rate FROM proc_cs_lines c JOIN proc_comparative_statements s ON s.id = c.cs_id JOIN proc_rfq_lines r ON r.id = c.rfq_line_id WHERE s.status = 'APPROVED' AND s.org_project_id = ? AND r.item_id = ? AND c.selected_qty > 0 AND s.rfq_id <> ? AND c.deleted_at IS NULL ORDER BY s.approved_at DESC, c.id DESC LIMIT 1").get(rfq.org_project_id, l.item_id, rfq.id) : null;
    return { lastPo: item?.last_purchase_amount > 0 ? item.last_purchase_amount : null, lastProject: lastProject?.landed_rate ?? null, budget: pl?.est_rate > 0 ? pl.est_rate : null, item };
  }
  function cellsFor(rfq) {
    const qs = db.prepare("SELECT * FROM proc_quotations WHERE rfq_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL ORDER BY vendor_id").all(rfq.id); const out = [];
    for (const q of qs) for (const x of db.prepare('SELECT * FROM proc_quotation_lines WHERE quotation_id = ? AND deleted_at IS NULL AND offered_qty > 0').all(q.id)) out.push({ rfqLineId: x.rfq_line_id, vendorId: q.vendor_id, quotationId: q.id, quotationLineId: x.id, offeredQty: x.offered_qty, landedRate: x.landed_rate, deliveryDays: q.delivery_days, deviation: x.deviation });
    return out;
  }
  function writeMatrix(rfq, cs, keep) {
    const cells = cellsFor(rfq); const ls = rfqLines(rfq.id); const now = nowIso(); db.prepare('UPDATE proc_cs_lines SET deleted_at = ?, is_active = 0 WHERE cs_id = ? AND deleted_at IS NULL').run(now, cs.id);
    for (const l of ls) {
      const row_ = cells.filter((c) => c.rfqLineId === l.id); const { ranks } = rankCells(row_); const b = benchmarks(rfq, l); const mk = l.item_id ? rateBenchmarks.lookup(db, { companyId: rfq.company_id, itemId: l.item_id, date: todayIST() }) : null; const rcs = l.item_id ? (rateContracts.providers.map((fn) => { try { return fn({ companyId: rfq.company_id, projectId: rfq.org_project_id, itemId: l.item_id, vendorId: null }); } catch { return null; } }).find((x) => x?.rate > 0)?.rate ?? null) : null;
      for (const c of row_) { const old = keep?.get(`${l.id}:${c.vendorId}`); const rank = ranks.get(c.vendorId);
        db.prepare("INSERT INTO proc_cs_lines (company_id, cs_id, rfq_line_id, vendor_id, quotation_id, quotation_line_id, offered_qty, landed_rate, rank_no, is_l1, compliance, selected_qty, last_po_rate, last_project_rate, budget_rate, rc_rate, market_rate, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proc_quotation', ?)").run(rfq.company_id, cs.id, l.id, c.vendorId, c.quotationId, c.quotationLineId, c.offeredQty, c.landedRate, rank, rank === 1 ? 1 : 0, old?.compliance ?? (c.deviation ? 'DEVIATION' : 'YES'), Math.min(old?.selected ?? 0, c.offeredQty), b.lastPo, b.lastProject, b.budget, rcs, mk?.rate ?? null, rfq.org_project_id, cs.requested_by, String(c.quotationId)); }
    }
  }
  /** The vendor who quoted every line in full with the lowest total, or null. */
  function overallBest(ls, cells) {
    const full = new Map(); for (const v of new Set(cells.map((c) => c.vendorId))) { let total = 0; let ok = true; for (const l of ls) { const c = cells.find((x) => x.vendorId === v && x.rfqLineId === l.id); if (!c || c.offeredQty < l.qty) { ok = false; break; } total += (c.landedRate * l.qty) / 1000; } if (ok) full.set(v, total); }
    return full.size ? [...full.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0][0] : null;
  }
  /** The selections the three recommendations give. Overall L1: the vendor who quoted every line in full with the lowest total. */
  function recommend(rfq, type, custom, bad = new Set()) {
    const ls = rfqLines(rfq.id); const cells = cellsFor(rfq).filter((c) => !bad.has(`${c.rfqLineId}:${c.vendorId}`)); const picks = [];
    if (type === 'CUSTOM') { for (const s of custom ?? []) picks.push({ rfqLineId: s.rfqLineId, vendorId: s.vendorId, qty: q3(s.qty) }); return picks; }
    if (type === 'OVERALL_L1') {
      const best0 = overallBest(ls, cells);
      if (best0 == null) throw unprocessable('No vendor quoted every line in full: choose the L1 of each line, or select by hand.');
      const best = best0; return ls.map((l) => ({ rfqLineId: l.id, vendorId: best, qty: l.qty }));
    }
    for (const l of ls) { const { picks: p } = allocate(cells.filter((c) => c.rfqLineId === l.id), l.qty); for (const x of p) picks.push({ rfqLineId: l.id, vendorId: x.vendorId, qty: x.qty }); }
    return picks;
  }
  /** Checks (BR-02) and applies a selection; returns the lines that are not L1. */
  function applySelection(rfq, cs, picks) {
    const ls = new Map(rfqLines(rfq.id).map((l) => [l.id, l])); const lines = csLines(cs.id); const problems = []; const per = new Map();
    for (const [i, p] of picks.entries()) {
      const l = ls.get(p.rfqLineId); const cell = lines.find((c) => c.rfq_line_id === p.rfqLineId && c.vendor_id === p.vendorId);
      if (!l) { problems.push({ field: `selections.${i}.rfqLineId`, message: 'Not a line of this RFQ' }); continue; } if (!cell) { problems.push({ field: `selections.${i}.vendorId`, message: 'That vendor did not quote this line' }); continue; }
      if (cell.compliance === 'NO') problems.push({ field: `selections.${i}.vendorId`, message: 'The offer does not comply technically: it is not awarded' }); if (p.qty > cell.offered_qty) problems.push({ field: `selections.${i}.qty`, message: `The vendor offered only ${d3(cell.offered_qty)}` });
      per.set(p.rfqLineId, (per.get(p.rfqLineId) ?? 0) + p.qty); if (per.get(p.rfqLineId) > l.qty) problems.push({ field: `selections.${i}.qty`, message: `More than the RFQ quantity of ${d3(l.qty)} is selected on line ${l.line_no}` });
    }
    fail(problems);
    db.prepare('UPDATE proc_cs_lines SET selected_qty = 0 WHERE cs_id = ? AND deleted_at IS NULL').run(cs.id); for (const p of picks) db.prepare('UPDATE proc_cs_lines SET selected_qty = ? WHERE cs_id = ? AND rfq_line_id = ? AND vendor_id = ? AND deleted_at IS NULL').run(p.qty, cs.id, p.rfqLineId, p.vendorId);
    const fresh = csLines(cs.id); const nonL1 = []; for (const l of ls.values()) { const cells = fresh.filter((c) => c.rfq_line_id === l.id && c.compliance !== 'NO').map((c) => ({ vendorId: c.vendor_id, landedRate: c.landed_rate, offeredQty: c.offered_qty })); const sel = fresh.filter((c) => c.rfq_line_id === l.id && c.selected_qty > 0).map((c) => ({ vendorId: c.vendor_id, qty: c.selected_qty })); const bad = nonL1Vendors(cells, sel, l.qty); if (bad.length) nonL1.push({ rfqLineId: l.id, lineNo: l.line_no, vendors: bad }); }
    const best = overallBest([...ls.values()], cellsFor(rfq)); const wholeToBest = best != null && [...ls.values()].every((l) => fresh.filter((c) => c.rfq_line_id === l.id && c.selected_qty > 0).every((c) => c.vendor_id === best) && fresh.filter((c) => c.rfq_line_id === l.id).reduce((n, c) => n + c.selected_qty, 0) === l.qty); if (wholeToBest) nonL1.length = 0; // the overall L1 is a recommendation of its own (FR-03)
    const total = fresh.reduce((n, c) => n + Math.round((c.selected_qty * c.landed_rate) / 1000), 0); const baseline = fresh.reduce((n, c) => n + (c.selected_qty > 0 && c.budget_rate ? Math.round((c.selected_qty * c.budget_rate) / 1000) : 0), 0); const covered = fresh.filter((c) => c.selected_qty > 0 && c.budget_rate).reduce((n, c) => n + Math.round((c.selected_qty * c.landed_rate) / 1000), 0);
    db.prepare('UPDATE proc_comparative_statements SET total_value = ?, savings_vs_budget = ?, non_l1 = ?, recommended_split_json = ? WHERE id = ?').run(total, baseline - covered, nonL1.length ? 1 : 0, JSON.stringify(picks.map((p) => ({ rfqLineId: p.rfqLineId, vendorId: p.vendorId, qty: d3(p.qty) }))), cs.id);
    return nonL1;
  }

  // ---- views ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const f = db.prepare('SELECT doc_no, title, status, due_date FROM proc_rfqs WHERE id = ?').get(r.rfq_id); const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user);
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, rfqId: r.rfq_id, rfqNo: f?.doc_no, rfqTitle: f?.title, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, recommendationType: r.recommendation_type, recommendationLabel: CS_TYPES[r.recommendation_type], nonL1: Boolean(r.non_l1), reasonCode: r.reason_code, justification: r.justification,
      totalValue: rs(r.total_value), savingsVsBudget: rs(r.savings_vs_budget), roundNo: r.round_no, status: r.status, statusLabel: CS_STATUS[r.status], revisionNo: r.revision_no, parentId: r.parent_id, requestedBy: r.requested_by, approvedBy: r.approved_by, approvedAt: r.approved_at, cancelReason: r.cancel_reason, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      approvalLevel: levelOf(r.company_id, r.total_value, Boolean(r.non_l1)),
      can: { edit: can('proc.comparative_statement.edit') && EDITABLE.includes(r.status), submit: can('proc.comparative_statement.submit') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('proc.comparative_statement.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status), delete: can('proc.comparative_statement.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('proc.comparative_statement.amend') && r.status === 'APPROVED', approve: can('proc.comparative_statement.approve') && r.status === 'SUBMITTED' && !own, print: can('proc.comparative_statement.print'), negotiate: can('proc.comparative_statement.edit') && EDITABLE.includes(r.status) } };
    if (detail) {
      const lines = csLines(r.id); const vendors = [...new Set(lines.map((c) => c.vendor_id))]; const rl = rfqLines(r.rfq_id);
      o.vendors = vendors.map((v) => { const mine = lines.filter((c) => c.vendor_id === v); const q = db.prepare('SELECT * FROM proc_quotations WHERE id = ?').get(mine[0].quotation_id); const full = rl.every((l) => mine.find((c) => c.rfq_line_id === l.id && c.offered_qty >= l.qty)); const total = full ? rl.reduce((n, l) => n + Math.round((mine.find((c) => c.rfq_line_id === l.id).landed_rate * l.qty) / 1000), 0) : null;
        return { vendorId: v, ...vname(v), quotationId: q.id, quotationNo: q.doc_no, versionNo: q.version_no, deliveryDays: q.delivery_days, paymentTerms: q.payment_terms, validUntil: q.valid_until, expired: q.valid_until < todayIST(), quotedLines: mine.length, fullQuote: full, totalLanded: total == null ? null : rs(total), selectedValue: rs(mine.reduce((n, c) => n + Math.round((c.selected_qty * c.landed_rate) / 1000), 0)), overallRank: null }; });
      const ranked = o.vendors.filter((v) => v.fullQuote).sort((a, b) => a.totalLanded - b.totalLanded); ranked.forEach((v, i) => { v.overallRank = i > 0 && v.totalLanded === ranked[i - 1].totalLanded ? ranked[i - 1].overallRank : i + 1; });
      o.lines = rl.map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; const mine = lines.filter((c) => c.rfq_line_id === l.id); const b = mine[0];
        return { rfqLineId: l.id, lineNo: l.line_no, itemId: l.item_id, itemCode: it?.code ?? null, itemName: it?.name ?? l.service_desc, qty: d3(l.qty), uom: l.uom, spec: l.spec,
          benchmarks: { lastPo: rs(b?.last_po_rate ?? null), lastProject: rs(b?.last_project_rate ?? null), budget: rs(b?.budget_rate ?? null), rateContract: rs(b?.rc_rate ?? null), market: rs(b?.market_rate ?? null) },
          selectedQty: d3(mine.reduce((n, c) => n + c.selected_qty, 0)),
          cells: vendors.map((v) => { const c = mine.find((x) => x.vendor_id === v); const q = c ? db.prepare('SELECT delivery_days, valid_until, payment_terms FROM proc_quotations WHERE id = ?').get(c.quotation_id) : null; const ql = c ? db.prepare('SELECT make, deviation, rate FROM proc_quotation_lines WHERE id = ?').get(c.quotation_line_id) : null;
            return c ? { vendorId: v, quoted: true, rate: rs(ql?.rate ?? 0), landedRate: rs(c.landed_rate), landedAmount: rs(Math.round((c.landed_rate * Math.min(c.offered_qty, l.qty)) / 1000)), offeredQty: d3(c.offered_qty), rank: c.rank_no, isL1: Boolean(c.is_l1), compliance: c.compliance, make: ql?.make ?? null, deviation: ql?.deviation ?? null, deliveryDays: q.delivery_days, selectedQty: d3(c.selected_qty), vsLastPo: c.last_po_rate ? Math.round(((c.landed_rate - c.last_po_rate) / c.last_po_rate) * 1000) / 10 : null, vsBudget: c.budget_rate ? Math.round(((c.landed_rate - c.budget_rate) / c.budget_rate) * 1000) / 10 : null } : { vendorId: v, quoted: false }; }) }; });
      o.negotiations = db.prepare('SELECT * FROM proc_cs_negotiations WHERE cs_id = ? AND deleted_at IS NULL ORDER BY round_no, id').all(r.id).map((n) => ({ id: n.id, roundNo: n.round_no, vendorId: n.vendor_id, vendor: vname(n.vendor_id).name, note: n.note, recordedBy: n.recorded_by, at: n.created_at, quotationBefore: n.quotation_before_id ? db.prepare('SELECT doc_no, version_no FROM proc_quotations WHERE id = ?').get(n.quotation_before_id) : null, quotationAfter: n.quotation_after_id ? db.prepare('SELECT doc_no, version_no FROM proc_quotations WHERE id = ?').get(n.quotation_after_id) : null }));
      const newer = vendors.filter((v) => { const cur = db.prepare("SELECT id FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL").get(r.rfq_id, v); return !cur || !lines.some((c) => c.vendor_id === v && c.quotation_id === cur.id); });
      const missing = db.prepare("SELECT DISTINCT q.vendor_id FROM proc_quotations q WHERE q.rfq_id = ? AND q.status = 'RECEIVED' AND q.deleted_at IS NULL").all(r.rfq_id).map((x) => x.vendor_id).filter((v) => !vendors.includes(v));
      o.warnings = [...(newer.length || missing.length ? [{ code: 'STALE', message: 'A quotation was revised or received after this statement was made: refresh it.' }] : []), ...o.vendors.filter((v) => v.expired).map((v) => ({ code: 'EXPIRED', message: `${v.name}: the quotation validity ended ${v.validUntil}.` }))];
    }
    return o;
  };
  const selectionsOf = (r) => json(r.recommended_split_json, []);
  const checkJustification = (r, lines) => { if (!lines) return; const min = Number(param(r.company_id, 'proc.cs.min_justification') ?? 20); const p = []; if (!r.reason_code) p.push({ field: 'reasonCode', message: 'Choose the reason: technical, delivery, quality or other' }); if (!r.justification || r.justification.trim().length < min) p.push({ field: 'justification', message: `A vendor who is not the L1 is chosen only with a reason (at least ${min} characters)` }); fail(p); };

  const css = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.comparative_statement.view').allowed) throw forbidden('You may not see comparative statements (permission proc.comparative_statement.view).'); const sc = scope(actor);
      return runList(db, csList, parseListRequest(csList, query), { select: 'x.*, f.doc_no AS fno, f.title AS ftitle, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, date: x.doc_date, rfq: x.fno, rfqId: x.rfq_id, title: x.ftitle, project: x.pcode, type: x.recommendation_type, value: String(rs(x.total_value)), savings: String(rs(x.savings_vs_budget)), nonL1: x.non_l1 ? 'YES' : 'NO', status: x.status, statusLabel: CS_STATUS[x.status] }) });
    },
    exportSource(actor, req) { return css.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => { const v = view(actor, row(actor, id), { detail: true }); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    /** The RFQs a statement can be made for: issued or closed, with a received quotation and no statement in progress. */
    rfqs(actor) {
      if (!authz.check(actor, 'proc.comparative_statement.create').allowed) throw forbidden('You may not make comparative statements (permission proc.comparative_statement.create).');
      return db.prepare("SELECT f.id, f.doc_no, f.title, f.org_project_id, f.status, p.code AS pcode, (SELECT COUNT(*) FROM proc_quotations q WHERE q.rfq_id = f.id AND q.status = 'RECEIVED' AND q.deleted_at IS NULL) AS quotes FROM proc_rfqs f JOIN org_projects p ON p.id = f.org_project_id WHERE f.company_id = ? AND f.deleted_at IS NULL AND f.status IN ('ISSUED', 'CLOSED') AND NOT EXISTS (SELECT 1 FROM proc_comparative_statements s WHERE s.rfq_id = f.id AND s.deleted_at IS NULL AND s.status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')) ORDER BY f.id DESC LIMIT 200").all(actor.companyId)
        .filter((f) => f.quotes > 0 && may(actor, 'proc.comparative_statement.create', f.org_project_id)).map((f) => ({ id: f.id, docNo: f.doc_no, title: f.title, project: f.pcode, status: f.status, quotations: f.quotes }));
    },
    create(actor, b) {
      const rfq = db.prepare('SELECT * FROM proc_rfqs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.rfqId), actor.companyId); if (!rfq || !may(actor, 'proc.comparative_statement.view', rfq.org_project_id)) throw notFound('That RFQ does not exist.'); need(actor, 'proc.comparative_statement.create', 'make a comparative statement', rfq.org_project_id);
      if (!['ISSUED', 'CLOSED'].includes(rfq.status)) throw unprocessable('A statement is made for an issued or closed RFQ.'); if (!cellsFor(rfq).length) throw unprocessable('No quotation has been received for this RFQ.');
      if (db.prepare("SELECT 1 FROM proc_comparative_statements WHERE rfq_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED')").get(rfq.id)) throw conflict('This RFQ has a comparative statement already: amend it, or cancel it first.');
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'PROC_CS', 'proc_comparative_statements', 'CS'); const id = Number(db.prepare("INSERT INTO proc_comparative_statements (company_id, doc_no, doc_date, rfq_id, org_project_id, recommendation_type, reason_code, justification, status, requested_by, project_id, created_by, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, 'proc_rfq', ?)").run(actor.companyId, no, todayIST(), rfq.id, rfq.org_project_id, b.recommendationType, b.reasonCode ?? null, b.justification ?? null, actor.user, rfq.org_project_id, actor.user, String(rfq.id)).lastInsertRowid);
        const cs = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ?').get(id); writeMatrix(rfq, cs, null); applySelection(rfq, cs, recommend(rfq, b.recommendationType, b.selections)); audit(actor, 'proc_comparative_statements', id, 'create', actor.companyId, { newValues: { docNo: no, type: b.recommendationType } }); evt('proc.cs.generated', actor, cs, { type: b.recommendationType }); return css.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.comparative_statement.edit'); if (!EDITABLE.includes(r.status)) throw conflict(`${CS_STATUS[r.status]}: the statement is not changed now. Amend an approved one.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this statement; reload it.'); const rfq = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(r.rfq_id);
      return transaction(db, () => {
        const keepSel = new Map(csLines(r.id).map((c) => [`${c.rfq_line_id}:${c.vendor_id}`, { compliance: c.compliance, selected: c.selected_qty }]));
        if (b.compliance) for (const x of b.compliance) { const k = `${x.rfqLineId}:${x.vendorId}`; if (!keepSel.has(k)) fail([{ field: 'compliance', message: 'That vendor did not quote that line' }]); keepSel.get(k).compliance = x.value; }
        const type = b.recommendationType ?? r.recommendation_type; if (b.refresh || b.compliance) { writeMatrix(rfq, r, keepSel); for (const n of db.prepare('SELECT * FROM proc_cs_negotiations WHERE cs_id = ? AND quotation_after_id IS NULL AND deleted_at IS NULL').all(r.id)) { const cur = db.prepare("SELECT id FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL").get(r.rfq_id, n.vendor_id); if (cur && cur.id !== n.quotation_before_id) db.prepare('UPDATE proc_cs_negotiations SET quotation_after_id = ? WHERE id = ?').run(cur.id, n.id); } }
        db.prepare('UPDATE proc_comparative_statements SET recommendation_type = ?, reason_code = ?, justification = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(type, 'reasonCode' in b ? b.reasonCode : r.reason_code, 'justification' in b ? b.justification : r.justification, actor.user, nowIso(), r.id);
        const fresh = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ?').get(r.id);
        const picks = b.selections || (b.recommendationType && b.recommendationType !== 'CUSTOM') ? recommend(rfq, type, b.selections ?? selectionsOf(r).map((s) => ({ ...s, qty: s.qty })), new Set([...keepSel.entries()].filter(([, v]) => v.compliance === 'NO').map(([k]) => k))) : csLines(r.id).filter((c) => c.selected_qty > 0).map((c) => ({ rfqLineId: c.rfq_line_id, vendorId: c.vendor_id, qty: c.selected_qty }));
        applySelection(rfq, fresh, picks); audit(actor, 'proc_comparative_statements', r.id, 'update', r.company_id, { newValues: { type, refreshed: Boolean(b.refresh) } }); return css.get(actor, r.id);
      });
    },
    importSelections(actor, id, { rows }) {
      const r = row(actor, id, 'proc.comparative_statement.edit'); const by = new Map(rfqLines(r.rfq_id).map((l) => [l.line_no, l.id])); const problems = []; const sel = rows.map((x, i) => { const l = by.get(x.lineNo); if (!l) { problems.push({ field: `rows.${i}.lineNo`, message: `The RFQ has no line ${x.lineNo}` }); return null; } return { rfqLineId: l, vendorId: x.vendorId, qty: x.qty }; }).filter(Boolean); fail(problems);
      return css.update(actor, id, { recommendationType: 'CUSTOM', selections: sel });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.comparative_statement.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); const now = nowIso(); db.prepare('UPDATE proc_cs_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE cs_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_cs_negotiations SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE cs_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_comparative_statements SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_comparative_statements', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },
    /** FR-04: a negotiation round: the vendor is asked to revise (the revised quotation is entered through the quotation, then the statement is refreshed). */
    negotiate(actor, id, { vendorId, note }) {
      const r = row(actor, id, 'proc.comparative_statement.edit'); if (!EDITABLE.includes(r.status)) throw conflict('Negotiation is recorded on a draft or returned statement.'); if (!csLines(r.id).some((c) => c.vendor_id === vendorId)) throw notFound('That vendor has no quotation in this statement.');
      return transaction(db, () => { const round = r.round_no + 1; const cur = db.prepare("SELECT id FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL").get(r.rfq_id, vendorId); db.prepare("INSERT INTO proc_cs_negotiations (company_id, cs_id, round_no, vendor_id, note, quotation_before_id, recorded_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, round, vendorId, note, cur?.id ?? null, actor.user, r.org_project_id, actor.user);
        db.prepare('UPDATE proc_comparative_statements SET round_no = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(round, actor.user, nowIso(), r.id); audit(actor, 'proc_cs_negotiations', r.id, 'negotiate', r.company_id, { newValues: { round, vendorId } }); return css.get(actor, r.id); });
    },
    submit(actor, id) {
      const r = row(actor, id, 'proc.comparative_statement.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned statement is sent for approval.'); const lines = csLines(r.id); const sel = lines.filter((c) => c.selected_qty > 0);
      if (!sel.length) throw unprocessable('Select at least one vendor and quantity.');
      const view_ = view(actor, r, { detail: true }); if (view_.warnings.some((w) => w.code === 'STALE')) throw conflict('A quotation was revised or received after this statement was made: refresh it first.');
      const non = r.non_l1 ? [1] : null; checkJustification(r, non);
      return transaction(db, () => {
        const level = levelOf(r.company_id, r.total_value, Boolean(r.non_l1)); const ctx = { projectId: r.org_project_id, amount: Number(rs(r.total_value)), nonL1: r.non_l1 ? 'yes' : 'no', needPd: level >= 1 ? 'yes' : 'no', needDir: level >= 2 ? 'yes' : 'no' };
        if (r.non_l1) protocolOf(db).check(actor, 'CP-PROC-04', { entity: 'proc_cs', entityId: String(r.id), ref: r.doc_no, lines: sel.length, reason: `${r.reason_code}: ${r.justification}`, message: `${r.doc_no}: a vendor who is not the L1 is chosen (${r.reason_code}).` });
        if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: CS_DOC, docId: String(r.id), comment: `${r.doc_no}: ${rs(r.total_value)}${r.non_l1 ? ' (not L1)' : ''}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_comparative_statements SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE proc_comparative_statements SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'proc_comparative_statements', r.id, 'submit', r.company_id, { newValues: { total: rs(r.total_value), nonL1: Boolean(r.non_l1), level } }); return css.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a statement waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return css.get(actor, r.id); },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.comparative_statement.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'APPROVED'].includes(r.status)) throw unprocessable('Only a statement that is not closed is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); db.prepare("UPDATE proc_comparative_statements SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), r.id); audit(actor, 'proc_comparative_statements', r.id, 'cancel', r.company_id, { reason }); evt('proc.cs.cancelled', actor, r, { reason, wasApproved: r.status === 'APPROVED' }); return css.get(actor, r.id); });
    },
    /** An approved statement is amended by a new revision, with the matrix made again from the quotations, that replaces it when approved. */
    amend(actor, id, { reason }) {
      const r = row(actor, id, 'proc.comparative_statement.amend'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved statement is amended.'); if (db.prepare("SELECT 1 FROM proc_comparative_statements WHERE parent_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this statement is already open.'); const rfq = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(r.rfq_id);
      return transaction(db, () => { const no = `${r.doc_no.split('/R')[0]}/R${r.revision_no + 1}`; const keep = new Map(csLines(r.id).map((c) => [`${c.rfq_line_id}:${c.vendor_id}`, { compliance: c.compliance, selected: c.selected_qty }]));
        const nid = Number(db.prepare("INSERT INTO proc_comparative_statements (company_id, doc_no, doc_date, rfq_id, org_project_id, recommendation_type, reason_code, justification, status, revision_no, parent_id, requested_by, project_id, created_by, source_type, source_id, remarks) VALUES (?, ?, ?, ?, ?, 'CUSTOM', ?, ?, 'DRAFT', ?, ?, ?, ?, ?, 'amendment', ?, ?)").run(r.company_id, no, todayIST(), r.rfq_id, r.org_project_id, r.reason_code, r.justification, r.revision_no + 1, r.id, actor.user, r.org_project_id, actor.user, String(r.id), reason).lastInsertRowid);
        const n = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ?').get(nid); writeMatrix(rfq, n, keep); applySelection(rfq, n, csLines(nid).filter((c) => c.selected_qty > 0).map((c) => ({ rfqLineId: c.rfq_line_id, vendorId: c.vendor_id, qty: c.selected_qty }))); audit(actor, 'proc_comparative_statements', nid, 'amend', r.company_id, { reason, newValues: { of: r.doc_no } }); return css.get(actor, nid); });
    },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('proc_comparative_statements', 'proc_cs_negotiations') AND entity_id = ? ORDER BY id").all(String(r.id)) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.comparative_statement.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_comparative_statements', r.id, 'print', r.company_id);
      const columns = [{ key: 'item', label: 'Item', type: 'text' }, { key: 'qty', label: 'Quantity', type: 'text' }, ...v.vendors.map((x) => ({ key: `v${x.vendorId}`, label: x.name, type: 'text' })), { key: 'bench', label: 'Last PO / estimate', type: 'text' }, { key: 'sel', label: 'Selected', type: 'text' }];
      const rows = v.lines.map((l) => ({ item: `${l.lineNo}. ${l.itemCode ? `${l.itemCode} ` : ''}${l.itemName}`, qty: `${l.qty} ${l.uom}`, ...Object.fromEntries(l.cells.map((c) => [`v${c.vendorId}`, c.quoted ? `${c.landedRate} (L${c.rank})${c.compliance !== 'YES' ? ` ${c.compliance}` : ''}${c.selectedQty > 0 ? ' *' : ''}` : '—'])), bench: `${l.benchmarks.lastPo ?? '—'} / ${l.benchmarks.budget ?? '—'}`, sel: String(l.selectedQty) }));
      const footer = [`${v.docNo}: ${v.rfqNo} ${v.rfqTitle}. ${v.projectCode}. ${v.recommendationLabel}. * = selected`, `Value ${v.totalValue}; against the estimate ${v.savingsVsBudget}`, v.nonL1 ? `Not the L1 (${v.reasonCode}): ${v.justification}` : '', ...v.vendors.map((x) => `${x.name}: ${x.quotationNo} v${x.versionNo}, delivery ${x.deliveryDays} days, ${x.paymentTerms ?? 'payment terms not stated'}, valid to ${x.validUntil}${x.totalLanded != null ? `, total ${x.totalLanded}` : ''}`), `Prepared by ${v.requestedBy}${v.approvedBy ? `; approved by ${v.approvedBy}` : ''}`].filter(Boolean);
      return { buffer: toPdf({ columns, rows, footer, title: `Comparative statement ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_comparative_statements WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') {
        db.prepare("UPDATE proc_comparative_statements SET status = 'APPROVED', approved_by = ?, approved_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, actor.user, now, r.id);
        if (r.parent_id) { db.prepare("UPDATE proc_comparative_statements SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE id = ?").run(now, r.parent_id); }
        db.prepare("UPDATE proc_rfqs SET status = 'CLOSED', closed_at = COALESCE(closed_at, ?), updated_at = ?, version = version + 1 WHERE id = ? AND status = 'ISSUED'").run(now, now, r.rfq_id); db.prepare("UPDATE proc_rfq_vendors SET token_expires = ? WHERE rfq_id = ? AND token_hash IS NOT NULL AND deleted_at IS NULL").run(now, r.rfq_id);
        audit(actor, 'proc_comparative_statements', r.id, 'approve', r.company_id);
        const awards = db.prepare('SELECT c.*, l.item_id, l.service_desc, l.uom, l.pr_line_id, l.delivery_site_id, l.required_by, ql.rate, ql.gst_rate, ql.make FROM proc_cs_lines c JOIN proc_rfq_lines l ON l.id = c.rfq_line_id JOIN proc_quotation_lines ql ON ql.id = c.quotation_line_id WHERE c.cs_id = ? AND c.selected_qty > 0 AND c.deleted_at IS NULL ORDER BY l.line_no, c.rank_no').all(r.id)
          .map((c) => ({ rfqLineId: c.rfq_line_id, prLineId: c.pr_line_id, itemId: c.item_id, serviceDesc: c.service_desc, vendorId: c.vendor_id, quotationId: c.quotation_id, qty: c.selected_qty, uom: c.uom, rate: c.rate, landedRate: c.landed_rate, gstRate: c.gst_rate, make: c.make, requiredBy: c.required_by, deliverySiteId: c.delivery_site_id }));
        evt('proc.cs.approved', actor, r, { totalValue: r.total_value, nonL1: Boolean(r.non_l1), supersedes: r.parent_id, awards });
        notify(r.company_id, 'proc.cs.approved', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `The comparative statement ${r.doc_no} is approved: the order can be made.`, `/proc/comparative-statements?id=${r.id}`, r.id, { projectId: r.org_project_id }); return;
      }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = outcome === 'RETURNED' ? 'RETURNED' : outcome === 'REJECTED' ? 'REJECTED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_comparative_statements SET status = ?, workflow_instance_id = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_comparative_statements', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') { evt('proc.cs.rejected', actor, r, { reason: comment }); notify(r.company_id, 'proc.cs.rejected', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `The comparative statement ${r.doc_no} was not approved${comment ? `: ${comment}` : ''}.`, `/proc/comparative-statements?id=${r.id}`, r.id, { projectId: r.org_project_id }); }
      if (outcome === 'RETURNED') notify(r.company_id, 'proc.cs.returned', [`user:${r.requested_by}`], r.doc_no, r.doc_no, `The comparative statement ${r.doc_no} was returned${comment ? `: ${comment}` : ''}.`, `/proc/comparative-statements?id=${r.id}`, `${r.id}.r`, { projectId: r.org_project_id });
    },
  };
  return { css, decide: css.decide };
}
