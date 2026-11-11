import { createHash, randomBytes } from 'node:crypto';
import { transaction } from '../../platform/db/index.js';
import { publishEvent } from '../../platform/events/index.js';
import { HttpError, conflict, forbidden, notFound, unprocessable } from '../../platform/http/errors.js';
import { toPdf } from '../../platform/export/index.js';
import { commOf } from '../../platform/comm/index.js';
import { defineList, parseListRequest, runList } from '../../platform/list/index.js';
import { controlRegistry, protocolOf } from '../../platform/protocol/index.js';
import { parameterRegistry } from '../../platform/parameters/index.js';
import { workflowOf } from '../../platform/workflow/index.js';
import { todayIST } from '../../../shared/dates.js';
import { d3, json, lower, nowIso, q3, rid, rs, same } from './base.js';

// Requests for quotation and vendor quotations (part 15.03). An RFQ is made from approved requisition lines (one or many requisitions of a project) with its terms and due date, sent to vendors chosen from the active vendors of the partner master
// (never one on hold or blacklisted) by e-mail, WhatsApp or a tokenised link, and the quotations come back: keyed in by procurement, or entered by the vendor on the tokenised page. Each quotation line has a landed rate (FR-05): the basic rate less
// the discount, plus freight, loading and other charges, with GST left out when it is recoverable (a parameter). Above a value threshold at least the minimum number of vendors is invited, unless the single-source justification is approved by the
// procurement manager and the project director (BR-01, control CP-PROC-03). Rates are seen only with `proc.quotation.rates` (BR-02).
export const RFQ_DOC = 'PROC_RFQ_JUSTIFY';
export const RFQ_STATUS = { DRAFT: 'Draft', SUBMITTED: 'Justification waiting for approval', RETURNED: 'Returned for correction', ISSUED: 'Issued to vendors', CLOSED: 'Closed', CANCELLED: 'Cancelled', SUPERSEDED: 'Superseded' };
export const QUOTE_STATUS = { DRAFT: 'Draft', RECEIVED: 'Received', SUPERSEDED: 'Superseded by a revision', WITHDRAWN: 'Withdrawn by the vendor', CANCELLED: 'Cancelled' };
export const RESPONSE_STATUS = { INVITED: 'Invited', SENT: 'Sent', VIEWED: 'Opened', RESPONDED: 'Quoted', DECLINED: 'Declined' };
const EDITABLE = ['DRAFT', 'RETURNED'];

controlRegistry.define({
  code: 'CP-PROC-03', module: 'proc', stage: 'VERIFY', description: 'An enquiry above the value threshold goes to at least the minimum number of vendors, unless a single-source justification is approved', enforcement: 'EXCEPTION', evidenceRequired: true, escalationLevel: 1, ownerRole: 'PROCMGR', mode: 'ENFORCE',
  evaluate: ({ context }) => ({ pass: false, message: context.message ?? 'Fewer vendors than the minimum', details: { ref: context.ref ?? null, vendors: context.vendors ?? null, minimum: context.minimum ?? null } }),
});
for (const [key, dataType, def, description, extra] of [
  ['proc.rfq.min_vendors', 'integer', 3, 'BR-01: the number of vendors an RFQ above the value threshold is sent to, unless the single-source justification is approved (control CP-PROC-03).', { min: 1, max: 20 }],
  ['proc.rfq.threshold_minor', 'integer', 10_000_000, 'BR-01: the estimated value, in paise (₹ 1 lakh), from which the minimum number of vendors applies.', { min: 0, max: 100_000_000_000 }],
  ['proc.rfq.token_grace_days', 'integer', 2, 'FR-03: the days after the due date until which a vendor link still works (a late quotation is accepted until the RFQ is closed).', { min: 0, max: 30 }],
  ['proc.rfq.remind_days', 'integer', 2, 'FR-07: the reminder to vendors who have not answered goes when the due date is this many days away or less.', { min: 0, max: 30 }],
  ['proc.rfq.max_reminders', 'integer', 3, 'FR-07: the most reminders sent to one vendor for one RFQ.', { min: 0, max: 10 }],
  ['proc.rfq.gst_recoverable', 'boolean', true, 'FR-05: whether GST is left out of the landed rate because the company recovers it as input tax credit. Set to false to compare with the GST included.', {}],
]) if (!parameterRegistry.get(key)) parameterRegistry.define({ key, dataType, default: def, scopes: ['system', 'company'], description, .../** @type {any} */ (extra) });

/**
 * FR-05: the landed rate of a quotation line, in paise per unit, and its amount. Percentages are ×10000 (12.5% is 125000), the quantity is in thousandths, freight, loading and other charges are the line totals in paise.
 * The discount is taken off the rate; a rate that includes GST is brought back to its basic value; the charges are added; GST is added back only when it is not recoverable.
 */
export function landed({ rate, discountPct = 0, gstRate = 0, freight = 0, loading = 0, other = 0, qty, inclusive = false, recoverable = true }) {
  const g = gstRate / 1_000_000; const net = rate * (1 - discountPct / 1_000_000); const basic = inclusive ? net / (1 + g) : net;
  const base = (basic * qty) / 1000 + freight + loading + other; const total = recoverable ? base : base * (1 + g);
  return { landedAmount: Math.round(total), landedRate: qty > 0 ? Math.round((total * 1000) / qty) : 0 };
}
const hash = (t) => createHash('sha256').update(t).digest('hex');
const gone = (msg) => new HttpError(410, 'LINK_EXPIRED', msg);

export const rfqList = defineList({
  code: 'proc.rfqs', label: 'Requests for quotation', permission: 'proc.rfq.view', from: 'proc_rfqs x JOIN org_projects p ON p.id = x.org_project_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'x.title', 'p.code'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'RFQ' }, date: { sql: 'x.doc_date', type: 'date', label: 'Date' }, project: { sql: 'p.code', type: 'text', label: 'Project' }, title: { sql: 'x.title', type: 'text', label: 'Title' }, dueDate: { sql: 'x.due_date', type: 'date', label: 'Due' },
    vendors: { sql: '(SELECT COUNT(*) FROM proc_rfq_vendors v WHERE v.rfq_id = x.id AND v.deleted_at IS NULL)', type: 'number', label: 'Vendors', sortable: false },
    responded: { sql: "(SELECT COUNT(*) FROM proc_rfq_vendors v WHERE v.rfq_id = x.id AND v.deleted_at IS NULL AND v.response_status = 'RESPONDED')", type: 'number', label: 'Quoted', sortable: false },
    status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(RFQ_STATUS) },
  },
});
export const quoteList = defineList({
  code: 'proc.quotations', label: 'Vendor quotations', permission: 'proc.quotation.view', from: 'proc_quotations x JOIN proc_rfqs f ON f.id = x.rfq_id JOIN org_projects p ON p.id = x.org_project_id JOIN mdm_partners v ON v.id = x.vendor_id', where: 'x.deleted_at IS NULL', searchable: ['x.doc_no', 'f.doc_no', 'v.legal_name', 'v.trade_name', 'x.quote_ref'], defaultSort: '-date',
  columns: {
    docNo: { sql: 'x.doc_no', type: 'text', label: 'Quotation' }, rfq: { sql: 'f.doc_no', type: 'text', label: 'RFQ' }, vendor: { sql: 'COALESCE(v.trade_name, v.legal_name)', type: 'text', label: 'Vendor' }, project: { sql: 'p.code', type: 'text', label: 'Project' },
    date: { sql: 'x.quote_date', type: 'date', label: 'Quoted on' }, validUntil: { sql: 'x.valid_until', type: 'date', label: 'Valid until' }, versionNo: { sql: 'x.version_no', type: 'number', label: 'Version' }, total: { sql: 'x.total_landed', type: 'text', label: 'Landed total', sortable: false }, deliveryDays: { sql: 'x.delivery_days', type: 'number', label: 'Delivery (days)' },
    via: { sql: 'x.entered_via', type: 'enum', label: 'Entered', options: [['MANUAL', 'By procurement'], ['PORTAL', 'By the vendor']] }, status: { sql: 'x.status', type: 'enum', label: 'Status', options: Object.entries(QUOTE_STATUS) },
  },
});

export function createRfqService({ db, base, baseUrl = () => '' }) {
  const { authz, param, may, need, fail, audit, notify, number, project, itemOf } = base;
  const sysActor = (companyId, user = 'system') => ({ user, companyId, roles: ['SYSTEM'] });
  const evt = (type, actor, r, data, entity = 'proc_rfq') => publishEvent(db, { type, entity, entityId: r.id, actorId: actor?.user ?? 'system', companyId: r.company_id, projectId: r.org_project_id, data: { rfqId: r.rfq_id ?? r.id, docNo: r.doc_no, projectId: r.org_project_id, ...data } });
  const vname = (id) => { const v = db.prepare('SELECT code, trade_name, legal_name FROM mdm_partners WHERE id = ?').get(id); return v ? { code: v.code, name: v.trade_name ?? v.legal_name } : { code: '', name: '' }; };
  const scopeOf = (actor, key, table) => { const f = authz.scopeFilter(actor, key, { project: `${table}.org_project_id` }); return { sql: `${table}.company_id = :c AND ${f.sql}`, params: { c: actor.companyId, ...(f.params ?? {}) } }; };
  const linesOf = (id) => db.prepare('SELECT * FROM proc_rfq_lines WHERE rfq_id = ? AND deleted_at IS NULL ORDER BY line_no').all(id);
  const vendorsOf = (id) => db.prepare('SELECT * FROM proc_rfq_vendors WHERE rfq_id = ? AND deleted_at IS NULL ORDER BY id').all(id);
  const minVendors = (cid) => Number(param(cid, 'proc.rfq.min_vendors') ?? 3); const threshold = (cid) => Number(param(cid, 'proc.rfq.threshold_minor') ?? 10_000_000);
  const recoverable = (cid) => (param(cid, 'proc.rfq.gst_recoverable') ?? true) !== false;
  const link = (token) => `${String(baseUrl() ?? '').replace(/\/$/, '')}/vendor-quote?token=${token}`;
  const newToken = () => randomBytes(24).toString('base64url');
  const expiryOf = (cid, dueDate) => { const d = new Date(`${dueDate}T23:59:59+05:30`); d.setUTCDate(d.getUTCDate() + Number(param(cid, 'proc.rfq.token_grace_days') ?? 2)); return d.toISOString(); };
  const row = (actor, id, key = 'proc.rfq.view') => {
    const r = db.prepare('SELECT * FROM proc_rfqs WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.rfq.view', r.org_project_id)) throw notFound('That RFQ does not exist.'); if (key !== 'proc.rfq.view') need(actor, key, 'do that with an RFQ', r.org_project_id); return r;
  };
  const rowQ = (actor, id, key = 'proc.quotation.view') => {
    const r = db.prepare('SELECT * FROM proc_quotations WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(id), actor.companyId); if (!r || !may(actor, 'proc.quotation.view', r.org_project_id)) throw notFound('That quotation does not exist.'); if (key !== 'proc.quotation.view') need(actor, key, 'do that with a quotation', r.org_project_id); return r;
  };
  const short = (r, vendorCount) => vendorCount < minVendors(r.company_id) && r.est_total >= threshold(r.company_id);
  const contactOf = (vendorId, channel) => { const c = db.prepare('SELECT email, mobile FROM mdm_partner_contacts WHERE partner_id = ? AND deleted_at IS NULL ORDER BY is_primary DESC, id LIMIT 1').get(vendorId); if (channel === 'EMAIL') return c?.email ?? null; if (channel === 'WHATSAPP') { const m = String(c?.mobile ?? '').replace(/[\s-]/g, ''); return !m ? null : m.startsWith('+') ? m : m.length === 10 ? `+91${m}` : `+${m}`; } return null; };

  // ---- the vendors: active ones of the partner master, matched by category and region (FR-02) -----------------------------------------------------------------------------------------------------------------
  const eligibility = (companyId, vendorId) => {
    const p = db.prepare('SELECT id, partner_status, status_reason FROM mdm_partners WHERE id = ? AND company_id = ? AND deleted_at IS NULL').get(rid(vendorId), companyId); if (!p) return 'Not a business partner of this company';
    if (!db.prepare("SELECT 1 FROM mdm_partner_roles WHERE partner_id = ? AND partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND deleted_at IS NULL").get(p.id)) return 'Not a vendor';
    if (p.partner_status !== 'ACTIVE') return p.partner_status === 'ON_HOLD' ? 'On hold: it is not sent an enquiry' : p.partner_status === 'BLACKLISTED' ? 'Blacklisted: it is not sent an enquiry' : `Not active (${p.partner_status.toLowerCase().replace('_', ' ')})`; return null;
  };
  const vendorChoices = (actor, { projectId, prLineIds = [], q = '' }) => {
    project(actor, projectId, 'proc.rfq.view'); const cats = new Set(); const cs = prLineIds.length ? db.prepare(`SELECT DISTINCT c.code, c.name FROM proc_pr_lines l JOIN mdm_items i ON i.id = l.item_id JOIN mdm_item_categories c ON c.id = i.category_id WHERE l.id IN (${prLineIds.map(() => '?').join(',')})`).all(...prLineIds) : [];
    for (const c of cs) { cats.add(lower(c.code)); cats.add(lower(c.name)); }
    const like = `%${q}%`; const rows = db.prepare(`SELECT p.id, p.code, COALESCE(p.trade_name, p.legal_name) AS name, p.partner_status, (SELECT categories_json FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND r.deleted_at IS NULL LIMIT 1) AS cats, (SELECT regions_json FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND r.deleted_at IS NULL LIMIT 1) AS regions FROM mdm_partners p WHERE p.company_id = ? AND p.deleted_at IS NULL AND EXISTS (SELECT 1 FROM mdm_partner_roles r WHERE r.partner_id = p.id AND r.partner_role IN ('VENDOR', 'SERVICE_PROVIDER', 'SUBCONTRACTOR') AND r.deleted_at IS NULL) AND (p.legal_name LIKE ? OR p.trade_name LIKE ? OR p.code LIKE ?) ORDER BY p.legal_name LIMIT 300`).all(actor.companyId, like, like, like);
    return rows.map((p) => { const own = json(p.cats, []).map(lower); const match = !cats.size ? null : own.length === 0 ? 'ANY' : own.some((c) => cats.has(c)) ? 'CATEGORY' : null; const reason = p.partner_status === 'ACTIVE' ? null : eligibility(actor.companyId, p.id);
      return { id: p.id, code: p.code, name: p.name, status: p.partner_status, categories: json(p.cats, []), regions: json(p.regions, []), match, eligible: !reason, excludedReason: reason, email: contactOf(p.id, 'EMAIL'), mobile: contactOf(p.id, 'WHATSAPP') }; }).sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(Boolean(b.match)) - Number(Boolean(a.match)));
  };

  // ---- the views -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
  const vendorView = (v) => { const n = vname(v.vendor_id); return { id: v.id, vendorId: v.vendor_id, code: n.code, name: n.name, channel: v.channel, contactTo: v.contact_to, responseStatus: v.response_status, responseLabel: RESPONSE_STATUS[v.response_status], sentAt: v.sent_at, sendStatus: v.send_status, sendNote: v.send_note, viewedAt: v.viewed_at, respondedAt: v.responded_at, declineReason: v.decline_reason, reminderCount: v.reminder_count, lastReminderAt: v.last_reminder_at, regretSentAt: v.regret_sent_at, linkIssued: Boolean(v.token_hash), linkExpires: v.token_expires, linkUsed: Boolean(v.token_used_at) }; };
  const view = (actor, r, { detail = false } = {}) => {
    const p = db.prepare('SELECT code, name FROM org_projects WHERE id = ?').get(r.org_project_id); const can = (k) => may(actor, k, r.org_project_id); const own = same(r.requested_by, actor.user); const rates = can('proc.quotation.rates');
    const nv = db.prepare('SELECT COUNT(*) AS n, SUM(response_status = \'RESPONDED\') AS ok FROM proc_rfq_vendors WHERE rfq_id = ? AND deleted_at IS NULL').get(r.id); const needsJustification = short(r, nv.n) && !r.justified;
    const o = { id: r.id, docNo: r.doc_no, date: r.doc_date, projectId: r.org_project_id, projectCode: p?.code, projectName: p?.name, title: r.title, issueDate: r.issue_date, dueDate: r.due_date, terms: json(r.terms_json, {}), estTotal: rates ? rs(r.est_total) : null, canSeeRates: rates, status: r.status, statusLabel: RFQ_STATUS[r.status],
      revisionNo: r.revision_no, parentId: r.parent_id, justified: Boolean(r.justified), justification: r.justification, requestedBy: r.requested_by, issuedAt: r.issued_at, issuedBy: r.issued_by, closedAt: r.closed_at, cancelReason: r.cancel_reason, workflowInstanceId: r.workflow_instance_id, rowVersion: r.version,
      vendorCount: nv.n, respondedCount: nv.ok ?? 0, minVendors: minVendors(r.company_id), thresholdValue: rs(threshold(r.company_id)), needsJustification, overdue: r.status === 'ISSUED' && r.due_date < todayIST(),
      can: { edit: can('proc.rfq.edit') && EDITABLE.includes(r.status), submit: can('proc.rfq.submit') && EDITABLE.includes(r.status) && needsJustification, issue: can('proc.rfq.issue') && EDITABLE.includes(r.status), withdraw: r.status === 'SUBMITTED' && own, cancel: can('proc.rfq.cancel') && ['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED'].includes(r.status), delete: can('proc.rfq.delete') && r.status === 'DRAFT' && !r.workflow_instance_id,
        amend: can('proc.rfq.amend') && r.status === 'ISSUED', close: can('proc.rfq.issue') && r.status === 'ISSUED', remind: can('proc.rfq.issue') && r.status === 'ISSUED', approve: can('proc.rfq.approve') && r.status === 'SUBMITTED' && !own, print: can('proc.rfq.print'), quote: can('proc.quotation.create') && r.status === 'ISSUED', clarify: can('proc.rfq.edit') && ['ISSUED', 'CLOSED'].includes(r.status) } };
    if (detail) {
      o.lines = linesOf(r.id).map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; const pl = db.prepare('SELECT l.line_no, l.est_rate, r.doc_no, r.id AS pr_id FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE l.id = ?').get(l.pr_line_id); const s = l.delivery_site_id ? db.prepare('SELECT code, name FROM org_sites WHERE id = ?').get(l.delivery_site_id) : null;
        return { id: l.id, lineNo: l.line_no, prLineId: l.pr_line_id, prId: pl?.pr_id, prNo: pl?.doc_no, prLineNo: pl?.line_no, itemId: l.item_id, itemCode: it?.code ?? null, itemName: it?.name ?? l.service_desc, serviceDesc: l.service_desc, qty: d3(l.qty), uom: l.uom, spec: l.spec, requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, deliverySite: s ? `${s.code} ${s.name}` : null, estRate: rates ? rs(pl?.est_rate ?? 0) : null }; });
      o.vendors = vendorsOf(r.id).map(vendorView);
      o.quotations = db.prepare('SELECT * FROM proc_quotations WHERE rfq_id = ? AND deleted_at IS NULL ORDER BY vendor_id, version_no DESC').all(r.id).map((q) => quoteView(actor, q));
      o.clarifications = db.prepare('SELECT * FROM proc_rfq_clarifications WHERE rfq_id = ? AND deleted_at IS NULL ORDER BY id').all(r.id).map((c) => ({ id: c.id, vendorId: c.vendor_id, vendor: c.vendor_id ? vname(c.vendor_id).name : null, askedBy: c.asked_by, question: c.question, answer: c.answer, answeredBy: c.answered_by, answeredAt: c.answered_at, shareAll: Boolean(c.share_all), at: c.created_at }));
    }
    return o;
  };
  const quoteView = (actor, q, { detail = false } = {}) => {
    const rates = may(actor, 'proc.quotation.rates', q.org_project_id); const can = (k) => may(actor, k, q.org_project_id); const f = db.prepare('SELECT doc_no, status, due_date FROM proc_rfqs WHERE id = ?').get(q.rfq_id); const n = vname(q.vendor_id); const open = f?.status === 'ISSUED';
    const o = { id: q.id, docNo: q.doc_no, rfqId: q.rfq_id, rfqNo: f?.doc_no, rfqStatus: f?.status, vendorId: q.vendor_id, vendorCode: n.code, vendor: n.name, projectId: q.org_project_id, quoteRef: q.quote_ref, quoteDate: q.quote_date, validUntil: q.valid_until, deliveryDays: q.delivery_days, paymentTerms: q.payment_terms, freightTerms: q.freight_terms, gstInclusive: Boolean(q.gst_inclusive), gstRecoverable: Boolean(q.gst_recoverable),
      versionNo: q.version_no, parentId: q.parent_id, status: q.status, statusLabel: QUOTE_STATUS[q.status], enteredVia: q.entered_via, enteredBy: q.entered_by, receivedAt: q.received_at, totalLanded: rates ? rs(q.total_landed) : null, canSeeRates: rates, deviations: q.deviations, cancelReason: q.cancel_reason, rowVersion: q.version,
      expired: q.status === 'RECEIVED' && q.valid_until < todayIST(),
      can: { edit: can('proc.quotation.edit') && q.status === 'DRAFT' && open, submit: can('proc.quotation.submit') && q.status === 'DRAFT' && open, withdraw: can('proc.quotation.cancel') && q.status === 'RECEIVED', cancel: can('proc.quotation.cancel') && ['DRAFT', 'RECEIVED'].includes(q.status), delete: can('proc.quotation.delete') && q.status === 'DRAFT', amend: can('proc.quotation.amend') && q.status === 'RECEIVED' && open, print: can('proc.quotation.print') } };
    if (detail) o.lines = db.prepare('SELECT * FROM proc_quotation_lines WHERE quotation_id = ? AND deleted_at IS NULL ORDER BY rfq_line_id').all(q.id).map((l) => { const rl = db.prepare('SELECT line_no, item_id, service_desc, qty, uom FROM proc_rfq_lines WHERE id = ?').get(l.rfq_line_id); const it = rl?.item_id ? itemOf(q.company_id, rl.item_id) : null;
      return { id: l.id, rfqLineId: l.rfq_line_id, lineNo: rl?.line_no, itemCode: it?.code ?? null, itemName: it?.name ?? rl?.service_desc, uom: rl?.uom, rfqQty: d3(rl?.qty ?? 0), offeredQty: d3(l.offered_qty), rate: rates ? rs(l.rate) : null, discountPct: rates ? l.discount_pct / 10000 : null, gstRate: l.gst_rate / 10000, freight: rates ? rs(l.freight) : null, loading: rates ? rs(l.loading) : null, otherCharges: rates ? rs(l.other_charges) : null, landedRate: rates ? rs(l.landed_rate) : null, landedAmount: rates ? rs(l.landed_amount) : null, make: l.make, deviation: l.deviation }; });
    return o;
  };

  // ---- the lines of an RFQ come from approved requisition lines (FR-01) ---------------------------------------------------------------------------------------------------------------------------
  const prLinesFor = (actor, projectId, lines) => {
    const problems = []; const out = []; const seen = new Set();
    lines.forEach((x, i) => {
      const l = db.prepare("SELECT l.*, r.org_project_id, r.status AS pr_status, r.doc_no FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id WHERE l.id = ? AND r.company_id = ? AND l.deleted_at IS NULL AND r.deleted_at IS NULL").get(x.prLineId, actor.companyId);
      if (!l || l.org_project_id !== projectId) { problems.push({ field: `lines.${i}.prLineId`, message: 'Not a line of a requisition of this project' }); return; }
      if (l.pr_status !== 'APPROVED') problems.push({ field: `lines.${i}.prLineId`, message: `${l.doc_no} is not approved: only approved requisition lines are sent out for quotation` });
      if (seen.has(l.id)) problems.push({ field: `lines.${i}.prLineId`, message: 'This requisition line is already on the RFQ' }); seen.add(l.id);
      const qty = x.qty != null ? q3(x.qty) : l.balance_qty; if (qty > l.balance_qty) problems.push({ field: `lines.${i}.qty`, message: `Only ${d3(l.balance_qty)} ${l.uom} of ${l.doc_no} line ${l.line_no} is left to buy` }); if (l.balance_qty <= 0) problems.push({ field: `lines.${i}.prLineId`, message: `${l.doc_no} line ${l.line_no} has nothing left to buy` });
      out.push({ prLineId: l.id, itemId: l.item_id, serviceDesc: l.service_desc, qty, uom: l.uom, spec: x.spec ?? l.spec ?? null, requiredBy: l.required_by, deliverySiteId: l.delivery_site_id, est: Math.round((qty * (l.est_rate ?? 0)) / 1000) });
    }); fail(problems); return out;
  };
  const checkVendors = (actor, vendors) => {
    const problems = []; const seen = new Set(); vendors.forEach((v, i) => { const why = eligibility(actor.companyId, v.vendorId); if (why) problems.push({ field: `vendors.${i}.vendorId`, message: why }); if (seen.has(v.vendorId)) problems.push({ field: `vendors.${i}.vendorId`, message: 'This vendor is on the RFQ already' }); seen.add(v.vendorId); }); fail(problems);
  };
  const saveLines = (r, lines, actor) => {
    const now = nowIso(); db.prepare('UPDATE proc_rfq_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rfq_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
    lines.forEach((l, i) => db.prepare("INSERT INTO proc_rfq_lines (company_id, rfq_id, line_no, pr_line_id, item_id, service_desc, qty, uom, spec, required_by, delivery_site_id, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, i + 1, l.prLineId, l.itemId, l.serviceDesc, l.qty, l.uom, l.spec, l.requiredBy, l.deliverySiteId, r.org_project_id, actor.user));
  };
  const saveVendors = (r, vendors, actor) => {
    const now = nowIso(); db.prepare('UPDATE proc_rfq_vendors SET deleted_at = ?, deleted_by = ?, is_active = 0, token_hash = NULL WHERE rfq_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id);
    for (const v of vendors) db.prepare("INSERT INTO proc_rfq_vendors (company_id, rfq_id, vendor_id, channel, contact_to, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, v.vendorId, v.channel ?? 'EMAIL', v.contactTo ?? null, r.org_project_id, actor.user);
  };

  // ---- sending (FR-03): the message names the RFQ and carries the link; a channel that is not set up is recorded, and the issuer is given the link ----------------------------------------------
  const invitation = (r, v, url, kind = 'invite') => {
    const co = db.prepare('SELECT short_name FROM org_companies WHERE id = ?').get(r.company_id)?.short_name ?? ''; const head = kind === 'remind' ? `Reminder: quotation requested, ${r.doc_no}` : kind === 'amend' ? `RFQ ${r.doc_no} changed` : `Request for quotation ${r.doc_no}`;
    const ls = linesOf(r.id).map((l) => `${l.line_no}. ${l.item_id ? itemOf(r.company_id, l.item_id)?.name : l.service_desc}: ${d3(l.qty)} ${l.uom}`).join('\n');
    const body = `${co} asks for your quotation for ${r.title} (${r.doc_no}) by ${r.due_date}.\n\n${ls}\n\nSubmit your rates on this page: ${url}\nThe link is for you only and works until ${String(v.token_expires ?? '').slice(0, 10)}. Reply to this message if you have a question.`;
    return { subject: head, body };
  };
  const dispatch = (actor, r, v, url, kind) => {
    const to = v.contact_to || contactOf(v.vendor_id, v.channel); if (v.channel === 'LINK') return { status: 'LINK_ONLY', note: 'Give the vendor the link yourself.', sent: false };
    if (!to) return { status: 'NO_ADDRESS', note: `The vendor has no ${v.channel === 'EMAIL' ? 'e-mail address' : 'mobile number'} in the partner master: give it the link yourself.`, sent: false };
    const m = invitation(r, v, url, kind);
    try { const res = commOf(db).send({ companyId: r.company_id, channel: v.channel, to, subject: m.subject, body: m.body, purpose: 'TRANSACTIONAL', related: { entity: 'proc_rfq', id: String(r.id) }, actor: actor?.user ?? 'system' }); const blocked = res.status === 'BLOCKED'; return { status: blocked ? 'BLOCKED' : 'QUEUED', note: blocked ? (res.message ?? res.blockReason) : null, sent: !blocked, messageId: res.id }; } catch (x) { return { status: 'BLOCKED', note: String(x?.message ?? x).slice(0, 200), sent: false }; }
  };

  const rfqs = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.rfq.view').allowed) throw forbidden('You may not see RFQs (permission proc.rfq.view).'); const sc = scopeOf(actor, 'proc.rfq.view', 'x');
      return runList(db, rfqList, parseListRequest(rfqList, query), { select: 'x.*, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => { const n = db.prepare("SELECT COUNT(*) AS n, SUM(response_status = 'RESPONDED') AS ok FROM proc_rfq_vendors WHERE rfq_id = ? AND deleted_at IS NULL").get(x.id); return { id: x.id, docNo: x.doc_no, date: x.doc_date, project: x.pcode, projectId: x.org_project_id, title: x.title, dueDate: x.due_date, vendors: n.n, responded: n.ok ?? 0, status: x.status, statusLabel: RFQ_STATUS[x.status], overdue: x.status === 'ISSUED' && x.due_date < todayIST() }; } });
    },
    exportSource(actor, req) { return rfqs.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => { const v = view(actor, row(actor, id), { detail: true }); if (v.can.approve && v.workflowInstanceId) v.taskId = workflowOf(db).listTasks(actor, { mine: 'assigned', limit: 200 }).rows.find((t) => t.instance?.id === v.workflowInstanceId)?.id ?? null; return v; },
    /** What the form needs: the approved requisition lines with something left to buy, the rules, and the vendors (matched to the lines chosen). */
    options(actor, projectId, prLineIds = []) {
      const p = project(actor, projectId, 'proc.rfq.view');
      const prs = db.prepare("SELECT l.id, l.line_no, l.item_id, l.service_desc, l.qty, l.balance_qty, l.uom, l.required_by, l.est_rate, l.spec, r.id AS pr_id, r.doc_no, i.code AS icode, i.name AS iname, (SELECT COUNT(*) FROM proc_rfq_lines x JOIN proc_rfqs f ON f.id = x.rfq_id WHERE x.pr_line_id = l.id AND x.deleted_at IS NULL AND f.deleted_at IS NULL AND f.status IN ('DRAFT', 'SUBMITTED', 'RETURNED', 'ISSUED')) AS open_rfqs FROM proc_pr_lines l JOIN proc_requisitions r ON r.id = l.pr_id LEFT JOIN mdm_items i ON i.id = l.item_id WHERE r.company_id = ? AND r.org_project_id = ? AND r.status = 'APPROVED' AND r.deleted_at IS NULL AND l.deleted_at IS NULL AND l.balance_qty > 0 ORDER BY r.doc_no, l.line_no LIMIT 500").all(actor.companyId, p.id);
      const rates = may(actor, 'proc.quotation.rates', p.id);
      return { project: { id: p.id, code: p.code, name: p.name }, minVendors: minVendors(actor.companyId), thresholdValue: rs(threshold(actor.companyId)), gstRecoverable: recoverable(actor.companyId),
        requisitionLines: prs.map((l) => ({ id: l.id, prId: l.pr_id, prNo: l.doc_no, lineNo: l.line_no, itemId: l.item_id, itemCode: l.icode, itemName: l.iname ?? l.service_desc, qty: d3(l.balance_qty), uom: l.uom, requiredBy: l.required_by, spec: l.spec, estRate: rates ? rs(l.est_rate ?? 0) : null, openRfqs: l.open_rfqs })),
        vendors: vendorChoices(actor, { projectId: p.id, prLineIds }) };
    },
    vendors: (actor, q) => vendorChoices(actor, q),
    create(actor, b) {
      const p = project(actor, b.projectId, 'proc.rfq.view', 'proc.rfq.create'); const lines = prLinesFor(actor, p.id, b.lines); checkVendors(actor, b.vendors ?? []);
      if (b.dueDate < todayIST()) fail([{ field: 'dueDate', message: 'The due date is not in the past' }]);
      return transaction(db, () => {
        const no = number(actor.companyId, actor.user, 'PROC_RFQ', 'proc_rfqs', 'RFQ'); const est = lines.reduce((n, l) => n + l.est, 0);
        const id = Number(db.prepare("INSERT INTO proc_rfqs (company_id, doc_no, doc_date, org_project_id, title, due_date, terms_json, est_total, status, justification, requested_by, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, 'api')").run(actor.companyId, no, todayIST(), p.id, b.title, b.dueDate, JSON.stringify(b.terms ?? {}), est, b.justification ?? null, actor.user, p.id, actor.user).lastInsertRowid);
        const r = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(id); saveLines(r, lines, actor); saveVendors(r, b.vendors ?? [], actor); audit(actor, 'proc_rfqs', id, 'create', actor.companyId, { newValues: { docNo: no, lines: lines.length, vendors: (b.vendors ?? []).length } }); return rfqs.get(actor, id);
      });
    },
    update(actor, id, b) {
      const r = row(actor, id, 'proc.rfq.edit'); if (!EDITABLE.includes(r.status)) throw conflict(`${RFQ_STATUS[r.status]}: the RFQ is not changed now. Amend an issued RFQ.`); if (b.rowVersion && b.rowVersion !== r.version) throw conflict('Someone changed this RFQ; reload it.');
      const lines = b.lines ? prLinesFor(actor, r.org_project_id, b.lines) : null; if (b.vendors) checkVendors(actor, b.vendors); if (b.dueDate && b.dueDate < todayIST()) fail([{ field: 'dueDate', message: 'The due date is not in the past' }]);
      return transaction(db, () => {
        const est = lines ? lines.reduce((n, l) => n + l.est, 0) : r.est_total;
        db.prepare('UPDATE proc_rfqs SET title = ?, due_date = ?, terms_json = ?, est_total = ?, justification = ?, justified = CASE WHEN ? THEN 0 ELSE justified END, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(b.title ?? r.title, b.dueDate ?? r.due_date, 'terms' in b ? JSON.stringify(b.terms ?? {}) : r.terms_json, est, 'justification' in b ? b.justification : r.justification, (b.lines || b.vendors) ? 1 : 0, actor.user, nowIso(), r.id);
        if (lines) saveLines(r, lines, actor); if (b.vendors) saveVendors(r, b.vendors, actor); audit(actor, 'proc_rfqs', r.id, 'update', r.company_id); return rfqs.get(actor, r.id);
      });
    },
    remove(actor, id) { const r = row(actor, id, 'proc.rfq.delete'); if (r.status !== 'DRAFT' || r.workflow_instance_id) throw unprocessable('Only a draft that was never sent is deleted. Cancel it instead.'); const now = nowIso(); db.prepare('UPDATE proc_rfq_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rfq_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_rfq_vendors SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE rfq_id = ? AND deleted_at IS NULL').run(now, actor.user, r.id); db.prepare('UPDATE proc_rfqs SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, r.id); audit(actor, 'proc_rfqs', r.id, 'delete', r.company_id); return { id: r.id, deleted: true }; },

    /** BR-01: fewer vendors than the minimum on a value above the threshold: the single-source justification goes to the procurement manager and then the project director. */
    submit(actor, id) {
      const r = row(actor, id, 'proc.rfq.submit'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned RFQ is sent for approval.'); const n = vendorsOf(r.id).length;
      if (!short(r, n)) throw unprocessable(`No justification is needed: the RFQ goes to ${n} vendor(s), at least ${minVendors(r.company_id)} are needed only from ${rs(threshold(r.company_id))}. Issue it instead.`); if (!r.justification || r.justification.trim().length < 20) fail([{ field: 'justification', message: 'Give the reason the RFQ goes to fewer vendors (at least 20 characters)' }]);
      return transaction(db, () => {
        const ctx = { projectId: r.org_project_id, amount: Number(rs(r.est_total)), vendors: n }; if (r.status === 'RETURNED' && r.workflow_instance_id) workflowOf(db).resubmit(actor, r.workflow_instance_id, { comment: 'Corrected', context: ctx });
        else { const inst = workflowOf(db).submit(actor, { docType: RFQ_DOC, docId: String(r.id), comment: `${r.doc_no}: ${n} vendor(s) for ${rs(r.est_total)}`.slice(0, 300), context: ctx }); db.prepare('UPDATE proc_rfqs SET workflow_instance_id = ? WHERE id = ?').run(inst.id, r.id); }
        db.prepare("UPDATE proc_rfqs SET status = 'SUBMITTED', requested_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, actor.user, nowIso(), r.id); audit(actor, 'proc_rfqs', r.id, 'submit', r.company_id, { newValues: { vendors: n } }); return rfqs.get(actor, r.id);
      });
    },
    withdraw(actor, id, { reason }) { const r = row(actor, id); if (r.status !== 'SUBMITTED') throw unprocessable('Only a justification waiting for approval is withdrawn.'); if (!same(r.requested_by, actor.user)) throw forbidden('Only the person who sent it withdraws it.'); workflowOf(db).withdraw(actor, r.workflow_instance_id, { comment: reason }); return rfqs.get(actor, r.id); },
    decide(instance, actor, outcome, comment) {
      const r = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(rid(instance.docId)); if (!r || r.status !== 'SUBMITTED') return; const now = nowIso();
      if (outcome === 'APPROVED') { db.prepare("UPDATE proc_rfqs SET status = 'DRAFT', justified = 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(actor.user, now, r.id); audit(actor, 'proc_rfqs', r.id, 'approve', r.company_id); notify(r.company_id, 'proc.rfq.justify_approved', [`user:${r.requested_by}`], r.doc_no, r.title, 'The single-source justification is approved: issue the RFQ.', `/proc/rfqs?id=${r.id}`, r.id, { projectId: r.org_project_id }); return; }
      const withdrawn = outcome === 'CANCELLED' && instance.status === 'WITHDRAWN'; const to = ['RETURNED', 'REJECTED'].includes(outcome) ? 'RETURNED' : withdrawn ? 'DRAFT' : 'CANCELLED';
      db.prepare('UPDATE proc_rfqs SET status = ?, workflow_instance_id = ?, justified = 0, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, withdrawn ? null : r.workflow_instance_id, actor.user, now, r.id); audit(actor, 'proc_rfqs', r.id, outcome.toLowerCase(), r.company_id, { reason: comment });
      if (outcome === 'REJECTED') notify(r.company_id, 'proc.rfq.justify_rejected', [`user:${r.requested_by}`], r.doc_no, r.title, `The justification was not approved${comment ? `: ${comment}` : ''}. Add vendors or correct the reason.`, `/proc/rfqs?id=${r.id}`, r.id, { projectId: r.org_project_id });
    },

    /** FR-03: send the RFQ. Every vendor gets a link of its own (only its hash is kept) valid until the due date plus the grace days; the links are given back once, for a vendor who cannot be reached through the channel. */
    issue(actor, id) {
      const r = row(actor, id, 'proc.rfq.issue'); if (!EDITABLE.includes(r.status)) throw unprocessable('Only a draft or a returned RFQ is issued.'); const ls = linesOf(r.id); const vs = vendorsOf(r.id);
      if (!ls.length) throw unprocessable('The RFQ has no lines.'); if (!vs.length) throw unprocessable('Choose the vendors the RFQ goes to.'); if (r.due_date < todayIST()) throw unprocessable('The due date has passed: change it first.');
      for (const v of vs) { const why = eligibility(r.company_id, v.vendor_id); if (why) throw unprocessable(`${vname(v.vendor_id).name}: ${why}`); }
      if (short(r, vs.length) && !r.justified) protocolOf(db).enforce(actor, 'CP-PROC-03', { entity: 'proc_rfq', entityId: String(r.id), amount: Number(rs(r.est_total)), valueAtRisk: Number(rs(r.est_total)), ref: r.doc_no, vendors: vs.length, minimum: minVendors(r.company_id), message: `${r.doc_no} goes to ${vs.length} vendor(s); ${minVendors(r.company_id)} are needed above ${rs(threshold(r.company_id))} unless the single-source justification is approved.` });
      return transaction(db, () => {
        const now = nowIso(); const links = []; const expires = expiryOf(r.company_id, r.due_date);
        for (const v of vs) { const token = newToken(); const url = link(token); const cur = { ...v, token_expires: expires }; const sent = dispatch(actor, r, cur, url, 'invite');
          db.prepare('UPDATE proc_rfq_vendors SET token_hash = ?, token_expires = ?, token_used_at = NULL, response_status = ?, sent_at = ?, send_status = ?, send_note = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(hash(token), expires, sent.sent ? 'SENT' : 'INVITED', sent.sent ? now : null, sent.status, sent.note ?? null, actor.user, now, v.id);
          links.push({ vendorId: v.vendor_id, vendor: vname(v.vendor_id).name, channel: v.channel, sendStatus: sent.status, note: sent.note ?? null, url }); }
        db.prepare("UPDATE proc_rfqs SET status = 'ISSUED', issue_date = ?, issued_at = ?, issued_by = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(todayIST(), now, actor.user, actor.user, now, r.id);
        audit(actor, 'proc_rfqs', r.id, 'issue', r.company_id, { newValues: { vendors: vs.length, sent: links.filter((x) => x.sendStatus === 'QUEUED').length, justified: Boolean(r.justified) } });
        const fresh = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(r.id); evt('proc.rfq.issued', actor, fresh, { title: r.title, dueDate: r.due_date, vendors: vs.map((v) => v.vendor_id), lines: ls.map((l) => ({ lineId: l.id, lineNo: l.line_no, prLineId: l.pr_line_id, itemId: l.item_id, qty: d3(l.qty), uom: l.uom })) });
        return { rfq: rfqs.get(actor, r.id), links };
      });
    },
    /** A vendor lost its link, or has quoted and must revise: a new link replaces the old, which stops working. */
    reissue(actor, id, { vendorId }) {
      const r = row(actor, id, 'proc.rfq.issue'); if (r.status !== 'ISSUED') throw unprocessable('Links are issued again only while the RFQ is issued.'); const v = db.prepare('SELECT * FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL').get(r.id, rid(vendorId)); if (!v) throw notFound('That vendor is not on the RFQ.');
      const why = eligibility(r.company_id, v.vendor_id); if (why) throw unprocessable(why);
      return transaction(db, () => { const token = newToken(); const expires = expiryOf(r.company_id, r.due_date); const url = link(token); const sent = dispatch(actor, r, { ...v, token_expires: expires }, url, 'invite'); const now = nowIso();
        db.prepare("UPDATE proc_rfq_vendors SET token_hash = ?, token_expires = ?, token_used_at = NULL, response_status = CASE WHEN response_status IN ('RESPONDED', 'DECLINED') THEN 'SENT' ELSE response_status END, send_status = ?, send_note = ?, sent_at = COALESCE(?, sent_at), updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(hash(token), expires, sent.status, sent.note ?? null, sent.sent ? now : null, actor.user, now, v.id);
        audit(actor, 'proc_rfq_vendors', v.id, 'reissue', r.company_id, { newValues: { vendorId: v.vendor_id } }); return { vendorId: v.vendor_id, vendor: vname(v.vendor_id).name, sendStatus: sent.status, note: sent.note ?? null, url, rfq: rfqs.get(actor, r.id) }; });
    },
    /** FR-07: remind the vendors who have not answered (each gets a fresh link, the old one stops working; if the message cannot be sent the old link is kept). */
    remind(actor, id, { auto = false } = {}) {
      const r = auto ? db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(rid(id)) : row(actor, id, 'proc.rfq.issue'); if (r.status !== 'ISSUED') throw unprocessable('Only an issued RFQ has vendors to remind.'); const max = Number(param(r.company_id, 'proc.rfq.max_reminders') ?? 3); const out = [];
      for (const v of vendorsOf(r.id)) {
        if (!['INVITED', 'SENT', 'VIEWED'].includes(v.response_status)) continue; if (v.reminder_count >= max) { out.push({ vendorId: v.vendor_id, vendor: vname(v.vendor_id).name, skipped: 'The most reminders were sent' }); continue; }
        if (auto && v.last_reminder_at && Date.now() - Date.parse(v.last_reminder_at) < 20 * 3_600_000) continue;
        const token = newToken(); const expires = expiryOf(r.company_id, r.due_date); const url = link(token); const sent = dispatch(actor, r, { ...v, token_expires: expires }, url, 'remind'); const now = nowIso();
        if (sent.sent) db.prepare('UPDATE proc_rfq_vendors SET token_hash = ?, token_expires = ?, reminder_count = reminder_count + 1, last_reminder_at = ?, send_status = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(hash(token), expires, now, sent.status, actor.user, now, v.id);
        else db.prepare('UPDATE proc_rfq_vendors SET send_status = ?, send_note = ?, updated_at = ? WHERE id = ?').run(sent.status, sent.note ?? null, now, v.id);
        out.push({ vendorId: v.vendor_id, vendor: vname(v.vendor_id).name, sendStatus: sent.status, note: sent.note ?? null, ...(sent.sent ? { url } : {}) });
      }
      if (out.length) audit(actor, 'proc_rfqs', r.id, 'remind', r.company_id, { newValues: { vendors: out.length } }); return { reminded: out.filter((x) => x.sendStatus === 'QUEUED').length, vendors: out };
    },
    /** FR-07: told to the issuer — the RFQ closes within the days set (or is past due) with vendors who have not answered. */
    sweep() {
      let n = 0; const today = todayIST();
      for (const r of db.prepare("SELECT * FROM proc_rfqs WHERE status = 'ISSUED' AND deleted_at IS NULL").all()) {
        const days = Number(param(r.company_id, 'proc.rfq.remind_days') ?? 2); const pending = vendorsOf(r.id).filter((v) => ['INVITED', 'SENT', 'VIEWED'].includes(v.response_status)); if (!pending.length) continue;
        const left = Math.round((Date.parse(`${r.due_date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000); if (left > days) continue;
        if (left >= 0) rfqs.remind(sysActor(r.company_id), r.id, { auto: true });
        if (!db.prepare("SELECT 1 FROM core_audit_log WHERE entity = 'proc_rfqs' AND entity_id = ? AND action = 'due_soon' AND date(created_at) = ?").get(String(r.id), today)) { audit(sysActor(r.company_id), 'proc_rfqs', r.id, 'due_soon', r.company_id); notify(r.company_id, 'proc.rfq.due_soon', [`user:${r.issued_by ?? r.requested_by}`], r.doc_no, r.title, left < 0 ? `${r.doc_no} is ${-left} day(s) past its due date; ${pending.length} vendor(s) have not answered.` : `${r.doc_no} closes in ${left} day(s); ${pending.length} vendor(s) have not answered.`, `/proc/rfqs?id=${r.id}`, `${r.id}.${today}`, { projectId: r.org_project_id }); n += 1; }
      }
      return n;
    },
    /** FR-06: the due date or terms of an issued RFQ are changed; the vendors are told, and their links last to the new due date. */
    amend(actor, id, b) {
      const r = row(actor, id, 'proc.rfq.amend'); if (r.status !== 'ISSUED') throw unprocessable('Only an issued RFQ is amended.'); if (!b.dueDate && !b.terms) fail([{ field: 'dueDate', message: 'Give the new due date or the changed terms' }]); if (b.dueDate && b.dueDate < todayIST()) fail([{ field: 'dueDate', message: 'The due date is not in the past' }]);
      return transaction(db, () => { const due = b.dueDate ?? r.due_date; const now = nowIso();
        db.prepare('UPDATE proc_rfqs SET due_date = ?, terms_json = ?, revision_no = revision_no + 1, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(due, b.terms ? JSON.stringify(b.terms) : r.terms_json, actor.user, now, r.id);
        const fresh = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(r.id); const expires = expiryOf(r.company_id, due);
        for (const v of vendorsOf(r.id)) { if (v.token_hash && !v.token_used_at) db.prepare('UPDATE proc_rfq_vendors SET token_expires = ? WHERE id = ?').run(expires, v.id); const to = v.contact_to || contactOf(v.vendor_id, v.channel); if (to && v.channel !== 'LINK') { try { commOf(db).send({ companyId: r.company_id, channel: v.channel, to, subject: `RFQ ${r.doc_no} changed`, body: `${r.doc_no} (${r.title}) was changed: ${b.reason}. The due date is ${due}. Use the link we sent you.`, purpose: 'TRANSACTIONAL', related: { entity: 'proc_rfq', id: String(r.id) }, actor: actor.user }); } catch { /* the change is saved anyway */ } } }
        audit(actor, 'proc_rfqs', r.id, 'amend', r.company_id, { reason: b.reason, oldValues: { dueDate: r.due_date }, newValues: { dueDate: due } }); evt('proc.rfq.amended', actor, fresh, { dueDate: due, reason: b.reason }); return rfqs.get(actor, r.id); });
    },
    close(actor, id, { reason }) {
      const r = row(actor, id, 'proc.rfq.issue'); if (r.status !== 'ISSUED') throw unprocessable('Only an issued RFQ is closed.');
      return transaction(db, () => { const now = nowIso(); db.prepare("UPDATE proc_rfqs SET status = 'CLOSED', closed_at = ?, remarks = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, reason, actor.user, now, r.id); db.prepare("UPDATE proc_rfq_vendors SET token_expires = ? WHERE rfq_id = ? AND token_hash IS NOT NULL AND deleted_at IS NULL").run(now, r.id);
        db.prepare("UPDATE proc_quotations SET status = 'CANCELLED', cancel_reason = 'The RFQ was closed', updated_at = ?, version = version + 1 WHERE rfq_id = ? AND status = 'DRAFT' AND deleted_at IS NULL").run(now, r.id);
        const got = db.prepare("SELECT COUNT(*) AS n FROM proc_quotations WHERE rfq_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL").get(r.id).n; audit(actor, 'proc_rfqs', r.id, 'close', r.company_id, { reason, newValues: { quotations: got } });
        evt('proc.rfq.closed', actor, db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(r.id), { quotations: got, reason, shortOfMinimum: got < minVendors(r.company_id) && r.est_total >= threshold(r.company_id) && !r.justified }); return rfqs.get(actor, r.id); });
    },
    cancel(actor, id, { reason }) {
      const r = row(actor, id, 'proc.rfq.cancel'); if (!['DRAFT', 'RETURNED', 'SUBMITTED', 'ISSUED'].includes(r.status)) throw unprocessable('Only an RFQ that is not closed is cancelled.');
      return transaction(db, () => { if (r.status === 'SUBMITTED') workflowOf(db).abandon(actor.companyId, r.workflow_instance_id, actor.user, 'CANCELLED', reason); const now = nowIso();
        db.prepare("UPDATE proc_rfq_vendors SET token_expires = ? WHERE rfq_id = ? AND token_hash IS NOT NULL AND deleted_at IS NULL").run(now, r.id); db.prepare("UPDATE proc_quotations SET status = 'CANCELLED', cancel_reason = 'The RFQ was cancelled', updated_at = ?, version = version + 1 WHERE rfq_id = ? AND status = 'DRAFT' AND deleted_at IS NULL").run(now, r.id);
        db.prepare("UPDATE proc_rfqs SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, now, r.id); audit(actor, 'proc_rfqs', r.id, 'cancel', r.company_id, { reason }); evt('proc.rfq.cancelled', actor, r, { reason, wasIssued: r.status === 'ISSUED' }); return rfqs.get(actor, r.id); });
    },
    /** FR-06: a regret letter to vendors who were not chosen (or did not quote). */
    regret(actor, id, { vendorIds, message }) {
      const r = row(actor, id, 'proc.rfq.issue'); if (!['ISSUED', 'CLOSED'].includes(r.status)) throw unprocessable('Regret letters go once the RFQ is issued or closed.'); const out = [];
      for (const vid of vendorIds) { const v = db.prepare('SELECT * FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL').get(r.id, vid); if (!v) throw notFound('A vendor chosen is not on the RFQ.'); if (v.regret_sent_at) { out.push({ vendorId: vid, vendor: vname(vid).name, skipped: 'A regret letter was sent already' }); continue; }
        const channel = v.channel === 'LINK' ? 'EMAIL' : v.channel; const to = v.contact_to || contactOf(vid, channel); let status = 'NO_ADDRESS'; if (to) { try { const res = commOf(db).send({ companyId: r.company_id, channel, to, subject: `RFQ ${r.doc_no}: thank you for your quotation`, body: message || `Thank you for responding to ${r.title} (${r.doc_no}). We have not placed the order with you this time. We value your interest and will invite you again.`, purpose: 'TRANSACTIONAL', related: { entity: 'proc_rfq', id: String(r.id) }, actor: actor.user }); status = res.status === 'BLOCKED' ? 'BLOCKED' : 'QUEUED'; } catch { status = 'BLOCKED'; } }
        db.prepare('UPDATE proc_rfq_vendors SET regret_sent_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(nowIso(), actor.user, nowIso(), v.id); out.push({ vendorId: vid, vendor: vname(vid).name, sendStatus: status }); }
      audit(actor, 'proc_rfqs', r.id, 'regret', r.company_id, { newValues: { vendors: out.length } }); return { sent: out.filter((x) => x.sendStatus).length, vendors: out, rfq: rfqs.get(actor, r.id) };
    },
    /** FR-06: the clarification log. A question may come by phone (entered here) or from the vendor's page; the answer is shared with every vendor, or only the one who asked. */
    ask(actor, id, { vendorId, question }) { const r = row(actor, id, 'proc.rfq.edit'); if (!['ISSUED', 'CLOSED'].includes(r.status)) throw unprocessable('Clarifications are logged once the RFQ is issued.'); if (vendorId && !db.prepare('SELECT 1 FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL').get(r.id, vendorId)) throw notFound('That vendor is not on the RFQ.'); const cid = Number(db.prepare("INSERT INTO proc_rfq_clarifications (company_id, rfq_id, vendor_id, asked_by, question, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'api')").run(r.company_id, r.id, vendorId ?? null, actor.user, question, r.org_project_id, actor.user).lastInsertRowid); audit(actor, 'proc_rfq_clarifications', cid, 'create', r.company_id); return rfqs.get(actor, r.id); },
    answer(actor, id, clarId, { answer, shareAll }) { const r = row(actor, id, 'proc.rfq.edit'); const c = db.prepare('SELECT * FROM proc_rfq_clarifications WHERE id = ? AND rfq_id = ? AND deleted_at IS NULL').get(rid(clarId), r.id); if (!c) throw notFound('That question does not exist.'); db.prepare('UPDATE proc_rfq_clarifications SET answer = ?, answered_by = ?, answered_at = ?, share_all = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(answer, actor.user, nowIso(), shareAll ? 1 : 0, actor.user, nowIso(), c.id); audit(actor, 'proc_rfq_clarifications', c.id, 'answer', r.company_id, { newValues: { shareAll: Boolean(shareAll) } }); return rfqs.get(actor, r.id); },
    history(actor, id) { const r = row(actor, id); return { approvals: r.workflow_instance_id ? db.prepare('SELECT event, actor, comment, at, step_code FROM wf_history WHERE instance_id = ? ORDER BY id').all(r.workflow_instance_id) : [], audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity IN ('proc_rfqs', 'proc_rfq_vendors', 'proc_rfq_clarifications') AND (entity_id = ? OR entity_id IN (SELECT CAST(id AS TEXT) FROM proc_rfq_vendors WHERE rfq_id = ?) OR entity_id IN (SELECT CAST(id AS TEXT) FROM proc_rfq_clarifications WHERE rfq_id = ?)) ORDER BY id").all(String(r.id), r.id, r.id) }; },
    print(actor, id) {
      const r = row(actor, id, 'proc.rfq.print'); const v = view(actor, r, { detail: true }); audit(actor, 'proc_rfqs', r.id, 'print', r.company_id); const t = v.terms ?? {};
      const columns = [['lineNo', '#'], ['item', 'Item or service'], ['qty', 'Quantity'], ['uom', 'Unit'], ['requiredBy', 'Required by'], ['site', 'Deliver to'], ['spec', 'Specification']].map(([key, label]) => ({ key, label, type: 'text' }));
      const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: l.itemCode ? `${l.itemCode} ${l.itemName}` : l.itemName, qty: String(l.qty), uom: l.uom, requiredBy: l.requiredBy ?? '', site: l.deliverySite ?? '', spec: l.spec ?? '' }));
      const footer = [`${v.docNo}: ${v.title}. ${v.projectCode}; quotation due by ${v.dueDate}`, [t.delivery && `Delivery: ${t.delivery}`, t.payment && `Payment: ${t.payment}`, t.validityDays && `Quotation valid for ${t.validityDays} days`].filter(Boolean).join('. '), t.technicalSpecs ? `Technical specification: ${t.technicalSpecs}` : '', t.approvedMakes ? `Approved makes: ${t.approvedMakes}` : '', `Issued by ${v.issuedBy ?? v.requestedBy}`].filter(Boolean);
      return { buffer: toPdf({ columns, rows, footer, title: `Request for quotation ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
    /** The quotations side by side, line by line, with the landed rate and the lowest marked (input to the comparative statement, 15.04). */
    comparison(actor, id) {
      const r = row(actor, id); need(actor, 'proc.quotation.rates', 'see the rates quoted', r.org_project_id); const ls = linesOf(r.id);
      const qs = db.prepare("SELECT * FROM proc_quotations WHERE rfq_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL ORDER BY vendor_id").all(r.id); const qls = qs.map((q) => ({ q, lines: new Map(db.prepare('SELECT * FROM proc_quotation_lines WHERE quotation_id = ? AND deleted_at IS NULL').all(q.id).map((l) => [l.rfq_line_id, l])) }));
      const rows = ls.map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; const cells = qls.map(({ q, lines }) => { const x = lines.get(l.id); return x && x.offered_qty > 0 ? { quotationId: q.id, vendorId: q.vendor_id, rate: rs(x.rate), landedRate: rs(x.landed_rate), landedAmount: rs(x.landed_amount), offeredQty: d3(x.offered_qty), make: x.make, deviation: x.deviation, deliveryDays: q.delivery_days } : { quotationId: q.id, vendorId: q.vendor_id, notQuoted: true }; });
        const low = Math.min(...cells.filter((c) => !c.notQuoted).map((c) => c.landedRate), Infinity); return { rfqLineId: l.id, lineNo: l.line_no, itemCode: it?.code ?? null, itemName: it?.name ?? l.service_desc, qty: d3(l.qty), uom: l.uom, cells: cells.map((c) => ({ ...c, lowest: !c.notQuoted && c.landedRate === low && Number.isFinite(low) })) }; });
      return { rfqId: r.id, docNo: r.doc_no, gstRecoverable: recoverable(r.company_id), vendors: qs.map((q) => ({ vendorId: q.vendor_id, ...vname(q.vendor_id), quotationId: q.id, quotationNo: q.doc_no, versionNo: q.version_no, validUntil: q.valid_until, deliveryDays: q.delivery_days, paymentTerms: q.payment_terms, totalLanded: rs(q.total_landed), expired: q.valid_until < todayIST() })), lines: rows };
    },
  };

  // ---- quotations (FR-04, FR-05, FR-06) ----------------------------------------------------------------------------------------------------------------------------------------------------------------------
  /** The lines of a quotation with their landed rates; the GST treatment is fixed on the quotation. */
  const normaliseQ = (rfq, b, gstRecoverable) => {
    const rl = new Map(linesOf(rfq.id).map((l) => [l.id, l])); const problems = []; const seen = new Set();
    const lines = (b.lines ?? []).map((x, i) => {
      const l = rl.get(x.rfqLineId); if (!l) { problems.push({ field: `lines.${i}.rfqLineId`, message: 'Not a line of this RFQ' }); return null; } if (seen.has(l.id)) problems.push({ field: `lines.${i}.rfqLineId`, message: 'This line is quoted twice' }); seen.add(l.id);
      const qty = x.offeredQty != null ? q3(x.offeredQty) : l.qty; const rate = Math.round(x.rate * 100); if (qty > 0 && rate <= 0) problems.push({ field: `lines.${i}.rate`, message: 'Give the rate, or an offered quantity of zero if the vendor does not quote this line' });
      const m = { rfqLineId: l.id, offeredQty: qty, rate, discountPct: Math.round((x.discountPct ?? 0) * 10000), gstRate: Math.round((x.gstRate ?? 0) * 10000), freight: Math.round((x.freight ?? 0) * 100), loading: Math.round((x.loading ?? 0) * 100), otherCharges: Math.round((x.otherCharges ?? 0) * 100), make: x.make ?? null, deviation: x.deviation ?? null };
      return { ...m, ...landed({ rate, discountPct: m.discountPct, gstRate: m.gstRate, freight: m.freight, loading: m.loading, other: m.otherCharges, qty, inclusive: b.gstInclusive, recoverable: gstRecoverable }) };
    }).filter(Boolean);
    if (!lines.some((l) => l.offeredQty > 0)) problems.push({ field: 'lines', message: 'Quote at least one line' }); if (b.validUntil < (b.quoteDate ?? todayIST())) problems.push({ field: 'validUntil', message: 'The validity ends before the quotation date' }); fail(problems); return lines;
  };
  const writeQ = (q, lines, user) => {
    db.prepare('UPDATE proc_quotation_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE quotation_id = ? AND deleted_at IS NULL').run(nowIso(), user, q.id);
    for (const l of lines) db.prepare("INSERT INTO proc_quotation_lines (company_id, quotation_id, rfq_line_id, offered_qty, rate, discount_pct, gst_rate, freight, loading, other_charges, landed_rate, landed_amount, make, deviation, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'api')").run(q.company_id, q.id, l.rfqLineId, l.offeredQty, l.rate, l.discountPct, l.gstRate, l.freight, l.loading, l.otherCharges, l.landedRate, l.landedAmount, l.make, l.deviation, q.org_project_id, user);
    db.prepare('UPDATE proc_quotations SET total_landed = ? WHERE id = ?').run(lines.reduce((n, l) => n + l.landedAmount, 0), q.id);
  };
  const insertQ = (rfq, vendorId, b, { via, user, status }) => {
    const prev = db.prepare('SELECT * FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status IN (\'RECEIVED\', \'DRAFT\', \'SUPERSEDED\', \'WITHDRAWN\') AND deleted_at IS NULL ORDER BY version_no DESC LIMIT 1').get(rfq.id, vendorId);
    const lines = normaliseQ(rfq, b, recoverable(rfq.company_id)); const no = number(rfq.company_id, user, 'PROC_QUOTATION', 'proc_quotations', 'QTN'); const now = nowIso();
    const id = Number(db.prepare('INSERT INTO proc_quotations (company_id, doc_no, rfq_id, vendor_id, org_project_id, quote_ref, quote_date, valid_until, delivery_days, payment_terms, freight_terms, gst_inclusive, gst_recoverable, version_no, parent_id, status, entered_via, entered_by, received_at, deviations, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(rfq.company_id, no, rfq.id, vendorId, rfq.org_project_id, b.quoteRef ?? null, b.quoteDate ?? todayIST(), b.validUntil, b.deliveryDays ?? 0, b.paymentTerms ?? null, b.freightTerms ?? null, b.gstInclusive ? 1 : 0, recoverable(rfq.company_id) ? 1 : 0, (prev?.version_no ?? 0) + 1, prev?.id ?? null, status, via, user, status === 'RECEIVED' ? now : null, b.deviations ?? null, rfq.org_project_id, user, via === 'PORTAL' ? 'portal' : 'api').lastInsertRowid);
    const q = db.prepare('SELECT * FROM proc_quotations WHERE id = ?').get(id); writeQ(q, lines, user); return db.prepare('SELECT * FROM proc_quotations WHERE id = ?').get(id);
  };
  /** The quotation becomes the vendor's current one: an earlier received version is superseded, the vendor is marked as having quoted, the rates are given to the rate intelligence (15.09). */
  const receive = (actor, q) => {
    const now = nowIso(); db.prepare("UPDATE proc_quotations SET status = 'SUPERSEDED', updated_at = ?, version = version + 1 WHERE rfq_id = ? AND vendor_id = ? AND status = 'RECEIVED' AND id <> ? AND deleted_at IS NULL").run(now, q.rfq_id, q.vendor_id, q.id);
    db.prepare("UPDATE proc_quotations SET status = 'RECEIVED', received_at = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(now, actor.user, now, q.id); db.prepare("UPDATE proc_rfq_vendors SET response_status = 'RESPONDED', responded_at = ?, updated_at = ? WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL").run(now, now, q.rfq_id, q.vendor_id);
    const fresh = db.prepare('SELECT * FROM proc_quotations WHERE id = ?').get(q.id); const f = db.prepare('SELECT * FROM proc_rfqs WHERE id = ?').get(q.rfq_id);
    evt('proc.quotation.received', actor, { ...fresh, id: fresh.id, rfq_id: fresh.rfq_id }, { quotationId: q.id, quotationNo: q.doc_no, rfqNo: f.doc_no, vendorId: q.vendor_id, versionNo: q.version_no, validUntil: q.valid_until, totalLanded: fresh.total_landed, via: q.entered_via }, 'proc_quotation');
    for (const l of db.prepare('SELECT l.*, r.item_id, r.uom FROM proc_quotation_lines l JOIN proc_rfq_lines r ON r.id = l.rfq_line_id WHERE l.quotation_id = ? AND l.deleted_at IS NULL AND l.offered_qty > 0').all(q.id)) if (l.item_id) evt('proc.rate.observed', actor, { ...fresh, id: fresh.id }, { quotationId: q.id, vendorId: q.vendor_id, itemId: l.item_id, uom: l.uom, rate: l.rate, discountPct: l.discount_pct, landedRate: l.landed_rate, gstRate: l.gst_rate, gstInclusive: Boolean(q.gst_inclusive), observedOn: q.quote_date, validUntil: q.valid_until, source: 'RFQ' }, 'proc_quotation');
    notify(f.company_id, 'proc.rfq.quote_received', [`user:${f.issued_by ?? f.requested_by}`], q.doc_no, f.title, `${vname(q.vendor_id).name} quoted for ${f.doc_no} (version ${q.version_no})${q.entered_via === 'PORTAL' ? ' on its own page' : ''}.`, `/proc/rfqs?id=${f.id}`, q.id, { projectId: f.org_project_id });
    return fresh;
  };
  const rfqOpen = (actor, id) => { const f = row(actor, id); if (f.status !== 'ISSUED') throw unprocessable(`${f.doc_no} is ${RFQ_STATUS[f.status].toLowerCase()}: quotations are entered while it is issued.`); return f; };
  const quotes = {
    list(actor, query) {
      if (!authz.check(actor, 'proc.quotation.view').allowed) throw forbidden('You may not see quotations (permission proc.quotation.view).'); const sc = scopeOf(actor, 'proc.quotation.view', 'x');
      return runList(db, quoteList, parseListRequest(quoteList, query), { select: 'x.*, f.doc_no AS fno, p.code AS pcode', scopeSql: sc.sql, params: sc.params, tieBreaker: 'x.id', map: (x) => ({ id: x.id, docNo: x.doc_no, rfq: x.fno, rfqId: x.rfq_id, vendor: vname(x.vendor_id).name, project: x.pcode, date: x.quote_date, validUntil: x.valid_until, versionNo: x.version_no, deliveryDays: x.delivery_days, via: x.entered_via, status: x.status, statusLabel: QUOTE_STATUS[x.status], total: may(actor, 'proc.quotation.rates', x.org_project_id) ? String(rs(x.total_landed)) : '' }) });
    },
    exportSource(actor, req) { return quotes.list(actor, { ...req, page: 1, pageSize: 100 }); },
    get: (actor, id) => quoteView(actor, rowQ(actor, id), { detail: true }),
    create(actor, b) {
      const f = rfqOpen(actor, b.rfqId); need(actor, 'proc.quotation.create', 'enter a quotation', f.org_project_id); const v = db.prepare('SELECT * FROM proc_rfq_vendors WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL').get(f.id, b.vendorId); if (!v) fail([{ field: 'vendorId', message: 'That vendor is not on the RFQ: add it first' }]);
      if (db.prepare("SELECT 1 FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'DRAFT' AND deleted_at IS NULL").get(f.id, b.vendorId)) throw conflict('A draft quotation of this vendor is open: complete or cancel it.');
      return transaction(db, () => { const q = insertQ(f, b.vendorId, b, { via: 'MANUAL', user: actor.user, status: 'DRAFT' }); audit(actor, 'proc_quotations', q.id, 'create', q.company_id, { newValues: { docNo: q.doc_no, version: q.version_no } }); return quotes.get(actor, q.id); });
    },
    update(actor, id, b) {
      const q = rowQ(actor, id, 'proc.quotation.edit'); if (q.status !== 'DRAFT') throw conflict('Only a draft quotation is changed: revise a received one.'); if (b.rowVersion && b.rowVersion !== q.version) throw conflict('Someone changed this quotation; reload it.'); const f = rfqOpen(actor, q.rfq_id);
      const m = { quoteRef: 'quoteRef' in b ? b.quoteRef : q.quote_ref, quoteDate: b.quoteDate ?? q.quote_date, validUntil: b.validUntil ?? q.valid_until, deliveryDays: b.deliveryDays ?? q.delivery_days, paymentTerms: 'paymentTerms' in b ? b.paymentTerms : q.payment_terms, freightTerms: 'freightTerms' in b ? b.freightTerms : q.freight_terms, gstInclusive: 'gstInclusive' in b ? b.gstInclusive : Boolean(q.gst_inclusive), deviations: 'deviations' in b ? b.deviations : q.deviations };
      const cur = b.lines ?? quoteView(actor, q, { detail: true }).lines.map((l) => ({ rfqLineId: l.rfqLineId, offeredQty: l.offeredQty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, freight: l.freight, loading: l.loading, otherCharges: l.otherCharges, make: l.make, deviation: l.deviation }));
      return transaction(db, () => { const lines = normaliseQ(f, { ...m, lines: cur }, Boolean(q.gst_recoverable));
        db.prepare('UPDATE proc_quotations SET quote_ref = ?, quote_date = ?, valid_until = ?, delivery_days = ?, payment_terms = ?, freight_terms = ?, gst_inclusive = ?, deviations = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(m.quoteRef ?? null, m.quoteDate, m.validUntil, m.deliveryDays, m.paymentTerms ?? null, m.freightTerms ?? null, m.gstInclusive ? 1 : 0, m.deviations ?? null, actor.user, nowIso(), q.id);
        writeQ(q, lines, actor.user); audit(actor, 'proc_quotations', q.id, 'update', q.company_id); return quotes.get(actor, q.id); });
    },
    remove(actor, id) { const q = rowQ(actor, id, 'proc.quotation.delete'); if (q.status !== 'DRAFT') throw unprocessable('Only a draft is deleted. Cancel a received quotation instead.'); const now = nowIso(); db.prepare('UPDATE proc_quotation_lines SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE quotation_id = ? AND deleted_at IS NULL').run(now, actor.user, q.id); db.prepare('UPDATE proc_quotations SET deleted_at = ?, deleted_by = ?, is_active = 0 WHERE id = ?').run(now, actor.user, q.id); audit(actor, 'proc_quotations', q.id, 'delete', q.company_id); return { id: q.id, deleted: true }; },
    /** The quotation is recorded as received (there is no approval of a quotation: the comparison and the order have theirs). */
    submit(actor, id) {
      const q = rowQ(actor, id, 'proc.quotation.submit'); if (q.status !== 'DRAFT') throw unprocessable('Only a draft quotation is recorded as received.'); rfqOpen(actor, q.rfq_id);
      return transaction(db, () => { receive(actor, q); audit(actor, 'proc_quotations', q.id, 'submit', q.company_id, { newValues: { version: q.version_no } }); return quotes.get(actor, q.id); });
    },
    withdraw(actor, id, { reason }) { const q = rowQ(actor, id, 'proc.quotation.cancel'); if (q.status !== 'RECEIVED') throw unprocessable('Only a received quotation is withdrawn.'); db.prepare("UPDATE proc_quotations SET status = 'WITHDRAWN', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), q.id); db.prepare("UPDATE proc_rfq_vendors SET response_status = CASE WHEN EXISTS (SELECT 1 FROM proc_quotations x WHERE x.rfq_id = ? AND x.vendor_id = ? AND x.status = 'RECEIVED' AND x.deleted_at IS NULL) THEN response_status ELSE 'SENT' END WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL").run(q.rfq_id, q.vendor_id, q.rfq_id, q.vendor_id); audit(actor, 'proc_quotations', q.id, 'withdraw', q.company_id, { reason }); evt('proc.quotation.withdrawn', actor, { ...q }, { quotationId: q.id, vendorId: q.vendor_id, reason }, 'proc_quotation'); return quotes.get(actor, q.id); },
    cancel(actor, id, { reason }) { const q = rowQ(actor, id, 'proc.quotation.cancel'); if (!['DRAFT', 'RECEIVED'].includes(q.status)) throw unprocessable('Only a draft or received quotation is cancelled.'); db.prepare("UPDATE proc_quotations SET status = 'CANCELLED', cancel_reason = ?, updated_by = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, actor.user, nowIso(), q.id); audit(actor, 'proc_quotations', q.id, 'cancel', q.company_id, { reason }); return quotes.get(actor, q.id); },
    /** FR-06: a revised quotation: a new draft version, with the lines copied, that replaces the received one when it is recorded. */
    amend(actor, id, { reason }) {
      const q = rowQ(actor, id, 'proc.quotation.amend'); if (q.status !== 'RECEIVED') throw unprocessable('Only a received quotation is revised.'); const f = rfqOpen(actor, q.rfq_id); if (db.prepare("SELECT 1 FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'DRAFT' AND deleted_at IS NULL").get(q.rfq_id, q.vendor_id)) throw conflict('A draft revision of this quotation is open.');
      const v = quoteView(actor, q, { detail: true }); need(actor, 'proc.quotation.rates', 'copy the rates of a quotation', q.org_project_id);
      return transaction(db, () => { const n = insertQ(f, q.vendor_id, { quoteRef: q.quote_ref, quoteDate: todayIST(), validUntil: q.valid_until < todayIST() ? f.due_date : q.valid_until, deliveryDays: q.delivery_days, paymentTerms: q.payment_terms, freightTerms: q.freight_terms, gstInclusive: Boolean(q.gst_inclusive), deviations: q.deviations, lines: v.lines.map((l) => ({ rfqLineId: l.rfqLineId, offeredQty: l.offeredQty, rate: l.rate, discountPct: l.discountPct, gstRate: l.gstRate, freight: l.freight, loading: l.loading, otherCharges: l.otherCharges, make: l.make, deviation: l.deviation })) }, { via: 'MANUAL', user: actor.user, status: 'DRAFT' }); audit(actor, 'proc_quotations', n.id, 'amend', n.company_id, { reason, newValues: { of: q.doc_no } }); return quotes.get(actor, n.id); });
    },
    /** Lines keyed in as rows (by the RFQ line number) into a draft quotation. */
    importLines(actor, id, { rows }) {
      const q = rowQ(actor, id, 'proc.quotation.edit'); if (q.status !== 'DRAFT') throw conflict('Rates are loaded into a draft quotation.'); const f = rfqOpen(actor, q.rfq_id); const byNo = new Map(linesOf(f.id).map((l) => [l.line_no, l])); const problems = [];
      const lines = rows.map((x, i) => { const l = byNo.get(x.lineNo); if (!l) { problems.push({ field: `rows.${i}.lineNo`, message: `The RFQ has no line ${x.lineNo}` }); return null; } return { rfqLineId: l.id, offeredQty: x.offeredQty, rate: x.rate, discountPct: x.discountPct, gstRate: x.gstRate, freight: x.freight, loading: x.loading, otherCharges: x.otherCharges, make: x.make, deviation: x.deviation }; }).filter(Boolean); fail(problems);
      return quotes.update(actor, q.id, { lines });
    },
    history(actor, id) { const q = rowQ(actor, id); return { versions: db.prepare('SELECT id, doc_no, version_no, status, received_at, entered_via FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND deleted_at IS NULL ORDER BY version_no').all(q.rfq_id, q.vendor_id).map((x) => ({ id: x.id, docNo: x.doc_no, versionNo: x.version_no, status: x.status, statusLabel: QUOTE_STATUS[x.status], receivedAt: x.received_at, via: x.entered_via })), audit: db.prepare("SELECT action, actor, reason, created_at AS at FROM core_audit_log WHERE entity = 'proc_quotations' AND entity_id = ? ORDER BY id").all(String(q.id)) }; },
    print(actor, id) {
      const q = rowQ(actor, id, 'proc.quotation.print'); const v = quoteView(actor, q, { detail: true }); audit(actor, 'proc_quotations', q.id, 'print', q.company_id); const cols = [['lineNo', '#'], ['item', 'Item or service'], ['qty', 'Offered'], ['uom', 'Unit'], ['make', 'Make']]; if (v.canSeeRates) cols.push(['rate', 'Rate'], ['landed', 'Landed rate'], ['amount', 'Landed amount']);
      const rows = v.lines.map((l) => ({ lineNo: String(l.lineNo), item: l.itemCode ? `${l.itemCode} ${l.itemName}` : l.itemName, qty: String(l.offeredQty), uom: l.uom, make: l.make ?? '', rate: String(l.rate ?? ''), landed: String(l.landedRate ?? ''), amount: String(l.landedAmount ?? '') }));
      const footer = [`${v.docNo} (version ${v.versionNo}) for ${v.rfqNo}: ${v.vendor}`, `Valid until ${v.validUntil}; delivery in ${v.deliveryDays} days; ${v.paymentTerms ?? 'payment terms not stated'}`, v.gstInclusive ? 'Rates include GST' : 'Rates exclude GST', v.canSeeRates ? `Landed total ${v.totalLanded}${v.gstRecoverable ? ' (GST left out as recoverable)' : ''}` : '', v.deviations ? `Deviations: ${v.deviations}` : ''].filter(Boolean);
      return { buffer: toPdf({ columns: cols.map(([key, label]) => ({ key, label, type: 'text' })), rows, footer, title: `Quotation ${v.docNo}` }), contentType: 'application/pdf', fileName: `${v.docNo.replaceAll('/', '-')}.pdf`, rows: rows.length };
    },
  };

  // ---- the vendor's side: no sign-in, the link is the proof (FR-03). One use: after the quotation is submitted the link stops working until procurement issues a new one (T-01) ----------------------------------
  const byToken = (token) => {
    const v = db.prepare('SELECT * FROM proc_rfq_vendors WHERE token_hash = ? AND deleted_at IS NULL').get(hash(String(token))); if (!v) throw notFound('This link is not valid.');
    const r = db.prepare('SELECT * FROM proc_rfqs WHERE id = ? AND deleted_at IS NULL').get(v.rfq_id); if (!r) throw notFound('This link is not valid.');
    if (r.status !== 'ISSUED') throw gone(r.status === 'CLOSED' ? 'This request for quotation is closed.' : 'This request for quotation is no longer open.');
    if (v.token_expires && Date.parse(v.token_expires) < Date.now()) throw gone('This link has expired. Ask the buyer to send you a new one.');
    return { v, r };
  };
  const portal = {
    info(token) {
      const { v, r } = byToken(token); if (v.token_used_at) throw gone('You have already sent your quotation through this link. To revise it, ask the buyer to send you a new link.');
      if (v.response_status !== 'VIEWED') db.prepare("UPDATE proc_rfq_vendors SET response_status = CASE WHEN response_status IN ('INVITED', 'SENT') THEN 'VIEWED' ELSE response_status END, viewed_at = COALESCE(viewed_at, ?), updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), v.id);
      const co = db.prepare('SELECT short_name FROM org_companies WHERE id = ?').get(r.company_id)?.short_name ?? ''; const prev = db.prepare("SELECT * FROM proc_quotations WHERE rfq_id = ? AND vendor_id = ? AND status = 'RECEIVED' AND deleted_at IS NULL").get(r.id, v.vendor_id);
      return { company: co, rfq: { docNo: r.doc_no, title: r.title, dueDate: r.due_date, terms: json(r.terms_json, {}) }, vendor: vname(v.vendor_id).name, expires: v.token_expires, revising: Boolean(prev), gstRecoverable: recoverable(r.company_id),
        lines: linesOf(r.id).map((l) => { const it = l.item_id ? itemOf(r.company_id, l.item_id) : null; return { id: l.id, lineNo: l.line_no, item: it ? `${it.code} ${it.name}` : l.service_desc, qty: d3(l.qty), uom: l.uom, spec: l.spec, requiredBy: l.required_by }; }),
        clarifications: db.prepare('SELECT question, answer, vendor_id FROM proc_rfq_clarifications WHERE rfq_id = ? AND deleted_at IS NULL AND answer IS NOT NULL AND (share_all = 1 OR vendor_id = ?) ORDER BY id').all(r.id, v.vendor_id).map((c) => ({ question: c.question, answer: c.answer })) };
    },
    submit(token, b) {
      const { v, r } = byToken(token); if (v.token_used_at) throw gone('You have already sent your quotation through this link. To revise it, ask the buyer to send you a new link.'); const user = `vendor:${vname(v.vendor_id).code}`; const actor = { user, companyId: r.company_id, roles: ['VENDOR'] };
      return transaction(db, () => {
        const q = insertQ(r, v.vendor_id, { ...b, quoteDate: todayIST() }, { via: 'PORTAL', user, status: 'DRAFT' }); receive(actor, q); const now = nowIso(); db.prepare('UPDATE proc_rfq_vendors SET token_used_at = ?, updated_at = ? WHERE id = ?').run(now, now, v.id);
        audit(actor, 'proc_quotations', q.id, 'submit', r.company_id, { newValues: { rfq: r.doc_no, version: q.version_no, via: 'PORTAL' } }); return { docNo: q.doc_no, versionNo: q.version_no, message: 'Your quotation is received. Thank you. This link now stops working; the buyer will contact you.' };
      });
    },
    decline(token, { reason }) {
      const { v, r } = byToken(token); if (v.token_used_at) throw gone('You have already answered through this link.'); const now = nowIso();
      db.prepare("UPDATE proc_rfq_vendors SET response_status = 'DECLINED', decline_reason = ?, responded_at = ?, token_used_at = ?, updated_at = ?, version = version + 1 WHERE id = ?").run(reason, now, now, now, v.id); audit({ user: `vendor:${vname(v.vendor_id).code}`, companyId: r.company_id }, 'proc_rfq_vendors', v.id, 'decline', r.company_id, { reason });
      notify(r.company_id, 'proc.rfq.quote_received', [`user:${r.issued_by ?? r.requested_by}`], r.doc_no, r.title, `${vname(v.vendor_id).name} declined to quote${reason ? `: ${reason}` : ''}.`, `/proc/rfqs?id=${r.id}`, `${v.id}.d`, { projectId: r.org_project_id }); return { message: 'Thank you for letting us know.' };
    },
    clarify(token, { question }) {
      const { v, r } = byToken(token); const cid = Number(db.prepare("INSERT INTO proc_rfq_clarifications (company_id, rfq_id, vendor_id, asked_by, question, project_id, created_by, source_type) VALUES (?, ?, ?, ?, ?, ?, ?, 'portal')").run(r.company_id, r.id, v.vendor_id, `vendor:${vname(v.vendor_id).code}`, question, r.org_project_id, `vendor:${vname(v.vendor_id).code}`).lastInsertRowid);
      notify(r.company_id, 'proc.rfq.quote_received', [`user:${r.issued_by ?? r.requested_by}`], r.doc_no, r.title, `${vname(v.vendor_id).name} asked: ${question.slice(0, 160)}`, `/proc/rfqs?id=${r.id}`, `${cid}.q`, { projectId: r.org_project_id }); return { message: 'Your question is sent. The answer will appear on this page.' };
    },
  };
  return { rfqs, quotes, portal, decide: rfqs.decide, landed };
}
