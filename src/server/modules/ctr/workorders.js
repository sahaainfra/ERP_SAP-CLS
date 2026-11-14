import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { budOf } from '../bud/budgets.js';
import { nowIso, rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';

// Subcontract work orders (part 21.03): item-rate, labour-rate and lump-sum work orders against the BOQ and work packages, with terms (retention, security deposit, advance and its recovery, free-issue materials with wastage, TDS, GST, payment, LD), the back-to-back
// mapping of each item to the client BOQ for margin (BR-01: a rate above the client rate is a negative margin and needs the director as well), the budget quantity check (BR-02: beyond it a work order needs an approved exception), amendments through the same approval
// with the commitment moved by the difference (T-01), acceptance by the subcontractor and closure with the final bill. Money is paise inside and rupees in the API; rates are x10000 inside (as the BOQ), quantities x1000, percentages basis points.
controlRegistry.define({ code: 'CP-CTR-01', module: 'ctr', stage: 'VERIFY', description: 'A work order quantity beyond the budget quantity of a BOQ item needs an approved exception', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PD', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'The quantity is beyond the budget quantity', details: { over: context.over ?? null, project: context.project ?? null } }) });
export const WO_TYPE = { ITEM_RATE: 'Item rate', LABOUR_RATE: 'Labour rate (labour only)', LUMP_SUM: 'Lump sum with milestones' };
export const WO_STATE = { PREPARING: 'Being prepared', ISSUED: 'Issued', ACCEPTED: 'Accepted', CLOSED: 'Closed' };
const rs = (p) => (p == null ? null : Math.round(p) / 100); const paise = (r) => Math.round(Number(r) * 100); const bp = (p) => Math.round(Number(p) * 100); const pc = (b) => (b ?? 0) / 100;
const q3 = (x) => Math.round(Number(x) * 1000); const d3 = (t) => t / 1000; const r4 = (x) => Math.round(Number(x) * 10000); const dr = (t) => t / 10000;
/** qty (x1000) x rate (x10000) = paise, rounded once. */
export const amountOf = (qtyTh, rateX4) => Math.round((qtyTh * rateX4) / 100000);
/** T-01 / BR-01: the margin of an item against the client BOQ: client amount less our amount at the same quantity; negative when our rate is above the client's. */
export const marginOf = (qtyTh, rateX4, clientRateX4) => { const own = amountOf(qtyTh, rateX4); const client = amountOf(qtyTh, clientRateX4); return { client, own, margin: client - own, marginBp: client > 0 ? Math.round(((client - own) * 10000) / client) : null, negative: clientRateX4 > 0 && rateX4 > clientRateX4 }; };
const BAND_PD = 1_000_000_00; const BAND_DIR = 5_000_000_00; // paise: PD above Rs 10 lakh, the director above Rs 50 lakh

export const woList = defineList({ code: 'ctr.work_orders', label: 'Work orders', permission: 'ctr.work_order.view', from: 'ctr_work_orders x JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners s ON s.id = x.subcontractor_id', where: "x.deleted_at IS NULL AND x.status <> 'CANCELLED'", searchable: ['x.doc_no', 'x.wo_no', 'x.title', 's.legal_name', 'p.code'], defaultSort: 'docNo',
  columns: { docNo: { sql: 'x.doc_no', type: 'text', label: 'Record' }, woNo: { sql: 'x.wo_no', type: 'text', label: 'Work order' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, subcontractor: { sql: 's.legal_name', type: 'text', label: 'Subcontractor' }, type: { sql: 'x.wo_type', type: 'enum', label: 'Type', options: Object.entries(WO_TYPE) }, value: { sql: 'x.value_paise', type: 'money', label: 'Value' }, endDate: { sql: 'x.end_date', type: 'date', label: 'Ends' }, state: { sql: 'x.wo_state', type: 'enum', label: 'State', options: Object.entries(WO_STATE) }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) } } });

export function createWorkOrderService({ db, base, flags }) {
  const { audit, fail, may, notify } = base; void flags; const { evt, gate, scopeOf, pcode, projectOk } = qaHelpers({ db, base }); const today = () => todayIST(); const sys = (cid, user = 'system') => ({ user, companyId: cid, roles: ['SYSTEM'] });
  const partner = (id) => (id ? db.prepare('SELECT legal_name FROM mdm_partners WHERE id = ?').get(id)?.legal_name ?? null : null);
  const itemsOf = (woId) => db.prepare('SELECT * FROM ctr_wo_items WHERE wo_id = ? AND deleted_at IS NULL ORDER BY line_no').all(woId);
  const freeOf = (woId) => db.prepare('SELECT f.*, i.name AS item_name, i.code AS item_code FROM ctr_wo_free_issue f JOIN mdm_items i ON i.id = f.item_id WHERE f.wo_id = ? AND f.deleted_at IS NULL ORDER BY f.id').all(woId);
  /** The budget quantity of a BOQ line (current approved budget) and what other live work orders already hold of it. */
  function budgetOf(projectId, boqLineId, excludeWo = 0) {
    if (!boqLineId) return { budget: 0, other: 0 };
    const cur = db.prepare("SELECT id FROM bud_budgets WHERE org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY version_no DESC, id DESC LIMIT 1").get(projectId);
    const budget = cur ? db.prepare('SELECT COALESCE(SUM(qty), 0) AS s FROM bud_lines WHERE budget_id = ? AND boq_line_id = ? AND deleted_at IS NULL').get(cur.id, boqLineId).s : 0;
    const other = db.prepare("SELECT COALESCE(SUM(i.qty_th), 0) AS s FROM ctr_wo_items i JOIN ctr_work_orders w ON w.id = i.wo_id WHERE i.boq_line_id = ? AND i.deleted_at IS NULL AND w.deleted_at IS NULL AND w.status = 'APPROVED' AND w.wo_state <> 'CLOSED' AND w.id <> ?").get(boqLineId, excludeWo).s;
    return { budget, other };
  }
  const boqOk = (projectId, lineId, field) => { if (!lineId) return null; const l = db.prepare('SELECT l.*, v.org_project_id AS pj FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ? AND l.deleted_at IS NULL').get(rid(lineId)); if (!l || l.pj !== projectId) fail([{ field, message: 'Not an item of the BOQ of this project' }]); return l; };
  /** The rows of the items worked out on the server: amounts, the client rate of the mapped item, the margin. */
  function buildItems(projectId, items) {
    return items.map((x, i) => {
      const kind = x.itemKind ?? 'BOQ'; const boq = boqOk(projectId, x.boqLineId, `items.${i}.boqLineId`); const cl = boqOk(projectId, x.clientBoqLineId, `items.${i}.clientBoqLineId`);
      if (kind === 'BOQ' && !boq) fail([{ field: `items.${i}.boqLineId`, message: 'A BOQ item names its BOQ line' }]); if (kind === 'MILESTONE' && !x.dueDate) fail([{ field: `items.${i}.dueDate`, message: 'A milestone has a due date' }]);
      const qty = q3(kind === 'MILESTONE' ? 1 : x.qty); const rate = r4(x.rate); if (kind !== 'MILESTONE' && qty <= 0) fail([{ field: `items.${i}.qty`, message: 'The quantity is more than zero' }]);
      return { line_no: i + 1, item_kind: kind, boq_line_id: boq?.id ?? null, description: x.description, uom: x.uom ?? boq?.uom ?? null, qty_th: qty, rate_x4: rate, amount_paise: amountOf(qty, rate), wbs_id: x.wbsId ?? null, client_boq_line_id: cl?.id ?? null, client_rate_x4: cl?.rate ?? 0, due_date: x.dueDate ?? null };
    });
  }
  const saveItems = (actor, woId, projectId, rows) => {
    db.prepare('UPDATE ctr_wo_items SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE wo_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, woId);
    for (const x of rows) db.prepare('INSERT INTO ctr_wo_items (company_id, wo_id, line_no, item_kind, boq_line_id, description, uom, qty_th, rate_x4, amount_paise, wbs_id, client_boq_line_id, client_rate_x4, due_date, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, woId, x.line_no, x.item_kind, x.boq_line_id, x.description, x.uom, x.qty_th, x.rate_x4, x.amount_paise, x.wbs_id, x.client_boq_line_id, x.client_rate_x4, x.due_date, projectId, actor.user, 'manual');
  };
  const saveFree = (actor, woId, projectId, free) => {
    db.prepare('UPDATE ctr_wo_free_issue SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE wo_id = ? AND deleted_at IS NULL').run(nowIso(), actor.user, woId);
    for (const f of free) { if (!db.prepare('SELECT 1 FROM mdm_items WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(f.itemId), actor.companyId)) fail([{ field: 'freeIssue', message: 'Not an item of the material master' }]); db.prepare('INSERT INTO ctr_wo_free_issue (company_id, wo_id, item_id, uom, norm_th, wastage_bp, chargeable_rate_x4, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, woId, f.itemId, f.uom ?? null, q3(f.norm), bp(f.wastagePct ?? 0), r4(f.chargeableRate ?? 0), projectId, actor.user, 'manual'); }
  };
  /** Totals, margin and budget flags of a work order from its saved items (BR-01, BR-02). */
  function recompute(woId) {
    const w = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(woId); const its = itemsOf(woId);
    const value = its.reduce((n, x) => n + x.amount_paise, 0); const negative = its.some((x) => marginOf(x.qty_th, x.rate_x4, x.client_rate_x4).negative);
    const over = its.some((x) => { const b = budgetOf(w.org_project_id, x.boq_line_id, w.id); return b.budget > 0 && b.other + x.qty_th > b.budget; });
    db.prepare('UPDATE ctr_work_orders SET value_paise = ?, negative_margin = ?, over_budget = ? WHERE id = ?').run(value, negative ? 1 : 0, over ? 1 : 0, woId);
    return db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(woId);
  }
  const termsCols = (b, r = {}) => ({ wo_no: b.woNo ?? r.wo_no, wo_type: b.woType ?? r.wo_type, contract_id: 'contractId' in b ? b.contractId : r.contract_id, subcontractor_id: b.subcontractorId ?? r.subcontractor_id, work_package_id: 'workPackageId' in b ? b.workPackageId : r.work_package_id, cs_id: 'csId' in b ? b.csId : r.cs_id, selection_kind: b.selectionKind ?? r.selection_kind ?? 'NEGOTIATED', justification: 'justification' in b ? b.justification : r.justification, title: b.title ?? r.title, scope_text: 'scopeText' in b ? b.scopeText : r.scope_text, start_date: b.startDate ?? r.start_date, end_date: b.endDate ?? r.end_date,
    retention_bp: 'retentionPct' in b ? bp(b.retentionPct) : r.retention_bp ?? 0, sd_bp: 'sdPct' in b ? bp(b.sdPct) : r.sd_bp ?? 0, advance_bp: 'advancePct' in b ? bp(b.advancePct) : r.advance_bp ?? 0, advance_recovery_bp: 'advanceRecoveryPct' in b ? bp(b.advanceRecoveryPct) : r.advance_recovery_bp ?? 0, tds_section: 'tdsSection' in b ? b.tdsSection : r.tds_section, gst_mode: b.gstMode ?? r.gst_mode ?? 'FORWARD', gst_bp: 'gstPct' in b ? bp(b.gstPct) : r.gst_bp ?? 1800, payment_days: b.paymentDays ?? r.payment_days ?? 30, ld_bp: 'ldPct' in b ? bp(b.ldPct) : r.ld_bp ?? 0, ld_cap_bp: 'ldCapPct' in b ? bp(b.ldCapPct) : r.ld_cap_bp ?? 0, safety_penalty_paise: 'safetyPenalty' in b ? paise(b.safetyPenalty) : r.safety_penalty_paise ?? 0, terms_json: 'terms' in b ? JSON.stringify(b.terms) : r.terms_json ?? '{}' });
  const checkLinks = (actor, pj, c) => {
    const p = db.prepare('SELECT partner_status FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(c.subcontractor_id), actor.companyId); if (!p) fail([{ field: 'subcontractorId', message: 'Not a business partner of this company' }]); if (p.partner_status !== 'ACTIVE') fail([{ field: 'subcontractorId', message: 'The subcontractor is not active' }]);
    if (!db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role IN ('SUBCONTRACTOR', 'LABOUR_CONTRACTOR', 'SERVICE_PROVIDER') AND deleted_at IS NULL").get(rid(c.subcontractor_id))) fail([{ field: 'subcontractorId', message: 'This partner is not a subcontractor or labour contractor' }]);
    if (c.contract_id && !db.prepare("SELECT 1 FROM ctr_contracts WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL").get(rid(c.contract_id), actor.companyId, pj)) fail([{ field: 'contractId', message: 'Not a contract of this project' }]);
    if (c.work_package_id && !db.prepare("SELECT 1 FROM proj_work_packages WHERE id = ? AND company_id = ? AND project_id = ? AND deleted_at IS NULL").get(rid(c.work_package_id), actor.companyId, pj)) fail([{ field: 'workPackageId', message: 'Not a work package of this project' }]);
    if (c.cs_id && !db.prepare("SELECT 1 FROM proc_comparative_statements WHERE id = ? AND company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(rid(c.cs_id), actor.companyId, pj)) fail([{ field: 'csId', message: 'Not an approved comparative statement of this project' }]);
    if (c.end_date < c.start_date) fail([{ field: 'endDate', message: 'The work order ends before it starts' }]);
  };
  /** What stops a work order from being sent. */
  function problemsOf(r) {
    const p = []; const its = itemsOf(r.id);
    if (!its.length) p.push({ field: 'items', message: 'Add at least one item' });
    if (r.wo_type === 'LUMP_SUM' && its.some((x) => x.item_kind !== 'MILESTONE')) p.push({ field: 'items', message: 'A lump-sum work order is made of milestones' });
    if (r.wo_type !== 'LUMP_SUM' && its.some((x) => x.item_kind === 'MILESTONE')) p.push({ field: 'items', message: 'Milestones belong to a lump-sum work order' });
    if (its.some((x) => x.item_kind !== 'MILESTONE' && x.rate_x4 <= 0)) p.push({ field: 'items', message: 'Every item has a rate' });
    if (r.selection_kind === 'CS' && !r.cs_id) p.push({ field: 'csId', message: 'Name the approved comparative statement' });
    if (r.selection_kind === 'NEGOTIATED' && (r.justification ?? '').trim().length < 10) p.push({ field: 'justification', message: 'A negotiated award needs its justification (at least 10 characters)' });
    if (r.advance_bp > 0 && r.advance_recovery_bp <= 0) p.push({ field: 'advanceRecoveryPct', message: 'Say how much of each bill recovers the advance' });
    if (r.wo_type === 'LABOUR_RATE' && !freeOf(r.id).length) p.push({ field: 'freeIssue', message: 'A labour-rate work order lists the materials issued free' });
    if (r.value_paise <= 0) p.push({ field: 'items', message: 'The work order has no value' });
    return p;
  }
  const ctxOf = (r) => { const v = r.value_paise; return { amount: rs(v), needsPd: v > BAND_PD ? 1 : 0, needsDir: v > BAND_DIR || r.negative_margin === 1 ? 1 : 0, negativeMargin: r.negative_margin, overBudget: r.over_budget, woType: r.wo_type }; };
  /** BR-02: quantity beyond the budget needs an approved exception (04.04). */
  function budgetCheck(actor, r) {
    const pj = pcode(r.org_project_id); const over = itemsOf(r.id).map((x) => { const b = budgetOf(r.org_project_id, x.boq_line_id, r.id); return b.budget > 0 && b.other + x.qty_th > b.budget ? { x, over: b.other + x.qty_th - b.budget, budget: b.budget } : null; }).filter(Boolean);
    if (!over.length) return; const worst = over[0];
    protocolOf(db).enforce(actor, 'CP-CTR-01', { entity: 'ctr_work_orders', entityId: String(r.id), amount: d3(over.reduce((n, o) => n + o.over, 0)), valueAtRisk: rs(r.value_paise), ref: r.doc_no, project: pj, over: d3(worst.over), message: `Item ${worst.x.line_no} (${worst.x.description}) is ${d3(worst.over)} beyond the budget quantity ${d3(worst.budget)}` });
  }
  const commitLines = (r) => itemsOf(r.id).map((x) => ({ lineId: String(x.line_no), wbsId: x.wbs_id ?? undefined, resourceType: 'SUBCONTRACT', qty: d3(x.qty_th), amount: rs(x.amount_paise), description: x.description }));
  /** The commitment of the work order in the budget ledger (12.03); the same lines again move it by the difference (T-01). */
  const commitWo = (actor, r) => { const bud = budOf(db)?.ledger; if (!bud || !db.prepare('SELECT 1 FROM proj_projects WHERE project_id = ? AND deleted_at IS NULL').get(r.org_project_id)) return null; return bud.commitments.commit(sys(r.company_id, actor.user), { projectId: r.org_project_id, stage: 'WO', sourceType: 'ctr_work_order', sourceId: String(r.id), docRef: r.doc_no, vendorRef: String(r.subcontractor_id), vendorName: partner(r.subcontractor_id), lines: commitLines(r) }); };
  const woData = (r) => ({ workOrderId: r.id, docNo: r.doc_no, woNo: r.wo_no, woType: r.wo_type, projectId: r.org_project_id, siteId: r.org_site_id, contractId: r.contract_id, subcontractorId: r.subcontractor_id, subcontractor: partner(r.subcontractor_id), workPackageId: r.work_package_id, value: rs(r.value_paise), startDate: r.start_date, endDate: r.end_date, retentionPct: pc(r.retention_bp), sdPct: pc(r.sd_bp), advancePct: pc(r.advance_bp), advanceRecoveryPct: pc(r.advance_recovery_bp), tdsSection: r.tds_section, gstMode: r.gst_mode, gstPct: pc(r.gst_bp), paymentDays: r.payment_days, ldPct: pc(r.ld_bp), amendmentNo: r.amendment_no, negativeMargin: r.negative_margin === 1,
    items: itemsOf(r.id).map((x) => ({ lineNo: x.line_no, boqLineId: x.boq_line_id, description: x.description, uom: x.uom, qty: d3(x.qty_th), rate: dr(x.rate_x4), amount: rs(x.amount_paise), wbsId: x.wbs_id })), freeIssue: freeOf(r.id).map((f) => ({ itemId: f.item_id, norm: d3(f.norm_th), wastagePct: pc(f.wastage_bp), chargeableRate: dr(f.chargeable_rate_x4) })) });
  const wf = new Map();
  const flow = createFlow({ db, base, docType: 'CTR_WORK_ORDER', table: 'ctr_work_orders', perm: 'ctr.work_order', label: 'work order', route: '/ctr/work-orders?id=', ctx: ctxOf, title: (r) => `${r.wo_no} ${r.title}`, notifyCode: 'ctr.wo.decided', numberKey: 'CTR_WORK_ORDER', prefix: 'WOR',
    beforeSubmit: (actor, r) => { const f = recompute(r.id); const p = problemsOf(f); if (p.length) fail(p); budgetCheck(actor, f); },
    onApproved: (actor, r) => {
      const f = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(r.id); db.prepare("UPDATE ctr_work_orders SET wo_state = 'ISSUED' WHERE id = ?").run(r.id); commitWo(actor, f);
      evt('ctr.wo.approved', actor, r.company_id, 'ctr_work_orders', r.id, woData(f), r.org_project_id); notify(r.company_id, 'ctr.wo.accepted', ['role:SUBCO', 'role:COMMGR'], r.wo_no, 'work order issued', `${r.wo_no} (${r.title}) to ${partner(r.subcontractor_id)} is approved: send it to the subcontractor for acceptance.`, `/ctr/work-orders?id=${r.id}`, `${r.id}.issued`, { projectId: r.org_project_id });
    } });
  void wf;
  const margins = (actor, r) => itemsOf(r.id).map((x) => { const m = marginOf(x.qty_th, x.rate_x4, x.client_rate_x4); return { lineNo: x.line_no, description: x.description, qty: d3(x.qty_th), rate: dr(x.rate_x4), clientRate: x.client_rate_x4 ? dr(x.client_rate_x4) : null, amount: rs(m.own), clientAmount: x.client_rate_x4 ? rs(m.client) : null, margin: x.client_rate_x4 ? rs(m.margin) : null, marginPct: m.marginBp == null ? null : m.marginBp / 100, negative: m.negative, mapped: x.client_rate_x4 > 0 }; });
  const canMargin = (actor, r) => may(actor, 'ctr.work_order.margin', r.org_project_id, r.org_site_id);
  const view = (actor, r, detail = false) => {
    const can0 = flow.can(actor, r); const live = r.status === 'APPROVED';
    const o = { id: r.id, docNo: r.doc_no, woNo: r.wo_no, woType: r.wo_type, typeLabel: WO_TYPE[r.wo_type], title: r.title, projectId: r.org_project_id, project: pcode(r.org_project_id), siteId: r.org_site_id, contractId: r.contract_id, contractNo: r.contract_id ? db.prepare('SELECT contract_no FROM ctr_contracts WHERE id = ?').get(r.contract_id)?.contract_no : null, subcontractorId: r.subcontractor_id, subcontractor: partner(r.subcontractor_id), workPackageId: r.work_package_id, csId: r.cs_id, selectionKind: r.selection_kind, justification: r.justification, startDate: r.start_date, endDate: r.end_date, value: rs(r.value_paise),
      state: r.wo_state, stateLabel: WO_STATE[r.wo_state], amendmentNo: r.amendment_no, overBudget: r.over_budget === 1, negativeMargin: canMargin(actor, r) ? r.negative_margin === 1 : null, status: r.status, statusLabel: STATUS[r.status], version: r.version, requestedBy: r.requested_by, acceptedBy: r.accepted_by, acceptedAt: r.accepted_at, closedOn: r.closed_on, finalBillRef: r.final_bill_ref,
      can: { ...can0, accept: live && r.wo_state === 'ISSUED' && may(actor, 'ctr.work_order.accept', r.org_project_id, r.org_site_id), close: live && ['ISSUED', 'ACCEPTED'].includes(r.wo_state) && may(actor, 'ctr.work_order.close', r.org_project_id, r.org_site_id), amend: live && r.wo_state !== 'CLOSED' && may(actor, 'ctr.work_order.amend', r.org_project_id, r.org_site_id) && !db.prepare("SELECT 1 FROM ctr_wo_amendments WHERE wo_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id) } };
    if (detail) {
      const its = itemsOf(r.id); const mg = canMargin(actor, r); const tm = margins(actor, r);
      Object.assign(o, flow.approveInfo(actor, r), { scopeText: r.scope_text, cancelReason: r.cancel_reason, closeNote: r.close_note, acceptanceRef: r.acceptance_ref, retentionPct: pc(r.retention_bp), sdPct: pc(r.sd_bp), advancePct: pc(r.advance_bp), advanceRecoveryPct: pc(r.advance_recovery_bp), tdsSection: r.tds_section, gstMode: r.gst_mode, gstPct: pc(r.gst_bp), paymentDays: r.payment_days, ldPct: pc(r.ld_bp), ldCapPct: pc(r.ld_cap_bp), safetyPenalty: rs(r.safety_penalty_paise), terms: JSON.parse(r.terms_json || '{}'), problems: ['DRAFT', 'RETURNED'].includes(r.status) ? problemsOf(r) : [],
        items: its.map((x, i) => ({ id: x.id, lineNo: x.line_no, itemKind: x.item_kind, boqLineId: x.boq_line_id, description: x.description, uom: x.uom, qty: d3(x.qty_th), rate: dr(x.rate_x4), amount: rs(x.amount_paise), wbsId: x.wbs_id, clientBoqLineId: x.client_boq_line_id, dueDate: x.due_date, executed: d3(x.executed_qty_th), billed: d3(x.billed_qty_th), ...(mg ? { clientRate: tm[i].clientRate, margin: tm[i].margin, marginPct: tm[i].marginPct, negative: tm[i].negative } : {}) })),
        freeIssue: freeOf(r.id).map((f) => ({ id: f.id, itemId: f.item_id, item: `${f.item_code} ${f.item_name}`, uom: f.uom, norm: d3(f.norm_th), wastagePct: pc(f.wastage_bp), chargeableRate: dr(f.chargeable_rate_x4) })),
        amendments: db.prepare('SELECT * FROM ctr_wo_amendments WHERE wo_id = ? AND deleted_at IS NULL ORDER BY amendment_no').all(r.id).map((a) => ({ id: a.id, docNo: a.doc_no, no: a.amendment_no, description: a.description, delta: rs(a.delta_paise), newEndDate: a.new_end_date, status: a.status, statusLabel: STATUS[a.status] })),
        clientTerms: r.contract_id ? (() => { const k = db.prepare('SELECT contract_no, retention_bp, ld_rate_bp, ld_cap_bp FROM ctr_contracts WHERE id = ?').get(r.contract_id); return { contractNo: k.contract_no, retentionPct: pc(k.retention_bp), ldPct: pc(k.ld_rate_bp), ldCapPct: pc(k.ld_cap_bp), clauses: db.prepare("SELECT clause_no AS clauseNo, title, category, summary, time_bar_days AS timeBarDays FROM ctr_clauses WHERE contract_id = ? AND deleted_at IS NULL AND category IN ('NOTICE', 'TIME_BAR', 'PAYMENT', 'LD', 'INSURANCE', 'SECURITY') ORDER BY clause_no").all(r.contract_id) }; })() : null,
        marginTotals: mg ? { client: rs(tm.reduce((n, x) => n + (x.clientAmount != null ? paise(x.clientAmount) : 0), 0)), own: rs(tm.filter((x) => x.mapped).reduce((n, x) => n + paise(x.amount), 0)), margin: rs(tm.reduce((n, x) => n + (x.margin != null ? paise(x.margin) : 0), 0)) } : null,
        recoveries: { advance: rs(Math.round((r.value_paise * r.advance_bp) / 10000)), retention: rs(Math.round((r.value_paise * r.retention_bp) / 10000)), securityDeposit: rs(Math.round((r.value_paise * r.sd_bp) / 10000)) },
        commitment: (() => { const c = db.prepare("SELECT COALESCE(SUM(amount), 0) AS a, COALESCE(SUM(consumed_amount), 0) AS c FROM bud_commitments WHERE company_id = ? AND src_type = 'ctr_work_order' AND src_id = ? AND deleted_at IS NULL").get(r.company_id, String(r.id)); return { committed: rs(c.a), consumed: rs(c.c) }; })() });
    }
    return o;
  };
  const wos = {
    ...flow,
    list(actor, query) { return runList(db, woList, parseListRequest(woList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'ctr.work_order.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get: (actor, id) => view(actor, flow.row(actor, id), true),
    options(actor) {
      gate(actor, 'ctr.work_order.create', 'create work orders'); const pjs = db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'ctr.work_order.create', p.id));
      return { projects: pjs, contracts: db.prepare("SELECT id, contract_no AS contractNo, org_project_id AS projectId FROM ctr_contracts WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY contract_no").all(actor.companyId),
        subcontractors: db.prepare("SELECT DISTINCT p.id, p.legal_name AS name FROM mdm_partners p JOIN mdm_partner_roles r ON r.partner_id = p.id AND r.deleted_at IS NULL WHERE p.company_id = ? AND p.deleted_at IS NULL AND p.partner_status = 'ACTIVE' AND r.partner_role IN ('SUBCONTRACTOR', 'LABOUR_CONTRACTOR', 'SERVICE_PROVIDER') ORDER BY p.legal_name LIMIT 500").all(actor.companyId),
        packages: db.prepare("SELECT id, code, name, project_id AS projectId FROM proj_work_packages WHERE company_id = ? AND deleted_at IS NULL AND wp_type = 'SUBCONTRACT' AND wp_status = 'ACTIVE' ORDER BY code LIMIT 500").all(actor.companyId),
        statements: db.prepare("SELECT id, doc_no AS docNo, org_project_id AS projectId FROM proc_comparative_statements WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY id DESC LIMIT 200").all(actor.companyId),
        boqLines: db.prepare("SELECT l.id, l.item_code AS code, l.description, l.uom, l.qty, l.rate, v.org_project_id AS projectId FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.company_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') AND v.status = 'APPROVED' AND v.deleted_at IS NULL ORDER BY v.org_project_id, l.item_code LIMIT 2000").all(actor.companyId).map((l) => ({ ...l, qty: d3(l.qty), rate: dr(l.rate) })),
        items: db.prepare('SELECT id, code, name FROM mdm_items WHERE company_id = ? AND deleted_at IS NULL ORDER BY code LIMIT 500').all(actor.companyId), tdsSections: db.prepare("SELECT section, description FROM mdm_tds_sections WHERE (company_id = ? OR company_id IS NULL) AND row_status = 'ACTIVE' AND deleted_at IS NULL ORDER BY section").all(actor.companyId), types: Object.entries(WO_TYPE).map(([id, label]) => ({ id, label })) };
    },
    create(actor, b) {
      const pj = projectOk(actor, b.projectId, 'ctr.work_order.create'); const c = termsCols(b); checkLinks(actor, pj.id, c); if (db.prepare('SELECT 1 FROM ctr_work_orders WHERE company_id = ? AND wo_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, c.wo_no)) throw conflict('This work order number is used already.');
      const rows = buildItems(pj.id, b.items ?? []); const calc = rows.reduce((n, x) => n + x.amount_paise, 0); if (b.value != null && paise(b.value) !== calc) fail([{ field: 'value', message: `The value is worked out by the server: ${rs(calc)}` }]);
      return transaction(db, () => { const no = flow.next(actor); const k = Object.keys(c); const id = Number(db.prepare(`INSERT INTO ctr_work_orders (company_id, doc_no, org_project_id, org_site_id, ${k.join(', ')}, created_by, source_type) VALUES (?, ?, ?, ?, ${k.map(() => '?').join(', ')}, ?, ?)`).run(actor.companyId, no, pj.id, b.siteId ?? null, ...Object.values(c).map((v) => (v === undefined ? null : v)), actor.user, 'manual').lastInsertRowid); saveItems(actor, id, pj.id, rows); saveFree(actor, id, pj.id, b.freeIssue ?? []); recompute(id); audit(actor, 'ctr_work_orders', id, 'create', actor.companyId); return wos.get(actor, id); });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.work_order.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved work order is changed by an amendment.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this; reload it.');
      const c = termsCols(b, r); checkLinks(actor, r.org_project_id, c); if (c.wo_no.toLowerCase() !== r.wo_no.toLowerCase() && db.prepare('SELECT 1 FROM ctr_work_orders WHERE company_id = ? AND wo_no = ? COLLATE NOCASE AND deleted_at IS NULL AND id <> ?').get(actor.companyId, c.wo_no, r.id)) throw conflict('This work order number is used already.');
      const rows = b.items ? buildItems(r.org_project_id, b.items) : null; if (rows && b.value != null && paise(b.value) !== rows.reduce((n, x) => n + x.amount_paise, 0)) fail([{ field: 'value', message: 'The value is worked out by the server' }]);
      return transaction(db, () => { const k = Object.keys(c); db.prepare(`UPDATE ctr_work_orders SET ${k.map((x) => `${x} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(c).map((v) => (v === undefined ? null : v)), actor.user, nowIso(), r.id); if (rows) saveItems(actor, r.id, r.org_project_id, rows); if (b.freeIssue) saveFree(actor, r.id, r.org_project_id, b.freeIssue); recompute(r.id); audit(actor, 'ctr_work_orders', r.id, 'update', r.company_id); return wos.get(actor, r.id); });
    },
    remove: (actor, id) => flow.remove(actor, id), submit(actor, id) { flow.submit(actor, id); return wos.get(actor, id); }, withdraw: (actor, id, b) => { flow.withdraw(actor, id, b); return wos.get(actor, id); }, cancel: (actor, id, b) => { flow.cancel(actor, id, b); return wos.get(actor, id); },
    history: (actor, id) => flow.history(actor, id),
    /** FR-05: the subcontractor accepts the issued work order (recorded by the coordinator with the reference of the signed copy or the portal acceptance). */
    accept(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.work_order.accept'); if (r.status !== 'APPROVED' || r.wo_state !== 'ISSUED') throw unprocessable('Only an issued work order is accepted.');
      return transaction(db, () => { db.prepare("UPDATE ctr_work_orders SET wo_state = 'ACCEPTED', accepted_by = ?, accepted_at = ?, acceptance_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.acceptedBy, nowIso(), b.reference ?? null, actor.user, nowIso(), r.id); audit(actor, 'ctr_work_orders', r.id, 'accept', r.company_id, { reason: `Accepted by ${b.acceptedBy}` });
        evt('ctr.wo.accepted', actor, r.company_id, 'ctr_work_orders', r.id, { ...woData(r), acceptedBy: b.acceptedBy, reference: b.reference ?? null }, r.org_project_id); return wos.get(actor, r.id); });
    },
    /** FR-07: the work order is closed with its final bill; what is still committed is released. */
    close(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.work_order.close'); if (r.status !== 'APPROVED' || !['ISSUED', 'ACCEPTED'].includes(r.wo_state)) throw unprocessable('Only an issued or accepted work order is closed.');
      if (db.prepare("SELECT 1 FROM ctr_wo_amendments WHERE wo_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(r.id)) throw conflict('An amendment of this work order is open: finish or cancel it first.');
      return transaction(db, () => { const bud = budOf(db)?.ledger; let released = 0; if (bud && db.prepare("SELECT 1 FROM bud_commitments WHERE company_id = ? AND src_type = 'ctr_work_order' AND src_id = ? AND deleted_at IS NULL").get(r.company_id, String(r.id))) released = bud.commitments.release(sys(r.company_id, actor.user), { sourceType: 'ctr_work_order', sourceId: String(r.id), reason: `Closed with final bill ${b.finalBillRef}`, quiet: true })?.released ?? 0;
        db.prepare("UPDATE ctr_work_orders SET wo_state = 'CLOSED', closed_on = ?, final_bill_ref = ?, close_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(today(), b.finalBillRef, b.note ?? null, actor.user, nowIso(), r.id); audit(actor, 'ctr_work_orders', r.id, 'close', r.company_id, { reason: b.finalBillRef });
        evt('ctr.wo.closed', actor, r.company_id, 'ctr_work_orders', r.id, { ...woData(r), finalBillRef: b.finalBillRef, releasedCommitment: released }, r.org_project_id); return wos.get(actor, r.id); });
    },
    /** The adapter for the measurements and bills of the subcontractor (22.05): the executed and billed quantities only go up and never beyond the ordered quantity. */
    progress(companyId, { woId, lines }) {
      const r = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(woId), companyId); if (!r) throw notFound('That work order does not exist.'); if (r.status !== 'APPROVED' || r.wo_state === 'CLOSED') throw unprocessable('Only a live work order takes measurements.');
      return transaction(db, () => { for (const l of lines) { const it = db.prepare('SELECT * FROM ctr_wo_items WHERE wo_id = ? AND line_no = ? AND deleted_at IS NULL').get(r.id, l.lineNo); if (!it) throw notFound(`Line ${l.lineNo} does not exist.`); const ex = q3(l.executed); const bi = q3(l.billed); if (ex < it.executed_qty_th || bi < it.billed_qty_th) throw unprocessable(`Line ${l.lineNo}: the executed and billed quantities only go up.`); if (ex > it.qty_th) throw unprocessable(`Line ${l.lineNo}: ${d3(ex)} is beyond the ordered ${d3(it.qty_th)}; amend the work order first.`); if (bi > ex) throw unprocessable(`Line ${l.lineNo}: more is billed than is executed.`); db.prepare('UPDATE ctr_wo_items SET executed_qty_th = ?, billed_qty_th = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(ex, bi, nowIso(), it.id); } return { woId: r.id, lines: lines.length }; });
    },
    print(actor, id) {
      const r = flow.row(actor, id, 'ctr.work_order.print'); const v = view(actor, r, true); audit(actor, 'ctr_work_orders', r.id, 'print', r.company_id);
      const rows = [['Work order', `${v.woNo} (${v.docNo}), ${v.typeLabel}`], ['Project / contract', `${v.project} / ${v.contractNo ?? '-'}`], ['Subcontractor', v.subcontractor], ['Period', `${v.startDate} to ${v.endDate}`], ['Value', `${v.value}`], ['Retention / security deposit', `${v.retentionPct}% / ${v.sdPct}%`], ['Advance / recovery', `${v.advancePct}% / ${v.advanceRecoveryPct}% of each bill`], ['TDS / GST', `${v.tdsSection ?? '-'} / ${v.gstMode} ${v.gstPct}%`], ['Payment', `${v.paymentDays} days`], ['Liquidated damages', `${v.ldPct}% (cap ${v.ldCapPct}%)`], ...v.items.map((x) => [`Item ${x.lineNo}`, `${x.description}: ${x.qty} ${x.uom ?? ''} x ${x.rate} = ${x.amount}`]), ...v.freeIssue.map((f) => [`Free issue`, `${f.item}: ${f.norm} per unit, wastage ${f.wastagePct}%, charged at ${f.chargeableRate}`]), ['Status', `${v.statusLabel}${v.state ? `, ${v.stateLabel}` : ''}`]].map(([k, x]) => ({ k, v: String(x) }));
      return { buffer: toPdf({ columns: [{ key: 'k', label: 'Particular', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [r.doc_no], title: `Work order ${r.wo_no}` }), contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    exportCsv(actor) { gate(actor, 'ctr.work_order.export', 'export work orders'); const l = wos.list(actor, { page: 1, pageSize: 100 }); const headers = ['Record', 'Work order', 'Project', 'Subcontractor', 'Type', 'Value', 'Starts', 'Ends', 'State', 'Approval']; const rows = l.data.map((x) => [x.docNo, x.woNo, x.project, x.subcontractor, x.typeLabel, x.value, x.startDate, x.endDate, x.stateLabel, x.statusLabel]); audit(actor, 'ctr_work_orders', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `work-orders-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') }; },
    importRows(actor, { rows }) {
      gate(actor, 'ctr.work_order.create', 'import work orders'); const out = []; for (const [i, x] of rows.entries()) { try { const pj = db.prepare('SELECT id FROM org_projects WHERE company_id = ? AND code = ? COLLATE NOCASE AND deleted_at IS NULL').get(actor.companyId, x.projectCode ?? ''); if (!pj) throw new Error('Project code not found'); const sub = db.prepare('SELECT id FROM mdm_partners WHERE company_id = ? AND (code = ? COLLATE NOCASE OR legal_name = ? COLLATE NOCASE) AND deleted_at IS NULL').get(actor.companyId, x.subcontractor ?? '', x.subcontractor ?? ''); if (!sub) throw new Error('Subcontractor not found');
        const d = wos.create(actor, { projectId: pj.id, woNo: x.woNo, woType: x.woType ?? 'ITEM_RATE', subcontractorId: sub.id, selectionKind: 'NEGOTIATED', justification: x.justification ?? 'Imported', title: x.title ?? x.woNo, startDate: x.startDate, endDate: x.endDate, retentionPct: Number(x.retentionPct ?? 0), sdPct: 0, advancePct: 0, advanceRecoveryPct: 0, gstMode: 'FORWARD', gstPct: 18, paymentDays: 30, ldPct: 0, ldCapPct: 0, safetyPenalty: 0, terms: {}, items: [], freeIssue: [] }); out.push({ row: i + 1, docNo: d.docNo }); } catch (e) { out.push({ row: i + 1, error: e.message }); } }
      return { created: out.filter((x) => x.docNo).length, rows: out };
    },
    /** FR-04: the back-to-back margin by item across work orders. */
    marginReport(actor, q = {}) {
      gate(actor, 'ctr.work_order.view', 'see work orders'); const sc = scopeOf(actor, 'ctr.work_order.view'); const rows = db.prepare(`SELECT x.* FROM ctr_work_orders x WHERE ${sc} AND x.deleted_at IS NULL AND x.status = 'APPROVED' ${q.projectId ? 'AND x.org_project_id = :pj' : ''} ${q.woId ? 'AND x.id = :wo' : ''} ORDER BY x.doc_no`).all({ c: actor.companyId, ...(q.projectId ? { pj: rid(q.projectId) } : {}), ...(q.woId ? { wo: rid(q.woId) } : {}) });
      const out = []; for (const w of rows) { if (!canMargin(actor, w)) continue; for (const m of margins(actor, w)) if (!q.negativeOnly || m.negative) out.push({ woId: w.id, docNo: w.doc_no, woNo: w.wo_no, project: pcode(w.org_project_id), subcontractor: partner(w.subcontractor_id), ...m }); }
      const mapped = out.filter((x) => x.mapped); return { rows: out, totals: { client: rs(mapped.reduce((n, x) => n + paise(x.clientAmount), 0)), own: rs(mapped.reduce((n, x) => n + paise(x.amount), 0)), margin: rs(mapped.reduce((n, x) => n + paise(x.margin), 0)), negativeCount: out.filter((x) => x.negative).length, unmapped: out.filter((x) => !x.mapped).length } };
    },
  };

  // ---- amendments (FR-06) -----------------------------------------------------------------------------------------------------------------------------------------------------------------
  const aOf = (id) => db.prepare('SELECT * FROM ctr_wo_amendments WHERE id = ?').get(id);
  /** The items after the changes of an amendment (without saving): the delta and the margin follow from them. */
  function applied(wo, changes) {
    const its = itemsOf(wo.id).map((x) => ({ ...x })); let next = its.length;
    for (const c of changes) { if (c.add) { const [row] = buildItems(wo.org_project_id, [c.add]); next += 1; its.push({ ...row, line_no: next, executed_qty_th: 0, billed_qty_th: 0, isNew: true }); continue; } const it = its.find((x) => x.line_no === c.lineNo); if (!it) fail([{ field: 'changes', message: `Line ${c.lineNo} does not exist` }]); if (c.qty != null) it.qty_th = q3(c.qty); if (c.rate != null) it.rate_x4 = r4(c.rate); if (it.qty_th < it.executed_qty_th) fail([{ field: 'changes', message: `Line ${it.line_no}: the quantity cannot go below the ${d3(it.executed_qty_th)} executed already` }]); it.amount_paise = amountOf(it.qty_th, it.rate_x4); }
    return its;
  }
  const aflow = createFlow({ db, base, docType: 'CTR_WO_AMENDMENT', table: 'ctr_wo_amendments', perm: 'ctr.work_order', label: 'work order amendment', route: '/ctr/work-orders?amendment=', ctx: (a) => { const wo = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(a.wo_id); const d = Math.abs(a.delta_paise); return { amount: rs(d), needsPd: d > BAND_PD ? 1 : 0, needsDir: d > BAND_DIR || a.negative_margin === 1 ? 1 : 0, negativeMargin: a.negative_margin, woType: wo.wo_type }; }, title: (a) => `${a.doc_no} ${a.description}`, notifyCode: 'ctr.wo.decided', numberKey: 'CTR_WO_AMENDMENT', prefix: 'WOA',
    beforeSubmit: (actor, a) => { const wo = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(a.wo_id); if (wo.status !== 'APPROVED' || wo.wo_state === 'CLOSED') throw unprocessable('Only a live work order is amended.'); applied(wo, JSON.parse(a.changes_json)); },
    onApproved: (actor, a) => {
      const wo = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(a.wo_id); const changes = JSON.parse(a.changes_json); const its = applied(wo, changes); const before = wo.value_paise;
      for (const x of its) { if (x.isNew) db.prepare('INSERT INTO ctr_wo_items (company_id, wo_id, line_no, item_kind, boq_line_id, description, uom, qty_th, rate_x4, amount_paise, wbs_id, client_boq_line_id, client_rate_x4, due_date, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(wo.company_id, wo.id, x.line_no, x.item_kind, x.boq_line_id, x.description, x.uom, x.qty_th, x.rate_x4, x.amount_paise, x.wbs_id, x.client_boq_line_id, x.client_rate_x4, x.due_date, wo.org_project_id, actor.user, 'amendment'); else db.prepare('UPDATE ctr_wo_items SET qty_th = ?, rate_x4 = ?, amount_paise = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE wo_id = ? AND line_no = ? AND deleted_at IS NULL').run(x.qty_th, x.rate_x4, x.amount_paise, actor.user, nowIso(), wo.id, x.line_no); }
      db.prepare('UPDATE ctr_work_orders SET amendment_no = ?, end_date = COALESCE(?, end_date), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(a.amendment_no, a.new_end_date, actor.user, nowIso(), wo.id); const f = recompute(wo.id);
      commitWo(actor, f); audit(actor, 'ctr_work_orders', wo.id, 'amend', wo.company_id, { reason: a.description, oldValues: { value: rs(before) }, newValues: { value: rs(f.value_paise) } });
      evt('ctr.wo.amended', actor, wo.company_id, 'ctr_wo_amendments', a.id, { ...woData(f), amendmentId: a.id, amendmentDocNo: a.doc_no, amendmentNo: a.amendment_no, description: a.description, before: rs(before), after: rs(f.value_paise), delta: rs(f.value_paise - before) }, wo.org_project_id);
    } });
  const amendments = {
    ...aflow,
    create(actor, id, b) {
      const wo = flow.row(actor, id, 'ctr.work_order.amend'); if (wo.status !== 'APPROVED' || wo.wo_state === 'CLOSED') throw unprocessable('Only a live work order is amended.'); if (db.prepare("SELECT 1 FROM ctr_wo_amendments WHERE wo_id = ? AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED') AND deleted_at IS NULL").get(wo.id)) throw conflict('An amendment of this work order is open already.');
      if (!b.changes.length && !b.newEndDate) fail([{ field: 'changes', message: 'Change at least one item or the end date' }]); if (b.newEndDate && b.newEndDate < wo.start_date) fail([{ field: 'newEndDate', message: 'The new end date is before the start' }]);
      const its = applied(wo, b.changes); const after = its.reduce((n, x) => n + x.amount_paise, 0); const neg = its.some((x) => marginOf(x.qty_th, x.rate_x4, x.client_rate_x4).negative);
      return transaction(db, () => { const no = aflow.next(actor); const n = db.prepare('SELECT COALESCE(MAX(amendment_no), 0) + 1 AS n FROM ctr_wo_amendments WHERE wo_id = ?').get(wo.id).n; const aid = Number(db.prepare('INSERT INTO ctr_wo_amendments (company_id, doc_no, wo_id, org_project_id, org_site_id, amendment_no, description, changes_json, new_end_date, delta_paise, negative_margin, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(wo.company_id, no, wo.id, wo.org_project_id, wo.org_site_id, n, b.description, JSON.stringify(b.changes), b.newEndDate, after - wo.value_paise, neg ? 1 : 0, actor.user, 'manual').lastInsertRowid); audit(actor, 'ctr_wo_amendments', aid, 'create', wo.company_id); return amendments.get(actor, aid); });
    },
    get(actor, id) {
      const a = aflow.row(actor, id); const wo = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(a.wo_id); const mg = canMargin(actor, wo); const changes = JSON.parse(a.changes_json); const before = itemsOf(wo.id); const after = a.status === 'APPROVED' ? itemsOf(wo.id) : applied(wo, changes);
      return { id: a.id, docNo: a.doc_no, no: a.amendment_no, woId: wo.id, woNo: wo.wo_no, projectId: a.org_project_id, description: a.description, newEndDate: a.new_end_date, endDate: wo.end_date, delta: rs(a.delta_paise), negativeMargin: mg ? a.negative_margin === 1 : null, status: a.status, statusLabel: STATUS[a.status], version: a.version, requestedBy: a.requested_by, value: rs(wo.value_paise), valueAfter: rs(wo.value_paise + (a.status === 'APPROVED' ? 0 : a.delta_paise)),
        compare: after.map((x) => { const old = before.find((y) => y.line_no === x.line_no && a.status !== 'APPROVED'); return { lineNo: x.line_no, description: x.description, qtyBefore: old ? d3(old.qty_th) : null, qtyAfter: d3(x.qty_th), rateBefore: old ? dr(old.rate_x4) : null, rateAfter: dr(x.rate_x4), amountBefore: old ? rs(old.amount_paise) : null, amountAfter: rs(x.amount_paise), added: !old && a.status !== 'APPROVED' }; }), can: aflow.can(actor, a), ...aflow.approveInfo(actor, a) };
    },
    history: (actor, id) => aflow.history(actor, id), submit(actor, id) { aflow.submit(actor, id); return amendments.get(actor, id); }, withdraw: (actor, id, b) => { aflow.withdraw(actor, id, b); return amendments.get(actor, id); }, cancel: (actor, id, b) => { aflow.cancel(actor, id, b); return amendments.get(actor, id); },
  };
  void forbidden; void aOf;
  return { workOrders: wos, woAmendments: amendments };
}
