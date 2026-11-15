import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { boqOf, variationProviders } from '../proj/boq.js';
import { nowIso, rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';
import { amountOf } from './workorders.js';

// Change and variation management (part 21.05): a change request from a client instruction, an RFI response, a design change, an internal proposal or a quantity deviation goes through the technical review and the QS evaluation (every rate from a documented basis: the
// contract rate, a schedule of rates or an approved rate analysis, BR-01), is approved internally (QS, commercial manager, project director above Rs 10 lakh, director above Rs 50 lakh) and goes to the client; the client's answer is recorded and an approved answer becomes a variation
// order, which after its own approval revises the contract value (21.01), makes the revised BOQ (10.04) and the budget draft (12.02) and drafts the back-to-back amendments of the work orders (21.03). Money is paise inside and rupees in the API; rates x10000, quantities x1000.
for (const [key, type, def, description] of [['ctr.variation.provisional_billing', 'boolean', false, 'Whether the contract allows extra items to be billed provisionally before the variation order is approved (part 21.05 BR-01).']]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: type, default: def, scopes: ['system', 'company'], description });
}
export const SOURCE_LABEL = { CLIENT_INSTRUCTION: 'Client or engineer instruction', RFI: 'RFI response', DESIGN_CHANGE: 'Design change', INTERNAL: 'Internal proposal', QTY_DEVIATION: 'Quantity deviation', SUBCONTRACT: 'Subcontract variation' };
export const CR_STATE = { PREPARING: 'Being prepared', READY: 'Ready for the client', WITH_CLIENT: 'With the client', APPROVED: 'Approved', REJECTED: 'Rejected', DISPUTED: 'Disputed', WITHDRAWN: 'Withdrawn' };
export const BASIS_LABEL = { CONTRACT: 'Contract rate', SCHEDULE: 'Schedule of rates', ANALYSIS: 'Rate analysis' };
const BAND_PD = 1_000_000_00; const BAND_DIR = 5_000_000_00;
const rs = (p) => (p == null ? null : Math.round(p) / 100); const q3 = (x) => Math.round(Number(x) * 1000); const d3 = (t) => t / 1000; const r4 = (x) => Math.round(Number(x) * 10000); const dr = (t) => t / 10000; const paise = (r) => Math.round(Number(r) * 100);

export const crList = defineList({ code: 'ctr.variations', label: 'Variation register', permission: 'ctr.change.view', from: 'ctr_change_requests x JOIN org_projects p ON p.id = x.org_project_id LEFT JOIN ctr_variation_orders v ON v.cr_id = x.id AND v.deleted_at IS NULL AND v.status <> \'CANCELLED\'', where: "x.deleted_at IS NULL AND x.status <> 'CANCELLED'", searchable: ['x.doc_no', 'x.cr_no', 'x.title', 'x.origin_ref', 'p.code', 'v.vo_no'], defaultSort: 'crNo',
  columns: { crNo: { sql: 'x.cr_no', type: 'text', label: 'Change request' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, source: { sql: 'x.origin_type', type: 'enum', label: 'Source', options: Object.entries(SOURCE_LABEL) }, claimed: { sql: 'x.value_claimed_paise', type: 'money', label: 'Claimed' }, approved: { sql: 'COALESCE(v.value_approved_paise, 0)', type: 'money', label: 'Approved' }, voNo: { sql: 'v.vo_no', type: 'text', label: 'Variation order' }, state: { sql: 'x.cr_state', type: 'enum', label: 'State', options: Object.entries(CR_STATE) }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) } } });

export function createVariationService({ db, base, flags, contracts, workOrders }) {
  const { audit, fail, may, notify, number } = base; void flags; const { evt, gate, scopeOf, pcode, projectOk } = qaHelpers({ db, base }); const today = () => todayIST();
  variationProviders.push((d, { companyId, projectId, variationRef }) => (d.prepare("SELECT vo_no FROM ctr_variation_orders WHERE company_id = ? AND org_project_id = ? AND vo_no = ? COLLATE NOCASE AND status = 'APPROVED' AND deleted_at IS NULL").get(companyId, projectId, variationRef) ? { ref: variationRef } : null));
  const evalOf = (r) => JSON.parse(r.qs_json || '{}');
  /** BR-01: every rate comes from a documented basis: the contract rate of the BOQ line, a schedule of rates with its reference, or an approved rate analysis. */
  function deriveItems(projectId, cr, items) {
    const wo = cr.kind === 'SUBCONTRACT' ? db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(cr.work_order_id) : null; const out = [];
    for (const [i, x] of items.entries()) {
      const f = (field, message) => fail([{ field: `items.${i}.${field}`, message }]); let boq = null; let woItem = null; let rate = x.rate == null ? null : r4(x.rate); let basisRef = x.basisRef ?? null; let analysisId = null;
      if (cr.kind === 'CLIENT') { if (x.woLineNo) f('woLineNo', 'A client variation names BOQ items, not work order lines'); if (x.boqLineId) { boq = db.prepare('SELECT l.*, v.org_project_id AS pj FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.id = ? AND l.deleted_at IS NULL').get(rid(x.boqLineId)); if (!boq || boq.pj !== projectId) f('boqLineId', 'Not an item of the BOQ of this project'); } }
      else { if (x.woLineNo) { woItem = db.prepare('SELECT * FROM ctr_wo_items WHERE wo_id = ? AND line_no = ? AND deleted_at IS NULL').get(wo.id, x.woLineNo); if (!woItem) f('woLineNo', 'Not a line of the work order'); } if (x.boqLineId) f('boqLineId', 'A subcontract variation names work order lines'); }
      if (x.basisKind === 'CONTRACT') { const ref = boq?.rate ?? woItem?.rate_x4; if (ref == null) f('basisKind', 'The contract rate belongs to an item of the BOQ or of the work order; an extra item takes a schedule rate or an analysed rate'); if (rate != null && rate !== ref) f('rate', `The contract rate of this item is ${dr(ref)}`); rate = ref; basisRef = boq ? `BOQ ${boq.item_code}` : `Work order line ${x.woLineNo}`; }
      else if (x.basisKind === 'SCHEDULE') { if ((basisRef ?? '').trim().length < 3) f('basisRef', 'Name the schedule of rates and its item'); if (rate == null || rate <= 0) f('rate', 'Give the schedule rate'); }
      else { const a = x.analysisId ? db.prepare("SELECT * FROM ra_analyses WHERE id = ? AND company_id = ? AND deleted_at IS NULL").get(rid(x.analysisId), cr.company_id) : null; if (!a) f('analysisId', 'Choose a rate analysis'); if (a.analysis_status !== 'APPROVED') f('analysisId', 'The rate analysis is not approved'); if (rate != null && rate !== a.unit_rate) f('rate', `The analysed rate is ${dr(a.unit_rate)}`); rate = a.unit_rate; analysisId = a.id; basisRef = `Analysis ${a.analysis_no}`; }
      const qty = q3(x.qtyChange); out.push({ line_no: i + 1, boq_line_id: boq?.id ?? null, wo_line_no: x.woLineNo ?? null, description: x.description, uom: x.uom ?? boq?.uom ?? woItem?.uom ?? null, qty_change_th: qty, rate_x4: rate, amount_paise: amountOf(qty, rate), basis_kind: x.basisKind, basis_ref: basisRef, analysis_id: analysisId, wbs_id: x.wbsId ?? null, cost_code_id: x.costCodeId ?? null, is_extra: (cr.kind === 'CLIENT' && !boq) || (cr.kind === 'SUBCONTRACT' && !woItem) ? 1 : 0 });
    }
    return out;
  }
  const itemView = (x) => ({ lineNo: x.line_no, boqLineId: x.boq_line_id, woLineNo: x.wo_line_no, description: x.description, uom: x.uom, qtyChange: d3(x.qty_change_th), rate: dr(x.rate_x4), amount: rs(x.amount_paise), basisKind: x.basis_kind, basisLabel: BASIS_LABEL[x.basis_kind], basisRef: x.basis_ref, analysisId: x.analysis_id, wbsId: x.wbs_id, costCodeId: x.cost_code_id, isExtra: x.is_extra === 1 });
  const ctxOf = (r) => ({ amount: rs(Math.abs(r.value_claimed_paise)), needsPd: Math.abs(r.value_claimed_paise) > BAND_PD ? 1 : 0, needsDir: Math.abs(r.value_claimed_paise) > BAND_DIR ? 1 : 0, kind: r.kind });
  function problemsOf(r) {
    const p = []; const e = evalOf(r);
    if ((r.technical_review ?? '').trim().length < 10 || !r.technical_by) p.push({ field: 'technicalReview', message: 'The technical review (scope, drawings, method) is not given' });
    if (!(e.items ?? []).length) p.push({ field: 'items', message: 'The QS evaluation has no items' });
    if (r.kind === 'CLIENT' && !r.contract_id) p.push({ field: 'contractId', message: 'Name the client contract' });
    if (r.kind === 'SUBCONTRACT' && !r.work_order_id) p.push({ field: 'workOrderId', message: 'Name the work order' });
    if (r.value_claimed_paise === 0 && r.time_claimed_days === 0 && (e.items ?? []).length) p.push({ field: 'items', message: 'The change has neither value nor time' });
    return p;
  }
  const flow = createFlow({ db, base, docType: 'CTR_CHANGE_REQUEST', table: 'ctr_change_requests', perm: 'ctr.change', label: 'change request', route: '/ctr/variations?id=', ctx: ctxOf, title: (r) => `${r.cr_no} ${r.title}`, notifyCode: 'ctr.change.decided', numberKey: 'CTR_CHANGE_REQUEST', prefix: 'CRQ',
    beforeSubmit: (_a, r) => { const p = problemsOf(r); if (p.length) fail(p); },
    onApproved: (actor, r) => {
      db.prepare("UPDATE ctr_change_requests SET cr_state = 'READY' WHERE id = ?").run(r.id);
      if (r.kind === 'CLIENT') contracts.applyVariation(r.company_id, { contractId: r.contract_id, refId: String(r.id), refNo: r.cr_no, description: r.title, amount: rs(r.value_claimed_paise), status: 'PENDING', actor });
      evt('ctr.change.ready', actor, r.company_id, 'ctr_change_requests', r.id, crData(r), r.org_project_id);
      notify(r.company_id, 'ctr.variation.alert', ['role:COMMGR'], r.cr_no, 'ready for the client', `${r.cr_no} (${r.title}) is approved internally: send the proposal to the client.`, `/ctr/variations?id=${r.id}`, `${r.id}.ready`, { projectId: r.org_project_id });
    } });
  const crData = (r) => ({ changeRequestId: r.id, docNo: r.doc_no, crNo: r.cr_no, kind: r.kind, projectId: r.org_project_id, contractId: r.contract_id, workOrderId: r.work_order_id, originType: r.origin_type, originRef: r.origin_ref, title: r.title, claimed: rs(r.value_claimed_paise), timeClaimedDays: r.time_claimed_days, state: r.cr_state });
  const voOf = (crId) => db.prepare("SELECT * FROM ctr_variation_orders WHERE cr_id = ? AND deleted_at IS NULL AND status <> 'CANCELLED' ORDER BY id DESC").get(crId);
  const view = (actor, r, detail = false) => {
    const vo = voOf(r.id); const c0 = flow.can(actor, r); const w = { pid: r.org_project_id, sid: r.org_site_id };
    const o = { id: r.id, docNo: r.doc_no, crNo: r.cr_no, kind: r.kind, projectId: r.org_project_id, project: pcode(r.org_project_id), siteId: r.org_site_id, contractId: r.contract_id, contractNo: r.contract_id ? db.prepare('SELECT contract_no FROM ctr_contracts WHERE id = ?').get(r.contract_id)?.contract_no : null, workOrderId: r.work_order_id, woNo: r.work_order_id ? db.prepare('SELECT wo_no FROM ctr_work_orders WHERE id = ?').get(r.work_order_id)?.wo_no : null, originType: r.origin_type, sourceLabel: SOURCE_LABEL[r.origin_type], originRef: r.origin_ref, title: r.title, claimed: rs(r.value_claimed_paise), timeClaimedDays: r.time_claimed_days, approved: vo ? rs(vo.value_approved_paise) : null, voId: vo?.id ?? null, voNo: vo?.vo_no ?? null, voStatus: vo?.status ?? null,
      state: r.cr_state, stateLabel: CR_STATE[r.cr_state], status: r.status, statusLabel: STATUS[r.status], version: r.version, requestedBy: r.requested_by, clientRef: r.client_ref,
      can: { ...c0, review: r.status !== 'APPROVED' && ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'ctr.change.review', w.pid, w.sid), evaluate: ['DRAFT', 'RETURNED'].includes(r.status) && may(actor, 'ctr.change.evaluate', w.pid, w.sid), toClient: r.status === 'APPROVED' && r.cr_state === 'READY' && may(actor, 'ctr.change.respond', w.pid, w.sid), respond: r.status === 'APPROVED' && ['WITH_CLIENT', 'DISPUTED'].includes(r.cr_state) && !(vo && vo.status !== 'REJECTED') && may(actor, 'ctr.change.respond', w.pid, w.sid) } };
    if (detail) { const e = evalOf(r); Object.assign(o, flow.approveInfo(actor, r), { description: r.description, originId: r.origin_id, technicalReview: r.technical_review, technicalBy: r.technical_by, technicalAt: r.technical_at, notes: e.notes ?? null, items: (e.items ?? []).map(itemView), cancelReason: r.cancel_reason, toClientOn: r.to_client_on, responseOn: r.response_on, responseNote: r.response_note, problems: ['DRAFT', 'RETURNED'].includes(r.status) ? problemsOf(r) : [] }); }
    return o;
  };
  const crs = {
    ...flow,
    list(actor, query) { return runList(db, crList, parseListRequest(crList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'ctr.change.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get: (actor, id) => view(actor, flow.row(actor, id), true),
    options(actor) {
      gate(actor, 'ctr.change.create', 'raise change requests'); const pjs = db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'ctr.change.create', p.id));
      return { projects: pjs, contracts: db.prepare("SELECT id, contract_no AS contractNo, org_project_id AS projectId FROM ctr_contracts WHERE company_id = ? AND status = 'APPROVED' AND deleted_at IS NULL ORDER BY contract_no").all(actor.companyId), workOrders: db.prepare("SELECT id, wo_no AS woNo, org_project_id AS projectId FROM ctr_work_orders WHERE company_id = ? AND status = 'APPROVED' AND wo_state IN ('ISSUED', 'ACCEPTED') AND deleted_at IS NULL ORDER BY wo_no").all(actor.companyId),
        boqLines: db.prepare("SELECT l.id, l.item_code AS code, l.description, l.uom, l.rate, v.org_project_id AS projectId FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE l.company_id = ? AND l.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') AND v.status = 'APPROVED' AND v.deleted_at IS NULL ORDER BY v.org_project_id, l.item_code LIMIT 2000").all(actor.companyId).map((l) => ({ ...l, rate: dr(l.rate) })),
        analyses: db.prepare("SELECT id, analysis_no AS code, unit_rate AS rate FROM ra_analyses WHERE company_id = ? AND analysis_status = 'APPROVED' AND deleted_at IS NULL ORDER BY analysis_no LIMIT 500").all(actor.companyId).map((a) => ({ ...a, rate: dr(a.rate) })), sources: Object.entries(SOURCE_LABEL).map(([id, label]) => ({ id, label })), bases: Object.entries(BASIS_LABEL).map(([id, label]) => ({ id, label })) };
    },
    create(actor, b) {
      const pj = projectOk(actor, b.projectId, 'ctr.change.create'); if (b.kind === 'SUBCONTRACT' && b.originType !== 'SUBCONTRACT') fail([{ field: 'originType', message: 'A subcontract variation has the source "subcontract variation"' }]); if (b.kind === 'CLIENT' && b.originType === 'SUBCONTRACT') fail([{ field: 'originType', message: 'Choose the source of the client change' }]);
      if (b.contractId && !db.prepare('SELECT 1 FROM ctr_contracts WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL').get(rid(b.contractId), actor.companyId, pj.id)) fail([{ field: 'contractId', message: 'Not a contract of this project' }]);
      if (b.workOrderId && !db.prepare("SELECT 1 FROM ctr_work_orders WHERE id = ? AND company_id = ? AND org_project_id = ? AND status = 'APPROVED' AND deleted_at IS NULL").get(rid(b.workOrderId), actor.companyId, pj.id)) fail([{ field: 'workOrderId', message: 'Not an approved work order of this project' }]);
      return transaction(db, () => { const no = flow.next(actor); const crNo = number(actor.companyId, actor.user, 'CTR_CR_NO', 'ctr_change_requests', 'CR', {}); const id = Number(db.prepare('INSERT INTO ctr_change_requests (company_id, doc_no, cr_no, kind, org_project_id, org_site_id, contract_id, work_order_id, origin_type, origin_ref, origin_id, title, description, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, no, crNo, b.kind, pj.id, b.siteId ?? null, b.contractId ?? null, b.workOrderId ?? null, b.originType, b.originRef ?? null, b.originId ?? null, b.title, b.description, actor.user, 'manual').lastInsertRowid); audit(actor, 'ctr_change_requests', id, 'create', actor.companyId); return crs.get(actor, id); });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.change.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved change request is not edited.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this; reload it.');
      db.prepare('UPDATE ctr_change_requests SET contract_id = ?, work_order_id = ?, origin_type = ?, origin_ref = ?, origin_id = ?, title = ?, description = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run('contractId' in b ? b.contractId : r.contract_id, 'workOrderId' in b ? b.workOrderId : r.work_order_id, b.originType ?? r.origin_type, 'originRef' in b ? b.originRef : r.origin_ref, 'originId' in b ? b.originId : r.origin_id, b.title ?? r.title, b.description ?? r.description, actor.user, nowIso(), r.id); audit(actor, 'ctr_change_requests', r.id, 'update', r.company_id); return crs.get(actor, r.id);
    },
    remove: (actor, id) => flow.remove(actor, id), submit(actor, id) { flow.submit(actor, id); return crs.get(actor, id); }, withdraw: (actor, id, b) => { flow.withdraw(actor, id, b); return crs.get(actor, id); }, cancel: (actor, id, b) => { flow.cancel(actor, id, b); return crs.get(actor, id); }, history: (actor, id) => flow.history(actor, id),
    /** FR-02: the technical review (scope, drawings, method) by the engineer. */
    review(actor, id, { review }) { const r = flow.row(actor, id, 'ctr.change.review'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved change request is not reviewed again.'); db.prepare('UPDATE ctr_change_requests SET technical_review = ?, technical_by = ?, technical_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(review, actor.user, nowIso(), actor.user, nowIso(), r.id); audit(actor, 'ctr_change_requests', r.id, 'review', r.company_id); return crs.get(actor, r.id); },
    /** FR-02, BR-01: the QS evaluation: quantities and rates from a documented basis; the value is worked out here. */
    evaluate(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.change.evaluate'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved change request is not evaluated again.'); const items = deriveItems(r.org_project_id, r, b.items); const total = items.reduce((n, x) => n + x.amount_paise, 0); if (b.value != null && paise(b.value) !== total) fail([{ field: 'value', message: `The value is worked out by the server: ${rs(total)}` }]);
      db.prepare('UPDATE ctr_change_requests SET qs_json = ?, value_claimed_paise = ?, time_claimed_days = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(JSON.stringify({ items, notes: b.notes ?? null, evaluatedBy: actor.user, evaluatedAt: nowIso() }), total, b.timeDays ?? 0, actor.user, nowIso(), r.id); audit(actor, 'ctr_change_requests', r.id, 'evaluate', r.company_id, { newValues: { value: rs(total), items: items.length } }); return crs.get(actor, r.id);
    },
    /** FR-03: the proposal goes to the client. */
    toClient(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.change.respond'); if (r.status !== 'APPROVED' || r.cr_state !== 'READY') throw unprocessable('Only a change request approved internally is sent to the client.');
      db.prepare("UPDATE ctr_change_requests SET cr_state = 'WITH_CLIENT', to_client_on = ?, client_ref = COALESCE(?, client_ref), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.submittedOn, b.clientRef, actor.user, nowIso(), r.id); audit(actor, 'ctr_change_requests', r.id, 'to_client', r.company_id);
      evt('ctr.change.sent', actor, r.company_id, 'ctr_change_requests', r.id, { ...crData({ ...r, cr_state: 'WITH_CLIENT' }), submittedOn: b.submittedOn, clientRef: b.clientRef }, r.org_project_id); return crs.get(actor, r.id);
    },
    /** FR-03: the client's answer. An approval makes the variation order (a draft the commercial manager sends for approval); a rejection withdraws the pending value; a dispute keeps it and goes to claims (21.06). */
    respond(actor, id, b) {
      const r = flow.row(actor, id, 'ctr.change.respond'); if (r.status !== 'APPROVED' || !['WITH_CLIENT', 'DISPUTED'].includes(r.cr_state)) throw unprocessable('Only a change request with the client is answered.'); if (voOf(r.id) && voOf(r.id).status !== 'REJECTED') throw conflict('A variation order exists already for this change request.');
      if (b.response !== 'APPROVED' && (b.note ?? '').length < 5) fail([{ field: 'note', message: 'Say what the client said (at least 5 characters)' }]);
      return transaction(db, () => {
        db.prepare('UPDATE ctr_change_requests SET response_on = ?, response_note = ?, client_ref = COALESCE(?, client_ref), cr_state = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.responseOn, b.note, b.clientRef, b.response === 'APPROVED' ? 'WITH_CLIENT' : b.response, actor.user, nowIso(), r.id); audit(actor, 'ctr_change_requests', r.id, `client_${b.response.toLowerCase()}`, r.company_id, { reason: b.note ?? undefined });
        if (b.response === 'REJECTED') { if (r.kind === 'CLIENT') contracts.applyVariation(r.company_id, { contractId: r.contract_id, refId: String(r.id), refNo: r.cr_no, description: r.title, amount: rs(r.value_claimed_paise), status: 'WITHDRAWN', actor }); evt('ctr.change.rejected', actor, r.company_id, 'ctr_change_requests', r.id, { ...crData({ ...r, cr_state: 'REJECTED' }), note: b.note }, r.org_project_id); }
        else if (b.response === 'DISPUTED') evt('ctr.change.disputed', actor, r.company_id, 'ctr_change_requests', r.id, { ...crData({ ...r, cr_state: 'DISPUTED' }), note: b.note }, r.org_project_id);
        else { const no = vos.flow.next(actor); const voNo = number(actor.companyId, actor.user, 'CTR_VO_NO', 'ctr_variation_orders', 'VO', {}); const e = evalOf(r); const value = b.approvedValue == null ? r.value_claimed_paise : paise(b.approvedValue); const days = b.approvedDays ?? r.time_claimed_days;
          const vid = Number(db.prepare('INSERT INTO ctr_variation_orders (company_id, doc_no, vo_no, kind, org_project_id, org_site_id, contract_id, work_order_id, cr_id, client_ref, title, value_approved_paise, time_approved_days, approved_on, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, no, voNo, r.kind, r.org_project_id, r.org_site_id, r.contract_id, r.work_order_id, r.id, b.clientRef ?? r.client_ref, r.title, value, days, b.responseOn, actor.user, 'client_response').lastInsertRowid);
          for (const x of e.items ?? []) db.prepare('INSERT INTO ctr_vo_items (company_id, vo_id, line_no, boq_line_id, wo_line_no, description, uom, qty_change_th, rate_x4, amount_paise, basis_kind, basis_ref, analysis_id, wbs_id, cost_code_id, is_extra, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(r.company_id, vid, x.line_no, x.boq_line_id, x.wo_line_no, x.description, x.uom, x.qty_change_th, x.rate_x4, x.amount_paise, x.basis_kind, x.basis_ref, x.analysis_id, x.wbs_id, x.cost_code_id, x.is_extra, r.org_project_id, actor.user, 'client_response');
          audit(actor, 'ctr_variation_orders', vid, 'create', r.company_id); }
        return crs.get(actor, r.id);
      });
    },
    /** FR-03: the proposal document to the client with its supporting calculation (04.11). */
    proposal(actor, id) {
      const r = flow.row(actor, id, 'ctr.change.print'); const v = crs.get(actor, id); audit(actor, 'ctr_change_requests', r.id, 'print', r.company_id);
      const rows = [['Change request', `${v.crNo} (${v.docNo}) ${v.title}`], ['Project / contract', `${v.project} / ${v.contractNo ?? v.woNo ?? '-'}`], ['Source', `${v.sourceLabel}${v.originRef ? `: ${v.originRef}` : ''}`], ['Description', v.description], ['Technical review', v.technicalReview ?? '-'], ...v.items.map((x) => [`Item ${x.lineNo}`, `${x.description}: ${x.qtyChange} ${x.uom ?? ''} x ${x.rate} = ${x.amount} (${x.basisLabel}: ${x.basisRef ?? '-'})`]), ['Value claimed', `${v.claimed}`], ['Time claimed', `${v.timeClaimedDays} day(s)`], ['Status', `${v.statusLabel}, ${v.stateLabel}`]].map(([k, x]) => ({ k, v: String(x) }));
      return { buffer: toPdf({ columns: [{ key: 'k', label: 'Particular', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }], rows, footer: [r.doc_no], title: `Variation proposal ${r.cr_no}` }), contentType: 'application/pdf', fileName: `${r.doc_no.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    exportCsv(actor) { gate(actor, 'ctr.change.export', 'export the variation register'); const l = crs.list(actor, { page: 1, pageSize: 100 }); const headers = ['Change request', 'Project', 'Title', 'Source', 'Claimed', 'Approved', 'Variation order', 'State', 'Approval']; const rows = l.data.map((x) => [x.crNo, x.project, x.title, x.sourceLabel, x.claimed, x.approved ?? '', x.voNo ?? '', x.stateLabel, x.statusLabel]); audit(actor, 'ctr_change_requests', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `variations-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') }; },
    /** FR-05: the register by project and state. */
    summary(actor, q = {}) {
      gate(actor, 'ctr.change.view', 'see the variation summary'); const sc = scopeOf(actor, 'ctr.change.view'); const rows = db.prepare(`SELECT x.* FROM ctr_change_requests x WHERE ${sc} AND x.deleted_at IS NULL AND x.status <> 'CANCELLED' ${q.projectId ? 'AND x.org_project_id = :pj' : ''} ${q.kind ? 'AND x.kind = :kind' : ''}`).all({ c: actor.companyId, ...(q.projectId ? { pj: rid(q.projectId) } : {}), ...(q.kind ? { kind: q.kind } : {}) });
      const key = (r) => (r.status !== 'APPROVED' ? 'PENDING' : r.cr_state === 'READY' ? 'PENDING' : r.cr_state === 'WITH_CLIENT' ? (voOf(r.id) ? 'APPROVED' : 'SUBMITTED') : r.cr_state); const by = new Map();
      for (const r of rows) { const k = `${r.org_project_id}:${key(r)}`; const vo = voOf(r.id); const a = by.get(k) ?? { projectId: r.org_project_id, project: pcode(r.org_project_id), state: key(r), count: 0, claimed: 0, approved: 0, claimedDays: 0, approvedDays: 0 }; a.count += 1; a.claimed += r.value_claimed_paise; a.claimedDays += r.time_claimed_days; if (vo && vo.status === 'APPROVED') { a.approved += vo.value_approved_paise; a.approvedDays += vo.time_approved_days; } by.set(k, a); }
      const out = [...by.values()].map((a) => ({ ...a, claimed: rs(a.claimed), approved: rs(a.approved) })).sort((x, y) => x.project.localeCompare(y.project) || x.state.localeCompare(y.state));
      return { rows: out, totals: { count: out.reduce((n, x) => n + x.count, 0), claimed: rs(rows.reduce((n, r) => n + r.value_claimed_paise, 0)), approved: out.reduce((n, x) => n + x.approved, 0), claimedDays: rows.reduce((n, r) => n + r.time_claimed_days, 0), approvedDays: out.reduce((n, x) => n + x.approvedDays, 0) } };
    },
  };
  // ---- the variation order -------------------------------------------------------------------------------------------------------------------------------------------------
  const voCtx = (v) => { const a = Math.abs(v.value_approved_paise); return { amount: rs(a), needsPd: a > BAND_PD ? 1 : 0, needsDir: a > BAND_DIR ? 1 : 0, kind: v.kind }; };
  const voData = (v) => ({ variationId: v.id, variationNo: v.vo_no, docNo: v.doc_no, kind: v.kind, projectId: v.org_project_id, contractId: v.contract_id, workOrderId: v.work_order_id, changeRequestId: v.cr_id, title: v.title, amount: rs(v.value_approved_paise), timeDays: v.time_approved_days, approvedOn: v.approved_on, clientRef: v.client_ref });
  const voItems = (id) => db.prepare('SELECT * FROM ctr_vo_items WHERE vo_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  /** The revised BOQ of the approved variation (10.04): a copy of the latest frozen version with the quantities changed and the extra items added; what cannot be placed (a mapped quantity) is left for the QS. */
  function reviseBoq(v, items) {
    const boq = boqOf(db); if (!boq) return { versionId: null, notes: ['The BOQ service is not available.'] };
    const changes = items.map((x) => (x.boq_line_id ? { itemCode: db.prepare('SELECT item_code FROM proj_boq_lines WHERE id = ?').get(x.boq_line_id).item_code, qtyChange: x.qty_change_th } : { extraCode: `${v.vo_no}/${x.line_no}`, description: x.description, uom: x.uom, qtyChange: x.qty_change_th, rate: x.rate_x4, analysisId: x.analysis_id, costCodeId: x.cost_code_id }));
    try { return boq.versions.reviseFromVariation(v.company_id, { projectId: v.org_project_id, variationRef: v.vo_no, user: v.created_by ?? 'system', name: `Revised BOQ for ${v.vo_no}`, changes }); } catch (e) { return { versionId: null, notes: [`The revised BOQ was not made: ${e.message}`] }; }
  }
  /** FR-04: the back-to-back drafts: the work order items mapped to the varied client item get the same quantity change; a subcontract variation drafts the amendment of its work order. */
  function draftAmendments(v, items, cr) {
    const made = []; const notes = []; const user = v.created_by ?? 'system';
    const tryDraft = (woId, changes, description) => { try { const r = workOrders.draftFor(v.company_id, woId, { description, newEndDate: null, changes }, user); made.push(r.id); } catch (e) { notes.push(`Work order ${woId}: ${e.message}`); } };
    if (v.kind === 'SUBCONTRACT') { const wo = db.prepare('SELECT * FROM ctr_work_orders WHERE id = ?').get(v.work_order_id); const changes = items.map((x) => { if (x.wo_line_no) { const it = db.prepare('SELECT * FROM ctr_wo_items WHERE wo_id = ? AND line_no = ? AND deleted_at IS NULL').get(wo.id, x.wo_line_no); return { lineNo: x.wo_line_no, qty: (it.qty_th + x.qty_change_th) / 1000, ...(x.basis_kind !== 'CONTRACT' ? { rate: dr(x.rate_x4) } : {}) }; } return { add: { itemKind: 'CUSTOM', description: x.description, uom: x.uom ?? undefined, qty: d3(x.qty_change_th), rate: dr(x.rate_x4) } }; }); tryDraft(wo.id, changes, `Subcontract variation ${v.vo_no}: ${v.title}`); return { made, notes }; }
    const byWo = new Map(); for (const x of items) { if (!x.boq_line_id) continue; for (const w of db.prepare("SELECT i.*, o.id AS woid FROM ctr_wo_items i JOIN ctr_work_orders o ON o.id = i.wo_id WHERE i.client_boq_line_id = ? AND i.deleted_at IS NULL AND o.deleted_at IS NULL AND o.status = 'APPROVED' AND o.wo_state IN ('ISSUED', 'ACCEPTED') AND o.org_project_id = ?").all(x.boq_line_id, v.org_project_id)) { const arr = byWo.get(w.woid) ?? []; arr.push({ lineNo: w.line_no, qty: (w.qty_th + x.qty_change_th) / 1000 }); byWo.set(w.woid, arr); } }
    for (const [woId, changes] of byWo) tryDraft(woId, changes, `Back-to-back of ${v.vo_no}: ${v.title}`); void cr; return { made, notes };
  }
  const vflow = createFlow({ db, base, docType: 'CTR_VARIATION_ORDER', table: 'ctr_variation_orders', perm: 'ctr.variation', label: 'variation order', route: '/ctr/variations?vo=', ctx: voCtx, title: (v) => `${v.vo_no} ${v.title}`, notifyCode: 'ctr.variation.decided', numberKey: 'CTR_VARIATION_ORDER', prefix: 'VOR',
    beforeSubmit: (_a, v) => { if (!voItems(v.id).length) fail([{ field: 'items', message: 'The variation order has no items' }]); },
    onApproved: (actor, v) => {
      const cr = db.prepare('SELECT * FROM ctr_change_requests WHERE id = ?').get(v.cr_id); const items = voItems(v.id); const out = {};
      db.prepare("UPDATE ctr_variation_orders SET vo_state = 'EFFECTIVE', approved_on = COALESCE(approved_on, ?) WHERE id = ?").run(today(), v.id); db.prepare("UPDATE ctr_change_requests SET cr_state = 'APPROVED' WHERE id = ?").run(cr.id);
      if (v.kind === 'CLIENT') {
        contracts.applyVariation(v.company_id, { contractId: v.contract_id, refId: String(cr.id), refNo: v.vo_no, description: v.title, amount: rs(v.value_approved_paise), status: 'APPROVED', actor }); out.contractValue = rs(v.value_approved_paise);
        const b = reviseBoq(v, items); out.boqVersionId = b.versionId; out.boqNotes = b.notes; if (b.versionId) db.prepare('UPDATE ctr_variation_orders SET boq_version_id = ? WHERE id = ?').run(b.versionId, v.id);
      }
      const d = draftAmendments(v, items, cr); out.woAmendmentDrafts = d.made; out.woNotes = d.notes; db.prepare('UPDATE ctr_variation_orders SET outputs_json = ? WHERE id = ?').run(JSON.stringify(out), v.id);
      evt('ctr.variation.approved', actor, v.company_id, 'ctr_variation_orders', v.id, { ...voData({ ...v, approved_on: today() }), lines: v.kind === 'CLIENT' ? items.map((x) => ({ wbsId: x.wbs_id, costCodeId: x.cost_code_id, resourceType: 'OTHER', description: x.description, uom: x.uom, qty: d3(x.qty_change_th), amount: rs(x.amount_paise) })) : [], items: items.map((x) => ({ lineNo: x.line_no, boqLineId: x.boq_line_id, description: x.description, qtyChange: d3(x.qty_change_th), rate: dr(x.rate_x4), amount: rs(x.amount_paise), isExtra: x.is_extra === 1 })), outputs: out }, v.org_project_id);
      notify(v.company_id, 'ctr.variation.alert', ['role:COMMGR', 'role:QS', 'role:PM'], v.vo_no, 'variation approved', `${v.vo_no} (${v.title}) of ₹ ${rs(v.value_approved_paise)} is approved: the contract value, the revised BOQ draft and the budget draft are made.`, `/ctr/variations?vo=${v.id}`, `${v.id}.approved`, { projectId: v.org_project_id });
    } });
  const voView = (actor, v, detail = false) => {
    const w = { pid: v.org_project_id, sid: v.org_site_id }; const o = { id: v.id, docNo: v.doc_no, voNo: v.vo_no, kind: v.kind, title: v.title, projectId: v.org_project_id, project: pcode(v.org_project_id), contractId: v.contract_id, workOrderId: v.work_order_id, crId: v.cr_id, crNo: db.prepare('SELECT cr_no FROM ctr_change_requests WHERE id = ?').get(v.cr_id)?.cr_no, clientRef: v.client_ref, approved: rs(v.value_approved_paise), timeApprovedDays: v.time_approved_days, approvedOn: v.approved_on, state: v.vo_state, boqVersionId: v.boq_version_id, status: v.status, statusLabel: STATUS[v.status], version: v.version, requestedBy: v.requested_by, can: vflow.can(actor, v) };
    void w; if (detail) { const cr = db.prepare('SELECT value_claimed_paise, time_claimed_days FROM ctr_change_requests WHERE id = ?').get(v.cr_id); Object.assign(o, vflow.approveInfo(actor, v), { claimed: rs(cr.value_claimed_paise), timeClaimedDays: cr.time_claimed_days, items: voItems(v.id).map(itemView), outputs: JSON.parse(v.outputs_json || '{}'), cancelReason: v.cancel_reason }); } return o;
  };
  const vos = {
    flow: vflow, ...vflow,
    get: (actor, id) => voView(actor, vflow.row(actor, id), true),
    update(actor, id, b) { const v = vflow.row(actor, id, 'ctr.variation.edit'); if (!vflow.EDITABLE.includes(v.status)) throw conflict('An approved variation order is not edited.'); if (b.rowVersion && b.rowVersion !== v.version) throw conflict('Someone changed this; reload it.'); db.prepare('UPDATE ctr_variation_orders SET title = ?, client_ref = ?, value_approved_paise = ?, time_approved_days = ?, approved_on = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.title ?? v.title, 'clientRef' in b ? b.clientRef : v.client_ref, 'approvedValue' in b ? paise(b.approvedValue) : v.value_approved_paise, b.approvedDays ?? v.time_approved_days, 'approvedOn' in b ? b.approvedOn : v.approved_on, actor.user, nowIso(), v.id); audit(actor, 'ctr_variation_orders', v.id, 'update', v.company_id); return vos.get(actor, v.id); },
    submit(actor, id) { vflow.submit(actor, id); return vos.get(actor, id); }, withdraw: (actor, id, b) => { vflow.withdraw(actor, id, b); return vos.get(actor, id); }, cancel: (actor, id, b) => { vflow.cancel(actor, id, b); return vos.get(actor, id); }, history: (actor, id) => vflow.history(actor, id),
  };
  /** BR-01 for billing (22.03): an extra item is billed only once its variation order is approved, unless the contract allows provisional billing. */
  function billingGate(companyId, { projectId, voItemId = null, voNo = null }) {
    const row = voItemId ? db.prepare('SELECT v.*, i.is_extra FROM ctr_vo_items i JOIN ctr_variation_orders v ON v.id = i.vo_id WHERE i.id = ? AND v.company_id = ? AND v.org_project_id = ?').get(rid(voItemId), companyId, rid(projectId)) : db.prepare('SELECT * FROM ctr_variation_orders WHERE company_id = ? AND org_project_id = ? AND vo_no = ? COLLATE NOCASE AND deleted_at IS NULL').get(companyId, rid(projectId), voNo ?? '');
    const provisional = base.param(companyId, 'ctr.variation.provisional_billing') === true;
    if (row && row.status === 'APPROVED' && row.vo_state === 'EFFECTIVE') return { allowed: true, basis: 'APPROVED', voNo: row.vo_no };
    if (provisional) return { allowed: true, basis: 'PROVISIONAL', voNo: row?.vo_no ?? null };
    return { allowed: false, basis: null, voNo: row?.vo_no ?? null, reason: row ? `${row.vo_no} is not approved yet: an extra item is billed only after its variation order is approved` : 'No variation order covers this item: an extra item is billed only after its variation order is approved' };
  }
  /** The adapter for the deviation statements (22.02): an accepted deviation, or an approved extra item, becomes a change request of the source "quantity deviation"; the person was authorised by the billing permission, the change request then follows its own approval. */
  function raiseFromDeviation(actor, b) {
    return transaction(db, () => {
      const pj = db.prepare('SELECT id FROM org_projects WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(b.projectId), actor.companyId); if (!pj) fail([{ field: 'projectId', message: 'Not a project of this company' }]);
      const no = flow.next(actor); const crNo = number(actor.companyId, actor.user, 'CTR_CR_NO', 'ctr_change_requests', 'CR', {});
      const id = Number(db.prepare("INSERT INTO ctr_change_requests (company_id, doc_no, cr_no, kind, org_project_id, org_site_id, contract_id, origin_type, origin_ref, origin_id, title, description, created_by, source_type, source_id) VALUES (?, ?, ?, 'CLIENT', ?, ?, ?, 'QTY_DEVIATION', ?, ?, ?, ?, ?, ?, ?)").run(actor.companyId, no, crNo, pj.id, b.siteId ?? null, b.contractId ?? null, b.ref, b.sourceId ?? null, String(b.title).slice(0, 200), String(b.description).slice(0, 4000), actor.user, b.sourceType, String(b.sourceId ?? '')).lastInsertRowid);
      audit(actor, 'ctr_change_requests', id, 'create', actor.companyId, { reason: `raised from ${b.ref}` }); return { id, docNo: no, crNo };
    });
  }
  return { changeRequests: crs, variationOrders: vos, variations: { billingGate, raiseFromDeviation } };
}
