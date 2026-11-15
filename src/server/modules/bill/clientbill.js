import { calcOf } from '../../platform/calc/index.js';
import { transaction } from '../../platform/db/index.js';
import { toPdf } from '../../platform/export/index.js';
import { conflict, unprocessable } from '../../platform/http/errors.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { toCsv } from '../../platform/security/csv.js';
import { todayIST } from '../../../shared/dates.js';
import { ctrOf } from '../ctr/index.js';
import { nowIso, rid } from '../proc/base.js';
import { qaHelpers } from '../qa/common.js';
import { STATUS, createFlow } from '../qa/flow.js';

// The client running-account bill (part 22.03): the certified measurements not yet billed up to the end of the period, priced at the rates of the contract (and of the approved variations for extra items), added to the previous bills for the cumulative figures; the approved escalation; the milestones of a lump-sum contract; the deductions of the contract terms and the statutory ones, worked out by the calculation engine with their traces; GST by the tax formula.
// Money is paise inside and rupees in the API; quantities x1000; rates x10000.
for (const [key, def, description] of [
  ['bill.client.gst_pct', 18, 'GST rate on the works contract bills of the client when the bill gives none (part 22.03 FR-03).'],
  ['bill.client.tds_pct', 2, 'Income-tax TDS deducted by the client from the taxable value of a bill (part 22.03 FR-02).'],
  ['bill.client.gst_tds_pct', 2, 'GST-TDS deducted by the client from the taxable value of a bill (part 22.03 FR-02).'],
  ['bill.client.cess_pct', 1, 'Building and other construction workers cess on the value of work of a bill (part 22.03 FR-02).']]) {
  if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType: 'decimal', default: def, scopes: ['system', 'company'], description, min: 0, max: 100 });
}
export const BILL_TYPE = { RA: 'Running account bill', FINAL: 'Final bill', ESCALATION: 'Escalation bill', MILESTONE: 'Milestone bill' };
export const CLIENT_STATE = { NOT_SENT: 'Not sent to the client', SENT: 'Sent to the client' };
export const DEDUCTION_KIND = { RETENTION: 'Retention', ADVANCE_RECOVERY: 'Advance recovery', SECURED_ADVANCE: 'Secured advance on materials', CLIENT_MATERIAL: 'Material supplied by the client', WATER_ELECTRICITY: 'Water and electricity charges', CESS: 'BOCW labour cess', TDS: 'Income-tax TDS', GST_TDS: 'GST-TDS', LD: 'Liquidated damages', OTHER: 'Other recovery' };
export const MANUAL_KINDS = ['SECURED_ADVANCE', 'CLIENT_MATERIAL', 'WATER_ELECTRICITY', 'OTHER'];
const rs = (p) => (p == null ? null : p / 100); const paise = (r) => Math.round(Number(r) * 100); const D = (p) => (p / 100).toFixed(2); const toP = (s) => Math.round(Number(s) * 100);
const d3 = (t) => (t == null ? null : t / 1000);
/** quantity x1000 times rate x10000 is paise x 100000; rounded half up. */
export const amountOf = (qtyTh, rateX4) => Number((BigInt(qtyTh) * BigInt(rateX4) * 2n + 100000n) / 200000n);
const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });

export const cbList = defineList({ code: 'bill.client_bills', label: 'Client bills', permission: 'bill.client_bill.view', from: 'bill_client_bills x JOIN org_projects p ON p.id = x.org_project_id JOIN ctr_contracts k ON k.id = x.contract_id', where: "x.deleted_at IS NULL AND x.status <> 'CANCELLED'", searchable: ['x.doc_no', 'x.bill_no', 'p.code', 'k.contract_no', 'x.client_ref'], defaultSort: '-periodTo',
  columns: { billNo: { sql: 'x.bill_no', type: 'text', label: 'Bill' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, contract: { sql: 'k.contract_no', type: 'text', label: 'Contract' }, type: { sql: 'x.bill_type', type: 'enum', label: 'Type', options: Object.entries(BILL_TYPE) }, periodTo: { sql: 'x.period_to', type: 'date', label: 'Period to' }, gross: { sql: '(x.gross_paise / 100.0)', type: 'number', label: 'Value of work' }, gst: { sql: '(x.gst_paise / 100.0)', type: 'number', label: 'GST' }, deductions: { sql: '(x.deductions_paise / 100.0)', type: 'number', label: 'Deductions' }, net: { sql: '(x.net_paise / 100.0)', type: 'number', label: 'Net payable' }, client: { sql: 'x.client_state', type: 'enum', label: 'Client', options: Object.entries(CLIENT_STATE) }, status: { sql: 'x.status', type: 'enum', label: 'Approval', options: Object.entries(STATUS) } } });

export function createClientBillService({ db, base, mb }) {
  const { audit, fail, may, notify, param } = base; const { evt, gate, scopeOf, pcode, projectOk } = qaHelpers({ db, base }); const today = () => todayIST(); const ctr = () => ctrOf(db)?.svc;
  const num = (companyId, key) => Number(param(companyId, key) ?? 0);
  /** BR-02: every deduction is worked out by a formula of the calculation engine; the trace is kept with the bill. */
  function pctOf(basePaise, pct, rec, field) {
    const out = calcOf(db).evaluate('est.percent_amount', { base: D(Math.max(0, basePaise)), percent: String(pct) }, rec.id ? { entity: 'bill_client_bills', entityId: rec.id, field, companyId: rec.companyId, user: rec.user } : {});
    return { paise: toP(out.result.amount), formula: `${out.formula.code} v${out.formula.version}` };
  }
  function gstOf(taxablePaise, pct, supply, rec) {
    const out = calcOf(db).evaluate('tax.gst_split', { taxable: D(Math.max(0, taxablePaise)), gst_percent: String(pct), supply }, rec.id ? { entity: 'bill_client_bills', entityId: rec.id, field: 'gst', companyId: rec.companyId, user: rec.user } : {});
    return { cgst: toP(out.result.cgst), sgst: toP(out.result.sgst), igst: toP(out.result.igst), total: toP(out.result.tax_total), formula: `${out.formula.code} v${out.formula.version}` };
  }
  const contractOf = (companyId, projectId, id) => { const k = db.prepare("SELECT * FROM ctr_contracts WHERE id = ? AND company_id = ? AND org_project_id = ? AND deleted_at IS NULL").get(rid(id), companyId, projectId); if (!k) fail([{ field: 'contractId', message: 'Not a contract of this project' }]); if (k.status !== 'APPROVED' || !['ACTIVE'].includes(k.contract_state)) fail([{ field: 'contractId', message: 'Only an approved, active contract is billed' }]); return k; };
  /**
   * The whole bill from its inputs, on the server (FR-01 to FR-03): used by the preview, the save and the submit.
   */
  function build({ companyId, user, k, billType, periodTo, supply, gstPct, manual = [], ldAmount = 0, billNo, billId = 0 }) {
    const rec = { id: billId, companyId, user }; const issues = []; const issue = (code, severity, message) => issues.push({ code, severity, message });
    const prevBills = db.prepare("SELECT * FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND id <> ? ORDER BY seq_no").all(k.id, billId); const prevIds = prevBills.map((x) => x.id);
    const prevItems = prevIds.length ? db.prepare(`SELECT * FROM bill_client_bill_items WHERE bill_id IN (${prevIds.map(() => '?').join(',')}) AND deleted_at IS NULL`).all(...prevIds) : []; const prevByCode = new Map();
    for (const p of prevItems) { const key = `${p.item_kind}|${p.item_code.toLowerCase()}`; const a = prevByCode.get(key) ?? { qty: 0, amount: 0 }; a.qty += p.this_qty_th; a.amount += p.this_amount_paise; prevByCode.set(key, a); }
    const items = []; const mbIds = [];
    // the lines of the BOQ with their rates: the contract version, or a version of an approved variation (extra items)
    const lines = db.prepare("SELECT l.id, l.item_code, l.description, l.uom, l.rate, v.vtype, v.status AS vstatus, v.variation_ref AS vref, v.version_no FROM proj_boq_lines l JOIN proj_boq_versions v ON v.id = l.version_id WHERE v.company_id = ? AND v.org_project_id = ? AND l.deleted_at IS NULL AND v.deleted_at IS NULL AND l.line_kind IN ('ITEM', 'SUBITEM') ORDER BY v.version_no, l.id").all(companyId, k.org_project_id); const byCode = new Map();
    for (const l of lines) { const c = l.item_code.toLowerCase(); const e = byCode.get(c) ?? { contract: false, latest: null }; byCode.set(c, e); if (l.vtype === 'CONTRACT' && l.vstatus === 'APPROVED') e.contract = true; if (l.vstatus === 'APPROVED' || (l.vtype === 'REVISED' && l.vref)) e.latest = l; }
    if (billType !== 'ESCALATION' && billType !== 'MILESTONE') {
      const entries = db.prepare("SELECT e.id, e.certified_qty_th AS q, l.item_code FROM bill_mb_entries e JOIN proj_boq_lines l ON l.id = e.boq_line_id WHERE e.company_id = ? AND e.org_project_id = ? AND e.status = 'APPROVED' AND e.deleted_at IS NULL AND e.bill_ref IS NULL AND e.certified_on <= ? ORDER BY e.id").all(companyId, k.org_project_id, periodTo); const groups = new Map();
      for (const e of entries) { const c = e.item_code.toLowerCase(); const g = groups.get(c) ?? { code: e.item_code, qty: 0, ids: [] }; g.qty += e.q; g.ids.push(e.id); groups.set(c, g); }
      for (const g of [...groups.values()].sort((a, b) => natural(a.code, b.code))) {
        const info = byCode.get(g.code.toLowerCase()); const l = info?.latest;
        if (!l) { issue('ITEM_NOT_IN_CONTRACT', 'WARN', `${g.code}: the item is not in the contract BOQ nor in an approved variation; its measurements are not billed`); continue; }
        const kind = info.contract ? 'BOQ' : 'EXTRA';
        if (kind === 'EXTRA') { const gt = ctr()?.variations?.billingGate(companyId, { projectId: k.org_project_id, voNo: l.vref }); if (!gt?.allowed) { issue('VO_NOT_APPROVED', 'WARN', `${g.code}: ${gt?.reason ?? 'the variation order is not approved'}; its measurements are not billed`); continue; } }
        const prev = prevByCode.get(`${kind}|${g.code.toLowerCase()}`) ?? { qty: 0, amount: 0 }; const cum = prev.qty + g.qty;
        const cert = db.prepare("SELECT COALESCE(SUM(e.certified_qty_th), 0) AS s FROM bill_mb_entries e JOIN proj_boq_lines x ON x.id = e.boq_line_id WHERE e.company_id = ? AND e.org_project_id = ? AND x.item_code = ? COLLATE NOCASE AND e.status = 'APPROVED' AND e.deleted_at IS NULL AND e.certified_on <= ?").get(companyId, k.org_project_id, g.code, periodTo).s;
        if (cum > cert) fail([{ field: g.code, message: `${g.code}: the cumulative quantity ${d3(cum)} is more than the certified ${d3(cert)}` }]);
        items.push({ item_kind: kind, boq_line_id: l.id, milestone_id: null, item_code: g.code, description: l.description, uom: l.uom, vo_no: kind === 'EXTRA' ? l.vref : null, rate_x4: l.rate, prev_qty_th: prev.qty, this_qty_th: g.qty, cum_qty_th: cum, certified_cum_th: cert, prev_amount_paise: prev.amount, this_amount_paise: amountOf(g.qty, l.rate), cum_amount_paise: prev.amount + amountOf(g.qty, l.rate), mb_ids_json: JSON.stringify(g.ids) }); mbIds.push(...g.ids);
      }
    }
    if (billType === 'MILESTONE') {
      const used = new Set(db.prepare("SELECT i.milestone_id FROM bill_client_bill_items i JOIN bill_client_bills b ON b.id = i.bill_id WHERE b.contract_id = ? AND b.deleted_at IS NULL AND b.status NOT IN ('CANCELLED', 'REJECTED') AND i.milestone_id IS NOT NULL AND b.id <> ?").all(k.id, billId).map((x) => x.milestone_id));
      for (const m of db.prepare("SELECT * FROM ctr_milestones WHERE contract_id = ? AND deleted_at IS NULL AND payment_linked = 1 AND milestone_status = 'ACHIEVED' ORDER BY sort_order, due_date, id").all(k.id)) { if (used.has(m.id)) continue; items.push({ item_kind: 'MILESTONE', boq_line_id: null, milestone_id: m.id, item_code: m.code, description: m.name, uom: 'LS', vo_no: null, rate_x4: m.amount_paise * 100, prev_qty_th: 0, this_qty_th: 1000, cum_qty_th: 1000, certified_cum_th: 1000, prev_amount_paise: 0, this_amount_paise: m.amount_paise, cum_amount_paise: m.amount_paise, mb_ids_json: '[]' }); }
    }
    const gross = items.reduce((n, x) => n + x.this_amount_paise, 0); const prevGross = prevBills.reduce((n, x) => n + x.gross_paise, 0);
    // the approved escalation of this bill (21.07)
    const esc = ctr()?.escalations?.forBill(companyId, { contractId: k.id, billRef: billNo }) ?? null; const escPaise = esc ? paise(esc.amount) : 0;
    if (!esc && k.pvc_applicable === 1) issue('ESCALATION_PENDING', 'INFO', 'The contract has price variation but no approved escalation computation is made against this bill number; it is billed separately or after the computation is approved');
    if (billType === 'ESCALATION' && !esc) fail([{ field: 'billType', message: `An escalation bill needs an approved escalation computation against the bill number ${billNo}` }]);
    if (!items.length && billType !== 'ESCALATION') fail([{ field: 'periodTo', message: billType === 'MILESTONE' ? 'No achieved payment milestone is waiting to be billed' : `There is no certified measurement to bill up to ${periodTo}` }]);
    const taxable = Math.max(0, gross + escPaise); const pct = gstPct ?? num(companyId, 'bill.client.gst_pct'); const gst = gstOf(taxable, pct, supply, rec);
    // the deductions
    const ded = []; const add = (kind, label, basis, pct2, amount, note, calc = null, extra = {}) => { if (amount > 0) ded.push({ kind, label, basis, pct: pct2, amount, note, calc, ...extra }); };
    if (k.retention_bp > 0) { const r = pctOf(gross, k.retention_bp / 100, rec, 'retention'); let amount = r.paise; let note = `${k.retention_bp / 100}% of the value of work`; if (k.retention_cap_bp > 0) { const cap = Math.round((k.revised_paise * k.retention_cap_bp) / 10000); const before = prevBills.reduce((n, b) => n + JSON.parse(b.deductions_json).filter((x) => x.kind === 'RETENTION').reduce((m, x) => m + x.amount, 0), 0); if (before + amount > cap) { amount = Math.max(0, cap - before); note += `; limited to the cap of ${k.retention_cap_bp / 100}% of the contract value`; } } add('RETENTION', DEDUCTION_KIND.RETENTION, gross, k.retention_bp / 100, amount, note, r.formula); }
    const advs = db.prepare("SELECT * FROM ctr_advances WHERE contract_id = ? AND deleted_at IS NULL ORDER BY id").all(k.id); const advTotal = advs.reduce((n, a) => n + a.advance_paise, 0); const advOut = advs.reduce((n, a) => n + a.advance_paise - a.recovered_paise, 0);
    if (advOut > 0 && k.revised_paise > 0 && gross > 0) { const t = JSON.parse(k.advance_terms_json || '{}'); const lo = Math.round(((t.recoveryStartPct ?? 0) / 100) * k.revised_paise); const hi = t.recoveryEndPct > 0 ? Math.round((t.recoveryEndPct / 100) * k.revised_paise) : k.revised_paise; const from = Math.max(prevGross, lo); const to = Math.min(prevGross + gross, hi); const covered = Math.max(0, to - from); const rec2 = hi > lo ? Math.min(advOut, Math.round((advTotal * covered) / (hi - lo))) : 0; add('ADVANCE_RECOVERY', DEDUCTION_KIND.ADVANCE_RECOVERY, covered, null, rec2, `${D(covered)} of the band ${t.recoveryStartPct ?? 0}% to ${t.recoveryEndPct || 100}% of the contract value is billed; outstanding advance ${D(advOut)}`, null); }
    const cessPct = num(companyId, 'bill.client.cess_pct'); if (cessPct > 0) { const r = pctOf(gross, cessPct, rec, 'cess'); add('CESS', DEDUCTION_KIND.CESS, gross, cessPct, r.paise, `${cessPct}% of the value of work`, r.formula); }
    const tdsPct = num(companyId, 'bill.client.tds_pct'); if (tdsPct > 0) { const r = pctOf(taxable, tdsPct, rec, 'tds'); add('TDS', DEDUCTION_KIND.TDS, taxable, tdsPct, r.paise, `${tdsPct}% of the taxable value`, r.formula); }
    const gtdsPct = num(companyId, 'bill.client.gst_tds_pct'); if (gtdsPct > 0) { const r = pctOf(taxable, gtdsPct, rec, 'gst_tds'); add('GST_TDS', DEDUCTION_KIND.GST_TDS, taxable, gtdsPct, r.paise, `${gtdsPct}% of the taxable value`, r.formula); }
    const ldP = paise(ldAmount); if (ldP > 0) { const a = db.prepare('SELECT * FROM ctr_ld_assessments WHERE contract_id = ? AND deleted_at IS NULL ORDER BY as_of DESC LIMIT 1').get(k.id); const taken = db.prepare("SELECT deductions_json FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND id <> ?").all(k.id, billId).reduce((n, b) => n + JSON.parse(b.deductions_json).filter((x) => x.kind === 'LD').reduce((m, x) => m + x.amount, 0), 0); const left = a ? Math.max(0, a.ld_paise - Math.max(a.deducted_paise, taken)) : 0; if (ldP > left) fail([{ field: 'ldAmount', message: `The liquidated damages levied and not yet deducted are ${D(left)}` }]); add('LD', DEDUCTION_KIND.LD, a.ld_paise, null, ldP, `of the ${D(a.ld_paise)} assessed on ${a.as_of}`, null); }
    for (const [i, m] of manual.entries()) { if (!MANUAL_KINDS.includes(m.kind)) fail([{ field: `manual.${i}.kind`, message: 'Choose a kind of recovery' }]); add(m.kind, m.label || DEDUCTION_KIND[m.kind], null, null, paise(m.amount), m.reason ?? '', null, { manual: true }); }
    const dTotal = ded.reduce((n, x) => n + x.amount, 0); const net = taxable + gst.total - dTotal;
    if (net < 0) issue('NEGATIVE_NET', 'WARN', 'The deductions are more than the bill: nothing is payable and the balance is carried by the client');
    return { items, mbIds, gross, prevGross, escPaise, escId: esc?.escalationId ?? null, taxable, gst, pct, deductions: ded, dTotal, net, issues, prevBillId: prevBills.at(-1)?.id ?? null };
  }
  const cols = (r) => ({ prev_bill_id: r.prevBillId, prev_gross_paise: r.prevGross, gross_paise: r.gross, cum_gross_paise: r.prevGross + r.gross, escalation_paise: r.escPaise, escalation_calc_id: r.escId, taxable_paise: r.taxable, gst_json: JSON.stringify({ cgst: r.gst.cgst, sgst: r.gst.sgst, igst: r.gst.igst, formula: r.gst.formula }), gst_paise: r.gst.total, gst_pct_bp: Math.round(r.pct * 100), deductions_json: JSON.stringify(r.deductions), deductions_paise: r.dTotal, net_paise: r.net, issues_json: JSON.stringify(r.issues), mb_ids_json: JSON.stringify(r.mbIds) });
  const saveItems = (companyId, billId, user, r) => { db.prepare('DELETE FROM bill_client_bill_items WHERE bill_id = ?').run(billId); r.items.forEach((x, i) => db.prepare('INSERT INTO bill_client_bill_items (company_id, bill_id, line_no, item_kind, boq_line_id, milestone_id, item_code, description, uom, vo_no, rate_x4, prev_qty_th, this_qty_th, cum_qty_th, certified_cum_th, prev_amount_paise, this_amount_paise, cum_amount_paise, mb_ids_json, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(companyId, billId, i + 1, x.item_kind, x.boq_line_id, x.milestone_id, x.item_code, x.description, x.uom, x.vo_no, x.rate_x4, x.prev_qty_th, x.this_qty_th, x.cum_qty_th, x.certified_cum_th, x.prev_amount_paise, x.this_amount_paise, x.cum_amount_paise, x.mb_ids_json, user, 'mb')); };
  const inputOf = (r) => ({ companyId: r.company_id, k: db.prepare('SELECT * FROM ctr_contracts WHERE id = ?').get(r.contract_id), billType: r.bill_type, periodFrom: r.period_from, periodTo: r.period_to, supply: r.supply, gstPct: r.gst_pct_bp / 100, manual: JSON.parse(r.manual_json), ldAmount: rs(r.ld_input_paise), billNo: r.bill_no, billId: r.id });
  const view = (actor, r, detail = false) => {
    const c0 = flow.can(actor, r); const ded = JSON.parse(r.deductions_json); const gst = JSON.parse(r.gst_json || '{}'); const k = db.prepare('SELECT contract_no, title FROM ctr_contracts WHERE id = ?').get(r.contract_id);
    const o = { id: r.id, docNo: r.doc_no, billNo: r.bill_no, projectId: r.org_project_id, project: pcode(r.org_project_id), contractId: r.contract_id, contractNo: k?.contract_no, billType: r.bill_type, typeLabel: BILL_TYPE[r.bill_type], seqNo: r.seq_no, periodFrom: r.period_from, periodTo: r.period_to, supply: r.supply, gstPct: r.gst_pct_bp / 100,
      prevGross: rs(r.prev_gross_paise), gross: rs(r.gross_paise), cumGross: rs(r.cum_gross_paise), escalation: rs(r.escalation_paise), taxable: rs(r.taxable_paise), gst: rs(r.gst_paise), cgst: rs(gst.cgst ?? 0), sgst: rs(gst.sgst ?? 0), igst: rs(gst.igst ?? 0), deductionsTotal: rs(r.deductions_paise), net: rs(r.net_paise), clientState: r.client_state, clientLabel: CLIENT_STATE[r.client_state], sentOn: r.sent_on, clientRef: r.client_ref, notes: r.notes, status: r.status, statusLabel: STATUS[r.status], version: r.version, requestedBy: r.requested_by,
      can: { ...c0, amend: false, send: r.status === 'APPROVED' && r.client_state === 'NOT_SENT' && may(actor, 'bill.client_bill.send', r.org_project_id, r.org_site_id) } };
    if (detail) Object.assign(o, flow.approveInfo(actor, r), {
      deductions: ded.map((x) => ({ kind: x.kind, label: x.label, basis: x.basis == null ? null : rs(x.basis), pct: x.pct, amount: rs(x.amount), note: x.note, calc: x.calc, manual: Boolean(x.manual) })), manual: JSON.parse(r.manual_json), ldAmount: rs(r.ld_input_paise), issues: JSON.parse(r.issues_json),
      items: db.prepare('SELECT * FROM bill_client_bill_items WHERE bill_id = ? AND deleted_at IS NULL ORDER BY line_no').all(r.id).map(itemView),
      measurements: JSON.parse(r.mb_ids_json).slice(0, 500).map((id) => db.prepare('SELECT e.id, e.doc_no AS docNo, e.description, e.certified_qty_th, e.mb_book AS book, e.mb_page AS page, l.item_code AS item FROM bill_mb_entries e JOIN proj_boq_lines l ON l.id = e.boq_line_id WHERE e.id = ?').get(id)).filter(Boolean).map((e) => ({ id: e.id, docNo: e.docNo, item: e.item, description: e.description, certified: d3(e.certified_qty_th), book: e.book, page: e.page })), cancelReason: r.cancel_reason });
    return o;
  };
  const itemView = (i) => ({ lineNo: i.line_no, kind: i.item_kind, code: i.item_code, description: i.description, uom: i.uom, voNo: i.vo_no, rate: i.rate_x4 / 10000, prevQty: d3(i.prev_qty_th), thisQty: d3(i.this_qty_th), cumQty: d3(i.cum_qty_th), certifiedCum: d3(i.certified_cum_th), prevAmount: rs(i.prev_amount_paise), thisAmount: rs(i.this_amount_paise), cumAmount: rs(i.cum_amount_paise), boqLineId: i.boq_line_id, milestoneId: i.milestone_id });
  const flow = createFlow({ db, base, docType: 'BILL_CLIENT_BILL', table: 'bill_client_bills', perm: 'bill.client_bill', label: 'client bill', route: '/bill/client-bills?id=', ctx: (r) => ({ net: rs(r.net_paise), gross: rs(r.gross_paise), billType: r.bill_type }), title: (r) => `${r.bill_no}`, notifyCode: 'bill.client_bill.decided', numberKey: 'BILL_CLIENT_BILL', prefix: 'CBL',
    beforeSubmit: (actor, r) => {
      const open = db.prepare("SELECT 1 FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status = 'SUBMITTED' AND id <> ?").get(r.contract_id, r.id); if (open) throw conflict('Another bill of this contract is waiting for approval: it is approved or withdrawn first.');
      const b = build({ ...inputOf(r), user: actor.user }); if (b.issues.some((x) => x.severity === 'BLOCK')) fail(b.issues.filter((x) => x.severity === 'BLOCK').map((x) => ({ field: x.code, message: x.message })));
      transaction(db, () => { const c = cols(b); db.prepare(`UPDATE bill_client_bills SET ${Object.keys(c).map((x) => `${x} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(c), r.id); saveItems(r.company_id, r.id, actor.user, b); });
    },
    onApproved: (actor, r) => {
      const ids = JSON.parse(r.mb_ids_json); if (ids.length) mb.markBilled(r.company_id, { mbIds: ids, billRef: r.bill_no });
      for (const i of db.prepare('SELECT * FROM bill_client_bill_items WHERE bill_id = ? AND milestone_id IS NOT NULL').all(r.id)) ctr()?.milestones?.markBilled(r.company_id, { milestoneId: i.milestone_id, billRef: r.bill_no });
      const adv = JSON.parse(r.deductions_json).find((x) => x.kind === 'ADVANCE_RECOVERY'); if (adv) { let left = adv.amount; for (const a of db.prepare('SELECT * FROM ctr_advances WHERE contract_id = ? AND deleted_at IS NULL ORDER BY id').all(r.contract_id)) { const take = Math.min(left, a.advance_paise - a.recovered_paise); if (take > 0) { ctr().advances.apply(r.company_id, { contractId: r.contract_id, refNo: a.ref_no, kind: a.advance_kind, advance: rs(a.advance_paise), recovered: rs(a.recovered_paise + take), actor }); left -= take; } } }
      evt('bill.client.approved', actor, r.company_id, 'bill_client_bills', r.id, { billId: r.id, billNo: r.bill_no, projectId: r.org_project_id, contractId: r.contract_id, billType: r.bill_type, gross: rs(r.gross_paise), net: rs(r.net_paise) }, r.org_project_id);
    } });
  const data = (r) => ({ billId: r.id, docNo: r.doc_no, billNo: r.bill_no, seqNo: r.seq_no, billType: r.bill_type, projectId: r.org_project_id, contractId: r.contract_id, periodFrom: r.period_from, periodTo: r.period_to, gross: rs(r.gross_paise), cumGross: rs(r.cum_gross_paise), escalation: rs(r.escalation_paise), taxable: rs(r.taxable_paise), gst: rs(r.gst_paise), deductions: rs(r.deductions_paise), net: rs(r.net_paise), sentOn: r.sent_on, clientRef: r.client_ref });
  const same = (b, r = {}) => ({ billType: b.billType ?? r.bill_type ?? 'RA', periodFrom: b.periodFrom ?? r.period_from, periodTo: b.periodTo ?? r.period_to, supply: b.supply ?? r.supply ?? 'intra', gstPct: 'gstPct' in b ? b.gstPct : r.gst_pct_bp != null ? r.gst_pct_bp / 100 : null, manual: b.manual ?? (r.manual_json ? JSON.parse(r.manual_json) : []), ldAmount: 'ldAmount' in b ? b.ldAmount ?? 0 : rs(r.ld_input_paise ?? 0) });
  const bills = {
    ...flow,
    list(actor, query) { return runList(db, cbList, parseListRequest(cbList, query), { select: 'x.*', scopeSql: scopeOf(actor, 'bill.client_bill.view'), params: { c: actor.companyId }, tieBreaker: 'x.id', map: (r) => view(actor, r) }); },
    get: (actor, id) => view(actor, flow.row(actor, id), true),
    options(actor) {
      gate(actor, 'bill.client_bill.create', 'prepare client bills'); return { projects: db.prepare("SELECT id, code, name FROM org_projects WHERE company_id = ? AND deleted_at IS NULL AND status = 'ACTIVE' ORDER BY code").all(actor.companyId).filter((p) => may(actor, 'bill.client_bill.create', p.id)),
        contracts: db.prepare("SELECT id, contract_no AS contractNo, org_project_id AS projectId, contract_type AS type, retention_bp, pvc_applicable FROM ctr_contracts WHERE company_id = ? AND deleted_at IS NULL AND status = 'APPROVED' AND contract_state = 'ACTIVE' ORDER BY contract_no LIMIT 500").all(actor.companyId).map((c) => ({ id: c.id, contractNo: c.contractNo, projectId: c.projectId, type: c.type, retentionPct: c.retention_bp / 100, pvc: c.pvc_applicable === 1 })),
        types: Object.entries(BILL_TYPE).map(([id, label]) => ({ id, label })), kinds: MANUAL_KINDS.map((id) => ({ id, label: DEDUCTION_KIND[id] })), gstPct: num(actor.companyId, 'bill.client.gst_pct'), tdsPct: num(actor.companyId, 'bill.client.tds_pct'), gstTdsPct: num(actor.companyId, 'bill.client.gst_tds_pct'), cessPct: num(actor.companyId, 'bill.client.cess_pct') };
    },
    /** FR-01 to FR-03 without saving: what the bill would be, for the form. */
    preview(actor, b) {
      const pj = projectOk(actor, b.projectId, 'bill.client_bill.create'); const k = contractOf(actor.companyId, pj.id, b.contractId); const seq = (db.prepare("SELECT COALESCE(MAX(seq_no), 0) AS m FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(k.id).m) + 1; const x = same(b);
      const r = build({ companyId: actor.companyId, user: actor.user, k, ...x, billNo: `${k.contract_no}/RA-${seq}` }); return { seqNo: seq, billNo: `${k.contract_no}/RA-${seq}`, gross: rs(r.gross), prevGross: rs(r.prevGross), escalation: rs(r.escPaise), taxable: rs(r.taxable), gst: rs(r.gst.total), deductionsTotal: rs(r.dTotal), net: rs(r.net), items: r.items.map((i, n) => itemView({ ...i, line_no: n + 1 })), deductions: r.deductions.map((d) => ({ kind: d.kind, label: d.label, amount: rs(d.amount), note: d.note, pct: d.pct })), issues: r.issues };
    },
    create(actor, b) {
      const pj = projectOk(actor, b.projectId, 'bill.client_bill.create'); const k = contractOf(actor.companyId, pj.id, b.contractId); if (b.periodTo < b.periodFrom) fail([{ field: 'periodTo', message: 'The period ends before it starts' }]);
      if (db.prepare("SELECT 1 FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status IN ('DRAFT', 'SUBMITTED', 'RETURNED')").get(k.id)) throw conflict('This contract has a bill that is not finished: approve, cancel or finish it before preparing the next.');
      return transaction(db, () => {
        const seq = (db.prepare("SELECT COALESCE(MAX(seq_no), 0) AS m FROM bill_client_bills WHERE contract_id = ? AND deleted_at IS NULL AND status NOT IN ('CANCELLED', 'REJECTED')").get(k.id).m) + 1; const billNo = `${k.contract_no}/RA-${seq}`; const no = flow.next(actor); const x = same(b);
        const id = Number(db.prepare('INSERT INTO bill_client_bills (company_id, doc_no, bill_no, org_project_id, org_site_id, contract_id, bill_type, seq_no, period_from, period_to, supply, manual_json, ld_input_paise, notes, requested_by, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(actor.companyId, no, billNo, pj.id, b.siteId ?? null, k.id, x.billType, seq, x.periodFrom, x.periodTo, x.supply, JSON.stringify(x.manual), paise(x.ldAmount), b.notes ?? null, actor.user, actor.user, 'mb').lastInsertRowid);
        const r = build({ companyId: actor.companyId, user: actor.user, k, ...x, billNo, billId: id }); const c = cols(r); db.prepare(`UPDATE bill_client_bills SET ${Object.keys(c).map((y) => `${y} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(c), id); saveItems(actor.companyId, id, actor.user, r);
        if (b.net != null && paise(b.net) !== r.net) fail([{ field: 'net', message: `The net payable is worked out by the server: ${D(r.net)}` }]);
        audit(actor, 'bill_client_bills', id, 'create', actor.companyId); return bills.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = flow.row(actor, id, 'bill.client_bill.edit'); if (!flow.EDITABLE.includes(r.status)) throw conflict('An approved bill is locked.'); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this; reload it.');
      const x = same(b, r); if (x.periodTo < x.periodFrom) fail([{ field: 'periodTo', message: 'The period ends before it starts' }]);
      return transaction(db, () => { const k = db.prepare('SELECT * FROM ctr_contracts WHERE id = ?').get(r.contract_id); const res = build({ companyId: r.company_id, user: actor.user, k, ...x, billNo: r.bill_no, billId: r.id }); const c = { ...cols(res), bill_type: x.billType, period_from: x.periodFrom, period_to: x.periodTo, supply: x.supply, manual_json: JSON.stringify(x.manual), ld_input_paise: paise(x.ldAmount), notes: 'notes' in b ? b.notes : r.notes };
        db.prepare(`UPDATE bill_client_bills SET ${Object.keys(c).map((y) => `${y} = ?`).join(', ')}, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?`).run(...Object.values(c), actor.user, nowIso(), r.id); saveItems(r.company_id, r.id, actor.user, res); audit(actor, 'bill_client_bills', r.id, 'update', r.company_id); return bills.get(actor, r.id); });
    },
    remove: (actor, id) => flow.remove(actor, id), submit(actor, id) { flow.submit(actor, id); return bills.get(actor, id); }, withdraw: (actor, id, b) => { flow.withdraw(actor, id, b); return bills.get(actor, id); }, cancel: (actor, id, b) => { flow.cancel(actor, id, b); return bills.get(actor, id); }, history: (actor, id) => flow.history(actor, id),
    amend(actor, id) { flow.row(actor, id, 'bill.client_bill.amend'); throw unprocessable('An approved bill is locked, its measurements are marked billed. A correction goes in the next bill as a negative measurement entry or through the certification of 22.04.'); },
    /** FR-05: the approved bill goes to the client; the certification (22.04) and the cash forecast (23.13) take it from the event. */
    send(actor, id, b) {
      const r = flow.row(actor, id, 'bill.client_bill.send'); if (r.status !== 'APPROVED') throw unprocessable('Only an approved bill goes to the client.'); if (r.client_state !== 'NOT_SENT') throw conflict('The bill was sent already.'); if (b.sentOn < r.period_to) fail([{ field: 'sentOn', message: 'The bill is not sent before its period ends' }]);
      return transaction(db, () => { db.prepare("UPDATE bill_client_bills SET client_state = 'SENT', sent_on = ?, client_ref = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(b.sentOn, b.clientRef ?? null, actor.user, nowIso(), r.id); audit(actor, 'bill_client_bills', r.id, 'send', r.company_id, { newValues: { sentOn: b.sentOn, ref: b.clientRef } });
        const f = db.prepare('SELECT * FROM bill_client_bills WHERE id = ?').get(r.id); evt('bill.client.submitted', actor, r.company_id, 'bill_client_bills', r.id, data(f), r.org_project_id); notify(r.company_id, 'bill.client_bill.sent', ['role:QS', 'role:PM', 'role:COMMGR'], r.bill_no, 'sent to the client', `${r.bill_no} (net ${D(r.net_paise)}) was sent to the client${b.clientRef ? ` under ${b.clientRef}` : ''}.`, `/bill/client-bills?id=${r.id}`, `${r.id}.sent`, { projectId: r.org_project_id }); return bills.get(actor, r.id); });
    },
    exportCsv(actor) { gate(actor, 'bill.client_bill.export', 'export client bills'); const l = bills.list(actor, { page: 1, pageSize: 100 }); const headers = ['Bill', 'Project', 'Contract', 'Type', 'Period to', 'Value of work', 'Escalation', 'GST', 'Deductions', 'Net payable', 'Client', 'Approval']; const rows = l.data.map((x) => [x.billNo, x.project, x.contractNo, x.typeLabel, x.periodTo, x.gross, x.escalation, x.gst, x.deductionsTotal, x.net, x.clientLabel, x.statusLabel]); audit(actor, 'bill_client_bills', 0, 'export', actor.companyId, { reason: `${rows.length} row(s)` }); return { contentType: 'text/csv; charset=utf-8', fileName: `client-bills-${today()}.csv`, buffer: Buffer.from(`${String.fromCharCode(0xfeff)}${toCsv(headers, rows)}`, 'utf8') }; },
    importRows(actor, { rows }) {
      gate(actor, 'bill.client_bill.create', 'import client bills'); const out = []; for (const [i, x] of rows.entries()) { try { const k = db.prepare("SELECT * FROM ctr_contracts WHERE company_id = ? AND contract_no = ? COLLATE NOCASE AND deleted_at IS NULL").get(actor.companyId, x.contractNo ?? ''); if (!k) throw new Error('Contract not found'); const d = bills.create(actor, { projectId: k.org_project_id, siteId: null, contractId: k.id, billType: x.billType ?? 'RA', periodFrom: x.periodFrom, periodTo: x.periodTo, supply: x.supply ?? 'intra', gstPct: null, manual: [], ldAmount: 0, notes: null, net: null }); out.push({ row: i + 1, docNo: d.docNo, billNo: d.billNo }); } catch (e) { out.push({ row: i + 1, error: e.message }); } }
      return out;
    },
    /** FR-04, FR-05: the bill abstract in the format given to the client: the items with the previous, this and cumulative quantities and amounts, then the summary. */
    print(actor, id) {
      const r = flow.row(actor, id, 'bill.client_bill.print'); const v = bills.get(actor, id); audit(actor, 'bill_client_bills', r.id, 'print', r.company_id); const m = (x) => x.toFixed(2);
      const rows = v.items.map((i) => ({ sl: String(i.lineNo), item: `${i.code}${i.voNo ? ` (${i.voNo})` : ''}`, description: i.description, uom: i.uom ?? '', rate: m(i.rate), prev: String(i.prevQty), cur: String(i.thisQty), cum: String(i.cumQty), prevAmt: m(i.prevAmount), curAmt: m(i.thisAmount), cumAmt: m(i.cumAmount) }));
      const sum = (label, amt) => rows.push({ sl: '', item: '', description: label, uom: '', rate: '', prev: '', cur: '', cum: '', prevAmt: '', curAmt: m(amt), cumAmt: '' });
      sum('Value of work done this bill', v.gross); if (v.escalation) sum('Escalation (price variation)', v.escalation); sum(`GST ${v.gstPct}% (${v.supply === 'intra' ? 'CGST + SGST' : 'IGST'})`, v.gst); for (const d of v.deductions) sum(`Less: ${d.label}`, -d.amount); sum('Net payable', v.net);
      return { buffer: toPdf({ columns: [{ key: 'sl', label: 'Sl', type: 'text' }, { key: 'item', label: 'Item', type: 'text' }, { key: 'description', label: 'Description', type: 'text' }, { key: 'uom', label: 'Unit', type: 'text' }, { key: 'rate', label: 'Rate', type: 'number' }, { key: 'prev', label: 'Previous qty', type: 'number' }, { key: 'cur', label: 'This bill qty', type: 'number' }, { key: 'cum', label: 'Upto date qty', type: 'number' }, { key: 'prevAmt', label: 'Previous amount', type: 'number' }, { key: 'curAmt', label: 'This bill amount', type: 'number' }, { key: 'cumAmt', label: 'Upto date amount', type: 'number' }], rows, footer: [`${v.billNo} · ${v.project} · ${v.contractNo} · ${v.periodFrom} to ${v.periodTo}`], title: `${v.typeLabel} ${v.billNo}` }), contentType: 'application/pdf', fileName: `${v.billNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
  };
  return { clientBills: bills };
}
